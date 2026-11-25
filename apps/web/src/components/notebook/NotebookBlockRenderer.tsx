/*
 * Unified Notebook Block Renderer shared by StepReaderPage and StudioPage Live Preview.
 * - Groups every Section Task heading (`heading.is_task === true`) together with ALL blocks belonging
 *   to that section (up to the next heading of equal or higher level) inside `<section class="notebook-section-task">`,
 *   making the ENTIRE section one cohesive checkable task milestone with top checkbox + bottom completion pill.
 * - Inline `steps` blocks render as paragraph-level checkpoints (`段任务`) woven naturally between prose.
 */

import { type ReactNode, useMemo, useState } from 'react';
import {
  extractBlockPlainText,
  extractQuoteExcerpt,
  resolveNotesToBlocks,
} from '../../lib/annotationAnchor';
import type { ExtendedMessages, UiMessages } from '../../lib/i18n';
import { SafeHtml } from '../../lib/sanitizer';
import type { ResolvedTheme } from '../../lib/theme';
import type { NotebookBlock, UserMarginNoteDto } from '../../lib/types';
import {
  IconAlertCircle,
  IconCheck,
  IconSparkBullet,
  IconSquareEmpty,
} from '../ui/Icons';
import {
  AuthorMarginSticker,
  BlockWithMargin,
  MarginNoteEditorForm,
  type MarginNoteEditPatch,
  MarginStickerCard,
  ParagraphWithMargin,
} from './MarginNoteLayer';
import { NotebookAlert } from './NotebookAlert';
import { NotebookStepsBlock } from './NotebookStepsBlock';
import { PixelStickerById, pixelSizeToPx } from './PixelStickers';
import { RoughDiagram } from './RoughDiagram';
import { SketchHeading } from './SketchHeading';
import {
  decodeReaderNoteSpec,
  MARGIN_TAG_ICONS,
} from './StationeryStickers';
import { WashiCodeCard } from './WashiCodeCard';

interface NotebookBlockRendererProps {
  blocks: NotebookBlock[];
  copy: UiMessages;
  notesCopy?: ExtendedMessages['notes'];
  theme: ResolvedTheme;
  /** Interactive mode (StepReaderPage) attaches margin-note actions; preview mode renders read-only marginalia */
  interactive?: {
    marginNotes: UserMarginNoteDto[];
    onAddNote: (blockId: string, patch: MarginNoteEditPatch) => Promise<void>;
    onUpdateNote: (note: UserMarginNoteDto, patch: MarginNoteEditPatch) => Promise<void>;
    onRebindNote?: (note: UserMarginNoteDto, targetBlock: NotebookBlock) => Promise<void>;
    onDeleteNote: (note: UserMarginNoteDto) => Promise<void>;
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
  notesCopy,
  theme,
  interactive,
  stepChecks,
}: NotebookBlockRendererProps) {
  const [editingOrphanId, setEditingOrphanId] = useState<string | null>(null);

  // Extract block-anchored free-placed pixel stickers onto their host blocks
  const { flowBlocks, attachedMap } = useMemo(() => {
    type OverlayPixel = Extract<NotebookBlock, { type: 'pixel_sticker' }>;
    const nonOverlay: NotebookBlock[] = [];
    const byHost = new Map<string, OverlayPixel[]>();
    const leading: OverlayPixel[] = [];

    for (const blk of blocks) {
      if (
        blk.type === 'pixel_sticker' &&
        (blk.anchor === 'block' || (blk.x != null && blk.y != null))
      ) {
        const lastHost = nonOverlay[nonOverlay.length - 1];
        if (lastHost) {
          const list = byHost.get(lastHost.block_id) ?? [];
          list.push(blk);
          byHost.set(lastHost.block_id, list);
        } else {
          leading.push(blk);
        }
      } else {
        nonOverlay.push(blk);
      }
    }

    if (leading.length > 0 && nonOverlay[0]) {
      const firstId = nonOverlay[0].block_id;
      byHost.set(firstId, [...leading, ...(byHost.get(firstId) ?? [])]);
    }
    return { flowBlocks: nonOverlay, attachedMap: byHost };
  }, [blocks]);

  // 3-Level W3C Web Annotation Fuzzy Re-Anchoring (L1 exact block_id -> L2 TextQuoteSelector -> L3 Orphaned Tray)
  const resolvedNotes = useMemo(
    () =>
      interactive
        ? resolveNotesToBlocks(flowBlocks, interactive.marginNotes)
        : { byBlockId: new Map(), orphaned: [] as UserMarginNoteDto[] },
    [flowBlocks, interactive],
  );

  const rebindableBlocks = useMemo(
    () =>
      flowBlocks
        .filter((b) => b.type !== 'pixel_sticker' && b.type !== 'heading')
        .map((b) => ({
          block: b,
          preview: extractBlockPlainText(b).slice(0, 44) || b.block_id,
        })),
    [flowBlocks],
  );

  const wrapWithAttachedStickers = (
    blockId: string,
    content: ReactNode,
  ): ReactNode => {
    const attached = attachedMap.get(blockId);
    if (!attached || attached.length === 0) return content;

    return (
      <div
        key={blockId}
        className="relative"
        data-sticker-host={blockId}
      >
        {content}
        {attached.map((st) => {
          const x = Math.max(-25, Math.min(125, st.x ?? 88));
          const y = Math.max(-60, Math.min(160, st.y ?? 16));
          const rotate = Math.max(-180, Math.min(180, st.rotate ?? 0));
          const scale = Math.max(0.35, Math.min(3.5, st.scale ?? 1));
          const flipX = st.flip ? ' scaleX(-1)' : '';
          const zIndex = st.layer === 'behind' ? 1 : 25;
          return (
            <div
              key={st.block_id}
              data-testid={`article-pixel-sticker-${st.sprite}`}
              data-sticker-locked={st.locked ? 'true' : undefined}
              className="pointer-events-none select-none absolute flex flex-col items-center"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                zIndex,
                transform: `translate(-50%, -50%) rotate(${rotate}deg) scale(${scale})${flipX}`,
              }}
            >
              <PixelStickerById
                sprite={st.sprite}
                size={56}
                label={st.caption || undefined}
              />
              {st.caption && (
                <span className="mt-1 px-2 py-0.5 rounded-md bg-surface-sheet/90 border border-border-subtle text-xs text-ink-secondary font-hand whitespace-nowrap">
                  <SafeHtml as="span" html={st.caption} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderTree = buildRenderTree(flowBlocks);
  // Continuous 1-based numbering across all paragraph-level scattered tasks in the article
  let runningParagraphTaskNumber = 1;

  const renderSingleBlock = (block: NotebookBlock): ReactNode =>
    wrapWithAttachedStickers(block.block_id, renderSingleBlockInner(block));

  const renderSingleBlockInner = (block: NotebookBlock): ReactNode => {
    switch (block.type) {
      case 'heading':
        return (
          <SketchHeading
            key={block.block_id}
            id={block.block_id}
            level={block.level}
            number={block.number}
            text={block.text}
            align={block.align}
            jumpAriaLabel={copy.jumpToSectionAria(block.text)}
          />
        );

      case 'paragraph': {
        const alignCls =
          block.align === 'center'
            ? 'ink-align-center'
            : block.align === 'right'
              ? 'ink-align-right'
              : block.align === 'left'
                ? 'ink-align-left'
                : '';
        const sizeCls =
          block.size === 'sm' ||
          block.size === 'lg' ||
          block.size === 'xl' ||
          block.size === '2xl'
            ? `ink-size-${block.size}`
            : 'text-sm sm:text-base';
        if (interactive) {
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <ParagraphWithMargin
              key={block.block_id}
              blockId={block.block_id}
              html={block.html}
              align={block.align}
              size={block.size}
              authorNote={block.margin_note}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
              onDeleteNote={interactive.onDeleteNote}
            />
          );
        }
        return (
          <div key={block.block_id} className="my-3.5 space-y-2.5">
            <SafeHtml
              html={block.html}
              className={`notebook-prose ${sizeCls} ${alignCls} text-ink-primary`.trim()}
            />
            {block.margin_note && (
              <div className="max-w-60">
                <AuthorMarginSticker
                  rawNote={block.margin_note}
                  badgeLabel={copy.authorNoteBadge}
                />
              </div>
            )}
          </div>
        );
      }

      case 'alert': {
        const alertEl = (
          <NotebookAlert
            kind={block.kind}
            stampText={copy.alertStamps[block.kind]}
            title={block.title}
            bodyHtml={block.body_html}
            detailSummary={block.detail_summary}
            detailHtml={block.detail_html}
            style={block.style}
            tone={block.tone}
            badge={block.badge}
            align={block.align}
            size={block.size}
          />
        );
        if (interactive) {
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              compactTrigger
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
              onDeleteNote={interactive.onDeleteNote}
            >
              {alertEl}
            </BlockWithMargin>
          );
        }
        return <div key={block.block_id}>{alertEl}</div>;
      }

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
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              authorNote={block.margin_note}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
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
              <div className="max-w-60 -mt-2 mb-4">
                <AuthorMarginSticker
                  rawNote={block.margin_note}
                  badgeLabel={copy.authorNoteBadge}
                />
              </div>
            )}
          </div>
        );
      }

      case 'rough_diagram': {
        const diagramEl = (
          <RoughDiagram
            spec={block.spec}
            caption={block.caption}
            theme={theme}
            defaultAriaLabel={copy.studio.visual.types.rough_diagram}
          />
        );
        if (interactive) {
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              compactTrigger
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
              onDeleteNote={interactive.onDeleteNote}
            >
              {diagramEl}
            </BlockWithMargin>
          );
        }
        return <div key={block.block_id}>{diagramEl}</div>;
      }

      case 'pixel_sticker': {
        const alignClass =
          block.align === 'left'
            ? 'items-start text-start'
            : block.align === 'right'
              ? 'items-end text-end'
              : 'items-center text-center';
        return (
          <figure
            key={block.block_id}
            data-testid={`article-pixel-sticker-${block.sprite}`}
            className={`my-5 mx-0 w-full flex flex-col ${alignClass}`}
          >
            <div className="pixel-sticker-float inline-flex items-center justify-center p-2">
              <PixelStickerById
                sprite={block.sprite}
                size={pixelSizeToPx(block.size)}
                label={block.caption || undefined}
              />
            </div>
            {block.caption && (
              <figcaption className="mt-1.5 text-xs text-ink-secondary font-hand max-w-md">
                <SafeHtml as="span" html={block.caption} />
              </figcaption>
            )}
          </figure>
        );
      }

      case 'list': {
        const ListTag = block.ordered ? 'ol' : 'ul';
        const listEl = (
          <ListTag className="my-5 ps-0 list-none space-y-2.5 w-full">
            {block.items_html.map((itemHtml, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2.5 text-base text-ink-primary"
              >
                {/* Supercharged Default Bullets (Refactoring UI §8.1) */}
                <span
                  aria-hidden="true"
                  className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded-lg bg-action-subtle text-link-ink mt-1 shrink-0 tabular-nums inline-flex items-center justify-center min-h-5 min-w-5"
                >
                  {block.ordered ? (
                    `${idx + 1}.`
                  ) : (
                    <IconSparkBullet className="w-3 h-3" />
                  )}
                </span>
                <SafeHtml
                  html={itemHtml}
                  className="notebook-prose flex-1"
                />
              </li>
            ))}
          </ListTag>
        );
        if (interactive) {
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              compactTrigger
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
              onDeleteNote={interactive.onDeleteNote}
            >
              {listEl}
            </BlockWithMargin>
          );
        }
        return <div key={block.block_id}>{listEl}</div>;
      }

      case 'image': {
        const figureEl = (
          <figure className="my-5 mx-0 w-full rounded-2xl overflow-hidden border-2 border-border-ink bg-surface-raised">
            <img
              src={block.src}
              alt={block.alt}
              loading="lazy"
              className="block w-full max-h-[34rem] object-contain bg-surface-sunken"
            />
            {(block.caption || block.alt) && (
              <figcaption className="px-4 py-2 text-xs text-ink-secondary border-t border-dashed border-border-subtle bg-surface-sheet">
                {block.caption || block.alt}
              </figcaption>
            )}
          </figure>
        );

        if (interactive) {
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              authorNote={block.margin_note}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
              onDeleteNote={interactive.onDeleteNote}
            >
              {figureEl}
            </BlockWithMargin>
          );
        }

        return (
          <div key={block.block_id} className="space-y-2">
            {figureEl}
            {block.margin_note && (
              <div className="max-w-60 -mt-2 mb-4">
                <AuthorMarginSticker
                  rawNote={block.margin_note}
                  badgeLabel={copy.authorNoteBadge}
                />
              </div>
            )}
          </div>
        );
      }

      case 'quote': {
        const qAlignCls =
          block.align === 'center'
            ? 'ink-align-center'
            : block.align === 'right'
              ? 'ink-align-right'
              : '';
        const qSizeCls =
          block.size === 'sm' ||
          block.size === 'lg' ||
          block.size === 'xl' ||
          block.size === '2xl'
            ? `ink-size-${block.size}`
            : 'text-base';
        const quoteEl = (
          <blockquote
            className={`my-6 mx-0 w-full rounded-xl py-3.5 px-5 relative ${qAlignCls}`.trim()}
            style={{
              backgroundColor: 'var(--alert-note-bg)',
              borderInlineStart: '6px solid var(--marker-h1)',
              color: 'var(--alert-note-title)',
            }}
          >
            <SafeHtml
              html={block.html}
              className={`notebook-prose ${qSizeCls} leading-relaxed`.trim()}
            />
          </blockquote>
        );
        if (interactive) {
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              compactTrigger
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
              onDeleteNote={interactive.onDeleteNote}
            >
              {quoteEl}
            </BlockWithMargin>
          );
        }
        return <div key={block.block_id}>{quoteEl}</div>;
      }

      case 'steps': {
        const startNumber = runningParagraphTaskNumber;
        runningParagraphTaskNumber += block.items.length;
        const fallbackChecked = new Set(
          block.items
            .filter((it) => it.default_checked)
            .map((it) => it.item_id),
        );
        const stepsEl = (
          <NotebookStepsBlock
            blockId={block.block_id}
            title={block.title}
            scope={block.scope ?? 'paragraph'}
            items={block.items}
            startNumber={startNumber}
            checkedIds={stepChecks ? stepChecks.checkedIds : fallbackChecked}
            onToggle={stepChecks?.onToggle}
            onResetBlock={stepChecks?.onResetIds}
            readOnly={stepChecks ? Boolean(stepChecks.readOnly) : true}
            omitRootId={Boolean(interactive)}
            copy={copy}
          />
        );
        if (interactive) {
          const blockNotes = resolvedNotes.byBlockId.get(block.block_id) ?? [];
          return (
            <BlockWithMargin
              key={block.block_id}
              blockId={block.block_id}
              userNotes={blockNotes}
              copy={copy}
              notesCopy={notesCopy}
              compactTrigger
              onAddNote={interactive.onAddNote}
              onUpdateNote={interactive.onUpdateNote}
              onDeleteNote={interactive.onDeleteNote}
            >
              {stepsEl}
            </BlockWithMargin>
          );
        }
        return <div key={block.block_id}>{stepsEl}</div>;
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
        {wrapWithAttachedStickers(
          heading.block_id,
          <SketchHeading
            id={heading.block_id}
            level={heading.level}
            number={heading.number}
            text={heading.text}
            align={heading.align}
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
          />,
        )}

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
              <IconSquareEmpty className="w-3.5 h-3.5 shrink-0" />
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

  return (
    <>
      {renderTree.map((node) => renderNode(node))}

      {/* Level 3 W3C Fallback: Orphaned / Historical Notes Tray (never silently drops notes after edits) */}
      {interactive && resolvedNotes.orphaned.length > 0 && (
        <details
          open
          className="mt-8 rounded-2xl border border-dashed border-border-control bg-surface-raised/65 p-4 space-y-3"
        >
          <summary className="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold text-ink-secondary">
            <IconAlertCircle className="w-4 h-4 text-ink-muted shrink-0" />
            <span>
              {notesCopy?.orphanedTitle(resolvedNotes.orphaned.length) ??
                `Historical Notes (${resolvedNotes.orphaned.length})`}
            </span>
          </summary>

          {notesCopy?.orphanedHint && (
            <p className="text-xs text-ink-muted m-0 leading-relaxed">
              {notesCopy.orphanedHint}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {resolvedNotes.orphaned.map((note, idx) => {
              const spec = decodeReaderNoteSpec(
                note.tone && note.style && note.tag
                  ? `${note.tone}:${note.style}:${note.tag}`
                  : note.note_color,
              );
              const quote = extractQuoteExcerpt(note);
              const tagLabel =
                spec.tag === 'note'
                  ? copy.myNoteBadge
                  : copy.marginTags[spec.tag];

              return (
                <div key={note.id} className="space-y-2">
                  {quote && (
                    <blockquote className="m-0 ps-2.5 border-s-2 border-border-control text-xs text-ink-muted line-clamp-2">
                      {quote}
                    </blockquote>
                  )}

                  {editingOrphanId === note.id ? (
                    <MarginNoteEditorForm
                      initialDraft={note.raw_content}
                      initialTone={spec.tone}
                      initialStyle={spec.style}
                      initialTag={spec.tag}
                      copy={copy}
                      notesCopy={notesCopy}
                      compact
                      onCancel={() => setEditingOrphanId(null)}
                      onSubmit={async (patch) => {
                        await interactive.onUpdateNote(note, patch);
                        setEditingOrphanId(null);
                      }}
                    />
                  ) : (
                    <MarginStickerCard
                      style={spec.style}
                      tone={spec.tone}
                      badgeIcon={MARGIN_TAG_ICONS[spec.tag]}
                      badgeLabel={tagLabel}
                      pendingSyncLabel={
                        note.pendingSync ? notesCopy?.pendingSyncBadge : undefined
                      }
                      tiltDeg={idx % 2 === 0 ? 0.4 : -0.4}
                      onEdit={() => setEditingOrphanId(note.id)}
                      editAriaLabel={notesCopy?.editNoteAria}
                      onDelete={() => void interactive.onDeleteNote(note)}
                      deleteAriaLabel={copy.deleteStickyAria}
                    >
                      <SafeHtml html={note.content_html} />
                    </MarginStickerCard>
                  )}

                  {interactive.onRebindNote && rebindableBlocks.length > 0 && (
                    <select
                      defaultValue=""
                      aria-label={notesCopy?.rebindPlaceholder}
                      onChange={(e) => {
                        const targetId = e.target.value;
                        const found = rebindableBlocks.find(
                          (b) => b.block.block_id === targetId,
                        );
                        if (found) {
                          void interactive.onRebindNote?.(note, found.block);
                        }
                      }}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface-sheet text-ink-secondary cursor-pointer"
                    >
                      <option value="" disabled>
                        {notesCopy?.rebindPlaceholder || copy.addStickyBtn}
                      </option>
                      {rebindableBlocks.map(({ block, preview }) => (
                        <option key={block.block_id} value={block.block_id}>
                          {preview}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}
