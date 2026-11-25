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
  useState,
} from 'react';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import {
  type ActiveInlineFormats,
  parseKeyComboInput,
  eventToKeyCombo,
  QUICK_KBD_KEYS,
  RICH_BG_SWATCHES,
  RICH_FG_SWATCHES,
  RICH_HL_SWATCHES,
  type RichInlineCommand,
  setPersistentSelectionHighlight,
} from '../../../lib/richInline';
import type {
  LocaleCode,
  StickerStyle,
  TextAlign,
  TextSizePreset,
} from '../../../lib/types';
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
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowUp,
  IconBold,
  IconCheckSquare,
  IconClose,
  IconCode,
  IconCopy,
  IconDiagram,
  IconEraser,
  IconFileCode,
  IconGripVertical,
  IconHeading,
  IconHighlighter,
  IconImage,
  IconInlineCode,
  IconItalic,
  IconKeyboardKey,
  IconLink,
  IconList,
  IconPalette,
  IconParagraph,
  IconPen,
  IconPixelSticker,
  IconPlus,
  IconQuote,
  IconStrikethrough,
  IconTextSize,
  IconTrash,
  IconUnderline,
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
    case 'pixel_sticker':
      return <IconPixelSticker className="w-3.5 h-3.5 text-accent-amber" />;
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
    case 'pixel_sticker':
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
 * Shared Theme-Calibrated Text Color / Pill Background / Highlighter Swatch Palette
 * Reused by both `<InlineFormatToolbar>` and `<EditorContextMenu>`.
 */
export function ColorHighlightPalette({
  locale,
  activeFg,
  activeBg,
  activeHighlight,
  testIdPrefix,
  preventFocusLoss = false,
  onCommand,
}: {
  locale: LocaleCode;
  activeFg?: string | null;
  activeBg?: string | null;
  activeHighlight?: string | null;
  testIdPrefix: string;
  preventFocusLoss?: boolean;
  onCommand: (cmd: RichInlineCommand) => void;
}) {
  const rf = EXT_COPY[locale].studio.richFormat;
  const colorName = (id: string): string => {
    switch (id) {
      case 'violet':
        return rf.colorViolet;
      case 'ice':
        return rf.colorIce;
      case 'emerald':
        return rf.colorEmerald;
      case 'amber':
        return rf.colorAmber;
      case 'rose':
        return rf.colorRose;
      case 'muted':
        return rf.colorMuted;
      case 'kraft':
        return rf.colorKraft;
      default:
        return rf.colorDefault;
    }
  };

  const keepFocus = preventFocusLoss
    ? (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.button === 0) e.preventDefault();
      }
    : undefined;

  return (
    <div className="space-y-2 text-xs">
      {/* Row 1: Text Color */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary font-semibold whitespace-nowrap">
          {rf.textColor}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            data-testid={`${testIdPrefix}-fg-default`}
            aria-label={`${rf.textColor}: ${rf.colorDefault}`}
            aria-pressed={!activeFg}
            onPointerDown={keepFocus}
            onClick={() => onCommand({ type: 'fg-color', value: null })}
            className="w-6 h-6 rounded-full border border-border-control bg-surface-sheet text-ink-primary font-mono text-xs inline-flex items-center justify-center cursor-pointer"
          >
            A
          </button>
          {RICH_FG_SWATCHES.map((sw) => (
            <button
              key={sw.id}
              type="button"
              data-testid={`${testIdPrefix}-fg-${sw.id}`}
              aria-label={`${rf.textColor}: ${colorName(sw.id)}`}
              title={colorName(sw.id)}
              aria-pressed={activeFg === sw.id}
              onPointerDown={keepFocus}
              onClick={() => onCommand({ type: 'fg-color', value: sw.id })}
              className={`w-6 h-6 rounded-full border cursor-pointer inline-flex items-center justify-center font-semibold text-xs ${
                activeFg === sw.id
                  ? 'border-border-ink ring-2 ring-action-bg ring-offset-1 ring-offset-surface-sheet'
                  : 'border-border-subtle hover:border-border-ink'
              }`}
              style={{ color: sw.cssVar, backgroundColor: 'var(--surface-sheet)' }}
            >
              A
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Pill Background Color */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary font-semibold whitespace-nowrap">
          {rf.bgColor}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            data-testid={`${testIdPrefix}-bg-default`}
            aria-label={`${rf.bgColor}: ${rf.colorDefault}`}
            aria-pressed={!activeBg}
            onPointerDown={keepFocus}
            onClick={() => onCommand({ type: 'bg-color', value: null })}
            className="w-6 h-6 rounded-md border border-dashed border-border-control bg-surface-sheet text-ink-muted text-xs inline-flex items-center justify-center cursor-pointer"
          >
            <IconClose className="w-3 h-3" />
          </button>
          {RICH_BG_SWATCHES.map((sw) => (
            <button
              key={sw.id}
              type="button"
              data-testid={`${testIdPrefix}-bg-${sw.id}`}
              aria-label={`${rf.bgColor}: ${colorName(sw.id)}`}
              title={colorName(sw.id)}
              aria-pressed={activeBg === sw.id}
              onPointerDown={keepFocus}
              onClick={() => onCommand({ type: 'bg-color', value: sw.id })}
              className={`w-6 h-6 rounded-md border cursor-pointer ${
                activeBg === sw.id
                  ? 'ring-2 ring-action-bg ring-offset-1 ring-offset-surface-sheet'
                  : 'hover:border-border-ink'
              }`}
              style={{
                backgroundColor: sw.bgVar,
                borderColor: sw.borderVar,
              }}
            />
          ))}
        </div>
      </div>

      {/* Row 3: Highlighter Marker Color */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary font-semibold whitespace-nowrap">
          {rf.highlightColor}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            data-testid={`${testIdPrefix}-hl-default`}
            aria-label={`${rf.highlightColor}: ${rf.colorDefault}`}
            aria-pressed={!activeHighlight}
            onPointerDown={keepFocus}
            onClick={() => onCommand({ type: 'highlight', value: null })}
            className="w-6 h-6 rounded-md border border-dashed border-border-control bg-surface-sheet text-ink-muted text-xs inline-flex items-center justify-center cursor-pointer"
          >
            <IconClose className="w-3 h-3" />
          </button>
          {RICH_HL_SWATCHES.map((sw) => (
            <button
              key={sw.id}
              type="button"
              data-testid={`${testIdPrefix}-hl-${sw.id}`}
              aria-label={`${rf.highlightColor}: ${colorName(sw.id)}`}
              title={colorName(sw.id)}
              aria-pressed={activeHighlight === sw.id}
              onPointerDown={keepFocus}
              onClick={() => onCommand({ type: 'highlight', value: sw.id })}
              className={`w-6 h-6 rounded-md border cursor-pointer inline-flex items-end justify-center pb-1 ${
                activeHighlight === sw.id
                  ? 'border-border-ink ring-2 ring-action-bg ring-offset-1 ring-offset-surface-sheet'
                  : 'border-border-subtle hover:border-border-ink'
              }`}
              style={{
                backgroundColor: 'var(--surface-sheet)',
                backgroundImage: `linear-gradient(to top, ${sw.cssVar} 60%, transparent 60%)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive Tactile Keyboard Key Combo Recorder & Composer (`<kbd>` + `.ink-kbd-combo`).
 */
export function KbdComboComposer({
  locale,
  onInsert,
  onCancel,
}: {
  locale: LocaleCode;
  onInsert: (keys: string[]) => void;
  onCancel?: () => void;
}) {
  const rf = EXT_COPY[locale].studio.richFormat;
  const [rawInput, setRawInput] = useState('Ctrl+K');
  const lastCompEndRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, []);

  const parsedKeys = parseKeyComboInput(rawInput);

  return (
    <div
      data-testid="kbd-composer-panel"
      className="space-y-2.5 text-xs p-2.5 rounded-xl bg-surface-sheet border-2 border-border-ink shadow-[3px_3px_0_0_var(--border-ink)] w-72 sm:w-80"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink-primary inline-flex items-center gap-1.5">
          <IconKeyboardKey className="w-3.5 h-3.5 text-link-ink" />
          <span>{rf.kbdTitle}</span>
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={UI_COPY[locale].auth.close}
            className="w-6 h-6 rounded-md inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer"
          >
            <IconClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        data-testid="kbd-combo-input"
        value={rawInput}
        placeholder={rf.kbdRecordPlaceholder}
        onCompositionEnd={(e) => {
          lastCompEndRef.current = e.timeStamp;
        }}
        onChange={(e) => setRawInput(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e, lastCompEndRef.current)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel?.();
            return;
          }
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            if (parsedKeys.length > 0) onInsert(parsedKeys);
            return;
          }
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault();
            const recorded = eventToKeyCombo(e);
            if (recorded.length > 0) setRawInput(recorded.join(' + '));
          }
        }}
        className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle font-mono text-xs focus:outline-none focus:border-action-bg"
      />

      <div className="flex flex-wrap gap-1">
        {QUICK_KBD_KEYS.map((keyLabel) => (
          <button
            key={keyLabel}
            type="button"
            onClick={() => {
              const cur = parseKeyComboInput(rawInput);
              setRawInput([...cur, keyLabel].slice(0, 6).join(' + '));
            }}
            className="ink-kbd px-1.5 py-0.5 text-xs cursor-pointer hover:bg-action-subtle"
          >
            {keyLabel}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border-subtle">
        <div className="min-h-6 flex items-center gap-1 overflow-x-auto">
          {parsedKeys.length > 0 ? (
            <span className="ink-kbd-combo" aria-hidden="true">
              {parsedKeys.map((k, idx) => (
                <span key={`${k}-${idx}`} className="inline-flex items-center gap-1">
                  {idx > 0 && <span className="ink-kbd-sep">+</span>}
                  <kbd className="ink-kbd">{k}</kbd>
                </span>
              ))}
            </span>
          ) : (
            <span className="text-ink-muted">{rf.kbdRecordHint}</span>
          )}
        </div>
        <button
          type="button"
          data-testid="kbd-insert-submit"
          disabled={parsedKeys.length === 0}
          onClick={() => {
            if (parsedKeys.length > 0) onInsert(parsedKeys);
          }}
          className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold ink-btn-primary disabled:opacity-45 cursor-pointer shrink-0"
        >
          {rf.kbdInsertBtn}
        </button>
      </div>
    </div>
  );
}

/**
 * Accessible Selection Formatting Toolbar (`modern-web-guidance/toolbar` & `highlight-text-ranges`).
 * Renders single-tab-stop toolbar with `focusgroup="toolbar wrap"` (+ roving fallback),
 * ARIA `[aria-pressed="true"]`, inline colors/highlights, font size, alignment, `<kbd>`, & links.
 */
export function InlineFormatToolbar({
  locale,
  rect,
  formats,
  supportsAlign = false,
  blockAlign = 'left',
  supportsFontSize = false,
  blockSize = 'base',
  savedRange,
  onCommand,
  onChangeAlign,
  onChangeBlockSize,
  onRequestDismiss,
}: {
  locale: LocaleCode;
  rect: { top: number; bottom: number; left: number; width: number };
  formats: ActiveInlineFormats;
  supportsAlign?: boolean;
  blockAlign?: TextAlign;
  supportsFontSize?: boolean;
  blockSize?: TextSizePreset;
  savedRange: Range | null;
  onCommand: (cmd: RichInlineCommand) => void;
  onChangeAlign?: (align: TextAlign) => void;
  onChangeBlockSize?: (size: TextSizePreset) => void;
  onRequestDismiss?: () => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const rf = EXT_COPY[locale].studio.richFormat;
  const barRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const lastLinkCompEndRef = useRef<number | null>(null);
  const [subPanel, setSubPanel] = useState<'color' | 'size' | 'kbd' | 'link' | null>(null);
  const [linkDraft, setLinkDraft] = useState(formats.linkHref ?? 'https://');

  useEffect(() => {
    setLinkDraft(formats.linkHref ?? 'https://');
  }, [formats.linkHref]);

  // Keep selected range highlighted visually whenever an input subpanel (`kbd` / `link`) holds focus
  useEffect(() => {
    if (subPanel === 'kbd' || subPanel === 'link') {
      setPersistentSelectionHighlight(savedRange);
      return () => setPersistentSelectionHighlight(null);
    }
    setPersistentSelectionHighlight(null);
    return undefined;
  }, [subPanel, savedRange]);

  // Install roving-tabindex fallback ONLY when native `focusgroup` is unsupported (`toolbar` guide)
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || 'focusGroup' in HTMLElement.prototype) return undefined;

    const getItems = () =>
      Array.from(bar.querySelectorAll<HTMLButtonElement>('[role="group"] > button'));
    const initItems = getItems();
    initItems.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
    });

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLButtonElement | null;
      const items = getItems();
      if (target && items.includes(target)) {
        items.forEach((b) => {
          b.tabIndex = b === target ? 0 : -1;
        });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      const items = getItems();
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      if (idx < 0 || items.length === 0) return;
      e.preventDefault();
      const rtl = getComputedStyle(bar).direction === 'rtl';
      let nextIdx = idx;
      if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = items.length - 1;
      else if (e.key === 'ArrowRight') {
        nextIdx = (idx + (rtl ? -1 : 1) + items.length) % items.length;
      } else if (e.key === 'ArrowLeft') {
        nextIdx = (idx + (rtl ? 1 : -1) + items.length) % items.length;
      }
      items[nextIdx]?.focus({ preventScroll: true });
    };

    bar.addEventListener('focusin', onFocusIn);
    bar.addEventListener('keydown', onKeyDown);
    return () => {
      bar.removeEventListener('focusin', onFocusIn);
      bar.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const vh = vv
    ? vv.height + vv.offsetTop
    : typeof window !== 'undefined'
      ? window.innerHeight
      : 800;
  const isCoarse =
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const estimatedBarHalfW = Math.min(260, Math.floor((vw - 24) / 2));
  const preferBelowCoarse =
    isCoarse && rect.bottom + (subPanel ? 260 : 72) <= vh;
  const openBelow = preferBelowCoarse || rect.top < (subPanel ? 280 : 118);
  const maxAllowedTop = Math.max(8, vh - (subPanel ? 260 : 68));
  const fixedTop = openBelow
    ? Math.min(maxAllowedTop, rect.bottom + (isCoarse ? 10 : 8))
    : Math.max(8, rect.top - 48);
  const fixedLeft = Math.max(
    12,
    Math.min(
      rect.left + rect.width / 2 - estimatedBarHalfW,
      vw - estimatedBarHalfW * 2 - 12,
    ),
  );

  const keepFocusOnPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button === 0) e.preventDefault();
  };

  const sizeOptions: Array<{ id: TextSizePreset; label: string }> = [
    { id: 'sm', label: rf.sizeSm },
    { id: 'base', label: rf.sizeBase },
    { id: 'lg', label: rf.sizeLg },
    { id: 'xl', label: rf.sizeXl },
    { id: '2xl', label: rf.size2xl },
  ];

  const activeSize = blockSize !== 'base' ? blockSize : formats.fontSize ?? 'base';

  return (
    <div
      data-testid="flow-inline-toolbar"
      className="fixed z-(--z-popover) flex flex-col items-start gap-1.5 ui-popover-enter origin-bottom max-h-[calc(100dvh-1rem)] overflow-y-auto"
      style={{
        left: `${Math.round(fixedLeft)}px`,
        top: `${Math.round(fixedTop)}px`,
        maxWidth: 'calc(100dvw - 1.5rem)',
      }}
    >
      <div
        ref={barRef}
        role="toolbar"
        aria-label={rf.toolbarAria}
        className="flow-inline-toolbar"
        {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
      >
        <div role="group" aria-label={v.fmtBold} className="inline-flex items-center gap-0.5">
          <button
            type="button"
            data-testid="toolbar-bold-btn"
            aria-label={v.fmtBold}
            title={`${v.fmtBold} (Ctrl+B)`}
            aria-pressed={formats.bold}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => onCommand({ type: 'bold' })}
          >
            <IconBold />
          </button>
          <button
            type="button"
            data-testid="toolbar-italic-btn"
            aria-label={v.fmtItalic}
            title={`${v.fmtItalic} (Ctrl+I)`}
            aria-pressed={formats.italic}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => onCommand({ type: 'italic' })}
          >
            <IconItalic />
          </button>
          <button
            type="button"
            data-testid="toolbar-underline-btn"
            aria-label={rf.underline}
            title={`${rf.underline} (Ctrl+U)`}
            aria-pressed={formats.underline}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => onCommand({ type: 'underline' })}
          >
            <IconUnderline />
          </button>
          <button
            type="button"
            data-testid="toolbar-strike-btn"
            aria-label={rf.strikethrough}
            title={rf.strikethrough}
            aria-pressed={formats.strike}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => onCommand({ type: 'strike' })}
          >
            <IconStrikethrough />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="w-px h-4 bg-border-subtle mx-0.5" />

        <div role="group" aria-label={rf.inlineCode} className="inline-flex items-center gap-0.5">
          <button
            type="button"
            data-testid="toolbar-code-btn"
            aria-label={rf.inlineCode}
            title={`${rf.inlineCode} (Ctrl+E)`}
            aria-pressed={formats.code}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => onCommand({ type: 'inline-code' })}
          >
            <IconInlineCode />
          </button>
          <button
            type="button"
            data-testid="toolbar-kbd-btn"
            aria-label={rf.kbdCombo}
            title={rf.kbdCombo}
            aria-pressed={subPanel === 'kbd'}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => setSubPanel((p) => (p === 'kbd' ? null : 'kbd'))}
          >
            <IconKeyboardKey />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="w-px h-4 bg-border-subtle mx-0.5" />

        <div role="group" aria-label={rf.highlightColor} className="inline-flex items-center gap-0.5">
          <button
            type="button"
            data-testid="toolbar-color-btn"
            aria-label={rf.highlightColor}
            title={`${rf.textColor} / ${rf.bgColor} / ${rf.highlightColor}`}
            aria-pressed={
              subPanel === 'color' ||
              Boolean(formats.fgColor || formats.bgColor || formats.highlight)
            }
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => setSubPanel((p) => (p === 'color' ? null : 'color'))}
          >
            <IconHighlighter />
          </button>
          <button
            type="button"
            data-testid="toolbar-fontsize-btn"
            aria-label={rf.fontSize}
            title={rf.fontSize}
            aria-pressed={subPanel === 'size' || activeSize !== 'base'}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => setSubPanel((p) => (p === 'size' ? null : 'size'))}
          >
            <IconTextSize />
          </button>
        </div>

        {supportsAlign && onChangeAlign && (
          <>
            <span role="separator" aria-orientation="vertical" className="w-px h-4 bg-border-subtle mx-0.5" />
            <div role="group" aria-label={rf.alignLeft} className="inline-flex items-center gap-0.5">
              <button
                type="button"
                data-testid="toolbar-align-left"
                aria-label={rf.alignLeft}
                title={rf.alignLeft}
                aria-pressed={blockAlign === 'left'}
                onPointerDown={keepFocusOnPointerDown}
                onClick={() => onChangeAlign('left')}
              >
                <IconAlignLeft />
              </button>
              <button
                type="button"
                data-testid="toolbar-align-center"
                aria-label={rf.alignCenter}
                title={rf.alignCenter}
                aria-pressed={blockAlign === 'center'}
                onPointerDown={keepFocusOnPointerDown}
                onClick={() => onChangeAlign('center')}
              >
                <IconAlignCenter />
              </button>
              <button
                type="button"
                data-testid="toolbar-align-right"
                aria-label={rf.alignRight}
                title={rf.alignRight}
                aria-pressed={blockAlign === 'right'}
                onPointerDown={keepFocusOnPointerDown}
                onClick={() => onChangeAlign('right')}
              >
                <IconAlignRight />
              </button>
            </div>
          </>
        )}

        <span role="separator" aria-orientation="vertical" className="w-px h-4 bg-border-subtle mx-0.5" />

        <div role="group" aria-label={v.fmtLink} className="inline-flex items-center gap-0.5">
          <button
            type="button"
            data-testid="toolbar-link-btn"
            aria-label={v.fmtLink}
            title={v.fmtLink}
            aria-pressed={Boolean(formats.linkHref) || subPanel === 'link'}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => {
              setSubPanel((p) => (p === 'link' ? null : 'link'));
              requestAnimationFrame(() => linkInputRef.current?.focus({ preventScroll: true }));
            }}
          >
            <IconLink />
          </button>
          <button
            type="button"
            data-testid="toolbar-clear-btn"
            aria-label={rf.clearFormat}
            title={rf.clearFormat}
            onPointerDown={keepFocusOnPointerDown}
            onClick={() => {
              onCommand({ type: 'clear-format' });
              setSubPanel(null);
            }}
          >
            <IconEraser />
          </button>
        </div>
      </div>

      {subPanel === 'color' && (
        <div
          data-testid="toolbar-color-panel"
          className="p-3 rounded-xl bg-surface-sheet border-2 border-border-ink shadow-[3px_3px_0_0_var(--border-ink)] w-72"
        >
          <ColorHighlightPalette
            locale={locale}
            activeFg={formats.fgColor}
            activeBg={formats.bgColor}
            activeHighlight={formats.highlight}
            testIdPrefix="toolbar"
            preventFocusLoss
            onCommand={(cmd) => onCommand(cmd)}
          />
        </div>
      )}

      {subPanel === 'size' && (
        <div
          data-testid="toolbar-fontsize-panel"
          className="p-2.5 rounded-xl bg-surface-sheet border-2 border-border-ink shadow-[3px_3px_0_0_var(--border-ink)] space-y-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-1">
            {sizeOptions.map((opt) => {
              const isSelected = activeSize === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`toolbar-size-${opt.id}`}
                  aria-pressed={isSelected}
                  onPointerDown={keepFocusOnPointerDown}
                  onClick={() => {
                    onCommand({
                      type: 'font-size',
                      value: opt.id === 'base' ? null : opt.id,
                    });
                    if (supportsFontSize && onChangeBlockSize) {
                      onChangeBlockSize(opt.id);
                    }
                    setSubPanel(null);
                  }}
                  className={`min-h-7 px-2.5 py-1 rounded-lg border cursor-pointer font-semibold transition-colors ${
                    isSelected
                      ? 'bg-action-subtle text-link-ink border-action-bg'
                      : 'bg-surface-raised text-ink-secondary border-border-subtle hover:text-ink-primary'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {subPanel === 'kbd' && (
        <KbdComboComposer
          locale={locale}
          onInsert={(keys) => {
            onCommand({ type: 'kbd-combo', keys });
            setSubPanel(null);
            onRequestDismiss?.();
          }}
          onCancel={() => setSubPanel(null)}
        />
      )}

      {subPanel === 'link' && (
        <div
          data-testid="toolbar-link-panel"
          className="p-2.5 rounded-xl bg-surface-sheet border-2 border-border-ink shadow-[3px_3px_0_0_var(--border-ink)] flex items-center gap-1.5 text-xs w-72"
        >
          <input
            ref={linkInputRef}
            type="url"
            aria-label={rf.linkPlaceholder}
            value={linkDraft}
            placeholder={rf.linkPlaceholder}
            onCompositionEnd={(e) => {
              lastLinkCompEndRef.current = e.timeStamp;
            }}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e, lastLinkCompEndRef.current)) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommand({ type: 'link', href: linkDraft });
                setSubPanel(null);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setSubPanel(null);
              }
            }}
            className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-surface-raised border border-border-subtle font-mono text-xs text-ink-primary focus:outline-none focus:border-action-bg"
          />
          <button
            type="button"
            onClick={() => {
              onCommand({ type: 'link', href: linkDraft });
              setSubPanel(null);
            }}
            className="min-h-7 px-2 py-1 rounded-lg font-semibold ink-btn-primary cursor-pointer shrink-0"
          >
            {rf.linkApplyBtn}
          </button>
          {formats.linkHref && (
            <button
              type="button"
              onClick={() => {
                onCommand({ type: 'unlink' });
                setSubPanel(null);
              }}
              className="min-h-7 px-2 py-1 rounded-lg text-accent-danger border border-border-subtle hover:bg-surface-raised cursor-pointer shrink-0"
            >
              {rf.linkRemoveBtn}
            </button>
          )}
        </div>
      )}
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
