/*
 * Shared Paper & Sticker Tone Swatch Picker (`VisualBlockEditor` & `MarginNoteLayer`):
 * Renders accessible circular color swatches with `aria-pressed` and non-color check mark.
 */

import type { UiMessages } from '../../lib/i18n';
import type { StickerTone } from '../../lib/types';
import { IconCheck } from '../ui/Icons';
import { ALL_STICKER_TONES, STICKER_TONE_TOKENS } from './StationeryStickers';

export interface ToneSwatchPickerProps {
  value: StickerTone | '';
  onChange: (next: StickerTone | '') => void;
  copy: Pick<UiMessages, 'stickerTones' | 'stickyColorAria'>;
  ariaLabel?: string;
  autoOptionLabel?: string;
  ringOffsetClass?: string;
  className?: string;
}

export function ToneSwatchPicker({
  value,
  onChange,
  copy,
  ariaLabel,
  autoOptionLabel,
  ringOffsetClass = 'ring-offset-surface-sheet',
  className = '',
}: ToneSwatchPickerProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex items-center gap-1.5 ${className}`.trim()}
    >
      {autoOptionLabel !== undefined && (
        <button
          type="button"
          aria-pressed={value === ''}
          onClick={() => onChange('')}
          className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer transition-colors ${
            value === ''
              ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
              : 'bg-surface-raised/60 text-ink-muted border-border-subtle hover:text-ink-primary'
          }`}
        >
          {autoOptionLabel}
        </button>
      )}

      {ALL_STICKER_TONES.map((tone) => {
        const cfg = STICKER_TONE_TOKENS[tone];
        const active = value === tone;
        return (
          <button
            key={tone}
            type="button"
            data-color-swatch=""
            aria-label={copy.stickyColorAria(copy.stickerTones[tone])}
            aria-pressed={active}
            onClick={() => onChange(tone)}
            className={`w-6 h-6 rounded-full border-2 inline-flex items-center justify-center cursor-pointer transition-transform ${
              active ? `scale-110 ring-2 ring-ink-primary ring-offset-1 ${ringOffsetClass}` : ''
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
  );
}
