/*
 * Shared Debounced Username Input & Live Availability Status (`RegisterFlowPanel` & `OAuthOnboardingPanel`).
 */

import { type RefObject, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type { LocaleCode } from '../../lib/types';
import { FieldErrorText } from '../ui/FormControls';
import { IconAlertCircle, IconCheck } from '../ui/Icons';

export type UsernameCheckState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'taken'
  | 'invalid_format';

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

export function useUsernameAvailability(
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

export interface UsernameFieldProps {
  id: string;
  locale: LocaleCode;
  value: string;
  onChange: (next: string) => void;
  enabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onStatusChange?: (status: UsernameCheckState) => void;
}

export function UsernameField({
  id,
  locale,
  value,
  onChange,
  enabled = true,
  autoFocus = false,
  placeholder,
  inputRef,
  onStatusChange,
}: UsernameFieldProps) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const resolvedRef = inputRef ?? internalRef;
  const copy = UI_COPY[locale].auth;
  const extAuth = EXT_COPY[locale].auth;
  const errId = `${id}-err`;

  const status = useUsernameAvailability(
    value,
    enabled,
    resolvedRef,
    extAuth.usernameTaken,
    extAuth.usernameInvalidFormat,
  );

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  return (
    <div className="auth-field">
      <label htmlFor={id} className="ink-field-label">
        {copy.usernameLabel}
      </label>
      <input
        ref={resolvedRef}
        id={id}
        name="username"
        type="text"
        required
        autoFocus={autoFocus}
        minLength={3}
        maxLength={32}
        autoComplete="username"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="next"
        aria-invalid={
          status === 'taken' || status === 'invalid_format' ? true : undefined
        }
        data-error={errId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="auth-input"
      />
      {status === 'checking' ? (
        <p
          id={errId}
          role="status"
          aria-live="polite"
          className="mt-1.5 mb-0 text-xs text-ink-muted leading-snug"
        >
          {extAuth.usernameChecking}
        </p>
      ) : status === 'available' ? (
        <p
          id={errId}
          role="status"
          aria-live="polite"
          className="mt-1.5 mb-0 text-xs font-semibold flex items-center gap-1 leading-snug"
          style={{ color: 'var(--accent-success-ink)' }}
        >
          <IconCheck className="w-3.5 h-3.5 shrink-0" />
          <span>{extAuth.usernameAvailable}</span>
        </p>
      ) : status === 'taken' || status === 'invalid_format' ? (
        <p
          id={errId}
          role="status"
          aria-live="polite"
          className="mt-1.5 mb-0 text-xs font-semibold flex items-start gap-1 leading-snug"
          style={{ color: 'var(--accent-danger-ink)' }}
        >
          <IconAlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {status === 'taken' ? extAuth.usernameTaken : extAuth.usernameInvalidFormat}
          </span>
        </p>
      ) : (
        <FieldErrorText
          id={errId}
          prefixLabel={extAuth.errorPrefixLabel}
          message={extAuth.errUsernameInvalid}
        />
      )}
    </div>
  );
}
