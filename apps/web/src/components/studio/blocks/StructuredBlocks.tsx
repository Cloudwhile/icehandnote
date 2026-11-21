/*
 * Structured Visual Block Bodies:
 * - `StepsBlockBody`: Checkable notebook steps (`:::steps[...]`).
 * - `AlertBlockBody`: 9-kind stationery alerts with physical silhouette + `<ToneSwatchPicker>` + collapsible details.
 * - `CodeCardBlockBody`: Notebook code sheets (`washi`, `ruled`, `clip`, etc.) + `<AuthorMarginNoteInput>`.
 * - `ListBlockBody`: Ordered / Unordered list editor using `<SegmentedControl>`.
 */

import { UI_COPY } from '../../../lib/i18n';
import type { LocaleCode } from '../../../lib/types';
import {
  createVisualId,
  type VisualBlock,
  type VisualStepItem,
} from '../../../lib/visualBlocks';
import {
  ALERT_DOODLE_ICONS,
  ALL_ALERT_KINDS,
  ALL_CODE_CARD_STYLES,
  ALL_STICKER_STYLES,
  DEFAULT_ALERT_PRESET,
  STICKER_TONE_TOKENS,
} from '../../notebook/StationeryStickers';
import { ToneSwatchPicker } from '../../notebook/ToneSwatchPicker';
import {
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
} from '../../ui/Icons';
import { SegmentedControl } from '../../ui/Tabs';
import { AuthorMarginNoteInput } from './AuthorMarginNoteInput';

export function StepsBlockBody({
  block,
  locale,
  taskStartOffset,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'steps' }>;
  locale: LocaleCode;
  taskStartOffset: number;
  onUpdate: (next: Extract<VisualBlock, { type: 'steps' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;

  return (
    <div className="space-y-3">
      {(block.items.length > 1 || block.title.trim().length > 0) && (
        <div>
          <label className="block mb-1 text-xs font-semibold text-ink-secondary">
            {v.stepsTitleLabel}
          </label>
          <input
            type="text"
            value={block.title}
            onChange={(e) => onUpdate({ ...block, title: e.target.value })}
            placeholder={v.stepsTitlePlaceholder}
            className="w-full px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
          />
        </div>
      )}

      <div className="space-y-2">
        {block.items.map((stepItem, sIdx) => {
          const globalTaskNum = taskStartOffset + sIdx + 1;
          const updateStepItem = (patch: Partial<VisualStepItem>) => {
            const nextItems = block.items.map((it, i) =>
              i === sIdx ? { ...it, ...patch } : it,
            );
            onUpdate({ ...block, items: nextItems });
          };
          const moveStepItem = (delta: -1 | 1) => {
            const target = sIdx + delta;
            if (target < 0 || target >= block.items.length) return;
            const nextItems = [...block.items];
            const [m] = nextItems.splice(sIdx, 1);
            nextItems.splice(target, 0, m);
            onUpdate({ ...block, items: nextItems });
          };
          const removeStepItem = () => {
            const nextItems = block.items.filter((_, i) => i !== sIdx);
            onUpdate({
              ...block,
              items:
                nextItems.length > 0
                  ? nextItems
                  : [
                      {
                        id: createVisualId('st'),
                        title: '',
                        detail: '',
                        defaultChecked: false,
                      },
                    ],
            });
          };

          return (
            <div
              key={stepItem.id}
              className="p-2.5 rounded-xl bg-surface-sheet border border-border-subtle flex items-start gap-2"
            >
              <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                <span className="font-mono text-xs font-semibold text-link-ink tabular-nums">
                  {String(globalTaskNum).padStart(2, '0')}
                </span>
                <label
                  title={v.defaultCheckedTitle}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center hover:bg-surface-raised cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={stepItem.defaultChecked}
                    onChange={(e) =>
                      updateStepItem({ defaultChecked: e.target.checked })
                    }
                    aria-label={v.defaultCheckedTitle}
                    className="w-4 h-4 cursor-pointer"
                  />
                </label>
              </div>

              <div className="flex-1 min-w-0 space-y-1.5">
                <input
                  type="text"
                  value={stepItem.title}
                  onChange={(e) => updateStepItem({ title: e.target.value })}
                  placeholder={v.stepItemTitlePlaceholder}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-sm"
                />
                <input
                  type="text"
                  value={stepItem.detail}
                  onChange={(e) => updateStepItem({ detail: e.target.value })}
                  placeholder={v.stepItemDetailPlaceholder}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-secondary border border-border-subtle text-xs"
                />
              </div>

              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  type="button"
                  disabled={sIdx === 0}
                  onClick={() => moveStepItem(-1)}
                  aria-label={v.moveUp}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer"
                >
                  <IconArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={sIdx === block.items.length - 1}
                  onClick={() => moveStepItem(1)}
                  aria-label={v.moveDown}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer"
                >
                  <IconArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={removeStepItem}
                  aria-label={v.deleteBlock}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() =>
          onUpdate({
            ...block,
            items: [
              ...block.items,
              {
                id: createVisualId('st'),
                title: '',
                detail: '',
                defaultChecked: false,
              },
            ],
          })
        }
        className="min-h-8 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink inline-flex items-center gap-1.5 cursor-pointer"
      >
        <IconPlus className="w-3.5 h-3.5" />
        <span>{v.addStepItem}</span>
      </button>
    </div>
  );
}

export function AlertBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'alert' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'alert' }>) => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;

  return (
    <div className="space-y-3">
      {/* 1. Sticker Semantic Type (9 kinds) */}
      <div
        role="group"
        aria-label={v.alertKindLabel}
        className="flex flex-wrap gap-1.5"
      >
        {ALL_ALERT_KINDS.map((kind) => {
          const active = block.kind === kind;
          const presetTone = block.tone || DEFAULT_ALERT_PRESET[kind].tone;
          const tok = STICKER_TONE_TOKENS[presetTone];
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={active}
              onClick={() => onUpdate({ ...block, kind })}
              className="min-h-7 px-2.5 py-0.5 rounded-full text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              style={
                active
                  ? {
                      backgroundColor: tok.badgeBg,
                      color: tok.badgeFg,
                      borderColor: tok.border,
                    }
                  : {
                      backgroundColor: 'var(--surface-sheet)',
                      color: 'var(--ink-muted)',
                      borderColor: 'var(--border-subtle)',
                    }
              }
            >
              <span className="scale-90 inline-flex">
                {ALERT_DOODLE_ICONS[kind]}
              </span>
              <span>{copy.alertStamps[kind]}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Physical Sticker Silhouette + Paper Tone Swatches */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl bg-surface-sheet border border-border-subtle">
        <div
          role="group"
          aria-label={v.stickerStyleLabel}
          className="flex flex-wrap items-center gap-1"
        >
          <button
            type="button"
            aria-pressed={block.style === ''}
            onClick={() => onUpdate({ ...block, style: '' })}
            className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer transition-colors ${
              block.style === ''
                ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                : 'bg-surface-raised/60 text-ink-muted border-border-subtle hover:text-ink-primary'
            }`}
          >
            {v.stickerAutoOption}
          </button>
          {ALL_STICKER_STYLES.map((st) => {
            const active = block.style === st;
            return (
              <button
                key={st}
                type="button"
                aria-pressed={active}
                onClick={() => onUpdate({ ...block, style: st })}
                className={`min-h-7 px-2 py-0.5 rounded-md text-xs border cursor-pointer transition-colors ${
                  active
                    ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                    : 'bg-surface-raised/60 text-ink-muted border-border-subtle hover:text-ink-primary'
                }`}
              >
                {copy.stickerStyles[st]}
              </button>
            );
          })}
        </div>

        <ToneSwatchPicker
          value={block.tone}
          onChange={(nextTone) => onUpdate({ ...block, tone: nextTone })}
          copy={copy}
          ariaLabel={v.stickerToneLabel}
          autoOptionLabel={v.stickerAutoOption}
          ringOffsetClass="ring-offset-surface-sheet"
        />
      </div>

      {/* 3. Title + Optional Custom Stamp Badge */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
        <div className="sm:col-span-9">
          <input
            type="text"
            value={block.title}
            onChange={(e) => onUpdate({ ...block, title: e.target.value })}
            placeholder={v.alertTitlePlaceholder}
            className="w-full px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
          />
        </div>
        <div className="sm:col-span-3">
          <input
            type="text"
            maxLength={24}
            value={block.badge}
            onChange={(e) => onUpdate({ ...block, badge: e.target.value })}
            aria-label={v.stickerBadgePlaceholder}
            placeholder={
              copy.alertStamps[block.kind] || v.stickerBadgePlaceholder
            }
            className="w-full px-2.5 py-2 rounded-xl bg-surface-sheet text-ink-secondary border border-border-subtle text-xs font-hand font-semibold"
          />
        </div>
      </div>

      <textarea
        rows={Math.min(8, Math.max(2, block.body.split('\n').length + 1))}
        value={block.body}
        onChange={(e) => onUpdate({ ...block, body: e.target.value })}
        placeholder={v.alertBodyPlaceholder}
        className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm leading-relaxed ink-input-inset"
      />

      <div className="pt-1 border-t border-dashed border-border-subtle space-y-2">
        <input
          type="text"
          value={block.detailSummary}
          onChange={(e) =>
            onUpdate({ ...block, detailSummary: e.target.value })
          }
          placeholder={v.alertDetailSummaryPlaceholder}
          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-secondary border border-border-subtle text-xs"
        />
        {(block.detailSummary.trim() || block.detailBody.trim()) && (
          <textarea
            rows={2}
            value={block.detailBody}
            onChange={(e) => onUpdate({ ...block, detailBody: e.target.value })}
            placeholder={v.alertDetailBodyPlaceholder}
            className="w-full p-2.5 rounded-lg bg-surface-sheet text-ink-secondary border border-border-subtle text-xs leading-relaxed"
          />
        )}
      </div>
    </div>
  );
}

export function CodeCardBlockBody({
  block,
  locale,
  langListId,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'code_card' }>;
  locale: LocaleCode;
  langListId: string;
  onUpdate: (next: Extract<VisualBlock, { type: 'code_card' }>) => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;

  return (
    <div className="space-y-2.5">
      <div
        role="group"
        aria-label={v.codeStyleLabel}
        className="flex flex-wrap gap-1.5"
      >
        {ALL_CODE_CARD_STYLES.map((st) => {
          const active = block.style === st;
          return (
            <button
              key={st}
              type="button"
              aria-pressed={active}
              onClick={() => onUpdate({ ...block, style: st })}
              className={`min-h-7 px-2.5 py-0.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                active
                  ? 'font-semibold bg-action-subtle text-link-ink border-border-ink'
                  : 'bg-surface-sheet text-ink-muted border-border-subtle hover:text-ink-primary'
              }`}
            >
              {copy.codeCardStyles[st]}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
        <div className="sm:col-span-4">
          <input
            type="text"
            list={langListId}
            value={block.language}
            onChange={(e) => onUpdate({ ...block, language: e.target.value })}
            aria-label={v.codeLangLabel}
            placeholder="rust"
            className="w-full px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-primary border border-border-subtle text-xs font-mono"
          />
        </div>
        <div className="sm:col-span-8">
          <input
            type="text"
            value={block.filename}
            onChange={(e) => onUpdate({ ...block, filename: e.target.value })}
            placeholder={v.codeFilePlaceholder}
            className="w-full px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-primary border border-border-subtle text-xs font-mono"
          />
        </div>
      </div>

      <textarea
        rows={Math.min(14, Math.max(4, block.code.split('\n').length + 1))}
        value={block.code}
        onChange={(e) => onUpdate({ ...block, code: e.target.value })}
        placeholder={v.codeBodyPlaceholder}
        spellCheck={false}
        className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle font-mono text-xs leading-relaxed ink-input-inset"
      />

      <AuthorMarginNoteInput
        locale={locale}
        rawValue={block.marginNote}
        onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
      />
    </div>
  );
}

export function ListBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'list' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'list' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;

  return (
    <div className="space-y-2.5">
      <SegmentedControl
        options={[
          { value: 'unordered' as const, label: v.listUnordered },
          { value: 'ordered' as const, label: v.listOrdered },
        ]}
        value={block.ordered ? 'ordered' : 'unordered'}
        onChange={(mode) =>
          onUpdate({ ...block, ordered: mode === 'ordered' })
        }
        ariaLabel={v.types.list}
        surface="sheet"
      />

      <div className="space-y-1.5">
        {block.items.map((itemText, lIdx) => (
          <div key={lIdx} className="flex items-center gap-2">
            <span className="font-mono text-xs text-link-ink w-5 text-end shrink-0 tabular-nums">
              {block.ordered ? `${lIdx + 1}.` : '✦'}
            </span>
            <input
              type="text"
              value={itemText}
              onChange={(e) => {
                const nextItems = block.items.map((it, i) =>
                  i === lIdx ? e.target.value : it,
                );
                onUpdate({ ...block, items: nextItems });
              }}
              placeholder={v.listItemPlaceholder}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-primary border border-border-subtle text-sm"
            />
            <button
              type="button"
              onClick={() => {
                const nextItems = block.items.filter((_, i) => i !== lIdx);
                onUpdate({
                  ...block,
                  items: nextItems.length > 0 ? nextItems : [''],
                });
              }}
              aria-label={v.deleteBlock}
              className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-sheet cursor-pointer shrink-0"
            >
              <IconTrash className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onUpdate({ ...block, items: [...block.items, ''] })}
        className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink inline-flex items-center gap-1.5 cursor-pointer"
      >
        <IconPlus className="w-3.5 h-3.5" />
        <span>{v.addListItem}</span>
      </button>
    </div>
  );
}
