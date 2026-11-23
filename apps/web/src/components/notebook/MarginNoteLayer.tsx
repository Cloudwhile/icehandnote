/*
 * Hand-Drawn Notebook Margin Stickers (`MarginNoteLayer`)
 * - Supports both Author Marginalia (`:::margin[mint:pin | 批注]`) and Reader Interactive Stickies
 *   across all article content blocks (paragraphs, code cards, images, alerts, quotes, lists, tasks, diagrams).
 * - Reader composer & inline editor support 5 tags (`note`/`idea`/`ask`/`star`/`todo`),
 *   6 physical silhouettes (`tape`/`pin`/`torn`/`clip`/`stamp`/`tag`), 6 dual-theme palettes,
 *   safe inline Markdown (**bold**, *italic*, `code`, ~~strike~~), 2000-char counter,
 *   RFC 7396 partial updates (`PATCH` + `If-Match`), and W3C Web Annotation re-anchoring indicators.
 */

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  applySemanticNoteHighlights,
  extractQuoteExcerpt,
  isSelectionNote,
  MAX_NOTE_CHARS,
  type ResolvedBlockNote,
} from '../../lib/annotationAnchor';
import type { ExtendedMessages, UiMessages } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type {
  AnnotationTarget,
  MarginStickerTag,
  StickerStyle,
  StickerTone,
  UserMarginNoteDto,
} from '../../lib/types';
import { parseAuthorMarginNote } from '../../lib/visualBlocks';
import { IconClose, IconPen } from '../ui/Icons';
import {
  ALL_MARGIN_TAGS,
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
import { ToneSwatchPicker } from './ToneSwatchPicker';

const MARGIN_STICKER_STYLES: StickerStyle[] = [
  'tape',
  'pin',
  'torn',
  'clip',
  'stamp',
  'tag',
];

export interface MarginNoteEditPatch {
  content: string;
  tone: StickerTone;
  style: StickerStyle;
  tag: MarginStickerTag;
  note_color: string;
  motivation?: string;
  target?: AnnotationTarget;
}

export function MarginStickerCard({
  style,
  tone,
  badgeIcon,
  badgeLabel,
  reanchoredLabel,
  pendingSyncLabel,
  quoteExcerpt,
  focused = false,
  tiltDeg = -0.7,
  onEdit,
  editAriaLabel,
  onDelete,
  deleteAriaLabel,
  children,
}: {
  style: StickerStyle;
  tone: StickerTone;
  badgeIcon: ReactNode;
  badgeLabel: string;
  reanchoredLabel?: string;
  pendingSyncLabel?: string;
  quoteExcerpt?: string;
  focused?: boolean;
  tiltDeg?: number;
  onEdit?: () => void;
  editAriaLabel?: string;
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
      className={`sticker-card text-xs ${padClass} ${focused ? 'ring-2 ring-link-ink/50' : ''}`}
      style={{
        ...customVars,
        borderRadius: radius,
        transform: `rotate(${tiltDeg}deg)`,
        boxShadow: 'var(--shadow-control)',
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
          <div className="flex items-center gap-1 min-w-0 flex-wrap">
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
            {reanchoredLabel && (
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded border border-dashed"
                style={{
                  borderColor: tokens.border,
                  color: tokens.badgeFg,
                }}
              >
                {reanchoredLabel}
              </span>
            )}
            {pendingSyncLabel && (
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded border border-dashed"
                style={{
                  borderColor: tokens.border,
                  color: tokens.badgeFg,
                }}
              >
                {pendingSyncLabel}
              </span>
            )}
          </div>

          {(onEdit || onDelete) && (
            <div className="flex items-center gap-0.5 -me-1 -mt-1 shrink-0">
              {onEdit && (
                <button
                  type="button"
                  aria-label={editAriaLabel}
                  title={editAriaLabel}
                  onClick={onEdit}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center cursor-pointer hover:bg-surface-sheet/50 transition-colors ink-icon-target"
                  style={{ color: tokens.badgeFg }}
                >
                  <IconPen className="w-3.5 h-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  aria-label={deleteAriaLabel}
                  title={deleteAriaLabel}
                  onClick={onDelete}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center cursor-pointer hover:bg-surface-sheet/50 transition-colors ink-icon-target"
                  style={{ color: tokens.badgeFg }}
                >
                  <IconClose className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {quoteExcerpt && (
          <blockquote
            className="mb-1.5 ps-2 border-s-2 border-dashed text-xs opacity-80 line-clamp-2 italic"
            style={{ borderColor: tokens.border, color: tokens.body }}
          >
            {quoteExcerpt}
          </blockquote>
        )}

        <div
          className="font-hand leading-relaxed text-sm sm:text-base break-words [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:px-1 [&_code]:rounded [&_code]:bg-surface-sheet/65 [&_ul]:ps-4 [&_ul]:my-1 [&_ol]:ps-4 [&_ol]:my-1 [&_p]:my-0.5"
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

interface NoteEditorFormProps {
  initialDraft?: string;
  initialTone?: StickerTone;
  initialStyle?: StickerStyle;
  initialTag?: MarginStickerTag;
  copy: UiMessages;
  notesCopy?: ExtendedMessages['notes'];
  compact?: boolean;
  onCancel: () => void;
  onSubmit: (patch: MarginNoteEditPatch) => Promise<void>;
}

export function MarginNoteEditorForm({
  initialDraft = '',
  initialTone = 'amber',
  initialStyle = 'tape',
  initialTag = 'note',
  copy,
  notesCopy,
  compact = false,
  onCancel,
  onSubmit,
}: NoteEditorFormProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [tone, setTone] = useState<StickerTone>(initialTone);
  const [style, setStyle] = useState<StickerStyle>(initialStyle);
  const [tag, setTag] = useState<MarginStickerTag>(initialTag);
  const [saving, setSaving] = useState(false);

  const activeTokens = STICKER_TONE_TOKENS[tone] ?? STICKER_TONE_TOKENS.amber;
  const charCount = [...draft.trim()].length;
  const isTooLong = charCount > MAX_NOTE_CHARS;

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed || isTooLong || saving) return;
    setSaving(true);
    try {
      const encoded = encodeReaderNoteSpec({ tone, style, tag });
      await onSubmit({
        content: trimmed,
        tone,
        style,
        tag,
        note_color: encoded,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`ui-popover-enter origin-top-left rounded-xl border-2 border-border-ink bg-surface-raised space-y-2.5 shadow-[3px_3px_0_0_var(--border-ink)] ${
        compact ? 'p-2.5' : 'mt-2 p-3.5 max-w-md'
      }`}
    >
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

      {/* 3. Live-Preview Handwritten Markdown Note Area */}
      <div className="space-y-1">
        <textarea
          rows={compact ? 3 : 2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSave();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={copy.stickyPlaceholder}
          aria-invalid={isTooLong}
          className="w-full rounded-xl px-3 py-2 font-hand text-base leading-relaxed border-2 resize-y"
          style={{
            backgroundColor: activeTokens.bg,
            borderColor: isTooLong ? 'var(--accent-danger-ink)' : activeTokens.border,
            color: activeTokens.title,
          }}
        />
        <div className="flex items-center justify-between gap-2 px-0.5 text-xs">
          <span className="text-ink-muted truncate">
            {notesCopy?.markdownHint ?? ''}
          </span>
          <span
            className={`font-mono tabular-nums shrink-0 ${
              isTooLong ? 'text-accent-danger font-semibold' : 'text-ink-muted'
            }`}
          >
            {charCount} / {MAX_NOTE_CHARS}
          </span>
        </div>
      </div>

      {/* 4. Color Swatches + Cancel / Save */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToneSwatchPicker
          value={tone}
          onChange={(next) => {
            if (next) setTone(next);
          }}
          copy={copy}
          ringOffsetClass="ring-offset-surface-raised"
        />

        <div className="flex items-center gap-2 ms-auto">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-7 px-2.5 py-1 text-xs text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
          >
            {copy.cancelBtn}
          </button>
          <button
            type="button"
            disabled={saving || !draft.trim() || isTooLong}
            onClick={() => void handleSave()}
            className="min-h-7 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-50"
          >
            {copy.saveStickyBtn}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BlockWithMarginProps {
  blockId: string;
  authorNote?: string | null;
  userNotes: ResolvedBlockNote[];
  copy: UiMessages;
  notesCopy?: ExtendedMessages['notes'];
  compactTrigger?: boolean;
  onAddNote: (blockId: string, patch: MarginNoteEditPatch) => Promise<void>;
  onUpdateNote?: (note: UserMarginNoteDto, patch: MarginNoteEditPatch) => Promise<void>;
  onDeleteNote: (note: UserMarginNoteDto) => Promise<void>;
  children: ReactNode;
}

export function BlockWithMargin({
  blockId,
  authorNote,
  userNotes,
  copy,
  notesCopy,
  compactTrigger = false,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  children,
}: BlockWithMarginProps) {
  const [composing, setComposing] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null);
  const contentHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = contentHostRef.current;
    if (!host) return;

    const noteItems = userNotes.map((entry) => entry.note);
    const observer = new MutationObserver(() => {
      syncHighlights();
    });

    const syncHighlights = () => {
      const target = contentHostRef.current;
      if (!target) return;
      observer.disconnect();
      try {
        applySemanticNoteHighlights(target, noteItems, (hitId) => {
          setFocusedNoteId(hitId);
          window.setTimeout(() => {
            setFocusedNoteId((prev) => (prev === hitId ? null : prev));
          }, 1800);
        });
      } finally {
        observer.takeRecords();
        observer.observe(host, { childList: true, subtree: true });
      }
    };

    syncHighlights();

    return () => {
      observer.disconnect();
    };
  }, [userNotes, blockId]);

  const hasMarginStickies = Boolean(authorNote || userNotes.length > 0);

  return (
    <div
      id={blockId}
      className={`my-4 w-full scroll-mt-24 group/margin ${
        hasMarginStickies
          ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-5 items-start'
          : ''
      }`}
    >
      {/* Main Content Column */}
      <div className="relative min-w-0 max-w-full">
        <div ref={contentHostRef} data-annotatable-block={blockId}>
          {children}
        </div>

        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          aria-expanded={composing}
          className={`mt-1.5 min-h-7 px-2 -ms-1 rounded-lg inline-flex items-center gap-1 font-hand text-xs sm:text-sm font-semibold text-ink-muted hover:text-ink-primary transition-all cursor-pointer ${
            compactTrigger && !composing && userNotes.length === 0
              ? '[@media(hover:hover)]:sm:opacity-0 [@media(hover:hover)]:sm:group-hover/margin:opacity-100 focus-visible:opacity-100'
              : ''
          }`}
        >
          <span>{copy.addStickyBtn}</span>
        </button>

        {composing && (
          <MarginNoteEditorForm
            copy={copy}
            notesCopy={notesCopy}
            onCancel={() => setComposing(false)}
            onSubmit={async (patch) => {
              await onAddNote(blockId, patch);
              setComposing(false);
            }}
          />
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

          {userNotes.map(({ note, reanchored }, idx) => {
            const spec = decodeReaderNoteSpec(
              note.tone && note.style && note.tag
                ? `${note.tone}:${note.style}:${note.tag}`
                : note.note_color,
            );
            const tagLabel =
              spec.tag === 'note'
                ? copy.myNoteBadge
                : copy.marginTags[spec.tag];

            if (editingNoteId === note.id && onUpdateNote) {
              return (
                <MarginNoteEditorForm
                  key={note.id}
                  initialDraft={note.raw_content}
                  initialTone={spec.tone}
                  initialStyle={spec.style}
                  initialTag={spec.tag}
                  copy={copy}
                  notesCopy={notesCopy}
                  compact
                  onCancel={() => setEditingNoteId(null)}
                  onSubmit={async (patch) => {
                    await onUpdateNote(note, patch);
                    setEditingNoteId(null);
                  }}
                />
              );
            }

            return (
              <MarginStickerCard
                key={note.id}
                style={spec.style}
                tone={spec.tone}
                badgeIcon={MARGIN_TAG_ICONS[spec.tag]}
                badgeLabel={tagLabel}
                reanchoredLabel={reanchored ? notesCopy?.reanchoredBadge : undefined}
                pendingSyncLabel={note.pendingSync ? notesCopy?.pendingSyncBadge : undefined}
                quoteExcerpt={isSelectionNote(note) ? extractQuoteExcerpt(note) : undefined}
                focused={focusedNoteId === note.id}
                tiltDeg={idx % 2 === 0 ? 0.7 : -0.6}
                onEdit={onUpdateNote ? () => setEditingNoteId(note.id) : undefined}
                editAriaLabel={notesCopy?.editNoteAria}
                onDelete={() => void onDeleteNote(note)}
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
  align,
  size,
  ...rest
}: Omit<BlockWithMarginProps, 'children'> & {
  html: string;
  align?: string | null;
  size?: string | null;
}) {
  const alignCls =
    align === 'center'
      ? 'ink-align-center'
      : align === 'right'
        ? 'ink-align-right'
        : align === 'left'
          ? 'ink-align-left'
          : '';
  const sizeCls =
    size === 'sm' || size === 'lg' || size === 'xl' || size === '2xl'
      ? `ink-size-${size}`
      : 'text-base';
  return (
    <BlockWithMargin {...rest}>
      <SafeHtml
        html={html}
        className={`notebook-prose ${sizeCls} ${alignCls} text-ink-primary`.trim()}
      />
    </BlockWithMargin>
  );
}
