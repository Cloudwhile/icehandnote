import type { CSSProperties } from 'react';
import { EXT_COPY } from '../../lib/i18n';
import type { LocaleCode } from '../../lib/types';

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  tier: 'idle' | 'weak' | 'fair' | 'good' | 'strong';
}

/**
 * Advisory-only password strength evaluator (never blocks submission).
 * Scale: 0 = empty, 1 = weak, 2 = fair, 3 = good, 4 = strong.
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password) {
    return { score: 0, tier: 'idle' };
  }
  const len = password.length;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(password);
  const classes =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasDigit ? 1 : 0) +
    (hasSymbol ? 1 : 0);

  if (len < 8) {
    return { score: 1, tier: 'weak' };
  }
  if (classes >= 4 || (classes >= 3 && len >= 12) || (classes >= 2 && len >= 16)) {
    return { score: 4, tier: 'strong' };
  }
  if (classes >= 3 || (classes >= 2 && len >= 11)) {
    return { score: 3, tier: 'good' };
  }
  if (classes >= 2 || len >= 12) {
    return { score: 2, tier: 'fair' };
  }
  return { score: 1, tier: 'weak' };
}

interface PasswordStrengthMeterProps {
  password: string;
  locale: LocaleCode;
  id?: string;
}

export function PasswordStrengthMeter({
  password,
  locale,
  id,
}: PasswordStrengthMeterProps) {
  const extAuth = EXT_COPY[locale].auth;
  const { score, tier } = evaluatePasswordStrength(password);

  const labelText =
    tier === 'idle'
      ? extAuth.pwStrengthIdle
      : tier === 'weak'
        ? extAuth.pwStrengthWeak
        : tier === 'fair'
          ? extAuth.pwStrengthFair
          : tier === 'good'
            ? extAuth.pwStrengthGood
            : extAuth.pwStrengthStrong;

  const fillVar =
    tier === 'weak'
      ? 'var(--accent-danger-ink)'
      : tier === 'fair'
        ? 'var(--accent-amber-ink)'
        : tier === 'good'
          ? 'var(--accent-ice-ink)'
          : tier === 'strong'
            ? 'var(--accent-success-ink)'
            : 'var(--border-subtle)';

  const textStyle: CSSProperties =
    tier === 'idle'
      ? { color: 'var(--ink-muted)' }
      : { color: fillVar };

  return (
    <div id={id} className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-muted">{extAuth.pwStrengthLabel}</span>
        <span
          role="status"
          aria-live="polite"
          className="font-semibold"
          style={textStyle}
        >
          {labelText}
        </span>
      </div>
      <div className="pw-strength-track">
        <progress
          className="pw-strength-meter"
          max={4}
          value={score}
          aria-label={`${extAuth.pwStrengthLabel}: ${labelText}`}
          style={{ '--progress-bar-fill': fillVar } as CSSProperties}
        />
        <span aria-hidden="true" className="pw-strength-ticks">
          <span />
          <span />
          <span />
          <span />
        </span>
      </div>
      {extAuth.pwStrengthAdvisory && (
        <p className="text-xs text-ink-muted leading-snug">
          {extAuth.pwStrengthAdvisory}
        </p>
      )}
    </div>
  );
}
