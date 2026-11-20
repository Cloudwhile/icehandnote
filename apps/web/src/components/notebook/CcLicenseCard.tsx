/*
 * Hand-Drawn Stationery Creative Commons License Stamp (`CcLicenseCard`)
 * - Renders bespoke 2px ink circular CC medallions (`CC`, `BY`, `SA`, `NC`, `ND`, `0`, `©`),
 *   localized license title, optional author attribution, and semantic `rel="license"` deed link.
 */

import type { UiMessages } from '../../lib/i18n';
import {
  getLicenseDeedUrl,
  type LicenseEmblem,
  resolveEffectiveLicense,
} from '../../lib/licenses';
import type { LocaleCode } from '../../lib/types';
import { PostmarkOrnament } from './StationeryStickers';

interface CcLicenseCardProps {
  locale: LocaleCode;
  copy: UiMessages;
  stepLicense?: string | null;
  siteDefaultLicense?: string | null;
  authorName?: string | null;
  compact?: boolean;
}

function EmblemMedallion({ kind }: { kind: LicenseEmblem }) {
  return (
    <span
      aria-hidden="true"
      className="w-7 h-7 rounded-full border-[1.75px] inline-flex items-center justify-center shrink-0 select-none"
      style={{
        borderColor: 'var(--alert-kraft-border)',
        backgroundColor: 'var(--alert-kraft-badge-bg)',
        color: 'var(--alert-kraft-title)',
      }}
    >
      {kind === 'cc' && (
        <span className="font-mono text-xs font-semibold tracking-tighter leading-none">
          CC
        </span>
      )}
      {kind === 'by' && (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="6.5" r="2.5" />
          <path d="M8.5 11.5h7l-.8 5H13v4.5h-2V16.5H9.3l-.8-5Z" />
        </svg>
      )}
      {kind === 'sa' && (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 8.5A6.5 6.5 0 1 0 18 14.5" />
          <polyline points="14 5.5 18 8.5 14.5 11.5" />
        </svg>
      )}
      {kind === 'nc' && (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v16M15.5 8.5c0-1.5-1.5-2.5-3.5-2.5s-3.5 1-3.5 2.5 1.5 2.2 3.5 2.7 3.5 1.2 3.5 2.8-1.5 2.5-3.5 2.5-3.5-1-3.5-2.5" />
          <line x1="5" y1="5" x2="19" y2="19" />
        </svg>
      )}
      {kind === 'nd' && (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="6.5" y1="9.5" x2="17.5" y2="9.5" />
          <line x1="6.5" y1="14.5" x2="17.5" y2="14.5" />
        </svg>
      )}
      {kind === 'zero' && (
        <span className="font-mono text-xs font-semibold leading-none">0</span>
      )}
      {kind === 'copyright' && (
        <span className="font-mono text-xs font-semibold leading-none">©</span>
      )}
    </span>
  );
}

export function CcLicenseCard({
  locale,
  copy,
  stepLicense,
  siteDefaultLicense,
  authorName,
  compact = false,
}: CcLicenseCardProps) {
  const meta = resolveEffectiveLicense(stepLicense, siteDefaultLicense);
  if (!meta) return null;

  const deedUrl = getLicenseDeedUrl(meta, locale);
  const label = copy.licenseNames[meta.id];
  const cleanAuthor = authorName?.trim() || '';

  return (
    <div
      data-sticker-style="stamp"
      className={`sticker-card overflow-hidden ${
        compact ? 'p-3 sm:p-3.5' : 'p-3.5 sm:p-4'
      }`}
      style={{
        '--sticker-bg': 'var(--alert-kraft-bg)',
        '--sticker-border': 'var(--alert-kraft-border)',
        '--sticker-body': 'var(--alert-kraft-body)',
        borderRadius: '11px',
        boxShadow: '2px 2px 0 0 var(--border-ink)',
      } as React.CSSProperties}
    >
      <div className="pointer-events-none absolute top-1.5 end-2.5 z-0">
        <PostmarkOrnament stroke="var(--alert-kraft-border)" compact />
      </div>

      <div className="relative z-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-1 shrink-0">
            {meta.emblems.map((emblem) => (
              <EmblemMedallion key={emblem} kind={emblem} />
            ))}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="font-hand text-xs font-semibold px-1.5 py-0.5 rounded border border-dashed"
                style={{
                  backgroundColor: 'var(--alert-kraft-badge-bg)',
                  color: 'var(--alert-kraft-badge-fg)',
                  borderColor: 'var(--alert-kraft-border)',
                }}
              >
                {copy.licenseBadge}
              </span>
              {cleanAuthor && (
                <span
                  className="font-mono text-xs font-semibold truncate"
                  style={{ color: 'var(--alert-kraft-body)' }}
                >
                  @{cleanAuthor}
                </span>
              )}
            </div>

            <p
              className="m-0 mt-0.5 font-hand text-sm sm:text-base font-semibold leading-snug"
              style={{ color: 'var(--alert-kraft-title)' }}
            >
              {label}
            </p>
          </div>
        </div>

        {deedUrl && (
          <a
            href={deedUrl}
            target="_blank"
            rel="license noopener noreferrer"
            className="min-h-8 px-2.5 py-1 rounded-lg font-hand text-xs sm:text-sm font-semibold border-[1.5px] inline-flex items-center gap-1 shrink-0 no-underline transition-transform hover:-translate-y-px"
            style={{
              backgroundColor: 'var(--surface-sheet)',
              borderColor: 'var(--alert-kraft-border)',
              color: 'var(--alert-kraft-title)',
              boxShadow: '1.5px 1.5px 0 0 var(--alert-kraft-border)',
            }}
          >
            {copy.licenseDeedLink}
          </a>
        )}
      </div>
    </div>
  );
}
