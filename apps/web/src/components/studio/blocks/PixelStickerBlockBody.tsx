/*
 * Die-Cut Pixel Sticker Visual Block Editor (`pixel_sticker`) for IceHandNote Studio:
 * - Interactive 12-sprite pixel art picker (cat, quill, coffee, crystal, sprout, compass,
 *   floppy, hourglass, star, plane, lightbulb, heart).
 * - Alignment (`left | center | right`), size (`sm | md | lg`), and optional handwritten caption.
 */

import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { LocaleCode } from '../../../lib/types';
import type { VisualBlock } from '../../../lib/visualBlocks';
import {
  ALL_PIXEL_SPRITE_IDS,
  normalizePixelSpriteId,
  pixelSizeToPx,
  PixelStickerById,
} from '../../notebook/PixelStickers';
import { IconPixelSticker } from '../../ui/Icons';

type PixelStickerVisualBlock = Extract<VisualBlock, { type: 'pixel_sticker' }>;

interface PixelStickerBlockBodyProps {
  block: PixelStickerVisualBlock;
  locale: LocaleCode;
  onUpdate: (next: PixelStickerVisualBlock) => void;
}

const ALIGN_OPTIONS: ReadonlyArray<'left' | 'center' | 'right'> = [
  'left',
  'center',
  'right',
];

const SIZE_OPTIONS: ReadonlyArray<'sm' | 'md' | 'lg'> = ['sm', 'md', 'lg'];

export function PixelStickerBlockBody({
  block,
  locale,
  onUpdate,
}: PixelStickerBlockBodyProps) {
  const ext = EXT_COPY[locale].studio.pixelSticker;
  const blockTitle = UI_COPY[locale].studio.visual.types.pixel_sticker;
  const currentSprite = normalizePixelSpriteId(block.sprite);

  const alignWrapClass =
    block.align === 'left'
      ? 'items-start text-start'
      : block.align === 'right'
        ? 'items-end text-end'
        : 'items-center text-center';

  const alignLabels: Record<'left' | 'center' | 'right', string> = {
    left: ext.alignLeft,
    center: ext.alignCenter,
    right: ext.alignRight,
  };

  const sizeLabels: Record<'sm' | 'md' | 'lg', string> = {
    sm: ext.sizeSm,
    md: ext.sizeMd,
    lg: ext.sizeLg,
  };

  return (
    <div
      className="my-2 rounded-2xl border border-dashed border-border-subtle bg-surface-raised/60 p-4 space-y-3.5"
      data-testid="pixel-sticker-block-editor"
    >
      {/* Header + Align / Size Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
          <IconPixelSticker className="w-3.5 h-3.5 text-accent-amber" />
          <span>{blockTitle}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={ext.alignLabel}
            className="inline-flex items-center rounded-lg border border-border-subtle bg-surface-sheet p-0.5 gap-0.5"
          >
            {ALIGN_OPTIONS.map((al) => {
              const active = block.align === al;
              return (
                <button
                  key={al}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onUpdate({ ...block, align: al })}
                  className={`min-h-6 px-2 py-0.5 rounded-md text-xs cursor-pointer transition-colors ${
                    active
                      ? 'font-semibold bg-action-subtle text-link-ink'
                      : 'text-ink-muted hover:text-ink-primary'
                  }`}
                >
                  {alignLabels[al]}
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label={ext.sizeLabel}
            className="inline-flex items-center rounded-lg border border-border-subtle bg-surface-sheet p-0.5 gap-0.5"
          >
            {SIZE_OPTIONS.map((sz) => {
              const active = block.size === sz;
              return (
                <button
                  key={sz}
                  type="button"
                  aria-pressed={active}
                  data-testid={`pixel-size-${sz}`}
                  onClick={() => onUpdate({ ...block, size: sz })}
                  className={`min-h-6 px-2 py-0.5 rounded-md text-xs cursor-pointer transition-colors ${
                    active
                      ? 'font-semibold bg-action-subtle text-link-ink'
                      : 'text-ink-muted hover:text-ink-primary'
                  }`}
                >
                  {sizeLabels[sz]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live Paper Stage Preview */}
      <div
        className={`rounded-xl border border-border-subtle bg-surface-sheet/80 px-4 py-3 flex flex-col ${alignWrapClass}`}
      >
        <div className="pixel-sticker-float inline-flex items-center justify-center p-1">
          <PixelStickerById
            sprite={currentSprite}
            size={pixelSizeToPx(block.size)}
            label={block.caption || ext.sprites[currentSprite]}
          />
        </div>
        {block.caption.trim() && (
          <p className="mt-1.5 text-xs text-ink-secondary font-hand max-w-md">
            {block.caption}
          </p>
        )}
      </div>

      {/* 12-Sprite Selector Grid */}
      <div className="space-y-1.5">
        <div className="text-xs text-ink-muted">{ext.pickerLabel}</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
          {ALL_PIXEL_SPRITE_IDS.map((sp) => {
            const active = currentSprite === sp;
            return (
              <button
                key={sp}
                type="button"
                aria-pressed={active}
                data-testid={`pixel-sprite-${sp}`}
                onClick={() => onUpdate({ ...block, sprite: sp })}
                className={`min-h-14 px-2 py-1.5 rounded-xl border flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                  active
                    ? 'border-link-ink bg-action-subtle/70 text-link-ink font-semibold'
                    : 'border-border-subtle bg-surface-sheet hover:border-border-ink text-ink-secondary'
                }`}
              >
                <PixelStickerById sprite={sp} size={26} />
                <span className="text-xs leading-tight truncate max-w-full">
                  {ext.sprites[sp]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Optional Handwritten Caption Input */}
      <input
        type="text"
        value={block.caption}
        data-testid="pixel-sticker-caption-input"
        onChange={(e) => onUpdate({ ...block, caption: e.target.value })}
        placeholder={ext.captionPlaceholder}
        className="w-full px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-sheet text-sm text-ink-primary placeholder:text-ink-muted font-hand focus:outline-none focus:border-link-ink"
      />
    </div>
  );
}
