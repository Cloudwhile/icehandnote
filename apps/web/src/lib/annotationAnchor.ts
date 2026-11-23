import { stripHtmlTags } from './sanitizer';
import type {
  AnnotationTarget,
  LocaleCode,
  NotebookBlock,
  UserMarginNoteDto,
} from './types';

export const MAX_NOTE_CHARS = 2000;

/** Build the strong RFC 9110 ETag matching backend `UserMarginNoteDto::etag()`. */
export function buildNoteEtag(
  note: Pick<UserMarginNoteDto, 'id' | 'version'>,
): string {
  const simpleId = note.id.replace(/-/g, '').toLowerCase();
  const ver = Math.max(1, note.version ?? 1);
  return `"ann-${simpleId}-v${ver}"`;
}

/** Extract normalized plain text from any NotebookBlock for W3C TextQuoteSelector anchoring. */
export function extractBlockPlainText(block: NotebookBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
      return stripHtmlTags(block.html);
    case 'heading':
      return stripHtmlTags(block.text);
    case 'code_card':
      return [block.filename ?? '', block.code].filter(Boolean).join('\n').trim();
    case 'alert':
      return [block.title, stripHtmlTags(block.body_html)]
        .filter(Boolean)
        .join(' ')
        .trim();
    case 'list':
      return block.items_html.map((h) => stripHtmlTags(h)).join(' ');
    case 'steps':
      return [
        block.title,
        ...block.items.map((it) => stripHtmlTags(it.title_html)),
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
    case 'image':
      return [block.caption ?? '', block.alt].filter(Boolean).join(' ').trim();
    case 'rough_diagram':
      return [
        block.caption ?? '',
        ...block.spec.nodes.map((n) => n.label),
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
    case 'pixel_sticker':
      return block.caption ? stripHtmlTags(block.caption) : block.sprite;
  }
}

/** Construct a W3C Web Annotation Data Model target (`FragmentSelector` + `TextQuoteSelector`). */
export function buildBlockAnnotationTarget(
  stepId: string,
  locale: LocaleCode,
  sourceRevision: number,
  block: NotebookBlock,
): AnnotationTarget {
  const plain = extractBlockPlainText(block).replace(/\s+/g, ' ').trim();
  const exact = plain.slice(0, 96);
  const suffix = plain.length > 96 ? plain.slice(96, 136) : '';
  const selector: AnnotationTarget['selector'] = [
    {
      type: 'FragmentSelector',
      conformsTo: 'https://icehandnote.dev/spec/block-id',
      value: block.block_id,
    },
  ];
  if (exact) {
    selector.push({
      type: 'TextQuoteSelector',
      exact,
      prefix: '',
      suffix,
    });
  }
  return {
    source: `urn:icehandnote:step:${stepId}:locale:${locale}`,
    source_revision: Math.max(1, sourceRevision),
    selector,
  };
}

export function extractQuoteExcerpt(note: UserMarginNoteDto): string {
  const sel = note.target?.selector?.find(
    (s): s is Extract<AnnotationTarget['selector'][number], { type: 'TextQuoteSelector' }> =>
      s.type === 'TextQuoteSelector' && Boolean(s.exact?.trim()),
  );
  return sel?.exact?.trim() ?? '';
}

export function isSelectionNote(note: UserMarginNoteDto): boolean {
  if (note.motivation === 'highlighting') return true;
  return Boolean(
    note.target?.selector?.some((s) => s.type === 'TextPositionSelector'),
  );
}

export interface SelectionAnchorDraft {
  blockId: string;
  target: AnnotationTarget;
  exact: string;
  rect: { top: number; left: number };
}

function closestAnnotatableBlock(
  node: Node | null,
  boundary: HTMLElement,
): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== boundary) {
    if (cur instanceof HTMLElement && cur.dataset.annotatableBlock) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * Capture a W3C Web Annotation target (`FragmentSelector` + `TextQuoteSelector` +
 * `TextPositionSelector`) for a user text selection inside a single `[data-annotatable-block]`.
 */
export function captureSelectionWithinContainer(
  articleEl: HTMLElement,
  stepId: string,
  locale: LocaleCode,
  sourceRevision: number,
): SelectionAnchorDraft | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  if (
    !articleEl.contains(range.startContainer) ||
    !articleEl.contains(range.endContainer)
  ) {
    return null;
  }

  const startBlock = closestAnnotatableBlock(range.startContainer, articleEl);
  const endBlock = closestAnnotatableBlock(range.endContainer, articleEl);
  if (!startBlock || !endBlock || startBlock !== endBlock) return null;

  const blockId = startBlock.dataset.annotatableBlock?.trim();
  if (!blockId) return null;

  const rawSelected = range.toString();
  const exact = rawSelected.trim();
  if (exact.length < 2 || exact.length > 600) return null;

  const walker = document.createTreeWalker(startBlock, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentEl = node.parentElement;
      if (parentEl && parentEl.closest(HIGHLIGHT_SKIP_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textChunks: string[] = [];
  let totalLen = 0;
  let rawStart = -1;
  let rawEnd = -1;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const val = current.nodeValue ?? '';
    if (current === range.startContainer) {
      rawStart = totalLen + range.startOffset;
    }
    if (current === range.endContainer) {
      rawEnd = totalLen + range.endOffset;
    }
    textChunks.push(val);
    totalLen += val.length;
  }

  if (rawStart < 0 || rawEnd < 0) {
    const pre = document.createRange();
    pre.selectNodeContents(startBlock);
    pre.setEnd(range.startContainer, range.startOffset);
    rawStart = pre.toString().length;
    rawEnd = rawStart + rawSelected.length;
  }
  if (rawEnd <= rawStart) return null;

  const leadTrim = rawSelected.length - rawSelected.trimStart().length;
  const trailTrim = rawSelected.length - rawSelected.trimEnd().length;
  const start = Math.max(0, rawStart + leadTrim);
  const end = Math.max(start, rawEnd - trailTrim);
  const fullText = textChunks.join('');
  const resolvedExact = fullText.slice(start, end) || exact;

  const prefix = fullText.slice(Math.max(0, start - 32), start);
  const suffix = fullText.slice(end, Math.min(fullText.length, end + 32));
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    blockId,
    exact: resolvedExact,
    rect: { top: rect.top, left: rect.left + rect.width / 2 },
    target: {
      source: `urn:icehandnote:step:${stepId}:locale:${locale}`,
      source_revision: Math.max(1, sourceRevision),
      selector: [
        {
          type: 'FragmentSelector',
          conformsTo: 'https://icehandnote.dev/spec/block-id',
          value: blockId,
        },
        {
          type: 'TextQuoteSelector',
          exact: resolvedExact,
          prefix,
          suffix,
        },
        {
          type: 'TextPositionSelector',
          start,
          end,
        },
      ],
    },
  };
}

const VALID_HL_TONES = new Set(['amber', 'violet', 'ice', 'emerald', 'rose']);
const HIGHLIGHT_SKIP_SELECTOR =
  'svg, script, style, button, input, textarea, select, pre, [data-no-highlight]';

function resolveHighlightTone(note: UserMarginNoteDto): string {
  const candidate = note.tone || note.note_color.split(':')[0] || 'amber';
  return VALID_HL_TONES.has(candidate) ? candidate : 'amber';
}

/**
 * Idempotent semantic `<mark>` wrapping inside an annotatable block container:
 * follows `modern-web-guidance/highlight-text-ranges` (`TreeWalker` + `NodeFilter.SHOW_TEXT`,
 * never manipulating `innerHTML`, and paired with non-color dashed underline in CSS).
 */
export function applySemanticNoteHighlights(
  containerEl: HTMLElement,
  notes: UserMarginNoteDto[],
  onSelectHighlight?: (noteId: string) => void,
): void {
  const existingMarks = containerEl.querySelectorAll('mark[data-ihn-hl="1"]');
  existingMarks.forEach((markEl) => {
    const parent = markEl.parentNode;
    if (!parent) return;
    while (markEl.firstChild) {
      parent.insertBefore(markEl.firstChild, markEl);
    }
    parent.removeChild(markEl);
  });
  containerEl.normalize();

  const selectionNotes = notes.filter(isSelectionNote);
  if (selectionNotes.length === 0) return;

  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentEl = node.parentElement;
      if (parentEl && parentEl.closest(HIGHLIGHT_SKIP_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textEntries: Array<{
    node: Text;
    start: number;
    end: number;
  }> = [];
  const chunks: string[] = [];
  let cursor = 0;
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    const textNode = cur as Text;
    const len = textNode.nodeValue?.length ?? 0;
    if (len === 0) continue;
    textEntries.push({ node: textNode, start: cursor, end: cursor + len });
    chunks.push(textNode.nodeValue ?? '');
    cursor += len;
  }
  if (textEntries.length === 0) return;

  const fullText = chunks.join('');
  interface MatchSpan {
    start: number;
    end: number;
    tone: string;
    noteId: string;
    preview: string;
  }
  const matched: MatchSpan[] = [];

  for (const note of selectionNotes) {
    const quoteSel = note.target?.selector?.find(
      (s): s is Extract<AnnotationTarget['selector'][number], { type: 'TextQuoteSelector' }> =>
        s.type === 'TextQuoteSelector' && Boolean(s.exact),
    );
    const posSel = note.target?.selector?.find(
      (s): s is Extract<AnnotationTarget['selector'][number], { type: 'TextPositionSelector' }> =>
        s.type === 'TextPositionSelector',
    );
    const exact = quoteSel?.exact;
    let spanStart = -1;
    let spanEnd = -1;

    if (exact && posSel && fullText.slice(posSel.start, posSel.end) === exact) {
      spanStart = posSel.start;
      spanEnd = posSel.end;
    } else if (exact) {
      let searchAt = 0;
      let bestIdx = -1;
      let bestScore = -1;
      while (searchAt <= fullText.length - exact.length) {
        const hit = fullText.indexOf(exact, searchAt);
        if (hit < 0) break;
        let score = 0;
        if (quoteSel.prefix) {
          const leftCtx = fullText.slice(Math.max(0, hit - quoteSel.prefix.length), hit);
          if (leftCtx === quoteSel.prefix) score += 4;
          else if (leftCtx.endsWith(quoteSel.prefix.slice(-8))) score += 2;
        }
        if (quoteSel.suffix) {
          const rightStart = hit + exact.length;
          const rightCtx = fullText.slice(rightStart, rightStart + quoteSel.suffix.length);
          if (rightCtx === quoteSel.suffix) score += 4;
          else if (rightCtx.startsWith(quoteSel.suffix.slice(0, 8))) score += 2;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = hit;
        }
        searchAt = hit + 1;
      }
      if (bestIdx >= 0) {
        spanStart = bestIdx;
        spanEnd = bestIdx + exact.length;
      }
    } else if (posSel && posSel.end > posSel.start && posSel.end <= fullText.length) {
      spanStart = posSel.start;
      spanEnd = posSel.end;
    }

    if (spanStart >= 0 && spanEnd > spanStart) {
      matched.push({
        start: spanStart,
        end: spanEnd,
        tone: resolveHighlightTone(note),
        noteId: note.id,
        preview: note.raw_content || exact || '',
      });
    }
  }

  if (matched.length === 0) return;

  // Sort ascending and deduplicate overlaps cleanly before splitting Text nodes
  matched.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: MatchSpan[] = [];
  let lastEnd = 0;
  for (const m of matched) {
    const clampedStart = Math.max(m.start, lastEnd);
    if (clampedStart < m.end) {
      nonOverlapping.push({ ...m, start: clampedStart });
      lastEnd = m.end;
    }
  }

  interface NodeSlice {
    entryIndex: number;
    localStart: number;
    localEnd: number;
    span: MatchSpan;
  }
  const perNodeSlices: NodeSlice[] = [];
  for (let ei = 0; ei < textEntries.length; ei++) {
    const entry = textEntries[ei];
    for (const span of nonOverlapping) {
      const ovStart = Math.max(entry.start, span.start);
      const ovEnd = Math.min(entry.end, span.end);
      if (ovStart < ovEnd) {
        perNodeSlices.push({
          entryIndex: ei,
          localStart: ovStart - entry.start,
          localEnd: ovEnd - entry.start,
          span,
        });
      }
    }
  }

  // Wrap in strictly descending entry & local offset order so earlier offsets never shift
  perNodeSlices.sort(
    (a, b) => b.entryIndex - a.entryIndex || b.localStart - a.localStart,
  );
  for (const slice of perNodeSlices) {
    const baseNode = textEntries[slice.entryIndex].node;
    if (!baseNode.parentNode) continue;
    const len = baseNode.nodeValue?.length ?? 0;
    if (slice.localEnd < len) {
      baseNode.splitText(slice.localEnd);
    }
    const targetNode =
      slice.localStart > 0 ? baseNode.splitText(slice.localStart) : baseNode;
    const mark = document.createElement('mark');
    mark.className = 'nb-user-highlight';
    mark.dataset.ihnHl = '1';
    mark.dataset.tone = slice.span.tone;
    mark.dataset.noteId = slice.span.noteId;
    mark.tabIndex = 0;
    mark.setAttribute('role', 'button');
    if (slice.span.preview) {
      mark.title = slice.span.preview.slice(0, 120);
    }
    mark.textContent = targetNode.nodeValue ?? '';
    if (onSelectHighlight) {
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectHighlight(slice.span.noteId);
      });
      mark.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onSelectHighlight(slice.span.noteId);
        }
      });
    }
    targetNode.parentNode?.replaceChild(mark, targetNode);
  }
}

function normalizeForMatch(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

function diceBigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    counts.set(bg, (counts.get(bg) ?? 0) + 1);
  }
  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const cur = counts.get(bg) ?? 0;
    if (cur > 0) {
      counts.set(bg, cur - 1);
      matches++;
    }
  }
  return (2 * matches) / (a.length - 1 + (b.length - 1));
}

export interface ResolvedBlockNote {
  note: UserMarginNoteDto;
  reanchored: boolean;
}

/**
 * 3-Level W3C Web Annotation Fuzzy Re-Anchoring:
 * - Level 1: Exact `block_id` match (`FragmentSelector` / `block_anchor_id`).
 * - Level 2: Fuzzy `TextQuoteSelector` similarity match across all current blocks (>= 0.55 Dice or substring hit).
 * - Level 3: Unmatched notes collected into `orphaned` tray so reader notes never silently disappear.
 */
export function resolveNotesToBlocks(
  blocks: NotebookBlock[],
  notes: UserMarginNoteDto[],
): {
  byBlockId: Map<string, ResolvedBlockNote[]>;
  orphaned: UserMarginNoteDto[];
} {
  const byBlockId = new Map<string, ResolvedBlockNote[]>();
  const orphaned: UserMarginNoteDto[] = [];

  const blockIndex = new Map<string, NotebookBlock>();
  const blockTexts: Array<{ blockId: string; norm: string }> = [];
  for (const blk of blocks) {
    if (blk.type === 'pixel_sticker') continue;
    blockIndex.set(blk.block_id, blk);
    const norm = normalizeForMatch(extractBlockPlainText(blk));
    if (norm) {
      blockTexts.push({ blockId: blk.block_id, norm });
    }
  }

  const pushNote = (blockId: string, entry: ResolvedBlockNote) => {
    const list = byBlockId.get(blockId) ?? [];
    list.push(entry);
    byBlockId.set(blockId, list);
  };

  for (const note of notes) {
    // Level 1: Direct block anchor match
    if (blockIndex.has(note.block_anchor_id)) {
      pushNote(note.block_anchor_id, { note, reanchored: false });
      continue;
    }
    const fragSel = note.target?.selector?.find(
      (s): s is Extract<AnnotationTarget['selector'][number], { type: 'FragmentSelector' }> =>
        s.type === 'FragmentSelector',
    );
    if (fragSel && blockIndex.has(fragSel.value)) {
      pushNote(fragSel.value, { note, reanchored: false });
      continue;
    }

    // Level 2: Fuzzy TextQuoteSelector match across current blocks
    const quoteNorm = normalizeForMatch(extractQuoteExcerpt(note));
    let bestBlockId: string | null = null;
    let bestScore = 0;
    if (quoteNorm.length >= 6) {
      for (const candidate of blockTexts) {
        if (
          candidate.norm.includes(quoteNorm) ||
          (candidate.norm.length >= 4 &&
            candidate.norm.length >= quoteNorm.length * 0.5 &&
            quoteNorm.includes(candidate.norm))
        ) {
          bestBlockId = candidate.blockId;
          bestScore = 1;
          break;
        }
        const slice = candidate.norm.slice(0, Math.max(quoteNorm.length + 32, 128));
        const score = diceBigramSimilarity(quoteNorm, slice);
        if (score > bestScore) {
          bestScore = score;
          bestBlockId = candidate.blockId;
        }
      }
    }

    if (bestBlockId && bestScore >= 0.55) {
      pushNote(bestBlockId, { note, reanchored: true });
    } else {
      // Level 3: Orphaned Notes Tray (never silently lost)
      orphaned.push(note);
    }
  }

  return { byBlockId, orphaned };
}
