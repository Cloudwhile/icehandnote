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
  type ChangeEvent,
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
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PasswordStrengthMeter } from '../components/auth/PasswordStrengthMeter';
import { CcLicenseCard } from '../components/notebook/CcLicenseCard';
import { NotebookBlockRenderer } from '../components/notebook/NotebookBlockRenderer';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import { StudioEditorInspector } from '../components/studio/StudioEditorInspector';
import { StudioMobileDrawer } from '../components/studio/StudioMobileDrawer';
import { StudioOverviewPanel } from '../components/studio/StudioOverviewPanel';
import { StudioSettingsPanel } from '../components/studio/StudioSettingsPanel';
import {
  StudioSidebarContent,
  type StudioSectionId,
} from '../components/studio/StudioSidebarContent';
import {
  VisualBlockEditor,
  VisualBlockToolStrip,
} from '../components/studio/VisualBlockEditor';
import {
  IconBook,
  IconExternalLink,
  IconFileCode,
  IconGlobe,
  IconImage,
  IconLayers,
  IconLogOut,
  IconMenu,
  IconMoon,
  IconMoreHorizontal,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconSidebarToggle,
  IconSnowflake,
  IconSun,
  IconTrash,
} from '../components/ui/Icons';
import { ModalDialog } from '../components/ui/ModalDialog';
import { PopupMenu } from '../components/ui/PopupMenu';
import { useToast } from '../components/ui/ToastProvider';
import { UserAvatar } from '../components/ui/UserAvatar';
import { api } from '../lib/api';
import {
  detectSystemLocale,
  LOCALES,
  type LocalePreference,
  UI_COPY,
} from '../lib/i18n';
import { RC3_COPY } from '../lib/i18nRc3';
import { normalizeLicenseId } from '../lib/licenses';
import { SafeHtml, stripHtmlTags } from '../lib/sanitizer';
import type { ResolvedTheme } from '../lib/theme';
import {
  getEffectiveOAuthProviders,
  type ArticleAuthorDto,
  type CollaboratorInviteDto,
  type LicenseId,
  type LocaleCode,
  type NotebookBlock,
  type SiteSettingsDto,
  type StudioSettingsTabId,
  type StudioStepEditorDto,
  type StudioTrackDto,
  type UserProfileDto,
  type UserRole,
} from '../lib/types';
import {
  createDefaultVisualBlock,
  createVisualId,
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
  onOpenProfile: () => void;
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
  onOpenProfile,
  onLogout,
}: StudioPageProps) {
  const copy = UI_COPY[locale];
  const s = copy.studio;
  const rc3 = RC3_COPY[locale];
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const usersTableCaptionId = useId();
  const deleteTitleId = useId();
  const newStepTitleId = useId();
  const takedownTitleId = useId();
  const deleteCatalogTitleId = useId();
  const createUserTitleId = useId();
  const banUserTitleId = useId();
  const resetPwTitleId = useId();
  const deleteUserTitleId = useId();
  const visualTabId = useId();
  const markdownTabId = useId();
  const visualTabRef = useRef<HTMLButtonElement | null>(null);
  const markdownTabRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mdImageInputRef = useRef<HTMLInputElement | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const saveActionRef = useRef<() => void>(() => {});

  // Dashboard shell navigation state
  const [activeSection, setActiveSection] = useState<StudioSectionId>('overview');
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<StudioSettingsTabId>('general');
  const handleSelectSettingsTab = useCallback((tab: StudioSettingsTabId) => {
    setActiveSettingsTab(tab);
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, []);
  const enabledOAuthCount = useMemo(
    () =>
      getEffectiveOAuthProviders(siteSettings).filter(
        (p) => p.enabled && p.client_id.trim(),
      ).length,
    [siteSettings],
  );
  const [editorMode, setEditorMode] = useState<'visual' | 'markdown'>('visual');
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : true,
  );
  const [previewSplitOpen, setPreviewSplitOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

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
  const [docMinutes, setDocMinutes] = useState(1);
  const [docVersion, setDocVersion] = useState(1);
  const [docSyncedRev, setDocSyncedRev] = useState(1);
  const [docCanonicalRev, setDocCanonicalRev] = useState(1);
  const [bumpCanonical, setBumpCanonical] = useState(false);
  const [docStatus, setDocStatus] = useState<'published' | 'draft'>('published');
  const [docLicense, setDocLicense] = useState<LicenseId | ''>('');
  const [docTagsText, setDocTagsText] = useState('');
  const [docBody, setDocBody] = useState('');
  const [visualBlocks, setVisualBlocks] = useState<VisualBlock[]>([]);
  const [docExists, setDocExists] = useState(true);
  const [docAuthors, setDocAuthors] = useState<ArticleAuthorDto[]>([]);
  const [docPendingInvites, setDocPendingInvites] = useState<CollaboratorInviteDto[]>([]);
  const [canManageCollaborators, setCanManageCollaborators] = useState(false);
  const [docTakedownReason, setDocTakedownReason] = useState<string | null>(null);
  const [docTakedownBy, setDocTakedownBy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [uploadingMdImage, setUploadingMdImage] = useState(false);

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
  const [saving, setSaving] = useState(false);

  // Quick new step inline creator
  const [newStepSlug, setNewStepSlug] = useState('');
  const [creatingNewStep, setCreatingNewStep] = useState(false);

  // Catalog: Create Track & Create Chapter forms + delete confirm
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

  const [deleteCatalogTarget, setDeleteCatalogTarget] = useState<
    | { kind: 'track'; trackSlug: string }
    | { kind: 'chapter'; trackSlug: string; chapterSlug: string }
    | null
  >(null);

  // Admin Takedown modal target
  const [takedownTarget, setTakedownTarget] = useState<{
    trackSlug: string;
    chapterSlug: string;
    stepSlug: string;
    title: string;
  } | null>(null);
  const [takedownReasonInput, setTakedownReasonInput] = useState('');
  const [submittingTakedown, setSubmittingTakedown] = useState(false);

  // Admin Users & governance modals
  const [usersList, setUsersList] = useState<UserProfileDto[]>([]);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('author');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const [banTarget, setBanTarget] = useState<UserProfileDto | null>(null);
  const [banReasonInput, setBanReasonInput] = useState('');
  const [submittingBan, setSubmittingBan] = useState(false);

  const [resetPwTarget, setResetPwTarget] = useState<UserProfileDto | null>(null);
  const [resetPwInput, setResetPwInput] = useState('');
  const [submittingResetPw, setSubmittingResetPw] = useState(false);

  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfileDto | null>(null);

  const canAuthor = Boolean(user && (user.role === 'author' || user.role === 'admin'));
  const isAdmin = Boolean(user && user.role === 'admin');
  const autosaveEnabledRef = useRef(siteSettings.enable_draft_autosave);
  autosaveEnabledRef.current = siteSettings.enable_draft_autosave;
  const activeTargetKey = `${selTrack}/${selChapter}/${selStep}/${editLocale}`;
  const activeTargetRef = useRef(activeTargetKey);
  activeTargetRef.current = activeTargetKey;

  useEffect(() => {
    setLogoFailed(false);
  }, [siteSettings.logo_url]);

  // Reset main pane scroll position when switching Studio sections (fixes preserved scroll offset)
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  // Honor `?track=&chapter=&step=` deep links (e.g., after accepting a co-author invite)
  useEffect(() => {
    if (!canAuthor) return;
    const t = searchParams.get('track');
    const c = searchParams.get('chapter');
    const st = searchParams.get('step');
    if (t && c && st) {
      setSelTrack(t);
      setSelChapter(c);
      setSelStep(st);
      setActiveSection('editor');
      const next = new URLSearchParams(searchParams);
      next.delete('track');
      next.delete('chapter');
      next.delete('step');
      setSearchParams(next, { replace: true });
    }
  }, [canAuthor, searchParams, setSearchParams]);

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
        setDocVersion(dto.version ?? dto.synced_revision);
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
        setDocAuthors(dto.authors ?? []);
        setDocPendingInvites(dto.pending_invites ?? []);
        setCanManageCollaborators(Boolean(dto.can_manage_collaborators));
        setDocTakedownReason(dto.takedown_reason ?? null);
        setDocTakedownBy(dto.takedown_by ?? null);
        setLastInviteUrl('');
        setPreviewStepOverrides({});
        setSavedSnapshot(
          JSON.stringify({
            title: dto.title,
            summary: dto.summary,
            stepNum: dto.step_number,
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
        setDocAuthors([]);
        setDocPendingInvites([]);
        setCanManageCollaborators(false);
        setDocTakedownReason(null);
        setDocTakedownBy(null);
        toast.error(err);
      }
    },
    [canAuthor, toast],
  );

  useEffect(() => {
    void loadEditorStep(selTrack, selChapter, selStep, editLocale);
  }, [selTrack, selChapter, selStep, editLocale, loadEditorStep]);

  // Debounced live Rust AST preview (+ automatic reading minutes calculation)
  useEffect(() => {
    if (!canAuthor || activeSection !== 'editor') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!docBody.trim()) {
        setPreviewBlocks([]);
        setDocMinutes(1);
        return;
      }
      void api
        .studioPreview({
          title: docTitle,
          summary: docSummary,
          body_markdown: docBody,
        })
        .then((res) => {
          if (cancelled) return;
          setPreviewBlocks(res.blocks);
          if (typeof res.frontmatter?.estimated_minutes === 'number') {
            setDocMinutes(res.frontmatter.estimated_minutes);
          }
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
            setDocMinutes(saved.estimated_minutes);
            setDocVersion(saved.version ?? saved.synced_revision);
            setDocSyncedRev(saved.synced_revision);
            setDocCanonicalRev(saved.canonical_revision);
            setSavedSnapshot(
              JSON.stringify({
                title: cur.docTitle.trim(),
                summary: cur.docSummary.trim(),
                stepNum: cur.docStepNum,
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
    toast.info(s.switchedNewStepBanner(clean));
  };

  const handleVisualBlocksChange = (nextBlocks: VisualBlock[]) => {
    setVisualBlocks(nextBlocks);
    setDocBody(serializeVisualBlocksToMarkdown(nextBlocks));
  };

  const handleAppendVisualBlock = (kind: VisualBlock['type']) => {
    handleVisualBlocksChange([...visualBlocks, createDefaultVisualBlock(kind)]);
  };

  const handleAppendSectionTask = () => {
    handleVisualBlocksChange([
      ...visualBlocks,
      {
        id: createVisualId(),
        type: 'heading',
        level: 2,
        text: '',
        isTask: true,
        defaultChecked: false,
      },
    ]);
  };

  const handleTogglePreviewSplit = () => {
    setPreviewSplitOpen((prev) => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && window.innerWidth < 1536) {
        setInspectorOpen(false);
      }
      return next;
    });
  };

  const handleToggleInspector = () => {
    setInspectorOpen((prev) => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && window.innerWidth < 1536) {
        setPreviewSplitOpen(false);
      }
      return next;
    });
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

  const handleUploadMdImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploadingMdImage) return;
    setUploadingMdImage(true);
    try {
      const res = await api.uploadStudioMedia(file);
      const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
      insertSnippetAtCursor(`\n![${alt}](${res.url})\n`);
      toast.success(rc3.studio.imageUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingMdImage(false);
    }
  };

  const handleSaveStep = async () => {
    if (saving || (!isEditorDirty && docExists)) {
      return;
    }
    if (!docTitle.trim() || !selStep.trim()) {
      toast.warning(s.missingTitleOrSlugBanner);
      return;
    }
    setSaving(true);
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
      setDocMinutes(saved.estimated_minutes);
      setDocVersion(saved.version ?? saved.synced_revision);
      setDocSyncedRev(saved.synced_revision);
      setDocCanonicalRev(saved.canonical_revision);
      if (saved.authors) setDocAuthors(saved.authors);
      if (saved.pending_invites) setDocPendingInvites(saved.pending_invites);
      if (typeof saved.can_manage_collaborators === 'boolean') {
        setCanManageCollaborators(saved.can_manage_collaborators);
      }
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
          status: docStatus,
          license: docLicense,
          tags: docTagsText,
          body: docBody,
          bump: false,
        }),
      );
      await refreshOverview();
      const timeStr = new Date().toLocaleTimeString();
      toast.success(
        s.savedBanner(
          editLocale,
          saved.version ?? saved.synced_revision,
          saved.status === 'draft',
          timeStr,
        ),
      );
    } catch (err) {
      toast.error(err);
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
      toast.success(s.deletedBanner(deletedSlug));
    } catch (err) {
      toast.error(err);
    }
  };

  const handleInviteCollaborator = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = inviteEmail.trim();
    if (!cleanEmail || inviting) return;
    setInviting(true);
    try {
      const res = await api.createCollaboratorInvite(
        selTrack,
        selChapter,
        selStep,
        cleanEmail,
        locale,
      );
      setInviteEmail('');
      setLastInviteUrl(res.invite_url);
      setDocPendingInvites((prev) => [
        res.invite,
        ...prev.filter((inv) => inv.id !== res.invite.id),
      ]);
      if (res.email_sent) {
        toast.success(rc3.studio.inviteCreatedEmailSentMsg);
      } else {
        toast.info(rc3.studio.inviteCreatedLinkOnlyMsg);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setInviting(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!lastInviteUrl) return;
    try {
      await navigator.clipboard.writeText(lastInviteUrl);
      toast.success(rc3.settings.copiedMsg);
    } catch (err) {
      toast.error(err);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await api.revokeCollaboratorInvite(inviteId);
      setDocPendingInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
      toast.success(rc3.studio.inviteRevokedMsg);
    } catch (err) {
      toast.error(err);
    }
  };

  const handleRemoveCollaborator = async (targetUserId: string) => {
    try {
      await api.removeStepCollaborator(selTrack, selChapter, selStep, targetUserId);
      setDocAuthors((prev) => prev.filter((a) => a.user_id !== targetUserId));
      toast.success(rc3.studio.collaboratorRemovedMsg);
      void refreshOverview();
    } catch (err) {
      toast.error(err);
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
      toast.success(s.trackCreatedBanner(stripHtmlTags(created.title)));
    } catch (err) {
      toast.error(err);
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
      toast.success(s.chapterCreatedBanner(newChTrack));
    } catch (err) {
      toast.error(err);
    }
  };

  const handleConfirmDeleteCatalog = async () => {
    if (!deleteCatalogTarget) return;
    try {
      if (deleteCatalogTarget.kind === 'track') {
        await api.studioDeleteTrack(deleteCatalogTarget.trackSlug);
        toast.success(rc3.studio.trackDeletedMsg);
      } else {
        await api.studioDeleteChapter(
          deleteCatalogTarget.trackSlug,
          deleteCatalogTarget.chapterSlug,
        );
        toast.success(rc3.studio.chapterDeletedMsg);
      }
      setDeleteCatalogTarget(null);
      await refreshOverview();
    } catch (err) {
      toast.error(err);
    }
  };

  const handleConfirmTakedown = async (e: FormEvent) => {
    e.preventDefault();
    if (!takedownTarget || !takedownReasonInput.trim() || submittingTakedown) return;
    setSubmittingTakedown(true);
    try {
      const res = await api.adminTakedownStep(
        takedownTarget.trackSlug,
        takedownTarget.chapterSlug,
        takedownTarget.stepSlug,
        takedownReasonInput.trim(),
      );
      toast.success(rc3.studio.takedownSuccessMsg(res.emails_sent));
      if (
        takedownTarget.trackSlug === selTrack &&
        takedownTarget.chapterSlug === selChapter &&
        takedownTarget.stepSlug === selStep
      ) {
        setDocTakedownReason(takedownReasonInput.trim());
        setDocTakedownBy(user?.display_name ?? null);
      }
      setTakedownTarget(null);
      setTakedownReasonInput('');
      await refreshOverview();
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmittingTakedown(false);
    }
  };

  const handleRestoreStep = async (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
  ) => {
    try {
      await api.adminRestoreStep(trackSlug, chapterSlug, stepSlug);
      toast.success(rc3.studio.restoredSuccessMsg);
      if (trackSlug === selTrack && chapterSlug === selChapter && stepSlug === selStep) {
        setDocTakedownReason(null);
        setDocTakedownBy(null);
      }
      await refreshOverview();
    } catch (err) {
      toast.error(err);
    }
  };

  const handleRoleChange = async (targetUserId: string, nextRole: UserRole) => {
    try {
      const updated = await api.adminUpdateUserRole(targetUserId, nextRole);
      setUsersList((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      toast.success(
        s.roleUpdatedFeedback(updated.username, updated.role.toUpperCase()),
      );
    } catch (err) {
      toast.error(err);
    }
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newUserPassword || creatingUser) return;
    setCreatingUser(true);
    try {
      const created = await api.adminCreateUser({
        username: newUsername.trim(),
        display_name: newDisplayName.trim() || newUsername.trim(),
        email: newEmail.trim(),
        role: newUserRole,
        password: newUserPassword,
      });
      setUsersList((prev) => [created, ...prev]);
      setCreateUserOpen(false);
      setNewUsername('');
      setNewDisplayName('');
      setNewEmail('');
      setNewUserRole('author');
      setNewUserPassword('');
      toast.success(rc3.users.userCreatedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setCreatingUser(false);
    }
  };

  const handleConfirmBanUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!banTarget || submittingBan) return;
    setSubmittingBan(true);
    try {
      const updated = await api.adminSetUserBan(
        banTarget.id,
        true,
        banReasonInput.trim(),
      );
      setUsersList((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setBanTarget(null);
      setBanReasonInput('');
      toast.success(rc3.users.userBannedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmittingBan(false);
    }
  };

  const handleUnbanUser = async (target: UserProfileDto) => {
    try {
      const updated = await api.adminSetUserBan(target.id, false, '');
      setUsersList((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      toast.success(rc3.users.userUnbannedMsg);
    } catch (err) {
      toast.error(err);
    }
  };

  const handleConfirmResetUserPw = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetPwTarget || !resetPwInput || submittingResetPw) return;
    setSubmittingResetPw(true);
    try {
      const updated = await api.adminResetUserPassword(
        resetPwTarget.id,
        resetPwInput,
      );
      setUsersList((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setResetPwTarget(null);
      setResetPwInput('');
      toast.success(rc3.users.userPwResetMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmittingResetPw(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteUserTarget) return;
    try {
      await api.adminDeleteUser(deleteUserTarget.id);
      setUsersList((prev) => prev.filter((u) => u.id !== deleteUserTarget.id));
      setDeleteUserTarget(null);
      toast.success(rc3.users.userDeletedMsg);
    } catch (err) {
      toast.error(err);
    }
  };

  const adminCount = usersList.filter((u) => u.role === 'admin').length;
  const authorCount = usersList.filter((u) => u.role === 'author').length;
  const readerCount = usersList.filter((u) => u.role === 'reader').length;

  // Dynamic localized mobile stacked-card column labels (`responsive-table`)
  const responsiveTableVars = {
    '--col-2': JSON.stringify(s.colAuthSource),
    '--col-3': JSON.stringify(rc3.users.colStatus),
    '--col-4': JSON.stringify(s.colRole),
    '--col-5': JSON.stringify(rc3.users.colActions),
  } as CSSProperties;

  const combinedPreviewAuthor =
    docAuthors.length > 0
      ? docAuthors.map((a) => a.display_name).join(' · ')
      : user?.display_name || siteSettings.default_author_name;

  return (
    <div
      className="studio-shell"
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      {/* ================================================================= */}
      {/* ZONE 1 (上分區): Minimal Single-Row Studio Topbar                 */}
      {/* ================================================================= */}
      <header className="studio-topbar">
        {/* Left: Mobile Drawer Trigger FIRST (< 1024px, prevents 375px occlusion P0 #1) + Brand Logo + Desktop Collapse */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
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

          <Link
            to={`/${locale}`}
            title={s.backHomeTitle}
            className="inline-flex items-center gap-2 no-underline text-ink-primary min-w-0 shrink-0"
          >
            <span
              aria-hidden="true"
              className="w-7 h-7 rounded-lg flex items-center justify-center border border-border-ink bg-surface-raised shrink-0 overflow-hidden"
            >
              {siteSettings.logo_url && !logoFailed ? (
                <img
                  src={siteSettings.logo_url}
                  alt=""
                  onError={() => setLogoFailed(true)}
                  className="w-full h-full object-contain p-0.5"
                />
              ) : (
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
              )}
            </span>
            <SafeHtml
              as="span"
              html={siteSettings.site_name}
              className="hidden sm:inline text-sm font-semibold tracking-tight studio-ellipsis max-w-36"
            />
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
        </div>

        {/* Right: Search + Dropdown Locale + Theme + Dropdown Account */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
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
                <UserAvatar
                  name={user.display_name}
                  avatarUrl={user.avatar_url}
                  sizeClass="w-5 h-5"
                  textClass="text-xs"
                />
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

                <button
                  type="button"
                  onClick={(e) => {
                    close(e.detail !== 0);
                    onOpenProfile();
                  }}
                >
                  <IconSettings className="w-3.5 h-3.5 text-ink-muted" />
                  <span>{rc3.profile.menuItem}</span>
                </button>

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
          activeSettingsTab={activeSettingsTab}
          onSelectSettingsTab={handleSelectSettingsTab}
          enabledOAuthCount={enabledOAuthCount}
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
          activeSettingsTab={activeSettingsTab}
          onSelectSettingsTab={handleSelectSettingsTab}
          enabledOAuthCount={enabledOAuthCount}
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
      <main ref={mainScrollRef} className="studio-main studio-scroll-pane">
        <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-6">
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
          {/* SECTION B: 3-Zone WordPress / Canva-Style Article Editor        */}
          {/* Clean separation: Top Action & Tool Bar | Canvas | Info Panel   */}
          {/* --------------------------------------------------------------- */}
          {activeSection === 'editor' && (
            <div
              key="studio-sec-editor"
              className="ui-panel-enter studio-editor-workspace"
            >
              <h1 className="sr-only">{s.editorHeadingSr}</h1>

              {/* ZONE 1A: Top Editor Workbench Bar (Locale + Mode Switch + View Toggles + Publish + Save) */}
              <div className="studio-panel overflow-hidden">
                <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
                  {/* Left: Locale Dropdown + Visual/Source Mode Switcher + Live Auto-Save Status */}
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
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
                            v{docVersion}
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

                    {/* Segmented Visual / Source Code Editor Switcher (WordPress / Canva style) */}
                    <div
                      role="tablist"
                      aria-label={s.visual.modeAria}
                      onKeyDown={handleEditorTabKeyDown}
                      className="inline-flex items-center p-0.5 rounded-xl bg-surface-raised border border-border-subtle"
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
                        className={`min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                          editorMode === 'visual'
                            ? 'bg-surface-sheet text-ink-primary border border-border-subtle'
                            : 'text-ink-muted hover:text-ink-primary border border-transparent'
                        }`}
                        {...(editorMode === 'visual'
                          ? ({ focusgroupstart: '' } as Record<string, string>)
                          : {})}
                      >
                        <IconLayers className="w-3.5 h-3.5 text-ink-muted" />
                        <span>{rc3.studio.editorVisualMode}</span>
                      </button>
                      <button
                        ref={markdownTabRef}
                        id={markdownTabId}
                        type="button"
                        role="tab"
                        aria-selected={editorMode === 'markdown'}
                        tabIndex={editorMode === 'markdown' ? 0 : -1}
                        onClick={() => handleSwitchEditorMode('markdown')}
                        className={`min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                          editorMode === 'markdown'
                            ? 'bg-surface-sheet text-ink-primary border border-border-subtle'
                            : 'text-ink-muted hover:text-ink-primary border border-transparent'
                        }`}
                        {...(editorMode === 'markdown'
                          ? ({ focusgroupstart: '' } as Record<string, string>)
                          : {})}
                      >
                        <IconFileCode className="w-3.5 h-3.5 text-ink-muted" />
                        <span>{rc3.studio.editorSourceMode}</span>
                      </button>
                    </div>

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
                          className={`hidden md:inline-flex min-h-7 px-2 py-0.5 rounded-lg font-mono text-xs tabular-nums hover:bg-surface-raised hover:text-ink-primary transition-colors cursor-pointer ${statusTone}`}
                        >
                          {statusText}
                        </button>
                      ) : (
                        <span
                          role="status"
                          aria-live="polite"
                          className={`hidden md:inline font-mono text-xs tabular-nums ${statusTone}`}
                        >
                          {statusText}
                        </span>
                      );
                    })()}
                  </div>

                  {/* Right: Preview Split Toggle + Article Info Panel Toggle + Publish Switch + Overflow + ONE Primary Save */}
                  <div className="flex flex-wrap items-center gap-2 ms-auto">
                    <button
                      type="button"
                      aria-pressed={previewSplitOpen}
                      onClick={handleTogglePreviewSplit}
                      className={`min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                        previewSplitOpen
                          ? 'bg-action-subtle border-action-bg text-ink-primary'
                          : 'bg-surface-raised border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary'
                      }`}
                    >
                      <IconBook className="w-3.5 h-3.5 text-ink-muted" />
                      <span>{rc3.studio.editorPreviewToggle}</span>
                    </button>

                    <button
                      type="button"
                      aria-pressed={inspectorOpen}
                      onClick={handleToggleInspector}
                      className={`min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                        inspectorOpen
                          ? 'bg-action-subtle border-action-bg text-ink-primary'
                          : 'bg-surface-raised border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary'
                      }`}
                    >
                      <IconSidebarToggle className="w-3.5 h-3.5 text-ink-muted" />
                      <span>{rc3.studio.editorInspectorToggle}</span>
                    </button>

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

                    {/* Overflow Dropdown Menu folding Bump Rev, Preview, New Article, Takedown & Delete */}
                    <PopupMenu
                      align="end"
                      showChevron={false}
                      triggerAriaLabel={s.editorHeadingSr}
                      triggerClassName="w-8 h-8 rounded-xl bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary"
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

                          {isAdmin && docExists && (
                            <>
                              <hr />
                              {docTakedownReason ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    close(e.detail !== 0);
                                    void handleRestoreStep(selTrack, selChapter, selStep);
                                  }}
                                >
                                  <IconShield className="w-3.5 h-3.5 text-ink-muted" />
                                  <span>{rc3.studio.restoreBtn}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  data-tone="danger"
                                  onClick={(e) => {
                                    close(e.detail !== 0);
                                    setTakedownReasonInput('');
                                    setTakedownTarget({
                                      trackSlug: selTrack,
                                      chapterSlug: selChapter,
                                      stepSlug: selStep,
                                      title: stripHtmlTags(docTitle) || selStep,
                                    });
                                  }}
                                >
                                  <IconShield className="w-3.5 h-3.5" />
                                  <span>{rc3.studio.takedownBtn}</span>
                                </button>
                              )}
                            </>
                          )}

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
                      disabled={saving || (!isEditorDirty && docExists)}
                      onClick={() => void handleSaveStep()}
                      title="Ctrl+S / ⌘S"
                      className="min-h-8 px-4 py-1.5 rounded-xl text-xs sm:text-sm font-semibold ink-btn-primary inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

                {/* ZONE 1B: Dedicated Separated Contextual Editing Tool Bar (`工具栏`) */}
                <div
                  role="toolbar"
                  aria-label={rc3.studio.editorToolbarAria}
                  className="px-4 py-2.5 border-t border-border-subtle bg-surface-raised/60"
                >
                  {editorMode === 'visual' ? (
                    <VisualBlockToolStrip
                      locale={locale}
                      blockCount={visualBlocks.length}
                      onInsertBlock={handleAppendVisualBlock}
                      onInsertSectionTask={handleAppendSectionTask}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        ref={mdImageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                        onChange={(e) => void handleUploadMdImage(e)}
                        className="sr-only"
                      />
                      <button
                        type="button"
                        disabled={uploadingMdImage}
                        onClick={() => mdImageInputRef.current?.click()}
                        className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-sheet hover:bg-action-subtle text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
                      >
                        <IconImage className="w-3.5 h-3.5 text-ink-muted" />
                        <span>{s.snippets.image}</span>
                      </button>
                      {stationerySnippets.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => insertSnippetAtCursor(item.snippet)}
                          className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-mono bg-surface-sheet hover:bg-action-subtle text-ink-primary border border-border-subtle hover:border-border-ink cursor-pointer transition-colors"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Admin Takedown Notice Banner */}
              {docTakedownReason && (
                <div
                  role="alert"
                  className="ui-panel-enter studio-panel px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  style={{
                    backgroundColor: 'var(--alert-danger-bg)',
                    borderColor: 'var(--alert-danger-border)',
                    borderInlineStartWidth: '4px',
                  }}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div
                      className="text-xs font-semibold"
                      style={{ color: 'var(--alert-danger-title)' }}
                    >
                      {rc3.studio.takedownBannerTitle}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: 'var(--alert-danger-body)' }}
                    >
                      {rc3.studio.takedownBannerMeta(
                        docTakedownBy ?? '',
                        docTakedownReason,
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleRestoreStep(selTrack, selChapter, selStep)
                      }
                      className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer shrink-0"
                    >
                      {rc3.studio.restoreBtn}
                    </button>
                  )}
                </div>
              )}

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

              {/* ZONE 2 (编辑区) & ZONE 3 (信息栏): Separated Writing Canvas + Optional Preview + Collapsible Inspector */}
              <div className="studio-editor-body">
                {/* ZONE 2: Dedicated Writing & Design Canvas (`编辑区`) + Optional Live Split Preview */}
                <div className="flex-1 min-w-0">
                  <div
                    className={
                      previewSplitOpen
                        ? 'grid grid-cols-1 xl:grid-cols-2 gap-6 items-start'
                        : 'w-full'
                    }
                  >
                    {/* Active Editing Canvas (`可视化视图` or `源代码`) */}
                    <div className="min-w-0">
                      {/* Panel 1: Visual Block Canvas (`可视化视图编辑`) */}
                      <div
                        role="tabpanel"
                        aria-labelledby={visualTabId}
                        hidden={editorMode !== 'visual'}
                      >
                        <div className="editor-tabpanel-body studio-panel p-5 sm:p-7 space-y-6">
                          {/* WordPress / Canva-style direct inline Canvas Document Title */}
                          <div className="pb-4 border-b border-dashed border-border-subtle space-y-1.5">
                            <input
                              type="text"
                              aria-label={s.titleInputLabel}
                              value={docTitle}
                              onChange={(e) => setDocTitle(e.target.value)}
                              placeholder={rc3.studio.editorCanvasTitlePlaceholder}
                              style={{ fontFamily: 'var(--font-hand)' }}
                              className="w-full bg-transparent border-0 p-0 text-2xl sm:text-3xl font-semibold text-ink-primary placeholder:text-ink-muted/60 focus:outline-none leading-tight tracking-tight"
                            />
                            <svg
                              aria-hidden="true"
                              className="w-52 max-w-full h-2.5 block pointer-events-none"
                              viewBox="0 0 220 10"
                              fill="none"
                            >
                              <path
                                d="M3 6.5 C 65 2.5, 138 9, 216 4.2"
                                stroke="var(--marker-h1)"
                                strokeWidth="3.4"
                                strokeLinecap="round"
                              />
                            </svg>
                          </div>

                          <VisualBlockEditor
                            locale={locale}
                            blocks={visualBlocks}
                            onChange={handleVisualBlocksChange}
                            hideTopInserter
                          />
                        </div>
                      </div>

                      {/* Panel 2: Dedicated Markdown Source Code Canvas (`源代码编辑`) */}
                      <div
                        role="tabpanel"
                        aria-labelledby={markdownTabId}
                        hidden={editorMode !== 'markdown'}
                      >
                        <div className="editor-tabpanel-body studio-panel p-5 space-y-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <label
                              htmlFor="doc-markdown-body"
                              className="text-xs font-semibold text-ink-secondary"
                            >
                              {s.markdownLabel}
                            </label>
                            <span className="text-xs font-mono text-ink-muted tabular-nums">
                              {docTitle ? stripHtmlTags(docTitle) : selStep}
                            </span>
                          </div>
                          <textarea
                            id="doc-markdown-body"
                            ref={textareaRef}
                            rows={26}
                            value={docBody}
                            onChange={(e) => setDocBody(e.target.value)}
                            spellCheck={false}
                            className="ink-field-input min-h-[34rem] p-4 font-mono text-xs sm:text-sm leading-relaxed resize-y"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Optional Side-by-Side Compiled Notebook Preview Sheet */}
                    {previewSplitOpen && (
                      <div className="notebook-sheet-stack min-w-0 ui-panel-enter">
                        <div className="notebook-sheet-card p-5 sm:p-7 space-y-4">
                          <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-dashed border-border-subtle">
                            <span className="text-xs font-mono uppercase tracking-wider text-accent-ice font-semibold">
                              {s.livePreviewBadge(editLocale)}
                            </span>
                            <span className="text-xs font-mono text-ink-muted tabular-nums">
                              v{docVersion} · {rc3.studio.autoReadMinutesBadge(docMinutes)} ·{' '}
                              {docStatus === 'published'
                                ? rc3.studio.editorStatusPublished
                                : rc3.studio.editorStatusDraft}
                            </span>
                          </div>

                          <div>
                            <h2
                              className="text-2xl font-semibold text-ink-primary m-0 leading-tight"
                              style={{ fontFamily: 'var(--font-hand)' }}
                            >
                              {docTitle ? (
                                <SafeHtml as="span" html={docTitle} />
                              ) : (
                                s.untitledPlaceholder
                              )}
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
                                <SafeHtml as="span" html={docSummary} />
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
                              authorName={combinedPreviewAuthor}
                              compact
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ZONE 3: Dedicated Collapsible Article Info Inspector (`信息栏`) */}
                {inspectorOpen && (
                  <StudioEditorInspector
                    locale={locale}
                    siteSettings={siteSettings}
                    trackTitle={
                      currentTrackObj ? stripHtmlTags(currentTrackObj.title) : selTrack
                    }
                    chapterTitle={
                      currentChapterObj
                        ? stripHtmlTags(currentChapterObj.title)
                        : selChapter
                    }
                    stepSlug={selStep}
                    docExists={docExists}
                    docStatus={docStatus}
                    docVersion={docVersion}
                    docMinutes={docMinutes}
                    docCanonicalRev={docCanonicalRev}
                    docTitle={docTitle}
                    onChangeTitle={setDocTitle}
                    docSummary={docSummary}
                    onChangeSummary={setDocSummary}
                    docStepNum={docStepNum}
                    onChangeStepNum={setDocStepNum}
                    docLicense={docLicense}
                    onChangeLicense={setDocLicense}
                    docTagsText={docTagsText}
                    onChangeTagsText={setDocTagsText}
                    docAuthors={docAuthors}
                    docPendingInvites={docPendingInvites}
                    canManageCollaborators={canManageCollaborators}
                    inviteEmail={inviteEmail}
                    onChangeInviteEmail={setInviteEmail}
                    inviting={inviting}
                    lastInviteUrl={lastInviteUrl}
                    onInviteCollaborator={(e) => void handleInviteCollaborator(e)}
                    onCopyInviteLink={() => void handleCopyInviteLink()}
                    onRevokeInvite={(id) => void handleRevokeInvite(id)}
                    onRemoveCollaborator={(uid) => void handleRemoveCollaborator(uid)}
                    onClose={() => setInspectorOpen(false)}
                  />
                )}
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
                          <SafeHtml as="span" html={t.title} />
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-surface-raised text-ink-secondary">
                          {copy.difficultyLabels[t.difficulty] ?? t.difficulty}
                        </span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteCatalogTarget({
                                kind: 'track',
                                trackSlug: t.slug,
                              })
                            }
                            className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised cursor-pointer"
                          >
                            {rc3.studio.deleteTrackBtn}
                          </button>
                        )}
                      </div>
                    </div>

                    {t.chapters.map((ch) => (
                      <div
                        key={ch.chapter_id}
                        className="rounded-xl p-4 bg-surface-raised space-y-3"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-ink-primary">
                            <SafeHtml as="span" html={ch.title} />{' '}
                            <span className="font-mono text-xs text-ink-muted">
                              ({ch.slug})
                            </span>
                          </span>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickNewStepFromSidebar(t.slug, ch.slug)
                              }
                              className="min-h-7 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
                            >
                              {s.addStepHereBtn}
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteCatalogTarget({
                                    kind: 'chapter',
                                    trackSlug: t.slug,
                                    chapterSlug: ch.slug,
                                  })
                                }
                                className="min-h-7 text-xs font-semibold text-accent-danger hover:underline cursor-pointer"
                              >
                                {rc3.studio.deleteChapterBtn}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          {ch.steps.map((st) => (
                            <div
                              key={st.step_id}
                              className="p-3 rounded-xl bg-surface-sheet flex flex-wrap items-baseline justify-between gap-3"
                            >
                              <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span className="font-mono text-xs text-ink-muted tabular-nums">
                                  #{st.step_number}
                                </span>
                                <span className="text-sm font-semibold text-ink-primary">
                                  <SafeHtml as="span" html={st.title} />
                                </span>
                                <span className="font-mono text-xs text-ink-muted tabular-nums">
                                  {s.canonicalRevMeta(st.version ?? st.canonical_revision)}
                                </span>
                                {st.authors && st.authors.length > 0 && (
                                  <span className="text-xs text-ink-muted">
                                    · {st.authors.map((a) => a.display_name).join(', ')}
                                  </span>
                                )}
                                {st.takedown_reason && (
                                  <span
                                    title={st.takedown_reason}
                                    className="px-1.5 py-0.5 rounded text-xs font-mono font-semibold"
                                    style={{
                                      backgroundColor: 'var(--alert-danger-badge-bg)',
                                      color: 'var(--alert-danger-badge-fg)',
                                    }}
                                  >
                                    {rc3.studio.takenDownBadge}
                                  </span>
                                )}
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

                                {isAdmin &&
                                  (st.takedown_reason ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleRestoreStep(
                                          t.slug,
                                          ch.slug,
                                          st.slug,
                                        )
                                      }
                                      className="min-h-7 px-2 py-1 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle cursor-pointer"
                                    >
                                      {rc3.studio.restoreBtn}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTakedownReasonInput('');
                                        setTakedownTarget({
                                          trackSlug: t.slug,
                                          chapterSlug: ch.slug,
                                          stepSlug: st.slug,
                                          title: stripHtmlTags(st.title) || st.slug,
                                        });
                                      }}
                                      className="min-h-7 px-2 py-1 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised cursor-pointer"
                                    >
                                      {rc3.studio.takedownBtn}
                                    </button>
                                  ))}
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
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
                          {stripHtmlTags(t.title)}
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
                <div className="flex flex-wrap items-baseline gap-3">
                  <h1
                    id={usersTableCaptionId}
                    className="text-xl font-semibold text-ink-primary m-0"
                  >
                    {s.usersTitle}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
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

                <button
                  type="button"
                  onClick={() => setCreateUserOpen(true)}
                  className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
                >
                  {rc3.users.createUserBtn}
                </button>
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
                            {rc3.users.colStatus}
                          </th>
                          <th className="py-3 px-4 text-start font-semibold">
                            {s.colRole}
                          </th>
                          <th className="py-3 px-4 text-start font-semibold">
                            {rc3.users.colActions}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersList.map((u) => {
                          const isSelf = u.id === user.id;
                          return (
                            <tr
                              key={u.id}
                              className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-raised/50"
                            >
                              <th
                                scope="row"
                                className="py-3.5 px-4 text-start font-normal"
                              >
                                <div className="flex items-center gap-3">
                                  <UserAvatar
                                    name={u.display_name}
                                    avatarUrl={u.avatar_url}
                                    sizeClass="w-8 h-8"
                                    textClass="text-xs"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-ink-primary flex flex-wrap items-baseline gap-1.5">
                                      <span>{u.display_name}</span>
                                      <span className="font-mono text-xs text-ink-muted">
                                        @{u.username}
                                      </span>
                                      {u.oauth_provider && (
                                        <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-surface-raised border border-border-subtle text-ink-secondary">
                                          {u.oauth_provider}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-ink-muted truncate">
                                      {u.email || '—'}
                                    </div>
                                  </div>
                                </div>
                              </th>
                              <td className="py-3.5 px-4 text-xs font-mono text-ink-secondary">
                                {u.auth_source}
                              </td>
                              <td className="py-3.5 px-4">
                                {u.is_banned ? (
                                  <span
                                    title={u.ban_reason || undefined}
                                    className="inline-flex px-2 py-0.5 rounded text-xs font-mono font-semibold"
                                    style={{
                                      backgroundColor: 'var(--alert-danger-badge-bg)',
                                      color: 'var(--alert-danger-badge-fg)',
                                    }}
                                  >
                                    {rc3.users.statusBanned}
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex px-2 py-0.5 rounded text-xs font-mono font-semibold"
                                    style={{
                                      backgroundColor: 'var(--alert-mint-badge-bg)',
                                      color: 'var(--alert-mint-badge-fg)',
                                    }}
                                  >
                                    {rc3.users.statusActive}
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4">
                                <select
                                  aria-label={s.changeRoleAria(u.display_name)}
                                  value={u.role}
                                  disabled={isSelf}
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
                              <td className="py-3.5 px-4 text-start">
                                <div className="inline-flex flex-wrap items-center justify-start gap-1.5">
                                  {u.is_banned ? (
                                    <button
                                      type="button"
                                      disabled={isSelf}
                                      onClick={() => void handleUnbanUser(u)}
                                      className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle cursor-pointer disabled:opacity-40"
                                    >
                                      {rc3.users.unbanBtn}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={isSelf}
                                      onClick={() => {
                                        setBanReasonInput('');
                                        setBanTarget(u);
                                      }}
                                      className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-ink-secondary hover:bg-surface-raised cursor-pointer disabled:opacity-40"
                                    >
                                      {rc3.users.banBtn}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={isSelf}
                                    onClick={() => {
                                      setResetPwInput('');
                                      setResetPwTarget(u);
                                    }}
                                    className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-ink-secondary hover:bg-surface-raised cursor-pointer disabled:opacity-40"
                                  >
                                    {rc3.users.resetPwBtn}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSelf}
                                    onClick={() => setDeleteUserTarget(u)}
                                    className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised cursor-pointer disabled:opacity-40"
                                  >
                                    {rc3.users.deleteUserBtn}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
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
            <div key={`studio-sec-settings-${activeSettingsTab}`} className="ui-panel-enter">
              <StudioSettingsPanel
                locale={locale}
                activeTab={activeSettingsTab}
                onSelectTab={handleSelectSettingsTab}
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
                    {stripHtmlTags(t.title)} ({t.slug})
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
                    {stripHtmlTags(ch.title)} ({ch.slug})
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
                className="ink-field-input font-mono"
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

      {/* Admin Takedown Article Modal */}
      <ModalDialog
        open={Boolean(takedownTarget)}
        onClose={() => setTakedownTarget(null)}
        ariaLabelledBy={takedownTitleId}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={(e) => void handleConfirmTakedown(e)} className="p-5 space-y-4">
          <h3
            id={takedownTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {rc3.studio.takedownDialogTitle(takedownTarget?.title ?? '')}
          </h3>
          <div>
            <label
              htmlFor="admin-takedown-reason"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {rc3.studio.takedownReasonLabel}
            </label>
            <textarea
              id="admin-takedown-reason"
              rows={3}
              required
              value={takedownReasonInput}
              onChange={(e) => setTakedownReasonInput(e.target.value)}
              placeholder={rc3.studio.takedownReasonPlaceholder}
              className="ink-field-input"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setTakedownTarget(null)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="submit"
              disabled={submittingTakedown}
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold text-white border-2 border-border-ink cursor-pointer disabled:opacity-60"
              style={{
                backgroundColor: 'var(--palette-danger-500)',
                boxShadow: 'var(--shadow-control)',
              }}
            >
              {rc3.studio.takedownConfirmBtn}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Admin Delete Track / Chapter Confirmation Modal */}
      <ModalDialog
        open={Boolean(deleteCatalogTarget)}
        onClose={() => setDeleteCatalogTarget(null)}
        ariaLabelledBy={deleteCatalogTitleId}
        maxWidthClass="max-w-sm"
      >
        <div className="p-5 space-y-4">
          <h3
            id={deleteCatalogTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {deleteCatalogTarget?.kind === 'track'
              ? rc3.studio.deleteTrackDialogTitle(deleteCatalogTarget.trackSlug)
              : rc3.studio.deleteChapterDialogTitle(
                  deleteCatalogTarget?.kind === 'chapter'
                    ? deleteCatalogTarget.chapterSlug
                    : '',
                )}
          </h3>
          <p className="text-xs text-ink-secondary leading-relaxed m-0">
            {deleteCatalogTarget?.kind === 'track'
              ? rc3.studio.deleteTrackDialogDesc
              : rc3.studio.deleteChapterDialogDesc}
          </p>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDeleteCatalogTarget(null)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmDeleteCatalog()}
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

      {/* Admin Create User Modal */}
      <ModalDialog
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        ariaLabelledBy={createUserTitleId}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={(e) => void handleCreateUser(e)} className="p-5 space-y-3.5">
          <h3
            id={createUserTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {rc3.users.createUserTitle}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="admin-new-username" className="ink-field-label">
                {rc3.users.usernameLabel}
              </label>
              <input
                id="admin-new-username"
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="ink-field-input font-mono"
              />
            </div>
            <div>
              <label htmlFor="admin-new-displayname" className="ink-field-label">
                {rc3.users.displayNameLabel}
              </label>
              <input
                id="admin-new-displayname"
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="ink-field-input"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="admin-new-email" className="ink-field-label">
                {rc3.users.emailLabel}
              </label>
              <input
                id="admin-new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="ink-field-input"
              />
            </div>
            <div>
              <label htmlFor="admin-new-role" className="ink-field-label">
                {rc3.users.roleLabel}
              </label>
              <select
                id="admin-new-role"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="ink-select w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm"
              >
                <option value="reader">{s.roleOptReader}</option>
                <option value="author">{s.roleOptAuthor}</option>
                <option value="admin">{s.roleOptAdmin}</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="admin-new-pw" className="ink-field-label">
              {rc3.users.passwordLabel}
            </label>
            <input
              id="admin-new-pw"
              type="password"
              required
              minLength={8}
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              className="ink-field-input"
            />
            <PasswordStrengthMeter
              password={newUserPassword}
              locale={locale}
              id="admin-new-pw-strength"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCreateUserOpen(false)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="submit"
              disabled={creatingUser}
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
            >
              {rc3.users.createSubmitBtn}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Admin Suspend User Modal */}
      <ModalDialog
        open={Boolean(banTarget)}
        onClose={() => setBanTarget(null)}
        ariaLabelledBy={banUserTitleId}
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={(e) => void handleConfirmBanUser(e)} className="p-5 space-y-4">
          <h3
            id={banUserTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {rc3.users.banDialogTitle(banTarget?.display_name ?? '')}
          </h3>
          <div>
            <label
              htmlFor="admin-ban-reason"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {rc3.users.banReasonLabel}
            </label>
            <input
              id="admin-ban-reason"
              type="text"
              value={banReasonInput}
              onChange={(e) => setBanReasonInput(e.target.value)}
              placeholder={rc3.users.banReasonPlaceholder}
              className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setBanTarget(null)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="submit"
              disabled={submittingBan}
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold text-white border-2 border-border-ink cursor-pointer disabled:opacity-60"
              style={{
                backgroundColor: 'var(--palette-danger-500)',
                boxShadow: 'var(--shadow-control)',
              }}
            >
              {rc3.users.banConfirmBtn}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Admin Reset User Password Modal */}
      <ModalDialog
        open={Boolean(resetPwTarget)}
        onClose={() => setResetPwTarget(null)}
        ariaLabelledBy={resetPwTitleId}
        maxWidthClass="max-w-sm"
      >
        <form
          onSubmit={(e) => void handleConfirmResetUserPw(e)}
          className="p-5 space-y-4"
        >
          <h3
            id={resetPwTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {rc3.users.resetPwDialogTitle(resetPwTarget?.display_name ?? '')}
          </h3>
          <div>
            <label
              htmlFor="admin-reset-pw"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {rc3.users.resetPwInputLabel}
            </label>
            <input
              id="admin-reset-pw"
              type="password"
              required
              minLength={8}
              value={resetPwInput}
              onChange={(e) => setResetPwInput(e.target.value)}
              className="ink-field-input"
            />
            <PasswordStrengthMeter
              password={resetPwInput}
              locale={locale}
              id="admin-reset-pw-strength"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setResetPwTarget(null)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="submit"
              disabled={submittingResetPw}
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
            >
              {rc3.users.resetPwConfirmBtn}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Admin Delete User Confirmation Modal */}
      <ModalDialog
        open={Boolean(deleteUserTarget)}
        onClose={() => setDeleteUserTarget(null)}
        ariaLabelledBy={deleteUserTitleId}
        maxWidthClass="max-w-sm"
      >
        <div className="p-5 space-y-4">
          <h3
            id={deleteUserTitleId}
            className="text-lg font-semibold text-ink-primary m-0"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {rc3.users.deleteUserDialogTitle(deleteUserTarget?.display_name ?? '')}
          </h3>
          <p className="text-xs text-ink-secondary leading-relaxed m-0">
            {rc3.users.deleteUserDialogDesc}
          </p>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDeleteUserTarget(null)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.deleteCancelBtn}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmDeleteUser()}
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
