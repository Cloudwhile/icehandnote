/*
 * Refactoring UI & Modern Web Guidance (`navbar`, `menu`) Constraint Brief:
 * - Visual & interaction parity with Studio Dashboard topbar:
 *   Unified `<PopupMenu>` Language Dropdown (with `Follow System` + enabled locales) and
 *   unified Account Dropdown (`Admin ▾`), replacing sprawled flat pill buttons.
 * - Single-row compact sticky header on both mobile (375px) and desktop (1280px+).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  detectSystemLocale,
  LOCALES,
  type LocalePreference,
  UI_COPY,
} from '../../lib/i18n';
import { RC3_COPY } from '../../lib/i18nRc3';
import { SafeHtml } from '../../lib/sanitizer';
import type { ResolvedTheme } from '../../lib/theme';
import type { LocaleCode, SiteSettingsDto, UserProfileDto } from '../../lib/types';
import {
  IconClose,
  IconGlobe,
  IconLogOut,
  IconMenu,
  IconMoon,
  IconPen,
  IconSearch,
  IconSettings,
  IconSun,
} from '../ui/Icons';
import { PopupMenu } from '../ui/PopupMenu';
import { UserAvatar } from '../ui/UserAvatar';

interface TopNavbarProps {
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  user: UserProfileDto | null;
  siteSettings: SiteSettingsDto;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function TopNavbar({
  locale,
  localePref,
  onChangeLocalePref,
  theme,
  onToggleTheme,
  onOpenSearch,
  user,
  siteSettings,
  onOpenAuth,
  onOpenProfile,
  onLogout,
}: TopNavbarProps) {
  const copy = UI_COPY[locale];
  const profCopy = RC3_COPY[locale].profile;
  const visibleLocales = LOCALES.filter((l) =>
    siteSettings.enabled_locales.includes(l.code),
  );
  const localesToRender = visibleLocales.length > 0 ? visibleLocales : LOCALES;
  const systemResolvedLocale = detectSystemLocale(
    siteSettings.enabled_locales,
    siteSettings.default_locale,
  );
  const systemShortLabel =
    LOCALES.find((l) => l.code === systemResolvedLocale)?.short ??
    systemResolvedLocale;
  const activeLocaleShort =
    LOCALES.find((l) => l.code === locale)?.short ?? locale;

  const showBlogLink = Boolean(
    siteSettings.blog_origin_url.trim() && siteSettings.blog_nav_label.trim(),
  );
  const location = useLocation();
  const mobileMenuId = useId();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const isHome =
    location.pathname === `/${locale}` || location.pathname === `/${locale}/`;
  const isStudio = location.pathname.startsWith(`/${locale}/studio`);
  const canAuthor = Boolean(user && (user.role === 'author' || user.role === 'admin'));

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, locale]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(target) &&
        menuTriggerRef.current &&
        !menuTriggerRef.current.contains(target)
      ) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [mobileMenuOpen]);

  return (
    <header className="w-full sticky top-3 z-30 px-3 sm:px-6">
      <div className="max-w-6xl mx-auto relative">
        <div
          className="rounded-2xl bg-surface-sheet/95 backdrop-blur px-3.5 sm:px-5 py-2 flex items-center justify-between gap-2.5"
          style={{
            border: '2px solid var(--border-ink)',
            boxShadow: 'var(--shadow-control)',
          }}
        >
          {/* Left: Snowflake Brand Mark + Desktop Primary Navigation Landmark */}
          <div className="flex items-center gap-4 min-w-0">
            <Link
              to={`/${locale}`}
              className="inline-flex items-center gap-2.5 no-underline text-ink-primary shrink-0"
            >
              <span
                aria-hidden="true"
                className="w-8 h-8 rounded-xl flex items-center justify-center border border-border-ink bg-surface-raised overflow-hidden shrink-0"
              >
                {siteSettings.logo_url?.trim() ? (
                  <img
                    src={siteSettings.logo_url}
                    alt=""
                    className="w-full h-full object-contain p-0.5"
                  />
                ) : (
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-ice-ink)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07" />
                    <circle cx="12" cy="12" r="2.2" fill="var(--link-ink)" stroke="none" />
                  </svg>
                )}
              </span>
              <div className="leading-tight">
                <div className="text-base font-semibold tracking-tight flex items-baseline gap-1.5">
                  <SafeHtml as="span" html={siteSettings.site_name || copy.brandName} />
                  {siteSettings.brand_badge && (
                    <SafeHtml
                      as="span"
                      html={siteSettings.brand_badge}
                      className="font-mono text-xs font-semibold uppercase tracking-wider text-accent-ice hidden sm:inline"
                    />
                  )}
                </div>
              </div>
            </Link>

            <nav aria-label={copy.navPrimaryAria} className="hidden md:flex items-center gap-2 text-sm">
              <Link
                to={`/${locale}`}
                aria-current={isHome ? 'page' : undefined}
                className={`no-underline px-2.5 py-1.5 rounded-lg transition-colors ${
                  isHome
                    ? 'font-semibold text-ink-primary border-b-2 border-action-bg'
                    : 'text-ink-muted hover:text-ink-primary'
                }`}
              >
                {copy.navHome}
              </Link>

              {canAuthor && (
                <Link
                  to={`/${locale}/studio`}
                  aria-current={isStudio ? 'page' : undefined}
                  className={`no-underline px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                    isStudio
                      ? 'font-semibold text-ink-primary border-b-2 border-accent-ice'
                      : 'text-ink-muted hover:text-ink-primary'
                  }`}
                >
                  <IconPen className="w-3.5 h-3.5 text-ink-muted" />
                  <span>{copy.navStudio}</span>
                </Link>
              )}

              {showBlogLink && (
                <a
                  href={siteSettings.blog_origin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="no-underline text-ink-muted hover:text-ink-primary px-2.5 py-1.5 text-sm transition-colors hidden xl:inline"
                >
                  {siteSettings.blog_nav_label} ↗
                </a>
              )}
            </nav>
          </div>

          {/* Right: Consistent Controls matching Studio Dashboard (Search + Locale Dropdown + Theme + Account Dropdown) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label={copy.searchTrigger}
              className="min-h-8 px-2.5 py-1.5 rounded-xl text-xs bg-surface-raised text-ink-secondary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <IconSearch className="w-3.5 h-3.5 text-ink-muted" />
              <kbd className="hidden sm:inline font-mono text-xs px-1.5 py-0.5 rounded bg-surface-sheet border border-border-subtle text-ink-muted">
                ⌘K
              </kbd>
            </button>

            {/* Unified Language Dropdown Menu (identical pattern to Studio Dashboard) */}
            {localesToRender.length > 1 && (
              <div className="hidden md:block">
                <PopupMenu
                  align="end"
                  triggerAriaLabel={copy.navLanguageAria}
                  triggerTitle={copy.navLanguageAria}
                  triggerClassName="min-h-8 px-2.5 py-1 rounded-xl text-xs bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink"
                  triggerLabel={
                    <>
                      <IconGlobe className="w-3.5 h-3.5 text-ink-muted" />
                      <span className="font-semibold">{activeLocaleShort}</span>
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
              </div>
            )}

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={
                theme === 'dark' ? copy.themeLightLabel : copy.themeDarkLabel
              }
              title={
                theme === 'dark' ? copy.themeLightLabel : copy.themeDarkLabel
              }
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink inline-flex items-center justify-center cursor-pointer transition-colors"
            >
              {theme === 'dark' ? (
                <IconSun className="w-4 h-4 text-accent-amber" />
              ) : (
                <IconMoon className="w-4 h-4 text-ink-secondary" />
              )}
            </button>

            {/* Desktop Account Dropdown (identical pattern to Studio Dashboard) or Sign In button */}
            <div className="hidden md:flex items-center">
              {user ? (
                <PopupMenu
                  align="end"
                  triggerAriaLabel={user.display_name}
                  triggerClassName="min-h-8 ps-1.5 pe-2.5 py-1 rounded-full bg-surface-raised border border-border-subtle hover:border-border-ink text-xs"
                  triggerLabel={
                    <>
                      <UserAvatar
                        name={user.display_name}
                        avatarUrl={user.avatar_url}
                        sizeClass="w-5 h-5"
                      />
                      <span className="font-semibold text-ink-primary max-w-24 studio-ellipsis">
                        {user.display_name}
                      </span>
                    </>
                  }
                >
                  {({ close }) => (
                    <>
                      <div className="ink-menu-header">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-ink-primary studio-ellipsis">
                            {user.display_name}
                          </span>
                          <span
                            className="font-mono text-xs uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold shrink-0"
                            style={{
                              backgroundColor: 'var(--alert-note-badge-bg)',
                              color: 'var(--alert-note-badge-fg)',
                            }}
                          >
                            {user.role}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          close(e.detail !== 0);
                          onOpenProfile();
                        }}
                      >
                        <IconSettings className="w-3.5 h-3.5 text-ink-muted" />
                        <span>{profCopy.menuItem}</span>
                      </button>

                      {canAuthor && (
                        <Link
                          to={`/${locale}/studio`}
                          onClick={() => close(true)}
                        >
                          <IconPen className="w-3.5 h-3.5 text-ink-muted" />
                          <span>{copy.navStudio}</span>
                        </Link>
                      )}

                      <button
                        type="button"
                        data-tone="danger"
                        onClick={(e) => {
                          close(e.detail !== 0);
                          onLogout();
                        }}
                      >
                        <IconLogOut className="w-3.5 h-3.5" />
                        <span>{copy.logoutBtn}</span>
                      </button>
                    </>
                  )}
                </PopupMenu>
              ) : (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="min-h-8 px-3.5 py-1.5 rounded-full text-xs font-semibold ink-btn-secondary cursor-pointer inline-flex items-center gap-1.5"
                >
                  <span>{copy.loginPassportBtn}</span>
                </button>
              )}
            </div>

            {/* Mobile Compact Menu Trigger (< md) */}
            <button
              ref={menuTriggerRef}
              type="button"
              aria-expanded={mobileMenuOpen}
              aria-controls={mobileMenuId}
              aria-label={copy.navMenuAria}
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden w-8 h-8 rounded-xl bg-surface-raised border border-border-subtle hover:border-border-ink inline-flex items-center justify-center cursor-pointer"
            >
              {mobileMenuOpen ? (
                <IconClose className="w-4 h-4 text-ink-primary" />
              ) : (
                <IconMenu className="w-4 h-4 text-ink-primary" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Popover Navigation & Language Sheet */}
        {mobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            id={mobileMenuId}
            role="region"
            aria-label={copy.navPrimaryAria}
            className="ui-popover-enter origin-top-right md:hidden absolute end-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl bg-surface-sheet p-4 space-y-4 ink-surface-floating z-40"
          >
            <nav aria-label={copy.navPrimaryAria} className="space-y-1">
              <Link
                to={`/${locale}`}
                aria-current={isHome ? 'page' : undefined}
                className={`block no-underline px-3 py-2 rounded-lg text-sm ${
                  isHome
                    ? 'font-semibold bg-action-subtle text-ink-primary'
                    : 'text-ink-secondary hover:bg-surface-raised hover:text-ink-primary'
                }`}
              >
                {copy.navHome}
              </Link>
              {canAuthor && (
                <Link
                  to={`/${locale}/studio`}
                  aria-current={isStudio ? 'page' : undefined}
                  className={`flex items-center gap-2 no-underline px-3 py-2 rounded-lg text-sm ${
                    isStudio
                      ? 'font-semibold bg-action-subtle text-ink-primary'
                      : 'text-ink-secondary hover:bg-surface-raised hover:text-ink-primary'
                  }`}
                >
                  <IconPen className="w-4 h-4 text-ink-muted" />
                  <span>{copy.navStudio}</span>
                </Link>
              )}
              {showBlogLink && (
                <a
                  href={siteSettings.blog_origin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block no-underline px-3 py-2 rounded-lg text-sm text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
                >
                  {siteSettings.blog_nav_label} ↗
                </a>
              )}
            </nav>

            {localesToRender.length > 1 && (
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
                  className="grid grid-cols-4 gap-1 rounded-xl p-1 bg-surface-raised border border-border-subtle"
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
            )}

            <div className="pt-3 border-t border-dashed border-border-subtle">
              {user ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 min-w-0">
                      <UserAvatar
                        name={user.display_name}
                        avatarUrl={user.avatar_url}
                        sizeClass="w-6 h-6"
                      />
                      <span className="text-sm font-semibold text-ink-primary truncate">
                        {user.display_name}
                      </span>
                      <span
                        className="font-mono text-xs uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold shrink-0"
                        style={{
                          backgroundColor: 'var(--alert-note-badge-bg)',
                          color: 'var(--alert-note-badge-fg)',
                        }}
                      >
                        {user.role}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onOpenProfile();
                      }}
                      className="flex-1 min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer"
                    >
                      {profCopy.menuItem}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onLogout();
                      }}
                      className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer shrink-0"
                    >
                      {copy.logoutBtn}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenAuth();
                  }}
                  className="w-full min-h-10 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer"
                >
                  {copy.loginPassportBtn}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
