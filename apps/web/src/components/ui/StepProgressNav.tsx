/*
 * Accessible Multi-Step Form Progress Tracker (`modern-web-guidance/forms` §11):
 * Marks the active wizard step programmatically via `aria-current="step"`.
 */

import { IconCheck } from './Icons';

export interface StepProgressNavProps {
  steps: readonly string[];
  activeIndex: number;
  ariaLabel: string;
  className?: string;
}

export function StepProgressNav({
  steps,
  activeIndex,
  ariaLabel,
  className = 'mb-6',
}: StepProgressNavProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <ol
        className="grid gap-2 sm:flex sm:items-center list-none m-0 p-0"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((label, idx) => {
          const done = idx < activeIndex;
          const active = idx === activeIndex;
          return (
            <li
              key={label}
              aria-current={active ? 'step' : undefined}
              className="flex flex-col items-center text-center gap-1 sm:flex-row sm:text-start sm:gap-2 min-w-0 sm:flex-1 sm:last:flex-initial"
            >
              <div className="flex flex-col items-center gap-1 sm:flex-row sm:items-center sm:gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-mono shrink-0 transition-colors ${
                    active
                      ? 'bg-action-bg text-action-fg font-semibold'
                      : done
                        ? 'bg-accent-success text-action-fg'
                        : 'bg-surface-raised border border-border-subtle text-ink-muted'
                  }`}
                >
                  {done ? <IconCheck className="w-3.5 h-3.5" /> : idx + 1}
                </span>
                <span
                  className={`text-xs leading-snug sm:truncate ${
                    active
                      ? 'font-semibold text-ink-primary'
                      : done
                        ? 'font-semibold text-ink-secondary'
                        : 'text-ink-muted'
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`hidden sm:block h-px flex-1 min-w-3 border-t border-dashed ${
                    done ? 'border-accent-success' : 'border-border-subtle'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
