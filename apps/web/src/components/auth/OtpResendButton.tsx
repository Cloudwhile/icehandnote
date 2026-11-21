/*
 * Shared Localized OTP Resend Link/Button (`LoginFlowPanel`, `RegisterFlowPanel`, `PasswordResetFlowPanel`).
 */

import { EXT_COPY } from '../../lib/i18n';
import type { LocaleCode } from '../../lib/types';

export interface OtpResendButtonProps {
  locale: LocaleCode;
  cooldown: number;
  sending: boolean;
  disabled?: boolean;
  onResend: () => void;
  className?: string;
}

export function OtpResendButton({
  locale,
  cooldown,
  sending,
  disabled = false,
  onResend,
  className = '',
}: OtpResendButtonProps) {
  const extAuth = EXT_COPY[locale].auth;

  return (
    <button
      type="button"
      disabled={sending || cooldown > 0 || disabled}
      onClick={onResend}
      className={`inline-flex items-center min-h-7 px-1 font-semibold text-link-ink hover:underline cursor-pointer disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed tabular-nums ${className}`.trim()}
    >
      {sending
        ? extAuth.sendingCodeBtn
        : cooldown > 0
          ? extAuth.resendCodeCountdown(cooldown)
          : extAuth.resendOtpBtn}
    </button>
  );
}
