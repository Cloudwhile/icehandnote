/*
 * Reusable Accessible Password Input (`modern-web-guidance/forms` §8):
 * - Provides an accessible `<button type="button" aria-pressed={visible}>` unmask toggle
 *   paired with a screen-reader-only warning (`aria-describedby`) and localized labels.
 * - Optionally renders `<PasswordStrengthMeter>` right beneath the field.
 */

import { type InputHTMLAttributes, type Ref, useId, useState } from 'react';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type { LocaleCode } from '../../lib/types';
import { PasswordStrengthMeter } from '../auth/PasswordStrengthMeter';
import { IconEye, IconEyeOff } from './Icons';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  locale: LocaleCode;
  inputRef?: Ref<HTMLInputElement>;
  variant?: 'auth' | 'field' | 'compact';
  showStrengthMeter?: boolean;
  strengthId?: string;
  dataError?: string;
}

export function PasswordInput({
  locale,
  id,
  value = '',
  inputRef,
  variant = 'field',
  showStrengthMeter = false,
  strengthId,
  dataError,
  ariaDescribedBy,
  className = '',
  ...rest
}: PasswordInputProps & { ariaDescribedBy?: string }) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const warningId = useId();
  const resolvedId = id ?? generatedId;
  const resolvedStrengthId = strengthId ?? `${resolvedId}-strength`;

  const authCopy = UI_COPY[locale].auth;
  const extAuth = EXT_COPY[locale].auth;

  const describedByParts = [
    ariaDescribedBy,
    rest['aria-describedby'],
    showStrengthMeter ? resolvedStrengthId : undefined,
  ].filter(Boolean);

  const baseClass =
    variant === 'auth'
      ? 'auth-input pr-11'
      : variant === 'compact'
        ? 'w-full px-3 py-2 pr-10 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset'
        : 'ink-field-input pr-10';

  const strValue = typeof value === 'string' ? value : String(value ?? '');

  return (
    <div>
      <span id={warningId} className="sr-only">
        {extAuth.passwordToggleWarning}
      </span>
      <div className="relative">
        <input
          {...rest}
          ref={inputRef}
          id={resolvedId}
          type={visible ? 'text' : 'password'}
          value={value}
          aria-describedby={
            describedByParts.length > 0 ? describedByParts.join(' ') : undefined
          }
          data-error={dataError}
          className={`${baseClass} ${className}`.trim()}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? authCopy.hidePassword : authCopy.showPassword}
          aria-describedby={warningId}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 end-1 my-auto w-8 h-8 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
        >
          {visible ? (
            <IconEyeOff className="w-4 h-4" />
          ) : (
            <IconEye className="w-4 h-4" />
          )}
        </button>
      </div>

      {showStrengthMeter && (
        <PasswordStrengthMeter
          password={strValue}
          locale={locale}
          id={resolvedStrengthId}
        />
      )}
    </div>
  );
}
