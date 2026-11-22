/*
 * Refactoring UI & Modern Web Guidance (`navbar`, `menu`) Constraint Brief:
 * - Composes shared `<SiteBrand>`, `<SearchTriggerButton>`, `<LocaleSwitcher>`,
 *   `<ThemeToggleButton>`, `<UserAccountMenu>`, and `<StatusBadge>`.
 * - Single-row compact sticky header on both mobile (375px) and desktop (1280px+).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EXT_COPY, type LocalePreference, UI_COPY } from '../../lib/i18n';
import type { ResolvedTheme } from '../../lib/theme';
import type { LocaleCode, SiteSettingsDto, UserProfileDto } from '../../lib/types';
import { IconBook, IconClose, IconMenu, IconPen } from '../ui/Icons';
import { StatusBadge } from '../ui/StatusBadge';
import { UserAvatar } from '../ui/UserAvatar';
import { LocaleSwitcher } from './LocaleSwitcher';
import { SearchTriggerButton } from './SearchTriggerButton';
import { SiteBrand } from './SiteBrand';
import { ThemeToggleButton } from './ThemeToggleButton';
import { UserAccountMenu } from './UserAccountMenu';

interface TopNavbarProps {
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenNotes?: () => void;
  user: UserProfileDto | null;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
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
  onOpenNotes,
  user,
  siteSettings,
  settingsReady = true,
  onOpenAuth,
  onOpenProfile,
  onLogout,
}: TopNavbarProps) {
  const copy = UI_COPY[locale];
  const profCopy = EXT_COPY[locale].profile;
  const notesCopy = EXT_COPY[locale].notes;

  const showBlogLink = Boolean(
    settingsReady &&
      siteSettings.blog_origin_url.trim() &&
      siteSettings.blog_nav_label.trim(),
  );
  const location = useLocation();
  const mobileMenuId = useId();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const isHome =
    location.pathname === `/${locale}` || location.pathname === `/${locale}/`;
  const isStudio = location.pathname.startsWith(`/${locale}/studio`);
  const canAuthor = Boolean(
    user &&
      (user.role === 'author' ||
        user.role === 'admin' ||
        user.has_collaborations),
  );

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
    const onPointerDown = (e: PointerEvent) => {
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
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [mobileMenuOpen]);

  return (
    <header
      className="w-full sticky top-0 z-30 pt-3 px-3 sm:px-6"
      style={{
        background:
          'linear-gradient(to bottom, var(--surface-page) 62%, transparent)',
      }}
    >
      <div className="max-w-6xl mx-auto relative">
        <div
          className="rounded-2xl bg-surface-sheet/95 backdrop-blur px-3.5 sm:px-5 py-2 flex items-center justify-between gap-2.5"
          style={{
            border: '2px solid var(--border-ink)',
            boxShadow: 'var(--shadow-control)',
          }}
        >
          {/* Left: Shared Site Brand + Desktop Primary Navigation Landmark */}
          <div className="flex items-center gap-4 min-w-0">
            <SiteBrand
              locale={locale}
              siteSettings={siteSettings}
              settingsReady={settingsReady}
              showBadge
            />

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

              {siteSettings.enable_margin_notes && onOpenNotes && (
                <button
                  type="button"
                  onClick={onOpenNotes}
                  className="px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary transition-colors cursor-pointer"
                >
                  <IconBook className="w-3.5 h-3.5 shrink-0" />
                  <span>{notesCopy.myNotesBtn}</span>
                </button>
              )}

              {showBlogLink && (
                <a
                  href={siteSettings.blog_origin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="no-underline text-ink-muted hover:text-ink-primary px-2.5 py-1.5 rounded-lg text-sm transition-colors hidden xl:inline"
                >
                  {siteSettings.blog_nav_label}
                </a>
              )}
            </nav>
          </div>

          {/* Right: Shared Search + Locale Dropdown + Theme Toggle + Account Menu */}
          <div className="flex items-center gap-2 shrink-0">
            <SearchTriggerButton locale={locale} onOpenSearch={onOpenSearch} />

            <div className="hidden md:block">
              <LocaleSwitcher
                locale={locale}
                localePref={localePref}
                onChangeLocalePref={onChangeLocalePref}
                siteSettings={siteSettings}
              />
            </div>

            <ThemeToggleButton
              locale={locale}
              theme={theme}
              onToggleTheme={onToggleTheme}
              sizeClass="w-9 h-9"
            />

            <div className="hidden md:flex items-center">
              {user ? (
                <UserAccountMenu
                  locale={locale}
                  user={user}
                  context="public"
                  onOpenProfile={onOpenProfile}
                  onLogout={onLogout}
                />
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
              className="md:hidden w-9 h-9 ink-icon-target rounded-xl bg-surface-raised border border-border-subtle hover:border-border-ink inline-flex items-center justify-center cursor-pointer"
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
            className="ui-popover-enter origin-top-right md:hidden absolute end-0 mt-2 w-[min(20rem,calc(100dvw-1.5rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-2xl bg-surface-sheet p-4 space-y-4 ink-surface-floating z-40"
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
              {siteSettings.enable_margin_notes && onOpenNotes && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenNotes();
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-ink-secondary hover:text-ink-primary cursor-pointer transition-colors"
                >
                  <IconBook className="w-4 h-4 shrink-0" />
                  <span>{notesCopy.myNotesBtn}</span>
                </button>
              )}
              {showBlogLink && (
                <a
                  href={siteSettings.blog_origin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block no-underline px-3 py-2 rounded-lg text-sm text-ink-secondary hover:text-ink-primary"
                >
                  {siteSettings.blog_nav_label}
                </a>
              )}
            </nav>

            <LocaleSwitcher
              locale={locale}
              localePref={localePref}
              onChangeLocalePref={onChangeLocalePref}
              siteSettings={siteSettings}
              variant="inline"
            />

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
                      <StatusBadge tone="info" mono uppercase className="px-1.5">
                        {user.role}
                      </StatusBadge>
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
