/*
 * Shared Public Site Footer rendered consistently across Home, Reader, and 404 views.
 * - Anchored cleanly at page bottom via `mt-auto` inside the `min-h-svh flex flex-col` shell.
 * - Never flashes `'IceHandnote · © IceHandnote · CC BY-NC-SA 4.0'` before `settingsReady` resolves.
 */

import { Link } from 'react-router-dom';
import { UI_COPY } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { LocaleCode, SiteSettingsDto } from '../../lib/types';

interface SiteFooterProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
}

export function SiteFooter({
  locale,
  siteSettings,
  settingsReady = true,
}: SiteFooterProps) {
  const copy = UI_COPY[locale];
  const showBlogLink = Boolean(
    settingsReady &&
      siteSettings.blog_origin_url.trim() &&
      siteSettings.blog_nav_label.trim(),
  );

  return (
    <footer className="mt-auto w-full px-4 sm:px-6 pb-20 lg:pb-10">
      <div className="max-w-6xl mx-auto pt-6 border-t border-border-subtle flex flex-wrap items-center justify-between gap-4 text-xs text-ink-muted">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-y-1 sm:gap-x-3">
          {!settingsReady ? (
            <span
              aria-hidden="true"
              className="inline-block w-44 h-4 rounded bg-surface-raised animate-pulse"
            />
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <SafeHtml
                as="span"
                html={siteSettings.site_name || copy.brandName}
                className="font-semibold text-ink-secondary"
              />
              {siteSettings.footer_text && (
                <>
                  <span aria-hidden="true">·</span>
                  <SafeHtml as="span" html={siteSettings.footer_text} />
                </>
              )}
            </div>
          )}
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <a
            href="https://github.com/Cloudwhile/icehandnote"
            target="_blank"
            rel="noopener noreferrer"
            className="font-hand text-sm font-semibold text-ink-secondary hover:text-link-ink no-underline inline-flex items-center gap-1 min-h-7 px-1 rounded transition-colors"
          >
            <span>Cloudwhile</span>
            <span className="font-mono text-xs text-ink-muted">AGPL-3.0</span>
          </a>
        </div>

        <nav aria-label={copy.navPrimaryAria} className="flex flex-wrap items-center gap-3">
          <Link
            to={`/${locale}`}
            className="inline-flex items-center min-h-7 px-1.5 rounded no-underline text-ink-muted hover:text-ink-primary transition-colors"
          >
            {copy.navHome}
          </Link>
          {showBlogLink && (
            <a
              href={siteSettings.blog_origin_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center min-h-7 px-1.5 rounded no-underline text-ink-muted hover:text-ink-primary transition-colors"
            >
              {siteSettings.blog_nav_label}
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
