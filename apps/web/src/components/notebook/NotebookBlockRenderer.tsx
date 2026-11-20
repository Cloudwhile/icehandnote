/*
 * Unified Notebook Block Renderer shared by StepReaderPage and StudioPage Live Preview.
 * - Groups every Section Task heading (`heading.is_task === true`) together with ALL blocks belonging
 *   to that section (up to the next heading of equal or higher level) inside `<section class="notebook-section-task">`,
 *   making the ENTIRE section one cohesive checkable task milestone with top checkbox + bottom completion pill.
 * - Inline `steps` blocks render as paragraph-level checkpoints (`段任务`) woven naturally between prose.
 */

import type { ReactNode } from 'react';
import type { UiMessages } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { ResolvedTheme } from '../../lib/theme';
import type { NotebookBlock, UserMarginNoteDto } from '../../lib/types';
import { IconCheck } from '../ui/Icons';
import {
  AuthorMarginSticker,
  BlockWithMargin,
  ParagraphWithMargin,
} from './MarginNoteLayer';
import { NotebookAlert } from './NotebookAlert';
import { NotebookStepsBlock } from './NotebookStepsBlock';
import { RoughDiagram } from './RoughDiagram';
import { SketchHeading } from './SketchHeading';
import { WashiCodeCard } from './WashiCodeCard';

interface NotebookBlockRendererProps {
  blocks: NotebookBlock[];
  copy: UiMessages;
  theme: ResolvedTheme;
  /** Interactive mode (StepReaderPage) attaches margin-note actions; preview mode renders read-only marginalia */
  interactive?: {
    marginNotes: UserMarginNoteDto[];
    onAddNote: (blockId: string, color: string, content: string) => Promise<void>;
    onDeleteNote: (noteId: string) => Promise<void>;
  };
  /** Interactive in-article checkable tasks (both Section Tasks & Paragraph Tasks) */
  stepChecks?: {
    checkedIds: Set<string>;
    onToggle: (itemId: string, checked: boolean) => void;
    onResetIds?: (itemIds: string[]) => void;
    readOnly?: boolean;
  };
}

type HeadingBlock = Extract<NotebookBlock, { type: 'heading' }>;

type RenderNode =
  | { kind: 'single'; block: NotebookBlock }
  | { kind: 'section_task'; heading: HeadingBlock; children: RenderNode[] };

/**
 * Groups flat compiled blocks so each heading with `is_task: true` owns every subsequent block
 * until the next heading of equal or higher hierarchy level (recursively supporting nested sub-section tasks).
 */
function buildRenderTree(blocks: NotebookBlock[]): RenderNode[] {
  const nodes: RenderNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'heading' && block.is_task) {
      const heading = block;
      const innerBlocks: NotebookBlock[] = [];
      let j = i + 1;
      while (j < blocks.length) {
        const candidate = blocks[j];
        if (candidate.type === 'heading' && candidate.level <= heading.level) {
          break;
        }
        innerBlocks.push(candidate);
        j += 1;
      }
      nodes.push({
        kind: 'section_task',
        heading,
        children: buildRenderTree(innerBlocks),
      });
      i = j;
    } else {
      nodes.push({ kind: 'single', block });
      i += 1;
    }
  }

  return nodes;
}

export function NotebookBlockRenderer({
  blocks,
  copy,
  theme,
  interactive,
  stepChecks,
}: NotebookBlockRendererProps) {
  const renderTree = buildRenderTree(blocks);
  // Continuous 1-based numbering across all paragraph-level scattered tasks in the article
  let runningParagraphTaskNumber = 1;

  const renderSingleBlock = (block: NotebookBlock): ReactNode => {
    switch (block.type) {
      case 'heading':
        return (
          <SketchHeading
            key={block.block_id}
            id={block.block_id}
            level={block.level}
            number={block.number}
            text={block.text}
            jumpAriaLabel={copy.jumpToSectionAria(block.text)}
          />
        );

      case 'paragraph': {
        if (interactive) {
          const blockNotes = interactive.marginNotes.filter(
            (n) => n.block_anchor_id === block.block_id,
          );
          return (
            <ParagraphWithMargin
              key={block.block_id}
              blockId={block.block_id}
              html={block.html}
              authorNote={block.margin_note}
              userNotes={blockNotes}
              copy={copy}
              onAddNote={interactive.onAddNote}
              onDeleteNote={interactive.onDeleteNote}
            />
          );
        }
        return (
          <div key={block.block_id} className="my-3.5 space-y-2.5">
            <SafeHtml
              html={block.html}
              className="notebook-prose text-sm sm:text-base text-ink-primary"
            />
            {block.margin_note && (
              <div className="max-w-[240px]">
                <AuthorMarginSticker
                  rawNote={block.margin_note}
                  badgeLabel={copy.authorNoteBadge}
                />
              </div>
            )}
          </div>
        );
      }

      case 'alert':
        return (
          <NotebookAlert
            key={block.block_id}
            kind={block.kind}
            stampText={copy.alertStamps[block.kind]}
            title={block.title}
            bodyHtml={block.body_html}
            detailSummary={block.detail_summary}
            detailHtml={block.detail_html}
            style={block.style}
            tone={block.tone}
            badge={block.badge}
          />
        );

      case 'code_card': {
        const codeElement = (
          <WashiCodeCard
            language={block.language}
            filename={block.filename}
            code={block.code}
            style={block.style}
            copyLabel={copy.copyCode}
            copiedLabel={copy.copiedCode}
            copyFailedLabel={copy.copyFailedCode}
          />
        );

        if (interactive) {
          const blockNotes = interactive.marginNotes.filter(
            (n) => n.block_anchor_id === block.block_id,
          );
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              authorNote={block.margin_note}
              userNotes={blockNotes}
              copy={copy}
              onAddNote={interactive.onAddNote}
              onDeleteNote={interactive.onDeleteNote}
            >
              {codeElement}
            </BlockWithMargin>
          );
        }

        return (
          <div key={block.block_id} className="space-y-2">
            {codeElement}
            {block.margin_note && (
              <div className="max-w-[240px] -mt-2 mb-4">
                <AuthorMarginSticker
                  rawNote={block.margin_note}
                  badgeLabel={copy.authorNoteBadge}
                />
              </div>
            )}
          </div>
        );
      }

      case 'rough_diagram':
        return (
          <RoughDiagram
            key={block.block_id}
            spec={block.spec}
            caption={block.caption}
            theme={theme}
          />
        );

      case 'list': {
        const ListTag = block.ordered ? 'ol' : 'ul';
        return (
          <ListTag
            key={block.block_id}
            className="my-5 ps-0 list-none space-y-2.5 w-full"
          >
            {block.items_html.map((itemHtml, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2.5 text-base text-ink-primary"
              >
                {/* Supercharged Default Bullets (Refactoring UI §8.1) */}
                <span
                  aria-hidden="true"
                  className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded-lg bg-action-subtle text-link-ink mt-1 shrink-0 tabular-nums"
                >
                  {block.ordered ? `${idx + 1}.` : '✦'}
                </span>
                <SafeHtml
                  html={itemHtml}
                  className="notebook-prose flex-1"
                />
              </li>
            ))}
          </ListTag>
        );
      }

      case 'quote':
        return (
          <blockquote
            key={block.block_id}
            className="my-6 mx-0 w-full rounded-xl py-3.5 px-5 relative"
            style={{
              backgroundColor: 'var(--alert-note-bg)',
              borderInlineStart: '6px solid var(--marker-h1)',
              color: 'var(--alert-note-title)',
            }}
          >
            <SafeHtml
              html={block.html}
              className="text-base leading-relaxed"
            />
          </blockquote>
        );

      case 'steps': {
        const startNumber = runningParagraphTaskNumber;
        runningParagraphTaskNumber += block.items.length;
        const fallbackChecked = new Set(
          block.items
            .filter((it) => it.default_checked)
            .map((it) => it.item_id),
        );
        return (
          <NotebookStepsBlock
            key={block.block_id}
            blockId={block.block_id}
            title={block.title}
            scope={block.scope ?? 'paragraph'}
            items={block.items}
            startNumber={startNumber}
            checkedIds={stepChecks ? stepChecks.checkedIds : fallbackChecked}
            onToggle={stepChecks?.onToggle}
            onResetBlock={stepChecks?.onResetIds}
            readOnly={stepChecks ? Boolean(stepChecks.readOnly) : true}
            copy={copy}
          />
        );
      }
    }
  };

  const renderNode = (node: RenderNode): ReactNode => {
    if (node.kind === 'single') {
      return renderSingleBlock(node.block);
    }

    const { heading, children } = node;
    const isChecked = stepChecks
      ? stepChecks.checkedIds.has(heading.block_id)
      : Boolean(heading.default_checked);
    const isReadOnly = stepChecks ? Boolean(stepChecks.readOnly) : true;

    return (
      <section
        key={heading.block_id}
        className="notebook-section-task"
        data-checked={isChecked ? 'true' : 'false'}
        aria-label={`${copy.taskScopeSection}: ${heading.text}`}
      >
        <SketchHeading
          id={heading.block_id}
          level={heading.level}
          number={heading.number}
          text={heading.text}
          jumpAriaLabel={copy.jumpToSectionAria(heading.text)}
          inSectionTask
          taskControl={{
            checked: isChecked,
            readOnly: isReadOnly,
            scopeLabel: copy.taskScopeSection,
            doneLabel: copy.sectionTaskDoneShort,
            onToggle: stepChecks
              ? (next) => stepChecks.onToggle(heading.block_id, next)
              : undefined,
          }}
        />

        <div className="notebook-section-task-body">
          {children.map((child) => renderNode(child))}
        </div>

        {/* Ergonomic end-of-section completion trigger (synced with top heading checkbox) */}
        <div className="notebook-section-task-footer">
          <button
            type="button"
            disabled={isReadOnly || !stepChecks}
            aria-pressed={isChecked}
            onClick={() => stepChecks?.onToggle(heading.block_id, !isChecked)}
            className="notebook-section-task-btn ui-press-tactile"
            data-checked={isChecked ? 'true' : 'false'}
          >
            {isChecked ? (
              <IconCheck className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <span
                aria-hidden="true"
                className="w-3.5 h-3.5 rounded border-[1.75px] border-current inline-block shrink-0"
              />
            )}
            <span>
              {isChecked
                ? copy.sectionTaskCompletedBadge
                : copy.sectionTaskCompleteBtn}
            </span>
            <span className="font-mono opacity-75">§{heading.number}</span>
          </button>
        </div>
      </section>
    );
  };

  return <>{renderTree.map((node) => renderNode(node))}</>;
}
