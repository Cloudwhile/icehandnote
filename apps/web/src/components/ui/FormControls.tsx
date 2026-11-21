/*
 * Shared Accessible Form Selection & Feedback Primitives (`modern-web-guidance/forms`):
 * - `<RadioPillGroup>`: Semantic `<fieldset>` + `<legend>` + `sr-only` native `<input type="radio">` pills.
 * - `<CheckboxPillGroup>`: Multi-select `<fieldset>` + `<legend>` + `sr-only` native `<input type="checkbox">` pills.
 * - `<RadioCardGroup>`: Multi-line title + hint radio cards with `:has(input:focus-visible)` ring.
 * - `<SwitchRow>`: Native `<input type="checkbox" switch="">` toggle row (row or compact chip mode).
 * - `<FieldErrorText>`: Non-color icon + message validation feedback paired with `data-error`.
 */

import type { ReactNode } from 'react';
import { IconAlertCircle, IconCheck } from './Icons';

export interface ChoicePillOption<T extends string | number> {
  value: T;
  label: ReactNode;
  badge?: ReactNode;
}

export interface RadioPillGroupProps<T extends string | number> {
  name: string;
  legend?: ReactNode;
  options: readonly ChoicePillOption<T>[];
  value: T;
  onChange: (next: T) => void;
  size?: 'sm' | 'md';
  mono?: boolean;
  className?: string;
}

export function RadioPillGroup<T extends string | number>({
  name,
  legend,
  options,
  value,
  onChange,
  size = 'md',
  mono = false,
  className = '',
}: RadioPillGroupProps<T>) {
  const heightCls = size === 'sm' ? 'min-h-8 px-3 py-1' : 'min-h-9 px-3 py-1.5';
  const dotCls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  const pills = (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <label
            key={String(opt.value)}
            className={`relative inline-flex items-center gap-1.5 ${heightCls} rounded-xl text-xs ${
              mono ? 'font-mono tabular-nums' : ''
            } border cursor-pointer transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-action-bg has-[input:focus-visible]:outline-offset-2 ${
              active
                ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-ink-muted'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={String(opt.value)}
              checked={active}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`${dotCls} rounded-full inline-flex items-center justify-center border shrink-0 ${
                active
                  ? 'bg-action-bg border-action-bg text-action-fg'
                  : 'bg-surface-sheet border-ink-muted'
              }`}
            >
              {active && <IconCheck className="w-2.5 h-2.5" />}
            </span>
            <span>{opt.label}</span>
            {opt.badge}
          </label>
        );
      })}
    </div>
  );

  if (!legend) {
    return <div className={className}>{pills}</div>;
  }

  return (
    <fieldset className={`m-0 p-0 border-0 ${className}`.trim()}>
      <legend className="text-xs font-semibold text-ink-secondary mb-2.5 p-0">
        {legend}
      </legend>
      {pills}
    </fieldset>
  );
}

export interface CheckboxPillGroupProps<T extends string> {
  name: string;
  legend?: ReactNode;
  options: readonly ChoicePillOption<T>[];
  values: readonly T[];
  onToggle: (item: T) => void;
  className?: string;
}

export function CheckboxPillGroup<T extends string>({
  name,
  legend,
  options,
  values,
  onToggle,
  className = '',
}: CheckboxPillGroupProps<T>) {
  const pills = (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const checked = values.includes(opt.value);
        return (
          <label
            key={opt.value}
            className={`relative inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-action-bg has-[input:focus-visible]:outline-offset-2 ${
              checked
                ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                : 'bg-surface-raised border-border-subtle text-ink-muted hover:border-ink-muted'
            }`}
          >
            <input
              type="checkbox"
              name={name}
              value={opt.value}
              checked={checked}
              onChange={() => onToggle(opt.value)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`w-4 h-4 rounded inline-flex items-center justify-center border shrink-0 ${
                checked
                  ? 'bg-action-bg border-action-bg text-action-fg'
                  : 'bg-surface-sheet border-ink-muted'
              }`}
            >
              {checked && <IconCheck className="w-2.5 h-2.5" />}
            </span>
            <span>{opt.label}</span>
            {opt.badge && (
              <span className="font-mono text-ink-muted">{opt.badge}</span>
            )}
          </label>
        );
      })}
    </div>
  );

  if (!legend) {
    return <div className={className}>{pills}</div>;
  }

  return (
    <fieldset className={`m-0 p-0 border-0 ${className}`.trim()}>
      <legend className="text-xs font-semibold text-ink-secondary mb-2.5 p-0">
        {legend}
      </legend>
      {pills}
    </fieldset>
  );
}

export interface RadioCardOption<T extends string> {
  value: T;
  title: ReactNode;
  hint?: ReactNode;
}

export interface RadioCardGroupProps<T extends string> {
  name: string;
  legend: ReactNode;
  options: readonly RadioCardOption<T>[];
  value: T;
  onChange: (next: T) => void;
  columnsClass?: string;
  className?: string;
}

export function RadioCardGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  columnsClass = 'grid-cols-2',
  className = '',
}: RadioCardGroupProps<T>) {
  return (
    <fieldset className={`m-0 p-0 border-0 flex flex-col gap-2 ${className}`.trim()}>
      <legend className="ink-field-label p-0 mb-1.5">{legend}</legend>
      <div className={`grid ${columnsClass} gap-2.5`}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <label
              key={opt.value}
              className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-action-bg has-[input:focus-visible]:outline-offset-2 ${
                selected
                  ? 'bg-action-subtle border-action-bg text-ink-primary'
                  : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-border-ink'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
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
                  {opt.title}
                </span>
                {opt.hint && (
                  <span className="block text-xs text-ink-muted mt-0.5 leading-snug">
                    {opt.hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface SwitchRowProps {
  name?: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  variant?: 'row' | 'chip' | 'inline';
  labelPosition?: 'start' | 'end';
  className?: string;
}

export function SwitchRow({
  name,
  label,
  checked,
  onChange,
  disabled = false,
  variant = 'row',
  labelPosition = 'start',
  className = '',
}: SwitchRowProps) {
  const inputEl = (
    <input
      type="checkbox"
      role="switch"
      name={name}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="shrink-0"
      {...({ switch: '' } as Record<string, unknown>)}
    />
  );

  if (variant === 'chip') {
    return (
      <label
        className={`inline-flex items-center gap-2 min-h-8 px-2.5 py-1 rounded-xl bg-surface-raised border border-border-subtle text-xs text-ink-secondary hover:text-ink-primary transition-colors ${
          disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'
        } ${className}`.trim()}
      >
        {labelPosition === 'end' ? (
          <>
            {inputEl}
            <span>{label}</span>
          </>
        ) : (
          <>
            <span>{label}</span>
            {inputEl}
          </>
        )}
      </label>
    );
  }

  if (variant === 'inline') {
    return (
      <label
        className={`inline-flex items-center gap-2 min-h-7 text-xs text-ink-secondary ${
          disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'
        } ${className}`.trim()}
      >
        {labelPosition === 'end' ? (
          <>
            {inputEl}
            <span>{label}</span>
          </>
        ) : (
          <>
            <span>{label}</span>
            {inputEl}
          </>
        )}
      </label>
    );
  }

  return (
    <label
      className={`flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-raised/50 transition-colors ${
        disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`.trim()}
    >
      <span className="text-sm text-ink-primary">{label}</span>
      {inputEl}
    </label>
  );
}

export function FieldErrorText({
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
