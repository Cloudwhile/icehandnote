/*
 * Decoupled 3-Zone Article Editor Panel (`StudioPage` Section B).
 * Reuses `<UnderlineTabs variant="segmented">`, `<SwitchRow variant="chip">`,
 * `<FileUploadButton>`, `<MarkerUnderline variant="canvas">`, `<ConfirmDialog tone="danger">`,
 * `<StudioEditorInspector>`, and `<VisualBlockEditor>`.
 */

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { api, getClientTabId } from '../../lib/api';
import { ApiError } from '../../lib/apiError';
import { normalizeEmail } from '../../lib/email';
import {
  EXT_COPY,
  getEnabledLocaleMetas,
  LOCALES,
  UI_COPY,
} from '../../lib/i18n';
import { normalizeLicenseId } from '../../lib/licenses';
import { runLayoutTransition } from '../../lib/motion';
import { SafeHtml, stripHtmlTags } from '../../lib/sanitizer';
import {
  isAutoPlaceholderSlug,
  sanitizeStepSlugDraft,
  suggestSlugFromTitle,
} from '../../lib/slugify';
import type { ResolvedTheme } from '../../lib/theme';
import type {
  ArticleAuthorDto,
  CollaboratorInviteDto,
  CollaboratorRole,
  LicenseId,
  LocaleCode,
  NotebookBlock,
  RevisionConflictMeta,
  SiteSettingsDto,
  StudioStepEditorDto,
  StudioTrackDto,
  UserProfileDto,
} from '../../lib/types';
import {
  createDefaultVisualBlock,
  createVisualId,
  parseMarkdownToVisualBlocks,
  serializeVisualBlocksToMarkdown,
  type VisualBlock,
} from '../../lib/visualBlocks';
import { CcLicenseCard } from '../notebook/CcLicenseCard';
import { MarkerUnderline } from '../notebook/MarkerUnderline';
import { NotebookBlockRenderer } from '../notebook/NotebookBlockRenderer';
import { NotebookEmptyState } from '../notebook/NotebookEmptyState';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FileUploadButton } from '../ui/FileUploadButton';
import { SwitchRow } from '../ui/FormControls';
import {
  IconAlertTriangle,
  IconBook,
  IconExternalLink,
  IconFileCode,
  IconGlobe,
  IconImage,
  IconLayers,
  IconMoreHorizontal,
  IconPlus,
  IconShield,
  IconSidebarToggle,
  IconTrash,
} from '../ui/Icons';
import { PopupMenu } from '../ui/PopupMenu';
import { UnderlineTabs } from '../ui/Tabs';
import { useToast } from '../ui/ToastProvider';
import { RevisionConflictModal } from './RevisionConflictModal';
import { RevisionHistoryModal } from './RevisionHistoryModal';
import type { TakedownStepTarget } from './StudioCatalogPanel';
import { StudioEditorInspector } from './StudioEditorInspector';
import type { StudioSectionId } from './StudioSidebarContent';
import { VisualBlockEditor, VisualBlockToolStrip } from './VisualBlockEditor';
import { UserAvatar } from '../ui/UserAvatar';
import { useStudioCollabStream } from '../../lib/studioPresence';

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
        '\n```sketch\n{\n  "nodes": [\n    { "id": "n1", "label": "A", "x": 24, "y": 36, "width": 160, "height": 62, "tone": "ice" },\n    { "id": "n2", "label": "B", "x": 260, "y": 36, "width": 160, "height": 62, "tone": "violet" }\n  ],\n  "edges": [\n    { "from": "n1", "to": "n2" }\n  ]\n}\n```\n',
    } as const;
  }
  if (locale === 'zh-TW') {
    return {
      sectionTask: '\n## [ ] 小節標題\n\n',
      steps: '\n- [ ] 任務項目\n',
      tip: '\n:::tip[提示]\n\n:::\n',
      note: '\n:::note[筆記]\n\n:::\n',
      info: '\n:::info[資訊]\n\n:::\n',
      warn: '\n:::warning[注意]\n\n:::\n',
      danger: '\n:::danger[警示]\n\n:::\n',
      margin: '\n:::margin[]\n',
      code: '\n```text\n\n```\n',
      sketch:
        '\n```sketch\n{\n  "nodes": [\n    { "id": "n1", "label": "A", "x": 24, "y": 36, "width": 160, "height": 62, "tone": "ice" },\n    { "id": "n2", "label": "B", "x": 245, "y": 36, "width": 160, "height": 62, "tone": "violet" }\n  ],\n  "edges": [\n    { "from": "n1", "to": "n2" }\n  ]\n}\n```\n',
    } as const;
  }
  if (locale === 'ja') {
    return {
      sectionTask: '\n## [ ] セクション見出し\n\n',
      steps: '\n- [ ] タスク項目\n',
      tip: '\n:::tip[ヒント]\n\n:::\n',
      note: '\n:::note[メモ]\n\n:::\n',
      info: '\n:::info[情報]\n\n:::\n',
      warn: '\n:::warning[注意]\n\n:::\n',
      danger: '\n:::danger[警告]\n\n:::\n',
      margin: '\n:::margin[]\n',
      code: '\n```text\n\n```\n',
      sketch:
        '\n```sketch\n{\n  "nodes": [\n    { "id": "n1", "label": "A", "x": 24, "y": 36, "width": 160, "height": 62, "tone": "ice" },\n    { "id": "n2", "label": "B", "x": 245, "y": 36, "width": 160, "height": 62, "tone": "violet" }\n  ],\n  "edges": [\n    { "from": "n1", "to": "n2" }\n  ]\n}\n```\n',
    } as const;
  }
  return {
    sectionTask: '\n## [ ] 小节标题\n\n',
    steps: '\n- [ ] 任务项\n',
    tip: '\n:::tip[提示]\n\n:::\n',
    note: '\n:::note[笔记]\n\n:::\n',
    info: '\n:::info[信息]\n\n:::\n',
    warn: '\n:::warning[注意]\n\n:::\n',
    danger: '\n:::danger[警示]\n\n:::\n',
    margin: '\n:::margin[]\n',
    code: '\n```text\n\n```\n',
    sketch:
      '\n```sketch\n{\n  "nodes": [\n    { "id": "n1", "label": "A", "x": 24, "y": 36, "width": 160, "height": 62, "tone": "ice" },\n    { "id": "n2", "label": "B", "x": 245, "y": 36, "width": 160, "height": 62, "tone": "violet" }\n  ],\n  "edges": [\n    { "from": "n1", "to": "n2" }\n  ]\n}\n```\n',
  } as const;
}

function localDraftKey(
  userId: string,
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
): string {
  return `icehandnote_studio_draft::${userId}::${track}::${chapter}::${step}::${loc}`;
}

function readLocalDraft(
  userId: string,
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
): LocalDraftSnapshot | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(
      localDraftKey(userId, track, chapter, step, loc),
    );
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
  userId: string,
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
  snap: LocalDraftSnapshot,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(
      localDraftKey(userId, track, chapter, step, loc),
      JSON.stringify(snap),
    );
  } catch {
    // ignore storage quota errors
  }
}

function clearLocalDraft(
  userId: string,
  track: string,
  chapter: string,
  step: string,
  loc: LocaleCode,
): void {
  if (!userId) return;
  try {
    localStorage.removeItem(localDraftKey(userId, track, chapter, step, loc));
  } catch {
    // ignore storage restriction
  }
}

export interface StepModerationPatch {
  stepKey: string;
  reason: string | null;
  by: string | null;
  seq: number;
}

export interface StudioEditorPanelProps {
  locale: LocaleCode;
  theme: ResolvedTheme;
  user: UserProfileDto;
  isAdmin: boolean;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
  tracks: StudioTrackDto[];
  selTrack: string;
  selChapter: string;
  selStep: string;
  editLocale: LocaleCode;
  onChangeEditLocale: (next: LocaleCode) => void;
  onStepDeleted: (nextStepSlug: string) => void;
  onStepSlugSaved?: (nextStepSlug: string) => void;
  onRefreshOverview: () => Promise<StudioTrackDto[] | undefined>;
  onOpenNewStepModal: () => void;
  onSwitchSection: (section: StudioSectionId) => void;
  onRequestTakedown: (target: TakedownStepTarget) => void;
  onRestoreStep: (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
  ) => void;
  moderationPatch: StepModerationPatch | null;
}

export function StudioEditorPanel({
  locale,
  theme,
  user,
  isAdmin,
  siteSettings,
  settingsReady = true,
  tracks,
  selTrack,
  selChapter,
  selStep,
  editLocale,
  onChangeEditLocale,
  onStepDeleted,
  onStepSlugSaved,
  onRefreshOverview,
  onOpenNewStepModal,
  onSwitchSection,
  onRequestTakedown,
  onRestoreStep,
  moderationPatch,
}: StudioEditorPanelProps) {
  const copy = UI_COPY[locale];
  const s = copy.studio;
  const extCopy = EXT_COPY[locale];
  const toast = useToast();
  const modeTabPrefix = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveActionRef = useRef<() => void>(() => {});
  const skipNextLoadKeyRef = useRef<string | null>(null);
  const slugManuallyEditedRef = useRef(false);
  const invitingRef = useRef(false);

  const [editorMode, setEditorMode] = useState<'visual' | 'markdown'>('visual');
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  const [previewSplitOpen, setPreviewSplitOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingStep, setDeletingStep] = useState(false);

  const enabledStudioLocales = useMemo(
    () => getEnabledLocaleMetas(siteSettings.enabled_locales),
    [siteSettings.enabled_locales],
  );

  // Editor document fields
  const [draftStepSlug, setDraftStepSlug] = useState(selStep);
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
  const [docEtag, setDocEtag] = useState('');
  const [canEditDoc, setCanEditDoc] = useState(true);
  const [canLeaveDoc, setCanLeaveDoc] = useState(false);
  const [docAuthors, setDocAuthors] = useState<ArticleAuthorDto[]>([]);
  const [docPendingInvites, setDocPendingInvites] = useState<
    CollaboratorInviteDto[]
  >([]);
  const [canManageCollaborators, setCanManageCollaborators] = useState(false);
  const [docTakedownReason, setDocTakedownReason] = useState<string | null>(
    null,
  );
  const [docTakedownBy, setDocTakedownBy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaboratorRole>('editor');
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMounted, setHistoryMounted] = useState(false);
  useEffect(() => {
    if (historyOpen) setHistoryMounted(true);
  }, [historyOpen]);
  const [conflictState, setConflictState] =
    useState<RevisionConflictMeta | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<{
    authorName: string;
    editSeq: number;
    locale: string;
    etag: string;
  } | null>(null);
  const [transferTarget, setTransferTarget] =
    useState<ArticleAuthorDto | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [busyLifecycle, setBusyLifecycle] = useState(false);
  const [uploadingMdImage, setUploadingMdImage] = useState(false);
  const [uploadingVisualImage, setUploadingVisualImage] = useState(false);

  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>({
    kind: 'idle',
  });
  const [recoverableDraft, setRecoverableDraft] =
    useState<LocalDraftSnapshot | null>(null);
  const [lastLocalAutosaveSig, setLastLocalAutosaveSig] = useState('');

  // Live preview AST & interactive step test overrides
  const [previewBlocks, setPreviewBlocks] = useState<NotebookBlock[]>([]);
  const [previewStepOverrides, setPreviewStepOverrides] = useState<
    Record<string, boolean>
  >({});
  const [saving, setSaving] = useState(false);

  const autosaveEnabledRef = useRef(siteSettings.enable_draft_autosave);
  autosaveEnabledRef.current = siteSettings.enable_draft_autosave;
  const activeTargetKey = `${selTrack}/${selChapter}/${selStep}/${editLocale}`;
  const activeTargetRef = useRef(activeTargetKey);
  activeTargetRef.current = activeTargetKey;
  const loadSeqRef = useRef(0);
  const userIdRef = useRef(user.id);
  userIdRef.current = user.id;

  const handleTitleChange = (nextTitle: string) => {
    setDocTitle(nextTitle);
    if (
      !slugManuallyEditedRef.current &&
      (!docExists || isAutoPlaceholderSlug(selStep))
    ) {
      const auto = suggestSlugFromTitle(nextTitle, docStepNum);
      if (auto) {
        setDraftStepSlug(auto);
      }
    }
  };

  // Apply external moderation updates (takedown / restore) without discarding unsaved body edits
  useEffect(() => {
    if (
      moderationPatch &&
      moderationPatch.stepKey === `${selTrack}/${selChapter}/${selStep}`
    ) {
      setDocTakedownReason(moderationPatch.reason);
      setDocTakedownBy(moderationPatch.by);
    }
  }, [moderationPatch, selTrack, selChapter, selStep]);

  // Load selected step into editor with monotonic sequence guard against stale async responses
  const loadEditorStep = useCallback(
    async (tSlug: string, cSlug: string, sSlug: string, loc: LocaleCode) => {
      if (!tSlug || !cSlug || !sSlug) return;
      const reqSeq = (loadSeqRef.current += 1);
      const targetKey = `${tSlug}/${cSlug}/${sSlug}/${loc}`;
      try {
        const dto: StudioStepEditorDto = await api.studioGetStep(
          tSlug,
          cSlug,
          sSlug,
          loc,
        );
        if (loadSeqRef.current !== reqSeq || activeTargetRef.current !== targetKey) {
          return;
        }
        const editable = dto.can_edit !== false;
        setDocExists(dto.exists);
        setDocEtag(dto.etag ?? '');
        setCanEditDoc(editable);
        setCanLeaveDoc(Boolean(dto.can_leave));
        setConflictState(null);
        setRemoteNotice(null);
        const resolvedDtoSlug = dto.step_slug || sSlug;
        setDraftStepSlug(resolvedDtoSlug);
        slugManuallyEditedRef.current = false;
        setDocTitle(dto.title);
        setDocSummary(dto.summary);
        setDocStepNum(dto.step_number);
        setDocMinutes(dto.estimated_minutes);
        setDocVersion(dto.version ?? dto.synced_revision);
        setDocSyncedRev(dto.synced_revision);
        setDocCanonicalRev(dto.canonical_revision);
        setBumpCanonical(false);
        const nextStatus =
          !dto.exists || dto.status === 'draft' ? 'draft' : 'published';
        setDocStatus(nextStatus);
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
            stepSlug: resolvedDtoSlug,
            title: dto.title.trim(),
            summary: dto.summary.trim(),
            stepNum: dto.step_number,
            status: nextStatus,
            license: nextLicense,
            tags: nextTags,
            body: dto.body_markdown,
            bump: false,
          }),
        );
        setAutosaveStatus({ kind: 'idle' });
        setLastLocalAutosaveSig('');

        const localDraft = editable
          ? readLocalDraft(userIdRef.current, tSlug, cSlug, sSlug, loc)
          : null;
        if (
          editable &&
          autosaveEnabledRef.current &&
          localDraft &&
          (localDraft.title.trim() !== dto.title.trim() ||
            localDraft.summary.trim() !== dto.summary.trim() ||
            (localDraft.license ?? '') !== nextLicense ||
            localDraft.body !== dto.body_markdown ||
            localDraft.tags !== nextTags)
        ) {
          setRecoverableDraft(localDraft);
        } else {
          setRecoverableDraft(null);
        }
      } catch (err) {
        if (loadSeqRef.current !== reqSeq || activeTargetRef.current !== targetKey) {
          return;
        }
        setDocExists(false);
        setDocEtag('');
        setCanEditDoc(false);
        setCanLeaveDoc(false);
        setDocAuthors([]);
        setDocPendingInvites([]);
        setCanManageCollaborators(false);
        setDocTakedownReason(null);
        setDocTakedownBy(null);
        toast.error(err);
      }
    },
    [toast],
  );

  useEffect(() => {
    const nextKey = `${selTrack}/${selChapter}/${selStep}/${editLocale}`;
    if (skipNextLoadKeyRef.current === nextKey) {
      skipNextLoadKeyRef.current = null;
      return;
    }
    setDraftStepSlug(selStep);
    slugManuallyEditedRef.current = false;
    void loadEditorStep(selTrack, selChapter, selStep, editLocale);
  }, [selTrack, selChapter, selStep, editLocale, loadEditorStep]);

  // Debounced live Rust AST preview (+ automatic reading minutes calculation)
  useEffect(() => {
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
  }, [docTitle, docSummary, docBody]);

  const stationerySnippets = useMemo(() => {
    const bodies = getSnippetBodies(locale);
    return [
      {
        id: 'section-task',
        label: `+ ${copy.taskScopeSection}`,
        snippet: bodies.sectionTask,
      },
      {
        id: 'steps',
        label: `+ ${copy.taskScopeParagraph}`,
        snippet: bodies.steps,
      },
      { id: 'tip', label: s.snippets.tip, snippet: bodies.tip },
      { id: 'note', label: s.snippets.note, snippet: bodies.note },
      { id: 'info', label: s.snippets.info, snippet: bodies.info },
      { id: 'warn', label: s.snippets.warn, snippet: bodies.warn },
      { id: 'danger', label: s.snippets.danger, snippet: bodies.danger },
      { id: 'margin', label: s.snippets.margin, snippet: bodies.margin },
      { id: 'code', label: s.snippets.code, snippet: bodies.code },
      { id: 'sketch', label: s.snippets.sketch, snippet: bodies.sketch },
      {
        id: 'pixel-sticker',
        label: `+ ${s.visual.types.pixel_sticker}`,
        snippet: '\n:::pixel[cat]{align="center" size="md" caption=""}\n',
      },
    ];
  }, [
    locale,
    s.snippets,
    s.visual.types.pixel_sticker,
    copy.taskScopeSection,
    copy.taskScopeParagraph,
  ]);

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
        stepSlug: draftStepSlug.trim() || selStep,
        title: docTitle.trim(),
        summary: docSummary.trim(),
        stepNum: docStepNum,
        status: docStatus,
        license: docLicense,
        tags: docTagsText,
        body: docBody,
        bump: bumpCanonical,
      }),
    [
      draftStepSlug,
      selStep,
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
  const myTabId = useMemo(() => getClientTabId(), []);

  const { members: collabMembers } = useStudioCollabStream({
    enabled: docExists && Boolean(selTrack && selChapter && selStep),
    track: selTrack,
    chapter: selChapter,
    step: selStep,
    editLocale,
    isDirty: isEditorDirty,
    onRemoteSaved: (evt) => {
      if (
        evt.tab_id !== myTabId &&
        evt.locale === editLocale &&
        evt.etag !== docEtag
      ) {
        setRemoteNotice({
          authorName: evt.author_name || '',
          editSeq: evt.edit_seq,
          locale: evt.locale,
          etag: evt.etag,
        });
      }
    },
    onAclChanged: () => {
      void onRefreshOverview();
      if (!isEditorDirty) {
        void loadEditorStep(selTrack, selChapter, selStep, editLocale);
      }
    },
  });

  const otherCollabMembers = useMemo(() => {
    const map = new Map<string, (typeof collabMembers)[number]>();
    for (const m of collabMembers) {
      if (m.tab_id === myTabId) continue;
      const prev = map.get(m.user_id);
      if (!prev || m.state === 'editing') {
        map.set(m.user_id, m);
      }
    }
    return Array.from(map.values());
  }, [collabMembers, myTabId]);

  const latestEditorRef = useRef({
    userId: user.id,
    targetKey: activeTargetKey,
    selTrack,
    selChapter,
    selStep,
    draftStepSlug,
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
    docEtag,
    canEditDoc,
    saving,
    isDirty: isEditorDirty,
    currentDocSig,
  });
  latestEditorRef.current = {
    userId: user.id,
    targetKey: activeTargetKey,
    selTrack,
    selChapter,
    selStep,
    draftStepSlug,
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
    docEtag,
    canEditDoc,
    saving,
    isDirty: isEditorDirty,
    currentDocSig,
  };

  // Flush dirty draft locally on target switch or section unmount so edits are never silently discarded
  useEffect(() => {
    return () => {
      const cur = latestEditorRef.current;
      if (
        autosaveEnabledRef.current &&
        cur.canEditDoc &&
        cur.isDirty &&
        cur.selTrack &&
        cur.selChapter &&
        cur.selStep
      ) {
        writeLocalDraft(
          cur.userId,
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
      }
    };
  }, [activeTargetKey]);

  // Unified periodic draft auto-save (automatically paused while resolving HTTP 412 conflict or in read-only role)
  const needsAutosave =
    canEditDoc &&
    !conflictState &&
    isEditorDirty &&
    currentDocSig !== lastLocalAutosaveSig;

  useEffect(() => {
    if (!siteSettings.enable_draft_autosave || !needsAutosave || saving) {
      return;
    }

    const delayMs =
      Math.max(
        5,
        Math.min(300, siteSettings.draft_autosave_interval_secs || 15),
      ) * 1000;

    const timer = window.setTimeout(() => {
      const cur = latestEditorRef.current;
      if (activeTargetRef.current !== cur.targetKey || cur.saving) return;

      const timeStr = new Date().toLocaleTimeString();
      const unchangedSlug =
        (cur.draftStepSlug.trim() || cur.selStep) === cur.selStep;

      if (
        unchangedSlug &&
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
            expected_etag: cur.docExists && cur.docEtag ? cur.docEtag : undefined,
          })
          .then((saved) => {
            if (activeTargetRef.current !== cur.targetKey) return;
            clearLocalDraft(
              cur.userId,
              cur.selTrack,
              cur.selChapter,
              cur.selStep,
              cur.editLocale,
            );
            setRecoverableDraft(null);
            setDocExists(true);
            setDocEtag(saved.etag ?? '');
            setDocStatus('draft');
            setDocMinutes(saved.estimated_minutes);
            setDocVersion(saved.version ?? saved.synced_revision);
            setDocSyncedRev(saved.synced_revision);
            setDocCanonicalRev(saved.canonical_revision);
            setSavedSnapshot(
              JSON.stringify({
                stepSlug: cur.selStep,
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
            void onRefreshOverview();
          })
          .catch((err) => {
            if (activeTargetRef.current !== cur.targetKey) return;
            writeLocalDraft(
              cur.userId,
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
            if (
              err instanceof ApiError &&
              err.code === 'REVISION_CONFLICT' &&
              err.meta &&
              typeof err.meta.current_etag === 'string'
            ) {
              setConflictState(err.meta as unknown as RevisionConflictMeta);
            }
          });
      } else {
        writeLocalDraft(
          cur.userId,
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
    siteSettings.enable_draft_autosave,
    siteSettings.draft_autosave_interval_secs,
    needsAutosave,
    currentDocSig,
    saving,
    activeTargetKey,
    onRefreshOverview,
  ]);

  // Keyboard shortcut: Ctrl+S / Cmd+S saves immediately while editing
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActionRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentTrackObj = tracks.find((t) => t.slug === selTrack) ?? tracks[0];
  const currentChapterObj =
    currentTrackObj?.chapters.find((c) => c.slug === selChapter) ??
    currentTrackObj?.chapters[0];
  const currentStepObj = currentChapterObj?.steps.find(
    (st) => st.slug === selStep,
  );

  const handleVisualBlocksChange = (nextBlocks: VisualBlock[]) => {
    setVisualBlocks(nextBlocks);
    setDocBody(serializeVisualBlocksToMarkdown(nextBlocks));
  };

  const handleAppendVisualBlock = (kind: VisualBlock['type']) => {
    handleVisualBlocksChange([...visualBlocks, createDefaultVisualBlock(kind)]);
  };

  const handleUploadVisualImage = async (file: File) => {
    if (uploadingVisualImage) return;
    setUploadingVisualImage(true);
    try {
      const uploaded = await api.uploadStudioMedia(file);
      const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
      const nextImg: VisualBlock = {
        id: createVisualId(),
        type: 'image',
        src: uploaded.url,
        alt,
        caption: '',
        marginNote: '',
      };
      setVisualBlocks((prev) => {
        const updated = [...prev, nextImg];
        setDocBody(serializeVisualBlocksToMarkdown(updated));
        return updated;
      });
      toast.success(extCopy.studio.imageUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingVisualImage(false);
    }
  };

  const handleTogglePreviewSplit = () => {
    runLayoutTransition(null, () => {
      setPreviewSplitOpen((prev) => {
        const next = !prev;
        if (next && typeof window !== 'undefined' && window.innerWidth < 1536) {
          setInspectorOpen(false);
        }
        return next;
      });
    });
  };

  const handleToggleInspector = () => {
    runLayoutTransition(null, () => {
      setInspectorOpen((prev) => {
        const next = !prev;
        if (next && typeof window !== 'undefined' && window.innerWidth < 1536) {
          setPreviewSplitOpen(false);
        }
        return next;
      });
    });
  };

  const handleSwitchEditorMode = (nextMode: 'visual' | 'markdown') => {
    if (nextMode === 'visual' && editorMode !== 'visual') {
      setVisualBlocks(parseMarkdownToVisualBlocks(docBody));
    }
    setEditorMode(nextMode);
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

  const handleUploadMdImage = async (file: File) => {
    if (uploadingMdImage) return;
    setUploadingMdImage(true);
    try {
      const res = await api.uploadStudioMedia(file);
      const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
      insertSnippetAtCursor(`\n![${alt}](${res.url})\n`);
      toast.success(extCopy.studio.imageUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingMdImage(false);
    }
  };

  const canOpenPublishedPage =
    docExists &&
    docStatus === 'published' &&
    draftStepSlug.trim() === selStep &&
    !saving;

  const performSaveStep = async (
    overrideSlug?: string,
    forceWhenExists = false,
    overrideExpectedEtag?: string,
  ) => {
    const targetStepSlug = (overrideSlug ?? draftStepSlug).trim();
    if (
      saving ||
      !canEditDoc ||
      (!forceWhenExists && !overrideExpectedEtag && !isEditorDirty && docExists)
    ) {
      return;
    }
    if (
      !docTitle.trim() ||
      !targetStepSlug ||
      targetStepSlug === '-' ||
      !/^[a-zA-Z0-9_-]+$/.test(targetStepSlug)
    ) {
      toast.warning(s.missingTitleOrSlugBanner);
      return;
    }
    const isRenamingSlug =
      docExists && Boolean(selStep) && targetStepSlug !== selStep;
    setSaving(true);
    try {
      const tags = docTagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const expectedEtag =
        overrideExpectedEtag ?? (docExists && docEtag ? docEtag : undefined);

      const saved = await api.studioSaveStep({
        track_slug: selTrack,
        chapter_slug: selChapter,
        step_slug: targetStepSlug,
        previous_step_slug: isRenamingSlug ? selStep : undefined,
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
        expected_etag: expectedEtag,
      });

      const resolvedSlug = saved.step_slug || targetStepSlug;
      setDocExists(true);
      setDocEtag(saved.etag ?? '');
      setCanEditDoc(saved.can_edit !== false);
      setCanLeaveDoc(Boolean(saved.can_leave));
      setConflictState(null);
      setRemoteNotice(null);
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
      clearLocalDraft(user.id, selTrack, selChapter, selStep, editLocale);
      if (resolvedSlug !== selStep) {
        clearLocalDraft(user.id, selTrack, selChapter, resolvedSlug, editLocale);
      }
      setRecoverableDraft(null);
      setLastLocalAutosaveSig('');
      setAutosaveStatus({ kind: 'idle' });
      setDraftStepSlug(resolvedSlug);
      slugManuallyEditedRef.current = false;
      setSavedSnapshot(
        JSON.stringify({
          stepSlug: resolvedSlug,
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
      if (resolvedSlug !== selStep && onStepSlugSaved) {
        skipNextLoadKeyRef.current = `${selTrack}/${selChapter}/${resolvedSlug}/${editLocale}`;
        onStepSlugSaved(resolvedSlug);
      }
      await onRefreshOverview();
      const timeStr = new Date().toLocaleTimeString();
      if (resolvedSlug !== selStep) {
        toast.success(extCopy.studio.publishedUrl.renamedToast);
      } else {
        toast.success(
          s.savedBanner(
            editLocale,
            saved.version ?? saved.synced_revision,
            saved.status === 'draft',
            timeStr,
          ),
        );
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'REVISION_CONFLICT' &&
        err.meta &&
        typeof err.meta.current_etag === 'string'
      ) {
        setConflictState(err.meta as unknown as RevisionConflictMeta);
      } else {
        toast.error(err);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStep = () => performSaveStep();

  const handleCommitStepSlugOnBlur = (cleanSlug: string) => {
    setDraftStepSlug(cleanSlug);
    if (cleanSlug === selStep) return;
    if (!docTitle.trim()) {
      if (!docExists && onStepSlugSaved) {
        skipNextLoadKeyRef.current = `${selTrack}/${selChapter}/${cleanSlug}/${editLocale}`;
        onStepSlugSaved(cleanSlug);
      }
      return;
    }
    void performSaveStep(cleanSlug, true);
  };
  saveActionRef.current = () => {
    void handleSaveStep();
  };

  const handleConfirmDeleteStep = async () => {
    if (deletingStep) return;
    setDeletingStep(true);
    try {
      await api.studioDeleteStep(selTrack, selChapter, selStep);
      clearLocalDraft(user.id, selTrack, selChapter, selStep, editLocale);
      setRecoverableDraft(null);
      setDeleteModalOpen(false);
      const deletedSlug = selStep;
      const refreshed = await onRefreshOverview();
      const t = refreshed?.find((item) => item.slug === selTrack);
      const firstS = t?.chapters.find((c) => c.slug === selChapter)?.steps[0];
      if (firstS) {
        onStepDeleted(firstS.slug);
      } else {
        setDocExists(false);
        setDocTitle('');
        setDocSummary('');
        setDocBody('');
        setVisualBlocks([]);
        onStepDeleted('');
      }
      toast.success(s.deletedBanner(deletedSlug));
    } catch (err) {
      toast.error(err);
    } finally {
      setDeletingStep(false);
    }
  };

  const handleInviteCollaborator = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = normalizeEmail(inviteEmail);
    if (!cleanEmail) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (invitingRef.current) return;
    invitingRef.current = true;
    setInviting(true);
    try {
      const res = await api.createCollaboratorInvite(
        selTrack,
        selChapter,
        selStep,
        cleanEmail,
        locale,
        inviteRole,
        inviteRole === 'translator' ? [editLocale] : [],
      );
      setInviteEmail('');
      setLastInviteUrl(res.invite_url);
      setDocPendingInvites((prev) => [
        res.invite,
        ...prev.filter((inv) => inv.id !== res.invite.id),
      ]);
      if (res.email_sent) {
        toast.success(extCopy.studio.inviteCreatedEmailSentMsg);
      } else {
        toast.info(extCopy.studio.inviteCreatedLinkOnlyMsg);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      invitingRef.current = false;
      setInviting(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!lastInviteUrl) return;
    try {
      await navigator.clipboard.writeText(lastInviteUrl);
      toast.success(extCopy.settings.copiedMsg);
    } catch (err) {
      toast.error(err);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await api.revokeCollaboratorInvite(inviteId);
      setDocPendingInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
      toast.success(extCopy.studio.inviteRevokedMsg);
    } catch (err) {
      toast.error(err);
    }
  };

  const handleRemoveCollaborator = async (targetUserId: string) => {
    try {
      await api.removeStepCollaborator(
        selTrack,
        selChapter,
        selStep,
        targetUserId,
      );
      setDocAuthors((prev) => prev.filter((a) => a.user_id !== targetUserId));
      toast.success(extCopy.studio.collaboratorRemovedMsg);
      void onRefreshOverview();
    } catch (err) {
      toast.error(err);
    }
  };

  const handleUpdateCollaboratorRole = async (
    targetUserId: string,
    role: CollaboratorRole,
  ) => {
    try {
      await api.updateStepCollaboratorRole(
        selTrack,
        selChapter,
        selStep,
        targetUserId,
        role,
        role === 'translator' ? [editLocale] : [],
      );
      setDocAuthors((prev) =>
        prev.map((a) =>
          a.user_id === targetUserId
            ? { ...a, role, locale_scope: role === 'translator' ? [editLocale] : [] }
            : a,
        ),
      );
      toast.success(extCopy.collab.roleUpdatedToast);
    } catch (err) {
      toast.error(err);
    }
  };

  const handleConfirmTransferOwnership = async () => {
    if (!transferTarget?.user_id || busyLifecycle) return;
    setBusyLifecycle(true);
    try {
      await api.transferStepOwnership(
        selTrack,
        selChapter,
        selStep,
        transferTarget.user_id,
      );
      setTransferTarget(null);
      toast.success(extCopy.collab.ownerTransferredToast);
      await loadEditorStep(selTrack, selChapter, selStep, editLocale);
      void onRefreshOverview();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyLifecycle(false);
    }
  };

  const handleConfirmLeaveCollaboration = async () => {
    if (busyLifecycle) return;
    setBusyLifecycle(true);
    try {
      await api.leaveStepCollaboration(selTrack, selChapter, selStep);
      setLeaveConfirmOpen(false);
      toast.success(extCopy.collab.leftCollabToast);
      await onRefreshOverview();
      onSwitchSection('overview');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyLifecycle(false);
    }
  };

  const handleApplyRestoredSnapshot = (saved: StudioStepEditorDto) => {
    const resolvedSlug = saved.step_slug || selStep;
    const nextStatus = saved.status === 'draft' ? 'draft' : 'published';
    const nextLicense = normalizeLicenseId(saved.license);
    const nextTags = saved.tags.join(', ');

    setDocExists(true);
    setDocEtag(saved.etag ?? '');
    setDraftStepSlug(resolvedSlug);
    slugManuallyEditedRef.current = false;
    setDocTitle(saved.title);
    setDocSummary(saved.summary);
    setDocStepNum(saved.step_number);
    setDocMinutes(saved.estimated_minutes);
    setDocVersion(saved.version ?? saved.synced_revision);
    setDocSyncedRev(saved.synced_revision);
    setDocCanonicalRev(saved.canonical_revision);
    setBumpCanonical(false);
    setDocStatus(nextStatus);
    setDocLicense(nextLicense);
    setDocTagsText(nextTags);
    setDocBody(saved.body_markdown);
    setVisualBlocks(parseMarkdownToVisualBlocks(saved.body_markdown));
    setConflictState(null);
    setRemoteNotice(null);
    clearLocalDraft(user.id, selTrack, selChapter, resolvedSlug, editLocale);
    setRecoverableDraft(null);
    setSavedSnapshot(
      JSON.stringify({
        stepSlug: resolvedSlug,
        title: saved.title.trim(),
        summary: saved.summary.trim(),
        stepNum: saved.step_number,
        status: nextStatus,
        license: nextLicense,
        tags: nextTags,
        body: saved.body_markdown,
        bump: false,
      }),
    );
    void onRefreshOverview();
  };

  const combinedPreviewAuthor =
    docAuthors.length > 0
      ? docAuthors.map((a) => a.display_name).join(' · ')
      : user.display_name || (settingsReady ? siteSettings.default_author_name : '');

  const modeTabs = [
    {
      value: 'visual' as const,
      label: extCopy.studio.editorVisualMode,
      icon: <IconLayers className="w-3.5 h-3.5 text-ink-muted" />,
    },
    {
      value: 'markdown' as const,
      label: extCopy.studio.editorSourceMode,
      icon: <IconFileCode className="w-3.5 h-3.5 text-ink-muted" />,
    },
  ];

  const autosaveText = !siteSettings.enable_draft_autosave
    ? s.autosaveStatusOff
    : autosaveStatus.kind === 'saving'
      ? s.autosavingNow
      : autosaveStatus.kind === 'saved_server'
        ? s.autosavedServer(autosaveStatus.time)
        : autosaveStatus.kind === 'saved_local'
          ? s.autosavedLocal(autosaveStatus.time)
          : autosaveStatus.kind === 'error'
            ? s.autosaveFailed
            : s.autosaveStatusOn(siteSettings.draft_autosave_interval_secs);

  const autosaveTone = !siteSettings.enable_draft_autosave
    ? 'text-ink-muted'
    : autosaveStatus.kind === 'error'
      ? 'text-accent-danger'
      : autosaveStatus.kind === 'saved_server' ||
          autosaveStatus.kind === 'saved_local'
        ? 'text-accent-success'
        : 'text-ink-muted';

  return (
    <div className="studio-editor-workspace">
      <h1 className="sr-only">{s.editorHeadingSr}</h1>

      {/* Read-Only Collaborator Role Notice */}
      {docExists && !canEditDoc && (
        <div className="px-3.5 py-2.5 rounded-xl border border-accent-amber/50 bg-surface-raised flex items-center justify-between gap-2 text-xs text-ink-primary">
          <div className="flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4 text-accent-amber shrink-0" />
            <span>{extCopy.collab.readonlyBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="text-xs font-semibold text-link-ink hover:text-link-hover-ink cursor-pointer shrink-0 transition-colors"
          >
            {extCopy.collab.historyBtn}
          </button>
        </div>
      )}

      {/* ZONE 1A: Top Editor Workbench Bar */}
      <div className="studio-panel overflow-hidden">
        <div className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
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
                  {enabledStudioLocales.map((loc) => {
                    const active = loc.code === editLocale;
                    const tr = currentStepObj?.translations.find(
                      (item) => item.locale === loc.code,
                    );
                    const isDrifted =
                      tr &&
                      tr.status !== 'draft' &&
                      tr.synced_revision <
                        (currentStepObj?.canonical_revision ?? 1);
                    const statusHint = !tr
                      ? s.addLocaleAction
                      : tr.status === 'draft'
                        ? s.draftParen
                        : `v${tr.synced_revision}`;
                    return (
                      <button
                        key={loc.code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={(e) => {
                          onChangeEditLocale(loc.code);
                          close(e.detail !== 0);
                        }}
                      >
                        <span className="flex-1">{loc.label}</span>
                        <span className="ink-menu-hint inline-flex items-center gap-1">
                          {isDrifted && <IconAlertTriangle className="w-3 h-3" />}
                          <span>{statusHint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopupMenu>

            <UnderlineTabs
              variant="segmented"
              items={modeTabs}
              value={editorMode}
              onChange={handleSwitchEditorMode}
              ariaLabel={s.visual.modeAria}
              idPrefix={modeTabPrefix}
            />

            {isAdmin ? (
              <button
                type="button"
                aria-label={`${autosaveText} — ${s.configureAutosaveTitle}`}
                title={`${autosaveText} — ${s.configureAutosaveTitle}`}
                onClick={() => onSwitchSection('settings')}
                className={`hidden md:inline-flex items-center gap-1.5 min-h-7 px-2 py-0.5 rounded-lg font-mono text-xs tabular-nums hover:bg-surface-raised hover:text-ink-primary transition-colors cursor-pointer ${autosaveTone}`}
              >
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full bg-current shrink-0"
                />
                <span
                  role="status"
                  aria-live="polite"
                  className={
                    autosaveStatus.kind === 'error'
                      ? 'inline'
                      : 'hidden lg:inline'
                  }
                >
                  {autosaveText}
                </span>
              </button>
            ) : (
              <span
                role="status"
                aria-live="polite"
                aria-label={autosaveText}
                title={autosaveText}
                className={`hidden md:inline-flex items-center gap-1.5 font-mono text-xs tabular-nums ${autosaveTone}`}
              >
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full bg-current shrink-0"
                />
                <span
                  className={
                    autosaveStatus.kind === 'error'
                      ? 'inline'
                      : 'hidden lg:inline'
                  }
                >
                  {autosaveText}
                </span>
              </span>
            )}

            {otherCollabMembers.length > 0 && (
              <div
                aria-label={extCopy.collab.presenceLabel(otherCollabMembers.length)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border-subtle bg-surface-raised text-xs text-ink-secondary"
              >
                <div className="flex items-center -space-x-1.5">
                  {otherCollabMembers.slice(0, 4).map((m) => (
                    <span
                      key={m.user_id}
                      title={`${m.display_name} · ${
                        m.state === 'editing'
                          ? extCopy.collab.presenceEditingBadge
                          : extCopy.collab.presenceViewingBadge
                      } (${m.locale})`}
                      className="relative inline-flex rounded-full ring-2 ring-surface-sheet"
                    >
                      <UserAvatar
                        name={m.display_name || m.username}
                        avatarUrl={m.avatar_url}
                        sizeClass="w-5 h-5"
                      />
                      <span
                        aria-hidden="true"
                        className={`absolute -bottom-0.5 -end-0.5 w-2 h-2 rounded-full border border-surface-sheet ${
                          m.state === 'editing'
                            ? 'bg-accent-amber motion-safe:animate-pulse'
                            : 'bg-accent-success'
                        }`}
                      />
                    </span>
                  ))}
                </div>
                <span className="font-mono text-xs tabular-nums hidden xl:inline">
                  {extCopy.collab.presenceLabel(otherCollabMembers.length)}
                </span>
              </div>
            )}
          </div>

          {/* Right: Preview Split Toggle + Inspector Toggle + Publish Switch + Overflow + Save */}
          <div className="flex flex-wrap items-center gap-1.5 ms-auto">
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
              <span>{extCopy.studio.editorPreviewToggle}</span>
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
              <span>{extCopy.studio.editorInspectorToggle}</span>
            </button>

            <SwitchRow
              variant="chip"
              labelPosition="end"
              checked={docStatus === 'published'}
              onChange={(checked) =>
                setDocStatus(checked ? 'published' : 'draft')
              }
              label={s.publishCheckbox}
            />

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

                  {canOpenPublishedPage && (
                    <Link
                      to={`/${editLocale}/series/${selTrack}/${selStep}`}
                      onClick={() => close(true)}
                    >
                      <IconExternalLink className="w-3.5 h-3.5 text-ink-muted" />
                      <span>{s.openReaderLink.replace(/\s*↗$/, '')}</span>
                    </Link>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      close(e.detail !== 0);
                      onOpenNewStepModal();
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
                            onRestoreStep(selTrack, selChapter, selStep);
                          }}
                        >
                          <IconShield className="w-3.5 h-3.5 text-ink-muted" />
                          <span>{extCopy.studio.restoreBtn}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-tone="danger"
                          onClick={(e) => {
                            close(e.detail !== 0);
                            onRequestTakedown({
                              trackSlug: selTrack,
                              chapterSlug: selChapter,
                              stepSlug: selStep,
                              title: stripHtmlTags(docTitle) || selStep,
                            });
                          }}
                        >
                          <IconShield className="w-3.5 h-3.5" />
                          <span>{extCopy.studio.takedownBtn}</span>
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

            <button
              type="button"
              disabled={saving || !canEditDoc || (!isEditorDirty && docExists)}
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

        {/* ZONE 1B: Dedicated Contextual Editing Toolbar */}
        <div
          role="toolbar"
          aria-label={extCopy.studio.editorToolbarAria}
          className="px-3.5 py-2 border-t border-border-subtle bg-surface-raised/60"
        >
          {editorMode === 'visual' ? (
            <VisualBlockToolStrip
              locale={locale}
              blockCount={visualBlocks.length}
              uploadingImage={uploadingVisualImage}
              onInsertBlock={handleAppendVisualBlock}
              onUploadImageFile={(file) => void handleUploadVisualImage(file)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <FileUploadButton
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                uploading={uploadingMdImage}
                label={s.snippets.image}
                icon={<IconImage className="w-3.5 h-3.5 text-ink-muted" />}
                buttonClassName="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-sheet hover:bg-action-subtle text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
                onSelectFile={(file) => void handleUploadMdImage(file)}
              />
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
              {extCopy.studio.takedownBannerTitle}
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--alert-danger-body)' }}
            >
              {extCopy.studio.takedownBannerMeta(
                docTakedownBy ?? '',
                docTakedownReason,
              )}
            </div>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onRestoreStep(selTrack, selChapter, selStep)}
              className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer shrink-0"
            >
              {extCopy.studio.restoreBtn}
            </button>
          )}
        </div>
      )}

      {/* Local Auto-Saved Draft Recovery Strip */}
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
                setDocLicense(normalizeLicenseId(recoverableDraft.license));
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
                clearLocalDraft(user.id, selTrack, selChapter, selStep, editLocale);
                setRecoverableDraft(null);
              }}
              className="min-h-8 px-2.5 py-1 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {s.discardDraftBtn}
            </button>
          </div>
        </div>
      )}

      {remoteNotice && (
        <div
          role="status"
          className="rounded-xl border border-border-ink/40 bg-action-subtle px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-primary"
        >
          <span className="font-medium">
            {extCopy.collab.remoteSavedBanner(
              remoteNotice.authorName,
              remoteNotice.editSeq,
            )}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setRemoteNotice(null);
                void loadEditorStep(selTrack, selChapter, selStep, editLocale);
              }}
              className="min-h-7 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer"
            >
              {extCopy.collab.reloadLatestBtn}
            </button>
            <button
              type="button"
              onClick={() => setRemoteNotice(null)}
              className="min-h-7 px-2 py-1 text-xs text-ink-muted hover:text-ink-primary cursor-pointer"
            >
              {copy.cancelBtn}
            </button>
          </div>
        </div>
      )}

      {/* ZONE 2 & ZONE 3: Writing Canvas + Optional Live Split Preview + Collapsible Inspector */}
      <div className="studio-editor-body">
        <div className="flex-1 min-w-0">
          <div
            className={
              previewSplitOpen
                ? 'grid grid-cols-1 xl:grid-cols-2 gap-6 items-start'
                : 'w-full'
            }
          >
            <div className="min-w-0">
              {/* Panel 1: Hand-Drawn Stationery Flow Writing Canvas */}
              <div
                role="tabpanel"
                aria-labelledby={`${modeTabPrefix}-visual`}
                hidden={editorMode !== 'visual'}
                className="min-w-0 max-w-full"
              >
                <div className="editor-tabpanel-body notebook-sheet-stack">
                  <div className="notebook-sheet-card p-5 sm:p-8 lg:p-10 space-y-6">
                    <div className="pb-4 border-b border-dashed border-border-subtle space-y-2">
                      <input
                        type="text"
                        size={1}
                        aria-label={s.titleInputLabel}
                        value={docTitle}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        placeholder={extCopy.studio.editorCanvasTitlePlaceholder}
                        style={{ fontFamily: 'var(--font-hand)' }}
                        className="w-full min-w-0 bg-transparent border-0 p-0 text-2xl sm:text-3xl font-semibold text-ink-primary placeholder:text-ink-muted focus:outline-none leading-tight tracking-tight"
                      />
                      <MarkerUnderline variant="canvas" />
                      <textarea
                        rows={1}
                        aria-label={s.summaryInputLabel}
                        value={docSummary}
                        onChange={(e) => setDocSummary(e.target.value)}
                        placeholder={extCopy.studio.flowEditor.summaryInlinePlaceholder}
                        className="flow-editor-textarea text-sm text-ink-secondary leading-relaxed placeholder:text-ink-muted"
                      />
                    </div>

                    <VisualBlockEditor
                      locale={locale}
                      theme={theme}
                      blocks={visualBlocks}
                      onChange={handleVisualBlocksChange}
                      hideTopInserter
                    />
                  </div>
                </div>
              </div>

              {/* Panel 2: Markdown Source Canvas */}
              <div
                role="tabpanel"
                aria-labelledby={`${modeTabPrefix}-markdown`}
                hidden={editorMode !== 'markdown'}
                className="min-w-0 max-w-full"
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
                    onPaste={(e) => {
                      const img = Array.from(e.clipboardData?.items ?? []).find(
                        (it) => it.kind === 'file' && it.type.startsWith('image/'),
                      );
                      const file = img?.getAsFile();
                      if (file) {
                        e.preventDefault();
                        void handleUploadMdImage(file);
                      }
                    }}
                    onDragOver={(e) => {
                      if (e.dataTransfer?.types?.includes('Files')) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => {
                      const file = Array.from(e.dataTransfer?.files ?? []).find(
                        (f) => f.type.startsWith('image/'),
                      );
                      if (file) {
                        e.preventDefault();
                        void handleUploadMdImage(file);
                      }
                    }}
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
                      v{docVersion} · {extCopy.studio.autoReadMinutesBadge(docMinutes)} ·{' '}
                      {docStatus === 'published'
                        ? extCopy.studio.editorStatusPublished
                        : extCopy.studio.editorStatusDraft}
                    </span>
                  </div>

                  <div>
                    <h2
                      className="text-2xl font-semibold text-ink-primary leading-tight"
                      style={{ fontFamily: 'var(--font-hand)' }}
                    >
                      {docTitle ? (
                        <SafeHtml as="span" html={docTitle} />
                      ) : (
                        s.untitledPlaceholder
                      )}
                    </h2>
                    <MarkerUnderline
                      variant="canvas"
                      className="w-52 max-w-full h-2.5 mt-0.5 block pointer-events-none"
                    />
                    {docSummary && (
                      <p className="mt-2 text-sm text-ink-secondary leading-relaxed">
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

        {/* ZONE 3: Collapsible Article Info Inspector */}
        {inspectorOpen &&
          (() => {
            let savedTitleVal = '';
            try {
              if (savedSnapshot) {
                savedTitleVal =
                  (JSON.parse(savedSnapshot) as { title?: string }).title ?? '';
              }
            } catch {
              savedTitleVal = '';
            }
            const rawSuggestedSlug = suggestSlugFromTitle(docTitle, docStepNum);
            const suggestedTitleSlug =
              docExists &&
              !isAutoPlaceholderSlug(selStep) &&
              docTitle.trim() !== savedTitleVal.trim() &&
              rawSuggestedSlug &&
              rawSuggestedSlug !== draftStepSlug.trim() &&
              rawSuggestedSlug !== selStep
                ? rawSuggestedSlug
                : undefined;

            return (
              <StudioEditorInspector
                locale={locale}
                editLocale={editLocale}
                siteSettings={siteSettings}
                trackSlug={selTrack}
                trackTitle={
                  currentTrackObj ? stripHtmlTags(currentTrackObj.title) : selTrack
                }
                chapterTitle={
                  currentChapterObj
                    ? stripHtmlTags(currentChapterObj.title)
                    : selChapter
                }
                stepSlug={selStep}
                draftStepSlug={draftStepSlug}
                canOpenPublishedPage={canOpenPublishedPage}
                suggestedSlug={suggestedTitleSlug}
                onApplySuggestedSlug={
                  suggestedTitleSlug
                    ? () => handleCommitStepSlugOnBlur(suggestedTitleSlug)
                    : undefined
                }
                onChangeStepSlug={(val) => {
                  slugManuallyEditedRef.current = true;
                  setDraftStepSlug(sanitizeStepSlugDraft(val));
                }}
                onCommitStepSlug={handleCommitStepSlugOnBlur}
                docExists={docExists}
                docStatus={docStatus}
                docVersion={docVersion}
                docMinutes={docMinutes}
                docCanonicalRev={docCanonicalRev}
                docTitle={docTitle}
                onChangeTitle={handleTitleChange}
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
                canLeave={canLeaveDoc}
                inviteEmail={inviteEmail}
                onChangeInviteEmail={setInviteEmail}
                inviteRole={inviteRole}
                onChangeInviteRole={setInviteRole}
                inviting={inviting}
                lastInviteUrl={lastInviteUrl}
                onInviteCollaborator={(e) => void handleInviteCollaborator(e)}
                onCopyInviteLink={() => void handleCopyInviteLink()}
                onRevokeInvite={(id) => void handleRevokeInvite(id)}
                onRemoveCollaborator={(uid) => void handleRemoveCollaborator(uid)}
                onUpdateCollaboratorRole={(uid, r) =>
                  void handleUpdateCollaboratorRole(uid, r)
                }
                onTransferOwnership={(author) => setTransferTarget(author)}
                onLeaveCollaboration={() => setLeaveConfirmOpen(true)}
                onOpenHistory={() => setHistoryOpen(true)}
                onClose={() =>
                  runLayoutTransition(null, () => setInspectorOpen(false))
                }
              />
            );
          })()}
      </div>

      {/* Revision History & Collaboration Audit Log Modal */}
      {historyMounted && (
        <RevisionHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          locale={locale}
          trackSlug={selTrack}
          chapterSlug={selChapter}
          stepSlug={selStep}
          editLocale={editLocale}
          currentEtag={docEtag}
          canEdit={canEditDoc}
          onRestored={handleApplyRestoredSnapshot}
        />
      )}

      {/* HTTP 412 Optimistic Concurrency Conflict Resolution Modal */}
      <RevisionConflictModal
        open={Boolean(conflictState)}
        locale={locale}
        conflict={conflictState}
        localTitle={docTitle}
        localBody={docBody}
        resolving={saving}
        onClose={() => setConflictState(null)}
        onAdoptRemote={() => {
          setConflictState(null);
          setRemoteNotice(null);
          void loadEditorStep(selTrack, selChapter, selStep, editLocale);
        }}
        onMergeIntoEditor={(mergedBody, currentEtag) => {
          setConflictState(null);
          setRemoteNotice(null);
          setEditorMode('markdown');
          setDocBody(mergedBody);
          setDocEtag(currentEtag);
        }}
        onOverwriteWithLocal={(currentEtag) =>
          void performSaveStep(undefined, true, currentEtag)
        }
      />

      {/* Transfer Ownership Confirmation Modal */}
      <ConfirmDialog
        open={Boolean(transferTarget)}
        onClose={() => setTransferTarget(null)}
        tone="danger"
        busy={busyLifecycle}
        title={
          transferTarget
            ? extCopy.collab.transferConfirmTitle(transferTarget.display_name)
            : ''
        }
        description={extCopy.collab.transferConfirmDesc}
        cancelLabel={copy.cancelBtn}
        confirmLabel={extCopy.collab.transferOwnerBtn}
        onConfirm={() => void handleConfirmTransferOwnership()}
      />

      {/* Leave Collaboration Confirmation Modal */}
      <ConfirmDialog
        open={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        tone="danger"
        busy={busyLifecycle}
        title={extCopy.collab.leaveConfirmTitle}
        description={extCopy.collab.leaveConfirmDesc}
        cancelLabel={copy.cancelBtn}
        confirmLabel={extCopy.collab.leaveCollabBtn}
        onConfirm={() => void handleConfirmLeaveCollaboration()}
      />

      {/* Delete Step Confirmation Modal */}
      <ConfirmDialog
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        tone="danger"
        busy={deletingStep}
        title={s.deleteDialogTitle(selStep)}
        description={s.deleteDialogDesc}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={s.deleteConfirmBtn}
        onConfirm={() => void handleConfirmDeleteStep()}
      />
    </div>
  );
}
