import { useId } from 'react';
import type { UiMessages } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { StepTaskItem, TaskScope } from '../../lib/types';
import { IconCheckSquare } from '../ui/Icons';

interface NotebookStepsBlockProps {
  blockId: string;
  title?: string | null;
  scope?: TaskScope;
  items: StepTaskItem[];
  /** 1-based global ordinal of the first item in this block across the article */
  startNumber?: number;
  checkedIds: Set<string>;
  onToggle?: (itemId: string, checked: boolean) => void;
  onResetBlock?: (itemIds: string[]) => void;
  readOnly?: boolean;
  copy: UiMessages;
}

export function NotebookStepsBlock({
  blockId,
  title,
  scope = 'section',
  items,
  startNumber = 1,
  checkedIds,
  onToggle,
  onResetBlock,
  readOnly = false,
  copy,
}: NotebookStepsBlockProps) {
  const headingId = useId();
  const total = items.length;
  const doneCount = items.filter((item) => checkedIds.has(item.item_id)).length;
  const trimmedTitle = title?.trim() ?? '';
  const isParagraphScope = scope === 'paragraph';

  if (total === 1) {
    const item = items[0];
    const isChecked = checkedIds.has(item.item_id);
    const ordinalText = String(startNumber).padStart(2, '0');

    return (
      <div
        id={blockId}
        className={
          isParagraphScope ? 'notebook-task-paragraph' : 'notebook-task-section'
        }
        data-scope={scope}
        data-checked={isChecked ? 'true' : 'false'}
      >
        <label
          className="notebook-step-row"
          data-checked={isChecked ? 'true' : 'false'}
        >
          <input
            type="checkbox"
            className="notebook-step-checkbox"
            checked={isChecked}
            disabled={readOnly || !onToggle}
            onChange={(e) => onToggle?.(item.item_id, e.target.checked)}
          />

          <span
            key={`${item.item_id}-${isChecked ? 'done' : 'todo'}`}
            aria-hidden="true"
            className={`w-6 h-6 rounded-lg inline-flex items-center justify-center shrink-0 mt-0.5 text-xs font-mono font-semibold tabular-nums transition-colors ${
              isChecked
                ? 'bg-surface-sheet border border-border-subtle text-accent-success ui-badge-pop'
                : isParagraphScope
                  ? 'bg-surface-raised border border-border-subtle text-accent-ice'
                  : 'bg-action-subtle text-link-ink'
            }`}
          >
            {ordinalText}
          </span>

          <div className="flex-1 min-w-0 space-y-1">
            {trimmedTitle && (
              <div className="text-xs font-semibold text-ink-muted">
                {trimmedTitle}
              </div>
            )}

            <SafeHtml
              html={item.title_html}
              className={`notebook-prose font-semibold transition-colors ${
                isParagraphScope ? 'text-sm' : 'text-sm sm:text-base'
              } ${
                isChecked
                  ? 'line-through text-ink-muted'
                  : 'text-ink-primary'
              }`}
            />
            {item.detail_html && (
              <SafeHtml
                html={item.detail_html}
                className="notebook-prose text-xs sm:text-sm text-ink-secondary"
              />
            )}
          </div>
        </label>
      </div>
    );
  }

  // Grouped multi-item checklist (also carries scope badge: 节任务 / 段任务)
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const allDone = total > 0 && doneCount === total;
  const headingText = trimmedTitle || copy.stepsDefaultTitle;

  return (
    <section
      id={blockId}
      aria-labelledby={headingId}
      data-scope={scope}
      className="notebook-steps-card"
    >
      <div className="px-4 py-3 bg-surface-sheet space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 min-w-0">
            <IconCheckSquare className="w-4 h-4 text-accent-ice shrink-0" />
            <h3
              id={headingId}
              className="text-sm sm:text-base font-semibold text-ink-primary m-0 leading-snug"
            >
              {headingText}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {allDone && (
              <span
                className="ui-badge-pop px-2 py-0.5 rounded-full text-xs font-semibold text-accent-success border border-border-subtle"
                style={{ backgroundColor: 'var(--steps-checked-bg)' }}
              >
                {copy.stepsAllDoneBadge}
              </span>
            )}
            <span className="text-xs text-ink-muted tabular-nums">
              {copy.stepsProgressLabel(doneCount, total)}
            </span>
            {!readOnly && onResetBlock && doneCount > 0 && (
              <button
                type="button"
                onClick={() => onResetBlock(items.map((it) => it.item_id))}
                className="min-h-7 px-2 py-0.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:underline cursor-pointer ui-press-tactile"
              >
                {copy.stepsResetBtn}
              </button>
            )}
          </div>
        </div>

        <progress
          max={100}
          value={pct}
          aria-label={headingText}
          className="notebook-progress w-full block"
        >
          {pct}%
        </progress>
      </div>

      <ol className="list-none m-0 p-0">
        {items.map((item, idx) => {
          const isChecked = checkedIds.has(item.item_id);
          const ordinalText = String(startNumber + idx).padStart(2, '0');
          return (
            <li key={item.item_id}>
              <label
                className="notebook-step-row"
                data-checked={isChecked ? 'true' : 'false'}
              >
                <input
                  type="checkbox"
                  className="notebook-step-checkbox"
                  checked={isChecked}
                  disabled={readOnly || !onToggle}
                  onChange={(e) => onToggle?.(item.item_id, e.target.checked)}
                />

                <span
                  key={`${item.item_id}-${isChecked ? 'done' : 'todo'}`}
                  aria-hidden="true"
                  className={`w-6 h-6 rounded-lg inline-flex items-center justify-center shrink-0 mt-0.5 text-xs font-mono font-semibold tabular-nums transition-colors ${
                    isChecked
                      ? 'bg-surface-sheet border border-border-subtle text-accent-success ui-badge-pop'
                      : 'bg-action-subtle text-link-ink'
                  }`}
                >
                  {ordinalText}
                </span>

                <div className="flex-1 min-w-0 space-y-1">
                  <SafeHtml
                    html={item.title_html}
                    className={`notebook-prose text-sm sm:text-base font-semibold transition-colors ${
                      isChecked
                        ? 'line-through text-ink-muted'
                        : 'text-ink-primary'
                    }`}
                  />
                  {item.detail_html && (
                    <SafeHtml
                      html={item.detail_html}
                      className="notebook-prose text-xs sm:text-sm text-ink-secondary"
                    />
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
