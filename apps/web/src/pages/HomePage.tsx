/*
 * Refactoring UI Constraint Brief (Workflow B & C Refined — HomePage):
 * - Content Ranking:
 *   1. Primary: Hero headline (`tracking-tight` §4.8.1) + Track Notebook Cards (`--ink-primary`, `font-hand`)
 *   2. Secondary: Hero subtitle & Track summaries (`--ink-secondary`)
 *   3. Tertiary: Step counts, tags, footer license (`--ink-muted`)
 * - Action Pyramid (§2.8): ONE Primary CTA ("开始阅读 →", `ink-btn-primary`);
 *   Secondary CTA ("全站關鍵字檢索 ⌘K", `ink-btn-secondary`).
 * - Complete Edge States (§8.4 P0): Loading skeleton, API error state with Retry, and empty tracks state.
 * - Strict Semantic Tokens (§5.2.3 & §5.6): Zero raw hex text/icon colors in JSX; icons pass >= 4.9:1 AA.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import { IconSnowflake } from '../components/ui/Icons';
import { api, runDirectionalTransition } from '../lib/api';
import { UI_COPY } from '../lib/i18n';
import type {
  LocaleCode,
  SiteSettingsDto,
  TrackSummaryDto,
} from '../lib/types';

interface HomePageProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
  onOpenSearch: () => void;
}

function TrackIcon({ kind }: { kind: string }) {
  if (kind === 'terminal') {
    return (
      <svg aria-hidden="true" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (kind === 'cube') {
    return (
      <svg aria-hidden="true" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    );
  }
  return <IconSnowflake className="w-6 h-6" />;
}

export function HomePage({ locale, siteSettings, onOpenSearch }: HomePageProps) {
  const copy = UI_COPY[locale];
  const navigate = useNavigate();
  const [tracks, setTracks] = useState<TrackSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadData = useCallback(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);

    void api
      .listTracks(locale)
      .then((tr) => {
        if (!active) return;
        setTracks(tr);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => loadData(), [loadData]);

  const firstTrack = tracks[0];
  const primaryHref = firstTrack
    ? `/${locale}/tracks/${firstTrack.slug}/${firstTrack.first_chapter_slug}/${firstTrack.first_step_slug}`
    : null;

  return (
    <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-14 space-y-16">
      {/* 1. Dusk Sketch Hero + Parallax Wave Divider */}
      <section className="notebook-sheet-stack">
        <div
          className="notebook-sheet-card relative overflow-hidden pt-8 sm:pt-12 pb-16 px-6 sm:px-10"
          style={{
            background:
              'linear-gradient(160deg, var(--hero-grad-start) 0%, var(--surface-sheet) 72%)',
          }}
        >
          {/* Decorative Corner Sketch Skyline (aria-hidden, low-contrast §8.3.3) */}
          <svg
            aria-hidden="true"
            className="pointer-events-none hidden md:block absolute end-6 bottom-10 w-64 h-44 opacity-85"
            viewBox="0 0 260 180"
            fill="none"
          >
            <circle cx="205" cy="36" r="18" stroke="var(--marker-h2)" strokeWidth="2" strokeDasharray="4 3" />
            <path
              d="M15 155 L15 95 L55 72 L95 95 L95 155 M95 155 L95 82 L148 56 L195 82 L195 155 M195 155 L245 155"
              stroke="var(--ink-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="40" y="108" width="16" height="18" rx="2" fill="var(--palette-warn-300)" fillOpacity="0.55" stroke="var(--marker-h3)" strokeWidth="1.5" />
            <rect x="132" y="92" width="20" height="22" rx="2" fill="var(--marker-h2)" fillOpacity="0.35" stroke="var(--marker-h2)" strokeWidth="1.5" />
            <circle cx="72" cy="38" r="2.5" fill="var(--marker-h2)" />
            <circle cx="122" cy="26" r="2" fill="var(--palette-primary-300)" />
            <circle cx="165" cy="48" r="2.5" fill="var(--marker-h2)" />
          </svg>

          <div className="relative z-10 max-w-2xl space-y-4">
            <h1
              className="text-3xl sm:text-4xl font-semibold text-ink-primary leading-tight tracking-tight m-0"
              style={{ fontFamily: 'var(--font-hand)' }}
            >
              {siteSettings.hero_title || siteSettings.site_name || copy.brandName}
            </h1>

            {/* Signature 2-stroke Ice Cyan + Violet hand-drawn marker underline */}
            <svg
              aria-hidden="true"
              className="w-72 max-w-full h-3 block pointer-events-none"
              viewBox="0 0 280 12"
              fill="none"
            >
              <path
                d="M4 7 C 78 2, 162 10, 274 4.5"
                stroke="var(--marker-h1)"
                strokeWidth="3.8"
                strokeLinecap="round"
              />
              <path
                d="M28 10.2 C 110 7.5, 198 11, 255 8.5"
                stroke="var(--marker-h2)"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>

            {siteSettings.hero_tagline && (
              <p className="text-base text-ink-secondary leading-relaxed max-w-[60ch] m-0">
                {siteSettings.hero_tagline}
              </p>
            )}

            {/* Strict Action Pyramid (§2.8): 1 Primary + 1 Secondary */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!primaryHref}
                onClick={() => {
                  if (!primaryHref) return;
                  runDirectionalTransition(() => navigate(primaryHref), 'forward');
                }}
                className="min-h-10 px-5 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {copy.heroPrimaryCta}
              </button>

              <button
                type="button"
                onClick={onOpenSearch}
                className="min-h-10 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-secondary cursor-pointer"
              >
                {copy.heroSecondaryCta}
              </button>
            </div>
          </div>

          {/* Animated Multi-Layer SVG Waves */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 w-full h-8"
            viewBox="0 0 1200 40"
            preserveAspectRatio="none"
          >
            <path
              className="hero-wave-slow"
              d="M0,22 C220,38 420,4 660,22 C900,38 1060,8 1200,20 L1200,40 L0,40 Z"
              fill="var(--hero-wave-violet)"
            />
            <path
              className="hero-wave-fast"
              d="M0,28 C280,10 520,38 780,22 C980,10 1100,32 1200,26 L1200,40 L0,40 Z"
              fill="var(--hero-wave-ice)"
            />
          </svg>
        </div>
      </section>

      {/* 2. Curated Field Notebook Tracks */}
      <section aria-labelledby="tracks-heading" className="space-y-6">
        <h2
          id="tracks-heading"
          className="text-2xl font-semibold text-ink-primary m-0"
          style={{ fontFamily: 'var(--font-hand)' }}
        >
          {copy.tracksHeading}
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6" aria-busy="true">
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                className="h-64 rounded-2xl bg-surface-sheet/60 border border-border-subtle animate-pulse"
              />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-2xl bg-surface-sheet border-2 border-border-ink p-6">
            <NotebookEmptyState
              title={copy.loadErrorTitle}
              description={copy.loadErrorBody}
              actionLabel={copy.retryBtn}
              onAction={() => void loadData()}
            />
          </div>
        ) : tracks.length === 0 ? (
          <div className="rounded-2xl bg-surface-sheet border-2 border-border-ink p-6">
            <NotebookEmptyState
              title={copy.tracksEmptyTitle}
              description={copy.tracksEmptyBody}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tracks.map((track, idx) => {
              const topAccentVar =
                idx === 0
                  ? 'var(--marker-h1)'
                  : idx === 1
                    ? 'var(--marker-h2)'
                    : 'var(--marker-h3)';
              const iconInkVar =
                idx === 0
                  ? 'var(--link-ink)'
                  : idx === 1
                    ? 'var(--accent-ice-ink)'
                    : 'var(--accent-amber-ink)';
              const stepUrl = `/${locale}/tracks/${track.slug}/${track.first_chapter_slug}/${track.first_step_slug}`;

              return (
                <article
                  key={track.id}
                  className="notebook-sheet-stack notebook-track-card flex"
                >
                  <div
                    className="notebook-sheet-card p-5 flex flex-col justify-between w-full"
                    style={{ borderTopWidth: '5px', borderTopColor: topAccentVar }}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        {/* Enclosed 40x40 Icon Shape (§7.3.1) with WCAG AA theme-adaptive ink */}
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface-raised border border-border-subtle"
                          style={{ color: iconInkVar }}
                        >
                          <TrackIcon kind={track.icon_kind} />
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-surface-raised text-ink-secondary border border-border-subtle">
                          {copy.difficultyLabels[track.difficulty] ?? track.difficulty}
                        </span>
                      </div>

                      <h3
                        className="text-xl font-semibold text-ink-primary leading-snug m-0"
                        style={{ fontFamily: 'var(--font-hand)' }}
                      >
                        <Link
                          to={stepUrl}
                          className="no-underline text-ink-primary hover:text-link-ink transition-colors"
                        >
                          {track.title}
                        </Link>
                      </h3>

                      <p className="text-sm text-ink-secondary leading-relaxed m-0">
                        {track.description}
                      </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-dashed border-border-subtle space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {track.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs font-mono px-2 py-0.5 rounded-full bg-surface-raised text-ink-muted"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-ink-muted font-mono tabular-nums">
                          {copy.formatTrackCounts(track.chapter_count, track.step_count)}
                        </span>
                        <Link
                          to={stepUrl}
                          className="inline-flex items-center min-h-7 py-1 font-semibold text-link-ink no-underline hover:underline"
                        >
                          {copy.openNotebook}
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
