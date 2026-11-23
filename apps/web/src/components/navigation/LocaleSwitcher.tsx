/*
 * Unified Locale Switcher (`TopNavbar`, `StudioTopbar`, `AuthFlowPage`, Mobile Nav Sheet):
 * - `variant="dropdown"`: `<PopupMenu>` with "Follow System (short)" + `enabled_locales` radio items.
 * - `variant="inline"`: Compact segmented grid + Follow System pill for mobile navigation sheets.
 */

import {
  detectSystemLocale,
  getEnabledLocaleMetas,
  LOCALES,
  type LocalePreference,
  UI_COPY,
} from '../../lib/i18n';
import type { LocaleCode, SiteSettingsDto } from '../../lib/types';
import { IconGlobe } from '../ui/Icons';
import { PopupMenu } from '../ui/PopupMenu';

export interface LocaleSwitcherProps {
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  siteSettings: SiteSettingsDto;
  variant?: 'dropdown' | 'inline';
  compactOnMobile?: boolean;
  surfaceClass?: string;
  triggerRadiusClass?: string;
}

export function LocaleSwitcher({
  locale,
  localePref,
  onChangeLocalePref,
  siteSettings,
  variant = 'dropdown',
  compactOnMobile = false,
  surfaceClass = 'bg-surface-raised',
  triggerRadiusClass = 'rounded-xl',
}: LocaleSwitcherProps) {
  const copy = UI_COPY[locale];
  const localesToRender = getEnabledLocaleMetas(siteSettings.enabled_locales);

  if (localesToRender.length <= 1) {
    return null;
  }

  const systemResolvedLocale = detectSystemLocale(
    siteSettings.enabled_locales,
    siteSettings.default_locale,
  );
  const systemShortLabel =
    LOCALES.find((l) => l.code === systemResolvedLocale)?.short ??
    systemResolvedLocale;
  const activeLocaleShort =
    LOCALES.find((l) => l.code === locale)?.short ?? locale;

  if (variant === 'inline') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-ink-muted">
          <span>{copy.navLanguageAria}</span>
          <button
            type="button"
            aria-pressed={localePref === 'auto'}
            onClick={() => onChangeLocalePref('auto')}
            className={`min-h-7 px-2 py-0.5 rounded-lg text-xs cursor-pointer transition-colors ${
              localePref === 'auto'
                ? 'font-semibold bg-action-subtle text-link-ink'
                : 'text-ink-muted hover:text-ink-primary'
            }`}
          >
            {copy.followSystemLocale}
          </button>
        </div>
        <div
          role="group"
          aria-label={copy.navLanguageAria}
          className="grid grid-cols-[repeat(auto-fit,minmax(4rem,1fr))] gap-1 rounded-xl p-1 bg-surface-raised border border-border-subtle"
        >
          {localesToRender.map((item) => {
            const active = localePref === item.code;
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => onChangeLocalePref(item.code)}
                aria-pressed={active}
                className={`min-h-8 py-1 rounded-lg text-xs cursor-pointer transition-colors ${
                  active
                    ? 'font-semibold bg-surface-sheet text-ink-primary border border-border-subtle'
                    : 'text-ink-muted hover:text-ink-primary'
                }`}
              >
                {item.short}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <PopupMenu
      align="end"
      triggerAriaLabel={copy.navLanguageAria}
      triggerTitle={copy.navLanguageAria}
      triggerClassName={`min-h-8 px-2.5 py-1 ${triggerRadiusClass} text-xs ${surfaceClass} text-ink-primary border border-border-subtle hover:border-border-ink`}
      triggerLabel={
        <>
          <IconGlobe className="w-3.5 h-3.5 text-ink-muted" />
          <span
            className={`${compactOnMobile ? 'hidden sm:inline' : ''} font-semibold`.trim()}
          >
            {activeLocaleShort}
          </span>
        </>
      }
    >
      {({ close }) => (
        <div role="group" aria-label={copy.navLanguageAria}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={localePref === 'auto'}
            onClick={(e) => {
              onChangeLocalePref('auto');
              close(e.detail !== 0);
            }}
          >
            <span className="flex-1">{copy.followSystemLocale}</span>
            <span className="ink-menu-hint">{systemShortLabel}</span>
          </button>
          <hr />
          {localesToRender.map((item) => {
            const active = localePref === item.code;
            return (
              <button
                key={item.code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={(e) => {
                  onChangeLocalePref(item.code);
                  close(e.detail !== 0);
                }}
              >
                <span className="flex-1">{item.label}</span>
                <span className="ink-menu-hint">{item.code}</span>
              </button>
            );
          })}
        </div>
      )}
    </PopupMenu>
  );
}
