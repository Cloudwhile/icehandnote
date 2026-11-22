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
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../../../lib/api';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import {
  blockAlignClass,
  blockSizeClass,
  editorDomToInlineMarkdown,
} from '../../../lib/richInline';
import type { AlertKind, LocaleCode } from '../../../lib/types';
import { createVisualId, type VisualBlock } from '../../../lib/visualBlocks';
import { FileUploadButton } from '../../ui/FileUploadButton';
import { IconImage, IconPen } from '../../ui/Icons';
import { PopupMenu } from '../../ui/PopupMenu';
import { SegmentedControl } from '../../ui/Tabs';
import { useToast } from '../../ui/ToastProvider';
import {
  InlineAuthorMarginSticky,
  useAutoResizeTextarea,
} from './BlockFloatingControls';
import {
  RichEditable,
  type RichSelectionReport,
} from './RichEditable';
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
  onSelectionReport?: (report: RichSelectionReport | null) => void;
  onOpenKbdComposer?: (blockId: string, el: HTMLElement) => void;
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

function detectSlashMatch(
  textBeforeCaret: string,
  plainFullText: string,
  hasRichAtomicNodes: boolean,
): SlashMatch | null {
  const caret = textBeforeCaret.length;
  const lineStart = textBeforeCaret.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const beforeCaretOnLine = textBeforeCaret.slice(lineStart, caret);
  const m = beforeCaretOnLine.match(/^(?:(.*\s))?\/([^\s/]*)$/);
  if (!m) return null;
  const leading = m[1] ?? '';
  const query = m[2] ?? '';
  const tokenStart = lineStart + leading.length;
  const replaceWholeBlock =
    !hasRichAtomicNodes && plainFullText.trim() === `/${query}`;
  return {
    query,
    tokenStart,
    tokenEnd: caret,
    replaceWholeBlock,
  };
}

function stripSlashTokenAtRange(
  root: HTMLElement,
  tokenStart: number,
  tokenEnd: number,
): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;

  let cur = walker.nextNode();
  while (cur) {
    const txt = cur as Text;
    if (!txt.parentElement?.closest('[contenteditable="false"]')) {
      const raw = txt.textContent ?? '';
      // Map linear non-ZWS character count back to raw DOM offset cleanly
      const visibleIndices: number[] = [];
      for (let i = 0; i < raw.length; i += 1) {
        if (raw[i] !== '\u200B') visibleIndices.push(i);
      }
      const len = visibleIndices.length;
      if (!startNode && acc + len >= tokenStart) {
        startNode = txt;
        const rel = tokenStart - acc;
        startOff = rel >= len ? raw.length : visibleIndices[Math.max(0, rel)];
      }
      if (startNode && acc + len >= tokenEnd) {
        endNode = txt;
        const rel = tokenEnd - acc;
        endOff = rel >= len ? raw.length : visibleIndices[Math.max(0, rel)];
        break;
      }
      acc += len;
    }
    cur = walker.nextNode();
  }

  if (startNode && endNode) {
    const delRange = document.createRange();
    delRange.setStart(startNode, startOff);
    delRange.setEnd(endNode, endOff);
    delRange.deleteContents();
    delRange.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(delRange);
    }
  }
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
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [focused, setFocused] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissedValue, setSlashDismissedValue] = useState<string | null>(null);
  const [caretSnap, setCaretSnap] = useState<{
    textBeforeCaret: string;
    plainFullText: string;
    el: HTMLElement | null;
  }>({
    textBeforeCaret: '',
    plainFullText: '',
    el: null,
  });

  const slashMatch = useMemo(() => {
    if (!focused || slashDismissedValue === block.text) {
      return null;
    }
    return detectSlashMatch(
      caretSnap.textBeforeCaret,
      caretSnap.plainFullText,
      Boolean(caretSnap.el?.querySelector('kbd,code,img')),
    );
  }, [focused, slashDismissedValue, block.text, caretSnap]);

  const slashCommands = useMemo(
    () => (slashMatch ? filterSlashCommands(slashMatch.query, locale) : []),
    [slashMatch, locale],
  );
  const slashOpen = Boolean(slashMatch);
  const clampedSlashIdx =
    slashCommands.length > 0 ? Math.min(slashIndex, slashCommands.length - 1) : 0;

  const applySlashCommand = (cmdId: SlashCommandId) => {
    if (!slashMatch) return;
    setSlashIndex(0);
    setSlashDismissedValue(null);

    let strippedMd = block.text;
    const richEl = caretSnap.el;
    if (richEl && richEl.isConnected) {
      stripSlashTokenAtRange(richEl, slashMatch.tokenStart, slashMatch.tokenEnd);
      strippedMd = editorDomToInlineMarkdown(richEl, true).trimEnd();
    } else {
      const esc = slashMatch.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      strippedMd = block.text.replace(new RegExp(`/${esc}$`), '').trimEnd();
    }

    if (cmdId === 'kbd_shortcut') {
      if (richEl && richEl.isConnected) {
        richEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
        flow.onOpenKbdComposer?.(block.id, richEl);
      } else {
        onUpdate({ ...block, text: strippedMd });
      }
      return;
    }

    const created = createBlockFromSlashCommand(cmdId);
    if (slashMatch.replaceWholeBlock) {
      flow.onReplaceBlock(
        { ...created, id: block.id },
        { caret: 'start', itemIndex: 0 },
      );
      return;
    }
    flow.onCommitAndInsertAfter({ ...block, text: strippedMd }, created, 'start');
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
      <div ref={wrapRef} className="relative min-w-0">
        <RichEditable
          blockId={block.id}
          value={block.text}
          multiline={true}
          flowInputRole="primary"
          placeholder={placeholder}
          onChange={(nextVal) => {
            if (slashDismissedValue !== null && slashDismissedValue !== nextVal) {
              setSlashDismissedValue(null);
            }
            setSlashIndex(0);
            onUpdate({ ...block, text: nextVal });
          }}
          onPrefixTransform={(plain, caretPos) => {
            const converted = detectMarkdownPrefixBlock(block.id, plain, caretPos);
            if (!converted) return false;
            flow.onReplaceBlock(converted.block, {
              caret: converted.nextCaret,
              itemIndex: 0,
            });
            return true;
          }}
          onSelectionReport={flow.onSelectionReport}
          onCaretSnapshot={(ctx) => {
            setCaretSnap({
              textBeforeCaret: ctx.textBeforeCaret,
              plainFullText: (ctx.el.textContent ?? '').replace(/\u200B/g, ''),
              el: ctx.el,
            });
          }}
          onFocusField={() => setFocused(true)}
          onBlurField={() => setFocused(false)}
          onEnterKey={(e, { beforeMd, afterMd }) => {
            if (slashOpen && slashCommands.length > 0) {
              e.preventDefault();
              applySlashCommand(slashCommands[clampedSlashIdx].id);
              return true;
            }
            const fenced = block.text.trim().match(/^```([a-zA-Z0-9_-]*)$/);
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
              return true;
            }
            e.preventDefault();
            flow.onCommitAndInsertAfter(
              { ...block, text: beforeMd },
              {
                id: createVisualId(),
                type: 'paragraph',
                text: afterMd,
                marginNote: '',
                ...(block.align ? { align: block.align } : {}),
                ...(block.size ? { size: block.size } : {}),
              },
              0,
            );
            return true;
          }}
          onBackspaceAtStart={(remainingMd) => {
            flow.onBackspaceAtStart(remainingMd);
            return true;
          }}
          onMoveVertical={
            slashOpen
              ? undefined
              : (dir) => {
                  flow.onMoveFocusVertical(dir);
                  return true;
                }
          }
          onArrowNavKey={(e) => {
            if (!slashOpen) return false;
            if (e.key === 'ArrowDown' && slashCommands.length > 0) {
              e.preventDefault();
              setSlashIndex((i) => (i + 1) % slashCommands.length);
              return true;
            }
            if (e.key === 'ArrowUp' && slashCommands.length > 0) {
              e.preventDefault();
              setSlashIndex(
                (i) => (i - 1 + slashCommands.length) % slashCommands.length,
              );
              return true;
            }
            if (e.key === 'Tab' && slashCommands.length > 0) {
              e.preventDefault();
              applySlashCommand(slashCommands[clampedSlashIdx].id);
              return true;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setSlashDismissedValue(block.text);
              return true;
            }
            return false;
          }}
          className={`text-base text-ink-primary leading-[1.72] ${blockAlignClass(block.align)} ${blockSizeClass(block.size)}`.trim()}
        />

        <SlashCommandMenu
          locale={locale}
          open={slashOpen}
          anchorEl={wrapRef.current}
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
    <div className={`pt-2 pb-1 space-y-1 ${blockAlignClass(block.align)}`.trim()}>
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

          <RichEditable
            blockId={block.id}
            value={block.text}
            multiline={false}
            flowInputRole="primary"
            placeholder={v.headingPlaceholder}
            onChange={(val) => onUpdate({ ...block, text: val })}
            onPrefixTransform={(plain) => {
              if (!block.isTask && plain.startsWith('[ ] ')) {
                onUpdate({
                  ...block,
                  isTask: true,
                  defaultChecked: false,
                  text: plain.slice(4),
                });
                return true;
              }
              return false;
            }}
            onSelectionReport={flow.onSelectionReport}
            onEnterKey={(e, { beforeMd, afterMd }) => {
              e.preventDefault();
              flow.onCommitAndInsertAfter(
                { ...block, text: beforeMd },
                {
                  id: createVisualId(),
                  type: 'paragraph',
                  text: afterMd,
                  marginNote: '',
                },
                0,
              );
              return true;
            }}
            onBackspaceAtStart={(remainingMd) => {
              if (block.isTask) {
                onUpdate({ ...block, isTask: false, defaultChecked: false });
              } else {
                flow.onReplaceBlock(
                  {
                    id: block.id,
                    type: 'paragraph',
                    text: remainingMd,
                    marginNote: '',
                  },
                  { caret: 0 },
                );
              }
              return true;
            }}
            onMoveVertical={(dir) => {
              flow.onMoveFocusVertical(dir);
              return true;
            }}
            className={`w-full flex-1 min-w-0 font-hand font-semibold text-ink-primary leading-snug ${sizeClass} ${blockAlignClass(block.align)}`.trim()}
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
        className={`h-2.5 w-52 max-w-full block pointer-events-none ${
          block.align === 'center'
            ? 'mx-auto'
            : block.align === 'right'
              ? 'ms-auto'
              : ''
        }`}
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

  return (
    <blockquote
      className={`m-0 border-s-4 border-action-bg bg-surface-raised/55 rounded-e-xl ps-4 pe-3 py-2.5 ${blockAlignClass(block.align)} ${blockSizeClass(block.size)}`.trim()}
    >
      <RichEditable
        blockId={block.id}
        value={block.text}
        multiline={true}
        flowInputRole="primary"
        placeholder={v.quotePlaceholder}
        onChange={(val) => onUpdate({ ...block, text: val })}
        onSelectionReport={flow.onSelectionReport}
        onEnterKey={(e, { beforeMd, afterMd }) => {
          e.preventDefault();
          flow.onCommitAndInsertAfter(
            { ...block, text: beforeMd.replace(/\n+$/, '') },
            {
              id: createVisualId(),
              type: 'paragraph',
              text: afterMd,
              marginNote: '',
            },
            0,
          );
          return true;
        }}
        onBackspaceAtStart={(remainingMd) => {
          flow.onReplaceBlock(
            {
              id: block.id,
              type: 'paragraph',
              text: remainingMd,
              marginNote: '',
            },
            { caret: 0 },
          );
          return true;
        }}
        onMoveVertical={(dir) => {
          flow.onMoveFocusVertical(dir);
          return true;
        }}
        className={`font-hand text-base sm:text-lg leading-relaxed text-ink-primary ${blockAlignClass(block.align)} ${blockSizeClass(block.size)}`.trim()}
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
