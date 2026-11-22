import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChapterSidebarAndDrawer } from '../components/navigation/ChapterSidebarAndDrawer';
import { CcLicenseCard } from '../components/notebook/CcLicenseCard';
import { MarkerUnderline } from '../components/notebook/MarkerUnderline';
import { NotebookAlert } from '../components/notebook/NotebookAlert';
import { NotebookBlockRenderer } from '../components/notebook/NotebookBlockRenderer';
import type { MarginNoteEditPatch } from '../components/notebook/MarginNoteLayer';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import {
  PixelCatBookmarkSticker,
  PixelHourglassSticker,
  PixelPaperPlaneSticker,
  PixelStarStampSticker,
} from '../components/notebook/PixelStickers';
import { IconCheck, IconHeart, IconHome, IconMenu } from '../components/ui/Icons';
import { useToast } from '../components/ui/ToastProvider';
import { UserAvatar } from '../components/ui/UserAvatar';
import {
  buildBlockAnnotationTarget,
  buildNoteEtag,
} from '../lib/annotationAnchor';
import { api, runDirectionalTransition } from '../lib/api';
import { EXT_COPY, normalizeLocale, UI_COPY } from '../lib/i18n';
import { runLayoutTransition } from '../lib/motion';
import { SafeHtml, stripHtmlTags } from '../lib/sanitizer';
import { writeCachedRouteTitle } from '../lib/siteSettings';
import type { ResolvedTheme } from '../lib/theme';
import type {
  LocaleCode,
  NotebookBlock,
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
  const extCopy = EXT_COPY[locale];
  const toast = useToast();
  const articleSheetRef = useRef<HTMLDivElement>(null);

  const [detail, setDetail] = useState<StepDetailDto | null>(null);
  const [allTracks, setAllTracks] = useState<TrackSummaryDto[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());
  const [marginNotes, setMarginNotes] = useState<UserMarginNoteDto[]>([]);
  const [likes, setLikes] = useState(0);
  const [likedSession, setLikedSession] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const pendingToggleCountRef = useRef(0);

  // Scroll-progress fallback for browsers lacking `animation-timeline: scroll()` OR when reduced motion
  // suppresses the CSS scroll-driven animation (keeps reading progress bar visible without bounce)
  useEffect(() => {
    const bar = document.getElementById('reading-progress');
    if (!bar) return;

    const supportsScrollTimeline = CSS.supports('animation-timeline', 'scroll()');
    const reducedMotionMq =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let listening = false;
    const onScroll = () => {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      bar.style.transform = `scaleX(${ratio})`;
    };

    const syncMode = () => {
      const needsJsFallback =
        !supportsScrollTimeline || Boolean(reducedMotionMq?.matches);
      if (needsJsFallback) {
        if (!listening) {
          window.addEventListener('scroll', onScroll, { passive: true });
          window.addEventListener('resize', onScroll, { passive: true });
          listening = true;
        }
        onScroll();
      } else {
        if (listening) {
          window.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onScroll);
          listening = false;
        }
        bar.style.transform = '';
      }
    };

    syncMode();
    reducedMotionMq?.addEventListener('change', syncMode);
    return () => {
      if (listening) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      }
      reducedMotionMq?.removeEventListener('change', syncMode);
    };
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

    const req =
      !chapter || chapter === '-'
        ? api.getSeriesArticleDetail(locale, track, step)
        : api.getStepDetail(locale, track, chapter, step);

    void req
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
            const targetId = decodeURIComponent(location.hash.slice(1));
            document.getElementById(targetId)?.scrollIntoView();
          });
        } else {
          window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        }

        const [notes, serverChecks] = await Promise.all([
          siteSettings.enable_margin_notes
            ? api.listMarginNotes(stepData.step_id, locale).catch(() => [])
            : Promise.resolve([]),
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
  }, [
    locale,
    track,
    chapter,
    step,
    location.hash,
    siteSettings.enable_margin_notes,
    siteSettings.enable_progress_tracking,
  ]);

  // Keep article margin notes synchronized if deleted/restored from global MyNotesModal
  useEffect(() => {
    if (!detail?.step_id || !siteSettings.enable_margin_notes) return;
    const stepId = detail.step_id;
    const onNotesChanged = () => {
      void api
        .listMarginNotes(stepId, locale)
        .then((notes) => setMarginNotes(notes))
        .catch(() => {});
    };
    window.addEventListener('ihn:notes-changed', onNotesChanged);
    return () => window.removeEventListener('ihn:notes-changed', onNotesChanged);
  }, [detail?.step_id, locale, siteSettings.enable_margin_notes]);

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
    async (blockId: string, patch: MarginNoteEditPatch) => {
      if (!detail) return;
      try {
        const hostBlock = detail.blocks.find((b) => b.block_id === blockId);
        const target = hostBlock
          ? buildBlockAnnotationTarget(
              detail.step_id,
              locale,
              detail.synced_revision,
              hostBlock,
            )
          : undefined;
        const created = await api.createMarginNote({
          step_id: detail.step_id,
          locale_code: locale,
          block_anchor_id: blockId,
          note_color: patch.note_color,
          tone: patch.tone,
          style: patch.style,
          tag: patch.tag,
          target,
          content: patch.content,
        });
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) => [...prev, created]);
        });
      } catch (err) {
        toast.error(err);
      }
    },
    [detail, locale, toast],
  );

  const handleUpdateNote = useCallback(
    async (note: UserMarginNoteDto, patch: MarginNoteEditPatch) => {
      try {
        const updated = await api.updateMarginNote(
          note.id,
          {
            content: patch.content,
            tone: patch.tone,
            style: patch.style,
            tag: patch.tag,
            note_color: patch.note_color,
          },
          buildNoteEtag(note),
        );
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n)),
          );
        });
        toast.success(extCopy.notes.noteUpdatedToast);
      } catch (err) {
        toast.error(err);
      }
    },
    [extCopy.notes.noteUpdatedToast, toast],
  );

  const handleRebindNote = useCallback(
    async (note: UserMarginNoteDto, targetBlock: NotebookBlock) => {
      if (!detail) return;
      try {
        const target = buildBlockAnnotationTarget(
          detail.step_id,
          locale,
          detail.synced_revision,
          targetBlock,
        );
        const updated = await api.updateMarginNote(
          note.id,
          {
            block_anchor_id: targetBlock.block_id,
            target,
          },
          buildNoteEtag(note),
        );
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n)),
          );
        });
        toast.success(extCopy.notes.rebindSuccessToast);
      } catch (err) {
        toast.error(err);
      }
    },
    [detail, extCopy.notes.rebindSuccessToast, locale, toast],
  );

  const handleDeleteNote = useCallback(
    async (note: UserMarginNoteDto) => {
      try {
        const res = await api.deleteMarginNote(note.id, buildNoteEtag(note));
        if (!res.deleted) return;
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) => prev.filter((n) => n.id !== note.id));
        });
        toast.info(extCopy.notes.noteDeletedToast, {
          label: extCopy.notes.undoDeleteBtn,
          onClick: async () => {
            try {
              const restored = await api.restoreMarginNote(note.id);
              runLayoutTransition(articleSheetRef.current, () => {
                setMarginNotes((prev) => [
                  ...prev.filter((n) => n.id !== restored.id),
                  restored,
                ]);
              });
              toast.success(extCopy.notes.noteRestoredToast);
            } catch (err) {
              toast.error(err);
            }
          },
        });
      } catch (err) {
        toast.error(err);
      }
    },
    [
      extCopy.notes.noteDeletedToast,
      extCopy.notes.noteRestoredToast,
      extCopy.notes.undoDeleteBtn,
      toast,
    ],
  );

  const handleAdvance = () => {
    if (!detail) return;
    if (detail.next_step) {
      const nextUrl = `/${locale}/series/${detail.track_slug}/${detail.next_step.step_slug}`;
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

  const currentStepUrl = `/${locale}/series/${detail.track_slug}/${detail.step_slug}`;
  const firstTrackStep = detail.chapters[0]?.steps[0];
  const seriesRootUrl = firstTrackStep
    ? `/${locale}/series/${detail.track_slug}/${firstTrackStep.slug}`
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
                    <IconHome className="w-3.5 h-3.5 opacity-80 shrink-0" />
                    <span>{copy.navHome}</span>
                  </Link>
                </li>
                <li>
                  <Link to={seriesRootUrl} className="text-ink-secondary">
                    <SafeHtml as="span" html={detail.track_title} />
                  </Link>
                </li>
                <li>
                  <Link
                    to={currentStepUrl}
                    aria-current="page"
                    title={stripHtmlTags(detail.title)}
                  >
                    <SafeHtml
                      as="span"
                      html={detail.title}
                      className="truncate max-w-[16rem] sm:max-w-[26rem]"
                    />
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
            <div
              ref={articleSheetRef}
              className="notebook-sheet-card relative p-6 sm:p-10"
            >
              {/* Peeking Pixel Cat Bookmark perched at upper-right sheet edge */}
              <div
                aria-hidden="true"
                className="pointer-events-none select-none hidden sm:block absolute -top-7 end-6 z-20"
              >
                <PixelCatBookmarkSticker size={46} />
              </div>

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
                        {allTasksDone && <IconCheck className="w-3 h-3 inline me-1" />}
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
                    </>
                  ) : (
                    <>
                      <UserAvatar
                        name={
                          detail.author_name?.trim() ||
                          siteSettings.default_author_name?.trim() ||
                          copy.brandName
                        }
                        sizeClass="w-5 h-5"
                      />
                      <span className="font-semibold text-ink-secondary">
                        {stripHtmlTags(
                          detail.author_name?.trim() ||
                            siteSettings.default_author_name?.trim() ||
                            copy.brandName,
                        )}
                      </span>
                    </>
                  )}

                  {detail.published_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <span>{extCopy.reader.publishedAtLabel}</span>
                        <time
                          dateTime={detail.published_at}
                          className="font-mono tabular-nums text-ink-secondary"
                        >
                          {detail.published_at.slice(0, 10)}
                        </time>
                      </span>
                    </>
                  )}

                  {detail.updated_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <span>{extCopy.reader.updatedAtLabel}</span>
                        <time
                          dateTime={detail.updated_at}
                          className="font-mono tabular-nums text-ink-secondary"
                        >
                          {detail.updated_at.slice(0, 10)}
                        </time>
                      </span>
                    </>
                  )}
                </div>
              </header>

              {/* Outdated Article Warning Banner when past configured threshold */}
              {(() => {
                const updatedMs = Date.parse(detail.updated_at || '');
                const daysSinceUpdate = Number.isFinite(updatedMs)
                  ? Math.max(0, Math.floor((Date.now() - updatedMs) / 86_400_000))
                  : 0;
                const threshold = siteSettings.stale_article_days ?? 180;
                if (threshold <= 0 || daysSinceUpdate < threshold) {
                  return null;
                }
                const updatedDateStr = (detail.updated_at || detail.published_at || '').slice(0, 10);
                return (
                  <div
                    role="note"
                    data-stale-notice="true"
                    className="mb-6 p-4 rounded-xl border flex items-start gap-3.5"
                    style={{
                      backgroundColor: 'var(--alert-warn-bg)',
                      borderColor: 'var(--alert-warn-border)',
                    }}
                  >
                    <div className="shrink-0 mt-0.5" aria-hidden="true">
                      <PixelHourglassSticker size={36} />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-semibold border"
                          style={{
                            backgroundColor: 'var(--alert-warn-badge-bg)',
                            color: 'var(--alert-warn-badge-fg)',
                            borderColor: 'var(--alert-warn-border)',
                          }}
                        >
                          {extCopy.reader.staleNoticeBadge}
                        </span>
                        <p
                          className="text-sm font-semibold m-0"
                          style={{ color: 'var(--alert-warn-title)' }}
                        >
                          {extCopy.reader.staleNoticeTitle}
                        </p>
                      </div>
                      <p
                        className="text-xs leading-relaxed m-0"
                        style={{ color: 'var(--alert-warn-body)' }}
                      >
                        {extCopy.reader.staleNoticeBody(daysSinceUpdate, updatedDateStr)}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Article Content Blocks via Unified Renderer */}
              <div>
                <NotebookBlockRenderer
                  blocks={detail.blocks}
                  copy={copy}
                  notesCopy={extCopy.notes}
                  theme={theme}
                  interactive={
                    siteSettings.enable_margin_notes
                      ? {
                          marginNotes,
                          onAddNote: handleAddNote,
                          onUpdateNote: handleUpdateNote,
                          onRebindNote: handleRebindNote,
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
                              ? 'text-accent-danger ui-badge-pop inline-flex items-center'
                              : 'text-ink-muted inline-flex items-center'
                          }
                        >
                          <IconHeart className="w-4 h-4" filled={likedSession} />
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
                          <strong className="font-semibold text-accent-success inline-flex items-center gap-1.5 tabular-nums">
                            <PixelStarStampSticker size={22} />
                            <span>
                              {copy.stepsAllDoneBadge} ·{' '}
                              {copy.stepsProgressLabel(doneTaskCount, totalTaskCount)}
                            </span>
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
                              `/${locale}/series/${detail.track_slug}/${prev.step_slug}`,
                            ),
                          'backward',
                        );
                      }}
                      className="min-h-10 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-secondary cursor-pointer"
                    >
                      {copy.prevStep} · <SafeHtml as="span" html={detail.prev_step.title} />
                    </button>
                  ) : (
                    <span className="hidden sm:inline-flex items-center text-ink-muted">
                      <PixelPaperPlaneSticker size={26} />
                    </span>
                  )}

                  <div className="flex items-center gap-3 ms-auto">
                    {detail.prev_step && (
                      <span className="hidden sm:inline-flex" aria-hidden="true">
                        <PixelPaperPlaneSticker size={24} />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleAdvance}
                      className="min-h-10 px-5 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer"
                    >
                      {detail.next_step
                        ? copy.nextStepPrimary
                        : copy.finishTrackPrimary}
                    </button>
                  </div>
                </div>
              </footer>
            </div>
          </article>
        </main>
      </div>
    </>
  );
}
