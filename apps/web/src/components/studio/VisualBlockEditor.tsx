/*
 * Visual Block Editor for IceHandNote Studio.
 * - Primary authoring experience with lossless bidirectional sync to Markdown (`visualBlocks.ts`).
 * - Supports interactive checkable steps (`:::steps[...]`), headings, paragraphs + margin notes,
 *   5-variant stationery alerts + collapsible details, Washi code cards, lists, quotes,
 *   Rough.js node/edge diagrams with auto-layout, and a lossless raw-Markdown fallback block.
 * - Strict Design System adherence: only weights 400 & 600, min 12px (`text-xs`), semantic tokens,
 *   stroke SVG icons (`Icons.tsx`), and >= 28px (`w-7 h-7` / `min-h-7`) touch targets.
 */

import { type ChangeEvent, type ReactNode, useId, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { UI_COPY } from '../../lib/i18n';
import { RC3_COPY } from '../../lib/i18nRc3';
import type {
  LocaleCode,
  SketchNode,
  StickerStyle,
} from '../../lib/types';
import {
  createDefaultVisualBlock,
  createVisualId,
  formatAuthorMarginNote,
  parseAuthorMarginNote,
  type VisualBlock,
  type VisualStepItem,
} from '../../lib/visualBlocks';
import {
  ALERT_DOODLE_ICONS,
  ALL_ALERT_KINDS,
  ALL_CODE_CARD_STYLES,
  ALL_STICKER_STYLES,
  ALL_STICKER_TONES,
  DEFAULT_ALERT_PRESET,
  STICKER_TONE_TOKENS,
} from '../notebook/StationeryStickers';
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconCheckSquare,
  IconChevronDown,
  IconCode,
  IconCopy,
  IconDiagram,
  IconFileCode,
  IconHeading,
  IconImage,
  IconList,
  IconParagraph,
  IconPen,
  IconPlus,
  IconQuote,
  IconTrash,
  IconUpload,
} from '../ui/Icons';
import { useToast } from '../ui/ToastProvider';

interface VisualBlockEditorProps {
  locale: LocaleCode;
  blocks: VisualBlock[];
  onChange: (next: VisualBlock[]) => void;
  hideTopInserter?: boolean;
}

interface VisualBlockToolStripProps {
  locale: LocaleCode;
  blockCount: number;
  onInsertBlock: (kind: VisualBlock['type']) => void;
  onInsertSectionTask: () => void;
}

export function VisualBlockToolStrip({
  locale,
  blockCount,
  onInsertBlock,
  onInsertSectionTask,
}: VisualBlockToolStripProps) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onInsertSectionTask}
        className="ui-press-tactile min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold bg-action-subtle text-link-ink border border-action-bg/40 hover:border-border-ink inline-flex items-center gap-1.5 cursor-pointer transition-colors"
      >
        <IconCheckSquare className="w-3.5 h-3.5 text-link-ink" />
        <span>{copy.taskScopeSection}</span>
      </button>

      {INSERTABLE_TYPES.map((kind) => {
        const isSteps = kind === 'steps';
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onInsertBlock(kind)}
            className={`ui-press-tactile min-h-8 px-2.5 py-1 rounded-lg text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              isSteps
                ? 'font-semibold bg-surface-raised text-accent-ice border border-border-subtle hover:border-border-ink'
                : 'bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink'
            }`}
          >
            {blockIcon(kind)}
            <span>{isSteps ? copy.taskScopeParagraph : v.types[kind]}</span>
          </button>
        );
      })}

      <span className="ms-auto text-xs font-mono text-ink-muted tabular-nums ps-2">
        {v.blockCount(blockCount)}
      </span>
    </div>
  );
}

const INSERTABLE_TYPES: VisualBlock['type'][] = [
  'steps',
  'heading',
  'paragraph',
  'image',
  'alert',
  'code_card',
  'list',
  'quote',
  'rough_diagram',
];

const AUTHOR_MARGIN_STYLES: StickerStyle[] = [
  'tape',
  'pin',
  'torn',
  'clip',
  'stamp',
  'tag',
];

const SKETCH_TONES: SketchNode['tone'][] = [
  'violet',
  'ice',
  'amber',
  'coral',
  'paper',
];

const COMMON_LANGUAGES = [
  'rust',
  'typescript',
  'tsx',
  'javascript',
  'sql',
  'toml',
  'bash',
  'css',
  'html',
  'json',
  'yaml',
  'text',
];

function blockIcon(type: VisualBlock['type']): ReactNode {
  switch (type) {
    case 'heading':
      return <IconHeading className="w-3.5 h-3.5" />;
    case 'paragraph':
      return <IconParagraph className="w-3.5 h-3.5" />;
    case 'image':
      return <IconImage className="w-3.5 h-3.5 text-link-ink" />;
    case 'steps':
      return <IconCheckSquare className="w-3.5 h-3.5 text-accent-ice" />;
    case 'alert':
      return <IconAlertCircle className="w-3.5 h-3.5 text-accent-amber" />;
    case 'code_card':
      return <IconCode className="w-3.5 h-3.5" />;
    case 'list':
      return <IconList className="w-3.5 h-3.5" />;
    case 'quote':
      return <IconQuote className="w-3.5 h-3.5" />;
    case 'rough_diagram':
      return <IconDiagram className="w-3.5 h-3.5" />;
    case 'raw_markdown':
      return <IconFileCode className="w-3.5 h-3.5" />;
  }
}

function blockPreviewSummary(block: VisualBlock): string {
  switch (block.type) {
    case 'heading':
      return `H${block.level} · ${block.text || '…'}`;
    case 'paragraph':
      return block.text.slice(0, 48) || '…';
    case 'image':
      return block.caption || block.alt || block.src.slice(0, 42) || '…';
    case 'steps':
      return `${block.title || 'Steps'} (${block.items.length})`;
    case 'alert':
      return `${block.kind.toUpperCase()} · ${block.title || block.body.slice(0, 36) || '…'}`;
    case 'code_card':
      return `${block.language}${block.filename ? ` · ${block.filename}` : ''}`;
    case 'list':
      return `${block.ordered ? '1.' : '•'} ${block.items.length}`;
    case 'quote':
      return block.text.slice(0, 48) || '…';
    case 'rough_diagram':
      return `${block.caption || 'Diagram'} (${block.spec.nodes.length}N / ${block.spec.edges.length}E)`;
    case 'raw_markdown':
      return block.content.slice(0, 48) || '…';
  }
}

function cloneVisualBlock(block: VisualBlock): VisualBlock {
  const id = createVisualId();
  switch (block.type) {
    case 'steps':
      return {
        ...block,
        id,
        items: block.items.map((it) => ({ ...it, id: createVisualId('st') })),
      };
    case 'list':
      return { ...block, id, items: [...block.items] };
    case 'rough_diagram':
      return {
        ...block,
        id,
        spec: {
          nodes: block.spec.nodes.map((n) => ({ ...n })),
          edges: block.spec.edges.map((e) => ({ ...e })),
        },
      };
    default:
      return { ...block, id };
  }
}

interface ParagraphBlockBodyProps {
  block: Extract<VisualBlock, { type: 'paragraph' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'paragraph' }>) => void;
}

function ParagraphBlockBody({
  block,
  locale,
  onUpdate,
}: ParagraphBlockBodyProps) {
  const v = UI_COPY[locale].studio.visual;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const wrapSelection = (before: string, after: string, fallback: string) => {
    const el = textareaRef.current;
    if (!el) {
      onUpdate({ ...block, text: `${block.text}${before}${fallback}${after}` });
      return;
    }
    const start = el.selectionStart ?? block.text.length;
    const end = el.selectionEnd ?? block.text.length;
    const selected = block.text.slice(start, end) || fallback;
    const nextText =
      block.text.slice(0, start) +
      before +
      selected +
      after +
      block.text.slice(end);
    onUpdate({ ...block, text: nextText });
    requestAnimationFrame(() => {
      el.focus();
      const selStart = start + before.length;
      el.setSelectionRange(selStart, selStart + selected.length);
    });
  };

  const rows = Math.min(10, Math.max(3, block.text.split('\n').length + 1));

  return (
    <div className="space-y-2.5">
      {/* Inline formatting mini-toolbar */}
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => wrapSelection('**', '**', 'text')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtBold}
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('*', '*', 'text')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs italic bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtItalic}
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('`', '`', 'code')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-mono bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtCode}
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('[', '](https://)', 'label')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtLink}
        </button>
      </div>

      <textarea
        ref={textareaRef}
        rows={rows}
        value={block.text}
        onChange={(e) => onUpdate({ ...block, text: e.target.value })}
        placeholder={v.paragraphPlaceholder}
        className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle focus:border-border-ink text-sm leading-relaxed ink-input-inset"
      />

      {/* Optional Author Margin Sticker */}
      <AuthorMarginNoteInput
        locale={locale}
        rawValue={block.marginNote}
        onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
      />
    </div>
  );
}

function ImageBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'image' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'image' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;
  const rc3 = RC3_COPY[locale].studio;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploading) return;
    setUploading(true);
    try {
      const uploaded = await api.uploadStudioMedia(file);
      onUpdate({
        ...block,
        src: uploaded.url,
        alt: block.alt || file.name.replace(/\.[^.]+$/, ''),
      });
      toast.success(rc3.imageUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon,image/svg+xml"
          onChange={(e) => void handleFileChange(e)}
          className="sr-only"
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
        >
          <IconUpload className="w-3.5 h-3.5 text-ink-muted" />
          <span>{uploading ? v.imageUploading : v.imageUploadBtn}</span>
        </button>

        <input
          type="text"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          aria-label={v.imageUrlLabel}
          value={block.src}
          onChange={(e) => onUpdate({ ...block, src: e.target.value })}
          placeholder={v.imageUrlPlaceholder}
          className="flex-1 min-w-44 px-3 py-1.5 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          type="text"
          aria-label={v.imageAltLabel}
          value={block.alt}
          onChange={(e) => onUpdate({ ...block, alt: e.target.value })}
          placeholder={v.imageAltLabel}
          className="w-full px-3 py-1.5 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-xs"
        />
        <input
          type="text"
          aria-label={v.imageCaptionLabel}
          value={block.caption}
          onChange={(e) => onUpdate({ ...block, caption: e.target.value })}
          placeholder={v.imageCaptionLabel}
          className="w-full px-3 py-1.5 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-xs"
        />
      </div>

      {block.src.trim() && (
        <div className="rounded-xl overflow-hidden border border-border-subtle bg-surface-sunken p-2">
          <img
            src={block.src}
            alt={block.alt}
            loading="lazy"
            className="max-h-48 mx-auto rounded-lg object-contain"
          />
        </div>
      )}

      <AuthorMarginNoteInput
        locale={locale}
        rawValue={block.marginNote}
        onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
      />
    </div>
  );
}

function AuthorMarginNoteInput({
  locale,
  rawValue,
  onChange,
}: {
  locale: LocaleCode;
  rawValue: string;
  onChange: (nextRaw: string) => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const parsed = parseAuthorMarginNote(rawValue);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <IconPen className="w-3.5 h-3.5 text-ink-muted shrink-0" />
        <input
          type="text"
          value={parsed.text}
          onChange={(e) =>
            onChange(
              formatAuthorMarginNote(e.target.value, parsed.tone, parsed.style),
            )
          }
          aria-label={v.marginNoteLabel}
          placeholder={v.marginNotePlaceholder}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-secondary border border-border-subtle text-xs"
        />
      </div>

      {parsed.text.trim().length > 0 && (
        <div className="ps-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {AUTHOR_MARGIN_STYLES.map((st) => {
              const active = parsed.style === st;
              return (
                <button
                  key={st}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onChange(formatAuthorMarginNote(parsed.text, parsed.tone, st))
                  }
                  className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer transition-colors ${
                    active
                      ? 'font-semibold bg-surface-sheet text-ink-primary border-border-ink'
                      : 'bg-surface-sheet/60 text-ink-muted border-border-subtle hover:text-ink-primary'
                  }`}
                >
                  {copy.stickerStyles[st]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            {ALL_STICKER_TONES.map((t) => {
              const cfg = STICKER_TONE_TOKENS[t];
              const active = parsed.tone === t;
              return (
                <button
                  key={t}
                  type="button"
                  data-color-swatch=""
                  aria-label={copy.stickyColorAria(copy.stickerTones[t])}
                  aria-pressed={active}
                  onClick={() =>
                    onChange(formatAuthorMarginNote(parsed.text, t, parsed.style))
                  }
                  className={`w-6 h-6 rounded-full border-2 inline-flex items-center justify-center cursor-pointer transition-transform ${
                    active
                      ? 'scale-110 ring-2 ring-ink-primary ring-offset-1 ring-offset-surface-raised'
                      : ''
                  }`}
                  style={{
                    backgroundColor: cfg.swatch,
                    borderColor: 'var(--border-ink)',
                    color: '#ffffff',
                  }}
                >
                  {active && <IconCheck className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function VisualBlockEditor({
  locale,
  blocks,
  onChange,
  hideTopInserter = false,
}: VisualBlockEditorProps) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const langListId = useId();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateBlock = (index: number, nextBlock: VisualBlock) => {
    const next = [...blocks];
    next[index] = nextBlock;
    onChange(next);
  };

  const moveBlock = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  const duplicateBlock = (index: number) => {
    const next = [...blocks];
    next.splice(index + 1, 0, cloneVisualBlock(blocks[index]));
    onChange(next);
  };

  const deleteBlock = (index: number) => {
    const next = blocks.filter((_, idx) => idx !== index);
    onChange(next);
  };

  const appendBlock = (kind: VisualBlock['type']) => {
    onChange([...blocks, createDefaultVisualBlock(kind)]);
  };

  const appendSectionTaskHeading = () => {
    onChange([
      ...blocks,
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

  const insertBlockAt = (afterIndex: number, kind: VisualBlock['type']) => {
    const next = [...blocks];
    next.splice(afterIndex + 1, 0, createDefaultVisualBlock(kind));
    onChange(next);
    setInsertAfterId(null);
  };

  const insertSectionTaskAt = (afterIndex: number) => {
    const next = [...blocks];
    next.splice(afterIndex + 1, 0, {
      id: createVisualId(),
      type: 'heading',
      level: 2,
      text: '',
      isTask: true,
      defaultChecked: false,
    });
    onChange(next);
    setInsertAfterId(null);
  };

  return (
    <div className="space-y-4">
      <datalist id={langListId}>
        {COMMON_LANGUAGES.map((lang) => (
          <option key={lang} value={lang} />
        ))}
      </datalist>

      {/* Optional Embedded Top Block-Insert Toolbar (hidden when hosted by Studio's dedicated Toolbar) */}
      {!hideTopInserter && (
        <div className="rounded-xl p-3 bg-surface-raised border border-border-subtle space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-secondary">
              {v.addBlockLabel}
            </span>
          </div>
          <VisualBlockToolStrip
            locale={locale}
            blockCount={blocks.length}
            onInsertBlock={appendBlock}
            onInsertSectionTask={appendSectionTaskHeading}
          />
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="rounded-xl p-6 bg-surface-raised border border-dashed border-border-subtle text-center space-y-3">
          <div
            className="text-base font-semibold text-ink-primary"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {v.emptyTitle}
          </div>
          <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
            {(['heading', 'paragraph', 'steps'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => appendBlock(kind)}
                className="min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer"
              >
                {blockIcon(kind)}
                <span>+ {v.types[kind]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            let runningTaskOffset = 0;
            return blocks.map((block, idx) => {
              const isCollapsed = collapsedIds.has(block.id);
              const showInsertPicker = insertAfterId === block.id;
              const taskStartOffset = runningTaskOffset;
              if (block.type === 'steps') {
                runningTaskOffset += block.items.length;
              }

              const isSectionTaskHead = block.type === 'heading' && Boolean(block.isTask);

              return (
              <div key={block.id} className="ui-panel-enter space-y-2">
                <div className="rounded-xl border border-border-subtle focus-within:border-border-ink bg-surface-raised/60 overflow-hidden transition-colors">
                  {/* Block Card Header */}
                  <div className="px-3 py-2 bg-surface-sheet border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono text-xs text-ink-muted tabular-nums shrink-0">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-semibold shrink-0 ${
                          isSectionTaskHead
                            ? 'bg-action-subtle border-border-ink text-link-ink'
                            : 'bg-surface-raised border-border-subtle text-ink-primary'
                        }`}
                      >
                        {isSectionTaskHead ? (
                          <IconCheckSquare className="w-3.5 h-3.5 text-link-ink" />
                        ) : (
                          blockIcon(block.type)
                        )}
                        <span>
                          {isSectionTaskHead
                            ? copy.taskScopeSection
                            : block.type === 'steps'
                              ? copy.taskScopeParagraph
                              : v.types[block.type]}
                        </span>
                      </span>
                      {isCollapsed && (
                        <span className="text-xs text-ink-muted studio-ellipsis">
                          {blockPreviewSummary(block)}
                        </span>
                      )}
                    </div>

                    {/* Block Controls (all 28x28 >= 24px touch target) */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveBlock(idx, -1)}
                        aria-label={v.moveUp}
                        title={v.moveUp}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <IconArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === blocks.length - 1}
                        onClick={() => moveBlock(idx, 1)}
                        aria-label={v.moveDown}
                        title={v.moveDown}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <IconArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateBlock(idx)}
                        aria-label={v.duplicate}
                        title={v.duplicate}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer"
                      >
                        <IconCopy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setInsertAfterId((cur) =>
                            cur === block.id ? null : block.id,
                          )
                        }
                        aria-label={v.insertBelow}
                        title={v.insertBelow}
                        aria-expanded={showInsertPicker}
                        className={`w-7 h-7 rounded-lg inline-flex items-center justify-center cursor-pointer ${
                          showInsertPicker
                            ? 'bg-action-subtle text-link-ink'
                            : 'text-ink-muted hover:text-ink-primary hover:bg-surface-raised'
                        }`}
                      >
                        <IconPlus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleCollapse(block.id)}
                        aria-label={isCollapsed ? v.expand : v.collapse}
                        title={isCollapsed ? v.expand : v.collapse}
                        aria-expanded={!isCollapsed}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer"
                      >
                        <IconChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${
                            isCollapsed ? '-rotate-90' : ''
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteBlock(idx)}
                        aria-label={v.deleteBlock}
                        title={v.deleteBlock}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Block Card Body */}
                  {!isCollapsed && (
                    <div className="p-3.5 space-y-3">
                      {block.type === 'heading' && (
                        <div className="space-y-2.5">
                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                            <div
                              role="group"
                              aria-label={v.types.heading}
                              className="inline-flex rounded-lg p-0.5 bg-surface-sheet border border-border-subtle shrink-0"
                            >
                              {([2, 3, 4] as const).map((lvl) => (
                                <button
                                  key={lvl}
                                  type="button"
                                  aria-pressed={block.level === lvl}
                                  onClick={() =>
                                    updateBlock(idx, { ...block, level: lvl })
                                  }
                                  className={`min-h-7 px-2 py-0.5 rounded-md text-xs font-mono cursor-pointer ${
                                    block.level === lvl
                                      ? 'font-semibold bg-action-subtle text-link-ink'
                                      : 'text-ink-muted hover:text-ink-primary'
                                  }`}
                                >
                                  H{lvl}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              value={block.text}
                              onChange={(e) =>
                                updateBlock(idx, { ...block, text: e.target.value })
                              }
                              placeholder={v.headingPlaceholder}
                              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
                            />
                          </div>

                          <div className="flex items-center px-3 py-2 rounded-xl bg-surface-sheet border border-border-subtle">
                            <label className="inline-flex items-center gap-2 text-xs font-semibold text-ink-primary cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(block.isTask)}
                                onChange={(e) =>
                                  updateBlock(idx, {
                                    ...block,
                                    isTask: e.target.checked,
                                    defaultChecked: e.target.checked
                                      ? Boolean(block.defaultChecked)
                                      : false,
                                  })
                                }
                                {...({ switch: '' } as Record<string, unknown>)}
                              />
                              <span>{copy.sectionTaskToggleLabel}</span>
                            </label>
                          </div>
                        </div>
                      )}

                      {block.type === 'paragraph' && (
                        <ParagraphBlockBody
                          block={block}
                          locale={locale}
                          onUpdate={(next) => updateBlock(idx, next)}
                        />
                      )}

                      {block.type === 'steps' && (
                        <div className="space-y-3">
                          {(block.items.length > 1 || block.title.trim().length > 0) && (
                            <div>
                              <label className="block mb-1 text-xs font-semibold text-ink-secondary">
                                {v.stepsTitleLabel}
                              </label>
                              <input
                                type="text"
                                value={block.title}
                                onChange={(e) =>
                                  updateBlock(idx, {
                                    ...block,
                                    title: e.target.value,
                                  })
                                }
                                placeholder={v.stepsTitlePlaceholder}
                                className="w-full px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
                              />
                            </div>
                          )}

                          <div className="space-y-2">
                            {block.items.map((stepItem, sIdx) => {
                              const globalTaskNum = taskStartOffset + sIdx + 1;
                              const updateStepItem = (
                                patch: Partial<VisualStepItem>,
                              ) => {
                                const nextItems = block.items.map((it, i) =>
                                  i === sIdx ? { ...it, ...patch } : it,
                                );
                                updateBlock(idx, { ...block, items: nextItems });
                              };
                              const moveStepItem = (delta: -1 | 1) => {
                                const target = sIdx + delta;
                                if (target < 0 || target >= block.items.length)
                                  return;
                                const nextItems = [...block.items];
                                const [m] = nextItems.splice(sIdx, 1);
                                nextItems.splice(target, 0, m);
                                updateBlock(idx, { ...block, items: nextItems });
                              };
                              const removeStepItem = () => {
                                const nextItems = block.items.filter(
                                  (_, i) => i !== sIdx,
                                );
                                updateBlock(idx, {
                                  ...block,
                                  items:
                                    nextItems.length > 0
                                      ? nextItems
                                      : [
                                          {
                                            id: createVisualId('st'),
                                            title: '',
                                            detail: '',
                                            defaultChecked: false,
                                          },
                                        ],
                                });
                              };

                              return (
                                <div
                                  key={stepItem.id}
                                  className="p-2.5 rounded-xl bg-surface-sheet border border-border-subtle flex items-start gap-2"
                                >
                                  <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                                    <span className="font-mono text-xs font-semibold text-link-ink tabular-nums">
                                      {String(globalTaskNum).padStart(2, '0')}
                                    </span>
                                    <label
                                      title={v.defaultCheckedTitle}
                                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center hover:bg-surface-raised cursor-pointer transition-colors"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={stepItem.defaultChecked}
                                        onChange={(e) =>
                                          updateStepItem({
                                            defaultChecked: e.target.checked,
                                          })
                                        }
                                        aria-label={v.defaultCheckedTitle}
                                        className="w-4 h-4 cursor-pointer"
                                      />
                                    </label>
                                  </div>

                                  <div className="flex-1 min-w-0 space-y-1.5">
                                    <input
                                      type="text"
                                      value={stepItem.title}
                                      onChange={(e) =>
                                        updateStepItem({ title: e.target.value })
                                      }
                                      placeholder={v.stepItemTitlePlaceholder}
                                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-sm"
                                    />
                                    <input
                                      type="text"
                                      value={stepItem.detail}
                                      onChange={(e) =>
                                        updateStepItem({ detail: e.target.value })
                                      }
                                      placeholder={v.stepItemDetailPlaceholder}
                                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-secondary border border-border-subtle text-xs"
                                    />
                                  </div>

                                  <div className="flex flex-col gap-0.5 shrink-0">
                                    <button
                                      type="button"
                                      disabled={sIdx === 0}
                                      onClick={() => moveStepItem(-1)}
                                      aria-label={v.moveUp}
                                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer"
                                    >
                                      <IconArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={sIdx === block.items.length - 1}
                                      onClick={() => moveStepItem(1)}
                                      aria-label={v.moveDown}
                                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer"
                                    >
                                      <IconArrowDown className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={removeStepItem}
                                      aria-label={v.deleteBlock}
                                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer"
                                    >
                                      <IconTrash className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(idx, {
                                ...block,
                                items: [
                                  ...block.items,
                                  {
                                    id: createVisualId('st'),
                                    title: '',
                                    detail: '',
                                    defaultChecked: false,
                                  },
                                ],
                              })
                            }
                            className="min-h-8 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <IconPlus className="w-3.5 h-3.5" />
                            <span>{v.addStepItem}</span>
                          </button>
                        </div>
                      )}

                      {block.type === 'alert' && (
                        <div className="space-y-3">
                          {/* 1. Sticker Semantic Type (9 kinds) */}
                          <div
                            role="group"
                            aria-label={v.alertKindLabel}
                            className="flex flex-wrap gap-1.5"
                          >
                            {ALL_ALERT_KINDS.map((kind) => {
                              const active = block.kind === kind;
                              const presetTone =
                                block.tone || DEFAULT_ALERT_PRESET[kind].tone;
                              const tok = STICKER_TONE_TOKENS[presetTone];
                              return (
                                <button
                                  key={kind}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() =>
                                    updateBlock(idx, { ...block, kind })
                                  }
                                  className="min-h-7 px-2.5 py-0.5 rounded-full text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                                  style={
                                    active
                                      ? {
                                          backgroundColor: tok.badgeBg,
                                          color: tok.badgeFg,
                                          borderColor: tok.border,
                                        }
                                      : {
                                          backgroundColor: 'var(--surface-sheet)',
                                          color: 'var(--ink-muted)',
                                          borderColor: 'var(--border-subtle)',
                                        }
                                  }
                                >
                                  <span className="scale-90 inline-flex">
                                    {ALERT_DOODLE_ICONS[kind]}
                                  </span>
                                  <span>{copy.alertStamps[kind]}</span>
                                </button>
                              );
                            })}
                          </div>

                          {/* 2. Physical Sticker Silhouette + Paper Tone Swatches */}
                          <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl bg-surface-sheet border border-border-subtle">
                            <div
                              role="group"
                              aria-label={v.stickerStyleLabel}
                              className="flex flex-wrap items-center gap-1"
                            >
                              <button
                                type="button"
                                aria-pressed={block.style === ''}
                                onClick={() =>
                                  updateBlock(idx, { ...block, style: '' })
                                }
                                className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer transition-colors ${
                                  block.style === ''
                                    ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                                    : 'bg-surface-raised/60 text-ink-muted border-border-subtle hover:text-ink-primary'
                                }`}
                              >
                                {v.stickerAutoOption}
                              </button>
                              {ALL_STICKER_STYLES.map((st) => {
                                const active = block.style === st;
                                return (
                                  <button
                                    key={st}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() =>
                                      updateBlock(idx, { ...block, style: st })
                                    }
                                    className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer transition-colors ${
                                      active
                                        ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                                        : 'bg-surface-raised/60 text-ink-muted border-border-subtle hover:text-ink-primary'
                                    }`}
                                  >
                                    {copy.stickerStyles[st]}
                                  </button>
                                );
                              })}
                            </div>

                            <div
                              role="group"
                              aria-label={v.stickerToneLabel}
                              className="flex items-center gap-1.5"
                            >
                              <button
                                type="button"
                                aria-pressed={block.tone === ''}
                                onClick={() =>
                                  updateBlock(idx, { ...block, tone: '' })
                                }
                                className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer ${
                                  block.tone === ''
                                    ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                                    : 'bg-surface-raised/60 text-ink-muted border-border-subtle hover:text-ink-primary'
                                }`}
                              >
                                {v.stickerAutoOption}
                              </button>
                              {ALL_STICKER_TONES.map((t) => {
                                const cfg = STICKER_TONE_TOKENS[t];
                                const active = block.tone === t;
                                return (
                                  <button
                                    key={t}
                                    type="button"
                                    data-color-swatch=""
                                    aria-label={copy.stickyColorAria(
                                      copy.stickerTones[t],
                                    )}
                                    aria-pressed={active}
                                    onClick={() =>
                                      updateBlock(idx, { ...block, tone: t })
                                    }
                                    className={`w-6 h-6 rounded-full border-2 inline-flex items-center justify-center cursor-pointer transition-transform ${
                                      active
                                        ? 'scale-110 ring-2 ring-ink-primary ring-offset-1 ring-offset-surface-sheet'
                                        : ''
                                    }`}
                                    style={{
                                      backgroundColor: cfg.swatch,
                                      borderColor: 'var(--border-ink)',
                                      color: '#ffffff',
                                    }}
                                  >
                                    {active && <IconCheck className="w-3 h-3" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* 3. Title + Optional Custom Stamp Badge */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <div className="sm:col-span-9">
                              <input
                                type="text"
                                value={block.title}
                                onChange={(e) =>
                                  updateBlock(idx, {
                                    ...block,
                                    title: e.target.value,
                                  })
                                }
                                placeholder={v.alertTitlePlaceholder}
                                className="w-full px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <input
                                type="text"
                                maxLength={24}
                                value={block.badge}
                                onChange={(e) =>
                                  updateBlock(idx, {
                                    ...block,
                                    badge: e.target.value,
                                  })
                                }
                                aria-label={v.stickerBadgePlaceholder}
                                placeholder={
                                  copy.alertStamps[block.kind] ||
                                  v.stickerBadgePlaceholder
                                }
                                className="w-full px-2.5 py-2 rounded-xl bg-surface-sheet text-ink-secondary border border-border-subtle text-xs font-hand font-semibold"
                              />
                            </div>
                          </div>

                          <textarea
                            rows={Math.min(
                              8,
                              Math.max(2, block.body.split('\n').length + 1),
                            )}
                            value={block.body}
                            onChange={(e) =>
                              updateBlock(idx, { ...block, body: e.target.value })
                            }
                            placeholder={v.alertBodyPlaceholder}
                            className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm leading-relaxed ink-input-inset"
                          />

                          <div className="pt-1 border-t border-dashed border-border-subtle space-y-2">
                            <input
                              type="text"
                              value={block.detailSummary}
                              onChange={(e) =>
                                updateBlock(idx, {
                                  ...block,
                                  detailSummary: e.target.value,
                                })
                              }
                              placeholder={v.alertDetailSummaryPlaceholder}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-secondary border border-border-subtle text-xs"
                            />
                            {(block.detailSummary.trim() ||
                              block.detailBody.trim()) && (
                              <textarea
                                rows={2}
                                value={block.detailBody}
                                onChange={(e) =>
                                  updateBlock(idx, {
                                    ...block,
                                    detailBody: e.target.value,
                                  })
                                }
                                placeholder={v.alertDetailBodyPlaceholder}
                                className="w-full p-2.5 rounded-lg bg-surface-sheet text-ink-secondary border border-border-subtle text-xs leading-relaxed"
                              />
                            )}
                          </div>
                        </div>
                      )}

                      {block.type === 'code_card' && (
                        <div className="space-y-2.5">
                          {/* Notebook Code Sheet Style Selector */}
                          <div
                            role="group"
                            aria-label={v.codeStyleLabel}
                            className="flex flex-wrap gap-1.5"
                          >
                            {ALL_CODE_CARD_STYLES.map((st) => {
                              const active = block.style === st;
                              return (
                                <button
                                  key={st}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() =>
                                    updateBlock(idx, { ...block, style: st })
                                  }
                                  className={`min-h-7 px-2.5 py-0.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                                    active
                                      ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                                      : 'bg-surface-sheet text-ink-muted border-border-subtle hover:text-ink-primary'
                                  }`}
                                >
                                  {copy.codeCardStyles[st]}
                                </button>
                              );
                            })}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <div className="sm:col-span-4">
                              <input
                                type="text"
                                list={langListId}
                                value={block.language}
                                onChange={(e) =>
                                  updateBlock(idx, {
                                    ...block,
                                    language: e.target.value,
                                  })
                                }
                                aria-label={v.codeLangLabel}
                                placeholder="rust"
                                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-primary border border-border-subtle text-xs font-mono"
                              />
                            </div>
                            <div className="sm:col-span-8">
                              <input
                                type="text"
                                value={block.filename}
                                onChange={(e) =>
                                  updateBlock(idx, {
                                    ...block,
                                    filename: e.target.value,
                                  })
                                }
                                placeholder={v.codeFilePlaceholder}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-primary border border-border-subtle text-xs font-mono"
                              />
                            </div>
                          </div>

                          <textarea
                            rows={Math.min(
                              14,
                              Math.max(4, block.code.split('\n').length + 1),
                            )}
                            value={block.code}
                            onChange={(e) =>
                              updateBlock(idx, { ...block, code: e.target.value })
                            }
                            placeholder={v.codeBodyPlaceholder}
                            spellCheck={false}
                            className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle font-mono text-xs leading-relaxed ink-input-inset"
                          />

                          <AuthorMarginNoteInput
                            locale={locale}
                            rawValue={block.marginNote}
                            onChange={(nextRaw) =>
                              updateBlock(idx, { ...block, marginNote: nextRaw })
                            }
                          />
                        </div>
                      )}

                      {block.type === 'list' && (
                        <div className="space-y-2.5">
                          <div className="inline-flex rounded-lg p-0.5 bg-surface-sheet border border-border-subtle">
                            <button
                              type="button"
                              aria-pressed={!block.ordered}
                              onClick={() =>
                                updateBlock(idx, { ...block, ordered: false })
                              }
                              className={`min-h-7 px-2.5 py-0.5 rounded-md text-xs cursor-pointer ${
                                !block.ordered
                                  ? 'font-semibold bg-action-subtle text-link-ink'
                                  : 'text-ink-muted hover:text-ink-primary'
                              }`}
                            >
                              {v.listUnordered}
                            </button>
                            <button
                              type="button"
                              aria-pressed={block.ordered}
                              onClick={() =>
                                updateBlock(idx, { ...block, ordered: true })
                              }
                              className={`min-h-7 px-2.5 py-0.5 rounded-md text-xs cursor-pointer ${
                                block.ordered
                                  ? 'font-semibold bg-action-subtle text-link-ink'
                                  : 'text-ink-muted hover:text-ink-primary'
                              }`}
                            >
                              {v.listOrdered}
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            {block.items.map((itemText, lIdx) => (
                              <div
                                key={lIdx}
                                className="flex items-center gap-2"
                              >
                                <span className="font-mono text-xs text-link-ink w-5 text-end shrink-0 tabular-nums">
                                  {block.ordered ? `${lIdx + 1}.` : '✦'}
                                </span>
                                <input
                                  type="text"
                                  value={itemText}
                                  onChange={(e) => {
                                    const nextItems = block.items.map((it, i) =>
                                      i === lIdx ? e.target.value : it,
                                    );
                                    updateBlock(idx, {
                                      ...block,
                                      items: nextItems,
                                    });
                                  }}
                                  placeholder={v.listItemPlaceholder}
                                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-primary border border-border-subtle text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextItems = block.items.filter(
                                      (_, i) => i !== lIdx,
                                    );
                                    updateBlock(idx, {
                                      ...block,
                                      items:
                                        nextItems.length > 0 ? nextItems : [''],
                                    });
                                  }}
                                  aria-label={v.deleteBlock}
                                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-sheet cursor-pointer shrink-0"
                                >
                                  <IconTrash className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(idx, {
                                ...block,
                                items: [...block.items, ''],
                              })
                            }
                            className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <IconPlus className="w-3.5 h-3.5" />
                            <span>{v.addListItem}</span>
                          </button>
                        </div>
                      )}

                      {block.type === 'quote' && (
                        <textarea
                          rows={Math.min(
                            8,
                            Math.max(2, block.text.split('\n').length + 1),
                          )}
                          value={block.text}
                          onChange={(e) =>
                            updateBlock(idx, { ...block, text: e.target.value })
                          }
                          placeholder={v.quotePlaceholder}
                          className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm leading-relaxed ink-input-inset"
                          style={{ borderInlineStart: '4px solid var(--marker-h1)' }}
                        />
                      )}

                      {block.type === 'rough_diagram' && (
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={block.caption}
                            onChange={(e) =>
                              updateBlock(idx, {
                                ...block,
                                caption: e.target.value,
                              })
                            }
                            placeholder={v.diagramCaptionPlaceholder}
                            className="w-full px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
                          />

                          {/* Diagram Nodes Editor */}
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-ink-secondary">
                                {v.diagramNodesHeading}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const arranged = block.spec.nodes.map(
                                      (node, nIdx) => {
                                        const col = nIdx % 3;
                                        const row = Math.floor(nIdx / 3);
                                        return {
                                          ...node,
                                          x: 24 + col * 215,
                                          y: 32 + row * 108,
                                          width: node.width || 165,
                                          height: node.height || 62,
                                        };
                                      },
                                    );
                                    updateBlock(idx, {
                                      ...block,
                                      spec: { ...block.spec, nodes: arranged },
                                    });
                                  }}
                                  className="min-h-7 px-2.5 py-0.5 rounded-lg text-xs bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary cursor-pointer"
                                >
                                  {v.diagramAutoLayout}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nNum = block.spec.nodes.length + 1;
                                    const col = (nNum - 1) % 3;
                                    const row = Math.floor((nNum - 1) / 3);
                                    const nextNode: SketchNode = {
                                      id: `n${nNum}_${Date.now().toString(36).slice(-2)}`,
                                      label: `Node ${nNum}`,
                                      sublabel: '',
                                      x: 24 + col * 215,
                                      y: 32 + row * 108,
                                      width: 165,
                                      height: 62,
                                      tone: SKETCH_TONES[(nNum - 1) % SKETCH_TONES.length],
                                    };
                                    updateBlock(idx, {
                                      ...block,
                                      spec: {
                                        ...block.spec,
                                        nodes: [...block.spec.nodes, nextNode],
                                      },
                                    });
                                  }}
                                  className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink cursor-pointer"
                                >
                                  {v.diagramAddNode}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              {block.spec.nodes.map((node, nIdx) => {
                                const updateNode = (
                                  patch: Partial<SketchNode>,
                                ) => {
                                  const nextNodes = block.spec.nodes.map(
                                    (item, i) =>
                                      i === nIdx ? { ...item, ...patch } : item,
                                  );
                                  updateBlock(idx, {
                                    ...block,
                                    spec: { ...block.spec, nodes: nextNodes },
                                  });
                                };
                                return (
                                  <div
                                    key={node.id}
                                    className="p-2.5 rounded-xl bg-surface-sheet border border-border-subtle space-y-2"
                                  >
                                    {/* Row 1: Primary Label + Sublabel + Delete */}
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={node.label}
                                        onChange={(e) =>
                                          updateNode({ label: e.target.value })
                                        }
                                        placeholder={v.diagramNodeLabelPlaceholder}
                                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-semibold"
                                      />
                                      <input
                                        type="text"
                                        value={node.sublabel ?? ''}
                                        onChange={(e) =>
                                          updateNode({ sublabel: e.target.value })
                                        }
                                        placeholder={v.diagramNodeSubPlaceholder}
                                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-secondary border border-border-subtle text-xs"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const removedId = node.id;
                                          const nextNodes =
                                            block.spec.nodes.filter(
                                              (_, i) => i !== nIdx,
                                            );
                                          const nextEdges =
                                            block.spec.edges.filter(
                                              (ed) =>
                                                ed.from !== removedId &&
                                                ed.to !== removedId,
                                            );
                                          updateBlock(idx, {
                                            ...block,
                                            spec: {
                                              nodes: nextNodes,
                                              edges: nextEdges,
                                            },
                                          });
                                        }}
                                        aria-label={v.deleteBlock}
                                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer shrink-0"
                                      >
                                        <IconTrash className="w-3.5 h-3.5" />
                                      </button>
                                    </div>

                                    {/* Row 2: Uncrushed Tone Select + Labeled X / Y Coordinates (§3.4.1) */}
                                    <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-dashed border-border-subtle/70">
                                      <select
                                        value={node.tone}
                                        onChange={(e) =>
                                          updateNode({
                                            tone: e.target
                                              .value as SketchNode['tone'],
                                          })
                                        }
                                        aria-label="Tone"
                                        className="min-w-28 min-h-7 ps-2.5 pe-6 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono"
                                      >
                                        {SKETCH_TONES.map((tone) => (
                                          <option key={tone} value={tone}>
                                            {tone}
                                          </option>
                                        ))}
                                      </select>

                                      <label className="inline-flex items-center gap-1 text-xs font-mono text-ink-muted">
                                        <span>X</span>
                                        <input
                                          type="number"
                                          value={node.x}
                                          onChange={(e) =>
                                            updateNode({
                                              x: Number(e.target.value) || 0,
                                            })
                                          }
                                          className="w-20 min-h-7 px-2 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono tabular-nums"
                                        />
                                      </label>

                                      <label className="inline-flex items-center gap-1 text-xs font-mono text-ink-muted">
                                        <span>Y</span>
                                        <input
                                          type="number"
                                          value={node.y}
                                          onChange={(e) =>
                                            updateNode({
                                              y: Number(e.target.value) || 0,
                                            })
                                          }
                                          className="w-20 min-h-7 px-2 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono tabular-nums"
                                        />
                                      </label>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Diagram Edges Editor */}
                          <div className="space-y-2 pt-1 border-t border-dashed border-border-subtle">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-ink-secondary">
                                {v.diagramEdgesHeading}
                              </span>
                              <button
                                type="button"
                                disabled={block.spec.nodes.length < 2}
                                onClick={() => {
                                  const n0 = block.spec.nodes[0]?.id ?? '';
                                  const n1 =
                                    block.spec.nodes[1]?.id ?? n0;
                                  updateBlock(idx, {
                                    ...block,
                                    spec: {
                                      ...block.spec,
                                      edges: [
                                        ...block.spec.edges,
                                        { from: n0, to: n1, label: '' },
                                      ],
                                    },
                                  });
                                }}
                                className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink disabled:opacity-40 cursor-pointer"
                              >
                                {v.diagramAddEdge}
                              </button>
                            </div>

                            <div className="space-y-2">
                              {block.spec.edges.map((edge, eIdx) => (
                                <div
                                  key={eIdx}
                                  className="p-2.5 rounded-xl bg-surface-sheet border border-border-subtle space-y-2"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <select
                                      value={edge.from}
                                      onChange={(e) => {
                                        const nextEdges = block.spec.edges.map(
                                          (ed, i) =>
                                            i === eIdx
                                              ? { ...ed, from: e.target.value }
                                              : ed,
                                        );
                                        updateBlock(idx, {
                                          ...block,
                                          spec: { ...block.spec, edges: nextEdges },
                                        });
                                      }}
                                      className="flex-1 min-w-0 min-h-7 ps-2 pe-6 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                                    >
                                      {block.spec.nodes.map((n) => (
                                        <option key={n.id} value={n.id}>
                                          {n.label || n.id}
                                        </option>
                                      ))}
                                    </select>
                                    <span
                                      aria-hidden="true"
                                      className="text-xs font-mono text-ink-muted shrink-0"
                                    >
                                      →
                                    </span>
                                    <select
                                      value={edge.to}
                                      onChange={(e) => {
                                        const nextEdges = block.spec.edges.map(
                                          (ed, i) =>
                                            i === eIdx
                                              ? { ...ed, to: e.target.value }
                                              : ed,
                                        );
                                        updateBlock(idx, {
                                          ...block,
                                          spec: { ...block.spec, edges: nextEdges },
                                        });
                                      }}
                                      className="flex-1 min-w-0 min-h-7 ps-2 pe-6 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                                    >
                                      {block.spec.nodes.map((n) => (
                                        <option key={n.id} value={n.id}>
                                          {n.label || n.id}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={edge.label ?? ''}
                                      onChange={(e) => {
                                        const nextEdges = block.spec.edges.map(
                                          (ed, i) =>
                                            i === eIdx
                                              ? { ...ed, label: e.target.value }
                                              : ed,
                                        );
                                        updateBlock(idx, {
                                          ...block,
                                          spec: { ...block.spec, edges: nextEdges },
                                        });
                                      }}
                                      placeholder={v.diagramEdgeLabelPlaceholder}
                                      className="flex-1 min-w-0 min-h-7 px-2.5 py-1 rounded-lg bg-surface-raised text-ink-secondary border border-border-subtle text-xs"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextEdges = block.spec.edges.filter(
                                          (_, i) => i !== eIdx,
                                        );
                                        updateBlock(idx, {
                                          ...block,
                                          spec: { ...block.spec, edges: nextEdges },
                                        });
                                      }}
                                      aria-label={v.deleteBlock}
                                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer shrink-0"
                                    >
                                      <IconTrash className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {block.type === 'image' && (
                        <ImageBlockBody
                          block={block}
                          locale={locale}
                          onUpdate={(next) => updateBlock(idx, next)}
                        />
                      )}

                      {block.type === 'raw_markdown' && (
                        <textarea
                          rows={Math.min(
                            12,
                            Math.max(4, block.content.split('\n').length + 1),
                          )}
                          value={block.content}
                          onChange={(e) =>
                            updateBlock(idx, {
                              ...block,
                              content: e.target.value,
                            })
                          }
                          spellCheck={false}
                          className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle font-mono text-xs leading-relaxed ink-input-inset"
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Inline Insert-Below Quick Picker */}
                {showInsertPicker && (
                  <div className="ui-popover-enter origin-top rounded-xl p-2.5 bg-surface-sheet border border-dashed border-border-ink flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-ink-muted me-1">
                      {v.insertBelow}:
                    </span>
                    <button
                      type="button"
                      onClick={() => insertSectionTaskAt(idx)}
                      className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold bg-action-subtle text-link-ink border border-border-ink inline-flex items-center gap-1 cursor-pointer"
                    >
                      <IconCheckSquare className="w-3.5 h-3.5 text-link-ink" />
                      <span>{copy.taskScopeSection}</span>
                    </button>
                    {INSERTABLE_TYPES.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => insertBlockAt(idx, kind)}
                        className="min-h-7 px-2 py-0.5 rounded-lg text-xs bg-surface-raised hover:bg-action-subtle text-ink-primary border border-border-subtle inline-flex items-center gap-1 cursor-pointer"
                      >
                        {blockIcon(kind)}
                        <span>{kind === 'steps' ? copy.taskScopeParagraph : v.types[kind]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          });
          })()}
        </div>
      )}
    </div>
  );
}
