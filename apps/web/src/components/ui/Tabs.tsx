/*
 * Accessible Tablist & Segmented Control Primitives (`modern-web-guidance/tabs`):
 * - `<UnderlineTabs>`: Single-row WAI-ARIA `tablist` with `focusgroup="tablist nomemory"`,
 *   `focusgroupstart` on the active tab, forced-colors-safe underline shape indicator (`.mwg-tab`),
 *   `scrollIntoView({ block: 'nearest', inline: 'nearest' })`, and automatic ArrowLeft/ArrowRight/Home/End
 *   roving-focus fallback where native `focusGroup` is unavailable.
 * - `<SegmentedControl>`: Compact `role="group"` + `aria-pressed` toggle strip for view/filter switches.
 */

import { type KeyboardEvent, type ReactNode, useRef } from 'react';

export interface TabItem<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  id?: string;
}

export interface UnderlineTabsProps<T extends string | number> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  idPrefix?: string;
  fill?: boolean;
  variant?: 'underline' | 'segmented';
  className?: string;
}

export function UnderlineTabs<T extends string | number>({
  items,
  value,
  onChange,
  ariaLabel,
  idPrefix,
  fill = false,
  variant = 'underline',
  className = '',
}: UnderlineTabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAt = (idx: number, focusElement = false) => {
    const target = items[idx];
    if (!target) return;
    onChange(target.value);
    const btn = tabRefs.current[idx];
    if (btn) {
      if (focusElement) {
        btn.focus();
      }
      btn.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        container: 'nearest',
      } as ScrollIntoViewOptions);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (
      typeof HTMLElement !== 'undefined' &&
      Object.hasOwn(HTMLElement.prototype, 'focusGroup')
    ) {
      return;
    }
    if (items.length === 0) return;

    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft')
      nextIdx = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = items.length - 1;

    if (nextIdx >= 0) {
      e.preventDefault();
      selectAt(nextIdx, true);
    }
  };

  const isSegmented = variant === 'segmented';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={
        isSegmented
          ? `inline-flex items-center p-0.5 rounded-xl bg-surface-raised border border-border-subtle ${className}`.trim()
          : `mwg-tablist ${className}`.trim()
      }
      {...({ focusgroup: 'tablist nomemory' } as Record<string, unknown>)}
    >
      {items.map((item, idx) => {
        const active = item.value === value;
        const resolvedId =
          item.id ?? (idPrefix ? `${idPrefix}-${String(item.value)}` : undefined);

        return (
          <button
            key={String(item.value)}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            id={resolvedId}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => selectAt(idx, false)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={
              isSegmented
                ? `min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    active
                      ? 'bg-surface-sheet text-ink-primary border border-border-subtle shadow-[0_1px_2px_rgb(17_18_31/0.08)]'
                      : 'text-ink-muted hover:text-ink-primary border border-transparent'
                  }`
                : `mwg-tab ${fill ? 'mwg-tab-fill' : ''}`.trim()
            }
            {...(active ? ({ focusgroupstart: '' } as Record<string, unknown>) : {})}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  size?: 'xs' | 'sm';
  surface?: 'raised' | 'sheet';
  className?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
  surface = 'raised',
  className = '',
}: SegmentedControlProps<T>) {
  const isXs = size === 'xs';
  const containerBg =
    surface === 'sheet'
      ? 'bg-surface-sheet border-border-subtle'
      : 'bg-surface-raised border-border-subtle';

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 p-0.5 max-w-full overflow-x-auto ink-thin-scrollbar ${
        isXs ? 'rounded-lg' : 'rounded-xl'
      } border ${containerBg} ${className}`.trim()}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`${
              isXs
                ? 'min-h-8 sm:min-h-6 px-2.5 sm:px-2 py-0.5 rounded-md'
                : 'min-h-7 px-2.5 py-1 rounded-lg'
            } text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              active
                ? surface === 'sheet'
                  ? 'font-semibold bg-action-subtle text-link-ink'
                  : 'font-semibold bg-surface-sheet text-ink-primary border border-border-subtle'
                : 'text-ink-muted hover:text-ink-primary border border-transparent'
            }`}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
