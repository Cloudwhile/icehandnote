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
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type { ResolvedTheme } from '../../lib/theme';
import type { LocaleCode } from '../../lib/types';
import {
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
} from '../ui/Icons';
import { useToast } from '../ui/ToastProvider';
import {
  BlockGutterHandle,
  convertBlockType,
} from './blocks/BlockFloatingControls';
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

export function VisualBlockToolStrip({
  locale,
  blockCount,
  onInsertBlock,
  onUploadImageFile,
  uploadingImage = false,
}: VisualBlockToolStripProps) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const extFlow = EXT_COPY[locale].studio.flowEditor;

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
      const input = row?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-flow-input="primary"]',
      );
      if (!input) return;
      input.focus({ preventScroll: true });
      if (
        'setSelectionRange' in input &&
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

  const commitBlocks = useCallback(
    (next: VisualBlock[]) => {
      blocksRef.current = next;
      onChange(next);
    },
    [onChange],
  );

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
        commitBlocks(next);
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
          commitBlocks(next);
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
      className={`relative md:ps-11 space-y-2 rounded-xl transition-colors ${
        fileDragOver ? 'ring-2 ring-dashed ring-action-bg bg-action-subtle/20' : ''
      }`}
    >
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
              const next = [...displayBlocks];
              next[idx] = updatedCurrent;
              next.splice(idx + 1, 0, newAfter);
              if (newAfter.type === 'rough_diagram') {
                setFreshDiagramIds((prev) => new Set(prev).add(newAfter.id));
              }
              commitBlocks(next);
              scheduleFocus(newAfter.id, caret);
            },
            onReplaceBlock: (nextBlock, focus) => {
              const next = [...displayBlocks];
              next[idx] = nextBlock;
              if (nextBlock.type === 'rough_diagram') {
                setFreshDiagramIds((prev) => new Set(prev).add(nextBlock.id));
              }
              commitBlocks(next);
              scheduleFocus(nextBlock.id, focus?.caret ?? 'start');
            },
            onBackspaceAtStart: (remainingText) => {
              if (idx === 0) return;
              const prev = displayBlocks[idx - 1];
              if (prev.type === 'paragraph') {
                const caretPos = prev.text.length;
                const next = displayBlocks.filter((_, i) => i !== idx);
                next[idx - 1] = { ...prev, text: `${prev.text}${remainingText}` };
                commitBlocks(next);
                scheduleFocus(prev.id, caretPos);
                return;
              }
              if (prev.type === 'heading') {
                const caretPos = prev.text.length;
                const next = displayBlocks.filter((_, i) => i !== idx);
                next[idx - 1] = {
                  ...prev,
                  text: `${prev.text}${remainingText.replace(/\n+/g, ' ')}`,
                };
                commitBlocks(next);
                scheduleFocus(prev.id, caretPos);
                return;
              }
              if (!remainingText.trim()) {
                const next = displayBlocks.filter((_, i) => i !== idx);
                commitBlocks(next);
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
            commitBlocks(next);
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
            <div key={block.id} className="space-y-2">
              {isDropBefore && <div className="flow-drop-line" aria-hidden="true" />}

              <div
                data-flow-block-id={block.id}
                data-dragging={draggingBlockId === block.id ? 'true' : undefined}
                className="flow-block-row"
              >
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
                    commitBlocks(next);
                  }}
                  onMoveDown={() => {
                    if (idx >= displayBlocks.length - 1) return;
                    const next = [...displayBlocks];
                    const [m] = next.splice(idx, 1);
                    next.splice(idx + 1, 0, m);
                    commitBlocks(next);
                  }}
                  onDuplicate={() => {
                    const cloned = cloneVisualBlock(block);
                    const next = [...displayBlocks];
                    next.splice(idx + 1, 0, cloned);
                    commitBlocks(next);
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
                      commitBlocks([reset]);
                      scheduleFocus(reset.id, 0);
                    } else {
                      const prevTarget =
                        displayBlocks[Math.max(0, idx - 1)]?.id ??
                        displayBlocks[1]?.id;
                      commitBlocks(displayBlocks.filter((_, i) => i !== idx));
                      if (prevTarget) scheduleFocus(prevTarget, 'end');
                    }
                  }}
                  onTurnInto={(target) => {
                    const converted = convertBlockType(block, target);
                    updateCurrent(converted);
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
            row
              ?.querySelector<HTMLTextAreaElement>('[data-flow-input="primary"]')
              ?.focus({ preventScroll: true });
            return;
          }
          const created: VisualBlock = {
            id: createVisualId(),
            type: 'paragraph',
            text: '',
            marginNote: '',
          };
          commitBlocks([...displayBlocks, created]);
          scheduleFocus(created.id, 0);
        }}
        className="min-h-20 cursor-text"
      />
    </div>
  );
}
