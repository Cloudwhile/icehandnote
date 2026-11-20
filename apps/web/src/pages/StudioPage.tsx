/*
 * Refactoring UI Constraint Brief (Workflow B & C Refined — Top / Left / Right Admin Dashboard Shell):
 * - Shell Layout (§3.4.1 & `css-layout` §3):
 *   - Top Zone (`3.5rem` single-row): brand, role pill (WCAG AA semantic badge), breadcrumb, live save status,
 *     search, locale (with mobile fallback in sidebar), theme, frontpage link, profile & logout.
 *   - Left Zone (fixed `17.5rem`, recessed `--surface-sunken`, >= 5.1:1 muted ink): workbench nav + tree explorer.
 *   - Right Zone (`minmax(0, 1fr)`, independent scroll pane): Overview, Split-Pane Editor (with semantic `<h1>` +
 *     shared `<NotebookBlockRenderer>` + empty preview state), Catalog Matrix (`sm:grid-cols-3` mobile-safe forms +
 *     empty state), and Admin Users Governance (dynamic localized `--col-2..4` fixing mobile `WP ID` label!).
 * - Delete Confirm Modal: Unified `<ModalDialog>` (gains Safari `closedby` fallback + scroll containment).
 * - Full 4-locale i18n, zero raw hex text colors, zero `font-medium`, min 12px (`text-xs`).
 */

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CcLicenseCard } from '../components/notebook/CcLicenseCard';
import { NotebookBlockRenderer } from '../components/notebook/NotebookBlockRenderer';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import { StudioMobileDrawer } from '../components/studio/StudioMobileDrawer';
import { StudioOverviewPanel } from '../components/studio/StudioOverviewPanel';
import { StudioSettingsPanel } from '../components/studio/StudioSettingsPanel';
import {
  StudioSidebarContent,
  type StudioSectionId,
} from '../components/studio/StudioSidebarContent';
import { VisualBlockEditor } from '../components/studio/VisualBlockEditor';
import {
  IconExternalLink,
  IconFileCode,
  IconGlobe,
  IconLayers,
  IconLogOut,
  IconMenu,
  IconMoon,
  IconMoreHorizontal,
  IconPlus,
  IconSearch,
  IconSidebarToggle,
  IconSnowflake,
  IconSun,
  IconTrash,
} from '../components/ui/Icons';
import { ModalDialog } from '../components/ui/ModalDialog';
import { PopupMenu } from '../components/ui/PopupMenu';
import { api } from '../lib/api';
import {
  detectSystemLocale,
  LOCALES,
  type LocalePreference,
  UI_COPY,
} from '../lib/i18n';
import {
  ALL_LICENSE_OPTIONS,
  normalizeLicenseId,
} from '../lib/licenses';
import type { ResolvedTheme } from '../lib/theme';
import type {
  LicenseId,
  LocaleCode,
  NotebookBlock,
  SiteSettingsDto,
  StudioStepEditorDto,
  StudioTrackDto,
  UserProfileDto,
  UserRole,
} from '../lib/types';
import {
  parseMarkdownToVisualBlocks,
  serializeVisualBlocksToMarkdown,
  type VisualBlock,
} from '../lib/visualBlocks';

interface StudioPageProps {
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  user: UserProfileDto | null;
  authResolved: boolean;
  siteSettings: SiteSettingsDto;
  onSettingsUpdated: (next: SiteSettingsDto) => void;
  onOpenAuth: () => void;
  onLogout: () => void;
}

function getSnippetBodies(locale: LocaleCode) {
  if (locale === 'en') {
    return {
      sectionTask: '\n## [ ] Section Title\n\n',
      steps: '\n- [ ] Task item\n',
      tip: '\n:::tip[Tip]\n\n:::\n',
      note: '\n:::note[Note]\n\n:::\n',
      info: '\n:::info[Info]\n\n:::\n',
      warn: '\n:::warning[Warning]\n\n:::\n',
      danger: '\n:::danger[Caution]\n\n:::\n',
      margin: '\n:::margin[]\n',
      code: '\n```text\n\n```\n',
      sketch:
        '\n```sketch\n{\n  "nodes": [\n    { "id": "n1", "label": "A", "x": 24, "y": 36, "width": 160, "height": 62, "tone": "ice" },\n    { "id": "n2", "label": "B", "x": 245, "y": 36, "width": 160, "height": 62, "tone": "violet" }\n  ],\n  "edges": [\n    { "from": "n1", "to": "n2" }\n  ]\n}\n```\n',
    } as const;
  }
  return {
    sectionTask: '\n## [ ] 小节标题\n\n',
    steps: '\n- [ ] 任务项\n',
    tip: '\n:::tip[]\n\n:::\n',
    note: '\n:::note[]\n\n:::\n',
    info: '\n:::info[]\n\n:::\n',
    warn: '\n:::warning[]\n\n:::\n',
    danger: '\n:::danger[]\n\n:::\n',
    margin: '\n:::margin[]\n',
    code: '\n```text\n\n```\n',
    sketch:
      '\n```sketch\n{\n  "nodes": [\n    { "id": "n1", "label": "A", "x": 24, "y": 36, "width": 160, "height": 62, "tone": "ice" },\n    { "id": "n2", "label": "B", "x": 245, "y": 36, "width": 160, "height": 62, "tone": "violet" }\n  ],\n  "edges": [\n    { "from": "n1", "to": "n2" }\n  ]\n}\n```\n',
  } as const;
}

interface LocalDraftSnapshot {
  title: string;
  summary: string;
  stepNum: number;
  minutes: number;
  license?: string;
  tags: string;
  body: string;
  savedAt: number;
}

type AutosaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved_server'; time: string }
  | { kind: 'saved_local'; time: string }
  | { kind: 'error' };

function localDraftKey(
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
): string {
  return `icehandnote_studio_draft::${track}::${chapter}::${step}::${loc}`;
}

function readLocalDraft(
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
): LocalDraftSnapshot | null {
  try {
    const raw =
      localStorage.getItem(localDraftKey(track, chapter, step, loc)) ??
      localStorage.getItem(`icetowne_studio_draft::${track}::${chapter}::${step}::${loc}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftSnapshot>;
    if (typeof parsed.body !== 'string' || typeof parsed.savedAt !== 'number') {
      return null;
    }
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      stepNum: typeof parsed.stepNum === 'number' ? parsed.stepNum : 1,
      minutes: typeof parsed.minutes === 'number' ? parsed.minutes : 10,
      license: typeof parsed.license === 'string' ? parsed.license : '',
      tags: typeof parsed.tags === 'string' ? parsed.tags : '',
      body: parsed.body,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function writeLocalDraft(
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
  snap: LocalDraftSnapshot,
): void {
  try {
    localStorage.setItem(
      localDraftKey(track, chapter, step, loc),
      JSON.stringify(snap),
    );
  } catch {
    // ignore storage quota errors
  }
}

function clearLocalDraft(
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
): void {
  try {
    localStorage.removeItem(localDraftKey(track, chapter, step, loc));
  } catch {
    // ignore storage restriction
  }
}

export function StudioPage({
  locale,
  localePref,
  onChangeLocalePref,
  theme,
  onToggleTheme,
  onOpenSearch,
  user,
  authResolved,
  siteSettings,
  onSettingsUpdated,
  onOpenAuth,
  onLogout,
}: StudioPageProps) {
  const copy = UI_COPY[locale];
  const s = copy.studio;
  const navigate = useNavigate();
  const usersTableCaptionId = useId();
  const deleteTitleId = useId();
  const newStepTitleId = useId();
  const visualTabId = useId();
  const markdownTabId = useId();
  const visualTabRef = useRef<HTMLButtonElement | null>(null);
  const markdownTabRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveActionRef = useRef<() => void>(() => {});

  // Dashboard shell navigation state
  const [activeSection, setActiveSection] = useState<StudioSectionId>('overview');
  const [editorMode, setEditorMode] = useState<'visual' | 'markdown'>('visual');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const [tracks, setTracks] = useState<StudioTrackDto[]>([]);

  // Active editor target
  const [selTrack, setSelTrack] = useState('');
  const [selChapter, setSelChapter] = useState('');
  const [selStep, setSelStep] = useState('');
  const [editLocale, setEditLocale] = useState<LocaleCode>(locale);

  // Editor document fields
  const [docTitle, setDocTitle] = useState('');
  const [docSummary, setDocSummary] = useState('');
  const [docStepNum, setDocStepNum] = useState(1);
  const [docMinutes, setDocMinutes] = useState(10);
  const [docSyncedRev, setDocSyncedRev] = useState(1);
  const [docCanonicalRev, setDocCanonicalRev] = useState(1);
  const [bumpCanonical, setBumpCanonical] = useState(false);
  const [docStatus, setDocStatus] = useState<'published' | 'draft'>('published');
  const [docLicense, setDocLicense] = useState<LicenseId | ''>('');
  const [docTagsText, setDocTagsText] = useState('');
  const [docBody, setDocBody] = useState('');
  const [visualBlocks, setVisualBlocks] = useState<VisualBlock[]>([]);
  const [docExists, setDocExists] = useState(true);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>({
    kind: 'idle',
  });
  const [recoverableDraft, setRecoverableDraft] =
    useState<LocalDraftSnapshot | null>(null);
  const [lastLocalAutosaveSig, setLastLocalAutosaveSig] = useState('');

  // Live preview AST & interactive step test overrides
  const [previewBlocks, setPreviewBlocks] = useState<NotebookBlock[]>([]);
  const [previewStepOverrides, setPreviewStepOverrides] = useState<Record<string, boolean>>({});
  const [saveBanner, setSaveBanner] = useState('');
  const [saving, setSaving] = useState(false);

  // Quick new step inline creator
  const [newStepSlug, setNewStepSlug] = useState('');
  const [creatingNewStep, setCreatingNewStep] = useState(false);

  // Catalog: Create Track & Create Chapter forms
  const [trackSlugInput, setTrackSlugInput] = useState('');
  const [trackTitleInput, setTrackTitleInput] = useState('');
  const [trackDescInput, setTrackDescInput] = useState('');
  const [trackDifficulty, setTrackDifficulty] = useState('intermediate');
  const [firstChSlugInput, setFirstChSlugInput] = useState('01-basics');
  const [firstChTitleInput, setFirstChTitleInput] = useState('');

  const [newChTrack, setNewChTrack] = useState('');
  const [newChSlug, setNewChSlug] = useState('');
  const [newChNumber, setNewChNumber] = useState(2);
  const [newChTitle, setNewChTitle] = useState('');

  // Admin Users
  const [usersList, setUsersList] = useState<UserProfileDto[]>([]);
  const [roleFeedback, setRoleFeedback] = useState('');

  const canAuthor = Boolean(user && (user.role === 'author' || user.role === 'admin'));
  const isAdmin = Boolean(user && user.role === 'admin');
  const autosaveEnabledRef = useRef(siteSettings.enable_draft_autosave);
  autosaveEnabledRef.current = siteSettings.enable_draft_autosave;
  const activeTargetKey = `${selTrack}/${selChapter}/${selStep}/${editLocale}`;
  const activeTargetRef = useRef(activeTargetKey);
  activeTargetRef.current = activeTargetKey;

  const refreshOverview = useCallback(async () => {
    if (!canAuthor) return;
    try {
      const list = await api.studioOverview(locale);
      setTracks(list);
      if (list.length > 0) {
        setNewChTrack((prev) =>
          prev && list.some((t) => t.slug === prev) ? prev : list[0].slug,
        );
        setSelTrack((prevTrack) => {
          if (prevTrack && list.some((t) => t.slug === prevTrack)) {
            return prevTrack;
          }
          const firstT = list[0];
          const firstC = firstT.chapters[0];
          const firstS = firstC?.steps[0];
          setSelChapter(firstC?.slug ?? '');
          setSelStep(firstS?.slug ?? '');
          return firstT.slug;
        });
      }
      return list;
    } catch {
      return undefined;
    }
  }, [canAuthor, locale]);

  useEffect(() => {
    if (!canAuthor) return;
    void refreshOverview();
  }, [canAuthor, refreshOverview]);

  // Preload Admin users count for Overview KPI card + Users governance view
  useEffect(() => {
    if (!isAdmin) return;
    void api.adminListUsers().then(setUsersList).catch(() => {});
  }, [isAdmin, activeSection]);

  // Load selected step into editor with proper error handling
  const loadEditorStep = useCallback(
    async (tSlug: string, cSlug: string, sSlug: string, loc: LocaleCode) => {
      if (!canAuthor || !tSlug || !cSlug || !sSlug) return;
      try {
        const dto: StudioStepEditorDto = await api.studioGetStep(
          tSlug,
          cSlug,
          sSlug,
          loc,
        );
        setDocExists(dto.exists);
        setDocTitle(dto.title);
        setDocSummary(dto.summary);
        setDocStepNum(dto.step_number);
        setDocMinutes(dto.estimated_minutes);
        setDocSyncedRev(dto.synced_revision);
        setDocCanonicalRev(dto.canonical_revision);
        setBumpCanonical(false);
        setDocStatus(dto.status === 'draft' ? 'draft' : 'published');
        const nextLicense = normalizeLicenseId(dto.license);
        setDocLicense(nextLicense);
        const nextTags = dto.tags.join(', ');
        setDocTagsText(nextTags);
        setDocBody(dto.body_markdown);
        setVisualBlocks(parseMarkdownToVisualBlocks(dto.body_markdown));
        setPreviewStepOverrides({});
        setSavedSnapshot(
          JSON.stringify({
            title: dto.title,
            summary: dto.summary,
            stepNum: dto.step_number,
            minutes: dto.estimated_minutes,
            status: dto.status === 'draft' ? 'draft' : 'published',
            license: nextLicense,
            tags: nextTags,
            body: dto.body_markdown,
            bump: false,
          }),
        );
        setAutosaveStatus({ kind: 'idle' });
        setLastLocalAutosaveSig('');

        const localDraft = readLocalDraft(tSlug, cSlug, sSlug, loc);
        if (
          autosaveEnabledRef.current &&
          localDraft &&
          (localDraft.title !== dto.title ||
            localDraft.summary !== dto.summary ||
            (localDraft.license ?? '') !== nextLicense ||
            localDraft.body !== dto.body_markdown ||
            localDraft.tags !== nextTags)
        ) {
          setRecoverableDraft(localDraft);
        } else {
          setRecoverableDraft(null);
        }
      } catch (err) {
        setDocExists(false);
        setSaveBanner(
          s.loadStepFailedBanner(err instanceof Error ? err.message : 'Unknown error'),
        );
      }
    },
    [canAuthor, s],
  );

  useEffect(() => {
    void loadEditorStep(selTrack, selChapter, selStep, editLocale);
  }, [selTrack, selChapter, selStep, editLocale, loadEditorStep]);

  // Debounced live Rust AST preview
  useEffect(() => {
    if (!canAuthor || activeSection !== 'editor') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!docBody.trim()) {
        setPreviewBlocks([]);
        return;
      }
      void api
        .studioPreview({
          title: docTitle,
          summary: docSummary,
          body_markdown: docBody,
        })
        .then((res) => {
          if (!cancelled) setPreviewBlocks(res.blocks);
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canAuthor, activeSection, docTitle, docSummary, docBody]);

  // Compute pending translations/drafts badge count for Sidebar (respecting enabled locales)
  const pendingCount = useMemo(() => {
    const enabled =
      siteSettings.enabled_locales.length > 0
        ? siteSettings.enabled_locales
        : LOCALES.map((l) => l.code);
    let count = 0;
    for (const t of tracks) {
      for (const ch of t.chapters) {
        for (const st of ch.steps) {
          for (const locCode of enabled) {
            const tr = st.translations.find((item) => item.locale === locCode);
            if (!tr || tr.status === 'draft' || tr.synced_revision < st.canonical_revision) {
              count += 1;
            }
          }
        }
      }
    }
    return count;
  }, [tracks, siteSettings.enabled_locales]);

  const stationerySnippets = useMemo(() => {
    const bodies = getSnippetBodies(locale);
    return [
      { id: 'section-task', label: `+ ${copy.taskScopeSection}`, snippet: bodies.sectionTask },
      { id: 'steps', label: `+ ${copy.taskScopeParagraph}`, snippet: bodies.steps },
      { id: 'tip', label: s.snippets.tip, snippet: bodies.tip },
      { id: 'note', label: s.snippets.note, snippet: bodies.note },
      { id: 'info', label: s.snippets.info, snippet: bodies.info },
      { id: 'warn', label: s.snippets.warn, snippet: bodies.warn },
      { id: 'danger', label: s.snippets.danger, snippet: bodies.danger },
      { id: 'margin', label: s.snippets.margin, snippet: bodies.margin },
      { id: 'code', label: s.snippets.code, snippet: bodies.code },
      { id: 'sketch', label: s.snippets.sketch, snippet: bodies.sketch },
    ];
  }, [locale, s.snippets, copy.taskScopeSection, copy.taskScopeParagraph]);

  const previewCheckedIds = useMemo(() => {
    const set = new Set<string>();
    for (const block of previewBlocks) {
      if (block.type === 'heading' && block.is_task) {
        const override = previewStepOverrides[block.block_id];
        if (override !== undefined ? override : Boolean(block.default_checked)) {
          set.add(block.block_id);
        }
      } else if (block.type === 'steps') {
        for (const item of block.items) {
          const override = previewStepOverrides[item.item_id];
          if (override !== undefined ? override : item.default_checked) {
            set.add(item.item_id);
          }
        }
      }
    }
    return set;
  }, [previewBlocks, previewStepOverrides]);

  const currentDocSig = useMemo(
    () =>
      JSON.stringify({
        title: docTitle,
        summary: docSummary,
        stepNum: docStepNum,
        minutes: docMinutes,
        status: docStatus,
        license: docLicense,
        tags: docTagsText,
        body: docBody,
        bump: bumpCanonical,
      }),
    [
      docTitle,
      docSummary,
      docStepNum,
      docMinutes,
      docStatus,
      docLicense,
      docTagsText,
      docBody,
      bumpCanonical,
    ],
  );

  const isEditorDirty = Boolean(savedSnapshot) && currentDocSig !== savedSnapshot;

  const latestEditorRef = useRef({
    targetKey: activeTargetKey,
    selTrack,
    selChapter,
    selStep,
    editLocale,
    docTitle,
    docSummary,
    docStepNum,
    docMinutes,
    docSyncedRev,
    docStatus,
    docLicense,
    docTagsText,
    docBody,
    docExists,
    saving,
    currentDocSig,
  });
  latestEditorRef.current = {
    targetKey: activeTargetKey,
    selTrack,
    selChapter,
    selStep,
    editLocale,
    docTitle,
    docSummary,
    docStepNum,
    docMinutes,
    docSyncedRev,
    docStatus,
    docLicense,
    docTagsText,
    docBody,
    docExists,
    saving,
    currentDocSig,
  };

  // Unified periodic draft auto-save driven by Site Settings (`enable_draft_autosave` & `draft_autosave_interval_secs`):
  // - Draft / new articles with a title sync directly to backend as `status: 'draft'` (never auto-bumping canonical rev).
  // - Published articles (or untitled new drafts) safely write to local recovery storage so live pages are never altered mid-edit.
  const needsAutosave =
    isEditorDirty && currentDocSig !== lastLocalAutosaveSig;

  useEffect(() => {
    if (
      !canAuthor ||
      activeSection !== 'editor' ||
      !siteSettings.enable_draft_autosave ||
      !needsAutosave ||
      saving
    ) {
      return;
    }

    const delayMs =
      Math.max(5, Math.min(300, siteSettings.draft_autosave_interval_secs || 15)) *
      1000;

    const timer = window.setTimeout(() => {
      const cur = latestEditorRef.current;
      if (activeTargetRef.current !== cur.targetKey || cur.saving) return;

      const timeStr = new Date().toLocaleTimeString();

      if (
        (cur.docStatus === 'draft' || !cur.docExists) &&
        cur.docTitle.trim() &&
        cur.selStep.trim()
      ) {
        setAutosaveStatus({ kind: 'saving' });
        const tags = cur.docTagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

        void api
          .studioSaveStep({
            track_slug: cur.selTrack,
            chapter_slug: cur.selChapter,
            step_slug: cur.selStep,
            locale: cur.editLocale,
            title: cur.docTitle.trim(),
            summary: cur.docSummary.trim(),
            step_number: cur.docStepNum,
            estimated_minutes: cur.docMinutes,
            synced_revision: cur.docSyncedRev,
            bump_canonical: false,
            status: 'draft',
            license: cur.docLicense,
            tags,
            body_markdown: cur.docBody,
            write_to_content_dir: true,
          })
          .then((saved) => {
            if (activeTargetRef.current !== cur.targetKey) return;
            clearLocalDraft(
              cur.selTrack,
              cur.selChapter,
              cur.selStep,
              cur.editLocale,
            );
            setRecoverableDraft(null);
            setDocExists(true);
            setDocStatus('draft');
            setDocSyncedRev(saved.synced_revision);
            setDocCanonicalRev(saved.canonical_revision);
            setSavedSnapshot(
              JSON.stringify({
                title: cur.docTitle.trim(),
                summary: cur.docSummary.trim(),
                stepNum: cur.docStepNum,
                minutes: cur.docMinutes,
                status: 'draft',
                license: cur.docLicense,
                tags: cur.docTagsText,
                body: cur.docBody,
                bump: false,
              }),
            );
            setLastLocalAutosaveSig('');
            setAutosaveStatus({ kind: 'saved_server', time: timeStr });
            void refreshOverview();
          })
          .catch(() => {
            if (activeTargetRef.current !== cur.targetKey) return;
            // Fallback to local recovery draft if backend is temporarily unreachable
            writeLocalDraft(
              cur.selTrack,
              cur.selChapter,
              cur.selStep,
              cur.editLocale,
              {
                title: cur.docTitle,
                summary: cur.docSummary,
                stepNum: cur.docStepNum,
                minutes: cur.docMinutes,
                license: cur.docLicense,
                tags: cur.docTagsText,
                body: cur.docBody,
                savedAt: Date.now(),
              },
            );
            setLastLocalAutosaveSig(cur.currentDocSig);
            setAutosaveStatus({ kind: 'error' });
          });
      } else {
        writeLocalDraft(
          cur.selTrack,
          cur.selChapter,
          cur.selStep,
          cur.editLocale,
          {
            title: cur.docTitle,
            summary: cur.docSummary,
            stepNum: cur.docStepNum,
            minutes: cur.docMinutes,
            license: cur.docLicense,
            tags: cur.docTagsText,
            body: cur.docBody,
            savedAt: Date.now(),
          },
        );
        setLastLocalAutosaveSig(cur.currentDocSig);
        setAutosaveStatus({ kind: 'saved_local', time: timeStr });
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    canAuthor,
    activeSection,
    siteSettings.enable_draft_autosave,
    siteSettings.draft_autosave_interval_secs,
    needsAutosave,
    saving,
    activeTargetKey,
    refreshOverview,
  ]);

  // Keyboard shortcut: Ctrl+S / Cmd+S saves immediately while editing
  useEffect(() => {
    if (!canAuthor || activeSection !== 'editor') return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActionRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canAuthor, activeSection]);

  // Gate 0: Wait for initial auth check so authenticated refreshes never flash the login gate
  if (!authResolved && !user) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 py-16">
        <div className="rounded-2xl p-8 bg-surface-sheet border-2 border-border-ink text-center text-sm font-mono text-ink-muted inline-flex items-center justify-center gap-2 w-full">
          <IconSnowflake className="w-4 h-4 text-accent-ice" />
          <span>{s.verifyingGate}</span>
        </div>
      </main>
    );
  }

  // Gate 1: Unauthenticated
  if (!user) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 py-16">
        <div className="notebook-sheet-stack">
          <div className="notebook-sheet-card p-8">
            <NotebookEmptyState
              title={s.unauthTitle}
              description={s.unauthDesc}
              actionLabel={s.unauthCta}
              onAction={onOpenAuth}
            />
          </div>
        </div>
      </main>
    );
  }

  // Gate 2: Reader role (403) — provides clear recovery CTA back to reading (§8.4)
  if (!canAuthor) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 py-16">
        <div className="notebook-sheet-stack">
          <div className="notebook-sheet-card p-8">
            <NotebookEmptyState
              title={s.readerGateTitle(user.display_name)}
              description={s.readerGateDesc}
              actionLabel={s.readerGateCta}
              onAction={() => navigate(`/${locale}`)}
            />
          </div>
        </div>
      </main>
    );
  }

  const currentTrackObj = tracks.find((t) => t.slug === selTrack) ?? tracks[0];
  const currentChapterObj =
    currentTrackObj?.chapters.find((c) => c.slug === selChapter) ??
    currentTrackObj?.chapters[0];
  const currentStepObj = currentChapterObj?.steps.find((st) => st.slug === selStep);

  const handleTrackSelect = (nextTrackSlug: string) => {
    setSelTrack(nextTrackSlug);
    const t = tracks.find((item) => item.slug === nextTrackSlug);
    const ch = t?.chapters[0];
    if (ch) {
      setSelChapter(ch.slug);
      if (ch.steps[0]) setSelStep(ch.steps[0].slug);
    }
  };

  const handleChapterSelect = (nextChSlug: string) => {
    setSelChapter(nextChSlug);
    const ch = currentTrackObj?.chapters.find((c) => c.slug === nextChSlug);
    if (ch?.steps[0]) {
      setSelStep(ch.steps[0].slug);
    }
  };

  const handlePickStepFromSidebar = (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
  ) => {
    setSelTrack(trackSlug);
    setSelChapter(chapterSlug);
    setSelStep(stepSlug);
    setCreatingNewStep(false);
    setActiveSection('editor');
  };

  const handleQuickNewStepFromSidebar = (
    trackSlug: string,
    chapterSlug: string,
  ) => {
    setSelTrack(trackSlug);
    setSelChapter(chapterSlug);
    setCreatingNewStep(true);
    setActiveSection('editor');
  };

  const handleOpenEditorTarget = (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
    targetLocale: LocaleCode,
  ) => {
    setSelTrack(trackSlug);
    setSelChapter(chapterSlug);
    setSelStep(stepSlug);
    setEditLocale(targetLocale);
    setCreatingNewStep(false);
    setActiveSection('editor');
  };

  const handleStartNewStep = () => {
    const clean = newStepSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');
    if (!clean) return;
    setSelStep(clean);
    setNewStepSlug('');
    setCreatingNewStep(false);
    setSaveBanner(s.switchedNewStepBanner(clean));
  };

  const handleVisualBlocksChange = (nextBlocks: VisualBlock[]) => {
    setVisualBlocks(nextBlocks);
    setDocBody(serializeVisualBlocksToMarkdown(nextBlocks));
  };

  const handleSwitchEditorMode = (nextMode: 'visual' | 'markdown') => {
    if (nextMode === 'visual' && editorMode !== 'visual') {
      setVisualBlocks(parseMarkdownToVisualBlocks(docBody));
    }
    setEditorMode(nextMode);
  };

  const handleEditorTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextMode = editorMode === 'visual' ? 'markdown' : 'visual';
      handleSwitchEditorMode(nextMode);
      (nextMode === 'visual' ? visualTabRef : markdownTabRef).current?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      handleSwitchEditorMode('visual');
      visualTabRef.current?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      handleSwitchEditorMode('markdown');
      markdownTabRef.current?.focus();
    }
  };

  const insertSnippetAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDocBody((prev) => prev + snippet);
      return;
    }
    const start = el.selectionStart ?? docBody.length;
    const end = el.selectionEnd ?? docBody.length;
    const next = docBody.slice(0, start) + snippet + docBody.slice(end);
    setDocBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleSaveStep = async () => {
    if (!docTitle.trim() || !selStep.trim() || saving) {
      setSaveBanner(s.missingTitleOrSlugBanner);
      return;
    }
    setSaving(true);
    setSaveBanner('');
    try {
      const tags = docTagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const saved = await api.studioSaveStep({
        track_slug: selTrack,
        chapter_slug: selChapter,
        step_slug: selStep,
        locale: editLocale,
        title: docTitle.trim(),
        summary: docSummary.trim(),
        step_number: docStepNum,
        estimated_minutes: docMinutes,
        synced_revision: docSyncedRev,
        bump_canonical: bumpCanonical,
        status: docStatus,
        license: docLicense,
        tags,
        body_markdown: docBody,
        write_to_content_dir: true,
      });

      setDocExists(true);
      setDocSyncedRev(saved.synced_revision);
      setDocCanonicalRev(saved.canonical_revision);
      setBumpCanonical(false);
      clearLocalDraft(selTrack, selChapter, selStep, editLocale);
      setRecoverableDraft(null);
      setLastLocalAutosaveSig('');
      setAutosaveStatus({ kind: 'idle' });
      setSavedSnapshot(
        JSON.stringify({
          title: docTitle.trim(),
          summary: docSummary.trim(),
          stepNum: docStepNum,
          minutes: docMinutes,
          status: docStatus,
          license: docLicense,
          tags: docTagsText,
          body: docBody,
          bump: false,
        }),
      );
      await refreshOverview();
      const timeStr = new Date().toLocaleTimeString();
      setSaveBanner(
        s.savedBanner(editLocale, saved.synced_revision, saved.status === 'draft', timeStr),
      );
    } catch (err) {
      setSaveBanner(
        s.saveFailedBanner(err instanceof Error ? err.message : 'Unknown error'),
      );
    } finally {
      setSaving(false);
    }
  };
  saveActionRef.current = () => {
    void handleSaveStep();
  };

  const handleConfirmDeleteStep = async () => {
    try {
      await api.studioDeleteStep(selTrack, selChapter, selStep);
      clearLocalDraft(selTrack, selChapter, selStep, editLocale);
      setRecoverableDraft(null);
      setDeleteModalOpen(false);
      const deletedSlug = selStep;
      const refreshed = await refreshOverview();
      const t = refreshed?.find((item) => item.slug === selTrack);
      const firstS = t?.chapters.find((c) => c.slug === selChapter)?.steps[0];
      if (firstS) {
        setSelStep(firstS.slug);
      } else {
        setDocExists(false);
        setDocTitle('');
        setDocSummary('');
        setDocBody('');
        setVisualBlocks([]);
      }
      setSaveBanner(s.deletedBanner(deletedSlug));
    } catch (err) {
      setSaveBanner(
        s.deleteFailedBanner(err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  };

  const handleCreateTrack = async (e: FormEvent) => {
    e.preventDefault();
    if (!trackSlugInput.trim() || !trackTitleInput.trim()) return;
    try {
      const created = await api.studioCreateTrack({
        slug: trackSlugInput.trim(),
        difficulty: trackDifficulty,
        icon_kind: 'snowflake',
        tags: [],
        title_zh_tw: trackTitleInput.trim(),
        subtitle_zh_tw: trackDescInput.trim(),
        description_zh_tw: trackDescInput.trim(),
        first_chapter_slug: firstChSlugInput.trim() || '01-basics',
        first_chapter_title: firstChTitleInput.trim() || trackTitleInput.trim(),
      });
      await refreshOverview();
      setSelTrack(created.slug);
      setSelChapter(created.chapters[0]?.slug ?? '01-basics');
      setSelStep('01-intro');
      setTrackSlugInput('');
      setTrackTitleInput('');
      setTrackDescInput('');
      setActiveSection('editor');
      setSaveBanner(s.trackCreatedBanner(created.title));
    } catch (err) {
      setSaveBanner(
        s.trackCreateFailedBanner(err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  };

  const handleCreateChapter = async (e: FormEvent) => {
    e.preventDefault();
    if (!newChSlug.trim() || !newChTitle.trim()) return;
    try {
      await api.studioCreateChapter({
        track_slug: newChTrack,
        slug: newChSlug.trim(),
        number: newChNumber,
        title_zh_tw: newChTitle.trim(),
      });
      await refreshOverview();
      setNewChSlug('');
      setNewChTitle('');
      setSaveBanner(s.chapterCreatedBanner(newChTrack));
    } catch (err) {
      setSaveBanner(
        s.chapterCreateFailedBanner(err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  };

  const handleRoleChange = async (targetUserId: string, nextRole: UserRole) => {
    try {
      const updated = await api.adminUpdateUserRole(targetUserId, nextRole);
      setUsersList((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setRoleFeedback(
        s.roleUpdatedFeedback(updated.username, updated.role.toUpperCase()),
      );
    } catch (err) {
      setRoleFeedback(
        s.roleUpdateFailedFeedback(err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  };

  const adminCount = usersList.filter((u) => u.role === 'admin').length;
  const authorCount = usersList.filter((u) => u.role === 'author').length;
  const readerCount = usersList.filter((u) => u.role === 'reader').length;

  // Dynamic localized mobile stacked-card column labels (`responsive-table` MWG — fixes `--col-4` WP ID bug!)
  const responsiveTableVars = {
    '--col-2': JSON.stringify(s.colAuthSource),
    '--col-3': JSON.stringify(s.colRole),
    '--col-4': JSON.stringify(s.colWpId),
  } as CSSProperties;

  return (
    <div
      className="studio-shell"
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      {/* ================================================================= */}
      {/* ZONE 1 (上分區): Minimal Single-Row Studio Topbar                 */}
      {/* ================================================================= */}
      <header className="studio-topbar">
        {/* Left: Brand Logo FIRST, then Sidebar Toggle (zero redundant breadcrumb) */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link
            to={`/${locale}`}
            title={s.backHomeTitle}
            className="inline-flex items-center gap-2 no-underline text-ink-primary shrink-0"
          >
            <span
              aria-hidden="true"
              className="w-7 h-7 rounded-lg flex items-center justify-center border border-border-ink bg-surface-raised shrink-0"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent-ice-ink)"
                strokeWidth="2.1"
                strokeLinecap="round"
              >
                <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07" />
                <circle cx="12" cy="12" r="2.2" fill="var(--link-ink)" stroke="none" />
              </svg>
            </span>
            <span className="text-sm font-semibold tracking-tight studio-ellipsis max-w-36">
              {siteSettings.site_name}
            </span>
          </Link>

          {/* Desktop Sidebar Collapse Toggle (>= 1024px) */}
          <button
            type="button"
            aria-label={sidebarCollapsed ? s.expandSidebarAria : s.collapseSidebarAria}
            title={sidebarCollapsed ? s.expandSidebarAria : s.collapseSidebarAria}
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-lg bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer shrink-0 transition-colors"
          >
            <IconSidebarToggle className="w-4 h-4" />
          </button>

          {/* Mobile Drawer Trigger (< 1024px) */}
          <button
            type="button"
            aria-label={s.openNavAria}
            aria-expanded={mobileDrawerOpen}
            aria-controls="studio-sidebar-drawer"
            onClick={() => setMobileDrawerOpen(true)}
            className="lg:hidden inline-flex items-center justify-center w-8 h-8 rounded-lg bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer shrink-0 transition-colors"
          >
            <IconMenu className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Save Toast + Search + Dropdown Locale + Theme + Dropdown Account */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
          {saveBanner && (
            <div
              aria-live="polite"
              className="hidden xl:block text-xs font-mono px-2.5 py-1 rounded-lg bg-surface-raised border border-border-subtle text-ink-secondary max-w-72 studio-ellipsis"
              title={saveBanner}
            >
              {saveBanner}
            </div>
          )}

          <button
            type="button"
            onClick={onOpenSearch}
            aria-label={copy.searchTrigger}
            className="min-h-8 px-2.5 py-1.5 rounded-lg text-xs bg-surface-raised text-ink-secondary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <IconSearch className="w-3.5 h-3.5 text-ink-muted" />
            <kbd className="hidden sm:inline font-mono text-xs text-ink-muted">
              ⌘K
            </kbd>
          </button>

          {/* Compact Locale Dropdown Menu (replaces 4 flat sprawled buttons) */}
          <PopupMenu
            align="end"
            triggerAriaLabel={s.localeGroupAria}
            triggerTitle={s.languageLabel}
            triggerClassName="min-h-8 px-2.5 py-1 rounded-lg text-xs bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink"
            triggerLabel={
              <>
                <IconGlobe className="w-3.5 h-3.5 text-ink-muted" />
                <span className="hidden sm:inline font-semibold">
                  {LOCALES.find((l) => l.code === locale)?.short ?? locale}
                </span>
              </>
            }
          >
            {({ close }) => {
              const sysLoc = detectSystemLocale(
                siteSettings.enabled_locales,
                siteSettings.default_locale,
              );
              const sysShort =
                LOCALES.find((l) => l.code === sysLoc)?.short ?? sysLoc;
              return (
                <div role="group" aria-label={s.localeGroupAria}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={localePref === 'auto'}
                    onClick={(e) => {
                      onChangeLocalePref('auto');
                      close(e.detail !== 0);
                    }}
                  >
                    <span className="flex-1">{copy.followSystemLocale}</span>
                    <span className="ink-menu-hint">{sysShort}</span>
                  </button>
                  <hr />
                  {LOCALES.map((item) => {
                    const active = localePref === item.code;
                    return (
                      <button
                        key={item.code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={(e) => {
                          onChangeLocalePref(item.code);
                          close(e.detail !== 0);
                        }}
                      >
                        <span className="flex-1">{item.label}</span>
                        <span className="ink-menu-hint">{item.code}</span>
                      </button>
                    );
                  })}
                </div>
              );
            }}
          </PopupMenu>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              theme === 'dark' ? copy.themeLightLabel : copy.themeDarkLabel
            }
            title={
              theme === 'dark' ? copy.themeLightLabel : copy.themeDarkLabel
            }
            className="w-8 h-8 rounded-lg text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink inline-flex items-center justify-center cursor-pointer transition-colors"
          >
            {theme === 'dark' ? (
              <IconSun className="w-4 h-4 text-accent-amber" />
            ) : (
              <IconMoon className="w-4 h-4 text-ink-secondary" />
            )}
          </button>

          {/* Compact Account Dropdown Menu (folds Role Badge + Frontpage + Logout) */}
          <PopupMenu
            align="end"
            triggerAriaLabel={user.display_name}
            triggerClassName="min-h-8 ps-1.5 pe-2 py-1 rounded-full bg-surface-raised border border-border-subtle hover:border-border-ink text-xs"
            triggerLabel={
              <>
                <span
                  aria-hidden="true"
                  className="w-5 h-5 bg-action-bg text-action-fg font-mono font-semibold inline-flex items-center justify-center text-xs shrink-0"
                  style={{
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                  }}
                >
                  {user.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline-block font-semibold text-ink-primary max-w-20 studio-ellipsis">
                  {user.display_name}
                </span>
              </>
            }
          >
            {({ close }) => (
              <>
                <div className="ink-menu-header">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink-primary studio-ellipsis">
                      {user.display_name}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-mono font-semibold uppercase tracking-wider shrink-0"
                      style={{
                        backgroundColor: 'var(--alert-note-badge-bg)',
                        color: 'var(--alert-note-badge-fg)',
                      }}
                    >
                      {user.role}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-ink-muted studio-ellipsis mt-0.5">
                    @{user.username}
                  </div>
                </div>

                <Link
                  to={`/${locale}`}
                  onClick={() => close(true)}
                >
                  <IconExternalLink className="w-3.5 h-3.5 text-ink-muted" />
                  <span>{s.frontpageLink.replace(/\s*↗$/, '')}</span>
                </Link>

                <hr />

                <button
                  type="button"
                  data-tone="danger"
                  onClick={(e) => {
                    close(e.detail !== 0);
                    onLogout();
                  }}
                >
                  <IconLogOut className="w-3.5 h-3.5" />
                  <span>{copy.logoutBtn}</span>
                </button>
              </>
            )}
          </PopupMenu>
        </div>
      </header>

      {/* ================================================================= */}
      {/* ZONE 2 (左分區): Unified Navigation & Editor Explorer Sidebar      */}
      {/* ================================================================= */}
      <aside className="studio-sidebar" aria-label={s.sidebarAriaLabel}>
        <StudioSidebarContent
          locale={locale}
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          isAdmin={isAdmin}
          tracks={tracks}
          usersCount={usersList.length}
          pendingCount={pendingCount}
          selTrack={selTrack}
          selChapter={selChapter}
          selStep={selStep}
          onPickStep={handlePickStepFromSidebar}
          onQuickNewStep={handleQuickNewStepFromSidebar}
        />
      </aside>

      <StudioMobileDrawer
        locale={locale}
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
      >
        <StudioSidebarContent
          locale={locale}
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          isAdmin={isAdmin}
          tracks={tracks}
          usersCount={usersList.length}
          pendingCount={pendingCount}
          selTrack={selTrack}
          selChapter={selChapter}
          selStep={selStep}
          onPickStep={handlePickStepFromSidebar}
          onQuickNewStep={handleQuickNewStepFromSidebar}
          onCloseMobileDrawer={() => setMobileDrawerOpen(false)}
        />
      </StudioMobileDrawer>

      {/* ================================================================= */}
      {/* ZONE 3 (右分區): Fluid Independent Scrollable Main Workspace      */}
      {/* ================================================================= */}
      <main className="studio-main studio-scroll-pane">
        <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-6">
          {/* Mobile / Tablet Live Save Banner (visible below xl where topbar hides it) */}
          {saveBanner && (
            <div
              aria-live="polite"
              className="xl:hidden text-xs font-mono px-3.5 py-2 rounded-xl studio-panel text-ink-primary"
            >
              {saveBanner}
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* SECTION A: Dashboard Overview                                   */}
          {/* --------------------------------------------------------------- */}
          {activeSection === 'overview' && (
            <div key="studio-sec-overview" className="ui-panel-enter">
              <StudioOverviewPanel
                locale={locale}
                isAdmin={isAdmin}
                tracks={tracks}
                usersList={usersList}
                siteSettings={siteSettings}
                onOpenEditorTarget={handleOpenEditorTarget}
                onStartQuickNewStep={() => {
                  setCreatingNewStep(true);
                  setActiveSection('editor');
                }}
                onSwitchSection={setActiveSection}
              />
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* SECTION B: Split-Pane Hand-Drawn Tutorial Editor                */}
          {/* --------------------------------------------------------------- */}
          {activeSection === 'editor' && (
            <div key="studio-sec-editor" className="ui-panel-enter space-y-5">
              <h1 className="sr-only">{s.editorHeadingSr}</h1>

              {/* Calm Single-Row Editor Command Bar (article switching lives in the unified sidebar tree) */}
              <div className="studio-panel px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                {/* Left: Compact Translation Locale Dropdown + Context Path + Live Auto-Save Status */}
                <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                  <PopupMenu
                    align="start"
                    triggerAriaLabel={s.editLocaleLabel(docCanonicalRev)}
                    triggerClassName="min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink"
                    triggerLabel={
                      <>
                        <IconGlobe className="w-3.5 h-3.5 text-ink-muted" />
                        <span>
                          {LOCALES.find((l) => l.code === editLocale)?.short ??
                            editLocale}
                        </span>
                        <span className="font-mono text-ink-muted tabular-nums">
                          v{docSyncedRev}
                        </span>
                      </>
                    }
                  >
                    {({ close }) => (
                      <div
                        role="group"
                        aria-label={s.editLocaleLabel(docCanonicalRev)}
                      >
                        {LOCALES.map((loc) => {
                          const active = loc.code === editLocale;
                          const tr = currentStepObj?.translations.find(
                            (item) => item.locale === loc.code,
                          );
                          const statusHint = !tr
                            ? s.addLocaleAction
                            : tr.status === 'draft'
                              ? s.draftParen
                              : tr.synced_revision <
                                  (currentStepObj?.canonical_revision ?? 1)
                                ? `⚠ v${tr.synced_revision}`
                                : `v${tr.synced_revision}`;
                          return (
                            <button
                              key={loc.code}
                              type="button"
                              role="menuitemradio"
                              aria-checked={active}
                              onClick={(e) => {
                                setEditLocale(loc.code);
                                close(e.detail !== 0);
                              }}
                            >
                              <span className="flex-1">{loc.label}</span>
                              <span className="ink-menu-hint">{statusHint}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </PopupMenu>

                  {currentTrackObj && currentChapterObj && (
                    <span
                      className="hidden md:inline-block text-xs text-ink-muted studio-ellipsis max-w-64"
                      title={`${currentTrackObj.title} / ${currentChapterObj.title}`}
                    >
                      {currentTrackObj.title} / {currentChapterObj.title}
                    </span>
                  )}

                  {/* Unified Draft Auto-Save Status Indicator */}
                  {(() => {
                    const statusText = !siteSettings.enable_draft_autosave
                      ? s.autosaveStatusOff
                      : autosaveStatus.kind === 'saving'
                        ? s.autosavingNow
                        : autosaveStatus.kind === 'saved_server'
                          ? s.autosavedServer(autosaveStatus.time)
                          : autosaveStatus.kind === 'saved_local'
                            ? s.autosavedLocal(autosaveStatus.time)
                            : autosaveStatus.kind === 'error'
                              ? s.autosaveFailed
                              : s.autosaveStatusOn(
                                  siteSettings.draft_autosave_interval_secs,
                                );
                    const statusTone = !siteSettings.enable_draft_autosave
                      ? 'text-ink-muted'
                      : autosaveStatus.kind === 'error'
                        ? 'text-accent-danger'
                        : autosaveStatus.kind === 'saved_server' ||
                            autosaveStatus.kind === 'saved_local'
                          ? 'text-accent-success'
                          : 'text-ink-muted';

                    return isAdmin ? (
                      <button
                        type="button"
                        role="status"
                        aria-live="polite"
                        title={s.configureAutosaveTitle}
                        onClick={() => setActiveSection('settings')}
                        className={`min-h-7 px-2 py-0.5 rounded-lg font-mono text-xs tabular-nums hover:bg-surface-raised hover:text-ink-primary transition-colors cursor-pointer ${statusTone}`}
                      >
                        {statusText}
                      </button>
                    ) : (
                      <span
                        role="status"
                        aria-live="polite"
                        className={`font-mono text-xs tabular-nums ${statusTone}`}
                      >
                        {statusText}
                      </span>
                    );
                  })()}
                </div>

                {/* Right: Publish Switch + More Actions Dropdown (`⋯`) + Primary Save CTA */}
                <div className="flex flex-wrap items-center gap-2.5 ms-auto">
                  <label className="inline-flex items-center gap-2 min-h-8 px-2.5 py-1 rounded-xl bg-surface-raised border border-border-subtle cursor-pointer text-xs text-ink-secondary hover:text-ink-primary transition-colors">
                    <input
                      type="checkbox"
                      checked={docStatus === 'published'}
                      onChange={(e) =>
                        setDocStatus(e.target.checked ? 'published' : 'draft')
                      }
                      {...({ switch: '' } as Record<string, unknown>)}
                    />
                    <span>{s.publishCheckbox}</span>
                  </label>

                  {/* Overflow Dropdown Menu folding Bump Rev, Preview, New Article, and Delete */}
                  <PopupMenu
                    align="end"
                    showChevron={false}
                    triggerAriaLabel={s.editorHeadingSr}
                    triggerClassName="w-9 h-9 rounded-xl bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary"
                    triggerLabel={<IconMoreHorizontal className="w-4 h-4" />}
                  >
                    {({ close }) => (
                      <>
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={bumpCanonical}
                          onClick={(e) => {
                            setBumpCanonical((v) => !v);
                            if (e.detail !== 0) {
                              window.setTimeout(() => close(true), 180);
                            }
                          }}
                        >
                          <span className="flex-1">
                            {s.bumpCanonicalCheckbox(
                              docCanonicalRev,
                              docCanonicalRev + 1,
                            )}
                          </span>
                        </button>

                        <hr />

                        <Link
                          to={`/${editLocale}/tracks/${selTrack}/${selChapter}/${selStep}`}
                          onClick={() => close(true)}
                        >
                          <IconExternalLink className="w-3.5 h-3.5 text-ink-muted" />
                          <span>{s.openReaderLink.replace(/\s*↗$/, '')}</span>
                        </Link>

                        <button
                          type="button"
                          onClick={(e) => {
                            close(e.detail !== 0);
                            setCreatingNewStep(true);
                          }}
                        >
                          <IconPlus className="w-3.5 h-3.5 text-ink-muted" />
                          <span>{s.newStepToggle.replace(/^[+＋]\s*/, '')}</span>
                        </button>

                        {docExists && (
                          <>
                            <hr />
                            <button
                              type="button"
                              data-tone="danger"
                              onClick={(e) => {
                                close(e.detail !== 0);
                                setDeleteModalOpen(true);
                              }}
                            >
                              <IconTrash className="w-3.5 h-3.5" />
                              <span>{s.deleteStepBtn}</span>
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </PopupMenu>

                  {/* ONE Primary Action on the Editor view (§2.8) + unsaved dirty dot */}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSaveStep()}
                    title="Ctrl+S / ⌘S"
                    className="min-h-9 px-5 py-2 rounded-xl text-sm font-semibold ink-btn-primary inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {isEditorDirty && !saving && (
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full ui-badge-pop shrink-0"
                        style={{ backgroundColor: 'var(--marker-h3)' }}
                      />
                    )}
                    <span>{saving ? s.savingBtn : s.saveBtn(editLocale)}</span>
                  </button>
                </div>
              </div>

              {/* Local Auto-Saved Draft Recovery Strip (only shown when a newer local draft exists) */}
              {siteSettings.enable_draft_autosave && recoverableDraft && (
                <div
                  role="region"
                  aria-live="polite"
                  className="ui-panel-enter studio-panel px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  style={{ borderInlineStart: '4px solid var(--alert-warn-border)' }}
                >
                  <span className="text-xs font-semibold text-ink-primary">
                    {s.draftRecoveryBanner(
                      new Date(recoverableDraft.savedAt).toLocaleTimeString(),
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDocTitle(recoverableDraft.title);
                        setDocSummary(recoverableDraft.summary);
                        setDocStepNum(recoverableDraft.stepNum);
                        setDocMinutes(recoverableDraft.minutes);
                        setDocLicense(
                          normalizeLicenseId(recoverableDraft.license),
                        );
                        setDocTagsText(recoverableDraft.tags);
                        setDocBody(recoverableDraft.body);
                        setVisualBlocks(
                          parseMarkdownToVisualBlocks(recoverableDraft.body),
                        );
                        setRecoverableDraft(null);
                      }}
                      className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer"
                    >
                      {s.restoreDraftBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearLocalDraft(selTrack, selChapter, selStep, editLocale);
                        setRecoverableDraft(null);
                      }}
                      className="min-h-8 px-2.5 py-1 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
                    >
                      {s.discardDraftBtn}
                    </button>
                  </div>
                </div>
              )}

              {/* Split-Pane Editor & Real-Time Hand-Drawn Preview */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                {/* Left Pane: Frontmatter + Stationery Snippets + Markdown Source */}
                <div className="studio-panel p-5 space-y-4 min-w-0">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-8">
                      <label
                        htmlFor="doc-title-input"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.titleInputLabel}
                      </label>
                      <input
                        id="doc-title-input"
                        type="text"
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder={s.titleInputPlaceholder}
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-ink text-sm ink-input-inset"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="doc-stepnum-input"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.stepNumLabel}
                      </label>
                      <input
                        id="doc-stepnum-input"
                        type="number"
                        min={1}
                        value={docStepNum}
                        onChange={(e) =>
                          setDocStepNum(Number(e.target.value) || 1)
                        }
                        className="w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="doc-mins-input"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.minutesLabel}
                      </label>
                      <input
                        id="doc-mins-input"
                        type="number"
                        min={1}
                        value={docMinutes}
                        onChange={(e) =>
                          setDocMinutes(Number(e.target.value) || 5)
                        }
                        className="w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="doc-summary-input"
                      className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                    >
                      {s.summaryInputLabel}
                    </label>
                    <input
                      id="doc-summary-input"
                      type="text"
                      value={docSummary}
                      onChange={(e) => setDocSummary(e.target.value)}
                      placeholder={s.summaryInputPlaceholder}
                      className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-7">
                      <label
                        htmlFor="doc-license-select"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.licenseSelectLabel}
                      </label>
                      <select
                        id="doc-license-select"
                        name="license"
                        value={docLicense}
                        onChange={(e) =>
                          setDocLicense(normalizeLicenseId(e.target.value))
                        }
                        className="ink-select w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs sm:text-sm"
                      >
                        <option value="">
                          {s.licenseFollowSite(
                            copy.licenseNames[
                              normalizeLicenseId(siteSettings.default_license) ||
                                'cc-by-nc-sa-4.0'
                            ],
                          )}
                        </option>
                        {ALL_LICENSE_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {copy.licenseNames[opt.id]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-5">
                      <label
                        htmlFor="doc-tags-input"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.tagsInputLabel}
                      </label>
                      <input
                        id="doc-tags-input"
                        type="text"
                        value={docTagsText}
                        onChange={(e) => setDocTagsText(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono"
                      />
                    </div>
                  </div>

                  {/* Accessible Editor Mode Tablist (`modern-web-guidance/tabs`): Visual Editor primary, Markdown fallback */}
                  <div className="space-y-4">
                    <div
                      role="tablist"
                      aria-label={s.visual.modeAria}
                      onKeyDown={handleEditorTabKeyDown}
                      className="editor-mode-tablist"
                      {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
                    >
                      <button
                        ref={visualTabRef}
                        id={visualTabId}
                        type="button"
                        role="tab"
                        aria-selected={editorMode === 'visual'}
                        tabIndex={editorMode === 'visual' ? 0 : -1}
                        onClick={() => handleSwitchEditorMode('visual')}
                        className="editor-mode-tab"
                        {...(editorMode === 'visual'
                          ? ({ focusgroupstart: '' } as Record<string, string>)
                          : {})}
                      >
                        <IconLayers className="w-3.5 h-3.5" />
                        <span>{s.visual.visualTab}</span>
                      </button>
                      <button
                        ref={markdownTabRef}
                        id={markdownTabId}
                        type="button"
                        role="tab"
                        aria-selected={editorMode === 'markdown'}
                        tabIndex={editorMode === 'markdown' ? 0 : -1}
                        onClick={() => handleSwitchEditorMode('markdown')}
                        className="editor-mode-tab"
                        {...(editorMode === 'markdown'
                          ? ({ focusgroupstart: '' } as Record<string, string>)
                          : {})}
                      >
                        <IconFileCode className="w-3.5 h-3.5" />
                        <span>{s.visual.markdownTab}</span>
                      </button>
                    </div>

                    {/* Panel 1: Primary Visual Block Editor (zero padding/border/bg on role="tabpanel" element itself) */}
                    <div
                      role="tabpanel"
                      aria-labelledby={visualTabId}
                      hidden={editorMode !== 'visual'}
                    >
                      <div className="editor-tabpanel-body">
                        <VisualBlockEditor
                          locale={locale}
                          blocks={visualBlocks}
                          onChange={handleVisualBlocksChange}
                        />
                      </div>
                    </div>

                    {/* Panel 2: Markdown Source Fallback (zero padding/border/bg on role="tabpanel" element itself) */}
                    <div
                      role="tabpanel"
                      aria-labelledby={markdownTabId}
                      hidden={editorMode !== 'markdown'}
                    >
                      <div className="editor-tabpanel-body space-y-4">
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-ink-secondary">
                            {s.snippetsHeading}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {stationerySnippets.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => insertSnippetAtCursor(item.snippet)}
                                className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-mono bg-surface-raised hover:bg-action-subtle text-ink-primary border border-border-subtle cursor-pointer transition-colors"
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="doc-markdown-body"
                            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                          >
                            {s.markdownLabel}
                          </label>
                          <textarea
                            id="doc-markdown-body"
                            ref={textareaRef}
                            rows={22}
                            value={docBody}
                            onChange={(e) => setDocBody(e.target.value)}
                            className="w-full p-3.5 rounded-xl bg-surface-raised text-ink-primary border border-border-ink font-mono text-xs sm:text-sm leading-relaxed ink-input-inset"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Pane: Real-Time Compiled Notebook Sheet Preview (Unified Renderer) */}
                <div className="notebook-sheet-stack min-w-0">
                  <div className="notebook-sheet-card p-5 sm:p-7 space-y-4">
                    <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-dashed border-border-subtle">
                      <span className="text-xs font-mono uppercase tracking-wider text-accent-ice font-semibold">
                        {s.livePreviewBadge(editLocale)}
                      </span>
                      <span className="text-xs font-mono text-ink-muted tabular-nums">
                        v{docSyncedRev} · {docStatus}
                      </span>
                    </div>

                    <div>
                      <h2
                        className="text-2xl font-semibold text-ink-primary m-0 leading-tight"
                        style={{ fontFamily: 'var(--font-hand)' }}
                      >
                        {docTitle || s.untitledPlaceholder}
                      </h2>
                      <svg
                        aria-hidden="true"
                        className="w-52 max-w-full h-2.5 mt-0.5 block"
                        viewBox="0 0 220 10"
                        fill="none"
                      >
                        <path
                          d="M3 6.5 C 65 2.5, 138 9, 216 4.2"
                          stroke="var(--marker-h1)"
                          strokeWidth="3.6"
                          strokeLinecap="round"
                        />
                      </svg>
                      {docSummary && (
                        <p className="mt-2 text-sm text-ink-secondary leading-relaxed m-0">
                          {docSummary}
                        </p>
                      )}
                    </div>

                    <div className="pt-2">
                      {previewBlocks.length === 0 ? (
                        <NotebookEmptyState
                          title={s.previewEmptyTitle}
                          description={s.previewEmptyDesc}
                        />
                      ) : (
                        <NotebookBlockRenderer
                          blocks={previewBlocks}
                          copy={copy}
                          theme={theme}
                          stepChecks={{
                            checkedIds: previewCheckedIds,
                            onToggle: (itemId, checked) =>
                              setPreviewStepOverrides((prev) => ({
                                ...prev,
                                [itemId]: checked,
                              })),
                            onResetIds: (itemIds) =>
                              setPreviewStepOverrides((prev) => {
                                const next = { ...prev };
                                for (const id of itemIds) next[id] = false;
                                return next;
                              }),
                          }}
                        />
                      )}
                    </div>

                    <div className="pt-4 border-t border-dashed border-border-subtle">
                      <CcLicenseCard
                        locale={editLocale}
                        copy={UI_COPY[editLocale]}
                        stepLicense={docLicense}
                        siteDefaultLicense={siteSettings.default_license}
                        authorName={
                          user?.display_name || siteSettings.default_author_name
                        }
                        compact
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* SECTION C: Tracks, Chapters & 4-Locale Translation Matrix       */}
          {/* --------------------------------------------------------------- */}
          {activeSection === 'catalog' && (
            <div key="studio-sec-catalog" className="ui-panel-enter space-y-6">
              <h1 className="text-xl font-semibold text-ink-primary m-0">
                {s.catalogTitle}
              </h1>

              {tracks.length === 0 ? (
                <div className="studio-panel p-6">
                  <NotebookEmptyState
                    title={s.catalogEmptyTitle}
                    description={s.catalogEmptyDesc}
                  />
                </div>
              ) : (
                tracks.map((t) => (
                  <div
                    key={t.track_id}
                    className="studio-panel p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs text-ink-muted">
                          {t.slug}
                        </span>
                        <h2 className="text-base font-semibold text-ink-primary m-0">
                          {t.title}
                        </h2>
                      </div>
                      <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-surface-raised text-ink-secondary">
                        {copy.difficultyLabels[t.difficulty] ?? t.difficulty}
                      </span>
                    </div>

                    {t.chapters.map((ch) => (
                      <div
                        key={ch.chapter_id}
                        className="rounded-xl p-4 bg-surface-raised space-y-3"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-ink-primary">
                            {ch.title}{' '}
                            <span className="font-mono text-xs text-ink-muted">
                              ({ch.slug})
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickNewStepFromSidebar(t.slug, ch.slug)
                            }
                            className="min-h-7 text-xs font-semibold text-link-ink hover:underline cursor-pointer shrink-0"
                          >
                            {s.addStepHereBtn}
                          </button>
                        </div>

                        <div className="space-y-2">
                          {ch.steps.map((st) => (
                            <div
                              key={st.step_id}
                              className="p-3 rounded-xl bg-surface-sheet flex flex-wrap items-baseline justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <span className="font-mono text-xs text-ink-muted me-2 tabular-nums">
                                  #{st.step_number}
                                </span>
                                <span className="text-sm font-semibold text-ink-primary">
                                  {st.title}
                                </span>
                                <span className="ms-2 font-mono text-xs text-ink-muted tabular-nums">
                                  {s.canonicalRevMeta(st.canonical_revision)}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                {LOCALES.map((loc) => {
                                  const found = st.translations.find(
                                    (tr) => tr.locale === loc.code,
                                  );
                                  const drifted =
                                    found &&
                                    found.synced_revision < st.canonical_revision;
                                  return (
                                    <button
                                      key={loc.code}
                                      type="button"
                                      onClick={() =>
                                        handleOpenEditorTarget(
                                          t.slug,
                                          ch.slug,
                                          st.slug,
                                          loc.code,
                                        )
                                      }
                                      className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-mono border cursor-pointer transition-colors"
                                      style={
                                        !found
                                          ? {
                                              borderColor: 'var(--border-subtle)',
                                              color: 'var(--ink-muted)',
                                            }
                                          : found.status === 'draft'
                                            ? {
                                                backgroundColor:
                                                  'var(--alert-note-bg)',
                                                borderColor:
                                                  'var(--alert-note-border)',
                                                color: 'var(--alert-note-title)',
                                              }
                                            : drifted
                                              ? {
                                                  backgroundColor:
                                                    'var(--alert-warn-bg)',
                                                  borderColor:
                                                    'var(--alert-warn-border)',
                                                  color:
                                                    'var(--alert-warn-title)',
                                                }
                                              : {
                                                  backgroundColor:
                                                    'var(--action-subtle)',
                                                  borderColor:
                                                    'var(--border-subtle)',
                                                  color: 'var(--ink-primary)',
                                                }
                                      }
                                    >
                                      {loc.code}{' '}
                                      {!found
                                        ? s.addLocaleAction
                                        : found.status === 'draft'
                                          ? s.draftParen
                                          : drifted
                                            ? `⚠v${found.synced_revision}`
                                            : `✓v${found.synced_revision}`}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}

              {/* Create New Track & Chapter Forms */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <form
                  onSubmit={(e) => void handleCreateTrack(e)}
                  className="studio-panel p-5"
                >
                  <h3 className="text-base font-semibold text-ink-primary m-0 mb-5">
                    {s.createTrackTitle}
                  </h3>
                  <div className="mb-5">
                    <label
                      htmlFor="new-track-slug"
                      className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                    >
                      {s.trackSlugLabel}
                    </label>
                    <input
                      id="new-track-slug"
                      type="text"
                      required
                      value={trackSlugInput}
                      onChange={(e) => setTrackSlugInput(e.target.value)}
                      placeholder={s.trackSlugPlaceholder}
                      className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                    />
                  </div>
                  <div className="mb-5">
                    <label
                      htmlFor="new-track-title"
                      className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                    >
                      {s.trackTitleLabel}
                    </label>
                    <input
                      id="new-track-title"
                      type="text"
                      required
                      value={trackTitleInput}
                      onChange={(e) => setTrackTitleInput(e.target.value)}
                      placeholder={s.trackTitlePlaceholder}
                      className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                    />
                  </div>
                  <div className="mb-5">
                    <label
                      htmlFor="new-track-desc"
                      className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                    >
                      {s.trackDescLabel}
                    </label>
                    <input
                      id="new-track-desc"
                      type="text"
                      value={trackDescInput}
                      onChange={(e) => setTrackDescInput(e.target.value)}
                      placeholder={s.trackDescPlaceholder}
                      className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                    />
                  </div>
                  {/* Mobile-first 1-col -> sm:3-col grid (§3.3.1, fixes 375px squished inputs) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    <div>
                      <label
                        htmlFor="new-track-diff"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.difficultyLabel}
                      </label>
                      <select
                        id="new-track-diff"
                        value={trackDifficulty}
                        onChange={(e) => setTrackDifficulty(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                      >
                        <option value="beginner">{copy.difficultyLabels.beginner}</option>
                        <option value="intermediate">{copy.difficultyLabels.intermediate}</option>
                        <option value="advanced">{copy.difficultyLabels.advanced}</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="new-track-chslug"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.firstChapterSlugLabel}
                      </label>
                      <input
                        id="new-track-chslug"
                        type="text"
                        value={firstChSlugInput}
                        onChange={(e) => setFirstChSlugInput(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="new-track-chtitle"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.firstChapterTitleLabel}
                      </label>
                      <input
                        id="new-track-chtitle"
                        type="text"
                        value={firstChTitleInput}
                        onChange={(e) => setFirstChTitleInput(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
                  >
                    {s.createTrackSubmit}
                  </button>
                </form>

                <form
                  onSubmit={(e) => void handleCreateChapter(e)}
                  className="studio-panel p-5"
                >
                  <h3 className="text-base font-semibold text-ink-primary m-0 mb-5">
                    {s.createChapterTitle}
                  </h3>
                  <div className="mb-5">
                    <label
                      htmlFor="ch-parent-track"
                      className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                    >
                      {s.parentTrackLabel}
                    </label>
                    <select
                      id="ch-parent-track"
                      value={newChTrack}
                      onChange={(e) => setNewChTrack(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm"
                    >
                      {tracks.map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="new-ch-slug"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.chapterSlugLabel}
                      </label>
                      <input
                        id="new-ch-slug"
                        type="text"
                        required
                        value={newChSlug}
                        onChange={(e) => setNewChSlug(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="new-ch-num"
                        className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                      >
                        {s.chapterNumLabel}
                      </label>
                      <input
                        id="new-ch-num"
                        type="number"
                        min={1}
                        value={newChNumber}
                        onChange={(e) =>
                          setNewChNumber(Number(e.target.value) || 1)
                        }
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="mb-5">
                    <label
                      htmlFor="new-ch-title"
                      className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                    >
                      {s.chapterTitleLabel}
                    </label>
                    <input
                      id="new-ch-title"
                      type="text"
                      required
                      value={newChTitle}
                      onChange={(e) => setNewChTitle(e.target.value)}
                      placeholder={s.chapterTitlePlaceholder}
                      className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                    />
                  </div>
                  <button
                    type="submit"
                    className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer"
                  >
                    {s.createChapterSubmit}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* SECTION D: Admin User & Role Governance                         */}
          {/* --------------------------------------------------------------- */}
          {isAdmin && activeSection === 'users' && (
            <div key="studio-sec-users" className="ui-panel-enter space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h1
                  id={usersTableCaptionId}
                  className="text-xl font-semibold text-ink-primary m-0"
                >
                  {s.usersTitle}
                </h1>

                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                  {roleFeedback && (
                    <span
                      aria-live="polite"
                      className="text-xs font-mono font-semibold text-accent-success me-2"
                    >
                      {roleFeedback}
                    </span>
                  )}
                  <span className="px-2.5 py-1 rounded-lg bg-surface-sheet border border-border-subtle text-ink-primary">
                    {s.roleCountAdmin(adminCount)}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-surface-sheet border border-border-subtle text-ink-secondary">
                    {s.roleCountAuthor(authorCount)}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-surface-sheet border border-border-subtle text-ink-muted">
                    {s.roleCountReader(readerCount)}
                  </span>
                </div>
              </div>

              <div className="studio-panel p-4 sm:p-5 space-y-4">

                {usersList.length === 0 ? (
                  <NotebookEmptyState
                    title={s.usersEmptyTitle}
                    description={s.usersEmptyDesc}
                  />
                ) : (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-labelledby={usersTableCaptionId}
                    className="responsive-table-region"
                  >
                    <table
                      className="responsive-table text-start text-sm"
                      style={responsiveTableVars}
                    >
                      <thead>
                        <tr className="border-b border-border-subtle text-xs uppercase tracking-wider text-ink-muted">
                          <th className="py-3 px-4 text-start font-semibold">
                            {s.colIdentity}
                          </th>
                          <th className="py-3 px-4 text-start font-semibold">
                            {s.colAuthSource}
                          </th>
                          <th className="py-3 px-4 text-start font-semibold">
                            {s.colRole}
                          </th>
                          <th className="py-3 px-4 text-end font-semibold">
                            {s.colWpId}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersList.map((u) => (
                          <tr
                            key={u.id}
                            className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-raised/50"
                          >
                            <th
                              scope="row"
                              className="py-3.5 px-4 text-start font-normal"
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  aria-hidden="true"
                                  className="w-8 h-8 bg-action-bg text-action-fg font-mono font-semibold flex items-center justify-center text-xs shrink-0"
                                  style={{
                                    clipPath:
                                      'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                                  }}
                                >
                                  {u.display_name.slice(0, 1).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-ink-primary">
                                    {u.display_name}{' '}
                                    <span className="font-mono text-xs text-ink-muted">
                                      @{u.username}
                                    </span>
                                  </div>
                                  <div className="text-xs text-ink-muted truncate">
                                    {u.email}
                                  </div>
                                </div>
                              </div>
                            </th>
                            <td className="py-3.5 px-4 text-xs font-mono text-ink-secondary">
                              {u.auth_source}
                            </td>
                            <td className="py-3.5 px-4">
                              <select
                                aria-label={s.changeRoleAria(u.display_name)}
                                value={u.role}
                                disabled={u.id === user.id}
                                onChange={(e) =>
                                  void handleRoleChange(
                                    u.id,
                                    e.target.value as UserRole,
                                  )
                                }
                                className="min-h-8 px-2.5 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono disabled:opacity-60"
                              >
                                <option value="reader">{s.roleOptReader}</option>
                                <option value="author">{s.roleOptAuthor}</option>
                                <option value="admin">{s.roleOptAdmin}</option>
                              </select>
                            </td>
                            <td className="py-3.5 px-4 text-end font-mono text-xs tabular-nums text-ink-muted">
                              {u.wp_user_id ? `#${u.wp_user_id}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* SECTION E: Admin Site Settings                                  */}
          {/* --------------------------------------------------------------- */}
          {isAdmin && activeSection === 'settings' && (
            <div key="studio-sec-settings" className="ui-panel-enter">
              <StudioSettingsPanel
                locale={locale}
                settings={siteSettings}
                onSettingsUpdated={onSettingsUpdated}
              />
            </div>
          )}
        </div>
      </main>

      {/* New Article Dialog (replaces permanent Track/Chapter/Slug clutter in Editor bar) */}
      <ModalDialog
        open={creatingNewStep}
        onClose={() => setCreatingNewStep(false)}
        ariaLabelledBy={newStepTitleId}
        maxWidthClass="max-w-md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleStartNewStep();
          }}
          className="p-5 space-y-4"
        >
          <h3
            id={newStepTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {s.startNewNoteCta}
          </h3>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="modal-new-track"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.stepTrackLabel}
              </label>
              <select
                id="modal-new-track"
                value={selTrack}
                onChange={(e) => handleTrackSelect(e.target.value)}
                className="w-full ps-3 pe-7 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm"
              >
                {tracks.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.title} ({t.slug})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="modal-new-chapter"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.stepChapterLabel}
              </label>
              <select
                id="modal-new-chapter"
                value={selChapter}
                onChange={(e) => handleChapterSelect(e.target.value)}
                className="w-full ps-3 pe-7 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm"
              >
                {(currentTrackObj?.chapters ?? []).map((ch) => (
                  <option key={ch.slug} value={ch.slug}>
                    {ch.title} ({ch.slug})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="modal-new-slug"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.stepSlugLabel}
              </label>
              <input
                id="modal-new-slug"
                type="text"
                required
                value={newStepSlug}
                onChange={(e) => setNewStepSlug(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-ink text-sm font-mono ink-input-inset"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCreatingNewStep(false)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="submit"
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
            >
              {s.createBtn}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Destructive Delete Confirmation Modal (Unified `<ModalDialog>` with Safari fallback + §2.8.1 crimson CTA) */}
      <ModalDialog
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        ariaLabelledBy={deleteTitleId}
        maxWidthClass="max-w-sm"
      >
        <div className="p-5 space-y-4">
          <h3
            id={deleteTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {s.deleteDialogTitle(selStep)}
          </h3>
          <p className="text-xs text-ink-secondary leading-relaxed m-0">
            {s.deleteDialogDesc}
          </p>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDeleteModalOpen(false)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmDeleteStep()}
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold text-white border-2 border-border-ink cursor-pointer"
              style={{
                backgroundColor: 'var(--palette-danger-500)',
                boxShadow: 'var(--shadow-control)',
              }}
            >
              {s.deleteConfirmBtn}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
