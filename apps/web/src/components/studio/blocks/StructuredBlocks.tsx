/*
 * Hand-Drawn Stationery WYSIWYG Structured Block Bodies:
 * - `AlertBlockBody`: Renders in-place inside `.sticker-card` (`<StickerCardFrame>`) with real stamp badges,
 *   svg ornaments, and clean style/tone/disclosure controls tucked inside `<AlertStylePopover>`.
 * - `CodeCardBlockBody`: Renders in-place inside `.washi-code-surface` (`<WashiCodeFrame>`) with drafting grid/ruled
 *   paper lines, `<CodeStylePopover>`, and optional side `<InlineAuthorMarginSticky>`.
 * - `StepsBlockBody`: Renders inside real `.notebook-task-paragraph` / `.notebook-steps-card` with Enter-to-add,
 *   Enter-on-empty to exit, Backspace cleanup, and on-demand `+ Detail` reveal.
 * - `ListBlockBody`: Borderless live `✦` / `1.` items directly on the stationery sheet with Enter/Backspace flow.
 */

import { type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from 'react';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import { blockAlignClass, blockSizeClass } from '../../../lib/richInline';
import type { LocaleCode } from '../../../lib/types';
import {
  createVisualId,
  normalizeCodeCardStyle,
  type VisualBlock,
  type VisualStepItem,
} from '../../../lib/visualBlocks';
import { StickerCardFrame } from '../../notebook/NotebookAlert';
import { WashiCodeFrame } from '../../notebook/WashiCodeCard';
import { IconPlus, IconSparkBullet, IconTrash } from '../../ui/Icons';
import { SegmentedControl } from '../../ui/Tabs';
import {
  AlertStylePopover,
  CodeStylePopover,
  InlineAuthorMarginSticky,
  useAutoResizeTextarea,
} from './BlockFloatingControls';
import { focusRichEditable, RichEditable } from './RichEditable';
import type { FlowBlockHandlers } from './TextAndMediaBlocks';

export function StepsBlockBody({
  block,
  locale,
  taskStartOffset,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'steps' }>;
  locale: LocaleCode;
  taskStartOffset: number;
  onUpdate: (next: Extract<VisualBlock, { type: 'steps' }>) => void;
  flow: FlowBlockHandlers;
}) {
  const v = UI_COPY[locale].studio.visual;
  const extFlow = EXT_COPY[locale].studio.flowEditor;
  const [expandedDetailIds, setExpandedDetailIds] = useState<Set<string>>(
    () => new Set(),
  );

  const scheduleItemFocus = (idx: number, caret: number | 'end' = 0) => {
    requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>(
        `[data-flow-block-id="${block.id}"]`,
      );
      const input = container?.querySelector<HTMLElement>(
        `[data-flow-step-idx="${idx}"]`,
      );
      if (input) {
        focusRichEditable(input, caret);
      }
    });
  };

  const isMulti = block.items.length > 1 || block.title.trim().length > 0;
  const shellClass = isMulti ? 'notebook-steps-card' : 'notebook-task-paragraph';

  return (
    <div className={`${shellClass} my-1!`}>
      {isMulti && (
        <div className="px-4 py-2.5 border-b border-dashed border-border-subtle bg-surface-sheet/80 flex items-center justify-between gap-2">
          <input
            type="text"
            size={1}
            value={block.title}
            onChange={(e) => onUpdate({ ...block, title: e.target.value })}
            aria-label={v.stepsTitlePlaceholder || v.types.steps}
            placeholder={v.stepsTitlePlaceholder || v.types.steps}
            className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm font-semibold text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          <span className="font-mono text-xs text-ink-muted tabular-nums shrink-0">
            {block.items.filter((it) => it.defaultChecked).length}/{block.items.length}
          </span>
        </div>
      )}

      <div>
        {block.items.map((stepItem, sIdx) => {
          const globalTaskNum = taskStartOffset + sIdx + 1;
          const showDetail =
            stepItem.detail.length > 0 || expandedDetailIds.has(stepItem.id);

          const updateStepItem = (patch: Partial<VisualStepItem>) => {
            onUpdate({
              ...block,
              items: block.items.map((it, i) =>
                i === sIdx ? { ...it, ...patch } : it,
              ),
            });
          };

          return (
            <div
              key={stepItem.id}
              data-checked={stepItem.defaultChecked ? 'true' : 'false'}
              className="notebook-step-row group cursor-default!"
            >
              <input
                type="checkbox"
                checked={stepItem.defaultChecked}
                onChange={(e) =>
                  updateStepItem({ defaultChecked: e.target.checked })
                }
                aria-label={v.defaultCheckedTitle}
                title={v.defaultCheckedTitle}
                className="notebook-step-checkbox mt-1!"
              />

              <span className="font-mono text-xs font-semibold text-link-ink mt-1 shrink-0 tabular-nums">
                {String(globalTaskNum).padStart(2, '0')}.
              </span>

              <div className="flex-1 min-w-0 space-y-1">
                <RichEditable
                  blockId={block.id}
                  multiline={false}
                  flowInputRole={sIdx === 0 ? 'primary' : undefined}
                  extraDataAttrs={{ 'data-flow-step-idx': sIdx }}
                  value={stepItem.title}
                  placeholder={v.stepItemTitlePlaceholder}
                  onChange={(val) => updateStepItem({ title: val })}
                  onSelectionReport={flow.onSelectionReport}
                  onEnterKey={(e, { beforeMd, afterMd }) => {
                    e.preventDefault();
                    if (!beforeMd.trim() && !afterMd.trim()) {
                      if (block.items.length === 1) {
                        flow.onReplaceBlock(
                          {
                            id: block.id,
                            type: 'paragraph',
                            text: '',
                            marginNote: '',
                          },
                          { caret: 0 },
                        );
                      } else {
                        const nextItems = block.items.filter((_, i) => i !== sIdx);
                        flow.onCommitAndInsertAfter(
                          { ...block, items: nextItems },
                          {
                            id: createVisualId(),
                            type: 'paragraph',
                            text: '',
                            marginNote: '',
                          },
                          0,
                        );
                      }
                      return true;
                    }

                    const nextItems = [...block.items];
                    nextItems[sIdx] = { ...stepItem, title: beforeMd };
                    nextItems.splice(sIdx + 1, 0, {
                      id: createVisualId('st'),
                      title: afterMd,
                      detail: '',
                      defaultChecked: false,
                    });
                    onUpdate({ ...block, items: nextItems });
                    scheduleItemFocus(sIdx + 1, 0);
                    return true;
                  }}
                  onBackspaceAtStart={(remainingMd) => {
                    if (!remainingMd.trim() && !stepItem.detail.trim()) {
                      if (block.items.length <= 1) {
                        flow.onReplaceBlock(
                          {
                            id: block.id,
                            type: 'paragraph',
                            text: '',
                            marginNote: '',
                          },
                          { caret: 0 },
                        );
                      } else {
                        const prevIdx = Math.max(0, sIdx - 1);
                        const nextItems = block.items.filter((_, i) => i !== sIdx);
                        onUpdate({ ...block, items: nextItems });
                        scheduleItemFocus(prevIdx, 'end');
                      }
                      return true;
                    }
                    return false;
                  }}
                  onMoveVertical={(dir) => {
                    if (dir < 0 && sIdx > 0) {
                      scheduleItemFocus(sIdx - 1, 'end');
                      return true;
                    }
                    if (dir < 0 && sIdx === 0) {
                      flow.onMoveFocusVertical(-1);
                      return true;
                    }
                    if (dir > 0 && sIdx < block.items.length - 1) {
                      scheduleItemFocus(sIdx + 1, 0);
                      return true;
                    }
                    if (dir > 0 && sIdx === block.items.length - 1) {
                      flow.onMoveFocusVertical(1);
                      return true;
                    }
                    return false;
                  }}
                  className="w-full min-w-0 text-sm text-ink-primary font-semibold"
                />

                {showDetail && (
                  <RichEditable
                    blockId={block.id}
                    multiline={false}
                    flowInputRole={undefined}
                    value={stepItem.detail}
                    placeholder={v.stepItemDetailPlaceholder}
                    onChange={(val) => updateStepItem({ detail: val })}
                    onSelectionReport={flow.onSelectionReport}
                    className="w-full min-w-0 text-xs text-ink-secondary"
                  />
                )}
              </div>

              <div className="flow-hover-controls flex items-center gap-1 shrink-0">
                {!showDetail && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedDetailIds((prev) => new Set(prev).add(stepItem.id))
                    }
                    className="min-h-7 px-2 py-0.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer"
                  >
                    {extFlow.addStepDetailBtn}
                  </button>
                )}
                {block.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate({
                        ...block,
                        items: block.items.filter((_, i) => i !== sIdx),
                      })
                    }
                    aria-label={v.deleteBlock}
                    className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3.5 py-2 border-t border-dashed border-border-subtle/70 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            const nextIdx = block.items.length;
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
            });
            scheduleItemFocus(nextIdx, 0);
          }}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle inline-flex items-center gap-1 cursor-pointer transition-colors"
        >
          <IconPlus className="w-3.5 h-3.5" />
          <span>{v.addStepItem}</span>
        </button>
      </div>
    </div>
  );
}

export function AlertBlockBody({
  block,
  locale,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'alert' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'alert' }>) => void;
  flow?: FlowBlockHandlers;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const [detailForcedOpen, setDetailForcedOpen] = useState(false);

  const hasDetailContent = Boolean(
    block.detailSummary.trim() || block.detailBody.trim(),
  );
  const showDetail = detailForcedOpen || hasDetailContent;
  const displayBadge = block.badge.trim() || copy.alertStamps[block.kind];

  return (
    <StickerCardFrame
      kind={block.kind}
      style={block.style}
      tone={block.tone}
      className="my-2 w-full"
      topRightControl={
        <div className="flow-hover-controls">
          <AlertStylePopover
            block={block}
            locale={locale}
            detailOpen={showDetail}
            onToggleDetail={() => {
              if (showDetail) {
                setDetailForcedOpen(false);
                onUpdate({ ...block, detailSummary: '', detailBody: '' });
              } else {
                setDetailForcedOpen(true);
              }
            }}
            onUpdate={onUpdate}
          />
        </div>
      }
    >
      {({ tokens }) => (
        <div
          className={`space-y-1.5 pe-9 sm:pe-20 ${blockAlignClass(block.align)} ${blockSizeClass(block.size)}`.trim()}
        >
          <div
            className={`flex flex-wrap items-baseline gap-2 ${
              block.align === 'center'
                ? 'justify-center'
                : block.align === 'right'
                  ? 'justify-end'
                  : ''
            }`.trim()}
          >
            <span
              className="font-hand text-xs sm:text-sm font-semibold tracking-wide px-2 py-0.5 rounded border border-dashed shrink-0"
              style={{
                backgroundColor: tokens.badgeBg,
                color: tokens.badgeFg,
                borderColor: tokens.border,
              }}
            >
              {displayBadge}
            </span>

            <input
              type="text"
              size={1}
              value={block.title}
              onChange={(e) => onUpdate({ ...block, title: e.target.value })}
              aria-label={v.alertTitlePlaceholder}
              placeholder={v.alertTitlePlaceholder}
              className="flex-1 min-w-24 bg-transparent border-0 p-0 font-hand text-base sm:text-lg font-semibold leading-snug focus:outline-none"
              style={{ color: tokens.title }}
            />
          </div>

          <div style={{ color: tokens.body }}>
            <RichEditable
              blockId={block.id}
              value={block.body}
              multiline={true}
              flowInputRole="primary"
              placeholder={v.alertBodyPlaceholder}
              onChange={(val) => onUpdate({ ...block, body: val })}
              onSelectionReport={flow?.onSelectionReport}
              onMoveVertical={
                flow
                  ? (dir) => {
                      flow.onMoveFocusVertical(dir);
                      return true;
                    }
                  : undefined
              }
              className={`text-sm leading-relaxed ${blockAlignClass(block.align)} ${blockSizeClass(block.size)}`.trim()}
            />
          </div>

          {showDetail && (
            <div
              className="mt-2 pt-2 border-t border-dashed space-y-1.5"
              style={{ borderColor: tokens.border }}
            >
              <input
                type="text"
                value={block.detailSummary}
                onChange={(e) =>
                  onUpdate({ ...block, detailSummary: e.target.value })
                }
                aria-label={v.alertDetailSummaryPlaceholder}
                placeholder={v.alertDetailSummaryPlaceholder}
                className="w-full bg-transparent border-0 p-0 text-xs font-semibold focus:outline-none"
                style={{ color: tokens.title }}
              />
              <div style={{ color: tokens.body }}>
                <RichEditable
                  blockId={block.id}
                  value={block.detailBody}
                  multiline={true}
                  flowInputRole={undefined}
                  placeholder={v.alertDetailBodyPlaceholder}
                  onChange={(val) => onUpdate({ ...block, detailBody: val })}
                  onSelectionReport={flow?.onSelectionReport}
                  className="text-xs sm:text-sm leading-relaxed"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </StickerCardFrame>
  );
}

export function CodeCardBlockBody({
  block,
  locale,
  langListId,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'code_card' }>;
  locale: LocaleCode;
  langListId: string;
  onUpdate: (next: Extract<VisualBlock, { type: 'code_card' }>) => void;
  flow: FlowBlockHandlers;
}) {
  const v = UI_COPY[locale].studio.visual;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const escapeTabBypassRef = useRef(false);
  const sheetStyle = normalizeCodeCardStyle(block.style);
  useAutoResizeTextarea(taRef, block.code, 384);

  const showMarginSticky = Boolean(block.marginNote.trim()) || flow.marginNoteOpen;

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      escapeTabBypassRef.current = true;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      flow.onCommitAndInsertAfter(
        block,
        { id: createVisualId(), type: 'paragraph', text: '', marginNote: '' },
        0,
      );
      return;
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      if (escapeTabBypassRef.current) {
        escapeTabBypassRef.current = false;
        return;
      }
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? block.code.length;
      const end = el.selectionEnd ?? block.code.length;
      const nextCode =
        block.code.slice(0, start) + '  ' + block.code.slice(end);
      onUpdate({ ...block, code: nextCode });
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 2, start + 2);
      });
      return;
    }
    escapeTabBypassRef.current = false;
  };

  return (
    <div
      className={
        showMarginSticky
          ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_210px] xl:gap-5 items-start'
          : ''
      }
    >
      <WashiCodeFrame
        style={sheetStyle}
        seedKey={`${block.language}:${block.filename}:${block.code.length}`}
        className="my-2"
        headerStart={
          <input
            type="text"
            size={1}
            value={block.filename}
            onChange={(e) => onUpdate({ ...block, filename: e.target.value })}
            aria-label={v.codeFilePlaceholder}
            placeholder={v.codeFilePlaceholder}
            className="font-hand text-sm sm:text-base font-semibold min-w-16 max-w-full flex-1 px-2 py-0.5 rounded-md border border-dashed focus:outline-none"
            style={{
              color: 'var(--code-fg)',
              backgroundColor: 'var(--code-bg)',
              borderColor: 'var(--code-border-subtle)',
            }}
          />
        }
        headerEnd={(tokens) => (
          <>
            <input
              type="text"
              size={1}
              list={langListId}
              value={block.language}
              onChange={(e) => onUpdate({ ...block, language: e.target.value })}
              aria-label={v.codeLangLabel}
              placeholder="text"
              className="w-20 sm:w-24 min-w-0 px-2 py-0.5 rounded font-mono text-xs font-semibold uppercase tracking-wider border border-dashed text-center focus:outline-none"
              style={{
                backgroundColor: tokens.badgeBg,
                borderColor: tokens.border,
                color: tokens.badgeFg,
              }}
            />

            <CodeStylePopover
              block={block}
              locale={locale}
              onUpdate={onUpdate}
              onOpenMarginNote={flow.onOpenMarginNote}
            />
          </>
        )}
      >
        <div className="px-4 py-3">
          <textarea
            ref={taRef}
            data-flow-input="primary"
            rows={4}
            value={block.code}
            onChange={(e) => onUpdate({ ...block, code: e.target.value })}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              escapeTabBypassRef.current = false;
            }}
            aria-label={v.codeBodyPlaceholder}
            placeholder={v.codeBodyPlaceholder}
            spellCheck={false}
            className="flow-editor-textarea flow-editor-textarea--code font-mono text-xs sm:text-sm"
            style={{ color: 'var(--code-fg)' }}
          />
        </div>
      </WashiCodeFrame>

      {showMarginSticky && (
        <div className="mt-3 xl:mt-0">
          <InlineAuthorMarginSticky
            locale={locale}
            rawValue={block.marginNote}
            onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
            onRemove={() => {
              onUpdate({ ...block, marginNote: '' });
              flow.onCloseMarginNote();
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ListBlockBody({
  block,
  locale,
  onUpdate,
  flow,
}: {
  block: Extract<VisualBlock, { type: 'list' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'list' }>) => void;
  flow: FlowBlockHandlers;
}) {
  const v = UI_COPY[locale].studio.visual;

  const scheduleItemFocus = (idx: number, caret: number | 'end' = 0) => {
    requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>(
        `[data-flow-block-id="${block.id}"]`,
      );
      const input = container?.querySelector<HTMLElement>(
        `[data-flow-list-idx="${idx}"]`,
      );
      if (input) {
        focusRichEditable(input, caret);
      }
    });
  };

  return (
    <div className="relative space-y-1.5">
      <div className="flow-hover-controls flex justify-end mb-1">
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
      </div>

      <div className="space-y-1">
        {block.items.map((itemText, lIdx) => (
          <div key={lIdx} className="flex items-baseline gap-2.5">
            <span className="font-mono text-xs text-link-ink w-5 text-end shrink-0 tabular-nums select-none inline-flex justify-end items-center">
              {block.ordered ? (
                `${lIdx + 1}.`
              ) : (
                <IconSparkBullet className="w-3 h-3" />
              )}
            </span>
            <RichEditable
              blockId={block.id}
              multiline={false}
              flowInputRole={lIdx === 0 ? 'primary' : undefined}
              extraDataAttrs={{ 'data-flow-list-idx': lIdx }}
              value={itemText}
              placeholder={v.listItemPlaceholder}
              onChange={(val) =>
                onUpdate({
                  ...block,
                  items: block.items.map((it, i) => (i === lIdx ? val : it)),
                })
              }
              onPrefixTransform={(plain) => {
                if (block.items.length === 1 && plain.startsWith('[ ] ')) {
                  flow.onReplaceBlock(
                    {
                      id: block.id,
                      type: 'steps',
                      title: '',
                      scope: 'paragraph',
                      items: [
                        {
                          id: createVisualId('st'),
                          title: plain.slice(4),
                          detail: '',
                          defaultChecked: false,
                        },
                      ],
                    },
                    { caret: 0 },
                  );
                  return true;
                }
                return false;
              }}
              onSelectionReport={flow.onSelectionReport}
              onEnterKey={(e, { beforeMd, afterMd }) => {
                e.preventDefault();
                if (!beforeMd.trim() && !afterMd.trim()) {
                  if (block.items.length <= 1) {
                    flow.onReplaceBlock(
                      {
                        id: block.id,
                        type: 'paragraph',
                        text: '',
                        marginNote: '',
                      },
                      { caret: 0 },
                    );
                  } else {
                    const nextItems = block.items.filter((_, i) => i !== lIdx);
                    flow.onCommitAndInsertAfter(
                      { ...block, items: nextItems },
                      {
                        id: createVisualId(),
                        type: 'paragraph',
                        text: '',
                        marginNote: '',
                      },
                      0,
                    );
                  }
                  return true;
                }
                const nextItems = [...block.items];
                nextItems[lIdx] = beforeMd;
                nextItems.splice(lIdx + 1, 0, afterMd);
                onUpdate({ ...block, items: nextItems });
                scheduleItemFocus(lIdx + 1, 0);
                return true;
              }}
              onBackspaceAtStart={(remainingMd) => {
                if (block.items.length <= 1) {
                  flow.onReplaceBlock(
                    {
                      id: block.id,
                      type: 'paragraph',
                      text: remainingMd,
                      marginNote: '',
                    },
                    { caret: 0 },
                  );
                  return true;
                }
                if (lIdx > 0) {
                  const prevEl = document
                    .querySelector<HTMLElement>(`[data-flow-block-id="${block.id}"]`)
                    ?.querySelector<HTMLElement>(`[data-flow-list-idx="${lIdx - 1}"]`);
                  const prevPlainLen = (prevEl?.textContent ?? '').replace(
                    /\u200B/g,
                    '',
                  ).length;
                  const nextItems = block.items.filter((_, i) => i !== lIdx);
                  nextItems[lIdx - 1] = `${nextItems[lIdx - 1]}${remainingMd}`;
                  onUpdate({ ...block, items: nextItems });
                  scheduleItemFocus(lIdx - 1, prevPlainLen);
                  return true;
                }
                return false;
              }}
              onMoveVertical={(dir) => {
                if (dir < 0 && lIdx > 0) {
                  scheduleItemFocus(lIdx - 1, 'end');
                  return true;
                }
                if (dir < 0 && lIdx === 0) {
                  flow.onMoveFocusVertical(-1);
                  return true;
                }
                if (dir > 0 && lIdx < block.items.length - 1) {
                  scheduleItemFocus(lIdx + 1, 0);
                  return true;
                }
                if (dir > 0 && lIdx === block.items.length - 1) {
                  flow.onMoveFocusVertical(1);
                  return true;
                }
                return false;
              }}
              className="flex-1 min-w-0 text-base text-ink-primary leading-relaxed"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
