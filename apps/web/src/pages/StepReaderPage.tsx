import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChapterSidebarAndDrawer } from '../components/navigation/ChapterSidebarAndDrawer';
import { CcLicenseCard } from '../components/notebook/CcLicenseCard';
import { MarkerUnderline } from '../components/notebook/MarkerUnderline';
import { NotebookAlert } from '../components/notebook/NotebookAlert';
import { NotebookBlockRenderer } from '../components/notebook/NotebookBlockRenderer';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import { IconHome, IconMenu } from '../components/ui/Icons';
import { useToast } from '../components/ui/ToastProvider';
import { UserAvatar } from '../components/ui/UserAvatar';
import { api, runDirectionalTransition } from '../lib/api';
import { normalizeLocale, UI_COPY } from '../lib/i18n';
import { SafeHtml, stripHtmlTags } from '../lib/sanitizer';
import { writeCachedRouteTitle } from '../lib/siteSettings';
import type { ResolvedTheme } from '../lib/theme';
import type {
  LocaleCode,
  SiteSettingsDto,
  StepDetailDto,
  TrackSummaryDto,
  UserMarginNoteDto,
} from '../lib/types';

interface StepReaderPageProps {
  locale: LocaleCode;
  theme: ResolvedTheme;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
  onChangeLocale: (next: LocaleCode) => void;
}

function taskChecksStorageKey(stepId: string): string {
  return `icehandnote_task_checks_${stepId}`;
}

function readLocalTaskChecks(
  stepId: string,
  defaultCheckedIds: string[],
): { ids: Set<string>; hasRecord: boolean } {
  try {
    const raw =
      localStorage.getItem(taskChecksStorageKey(stepId)) ??
      localStorage.getItem(`icetowne_task_checks_${stepId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { ids?: unknown };
      if (Array.isArray(parsed.ids)) {
        return {
          ids: new Set(parsed.ids.filter((v): v is string => typeof v === 'string')),
          hasRecord: true,
        };
      }
    }
  } catch {
    // ignore invalid localStorage payloads
  }
  return { ids: new Set(defaultCheckedIds), hasRecord: false };
}

function writeLocalTaskChecks(stepId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(
      taskChecksStorageKey(stepId),
      JSON.stringify({ ids: Array.from(ids) }),
    );
  } catch {
    // ignore storage quota errors
  }
}

export function StepReaderPage({
  locale,
  theme,
  siteSettings,
  settingsReady = true,
  onChangeLocale,
}: StepReaderPageProps) {
  const { track = '', chapter = '', step = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const copy = UI_COPY[locale];
  const toast = useToast();

  const [detail, setDetail] = useState<StepDetailDto | null>(null);
  const [allTracks, setAllTracks] = useState<TrackSummaryDto[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());
  const [marginNotes, setMarginNotes] = useState<UserMarginNoteDto[]>([]);
  const [likes, setLikes] = useState(0);
  const [likedSession, setLikedSession] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const pendingToggleCountRef = useRef(0);

  // Scroll-progress fallback only for browsers without CSS `animation-timeline: scroll()`
  useEffect(() => {
    if (CSS.supports('animation-timeline', 'scroll()')) return;
    const bar = document.getElementById('reading-progress');
    if (!bar) return;

    const onScroll = () => {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
      bar.style.transform = `scaleX(${ratio})`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [detail?.step_id]);

  useEffect(() => {
    if (!detail || !settingsReady) return;
    const brand = stripHtmlTags(siteSettings.site_name || copy.brandName).trim();
    const plainTitle = stripHtmlTags(detail.title).trim();
    const fullTitle = plainTitle && brand ? `${plainTitle} · ${brand}` : plainTitle || brand;
    if (fullTitle) {
      document.title = fullTitle;
      writeCachedRouteTitle(location.pathname, fullTitle);
    }
  }, [detail, settingsReady, siteSettings.site_name, copy.brandName, location.pathname]);

  // Load all sibling series once per locale so the sidebar cleanly distinguishes series
  useEffect(() => {
    let active = true;
    void api
      .listTracks(locale)
      .then((list) => {
        if (active) setAllTracks(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => {
    let active = true;
    setNotFound(false);

    void api
      .getStepDetail(locale, track, chapter, step)
      .then(async (stepData) => {
        if (!active) return;
        setDetail(stepData);
        setLikes(stepData.likes_count);
        setLikedSession(false);

        const defaultCheckedIds = stepData.blocks.flatMap((b) => {
          if (b.type === 'heading' && b.is_task && b.default_checked) {
            return [b.block_id];
          }
          if (b.type === 'steps') {
            return b.items.filter((it) => it.default_checked).map((it) => it.item_id);
          }
          return [];
        });
        const local = readLocalTaskChecks(stepData.step_id, defaultCheckedIds);
        setCheckedTaskIds(local.ids);

        // Preserve `#hash` anchor navigation instead of forcing scroll to top
        if (location.hash) {
          requestAnimationFrame(() => {
            const targetId = location.hash.slice(1);
            document.getElementById(targetId)?.scrollIntoView();
          });
        } else {
          window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        }

        const [notes, serverChecks] = await Promise.all([
          api.listMarginNotes(stepData.step_id).catch(() => []),
          siteSettings.enable_progress_tracking
            ? api.getTaskChecks(stepData.step_id).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!active) return;
        setMarginNotes(notes);
        if (serverChecks && serverChecks.checked_item_ids.length > 0) {
          const synced = new Set(serverChecks.checked_item_ids);
          setCheckedTaskIds(synced);
          writeLocalTaskChecks(stepData.step_id, synced);
        }
      })
      .catch(() => {
        if (active) setNotFound(true);
      });

    return () => {
      active = false;
    };
  }, [locale, track, chapter, step, location.hash, siteSettings.enable_progress_tracking]);

  const handleToggleTaskCheck = useCallback(
    (itemId: string, checked: boolean) => {
      if (!detail) return;
      const stepId = detail.step_id;

      setCheckedTaskIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(itemId);
        else next.delete(itemId);
        writeLocalTaskChecks(stepId, next);
        return next;
      });

      if (!siteSettings.enable_progress_tracking) return;
      pendingToggleCountRef.current += 1;
      void api
        .toggleTaskCheck(stepId, itemId, checked)
        .then((res) => {
          if (pendingToggleCountRef.current <= 1) {
            const synced = new Set(res.checked_item_ids);
            setCheckedTaskIds(synced);
            writeLocalTaskChecks(stepId, synced);
          }
        })
        .catch(() => {
          // Local storage preserves user's checkbox state offline
        })
        .finally(() => {
          pendingToggleCountRef.current = Math.max(0, pendingToggleCountRef.current - 1);
        });
    },
    [detail, siteSettings.enable_progress_tracking],
  );

  const handleResetBlockTasks = useCallback(
    (itemIds: string[]) => {
      if (!detail || itemIds.length === 0) return;
      const stepId = detail.step_id;
      const toUncheck = itemIds.filter((id) => checkedTaskIds.has(id));

      setCheckedTaskIds((prev) => {
        const next = new Set(prev);
        for (const id of itemIds) next.delete(id);
        writeLocalTaskChecks(stepId, next);
        return next;
      });

      if (!siteSettings.enable_progress_tracking || toUncheck.length === 0) return;
      pendingToggleCountRef.current += toUncheck.length;
      void Promise.all(
        toUncheck.map((id) =>
          api
            .toggleTaskCheck(stepId, id, false)
            .catch(() => null)
            .finally(() => {
              pendingToggleCountRef.current = Math.max(
                0,
                pendingToggleCountRef.current - 1,
              );
            }),
        ),
      );
    },
    [detail, checkedTaskIds, siteSettings.enable_progress_tracking],
  );

  const handleAddNote = useCallback(
    async (blockId: string, color: string, content: string) => {
      if (!detail) return;
      try {
        const created = await api.createMarginNote({
          step_id: detail.step_id,
          locale_code: locale,
          block_anchor_id: blockId,
          note_color: color,
          content,
        });
        setMarginNotes((prev) => [...prev, created]);
      } catch (err) {
        toast.error(err);
      }
    },
    [detail, locale, toast],
  );

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      try {
        await api.deleteMarginNote(noteId);
        setMarginNotes((prev) => prev.filter((n) => n.id !== noteId));
      } catch (err) {
        toast.error(err);
      }
    },
    [toast],
  );

  const handleAdvance = () => {
    if (!detail) return;
    if (detail.next_step) {
      const nextUrl = `/${locale}/tracks/${detail.track_slug}/${detail.next_step.chapter_slug}/${detail.next_step.step_slug}`;
      runDirectionalTransition(() => navigate(nextUrl), 'forward');
    } else {
      runDirectionalTransition(() => navigate(`/${locale}`), 'backward');
    }
  };

  const handleLike = async () => {
    if (!detail || likedSession) return;
    setLikedSession(true);
    try {
      const res = await api.likeStep(detail.step_id);
      setLikes(res.likes_count);
    } catch {
      setLikes((n) => n + 1);
    }
  };

  const allTaskIds = useMemo(
    () =>
      (detail?.blocks ?? []).flatMap((b) => {
        if (b.type === 'heading' && b.is_task) return [b.block_id];
        if (b.type === 'steps') return b.items.map((it) => it.item_id);
        return [];
      }),
    [detail?.blocks],
  );
  const totalTaskCount = allTaskIds.length;
  const doneTaskCount = useMemo(
    () => allTaskIds.filter((id) => checkedTaskIds.has(id)).length,
    [allTaskIds, checkedTaskIds],
  );
  const allTasksDone = totalTaskCount > 0 && doneTaskCount === totalTaskCount;

  if (notFound) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="notebook-sheet-stack">
          <div className="notebook-sheet-card p-8">
            <NotebookEmptyState
              title={copy.stepNotFoundTitle}
              description={copy.stepNotFoundBody}
              actionLabel={copy.backHomeCta}
              onAction={() => navigate(`/${locale}`)}
            />
          </div>
        </div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="h-96 rounded-2xl bg-surface-sheet/50 border border-border-subtle animate-pulse" />
      </main>
    );
  }

  const canonicalLocaleTarget: LocaleCode = detail.available_locales.includes(
    siteSettings.default_locale,
  )
    ? siteSettings.default_locale
    : detail.available_locales.includes('zh-CN')
      ? 'zh-CN'
      : normalizeLocale(detail.available_locales[0]);

  const currentStepUrl = `/${locale}/tracks/${detail.track_slug}/${detail.chapter_slug}/${detail.step_slug}`;
  const firstTrackStep = detail.chapters[0]?.steps[0];
  const seriesRootUrl = firstTrackStep
    ? `/${locale}/tracks/${detail.track_slug}/${detail.chapters[0].slug}/${firstTrackStep.slug}`
    : `/${locale}`;

  return (
    <>
      <div id="reading-progress" aria-hidden="true" />

      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-16 flex items-start gap-8">
        <ChapterSidebarAndDrawer
          locale={locale}
          trackSlug={detail.track_slug}
          trackTitle={detail.track_title}
          currentStepId={detail.step_id}
          articleTaskStats={
            siteSettings.enable_progress_tracking && totalTaskCount > 0
              ? { done: doneTaskCount, total: totalTaskCount }
              : undefined
          }
          chapters={detail.chapters}
          allTracks={allTracks}
          toc={detail.toc}
          mobileOpen={mobileDrawerOpen}
          onCloseMobile={() => setMobileDrawerOpen(false)}
        />

        <main className="flex-1 min-w-0 space-y-5">
          {/* Semantic Breadcrumb Trail (`modern-web-guidance/breadcrumbs`) + Mobile Drawer Trigger */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav
              aria-label={copy.studio.breadcrumbAria}
              className="notebook-breadcrumb min-w-0"
            >
              <ol>
                <li>
                  <Link to={`/${locale}`}>
                    <IconHome className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                    <span>{copy.navHome}</span>
                  </Link>
                </li>
                <li>
                  <Link to={seriesRootUrl} className="text-ink-secondary">
                    {detail.chapter_title}
                  </Link>
                </li>
                <li>
                  <Link
                    to={currentStepUrl}
                    aria-current="page"
                    className="font-mono tabular-nums"
                  >
                    #{String(detail.step_number).padStart(2, '0')}
                  </Link>
                </li>
              </ol>
            </nav>

            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-expanded={mobileDrawerOpen}
              aria-controls="mobile-chapter-drawer"
              className="lg:hidden min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer"
            >
              <IconMenu className="w-3.5 h-3.5 text-ink-secondary" />
              <span>{copy.chapterDrawerButton}</span>
            </button>
          </div>

          {/* Untranslated Graceful Fallback Notice */}
          {detail.is_fallback && (
            <NotebookAlert
              kind="info"
              stampText={copy.alertStamps.info}
              title={copy.fallbackBannerTitle}
              bodyHtml={copy.fallbackBannerBody(detail.resolved_locale)}
            />
          )}

          {/* Translation Revision Drift Notice */}
          {detail.has_revision_drift && (
            <div className="space-y-2">
              <NotebookAlert
                kind="warning"
                stampText={copy.alertStamps.warning}
                title={copy.driftBannerTitle}
                bodyHtml={copy.driftBannerBody(
                  detail.synced_revision,
                  detail.canonical_revision,
                )}
              />
              <div className="-mt-3 ps-2">
                <button
                  type="button"
                  onClick={() => onChangeLocale(canonicalLocaleTarget)}
                  className="min-h-7 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
                >
                  → {copy.switchCanonicalCta(detail.canonical_revision)}
                </button>
              </div>
            </div>
          )}

          {/* Primary Stacked Loose-Leaf Notebook Sheet */}
          <article className="notebook-sheet-stack">
            <div className="notebook-sheet-card p-6 sm:p-10">
              {/* Article Header */}
              <header className="pb-6 mb-6 border-b border-dashed border-border-subtle space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detail.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-surface-raised text-ink-secondary border border-border-subtle"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted tabular-nums">
                    {siteSettings.enable_progress_tracking && totalTaskCount > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-full font-semibold border border-border-subtle ${
                          allTasksDone
                            ? 'text-accent-success'
                            : 'bg-surface-raised text-ink-secondary'
                        }`}
                        style={
                          allTasksDone
                            ? { backgroundColor: 'var(--steps-checked-bg)' }
                            : undefined
                        }
                      >
                        {allTasksDone ? '✓ ' : ''}
                        {copy.articleTasksLabel}{' '}
                        <span className="font-mono">
                          {doneTaskCount}/{totalTaskCount}
                        </span>
                      </span>
                    )}
                    <span>
                      <span className="font-mono">
                        v{detail.version ?? detail.synced_revision}
                      </span>{' '}
                      · {detail.estimated_minutes} {copy.minutesUnit}
                    </span>
                  </div>
                </div>

                <div>
                  <h1
                    className="text-2xl sm:text-3xl font-semibold text-ink-primary leading-tight tracking-tight"
                    style={{ fontFamily: 'var(--font-hand)' }}
                  >
                    <SafeHtml as="span" html={detail.title} />
                  </h1>
                  <MarkerUnderline variant="h1" />
                </div>

                <SafeHtml
                  as="p"
                  html={detail.summary}
                  className="text-base text-ink-secondary leading-relaxed"
                />

                <div className="pt-2 flex flex-wrap items-center gap-2.5 text-xs text-ink-muted">
                  {detail.authors && detail.authors.length > 0 ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {detail.authors.map((a, idx) => (
                          <span
                            key={a.user_id ?? `${a.username}-${idx}`}
                            className="inline-flex items-center gap-1.5"
                          >
                            <UserAvatar
                              name={a.display_name || a.username}
                              avatarUrl={a.avatar_url}
                              sizeClass="w-5 h-5"
                            />
                            <span className="font-semibold text-ink-secondary">
                              {a.display_name || a.username}
                            </span>
                          </span>
                        ))}
                      </div>
                      <span aria-hidden="true">•</span>
                    </>
                  ) : (
                    (detail.author_name?.trim() ||
                      siteSettings.default_author_name?.trim()) && (
                      <>
                        <UserAvatar
                          name={
                            detail.author_name?.trim() ||
                            siteSettings.default_author_name.trim()
                          }
                          sizeClass="w-5 h-5"
                        />
                        <span>
                          @
                          {stripHtmlTags(
                            detail.author_name?.trim() ||
                              siteSettings.default_author_name.trim(),
                          )}
                        </span>
                        <span aria-hidden="true">•</span>
                      </>
                    )
                  )}
                  <span className="font-mono tabular-nums">
                    {String(detail.step_number).padStart(2, '0')} /{' '}
                    {String(detail.total_steps_in_track).padStart(2, '0')}
                  </span>
                </div>
              </header>

              {/* Article Content Blocks via Unified Renderer */}
              <div>
                <NotebookBlockRenderer
                  blocks={detail.blocks}
                  copy={copy}
                  theme={theme}
                  interactive={
                    siteSettings.enable_margin_notes
                      ? {
                          marginNotes,
                          onAddNote: handleAddNote,
                          onDeleteNote: handleDeleteNote,
                        }
                      : undefined
                  }
                  stepChecks={{
                    checkedIds: checkedTaskIds,
                    onToggle: handleToggleTaskCheck,
                    onResetIds: handleResetBlockTasks,
                  }}
                />
              </div>

              {/* Article Footer: Reaction + Task Progress + Creative Commons Stamp + Single Directional Navigation Divider */}
              <footer className="mt-10 space-y-6">
                {(siteSettings.enable_likes ||
                  (siteSettings.enable_progress_tracking && totalTaskCount > 0)) && (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {siteSettings.enable_likes ? (
                      <button
                        type="button"
                        onClick={() => void handleLike()}
                        aria-pressed={likedSession}
                        className="min-h-9 px-4 py-2 rounded-full text-xs font-semibold ink-btn-secondary inline-flex items-center gap-2 cursor-pointer"
                      >
                        <span
                          key={likedSession ? 'liked' : 'idle'}
                          className={
                            likedSession
                              ? 'text-accent-danger ui-badge-pop inline-block'
                              : 'text-ink-muted inline-block'
                          }
                        >
                          ♥
                        </span>
                        <span>{copy.likeStep}</span>
                        <span className="font-mono tabular-nums">({likes})</span>
                      </button>
                    ) : (
                      <span />
                    )}

                    {siteSettings.enable_progress_tracking && totalTaskCount > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        {allTasksDone ? (
                          <strong className="font-semibold text-accent-success tabular-nums">
                            {copy.stepsAllDoneBadge} ·{' '}
                            {copy.stepsProgressLabel(doneTaskCount, totalTaskCount)}
                          </strong>
                        ) : (
                          <span className="tabular-nums">
                            {copy.articleTasksLabel} ·{' '}
                            {copy.stepsProgressLabel(doneTaskCount, totalTaskCount)}
                          </span>
                        )}
                        {doneTaskCount > 0 && (
                          <button
                            type="button"
                            onClick={() => handleResetBlockTasks(allTaskIds)}
                            className="min-h-7 px-2 py-0.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
                          >
                            {copy.stepsResetBtn}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <CcLicenseCard
                  locale={locale}
                  copy={copy}
                  stepLicense={detail.license}
                  siteDefaultLicense={siteSettings.default_license}
                  authorName={
                    detail.authors && detail.authors.length > 0
                      ? detail.authors.map((a) => a.display_name || a.username).join(', ')
                      : stripHtmlTags(
                          detail.author_name?.trim() || siteSettings.default_author_name,
                        )
                  }
                />

                {/* Directional Navigation Row (One Primary Action on the right!) */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-5 border-t border-dashed border-border-subtle">
                  {detail.prev_step ? (
                    <button
                      type="button"
                      onClick={() => {
                        const prev = detail.prev_step!;
                        runDirectionalTransition(
                          () =>
                            navigate(
                              `/${locale}/tracks/${detail.track_slug}/${prev.chapter_slug}/${prev.step_slug}`,
                            ),
                          'backward',
                        );
                      }}
                      className="min-h-10 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-secondary cursor-pointer"
                    >
                      {copy.prevStep} · {detail.prev_step.title}
                    </button>
                  ) : (
                    <span />
                  )}

                  <button
                    type="button"
                    onClick={handleAdvance}
                    className="min-h-10 px-5 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer ms-auto"
                  >
                    {detail.next_step
                      ? copy.nextStepPrimary
                      : copy.finishTrackPrimary}
                  </button>
                </div>
              </footer>
            </div>
          </article>
        </main>
      </div>
    </>
  );
}
