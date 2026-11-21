/*
 * Shared Author Margin Sticker Input (`ParagraphBlockBody`, `ImageBlockBody`, `CodeCardBlockBody`).
 * Reuses `<ToneSwatchPicker>` for consistent accessible circular color swatches.
 */

import { UI_COPY } from '../../../lib/i18n';
import type { LocaleCode, StickerStyle } from '../../../lib/types';
import {
  formatAuthorMarginNote,
  parseAuthorMarginNote,
} from '../../../lib/visualBlocks';
import { ToneSwatchPicker } from '../../notebook/ToneSwatchPicker';
import { IconPen } from '../../ui/Icons';

const AUTHOR_MARGIN_STYLES: readonly StickerStyle[] = [
  'tape',
  'pin',
  'torn',
  'clip',
  'stamp',
  'tag',
];

export interface AuthorMarginNoteInputProps {
  locale: LocaleCode;
  rawValue: string;
  onChange: (nextRaw: string) => void;
}

export function AuthorMarginNoteInput({
  locale,
  rawValue,
  onChange,
}: AuthorMarginNoteInputProps) {
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

          <ToneSwatchPicker
            value={parsed.tone}
            onChange={(nextTone) => {
              if (nextTone) {
                onChange(formatAuthorMarginNote(parsed.text, nextTone, parsed.style));
              }
            }}
            copy={copy}
            ringOffsetClass="ring-offset-surface-raised"
          />
        </div>
      )}
    </div>
  );
}
