/*
 * Contextual Popovers, IME-Safe Helpers, Auto-Resize Hook, Inline Formatting Toolbar,
 * and Block Gutter / Drag Handle Controls for the Hand-Drawn Stationery Flow Editor.
 */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { LocaleCode, StickerStyle } from '../../../lib/types';
import {
  createVisualId,
  formatAuthorMarginNote,
  parseAuthorMarginNote,
  type VisualBlock,
} from '../../../lib/visualBlocks';
import { MarginStickerCard } from '../../notebook/MarginNoteLayer';
import {
  ALERT_DOODLE_ICONS,
  ALL_ALERT_KINDS,
  ALL_CODE_CARD_STYLES,
  ALL_STICKER_STYLES,
  DEFAULT_ALERT_PRESET,
  STICKER_TONE_TOKENS,
} from '../../notebook/StationeryStickers';
import { ToneSwatchPicker } from '../../notebook/ToneSwatchPicker';
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconCheckSquare,
  IconCode,
  IconCopy,
  IconDiagram,
  IconFileCode,
  IconGripVertical,
  IconHeading,
  IconImage,
  IconList,
  IconPalette,
  IconParagraph,
  IconPen,
  IconPlus,
  IconQuote,
  IconTrash,
} from '../../ui/Icons';
import { PopupMenu } from '../../ui/PopupMenu';

const AUTHOR_MARGIN_STYLES: readonly StickerStyle[] = [
  'tape',
  'pin',
  'torn',
  'clip',
  'stamp',
  'tag',
];

/**
 * IME-safe check for custom Enter / prefix handlers (`modern-web-guidance/ime-safe-enter-submit`).
 * Combines `isComposing`, `keyCode === 229` (Safari WebKit bug 165004), and a 50ms post-compositionend window.
 */
export function isImeComposing(
  event: ReactKeyboardEvent<HTMLElement>,
  lastCompositionEndAt: number | null,
): boolean {
  const native = event.nativeEvent as globalThis.KeyboardEvent & {
    keyCode?: number;
  };
  if (native.isComposing || native.keyCode === 229) return true;
  if (
    lastCompositionEndAt !== null &&
    Math.abs(event.timeStamp - lastCompositionEndAt) < 50
  ) {
    return true;
  }
  return false;
}

/**
 * Fallback auto-resize ONLY where `field-sizing: content` is unsupported (`form-fields-automatically-fit-contents`).
 */
export function useAutoResizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx?: number,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof CSS !== 'undefined' &&
      CSS.supports('field-sizing', 'content')
    ) {
      return;
    }
    el.style.height = 'auto';
    const next = maxPx ? Math.min(maxPx, el.scrollHeight) : el.scrollHeight;
    el.style.height = `${Math.max(24, next)}px`;
  }, [ref, value, maxPx]);
}

export function wrapTextareaSelection(
  el: HTMLTextAreaElement | null,
  currentValue: string,
  before: string,
  after: string,
  fallback: string,
  commit: (nextValue: string) => void,
): void {
  if (!el) {
    commit(`${currentValue}${before}${fallback}${after}`);
    return;
  }
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  const selected = currentValue.slice(start, end) || fallback;
  const nextText =
    currentValue.slice(0, start) +
    before +
    selected +
    after +
    currentValue.slice(end);
  commit(nextText);
  requestAnimationFrame(() => {
    el.focus({ preventScroll: true });
    const selStart = start + before.length;
    el.setSelectionRange(selStart, selStart + selected.length);
  });
}

export function handleInlineFormatShortcut(
  e: ReactKeyboardEvent<HTMLTextAreaElement>,
  currentValue: string,
  commit: (nextValue: string) => void,
): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === 'b') {
    e.preventDefault();
    wrapTextareaSelection(e.currentTarget, currentValue, '**', '**', 'text', commit);
    return true;
  }
  if (k === 'i') {
    e.preventDefault();
    wrapTextareaSelection(e.currentTarget, currentValue, '*', '*', 'text', commit);
    return true;
  }
  if (k === 'e') {
    e.preventDefault();
    wrapTextareaSelection(e.currentTarget, currentValue, '`', '`', 'code', commit);
    return true;
  }
  if (k === 'k') {
    e.preventDefault();
    wrapTextareaSelection(
      e.currentTarget,
      currentValue,
      '[',
      '](https://)',
      'label',
      commit,
    );
    return true;
  }
  return false;
}

export function visualBlockIcon(type: VisualBlock['type']): ReactNode {
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

export function extractTurnIntoText(block: VisualBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
    case 'heading':
      return block.text;
    case 'list':
      return block.items.filter(Boolean).join('\n');
    case 'steps':
      return block.items
        .map((it) => it.title)
        .filter(Boolean)
        .join('\n');
    case 'alert':
      return [block.title, block.body].filter(Boolean).join('\n');
    case 'code_card':
      return block.code;
    case 'image':
      return block.caption || block.alt;
    case 'rough_diagram':
      return block.caption;
    case 'raw_markdown':
      return block.content;
  }
}

export function convertBlockType(
  block: VisualBlock,
  target: 'paragraph' | 'heading' | 'quote' | 'list' | 'steps' | 'alert',
): VisualBlock {
  const plain = extractTurnIntoText(block).trim();
  const lines = plain
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  switch (target) {
    case 'paragraph':
      return { id: block.id, type: 'paragraph', text: plain, marginNote: '' };
    case 'heading':
      return {
        id: block.id,
        type: 'heading',
        level: 2,
        text: plain.replace(/\n+/g, ' '),
        isTask: false,
        defaultChecked: false,
      };
    case 'quote':
      return { id: block.id, type: 'quote', text: plain };
    case 'list':
      return {
        id: block.id,
        type: 'list',
        ordered: false,
        items: lines.length > 0 ? lines : [''],
      };
    case 'steps':
      return {
        id: block.id,
        type: 'steps',
        title: '',
        scope: 'paragraph',
        items:
          lines.length > 0
            ? lines.map((title) => ({
                id: createVisualId('st'),
                title,
                detail: '',
                defaultChecked: false,
              }))
            : [
                {
                  id: createVisualId('st'),
                  title: '',
                  detail: '',
                  defaultChecked: false,
                },
              ],
      };
    case 'alert':
      return {
        id: block.id,
        type: 'alert',
        kind: 'tip',
        title: '',
        body: plain,
        detailSummary: '',
        detailBody: '',
        style: '',
        tone: '',
        badge: '',
      };
  }
}

/**
 * Accessible Selection Formatting Toolbar (`modern-web-guidance/toolbar`).
 */
export function InlineFormatToolbar({
  locale,
  onBold,
  onItalic,
  onCode,
  onLink,
}: {
  locale: LocaleCode;
  onBold: () => void;
  onItalic: () => void;
  onCode: () => void;
  onLink: () => void;
}) {
  const v = UI_COPY[locale].studio.visual;

  return (
    <div
      role="toolbar"
      aria-label={v.fmtBold}
      className="flow-inline-toolbar ui-popover-enter origin-bottom"
      {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
    >
      <button
        type="button"
        title="Ctrl+B / ⌘B"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onBold}
      >
        <span className="font-semibold">{v.fmtBold}</span>
      </button>
      <button
        type="button"
        title="Ctrl+I / ⌘I"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onItalic}
      >
        <span className="italic">{v.fmtItalic}</span>
      </button>
      <span
        role="separator"
        aria-orientation="vertical"
        className="w-px h-4 bg-border-subtle mx-0.5"
      />
      <button
        type="button"
        title="Ctrl+E / ⌘E"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCode}
      >
        <span className="font-mono">{v.fmtCode}</span>
      </button>
      <button
        type="button"
        title="Ctrl+K / ⌘K"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onLink}
      >
        <span>{v.fmtLink}</span>
      </button>
    </div>
  );
}

/**
 * Compact Floating Appearance & Detail Popover for Sticker Alerts (`viewport-aware-dropdowns`).
 */
export function AlertStylePopover({
  block,
  locale,
  detailOpen,
  onToggleDetail,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'alert' }>;
  locale: LocaleCode;
  detailOpen: boolean;
  onToggleDetail: () => void;
  onUpdate: (next: Extract<VisualBlock, { type: 'alert' }>) => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const flow = EXT_COPY[locale].studio.flowEditor;

  return (
    <PopupMenu
      variant="panel"
      align="end"
      showChevron={false}
      triggerAriaLabel={flow.stylePopoverBtn}
      triggerTitle={flow.stylePopoverBtn}
      triggerClassName="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet/90 border border-border-ink/40 hover:border-border-ink text-ink-primary shadow-xs"
      triggerLabel={
        <>
          <IconPalette className="w-3.5 h-3.5 text-ink-secondary" />
          <span className="hidden sm:inline">{flow.stylePopoverBtn}</span>
        </>
      }
    >
      {() => (
        <div className="space-y-3 text-xs">
          <div className="space-y-1.5">
            <div className="font-semibold text-ink-secondary">
              {v.alertKindLabel}
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_ALERT_KINDS.map((kind) => {
                const active = block.kind === kind;
                const presetTone = block.tone || DEFAULT_ALERT_PRESET[kind].tone;
                const tok = STICKER_TONE_TOKENS[presetTone];
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onUpdate({ ...block, kind })}
                    className="min-h-7 px-2 py-0.5 rounded-full text-xs font-semibold border inline-flex items-center gap-1 cursor-pointer transition-colors"
                    style={
                      active
                        ? {
                            backgroundColor: tok.badgeBg,
                            color: tok.badgeFg,
                            borderColor: tok.border,
                          }
                        : {
                            backgroundColor: 'var(--surface-raised)',
                            color: 'var(--ink-secondary)',
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
          </div>

          <div className="space-y-1.5">
            <div className="font-semibold text-ink-secondary">
              {v.stickerStyleLabel}
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                aria-pressed={block.style === ''}
                onClick={() => onUpdate({ ...block, style: '' })}
                className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer ${
                  block.style === ''
                    ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                    : 'bg-surface-raised text-ink-muted border-border-subtle hover:text-ink-primary'
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
                    onClick={() => onUpdate({ ...block, style: st })}
                    className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer ${
                      active
                        ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                        : 'bg-surface-raised text-ink-muted border-border-subtle hover:text-ink-primary'
                    }`}
                  >
                    {copy.stickerStyles[st]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="font-semibold text-ink-secondary">
              {v.stickerToneLabel}
            </div>
            <ToneSwatchPicker
              value={block.tone}
              onChange={(nextTone) => onUpdate({ ...block, tone: nextTone })}
              copy={copy}
              ariaLabel={v.stickerToneLabel}
              autoOptionLabel={v.stickerAutoOption}
              ringOffsetClass="ring-offset-surface-sheet"
              className="flex-wrap"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 pt-2 border-t border-border-subtle">
            <input
              type="text"
              maxLength={24}
              value={block.badge}
              onChange={(e) => onUpdate({ ...block, badge: e.target.value })}
              aria-label={v.stickerBadgePlaceholder}
              placeholder={`${v.stickerBadgePlaceholder}: ${copy.alertStamps[block.kind]}`}
              className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-hand font-semibold"
            />
            <button
              type="button"
              aria-pressed={detailOpen}
              onClick={onToggleDetail}
              className={`min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold border text-start cursor-pointer transition-colors ${
                detailOpen
                  ? 'bg-action-subtle text-link-ink border-border-ink'
                  : 'bg-surface-raised text-ink-secondary border-border-subtle hover:text-ink-primary'
              }`}
            >
              + {flow.toggleDetailBtn}
            </button>
          </div>
        </div>
      )}
    </PopupMenu>
  );
}

/**
 * Compact Floating Paper Style & Margin Note Popover for Washi Code Cards.
 */
export function CodeStylePopover({
  block,
  locale,
  onUpdate,
  onOpenMarginNote,
}: {
  block: Extract<VisualBlock, { type: 'code_card' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'code_card' }>) => void;
  onOpenMarginNote: () => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const flow = EXT_COPY[locale].studio.flowEditor;

  return (
    <PopupMenu
      variant="panel"
      align="end"
      showChevron={false}
      triggerAriaLabel={flow.stylePopoverBtn}
      triggerTitle={flow.stylePopoverBtn}
      triggerClassName="min-h-7 px-2 py-0.5 rounded-lg font-sans text-xs font-semibold bg-surface-sheet text-ink-primary border-[1.5px] border-border-ink"
      triggerLabel={
        <>
          <IconPalette className="w-3.5 h-3.5 text-ink-secondary" />
          <span className="hidden sm:inline">{flow.stylePopoverBtn}</span>
        </>
      }
    >
      {({ close }) => (
        <div className="space-y-3 text-xs">
          <div className="space-y-1.5">
            <div className="font-semibold text-ink-secondary">
              {v.codeStyleLabel}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CODE_CARD_STYLES.map((st) => {
                const active = block.style === st;
                return (
                  <button
                    key={st}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onUpdate({ ...block, style: st })}
                    className={`min-h-7 px-2.5 py-0.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                      active
                        ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                        : 'bg-surface-raised text-ink-secondary border-border-subtle hover:text-ink-primary'
                    }`}
                  >
                    {copy.codeCardStyles[st]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => {
                onOpenMarginNote();
                close(true);
              }}
              className="w-full min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-raised hover:bg-action-subtle text-ink-primary border border-border-subtle inline-flex items-center gap-1.5 cursor-pointer"
            >
              <IconPen className="w-3.5 h-3.5 text-ink-muted" />
              <span>{flow.addMarginBtn}</span>
            </button>
          </div>
        </div>
      )}
    </PopupMenu>
  );
}

/**
 * In-Place Side Author Margin Sticky (`:::margin[...]`), styled identically to reader stickies.
 */
export function InlineAuthorMarginSticky({
  locale,
  rawValue,
  onChange,
  onRemove,
}: {
  locale: LocaleCode;
  rawValue: string;
  onChange: (nextRaw: string) => void;
  onRemove: () => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const flow = EXT_COPY[locale].studio.flowEditor;
  const parsed = parseAuthorMarginNote(rawValue);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoResizeTextarea(taRef, parsed.text);

  return (
    <div className="relative">
      <MarginStickerCard
        style={parsed.style}
        tone={parsed.tone}
        badgeIcon={<IconPen className="w-3.5 h-3.5" />}
        badgeLabel={copy.authorNoteBadge}
        tiltDeg={-0.6}
        onDelete={onRemove}
        deleteAriaLabel={flow.removeMarginBtn}
      >
        <div className="space-y-1.5">
          <textarea
            ref={taRef}
            rows={2}
            value={parsed.text}
            onChange={(e) =>
              onChange(
                formatAuthorMarginNote(
                  e.target.value,
                  parsed.tone,
                  parsed.style,
                ) || ' ',
              )
            }
            aria-label={v.marginNoteLabel}
            placeholder={v.marginNotePlaceholder}
            className="flow-editor-textarea font-hand text-sm leading-relaxed placeholder:opacity-60"
            style={{ color: 'var(--sticker-body)' }}
          />
          <div className="flex justify-end">
            <PopupMenu
              variant="panel"
              align="end"
              showChevron={false}
              triggerAriaLabel={flow.stylePopoverBtn}
              triggerClassName="min-h-6 px-1.5 py-0.5 rounded text-xs font-sans bg-surface-sheet/70 border border-border-ink/30 text-ink-secondary hover:text-ink-primary"
              triggerLabel={<IconPalette className="w-3 h-3" />}
            >
              {() => (
                <div className="space-y-2.5 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {AUTHOR_MARGIN_STYLES.map((st) => {
                      const active = parsed.style === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            onChange(
                              formatAuthorMarginNote(
                                parsed.text.trim() || ' ',
                                parsed.tone,
                                st,
                              ),
                            )
                          }
                          className={`min-h-7 px-2 py-0.5 rounded-md border cursor-pointer ${
                            active
                              ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                              : 'bg-surface-raised text-ink-muted border-border-subtle'
                          }`}
                        >
                          {copy.stickerStyles[st]}
                        </button>
                      );
                    })}
                  </div>
                  <ToneSwatchPicker
                    value={parsed.tone}
                    onChange={(nextTone) => {
                      if (nextTone) {
                        onChange(
                          formatAuthorMarginNote(
                            parsed.text.trim() || ' ',
                            nextTone,
                            parsed.style,
                          ),
                        );
                      }
                    }}
                    copy={copy}
                    ringOffsetClass="ring-offset-surface-sheet"
                  />
                </div>
              )}
            </PopupMenu>
          </div>
        </div>
      </MarginStickerCard>
    </div>
  );
}

/**
 * Quiet Notion-style Gutter Controls (`+` insert below & `⠿` drag handle + Block Action Menu).
 */
export function BlockGutterHandle({
  index,
  total,
  block,
  locale,
  hasMarginNoteOpen,
  dragMovedRef,
  onInsertBelow,
  onDragPointerDown,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onTurnInto,
  onToggleMarginNote,
}: {
  index: number;
  total: number;
  block: VisualBlock;
  locale: LocaleCode;
  hasMarginNoteOpen: boolean;
  dragMovedRef: React.MutableRefObject<boolean>;
  onInsertBelow: () => void;
  onDragPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTurnInto: (
    target: 'paragraph' | 'heading' | 'quote' | 'list' | 'steps' | 'alert',
  ) => void;
  onToggleMarginNote?: () => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const flow = EXT_COPY[locale].studio.flowEditor;
  const supportsTurnInto =
    block.type === 'paragraph' ||
    block.type === 'heading' ||
    block.type === 'quote' ||
    block.type === 'list' ||
    block.type === 'steps' ||
    block.type === 'alert';

  const turnTargets: Array<{
    target: 'paragraph' | 'heading' | 'steps' | 'list' | 'quote' | 'alert';
    label: string;
  }> = [
    { target: 'paragraph', label: v.types.paragraph },
    { target: 'heading', label: v.types.heading },
    { target: 'steps', label: copy.taskScopeParagraph },
    { target: 'list', label: v.types.list },
    { target: 'quote', label: v.types.quote },
    { target: 'alert', label: v.types.alert },
  ];

  return (
    <div className="flow-gutter-actions">
      <button
        type="button"
        onClick={onInsertBelow}
        aria-label={flow.insertHandleAria}
        title={flow.insertHandleAria}
        className="w-6 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer transition-colors"
      >
        <IconPlus className="w-3.5 h-3.5" />
      </button>

      <PopupMenu
        align="start"
        showChevron={false}
        triggerAriaLabel={flow.dragHandleAria}
        triggerTitle={flow.dragHandleAria}
        triggerClassName="flow-drag-handle w-6 h-7 rounded-lg text-ink-muted hover:text-ink-primary hover:bg-surface-raised"
        onTriggerPointerDown={onDragPointerDown}
        onTriggerClickCapture={(e) => {
          if (dragMovedRef.current) {
            dragMovedRef.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        triggerLabel={<IconGripVertical className="w-3.5 h-3.5" />}
      >
        {({ close }) => (
          <>
            <button
              type="button"
              disabled={index === 0}
              onClick={(e) => {
                close(e.detail !== 0);
                onMoveUp();
              }}
            >
              <IconArrowUp className="w-3.5 h-3.5 text-ink-muted" />
              <span>{v.moveUp}</span>
            </button>
            <button
              type="button"
              disabled={index >= total - 1}
              onClick={(e) => {
                close(e.detail !== 0);
                onMoveDown();
              }}
            >
              <IconArrowDown className="w-3.5 h-3.5 text-ink-muted" />
              <span>{v.moveDown}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                close(e.detail !== 0);
                onDuplicate();
              }}
            >
              <IconCopy className="w-3.5 h-3.5 text-ink-muted" />
              <span>{v.duplicate}</span>
            </button>

            {onToggleMarginNote && (
              <>
                <hr />
                <button
                  type="button"
                  onClick={(e) => {
                    close(e.detail !== 0);
                    onToggleMarginNote();
                  }}
                >
                  <IconPen className="w-3.5 h-3.5 text-ink-muted" />
                  <span>
                    {hasMarginNoteOpen ? flow.removeMarginBtn : flow.addMarginBtn}
                  </span>
                </button>
              </>
            )}

            {supportsTurnInto && (
              <>
                <hr />
                <div className="px-2.5 py-1 text-xs font-semibold text-ink-muted">
                  {flow.turnIntoLabel}
                </div>
                {turnTargets
                  .filter((t) => t.target !== block.type)
                  .map((t) => (
                    <button
                      key={t.target}
                      type="button"
                      onClick={(e) => {
                        close(e.detail !== 0);
                        onTurnInto(t.target);
                      }}
                    >
                      {visualBlockIcon(t.target)}
                      <span>{t.label}</span>
                    </button>
                  ))}
              </>
            )}

            <hr />
            <button
              type="button"
              data-tone="danger"
              onClick={(e) => {
                close(e.detail !== 0);
                onDelete();
              }}
            >
              <IconTrash className="w-3.5 h-3.5" />
              <span>{v.deleteBlock}</span>
            </button>
          </>
        )}
      </PopupMenu>
    </div>
  );
}
