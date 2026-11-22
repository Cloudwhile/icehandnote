/*
 * Free-Posable & Element-Locked Pixel Sticker Layer for VisualBlockEditor (`modern-web-guidance/drag`):
 * - Unlocked stickers support smooth pointer-capture body drag across blocks, top rotate handle,
 *   bottom-right continuous scale handle, keyboard arrow nudging, and floating quick controls.
 * - Locked stickers (`locked: true`) surrender pointer events (`pointer-events: none`) so prose
 *   and inputs underneath remain completely editable, with hover unlock & right-click context support.
 */

import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { LocaleCode } from '../../../lib/types';
import type { AttachedPixelSticker } from '../../../lib/visualBlocks';
import {
  ALL_PIXEL_SPRITE_IDS,
  normalizePixelSpriteId,
  PixelStickerById,
} from '../../notebook/PixelStickers';
import { IconCopy, IconLock, IconTrash, IconUnlock } from '../../ui/Icons';

interface BlockStickerLayerProps {
  blockId: string;
  stickers: AttachedPixelSticker[];
  locale: LocaleCode;
  selectedStickerId: string | null;
  onSelectSticker: (stickerId: string | null) => void;
  onUpdateSticker: (
    stickerId: string,
    patch: Partial<AttachedPixelSticker>,
  ) => void;
  onMoveStickerToBlock: (
    fromBlockId: string,
    toBlockId: string,
    stickerId: string,
    coords: { x: number; y: number },
  ) => void;
  onDuplicateSticker: (stickerId: string) => void;
  onDeleteSticker: (stickerId: string) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(d, -180)) d = 180;
  return Number(d.toFixed(1));
}

export function BlockStickerLayer({
  blockId,
  stickers,
  locale,
  selectedStickerId,
  onSelectSticker,
  onUpdateSticker,
  onMoveStickerToBlock,
  onDuplicateSticker,
  onDeleteSticker,
}: BlockStickerLayerProps) {
  const ext = EXT_COPY[locale].studio.pixelSticker;
  const blockTitle = UI_COPY[locale].studio.visual.types.pixel_sticker;

  const [dragState, setDragState] = useState<{
    stickerId: string;
    dx: number;
    dy: number;
  } | null>(null);

  const bodyDragRef = useRef<{
    stickerId: string;
    pointerId: number;
    startX: number;
    startY: number;
    origCenterX: number;
    origCenterY: number;
    moved: boolean;
    lastDropEl: HTMLElement | null;
  } | null>(null);

  const rotateDragRef = useRef<{
    stickerId: string;
    cx: number;
    cy: number;
    baseDeg: number;
  } | null>(null);

  const scaleDragRef = useRef<{
    stickerId: string;
    cx: number;
    cy: number;
    startDist: number;
    startScale: number;
  } | null>(null);

  if (stickers.length === 0) return null;

  const clearDropHighlight = () => {
    if (bodyDragRef.current?.lastDropEl) {
      bodyDragRef.current.lastDropEl.removeAttribute('data-sticker-drop-target');
      bodyDragRef.current.lastDropEl = null;
    }
  };

  const findHostBlockAtPoint = (
    clientX: number,
    clientY: number,
  ): HTMLElement | null => {
    const candidates = document.querySelectorAll<HTMLElement>('[data-flow-block-id]');
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (
        clientX >= r.left - 8 &&
        clientX <= r.right + 8 &&
        clientY >= r.top - 12 &&
        clientY <= r.bottom + 12
      ) {
        return el;
      }
    }
    return null;
  };

  return (
    <>
      {stickers.map((st) => {
        const sprite = normalizePixelSpriteId(st.sprite);
        const isSelected = !st.locked && selectedStickerId === st.id;
        const activeOffset =
          dragState && dragState.stickerId === st.id
            ? ` translate3d(${dragState.dx}px, ${dragState.dy}px, 0)`
            : '';
        const x = clamp(st.x, -25, 125);
        const y = clamp(st.y, -60, 160);
        const rotate = clamp(st.rotate, -180, 180);
        const scale = clamp(st.scale, 0.35, 3.5);
        const zIndex = isSelected ? 40 : st.layer === 'behind' ? 2 : 24;

        const handleBodyPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
          if (e.button !== 0 || st.locked) return;
          e.stopPropagation();
          e.preventDefault();
          onSelectSticker(st.id);

          const hostEl = (e.currentTarget as HTMLElement).closest<HTMLElement>(
            '[data-flow-block-id]',
          );
          const hostRect = hostEl?.getBoundingClientRect();
          const origCenterX = hostRect
            ? hostRect.left + (x / 100) * hostRect.width
            : e.clientX;
          const origCenterY = hostRect
            ? hostRect.top + (y / 100) * hostRect.height
            : e.clientY;

          bodyDragRef.current = {
            stickerId: st.id,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            origCenterX,
            origCenterY,
            moved: false,
            lastDropEl: null,
          };
          setDragState({ stickerId: st.id, dx: 0, dy: 0 });
          e.currentTarget.setPointerCapture(e.pointerId);
        };

        const handleBodyPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
          const d = bodyDragRef.current;
          if (!d || d.stickerId !== st.id) return;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;

          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (Math.hypot(dx, dy) > 3) {
            d.moved = true;
          }
          setDragState({ stickerId: st.id, dx, dy });

          const dropEl = findHostBlockAtPoint(
            d.origCenterX + dx,
            d.origCenterY + dy,
          );
          if (d.lastDropEl && d.lastDropEl !== dropEl) {
            d.lastDropEl.removeAttribute('data-sticker-drop-target');
          }
          if (dropEl && dropEl.getAttribute('data-flow-block-id') !== blockId) {
            dropEl.setAttribute('data-sticker-drop-target', 'true');
            d.lastDropEl = dropEl;
          } else {
            d.lastDropEl = null;
          }
        };

        const finishBodyDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
          const d = bodyDragRef.current;
          if (!d || d.stickerId !== st.id) return;
          clearDropHighlight();

          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          const wasMoved = d.moved;
          const targetCenterX = d.origCenterX + dx;
          const targetCenterY = d.origCenterY + dy;
          bodyDragRef.current = null;
          setDragState(null);

          if (!wasMoved) return;

          const targetHost =
            findHostBlockAtPoint(targetCenterX, targetCenterY) ??
            (e.currentTarget as HTMLElement).closest<HTMLElement>(
              '[data-flow-block-id]',
            );
          if (!targetHost) return;
          const toBlockId =
            targetHost.getAttribute('data-flow-block-id') ?? blockId;
          const r = targetHost.getBoundingClientRect();
          const newX = Number(
            clamp(
              ((targetCenterX - r.left) / Math.max(1, r.width)) * 100,
              -15,
              115,
            ).toFixed(1),
          );
          const newY = Number(
            clamp(
              ((targetCenterY - r.top) / Math.max(1, r.height)) * 100,
              -40,
              140,
            ).toFixed(1),
          );

          if (toBlockId === blockId) {
            onUpdateSticker(st.id, { x: newX, y: newY });
          } else {
            onMoveStickerToBlock(blockId, toBlockId, st.id, {
              x: newX,
              y: newY,
            });
          }
        };

        const handleRotatePointerDown = (
          e: ReactPointerEvent<HTMLButtonElement>,
        ) => {
          if (e.button !== 0 || st.locked) return;
          e.stopPropagation();
          e.preventDefault();
          const wrapper = e.currentTarget.closest<HTMLElement>(
            '[data-sticker-id]',
          );
          if (!wrapper) return;
          const rect = wrapper.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const pointerAngle =
            (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
          rotateDragRef.current = {
            stickerId: st.id,
            cx,
            cy,
            baseDeg: pointerAngle - rotate,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        };

        const handleRotatePointerMove = (
          e: ReactPointerEvent<HTMLButtonElement>,
        ) => {
          const r = rotateDragRef.current;
          if (!r || r.stickerId !== st.id) return;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const pointerAngle =
            (Math.atan2(e.clientY - r.cy, e.clientX - r.cx) * 180) / Math.PI;
          let nextRot = normalizeDeg(pointerAngle - r.baseDeg);
          if (e.shiftKey) {
            nextRot = Math.round(nextRot / 15) * 15;
          }
          onUpdateSticker(st.id, { rotate: nextRot });
        };

        const finishRotateDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (rotateDragRef.current?.stickerId === st.id) {
            rotateDragRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }
        };

        const handleResizePointerDown = (
          e: ReactPointerEvent<HTMLButtonElement>,
        ) => {
          if (e.button !== 0 || st.locked) return;
          e.stopPropagation();
          e.preventDefault();
          const wrapper = e.currentTarget.closest<HTMLElement>(
            '[data-sticker-id]',
          );
          if (!wrapper) return;
          const rect = wrapper.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const startDist = Math.max(
            12,
            Math.hypot(e.clientX - cx, e.clientY - cy),
          );
          scaleDragRef.current = {
            stickerId: st.id,
            cx,
            cy,
            startDist,
            startScale: scale,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        };

        const handleResizePointerMove = (
          e: ReactPointerEvent<HTMLButtonElement>,
        ) => {
          const s = scaleDragRef.current;
          if (!s || s.stickerId !== st.id) return;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const curDist = Math.hypot(e.clientX - s.cx, e.clientY - s.cy);
          const nextScale = Number(
            clamp(s.startScale * (curDist / s.startDist), 0.4, 3.0).toFixed(2),
          );
          onUpdateSticker(st.id, { scale: nextScale });
        };

        const finishResizeDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (scaleDragRef.current?.stickerId === st.id) {
            scaleDragRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }
        };

        const toolbarPlacementClass =
          y < 42 ? 'top-full mt-3' : 'bottom-full mb-3';
        const toolbarHorizClass =
          x > 65 ? 'end-0' : x < 35 ? 'start-0' : 'left-1/2 -translate-x-1/2';

        return (
          <div
            key={st.id}
            data-sticker-id={st.id}
            data-sticker-block-id={blockId}
            data-sticker-locked={st.locked ? 'true' : undefined}
            data-testid={`posable-sticker-${sprite}`}
            className={`absolute ${
              st.locked ? 'pointer-events-none' : 'pointer-events-auto'
            }`}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              zIndex,
              transform: `translate(-50%, -50%)${activeOffset}`,
            }}
          >
            {/* Rotated / Scaled Inner Sticker + Gizmo Box */}
            <div
              className={`relative inline-flex flex-col items-center p-1.5 rounded-xl transition-shadow ${
                isSelected
                  ? 'outline-2 outline-dashed outline-link-ink bg-action-subtle/20'
                  : !st.locked
                    ? 'hover:outline-1 hover:outline-dashed hover:outline-border-ink/65'
                    : ''
              }`}
              style={{
                transform: `rotate(${rotate}deg) scale(${scale})`,
              }}
            >
              {/* Rotate Handle (top center) */}
              {isSelected && (
                <button
                  type="button"
                  data-testid="sticker-rotate-handle"
                  aria-label={ext.rotateRight}
                  title={ext.rotateRight}
                  onPointerDown={handleRotatePointerDown}
                  onPointerMove={handleRotatePointerMove}
                  onPointerUp={finishRotateDrag}
                  onLostPointerCapture={() => {
                    rotateDragRef.current = null;
                  }}
                  className="ink-sticker-gizmo-handle absolute -top-6 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-surface-sheet border-2 border-link-ink shadow-xs flex items-center justify-center text-xs text-link-ink"
                >
                  ↻
                </button>
              )}

              {/* Draggable Sticker Body */}
              <div
                role={st.locked ? undefined : 'button'}
                tabIndex={st.locked ? undefined : 0}
                aria-label={
                  st.locked ? undefined : `${blockTitle}: ${ext.sprites[sprite]}`
                }
                onPointerDown={handleBodyPointerDown}
                onPointerMove={handleBodyPointerMove}
                onPointerUp={finishBodyDrag}
                onLostPointerCapture={finishBodyDrag}
                onKeyDown={(e) => {
                  if (st.locked) return;
                  if (
                    ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
                      e.key,
                    )
                  ) {
                    e.preventDefault();
                    const step = e.shiftKey ? 5 : 2;
                    const dx =
                      e.key === 'ArrowRight'
                        ? step
                        : e.key === 'ArrowLeft'
                          ? -step
                          : 0;
                    const dy =
                      e.key === 'ArrowDown'
                        ? step
                        : e.key === 'ArrowUp'
                          ? -step
                          : 0;
                    onUpdateSticker(st.id, {
                      x: clamp(x + dx, -15, 115),
                      y: clamp(y + dy, -40, 140),
                    });
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    onDeleteSticker(st.id);
                  } else if (e.key === 'Escape') {
                    onSelectSticker(null);
                  }
                }}
                className={
                  st.locked
                    ? 'select-none'
                    : 'ink-sticker-gizmo-handle select-none focus:outline-none'
                }
                style={{
                  transform: st.flip ? 'scaleX(-1)' : undefined,
                }}
              >
                <PixelStickerById
                  sprite={sprite}
                  size={56}
                  label={st.caption || ext.sprites[sprite]}
                />
              </div>

              {st.caption && (
                <span className="mt-0.5 px-1.5 py-0.5 rounded-md bg-surface-sheet/90 border border-border-subtle text-xs text-ink-secondary font-hand whitespace-nowrap">
                  {st.caption}
                </span>
              )}

              {/* Bottom-Right Continuous Resize Handle */}
              {isSelected && (
                <button
                  type="button"
                  data-testid="sticker-resize-handle"
                  aria-label="Resize sticker"
                  title="Resize sticker"
                  onPointerDown={handleResizePointerDown}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={finishResizeDrag}
                  onLostPointerCapture={() => {
                    scaleDragRef.current = null;
                  }}
                  className="ink-sticker-gizmo-handle absolute -bottom-2 -end-2 w-4 h-4 rounded-full bg-link-ink border-2 border-surface-sheet shadow-xs cursor-nwse-resize"
                />
              )}
            </div>

            {/* Subtle Hover Unlock Chip when Sticker is Locked onto Element */}
            {st.locked && (
              <button
                type="button"
                data-testid="locked-sticker-unlock-btn"
                title={ext.lockedBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateSticker(st.id, { locked: false });
                  onSelectSticker(st.id);
                }}
                className="pointer-events-auto opacity-0 group-hover/block:opacity-95 focus:opacity-100 absolute -top-2 -end-2 px-1.5 py-0.5 rounded-md bg-surface-sheet/95 border border-border-ink text-xs font-semibold text-link-ink shadow-xs cursor-pointer transition-opacity whitespace-nowrap inline-flex items-center gap-1"
              >
                <IconUnlock className="w-3 h-3" />
                <span>{ext.unlockShortBtn}</span>
              </button>
            )}

            {/* Upright Floating Sticker Toolbar when Selected */}
            {isSelected && (
              <div
                data-testid="sticker-floating-toolbar"
                onPointerDown={(e) => e.stopPropagation()}
                className={`absolute ${toolbarPlacementClass} ${toolbarHorizClass} z-50 w-72 sm:w-80 p-2.5 rounded-2xl border-2 border-border-ink bg-surface-sheet shadow-lg space-y-2`}
              >
                {/* 12-Sprite Quick Picker */}
                <div className="grid grid-cols-6 gap-1">
                  {ALL_PIXEL_SPRITE_IDS.map((sp) => {
                    const active = sprite === sp;
                    return (
                      <button
                        key={sp}
                        type="button"
                        aria-pressed={active}
                        data-testid={`pixel-sprite-${sp}`}
                        title={ext.sprites[sp]}
                        aria-label={ext.sprites[sp]}
                        onClick={() => onUpdateSticker(st.id, { sprite: sp })}
                        className={`p-1 rounded-lg border flex items-center justify-center cursor-pointer transition-colors ${
                          active
                            ? 'border-link-ink bg-action-subtle/75'
                            : 'border-border-subtle bg-surface-raised hover:border-border-ink'
                        }`}
                      >
                        <PixelStickerById sprite={sp} size={22} />
                      </button>
                    );
                  })}
                </div>

                {/* Transform + Lock Actions Row */}
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSticker(st.id, {
                        rotate: normalizeDeg(rotate - 15),
                      })
                    }
                    title={ext.rotateLeft}
                    className="min-h-7 px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-raised hover:border-border-ink text-xs font-mono text-ink-primary cursor-pointer"
                  >
                    ↺ 15°
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSticker(st.id, {
                        rotate: normalizeDeg(rotate + 15),
                      })
                    }
                    title={ext.rotateRight}
                    className="min-h-7 px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-raised hover:border-border-ink text-xs font-mono text-ink-primary cursor-pointer"
                  >
                    ↻ 15°
                  </button>
                  <button
                    type="button"
                    aria-pressed={Boolean(st.flip)}
                    onClick={() =>
                      onUpdateSticker(st.id, { flip: !st.flip })
                    }
                    className={`min-h-7 px-2 py-0.5 rounded-lg border text-xs cursor-pointer ${
                      st.flip
                        ? 'border-link-ink bg-action-subtle text-link-ink font-semibold'
                        : 'border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-ink'
                    }`}
                  >
                    ⇆ {ext.flipBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSticker(st.id, {
                        layer: st.layer === 'behind' ? 'front' : 'behind',
                      })
                    }
                    className="min-h-7 px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-raised hover:border-border-ink text-xs text-ink-secondary cursor-pointer"
                  >
                    {st.layer === 'behind' ? ext.layerBehind : ext.layerFront}
                  </button>
                  <button
                    type="button"
                    aria-label="Duplicate sticker"
                    onClick={() => onDuplicateSticker(st.id)}
                    className="min-h-7 px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-raised hover:border-border-ink text-ink-secondary cursor-pointer inline-flex items-center"
                  >
                    <IconCopy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete sticker"
                    onClick={() => onDeleteSticker(st.id)}
                    className="ms-auto min-h-7 px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-raised hover:border-accent-danger text-ink-muted hover:text-accent-danger cursor-pointer inline-flex items-center"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Caption + Primary Lock Toggle Row */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    data-testid="pixel-sticker-caption-input"
                    value={st.caption ?? ''}
                    onChange={(e) =>
                      onUpdateSticker(st.id, { caption: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder={ext.captionPlaceholder}
                    className="flex-1 min-w-0 px-2.5 py-1 rounded-lg border border-border-subtle bg-surface-raised text-xs text-ink-primary placeholder:text-ink-muted font-hand focus:outline-none focus:border-link-ink"
                  />
                  <button
                    type="button"
                    data-testid="sticker-lock-toggle-btn"
                    onClick={() => {
                      onUpdateSticker(st.id, { locked: true });
                      onSelectSticker(null);
                    }}
                    className="shrink-0 min-h-7 px-2.5 py-1 rounded-lg bg-action-subtle border border-link-ink/40 hover:border-link-ink text-xs font-semibold text-link-ink inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <IconLock className="w-3.5 h-3.5" />
                    <span>{ext.lockBtn}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
