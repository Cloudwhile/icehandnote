/*
 * Shared Public Site Footer rendered consistently across Home, Reader, and 404 views.
 * - Anchored cleanly at page bottom via `mt-auto` inside the `min-h-svh flex flex-col` shell.
 * - Calm, low-noise typography (`--ink-muted`) with subtle divider border.
 */

import { Link } from 'react-router-dom';
import { UI_COPY } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { LocaleCode, SiteSettingsDto } from '../../lib/types';

interface SiteFooterProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
}

export function SiteFooter({ locale, siteSettings }: SiteFooterProps) {
  const copy = UI_COPY[locale];
  const showBlogLink = Boolean(
    siteSettings.blog_origin_url.trim() && siteSettings.blog_nav_label.trim(),
  );

  return (
    <footer className="mt-auto w-full px-4 sm:px-6 pb-20 lg:pb-10">
      <div className="max-w-6xl mx-auto pt-6 border-t border-border-subtle flex flex-wrap items-baseline justify-between gap-4 text-xs text-ink-muted">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/Cloudwhile/icehandnote"
            target="_blank"
            rel="noopener noreferrer"
            className="font-hand text-sm font-semibold text-ink-secondary hover:text-link-ink no-underline inline-flex items-baseline gap-1 transition-colors"
          >
            <span>Cloudwhile</span>
            <span className="font-mono text-xs text-ink-muted">AGPL-3.0</span>
          </a>
        </div>

        <nav aria-label={copy.navPrimaryAria} className="flex flex-wrap items-center gap-4">
          <Link
            to={`/${locale}`}
            className="no-underline text-ink-muted hover:text-ink-primary transition-colors"
          >
            {copy.navHome}
          </Link>
          {showBlogLink && (
            <a
              href={siteSettings.blog_origin_url}
              target="_blank"
              rel="noreferrer"
              className="no-underline text-ink-muted hover:text-ink-primary transition-colors"
            >
              {siteSettings.blog_nav_label} ↗
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
