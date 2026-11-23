/*
 * Branded Top-Layer Select Control built on `PopupMenu` (`modern-web-guidance/menu`):
 * - Uses native `popover="auto"` + `focusgroup="menu nomemory"` + `menuitemradio` `✓` checkmarks.
 * - Entire trigger surface (including chevron) toggles reliably inside `<dialog>` and embedded webviews.
 */

import { useMemo } from 'react';
import { PopupMenu } from './PopupMenu';

export interface InkSelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface InkSelectProps<T extends string = string> {
  id?: string;
  name?: string;
  value: T;
  options: ReadonlyArray<InkSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  align?: 'start' | 'end';
  triggerClassName?: string;
  wrapperClassName?: string;
  minWidthClass?: string;
}

export function InkSelect<T extends string = string>({
  id,
  name,
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '',
  disabled = false,
  align = 'start',
  triggerClassName = 'w-full min-h-9 px-3 py-1.5 rounded-xl bg-surface-raised text-ink-primary border border-border-control text-sm',
  wrapperClassName = 'w-full min-w-0',
  minWidthClass = 'min-w-[10rem]',
}: InkSelectProps<T>) {
  const selectedLabel = useMemo(() => {
    const matched = options.find((opt) => opt.value === value);
    return matched ? matched.label : placeholder || value;
  }, [options, placeholder, value]);

  return (
    <div className={`relative inline-block ${wrapperClassName}`}>
      {name && <input type="hidden" name={name} value={value} />}
      <PopupMenu
        triggerId={id}
        align={align}
        variant="menu"
        minWidthClass={minWidthClass}
        triggerDisabled={disabled}
        triggerAriaLabel={ariaLabel}
        triggerClassName={`justify-between text-start border hover:border-ink-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${triggerClassName}`}
        triggerLabel={
          <span className="truncate flex-1 text-start">{selectedLabel}</span>
        }
      >
        {({ close }) =>
          options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={opt.disabled}
                onClick={(e) => {
                  onChange(opt.value);
                  close(e.detail !== 0);
                }}
                className={active ? 'font-semibold text-link-ink' : ''}
              >
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })
        }
      </PopupMenu>
    </div>
  );
}
