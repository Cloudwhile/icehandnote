import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, runDirectionalTransition } from '../../lib/api';
import { UI_COPY } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { LocaleCode, SearchHitDto } from '../../lib/types';
import { NotebookEmptyState } from '../notebook/NotebookEmptyState';
import { IconClose, IconSnowflake } from '../ui/Icons';
import { ModalDialog, ModalHeader } from '../ui/ModalDialog';

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
      setLoading(false);
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
    runDirectionalTransition(
      () => navigate(`/${locale}/series/${hit.track_slug}/${hit.step_slug}`),
      'forward',
    );
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-lg"
      mobilePlacement="top"
    >
      <div className="p-4 sm:p-5 space-y-4">
        <ModalHeader
          titleId={titleId}
          title={copy.searchTitle}
          icon={<IconSnowflake className="w-4 h-4 text-accent-ice shrink-0" />}
          closeLabel={copy.closeLabel}
          onClose={onClose}
          handFont
          bordered={false}
        />

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
            className={`w-full px-3.5 py-2.5 rounded-xl bg-surface-raised text-ink-primary border border-border-ink text-base sm:text-sm ink-input-inset ${
              query ? 'pe-10' : ''
            }`.trim()}
          />
          {query && (
            <button
              type="button"
              aria-label={copy.clearSearchLabel}
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute end-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-sheet cursor-pointer transition-colors ink-icon-target"
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          )}
        </search>

        {query.trim() && (
          <div className="max-h-[min(20rem,52dvh)] overflow-y-auto overscroll-contain space-y-2">
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {!loading && hits.length === 0 ? copy.searchEmptyTitle : ''}
            </div>
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
                    <SafeHtml as="span" html={hit.track_title} />
                    <span className="font-mono uppercase tracking-wider">{hit.locale}</span>
                  </div>
                  <div
                    className="text-sm font-semibold text-ink-primary"
                    style={{ fontFamily: 'var(--font-hand)' }}
                  >
                    <SafeHtml as="span" html={hit.title} />
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
