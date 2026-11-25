import { useId } from 'react';
import {
  ALL_LICENSE_OPTIONS,
  getLicenseDeedUrl,
  normalizeLicenseId,
  resolveEffectiveLicense,
  type LicenseEmblem,
} from '../../lib/licenses';
import type { UiMessages } from '../../lib/locales';
import { UI_COPY } from '../../lib/i18n';
import type { LicenseId, LocaleCode } from '../../lib/types';

/**
 * Hand-drawn Creative Commons / Copyright double-ring ink coin medallion.
 * Uses pure organic `<path>` pen strokes, knockout slash masking (for NC), and balanced
 * proportions across both 32px archival plates and 24px Studio selector tiles.
 */
export function CcEmblemMedallion({
  emblem,
  size = 32,
}: {
  emblem: LicenseEmblem;
  size?: number;
}) {
  const clipId = useId();
  const coinBg = 'var(--surface-colophon-coin, #f8f4ea)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <clipPath id={clipId}>
          <path d="M16.1 2.7 C23.6 2.6, 29.4 8.5, 29.3 16.1 C29.4 23.5, 23.5 29.4, 15.9 29.3 C8.4 29.4, 2.7 23.4, 2.7 15.9 C2.6 8.6, 8.5 2.7, 16.1 2.7 Z" />
        </clipPath>
      </defs>

      {/* Outer hand-drawn archival ink bezel & inner sketch hairline ring */}
      <path
        d="M16.1 1.9 C23.9 1.7, 30.2 8.1, 30.1 16.0 C30.3 23.8, 23.9 30.2, 15.9 30.1 C8.1 30.2, 1.8 23.8, 1.9 15.9 C1.8 8.2, 8.2 1.8, 16.1 1.9 Z"
        style={{ fill: coinBg }}
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.2 4.2 C22.8 4.1, 27.9 9.3, 27.8 16.1 C27.9 22.7, 22.6 27.9, 15.9 27.8 C9.2 27.9, 4.1 22.5, 4.2 15.8 C4.1 9.5, 9.4 4.3, 16.2 4.2 Z"
        stroke="currentColor"
        strokeWidth={0.7}
        strokeOpacity={0.34}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {emblem === 'cc' && (
        <g
          stroke="currentColor"
          strokeWidth={2.05}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.7 13.1 C12.4 11.4, 9.3 12.9, 9.2 16.0 C9.1 19.2, 12.3 20.6, 14.8 18.8" />
          <path d="M21.4 13.1 C19.1 11.4, 16.0 12.9, 15.9 16.0 C15.8 19.2, 19.0 20.6, 21.5 18.8" />
        </g>
      )}

      {emblem === 'by' && (
        <g>
          {/* Hand-inked portrait head */}
          <path
            d="M16.1 7.4 C17.4 7.3, 18.3 8.3, 18.2 9.6 C18.3 10.9, 17.2 11.8, 15.9 11.7 C14.6 11.8, 13.7 10.8, 13.8 9.5 C13.7 8.2, 14.8 7.3, 16.1 7.4 Z"
            fill="currentColor"
          />
          {/* Hand-sketched tapered torso silhouette */}
          <path
            d="M11.7 14.4 C11.7 13.2, 12.6 12.3, 13.8 12.3 Q16.0 12.1 18.3 12.3 C19.5 12.3, 20.3 13.2, 20.3 14.4 L20.2 18.4 C20.2 18.9, 19.9 19.3, 19.4 19.3 L18.4 19.3 L18.4 23.8 C18.4 24.3, 18.1 24.6, 17.6 24.6 L14.4 24.6 C13.9 24.6, 13.6 24.3, 13.6 23.8 L13.6 19.3 L12.5 19.3 C12.0 19.3, 11.7 18.9, 11.7 18.4 Z"
            fill="currentColor"
          />
          {/* Subtle collar scoop & sleeve/stance engraving strokes */}
          <path
            d="M14.2 12.3 Q16.0 13.4 17.8 12.3"
            style={{ stroke: coinBg }}
            strokeWidth={0.95}
            strokeLinecap="round"
          />
          <path
            d="M13.5 15.1 Q13.4 17.0 13.5 18.9 M18.5 15.1 Q18.6 17.0 18.5 18.9 M16.0 19.6 Q15.9 22.1 16.0 24.5"
            style={{ stroke: coinBg }}
            strokeWidth={0.85}
            strokeLinecap="round"
          />
        </g>
      )}

      {emblem === 'nc' && (
        <g clipPath={`url(#${clipId})`}>
          {/* Hand-inked vertical currency spine */}
          <path
            d="M16.0 8.3 Q15.9 9.5 16.0 10.7 M16.0 21.3 Q16.1 22.5 16.0 23.7"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
          />
          {/* Organic calligraphy S-curve */}
          <path
            d="M19.15 12.2 C18.6 11.25, 17.5 10.7, 16.05 10.7 C14.2 10.7, 12.9 11.62, 12.9 12.98 C12.9 14.4, 14.08 15.0, 16.12 15.48 C18.22 15.98, 19.42 16.6, 19.42 18.13 C19.42 19.65, 17.97 20.68, 16.0 20.68 C14.28 20.68, 12.88 20.06, 12.35 18.96"
            stroke="currentColor"
            strokeWidth={1.95}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Diagonal hand-drawn prohibition nib stroke with halo */}
          <path
            d="M6.1 6.3 Q16.2 15.8 25.9 25.7"
            style={{ stroke: coinBg }}
            strokeWidth={3.6}
            strokeLinecap="round"
          />
          <path
            d="M6.1 6.3 Q16.2 15.8 25.9 25.7"
            stroke="currentColor"
            strokeWidth={1.85}
            strokeLinecap="round"
          />
        </g>
      )}

      {emblem === 'sa' && (
        <g>
          {/* Organic circular share-alike ink loop + nib arrowhead */}
          <path
            d="M19.9 11.4 C17.3 9.2, 13.0 9.8, 11.1 12.6 C9.2 15.4, 10.2 19.4, 13.2 21.0 C16.3 22.6, 20.5 21.2, 21.8 17.8 Q22.0 17.1 22.0 16.3"
            stroke="currentColor"
            strokeWidth={2.05}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M21.9 9.2 Q22.4 11.3 22.6 13.4 Q20.4 13.1 18.3 12.7 Q20.1 10.9 21.9 9.2 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={0.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}

      {emblem === 'nd' && (
        <g
          stroke="currentColor"
          strokeWidth={2.15}
          strokeLinecap="round"
        >
          <path d="M10.1 13.8 Q16.0 13.5 21.9 13.8" />
          <path d="M10.2 18.3 Q16.1 18.0 21.8 18.2" />
        </g>
      )}

      {emblem === 'zero' && (
        <path
          d="M16.1 10.4 C18.3 10.3, 19.7 12.8, 19.6 16.0 C19.7 19.3, 18.2 21.7, 15.9 21.6 C13.6 21.7, 12.3 19.2, 12.4 15.9 C12.3 12.7, 13.9 10.5, 16.1 10.4 Z"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {emblem === 'copyright' && (
        <path
          d="M19.8 12.6 C17.6 10.5, 13.8 11.0, 12.1 13.6 C10.4 16.2, 11.2 19.7, 14.0 20.9 C16.4 21.9, 18.5 21.0, 19.9 19.4"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

interface CcLicenseCardProps {
  /** Article license override (`"default"` / empty inherits `siteDefaultLicense`). */
  stepLicense?: string | null;
  siteDefaultLicense?: string | null;
  locale: LocaleCode;
  copy?: UiMessages;
  authorName?: string | null;
  compact?: boolean;
  className?: string;
}

/**
 * Archival double-ruled Press Colophon seal for articles.
 * Single-destination clickable seal when a Creative Commons deed URL exists
 * (clicking either the engraved coins or the license description opens the deed);
 * adapts to its own inline container size via CSS container queries.
 */
export function CcLicenseCard({
  stepLicense,
  siteDefaultLicense,
  locale,
  copy,
  authorName,
  compact = false,
  className = '',
}: CcLicenseCardProps) {
  const effective = resolveEffectiveLicense(stepLicense, siteDefaultLicense);
  if (!effective) return null;

  const ui = copy ?? UI_COPY[locale];
  const label = ui.licenseNames[effective.id] ?? effective.shortCode;
  const deedUrl = getLicenseDeedUrl(effective, locale);
  const cleanAuthor = authorName?.trim() || '';

  const innerContent = (
    <div className="cc-colophon-inner">
      {/* Row of finely engraved CC / BY / NC / SA / ND coin medallions */}
      <div className="cc-colophon-emblems flex items-center gap-1.5 text-ink-primary shrink-0">
        {effective.emblems.map((emb, idx) => (
          <CcEmblemMedallion
            key={`${emb}-${idx}`}
            emblem={emb}
            size={compact ? 26 : 30}
          />
        ))}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
          <span className="cc-colophon-kicker uppercase tracking-[0.14em]">
            {ui.licenseBadge}
          </span>
          {cleanAuthor && (
            <>
              <span aria-hidden="true">·</span>
              <span className="break-words">© {cleanAuthor}</span>
            </>
          )}
        </div>
        <p className="cc-colophon-title text-sm font-semibold text-ink-primary leading-snug m-0">
          {label}
        </p>
      </div>
    </div>
  );

  return (
    <aside
      aria-label={ui.licenseCardAria}
      className={`cc-colophon-host ${className}`.trim()}
    >
      {deedUrl ? (
        <a
          href={deedUrl}
          target="_blank"
          rel="noopener noreferrer license"
          title={label}
          className={`cc-colophon-seal cc-colophon-seal--link ${compact ? 'cc-colophon-seal--compact' : ''}`.trim()}
        >
          {innerContent}
        </a>
      ) : (
        <div
          className={`cc-colophon-seal ${compact ? 'cc-colophon-seal--compact' : ''}`.trim()}
        >
          {innerContent}
        </div>
      )}
    </aside>
  );
}

interface CcLicenseSelectorProps {
  value: string;
  onChange: (nextLicenseId: string) => void;
  locale: LocaleCode;
  /** Allow an explicit `"default"` entry that follows Site Settings */
  allowFollowSite?: boolean;
  siteDefaultLicense?: string | null;
  className?: string;
}

/**
 * Interactive Studio control for selecting content licenses.
 * Visually structured as an editable radio-card grid (not an archival seal).
 */
export function CcLicenseSelector({
  value,
  onChange,
  locale,
  allowFollowSite = false,
  siteDefaultLicense,
  className = '',
}: CcLicenseSelectorProps) {
  const ui = UI_COPY[locale];
  const studio = ui.studio;
  const resolvedSite = resolveEffectiveLicense(siteDefaultLicense, 'cc-by-4.0');
  const normalizedVal =
    allowFollowSite && (!value || value === 'default')
      ? 'default'
      : normalizeLicenseId(value);

  const optionValues: Array<LicenseId | ''> = [
    ...(allowFollowSite ? ([''] as const) : []),
    ...ALL_LICENSE_OPTIONS.map((opt) => opt.id),
  ];

  const handleRadioKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      return;
    }
    e.preventDefault();
    const last = optionValues.length - 1;
    let nextIdx = idx;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIdx = idx >= last ? 0 : idx + 1;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIdx = idx <= 0 ? last : idx - 1;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = last;
    }
    onChange(optionValues[nextIdx]);
    const group = e.currentTarget.parentElement;
    const radios = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[nextIdx]?.focus();
  };

  const activeIndex = optionValues.findIndex((optVal) =>
    optVal === '' ? normalizedVal === 'default' : normalizedVal === optVal,
  );

  return (
    <div className={`@container ${className}`.trim()}>
      <div
        role="radiogroup"
        aria-label={ui.licenseSelectAria}
        className="grid grid-cols-1 @[32rem]:grid-cols-2 gap-2"
      >
        {allowFollowSite && (
          <button
            type="button"
            role="radio"
            aria-checked={normalizedVal === 'default'}
            tabIndex={activeIndex === 0 || activeIndex < 0 ? 0 : -1}
            onClick={() => onChange('')}
            onKeyDown={(e) => handleRadioKeyDown(e, 0)}
            className={`cc-selector-option @[32rem]:col-span-2 ${
              normalizedVal === 'default' ? 'cc-selector-option--active' : ''
            }`}
          >
          <span className="cc-selector-radio" aria-hidden="true">
            {normalizedVal === 'default' && <span className="cc-selector-dot" />}
          </span>
          <div className="min-w-0 flex-1 text-start">
            <p className="text-xs font-semibold text-ink-primary truncate m-0">
              {studio.licenseFollowSite(resolvedSite?.shortCode ?? 'CC BY 4.0')}
            </p>
            {resolvedSite && (
              <p className="text-xs text-ink-muted leading-snug line-clamp-2 m-0">
                {ui.licenseNames[resolvedSite.id] ?? resolvedSite.shortCode}
              </p>
            )}
          </div>
          {resolvedSite && (
            <div className="flex items-center gap-1 text-ink-secondary shrink-0">
              {resolvedSite.emblems.slice(0, 3).map((emb, idx) => (
                <CcEmblemMedallion
                  key={`site-${emb}-${idx}`}
                  emblem={emb}
                  size={20}
                />
              ))}
            </div>
          )}
        </button>
      )}

      {ALL_LICENSE_OPTIONS.map((opt, mapIdx) => {
        const optionIdx = allowFollowSite ? mapIdx + 1 : mapIdx;
        const isActive = normalizedVal === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={
              isActive || (activeIndex < 0 && optionIdx === 0) ? 0 : -1
            }
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => handleRadioKeyDown(e, optionIdx)}
            className={`cc-selector-option ${
              isActive ? 'cc-selector-option--active' : ''
            }`}
          >
            <span className="cc-selector-radio" aria-hidden="true">
              {isActive && <span className="cc-selector-dot" />}
            </span>
            <div className="min-w-0 flex-1 text-start">
              <p className="text-xs font-mono font-semibold text-ink-primary truncate m-0">
                {opt.shortCode}
              </p>
              <p className="text-xs text-ink-muted leading-snug line-clamp-2 m-0">
                {ui.licenseNames[opt.id] ?? opt.shortCode}
              </p>
            </div>
            {opt.emblems.length > 0 && (
              <div className="flex items-center gap-1 text-ink-secondary shrink-0">
                {opt.emblems.map((emb, idx) => (
                  <CcEmblemMedallion
                    key={`${opt.id}-${emb}-${idx}`}
                    emblem={emb}
                    size={20}
                  />
                ))}
              </div>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
