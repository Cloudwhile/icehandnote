/*
 * Visual Block Editor for IceHandNote Studio.
 * - Orchestrates block list ordering, collapsing, duplication, and insertion,
 *   delegating each block type to decoupled sub-editors in `./blocks/`.
 */

import { type ReactNode, useId, useState } from 'react';
import { UI_COPY } from '../../lib/i18n';
import type { LocaleCode } from '../../lib/types';
import {
  createDefaultVisualBlock,
  createVisualId,
  type VisualBlock,
} from '../../lib/visualBlocks';
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconCheckSquare,
  IconChevronDown,
  IconCode,
  IconCopy,
  IconDiagram,
  IconFileCode,
  IconHeading,
  IconImage,
  IconList,
  IconParagraph,
  IconPlus,
  IconQuote,
  IconTrash,
} from '../ui/Icons';
import { RoughDiagramBlockBody } from './blocks/RoughDiagramBlockBody';
import {
  AlertBlockBody,
  CodeCardBlockBody,
  ListBlockBody,
  StepsBlockBody,
} from './blocks/StructuredBlocks';
import {
  HeadingBlockBody,
  ImageBlockBody,
  ParagraphBlockBody,
  QuoteBlockBody,
  RawMarkdownBlockBody,
} from './blocks/TextAndMediaBlocks';

interface VisualBlockEditorProps {
  locale: LocaleCode;
  blocks: VisualBlock[];
  onChange: (next: VisualBlock[]) => void;
  hideTopInserter?: boolean;
}

interface VisualBlockToolStripProps {
  locale: LocaleCode;
  blockCount: number;
  onInsertBlock: (kind: VisualBlock['type']) => void;
  onInsertSectionTask: () => void;
}

const INSERTABLE_TYPES: readonly VisualBlock['type'][] = [
  'steps',
  'heading',
  'paragraph',
  'image',
  'alert',
  'code_card',
  'list',
  'quote',
  'rough_diagram',
];

const COMMON_LANGUAGES = [
  'rust',
  'typescript',
  'tsx',
  'javascript',
  'sql',
  'toml',
  'bash',
  'css',
  'html',
  'json',
  'yaml',
  'text',
];

function blockIcon(type: VisualBlock['type']): ReactNode {
  switch (type) {
    case 'heading':
      return <IconHeading className="w-3.5 h-3.5" />;
    case 'paragraph':
      return <IconParagraph className="w-3.5 h-3.5" />;
    case 'image':
      return <IconImage className="w-3.5 h-3.5 text-link-ink" />;
    case 'steps':
      return <IconCheckSquare className="w-3.5 h-3.5 text-accent-ice" />;
    case 'alert':
      return <IconAlertCircle className="w-3.5 h-3.5 text-accent-amber" />;
    case 'code_card':
      return <IconCode className="w-3.5 h-3.5" />;
    case 'list':
      return <IconList className="w-3.5 h-3.5" />;
    case 'quote':
      return <IconQuote className="w-3.5 h-3.5" />;
    case 'rough_diagram':
      return <IconDiagram className="w-3.5 h-3.5" />;
    case 'raw_markdown':
      return <IconFileCode className="w-3.5 h-3.5" />;
  }
}

function blockPreviewSummary(block: VisualBlock): string {
  switch (block.type) {
    case 'heading':
      return `H${block.level} · ${block.text || '…'}`;
    case 'paragraph':
      return block.text.slice(0, 48) || '…';
    case 'image':
      return block.caption || block.alt || block.src.slice(0, 42) || '…';
    case 'steps':
      return `${block.title || 'Steps'} (${block.items.length})`;
    case 'alert':
      return `${block.kind.toUpperCase()} · ${block.title || block.body.slice(0, 36) || '…'}`;
    case 'code_card':
      return `${block.language}${block.filename ? ` · ${block.filename}` : ''}`;
    case 'list':
      return `${block.ordered ? '1.' : '•'} ${block.items.length}`;
    case 'quote':
      return block.text.slice(0, 48) || '…';
    case 'rough_diagram':
      return `${block.caption || 'Diagram'} (${block.spec.nodes.length}N / ${block.spec.edges.length}E)`;
    case 'raw_markdown':
      return block.content.slice(0, 48) || '…';
  }
}

function cloneVisualBlock(block: VisualBlock): VisualBlock {
  const id = createVisualId();
  switch (block.type) {
    case 'steps':
      return {
        ...block,
        id,
        items: block.items.map((it) => ({ ...it, id: createVisualId('st') })),
      };
    case 'list':
      return { ...block, id, items: [...block.items] };
    case 'rough_diagram':
      return {
        ...block,
        id,
        spec: {
          nodes: block.spec.nodes.map((n) => ({ ...n })),
          edges: block.spec.edges.map((e) => ({ ...e })),
        },
      };
    default:
      return { ...block, id };
  }
}

export function VisualBlockToolStrip({
  locale,
  blockCount,
  onInsertBlock,
  onInsertSectionTask,
}: VisualBlockToolStripProps) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={onInsertSectionTask}
        className="ui-press-tactile min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold bg-action-subtle text-link-ink border border-action-bg/40 hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
      >
        <IconCheckSquare className="w-3.5 h-3.5 text-link-ink shrink-0" />
        <span>{copy.taskScopeSection}</span>
      </button>

      {INSERTABLE_TYPES.map((kind) => {
        const isSteps = kind === 'steps';
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onInsertBlock(kind)}
            className={`ui-press-tactile min-h-7 px-2 py-0.5 rounded-lg text-xs inline-flex items-center gap-1 cursor-pointer transition-colors ${
              isSteps
                ? 'font-semibold bg-surface-raised text-accent-ice border border-border-subtle hover:border-border-ink'
                : 'bg-surface-raised text-ink-primary border border-border-subtle hover:border-border-ink'
            }`}
          >
            {blockIcon(kind)}
            <span>{isSteps ? copy.taskScopeParagraph : v.types[kind]}</span>
          </button>
        );
      })}

      <span className="ms-auto text-xs font-mono text-ink-muted tabular-nums ps-1.5 whitespace-nowrap">
        {v.blockCount(blockCount)}
      </span>
    </div>
  );
}

export function VisualBlockEditor({
  locale,
  blocks,
  onChange,
  hideTopInserter = false,
}: VisualBlockEditorProps) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;
  const langListId = useId();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateBlock = (index: number, nextBlock: VisualBlock) => {
    const next = [...blocks];
    next[index] = nextBlock;
    onChange(next);
  };

  const moveBlock = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  const duplicateBlock = (index: number) => {
    const next = [...blocks];
    next.splice(index + 1, 0, cloneVisualBlock(blocks[index]));
    onChange(next);
  };

  const deleteBlock = (index: number) => {
    const next = blocks.filter((_, idx) => idx !== index);
    onChange(next);
  };

  const appendBlock = (kind: VisualBlock['type']) => {
    onChange([...blocks, createDefaultVisualBlock(kind)]);
  };

  const appendSectionTaskHeading = () => {
    onChange([
      ...blocks,
      {
        id: createVisualId(),
        type: 'heading',
        level: 2,
        text: '',
        isTask: true,
        defaultChecked: false,
      },
    ]);
  };

  const insertBlockAt = (afterIndex: number, kind: VisualBlock['type']) => {
    const next = [...blocks];
    next.splice(afterIndex + 1, 0, createDefaultVisualBlock(kind));
    onChange(next);
    setInsertAfterId(null);
  };

  const insertSectionTaskAt = (afterIndex: number) => {
    const next = [...blocks];
    next.splice(afterIndex + 1, 0, {
      id: createVisualId(),
      type: 'heading',
      level: 2,
      text: '',
      isTask: true,
      defaultChecked: false,
    });
    onChange(next);
    setInsertAfterId(null);
  };

  return (
    <div className="space-y-4">
      <datalist id={langListId}>
        {COMMON_LANGUAGES.map((lang) => (
          <option key={lang} value={lang} />
        ))}
      </datalist>

      {!hideTopInserter && (
        <div className="rounded-xl p-3 bg-surface-raised border border-border-subtle space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-secondary">
              {v.addBlockLabel}
            </span>
          </div>
          <VisualBlockToolStrip
            locale={locale}
            blockCount={blocks.length}
            onInsertBlock={appendBlock}
            onInsertSectionTask={appendSectionTaskHeading}
          />
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="rounded-xl p-6 bg-surface-raised border border-dashed border-border-subtle text-center space-y-3">
          <div
            className="text-base font-semibold text-ink-primary"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {v.emptyTitle}
          </div>
          <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
            {(['heading', 'paragraph', 'steps'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => appendBlock(kind)}
                className="min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer"
              >
                {blockIcon(kind)}
                <span>+ {v.types[kind]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            let runningTaskOffset = 0;
            return blocks.map((block, idx) => {
              const isCollapsed = collapsedIds.has(block.id);
              const showInsertPicker = insertAfterId === block.id;
              const taskStartOffset = runningTaskOffset;
              if (block.type === 'steps') {
                runningTaskOffset += block.items.length;
              }
              const isSectionTaskHead =
                block.type === 'heading' && Boolean(block.isTask);

              return (
                <div key={block.id} className="ui-panel-enter space-y-2">
                  <div className="rounded-xl border border-border-subtle focus-within:border-border-ink bg-surface-raised/60 overflow-hidden transition-colors">
                    {/* Block Card Header */}
                    <div className="px-3 py-2 bg-surface-sheet border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-mono text-xs text-ink-muted tabular-nums shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-semibold shrink-0 ${
                            isSectionTaskHead
                              ? 'bg-action-subtle border-border-ink text-link-ink'
                              : 'bg-surface-raised border-border-subtle text-ink-primary'
                          }`}
                        >
                          {isSectionTaskHead ? (
                            <IconCheckSquare className="w-3.5 h-3.5 text-link-ink" />
                          ) : (
                            blockIcon(block.type)
                          )}
                          <span>
                            {isSectionTaskHead
                              ? copy.taskScopeSection
                              : block.type === 'steps'
                                ? copy.taskScopeParagraph
                                : v.types[block.type]}
                          </span>
                        </span>
                        {isCollapsed && (
                          <span className="text-xs text-ink-muted studio-ellipsis">
                            {blockPreviewSummary(block)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveBlock(idx, -1)}
                          aria-label={v.moveUp}
                          title={v.moveUp}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <IconArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === blocks.length - 1}
                          onClick={() => moveBlock(idx, 1)}
                          aria-label={v.moveDown}
                          title={v.moveDown}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <IconArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateBlock(idx)}
                          aria-label={v.duplicate}
                          title={v.duplicate}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer"
                        >
                          <IconCopy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setInsertAfterId((cur) =>
                              cur === block.id ? null : block.id,
                            )
                          }
                          aria-label={v.insertBelow}
                          title={v.insertBelow}
                          aria-expanded={showInsertPicker}
                          className={`w-7 h-7 rounded-lg inline-flex items-center justify-center cursor-pointer ${
                            showInsertPicker
                              ? 'bg-action-subtle text-link-ink'
                              : 'text-ink-muted hover:text-ink-primary hover:bg-surface-raised'
                          }`}
                        >
                          <IconPlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleCollapse(block.id)}
                          aria-label={isCollapsed ? v.expand : v.collapse}
                          title={isCollapsed ? v.expand : v.collapse}
                          aria-expanded={!isCollapsed}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer"
                        >
                          <IconChevronDown
                            className={`w-3.5 h-3.5 transition-transform ${
                              isCollapsed ? '-rotate-90' : ''
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteBlock(idx)}
                          aria-label={v.deleteBlock}
                          title={v.deleteBlock}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer"
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Block Card Body */}
                    {!isCollapsed && (
                      <div className="p-3.5 space-y-3">
                        {block.type === 'heading' && (
                          <HeadingBlockBody
                            block={block}
                            locale={locale}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'paragraph' && (
                          <ParagraphBlockBody
                            block={block}
                            locale={locale}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'steps' && (
                          <StepsBlockBody
                            block={block}
                            locale={locale}
                            taskStartOffset={taskStartOffset}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'alert' && (
                          <AlertBlockBody
                            block={block}
                            locale={locale}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'code_card' && (
                          <CodeCardBlockBody
                            block={block}
                            locale={locale}
                            langListId={langListId}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'list' && (
                          <ListBlockBody
                            block={block}
                            locale={locale}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'quote' && (
                          <QuoteBlockBody
                            block={block}
                            locale={locale}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'rough_diagram' && (
                          <RoughDiagramBlockBody
                            block={block}
                            locale={locale}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'image' && (
                          <ImageBlockBody
                            block={block}
                            locale={locale}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                        {block.type === 'raw_markdown' && (
                          <RawMarkdownBlockBody
                            block={block}
                            onUpdate={(next) => updateBlock(idx, next)}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {showInsertPicker && (
                    <div className="ui-popover-enter origin-top rounded-xl p-2.5 bg-surface-sheet border border-dashed border-border-ink flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-ink-muted me-1">
                        {v.insertBelow}:
                      </span>
                      <button
                        type="button"
                        onClick={() => insertSectionTaskAt(idx)}
                        className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold bg-action-subtle text-link-ink border border-border-ink inline-flex items-center gap-1 cursor-pointer"
                      >
                        <IconCheckSquare className="w-3.5 h-3.5 text-link-ink" />
                        <span>{copy.taskScopeSection}</span>
                      </button>
                      {INSERTABLE_TYPES.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => insertBlockAt(idx, kind)}
                          className="min-h-7 px-2 py-0.5 rounded-lg text-xs bg-surface-raised hover:bg-action-subtle text-ink-primary border border-border-subtle inline-flex items-center gap-1 cursor-pointer"
                        >
                          {blockIcon(kind)}
                          <span>
                            {kind === 'steps'
                              ? copy.taskScopeParagraph
                              : v.types[kind]}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
