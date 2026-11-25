import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
} from 'react-router-dom';
import { ChapterSidebarAndDrawer } from '../components/navigation/ChapterSidebarAndDrawer';
import { ArticleCoverBanner } from '../components/notebook/ArticleCoverBanner';
import { CcLicenseCard } from '../components/notebook/CcLicenseCard';
import { MarkerUnderline } from '../components/notebook/MarkerUnderline';
import { NotebookAlert } from '../components/notebook/NotebookAlert';
import { NotebookBlockRenderer } from '../components/notebook/NotebookBlockRenderer';
import {
  MarginNoteEditorForm,
  type MarginNoteEditPatch,
} from '../components/notebook/MarginNoteLayer';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import {
  PixelHourglassSticker,
  PixelStarStampSticker,
} from '../components/notebook/PixelStickers';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconChapterList,
  IconCheck,
  IconClock,
  IconClose,
  IconCopy,
  IconEdit,
  IconHeart,
  IconHighlighter,
  IconHome,
  IconMenu,
  IconPen,
  IconTag,
  TrackHandIcon,
} from '../components/ui/Icons';
import { useToast } from '../components/ui/ToastProvider';
import { UserAvatar } from '../components/ui/UserAvatar';
import {
  buildBlockAnnotationTarget,
  buildNoteEtag,
  captureSelectionWithinContainer,
  type SelectionAnchorDraft,
} from '../lib/annotationAnchor';
import {
  api,
  getActiveStorageScopeKey,
  isLikelyOfflineNetworkError,
  runDirectionalTransition,
} from '../lib/api';
import { resolveLocalizedError } from '../lib/apiError';
import { EXT_COPY, normalizeLocale, UI_COPY } from '../lib/i18n';
import {
  readViewCache,
  scopedViewCacheKey,
  writeViewCache,
} from '../lib/viewCache';
import { runLayoutTransition } from '../lib/motion';
import {
  buildOptimisticHtmlFromMarkdown,
  enqueueOfflineCreateNote,
  enqueueOfflineDeleteNote,
  enqueueOfflineUpdateNote,
  flushOfflineNoteQueue,
  isOfflineTempNoteId,
  mergeOfflineQueueIntoNotes,
} from '../lib/offlineNoteQueue';
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
  authScopeKey?: string;
  canAuthorEdit?: boolean;
  onChangeLocale: (next: LocaleCode) => void;
}

function taskChecksStorageKey(scopeKey: string, stepId: string): string {
  return `icehandnote_task_checks::${scopeKey}::${stepId}`;
}

function readLocalTaskChecks(
  scopeKey: string,
  stepId: string,
  defaultCheckedIds: string[],
): { ids: Set<string>; hasRecord: boolean } {
  try {
    const raw =
      localStorage.getItem(taskChecksStorageKey(scopeKey, stepId)) ??
      (scopeKey.startsWith('anon:')
        ? localStorage.getItem(`icehandnote_task_checks_${stepId}`) ??
          localStorage.getItem(`icetowne_task_checks_${stepId}`)
        : null);
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

function writeLocalTaskChecks(
  scopeKey: string,
  stepId: string,
  ids: Set<string>,
): void {
  try {
    localStorage.setItem(
      taskChecksStorageKey(scopeKey, stepId),
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
  authScopeKey = 'anon',
  canAuthorEdit = false,
  onChangeLocale,
}: StepReaderPageProps) {
  const { track = '', chapter = '', step = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const scrollCacheKey = `scroll:${location.pathname}`;
  const restoredScrollPathRef = useRef<string | null>(null);
  const canPersistScrollRef = useRef(false);
  const copy = UI_COPY[locale];
  const extCopy = EXT_COPY[locale];
  const toast = useToast();
  const articleSheetRef = useRef<HTMLDivElement>(null);

  const storageScope = getActiveStorageScopeKey();
  const detailCacheKey = scopedViewCacheKey(
    storageScope,
    `step:${locale}:${track}:${chapter || '-'}:${step}`,
  );
  const siblingTracksCacheKey = scopedViewCacheKey(
    storageScope,
    `home:tracks:${locale}`,
  );
  const routeKey = `${locale}:${track}:${chapter || '-'}:${step}`;
  const prevRouteKeyRef = useRef(routeKey);

  const [detail, setDetail] = useState<StepDetailDto | null>(() =>
    readViewCache<StepDetailDto>(detailCacheKey),
  );
  const [allTracks, setAllTracks] = useState<TrackSummaryDto[]>(
    () => readViewCache<TrackSummaryDto[]>(siblingTracksCacheKey) ?? [],
  );
  const [notFound, setNotFound] = useState(false);
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());
  const [marginNotes, setMarginNotes] = useState<UserMarginNoteDto[]>([]);
  const [selectionDraft, setSelectionDraft] = useState<SelectionAnchorDraft | null>(null);
  const [selectionComposing, setSelectionComposing] = useState(false);
  const selectionComposingRef = useRef(false);
  selectionComposingRef.current = selectionComposing;
  const [isMobileSelectionUi, setIsMobileSelectionUi] = useState(() =>
    typeof window !== 'undefined'
      ? window.innerWidth < 640 || Boolean(window.matchMedia?.('(pointer: coarse)').matches)
      : false,
  );
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [likes, setLikes] = useState(() => detail?.likes_count ?? 0);
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
    const cachedList = readViewCache<TrackSummaryDto[]>(siblingTracksCacheKey);
    if (cachedList) {
      setAllTracks(cachedList);
    }
    void api
      .listTracks(locale)
      .then((list) => {
        if (!active) return;
        writeViewCache(siblingTracksCacheKey, list);
        setAllTracks(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [locale, siblingTracksCacheKey]);

  // Fetch article detail ONLY on route/locale changes (never on `#hash` changes)
  useEffect(() => {
    let active = true;
    const isRouteNavigation = prevRouteKeyRef.current !== routeKey;
    prevRouteKeyRef.current = routeKey;
    let didScrollTop = false;
    const shouldResetScrollTop =
      isRouteNavigation && navigationType !== 'POP' && !window.location.hash;
    const cachedDetail = readViewCache<StepDetailDto>(detailCacheKey);
    if (cachedDetail) {
      setDetail(cachedDetail);
      setLikes(cachedDetail.likes_count);
      if (shouldResetScrollTop) {
        didScrollTop = true;
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      }
    } else if (isRouteNavigation) {
      setDetail(null);
    }
    setNotFound(false);

    const req =
      !chapter || chapter === '-'
        ? api.getSeriesArticleDetail(locale, track, step)
        : api.getStepDetail(locale, track, chapter, step);

    void req
      .then((stepData) => {
        if (!active) return;
        writeViewCache(detailCacheKey, stepData);
        setDetail(stepData);
        setLikes(stepData.likes_count);
        if (isRouteNavigation) {
          setLikedSession(false);
          if (!didScrollTop && shouldResetScrollTop) {
            window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
          }
        }
      })
      .catch(() => {
        if (active && !cachedDetail) setNotFound(true);
      });

    return () => {
      active = false;
    };
  }, [locale, track, chapter, step, detailCacheKey, routeKey, navigationType]);

  // Restore saved scroll offset synchronously before paint on reload/back-forward navigation
  useLayoutEffect(() => {
    if (!detail) return;
    if (restoredScrollPathRef.current === location.pathname) {
      canPersistScrollRef.current = true;
      return;
    }
    restoredScrollPathRef.current = location.pathname;
    if (navigationType === 'POP' && !window.location.hash) {
      const savedY = readViewCache<number>(scrollCacheKey);
      if (typeof savedY === 'number' && savedY > 0) {
        window.scrollTo({ top: savedY, behavior: 'instant' as ScrollBehavior });
        const rafId = window.requestAnimationFrame(() => {
          if (window.scrollY === 0) {
            window.scrollTo({
              top: savedY,
              behavior: 'instant' as ScrollBehavior,
            });
          }
          canPersistScrollRef.current = true;
        });
        return () => window.cancelAnimationFrame(rafId);
      }
    }
    canPersistScrollRef.current = true;
  }, [detail, location.pathname, navigationType, scrollCacheKey]);

  // Persist active route scroll offset into sessionStorage for SPA reloads
  useEffect(() => {
    let rafId = 0;
    const saveScroll = () => {
      if (!canPersistScrollRef.current) return;
      writeViewCache(scrollCacheKey, Math.max(0, Math.round(window.scrollY)));
    };
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        saveScroll();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', saveScroll);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      saveScroll();
      canPersistScrollRef.current = false;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', saveScroll);
    };
  }, [scrollCacheKey]);

  // Smooth/accurate `#hash` scrolling without refetching article detail
  useEffect(() => {
    if (!detail?.step_id || !location.hash) return;
    const raf = window.requestAnimationFrame(() => {
      try {
        const targetId = decodeURIComponent(location.hash.slice(1));
        if (targetId) {
          document.getElementById(targetId)?.scrollIntoView();
        }
      } catch {
        // Ignore malformed percent-encoding in URL hash
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [detail?.step_id, location.hash]);

  // Load/reload user-isolated margin notes & task checks whenever article or auth identity changes
  useEffect(() => {
    if (!detail) return;
    let active = true;
    const stepId = detail.step_id;
    const scopeKey = getActiveStorageScopeKey();
    const defaultCheckedIds = detail.blocks.flatMap((b) => {
      if (b.type === 'heading' && b.is_task && b.default_checked) {
        return [b.block_id];
      }
      if (b.type === 'steps') {
        return b.items.filter((it) => it.default_checked).map((it) => it.item_id);
      }
      return [];
    });

    const local = readLocalTaskChecks(scopeKey, stepId, defaultCheckedIds);
    setCheckedTaskIds(local.ids);
    setMarginNotes([]);

    void Promise.all([
      siteSettings.enable_margin_notes
        ? api.listMarginNotes(stepId, locale).catch(() => [])
        : Promise.resolve([]),
      siteSettings.enable_progress_tracking
        ? api.getTaskChecks(stepId).catch(() => null)
        : Promise.resolve(null),
    ]).then(async ([notes, serverChecks]) => {
      const mergedNotes = siteSettings.enable_margin_notes
        ? await mergeOfflineQueueIntoNotes(stepId, locale, notes, scopeKey)
        : [];
      if (!active) return;
      setMarginNotes(mergedNotes);
      if (serverChecks !== null) {
        const synced = new Set(serverChecks.checked_item_ids);
        setCheckedTaskIds(synced);
        writeLocalTaskChecks(scopeKey, stepId, synced);
      }
    });

    return () => {
      active = false;
    };
  }, [
    detail,
    locale,
    authScopeKey,
    siteSettings.enable_margin_notes,
    siteSettings.enable_progress_tracking,
  ]);

  // Keep article margin notes synchronized if deleted/restored from global MyNotesModal
  useEffect(() => {
    if (!detail?.step_id || !siteSettings.enable_margin_notes) return;
    const stepId = detail.step_id;
    const scopeKey = getActiveStorageScopeKey();
    const onNotesChanged = () => {
      void api
        .listMarginNotes(stepId, locale)
        .then((notes) => mergeOfflineQueueIntoNotes(stepId, locale, notes, scopeKey))
        .then((merged) => setMarginNotes(merged))
        .catch(() => {});
    };
    window.addEventListener('ihn:notes-changed', onNotesChanged);
    return () => window.removeEventListener('ihn:notes-changed', onNotesChanged);
  }, [detail?.step_id, locale, authScopeKey, siteSettings.enable_margin_notes]);

  // Auto-flush IndexedDB offline note queue when network reconnects or article opens online
  useEffect(() => {
    if (!detail?.step_id || !siteSettings.enable_margin_notes) return;
    const stepId = detail.step_id;
    const scopeKey = getActiveStorageScopeKey();
    let active = true;

    const syncOfflineQueue = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const result = await flushOfflineNoteQueue(api, scopeKey);
      if (!active) return;
      if (result.synced > 0) {
        toast.success(extCopy.notes.offlineSyncedToast(result.synced));
      }
      if (result.conflicts > 0 || result.dropped > 0) {
        toast.warning(resolveLocalizedError('CONFLICT', locale));
      }
      if (result.synced > 0 || result.dropped > 0) {
        const latest = await api.listMarginNotes(stepId, locale).catch(() => null);
        if (active && latest) {
          const merged = await mergeOfflineQueueIntoNotes(stepId, locale, latest, scopeKey);
          if (active) setMarginNotes(merged);
        }
      }
    };

    void syncOfflineQueue();
    const onOnline = () => {
      void syncOfflineQueue();
    };
    window.addEventListener('online', onOnline);
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
    };
  }, [
    detail?.step_id,
    locale,
    authScopeKey,
    siteSettings.enable_margin_notes,
    extCopy.notes,
    toast,
  ]);

  // Track narrow viewports / coarse touch pointers for bottom-docked selection toolbar
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const coarseMq = window.matchMedia?.('(pointer: coarse)') ?? null;
    const updateMode = () => {
      setIsMobileSelectionUi(
        window.innerWidth < 640 || Boolean(coarseMq?.matches),
      );
    };
    updateMode();
    window.addEventListener('resize', updateMode, { passive: true });
    coarseMq?.addEventListener('change', updateMode);
    return () => {
      window.removeEventListener('resize', updateMode);
      coarseMq?.removeEventListener('change', updateMode);
    };
  }, []);

  // Track visualViewport height offset while selection popover/composer is open above virtual keyboard
  useEffect(() => {
    if (!selectionDraft || typeof window === 'undefined') {
      setKeyboardBottomInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      setKeyboardBottomInset(0);
      return;
    }
    const updateInset = () => {
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setKeyboardBottomInset(inset);
    };
    updateInset();
    vv.addEventListener('resize', updateInset);
    vv.addEventListener('scroll', updateInset);
    return () => {
      vv.removeEventListener('resize', updateInset);
      vv.removeEventListener('scroll', updateInset);
    };
  }, [selectionDraft]);

  // Capture passage text selections for semantic `<mark>` highlight & annotation popover
  useEffect(() => {
    if (!detail?.step_id || !siteSettings.enable_margin_notes) {
      setSelectionDraft(null);
      setSelectionComposing(false);
      return;
    }

    let selChangeTimer: number | null = null;

    const handleSelectionCheck = (e: Event) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('[data-selection-popover="true"]')
      ) {
        return;
      }
      window.requestAnimationFrame(() => {
        const container = articleSheetRef.current;
        if (!container) return;
        const captured = captureSelectionWithinContainer(
          container,
          detail.step_id,
          locale,
          detail.synced_revision,
        );
        if (captured) {
          setSelectionDraft(captured);
          setSelectionComposing(false);
        } else {
          setSelectionDraft(null);
          setSelectionComposing(false);
        }
      });
    };

    const handleSelectionChange = () => {
      if (selectionComposingRef.current) return;
      const activeEl = document.activeElement;
      if (
        activeEl instanceof Element &&
        activeEl.closest('[data-selection-popover="true"]')
      ) {
        return;
      }
      if (selChangeTimer !== null) {
        window.clearTimeout(selChangeTimer);
      }
      selChangeTimer = window.setTimeout(() => {
        selChangeTimer = null;
        if (selectionComposingRef.current) return;
        const container = articleSheetRef.current;
        if (!container) return;
        const captured = captureSelectionWithinContainer(
          container,
          detail.step_id,
          locale,
          detail.synced_revision,
        );
        setSelectionDraft(captured);
        if (!captured) {
          setSelectionComposing(false);
        }
      }, 140);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectionDraft(null);
        setSelectionComposing(false);
      }
    };

    const handleViewportChange = () => {
      if (selectionComposingRef.current) return;
      const container = articleSheetRef.current;
      if (!container) {
        setSelectionDraft(null);
        return;
      }
      const captured = captureSelectionWithinContainer(
        container,
        detail.step_id,
        locale,
        detail.synced_revision,
      );
      setSelectionDraft(captured);
    };

    document.addEventListener('mouseup', handleSelectionCheck);
    document.addEventListener('touchend', handleSelectionCheck);
    document.addEventListener('keyup', handleSelectionCheck);
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleViewportChange, { passive: true });
    window.addEventListener('resize', handleViewportChange, { passive: true });
    return () => {
      if (selChangeTimer !== null) {
        window.clearTimeout(selChangeTimer);
      }
      document.removeEventListener('mouseup', handleSelectionCheck);
      document.removeEventListener('touchend', handleSelectionCheck);
      document.removeEventListener('keyup', handleSelectionCheck);
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [
    detail?.step_id,
    detail?.synced_revision,
    locale,
    siteSettings.enable_margin_notes,
  ]);

  const handleToggleTaskCheck = useCallback(
    (itemId: string, checked: boolean) => {
      if (!detail) return;
      const stepId = detail.step_id;
      const scopeKey = getActiveStorageScopeKey();

      setCheckedTaskIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(itemId);
        else next.delete(itemId);
        writeLocalTaskChecks(scopeKey, stepId, next);
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
            writeLocalTaskChecks(scopeKey, stepId, synced);
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
      const scopeKey = getActiveStorageScopeKey();
      const toUncheck = itemIds.filter((id) => checkedTaskIds.has(id));

      setCheckedTaskIds((prev) => {
        const next = new Set(prev);
        for (const id of itemIds) next.delete(id);
        writeLocalTaskChecks(scopeKey, stepId, next);
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
      const hostBlock = detail.blocks.find((b) => b.block_id === blockId);
      const target =
        patch.target ??
        (hostBlock
          ? buildBlockAnnotationTarget(
              detail.step_id,
              locale,
              detail.synced_revision,
              hostBlock,
            )
          : undefined);
      const payload = {
        step_id: detail.step_id,
        locale_code: locale,
        block_anchor_id: blockId,
        note_color: patch.note_color,
        tone: patch.tone,
        style: patch.style,
        tag: patch.tag,
        motivation: patch.motivation,
        target,
        content: patch.content,
      };
      try {
        const created = await api.createMarginNote(payload);
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) => [...prev, created]);
        });
      } catch (err) {
        if (isLikelyOfflineNetworkError(err)) {
          try {
            const optimistic = await enqueueOfflineCreateNote(payload);
            runLayoutTransition(articleSheetRef.current, () => {
              setMarginNotes((prev) => [...prev, optimistic]);
            });
            toast.info(extCopy.notes.offlineQueuedToast);
            return;
          } catch {
            // fall through if IndexedDB unavailable
          }
        }
        toast.error(err);
      }
    },
    [detail, extCopy.notes.offlineQueuedToast, locale, toast],
  );

  const handleUpdateNote = useCallback(
    async (note: UserMarginNoteDto, patch: MarginNoteEditPatch) => {
      const updateBody = {
        content: patch.content,
        tone: patch.tone,
        style: patch.style,
        tag: patch.tag,
        note_color: patch.note_color,
      };
      if (isOfflineTempNoteId(note.id)) {
        await enqueueOfflineUpdateNote(note.id, updateBody);
        setMarginNotes((prev) =>
          prev.map((n) =>
            n.id === note.id
              ? {
                  ...n,
                  raw_content: patch.content,
                  content_html: buildOptimisticHtmlFromMarkdown(patch.content),
                  tone: patch.tone,
                  style: patch.style,
                  tag: patch.tag,
                  note_color: patch.note_color,
                  pendingSync: true,
                }
              : n,
          ),
        );
        toast.info(extCopy.notes.offlineQueuedToast);
        return;
      }
      try {
        const updated = await api.updateMarginNote(
          note.id,
          updateBody,
          buildNoteEtag(note),
        );
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n)),
          );
        });
        toast.success(extCopy.notes.noteUpdatedToast);
      } catch (err) {
        if (isLikelyOfflineNetworkError(err)) {
          try {
            await enqueueOfflineUpdateNote(
              note.id,
              updateBody,
              buildNoteEtag(note),
            );
            setMarginNotes((prev) =>
              prev.map((n) =>
                n.id === note.id
                  ? {
                      ...n,
                      raw_content: patch.content,
                      content_html: buildOptimisticHtmlFromMarkdown(patch.content),
                      tone: patch.tone,
                      style: patch.style,
                      tag: patch.tag,
                      note_color: patch.note_color,
                      pendingSync: true,
                    }
                  : n,
              ),
            );
            toast.info(extCopy.notes.offlineQueuedToast);
            return;
          } catch {
            // fall through
          }
        }
        toast.error(err);
      }
    },
    [
      extCopy.notes.noteUpdatedToast,
      extCopy.notes.offlineQueuedToast,
      toast,
    ],
  );

  const handleRebindNote = useCallback(
    async (note: UserMarginNoteDto, targetBlock: NotebookBlock) => {
      if (!detail) return;
      const target = buildBlockAnnotationTarget(
        detail.step_id,
        locale,
        detail.synced_revision,
        targetBlock,
      );
      const rebindBody = {
        block_anchor_id: targetBlock.block_id,
        motivation: 'commenting' as const,
        target,
      };
      if (isOfflineTempNoteId(note.id)) {
        await enqueueOfflineUpdateNote(note.id, rebindBody);
        setMarginNotes((prev) =>
          prev.map((n) =>
            n.id === note.id
              ? {
                  ...n,
                  block_anchor_id: targetBlock.block_id,
                  motivation: 'commenting',
                  target,
                  pendingSync: true,
                }
              : n,
          ),
        );
        toast.info(extCopy.notes.offlineQueuedToast);
        return;
      }
      try {
        const updated = await api.updateMarginNote(
          note.id,
          rebindBody,
          buildNoteEtag(note),
        );
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n)),
          );
        });
        toast.success(extCopy.notes.rebindSuccessToast);
      } catch (err) {
        if (isLikelyOfflineNetworkError(err)) {
          try {
            await enqueueOfflineUpdateNote(
              note.id,
              rebindBody,
              buildNoteEtag(note),
            );
            setMarginNotes((prev) =>
              prev.map((n) =>
                n.id === note.id
                  ? {
                      ...n,
                      block_anchor_id: targetBlock.block_id,
                      target,
                      pendingSync: true,
                    }
                  : n,
              ),
            );
            toast.info(extCopy.notes.offlineQueuedToast);
            return;
          } catch {
            // fall through
          }
        }
        toast.error(err);
      }
    },
    [
      detail,
      extCopy.notes.offlineQueuedToast,
      extCopy.notes.rebindSuccessToast,
      locale,
      toast,
    ],
  );

  const handleDeleteNote = useCallback(
    async (note: UserMarginNoteDto) => {
      if (isOfflineTempNoteId(note.id)) {
        await enqueueOfflineDeleteNote(note.id);
        runLayoutTransition(articleSheetRef.current, () => {
          setMarginNotes((prev) => prev.filter((n) => n.id !== note.id));
        });
        toast.info(extCopy.notes.noteDeletedToast);
        return;
      }
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
        if (isLikelyOfflineNetworkError(err)) {
          try {
            await enqueueOfflineDeleteNote(note.id, buildNoteEtag(note));
            runLayoutTransition(articleSheetRef.current, () => {
              setMarginNotes((prev) => prev.filter((n) => n.id !== note.id));
            });
            toast.info(extCopy.notes.offlineQueuedToast);
            return;
          } catch {
            // fall through
          }
        }
        toast.error(err);
      }
    },
    [
      extCopy.notes.noteDeletedToast,
      extCopy.notes.noteRestoredToast,
      extCopy.notes.offlineQueuedToast,
      extCopy.notes.undoDeleteBtn,
      toast,
    ],
  );

  const handleAdvance = () => {
    if (!detail) return;
    if (detail.next_step) {
      const next = detail.next_step;
      const nextUrl =
        detail.chapters.length > 1 && next.chapter_slug
          ? `/${locale}/series/${detail.track_slug}/${next.chapter_slug}/${next.step_slug}`
          : `/${locale}/series/${detail.track_slug}/${next.step_slug}`;
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
        <div className="h-96 rounded-2xl bg-surface-sheet/50 border border-border-subtle motion-safe:animate-pulse ui-skeleton-delayed" />
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

  const isMultiChapter = detail.chapters.length > 1;
  const currentStepUrl = isMultiChapter
    ? `/${locale}/series/${detail.track_slug}/${detail.chapter_slug}/${detail.step_slug}`
    : `/${locale}/series/${detail.track_slug}/${detail.step_slug}`;
  const firstTrackStep = detail.chapters[0]?.steps[0];
  const seriesRootUrl = firstTrackStep
    ? isMultiChapter
      ? `/${locale}/series/${detail.track_slug}/${detail.chapters[0].slug}/${firstTrackStep.slug}`
      : `/${locale}/series/${detail.track_slug}/${firstTrackStep.slug}`
    : `/${locale}`;
  const studioEditUrl = `/${locale}/studio?section=editor&track=${encodeURIComponent(detail.track_slug)}&chapter=${encodeURIComponent(detail.chapter_slug)}&step=${encodeURIComponent(detail.step_slug)}&edit_locale=${encodeURIComponent(detail.resolved_locale)}`;

  const handleCopyArticleUrl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}${currentStepUrl}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(fullUrl)
        .then(() => toast.success(extCopy.reader.copiedUrlToast))
        .catch((err) => toast.error(err));
    }
  };

  return (
    <>
      <div id="reading-progress" aria-hidden="true" />

      <div className="w-full max-w-6xl mx-auto px-3.5 sm:px-6 pt-4 sm:pt-6 pb-20 sm:pb-16 flex items-start gap-8">
        <ChapterSidebarAndDrawer
          locale={locale}
          trackSlug={detail.track_slug}
          trackTitle={detail.track_title}
          trackIconKind={detail.track_icon_kind}
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
                {isMultiChapter && detail.chapter_title && (
                  <li className="hidden sm:flex">
                    <span className="text-ink-muted truncate max-w-44">
                      <SafeHtml as="span" html={detail.chapter_title} />
                    </span>
                  </li>
                )}
                <li>
                  <Link
                    to={currentStepUrl}
                    aria-current="page"
                    title={stripHtmlTags(detail.title)}
                  >
                    <SafeHtml
                      as="span"
                      html={detail.title}
                      className="truncate max-w-[12rem] sm:max-w-[26rem]"
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
              className="lg:hidden min-h-9 px-3 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer ink-icon-target"
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
                  className="min-h-7 text-xs font-semibold text-link-ink hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <IconArrowRight className="w-3.5 h-3.5" />
                  <span>{copy.switchCanonicalCta(detail.canonical_revision)}</span>
                </button>
              </div>
            </div>
          )}

          {/* Primary Loose-Leaf Notebook Sheet */}
          <article className="notebook-sheet-stack">
            <div
              ref={articleSheetRef}
              className="notebook-sheet-card relative p-5 sm:p-8 lg:p-10"
            >
              {/* Author-Configured Hero Cover Banner (`fetchpriority="high"` when present) */}
              {Boolean(detail.cover_image?.trim()) && (
                <div className="mb-6 rounded-2xl overflow-hidden border border-border-subtle">
                  <ArticleCoverBanner
                    variant="hero"
                    priority
                    coverUrl={detail.cover_image}
                    title={detail.title}
                    trackSlug={detail.track_slug}
                    trackTitle={detail.track_title}
                    trackIconKind={detail.track_icon_kind}
                    stepSlug={detail.step_slug}
                    stepNumber={detail.step_number}
                    tags={detail.tags}
                  />
                </div>
              )}

              {/* Article Header */}
              <header className="pb-6 mb-6 border-b border-dashed border-border-subtle space-y-4">
                {/* Tier 1: Series Kicker + Quick Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <Link
                      to={seriesRootUrl}
                      className="inline-flex items-center gap-1.5 font-semibold text-link-ink no-underline hover:underline"
                    >
                      <TrackHandIcon kind={detail.track_icon_kind} className="w-4 h-4" />
                      <SafeHtml as="span" html={detail.track_title} />
                    </Link>
                    <span aria-hidden="true" className="text-ink-muted">·</span>
                    <span className="font-mono text-ink-secondary tabular-nums">
                      {extCopy.reader.chapterPositionLabel(
                        detail.step_number,
                        detail.total_steps_in_track,
                      )}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleCopyArticleUrl}
                      className="min-h-8 sm:min-h-7 px-2.5 py-1 rounded-lg border border-border-subtle bg-surface-raised hover:border-border-ink text-xs font-semibold text-ink-secondary inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <IconCopy className="w-3.5 h-3.5 text-ink-muted" />
                      <span>{extCopy.reader.copyUrlBtn}</span>
                    </button>

                    {canAuthorEdit && (
                      <Link
                        to={studioEditUrl}
                        className="min-h-8 sm:min-h-7 px-2.5 py-1 rounded-lg border border-border-subtle bg-action-subtle/70 hover:border-link-ink text-xs font-semibold text-link-ink no-underline inline-flex items-center gap-1.5 transition-colors"
                      >
                        <IconEdit className="w-3.5 h-3.5" />
                        <span>{extCopy.reader.editChapterBtn}</span>
                      </Link>
                    )}
                  </div>
                </div>

                {/* Tier 2: Main Article Headline + Delicate Nib Rule */}
                <div>
                  <h1
                    className="text-2xl sm:text-3xl font-semibold text-ink-primary leading-tight tracking-tight text-balance m-0"
                    style={{ fontFamily: 'var(--font-hand)' }}
                  >
                    <SafeHtml as="span" html={detail.title} />
                  </h1>
                  <MarkerUnderline variant="h1" />
                </div>

                {/* Tier 3: Clean Editorial Lead Paragraph */}
                {detail.summary.trim() && (
                  <SafeHtml
                    as="p"
                    html={detail.summary}
                    className="text-base text-ink-secondary leading-relaxed pretty-text max-w-[65ch] m-0"
                  />
                )}

                {/* Tier 4: Quiet Metadata Strip (Authors, Dates, Reading Time, Version, Tasks) */}
                <div className="pt-1 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-ink-muted">
                  {detail.authors && detail.authors.length > 0 ? (
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
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
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
                    </span>
                  )}

                  {detail.published_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <IconCalendar className="w-3.5 h-3.5" />
                        <time
                          dateTime={detail.published_at}
                          className="font-mono tabular-nums text-ink-secondary"
                        >
                          {detail.published_at.slice(0, 10)}
                        </time>
                      </span>
                    </>
                  )}

                  {detail.updated_at &&
                    detail.updated_at.slice(0, 10) !==
                      (detail.published_at || '').slice(0, 10) && (
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

                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 tabular-nums text-ink-secondary">
                    <IconClock className="w-3.5 h-3.5 text-ink-muted" />
                    <span>
                      {detail.estimated_minutes} {copy.minutesUnit}
                    </span>
                  </span>

                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-ink-muted tabular-nums">
                    v{detail.version ?? detail.synced_revision}
                  </span>

                  {siteSettings.enable_progress_tracking && totalTaskCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                          allTasksDone ? 'text-accent-success' : 'text-ink-secondary'
                        }`}
                      >
                        {allTasksDone && <IconCheck className="w-3 h-3" />}
                        <span>
                          {copy.articleTasksLabel} {doneTaskCount}/{totalTaskCount}
                        </span>
                      </span>
                    </>
                  )}
                </div>

                {/* Tier 5: Plain Tags */}
                {detail.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono text-ink-muted">
                    <IconTag className="w-3.5 h-3.5 shrink-0" />
                    {detail.tags.map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </div>
                )}

                {/* Tier 6: Inline Collapsible Article Outline for Mobile & Tablet */}
                {detail.toc.length >= 2 && (
                  <details className="lg:hidden sidebar-chapter-group rounded-xl border border-border-subtle bg-surface-raised/60 px-3.5 py-2">
                    <summary className="justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-primary">
                        <IconChapterList className="w-3.5 h-3.5 text-link-ink" />
                        <span>{extCopy.reader.articleOutlineLabel}</span>
                      </span>
                      <span className="font-mono text-xs text-ink-muted tabular-nums">
                        {detail.toc.length}
                      </span>
                    </summary>
                    <ol className="list-none m-0 p-0 pt-2 mt-2 border-t border-dashed border-border-subtle space-y-1">
                      {detail.toc.map((item) => (
                        <li key={item.id}>
                          <a
                            href={`#${item.id}`}
                            className="flex items-baseline gap-2 py-1 px-1.5 rounded-lg text-xs no-underline text-ink-secondary hover:text-ink-primary transition-colors"
                            style={{ paddingInlineStart: `${6 + (item.level - 1) * 8}px` }}
                          >
                            <span className="font-mono font-semibold text-link-ink shrink-0">
                              {item.number}
                            </span>
                            <span className="truncate">{stripHtmlTags(item.text)}</span>
                          </a>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
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
                        className="min-h-10 sm:min-h-9 px-4 py-2 rounded-full text-xs font-semibold ink-btn-secondary inline-flex items-center gap-2 cursor-pointer"
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

                {/* Quiet Directional Prev / Next Series Navigation Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-5 border-t border-dashed border-border-subtle">
                  {detail.prev_step ? (
                    <button
                      type="button"
                      onClick={() => {
                        const prev = detail.prev_step!;
                        const prevHref =
                          isMultiChapter && prev.chapter_slug
                            ? `/${locale}/series/${detail.track_slug}/${prev.chapter_slug}/${prev.step_slug}`
                            : `/${locale}/series/${detail.track_slug}/${prev.step_slug}`;
                        runDirectionalTransition(() => navigate(prevHref), 'backward');
                      }}
                      className="w-full p-3.5 rounded-xl border border-border-subtle hover:border-border-ink bg-surface-raised/55 hover:bg-surface-raised text-start flex flex-col items-start gap-1 cursor-pointer transition-colors"
                    >
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-ink-muted">
                        <IconArrowLeft className="w-3.5 h-3.5" />
                        <span>{copy.prevStep.replace(/^←\s*/, '')}</span>
                      </span>
                      <span className="text-sm font-semibold text-ink-primary line-clamp-1">
                        <SafeHtml as="span" html={detail.prev_step.title} />
                      </span>
                    </button>
                  ) : (
                    <div className="hidden sm:block" />
                  )}

                  <button
                    type="button"
                    onClick={handleAdvance}
                    className={`w-full p-3.5 rounded-xl border text-end flex flex-col items-end gap-1 cursor-pointer transition-colors ${
                      detail.next_step
                        ? 'border-border-control bg-surface-raised/75 hover:border-link-ink hover:bg-action-subtle/35'
                        : 'border-border-subtle bg-surface-raised/45 hover:border-border-ink hover:bg-surface-raised'
                    }`}
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-mono font-semibold ${
                        detail.next_step ? 'text-link-ink' : 'text-ink-muted'
                      }`}
                    >
                      <span>
                        {(detail.next_step
                          ? copy.nextStepPrimary
                          : copy.finishTrackPrimary
                        ).replace(/\s*→$/, '')}
                      </span>
                      {detail.next_step ? (
                        <IconArrowRight className="w-3.5 h-3.5" />
                      ) : (
                        <IconHome className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <span className="text-sm font-semibold text-ink-primary line-clamp-1">
                      {detail.next_step ? (
                        <SafeHtml as="span" html={detail.next_step.title} />
                      ) : (
                        <SafeHtml as="span" html={detail.track_title} />
                      )}
                    </span>
                  </button>
                </div>
              </footer>
            </div>
          </article>

          {selectionDraft && siteSettings.enable_margin_notes && (
            <div
              data-selection-popover="true"
              role="dialog"
              aria-modal="false"
              aria-label={extCopy.notes.annotateSelectionBtn}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectionComposing(false);
                  setSelectionDraft(null);
                }
              }}
              style={
                isMobileSelectionUi
                  ? selectionComposing
                    ? {
                        position: 'fixed',
                        left: 'max(0.75rem, env(safe-area-inset-left, 0px))',
                        right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
                        bottom: `calc(max(0.75rem, env(safe-area-inset-bottom, 0px)) + ${keyboardBottomInset}px)`,
                        maxWidth: '26rem',
                        marginInline: 'auto',
                      }
                    : {
                        position: 'fixed',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        bottom: `calc(max(1rem, env(safe-area-inset-bottom, 0px) + 0.75rem) + ${keyboardBottomInset}px)`,
                        maxWidth: 'calc(100dvw - 1.5rem)',
                      }
                  : {
                      position: 'fixed',
                      top: `${Math.max(
                        16,
                        Math.min(
                          window.innerHeight - (selectionComposing ? 360 : 68),
                          selectionDraft.rect.top - 52,
                        ),
                      )}px`,
                      left: `${Math.max(
                        12,
                        Math.min(
                          window.innerWidth - (selectionComposing ? 340 : 210),
                          selectionDraft.rect.left - (selectionComposing ? 160 : 95),
                        ),
                      )}px`,
                    }
              }
              className={`z-(--z-popover) overflow-y-auto overscroll-contain rounded-xl border border-border-ink bg-surface-sheet shadow-(--shadow-floating) p-2 ${
                isMobileSelectionUi && selectionComposing
                  ? 'max-h-[min(75dvh,calc(100dvh-1.5rem))]'
                  : 'max-h-[calc(100dvh-2rem)]'
              }`}
            >
              {!selectionComposing ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const draft = selectionDraft;
                      window.getSelection()?.removeAllRanges();
                      setSelectionDraft(null);
                      void handleAddNote(draft.blockId, {
                        content: draft.exact.slice(0, 2000),
                        tone: 'amber',
                        style: 'tape',
                        tag: 'star',
                        note_color: 'amber:tape:star',
                        motivation: 'highlighting',
                        target: draft.target,
                      });
                    }}
                    className={`${
                      isMobileSelectionUi ? 'min-h-10 px-3.5 py-2' : 'min-h-8 px-3 py-1'
                    } rounded-lg text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap`}
                  >
                    <IconHighlighter className="w-3.5 h-3.5 text-accent-warn" />
                    <span>{extCopy.notes.highlightSelectionBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionComposing(true)}
                    className={`${
                      isMobileSelectionUi ? 'min-h-10 px-3.5 py-2' : 'min-h-8 px-3 py-1'
                    } rounded-lg text-xs font-semibold bg-surface-raised border border-border-ink text-ink-primary hover:border-action-bg inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap`}
                  >
                    <IconPen className="w-3.5 h-3.5" />
                    <span>{extCopy.notes.annotateSelectionBtn}</span>
                  </button>
                  {isMobileSelectionUi && (
                    <button
                      type="button"
                      aria-label={copy.closeLabel}
                      title={copy.closeLabel}
                      onClick={() => {
                        window.getSelection()?.removeAllRanges();
                        setSelectionComposing(false);
                        setSelectionDraft(null);
                      }}
                      className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer shrink-0 ink-icon-target"
                    >
                      <IconClose className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className={
                    isMobileSelectionUi
                      ? 'w-full space-y-2'
                      : 'w-[min(20rem,calc(100dvw-2rem))] space-y-2'
                  }
                >
                  <blockquote className="m-0 px-2.5 py-1.5 rounded-lg bg-surface-raised border-s-2 border-border-ink text-xs text-ink-secondary line-clamp-2 italic">
                    {selectionDraft.exact}
                  </blockquote>
                  <MarginNoteEditorForm
                    copy={copy}
                    notesCopy={extCopy.notes}
                    compact
                    onCancel={() => {
                      setSelectionComposing(false);
                      setSelectionDraft(null);
                    }}
                    onSubmit={async (patch) => {
                      const draft = selectionDraft;
                      await handleAddNote(draft.blockId, {
                        ...patch,
                        motivation: 'commenting',
                        target: draft.target,
                      });
                      window.getSelection()?.removeAllRanges();
                      setSelectionComposing(false);
                      setSelectionDraft(null);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
