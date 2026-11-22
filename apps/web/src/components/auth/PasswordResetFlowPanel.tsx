/*
 * Decoupled 3-Step Password Recovery & Reset Flow (`AuthFlowPage` Modes: `'forgot'` & `'reset'`).
 * Reuses `<StepProgressNav>`, `<FieldErrorText>`, `<OtpInput>`, `<OtpResendButton>`, and `<PasswordInput>`.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '../../lib/email';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type { LocaleCode, UserProfileDto } from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { FieldErrorText } from '../ui/FormControls';
import { IconCheck } from '../ui/Icons';
import { PasswordInput } from '../ui/PasswordInput';
import { StepProgressNav } from '../ui/StepProgressNav';
import { useToast } from '../ui/ToastProvider';
import {
  readOtpCooldown,
  saveOtpCooldown,
  useOtpCooldown,
} from './otpCooldown';
import { OtpInput } from './OtpInput';
import { OtpResendButton } from './OtpResendButton';

export interface PasswordResetFlowPanelProps {
  mode: 'forgot' | 'reset';
  locale: LocaleCode;
  resetEmailFromUrl: string;
  resetTokenFromUrl: string;
  returnQuerySuffix: string;
  onTokenVerifiedChange: (verified: boolean) => void;
  onFocusHeading: () => void;
  onSuccess: (user: UserProfileDto, welcomeMessage: string) => void;
}

export function PasswordResetFlowPanel({
  mode,
  locale,
  resetEmailFromUrl,
  resetTokenFromUrl,
  returnQuerySuffix,
  onTokenVerifiedChange,
  onFocusHeading,
  onSuccess,
}: PasswordResetFlowPanelProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const copy = UI_COPY[locale].auth;
  const extAuth = EXT_COPY[locale].auth;

  const formRef = useRef<HTMLFormElement | null>(null);
  const confirmPwRef = useRef<HTMLInputElement | null>(null);
  const onTokenVerifiedChangeRef = useRef(onTokenVerifiedChange);
  onTokenVerifiedChangeRef.current = onTokenVerifiedChange;

  const [forgotEmail, setForgotEmail] = useState(resetEmailFromUrl);
  const [resetEmail, setResetEmail] = useState(resetEmailFromUrl);
  const [resetOtpCode, setResetOtpCode] = useState('');
  const [verifiedResetToken, setVerifiedResetToken] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resending, setResending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const effectiveResetToken = verifiedResetToken || resetTokenFromUrl;
  const activeEmailSubject = mode === 'forgot' ? forgotEmail : resetEmail;

  const { cooldown, startCooldown, applyRateLimitError } = useOtpCooldown(
    'reset',
    activeEmailSubject,
  );

  useAccessibleFormValidation(formRef, [mode, Boolean(effectiveResetToken)]);

  useEffect(() => {
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

  useEffect(() => {
    onTokenVerifiedChangeRef.current(Boolean(effectiveResetToken));
  }, [effectiveResetToken]);

  useEffect(() => {
    const confirmInput = confirmPwRef.current;
    if (!confirmInput) return;
    if (confirmNewPassword && confirmNewPassword !== newPassword) {
      confirmInput.setCustomValidity(extAuth.passwordMismatchMsg);
    } else {
      confirmInput.setCustomValidity('');
    }
  }, [newPassword, confirmNewPassword, extAuth.passwordMismatchMsg]);

  const resetFlowSteps = [
    extAuth.authStepEmail,
    extAuth.authStepVerifyOtp,
    extAuth.authStepNewPassword,
  ];

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = normalizeEmail(forgotEmail);
    if (!cleanEmail) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (submitting) return;
    const targetUrl = `/${locale}/auth/reset-password?email=${encodeURIComponent(cleanEmail)}${returnQuerySuffix ? `&${returnQuerySuffix.slice(1)}` : ''}`;
    const existingCooldown = readOtpCooldown('reset', cleanEmail);
    if (existingCooldown > 0) {
      startCooldown(existingCooldown, cleanEmail);
      navigate(targetUrl);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.forgotPassword(cleanEmail, locale);
      const cd = res.cooldown_seconds || 60;
      saveOtpCooldown('reset', cleanEmail, cd);
      startCooldown(cd, cleanEmail);
      toast.success(extAuth.resetEmailSentMsg);
      navigate(targetUrl);
    } catch (err) {
      if (applyRateLimitError(err, cleanEmail)) {
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
    const cleanEmail = normalizeEmail(resetEmail);
    if (!cleanEmail) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (resending || cooldown > 0) return;
    setResending(true);
    try {
      const res = await api.forgotPassword(cleanEmail, locale);
      startCooldown(res.cooldown_seconds || 60, cleanEmail);
      toast.success(extAuth.resetEmailSentMsg);
    } catch (err) {
      applyRateLimitError(err, cleanEmail);
      toast.error(err);
    } finally {
      setResending(false);
    }
  };

  const handleVerifyResetOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (verifyingOtp) return;
    const cleanEmail = normalizeEmail(resetEmail);
    const cleanCode = resetOtpCode.trim();
    if (!cleanEmail) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (cleanCode.length < 6) {
      toast.error('OTP_CHALLENGE_INVALID');
      return;
    }
    setVerifyingOtp(true);
    try {
      const res = await api.verifyResetOtp(cleanEmail, cleanCode);
      setVerifiedResetToken(res.reset_token);
      setNewPassword('');
      setConfirmNewPassword('');
      window.requestAnimationFrame(onFocusHeading);
    } catch (err) {
      toast.error(err);
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResetStep3Submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !effectiveResetToken) return;
    if (newPassword !== confirmNewPassword) {
      toast.warning(extAuth.passwordMismatchMsg);
      confirmPwRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.resetPassword({
        token: effectiveResetToken,
        new_password: newPassword,
      });
      onSuccess(session.user, extAuth.resetSuccessMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === 'forgot') {
    return (
      <div className="flex flex-col gap-5">
        <StepProgressNav
          steps={resetFlowSteps}
          activeIndex={0}
          ariaLabel={extAuth.stepProgressAria}
        />

        <form
          ref={formRef}
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
              maxLength={MAX_EMAIL_LENGTH}
              autoComplete="email"
              autoCorrect="off"
              autoCapitalize="none"
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
              prefixLabel={extAuth.errorPrefixLabel}
              message={extAuth.errEmailInvalid}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
          >
            {submitting ? extAuth.sendingResetBtn : extAuth.sendResetBtn}
          </button>
        </form>

        <nav
          aria-label={extAuth.backToSignIn}
          className="text-center pt-4 border-t border-dashed border-border-subtle text-xs"
        >
          <Link
            to={`/${locale}/auth/login${returnQuerySuffix}`}
            className="inline-flex items-center justify-center min-h-7 px-2 font-semibold text-ink-muted hover:text-link-ink no-underline hover:underline underline-offset-4 transition-colors"
          >
            {extAuth.backToSignIn}
          </Link>
        </nav>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <StepProgressNav
        steps={resetFlowSteps}
        activeIndex={effectiveResetToken ? 2 : 1}
        ariaLabel={extAuth.stepProgressAria}
      />

      {!effectiveResetToken ? (
        <form
          ref={formRef}
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
                className="inline-flex items-center min-h-7 px-1 font-semibold text-link-ink no-underline hover:underline shrink-0"
              >
                {extAuth.changeEmailBtn}
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
                maxLength={MAX_EMAIL_LENGTH}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
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
                prefixLabel={extAuth.errorPrefixLabel}
                message={extAuth.errEmailInvalid}
              />
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="reset-otp" className="ink-field-label">
              {extAuth.verificationCodeLabel}
            </label>
            <p
              id="reset-otp-hint"
              className="text-xs text-ink-muted leading-relaxed mb-2.5 auth-copy-pretty"
            >
              {extAuth.resetStep2Desc(resetEmail.trim())}
            </p>
            <OtpInput
              id="reset-otp"
              value={resetOtpCode}
              onChange={setResetOtpCode}
              autoFocus={Boolean(resetEmailFromUrl)}
              disabled={verifyingOtp}
              ariaDescribedBy="reset-otp-hint"
              dataError="reset-otp-err"
            />
            <FieldErrorText
              id="reset-otp-err"
              prefixLabel={extAuth.errorPrefixLabel}
              message={extAuth.errOtpLength}
            />
          </div>

          <button
            type="submit"
            disabled={verifyingOtp}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
          >
            {verifyingOtp ? copy.submitting : extAuth.verifyOtpContinueBtn}
          </button>

          <div className="flex items-center justify-center pt-1 text-xs">
            <OtpResendButton
              locale={locale}
              cooldown={cooldown}
              sending={resending}
              disabled={!resetEmail.trim()}
              onResend={() => void handleResendResetCode()}
            />
          </div>
        </form>
      ) : (
        <form
          ref={formRef}
          method="POST"
          onSubmit={(e) => void handleResetStep3Submit(e)}
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
            <span>{extAuth.resetStep3VerifiedBadge}</span>
          </div>

          <div className="auth-field">
            <label htmlFor="auth-reset-pw" className="ink-field-label">
              {extAuth.newPasswordLabel}
            </label>
            <p id="auth-reset-pw-hint" className="text-xs text-ink-muted mb-1.5">
              {extAuth.passwordRuleHint}
            </p>
            <PasswordInput
              id="auth-reset-pw"
              name="new_password"
              locale={locale}
              variant="auth"
              required
              minLength={8}
              autoFocus
              autoComplete="new-password"
              enterKeyHint="next"
              ariaDescribedBy="auth-reset-pw-hint"
              showStrengthMeter
              strengthId="auth-reset-pw-strength"
              dataError="auth-reset-pw-err"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={copy.passwordPlaceholder}
            />
            <FieldErrorText
              id="auth-reset-pw-err"
              prefixLabel={extAuth.errorPrefixLabel}
              message={extAuth.errPasswordLength}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-reset-confirm-pw" className="ink-field-label">
              {extAuth.confirmPasswordLabel}
            </label>
            <PasswordInput
              inputRef={confirmPwRef}
              id="auth-reset-confirm-pw"
              name="confirm_new_password"
              locale={locale}
              variant="auth"
              required
              minLength={8}
              autoComplete="new-password"
              enterKeyHint="done"
              dataError="auth-reset-confirm-pw-err"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder={copy.passwordPlaceholder}
            />
            <FieldErrorText
              id="auth-reset-confirm-pw-err"
              prefixLabel={extAuth.errorPrefixLabel}
              message={
                confirmNewPassword && confirmNewPassword !== newPassword
                  ? extAuth.passwordMismatchMsg
                  : extAuth.errPasswordLength
              }
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
          >
            {submitting ? copy.submitting : extAuth.resetSubmitBtn}
          </button>
        </form>
      )}

      <nav
        aria-label={extAuth.backToSignIn}
        className="text-center pt-4 border-t border-dashed border-border-subtle"
      >
        <Link
          to={`/${locale}/auth/login${returnQuerySuffix}`}
          className="inline-flex items-center justify-center min-h-7 px-2 text-xs font-semibold text-ink-muted hover:text-link-ink no-underline hover:underline underline-offset-4 transition-colors"
        >
          {extAuth.backToSignIn}
        </Link>
      </nav>
    </div>
  );
}
