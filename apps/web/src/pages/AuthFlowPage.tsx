/*
 * Standalone Full-Page Identity & Security Flow
 * Built to `modern-web-guidance` standards:
 * - `autofill-sign-in-form` & `autofill-sign-up-form`: semantic `<form method="POST">`,
 *   stable `name`/`id`, `autocomplete`, `autocorrect="off"`, `autocapitalize="none"`,
 *   `enterkeyhint`, accessible Eye toggle with `aria-pressed`.
 * - `sms-otp-form` & `forms`: single native `<input autocomplete="one-time-code" inputMode="numeric">`
 *   layered over 6 tactile visual slots, real `<input type="radio">` role cards,
 *   `<nav>` + `<Link>` mode links, strict 3-step gated password reset with confirm password,
 *   debounced username availability check, persisted 60s resend cooldown, and advisory-only
 *   native `<progress>` password strength meter (`progress`).
 */

import {
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { OtpInput } from '../components/auth/OtpInput';
import { PasswordStrengthMeter } from '../components/auth/PasswordStrengthMeter';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconMoon,
  IconShield,
  IconSnowflake,
  IconSun,
  IconUpload,
} from '../components/ui/Icons';
import { PopupMenu } from '../components/ui/PopupMenu';
import { useToast } from '../components/ui/ToastProvider';
import { UserAvatar } from '../components/ui/UserAvatar';
import { api } from '../lib/api';
import { ApiError, resolveLocalizedError } from '../lib/apiError';
import {
  detectSystemLocale,
  LOCALES,
  type LocalePreference,
  UI_COPY,
} from '../lib/i18n';
import { RC3_COPY } from '../lib/i18nRc3';
import { SafeHtml } from '../lib/sanitizer';
import type { ResolvedTheme } from '../lib/theme';
import {
  getEffectiveOAuthProviders,
  type AvatarSource,
  type LocaleCode,
  type LoginOtpChallengeResponse,
  type OAuthOnboardingInfoDto,
  type SiteSettingsDto,
  type UserProfileDto,
} from '../lib/types';
import { useAccessibleFormValidation } from '../lib/useFormValidation';

export type AuthFlowMode = 'login' | 'register' | 'forgot' | 'reset' | 'onboarding';

type OtpFlowKind = 'register' | 'reset' | 'login_anomaly';
type UsernameCheckState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid_format';

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

function otpCooldownKey(flow: OtpFlowKind, subject: string): string {
  return `ihn_otp_cd:${flow}:${subject.trim().toLowerCase()}`;
}

function saveOtpCooldown(flow: OtpFlowKind, subject: string, seconds: number): void {
  const clean = subject.trim();
  if (!clean || seconds <= 0) return;
  try {
    sessionStorage.setItem(
      otpCooldownKey(flow, clean),
      String(Date.now() + seconds * 1000),
    );
  } catch {
    // ignore storage errors
  }
}

function readOtpCooldown(flow: OtpFlowKind, subject: string): number {
  const clean = subject.trim();
  if (!clean) return 0;
  try {
    const raw = sessionStorage.getItem(otpCooldownKey(flow, clean));
    if (!raw) return 0;
    const deadline = Number(raw);
    if (!Number.isFinite(deadline)) return 0;
    const rem = Math.ceil((deadline - Date.now()) / 1000);
    if (rem <= 0) {
      sessionStorage.removeItem(otpCooldownKey(flow, clean));
      return 0;
    }
    return rem;
  } catch {
    return 0;
  }
}

function useUsernameAvailability(
  username: string,
  enabled: boolean,
  inputRef: RefObject<HTMLInputElement | null>,
  takenMsg: string,
  invalidFormatMsg: string,
): UsernameCheckState {
  const [status, setStatus] = useState<UsernameCheckState>('idle');

  useEffect(() => {
    const input = inputRef.current;
    if (!enabled) {
      setStatus('idle');
      if (input) input.setCustomValidity('');
      return;
    }

    const clean = username.trim();
    if (!clean) {
      setStatus('idle');
      if (input) input.setCustomValidity('');
      return;
    }

    if (!USERNAME_PATTERN.test(clean)) {
      setStatus('invalid_format');
      if (input) input.setCustomValidity(invalidFormatMsg);
      return;
    }

    if (input) input.setCustomValidity('');
    setStatus('checking');

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api
        .checkUsername(clean, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          if (res.available) {
            setStatus('available');
            inputRef.current?.setCustomValidity('');
          } else if (res.reason === 'invalid_format') {
            setStatus('invalid_format');
            inputRef.current?.setCustomValidity(invalidFormatMsg);
          } else {
            setStatus('taken');
            inputRef.current?.setCustomValidity(takenMsg);
          }
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setStatus('idle');
          inputRef.current?.setCustomValidity('');
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [username, enabled, inputRef, takenMsg, invalidFormatMsg]);

  return status;
}

interface AuthFlowPageProps {
  mode: AuthFlowMode;
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  siteSettings: SiteSettingsDto;
  settingsResolved: boolean;
  blogSsoEntryUrl: string;
  user: UserProfileDto | null;
  authResolved: boolean;
  onAuthenticated: (user: UserProfileDto) => void;
}

function sanitizeReturnTo(raw: string | null, locale: LocaleCode): string {
  if (!raw) return `/${locale}`;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return `/${locale}`;
  if (
    /^\/[^/]+\/auth(\/|$)/.test(trimmed) ||
    /^\/[^/]+\/(login|register)(\/|$)/.test(trimmed)
  ) {
    return `/${locale}`;
  }
  return trimmed;
}

function StepProgressNav({
  steps,
  activeIndex,
  ariaLabel,
}: {
  steps: string[];
  activeIndex: number;
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="mb-6">
      <ol className="flex items-center gap-2 list-none m-0 p-0">
        {steps.map((label, idx) => {
          const done = idx < activeIndex;
          const active = idx === activeIndex;
          return (
            <li
              key={label}
              aria-current={active ? 'step' : undefined}
              className="flex items-center gap-2 min-w-0 flex-1 last:flex-initial"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-mono shrink-0 transition-colors ${
                    active
                      ? 'bg-action-bg text-action-fg font-semibold'
                      : done
                        ? 'bg-accent-success text-action-fg'
                        : 'bg-surface-raised border border-border-subtle text-ink-muted'
                  }`}
                >
                  {done ? <IconCheck className="w-3.5 h-3.5" /> : idx + 1}
                </span>
                <span
                  className={`text-xs truncate ${
                    active
                      ? 'font-semibold text-ink-primary'
                      : done
                        ? 'font-semibold text-ink-secondary'
                        : 'text-ink-muted'
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`h-px flex-1 min-w-3 border-t border-dashed ${
                    done ? 'border-accent-success' : 'border-border-subtle'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FieldErrorText({
  id,
  prefixLabel,
  message,
}: {
  id: string;
  prefixLabel: string;
  message: string;
}) {
  return (
    <div id={id} className="auth-error-msg">
      <span role="img" aria-label={prefixLabel} className="inline-flex mt-0.5 shrink-0">
        <IconAlertCircle className="w-3.5 h-3.5" />
      </span>
      <span>{message}</span>
    </div>
  );
}

function UsernameStatusHint({
  id,
  status,
  checkingText,
  availableText,
  takenText,
  invalidFormatText,
}: {
  id: string;
  status: UsernameCheckState;
  checkingText: string;
  availableText: string;
  takenText: string;
  invalidFormatText: string;
}) {
  if (status === 'idle') return null;
  if (status === 'checking') {
    return (
      <p
        id={id}
        role="status"
        aria-live="polite"
        className="mt-1.5 mb-0 text-xs text-ink-muted leading-snug"
      >
        {checkingText}
      </p>
    );
  }
  if (status === 'available') {
    return (
      <p
        id={id}
        role="status"
        aria-live="polite"
        className="mt-1.5 mb-0 text-xs font-semibold flex items-center gap-1 leading-snug"
        style={{ color: 'var(--accent-success-ink)' }}
      >
        <IconCheck className="w-3.5 h-3.5 shrink-0" />
        <span>{availableText}</span>
      </p>
    );
  }
  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      className="mt-1.5 mb-0 text-xs font-semibold flex items-start gap-1 leading-snug"
      style={{ color: 'var(--accent-danger-ink)' }}
    >
      <IconAlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{status === 'taken' ? takenText : invalidFormatText}</span>
    </p>
  );
}

export function AuthFlowPage({
  mode,
  locale,
  localePref,
  onChangeLocalePref,
  theme,
  onToggleTheme,
  siteSettings,
  settingsResolved,
  blogSsoEntryUrl,
  user,
  authResolved,
  onAuthenticated,
}: AuthFlowPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const ui = UI_COPY[locale];
  const copy = ui.auth;
  const rc3 = RC3_COPY[locale].auth;
  const profCopy = RC3_COPY[locale].profile;

  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get('return_to'), locale),
    [locale, searchParams],
  );
  const returnQuerySuffix = useMemo(() => {
    const raw = searchParams.get('return_to');
    if (!raw || sanitizeReturnTo(raw, locale) === `/${locale}`) return '';
    return `?return_to=${encodeURIComponent(raw)}`;
  }, [locale, searchParams]);

  const resetTokenFromUrl = searchParams.get('reset_token') ?? '';
  const resetEmailFromUrl = searchParams.get('email') ?? '';
  const onboardingTokenFromUrl = searchParams.get('oauth_onboarding') ?? '';

  const activeFormRef = useRef<HTMLFormElement | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const regUsernameRef = useRef<HTMLInputElement | null>(null);
  const onbUsernameRef = useRef<HTMLInputElement | null>(null);
  const resetConfirmPwRef = useRef<HTMLInputElement | null>(null);

  const [codeCooldown, setCodeCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Login + Anomaly OTP state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginChallenge, setLoginChallenge] =
    useState<LoginOtpChallengeResponse | null>(null);
  const [loginOtpCode, setLoginOtpCode] = useState('');
  const [resendingLoginOtp, setResendingLoginOtp] = useState(false);

  // Register 2-step state
  const [regStep, setRegStep] = useState<'details' | 'otp'>('details');
  const [regUsername, setRegUsername] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regRole, setRegRole] = useState<'reader' | 'author'>('reader');
  const [regOtpCode, setRegOtpCode] = useState('');
  const [sendingRegCode, setSendingRegCode] = useState(false);

  // Forgot & 3-Step Gated Reset state
  const [forgotEmail, setForgotEmail] = useState(resetEmailFromUrl);
  const [resetEmail, setResetEmail] = useState(resetEmailFromUrl);
  const [resetOtpCode, setResetOtpCode] = useState('');
  const [verifiedResetToken, setVerifiedResetToken] = useState('');
  const [verifyingResetOtp, setVerifyingResetOtp] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [resendingReset, setResendingReset] = useState(false);

  // OAuth Onboarding state
  const [onboardingInfo, setOnboardingInfo] =
    useState<OAuthOnboardingInfoDto | null>(null);
  const [onboardingTab, setOnboardingTab] = useState<'register' | 'bind'>('register');
  const [onbUsername, setOnbUsername] = useState('');
  const [onbDisplayName, setOnbDisplayName] = useState('');
  const [onbEmail, setOnbEmail] = useState('');
  const [onbRole, setOnbRole] = useState<'reader' | 'author'>('reader');
  const [onbAvatarSource, setOnbAvatarSource] = useState<AvatarSource>('oauth');
  const [onbUploadedAvatar, setOnbUploadedAvatar] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);

  const effectiveResetToken = verifiedResetToken || resetTokenFromUrl;

  const regUsernameStatus = useUsernameAvailability(
    regUsername,
    mode === 'register' && regStep === 'details',
    regUsernameRef,
    rc3.usernameTaken,
    rc3.usernameInvalidFormat,
  );

  const onbUsernameStatus = useUsernameAvailability(
    onbUsername,
    mode === 'onboarding' && onboardingTab === 'register' && Boolean(onboardingInfo),
    onbUsernameRef,
    rc3.usernameTaken,
    rc3.usernameInvalidFormat,
  );

  useAccessibleFormValidation(activeFormRef, [
    mode,
    regStep,
    Boolean(loginChallenge),
    onboardingTab,
    Boolean(onboardingInfo),
    Boolean(effectiveResetToken),
    settingsResolved,
  ]);

  // Keep confirm password custom validity synchronized in Reset Step 3
  useEffect(() => {
    const confirmInput = resetConfirmPwRef.current;
    if (!confirmInput) return;
    if (confirmNewPassword && confirmNewPassword !== newPassword) {
      confirmInput.setCustomValidity(rc3.passwordMismatchMsg);
    } else {
      confirmInput.setCustomValidity('');
    }
  }, [newPassword, confirmNewPassword, rc3.passwordMismatchMsg]);

  // Redirect authenticated users away from plain login/register pages
  useEffect(() => {
    if (!authResolved || !user) return;
    if (mode === 'login' || mode === 'register') {
      navigate(returnTo, { replace: true });
    }
  }, [authResolved, mode, navigate, returnTo, user]);

  // Reset transient sub-steps when switching primary auth route
  useEffect(() => {
    setLoginChallenge(null);
    setLoginOtpCode('');
    setRegStep('details');
    setRegOtpCode('');
    setVerifiedResetToken('');
    if (mode === 'reset') {
      if (resetEmailFromUrl) setResetEmail(resetEmailFromUrl);
      setResetOtpCode('');
      setNewPassword('');
      setConfirmNewPassword('');
    }
    if (mode === 'forgot' && resetEmailFromUrl) {
      setForgotEmail(resetEmailFromUrl);
    }
  }, [mode, resetEmailFromUrl]);

  // Hydrate persisted 60s resend cooldown whenever entering an OTP step
  useEffect(() => {
    if (mode === 'login' && loginChallenge) {
      setCodeCooldown(readOtpCooldown('login_anomaly', loginChallenge.challenge_id));
    } else if (mode === 'register' && regStep === 'otp') {
      setCodeCooldown(readOtpCooldown('register', regEmail));
    } else if (mode === 'reset' && !effectiveResetToken) {
      setCodeCooldown(readOtpCooldown('reset', resetEmail));
    }
  }, [mode, loginChallenge, regStep, regEmail, resetEmail, effectiveResetToken]);

  // Fetch OAuth Onboarding context
  useEffect(() => {
    if (mode !== 'onboarding') return;
    if (!onboardingTokenFromUrl) {
      navigate(`/${locale}/auth/login`, { replace: true });
      return;
    }
    let active = true;
    setOnboardingInfo(null);
    void api
      .getOAuthOnboarding(onboardingTokenFromUrl)
      .then((info) => {
        if (!active) return;
        setOnboardingInfo(info);
        setOnbUsername(info.suggested_username);
        setOnbDisplayName(info.display_name);
        setOnbEmail(info.email);
        setOnbRole('reader');
        setOnbAvatarSource(
          info.oauth_avatar_url
            ? 'oauth'
            : info.gravatar_preview_url
              ? 'gravatar'
              : 'default',
        );
        setOnboardingTab(info.allow_registration ? 'register' : 'bind');
      })
      .catch((err) => {
        if (!active) return;
        toast.error(err);
        navigate(`/${locale}/auth/login`, { replace: true });
      });
    return () => {
      active = false;
    };
  }, [locale, mode, navigate, onboardingTokenFromUrl, toast]);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCodeCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const finishAuth = (authenticatedUser: UserProfileDto, message: string) => {
    toast.success(message);
    onAuthenticated(authenticatedUser);
    navigate(returnTo, { replace: true });
  };

  // --- Handlers ---

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password || submitting) return;
    setSubmitting(true);
    try {
      const result = await api.loginWithPassword(identifier.trim(), password, locale);
      if (result.requires_otp) {
        const cd = result.cooldown_seconds || 60;
        saveOtpCooldown('login_anomaly', result.challenge_id, cd);
        setLoginChallenge(result);
        setLoginOtpCode('');
        setCodeCooldown(cd);
        toast.warning(rc3.anomalyTitle);
        window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
        return;
      }
      finishAuth(result.user, rc3.signedInWelcomeMsg(result.user.display_name));
    } catch (err) {
      toast.error(err, copy.loginFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyLoginOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (!loginChallenge || submitting) return;
    const code = loginOtpCode.trim();
    if (code.length < 6) {
      toast.error('OTP_CHALLENGE_INVALID');
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.verifyLoginOtp(loginChallenge.challenge_id, code);
      finishAuth(session.user, rc3.signedInWelcomeMsg(session.user.display_name));
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendLoginOtp = async () => {
    if (!loginChallenge || resendingLoginOtp || codeCooldown > 0) return;
    setResendingLoginOtp(true);
    try {
      const res = await api.resendLoginOtp(loginChallenge.challenge_id, locale);
      const cd = res.cooldown_seconds || 60;
      saveOtpCooldown('login_anomaly', loginChallenge.challenge_id, cd);
      setCodeCooldown(cd);
      toast.success(rc3.codeSentToast(loginChallenge.masked_email));
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'VERIFICATION_CODE_RATE_LIMITED' &&
        err.meta &&
        typeof err.meta.retry_after_secs === 'number'
      ) {
        const rem = Math.max(1, Math.round(err.meta.retry_after_secs));
        saveOtpCooldown('login_anomaly', loginChallenge.challenge_id, rem);
        setCodeCooldown(rem);
      }
      toast.error(err);
    } finally {
      setResendingLoginOtp(false);
    }
  };

  const requestRegisterCode = async (email: string): Promise<boolean> => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      toast.error('INVALID_EMAIL');
      return false;
    }
    if (sendingRegCode) return false;
    setSendingRegCode(true);
    try {
      const res = await api.sendRegisterVerificationCode(cleanEmail, locale);
      const cd = res.cooldown_seconds || 60;
      saveOtpCooldown('register', cleanEmail, cd);
      setCodeCooldown(cd);
      toast.success(rc3.codeSentToast(cleanEmail));
      return true;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'VERIFICATION_CODE_RATE_LIMITED' &&
        err.meta &&
        typeof err.meta.retry_after_secs === 'number'
      ) {
        const rem = Math.max(1, Math.round(err.meta.retry_after_secs));
        saveOtpCooldown('register', cleanEmail, rem);
        setCodeCooldown(rem);
      }
      toast.error(err);
      return false;
    } finally {
      setSendingRegCode(false);
    }
  };

  const handleRegisterStep1Submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sendingRegCode || submitting) return;
    if (regUsernameStatus === 'taken') {
      toast.error('USERNAME_TAKEN');
      regUsernameRef.current?.focus();
      return;
    }
    if (regUsernameStatus === 'invalid_format') {
      toast.error('INVALID_USERNAME');
      regUsernameRef.current?.focus();
      return;
    }
    const existingCooldown = readOtpCooldown('register', regEmail);
    if (existingCooldown > 0) {
      setCodeCooldown(existingCooldown);
      setRegOtpCode('');
      setRegStep('otp');
      window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
      return;
    }
    const ok = await requestRegisterCode(regEmail);
    if (ok) {
      setRegOtpCode('');
      setRegStep('otp');
      window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    }
  };

  const handleRegisterStep2Submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const code = regOtpCode.trim();
    if (code.length < 6) {
      toast.error('VERIFICATION_CODE_REQUIRED');
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.registerAccount({
        username: regUsername.trim(),
        email: regEmail.trim(),
        password: regPassword,
        verification_code: code,
        display_name: regDisplayName.trim() || regUsername.trim(),
        role: siteSettings.allow_author_registration ? regRole : 'reader',
      });
      finishAuth(session.user, rc3.registeredWelcomeMsg(session.user.display_name));
    } catch (err) {
      toast.error(err, copy.registerFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = forgotEmail.trim();
    if (!cleanEmail || submitting) return;
    const targetUrl = `/${locale}/auth/reset-password?email=${encodeURIComponent(cleanEmail)}${returnQuerySuffix ? `&${returnQuerySuffix.slice(1)}` : ''}`;
    const existingCooldown = readOtpCooldown('reset', cleanEmail);
    if (existingCooldown > 0) {
      setCodeCooldown(existingCooldown);
      navigate(targetUrl);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.forgotPassword(cleanEmail, locale);
      const cd = res.cooldown_seconds || 60;
      saveOtpCooldown('reset', cleanEmail, cd);
      setCodeCooldown(cd);
      toast.success(rc3.resetEmailSentMsg);
      navigate(targetUrl);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'VERIFICATION_CODE_RATE_LIMITED' &&
        err.meta &&
        typeof err.meta.retry_after_secs === 'number'
      ) {
        const rem = Math.max(1, Math.round(err.meta.retry_after_secs));
        saveOtpCooldown('reset', cleanEmail, rem);
        setCodeCooldown(rem);
        toast.error(err);
        navigate(targetUrl);
        return;
      }
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendResetCode = async () => {
    const cleanEmail = resetEmail.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (resendingReset || codeCooldown > 0) return;
    setResendingReset(true);
    try {
      const res = await api.forgotPassword(cleanEmail, locale);
      const cd = res.cooldown_seconds || 60;
      saveOtpCooldown('reset', cleanEmail, cd);
      setCodeCooldown(cd);
      toast.success(rc3.resetEmailSentMsg);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'VERIFICATION_CODE_RATE_LIMITED' &&
        err.meta &&
        typeof err.meta.retry_after_secs === 'number'
      ) {
        const rem = Math.max(1, Math.round(err.meta.retry_after_secs));
        saveOtpCooldown('reset', cleanEmail, rem);
        setCodeCooldown(rem);
      }
      toast.error(err);
    } finally {
      setResendingReset(false);
    }
  };

  const handleVerifyResetOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (verifyingResetOtp) return;
    const cleanEmail = resetEmail.trim();
    const cleanCode = resetOtpCode.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (cleanCode.length < 6) {
      toast.error('OTP_CHALLENGE_INVALID');
      return;
    }
    setVerifyingResetOtp(true);
    try {
      const res = await api.verifyResetOtp(cleanEmail, cleanCode);
      setVerifiedResetToken(res.reset_token);
      setNewPassword('');
      setConfirmNewPassword('');
      window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    } catch (err) {
      toast.error(err);
    } finally {
      setVerifyingResetOtp(false);
    }
  };

  const handleResetPasswordStep3Submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !effectiveResetToken) return;
    if (newPassword !== confirmNewPassword) {
      toast.warning(rc3.passwordMismatchMsg);
      resetConfirmPwRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.resetPassword({
        token: effectiveResetToken,
        new_password: newPassword,
      });
      finishAuth(session.user, rc3.resetSuccessMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOnboardingAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploadingAvatar || !onboardingTokenFromUrl) return;
    setUploadingAvatar(true);
    try {
      const res = await api.uploadMedia(file, onboardingTokenFromUrl);
      setOnbUploadedAvatar(res.url);
      setOnbAvatarSource('upload');
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleOnboardingRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !onboardingTokenFromUrl) return;
    if (onbUsernameStatus === 'taken') {
      toast.error('USERNAME_TAKEN');
      onbUsernameRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.completeOAuthRegistration({
        onboarding_token: onboardingTokenFromUrl,
        username: onbUsername.trim(),
        display_name: onbDisplayName.trim() || onbUsername.trim(),
        email: onbEmail.trim(),
        role: onboardingInfo?.allow_author_registration ? onbRole : 'reader',
        avatar_source: onbAvatarSource,
        uploaded_avatar_url: onbUploadedAvatar,
      });
      finishAuth(session.user, rc3.registeredWelcomeMsg(session.user.display_name));
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOnboardingBind = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !onboardingTokenFromUrl) return;
    setSubmitting(true);
    try {
      const session = await api.bindExistingOAuth({
        onboarding_token: onboardingTokenFromUrl,
        identifier: identifier.trim(),
        password,
      });
      finishAuth(session.user, rc3.oauthBoundSuccessMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const visibleLocales = LOCALES.filter((l) =>
    siteSettings.enabled_locales.includes(l.code),
  );
  const localesToRender = visibleLocales.length > 0 ? visibleLocales : LOCALES;
  const systemResolvedLocale = detectSystemLocale(
    siteSettings.enabled_locales,
    siteSettings.default_locale,
  );
  const systemShortLabel =
    LOCALES.find((l) => l.code === systemResolvedLocale)?.short ??
    systemResolvedLocale;
  const activeLocaleShort =
    LOCALES.find((l) => l.code === locale)?.short ?? locale;

  const enabledOAuthProviders = getEffectiveOAuthProviders(siteSettings).filter(
    (p) => p.enabled && p.client_id.trim().length > 0,
  );
  const oauthEnabled = enabledOAuthProviders.length > 0;
  const oauthLabel =
    enabledOAuthProviders[0]?.name.trim() ||
    siteSettings.oauth_provider_name.trim() ||
    'OAuth';
  const ssoEnabled =
    siteSettings.sso_enabled && Boolean(siteSettings.blog_origin_url.trim());

  const anomalyDescription =
    loginChallenge?.anomaly_reason === 'new_ip'
      ? rc3.anomalyDescNewIp
      : loginChallenge?.anomaly_reason === 'new_device'
        ? rc3.anomalyDescNewDevice
        : rc3.anomalyDescBoth;

  const onbAvatarPreview =
    onbAvatarSource === 'upload'
      ? onbUploadedAvatar
      : onbAvatarSource === 'oauth'
        ? onboardingInfo?.oauth_avatar_url ?? ''
        : onbAvatarSource === 'gravatar'
          ? onboardingInfo?.gravatar_preview_url ?? ''
          : '';

  const pageHeading =
    mode === 'login'
      ? loginChallenge
        ? rc3.anomalyTitle
        : copy.title
      : mode === 'register'
        ? copy.registerTitle
        : mode === 'forgot'
          ? rc3.forgotPasswordTitle
          : mode === 'reset'
            ? effectiveResetToken
              ? rc3.resetPasswordTitle
              : rc3.authStepVerifyOtp
            : rc3.onboardingTitle(onboardingInfo?.provider_name || oauthLabel);

  const pageSubtitle =
    mode === 'login'
      ? loginChallenge
        ? ''
        : rc3.loginSubtitle
      : mode === 'register'
        ? regStep === 'details'
          ? rc3.registerSubtitle
          : ''
        : mode === 'forgot'
          ? rc3.forgotPasswordDesc
          : mode === 'reset' && !effectiveResetToken
            ? rc3.resetOtpHint
            : '';

  const showPasswordToggleWarningId = 'auth-pw-toggle-warn';
  const resetFlowSteps = [
    rc3.authStepEmail,
    rc3.authStepVerifyOtp,
    rc3.authStepNewPassword,
  ];

  return (
    <div className="min-h-svh w-full flex flex-col auth-canvas-bg">
      {/* Shared screen-reader-only warning for password reveal buttons (`forms` §8) */}
      <span id={showPasswordToggleWarningId} className="sr-only">
        {rc3.passwordToggleWarning}
      </span>

      {/* Minimal Distraction-Free Auth Top Bar */}
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link
          to={`/${locale}`}
          className="inline-flex items-center gap-2.5 text-ink-primary no-underline min-w-0"
        >
          <span className="w-8 h-8 rounded-xl border border-border-ink bg-surface-sheet flex items-center justify-center shrink-0 overflow-hidden">
            {siteSettings.logo_url?.trim() ? (
              <img
                src={siteSettings.logo_url}
                alt=""
                className="w-6 h-6 object-contain"
              />
            ) : (
              <IconSnowflake className="w-4 h-4 text-accent-primary" />
            )}
          </span>
          <span className="text-sm sm:text-base font-semibold tracking-tight truncate">
            <SafeHtml html={siteSettings.site_name} />
          </span>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <PopupMenu
            align="end"
            triggerAriaLabel={ui.navLanguageAria}
            minWidthClass="min-w-44"
            triggerClassName="inline-flex items-center gap-1.5 min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer transition-colors"
            triggerLabel={
              <>
                <IconGlobe className="w-3.5 h-3.5 text-ink-muted" />
                <span>{activeLocaleShort}</span>
              </>
            }
          >
            {({ close }) => (
              <div className="py-1">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={localePref === 'auto'}
                  onClick={() => {
                    onChangeLocalePref('auto');
                    close(true);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 text-ink-primary hover:bg-surface-raised cursor-pointer"
                >
                  <span>
                    {ui.followSystemLocale} ({systemShortLabel})
                  </span>
                  {localePref === 'auto' && (
                    <IconCheck className="w-3.5 h-3.5 text-accent-primary" />
                  )}
                </button>
                <div className="my-1 border-t border-border-subtle" />
                {localesToRender.map((loc) => {
                  const selected = localePref === loc.code;
                  return (
                    <button
                      key={loc.code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        onChangeLocalePref(loc.code);
                        close(true);
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 text-ink-primary hover:bg-surface-raised cursor-pointer"
                    >
                      <span>{loc.label}</span>
                      {selected && (
                        <IconCheck className="w-3.5 h-3.5 text-accent-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </PopupMenu>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? ui.themeLightLabel : ui.themeDarkLabel}
            className="w-8 h-8 rounded-xl bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary inline-flex items-center justify-center cursor-pointer transition-colors"
          >
            {theme === 'dark' ? (
              <IconSun className="w-4 h-4" />
            ) : (
              <IconMoon className="w-4 h-4" />
            )}
          </button>

          <Link
            to={`/${locale}`}
            className="hidden sm:inline-flex items-center gap-1 min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold text-ink-muted hover:text-ink-primary hover:bg-surface-raised no-underline transition-colors"
          >
            <IconArrowLeft className="w-3.5 h-3.5" />
            <span>{rc3.backToHome}</span>
          </Link>
        </div>
      </header>

      {/* Main Centered Stationery Sheet */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-[448px] mx-auto">
          <div className="notebook-sheet-stack">
            <div className="notebook-sheet-card p-6 sm:p-8">
              {/* Editorial Heading */}
              <div className="mb-6">
                <div className="flex items-center gap-2.5">
                  {loginChallenge && (
                    <span
                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: 'var(--alert-warn-badge-bg)',
                        color: 'var(--alert-warn-badge-fg)',
                      }}
                    >
                      <IconShield className="w-4 h-4" />
                    </span>
                  )}
                  <h1
                    ref={stepHeadingRef}
                    tabIndex={-1}
                    className="text-xl sm:text-2xl font-semibold text-ink-primary m-0 leading-tight tracking-tight auth-heading-balance focus:outline-none"
                  >
                    {pageHeading}
                  </h1>
                </div>
                {pageSubtitle && (
                  <p className="mt-2 text-xs text-ink-muted m-0 leading-relaxed auth-copy-pretty">
                    {pageSubtitle}
                  </p>
                )}
              </div>

              {/* ================= MODE 1: LOGIN (STEP 1 & STEP 2 ANOMALY OTP) ================= */}
              {mode === 'login' && !loginChallenge && (
                <div className="flex flex-col gap-5">
                  <form
                    ref={activeFormRef}
                    method="POST"
                    onSubmit={(e) => void handleLoginSubmit(e)}
                    className="flex flex-col gap-4"
                  >
                    <div className="auth-field">
                      <label htmlFor="auth-login-id" className="ink-field-label">
                        {copy.identifierLabel}
                      </label>
                      <input
                        id="auth-login-id"
                        name="username"
                        type="text"
                        required
                        autoFocus
                        autoComplete="username"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        enterKeyHint="next"
                        data-error="auth-login-id-err"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder={copy.identifierPlaceholder}
                        className="auth-input"
                      />
                      <FieldErrorText
                        id="auth-login-id-err"
                        prefixLabel={rc3.errorPrefixLabel}
                        message={rc3.errIdentifierRequired}
                      />
                    </div>

                    <div className="auth-field">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <label
                          htmlFor="auth-login-pw"
                          className="text-xs font-semibold text-ink-secondary"
                        >
                          {copy.passwordLabel}
                        </label>
                        <Link
                          to={`/${locale}/auth/forgot-password${returnQuerySuffix}`}
                          className="text-xs font-semibold text-link-ink no-underline hover:underline"
                        >
                          {rc3.forgotPasswordLink}
                        </Link>
                      </div>
                      <div className="relative">
                        <input
                          id="auth-login-pw"
                          name="password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          enterKeyHint="done"
                          data-error="auth-login-pw-err"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={copy.passwordPlaceholder}
                          className="auth-input pr-11"
                        />
                        <button
                          type="button"
                          aria-pressed={showPassword}
                          aria-label={
                            showPassword ? copy.hidePassword : copy.showPassword
                          }
                          aria-describedby={showPasswordToggleWarningId}
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute inset-y-0 right-1 my-auto w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                        >
                          {showPassword ? (
                            <IconEyeOff className="w-4 h-4" />
                          ) : (
                            <IconEye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <FieldErrorText
                        id="auth-login-pw-err"
                        prefixLabel={rc3.errorPrefixLabel}
                        message={rc3.errPasswordLength}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                    >
                      {submitting ? copy.submitting : copy.submitBtn}
                    </button>
                  </form>

                  {(oauthEnabled || (ssoEnabled && blogSsoEntryUrl)) && (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center gap-3 text-xs text-ink-muted">
                        <span className="h-px flex-1 bg-border-subtle" />
                        <span>{copy.orDivider}</span>
                        <span className="h-px flex-1 bg-border-subtle" />
                      </div>

                      {oauthEnabled &&
                        enabledOAuthProviders.map((provider) => {
                          const label =
                            provider.name.trim() || provider.id || 'OAuth';
                          const href = `/api/v1/auth/oauth/authorize?provider=${encodeURIComponent(provider.id)}&return_to=${encodeURIComponent(returnTo)}`;
                          return (
                            <a
                              key={provider.id}
                              href={href}
                              className="w-full min-h-10 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center justify-center no-underline"
                            >
                              {copy.oauthSignInBtn(label)}
                            </a>
                          );
                        })}

                      {ssoEnabled && blogSsoEntryUrl && (
                        <a
                          href={blogSsoEntryUrl}
                          className="w-full min-h-10 px-4 py-2 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center justify-center no-underline transition-colors"
                        >
                          {copy.blogSsoLink}
                        </a>
                      )}
                    </div>
                  )}

                  {settingsResolved && siteSettings.allow_registration && (
                    <nav
                      aria-label={copy.registerTab}
                      className="pt-4 border-t border-dashed border-border-subtle flex items-center justify-center gap-1.5 text-xs text-ink-muted"
                    >
                      <span>{rc3.noAccountPrompt}</span>
                      <Link
                        to={`/${locale}/auth/register${returnQuerySuffix}`}
                        className="font-semibold text-link-ink no-underline hover:underline"
                      >
                        {rc3.goToRegisterLink}
                      </Link>
                    </nav>
                  )}
                </div>
              )}

              {mode === 'login' && loginChallenge && (
                <div className="flex flex-col gap-4">
                  <StepProgressNav
                    steps={[copy.signInTab, rc3.authStepVerifyOtp]}
                    activeIndex={1}
                    ariaLabel={rc3.stepProgressAria}
                  />

                  <div
                    className="p-3.5 rounded-xl border flex flex-col gap-2.5"
                    style={{
                      backgroundColor: 'var(--alert-warn-bg)',
                      borderColor: 'var(--alert-warn-border)',
                    }}
                  >
                    <p className="text-xs text-ink-primary leading-relaxed m-0 auth-copy-pretty">
                      {anomalyDescription}
                    </p>
                    <dl className="m-0 pt-2 border-t border-dashed border-border-subtle grid grid-cols-1 gap-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-ink-muted">{rc3.anomalyIpLabel}</dt>
                        <dd className="m-0 font-mono font-semibold text-ink-primary">
                          {loginChallenge.ip_address}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-ink-muted">{rc3.anomalyDeviceLabel}</dt>
                        <dd className="m-0 font-semibold text-ink-primary truncate">
                          {loginChallenge.device_label}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <form
                    ref={activeFormRef}
                    method="POST"
                    onSubmit={(e) => void handleVerifyLoginOtp(e)}
                    className="flex flex-col gap-4"
                  >
                    <div className="auth-field">
                      <label htmlFor="login-anomaly-otp" className="ink-field-label">
                        {rc3.verificationCodeLabel}
                      </label>
                      <p
                        id="login-anomaly-otp-hint"
                        className="text-xs text-ink-muted leading-relaxed m-0 mb-2.5 auth-copy-pretty"
                      >
                        {rc3.otpSentSubtitle(loginChallenge.masked_email)}
                      </p>
                      <OtpInput
                        id="login-anomaly-otp"
                        value={loginOtpCode}
                        onChange={setLoginOtpCode}
                        autoFocus
                        disabled={submitting}
                        ariaDescribedBy="login-anomaly-otp-hint"
                        dataError="login-anomaly-otp-err"
                      />
                      <FieldErrorText
                        id="login-anomaly-otp-err"
                        prefixLabel={rc3.errorPrefixLabel}
                        message={rc3.errOtpLength}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                    >
                      {submitting ? copy.submitting : rc3.verifyAndSignInBtn}
                    </button>

                    <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                      <button
                        type="button"
                        disabled={resendingLoginOtp || codeCooldown > 0}
                        onClick={() => void handleResendLoginOtp()}
                        className="font-semibold text-link-ink hover:underline cursor-pointer disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed tabular-nums"
                      >
                        {resendingLoginOtp
                          ? rc3.sendingCodeBtn
                          : codeCooldown > 0
                            ? rc3.resendCodeCountdown(codeCooldown)
                            : rc3.resendOtpBtn}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setLoginChallenge(null);
                          setLoginOtpCode('');
                        }}
                        className="font-semibold text-ink-muted hover:text-ink-primary cursor-pointer"
                      >
                        {rc3.backToSignIn}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* ================= MODE 2: REGISTER (2-STEP FLOW + LIVE USERNAME CHECK + STRENGTH BAR) ================= */}
              {mode === 'register' && (
                <div>
                  {!settingsResolved ? (
                    <div className="py-6 flex flex-col gap-3" aria-busy="true">
                      <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
                      <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
                      <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
                    </div>
                  ) : !siteSettings.allow_registration ? (
                    <div className="flex flex-col gap-4 py-2">
                      <p className="text-sm text-ink-secondary m-0 auth-copy-pretty">
                        {resolveLocalizedError('REGISTRATION_DISABLED', locale)}
                      </p>
                      <Link
                        to={`/${locale}/auth/login${returnQuerySuffix}`}
                        className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary inline-flex items-center justify-center no-underline"
                      >
                        {rc3.backToSignIn}
                      </Link>
                    </div>
                  ) : (
                    <>
                      <StepProgressNav
                        steps={[rc3.authStepAccount, rc3.authStepVerifyOtp]}
                        activeIndex={regStep === 'details' ? 0 : 1}
                        ariaLabel={rc3.stepProgressAria}
                      />

                      {regStep === 'details' ? (
                        <div className="flex flex-col gap-5">
                          <form
                            ref={activeFormRef}
                            method="POST"
                            onSubmit={(e) => void handleRegisterStep1Submit(e)}
                            className="flex flex-col gap-4"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                              <div className="auth-field">
                                <label htmlFor="auth-reg-user" className="ink-field-label">
                                  {copy.usernameLabel}
                                </label>
                                <input
                                  ref={regUsernameRef}
                                  id="auth-reg-user"
                                  name="username"
                                  type="text"
                                  required
                                  autoFocus
                                  minLength={3}
                                  maxLength={32}
                                  autoComplete="username"
                                  autoCorrect="off"
                                  autoCapitalize="none"
                                  spellCheck={false}
                                  enterKeyHint="next"
                                  aria-invalid={
                                    regUsernameStatus === 'taken' ||
                                    regUsernameStatus === 'invalid_format'
                                      ? true
                                      : undefined
                                  }
                                  data-error="auth-reg-user-err"
                                  value={regUsername}
                                  onChange={(e) => setRegUsername(e.target.value)}
                                  placeholder="alice_dev"
                                  className="auth-input"
                                />
                                {regUsernameStatus !== 'idle' ? (
                                  <UsernameStatusHint
                                    id="auth-reg-user-err"
                                    status={regUsernameStatus}
                                    checkingText={rc3.usernameChecking}
                                    availableText={rc3.usernameAvailable}
                                    takenText={rc3.usernameTaken}
                                    invalidFormatText={rc3.usernameInvalidFormat}
                                  />
                                ) : (
                                  <FieldErrorText
                                    id="auth-reg-user-err"
                                    prefixLabel={rc3.errorPrefixLabel}
                                    message={rc3.errUsernameInvalid}
                                  />
                                )}
                              </div>

                              <div className="auth-field">
                                <label htmlFor="auth-reg-name" className="ink-field-label">
                                  {copy.displayNameLabel}
                                </label>
                                <input
                                  id="auth-reg-name"
                                  name="display_name"
                                  type="text"
                                  maxLength={64}
                                  autoComplete="name"
                                  enterKeyHint="next"
                                  value={regDisplayName}
                                  onChange={(e) => setRegDisplayName(e.target.value)}
                                  placeholder="Alice"
                                  className="auth-input"
                                />
                              </div>
                            </div>

                            <div className="auth-field">
                              <label htmlFor="auth-reg-email" className="ink-field-label">
                                {copy.emailLabel}
                              </label>
                              <input
                                id="auth-reg-email"
                                name="email"
                                type="email"
                                required
                                autoComplete="email"
                                spellCheck={false}
                                enterKeyHint="next"
                                data-error="auth-reg-email-err"
                                value={regEmail}
                                onChange={(e) => setRegEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="auth-input"
                              />
                              <FieldErrorText
                                id="auth-reg-email-err"
                                prefixLabel={rc3.errorPrefixLabel}
                                message={rc3.errEmailInvalid}
                              />
                            </div>

                            <div className="auth-field">
                              <label htmlFor="auth-reg-pw" className="ink-field-label">
                                {copy.passwordLabel}
                              </label>
                              <p
                                id="auth-reg-pw-hint"
                                className="text-xs text-ink-muted m-0 mb-1.5"
                              >
                                {rc3.passwordRuleHint}
                              </p>
                              <div className="relative">
                                <input
                                  id="auth-reg-pw"
                                  name="password"
                                  type={showRegPassword ? 'text' : 'password'}
                                  required
                                  minLength={8}
                                  autoComplete="new-password"
                                  enterKeyHint="done"
                                  aria-describedby="auth-reg-pw-hint auth-reg-pw-strength"
                                  data-error="auth-reg-pw-err"
                                  value={regPassword}
                                  onChange={(e) => setRegPassword(e.target.value)}
                                  placeholder={copy.passwordPlaceholder}
                                  className="auth-input pr-11"
                                />
                                <button
                                  type="button"
                                  aria-pressed={showRegPassword}
                                  aria-label={
                                    showRegPassword
                                      ? copy.hidePassword
                                      : copy.showPassword
                                  }
                                  aria-describedby={showPasswordToggleWarningId}
                                  onClick={() => setShowRegPassword((v) => !v)}
                                  className="absolute inset-y-0 right-1 my-auto w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                                >
                                  {showRegPassword ? (
                                    <IconEyeOff className="w-4 h-4" />
                                  ) : (
                                    <IconEye className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                              <PasswordStrengthMeter
                                password={regPassword}
                                locale={locale}
                                id="auth-reg-pw-strength"
                              />
                              <FieldErrorText
                                id="auth-reg-pw-err"
                                prefixLabel={rc3.errorPrefixLabel}
                                message={rc3.errPasswordLength}
                              />
                            </div>

                            {siteSettings.allow_author_registration && (
                              <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
                                <legend className="ink-field-label p-0 mb-1.5">
                                  {rc3.accountRoleLabel}
                                </legend>
                                <div className="grid grid-cols-2 gap-2.5">
                                  {(
                                    [
                                      ['reader', rc3.roleReader, rc3.roleReaderHint],
                                      ['author', rc3.roleAuthor, rc3.roleAuthorHint],
                                    ] as const
                                  ).map(([roleKey, title, hint]) => {
                                    const selected = regRole === roleKey;
                                    return (
                                      <label
                                        key={roleKey}
                                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-action-bg has-[input:focus-visible]:outline-offset-2 ${
                                          selected
                                            ? 'bg-action-subtle border-action-bg text-ink-primary'
                                            : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-border-ink'
                                        }`}
                                      >
                                        <input
                                          type="radio"
                                          name="role"
                                          value={roleKey}
                                          checked={selected}
                                          onChange={() => setRegRole(roleKey)}
                                          className="sr-only"
                                        />
                                        <span
                                          aria-hidden="true"
                                          className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 inline-flex items-center justify-center ${
                                            selected
                                              ? 'border-action-bg bg-action-bg'
                                              : 'border-ink-muted bg-surface-sheet'
                                          }`}
                                        >
                                          {selected && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-action-fg" />
                                          )}
                                        </span>
                                        <span className="min-w-0">
                                          <span className="block text-xs font-semibold text-ink-primary">
                                            {title}
                                          </span>
                                          <span className="block text-xs text-ink-muted mt-0.5 leading-snug">
                                            {hint}
                                          </span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </fieldset>
                            )}

                            <button
                              type="submit"
                              disabled={sendingRegCode}
                              className="mt-1 w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                            >
                              {sendingRegCode ? rc3.sendingCodeBtn : rc3.continueToOtpBtn}
                            </button>
                          </form>

                          <nav
                            aria-label={copy.signInTab}
                            className="pt-4 border-t border-dashed border-border-subtle flex items-center justify-center gap-1.5 text-xs text-ink-muted"
                          >
                            <span>{rc3.hasAccountPrompt}</span>
                            <Link
                              to={`/${locale}/auth/login${returnQuerySuffix}`}
                              className="font-semibold text-link-ink no-underline hover:underline"
                            >
                              {rc3.goToLoginLink}
                            </Link>
                          </nav>
                        </div>
                      ) : (
                        <form
                          ref={activeFormRef}
                          method="POST"
                          onSubmit={(e) => void handleRegisterStep2Submit(e)}
                          className="flex flex-col gap-4"
                        >
                          <div className="px-3.5 py-2.5 rounded-xl bg-surface-raised border border-border-subtle flex items-center justify-between gap-2 text-xs">
                            <span className="font-mono font-semibold text-ink-primary truncate">
                              {regEmail.trim()}
                            </span>
                            <button
                              type="button"
                              onClick={() => setRegStep('details')}
                              className="font-semibold text-link-ink hover:underline shrink-0 cursor-pointer"
                            >
                              {rc3.editDetailsBackBtn}
                            </button>
                          </div>

                          <div className="auth-field">
                            <label htmlFor="register-otp" className="ink-field-label">
                              {rc3.verificationCodeLabel}
                            </label>
                            <p
                              id="register-otp-hint"
                              className="text-xs text-ink-muted leading-relaxed m-0 mb-2.5 auth-copy-pretty"
                            >
                              {rc3.otpSentSubtitle(regEmail.trim())}
                            </p>
                            <OtpInput
                              id="register-otp"
                              value={regOtpCode}
                              onChange={setRegOtpCode}
                              autoFocus
                              disabled={submitting}
                              ariaDescribedBy="register-otp-hint"
                              dataError="register-otp-err"
                            />
                            <FieldErrorText
                              id="register-otp-err"
                              prefixLabel={rc3.errorPrefixLabel}
                              message={rc3.errOtpLength}
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={submitting}
                            className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                          >
                            {submitting
                              ? copy.registerSubmitting
                              : rc3.verifyAndRegisterBtn}
                          </button>

                          <div className="flex items-center justify-center pt-1 text-xs">
                            <button
                              type="button"
                              disabled={sendingRegCode || codeCooldown > 0}
                              onClick={() => void requestRegisterCode(regEmail)}
                              className="font-semibold text-link-ink hover:underline cursor-pointer disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed tabular-nums"
                            >
                              {sendingRegCode
                                ? rc3.sendingCodeBtn
                                : codeCooldown > 0
                                  ? rc3.resendCodeCountdown(codeCooldown)
                                  : rc3.resendOtpBtn}
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ================= MODE 3: FORGOT PASSWORD (STEP 1 OF 3) ================= */}
              {mode === 'forgot' && (
                <div className="flex flex-col gap-5">
                  <StepProgressNav
                    steps={resetFlowSteps}
                    activeIndex={0}
                    ariaLabel={rc3.stepProgressAria}
                  />

                  <form
                    ref={activeFormRef}
                    method="POST"
                    onSubmit={(e) => void handleForgotSubmit(e)}
                    className="flex flex-col gap-4"
                  >
                    <div className="auth-field">
                      <label htmlFor="auth-forgot-email" className="ink-field-label">
                        {copy.emailLabel}
                      </label>
                      <input
                        id="auth-forgot-email"
                        name="email"
                        type="email"
                        required
                        autoFocus
                        autoComplete="email"
                        spellCheck={false}
                        enterKeyHint="done"
                        data-error="auth-forgot-email-err"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="auth-input"
                      />
                      <FieldErrorText
                        id="auth-forgot-email-err"
                        prefixLabel={rc3.errorPrefixLabel}
                        message={rc3.errEmailInvalid}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                    >
                      {submitting ? rc3.sendingResetBtn : rc3.sendResetBtn}
                    </button>
                  </form>

                  <nav
                    aria-label={rc3.backToSignIn}
                    className="text-center pt-4 border-t border-dashed border-border-subtle text-xs"
                  >
                    <Link
                      to={`/${locale}/auth/login${returnQuerySuffix}`}
                      className="font-semibold text-ink-muted hover:text-ink-primary no-underline"
                    >
                      {rc3.backToSignIn}
                    </Link>
                  </nav>
                </div>
              )}

              {/* ================= MODE 4: RESET PASSWORD (STRICT STEP 2 OTP -> STEP 3 NEW PW + CONFIRM) ================= */}
              {mode === 'reset' && (
                <div className="flex flex-col gap-5">
                  <StepProgressNav
                    steps={resetFlowSteps}
                    activeIndex={effectiveResetToken ? 2 : 1}
                    ariaLabel={rc3.stepProgressAria}
                  />

                  {!effectiveResetToken ? (
                    <form
                      ref={activeFormRef}
                      method="POST"
                      onSubmit={(e) => void handleVerifyResetOtpSubmit(e)}
                      className="flex flex-col gap-4"
                    >
                      {resetEmailFromUrl ? (
                        <div className="px-3.5 py-2.5 rounded-xl bg-surface-raised border border-border-subtle flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-semibold text-ink-primary truncate">
                            {resetEmail.trim()}
                          </span>
                          <Link
                            to={`/${locale}/auth/forgot-password?email=${encodeURIComponent(resetEmail.trim())}${returnQuerySuffix ? `&${returnQuerySuffix.slice(1)}` : ''}`}
                            className="font-semibold text-link-ink no-underline hover:underline shrink-0"
                          >
                            {rc3.changeEmailBtn}
                          </Link>
                        </div>
                      ) : (
                        <div className="auth-field">
                          <label htmlFor="auth-reset-email" className="ink-field-label">
                            {copy.emailLabel}
                          </label>
                          <input
                            id="auth-reset-email"
                            name="email"
                            type="email"
                            required
                            autoFocus
                            autoComplete="email"
                            spellCheck={false}
                            enterKeyHint="next"
                            data-error="auth-reset-email-err"
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="auth-input"
                          />
                          <FieldErrorText
                            id="auth-reset-email-err"
                            prefixLabel={rc3.errorPrefixLabel}
                            message={rc3.errEmailInvalid}
                          />
                        </div>
                      )}

                      <div className="auth-field">
                        <label htmlFor="reset-otp" className="ink-field-label">
                          {rc3.verificationCodeLabel}
                        </label>
                        <p
                          id="reset-otp-hint"
                          className="text-xs text-ink-muted leading-relaxed m-0 mb-2.5 auth-copy-pretty"
                        >
                          {rc3.resetStep2Desc(resetEmail.trim())}
                        </p>
                        <OtpInput
                          id="reset-otp"
                          value={resetOtpCode}
                          onChange={setResetOtpCode}
                          autoFocus={Boolean(resetEmailFromUrl)}
                          disabled={verifyingResetOtp}
                          ariaDescribedBy="reset-otp-hint"
                          dataError="reset-otp-err"
                        />
                        <FieldErrorText
                          id="reset-otp-err"
                          prefixLabel={rc3.errorPrefixLabel}
                          message={rc3.errOtpLength}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={verifyingResetOtp}
                        className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                      >
                        {verifyingResetOtp ? copy.submitting : rc3.verifyOtpContinueBtn}
                      </button>

                      <div className="flex items-center justify-center pt-1 text-xs">
                        <button
                          type="button"
                          disabled={
                            resendingReset || codeCooldown > 0 || !resetEmail.trim()
                          }
                          onClick={() => void handleResendResetCode()}
                          className="font-semibold text-link-ink hover:underline cursor-pointer disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed tabular-nums"
                        >
                          {resendingReset
                            ? rc3.sendingCodeBtn
                            : codeCooldown > 0
                              ? rc3.resendCodeCountdown(codeCooldown)
                              : rc3.resendOtpBtn}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form
                      ref={activeFormRef}
                      method="POST"
                      onSubmit={(e) => void handleResetPasswordStep3Submit(e)}
                      className="flex flex-col gap-4"
                    >
                      <div
                        className="px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2"
                        style={{
                          backgroundColor:
                            'color-mix(in srgb, var(--accent-success-ink) 10%, transparent)',
                          borderColor:
                            'color-mix(in srgb, var(--accent-success-ink) 35%, transparent)',
                          color: 'var(--accent-success-ink)',
                        }}
                      >
                        <IconCheck className="w-4 h-4 shrink-0" />
                        <span>{rc3.resetStep3VerifiedBadge}</span>
                      </div>

                      <div className="auth-field">
                        <label htmlFor="auth-reset-pw" className="ink-field-label">
                          {rc3.newPasswordLabel}
                        </label>
                        <p
                          id="auth-reset-pw-hint"
                          className="text-xs text-ink-muted m-0 mb-1.5"
                        >
                          {rc3.passwordRuleHint}
                        </p>
                        <div className="relative">
                          <input
                            id="auth-reset-pw"
                            name="new_password"
                            type={showNewPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            autoFocus
                            autoComplete="new-password"
                            enterKeyHint="next"
                            aria-describedby="auth-reset-pw-hint auth-reset-pw-strength"
                            data-error="auth-reset-pw-err"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder={copy.passwordPlaceholder}
                            className="auth-input pr-11"
                          />
                          <button
                            type="button"
                            aria-pressed={showNewPassword}
                            aria-label={
                              showNewPassword ? copy.hidePassword : copy.showPassword
                            }
                            aria-describedby={showPasswordToggleWarningId}
                            onClick={() => setShowNewPassword((v) => !v)}
                            className="absolute inset-y-0 right-1 my-auto w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                          >
                            {showNewPassword ? (
                              <IconEyeOff className="w-4 h-4" />
                            ) : (
                              <IconEye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <PasswordStrengthMeter
                          password={newPassword}
                          locale={locale}
                          id="auth-reset-pw-strength"
                        />
                        <FieldErrorText
                          id="auth-reset-pw-err"
                          prefixLabel={rc3.errorPrefixLabel}
                          message={rc3.errPasswordLength}
                        />
                      </div>

                      <div className="auth-field">
                        <label
                          htmlFor="auth-reset-confirm-pw"
                          className="ink-field-label"
                        >
                          {rc3.confirmPasswordLabel}
                        </label>
                        <div className="relative">
                          <input
                            ref={resetConfirmPwRef}
                            id="auth-reset-confirm-pw"
                            name="confirm_new_password"
                            type={showConfirmNewPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            autoComplete="new-password"
                            enterKeyHint="done"
                            data-error="auth-reset-confirm-pw-err"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            placeholder={copy.passwordPlaceholder}
                            className="auth-input pr-11"
                          />
                          <button
                            type="button"
                            aria-pressed={showConfirmNewPassword}
                            aria-label={
                              showConfirmNewPassword
                                ? copy.hidePassword
                                : copy.showPassword
                            }
                            aria-describedby={showPasswordToggleWarningId}
                            onClick={() => setShowConfirmNewPassword((v) => !v)}
                            className="absolute inset-y-0 right-1 my-auto w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                          >
                            {showConfirmNewPassword ? (
                              <IconEyeOff className="w-4 h-4" />
                            ) : (
                              <IconEye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <FieldErrorText
                          id="auth-reset-confirm-pw-err"
                          prefixLabel={rc3.errorPrefixLabel}
                          message={
                            confirmNewPassword && confirmNewPassword !== newPassword
                              ? rc3.passwordMismatchMsg
                              : rc3.errPasswordLength
                          }
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                      >
                        {submitting ? copy.submitting : rc3.resetSubmitBtn}
                      </button>
                    </form>
                  )}

                  <nav
                    aria-label={rc3.backToSignIn}
                    className="text-center pt-4 border-t border-dashed border-border-subtle"
                  >
                    <Link
                      to={`/${locale}/auth/login${returnQuerySuffix}`}
                      className="text-xs font-semibold text-ink-muted hover:text-ink-primary no-underline"
                    >
                      {rc3.backToSignIn}
                    </Link>
                  </nav>
                </div>
              )}

              {/* ================= MODE 5: OAUTH ONBOARDING ================= */}
              {mode === 'onboarding' && (
                <div className="flex flex-col gap-4">
                  {!onboardingInfo ? (
                    <div className="py-6 flex flex-col gap-3" aria-busy="true">
                      <div className="h-14 rounded-xl bg-surface-raised animate-pulse" />
                      <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
                      <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
                    </div>
                  ) : (
                    <>
                      <div
                        role="tablist"
                        aria-label={rc3.onboardingTitle(
                          onboardingInfo.provider_name || oauthLabel,
                        )}
                        className="mwg-tablist"
                        {...({ focusgroup: 'tablist nomemory' } as Record<string, unknown>)}
                      >
                        {onboardingInfo.allow_registration && (
                          <button
                            id="onb-tab-register"
                            type="button"
                            role="tab"
                            aria-selected={onboardingTab === 'register'}
                            onClick={() => setOnboardingTab('register')}
                            className="mwg-tab mwg-tab-fill"
                            {...(onboardingTab === 'register'
                              ? ({ focusgroupstart: '' } as Record<string, unknown>)
                              : {})}
                          >
                            {rc3.onboardingRegisterTab}
                          </button>
                        )}
                        <button
                          id="onb-tab-bind"
                          type="button"
                          role="tab"
                          aria-selected={onboardingTab === 'bind'}
                          onClick={() => setOnboardingTab('bind')}
                          className="mwg-tab mwg-tab-fill"
                          {...(onboardingTab === 'bind'
                            ? ({ focusgroupstart: '' } as Record<string, unknown>)
                            : {})}
                        >
                          {rc3.onboardingBindTab}
                        </button>
                      </div>

                      {onboardingTab === 'register' &&
                      onboardingInfo.allow_registration ? (
                        <div role="tabpanel" aria-labelledby="onb-tab-register">
                          <form
                            ref={activeFormRef}
                            method="POST"
                            onSubmit={(e) => void handleOnboardingRegister(e)}
                            className="flex flex-col gap-4"
                          >
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-raised border border-border-subtle">
                              <UserAvatar
                                name={onbDisplayName || onbUsername || 'U'}
                                avatarUrl={onbAvatarPreview}
                                sizeClass="w-11 h-11"
                                textClass="text-sm"
                              />
                              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                <div className="text-xs font-semibold text-ink-secondary">
                                  {rc3.onboardingAvatarLabel}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {(
                                    [
                                      ...(onboardingInfo.oauth_avatar_url
                                        ? ([['oauth', profCopy.avatarOAuth]] as const)
                                        : []),
                                      ...(onboardingInfo.gravatar_preview_url
                                        ? ([
                                            ['gravatar', profCopy.avatarGravatar],
                                          ] as const)
                                        : []),
                                      ['default', profCopy.avatarDefault] as const,
                                      ['upload', profCopy.avatarUpload] as const,
                                    ] as readonly (readonly [AvatarSource, string])[]
                                  ).map(([srcKey, label]) => (
                                    <button
                                      key={srcKey}
                                      type="button"
                                      aria-pressed={onbAvatarSource === srcKey}
                                      onClick={() => setOnbAvatarSource(srcKey)}
                                      className={`min-h-7 px-2 py-0.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                                        onbAvatarSource === srcKey
                                          ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                                          : 'bg-surface-sheet border-border-subtle text-ink-muted hover:text-ink-primary'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                                {onbAvatarSource === 'upload' && (
                                  <div>
                                    <input
                                      ref={avatarFileRef}
                                      type="file"
                                      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                                      onChange={(e) =>
                                        void handleOnboardingAvatarUpload(e)
                                      }
                                      className="sr-only"
                                    />
                                    <button
                                      type="button"
                                      disabled={uploadingAvatar}
                                      onClick={() => avatarFileRef.current?.click()}
                                      className="min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <IconUpload className="w-3 h-3 text-ink-muted" />
                                      <span>
                                        {uploadingAvatar
                                          ? profCopy.uploadingAvatarBtn
                                          : profCopy.uploadAvatarBtn}
                                      </span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                              <div className="auth-field">
                                <label htmlFor="onb-user" className="ink-field-label">
                                  {copy.usernameLabel}
                                </label>
                                <input
                                  ref={onbUsernameRef}
                                  id="onb-user"
                                  name="username"
                                  type="text"
                                  required
                                  minLength={3}
                                  maxLength={32}
                                  autoComplete="username"
                                  autoCorrect="off"
                                  autoCapitalize="none"
                                  spellCheck={false}
                                  enterKeyHint="next"
                                  aria-invalid={
                                    onbUsernameStatus === 'taken' ||
                                    onbUsernameStatus === 'invalid_format'
                                      ? true
                                      : undefined
                                  }
                                  data-error="onb-user-err"
                                  value={onbUsername}
                                  onChange={(e) => setOnbUsername(e.target.value)}
                                  className="auth-input"
                                />
                                {onbUsernameStatus !== 'idle' ? (
                                  <UsernameStatusHint
                                    id="onb-user-err"
                                    status={onbUsernameStatus}
                                    checkingText={rc3.usernameChecking}
                                    availableText={rc3.usernameAvailable}
                                    takenText={rc3.usernameTaken}
                                    invalidFormatText={rc3.usernameInvalidFormat}
                                  />
                                ) : (
                                  <FieldErrorText
                                    id="onb-user-err"
                                    prefixLabel={rc3.errorPrefixLabel}
                                    message={rc3.errUsernameInvalid}
                                  />
                                )}
                              </div>

                              <div className="auth-field">
                                <label htmlFor="onb-name" className="ink-field-label">
                                  {copy.displayNameLabel}
                                </label>
                                <input
                                  id="onb-name"
                                  name="display_name"
                                  type="text"
                                  maxLength={64}
                                  autoComplete="name"
                                  enterKeyHint="next"
                                  value={onbDisplayName}
                                  onChange={(e) => setOnbDisplayName(e.target.value)}
                                  className="auth-input"
                                />
                              </div>
                            </div>

                            <div className="auth-field">
                              <label htmlFor="onb-email" className="ink-field-label">
                                {copy.emailLabel}
                              </label>
                              <input
                                id="onb-email"
                                name="email"
                                type="email"
                                required
                                autoComplete="email"
                                spellCheck={false}
                                enterKeyHint="done"
                                data-error="onb-email-err"
                                value={onbEmail}
                                onChange={(e) => setOnbEmail(e.target.value)}
                                className="auth-input"
                              />
                              <FieldErrorText
                                id="onb-email-err"
                                prefixLabel={rc3.errorPrefixLabel}
                                message={rc3.errEmailInvalid}
                              />
                            </div>

                            {onboardingInfo.allow_author_registration && (
                              <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
                                <legend className="ink-field-label p-0 mb-1.5">
                                  {rc3.accountRoleLabel}
                                </legend>
                                <div className="grid grid-cols-2 gap-2.5">
                                  {(
                                    [
                                      ['reader', rc3.roleReader, rc3.roleReaderHint],
                                      ['author', rc3.roleAuthor, rc3.roleAuthorHint],
                                    ] as const
                                  ).map(([roleKey, title, hint]) => {
                                    const selected = onbRole === roleKey;
                                    return (
                                      <label
                                        key={roleKey}
                                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-action-bg has-[input:focus-visible]:outline-offset-2 ${
                                          selected
                                            ? 'bg-action-subtle border-action-bg text-ink-primary'
                                            : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-border-ink'
                                        }`}
                                      >
                                        <input
                                          type="radio"
                                          name="onb_role"
                                          value={roleKey}
                                          checked={selected}
                                          onChange={() => setOnbRole(roleKey)}
                                          className="sr-only"
                                        />
                                        <span
                                          aria-hidden="true"
                                          className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 inline-flex items-center justify-center ${
                                            selected
                                              ? 'border-action-bg bg-action-bg'
                                              : 'border-ink-muted bg-surface-sheet'
                                          }`}
                                        >
                                          {selected && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-action-fg" />
                                          )}
                                        </span>
                                        <span className="min-w-0">
                                          <span className="block text-xs font-semibold text-ink-primary">
                                            {title}
                                          </span>
                                          <span className="block text-xs text-ink-muted mt-0.5 leading-snug">
                                            {hint}
                                          </span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </fieldset>
                            )}

                            <button
                              type="submit"
                              disabled={submitting}
                              className="mt-1 w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                            >
                              {submitting
                                ? copy.registerSubmitting
                                : rc3.onboardingCreateBtn}
                            </button>
                          </form>
                        </div>
                      ) : (
                        <div role="tabpanel" aria-labelledby="onb-tab-bind">
                          <form
                            ref={activeFormRef}
                            method="POST"
                            onSubmit={(e) => void handleOnboardingBind(e)}
                            className="flex flex-col gap-4"
                          >
                            <p className="text-xs text-ink-muted leading-relaxed m-0 auth-copy-pretty">
                              {rc3.onboardingBindDesc}
                            </p>
                            <div className="auth-field">
                              <label htmlFor="onb-bind-id" className="ink-field-label">
                                {copy.identifierLabel}
                              </label>
                              <input
                                id="onb-bind-id"
                                name="username"
                                type="text"
                                required
                                autoComplete="username"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                enterKeyHint="next"
                                data-error="onb-bind-id-err"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                className="auth-input"
                              />
                              <FieldErrorText
                                id="onb-bind-id-err"
                                prefixLabel={rc3.errorPrefixLabel}
                                message={rc3.errIdentifierRequired}
                              />
                            </div>
                            <div className="auth-field">
                              <label htmlFor="onb-bind-pw" className="ink-field-label">
                                {copy.passwordLabel}
                              </label>
                              <div className="relative">
                                <input
                                  id="onb-bind-pw"
                                  name="password"
                                  type={showPassword ? 'text' : 'password'}
                                  required
                                  autoComplete="current-password"
                                  enterKeyHint="done"
                                  data-error="onb-bind-pw-err"
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  className="auth-input pr-11"
                                />
                                <button
                                  type="button"
                                  aria-pressed={showPassword}
                                  aria-label={
                                    showPassword
                                      ? copy.hidePassword
                                      : copy.showPassword
                                  }
                                  aria-describedby={showPasswordToggleWarningId}
                                  onClick={() => setShowPassword((v) => !v)}
                                  className="absolute inset-y-0 right-1 my-auto w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                                >
                                  {showPassword ? (
                                    <IconEyeOff className="w-4 h-4" />
                                  ) : (
                                    <IconEye className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                              <FieldErrorText
                                id="onb-bind-pw-err"
                                prefixLabel={rc3.errorPrefixLabel}
                                message={rc3.errPasswordLength}
                              />
                            </div>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                            >
                              {submitting ? copy.submitting : rc3.onboardingBindBtn}
                            </button>
                          </form>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
