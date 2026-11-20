/*
 * Hand-Drawn Notebook Margin Stickers (`MarginNoteLayer`)
 * - Supports both Author Marginalia (`:::margin[mint:pin | 批注]`) and Reader Interactive Stickies
 *   on BOTH `paragraph` and `code_card` blocks.
 * - Reader composer lets learners combine 5 quick tags (`note`/`idea`/`ask`/`star`/`todo`),
 *   6 physical silhouettes (`tape`/`pin`/`torn`/`clip`/`stamp`/`tag`), and 6 dual-theme palettes,
 *   persisted losslessly into `note_color VARCHAR(24)` (`"<tone>:<style>:<tag>"`).
 */

import { type CSSProperties, type ReactNode, useState } from 'react';
import type { UiMessages } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type {
  MarginStickerTag,
  StickerStyle,
  StickerTone,
  UserMarginNoteDto,
} from '../../lib/types';
import { parseAuthorMarginNote } from '../../lib/visualBlocks';
import { IconCheck, IconClose, IconPen } from '../ui/Icons';
import {
  ALL_MARGIN_TAGS,
  ALL_STICKER_TONES,
  decodeReaderNoteSpec,
  encodeReaderNoteSpec,
  MARGIN_TAG_ICONS,
  PaperclipOrnament,
  PostmarkOrnament,
  PushpinOrnament,
  STICKER_TONE_TOKENS,
  TagEyeletOrnament,
  TornBottomEdge,
  WashiTapeOrnament,
} from './StationeryStickers';

const MARGIN_STICKER_STYLES: StickerStyle[] = [
  'tape',
  'pin',
  'torn',
  'clip',
  'stamp',
  'tag',
];

export function MarginStickerCard({
  style,
  tone,
  badgeIcon,
  badgeLabel,
  tiltDeg = -0.7,
  onDelete,
  deleteAriaLabel,
  children,
}: {
  style: StickerStyle;
  tone: StickerTone;
  badgeIcon: ReactNode;
  badgeLabel: string;
  tiltDeg?: number;
  onDelete?: () => void;
  deleteAriaLabel?: string;
  children: ReactNode;
}) {
  const tokens = STICKER_TONE_TOKENS[tone] ?? STICKER_TONE_TOKENS.amber;

  const customVars = {
    '--sticker-bg': tokens.bg,
    '--sticker-border': tokens.border,
    '--sticker-body': tokens.title,
  } as CSSProperties;

  let padClass = 'p-3';
  let radius = '12px';

  if (style === 'tape') {
    padClass = 'pt-4 pb-3 px-3';
    radius = '11px 11px 4px 11px';
  } else if (style === 'pin') {
    padClass = 'pt-4 pb-3 px-3';
  } else if (style === 'torn') {
    padClass = 'pt-3 pb-2 px-3';
    radius = '10px 10px 3px 3px';
  } else if (style === 'tag') {
    padClass = 'py-3 pe-3 ps-8';
    radius = '18px 10px 10px 18px';
  } else if (style === 'looseleaf') {
    padClass = 'py-3 pe-3 ps-8';
  } else if (style === 'stamp') {
    radius = '9px';
  }

  return (
    <div
      data-sticker-style={style}
      className={`sticker-card text-xs ${padClass}`}
      style={{
        ...customVars,
        borderRadius: radius,
        transform: `rotate(${tiltDeg}deg)`,
        boxShadow: '2px 2px 0 0 var(--border-ink)',
      }}
    >
      {style === 'tape' && (
        <div className="pointer-events-none absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
          <WashiTapeOrnament
            fill={tokens.badgeBg}
            stroke={tokens.border}
            pattern="stripe"
            tiltDeg={-1.8}
            compact
          />
        </div>
      )}

      {style === 'pin' && (
        <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <PushpinOrnament fill={tokens.badgeBg} stroke={tokens.border} compact />
        </div>
      )}

      {style === 'torn' && (
        <div className="pointer-events-none absolute -top-1.5 -start-1.5 z-10">
          <WashiTapeOrnament
            fill={tokens.badgeBg}
            stroke={tokens.border}
            pattern="dots"
            tiltDeg={-24}
            compact
          />
        </div>
      )}

      {style === 'clip' && (
        <div className="pointer-events-none absolute -top-3 end-4 z-10">
          <PaperclipOrnament stroke={tokens.border} compact />
        </div>
      )}

      {style === 'stamp' && (
        <div className="pointer-events-none absolute top-1.5 end-2 z-0">
          <PostmarkOrnament stroke={tokens.border} compact />
        </div>
      )}

      {style === 'tag' && (
        <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-1 z-10">
          <TagEyeletOrnament stroke={tokens.border} badgeBg={tokens.badgeBg} />
        </div>
      )}

      {style === 'looseleaf' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2 start-2 w-3.5 flex flex-col justify-around items-center border-e border-dashed"
          style={{ borderColor: tokens.border, opacity: 0.8 }}
        >
          <span
            className="w-2 h-2 rounded-full border"
            style={{ backgroundColor: 'var(--surface-sheet)', borderColor: tokens.border }}
          />
          <span
            className="w-2 h-2 rounded-full border"
            style={{ backgroundColor: 'var(--surface-sheet)', borderColor: tokens.border }}
          />
        </div>
      )}

      <div className="relative z-1">
        <div className="flex items-center justify-between gap-1 mb-1">
          <span
            className="font-hand text-xs font-semibold inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed"
            style={{
              backgroundColor: tokens.badgeBg,
              color: tokens.badgeFg,
              borderColor: tokens.border,
            }}
          >
            {badgeIcon}
            <span>{badgeLabel}</span>
          </span>

          {onDelete && (
            <button
              type="button"
              aria-label={deleteAriaLabel}
              onClick={onDelete}
              className="w-7 h-7 -me-1 -mt-1 rounded-lg inline-flex items-center justify-center cursor-pointer hover:bg-surface-sheet/50 transition-colors"
              style={{ color: tokens.badgeFg }}
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div
          className="font-hand leading-relaxed text-sm sm:text-base"
          style={{ color: tokens.title }}
        >
          {children}
        </div>
      </div>

      {style === 'torn' && (
        <div className="mt-2 -mx-1.5">
          <TornBottomEdge borderStroke={tokens.border} />
        </div>
      )}
    </div>
  );
}

export function AuthorMarginSticker({
  rawNote,
  badgeLabel,
}: {
  rawNote: string;
  badgeLabel: string;
}) {
  const parsed = parseAuthorMarginNote(rawNote);
  if (!parsed.text) return null;
  return (
    <MarginStickerCard
      style={parsed.style}
      tone={parsed.tone}
      badgeIcon={<IconPen className="w-3.5 h-3.5" />}
      badgeLabel={badgeLabel}
      tiltDeg={-0.8}
    >
      <p className="m-0">{parsed.text}</p>
    </MarginStickerCard>
  );
}

interface BlockWithMarginProps {
  blockId: string;
  authorNote?: string | null;
  userNotes: UserMarginNoteDto[];
  copy: UiMessages;
  onAddNote: (blockId: string, color: string, content: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  children: ReactNode;
}

export function BlockWithMargin({
  blockId,
  authorNote,
  userNotes,
  copy,
  onAddNote,
  onDeleteNote,
  children,
}: BlockWithMarginProps) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tone, setTone] = useState<StickerTone>('amber');
  const [style, setStyle] = useState<StickerStyle>('tape');
  const [tag, setTag] = useState<MarginStickerTag>('note');
  const [saving, setSaving] = useState(false);

  const activeTokens = STICKER_TONE_TOKENS[tone];

  const handleSave = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      const encoded = encodeReaderNoteSpec({ tone, style, tag });
      await onAddNote(blockId, encoded, draft.trim());
      setDraft('');
      setComposing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id={blockId}
      className="my-4 xl:grid xl:grid-cols-[minmax(0,65ch)_220px] xl:gap-6 items-start group"
    >
      {/* Main Content Column */}
      <div className="relative min-w-0 max-w-full">
        {children}

        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          aria-expanded={composing}
          className="mt-1.5 min-h-7 px-2 -ms-1 rounded-lg inline-flex items-center gap-1 font-hand text-xs sm:text-sm font-semibold text-ink-muted hover:text-ink-primary hover:bg-surface-raised transition-colors cursor-pointer"
        >
          <span>{copy.addStickyBtn}</span>
        </button>

        {composing && (
          <div className="ui-popover-enter origin-top-left mt-2 p-3.5 rounded-xl border-2 border-border-ink bg-surface-raised max-w-md space-y-3 shadow-[3px_3px_0_0_var(--border-ink)]">
            {/* 1. Tag Pills (Note / Idea / Ask / Star / Todo) */}
            <div className="flex flex-wrap gap-1.5">
              {ALL_MARGIN_TAGS.map((t) => {
                const selected = tag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setTag(t)}
                    className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 cursor-pointer transition-colors"
                    style={
                      selected
                        ? {
                            backgroundColor: activeTokens.badgeBg,
                            color: activeTokens.badgeFg,
                            borderColor: activeTokens.border,
                          }
                        : {
                            backgroundColor: 'var(--surface-sheet)',
                            color: 'var(--ink-secondary)',
                            borderColor: 'var(--border-subtle)',
                          }
                    }
                  >
                    {MARGIN_TAG_ICONS[t]}
                    <span>{copy.marginTags[t]}</span>
                  </button>
                );
              })}
            </div>

            {/* 2. Physical Sticker Style Pills */}
            <div className="flex flex-wrap gap-1">
              {MARGIN_STICKER_STYLES.map((st) => {
                const selected = style === st;
                return (
                  <button
                    key={st}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setStyle(st)}
                    className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer transition-colors ${
                      selected
                        ? 'font-semibold bg-surface-sheet text-ink-primary border-border-ink'
                        : 'bg-surface-sheet/60 text-ink-muted border-border-subtle hover:text-ink-primary'
                    }`}
                  >
                    {copy.stickerStyles[st]}
                  </button>
                );
              })}
            </div>

            {/* 3. Live-Preview Handwritten Note Area */}
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={copy.stickyPlaceholder}
              className="w-full rounded-xl px-3 py-2 font-hand text-base leading-relaxed border-2"
              style={{
                backgroundColor: activeTokens.bg,
                borderColor: activeTokens.border,
                color: activeTokens.title,
              }}
            />

            {/* 4. Color Swatches + Cancel / Save */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {ALL_STICKER_TONES.map((t) => {
                  const cfg = STICKER_TONE_TOKENS[t];
                  const selected = tone === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      data-color-swatch=""
                      aria-label={copy.stickyColorAria(copy.stickerTones[t])}
                      aria-pressed={selected}
                      onClick={() => setTone(t)}
                      className={`w-7 h-7 rounded-full cursor-pointer border-2 inline-flex items-center justify-center transition-transform ${
                        selected
                          ? 'scale-110 ring-2 ring-ink-primary ring-offset-1 ring-offset-surface-raised'
                          : ''
                      }`}
                      style={{
                        backgroundColor: cfg.swatch,
                        borderColor: 'var(--border-ink)',
                        color: '#ffffff',
                      }}
                    >
                      {selected && <IconCheck className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 ms-auto">
                <button
                  type="button"
                  onClick={() => setComposing(false)}
                  className="min-h-7 px-2.5 py-1 text-xs text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
                >
                  {copy.cancelBtn}
                </button>
                <button
                  type="button"
                  disabled={saving || !draft.trim()}
                  onClick={() => void handleSave()}
                  className="min-h-7 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-50"
                >
                  {copy.saveStickyBtn}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Notebook Margin Column (Author Sticker + Reader Stickies) */}
      {(authorNote || userNotes.length > 0) && (
        <div className="mt-3 xl:mt-0 space-y-3">
          {authorNote && (
            <AuthorMarginSticker
              rawNote={authorNote}
              badgeLabel={copy.authorNoteBadge}
            />
          )}

          {userNotes.map((note, idx) => {
            const spec = decodeReaderNoteSpec(note.note_color);
            const tagLabel =
              spec.tag === 'note'
                ? copy.myNoteBadge
                : copy.marginTags[spec.tag];
            return (
              <MarginStickerCard
                key={note.id}
                style={spec.style}
                tone={spec.tone}
                badgeIcon={MARGIN_TAG_ICONS[spec.tag]}
                badgeLabel={tagLabel}
                tiltDeg={idx % 2 === 0 ? 0.7 : -0.6}
                onDelete={() => void onDeleteNote(note.id)}
                deleteAriaLabel={copy.deleteStickyAria}
              >
                <SafeHtml html={note.content_html} />
              </MarginStickerCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ParagraphWithMargin({
  html,
  ...rest
}: Omit<BlockWithMarginProps, 'children'> & { html: string }) {
  return (
    <BlockWithMargin {...rest}>
      <SafeHtml html={html} className="notebook-prose text-base text-ink-primary" />
    </BlockWithMargin>
  );
}
