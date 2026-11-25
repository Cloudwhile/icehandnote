/*
 * Refactoring UI Constraint Brief (Editorial Field Notebook — HomePage):
 * - Content Ranking:
 *   1. Primary: Quiet editorial masthead + Recent Article Cards w/ Cover Banners (`<article class="card">`)
 *   2. Secondary: All Series Directory w/ Hand-Drawn Emblems, Optional Author Badge, & Article Roadmaps
 *   3. Tertiary: Reading minutes, dates, tags (`--ink-muted`)
 * - Action Pyramid (§2.8): ONE Primary CTA ("开始阅读", `ink-btn-primary`);
 *   Secondary CTA ("全站关键检索 ⌘K", `ink-btn-secondary`).
 * - Complete Edge States (§8.4 P0): Loading skeleton, API error state with Retry, and empty tracks state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatShortcutK } from '../components/navigation/SearchTriggerButton';
import { ArticleCoverBanner } from '../components/notebook/ArticleCoverBanner';
import { MarkerUnderline } from '../components/notebook/MarkerUnderline';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import {
  IconArrowRight,
  IconCalendar,
  IconChapterList,
  IconClock,
  IconSearch,
  TrackHandIcon,
} from '../components/ui/Icons';
import {
  api,
  getActiveStorageScopeKey,
  runDirectionalTransition,
} from '../lib/api';
import { EXT_COPY, UI_COPY } from '../lib/i18n';
import { SafeHtml, stripHtmlTags } from '../lib/sanitizer';
import {
  readViewCache,
  scopedViewCacheKey,
  writeViewCache,
} from '../lib/viewCache';
import {
  type LocaleCode,
  resolveCustomTrackBadge,
  type SiteSettingsDto,
  type TrackArticleCardDto,
  type TrackSummaryDto,
} from '../lib/types';

interface HomePageProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
  onOpenSearch: () => void;
}

function buildArticleHref(
  locale: LocaleCode,
  track: TrackSummaryDto,
  article: { chapter_slug: string; step_slug: string },
): string {
  if (track.chapter_count > 1 && article.chapter_slug) {
    return `/${locale}/series/${track.slug}/${article.chapter_slug}/${article.step_slug}`;
  }
  return `/${locale}/series/${track.slug}/${article.step_slug}`;
}

export function HomePage({
  locale,
  siteSettings,
  settingsReady = true,
  onOpenSearch,
}: HomePageProps) {
  const copy = UI_COPY[locale];
  const extCopy = EXT_COPY[locale];
  const navigate = useNavigate();
  const tracksCacheKey = scopedViewCacheKey(
    getActiveStorageScopeKey(),
    `home:tracks:${locale}`,
  );
  const [tracks, setTracks] = useState<TrackSummaryDto[]>(
    () => readViewCache<TrackSummaryDto[]>(tracksCacheKey) ?? [],
  );
  const [loading, setLoading] = useState(
    () => readViewCache<TrackSummaryDto[]>(tracksCacheKey) === null,
  );
  const [loadError, setLoadError] = useState(false);

  const loadData = useCallback(() => {
    let active = true;
    const cached = readViewCache<TrackSummaryDto[]>(tracksCacheKey);
    if (cached) {
      setTracks(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setLoadError(false);

    void api
      .listTracks(locale)
      .then((tr) => {
        if (!active) return;
        writeViewCache(tracksCacheKey, tr);
        setTracks(tr);
      })
      .catch(() => {
        if (active && !cached) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [locale, tracksCacheKey]);

  useEffect(() => loadData(), [loadData]);

  const firstTrack = tracks.find((t) => Boolean(t.first_step_slug));
  const primaryHref = useMemo(() => {
    if (!firstTrack || !firstTrack.first_step_slug) return null;
    if (firstTrack.chapter_count > 1 && firstTrack.first_chapter_slug) {
      return `/${locale}/series/${firstTrack.slug}/${firstTrack.first_chapter_slug}/${firstTrack.first_step_slug}`;
    }
    return `/${locale}/series/${firstTrack.slug}/${firstTrack.first_step_slug}`;
  }, [firstTrack, locale]);

  const featuredArticles = useMemo(() => {
    const flattened: Array<{
      track: TrackSummaryDto;
      article: TrackArticleCardDto;
    }> = [];
    for (const track of tracks) {
      for (const article of track.articles ?? []) {
        flattened.push({ track, article });
      }
    }
    return flattened;
  }, [tracks]);

  const openArticleHref = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    runDirectionalTransition(() => navigate(href), 'forward');
  };

  return (
    <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-14 space-y-12 sm:space-y-16">
      {/* 1. Calm Editorial Masthead + Fine-Nib Notebook Sketch */}
      <section className="rounded-2xl bg-surface-sheet border border-border-subtle px-6 sm:px-10 py-8 sm:py-10 relative overflow-hidden">
        <span
          aria-hidden="true"
          className="pointer-events-none hidden sm:block absolute inset-y-6 start-4 w-px bg-border-subtle"
        />

        {/* Subtle fine-nib open notebook & pen vignette (pure path strokes, no cartoon waves/sprites) */}
        <svg
          aria-hidden="true"
          className="pointer-events-none hidden md:block absolute end-8 bottom-4 w-56 h-36 opacity-65"
          viewBox="0 0 240 160"
          fill="none"
        >
          <path
            d="M34 134 Q31 92 34 52 Q76 46 116 55 Q156 46 196 52 Q199 92 196 134 Q156 127 116 136 Q76 127 34 134 Z"
            stroke="var(--border-control)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M116 55 Q115 95 116 135"
            stroke="var(--border-control)"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
          <path
            d="M52 74 Q78 70 98 74 M52 90 Q75 87 96 90 M52 106 Q72 103 90 106 M134 74 Q158 70 178 74 M134 90 Q156 87 176 90"
            stroke="var(--ink-muted)"
            strokeOpacity="0.45"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M214 28 C196 42 178 65 166 93 Q160 106 157 118 Q170 112 183 103 C206 84 220 56 214 28 Z"
            stroke="var(--link-ink)"
            strokeOpacity="0.7"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M157 118 Q176 98 194 78"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.55"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>

        <div className="relative z-10 max-w-2xl space-y-4">
          <h1
            className="text-3xl sm:text-4xl font-semibold text-ink-primary leading-tight tracking-tight min-h-10 flex items-center text-balance"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {!settingsReady ? (
              <span
                aria-hidden="true"
                className="inline-block w-64 max-w-full h-9 rounded-xl bg-surface-raised motion-safe:animate-pulse"
              />
            ) : (
              <SafeHtml
                as="span"
                html={siteSettings.hero_title || siteSettings.site_name || copy.brandName}
              />
            )}
          </h1>

          <MarkerUnderline variant="hero" />

          {settingsReady && siteSettings.hero_tagline && (
            <SafeHtml
              as="p"
              html={siteSettings.hero_tagline}
              className="text-base text-ink-secondary leading-relaxed max-w-[60ch] pretty-text"
            />
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
              className="min-h-11 sm:min-h-10 px-5 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary inline-flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span>{copy.heroPrimaryCta.replace(/\s*→$/, '')}</span>
              <IconArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onOpenSearch}
              className="min-h-11 sm:min-h-10 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-secondary inline-flex items-center gap-2 cursor-pointer"
            >
              <IconSearch className="w-4 h-4 text-ink-muted" />
              <span>{formatShortcutK(copy.heroSecondaryCta)}</span>
            </button>
          </div>
        </div>
      </section>

      {/* 2. Recent Series Articles (`modern-web-guidance/card`) */}
      {!loading && !loadError && featuredArticles.length > 0 && (
        <section aria-labelledby="featured-articles-heading" className="space-y-5">
          <div className="space-y-1">
            <h2
              id="featured-articles-heading"
              className="text-2xl font-semibold text-ink-primary text-balance m-0"
              style={{ fontFamily: 'var(--font-hand)' }}
            >
              {extCopy.reader.featuredArticlesHeading}
            </h2>
            {extCopy.reader.featuredArticlesDesc && (
              <p className="text-sm text-ink-secondary leading-relaxed pretty-text max-w-[65ch] m-0">
                {extCopy.reader.featuredArticlesDesc}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredArticles.map(({ track, article }, artIdx) => {
              const href = buildArticleHref(locale, track, article);
              return (
                <article
                  key={`${track.id}:${article.step_id}`}
                  className="card rounded-2xl bg-surface-sheet border border-border-subtle hover:border-border-control overflow-hidden flex flex-col transition-colors"
                >
                  <ArticleCoverBanner
                    variant="card"
                    priority={artIdx < 2}
                    coverUrl={article.cover_image}
                    title={article.title}
                    trackSlug={track.slug}
                    trackTitle={track.title}
                    trackIconKind={track.icon_kind}
                    stepSlug={article.step_slug}
                    stepNumber={article.step_number}
                    tags={article.tags}
                  />

                  <header className="px-5 pt-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-link-ink min-w-0">
                        <TrackHandIcon kind={track.icon_kind} className="w-3.5 h-3.5" />
                        <span className="truncate">
                          <SafeHtml as="span" html={track.title} />
                        </span>
                      </span>
                      {track.chapter_count > 1 && article.chapter_title && (
                        <span className="truncate max-w-32 font-mono">
                          {stripHtmlTags(article.chapter_title)}
                        </span>
                      )}
                    </div>

                    <h3
                      className="text-lg sm:text-xl font-semibold text-ink-primary leading-snug text-balance m-0"
                      style={{ fontFamily: 'var(--font-hand)' }}
                    >
                      <Link
                        to={href}
                        onClick={(e) => openArticleHref(e, href)}
                        className="card-link no-underline text-ink-primary hover:text-link-ink transition-colors"
                      >
                        <SafeHtml as="span" html={article.title} />
                      </Link>
                    </h3>
                  </header>

                  <div className="px-5 pt-2 pb-4 flex-1 flex flex-col justify-between gap-4">
                    {article.summary && (
                      <SafeHtml
                        as="p"
                        html={article.summary}
                        className="text-sm text-ink-secondary leading-relaxed line-clamp-2 pretty-text m-0"
                      />
                    )}

                    <footer className="pt-3 border-t border-dashed border-border-subtle flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <IconClock className="w-3.5 h-3.5" />
                          <span>
                            {article.estimated_minutes} {copy.minutesUnit}
                          </span>
                        </span>
                        {article.published_at && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <IconCalendar className="w-3.5 h-3.5" />
                            <time dateTime={article.published_at}>
                              {article.published_at.slice(0, 10)}
                            </time>
                          </span>
                        )}
                      </div>

                      {article.tags.length > 0 && (
                        <span className="font-mono text-ink-muted">
                          #{article.tags[0]}
                        </span>
                      )}
                    </footer>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Field Notebook Series Directory & Chapter Roadmaps */}
      <section aria-labelledby="tracks-heading" className="space-y-5">
        <div className="space-y-1">
          <h2
            id="tracks-heading"
            className="text-2xl font-semibold text-ink-primary text-balance m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {tracks.length > 0 ? extCopy.reader.seriesDirectoryHeading : copy.tracksHeading}
          </h2>
          {tracks.length > 0 && extCopy.reader.seriesDirectoryDesc && (
            <p className="text-sm text-ink-secondary leading-relaxed pretty-text max-w-[65ch] m-0">
              {extCopy.reader.seriesDirectoryDesc}
            </p>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 ui-skeleton-delayed" aria-busy="true">
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                className="h-64 rounded-2xl bg-surface-sheet/60 border border-border-subtle motion-safe:animate-pulse"
              />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-2xl bg-surface-sheet border border-border-subtle p-6">
            <NotebookEmptyState
              title={copy.loadErrorTitle}
              description={copy.loadErrorBody}
              actionLabel={copy.retryBtn}
              onAction={() => void loadData()}
            />
          </div>
        ) : tracks.length === 0 ? (
          <div className="rounded-2xl bg-surface-sheet border border-border-subtle p-6">
            <NotebookEmptyState
              title={copy.tracksEmptyTitle}
              description={copy.tracksEmptyBody}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tracks.map((track) => {
              const customBadge = resolveCustomTrackBadge(track.difficulty);
              const stepUrl = track.first_step_slug
                ? track.chapter_count > 1 && track.first_chapter_slug
                  ? `/${locale}/series/${track.slug}/${track.first_chapter_slug}/${track.first_step_slug}`
                  : `/${locale}/series/${track.slug}/${track.first_step_slug}`
                : null;
              const roadmapArticles = track.articles ?? [];
              const previewItems = roadmapArticles.slice(0, 4);
              const extraCount = Math.max(0, roadmapArticles.length - previewItems.length);

              return (
                <article
                  key={track.id}
                  className="rounded-2xl bg-surface-sheet border border-border-subtle hover:border-border-control p-5 sm:p-6 flex flex-col justify-between transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-surface-raised border border-border-subtle text-link-ink shrink-0">
                        <TrackHandIcon kind={track.icon_kind} className="w-4 h-4" />
                      </div>
                      {customBadge && (
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface-raised text-ink-secondary border border-border-subtle shrink-0">
                          {customBadge}
                        </span>
                      )}
                    </div>

                    <h3
                      className="text-xl font-semibold text-ink-primary leading-snug text-balance m-0"
                      style={{ fontFamily: 'var(--font-hand)' }}
                    >
                      {stepUrl ? (
                        <Link
                          to={stepUrl}
                          onClick={(e) => openArticleHref(e, stepUrl)}
                          className="no-underline text-ink-primary hover:text-link-ink transition-colors"
                        >
                          <SafeHtml as="span" html={track.title} />
                        </Link>
                      ) : (
                        <SafeHtml as="span" html={track.title} />
                      )}
                    </h3>

                    <SafeHtml
                      as="p"
                      html={track.description}
                      className="text-sm text-ink-secondary leading-relaxed pretty-text m-0"
                    />

                    {previewItems.length > 0 && (
                      <div className="pt-2 space-y-1">
                        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                          <IconChapterList className="w-3.5 h-3.5" />
                          <span>{extCopy.reader.seriesContentsLabel}</span>
                        </div>
                        <ul className="list-none m-0 p-0 border-t border-dashed border-border-subtle divide-y divide-dashed divide-border-subtle">
                          {previewItems.map((art, artIdx) => {
                            const artHref = buildArticleHref(locale, track, art);
                            return (
                              <li key={art.step_id}>
                                <Link
                                  to={artHref}
                                  onClick={(e) => openArticleHref(e, artHref)}
                                  className="flex items-baseline justify-between gap-2 py-2 text-xs no-underline text-ink-secondary hover:text-link-ink transition-colors"
                                >
                                  <span className="flex items-baseline gap-2 min-w-0">
                                    <span className="font-mono text-link-ink shrink-0 tabular-nums">
                                      {String(art.step_number || artIdx + 1).padStart(2, '0')}
                                    </span>
                                    <span className="truncate font-semibold">
                                      <SafeHtml as="span" html={art.title} />
                                    </span>
                                  </span>
                                  <span className="font-mono text-ink-muted shrink-0 tabular-nums">
                                    {art.estimated_minutes}m
                                  </span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                        {extraCount > 0 && (
                          <div className="pt-0.5 text-xs font-mono text-ink-muted">
                            {extCopy.reader.moreArticlesCount(extraCount)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 pt-4 border-t border-dashed border-border-subtle space-y-2.5">
                    {track.tags.length > 0 && (
                      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs font-mono text-ink-muted">
                        {track.tags.map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-muted font-mono tabular-nums">
                        {copy.formatTrackCounts(track.chapter_count, track.step_count)}
                      </span>
                      {stepUrl && (
                        <Link
                          to={stepUrl}
                          onClick={(e) => openArticleHref(e, stepUrl)}
                          className="inline-flex items-center gap-1 min-h-9 px-2.5 py-1.5 -me-2 rounded-lg font-semibold text-link-ink hover:text-link-hover-ink no-underline transition-colors ink-icon-target"
                        >
                          <span>{copy.openNotebook.replace(/\s*→$/, '')}</span>
                          <IconArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
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
