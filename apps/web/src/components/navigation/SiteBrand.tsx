/*
 * Unified Site Brand Mark & Name (`TopNavbar`, `StudioTopbar`, `AuthFlowPage`):
 * - Prevents flashing the default Snowflake icon or `'IceHandnote'` placeholder before `settingsReady` is true.
 * - Gracefully recovers to the 2-tone Snowflake mark if a custom `logo_url` fails to load.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UI_COPY } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { LocaleCode, SiteSettingsDto } from '../../lib/types';
import { toSafeMediaUrl } from '../../lib/urlSafety';

export interface SiteBrandProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
  to?: string;
  title?: string;
  size?: 'sm' | 'md';
  showBadge?: boolean;
  hideNameOnMobile?: boolean;
  nameMaxWidthClass?: string;
  surfaceClass?: string;
}

export function BrandSnowflakeSvg({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent-ice-ink)"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07" />
      <circle cx="12" cy="12" r="2.2" fill="var(--link-ink)" stroke="none" />
    </svg>
  );
}

export function SiteBrand({
  locale,
  siteSettings,
  settingsReady = true,
  to,
  title,
  size = 'md',
  showBadge = false,
  hideNameOnMobile = false,
  nameMaxWidthClass = '',
  surfaceClass = 'bg-surface-raised',
}: SiteBrandProps) {
  const copy = UI_COPY[locale];
  const logoUrl = toSafeMediaUrl(siteSettings.logo_url);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  const boxSizeCls = size === 'sm' ? 'w-7 h-7 rounded-lg' : 'w-8 h-8 rounded-xl';
  const svgSizeCls = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const textSizeCls = size === 'sm' ? 'text-sm' : 'text-sm sm:text-base';
  const resolvedNameHtml = siteSettings.site_name || copy.brandName;

  const content = (
    <>
      <span
        aria-hidden="true"
        className={`${boxSizeCls} flex items-center justify-center border border-border-ink ${surfaceClass} overflow-hidden shrink-0`}
      >
        {!settingsReady ? (
          <span className="w-full h-full bg-surface-raised motion-safe:animate-pulse" />
        ) : logoUrl && !logoFailed ? (
          <img
            src={logoUrl}
            alt=""
            onError={() => setLogoFailed(true)}
            className="w-full h-full object-contain p-0.5"
          />
        ) : (
          <BrandSnowflakeSvg className={svgSizeCls} />
        )}
      </span>

      <span
        className={`${
          hideNameOnMobile ? 'hidden sm:inline-flex' : 'inline-flex'
        } items-baseline gap-1.5 leading-tight min-w-0`}
      >
        {!settingsReady ? (
          <span
            aria-hidden="true"
            className="inline-block w-24 h-4 rounded bg-surface-raised motion-safe:animate-pulse"
          />
        ) : (
          <>
            <SafeHtml
              as="span"
              html={resolvedNameHtml}
              linkVariant="chrome"
              className={`${textSizeCls} font-semibold tracking-tight ${
                nameMaxWidthClass ? `studio-ellipsis ${nameMaxWidthClass}` : 'truncate'
              }`}
            />
            {showBadge && siteSettings.brand_badge && (
              <SafeHtml
                as="span"
                html={siteSettings.brand_badge}
                linkVariant="chrome"
                className="font-mono text-xs font-semibold uppercase tracking-wider text-accent-ice hidden sm:inline shrink-0"
              />
            )}
          </>
        )}
      </span>
    </>
  );

  const targetHref = to ?? `/${locale}`;

  return (
    <Link
      to={targetHref}
      title={title}
      className="inline-flex items-center gap-2 sm:gap-2.5 no-underline text-ink-primary min-w-0 shrink"
    >
      {content}
    </Link>
  );
}
