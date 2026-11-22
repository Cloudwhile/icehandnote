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
    if (quoteNorm.length >= 4) {
      for (const candidate of blockTexts) {
        if (candidate.norm.includes(quoteNorm) || quoteNorm.includes(candidate.norm)) {
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
