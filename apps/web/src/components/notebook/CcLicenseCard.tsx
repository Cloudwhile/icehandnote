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
import type { LocaleCode } from '../../lib/types';

/**
 * Finely engraved Creative Commons / Copyright double-ring coin medallion.
 * Uses optical curves, knockout slash masking (for NC), and balanced proportions
 * across both 32px archival plates and 24px Studio selector tiles.
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
          <circle cx={16} cy={16} r={13.4} />
        </clipPath>
      </defs>

      {/* Outer heavy archival bezel & inner hair-line coin engraving */}
      <circle
        cx={16}
        cy={16}
        r={14.2}
        style={{ fill: coinBg }}
        stroke="currentColor"
        strokeWidth={1.7}
      />
      <circle
        cx={16}
        cy={16}
        r={11.8}
        stroke="currentColor"
        strokeWidth={0.65}
        strokeOpacity={0.32}
      />

      {emblem === 'cc' && (
        <g
          stroke="currentColor"
          strokeWidth={2.05}
          strokeLinecap="round"
        >
          <path d="M14.7 13.3a2.95 3.35 0 1 0 0 5.4" />
          <path d="M21.4 13.3a2.95 3.35 0 1 0 0 5.4" />
        </g>
      )}

      {emblem === 'by' && (
        <g>
          {/* Sculpted portrait head */}
          <circle cx={16} cy={9.55} r={2.2} fill="currentColor" />
          {/* Tapered torso silhouette with open sleeve & leg separation */}
          <path
            d="M11.65 14.35c0-1.15.9-2.05 2.08-2.05h4.54c1.18 0 2.08.9 2.08 2.05v4.15c0 .44-.36.8-.8.8h-1.08v4.55a.78.78 0 0 1-.78.78h-3.38a.78.78 0 0 1-.78-.78V19.3h-1.08a.8.8 0 0 1-.8-.8v-4.15Z"
            fill="currentColor"
          />
          {/* Subtle collar scoop & sleeve/stance engraving lines */}
          <path
            d="M14.2 12.25q1.8 1.15 3.6 0"
            style={{ stroke: coinBg }}
            strokeWidth={0.95}
            strokeLinecap="round"
          />
          <path
            d="M13.5 15.1v3.85M18.5 15.1v3.85M16 19.65v4.9"
            style={{ stroke: coinBg }}
            strokeWidth={0.85}
            strokeLinecap="round"
          />
        </g>
      )}

      {emblem === 'nc' && (
        <g clipPath={`url(#${clipId})`}>
          {/* Vertical currency spine */}
          <path
            d="M16 8.35v2.35M16 21.3v2.35"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
          />
          {/* Balanced geometric S-curve */}
          <path
            d="M19.15 12.2c-.55-.95-1.65-1.5-3.1-1.5-1.85 0-3.15.92-3.15 2.28 0 1.42 1.18 2.02 3.22 2.5 2.1.5 3.3 1.12 3.3 2.65 0 1.52-1.45 2.55-3.42 2.55-1.72 0-3.12-.62-3.65-1.72"
            stroke="currentColor"
            strokeWidth={1.95}
            strokeLinecap="round"
          />
          {/* Diagonal prohibition slash with clean coin-surface halo */}
          <line
            x1={6.2}
            y1={6.2}
            x2={25.8}
            y2={25.8}
            style={{ stroke: coinBg }}
            strokeWidth={3.6}
          />
          <line
            x1={6.2}
            y1={6.2}
            x2={25.8}
            y2={25.8}
            stroke="currentColor"
            strokeWidth={1.85}
          />
        </g>
      )}

      {emblem === 'sa' && (
        <g>
          {/* True circular share-alike loop + crisp geometric tangent arrowhead */}
          <path
            d="M19.95 11.45a5.95 5.95 0 1 0 2.05 4.85"
            stroke="currentColor"
            strokeWidth={2.05}
            strokeLinecap="round"
          />
          <path
            d="M21.9 9.15l.75 4.25-4.35-.7Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={0.7}
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
          <path d="M10.15 13.75h11.7" />
          <path d="M10.15 18.25h11.7" />
        </g>
      )}

      {emblem === 'zero' && (
        <ellipse
          cx={16}
          cy={16}
          rx={3.55}
          ry={5.6}
          stroke="currentColor"
          strokeWidth={2.25}
        />
      )}

      {emblem === 'copyright' && (
        <path
          d="M19.85 12.65a4.95 4.95 0 1 0 0 6.7"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
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

  return (
    <div
      role="radiogroup"
      aria-label={ui.licenseSelectAria}
      className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${className}`.trim()}
    >
      {allowFollowSite && (
        <button
          type="button"
          role="radio"
          aria-checked={normalizedVal === 'default'}
          onClick={() => onChange('')}
          className={`cc-selector-option sm:col-span-2 ${
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

      {ALL_LICENSE_OPTIONS.map((opt) => {
        const isActive = normalizedVal === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.id)}
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
  );
}
