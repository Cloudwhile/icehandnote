/*
 * Hand-Drawn Stationery Flow Block Editor (`VisualBlockEditor`) for IceHandNote Studio:
 * - Zero-frame borderless paper authoring directly matching reader typography & stickers.
 * - Cross-block keyboard flow (Enter split, Backspace merge, Arrow vertical navigation).
 * - Slash `/` command palette + Markdown prefix shortcuts.
 * - Clipboard screenshot `Ctrl+V` paste + OS image drag-and-drop auto-upload + multi-block Markdown paste.
 * - Single-axis pointer drag-handle reordering (`modern-web-guidance/drag-and-drop`) with `.flow-drop-line`.
 */

import {
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { runLayoutTransition, toViewTransitionIdent } from '../../lib/motion';
import {
  inspectActiveInlineFormats,
  setPersistentSelectionHighlight,
} from '../../lib/richInline';
import type { ResolvedTheme } from '../../lib/theme';
import type { LocaleCode, TextAlign, TextSizePreset } from '../../lib/types';
import {
  type AttachedPixelSticker,
  createDefaultVisualBlock,
  createVisualId,
  parseMarkdownToVisualBlocks,
  type VisualBlock,
} from '../../lib/visualBlocks';
import { FileUploadButton } from '../ui/FileUploadButton';
import {
  IconAlertCircle,
  IconCheckSquare,
  IconCode,
  IconDiagram,
  IconImage,
  IconInlineCode,
  IconKeyboardKey,
  IconPixelSticker,
} from '../ui/Icons';
import { useToast } from '../ui/ToastProvider';
import {
  BlockGutterHandle,
  convertBlockType,
  InlineFormatToolbar,
  KbdComboComposer,
} from './blocks/BlockFloatingControls';
import { BlockStickerLayer } from './blocks/BlockStickerLayer';
import {
  type ContextMenuTarget,
  EditorContextMenu,
} from './blocks/EditorContextMenu';
import { PixelStickerBlockBody } from './blocks/PixelStickerBlockBody';
import {
  executeRichCommandOnElement,
  focusRichEditable,
  type RichSelectionReport,
} from './blocks/RichEditable';
import { RoughDiagramBlockBody } from './blocks/RoughDiagramBlockBody';
import {
  AlertBlockBody,
  CodeCardBlockBody,
  ListBlockBody,
  StepsBlockBody,
} from './blocks/StructuredBlocks';
import {
  type FlowBlockHandlers,
  HeadingBlockBody,
  ImageBlockBody,
  ParagraphBlockBody,
  QuoteBlockBody,
  RawMarkdownBlockBody,
} from './blocks/TextAndMediaBlocks';

interface VisualBlockEditorProps {
  locale: LocaleCode;
  theme?: ResolvedTheme;
  blocks: VisualBlock[];
  onChange: (next: VisualBlock[]) => void;
  hideTopInserter?: boolean;
}

interface VisualBlockToolStripProps {
  locale: LocaleCode;
  blockCount: number;
  onInsertBlock: (kind: VisualBlock['type']) => void;
  onUploadImageFile: (file: File) => void;
  uploadingImage?: boolean;
}

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

function cloneVisualBlock(block: VisualBlock): VisualBlock {
  const id = createVisualId();
  const clonedStickers = block.stickers?.map((st) => ({
    ...st,
    id: createVisualId('stk'),
  }));
  switch (block.type) {
    case 'steps':
      return {
        ...block,
        id,
        items: block.items.map((it) => ({ ...it, id: createVisualId('st') })),
        ...(clonedStickers ? { stickers: clonedStickers } : {}),
      };
    case 'list':
      return {
        ...block,
        id,
        items: [...block.items],
        ...(clonedStickers ? { stickers: clonedStickers } : {}),
      };
    case 'rough_diagram':
      return {
        ...block,
        id,
        spec: {
          nodes: block.spec.nodes.map((n) => ({ ...n })),
          edges: block.spec.edges.map((e) => ({ ...e })),
        },
        ...(clonedStickers ? { stickers: clonedStickers } : {}),
      };
    default:
      return {
        ...block,
        id,
        ...(clonedStickers ? { stickers: clonedStickers } : {}),
      };
  }
}

export function VisualBlockToolStrip({
  locale,
  blockCount,
  onInsertBlock,
  onUploadImageFile,
  uploadingImage = false,
}: VisualBlockToolStripProps) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const extRich = EXT_COPY[locale].studio.richFormat;
  const extFlow = EXT_COPY[locale].studio.flowEditor;

  const dispatchRichQuickAction = (action: 'inline-code' | 'kbd-combo') => {
    window.dispatchEvent(
      new CustomEvent<'inline-code' | 'kbd-combo'>(
        'icehandnote:rich-quick-action',
        { detail: action },
      ),
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onInsertBlock('alert')}
        className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconAlertCircle className="w-3.5 h-3.5 text-accent-amber" />
        <span>{v.types.alert}</span>
      </button>

      <button
        type="button"
        onClick={() => onInsertBlock('steps')}
        className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconCheckSquare className="w-3.5 h-3.5 text-accent-ice" />
        <span>{copy.taskScopeParagraph}</span>
      </button>

      <button
        type="button"
        onClick={() => onInsertBlock('code_card')}
        className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconCode className="w-3.5 h-3.5 text-ink-secondary" />
        <span>{v.types.code_card}</span>
      </button>

      <FileUploadButton
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon,image/svg+xml"
        uploading={uploadingImage}
        label={v.types.image}
        uploadingLabel={v.imageUploading}
        icon={<IconImage className="w-3.5 h-3.5 text-link-ink" />}
        buttonClassName="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer disabled:opacity-60 transition-colors"
        onSelectFile={onUploadImageFile}
      />

      <button
        type="button"
        onClick={() => onInsertBlock('rough_diagram')}
        className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconDiagram className="w-3.5 h-3.5 text-ink-secondary" />
        <span>{v.types.rough_diagram}</span>
      </button>

      <button
        type="button"
        data-testid="insert-pixel-sticker-btn"
        onClick={() => onInsertBlock('pixel_sticker')}
        className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconPixelSticker className="w-3.5 h-3.5 text-accent-amber" />
        <span>+ {v.types.pixel_sticker}</span>
      </button>

      <button
        type="button"
        data-testid="toolstrip-inline-code-btn"
        onPointerDown={(e) => {
          if (e.button === 0) e.preventDefault();
        }}
        onClick={() => dispatchRichQuickAction('inline-code')}
        className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconInlineCode className="w-3.5 h-3.5 text-ink-secondary" />
        <span>+ {extRich.inlineCode}</span>
      </button>

      <button
        type="button"
        data-testid="toolstrip-kbd-btn"
        onPointerDown={(e) => {
          if (e.button === 0) e.preventDefault();
        }}
        onClick={() => dispatchRichQuickAction('kbd-combo')}
        className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconKeyboardKey className="w-3.5 h-3.5 text-link-ink" />
        <span>+ {extRich.kbdCombo}</span>
      </button>

      <span className="hidden xl:inline text-xs text-ink-muted ps-1">
        {extFlow.quickToolbarHint}
      </span>

      <span className="ms-auto text-xs font-mono text-ink-muted tabular-nums ps-1.5 whitespace-nowrap">
        {v.blockCount(blockCount)}
      </span>
    </div>
  );
}

export function VisualBlockEditor({
  locale,
  theme = 'light',
  blocks,
  onChange,
  hideTopInserter = false,
}: VisualBlockEditorProps) {
  const extStudio = EXT_COPY[locale].studio;
  const extFlow = extStudio.flowEditor;
  const toast = useToast();
  const langListId = useId();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fallbackParaIdRef = useRef<string>(createVisualId());
  const blocksRef = useRef<VisualBlock[]>(blocks);
  const pendingFocusRef = useRef<{
    blockId: string;
    caret?: number | 'start' | 'end';
  } | null>(null);
  const dragMovedRef = useRef(false);

  const [openMarginIds, setOpenMarginIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [freshDiagramIds, setFreshDiagramIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [fileDragOver, setFileDragOver] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dropGapIndex, setDropGapIndex] = useState<number | null>(null);
  const [uploadingQuickImg, setUploadingQuickImg] = useState(false);
  const [selectedSticker, setSelectedSticker] = useState<{
    blockId: string;
    stickerId: string;
  } | null>(null);
  const [contextMenuTarget, setContextMenuTarget] =
    useState<ContextMenuTarget | null>(null);
  const [activeSelection, setActiveSelection] =
    useState<RichSelectionReport | null>(null);
  const [standaloneKbdTarget, setStandaloneKbdTarget] = useState<{
    blockId: string;
    el: HTMLElement;
    range: Range | null;
    rect: { top: number; bottom: number; left: number };
  } | null>(null);
  const lastFocusedBlockIdRef = useRef<string | null>(null);
  const savedRightClickRangeRef = useRef<{
    blockId: string;
    el: HTMLElement;
    range: Range;
  } | null>(null);

  const displayBlocks: VisualBlock[] =
    blocks.length > 0
      ? blocks
      : [
          {
            id: fallbackParaIdRef.current,
            type: 'paragraph',
            text: '',
            marginNote: '',
          },
        ];
  blocksRef.current = displayBlocks;

  // Deselect active sticker gizmo when clicking outside stickers, toolbar, or context menu
  useEffect(() => {
    if (!selectedSticker) return;
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as HTMLElement | null;
      if (
        target?.closest('[data-sticker-id]') ||
        target?.closest('[data-testid="sticker-floating-toolbar"]') ||
        target?.closest('[data-testid="editor-context-menu"]')
      ) {
        return;
      }
      setSelectedSticker(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [selectedSticker]);

  const commitBlocks = useCallback(
    (next: VisualBlock[]) => {
      blocksRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const updateBlockAlign = useCallback(
    (blockId: string, align: TextAlign) => {
      const next = blocksRef.current.map((b) => {
        if (
          b.id === blockId &&
          (b.type === 'paragraph' ||
            b.type === 'heading' ||
            b.type === 'alert' ||
            b.type === 'quote')
        ) {
          return { ...b, align };
        }
        return b;
      });
      commitBlocks(next);
    },
    [commitBlocks],
  );

  const updateBlockSize = useCallback(
    (blockId: string, size: TextSizePreset) => {
      const next = blocksRef.current.map((b) => {
        if (
          b.id === blockId &&
          (b.type === 'paragraph' || b.type === 'alert' || b.type === 'quote')
        ) {
          return { ...b, size };
        }
        return b;
      });
      commitBlocks(next);
    },
    [commitBlocks],
  );

  // Listen to ZONE 1B toolstrip rich quick actions (`+ Inline code`, `+ Keyboard keys`)
  useEffect(() => {
    const onQuickAction = (ev: Event) => {
      const action = (ev as CustomEvent<'inline-code' | 'kbd-combo'>).detail;
      const root = containerRef.current;
      if (!root) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const focusedRich =
        activeEl?.closest<HTMLElement>('[data-rich-editable="true"]');
      const targetEl =
        (focusedRich && root.contains(focusedRich) ? focusedRich : null) ??
        (lastFocusedBlockIdRef.current
          ? root.querySelector<HTMLElement>(
              `[data-flow-block-id="${lastFocusedBlockIdRef.current}"] [data-rich-editable="true"]`,
            )
          : null) ??
        root.querySelector<HTMLElement>('[data-rich-editable="true"]');
      if (!targetEl) return;

      const blockId = targetEl.getAttribute('data-rich-block-id') ?? '';
      const sel = window.getSelection();
      const liveRange =
        sel &&
        sel.rangeCount > 0 &&
        targetEl.contains(sel.getRangeAt(0).commonAncestorContainer)
          ? sel.getRangeAt(0).cloneRange()
          : null;

      if (action === 'inline-code') {
        const nextRange = executeRichCommandOnElement(
          targetEl,
          liveRange,
          { type: 'inline-code' },
        );
        if (nextRange && !nextRange.collapsed) {
          const box = nextRange.getBoundingClientRect();
          setActiveSelection({
            blockId,
            el: targetEl,
            range: nextRange,
            rect: {
              top: box.top,
              bottom: box.bottom,
              left: box.left,
              width: box.width,
            },
            formats: inspectActiveInlineFormats(targetEl, nextRange),
          });
        } else {
          setActiveSelection(null);
        }
        return;
      }

      if (action === 'kbd-combo') {
        const box = targetEl.getBoundingClientRect();
        setStandaloneKbdTarget({
          blockId,
          el: targetEl,
          range: liveRange,
          rect: { top: box.top, bottom: box.bottom, left: box.left },
        });
      }
    };
    window.addEventListener('icehandnote:rich-quick-action', onQuickAction);
    return () =>
      window.removeEventListener('icehandnote:rich-quick-action', onQuickAction);
  }, []);

  // Dismiss floating selection toolbar / standalone `<kbd>` composer on outside click
  useEffect(() => {
    if (!activeSelection && !standaloneKbdTarget) return;
    const onOutsidePointer = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement | null;
      if (
        t?.closest('[data-testid="flow-inline-toolbar"]') ||
        t?.closest('[data-testid="editor-context-menu"]') ||
        t?.closest('[data-testid="kbd-composer-panel"]') ||
        t?.closest('.ink-menu-popover')
      ) {
        return;
      }
      if (standaloneKbdTarget) {
        setStandaloneKbdTarget(null);
      }
      if (
        activeSelection &&
        (!activeSelection.el.isConnected || !containerRef.current?.contains(t))
      ) {
        setActiveSelection(null);
      }
    };
    document.addEventListener('pointerdown', onOutsidePointer, true);
    return () =>
      document.removeEventListener('pointerdown', onOutsidePointer, true);
  }, [activeSelection, standaloneKbdTarget]);

  // Keep selected range highlighted via CSS Custom Highlight while context menu / kbd panel holds focus
  useEffect(() => {
    if (
      contextMenuTarget?.kind === 'block' &&
      contextMenuTarget.hasTextSelection &&
      savedRightClickRangeRef.current
    ) {
      setPersistentSelectionHighlight(savedRightClickRangeRef.current.range);
      return () => setPersistentSelectionHighlight(null);
    }
    if (standaloneKbdTarget?.range) {
      setPersistentSelectionHighlight(standaloneKbdTarget.range);
      return () => setPersistentSelectionHighlight(null);
    }
    return undefined;
  }, [contextMenuTarget, standaloneKbdTarget]);

  const attachStickerToBlock = (
    targetBlockId: string,
    coords?: { x: number; y: number },
    sprite = 'cat',
    extraUpdate?: (b: VisualBlock) => VisualBlock,
  ) => {
    const curBlocks = blocksRef.current;
    const resolvedId = curBlocks.some((b) => b.id === targetBlockId)
      ? targetBlockId
      : curBlocks[0]?.id;
    if (!resolvedId) return;

    const existingCount =
      curBlocks.find((b) => b.id === resolvedId)?.stickers?.length ?? 0;
    const newSticker: AttachedPixelSticker = {
      id: createVisualId('stk'),
      sprite,
      x:
        coords?.x ??
        Math.max(12, Math.min(92, 86 - (existingCount % 4) * 9)),
      y:
        coords?.y ??
        Math.max(12, Math.min(88, 20 + (existingCount % 3) * 18)),
      rotate: -6,
      scale: 1,
    };

    const next = curBlocks.map((b) => {
      if (b.id !== resolvedId) return b;
      const updated = extraUpdate ? extraUpdate(b) : b;
      return {
        ...updated,
        stickers: [...(updated.stickers ?? []), newSticker],
      };
    });
    onChange(next);
    setSelectedSticker({ blockId: resolvedId, stickerId: newSticker.id });
  };

  const updateStickerOnBlock = (
    targetBlockId: string,
    stickerId: string,
    patch: Partial<AttachedPixelSticker>,
  ) => {
    const next = blocksRef.current.map((b) => {
      if (b.id !== targetBlockId || !b.stickers) return b;
      return {
        ...b,
        stickers: b.stickers.map((st) =>
          st.id === stickerId ? { ...st, ...patch } : st,
        ),
      };
    });
    onChange(next);
  };

  const moveStickerBetweenBlocks = (
    fromBlockId: string,
    toBlockId: string,
    stickerId: string,
    coords: { x: number; y: number },
  ) => {
    const cur = blocksRef.current;
    const sourceBlock = cur.find((b) => b.id === fromBlockId);
    const moving = sourceBlock?.stickers?.find((s) => s.id === stickerId);
    if (!moving) return;

    const updatedSticker: AttachedPixelSticker = {
      ...moving,
      x: coords.x,
      y: coords.y,
    };

    const next = cur.map((b) => {
      if (b.id === fromBlockId && b.id === toBlockId) {
        return {
          ...b,
          stickers: (b.stickers ?? []).map((s) =>
            s.id === stickerId ? updatedSticker : s,
          ),
        };
      }
      if (b.id === fromBlockId) {
        return {
          ...b,
          stickers: (b.stickers ?? []).filter((s) => s.id !== stickerId),
        };
      }
      if (b.id === toBlockId) {
        return {
          ...b,
          stickers: [...(b.stickers ?? []), updatedSticker],
        };
      }
      return b;
    });
    onChange(next);
    setSelectedSticker({ blockId: toBlockId, stickerId });
  };

  const duplicateStickerOnBlock = (targetBlockId: string, stickerId: string) => {
    const cur = blocksRef.current;
    const host = cur.find((b) => b.id === targetBlockId);
    const orig = host?.stickers?.find((s) => s.id === stickerId);
    if (!orig) return;
    const copySt: AttachedPixelSticker = {
      ...orig,
      id: createVisualId('stk'),
      locked: false,
      x: Math.min(96, orig.x + 6),
      y: Math.min(96, orig.y + 8),
    };
    const next = cur.map((b) =>
      b.id === targetBlockId
        ? { ...b, stickers: [...(b.stickers ?? []), copySt] }
        : b,
    );
    onChange(next);
    setSelectedSticker({ blockId: targetBlockId, stickerId: copySt.id });
  };

  const deleteStickerOnBlock = (targetBlockId: string, stickerId: string) => {
    const next = blocksRef.current.map((b) =>
      b.id === targetBlockId && b.stickers
        ? { ...b, stickers: b.stickers.filter((s) => s.id !== stickerId) }
        : b,
    );
    onChange(next);
    setSelectedSticker((prev) =>
      prev && prev.stickerId === stickerId ? null : prev,
    );
  };

  const handleStickerMenuAction = (
    targetBlockId: string,
    stickerId: string,
    action:
      | 'toggle-lock'
      | 'rotate-left'
      | 'rotate-right'
      | 'flip'
      | 'scale-up'
      | 'scale-down'
      | 'reset'
      | 'toggle-layer'
      | 'duplicate'
      | 'delete',
  ) => {
    const host = blocksRef.current.find((b) => b.id === targetBlockId);
    const st = host?.stickers?.find((s) => s.id === stickerId);
    if (!st) return;

    const normDeg = (deg: number) => {
      let d = ((deg + 180) % 360 + 360) % 360 - 180;
      if (Object.is(d, -180)) d = 180;
      return Number(d.toFixed(1));
    };

    switch (action) {
      case 'toggle-lock': {
        const nextLocked = !st.locked;
        updateStickerOnBlock(targetBlockId, stickerId, { locked: nextLocked });
        if (nextLocked) {
          setSelectedSticker(null);
        } else {
          setSelectedSticker({ blockId: targetBlockId, stickerId });
        }
        break;
      }
      case 'rotate-left':
        updateStickerOnBlock(targetBlockId, stickerId, {
          rotate: normDeg(st.rotate - 15),
        });
        break;
      case 'rotate-right':
        updateStickerOnBlock(targetBlockId, stickerId, {
          rotate: normDeg(st.rotate + 15),
        });
        break;
      case 'flip':
        updateStickerOnBlock(targetBlockId, stickerId, { flip: !st.flip });
        break;
      case 'scale-up':
        updateStickerOnBlock(targetBlockId, stickerId, {
          scale: Number(Math.min(3.0, st.scale + 0.2).toFixed(2)),
        });
        break;
      case 'scale-down':
        updateStickerOnBlock(targetBlockId, stickerId, {
          scale: Number(Math.max(0.4, st.scale - 0.2).toFixed(2)),
        });
        break;
      case 'toggle-layer':
        updateStickerOnBlock(targetBlockId, stickerId, {
          layer: st.layer === 'behind' ? 'front' : 'behind',
        });
        break;
      case 'reset':
        updateStickerOnBlock(targetBlockId, stickerId, {
          rotate: 0,
          scale: 1,
          flip: false,
        });
        break;
      case 'duplicate':
        duplicateStickerOnBlock(targetBlockId, stickerId);
        break;
      case 'delete':
        deleteStickerOnBlock(targetBlockId, stickerId);
        break;
    }
  };

  const handleContainerContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const root = containerRef.current;
    if (!root) return;

    // 1. Hit-test all stickers by bounding box so even locked (`pointer-events: none`) stickers are caught
    const stickerEls = Array.from(
      root.querySelectorAll<HTMLElement>('[data-sticker-id]'),
    );
    for (let i = stickerEls.length - 1; i >= 0; i -= 1) {
      const el = stickerEls[i];
      const r = el.getBoundingClientRect();
      if (
        e.clientX >= r.left - 4 &&
        e.clientX <= r.right + 4 &&
        e.clientY >= r.top - 4 &&
        e.clientY <= r.bottom + 4
      ) {
        const stId = el.getAttribute('data-sticker-id');
        const bId = el.getAttribute('data-sticker-block-id');
        const host = blocksRef.current.find((b) => b.id === bId);
        const st = host?.stickers?.find((s) => s.id === stId);
        if (bId && st) {
          e.preventDefault();
          setContextMenuTarget({
            kind: 'sticker',
            x: e.clientX,
            y: e.clientY,
            blockId: bId,
            sticker: st,
          });
          return;
        }
      }
    }

    // 2. Hit-test block row (or fallback to last block when clicking canvas whitespace)
    const rowEl =
      (e.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-flow-block-id]',
      ) ?? root.querySelector<HTMLElement>('[data-flow-block-id]:last-of-type');
    if (!rowEl) return;

    const targetBlockId = rowEl.getAttribute('data-flow-block-id');
    const blockIdx = blocksRef.current.findIndex((b) => b.id === targetBlockId);
    const blk = blocksRef.current[blockIdx];
    if (!targetBlockId || !blk) return;

    const r = rowEl.getBoundingClientRect();
    const relX = Number(
      Math.max(
        6,
        Math.min(94, ((e.clientX - r.left) / Math.max(1, r.width)) * 100),
      ).toFixed(1),
    );
    const relY = Number(
      Math.max(
        10,
        Math.min(90, ((e.clientY - r.top) / Math.max(1, r.height)) * 100),
      ).toFixed(1),
    );

    const saved = savedRightClickRangeRef.current;
    let richSel = saved && rowEl.contains(saved.el) && !saved.range.collapsed
      ? saved
      : null;

    if (!richSel) {
      const liveSel = window.getSelection();
      if (liveSel && liveSel.rangeCount > 0 && !liveSel.isCollapsed) {
        const rng = liveSel.getRangeAt(0);
        const anc = rng.commonAncestorContainer;
        const richEl = (
          anc.nodeType === Node.ELEMENT_NODE
            ? (anc as HTMLElement)
            : anc.parentElement
        )?.closest<HTMLElement>('[data-rich-editable="true"]');
        if (richEl && rowEl.contains(richEl)) {
          richSel = {
            blockId: blk.id,
            el: richEl,
            range: rng.cloneRange(),
          };
          savedRightClickRangeRef.current = richSel;
        }
      }
    }

    const hasTextSelection = Boolean(richSel);
    const activeFormats = richSel
      ? inspectActiveInlineFormats(richSel.el, richSel.range)
      : undefined;
    if (richSel) {
      setPersistentSelectionHighlight(richSel.range);
    }

    const supportsAlign =
      blk.type === 'paragraph' ||
      blk.type === 'heading' ||
      blk.type === 'alert' ||
      blk.type === 'quote';
    const blockAlign: TextAlign =
      'align' in blk && blk.align ? blk.align : 'left';
    const supportsFontSize =
      blk.type === 'paragraph' || blk.type === 'alert' || blk.type === 'quote';
    const blockSize: TextSizePreset =
      (blk.type === 'paragraph' || blk.type === 'alert' || blk.type === 'quote') &&
      blk.size
        ? blk.size
        : 'base';

    const supportsMarginToggle =
      blk.type === 'paragraph' ||
      blk.type === 'code_card' ||
      blk.type === 'image';
    const hasMarginOpen =
      ('marginNote' in blk && Boolean(blk.marginNote.trim())) ||
      openMarginIds.has(blk.id);

    e.preventDefault();
    setContextMenuTarget({
      kind: 'block',
      x: e.clientX,
      y: e.clientY,
      blockId: blk.id,
      blockIndex: blockIdx,
      totalBlocks: blocksRef.current.length,
      blockType: blk.type,
      relX,
      relY,
      hasTextSelection,
      activeFormats,
      supportsAlign,
      blockAlign,
      supportsFontSize,
      blockSize,
      supportsMarginToggle,
      hasMarginOpen,
    });
  };

  const scheduleFocus = useCallback(
    (blockId: string, caret: number | 'start' | 'end' = 'start') => {
      pendingFocusRef.current = { blockId, caret };
    },
    [],
  );

  // Commit focus after DOM reconciles newly inserted/merged/converted blocks
  useEffect(() => {
    const req = pendingFocusRef.current;
    if (!req) return;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      const row = containerRef.current?.querySelector<HTMLElement>(
        `[data-flow-block-id="${req.blockId}"]`,
      );
      const input = row?.querySelector<HTMLElement>(
        '[data-flow-input="primary"]',
      );
      if (!input) return;
      if (input.getAttribute('data-rich-editable') === 'true') {
        focusRichEditable(input, req.caret);
        return;
      }
      input.focus({ preventScroll: true });
      if (
        (input instanceof HTMLInputElement ||
          input instanceof HTMLTextAreaElement) &&
        typeof input.setSelectionRange === 'function'
      ) {
        const len = input.value.length;
        const pos =
          req.caret === 'end'
            ? len
            : req.caret === 'start' || req.caret === undefined
              ? 0
              : Math.max(0, Math.min(req.caret, len));
        try {
          input.setSelectionRange(pos, pos);
        } catch {
          // ignore controls without text selection support
        }
      }
    });
  }, [displayBlocks]);

  const uploadAndInsertImage = useCallback(
    async (file: File, targetIndex: number, replaceEmptyTarget: boolean) => {
      const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
      const blobUrl = URL.createObjectURL(file);
      const imgBlock: VisualBlock = {
        id: createVisualId(),
        type: 'image',
        src: blobUrl,
        alt,
        caption: '',
        marginNote: '',
      };

      const cur = [...blocksRef.current];
      if (replaceEmptyTarget && cur[targetIndex]) {
        cur[targetIndex] = imgBlock;
      } else {
        const insertAt = Math.max(0, Math.min(cur.length, targetIndex + 1));
        cur.splice(insertAt, 0, imgBlock);
      }
      commitBlocks(cur);
      scheduleFocus(imgBlock.id, 'end');

      try {
        const uploaded = await api.uploadStudioMedia(file);
        const latest = blocksRef.current.map((b) =>
          b.id === imgBlock.id && b.type === 'image'
            ? { ...b, src: uploaded.url }
            : b,
        );
        commitBlocks(latest);
        toast.success(extStudio.imageUploadedMsg);
      } catch (err) {
        toast.error(err);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    },
    [commitBlocks, extStudio.imageUploadedMsg, scheduleFocus, toast],
  );

  const findTargetBlockIndexFromEvent = (target: EventTarget | null): number => {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-flow-block-id]',
    );
    if (!row) return displayBlocks.length - 1;
    const id = row.getAttribute('data-flow-block-id');
    const idx = displayBlocks.findIndex((b) => b.id === id);
    return idx >= 0 ? idx : displayBlocks.length - 1;
  };

  const handleContainerPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItem = items.find(
      (it) => it.kind === 'file' && it.type.startsWith('image/'),
    );
    const file =
      imgItem?.getAsFile() ??
      Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith('image/'),
      );

    if (file) {
      e.preventDefault();
      const idx = findTargetBlockIndexFromEvent(e.target);
      const targetBlock = displayBlocks[idx];
      const replaceEmpty =
        (targetBlock?.type === 'paragraph' && !targetBlock.text.trim()) ||
        (targetBlock?.type === 'image' && !targetBlock.src.trim());
      void uploadAndInsertImage(file, idx, replaceEmpty);
      return;
    }

    // Smart Markdown multi-block paste inside an empty flow paragraph
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const idx = findTargetBlockIndexFromEvent(e.target);
    const targetBlock = displayBlocks[idx];
    if (
      targetBlock?.type === 'paragraph' &&
      !targetBlock.text.trim() &&
      (text.includes('\n') ||
        /^(#{1,4}\s|-\s\[[ xX]\]\s|:::|```|>\s|!\[)/.test(text.trim()))
    ) {
      const parsed = parseMarkdownToVisualBlocks(text);
      if (parsed.length > 1 || (parsed.length === 1 && parsed[0].type !== 'paragraph')) {
        e.preventDefault();
        const next = [...displayBlocks];
        next.splice(idx, 1, ...parsed);
        runLayoutTransition(containerRef.current, () => {
          commitBlocks(next);
        });
        const last = parsed[parsed.length - 1];
        if (last) scheduleFocus(last.id, 'end');
      }
    }
  };

  const handleContainerDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      if (!fileDragOver) setFileDragOver(true);
    }
  };

  const handleContainerDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    const imageFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/'),
    );
    setFileDragOver(false);
    if (imageFiles.length === 0) return;

    e.preventDefault();
    const idx = findTargetBlockIndexFromEvent(e.target);
    const targetBlock = displayBlocks[idx];
    const replaceFirst =
      (targetBlock?.type === 'paragraph' && !targetBlock.text.trim()) ||
      (targetBlock?.type === 'image' && !targetBlock.src.trim());
    void uploadAndInsertImage(imageFiles[0], idx, replaceFirst);
  };

  // Single-axis vertical pointer drag reorder (`modern-web-guidance/drag-and-drop`)
  const handleStartBlockDrag = (
    blockId: string,
    startEvent: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (startEvent.button !== 0) return;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const handleEl = startEvent.currentTarget;
    const pointerId = startEvent.pointerId;
    const sourceIdx = blocksRef.current.findIndex((b) => b.id === blockId);
    if (sourceIdx === -1) return;

    let started = false;
    let currentDropGap: number | null = null;
    dragMovedRef.current = false;

    const computeGapFromClientY = (clientY: number): number => {
      const root = containerRef.current;
      if (!root) return sourceIdx;
      const rows = Array.from(
        root.querySelectorAll<HTMLElement>('[data-flow-block-id]'),
      );
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY < mid) {
          return i;
        }
      }
      return rows.length;
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onCancelDrag);
      document.removeEventListener('keydown', onKeyDown);
      containerRef.current?.classList.remove('flow-dragging');
      setDraggingBlockId(null);
      setDropGapIndex(null);
    };

    const onPointerMove = (moveEv: PointerEvent) => {
      if (moveEv.pointerId !== pointerId) return;
      if (!started) {
        const dist = Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY);
        if (dist < 5) return;
        started = true;
        dragMovedRef.current = true;
        try {
          handleEl.setPointerCapture(pointerId);
        } catch {
          // ignore if capture is unavailable
        }
        containerRef.current?.classList.add('flow-dragging');
        setDraggingBlockId(blockId);
      }
      const nextGap = computeGapFromClientY(moveEv.clientY);
      currentDropGap = nextGap;
      setDropGapIndex(nextGap);
    };

    const onPointerUp = (upEv: PointerEvent) => {
      if (upEv.pointerId !== pointerId) return;
      if (started && currentDropGap !== null) {
        const gap = currentDropGap;
        if (gap !== sourceIdx && gap !== sourceIdx + 1) {
          const next = [...blocksRef.current];
          const [moved] = next.splice(sourceIdx, 1);
          const targetIdx = gap > sourceIdx ? gap - 1 : gap;
          next.splice(targetIdx, 0, moved);
          runLayoutTransition(containerRef.current, () => {
            commitBlocks(next);
          });
          scheduleFocus(moved.id, 'start');
        }
      }
      cleanup();
    };

    const onCancelDrag = (cancelEv: PointerEvent) => {
      if (cancelEv.pointerId !== pointerId) return;
      dragMovedRef.current = false;
      cleanup();
    };

    const onKeyDown = (keyEv: KeyboardEvent) => {
      if (keyEv.key === 'Escape') {
        dragMovedRef.current = false;
        cleanup();
      }
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onCancelDrag);
    document.addEventListener('keydown', onKeyDown);
  };

  let runningTaskOffset = 0;
  let runningSectionNumber = 0;

  const selectedSelectionBlock = activeSelection
    ? displayBlocks.find((b) => b.id === activeSelection.blockId)
    : undefined;
  const selectionSupportsAlign =
    selectedSelectionBlock?.type === 'paragraph' ||
    selectedSelectionBlock?.type === 'heading' ||
    selectedSelectionBlock?.type === 'alert' ||
    selectedSelectionBlock?.type === 'quote';
  const selectionBlockAlign: TextAlign =
    selectedSelectionBlock &&
    'align' in selectedSelectionBlock &&
    selectedSelectionBlock.align
      ? selectedSelectionBlock.align
      : 'left';
  const selectionSupportsFontSize =
    selectedSelectionBlock?.type === 'paragraph' ||
    selectedSelectionBlock?.type === 'alert' ||
    selectedSelectionBlock?.type === 'quote';
  const selectionBlockSize: TextSizePreset =
    selectedSelectionBlock &&
    (selectedSelectionBlock.type === 'paragraph' ||
      selectedSelectionBlock.type === 'alert' ||
      selectedSelectionBlock.type === 'quote') &&
    selectedSelectionBlock.size
      ? selectedSelectionBlock.size
      : 'base';

  return (
    <div
      ref={containerRef}
      onPaste={handleContainerPaste}
      onDragOver={handleContainerDragOver}
      onDragLeave={(e) => {
        if (
          e.currentTarget === e.target ||
          !e.currentTarget.contains(e.relatedTarget as Node | null)
        ) {
          setFileDragOver(false);
        }
      }}
      onDrop={handleContainerDrop}
      onPointerDownCapture={(e) => {
        if (e.button !== 2) return;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const rng = sel.getRangeAt(0);
          const anc = rng.commonAncestorContainer;
          const richEl = (
            anc.nodeType === Node.ELEMENT_NODE
              ? (anc as HTMLElement)
              : anc.parentElement
          )?.closest<HTMLElement>('[data-rich-editable="true"]');
          if (richEl && containerRef.current?.contains(richEl)) {
            savedRightClickRangeRef.current = {
              blockId: richEl.getAttribute('data-rich-block-id') ?? '',
              el: richEl,
              range: rng.cloneRange(),
            };
            return;
          }
        }
        savedRightClickRangeRef.current = null;
      }}
      onContextMenu={handleContainerContextMenu}
      className={`relative md:ps-11 space-y-2 rounded-xl transition-colors ${
        fileDragOver ? 'ring-2 ring-dashed ring-action-bg bg-action-subtle/20' : ''
      }`}
    >
      {activeSelection && !contextMenuTarget && !standaloneKbdTarget && (
        <InlineFormatToolbar
          locale={locale}
          rect={activeSelection.rect}
          formats={activeSelection.formats}
          supportsAlign={selectionSupportsAlign}
          blockAlign={selectionBlockAlign}
          supportsFontSize={selectionSupportsFontSize}
          blockSize={selectionBlockSize}
          savedRange={activeSelection.range}
          onCommand={(cmd) => {
            const nextRange = executeRichCommandOnElement(
              activeSelection.el,
              activeSelection.range,
              cmd,
            );
            if (nextRange && !nextRange.collapsed) {
              const box = nextRange.getBoundingClientRect();
              setActiveSelection({
                ...activeSelection,
                range: nextRange,
                rect:
                  box.width > 0 || box.height > 0
                    ? {
                        top: box.top,
                        bottom: box.bottom,
                        left: box.left,
                        width: box.width,
                      }
                    : activeSelection.rect,
                formats: inspectActiveInlineFormats(
                  activeSelection.el,
                  nextRange,
                ),
              });
            } else {
              setActiveSelection(null);
            }
          }}
          onChangeAlign={(align) =>
            updateBlockAlign(activeSelection.blockId, align)
          }
          onChangeBlockSize={(size) =>
            updateBlockSize(activeSelection.blockId, size)
          }
          onRequestDismiss={() => setActiveSelection(null)}
        />
      )}

      {standaloneKbdTarget && (
        <div
          className="fixed z-60 ui-popover-enter"
          style={{
            top: `${Math.round(
              Math.max(
                12,
                Math.min(
                  (typeof window !== 'undefined' ? window.innerHeight : 800) - 220,
                  standaloneKbdTarget.rect.bottom + 8,
                ),
              ),
            )}px`,
            left: `${Math.round(
              Math.max(
                12,
                Math.min(
                  (typeof window !== 'undefined' ? window.innerWidth : 1280) - 332,
                  standaloneKbdTarget.rect.left,
                ),
              ),
            )}px`,
          }}
        >
          <KbdComboComposer
            locale={locale}
            onInsert={(keys) => {
              const target = standaloneKbdTarget;
              const nextRange = executeRichCommandOnElement(
                target.el,
                target.range,
                { type: 'kbd-combo', keys },
              );
              setStandaloneKbdTarget(null);
              requestAnimationFrame(() => {
                target.el.focus({ preventScroll: true });
                if (nextRange) {
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(nextRange);
                }
              });
            }}
            onCancel={() => {
              const target = standaloneKbdTarget;
              setStandaloneKbdTarget(null);
              requestAnimationFrame(() =>
                target.el.focus({ preventScroll: true }),
              );
            }}
          />
        </div>
      )}
      <datalist id={langListId}>
        {COMMON_LANGUAGES.map((lang) => (
          <option key={lang} value={lang} />
        ))}
      </datalist>

      {fileDragOver && (
        <div className="sticky top-16 z-20 flex justify-center pointer-events-none">
          <span className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-action-bg text-action-fg shadow-md">
            {extFlow.dropImageHint}
          </span>
        </div>
      )}

      {!hideTopInserter && (
        <div className="rounded-xl p-2.5 bg-surface-raised border border-border-subtle mb-4">
          <VisualBlockToolStrip
            locale={locale}
            blockCount={displayBlocks.length}
            uploadingImage={uploadingQuickImg}
            onInsertBlock={(kind) => {
              if (kind === 'pixel_sticker') {
                const targetId =
                  (lastFocusedBlockIdRef.current &&
                  displayBlocks.some(
                    (b) => b.id === lastFocusedBlockIdRef.current,
                  )
                    ? lastFocusedBlockIdRef.current
                    : displayBlocks[0]?.id) ?? '';
                attachStickerToBlock(targetId);
                return;
              }
              const created = createDefaultVisualBlock(kind);
              if (created.type === 'rough_diagram') {
                setFreshDiagramIds((prev) => new Set(prev).add(created.id));
              }
              commitBlocks([...displayBlocks, created]);
              scheduleFocus(created.id, 'start');
            }}
            onUploadImageFile={(file) => {
              setUploadingQuickImg(true);
              void uploadAndInsertImage(
                file,
                displayBlocks.length - 1,
                false,
              ).finally(() => setUploadingQuickImg(false));
            }}
          />
        </div>
      )}

      <div className="space-y-3">
        {displayBlocks.map((block, idx) => {
          const taskStartOffset = runningTaskOffset;
          if (block.type === 'steps') {
            runningTaskOffset += block.items.length;
          }
          if (block.type === 'heading') {
            runningSectionNumber += 1;
          }
          const curSectionNum = runningSectionNumber;

          const marginOpen =
            ('marginNote' in block && Boolean(block.marginNote.trim())) ||
            openMarginIds.has(block.id);

          const flowHandlers: FlowBlockHandlers = {
            onCommitAndInsertAfter: (updatedCurrent, newAfter, caret = 'start') => {
              if (newAfter.type === 'pixel_sticker') {
                attachStickerToBlock(
                  updatedCurrent.id,
                  undefined,
                  newAfter.sprite,
                  () => updatedCurrent,
                );
                scheduleFocus(updatedCurrent.id, 'end');
                return;
              }
              const next = [...displayBlocks];
              next[idx] = updatedCurrent;
              next.splice(idx + 1, 0, newAfter);
              if (newAfter.type === 'rough_diagram') {
                setFreshDiagramIds((prev) => new Set(prev).add(newAfter.id));
              }
              runLayoutTransition(containerRef.current, () => {
                commitBlocks(next);
              });
              scheduleFocus(newAfter.id, caret);
            },
            onReplaceBlock: (nextBlock, focus) => {
              if (nextBlock.type === 'pixel_sticker') {
                const restored: VisualBlock =
                  block.type === 'paragraph' ? { ...block, text: '' } : block;
                attachStickerToBlock(
                  block.id,
                  undefined,
                  nextBlock.sprite,
                  () => restored,
                );
                return;
              }
              const next = [...displayBlocks];
              next[idx] = nextBlock;
              if (nextBlock.type === 'rough_diagram') {
                setFreshDiagramIds((prev) => new Set(prev).add(nextBlock.id));
              }
              runLayoutTransition(containerRef.current, () => {
                commitBlocks(next);
              });
              scheduleFocus(nextBlock.id, focus?.caret ?? 'start');
            },
            onBackspaceAtStart: (remainingText) => {
              if (idx === 0) return;
              const prev = displayBlocks[idx - 1];
              if (prev.type === 'paragraph') {
                const prevRichEl = containerRef.current?.querySelector<HTMLElement>(
                  `[data-flow-block-id="${prev.id}"] [data-flow-input="primary"]`,
                );
                const caretPos = prevRichEl
                  ? (prevRichEl.textContent ?? '').replace(/\u200B/g, '').length
                  : prev.text.length;
                const next = displayBlocks.filter((_, i) => i !== idx);
                next[idx - 1] = { ...prev, text: `${prev.text}${remainingText}` };
                runLayoutTransition(containerRef.current, () => {
                  commitBlocks(next);
                });
                scheduleFocus(prev.id, caretPos);
                return;
              }
              if (prev.type === 'heading') {
                const prevRichEl = containerRef.current?.querySelector<HTMLElement>(
                  `[data-flow-block-id="${prev.id}"] [data-flow-input="primary"]`,
                );
                const caretPos = prevRichEl
                  ? (prevRichEl.textContent ?? '').replace(/\u200B/g, '').length
                  : prev.text.length;
                const next = displayBlocks.filter((_, i) => i !== idx);
                next[idx - 1] = {
                  ...prev,
                  text: `${prev.text}${remainingText.replace(/\n+/g, ' ')}`,
                };
                runLayoutTransition(containerRef.current, () => {
                  commitBlocks(next);
                });
                scheduleFocus(prev.id, caretPos);
                return;
              }
              if (!remainingText.trim()) {
                const next = displayBlocks.filter((_, i) => i !== idx);
                runLayoutTransition(containerRef.current, () => {
                  commitBlocks(next);
                });
                scheduleFocus(prev.id, 'end');
              } else {
                scheduleFocus(prev.id, 'end');
              }
            },
            onMoveFocusVertical: (direction) => {
              const targetIdx = idx + direction;
              if (targetIdx < 0 || targetIdx >= displayBlocks.length) return;
              scheduleFocus(
                displayBlocks[targetIdx].id,
                direction < 0 ? 'end' : 'start',
              );
            },
            onSelectionReport: setActiveSelection,
            onOpenKbdComposer: (bId, el) => {
              const sel = window.getSelection();
              const rng =
                sel &&
                sel.rangeCount > 0 &&
                el.contains(sel.getRangeAt(0).commonAncestorContainer)
                  ? sel.getRangeAt(0).cloneRange()
                  : null;
              const box = el.getBoundingClientRect();
              setStandaloneKbdTarget({
                blockId: bId,
                el,
                range: rng,
                rect: { top: box.top, bottom: box.bottom, left: box.left },
              });
            },
            marginNoteOpen: marginOpen,
            onOpenMarginNote: () => {
              setOpenMarginIds((prev) => new Set(prev).add(block.id));
            },
            onCloseMarginNote: () => {
              setOpenMarginIds((prev) => {
                const next = new Set(prev);
                next.delete(block.id);
                return next;
              });
            },
          };

          const commitBlocksAnimated = (nextBlocks: VisualBlock[]) => {
            runLayoutTransition(containerRef.current, () => {
              commitBlocks(nextBlocks);
            });
          };

          const updateCurrent = (nextBlock: VisualBlock) => {
            const next = [...displayBlocks];
            next[idx] = nextBlock;
            commitBlocks(next);
          };

          const insertEmptyParaBelow = () => {
            const nextPara: VisualBlock = {
              id: createVisualId(),
              type: 'paragraph',
              text: '',
              marginNote: '',
            };
            const next = [...displayBlocks];
            next.splice(idx + 1, 0, nextPara);
            commitBlocksAnimated(next);
            scheduleFocus(nextPara.id, 0);
          };

          const isDropBefore =
            draggingBlockId !== null &&
            dropGapIndex === idx &&
            idx !== displayBlocks.findIndex((b) => b.id === draggingBlockId) &&
            idx !== displayBlocks.findIndex((b) => b.id === draggingBlockId) + 1;

          const showDropAtEnd =
            draggingBlockId !== null &&
            idx === displayBlocks.length - 1 &&
            dropGapIndex === displayBlocks.length &&
            idx !== displayBlocks.findIndex((b) => b.id === draggingBlockId);

          const supportsMarginToggle =
            block.type === 'paragraph' ||
            block.type === 'code_card' ||
            block.type === 'image';

          return (
            <div
              key={block.id}
              className="space-y-2 vt-layout-item"
              style={{
                viewTransitionName: draggingBlockId
                  ? undefined
                  : toViewTransitionIdent('blk', block.id),
              }}
            >
              {isDropBefore && <div className="flow-drop-line" aria-hidden="true" />}

              <div
                data-flow-block-id={block.id}
                data-dragging={draggingBlockId === block.id ? 'true' : undefined}
                onFocusCapture={() => {
                  lastFocusedBlockIdRef.current = block.id;
                }}
                className="flow-block-row relative group/block"
              >
                <BlockStickerLayer
                  blockId={block.id}
                  stickers={block.stickers ?? []}
                  locale={locale}
                  selectedStickerId={
                    selectedSticker?.blockId === block.id
                      ? selectedSticker.stickerId
                      : null
                  }
                  onSelectSticker={(stId) =>
                    setSelectedSticker(
                      stId ? { blockId: block.id, stickerId: stId } : null,
                    )
                  }
                  onUpdateSticker={(stId, patch) =>
                    updateStickerOnBlock(block.id, stId, patch)
                  }
                  onMoveStickerToBlock={moveStickerBetweenBlocks}
                  onDuplicateSticker={(stId) =>
                    duplicateStickerOnBlock(block.id, stId)
                  }
                  onDeleteSticker={(stId) =>
                    deleteStickerOnBlock(block.id, stId)
                  }
                />

                <BlockGutterHandle
                  index={idx}
                  total={displayBlocks.length}
                  block={block}
                  locale={locale}
                  hasMarginNoteOpen={marginOpen}
                  dragMovedRef={dragMovedRef}
                  onInsertBelow={insertEmptyParaBelow}
                  onDragPointerDown={(ev) => handleStartBlockDrag(block.id, ev)}
                  onMoveUp={() => {
                    if (idx === 0) return;
                    const next = [...displayBlocks];
                    const [m] = next.splice(idx, 1);
                    next.splice(idx - 1, 0, m);
                    commitBlocksAnimated(next);
                  }}
                  onMoveDown={() => {
                    if (idx >= displayBlocks.length - 1) return;
                    const next = [...displayBlocks];
                    const [m] = next.splice(idx, 1);
                    next.splice(idx + 1, 0, m);
                    commitBlocksAnimated(next);
                  }}
                  onDuplicate={() => {
                    const cloned = cloneVisualBlock(block);
                    const next = [...displayBlocks];
                    next.splice(idx + 1, 0, cloned);
                    commitBlocksAnimated(next);
                    scheduleFocus(cloned.id, 'end');
                  }}
                  onDelete={() => {
                    if (displayBlocks.length <= 1) {
                      const reset: VisualBlock = {
                        id: block.id,
                        type: 'paragraph',
                        text: '',
                        marginNote: '',
                      };
                      commitBlocksAnimated([reset]);
                      scheduleFocus(reset.id, 0);
                    } else {
                      const prevTarget =
                        displayBlocks[Math.max(0, idx - 1)]?.id ??
                        displayBlocks[1]?.id;
                      commitBlocksAnimated(displayBlocks.filter((_, i) => i !== idx));
                      if (prevTarget) scheduleFocus(prevTarget, 'end');
                    }
                  }}
                  onTurnInto={(target) => {
                    const converted = convertBlockType(block, target);
                    const next = [...displayBlocks];
                    next[idx] = converted;
                    commitBlocksAnimated(next);
                    scheduleFocus(converted.id, 'end');
                  }}
                  onToggleMarginNote={
                    supportsMarginToggle
                      ? () => {
                          if (marginOpen) {
                            setOpenMarginIds((prev) => {
                              const next = new Set(prev);
                              next.delete(block.id);
                              return next;
                            });
                            if ('marginNote' in block && block.marginNote) {
                              updateCurrent({ ...block, marginNote: '' });
                            }
                          } else {
                            setOpenMarginIds((prev) =>
                              new Set(prev).add(block.id),
                            );
                          }
                        }
                      : undefined
                  }
                />

                {block.type === 'paragraph' && (
                  <ParagraphBlockBody
                    block={block}
                    locale={locale}
                    index={idx}
                    totalBlocks={displayBlocks.length}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'heading' && (
                  <HeadingBlockBody
                    block={block}
                    locale={locale}
                    sectionNumber={curSectionNum}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'steps' && (
                  <StepsBlockBody
                    block={block}
                    locale={locale}
                    taskStartOffset={taskStartOffset}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'alert' && (
                  <AlertBlockBody
                    block={block}
                    locale={locale}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'code_card' && (
                  <CodeCardBlockBody
                    block={block}
                    locale={locale}
                    langListId={langListId}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'list' && (
                  <ListBlockBody
                    block={block}
                    locale={locale}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'quote' && (
                  <QuoteBlockBody
                    block={block}
                    locale={locale}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'rough_diagram' && (
                  <RoughDiagramBlockBody
                    block={block}
                    locale={locale}
                    theme={theme}
                    initiallyExpanded={freshDiagramIds.has(block.id)}
                    onUpdate={(next) => updateCurrent(next)}
                  />
                )}
                {block.type === 'pixel_sticker' && (
                  <PixelStickerBlockBody
                    block={block}
                    locale={locale}
                    onUpdate={(next) => updateCurrent(next)}
                  />
                )}
                {block.type === 'image' && (
                  <ImageBlockBody
                    block={block}
                    locale={locale}
                    onUpdate={(next) => updateCurrent(next)}
                    flow={flowHandlers}
                  />
                )}
                {block.type === 'raw_markdown' && (
                  <RawMarkdownBlockBody
                    block={block}
                    onUpdate={(next) => updateCurrent(next)}
                  />
                )}
              </div>

              {showDropAtEnd && (
                <div className="flow-drop-line" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      {/* Notion-style bottom click pad: focuses trailing blank paragraph or appends one */}
      <div
        onClick={() => {
          const last = displayBlocks[displayBlocks.length - 1];
          if (last && last.type === 'paragraph' && !last.text.trim()) {
            scheduleFocus(last.id, 0);
            const row = containerRef.current?.querySelector<HTMLElement>(
              `[data-flow-block-id="${last.id}"]`,
            );
            const primary = row?.querySelector<HTMLElement>(
              '[data-flow-input="primary"]',
            );
            if (primary) {
              if (primary.getAttribute('data-rich-editable') === 'true') {
                focusRichEditable(primary, 0);
              } else {
                primary.focus({ preventScroll: true });
              }
            }
            return;
          }
          const created: VisualBlock = {
            id: createVisualId(),
            type: 'paragraph',
            text: '',
            marginNote: '',
          };
          runLayoutTransition(containerRef.current, () => {
            commitBlocks([...displayBlocks, created]);
          });
          scheduleFocus(created.id, 0);
        }}
        className="min-h-20 cursor-text"
      />

      <EditorContextMenu
        locale={locale}
        target={contextMenuTarget}
        onClose={() => setContextMenuTarget(null)}
        onPasteStickerHere={(blockId, coords) =>
          attachStickerToBlock(blockId, coords)
        }
        onStickerAction={handleStickerMenuAction}
        onRichCommand={(cmd) => {
          const saved = savedRightClickRangeRef.current;
          const rowEl =
            contextMenuTarget?.kind === 'block'
              ? containerRef.current?.querySelector<HTMLElement>(
                  `[data-flow-block-id="${contextMenuTarget.blockId}"]`,
                )
              : null;
          const richEl =
            (saved?.el?.isConnected ? saved.el : null) ??
            rowEl?.querySelector<HTMLElement>('[data-rich-editable="true"]');
          if (!richEl) return;

          const nextRange = executeRichCommandOnElement(
            richEl,
            saved?.range ?? null,
            cmd,
          );
          savedRightClickRangeRef.current = nextRange
            ? {
                blockId: richEl.getAttribute('data-rich-block-id') ?? '',
                el: richEl,
                range: nextRange,
              }
            : null;
          requestAnimationFrame(() => {
            richEl.focus({ preventScroll: true });
            if (nextRange) {
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(nextRange);
              if (!nextRange.collapsed) {
                const box = nextRange.getBoundingClientRect();
                setActiveSelection({
                  blockId: richEl.getAttribute('data-rich-block-id') ?? '',
                  el: richEl,
                  range: nextRange,
                  rect:
                    box.width > 0 || box.height > 0
                      ? {
                          top: box.top,
                          bottom: box.bottom,
                          left: box.left,
                          width: box.width,
                        }
                      : richEl.getBoundingClientRect(),
                  formats: inspectActiveInlineFormats(richEl, nextRange),
                });
              } else {
                setActiveSelection(null);
              }
            } else {
              setActiveSelection(null);
            }
          });
        }}
        onOpenKbdComposer={() => {
          const saved = savedRightClickRangeRef.current;
          const targetBlockId =
            contextMenuTarget?.kind === 'block'
              ? contextMenuTarget.blockId
              : saved?.blockId ?? displayBlocks[0]?.id ?? '';
          const richEl =
            (saved?.el?.isConnected ? saved.el : null) ??
            containerRef.current?.querySelector<HTMLElement>(
              `[data-flow-block-id="${targetBlockId}"] [data-rich-editable="true"]`,
            );
          if (!richEl) return;
          const box = richEl.getBoundingClientRect();
          setStandaloneKbdTarget({
            blockId: targetBlockId,
            el: richEl,
            range: saved?.range ?? null,
            rect: { top: box.top, bottom: box.bottom, left: box.left },
          });
        }}
        onChangeBlockAlign={(blockId, align) =>
          updateBlockAlign(blockId, align)
        }
        onChangeBlockSize={(blockId, size) => updateBlockSize(blockId, size)}
        onInsertBlockBelow={(afterBlockId, kind) => {
          const cur = blocksRef.current;
          const foundIdx = cur.findIndex((b) => b.id === afterBlockId);
          const idx = foundIdx >= 0 ? foundIdx : cur.length - 1;
          const created = createDefaultVisualBlock(kind);
          if (created.type === 'rough_diagram') {
            setFreshDiagramIds((prev) => new Set(prev).add(created.id));
          }
          const next = [...cur];
          next.splice(idx + 1, 0, created);
          runLayoutTransition(containerRef.current, () => {
            commitBlocks(next);
          });
          scheduleFocus(created.id, 'start');
        }}
        onBlockAction={(blockId, action) => {
          const cur = blocksRef.current;
          const idx = cur.findIndex((b) => b.id === blockId);
          const blk = cur[idx];
          if (idx < 0 || !blk) return;

          if (action === 'move-up') {
            if (idx === 0) return;
            const next = [...cur];
            const [moved] = next.splice(idx, 1);
            next.splice(idx - 1, 0, moved);
            runLayoutTransition(containerRef.current, () => {
              commitBlocks(next);
            });
            return;
          }
          if (action === 'move-down') {
            if (idx >= cur.length - 1) return;
            const next = [...cur];
            const [moved] = next.splice(idx, 1);
            next.splice(idx + 1, 0, moved);
            runLayoutTransition(containerRef.current, () => {
              commitBlocks(next);
            });
            return;
          }
          if (action === 'duplicate') {
            const cloned = cloneVisualBlock(blk);
            const next = [...cur];
            next.splice(idx + 1, 0, cloned);
            runLayoutTransition(containerRef.current, () => {
              commitBlocks(next);
            });
            scheduleFocus(cloned.id, 'end');
            return;
          }
          if (action === 'delete') {
            if (cur.length <= 1) {
              const reset: VisualBlock = {
                id: blk.id,
                type: 'paragraph',
                text: '',
                marginNote: '',
              };
              runLayoutTransition(containerRef.current, () => {
                commitBlocks([reset]);
              });
              scheduleFocus(reset.id, 0);
            } else {
              const prevTarget = cur[Math.max(0, idx - 1)]?.id ?? cur[1]?.id;
              const next = cur.filter((_, i) => i !== idx);
              runLayoutTransition(containerRef.current, () => {
                commitBlocks(next);
              });
              if (prevTarget) scheduleFocus(prevTarget, 'end');
            }
            return;
          }
          if (
            action === 'toggle-margin' &&
            (blk.type === 'paragraph' ||
              blk.type === 'code_card' ||
              blk.type === 'image')
          ) {
            const isOpen =
              Boolean(blk.marginNote.trim()) || openMarginIds.has(blk.id);
            if (isOpen) {
              setOpenMarginIds((prev) => {
                const next = new Set(prev);
                next.delete(blk.id);
                return next;
              });
              if (blk.marginNote) {
                commitBlocks(
                  cur.map((b) =>
                    b.id === blk.id && 'marginNote' in b
                      ? { ...b, marginNote: '' }
                      : b,
                  ),
                );
              }
            } else {
              setOpenMarginIds((prev) => new Set(prev).add(blk.id));
            }
          }
        }}
      />
    </div>
  );
}
