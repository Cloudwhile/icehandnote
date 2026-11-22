/*
 * Hand-Drawn Stationery WYSIWYG Flow Block Bodies (Text & Media):
 * - `ParagraphBlockBody`: Borderless writing directly on the paper, IME-safe `/` slash command menu,
 *   Markdown prefix auto-conversion (`## `, `> `, `- `, `1. `, `- [ ] `, ```), Enter split & Backspace merge,
 *   selection floating `<InlineFormatToolbar>`, and side `<InlineAuthorMarginSticky>`.
 * - `HeadingBlockBody`: Live typography + hand-drawn SVG marker underline + section task checkbox (`§`).
 * - `ImageBlockBody`: Clean drag/drop/upload stationery dropzone -> live framed `<figure>` + inline caption + margin sticky.
 * - `QuoteBlockBody` & `RawMarkdownBlockBody`.
 */

import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../../../lib/api';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { AlertKind, LocaleCode } from '../../../lib/types';
import { createVisualId, type VisualBlock } from '../../../lib/visualBlocks';
import { FileUploadButton } from '../../ui/FileUploadButton';
import { IconImage, IconPen } from '../../ui/Icons';
import { PopupMenu } from '../../ui/PopupMenu';
import { SegmentedControl } from '../../ui/Tabs';
import { useToast } from '../../ui/ToastProvider';
import {
  handleInlineFormatShortcut,
  InlineAuthorMarginSticky,
  InlineFormatToolbar,
  isImeComposing,
  useAutoResizeTextarea,
  wrapTextareaSelection,
} from './BlockFloatingControls';
import {
  createBlockFromSlashCommand,
  filterSlashCommands,
  type SlashCommandId,
  SlashCommandMenu,
} from './SlashCommandMenu';

export interface FlowBlockHandlers {
  onCommitAndInsertAfter: (
    updatedCurrent: VisualBlock,
    newAfterBlock: VisualBlock,
    caretPos?: number | 'start' | 'end',
  ) => void;
  onReplaceBlock: (
    nextBlock: VisualBlock,
    focus?: { caret?: number | 'start' | 'end'; itemIndex?: number },
  ) => void;
  onBackspaceAtStart: (remainingText: string) => void;
  onMoveFocusVertical: (direction: -1 | 1) => void;
  marginNoteOpen: boolean;
  onOpenMarginNote: () => void;
  onCloseMarginNote: () => void;
}

const HEADING_LEVEL_OPTIONS = [
  { value: 2 as const, label: 'H2' },
  { value: 3 as const, label: 'H3' },
  { value: 4 as const, label: 'H4' },
];

const SLASH_ALERT_MAP: Record<string, AlertKind> = {
  tip: 'tip',
  note: 'note',
  info: 'info',
  idea: 'idea',
  question: 'question',
  check: 'check',
  bookmark: 'bookmark',
  warning: 'warning',
  warn: 'warning',
  danger: 'danger',
};

function detectMarkdownPrefixBlock(
  blockId: string,
  value: string,
  caret: number,
): { block: VisualBlock; nextCaret: number } | null {
  if (value.includes('\n')) return null;

  let m = value.match(/^####\s(.*)$/);
  if (m) {
    return {
      block: { id: blockId, type: 'heading', level: 4, text: m[1], isTask: false, defaultChecked: false },
      nextCaret: Math.max(0, caret - 5),
    };
  }
  m = value.match(/^###\s(.*)$/);
  if (m) {
    return {
      block: { id: blockId, type: 'heading', level: 3, text: m[1], isTask: false, defaultChecked: false },
      nextCaret: Math.max(0, caret - 4),
    };
  }
  m = value.match(/^##\s+\[[ ]\]\s(.*)$/);
  if (m) {
    return {
      block: { id: blockId, type: 'heading', level: 2, text: m[1], isTask: true, defaultChecked: false },
      nextCaret: Math.max(0, caret - 7),
    };
  }
  m = value.match(/^##\s(.*)$/);
  if (m) {
    return {
      block: { id: blockId, type: 'heading', level: 2, text: m[1], isTask: false, defaultChecked: false },
      nextCaret: Math.max(0, caret - 3),
    };
  }
  m = value.match(/^(?:[-*]\s+)?\[[ ]\]\s(.*)$/);
  if (m) {
    return {
      block: {
        id: blockId,
        type: 'steps',
        title: '',
        scope: 'paragraph',
        items: [{ id: createVisualId('st'), title: m[1], detail: '', defaultChecked: false }],
      },
      nextCaret: 0,
    };
  }
  m = value.match(/^[-*]\s(.*)$/);
  if (m) {
    return {
      block: { id: blockId, type: 'list', ordered: false, items: [m[1]] },
      nextCaret: 0,
    };
  }
  m = value.match(/^1\.\s(.*)$/);
  if (m) {
    return {
      block: { id: blockId, type: 'list', ordered: true, items: [m[1]] },
      nextCaret: 0,
    };
  }
  m = value.match(/^>\s(.*)$/);
  if (m) {
    return {
      block: { id: blockId, type: 'quote', text: m[1] },
      nextCaret: Math.max(0, caret - 2),
    };
  }
  m = value.match(/^```([a-zA-Z0-9_-]*)\s$/);
  if (m) {
    return {
      block: {
        id: blockId,
        type: 'code_card',
        language: m[1] || 'text',
        filename: '',
        code: '',
        marginNote: '',
        style: 'washi',
      },
      nextCaret: 0,
    };
  }
  m = value.match(/^:::(tip|note|info|idea|question|check|bookmark|warning|warn|danger)\s(.*)$/i);
  if (m) {
    const kind = SLASH_ALERT_MAP[m[1].toLowerCase()] ?? 'tip';
    return {
      block: {
        id: blockId,
        type: 'alert',
        kind,
        title: '',
        body: m[2],
        detailSummary: '',
        detailBody: '',
        style: '',
        tone: '',
        badge: '',
      },
      nextCaret: 0,
    };
  }

  return null;
}

interface SlashMatch {
  query: string;
  tokenStart: number;
  tokenEnd: number;
  replaceWholeBlock: boolean;
}

function detectSlashMatch(value: string, caret: number): SlashMatch | null {
  const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const beforeCaretOnLine = value.slice(lineStart, caret);
  const m = beforeCaretOnLine.match(/^(?:(.*\s))?\/([^\s/]*)$/);
  if (!m) return null;
  const leading = m[1] ?? '';
  const query = m[2] ?? '';
  const tokenStart = lineStart + leading.length;
  const replaceWholeBlock =
    value.slice(0, tokenStart).trim().length === 0 &&
    value.slice(caret).trim().length === 0;
  return {
    query,
    tokenStart,
    tokenEnd: caret,
    replaceWholeBlock,
  };
}

export function ParagraphBlockBody({
  block,
  locale,
  index,
  totalBlocks,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'paragraph' }>;
  locale: LocaleCode;
  index: number;
  totalBlocks: number;
  onUpdate: (next: Extract<VisualBlock, { type: 'paragraph' }>) => void;
  flow: FlowBlockHandlers;
}) {
  const extFlow = EXT_COPY[locale].studio.flowEditor;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const lastCompEndRef = useRef<number | null>(null);

  const [focused, setFocused] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissedValue, setSlashDismissedValue] = useState<string | null>(null);
  const [caretSnapshot, setCaretSnapshot] = useState<number>(0);

  useAutoResizeTextarea(taRef, block.text);

  const slashMatch = useMemo(() => {
    if (!focused || isComposingRef.current || slashDismissedValue === block.text) {
      return null;
    }
    return detectSlashMatch(block.text, caretSnapshot);
  }, [focused, slashDismissedValue, block.text, caretSnapshot]);

  const slashCommands = useMemo(
    () => (slashMatch ? filterSlashCommands(slashMatch.query, locale) : []),
    [slashMatch, locale],
  );
  const slashOpen = Boolean(slashMatch);
  const clampedSlashIdx =
    slashCommands.length > 0 ? Math.min(slashIndex, slashCommands.length - 1) : 0;

  const syncCaretAndSelection = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    setCaretSnapshot(el.selectionStart ?? el.value.length);
    setHasSelection((el.selectionEnd ?? 0) > (el.selectionStart ?? 0));
  };

  const applySlashCommand = (cmdId: SlashCommandId) => {
    if (!slashMatch) return;
    const created = createBlockFromSlashCommand(cmdId);
    setSlashIndex(0);
    setSlashDismissedValue(null);
    if (slashMatch.replaceWholeBlock) {
      flow.onReplaceBlock(
        { ...created, id: block.id },
        { caret: 'start', itemIndex: 0 },
      );
      return;
    }
    const stripped = (
      block.text.slice(0, slashMatch.tokenStart) +
      block.text.slice(slashMatch.tokenEnd)
    ).trimEnd();
    flow.onCommitAndInsertAfter({ ...block, text: stripped }, created, 'start');
  };

  const applyPrefixOrUpdate = (nextValue: string, caretPos: number, composing: boolean) => {
    setCaretSnapshot(caretPos);
    if (slashDismissedValue !== null && slashDismissedValue !== nextValue) {
      setSlashDismissedValue(null);
    }
    setSlashIndex(0);

    if (!composing) {
      const converted = detectMarkdownPrefixBlock(block.id, nextValue, caretPos);
      if (converted) {
        flow.onReplaceBlock(converted.block, {
          caret: converted.nextCaret,
          itemIndex: 0,
        });
        return;
      }
    }

    onUpdate({ ...block, text: nextValue });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposing(e, lastCompEndRef.current)) {
      return;
    }

    if (slashOpen) {
      if (e.key === 'ArrowDown' && slashCommands.length > 0) {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp' && slashCommands.length > 0) {
        e.preventDefault();
        setSlashIndex(
          (i) => (i - 1 + slashCommands.length) % slashCommands.length,
        );
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && slashCommands.length > 0) {
        e.preventDefault();
        applySlashCommand(slashCommands[clampedSlashIdx].id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissedValue(block.text);
        return;
      }
    }

    if (
      handleInlineFormatShortcut(e, block.text, (nextVal) =>
        onUpdate({ ...block, text: nextVal }),
      )
    ) {
      return;
    }

    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    if (e.key === 'Enter' && !e.shiftKey) {
      const fenced = block.text.match(/^```([a-zA-Z0-9_-]*)$/);
      if (fenced) {
        e.preventDefault();
        flow.onReplaceBlock(
          {
            id: block.id,
            type: 'code_card',
            language: fenced[1] || 'text',
            filename: '',
            code: '',
            marginNote: block.marginNote,
            style: 'washi',
          },
          { caret: 0 },
        );
        return;
      }

      e.preventDefault();
      const head = block.text.slice(0, start);
      const tail = block.text.slice(end);
      flow.onCommitAndInsertAfter(
        { ...block, text: head },
        { id: createVisualId(), type: 'paragraph', text: tail, marginNote: '' },
        0,
      );
      return;
    }

    if (e.key === 'Backspace' && start === 0 && end === 0) {
      e.preventDefault();
      flow.onBackspaceAtStart(block.text);
      return;
    }

    if (e.key === 'ArrowUp' && start === 0 && end === 0) {
      e.preventDefault();
      flow.onMoveFocusVertical(-1);
      return;
    }

    if (
      e.key === 'ArrowDown' &&
      start === block.text.length &&
      end === block.text.length
    ) {
      e.preventDefault();
      flow.onMoveFocusVertical(1);
    }
  };

  const placeholder =
    index === 0 && totalBlocks === 1
      ? extFlow.firstParagraphPlaceholder
      : focused
        ? extFlow.slashPlaceholder
        : '';

  const showMarginSticky = Boolean(block.marginNote.trim()) || flow.marginNoteOpen;

  return (
    <div
      className={`relative ${
        showMarginSticky
          ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_210px] xl:gap-5 items-start'
          : ''
      }`}
    >
      <div className="relative min-w-0">
        {hasSelection && focused && !slashOpen && (
          <div className="mb-1.5 sm:mb-0 sm:absolute sm:-top-10 sm:start-0 sm:z-20">
            <InlineFormatToolbar
              locale={locale}
              onBold={() =>
                wrapTextareaSelection(
                  taRef.current,
                  block.text,
                  '**',
                  '**',
                  'text',
                  (next) => onUpdate({ ...block, text: next }),
                )
              }
              onItalic={() =>
                wrapTextareaSelection(
                  taRef.current,
                  block.text,
                  '*',
                  '*',
                  'text',
                  (next) => onUpdate({ ...block, text: next }),
                )
              }
              onCode={() =>
                wrapTextareaSelection(
                  taRef.current,
                  block.text,
                  '`',
                  '`',
                  'code',
                  (next) => onUpdate({ ...block, text: next }),
                )
              }
              onLink={() =>
                wrapTextareaSelection(
                  taRef.current,
                  block.text,
                  '[',
                  '](https://)',
                  'label',
                  (next) => onUpdate({ ...block, text: next }),
                )
              }
            />
          </div>
        )}

        <textarea
          ref={taRef}
          data-flow-input="primary"
          rows={1}
          value={block.text}
          onFocus={(e) => {
            setFocused(true);
            syncCaretAndSelection(e.currentTarget);
          }}
          onBlur={() => {
            setFocused(false);
            setHasSelection(false);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            lastCompEndRef.current = e.timeStamp;
            const target = e.currentTarget;
            applyPrefixOrUpdate(
              target.value,
              target.selectionStart ?? target.value.length,
              false,
            );
          }}
          onChange={(e) => {
            const target = e.currentTarget;
            applyPrefixOrUpdate(
              target.value,
              target.selectionStart ?? target.value.length,
              isComposingRef.current ||
                Boolean(
                  (e.nativeEvent as { isComposing?: boolean }).isComposing,
                ),
            );
          }}
          onSelect={(e) => syncCaretAndSelection(e.currentTarget)}
          onKeyUp={(e) => syncCaretAndSelection(e.currentTarget)}
          onMouseUp={(e) => syncCaretAndSelection(e.currentTarget)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flow-editor-textarea text-base text-ink-primary leading-[1.72] placeholder:text-ink-muted/65"
        />

        <SlashCommandMenu
          locale={locale}
          open={slashOpen}
          anchorEl={taRef.current}
          commands={slashCommands}
          activeIndex={clampedSlashIdx}
          onSelect={applySlashCommand}
          onDismiss={() => setSlashDismissedValue(block.text)}
        />
      </div>

      {showMarginSticky && (
        <div className="mt-3 xl:mt-0">
          <InlineAuthorMarginSticky
            locale={locale}
            rawValue={block.marginNote}
            onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
            onRemove={() => {
              onUpdate({ ...block, marginNote: '' });
              flow.onCloseMarginNote();
            }}
          />
        </div>
      )}
    </div>
  );
}

export function HeadingBlockBody({
  block,
  locale,
  sectionNumber,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'heading' }>;
  locale: LocaleCode;
  sectionNumber: number;
  onUpdate: (next: Extract<VisualBlock, { type: 'heading' }>) => void;
  flow: FlowBlockHandlers;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const lastCompEndRef = useRef<number | null>(null);

  const markerVar = block.isTask && block.defaultChecked
    ? 'var(--accent-success-ink)'
    : block.level === 2
      ? 'var(--marker-h2)'
      : block.level === 3
        ? 'var(--marker-h3)'
        : 'var(--marker-h4)';

  const sizeClass =
    block.level === 2
      ? 'text-xl sm:text-2xl'
      : block.level === 3
        ? 'text-lg sm:text-xl'
        : 'text-base sm:text-lg';

  return (
    <div className="pt-2 pb-1 space-y-1">
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-48 sm:min-w-0">
          {block.isTask && (
            <input
              type="checkbox"
              aria-label={v.defaultCheckedTitle}
              title={v.defaultCheckedTitle}
              checked={Boolean(block.defaultChecked)}
              onChange={(e) =>
                onUpdate({ ...block, defaultChecked: e.target.checked })
              }
              className="notebook-step-checkbox mt-0!"
            />
          )}

          <span
            className={`font-mono text-xs font-semibold px-1.5 py-0.5 rounded-lg shrink-0 ${
              block.isTask
                ? 'bg-action-subtle text-link-ink'
                : 'bg-surface-sunken text-ink-muted'
            }`}
          >
            §{sectionNumber}
          </span>

          <input
            type="text"
            size={1}
            data-flow-input="primary"
            value={block.text}
            onCompositionEnd={(e) => {
              lastCompEndRef.current = e.timeStamp;
            }}
            onChange={(e) => {
              const val = e.target.value;
              if (!block.isTask && val.startsWith('[ ] ')) {
                onUpdate({
                  ...block,
                  isTask: true,
                  defaultChecked: false,
                  text: val.slice(4),
                });
                return;
              }
              onUpdate({ ...block, text: val });
            }}
            onKeyDown={(e) => {
              if (isImeComposing(e, lastCompEndRef.current)) return;
              const start = e.currentTarget.selectionStart ?? 0;
              const end = e.currentTarget.selectionEnd ?? 0;

              if (e.key === 'Enter') {
                e.preventDefault();
                const head = block.text.slice(0, start);
                const tail = block.text.slice(end);
                flow.onCommitAndInsertAfter(
                  { ...block, text: head },
                  {
                    id: createVisualId(),
                    type: 'paragraph',
                    text: tail,
                    marginNote: '',
                  },
                  0,
                );
                return;
              }

              if (e.key === 'Backspace' && start === 0 && end === 0) {
                e.preventDefault();
                if (block.isTask) {
                  onUpdate({ ...block, isTask: false, defaultChecked: false });
                } else {
                  flow.onReplaceBlock(
                    {
                      id: block.id,
                      type: 'paragraph',
                      text: block.text,
                      marginNote: '',
                    },
                    { caret: 0 },
                  );
                }
                return;
              }

              if (e.key === 'ArrowUp' && start === 0) {
                e.preventDefault();
                flow.onMoveFocusVertical(-1);
                return;
              }
              if (e.key === 'ArrowDown' && start === block.text.length) {
                e.preventDefault();
                flow.onMoveFocusVertical(1);
              }
            }}
            placeholder={v.headingPlaceholder}
            style={{ fontFamily: 'var(--font-hand)' }}
            className={`w-full flex-1 min-w-0 bg-transparent border-0 p-0 font-semibold text-ink-primary placeholder:text-ink-muted/60 focus:outline-none leading-snug ${sizeClass}`}
          />
        </div>

        <div className="flow-hover-controls flex items-center gap-1.5 shrink-0">
          <SegmentedControl
            options={HEADING_LEVEL_OPTIONS}
            value={block.level}
            onChange={(lvl) => onUpdate({ ...block, level: lvl })}
            ariaLabel={v.types.heading}
            surface="sheet"
            className="font-mono"
          />
          <button
            type="button"
            aria-pressed={Boolean(block.isTask)}
            onClick={() =>
              onUpdate({
                ...block,
                isTask: !block.isTask,
                defaultChecked: !block.isTask
                  ? Boolean(block.defaultChecked)
                  : false,
              })
            }
            className={`min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors whitespace-nowrap ${
              block.isTask
                ? 'bg-action-subtle text-link-ink border-action-bg'
                : 'bg-surface-raised text-ink-muted border-border-subtle hover:text-ink-primary'
            }`}
          >
            {copy.taskScopeSection}
          </button>
        </div>
      </div>

      {/* Matching hand-drawn marker underline (`SketchHeading` style) */}
      <svg
        aria-hidden="true"
        className="h-2.5 w-52 max-w-full block pointer-events-none"
        viewBox="0 0 220 11"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d="M3 6.2 C 58 2.8, 118 7.6, 172 4.5 C 192 3.2, 206 6.8, 217 6.2"
          stroke={markerVar}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function ImageBlockBody({
  block,
  locale,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'image' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'image' }>) => void;
  flow: FlowBlockHandlers;
}) {
  const v = UI_COPY[locale].studio.visual;
  const extStudio = EXT_COPY[locale].studio;
  const extFlow = extStudio.flowEditor;
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showUrlField, setShowUrlField] = useState(false);

  const handleSelectFile = async (file: File) => {
    if (uploading) return;
    setUploading(true);
    try {
      const uploaded = await api.uploadStudioMedia(file);
      onUpdate({
        ...block,
        src: uploaded.url,
        alt: block.alt || file.name.replace(/\.[^.]+$/, ''),
      });
      toast.success(extStudio.imageUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleDropFile = (e: ReactDragEvent<HTMLDivElement>) => {
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      void handleSelectFile(file);
    }
  };

  const showMarginSticky = Boolean(block.marginNote.trim()) || flow.marginNoteOpen;

  if (!block.src.trim()) {
    return (
      <div
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDropFile}
        className={`rounded-2xl p-5 border-2 border-dashed transition-colors text-center space-y-3 ${
          dragOver
            ? 'border-action-bg bg-action-subtle/40'
            : 'border-border-subtle bg-surface-raised/60 hover:border-border-ink'
        }`}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <FileUploadButton
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon,image/svg+xml"
            uploading={uploading}
            label={v.imageUploadBtn}
            uploadingLabel={v.imageUploading}
            onSelectFile={(file) => void handleSelectFile(file)}
          />

          <button
            type="button"
            onClick={() => setShowUrlField((prev) => !prev)}
            className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary inline-flex items-center gap-1.5 cursor-pointer"
          >
            <IconImage className="w-3.5 h-3.5 text-ink-muted" />
            <span>{extFlow.pasteImageUrlBtn}</span>
          </button>
        </div>

        <p className="text-xs text-ink-muted m-0">{extFlow.emptyImageDropHint}</p>

        {showUrlField && (
          <input
            type="text"
            data-flow-input="primary"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
            aria-label={v.imageUrlLabel}
            value={block.src}
            onChange={(e) => onUpdate({ ...block, src: e.target.value })}
            placeholder={v.imageUrlPlaceholder}
            className="w-full max-w-md mx-auto block px-3 py-1.5 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={
        showMarginSticky
          ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_210px] xl:gap-5 items-start'
          : ''
      }
    >
      <figure
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDropFile}
        className={`relative my-1 mx-0 w-full rounded-2xl overflow-hidden border-2 bg-surface-raised transition-colors ${
          dragOver ? 'border-action-bg' : 'border-border-ink'
        }`}
      >
        <div className="flow-hover-controls absolute top-2.5 end-2.5 z-10 flex items-center gap-1.5">
          <FileUploadButton
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon,image/svg+xml"
            uploading={uploading}
            label={extFlow.changeImageBtn}
            uploadingLabel={v.imageUploading}
            buttonClassName="min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet/95 border border-border-ink/40 hover:border-border-ink text-ink-primary inline-flex items-center gap-1 cursor-pointer shadow-xs"
            onSelectFile={(file) => void handleSelectFile(file)}
          />

          <PopupMenu
            variant="panel"
            align="end"
            showChevron={false}
            triggerAriaLabel={v.imageAltLabel}
            triggerClassName="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet/95 border border-border-ink/40 hover:border-border-ink text-ink-primary shadow-xs"
            triggerLabel={<span>{extFlow.stylePopoverBtn}</span>}
          >
            {({ close }) => (
              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="block mb-1 font-semibold text-ink-secondary">
                    {v.imageUrlLabel}
                  </label>
                  <input
                    type="text"
                    spellCheck={false}
                    value={block.src}
                    onChange={(e) => onUpdate({ ...block, src: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-ink-secondary">
                    {v.imageAltLabel}
                  </label>
                  <input
                    type="text"
                    value={block.alt}
                    onChange={(e) => onUpdate({ ...block, alt: e.target.value })}
                    placeholder={v.imageAltLabel}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    flow.onOpenMarginNote();
                    close(true);
                  }}
                  className="w-full min-h-8 px-2.5 py-1 rounded-lg font-semibold bg-surface-raised hover:bg-action-subtle text-ink-primary border border-border-subtle inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <IconPen className="w-3.5 h-3.5 text-ink-muted" />
                  <span>{extFlow.addMarginBtn}</span>
                </button>
              </div>
            )}
          </PopupMenu>
        </div>

        <img
          src={block.src}
          alt={block.alt}
          loading="lazy"
          className="w-full h-auto max-h-[26rem] object-contain mx-auto block"
        />

        <figcaption className="px-4 py-2 border-t border-dashed border-border-subtle bg-surface-sheet">
          <input
            type="text"
            size={1}
            data-flow-input="primary"
            value={block.caption}
            onChange={(e) => onUpdate({ ...block, caption: e.target.value })}
            placeholder={v.imageCaptionLabel}
            className="w-full min-w-0 bg-transparent border-0 p-0 text-center text-xs text-ink-muted placeholder:text-ink-muted/65 focus:outline-none"
          />
        </figcaption>
      </figure>

      {showMarginSticky && (
        <div className="mt-3 xl:mt-0">
          <InlineAuthorMarginSticky
            locale={locale}
            rawValue={block.marginNote}
            onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
            onRemove={() => {
              onUpdate({ ...block, marginNote: '' });
              flow.onCloseMarginNote();
            }}
          />
        </div>
      )}
    </div>
  );
}

export function QuoteBlockBody({
  block,
  locale,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'quote' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'quote' }>) => void;
  flow: FlowBlockHandlers;
}) {
  const v = UI_COPY[locale].studio.visual;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const lastCompEndRef = useRef<number | null>(null);
  useAutoResizeTextarea(taRef, block.text);

  return (
    <blockquote className="m-0 border-s-4 border-action-bg bg-surface-raised/55 rounded-e-xl ps-4 pe-3 py-2.5">
      <textarea
        ref={taRef}
        data-flow-input="primary"
        rows={1}
        value={block.text}
        onCompositionEnd={(e) => {
          lastCompEndRef.current = e.timeStamp;
        }}
        onChange={(e) => onUpdate({ ...block, text: e.target.value })}
        onKeyDown={(e) => {
          if (isImeComposing(e, lastCompEndRef.current)) return;
          const start = e.currentTarget.selectionStart ?? 0;
          const end = e.currentTarget.selectionEnd ?? 0;

          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            start === block.text.length &&
            block.text.endsWith('\n')
          ) {
            e.preventDefault();
            flow.onCommitAndInsertAfter(
              { ...block, text: block.text.replace(/\n+$/, '') },
              {
                id: createVisualId(),
                type: 'paragraph',
                text: '',
                marginNote: '',
              },
              0,
            );
            return;
          }

          if (e.key === 'Backspace' && start === 0 && end === 0) {
            e.preventDefault();
            flow.onReplaceBlock(
              {
                id: block.id,
                type: 'paragraph',
                text: block.text,
                marginNote: '',
              },
              { caret: 0 },
            );
            return;
          }

          if (e.key === 'ArrowUp' && start === 0) {
            e.preventDefault();
            flow.onMoveFocusVertical(-1);
          } else if (e.key === 'ArrowDown' && start === block.text.length) {
            e.preventDefault();
            flow.onMoveFocusVertical(1);
          }
        }}
        placeholder={v.quotePlaceholder}
        style={{ fontFamily: 'var(--font-hand)' }}
        className="flow-editor-textarea text-base sm:text-lg leading-relaxed text-ink-primary placeholder:text-ink-muted/60"
      />
    </blockquote>
  );
}

export function RawMarkdownBlockBody({
  block,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'raw_markdown' }>;
  onUpdate: (next: Extract<VisualBlock, { type: 'raw_markdown' }>) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoResizeTextarea(taRef, block.content);

  return (
    <div className="rounded-xl p-3 bg-surface-raised border border-border-subtle">
      <textarea
        ref={taRef}
        data-flow-input="primary"
        rows={3}
        value={block.content}
        onChange={(e) => onUpdate({ ...block, content: e.target.value })}
        spellCheck={false}
        className="flow-editor-textarea font-mono text-xs leading-relaxed text-ink-primary"
      />
    </div>
  );
}
