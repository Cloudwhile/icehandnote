/*
 * Unified Dark/Light Theme Toggle Button (`TopNavbar`, `StudioTopbar`, `AuthFlowPage`).
 */

import { UI_COPY } from '../../lib/i18n';
import type { ResolvedTheme } from '../../lib/theme';
import type { LocaleCode } from '../../lib/types';
import { IconMoon, IconSun } from '../ui/Icons';

export interface ThemeToggleButtonProps {
  locale: LocaleCode;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  sizeClass?: string;
  radiusClass?: string;
  surfaceClass?: string;
}

export function ThemeToggleButton({
  locale,
  theme,
  onToggleTheme,
  sizeClass = 'w-8 h-8',
  radiusClass = 'rounded-xl',
  surfaceClass = 'bg-surface-raised',
}: ThemeToggleButtonProps) {
  const copy = UI_COPY[locale];
  const label = theme === 'dark' ? copy.themeLightLabel : copy.themeDarkLabel;

  return (
    <button
      type="button"
      onClick={onToggleTheme}
      aria-label={label}
      title={label}
      className={`${sizeClass} ${radiusClass} text-xs font-semibold ${surfaceClass} border border-border-subtle hover:border-border-ink inline-flex items-center justify-center cursor-pointer transition-colors`}
    >
      {theme === 'dark' ? (
        <IconSun className="w-4 h-4 text-accent-amber" />
      ) : (
        <IconMoon className="w-4 h-4 text-ink-secondary" />
      )}
    </button>
  );
}
