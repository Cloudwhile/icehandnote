/*
 * Lossless Bidirectional Markdown <-> Visual Block Codec for IceHandNote Studio.
 * Supports all hand-drawn notebook blocks (Heading, Paragraph + Margin Note, Interactive Checkable Steps,
 * 5-Variant Stationery Alerts + Collapsible Details, Washi Code Cards + Margin Note, Lists, Quotes,
 * Rough.js Diagrams) with a lossless `raw_markdown` safety net for any custom/table Markdown.
 */

import type {
  AlertKind,
  CodeCardStyle,
  SketchSpec,
  StickerStyle,
  StickerTone,
  TaskScope,
  TextAlign,
  TextSizePreset,
} from './types';

export interface AttachedPixelSticker {
  id: string;
  sprite: string;
  x: number;
  y: number;
  rotate: number;
  scale: number;
  flip?: boolean;
  locked?: boolean;
  layer?: 'front' | 'behind';
  caption?: string;
}

export interface VisualStepItem {
  id: string;
  title: string;
  detail: string;
  defaultChecked: boolean;
}

type VisualBlockCore =
  | {
      id: string;
      type: 'heading';
      level: 2 | 3 | 4;
      text: string;
      isTask?: boolean;
      defaultChecked?: boolean;
      align?: TextAlign;
    }
  | {
      id: string;
      type: 'paragraph';
      text: string;
      marginNote: string;
      align?: TextAlign;
      size?: TextSizePreset;
    }
  | {
      id: string;
      type: 'steps';
      title: string;
      scope: TaskScope;
      items: VisualStepItem[];
    }
  | {
      id: string;
      type: 'alert';
      kind: AlertKind;
      title: string;
      body: string;
      detailSummary: string;
      detailBody: string;
      style: StickerStyle | '';
      tone: StickerTone | '';
      badge: string;
      align?: TextAlign;
      size?: TextSizePreset;
    }
  | {
      id: string;
      type: 'code_card';
      language: string;
      filename: string;
      code: string;
      marginNote: string;
      style: CodeCardStyle;
    }
  | {
      id: string;
      type: 'list';
      ordered: boolean;
      items: string[];
    }
  | {
      id: string;
      type: 'image';
      src: string;
      alt: string;
      caption: string;
      marginNote: string;
    }
  | {
      id: string;
      type: 'quote';
      text: string;
      align?: TextAlign;
      size?: TextSizePreset;
    }
  | {
      id: string;
      type: 'rough_diagram';
      caption: string;
      spec: SketchSpec;
    }
  | {
      id: string;
      type: 'pixel_sticker';
      sprite: string;
      align: 'left' | 'center' | 'right';
      size: 'sm' | 'md' | 'lg';
      caption: string;
    }
  | {
      id: string;
      type: 'raw_markdown';
      content: string;
    };

export type VisualBlock = VisualBlockCore & {
  stickers?: AttachedPixelSticker[];
};

let blockSeq = 0;
export function createVisualId(prefix = 'vb'): string {
  blockSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${blockSeq}`;
}

const ALERT_KIND_MAP: Record<string, AlertKind> = {
  tip: 'tip',
  note: 'note',
  sticker: 'note',
  info: 'info',
  idea: 'idea',
  spark: 'idea',
  question: 'question',
  ask: 'question',
  qa: 'question',
  check: 'check',
  done: 'check',
  summary: 'check',
  bookmark: 'bookmark',
  mark: 'bookmark',
  ref: 'bookmark',
  warning: 'warning',
  warn: 'warning',
  danger: 'danger',
  error: 'danger',
};

const VALID_STICKER_STYLES = new Set<StickerStyle>([
  'tape',
  'pin',
  'torn',
  'clip',
  'stamp',
  'looseleaf',
  'tag',
]);

const VALID_STICKER_TONES = new Set<StickerTone>([
  'amber',
  'mint',
  'ice',
  'violet',
  'coral',
  'kraft',
]);

const VALID_CODE_STYLES = new Set<CodeCardStyle>([
  'washi',
  'spiral',
  'index',
  'torn',
]);

export function normalizeStickerStyle(raw?: string | null): StickerStyle | '' {
  const s = (raw ?? '').trim().toLowerCase() as StickerStyle;
  return VALID_STICKER_STYLES.has(s) ? s : '';
}

export function normalizeStickerTone(raw?: string | null): StickerTone | '' {
  const rawLower = (raw ?? '').trim().toLowerCase();
  if (rawLower === 'yellow' || rawLower === 'warn') return 'amber';
  return VALID_STICKER_TONES.has(rawLower as StickerTone)
    ? (rawLower as StickerTone)
    : '';
}

export function normalizeCodeCardStyle(raw?: string | null): CodeCardStyle {
  const s = (raw ?? '').trim().toLowerCase() as CodeCardStyle;
  return VALID_CODE_STYLES.has(s) ? s : 'washi';
}

export function normalizeBlockAlign(
  raw?: string | null,
): TextAlign | undefined {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'left' || s === 'center' || s === 'right') return s;
  return undefined;
}

export function normalizeBlockSize(
  raw?: string | null,
): TextSizePreset | undefined {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'sm' || s === 'lg' || s === 'xl' || s === '2xl') return s;
  return undefined;
}

export interface ParsedAuthorMarginNote {
  tone: StickerTone;
  style: StickerStyle;
  text: string;
  explicit: boolean;
}

/**
 * Parse author `:::margin[...]` content.
 * Supports plain `:::margin[批注]` (defaults to violet + tape) or styled `:::margin[mint:pin | 批注]`.
 */
export function parseAuthorMarginNote(raw: string): ParsedAuthorMarginNote {
  const trimmed = raw.trim();
  const pipeIdx = trimmed.indexOf(' | ');
  if (pipeIdx !== -1) {
    const head = trimmed.slice(0, pipeIdx).trim();
    const parts = head.split(':').map((p) => p.trim().toLowerCase());
    const tone = normalizeStickerTone(parts[0]);
    const style = parts[1] ? normalizeStickerStyle(parts[1]) : 'tape';
    if (tone && (parts.length === 1 || Boolean(style))) {
      return {
        tone,
        style: style || 'tape',
        text: trimmed.slice(pipeIdx + 3).trim(),
        explicit: true,
      };
    }
  }
  return {
    tone: 'violet',
    style: 'tape',
    text: trimmed,
    explicit: false,
  };
}

export function formatAuthorMarginNote(
  text: string,
  tone: StickerTone,
  style: StickerStyle,
): string {
  const clean = text.trim();
  if (!clean) return '';
  if (tone === 'violet' && style === 'tape') {
    return clean;
  }
  return `${tone}:${style} | ${clean}`;
}

function extractQuotedAttr(info: string, key: string): string {
  let cursor = 0;
  const needle = `${key}=`;
  while (cursor < info.length) {
    const idx = info.indexOf(needle, cursor);
    if (idx === -1) return '';
    const prev = idx === 0 ? ' ' : info[idx - 1];
    const valStart = idx + needle.length;
    if (!/\s|\{|,/.test(prev)) {
      cursor = valStart;
      continue;
    }
    const rest = info.slice(valStart);
    if (rest.startsWith('"')) {
      const end = rest.indexOf('"', 1);
      return end === -1 ? '' : rest.slice(1, end);
    }
    if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      return end === -1 ? '' : rest.slice(1, end);
    }
    const endMatch = rest.match(/[\s},]/);
    return (endMatch ? rest.slice(0, endMatch.index) : rest).trim();
  }
  return '';
}

function parseDirectiveHeader(rest: string): {
  kindRaw: string;
  title: string;
  attrsRaw: string;
} {
  const trimmed = rest.trim();
  let withoutAttrs = trimmed;
  let attrsRaw = '';
  if (trimmed.endsWith('}')) {
    const searchAfter = Math.max(0, trimmed.lastIndexOf(']'));
    const relBrace = trimmed.slice(searchAfter).indexOf('{');
    if (relBrace !== -1) {
      const braceIdx = searchAfter + relBrace;
      withoutAttrs = trimmed.slice(0, braceIdx).trim();
      attrsRaw = trimmed.slice(braceIdx + 1, -1).trim();
    }
  }
  const bracketIdx = withoutAttrs.indexOf('[');
  if (bracketIdx === -1) {
    return { kindRaw: withoutAttrs.toLowerCase(), title: '', attrsRaw };
  }
  return {
    kindRaw: withoutAttrs.slice(0, bracketIdx).trim().toLowerCase(),
    title: withoutAttrs.slice(bracketIdx + 1).replace(/\]$/, '').trim(),
    attrsRaw,
  };
}

function parseStepLine(raw: string): VisualStepItem | null {
  let s = raw.trim();
  if (!s) return null;
  let defaultChecked = false;

  if (s.startsWith('- ') || s.startsWith('* ')) {
    s = s.slice(2).trimStart();
  } else {
    const ordMatch = s.match(/^\d+\.\s+(.*)$/);
    if (ordMatch) {
      s = ordMatch[1].trimStart();
    }
  }

  if (s.startsWith('[ ]')) {
    defaultChecked = false;
    s = s.slice(3).trimStart();
  } else if (s.startsWith('[x]') || s.startsWith('[X]')) {
    defaultChecked = true;
    s = s.slice(3).trimStart();
  }

  if (!s) return null;

  const pipeIdx = s.indexOf(' | ');
  if (pipeIdx !== -1) {
    const title = s.slice(0, pipeIdx).trim();
    const detail = s.slice(pipeIdx + 3).trim();
    if (!title) return null;
    return { id: createVisualId('st'), title, detail, defaultChecked };
  }

  return { id: createVisualId('st'), title: s, detail: '', defaultChecked };
}

function isTaskListLine(trimmed: string): boolean {
  return /^[-*]\s+\[[ xX]\]\s+/.test(trimmed);
}

function isBulletListLine(trimmed: string): boolean {
  return /^[-*]\s+/.test(trimmed) && !isTaskListLine(trimmed);
}

function isOrderedListLine(trimmed: string): boolean {
  return /^\d+\.\s+/.test(trimmed);
}

function isTableLine(trimmed: string): boolean {
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}

function parseStandaloneImageLine(
  trimmed: string,
): { alt: string; src: string; caption: string } | null {
  if (!trimmed.startsWith('![')) return null;
  const closeAlt = trimmed.indexOf('](');
  if (closeAlt === -1 || !trimmed.endsWith(')')) return null;
  const alt = trimmed.slice(2, closeAlt).replace(/\\\]/g, ']');
  const inner = trimmed.slice(closeAlt + 2, -1).trim();
  if (!inner) return null;

  let src = inner;
  let caption = '';
  const dqIdx = inner.indexOf(' "');
  const sqIdx = inner.indexOf(" '");
  if (dqIdx !== -1 && inner.endsWith('"')) {
    src = inner.slice(0, dqIdx).trim();
    caption = inner.slice(dqIdx + 2, -1).trim();
  } else if (sqIdx !== -1 && inner.endsWith("'")) {
    src = inner.slice(0, sqIdx).trim();
    caption = inner.slice(sqIdx + 2, -1).trim();
  }
  if (!src || /\s/.test(src)) return null;
  return { alt, src, caption };
}

function isBlockStart(trimmed: string): boolean {
  if (!trimmed) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (trimmed.startsWith('```')) return true;
  if (trimmed.startsWith(':::')) return true;
  if (trimmed.startsWith('>')) return true;
  if (parseStandaloneImageLine(trimmed) !== null) return true;
  if (isTaskListLine(trimmed) || isBulletListLine(trimmed) || isOrderedListLine(trimmed)) return true;
  if (isTableLine(trimmed)) return true;
  return false;
}

/**
 * Parse IceHandNote Markdown body (without TOML frontmatter) into editable `VisualBlock[]`.
 */
export function parseMarkdownToVisualBlocks(markdown: string): VisualBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: VisualBlock[] = [];
  let pendingStickers: AttachedPixelSticker[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Standalone :::margin[...] attaches to previous paragraph, code_card, or image when possible
    if (trimmed.startsWith(':::margin[') && trimmed.endsWith(']')) {
      const note = trimmed.slice(':::margin['.length, -1).trim();
      const prev = blocks[blocks.length - 1];
      if (
        prev &&
        (prev.type === 'paragraph' || prev.type === 'code_card' || prev.type === 'image') &&
        !prev.marginNote
      ) {
        prev.marginNote = note;
      } else if (note) {
        blocks.push({ id: createVisualId(), type: 'raw_markdown', content: trimmed });
      }
      i += 1;
      continue;
    }

    // 2. Container directives: :::steps[...], :::pixel[...]{...}, :::format{...} and :::tip|note|...
    if (trimmed.startsWith(':::') && trimmed.length > 3) {
      const rest = trimmed.slice(3);
      const { kindRaw, title, attrsRaw } = parseDirectiveHeader(rest);

      if (kindRaw.toLowerCase() === 'format') {
        const alignVal = normalizeBlockAlign(extractQuotedAttr(attrsRaw, 'align'));
        const sizeVal = normalizeBlockSize(extractQuotedAttr(attrsRaw, 'size'));
        const prev = blocks[blocks.length - 1];
        if (
          prev &&
          (prev.type === 'paragraph' ||
            prev.type === 'quote' ||
            prev.type === 'alert')
        ) {
          if (alignVal) prev.align = alignVal;
          if (sizeVal) prev.size = sizeVal;
        } else if (prev && prev.type === 'heading' && alignVal) {
          prev.align = alignVal;
        }
        i += 1;
        if (i < lines.length && lines[i].trim() === ':::') {
          i += 1;
        }
        continue;
      }

      if (kindRaw.toLowerCase() === 'pixel') {
        const anchorAttr = extractQuotedAttr(attrsRaw, 'anchor').toLowerCase();
        const xStr = extractQuotedAttr(attrsRaw, 'x');
        const yStr = extractQuotedAttr(attrsRaw, 'y');
        const rotStr = extractQuotedAttr(attrsRaw, 'rotate');
        const scaleStr = extractQuotedAttr(attrsRaw, 'scale');
        const flipAttr = extractQuotedAttr(attrsRaw, 'flip').toLowerCase();
        const lockedAttr = extractQuotedAttr(attrsRaw, 'locked').toLowerCase();
        const layerAttr = extractQuotedAttr(attrsRaw, 'layer').toLowerCase();
        const caption = extractQuotedAttr(attrsRaw, 'caption').trim();
        const sprite = (title || 'cat').trim().toLowerCase() || 'cat';

        const isBlockAnchored =
          anchorAttr === 'block' || xStr !== '' || yStr !== '';

        if (isBlockAnchored) {
          const xVal = Number.parseFloat(xStr);
          const yVal = Number.parseFloat(yStr);
          const rotVal = Number.parseFloat(rotStr);
          const scaleVal = Number.parseFloat(scaleStr);
          const sticker: AttachedPixelSticker = {
            id: createVisualId('stk'),
            sprite,
            x: Number.isFinite(xVal) ? Math.max(-25, Math.min(125, xVal)) : 88,
            y: Number.isFinite(yVal) ? Math.max(-60, Math.min(160, yVal)) : 16,
            rotate: Number.isFinite(rotVal)
              ? Math.max(-180, Math.min(180, rotVal))
              : 0,
            scale: Number.isFinite(scaleVal)
              ? Math.max(0.35, Math.min(3.5, scaleVal))
              : 1,
            ...(flipAttr === 'true' || flipAttr === '1' ? { flip: true } : {}),
            ...(lockedAttr === 'true' || lockedAttr === '1'
              ? { locked: true }
              : {}),
            ...(layerAttr === 'behind' ? { layer: 'behind' as const } : {}),
            ...(caption ? { caption } : {}),
          };
          const prevBlock = blocks[blocks.length - 1];
          if (prevBlock) {
            prevBlock.stickers = [...(prevBlock.stickers ?? []), sticker];
          } else {
            pendingStickers.push(sticker);
          }
        } else {
          const rawAlign = extractQuotedAttr(attrsRaw, 'align').toLowerCase();
          const align: 'left' | 'center' | 'right' =
            rawAlign === 'left' || rawAlign === 'right' ? rawAlign : 'center';
          const rawSize = extractQuotedAttr(attrsRaw, 'size').toLowerCase();
          const size: 'sm' | 'md' | 'lg' =
            rawSize === 'sm' || rawSize === 'lg' ? rawSize : 'md';
          blocks.push({
            id: createVisualId(),
            type: 'pixel_sticker',
            sprite,
            align,
            size,
            caption,
          });
        }

        i += 1;
        if (i < lines.length && lines[i].trim() === ':::') {
          i += 1;
        }
        continue;
      }

      if (kindRaw === 'steps') {
        let scope: TaskScope = 'section';
        let cleanTitle = title;
        const lowerTitle = title.toLowerCase();
        if (lowerTitle === 'section') {
          scope = 'section';
          cleanTitle = '';
        } else if (lowerTitle === 'paragraph') {
          scope = 'paragraph';
          cleanTitle = '';
        } else {
          const pipeIdx = title.indexOf(' | ');
          if (pipeIdx !== -1) {
            const left = title.slice(0, pipeIdx).trim().toLowerCase();
            if (left === 'section' || left === 'paragraph') {
              scope = left;
              cleanTitle = title.slice(pipeIdx + 3).trim();
            }
          }
        }
        i += 1;
        const items: VisualStepItem[] = [];
        while (i < lines.length && lines[i].trim() !== ':::') {
          const parsed = parseStepLine(lines[i]);
          if (parsed) items.push(parsed);
          i += 1;
        }
        if (i < lines.length && lines[i].trim() === ':::') i += 1;
        blocks.push({
          id: createVisualId(),
          type: 'steps',
          title: cleanTitle,
          scope,
          items: items.length > 0 ? items : [{ id: createVisualId('st'), title: '', detail: '', defaultChecked: false }],
        });
        continue;
      }

      const alertKind = ALERT_KIND_MAP[kindRaw];
      if (alertKind) {
        i += 1;
        const bodyLines: string[] = [];
        let detailSummary = '';
        const detailLines: string[] = [];
        let inDetail = false;

        while (i < lines.length && lines[i].trim() !== ':::') {
          const inner = lines[i];
          const innerTrim = inner.trim();
          if (innerTrim.startsWith('???')) {
            inDetail = true;
            detailSummary = innerTrim.slice(3).trim();
          } else if (inDetail) {
            detailLines.push(inner);
          } else {
            bodyLines.push(inner);
          }
          i += 1;
        }
        if (i < lines.length && lines[i].trim() === ':::') i += 1;

        const align = normalizeBlockAlign(extractQuotedAttr(attrsRaw, 'align'));
        const size = normalizeBlockSize(extractQuotedAttr(attrsRaw, 'size'));
        blocks.push({
          id: createVisualId(),
          type: 'alert',
          kind: alertKind,
          title,
          body: bodyLines.join('\n').trim(),
          detailSummary,
          detailBody: detailLines.join('\n').trim(),
          style: normalizeStickerStyle(extractQuotedAttr(attrsRaw, 'style')),
          tone: normalizeStickerTone(extractQuotedAttr(attrsRaw, 'tone')),
          badge: extractQuotedAttr(attrsRaw, 'badge').trim().slice(0, 24),
          ...(align ? { align } : {}),
          ...(size ? { size } : {}),
        });
        continue;
      }
    }

    // 3. Fenced Code Blocks & Rough.js Sketch Diagrams
    const fenceOpenMatch = trimmed.match(/^(`{3,})(.*)$/);
    if (fenceOpenMatch) {
      const fenceLen = fenceOpenMatch[1].length;
      const info = fenceOpenMatch[2].trim();
      const closeFenceRe = new RegExp(`^\`{${fenceLen},}\\s*$`);
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !closeFenceRe.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && closeFenceRe.test(lines[i].trim())) i += 1;

      const rawCode = codeLines.join('\n');

      // Check for an immediately following :::margin[...]
      let marginNote = '';
      if (i < lines.length) {
        const nextTrim = lines[i].trim();
        if (nextTrim.startsWith(':::margin[') && nextTrim.endsWith(']')) {
          marginNote = nextTrim.slice(':::margin['.length, -1).trim();
          i += 1;
        }
      }

      if (info === 'sketch' || info.startsWith('sketch ')) {
        const caption = extractQuotedAttr(info, 'caption');
        try {
          const parsed = JSON.parse(rawCode.trim()) as Partial<SketchSpec>;
          if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
            blocks.push({
              id: createVisualId(),
              type: 'rough_diagram',
              caption,
              spec: {
                nodes: parsed.nodes,
                edges: parsed.edges,
              },
            });
            continue;
          }
        } catch {
          // Fall through to raw_markdown if malformed JSON so nothing is lost
        }
        blocks.push({
          id: createVisualId(),
          type: 'raw_markdown',
          content: `\`\`\`${info}\n${rawCode}\n\`\`\``,
        });
        continue;
      }

      const language = info.split(/\s+/)[0] || 'text';
      const filename = extractQuotedAttr(info, 'title');
      const style = normalizeCodeCardStyle(extractQuotedAttr(info, 'style'));
      blocks.push({
        id: createVisualId(),
        type: 'code_card',
        language,
        filename,
        code: rawCode,
        marginNote,
        style,
      });
      continue;
    }

    // 4. Headings (#..####) — detects optional leading `[ ] ` / `[x] ` Section Task marker (`节任务`)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const rawLevel = headingMatch[1].length;
      const level = (rawLevel <= 2 ? 2 : rawLevel === 3 ? 3 : 4) as 2 | 3 | 4;
      let rawHeadingText = headingMatch[2].trim();
      let isTask = false;
      let defaultChecked = false;
      if (rawHeadingText.startsWith('[ ]')) {
        const rest = rawHeadingText.slice(3).trimStart();
        if (rest.length > 0) {
          isTask = true;
          rawHeadingText = rest;
        }
      } else if (rawHeadingText.startsWith('[x]') || rawHeadingText.startsWith('[X]')) {
        const rest = rawHeadingText.slice(3).trimStart();
        if (rest.length > 0) {
          isTask = true;
          defaultChecked = true;
          rawHeadingText = rest;
        }
      }
      blocks.push({
        id: createVisualId(),
        type: 'heading',
        level,
        text: rawHeadingText,
        isTask,
        defaultChecked,
      });
      i += 1;
      continue;
    }

    // 5. Blockquotes (> ...)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({
        id: createVisualId(),
        type: 'quote',
        text: quoteLines.join('\n').trim(),
      });
      continue;
    }

    // 6. Standalone GitHub-style task list (- [ ] ...) -> Interactive Steps block
    if (isTaskListLine(trimmed)) {
      const items: VisualStepItem[] = [];
      while (i < lines.length && isTaskListLine(lines[i].trim())) {
        const parsed = parseStepLine(lines[i]);
        if (parsed) items.push(parsed);
        i += 1;
      }
      blocks.push({
        id: createVisualId(),
        type: 'steps',
        title: '',
        scope: 'paragraph',
        items,
      });
      continue;
    }

    // 7. Standard unordered or ordered list
    if (isBulletListLine(trimmed) || isOrderedListLine(trimmed)) {
      const ordered = isOrderedListLine(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (ordered && isOrderedListLine(cur)) {
          items.push(cur.replace(/^\d+\.\s+/, ''));
          i += 1;
        } else if (!ordered && isBulletListLine(cur)) {
          items.push(cur.replace(/^[-*]\s+/, ''));
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({
        id: createVisualId(),
        type: 'list',
        ordered,
        items,
      });
      continue;
    }

    // 8. Markdown tables -> preserve losslessly in raw_markdown
    if (isTableLine(trimmed)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i].trim())) {
        tableLines.push(lines[i]);
        i += 1;
      }
      blocks.push({
        id: createVisualId(),
        type: 'raw_markdown',
        content: tableLines.join('\n'),
      });
      continue;
    }

    // 8b. Standalone Markdown Image (+ optional trailing :::margin[...])
    const parsedImage = parseStandaloneImageLine(trimmed);
    if (parsedImage) {
      i += 1;
      let marginNote = '';
      if (i < lines.length) {
        const nextTrim = lines[i].trim();
        if (nextTrim.startsWith(':::margin[') && nextTrim.endsWith(']')) {
          marginNote = nextTrim.slice(':::margin['.length, -1).trim();
          i += 1;
        }
      }
      blocks.push({
        id: createVisualId(),
        type: 'image',
        src: parsedImage.src,
        alt: parsedImage.alt,
        caption: parsedImage.caption,
        marginNote,
      });
      continue;
    }

    // 9. Regular Paragraph (+ optional trailing :::margin[...])
    const paraLines: string[] = [];
    let marginNote = '';
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (!curTrim) break;
      if (curTrim.startsWith(':::margin[') && curTrim.endsWith(']')) {
        marginNote = curTrim.slice(':::margin['.length, -1).trim();
        i += 1;
        break;
      }
      if (paraLines.length > 0 && isBlockStart(curTrim)) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }
    blocks.push({
      id: createVisualId(),
      type: 'paragraph',
      text: paraLines.join('\n').trim(),
      marginNote,
    });
  }

  if (pendingStickers.length > 0) {
    if (blocks.length > 0) {
      blocks[0].stickers = [...pendingStickers, ...(blocks[0].stickers ?? [])];
    } else {
      blocks.push({
        id: createVisualId(),
        type: 'paragraph',
        text: '',
        marginNote: '',
        stickers: [...pendingStickers],
      });
    }
  }

  return blocks;
}

function serializeAttachedStickers(
  stickers?: AttachedPixelSticker[],
): string[] {
  if (!stickers || stickers.length === 0) return [];
  return stickers.map((st) => {
    const safeSprite = (st.sprite || 'cat').trim().toLowerCase() || 'cat';
    const x = Number(Math.max(-25, Math.min(125, st.x)).toFixed(1));
    const y = Number(Math.max(-60, Math.min(160, st.y)).toFixed(1));
    const rot = Number(Math.max(-180, Math.min(180, st.rotate)).toFixed(1));
    const sc = Number(Math.max(0.35, Math.min(3.5, st.scale)).toFixed(2));
    const attrs = [
      'anchor="block"',
      `x="${x}"`,
      `y="${y}"`,
      `rotate="${rot}"`,
      `scale="${sc}"`,
    ];
    if (st.flip) attrs.push('flip="true"');
    if (st.locked) attrs.push('locked="true"');
    if (st.layer === 'behind') attrs.push('layer="behind"');
    if (st.caption?.trim()) {
      attrs.push(
        `caption="${st.caption.trim().replace(/["\r\n]/g, "'")}"`,
      );
    }
    return `:::pixel[${safeSprite}]{${attrs.join(' ')}}`;
  });
}

function serializeFormatDirective(
  align?: TextAlign,
  size?: TextSizePreset,
): string {
  const attrs: string[] = [];
  if (align && align !== 'left') attrs.push(`align="${align}"`);
  if (size && size !== 'base') attrs.push(`size="${size}"`);
  return attrs.length > 0 ? `:::format{${attrs.join(' ')}}` : '';
}

/**
 * Serialize `VisualBlock[]` back to clean, git-friendly IceHandNote Markdown.
 */
export function serializeVisualBlocksToMarkdown(blocks: VisualBlock[]): string {
  const chunks: string[] = [];

  for (const block of blocks) {
    const beforeLen = chunks.length;
    switch (block.type) {
      case 'heading': {
        const hashes = '#'.repeat(block.level);
        const title = block.text.trim();
        const headLine =
          block.isTask && title
            ? `${hashes} ${block.defaultChecked ? '[x]' : '[ ]'} ${title}`
            : `${hashes} ${title}`;
        const fmtLine = serializeFormatDirective(block.align);
        chunks.push(fmtLine ? `${headLine}\n${fmtLine}` : headLine);
        break;
      }
      case 'paragraph': {
        const body = block.text.trim();
        const note = block.marginNote.trim();
        const fmtLine = serializeFormatDirective(block.align, block.size);
        if (!body && !note && !fmtLine) break;
        const parts: string[] = [body];
        if (fmtLine) parts.push(fmtLine);
        if (note) parts.push(`:::margin[${note}]`);
        chunks.push(parts.filter(Boolean).join('\n'));
        break;
      }
      case 'steps': {
        const cleanItems = block.items.filter((it) => it.title.trim().length > 0);
        if (cleanItems.length === 0 && !block.title.trim()) break;
        const lines = cleanItems.map((it) => {
          const box = it.defaultChecked ? '[x]' : '[ ]';
          const title = it.title.trim();
          const detail = it.detail.trim();
          return detail ? `- ${box} ${title} | ${detail}` : `- ${box} ${title}`;
        });
        const cleanTitle = block.title.trim();
        if (block.scope === 'paragraph' && !cleanTitle && lines.length > 0) {
          chunks.push(lines.join('\n'));
        } else {
          const header =
            block.scope === 'paragraph'
              ? cleanTitle
                ? `:::steps[paragraph | ${cleanTitle}]`
                : ':::steps[paragraph]'
              : cleanTitle
                ? `:::steps[${cleanTitle}]`
                : ':::steps[section]';
          chunks.push([header, ...lines, ':::'].join('\n'));
        }
        break;
      }
      case 'alert': {
        const titlePart = block.title.trim() ? `[${block.title.trim()}]` : '';
        const attrParts: string[] = [];
        if (block.style) attrParts.push(`style="${block.style}"`);
        if (block.tone) attrParts.push(`tone="${block.tone}"`);
        if (block.badge.trim()) {
          attrParts.push(
            `badge="${block.badge.trim().slice(0, 24).replace(/"/g, "'")}"`,
          );
        }
        if (block.align && block.align !== 'left') {
          attrParts.push(`align="${block.align}"`);
        }
        if (block.size && block.size !== 'base') {
          attrParts.push(`size="${block.size}"`);
        }
        const attrSuffix =
          attrParts.length > 0 ? `{${attrParts.join(' ')}}` : '';
        const outLines = [`:::${block.kind}${titlePart}${attrSuffix}`];
        if (block.body.trim()) outLines.push(block.body.trim());
        if (block.detailSummary.trim() || block.detailBody.trim()) {
          outLines.push(`??? ${block.detailSummary.trim()}`);
          if (block.detailBody.trim()) outLines.push(block.detailBody.trim());
        }
        outLines.push(':::');
        chunks.push(outLines.join('\n'));
        break;
      }
      case 'code_card': {
        const lang = block.language.trim() || 'text';
        const fileAttr = block.filename.trim()
          ? ` title="${block.filename.trim().replace(/"/g, "'")}"`
          : '';
        const styleAttr =
          block.style && block.style !== 'washi'
            ? ` style="${block.style}"`
            : '';
        let maxRun = 2;
        for (const m of block.code.matchAll(/`+/g)) {
          if (m[0].length > maxRun) maxRun = m[0].length;
        }
        const fence = '`'.repeat(maxRun + 1);
        const fenced = `${fence}${lang}${fileAttr}${styleAttr}\n${block.code}\n${fence}`;
        const note = block.marginNote.trim();
        chunks.push(note ? `${fenced}\n:::margin[${note}]` : fenced);
        break;
      }
      case 'list': {
        const clean = block.items.map((it) => it.trim()).filter(Boolean);
        if (clean.length === 0) break;
        chunks.push(
          clean
            .map((it, idx) => (block.ordered ? `${idx + 1}. ${it}` : `- ${it}`))
            .join('\n'),
        );
        break;
      }
      case 'image': {
        const src = block.src.trim();
        if (!src || src.startsWith('blob:')) break;
        const alt = block.alt.trim().replace(/\]/g, '\\]');
        const cap = block.caption.trim().replace(/"/g, "'");
        const mdImg = cap ? `![${alt}](${src} "${cap}")` : `![${alt}](${src})`;
        const note = block.marginNote.trim();
        chunks.push(note ? `${mdImg}\n:::margin[${note}]` : mdImg);
        break;
      }
      case 'quote': {
        const text = block.text.trim();
        if (!text) break;
        const qLines = text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n');
        const fmtLine = serializeFormatDirective(block.align, block.size);
        chunks.push(fmtLine ? `${qLines}\n${fmtLine}` : qLines);
        break;
      }
      case 'rough_diagram': {
        const capAttr = block.caption.trim()
          ? ` caption="${block.caption.trim().replace(/"/g, "'")}"`
          : '';
        const json = JSON.stringify(block.spec, null, 2);
        chunks.push(`\`\`\`sketch${capAttr}\n${json}\n\`\`\``);
        break;
      }
      case 'pixel_sticker': {
        const safeSprite = (block.sprite || 'cat').trim().toLowerCase() || 'cat';
        const attrs: string[] = [
          `align="${block.align || 'center'}"`,
          `size="${block.size || 'md'}"`,
        ];
        if (block.caption.trim()) {
          attrs.push(
            `caption="${block.caption.trim().replace(/["\r\n]/g, "'")}"`,
          );
        }
        chunks.push(`:::pixel[${safeSprite}]{${attrs.join(' ')}}`);
        break;
      }
      case 'raw_markdown': {
        if (block.content.trim()) {
          chunks.push(block.content.trim());
        }
        break;
      }
    }

    const stickerLines = serializeAttachedStickers(block.stickers);
    if (stickerLines.length > 0) {
      if (chunks.length > beforeLen) {
        chunks[chunks.length - 1] =
          `${chunks[chunks.length - 1]}\n${stickerLines.join('\n')}`;
      } else {
        chunks.push(stickerLines.join('\n'));
      }
    }
  }

  return chunks.join('\n\n');
}

export function createDefaultVisualBlock(kind: VisualBlock['type']): VisualBlock {
  const id = createVisualId();
  switch (kind) {
    case 'heading':
      return { id, type: 'heading', level: 2, text: '', isTask: false, defaultChecked: false };
    case 'paragraph':
      return { id, type: 'paragraph', text: '', marginNote: '' };
    case 'steps':
      return {
        id,
        type: 'steps',
        title: '',
        scope: 'paragraph',
        items: [
          { id: createVisualId('st'), title: '', detail: '', defaultChecked: false },
        ],
      };
    case 'alert':
      return {
        id,
        type: 'alert',
        kind: 'tip',
        title: '',
        body: '',
        detailSummary: '',
        detailBody: '',
        style: '',
        tone: '',
        badge: '',
      };
    case 'code_card':
      return {
        id,
        type: 'code_card',
        language: 'text',
        filename: '',
        code: '',
        marginNote: '',
        style: 'washi',
      };
    case 'list':
      return { id, type: 'list', ordered: false, items: ['', ''] };
    case 'image':
      return { id, type: 'image', src: '', alt: '', caption: '', marginNote: '' };
    case 'quote':
      return { id, type: 'quote', text: '' };
    case 'pixel_sticker':
      return {
        id,
        type: 'pixel_sticker',
        sprite: 'cat',
        align: 'center',
        size: 'md',
        caption: '',
      };
    case 'rough_diagram':
      return {
        id,
        type: 'rough_diagram',
        caption: '',
        spec: {
          nodes: [
            { id: 'n1', label: 'A', sublabel: '', x: 24, y: 36, width: 155, height: 64, tone: 'ice' },
            { id: 'n2', label: 'B', sublabel: '', x: 260, y: 36, width: 160, height: 64, tone: 'violet' },
          ],
          edges: [{ from: 'n1', to: 'n2', label: '' }],
        },
      };
    case 'raw_markdown':
      return { id, type: 'raw_markdown', content: '' };
  }
}
