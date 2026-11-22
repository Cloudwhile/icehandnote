/*
 * Reader Sidebar & Mobile Drawer (Merged Chapters + Distinct Series Navigation):
 * - Series-first hierarchy (`章节合并区分系列`):
 *   1. Active Series displays its colored series marker, title, unified task progress bar, and cleanly
 *      merged chapters (single-chapter series merge articles directly without redundant double headers;
 *      multi-chapter series use smooth native `<details>` collapsible chapter groups).
 *   2. Other Series appear below a crisp divider with distinct series color dots and article counts
 *      so readers can distinguish and jump across series effortlessly.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UI_COPY } from '../../lib/i18n';
import type {
  ChapterNavDto,
  LocaleCode,
  TocItem,
  TrackSummaryDto,
} from '../../lib/types';
import { IconClose, IconList, IconPen } from '../ui/Icons';
import { SwipeDrawerDialog } from '../ui/SwipeDrawerDialog';

interface ChapterSidebarProps {
  locale: LocaleCode;
  trackSlug: string;
  trackTitle: string;
  currentStepId: string;
  /** Interactive task progress inside the currently open article (when present) */
  articleTaskStats?: { done: number; total: number };
  chapters: ChapterNavDto[];
  allTracks?: TrackSummaryDto[];
  toc: TocItem[];
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function seriesAccentColor(index: number): string {
  if (index % 3 === 0) return 'var(--marker-h1)';
  if (index % 3 === 1) return 'var(--marker-h2)';
  return 'var(--marker-h3)';
}

export function ChapterSidebarAndDrawer({
  locale,
  trackSlug,
  trackTitle,
  currentStepId,
  articleTaskStats,
  chapters,
  allTracks = [],
  toc,
  mobileOpen,
  onCloseMobile,
}: ChapterSidebarProps) {
  const copy = UI_COPY[locale];
  const [tocOpen, setTocOpen] = useState(false);
  const tocContainerRef = useRef<HTMLDivElement | null>(null);
  const tocTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!tocOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTocOpen(false);
        tocTriggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (
        tocContainerRef.current &&
        !tocContainerRef.current.contains(e.target as Node)
      ) {
        setTocOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [tocOpen]);

  const totalArticles = chapters.reduce((acc, c) => acc + c.steps.length, 0);
  const taskTotal = articleTaskStats?.total ?? 0;
  const taskDone = articleTaskStats?.done ?? 0;
  const taskPct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;

  const activeTrackIdx = Math.max(
    0,
    allTracks.findIndex((t) => t.slug === trackSlug),
  );
  const activeAccent = seriesAccentColor(activeTrackIdx);
  const otherSeries = allTracks.filter((t) => t.slug !== trackSlug);
  const singleChapter = chapters.length === 1;

  const renderStepList = (ch: ChapterNavDto, onSelect?: () => void) => (
    <ul className="list-none m-0 p-0 space-y-1">
      {ch.steps.map((st) => {
        const active = st.id === currentStepId;
        return (
          <li key={st.id}>
            <Link
              to={`/${locale}/tracks/${trackSlug}/${ch.slug}/${st.slug}`}
              onClick={onSelect}
              aria-current={active ? 'page' : undefined}
              className={`flex items-start gap-2 min-h-9 px-2.5 py-1.5 rounded-lg text-sm no-underline transition-colors ${
                active
                  ? 'font-semibold text-ink-primary border-s-3 border-action-bg bg-action-subtle/60'
                  : 'text-ink-muted hover:text-ink-primary hover:bg-surface-sheet/60'
              }`}
            >
              <span
                aria-hidden="true"
                className="font-mono text-xs mt-0.5 shrink-0 tabular-nums"
              >
                {String(st.step_number).padStart(2, '0')}.
              </span>
              <span className="leading-snug flex-1">{st.title}</span>
              {!st.has_requested_locale && (
                <span
                  title={copy.fallbackShortTitle}
                  className="text-xs px-1.5 rounded border border-border-subtle text-ink-muted shrink-0"
                >
                  {copy.fallbackShortBadge}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const renderNavTree = (onSelect?: () => void) => (
    <div className="space-y-6">
      {/* 1. Active Series Block (distinct colored accent + merged chapter articles) */}
      <div className="space-y-3.5">
        <div
          className="ps-3 space-y-2"
          style={{ borderInlineStart: `3px solid ${activeAccent}` }}
        >
          <div className="flex items-start gap-2">
            <span className="text-sm font-semibold text-ink-primary leading-snug">
              {trackTitle}
            </span>
          </div>

          {taskTotal > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-ink-muted tabular-nums">
                <span>{copy.articleTasksLabel}</span>
                <span className="font-mono">
                  {taskDone}/{taskTotal}
                </span>
              </div>
              <progress
                max={100}
                value={taskPct}
                aria-label={copy.articleTasksLabel}
                className="notebook-progress w-full block"
              >
                {taskPct}%
              </progress>
            </div>
          ) : (
            <div className="text-xs text-ink-muted tabular-nums">
              {copy.formatTrackCounts(chapters.length, totalArticles)}
            </div>
          )}
        </div>

        {/* Merged chapters inside the active series */}
        {singleChapter ? (
          renderStepList(chapters[0], onSelect)
        ) : (
          <div className="space-y-2.5">
            {chapters.map((ch) => {
              const containsActive = ch.steps.some(
                (st) => st.id === currentStepId,
              );
              return (
                <details
                  key={ch.slug}
                  open={containsActive}
                  className="sidebar-chapter-group"
                >
                  <summary>{ch.title}</summary>
                  <div className="pt-1 ps-2">
                    {renderStepList(ch, onSelect)}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Other Series Switcher (clearly separates and links all sibling series) */}
      {otherSeries.length > 0 && (
        <div className="pt-4 border-t border-dashed border-border-subtle space-y-2">
          <div className="px-1 text-xs font-semibold text-ink-muted">
            {copy.otherSeriesHeading}
          </div>
          <ul className="list-none m-0 p-0 space-y-1">
            {otherSeries.map((series) => {
              const idx = Math.max(
                0,
                allTracks.findIndex((t) => t.slug === series.slug),
              );
              const accent = seriesAccentColor(idx);
              const href = `/${locale}/tracks/${series.slug}/${series.first_chapter_slug}/${series.first_step_slug}`;
              return (
                <li key={series.id}>
                  <Link
                    to={href}
                    onClick={onSelect}
                    className="group flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-xs no-underline text-ink-secondary hover:text-ink-primary hover:bg-surface-sheet/70 transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                      style={{ backgroundColor: accent }}
                    />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block font-semibold leading-snug text-ink-secondary group-hover:text-ink-primary">
                        {series.title}
                      </span>
                      <span className="block text-xs text-ink-muted tabular-nums">
                        {copy.formatTrackCounts(
                          series.chapter_count,
                          series.step_count,
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside
        aria-label={copy.chapterOutlineAria}
        className="hidden lg:block w-64 shrink-0 sticky top-24 self-start max-h-[calc(100dvh-7rem)] pe-2 overflow-y-auto ink-thin-scrollbar space-y-6"
      >
        {renderNavTree()}

        {toc.length > 0 && (
          <div className="pt-4 border-t border-dashed border-border-subtle space-y-2">
            <div className="px-1 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
              <IconPen className="w-3.5 h-3.5 text-ink-muted" />
              <span>{copy.tocHeading}</span>
            </div>
            <ul className="list-none m-0 p-0 space-y-1">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="flex items-baseline gap-2 py-1 px-1.5 rounded-lg text-xs no-underline text-ink-secondary hover:text-link-ink hover:bg-surface-sheet/70 transition-colors"
                    style={{ paddingInlineStart: `${6 + (item.level - 1) * 8}px` }}
                  >
                    <span className="font-mono font-semibold text-link-ink shrink-0">
                      {item.number}
                    </span>
                    <span className="truncate">{item.text}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <SwipeDrawerDialog
        id="mobile-chapter-drawer"
        open={mobileOpen}
        onClose={onCloseMobile}
        ariaLabel={copy.chapterDrawerButton}
        title={copy.chapterDrawerButton}
        closeAriaLabel={copy.closeLabel}
        surface="sheet"
        className="lg:hidden"
      >
        <nav
          aria-label={copy.chapterOutlineAria}
          className="p-5 flex-1 min-h-0 overflow-y-auto overscroll-contain"
        >
          {renderNavTree(onCloseMobile)}
        </nav>
      </SwipeDrawerDialog>

      {toc.length > 0 && (
        <div
          ref={tocContainerRef}
          className="lg:hidden fixed end-4 bottom-5 z-40"
        >
          <button
            ref={tocTriggerRef}
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            aria-expanded={tocOpen}
            aria-label={copy.tocButton}
            title={copy.tocButton}
            className="w-11 h-11 rounded-full flex items-center justify-center ink-btn-secondary cursor-pointer"
          >
            <IconList className="w-5 h-5 text-ink-secondary" />
          </button>

          {tocOpen && (
            <div
              role="region"
              aria-label={copy.tocHeading}
              className="ui-popover-enter origin-bottom-right lg:origin-bottom-left mt-2 absolute bottom-14 end-0 lg:start-0 lg:end-auto w-[min(18rem,calc(100dvw-2rem))] sm:w-80 rounded-2xl p-4 bg-surface-raised space-y-2.5 ink-surface-floating"
            >
              <div className="flex items-center justify-between pb-2 border-b border-dashed border-border-subtle">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-primary">
                  <IconPen className="w-3.5 h-3.5 text-ink-muted" />
                  <span>{copy.tocHeading}</span>
                </span>
                <button
                  type="button"
                  aria-label={copy.closeLabel}
                  onClick={() => {
                    setTocOpen(false);
                    tocTriggerRef.current?.focus();
                  }}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-sheet cursor-pointer"
                >
                  <IconClose className="w-3.5 h-3.5" />
                </button>
              </div>
              <ul className="list-none m-0 p-0 space-y-1.5 max-h-[min(16rem,calc(100dvh-7rem))] overflow-y-auto studio-scroll-pane">
                {toc.map((item) => (
                  <li
                    key={item.id}
                    className="border-b border-dashed border-border-subtle/60 pb-1 last:border-0"
                  >
                    <a
                      href={`#${item.id}`}
                      onClick={() => setTocOpen(false)}
                      className="flex items-baseline gap-2 py-1 text-xs no-underline text-ink-secondary hover:text-link-ink transition-colors"
                      style={{ paddingInlineStart: `${(item.level - 1) * 8}px` }}
                    >
                      <span className="font-mono font-semibold text-link-ink shrink-0">
                        {item.number}
                      </span>
                      <span className="truncate">{item.text}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
