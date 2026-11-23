/*
 * Decoupled Login & Anomaly OTP Verification Flow (`AuthFlowPage` Mode: `'login'`).
 * Uses shared `<PasswordInput>`, `<FieldErrorText>`, `<OtpInput>`, `<OtpResendButton>`, and `useOtpCooldown`.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/apiError';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { toSafeHttpUrl } from '../../lib/urlSafety';
import {
  consumePendingOAuthOtpChallenge,
  detectPasskeyCapabilities,
  parsePasskeyRequestOptions,
  serializePasskeyCredential,
  signalUnknownPasskey,
  type PasskeyClientCapabilities,
} from '../../lib/passkeys';
import {
  getEffectiveOAuthProviders,
  type LocaleCode,
  type LoginOtpChallengeResponse,
  type SiteSettingsDto,
  type UserProfileDto,
} from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { FieldErrorText } from '../ui/FormControls';
import { IconKey } from '../ui/Icons';
import { PasswordInput } from '../ui/PasswordInput';
import { useToast } from '../ui/ToastProvider';
import { saveOtpCooldown, useOtpCooldown } from './otpCooldown';
import { OtpInput } from './OtpInput';
import { OtpResendButton } from './OtpResendButton';

export interface LoginFlowPanelProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
  settingsResolved: boolean;
  blogSsoEntryUrl: string;
  user: UserProfileDto | null;
  returnTo: string;
  returnQuerySuffix: string;
  onChallengeChange: (active: boolean) => void;
  onFocusHeading: () => void;
  onSuccess: (user: UserProfileDto, welcomeMessage: string) => void;
}

export function LoginFlowPanel({
  locale,
  siteSettings,
  settingsResolved,
  blogSsoEntryUrl,
  user,
  returnTo,
  returnQuerySuffix,
  onChallengeChange,
  onFocusHeading,
  onSuccess,
}: LoginFlowPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const copy = UI_COPY[locale].auth;
  const extAuth = EXT_COPY[locale].auth;

  const formRef = useRef<HTMLFormElement | null>(null);
  const conditionalAbortRef = useRef<AbortController | null>(null);
  const submittingLoginRef = useRef(false);
  const resendingLoginOtpRef = useRef(false);
  const onChallengeChangeRef = useRef(onChallengeChange);
  onChallengeChangeRef.current = onChallengeChange;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signingInPasskey, setSigningInPasskey] = useState(false);

  const [loginChallenge, setLoginChallenge] =
    useState<LoginOtpChallengeResponse | null>(null);
  const [loginOtpCode, setLoginOtpCode] = useState('');
  const [resendingLoginOtp, setResendingLoginOtp] = useState(false);

  const [passkeyCaps, setPasskeyCaps] = useState<PasskeyClientCapabilities>({
    supported: false,
    conditionalGet: false,
    platformAuthenticator: false,
  });

  const { cooldown, startCooldown, applyRateLimitError } = useOtpCooldown(
    'login_anomaly',
    loginChallenge?.challenge_id ?? '',
  );

  useAccessibleFormValidation(formRef, [Boolean(loginChallenge), settingsResolved]);

  useEffect(() => {
    onChallengeChangeRef.current(Boolean(loginChallenge));
  }, [loginChallenge]);

  // Hydrate pending OAuth Anomaly OTP challenge handed off from App.tsx
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get('otp_challenge') !== '1') return;
    const pending = consumePendingOAuthOtpChallenge();
    if (pending) {
      const cd = pending.cooldown_seconds || 60;
      saveOtpCooldown('login_anomaly', pending.challenge_id, cd);
      setLoginChallenge(pending);
      setLoginOtpCode('');
      startCooldown(cd, pending.challenge_id);
    }
    sp.delete('otp_challenge');
    const qs = sp.toString();
    navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, { replace: true });
  }, [location.pathname, location.search, navigate, startCooldown]);

  useEffect(() => {
    let active = true;
    void detectPasskeyCapabilities().then((caps) => {
      if (active) setPasskeyCaps(caps);
    });
    return () => {
      active = false;
    };
  }, []);

  const applyAuthenticatedOrChallenge = (
    result: Awaited<ReturnType<typeof api.loginWithPassword>>,
  ) => {
    if (result.requires_otp) {
      const cd = result.cooldown_seconds || 60;
      setLoginChallenge(result);
      setLoginOtpCode('');
      startCooldown(cd, result.challenge_id);
      toast.warning(extAuth.anomalyTitle);
      window.requestAnimationFrame(onFocusHeading);
      return;
    }
    onSuccess(result.user, extAuth.signedInWelcomeMsg(result.user.display_name));
  };

  // WebAuthn Conditional UI autofill
  useEffect(() => {
    if (
      Boolean(loginChallenge) ||
      !settingsResolved ||
      !siteSettings.enable_passkeys ||
      !passkeyCaps.conditionalGet ||
      Boolean(user)
    ) {
      return;
    }
    const controller = new AbortController();
    conditionalAbortRef.current = controller;

    void (async () => {
      try {
        const optRes = await api.getPasskeyLoginOptions();
        if (controller.signal.aborted) return;
        const serverRpId =
          typeof optRes.options.rpId === 'string' ? optRes.options.rpId : '';
        const publicKey = parsePasskeyRequestOptions(optRes.options);
        const cred = await navigator.credentials.get({
          publicKey,
          mediation: 'conditional' as CredentialMediationRequirement,
          signal: controller.signal,
        });
        if (!cred || controller.signal.aborted) return;
        const encoded = serializePasskeyCredential(cred as PublicKeyCredential);
        try {
          setSubmitting(true);
          const result = await api.verifyPasskeyLogin(
            optRes.ceremony_id,
            encoded,
            locale,
          );
          applyAuthenticatedOrChallenge(result);
        } catch (verifyErr) {
          if (
            verifyErr instanceof ApiError &&
            (verifyErr.status === 404 || verifyErr.code === 'PASSKEY_NOT_FOUND') &&
            serverRpId &&
            typeof encoded.id === 'string'
          ) {
            void signalUnknownPasskey(serverRpId, encoded.id);
          }
          toast.error(verifyErr, copy.loginFailed);
        } finally {
          setSubmitting(false);
        }
      } catch {
        // Silent exit on passive Conditional UI abort
      }
    })();

    return () => {
      controller.abort();
      if (conditionalAbortRef.current === controller) {
        conditionalAbortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    Boolean(loginChallenge),
    settingsResolved,
    siteSettings.enable_passkeys,
    passkeyCaps.conditionalGet,
    Boolean(user),
    locale,
  ]);

  const handlePasskeySignIn = async () => {
    if (signingInPasskey || submitting) return;
    conditionalAbortRef.current?.abort();
    conditionalAbortRef.current = null;
    setSigningInPasskey(true);
    try {
      const optRes = await api.getPasskeyLoginOptions();
      const serverRpId =
        typeof optRes.options.rpId === 'string' ? optRes.options.rpId : '';
      const publicKey = parsePasskeyRequestOptions(optRes.options);
      let cred: Credential | null = null;
      try {
        cred = await navigator.credentials.get({ publicKey });
      } catch (domErr) {
        const name = domErr instanceof DOMException ? domErr.name : '';
        if (name === 'SecurityError') {
          toast.error(extAuth.passkeySecurityErrorMsg);
        } else if (name !== 'NotAllowedError' && name !== 'AbortError') {
          toast.error(domErr, copy.loginFailed);
        }
        return;
      }
      if (!cred) return;
      const encoded = serializePasskeyCredential(cred as PublicKeyCredential);
      try {
        const result = await api.verifyPasskeyLogin(
          optRes.ceremony_id,
          encoded,
          locale,
        );
        applyAuthenticatedOrChallenge(result);
      } catch (verifyErr) {
        if (
          verifyErr instanceof ApiError &&
          (verifyErr.status === 404 || verifyErr.code === 'PASSKEY_NOT_FOUND') &&
          serverRpId &&
          typeof encoded.id === 'string'
        ) {
          void signalUnknownPasskey(serverRpId, encoded.id);
        }
        toast.error(verifyErr, copy.loginFailed);
      }
    } catch (err) {
      toast.error(err, copy.loginFailed);
    } finally {
      setSigningInPasskey(false);
    }
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password || submittingLoginRef.current) return;
    conditionalAbortRef.current?.abort();
    conditionalAbortRef.current = null;
    submittingLoginRef.current = true;
    setSubmitting(true);
    try {
      const result = await api.loginWithPassword(identifier.trim(), password, locale);
      applyAuthenticatedOrChallenge(result);
    } catch (err) {
      toast.error(err, copy.loginFailed);
    } finally {
      submittingLoginRef.current = false;
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
      onSuccess(session.user, extAuth.signedInWelcomeMsg(session.user.display_name));
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendLoginOtp = async () => {
    if (!loginChallenge || resendingLoginOtpRef.current || cooldown > 0) return;
    resendingLoginOtpRef.current = true;
    setResendingLoginOtp(true);
    try {
      const res = await api.resendLoginOtp(loginChallenge.challenge_id, locale);
      startCooldown(res.cooldown_seconds || 60, loginChallenge.challenge_id);
      toast.success(extAuth.codeSentToast(loginChallenge.masked_email));
    } catch (err) {
      applyRateLimitError(err, loginChallenge.challenge_id);
      toast.error(err);
    } finally {
      resendingLoginOtpRef.current = false;
      setResendingLoginOtp(false);
    }
  };

  const enabledOAuthProviders = getEffectiveOAuthProviders(siteSettings).filter(
    (p) => p.enabled && p.client_id.trim().length > 0,
  );
  const oauthEnabled = enabledOAuthProviders.length > 0;
  const ssoEnabled =
    siteSettings.sso_enabled && Boolean(siteSettings.blog_origin_url.trim());

  if (loginChallenge) {
    const anomalyDescription =
      loginChallenge.anomaly_reason === 'new_ip'
        ? extAuth.anomalyDescNewIp
        : loginChallenge.anomaly_reason === 'new_device'
          ? extAuth.anomalyDescNewDevice
          : extAuth.anomalyDescBoth;

    return (
      <div key="login-challenge-panel" className="flex flex-col gap-4">
        <div
          className="p-3.5 rounded-xl border flex flex-col gap-2.5"
          style={{
            backgroundColor: 'var(--alert-warn-bg)',
            borderColor: 'var(--alert-warn-border)',
          }}
        >
          <p
            className="text-xs leading-relaxed auth-copy-pretty"
            style={{ color: 'var(--alert-warn-body)' }}
          >
            {anomalyDescription}
          </p>
          <dl className="pt-2 border-t border-dashed border-border-subtle grid grid-cols-1 gap-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt style={{ color: 'var(--alert-warn-body)' }}>
                {extAuth.anomalyIpLabel}
              </dt>
              <dd
                className="font-mono font-semibold"
                style={{ color: 'var(--alert-warn-title)' }}
              >
                {loginChallenge.ip_address}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt style={{ color: 'var(--alert-warn-body)' }}>
                {extAuth.anomalyDeviceLabel}
              </dt>
              <dd
                className="font-semibold truncate"
                style={{ color: 'var(--alert-warn-title)' }}
              >
                {loginChallenge.device_label}
              </dd>
            </div>
          </dl>
        </div>

        <form
          key="login-otp-form"
          ref={formRef}
          method="POST"
          onSubmit={(e) => void handleVerifyLoginOtp(e)}
          className="flex flex-col gap-4"
        >
          <div className="auth-field">
            <label htmlFor="login-anomaly-otp" className="ink-field-label">
              {extAuth.verificationCodeLabel}
            </label>
            <p
              id="login-anomaly-otp-hint"
              className="text-xs text-ink-muted leading-relaxed mb-2.5 auth-copy-pretty"
            >
              {extAuth.otpSentSubtitle(loginChallenge.masked_email)}
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
              prefixLabel={extAuth.errorPrefixLabel}
              message={extAuth.errOtpLength}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
          >
            {submitting ? copy.submitting : extAuth.verifyAndSignInBtn}
          </button>

          <div className="flex items-center justify-between gap-2 pt-1 text-xs">
            <OtpResendButton
              locale={locale}
              cooldown={cooldown}
              sending={resendingLoginOtp}
              onResend={() => void handleResendLoginOtp()}
            />

            <button
              type="button"
              onClick={() => {
                setLoginChallenge(null);
                setLoginOtpCode('');
              }}
              className="font-semibold text-ink-muted hover:text-ink-primary cursor-pointer"
            >
              {extAuth.backToSignIn}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div key="login-credentials-panel" className="flex flex-col gap-5">
      <form
        key="login-password-form"
        ref={formRef}
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
            aria-describedby="auth-page-heading"
            autoComplete={
              siteSettings.enable_passkeys && passkeyCaps.conditionalGet
                ? 'username webauthn'
                : 'username'
            }
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
            prefixLabel={extAuth.errorPrefixLabel}
            message={extAuth.errIdentifierRequired}
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
              className="inline-flex items-center min-h-7 -my-1 px-1 text-xs font-semibold text-link-ink no-underline hover:underline"
            >
              {extAuth.forgotPasswordLink}
            </Link>
          </div>
          <PasswordInput
            id="auth-login-pw"
            name="password"
            locale={locale}
            variant="auth"
            required
            autoComplete="current-password"
            enterKeyHint="done"
            dataError="auth-login-pw-err"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={copy.passwordPlaceholder}
          />
          <FieldErrorText
            id="auth-login-pw-err"
            prefixLabel={extAuth.errorPrefixLabel}
            message={extAuth.errPasswordLength}
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

      {((siteSettings.enable_passkeys && passkeyCaps.supported) ||
        oauthEnabled ||
        (ssoEnabled && blogSsoEntryUrl)) && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="h-px flex-1 bg-border-subtle" />
            <span>{copy.orDivider}</span>
            <span className="h-px flex-1 bg-border-subtle" />
          </div>

          {siteSettings.enable_passkeys && passkeyCaps.supported && (
            <button
              type="button"
              disabled={signingInPasskey || submitting}
              onClick={() => void handlePasskeySignIn()}
              className="w-full min-h-10 px-4 py-2 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55 transition-colors"
            >
              <IconKey className="w-3.5 h-3.5 text-ink-secondary" />
              <span>
                {signingInPasskey ? extAuth.passkeySigningInBtn : extAuth.passkeySignInBtn}
              </span>
            </button>
          )}

          {oauthEnabled &&
            enabledOAuthProviders.map((provider) => {
              const label = provider.name.trim() || provider.id || 'OAuth';
              const href = `/api/v1/auth/oauth/authorize?provider=${encodeURIComponent(provider.id)}&return_to=${encodeURIComponent(returnTo)}`;
              return (
                <a
                  key={provider.id}
                  href={href}
                  className="w-full min-h-10 px-4 py-2 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center justify-center no-underline transition-colors"
                >
                  {copy.oauthSignInBtn(label)}
                </a>
              );
            })}

          {ssoEnabled && toSafeHttpUrl(blogSsoEntryUrl) && (
            <a
              href={toSafeHttpUrl(blogSsoEntryUrl)}
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
          <span>{extAuth.noAccountPrompt}</span>
          <Link
            to={`/${locale}/auth/register${returnQuerySuffix}`}
            className="inline-flex items-center min-h-7 px-1 font-semibold text-link-ink no-underline hover:underline"
          >
            {extAuth.goToRegisterLink}
          </Link>
        </nav>
      )}
    </div>
  );
}
