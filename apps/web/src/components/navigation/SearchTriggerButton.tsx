/*
 * Unified Command Search Trigger Button (`TopNavbar` & `StudioTopbar`).
 */

import { UI_COPY } from '../../lib/i18n';
import type { LocaleCode } from '../../lib/types';
import { IconSearch } from '../ui/Icons';

export interface SearchTriggerButtonProps {
  locale: LocaleCode;
  onOpenSearch: () => void;
  radiusClass?: string;
  boxedShortcut?: boolean;
}

export function SearchTriggerButton({
  locale,
  onOpenSearch,
  radiusClass = 'rounded-xl',
  boxedShortcut = true,
}: SearchTriggerButtonProps) {
  const copy = UI_COPY[locale];

  return (
    <button
      type="button"
      onClick={onOpenSearch}
      aria-label={copy.searchTrigger}
      className={`min-h-8 px-2.5 py-1.5 ${radiusClass} text-xs bg-surface-raised text-ink-secondary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1.5 cursor-pointer transition-colors`}
    >
      <IconSearch className="w-3.5 h-3.5 text-ink-muted" />
      <kbd
        className={
          boxedShortcut
            ? 'hidden sm:inline font-mono text-xs px-1.5 py-0.5 rounded bg-surface-sheet border border-border-subtle text-ink-muted'
            : 'hidden sm:inline font-mono text-xs text-ink-muted'
        }
      >
        ⌘K
      </kbd>
    </button>
  );
}
