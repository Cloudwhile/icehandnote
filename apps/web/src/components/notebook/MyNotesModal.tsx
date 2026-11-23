/*
 * Global Cross-Article Reading Notes Hub (`MyNotesModal`)
 * - Built on native `<ModalDialog>` (`showModal()`, `closedby="any"`, `overscroll-behavior: contain`).
 * - Supports server-derived identity (Bearer Session or HttpOnly signed guest cookie),
 *   tag filtering (`note`/`idea`/`ask`/`star`/`todo`), full-text search, deep-link jumping
 *   to `/${locale}/series/${track}/${step}#${block_anchor_id}`, soft-delete with Undo Toast,
 *   and standards-compliant export (RFC 7763 Markdown + W3C Web Annotation JSON-LD).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  buildNoteEtag,
  extractQuoteExcerpt,
} from '../../lib/annotationAnchor';
import { api } from '../../lib/api';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { SafeHtml, stripHtmlTags } from '../../lib/sanitizer';
import type {
  LocaleCode,
  MarginStickerTag,
  UserMarginNoteDto,
} from '../../lib/types';
import { IconBook, IconSearch, IconTrash } from '../ui/Icons';
import { ModalDialog, ModalHeader } from '../ui/ModalDialog';
import { useToast } from '../ui/ToastProvider';
import {
  ALL_MARGIN_TAGS,
  decodeReaderNoteSpec,
  MARGIN_TAG_ICONS,
  STICKER_TONE_TOKENS,
} from './StationeryStickers';

interface MyNotesModalProps {
  open: boolean;
  onClose: () => void;
  locale: LocaleCode;
  /** Incrementing trigger so opening after editing on Reader refreshes immediately */
  refreshKey?: number;
}

export function MyNotesModal({
  open,
  onClose,
  locale,
  refreshKey = 0,
}: MyNotesModalProps) {
  const titleId = useId();
  const navigate = useNavigate();
  const toast = useToast();
  const ui = UI_COPY[locale];
  const notesCopy = EXT_COPY[locale].notes;

  const [notes, setNotes] = useState<UserMarginNoteDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTag, setActiveTag] = useState<'all' | MarginStickerTag>('all');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState<'markdown' | 'w3c-jsonld' | null>(
    null,
  );
  const loadSeqRef = useRef(0);

  const loadNotes = useCallback(async () => {
    const seq = (loadSeqRef.current += 1);
    setLoading(true);
    try {
      const list = await api.listAllMarginNotes({
        tag: activeTag === 'all' ? undefined : activeTag,
        q: query.trim() || undefined,
        limit: 200,
      });
      if (loadSeqRef.current !== seq) return;
      setNotes(list);
    } catch (err) {
      if (loadSeqRef.current !== seq) return;
      toast.error(err);
    } finally {
      if (loadSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, [activeTag, query, toast]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadNotes();
    }, query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [open, loadNotes, query, refreshKey]);

  const handleExport = async (format: 'markdown' | 'w3c-jsonld') => {
    if (exporting) return;
    setExporting(format);
    try {
      const { blob, filename } = await api.exportMarginNotes(format, {
        tag: activeTag === 'all' ? undefined : activeTag,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(notesCopy.exportSuccessToast);
    } catch (err) {
      toast.error(err);
    } finally {
      setExporting(null);
    }
  };

  const handleDelete = async (note: UserMarginNoteDto) => {
    try {
      const res = await api.deleteMarginNote(note.id, buildNoteEtag(note));
      if (!res.deleted) return;
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      window.dispatchEvent(new CustomEvent('ihn:notes-changed'));
      toast.info(notesCopy.noteDeletedToast, {
        label: notesCopy.undoDeleteBtn,
        onClick: async () => {
          try {
            const restored = await api.restoreMarginNote(note.id);
            setNotes((prev) => [
              {
                ...note,
                ...restored,
              },
              ...prev.filter((n) => n.id !== restored.id),
            ]);
            window.dispatchEvent(new CustomEvent('ihn:notes-changed'));
            toast.success(notesCopy.noteRestoredToast);
          } catch (err) {
            toast.error(err);
          }
        },
      });
    } catch (err) {
      toast.error(err);
    }
  };

  const handleJump = (note: UserMarginNoteDto) => {
    if (!note.track_slug || !note.step_slug) return;
    const targetLocale = note.locale_code || locale;
    const hash = note.block_anchor_id ? `#${encodeURIComponent(note.block_anchor_id)}` : '';
    onClose();
    navigate(
      `/${encodeURIComponent(targetLocale)}/series/${encodeURIComponent(note.track_slug)}/${encodeURIComponent(note.step_slug)}${hash}`,
    );
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-2xl"
      stableScrollbarGutter
    >
      <div className="p-5 sm:p-6 space-y-4">
        <ModalHeader
          titleId={titleId}
          title={notesCopy.myNotesTitle}
          icon={<IconBook className="w-5 h-5 text-link-ink shrink-0" />}
          closeLabel={ui.closeLabel}
          onClose={onClose}
          handFont
          trailing={
            notes.length > 0 ? (
              <span className="text-xs font-mono text-ink-muted tabular-nums">
                {notes.length}
              </span>
            ) : undefined
          }
        />

        {/* Search & Tag Filter Bar */}
        <div className="space-y-2.5">
          <div className="relative">
            <IconSearch className="w-4 h-4 text-ink-muted absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              autoFocus={
                typeof window !== 'undefined' &&
                window.matchMedia('(pointer: fine)').matches
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={notesCopy.searchPlaceholder}
              aria-label={notesCopy.searchPlaceholder}
              className="ink-field-input w-full ps-9 pe-3 py-2 text-base sm:text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex sm:flex-wrap items-center gap-1.5 max-sm:overflow-x-auto max-sm:pb-1 max-sm:w-full ink-thin-scrollbar">
              <button
                type="button"
                aria-pressed={activeTag === 'all'}
                onClick={() => setActiveTag('all')}
                className={`min-h-8 sm:min-h-7 shrink-0 px-2.5 py-0.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                  activeTag === 'all'
                    ? 'bg-action-subtle text-link-ink border-action-bg'
                    : 'bg-surface-raised text-ink-secondary border-border-subtle hover:text-ink-primary'
                }`}
              >
                {notesCopy.filterAllTag}
              </button>
              {ALL_MARGIN_TAGS.map((t) => {
                const selected = activeTag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveTag(t)}
                    className={`min-h-8 sm:min-h-7 shrink-0 px-2.5 py-0.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      selected
                        ? 'bg-action-subtle text-link-ink border-action-bg'
                        : 'bg-surface-raised text-ink-secondary border-border-subtle hover:text-ink-primary'
                    }`}
                  >
                    {MARGIN_TAG_ICONS[t]}
                    <span>{ui.marginTags[t]}</span>
                  </button>
                );
              })}
            </div>

            {notes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void handleExport('markdown')}
                  className="min-h-8 sm:min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border-subtle bg-surface-raised text-ink-secondary hover:text-ink-primary hover:border-border-ink cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {notesCopy.exportMdBtn}
                </button>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void handleExport('w3c-jsonld')}
                  className="min-h-8 sm:min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border-subtle bg-surface-raised text-ink-secondary hover:text-ink-primary hover:border-border-ink cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {notesCopy.exportJsonLdBtn}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Notes List */}
        <div className="max-h-[56dvh] overflow-y-auto ink-thin-scrollbar space-y-2.5 pe-1">
          {loading ? (
            <div className="space-y-2.5 py-2">
              <div className="h-20 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
              <div className="h-20 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
            </div>
          ) : notes.length === 0 ? (
            <div className="py-10 px-4 text-center rounded-2xl border border-dashed border-border-subtle bg-surface-raised/60 space-y-1.5">
              <p className="text-sm font-semibold text-ink-primary m-0">
                {notesCopy.emptyTitle}
              </p>
              <p className="text-xs text-ink-muted m-0 max-w-sm mx-auto leading-relaxed">
                {notesCopy.emptyDesc}
              </p>
            </div>
          ) : (
            notes.map((note) => {
              const spec = decodeReaderNoteSpec(
                note.tone && note.style && note.tag
                  ? `${note.tone}:${note.style}:${note.tag}`
                  : note.note_color,
              );
              const tokens =
                STICKER_TONE_TOKENS[spec.tone] ?? STICKER_TONE_TOKENS.amber;
              const quote = extractQuoteExcerpt(note);
              const cleanTitle = note.step_title
                ? stripHtmlTags(note.step_title)
                : note.step_slug || '';
              const stampDate = (note.updated_at || note.created_at).slice(0, 10);

              return (
                <article
                  key={note.id}
                  className="rounded-xl border border-border-subtle bg-surface-sheet p-3.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="font-hand text-xs font-semibold inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed shrink-0"
                        style={{
                          backgroundColor: tokens.badgeBg,
                          color: tokens.badgeFg,
                          borderColor: tokens.border,
                        }}
                      >
                        {MARGIN_TAG_ICONS[spec.tag]}
                        <span>{ui.marginTags[spec.tag]}</span>
                      </span>
                      {cleanTitle && (
                        <button
                          type="button"
                          onClick={() => handleJump(note)}
                          className="text-xs font-semibold text-ink-secondary hover:text-link-ink truncate cursor-pointer transition-colors"
                          title={cleanTitle}
                        >
                          {cleanTitle}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono text-ink-muted tabular-nums">
                        {note.locale_code} · {stampDate}
                      </span>
                      {note.track_slug && note.step_slug && (
                        <button
                          type="button"
                          onClick={() => handleJump(note)}
                          className="text-xs font-semibold text-link-ink hover:text-link-hover-ink cursor-pointer transition-colors"
                        >
                          {notesCopy.jumpToArticleBtn}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(note)}
                        aria-label={ui.deleteStickyAria}
                        title={ui.deleteStickyAria}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger cursor-pointer transition-colors ink-icon-target"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {quote && (
                    <blockquote className="m-0 ps-2.5 border-s-2 border-border-control text-xs text-ink-muted line-clamp-2">
                      {quote}
                    </blockquote>
                  )}

                  <div
                    className="rounded-lg px-3 py-2 font-hand text-sm leading-relaxed break-words [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:px-1 [&_code]:rounded [&_code]:bg-surface-sheet/70"
                    style={{
                      backgroundColor: tokens.bg,
                      color: tokens.title,
                    }}
                  >
                    <SafeHtml html={note.content_html} />
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
