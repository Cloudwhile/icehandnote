/*
 * Single-Input Tactile 6-Slot OTP Form (`modern-web-guidance/sms-otp-form` & `forms` §3)
 * - Uses ONE native `<input type="text" inputMode="numeric" autoComplete="one-time-code">`
 *   (never splits digits across 6 separate inputs) so browser/OS OTP autofill, copy-paste,
 *   undo, selection, and screen reader announcements work natively without fragmentation.
 * - Renders 6 purely visual `aria-hidden="true"` stationery digit cells (`[0][1][2] – [3][4][5]`)
 *   driven by the single input's value, focus state, and `:user-invalid` CSS state via `:has()`.
 */

import { type RefObject, useEffect, useRef, useState } from 'react';

interface OtpInputProps {
  id: string;
  name?: string;
  value: string;
  onChange: (next: string) => void;
  length?: number;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  enterKeyHint?: 'done' | 'next' | 'go' | 'send';
  ariaDescribedBy?: string;
  dataError?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onComplete?: (code: string) => void;
}

export function OtpInput({
  id,
  name = 'otp',
  value,
  onChange,
  length = 6,
  disabled = false,
  required = true,
  autoFocus = false,
  enterKeyHint = 'done',
  ariaDescribedBy,
  dataError,
  inputRef,
  onComplete,
}: OtpInputProps) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const resolvedRef = inputRef ?? internalRef;
  const [focused, setFocused] = useState(false);

  const cleanValue = value.replace(/\D/g, '').slice(0, length);

  useEffect(() => {
    if (autoFocus && !disabled) {
      resolvedRef.current?.focus();
    }
  }, [autoFocus, disabled, resolvedRef]);

  const activeSlotIndex = focused
    ? Math.min(cleanValue.length, length - 1)
    : -1;

  const handleChange = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, length);
    onChange(next);
    if (next.length === length && next !== cleanValue && onComplete) {
      onComplete(next);
    }
  };

  const renderSlot = (idx: number) => {
    const digit = cleanValue[idx] ?? '';
    const isActive = idx === activeSlotIndex;
    const showCaret = isActive && !digit && !disabled;

    return (
      <span
        key={idx}
        data-filled={digit ? 'true' : 'false'}
        data-active={isActive ? 'true' : 'false'}
        className="otp-slot flex-1 min-w-0 max-w-13 h-12 sm:h-13 rounded-xl inline-flex items-center justify-center font-mono text-xl font-semibold tabular-nums select-none"
      >
        {digit ? (
          digit
        ) : showCaret ? (
          <span className="otp-caret" />
        ) : (
          <span className="text-ink-muted/45 text-base font-normal">·</span>
        )}
      </span>
    );
  };

  const midpoint = length === 6 ? 3 : -1;

  return (
    <div
      className="otp-shell"
      style={{ ['--value-length' as string]: cleanValue.length }}
    >
      <input
        ref={resolvedRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        pattern={`\\d{${length}}`}
        maxLength={length}
        enterKeyHint={enterKeyHint}
        required={required}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        data-error={dataError}
        value={cleanValue}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => handleChange(e.target.value)}
        className="otp-native-input"
      />

      <div
        aria-hidden="true"
        className="flex items-center justify-center gap-1.5 sm:gap-2 w-full pointer-events-none"
      >
        {midpoint > 0 ? (
          <>
            {Array.from({ length: midpoint }, (_, i) => renderSlot(i))}
            <span className="w-2.5 h-0.5 rounded-full bg-border-subtle shrink-0 mx-0.5" />
            {Array.from({ length: length - midpoint }, (_, i) =>
              renderSlot(midpoint + i),
            )}
          </>
        ) : (
          Array.from({ length }, (_, i) => renderSlot(i))
        )}
      </div>
    </div>
  );
}
