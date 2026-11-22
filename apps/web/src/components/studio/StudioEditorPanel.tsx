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
import { api } from '../../lib/api';
import { normalizeEmail } from '../../lib/email';
import {
  EXT_COPY,
  getEnabledLocaleMetas,
  LOCALES,
  UI_COPY,
} from '../../lib/i18n';
import { normalizeLicenseId } from '../../lib/licenses';
import { SafeHtml, stripHtmlTags } from '../../lib/sanitizer';
import type { ResolvedTheme } from '../../lib/theme';
import type {
  ArticleAuthorDto,
  CollaboratorInviteDto,
  LicenseId,
  LocaleCode,
  NotebookBlock,
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
import type { TakedownStepTarget } from './StudioCatalogPanel';
import { StudioEditorInspector } from './StudioEditorInspector';
import type { StudioSectionId } from './StudioSidebarContent';
import { VisualBlockEditor, VisualBlockToolStrip } from './VisualBlockEditor';

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
      localStorage.getItem(
        `icetowne_studio_draft::${track}::${chapter}::${step}::${loc}`,
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

  const [editorMode, setEditorMode] = useState<'visual' | 'markdown'>('visual');
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : true,
  );
  const [previewSplitOpen, setPreviewSplitOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingStep, setDeletingStep] = useState(false);

  const enabledStudioLocales = useMemo(
    () => getEnabledLocaleMetas(siteSettings.enabled_locales),
    [siteSettings.enabled_locales],
  );

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
  const [docPendingInvites, setDocPendingInvites] = useState<
    CollaboratorInviteDto[]
  >([]);
  const [canManageCollaborators, setCanManageCollaborators] = useState(false);
  const [docTakedownReason, setDocTakedownReason] = useState<string | null>(
    null,
  );
  const [docTakedownBy, setDocTakedownBy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState('');
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

  // Load selected step into editor
  const loadEditorStep = useCallback(
    async (tSlug: string, cSlug: string, sSlug: string, loc: LocaleCode) => {
      if (!tSlug || !cSlug || !sSlug) return;
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
    [toast],
  );

  useEffect(() => {
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

  // Unified periodic draft auto-save
  const needsAutosave = isEditorDirty && currentDocSig !== lastLocalAutosaveSig;

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
            void onRefreshOverview();
          })
          .catch(() => {
            if (activeTargetRef.current !== cur.targetKey) return;
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
    siteSettings.enable_draft_autosave,
    siteSettings.draft_autosave_interval_secs,
    needsAutosave,
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
      await onRefreshOverview();
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
    if (deletingStep) return;
    setDeletingStep(true);
    try {
      await api.studioDeleteStep(selTrack, selChapter, selStep);
      clearLocalDraft(selTrack, selChapter, selStep, editLocale);
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
    if (inviting) return;
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
        toast.success(extCopy.studio.inviteCreatedEmailSentMsg);
      } else {
        toast.info(extCopy.studio.inviteCreatedLinkOnlyMsg);
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
                          onChangeEditLocale(loc.code);
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
                role="status"
                aria-live="polite"
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
                  className={
                    autosaveStatus.kind === 'error'
                      ? 'inline'
                      : 'hidden 2xl:inline'
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
                      : 'hidden 2xl:inline'
                  }
                >
                  {autosaveText}
                </span>
              </span>
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
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder={extCopy.studio.editorCanvasTitlePlaceholder}
                        style={{ fontFamily: 'var(--font-hand)' }}
                        className="w-full min-w-0 bg-transparent border-0 p-0 text-2xl sm:text-3xl font-semibold text-ink-primary placeholder:text-ink-muted/60 focus:outline-none leading-tight tracking-tight"
                      />
                      <MarkerUnderline variant="canvas" />
                      <textarea
                        rows={1}
                        aria-label={s.summaryInputLabel}
                        value={docSummary}
                        onChange={(e) => setDocSummary(e.target.value)}
                        placeholder={extCopy.studio.flowEditor.summaryInlinePlaceholder}
                        className="flow-editor-textarea text-sm text-ink-secondary leading-relaxed placeholder:text-ink-muted/60"
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
