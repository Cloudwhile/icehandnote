/*
 * Decoupled Studio Topbar (`StudioPage` Zone 1):
 * Reuses shared navigation primitives (`<SiteBrand>`, `<SearchTriggerButton>`,
 * `<LocaleSwitcher>`, `<ThemeToggleButton>`, `<UserAccountMenu>`).
 */

import { type LocalePreference, UI_COPY } from '../../lib/i18n';
import type { ResolvedTheme } from '../../lib/theme';
import type {
  LocaleCode,
  SiteSettingsDto,
  UserProfileDto,
} from '../../lib/types';
import { LocaleSwitcher } from '../navigation/LocaleSwitcher';
import { SearchTriggerButton } from '../navigation/SearchTriggerButton';
import { SiteBrand } from '../navigation/SiteBrand';
import { ThemeToggleButton } from '../navigation/ThemeToggleButton';
import { UserAccountMenu } from '../navigation/UserAccountMenu';
import { IconMenu, IconSidebarToggle } from '../ui/Icons';

export interface StudioTopbarProps {
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  user: UserProfileDto;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
  mobileDrawerOpen: boolean;
  onOpenMobileDrawer: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebarCollapsed: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function StudioTopbar({
  locale,
  localePref,
  onChangeLocalePref,
  theme,
  onToggleTheme,
  onOpenSearch,
  user,
  siteSettings,
  settingsReady = true,
  mobileDrawerOpen,
  onOpenMobileDrawer,
  sidebarCollapsed,
  onToggleSidebarCollapsed,
  onOpenProfile,
  onLogout,
}: StudioTopbarProps) {
  const s = UI_COPY[locale].studio;

  return (
    <header className="studio-topbar">
      {/* Left: Mobile Drawer Trigger + Brand + Desktop Sidebar Collapse */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          aria-label={s.openNavAria}
          aria-expanded={mobileDrawerOpen}
          aria-controls="studio-sidebar-drawer"
          onClick={onOpenMobileDrawer}
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 ink-icon-target rounded-lg bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer shrink-0 transition-colors"
        >
          <IconMenu className="w-4 h-4" />
        </button>

        <SiteBrand
          locale={locale}
          siteSettings={siteSettings}
          settingsReady={settingsReady}
          title={s.backHomeTitle}
          size="sm"
          hideNameOnMobile
          nameMaxWidthClass="max-w-36"
        />

        <button
          type="button"
          aria-label={sidebarCollapsed ? s.expandSidebarAria : s.collapseSidebarAria}
          title={sidebarCollapsed ? s.expandSidebarAria : s.collapseSidebarAria}
          onClick={onToggleSidebarCollapsed}
          className="hidden lg:inline-flex items-center justify-center w-9 h-9 ink-icon-target rounded-lg bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer shrink-0 transition-colors"
        >
          <IconSidebarToggle className="w-4 h-4" />
        </button>
      </div>

      {/* Right: Search + Locale + Theme + Account */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <SearchTriggerButton
          locale={locale}
          onOpenSearch={onOpenSearch}
          radiusClass="rounded-lg"
          boxedShortcut={false}
        />

        <LocaleSwitcher
          locale={locale}
          localePref={localePref}
          onChangeLocalePref={onChangeLocalePref}
          siteSettings={siteSettings}
          compactOnMobile
          triggerRadiusClass="rounded-lg"
        />

        <ThemeToggleButton
          locale={locale}
          theme={theme}
          onToggleTheme={onToggleTheme}
          radiusClass="rounded-lg"
        />

        <UserAccountMenu
          locale={locale}
          user={user}
          context="studio"
          onOpenProfile={onOpenProfile}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
}
