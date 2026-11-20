import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { UI_COPY } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { LocaleCode, SearchHitDto } from '../../lib/types';
import { NotebookEmptyState } from '../notebook/NotebookEmptyState';
import { IconSnowflake } from '../ui/Icons';
import { ModalDialog } from '../ui/ModalDialog';

interface CommandSearchDialogProps {
  open: boolean;
  onClose: () => void;
  locale: LocaleCode;
}

export function CommandSearchDialog({
  open,
  onClose,
  locale,
}: CommandSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const navigate = useNavigate();
  const copy = UI_COPY[locale];

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .search(locale, trimmed)
        .then((res) => {
          if (!cancelled) setHits(res);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, locale, open]);

  const jumpToHit = (hit: SearchHitDto) => {
    onClose();
    navigate(`/${locale}/tracks/${hit.track_slug}/${hit.chapter_slug}/${hit.step_slug}`);
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-lg"
    >
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="text-base font-semibold m-0 text-ink-primary inline-flex items-center gap-2"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            <IconSnowflake className="w-4 h-4 text-accent-ice" />
            <span>{copy.searchTitle}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink-primary border border-border-subtle cursor-pointer"
          >
            {copy.closeLabel}
          </button>
        </div>

        <search className="relative block">
          <input
            ref={inputRef}
            type="search"
            name="q"
            aria-labelledby={titleId}
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={copy.searchPlaceholder}
            className="w-full px-3.5 py-2.5 rounded-xl bg-surface-raised text-ink-primary border border-border-ink text-sm ink-input-inset"
          />
        </search>

        {query.trim() && (
          <div className="max-h-80 overflow-y-auto space-y-2 studio-scroll-pane">
            {loading ? (
              <p className="text-xs text-ink-muted py-4 text-center">…</p>
            ) : hits.length === 0 ? (
              <NotebookEmptyState
                title={copy.searchEmptyTitle}
                description={copy.searchEmptyBody}
              />
            ) : (
              hits.map((hit) => (
                <button
                  key={`${hit.track_slug}:${hit.step_slug}`}
                  type="button"
                  onClick={() => jumpToHit(hit)}
                  className="w-full text-start p-3 rounded-xl bg-surface-raised hover:bg-action-subtle/60 border border-border-subtle transition-colors cursor-pointer block space-y-1"
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs text-ink-muted">
                    <span>{hit.track_title}</span>
                    <span className="font-mono uppercase tracking-wider">{hit.locale}</span>
                  </div>
                  <div
                    className="text-sm font-semibold text-ink-primary"
                    style={{ fontFamily: 'var(--font-hand)' }}
                  >
                    {hit.title}
                  </div>
                  <SafeHtml
                    html={hit.snippet_html}
                    className="text-xs text-ink-secondary leading-relaxed"
                  />
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
