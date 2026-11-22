/*
 * Decoupled 2-Step Registration Flow (`AuthFlowPage` Mode: `'register'`).
 * Reuses `<UsernameField>`, `<PasswordInput>`, `<RadioCardGroup>`, `<StepProgressNav>`, `<OtpInput>`, and `<OtpResendButton>`.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { resolveLocalizedError } from '../../lib/apiError';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '../../lib/email';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type { LocaleCode, SiteSettingsDto, UserProfileDto } from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { FieldErrorText, RadioCardGroup } from '../ui/FormControls';
import { PasswordInput } from '../ui/PasswordInput';
import { StepProgressNav } from '../ui/StepProgressNav';
import { useToast } from '../ui/ToastProvider';
import { readOtpCooldown, useOtpCooldown } from './otpCooldown';
import { OtpInput } from './OtpInput';
import { OtpResendButton } from './OtpResendButton';
import { type UsernameCheckState, UsernameField } from './UsernameField';

export interface RegisterFlowPanelProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
  settingsResolved: boolean;
  returnQuerySuffix: string;
  onStepChange: (step: 'details' | 'otp') => void;
  onFocusHeading: () => void;
  onSuccess: (user: UserProfileDto, welcomeMessage: string) => void;
}

export function RegisterFlowPanel({
  locale,
  siteSettings,
  settingsResolved,
  returnQuerySuffix,
  onStepChange,
  onFocusHeading,
  onSuccess,
}: RegisterFlowPanelProps) {
  const toast = useToast();
  const copy = UI_COPY[locale].auth;
  const extAuth = EXT_COPY[locale].auth;

  const formRef = useRef<HTMLFormElement | null>(null);
  const usernameRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<'details' | 'otp'>('details');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameCheckState>('idle');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'reader' | 'author'>('reader');
  const [otpCode, setOtpCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { cooldown, startCooldown, applyRateLimitError } = useOtpCooldown(
    'register',
    email,
  );

  useAccessibleFormValidation(formRef, [step, settingsResolved]);

  useEffect(() => {
    onStepChange(step);
  }, [step, onStepChange]);

  const requestRegisterCode = async (targetEmail: string): Promise<boolean> => {
    const cleanEmail = normalizeEmail(targetEmail);
    if (!cleanEmail) {
      toast.error('INVALID_EMAIL');
      return false;
    }
    if (sendingCode) return false;
    setSendingCode(true);
    try {
      const res = await api.sendRegisterVerificationCode(cleanEmail, locale);
      startCooldown(res.cooldown_seconds || 60, cleanEmail);
      toast.success(extAuth.codeSentToast(cleanEmail));
      return true;
    } catch (err) {
      applyRateLimitError(err, cleanEmail);
      toast.error(err);
      return false;
    } finally {
      setSendingCode(false);
    }
  };

  const handleStep1Submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sendingCode || submitting) return;
    if (usernameStatus === 'taken') {
      toast.error('USERNAME_TAKEN');
      usernameRef.current?.focus();
      return;
    }
    if (usernameStatus === 'invalid_format') {
      toast.error('INVALID_USERNAME');
      usernameRef.current?.focus();
      return;
    }
    const existingCooldown = readOtpCooldown('register', email);
    if (existingCooldown > 0) {
      startCooldown(existingCooldown, email);
      setOtpCode('');
      setStep('otp');
      window.requestAnimationFrame(onFocusHeading);
      return;
    }
    const ok = await requestRegisterCode(email);
    if (ok) {
      setOtpCode('');
      setStep('otp');
      window.requestAnimationFrame(onFocusHeading);
    }
  };

  const handleStep2Submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const code = otpCode.trim();
    if (code.length < 6) {
      toast.error('VERIFICATION_CODE_REQUIRED');
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.registerAccount({
        username: username.trim(),
        email: normalizeEmail(email) ?? email.trim(),
        password,
        verification_code: code,
        display_name: displayName.trim() || username.trim(),
        role: siteSettings.allow_author_registration ? role : 'reader',
      });
      onSuccess(session.user, extAuth.registeredWelcomeMsg(session.user.display_name));
    } catch (err) {
      toast.error(err, copy.registerFailed);
    } finally {
      setSubmitting(false);
    }
  };

  if (!settingsResolved) {
    return (
      <div className="py-6 flex flex-col gap-3" aria-busy="true">
        <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
        <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
        <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
      </div>
    );
  }

  if (!siteSettings.allow_registration) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <p className="text-sm text-ink-secondary auth-copy-pretty">
          {resolveLocalizedError('REGISTRATION_DISABLED', locale)}
        </p>
        <Link
          to={`/${locale}/auth/login${returnQuerySuffix}`}
          className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary inline-flex items-center justify-center no-underline"
        >
          {extAuth.backToSignIn}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <StepProgressNav
        steps={[extAuth.authStepAccount, extAuth.authStepVerifyOtp]}
        activeIndex={step === 'details' ? 0 : 1}
        ariaLabel={extAuth.stepProgressAria}
      />

      {step === 'details' ? (
        <div className="flex flex-col gap-5">
          <form
            ref={formRef}
            method="POST"
            onSubmit={(e) => void handleStep1Submit(e)}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
              <UsernameField
                id="auth-reg-user"
                locale={locale}
                value={username}
                onChange={setUsername}
                enabled={step === 'details'}
                autoFocus
                placeholder="alice_dev"
                inputRef={usernameRef}
                onStatusChange={setUsernameStatus}
              />

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
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
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
                maxLength={MAX_EMAIL_LENGTH}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                data-error="auth-reg-email-err"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="auth-input"
              />
              <FieldErrorText
                id="auth-reg-email-err"
                prefixLabel={extAuth.errorPrefixLabel}
                message={extAuth.errEmailInvalid}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="auth-reg-pw" className="ink-field-label">
                {copy.passwordLabel}
              </label>
              <p id="auth-reg-pw-hint" className="text-xs text-ink-muted mb-1.5">
                {extAuth.passwordRuleHint}
              </p>
              <PasswordInput
                id="auth-reg-pw"
                name="password"
                locale={locale}
                variant="auth"
                required
                minLength={8}
                autoComplete="new-password"
                enterKeyHint="done"
                ariaDescribedBy="auth-reg-pw-hint"
                showStrengthMeter
                strengthId="auth-reg-pw-strength"
                dataError="auth-reg-pw-err"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={copy.passwordPlaceholder}
              />
              <FieldErrorText
                id="auth-reg-pw-err"
                prefixLabel={extAuth.errorPrefixLabel}
                message={extAuth.errPasswordLength}
              />
            </div>

            {siteSettings.allow_author_registration && (
              <RadioCardGroup
                name="role"
                legend={extAuth.accountRoleLabel}
                value={role}
                onChange={setRole}
                options={[
                  {
                    value: 'reader',
                    title: extAuth.roleReader,
                    hint: extAuth.roleReaderHint,
                  },
                  {
                    value: 'author',
                    title: extAuth.roleAuthor,
                    hint: extAuth.roleAuthorHint,
                  },
                ]}
              />
            )}

            <button
              type="submit"
              disabled={sendingCode}
              className="mt-1 w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
            >
              {sendingCode ? extAuth.sendingCodeBtn : extAuth.continueToOtpBtn}
            </button>
          </form>

          <nav
            aria-label={copy.signInTab}
            className="pt-4 border-t border-dashed border-border-subtle flex items-center justify-center gap-1.5 text-xs text-ink-muted"
          >
            <span>{extAuth.hasAccountPrompt}</span>
            <Link
              to={`/${locale}/auth/login${returnQuerySuffix}`}
              className="inline-flex items-center min-h-7 px-1 font-semibold text-link-ink no-underline hover:underline"
            >
              {extAuth.goToLoginLink}
            </Link>
          </nav>
        </div>
      ) : (
        <form
          ref={formRef}
          method="POST"
          onSubmit={(e) => void handleStep2Submit(e)}
          className="flex flex-col gap-4"
        >
          <div className="px-3.5 py-2.5 rounded-xl bg-surface-raised border border-border-subtle flex items-center justify-between gap-2 text-xs">
            <span className="font-mono font-semibold text-ink-primary truncate">
              {email.trim()}
            </span>
            <button
              type="button"
              onClick={() => setStep('details')}
              className="inline-flex items-center min-h-7 px-1 font-semibold text-link-ink hover:underline shrink-0 cursor-pointer"
            >
              {extAuth.editDetailsBackBtn}
            </button>
          </div>

          <div className="auth-field">
            <label htmlFor="register-otp" className="ink-field-label">
              {extAuth.verificationCodeLabel}
            </label>
            <p
              id="register-otp-hint"
              className="text-xs text-ink-muted leading-relaxed mb-2.5 auth-copy-pretty"
            >
              {extAuth.otpSentSubtitle(email.trim())}
            </p>
            <OtpInput
              id="register-otp"
              value={otpCode}
              onChange={setOtpCode}
              autoFocus
              disabled={submitting}
              ariaDescribedBy="register-otp-hint"
              dataError="register-otp-err"
            />
            <FieldErrorText
              id="register-otp-err"
              prefixLabel={extAuth.errorPrefixLabel}
              message={extAuth.errOtpLength}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
          >
            {submitting ? copy.registerSubmitting : extAuth.verifyAndRegisterBtn}
          </button>

          <div className="flex items-center justify-center pt-1 text-xs">
            <OtpResendButton
              locale={locale}
              cooldown={cooldown}
              sending={sendingCode}
              onResend={() => void requestRegisterCode(email)}
            />
          </div>
        </form>
      )}
    </div>
  );
}
