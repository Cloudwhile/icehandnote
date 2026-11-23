/*
 * Pure DOM <-> Inline Markdown Codec & Rich Selection Formatting Helpers for IceHandNote.
 * - Converts between clean Markdown/safe-HTML storage strings and live WYSIWYG DOM nodes
 *   (no raw `**`, `` ` ``, or tag markers displayed while editing).
 * - Supports theme-calibrated text colors (`ink-fg-*`), background pills (`ink-bg-*`),
 *   highlighter marker sweeps (`mark.ink-hl-*`), font sizes (`ink-size-*`),
 *   inline code (`<code class="ink-inline-code">`), tactile keyboard combos (`.ink-kbd-combo`),
 *   links, and CSS Custom Highlight persistence (`CSS.highlights` + `TreeWalker`).
 */

import type { TextAlign, TextSizePreset } from './types';
import { isSafeHref } from './urlSafety';

export type InlineFgColor = 'violet' | 'ice' | 'emerald' | 'amber' | 'rose' | 'muted';
export type InlineBgColor = 'violet' | 'ice' | 'emerald' | 'amber' | 'rose' | 'kraft';
export type InlineHighlightColor = 'amber' | 'violet' | 'ice' | 'emerald' | 'rose';

export interface ActiveInlineFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  fgColor: InlineFgColor | null;
  bgColor: InlineBgColor | null;
  highlight: InlineHighlightColor | null;
  fontSize: TextSizePreset | null;
  linkHref: string | null;
  selectedText: string;
}

export type RichInlineCommand =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'inline-code' }
  | { type: 'fg-color'; value: InlineFgColor | null }
  | { type: 'bg-color'; value: InlineBgColor | null }
  | { type: 'highlight'; value: InlineHighlightColor | null }
  | { type: 'font-size'; value: TextSizePreset | null }
  | { type: 'link'; href: string }
  | { type: 'unlink' }
  | { type: 'kbd-combo'; keys: string[] }
  | { type: 'clear-format' };

const ALLOWED_INLINE_TAG_PREFIX =
  /^<\/?(?:strong|b|em|i|u|s|del|ins|code|kbd|mark|span|a|br|sub|sup)(?=[\s/>])/i;

const FG_CLASS_RE = /^ink-fg-(violet|ice|emerald|amber|rose|muted)$/;
const BG_CLASS_RE = /^ink-bg-(violet|ice|emerald|amber|rose|kraft)$/;
const HL_CLASS_RE = /^ink-hl-(amber|violet|ice|emerald|rose)$/;
const SIZE_CLASS_RE = /^ink-size-(sm|lg|xl|2xl)$/;

export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, '&quot;');
}

function findMatchingLinkEnd(raw: string, urlStart: number): number {
  let depth = 0;
  for (let idx = urlStart; idx < raw.length; idx += 1) {
    const ch = raw[idx];
    if (ch === '\n' || ch === '\r') return -1;
    if (ch === '\\' && idx + 1 < raw.length) {
      idx += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      if (depth === 0) return idx;
      depth -= 1;
    }
  }
  return -1;
}

function convertInlineMarkdownText(raw: string, multiline: boolean): string {
  let out = '';
  let i = 0;

  while (i < raw.length) {
    // 1. Escaped ASCII punctuation (`\*`, `\``)
    if (raw[i] === '\\' && i + 1 < raw.length && /[*~`\\[\]()]/.test(raw[i + 1])) {
      out += escapeHtmlText(raw[i + 1]);
      i += 2;
      continue;
    }

    // 2. Backtick inline code (`...`)
    if (raw[i] === '`') {
      const close = raw.indexOf('`', i + 1);
      if (close > i + 1 && !raw.slice(i + 1, close).includes('\n')) {
        out += `<code class="ink-inline-code">${escapeHtmlText(raw.slice(i + 1, close))}</code>`;
        i = close + 1;
        continue;
      }
    }

    // 3. Markdown link [label](url)
    if (raw[i] === '[') {
      const mid = raw.indexOf('](', i + 1);
      if (mid !== -1 && !raw.slice(i + 1, mid).includes('\n')) {
        const end = findMatchingLinkEnd(raw, mid + 2);
        if (end !== -1) {
          const href = raw.slice(mid + 2, end).trim();
          if (isSafeHref(href)) {
            const inner = convertInlineMarkdownText(raw.slice(i + 1, mid), multiline);
            out += `<a href="${escapeAttr(href)}">${inner}</a>`;
            i = end + 1;
            continue;
          }
        }
      }
    }

    // 4. Bold (**...**)
    if (raw.startsWith('**', i)) {
      const close = raw.indexOf('**', i + 2);
      if (close > i + 2 && !/\s/.test(raw[i + 2]) && !/\s/.test(raw[close - 1])) {
        const inner = convertInlineMarkdownText(raw.slice(i + 2, close), multiline);
        out += `<strong>${inner}</strong>`;
        i = close + 2;
        continue;
      }
    }

    // 5. Strikethrough (~~...~~)
    if (raw.startsWith('~~', i)) {
      const close = raw.indexOf('~~', i + 2);
      if (close > i + 2 && !/\s/.test(raw[i + 2]) && !/\s/.test(raw[close - 1])) {
        const inner = convertInlineMarkdownText(raw.slice(i + 2, close), multiline);
        out += `<s>${inner}</s>`;
        i = close + 2;
        continue;
      }
    }

    // 6. Italic (*...*)
    if (raw[i] === '*' && raw[i + 1] !== '*') {
      const close = findClosingSingleStar(raw, i + 1);
      if (close > i + 1 && !/^\s/.test(raw[i + 1])) {
        const inner = convertInlineMarkdownText(raw.slice(i + 1, close), multiline);
        out += `<em>${inner}</em>`;
        i = close + 1;
        continue;
      }
    }

    if (raw[i] === '\n') {
      out += multiline ? '<br>' : ' ';
      i += 1;
      continue;
    }

    out += escapeHtmlText(raw[i]);
    i += 1;
  }

  return out;
}

function findClosingSingleStar(s: string, start: number): number {
  let idx = start;
  while (idx < s.length) {
    if (s[idx] === '\\') {
      idx += 2;
      continue;
    }
    if (s[idx] === '*') {
      if (s[idx + 1] === '*') {
        idx += 2;
        continue;
      }
      if (idx > start && !/\s/.test(s[idx - 1])) {
        return idx;
      }
    }
    if (s[idx] === '\n') return -1;
    idx += 1;
  }
  return -1;
}

/**
 * Converts stored Markdown/inline-HTML string into rich HTML suitable for `RichEditable`
 * without displaying raw Markdown markers.
 */
export function inlineMarkdownToHtml(src: string, multiline = true): string {
  if (!src) return '';
  let out = '';
  let cursor = 0;

  while (cursor < src.length) {
    const tagStart = src.indexOf('<', cursor);
    if (tagStart === -1) {
      out += convertInlineMarkdownText(src.slice(cursor), multiline);
      break;
    }

    if (tagStart > cursor) {
      out += convertInlineMarkdownText(src.slice(cursor, tagStart), multiline);
    }

    const tail = src.slice(tagStart);

    // Keep atomic <code ...>...</code>, <kbd ...>...</kbd>, and .ink-kbd-combo untouched by markdown rules
    const atomicMatch = tail.match(
      /^(<code\b[^>]*>[\s\S]*?<\/code>|<kbd\b[^>]*>[\s\S]*?<\/kbd>|<span\b[^>]*\bink-kbd-combo\b[^>]*>(?:<kbd\b[\s\S]*?<\/kbd>|<span\b[^>]*>[\s\S]*?<\/span>|\s)*<\/span>)/i,
    );
    if (atomicMatch) {
      let chunk = atomicMatch[1];
      if (/^<code\b/i.test(chunk) && !/\bink-inline-code\b/.test(chunk)) {
        chunk = chunk.replace(/^<code/i, '<code class="ink-inline-code"');
      } else if (/^<kbd\b/i.test(chunk) && !/\bink-kbd\b/.test(chunk)) {
        chunk = chunk.replace(/^<kbd/i, '<kbd class="ink-kbd"');
      }
      out += chunk;
      cursor = tagStart + atomicMatch[1].length;
      continue;
    }

    if (ALLOWED_INLINE_TAG_PREFIX.test(tail)) {
      const closeBracket = src.indexOf('>', tagStart);
      if (closeBracket !== -1) {
        out += src.slice(tagStart, closeBracket + 1);
        cursor = closeBracket + 1;
        continue;
      }
    }

    out += '&lt;';
    cursor = tagStart + 1;
  }

  return out;
}

function normalizeTextContent(s: string): string {
  return s.replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
}

function wrapMarkdownDelimiter(inner: string, marker: '**' | '*' | '~~'): string {
  const leading = inner.match(/^[ \t]+/)?.[0] ?? '';
  const tailSlice = inner.slice(leading.length);
  const trailing = tailSlice.match(/[ \t]+$/)?.[0] ?? '';
  const core = tailSlice.slice(0, tailSlice.length - trailing.length);
  if (!core) return `${leading}${trailing}`;
  return `${leading}${marker}${core}${marker}${trailing}`;
}

function appendSerializedPart(acc: string, nextPart: string): string {
  if (!nextPart) return acc;
  let safeNext = nextPart;
  if (acc.endsWith('*') && safeNext.startsWith('*')) {
    if (safeNext.startsWith('**') && safeNext.endsWith('**') && safeNext.length > 4) {
      safeNext = `<strong>${safeNext.slice(2, -2)}</strong>`;
    } else if (safeNext.startsWith('*') && safeNext.endsWith('*') && safeNext.length > 2) {
      safeNext = `<em>${safeNext.slice(1, -1)}</em>`;
    }
  } else if (acc.endsWith('~') && safeNext.startsWith('~~') && safeNext.endsWith('~~') && safeNext.length > 4) {
    safeNext = `<s>${safeNext.slice(2, -2)}</s>`;
  }
  return acc + safeNext;
}

function serializeChildList(nodes: NodeListOf<ChildNode> | ChildNode[], multiline: boolean): string {
  let acc = '';
  Array.from(nodes).forEach((child) => {
    acc = appendSerializedPart(acc, serializeDomNode(child, multiline));
  });
  return acc;
}

function extractCanonicalSpanClasses(rawClass: string): string[] {
  const kept: string[] = [];
  for (const token of rawClass.split(/\s+/)) {
    if (
      FG_CLASS_RE.test(token) ||
      BG_CLASS_RE.test(token) ||
      SIZE_CLASS_RE.test(token)
    ) {
      if (!kept.includes(token)) kept.push(token);
    }
  }
  return kept;
}

function serializeDomNode(node: Node, multiline: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeTextContent(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    return multiline ? '\n' : ' ';
  }

  // Canonicalize key combos cleanly
  if (el.classList.contains('ink-kbd-combo')) {
    const keys = Array.from(el.querySelectorAll('kbd'))
      .map((k) => normalizeTextContent(k.textContent ?? '').trim())
      .filter(Boolean);
    if (keys.length === 0) return '';
    return formatKeyComboHtml(keys);
  }

  if (tag === 'kbd') {
    const label = normalizeTextContent(el.textContent ?? '').trim();
    return label ? `<kbd class="ink-kbd">${escapeHtmlText(label)}</kbd>` : '';
  }

  if (tag === 'code') {
    if (el.querySelector('.ink-kbd-combo, kbd')) {
      return serializeChildList(el.childNodes, multiline);
    }
    const raw = normalizeTextContent(el.textContent ?? '');
    if (!raw) return '';
    const leading = raw.match(/^[ \t]+/)?.[0] ?? '';
    const tailSlice = raw.slice(leading.length);
    const trailing = tailSlice.match(/[ \t]+$/)?.[0] ?? '';
    const core = tailSlice.slice(0, tailSlice.length - trailing.length);
    if (!core) return `${leading}${trailing}`;
    if (!core.includes('`') && !core.includes('\n') && !core.includes('<') && !core.includes('>')) {
      return `${leading}\`${core}\`${trailing}`;
    }
    return `${leading}<code class="ink-inline-code">${escapeHtmlText(core)}</code>${trailing}`;
  }

  // Browser block wrappers created by contentEditable Enter/paste
  if (tag === 'div' || tag === 'p') {
    const inner = serializeChildList(el.childNodes, multiline);
    return inner;
  }

  const inner = serializeChildList(el.childNodes, multiline);

  if (tag === 'strong' || tag === 'b') {
    return inner ? wrapMarkdownDelimiter(inner, '**') : '';
  }
  if (tag === 'em' || tag === 'i') {
    return inner ? wrapMarkdownDelimiter(inner, '*') : '';
  }
  if (tag === 's' || tag === 'del' || tag === 'strike') {
    return inner ? wrapMarkdownDelimiter(inner, '~~') : '';
  }
  if (tag === 'u') {
    return inner ? `<u>${inner}</u>` : '';
  }
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    if (!href || !isSafeHref(href)) return inner;
    if (!inner) return '';
    if (!inner.includes('<') && !inner.includes('[') && !inner.includes(']') && !inner.includes('\n')) {
      const safeMdHref = href.replace(/\(/g, '%28').replace(/\)/g, '%29');
      return `[${inner}](${safeMdHref})`;
    }
    return `<a href="${escapeAttr(href)}">${inner}</a>`;
  }
  if (tag === 'mark') {
    if (!inner) return '';
    const hlCls =
      Array.from(el.classList).find((c) => HL_CLASS_RE.test(c)) ?? 'ink-hl-amber';
    return `<mark class="${hlCls}">${inner}</mark>`;
  }
  if (tag === 'span') {
    if (!inner) return '';
    const keptClasses = extractCanonicalSpanClasses(el.className || '');
    if (keptClasses.length === 0) return inner;
    return `<span class="${keptClasses.join(' ')}">${inner}</span>`;
  }

  return inner;
}

/**
 * Serializes a `RichEditable` DOM element cleanly back into stored Markdown + whitelisted inline HTML.
 */
export function editorDomToInlineMarkdown(root: Node, multiline = true): string {
  const nodes = Array.from(root.childNodes);
  let out = '';

  for (let i = 0; i < nodes.length; i += 1) {
    const cur = nodes[i];
    if (
      multiline &&
      cur.nodeType === Node.ELEMENT_NODE &&
      ['div', 'p'].includes((cur as HTMLElement).tagName.toLowerCase())
    ) {
      const part = serializeDomNode(cur, multiline);
      if (out && !out.endsWith('\n')) out += '\n';
      out += part;
      if (i < nodes.length - 1 && !out.endsWith('\n')) out += '\n';
      continue;
    }
    out = appendSerializedPart(out, serializeDomNode(cur, multiline));
  }

  // Strip a single trailing synthetic newline left by contentEditable `<br>` placeholders
  if (out.endsWith('\n') && root.lastChild?.nodeName === 'BR') {
    out = out.slice(0, -1);
  }
  return multiline ? out : out.replace(/\n+/g, ' ');
}

export function formatKeyComboHtml(keys: string[]): string {
  const clean = keys.map((k) => k.trim()).filter(Boolean).slice(0, 6);
  if (clean.length === 0) return '';
  if (clean.length === 1) {
    return `<kbd class="ink-kbd">${escapeHtmlText(clean[0])}</kbd>`;
  }
  const inner = clean
    .map((k) => `<kbd class="ink-kbd">${escapeHtmlText(k)}</kbd>`)
    .join('<span class="ink-kbd-sep">+</span>');
  return `<span class="ink-kbd-combo">${inner}</span>`;
}

export function parseKeyComboInput(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed === '+') return ['+'];
  return trimmed
    .split(/\s*\+\s*|\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 6);
}

const KEY_LABEL_MAP: Record<string, string> = {
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: '⌘',
  Enter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: '⌫',
  Delete: 'Del',
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

export function eventToKeyCombo(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string[] {
  const keys: string[] = [];
  if (e.ctrlKey) keys.push('Ctrl');
  if (e.metaKey) keys.push('⌘');
  if (e.altKey) keys.push('Alt');
  if (e.shiftKey) keys.push('Shift');

  const isModOnly = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key);
  if (!isModOnly) {
    const mapped =
      KEY_LABEL_MAP[e.key] ??
      (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    keys.push(mapped);
  }
  return keys;
}

/**
 * Inspects formatting active on the current `Range` inside `rootEl`.
 */
export function inspectActiveInlineFormats(
  rootEl: HTMLElement,
  range: Range,
): ActiveInlineFormats {
  const result: ActiveInlineFormats = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
    fgColor: null,
    bgColor: null,
    highlight: null,
    fontSize: null,
    linkHref: null,
    selectedText: range.toString(),
  };

  let cur: Node | null = range.startContainer;
  while (cur && cur !== rootEl) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === 'strong' || tag === 'b') result.bold = true;
      if (tag === 'em' || tag === 'i') result.italic = true;
      if (tag === 'u') result.underline = true;
      if (tag === 's' || tag === 'del' || tag === 'strike') result.strike = true;
      if (tag === 'code') result.code = true;
      if (tag === 'a' && !result.linkHref) {
        result.linkHref = el.getAttribute('href');
      }
      if (tag === 'mark' && !result.highlight) {
        for (const cls of Array.from(el.classList)) {
          const m = cls.match(HL_CLASS_RE);
          if (m) result.highlight = m[1] as InlineHighlightColor;
        }
        if (!result.highlight) result.highlight = 'amber';
      }
      if (tag === 'span') {
        for (const cls of Array.from(el.classList)) {
          const fg = cls.match(FG_CLASS_RE);
          if (fg && !result.fgColor) result.fgColor = fg[1] as InlineFgColor;
          const bg = cls.match(BG_CLASS_RE);
          if (bg && !result.bgColor) result.bgColor = bg[1] as InlineBgColor;
          const sz = cls.match(SIZE_CLASS_RE);
          if (sz && !result.fontSize) result.fontSize = sz[1] as TextSizePreset;
        }
      }
    }
    cur = cur.parentNode;
  }

  return result;
}

function getEditableTextNodesInRange(rootEl: HTMLElement, range: Range): Text[] {
  if (range.collapsed) return [];

  // Clone and align start/end boundaries by splitting boundary text nodes inside rootEl
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text;
    if (range.startOffset > 0 && range.startOffset < t.length) {
      const right = t.splitText(range.startOffset);
      if (range.endContainer === t) {
        range.setEnd(right, range.endOffset - range.startOffset);
      }
      range.setStart(right, 0);
    }
  }
  if (range.endContainer.nodeType === Node.TEXT_NODE) {
    const t = range.endContainer as Text;
    if (range.endOffset > 0 && range.endOffset < t.length) {
      t.splitText(range.endOffset);
      range.setEnd(t, t.length);
    }
  }

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (p?.closest('[contenteditable="false"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let cur = walker.nextNode();
  while (cur) {
    const txt = cur as Text;
    if (txt.length > 0 && range.intersectsNode(txt)) {
      nodes.push(txt);
    }
    cur = walker.nextNode();
  }
  return nodes;
}

function findDirectAncestorMatching(
  node: Node,
  rootEl: HTMLElement,
  pred: (el: HTMLElement) => boolean,
): HTMLElement | null {
  let cur: Node | null = node.parentNode;
  while (cur && cur !== rootEl) {
    if (cur.nodeType === Node.ELEMENT_NODE && pred(cur as HTMLElement)) {
      return cur as HTMLElement;
    }
    cur = cur.parentNode;
  }
  return null;
}

function isolateNodeFromAncestor(
  targetNode: Node,
  ancestorEl: HTMLElement,
): Node {
  // Splits `ancestorEl` around `targetNode` if needed so modifying/unwrapping `ancestorEl`
  // does not alter siblings before or after `targetNode`.
  const parent = ancestorEl.parentNode;
  if (!parent) return targetNode;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(ancestorEl);
  beforeRange.setEndBefore(targetNode);

  const afterRange = document.createRange();
  afterRange.selectNodeContents(ancestorEl);
  afterRange.setStartAfter(targetNode);

  const beforeFrag = beforeRange.extractContents();
  const afterFrag = afterRange.extractContents();

  if (normalizeTextContent(beforeFrag.textContent ?? '') || beforeFrag.querySelector('br,kbd')) {
    const leftClone = ancestorEl.cloneNode(false) as HTMLElement;
    leftClone.appendChild(beforeFrag);
    parent.insertBefore(leftClone, ancestorEl);
  }
  if (normalizeTextContent(afterFrag.textContent ?? '') || afterFrag.querySelector('br,kbd')) {
    const rightClone = ancestorEl.cloneNode(false) as HTMLElement;
    rightClone.appendChild(afterFrag);
    parent.insertBefore(rightClone, ancestorEl.nextSibling);
  }
  return targetNode;
}

function unwrapElement(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

function flattenCodeSyntaxSpans(codeEl: HTMLElement): void {
  codeEl.querySelectorAll('span').forEach((sp) => {
    const classes = Array.from(sp.classList);
    if (classes.some((c) => c === 'hljs' || c.startsWith('hljs-'))) {
      unwrapElement(sp);
    }
  });
}

function buildSelectedNodesRange(nodes: Node[]): Range | null {
  if (nodes.length === 0) return null;
  const r = document.createRange();
  r.setStartBefore(nodes[0]);
  r.setEndAfter(nodes[nodes.length - 1]);
  return r;
}

function trimRangeHorizontalWhitespace(range: Range): void {
  if (range.collapsed) return;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const txt = range.startContainer.textContent ?? '';
    const limit =
      range.startContainer === range.endContainer ? range.endOffset : txt.length;
    let s = range.startOffset;
    while (s < limit && /[ \t\u00A0\u200B]/.test(txt[s])) {
      s += 1;
    }
    if (s > range.startOffset) range.setStart(range.startContainer, s);
  }
  if (range.endContainer.nodeType === Node.TEXT_NODE) {
    const txt = range.endContainer.textContent ?? '';
    const floor =
      range.startContainer === range.endContainer ? range.startOffset : 0;
    let e = range.endOffset;
    while (e > floor && /[ \t\u00A0\u200B]/.test(txt[e - 1])) {
      e -= 1;
    }
    if (e < range.endOffset) range.setEnd(range.endContainer, e);
  }
}

function toggleTagFormat(
  rootEl: HTMLElement,
  range: Range,
  tagName: string,
  pred: (el: HTMLElement) => boolean,
  buildWrapper: () => HTMLElement,
): Range | null {
  const probeNodes = getEditableTextNodesInRange(rootEl, range.cloneRange());
  const allInsideProbe =
    probeNodes.length > 0 &&
    probeNodes.every((t) => Boolean(findDirectAncestorMatching(t, rootEl, pred)));

  if (!allInsideProbe) {
    trimRangeHorizontalWhitespace(range);
    if (range.collapsed) return null;
  }

  const textNodes = getEditableTextNodesInRange(rootEl, range);
  if (textNodes.length === 0) return null;

  const allInside = textNodes.every((t) =>
    Boolean(findDirectAncestorMatching(t, rootEl, pred)),
  );

  if (allInside) {
    if (tagName === 'code') {
      const seenCodes = new Set<HTMLElement>();
      for (const t of textNodes) {
        const codeAnc = findDirectAncestorMatching(t, rootEl, pred);
        if (codeAnc && !seenCodes.has(codeAnc)) {
          seenCodes.add(codeAnc);
          flattenCodeSyntaxSpans(codeAnc);
        }
      }
    }
    for (const t of textNodes) {
      let anc = findDirectAncestorMatching(t, rootEl, pred);
      if (anc) {
        isolateNodeFromAncestor(t, anc);
        anc = findDirectAncestorMatching(t, rootEl, pred);
        if (anc) unwrapElement(anc);
      }
    }
    return buildSelectedNodesRange(textNodes);
  }

  for (const t of textNodes) {
    if (findDirectAncestorMatching(t, rootEl, pred)) continue;
    const wrapper = buildWrapper();
    if (tagName === 'code' && !wrapper.className) {
      wrapper.className = 'ink-inline-code';
    }
    t.parentNode?.insertBefore(wrapper, t);
    wrapper.appendChild(t);
  }
  return buildSelectedNodesRange(textNodes);
}

function applySpanClassFamily(
  rootEl: HTMLElement,
  range: Range,
  classRe: RegExp,
  nextClass: string | null,
): Range | null {
  const textNodes = getEditableTextNodesInRange(rootEl, range);
  if (textNodes.length === 0) return null;

  for (const t of textNodes) {
    // 1. Strip any existing class in this family on ancestors by isolating `t` first
    let anc = findDirectAncestorMatching(
      t,
      rootEl,
      (el) => el.tagName === 'SPAN' && Array.from(el.classList).some((c) => classRe.test(c)),
    );
    while (anc) {
      isolateNodeFromAncestor(t, anc);
      for (const cls of Array.from(anc.classList)) {
        if (classRe.test(cls)) anc.classList.remove(cls);
      }
      if (anc.classList.length === 0) {
        unwrapElement(anc);
      }
      anc = findDirectAncestorMatching(
        t,
        rootEl,
        (el) => el.tagName === 'SPAN' && Array.from(el.classList).some((c) => classRe.test(c)),
      );
    }

    // 2. Apply `nextClass` cleanly onto direct parent styled span or create a new span
    if (nextClass) {
      const parentEl = t.parentElement;
      if (
        parentEl &&
        parentEl !== rootEl &&
        parentEl.tagName === 'SPAN' &&
        !parentEl.classList.contains('ink-kbd-combo') &&
        parentEl.childNodes.length === 1
      ) {
        parentEl.classList.add(nextClass);
      } else {
        const span = document.createElement('span');
        span.className = nextClass;
        t.parentNode?.insertBefore(span, t);
        span.appendChild(t);
      }
    }
  }

  return buildSelectedNodesRange(textNodes);
}

/**
 * Applies a rich inline formatting or insertion command onto `rootEl` using `range`
 * and returns a normalized `Range` preserving focus/selection cleanly.
 */
export function applyRichInlineCommand(
  rootEl: HTMLElement,
  range: Range,
  cmd: RichInlineCommand,
): Range | null {
  if (cmd.type === 'kbd-combo') {
    const keys = cmd.keys.map((k) => k.trim()).filter(Boolean);
    if (keys.length === 0) return null;
    range.deleteContents();

    // Never nest `<kbd>` inside `<code>`, `<kbd>`, or `.ink-kbd-combo`: exit or split outside first
    let curNode: Node | null = range.startContainer;
    let codeOrKbdAnc: HTMLElement | null = null;
    while (curNode && curNode !== rootEl) {
      if (curNode.nodeType === Node.ELEMENT_NODE) {
        const cand = curNode as HTMLElement;
        if (
          cand.tagName === 'CODE' ||
          cand.tagName === 'KBD' ||
          cand.classList.contains('ink-kbd-combo')
        ) {
          codeOrKbdAnc = cand;
        }
      }
      curNode = curNode.parentNode;
    }

    let needsLeadingSpace = false;
    if (codeOrKbdAnc && codeOrKbdAnc.parentNode) {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(codeOrKbdAnc);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(codeOrKbdAnc);
      afterRange.setStart(range.startContainer, range.startOffset);

      const beforeEmpty =
        normalizeTextContent(beforeRange.toString()).length === 0 &&
        !beforeRange.cloneContents().querySelector('kbd,img');
      const afterFrag = afterRange.extractContents();
      const afterHasContent =
        normalizeTextContent(afterFrag.textContent ?? '').length > 0 ||
        Boolean(afterFrag.querySelector('kbd,img'));

      if (beforeEmpty && !afterHasContent) {
        range.setStartBefore(codeOrKbdAnc);
        range.collapse(true);
        codeOrKbdAnc.parentNode.removeChild(codeOrKbdAnc);
      } else if (beforeEmpty && afterHasContent) {
        codeOrKbdAnc.appendChild(afterFrag);
        range.setStartBefore(codeOrKbdAnc);
        range.collapse(true);
      } else {
        if (afterHasContent) {
          const rightClone = codeOrKbdAnc.cloneNode(false) as HTMLElement;
          rightClone.appendChild(afterFrag);
          codeOrKbdAnc.parentNode.insertBefore(rightClone, codeOrKbdAnc.nextSibling);
        }
        range.setStartAfter(codeOrKbdAnc);
        range.collapse(true);
        needsLeadingSpace = true;
      }
    }

    const holder = document.createElement('span');
    holder.innerHTML = formatKeyComboHtml(keys);
    const kbdNode = holder.firstElementChild as HTMLElement | null;
    if (!kbdNode) return null;
    kbdNode.setAttribute('contenteditable', 'false');

    const spaceAfter = document.createTextNode('\u00A0');
    const frag = document.createDocumentFragment();
    if (needsLeadingSpace) {
      frag.appendChild(document.createTextNode(' '));
    }
    frag.appendChild(kbdNode);
    frag.appendChild(spaceAfter);
    range.insertNode(frag);

    const nextRange = document.createRange();
    nextRange.setStart(spaceAfter, spaceAfter.length);
    nextRange.collapse(true);
    return nextRange;
  }

  if (cmd.type === 'inline-code' && range.collapsed) {
    const codeEl = document.createElement('code');
    codeEl.className = 'ink-inline-code';
    codeEl.textContent = 'code';
    const spaceAfter = document.createTextNode('\u00A0');
    const frag = document.createDocumentFragment();
    frag.appendChild(codeEl);
    frag.appendChild(spaceAfter);
    range.insertNode(frag);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(codeEl);
    return nextRange;
  }

  if (range.collapsed) return null;

  switch (cmd.type) {
    case 'bold':
      return toggleTagFormat(
        rootEl,
        range,
        'strong',
        (el) => el.tagName === 'STRONG' || el.tagName === 'B',
        () => document.createElement('strong'),
      );
    case 'italic':
      return toggleTagFormat(
        rootEl,
        range,
        'em',
        (el) => el.tagName === 'EM' || el.tagName === 'I',
        () => document.createElement('em'),
      );
    case 'underline':
      return toggleTagFormat(
        rootEl,
        range,
        'u',
        (el) => el.tagName === 'U',
        () => document.createElement('u'),
      );
    case 'strike':
      return toggleTagFormat(
        rootEl,
        range,
        's',
        (el) => el.tagName === 'S' || el.tagName === 'DEL',
        () => document.createElement('s'),
      );
    case 'inline-code':
      return toggleTagFormat(
        rootEl,
        range,
        'code',
        (el) => el.tagName === 'CODE',
        () => {
          const el = document.createElement('code');
          el.className = 'ink-inline-code';
          return el;
        },
      );
    case 'fg-color':
      return applySpanClassFamily(
        rootEl,
        range,
        FG_CLASS_RE,
        cmd.value ? `ink-fg-${cmd.value}` : null,
      );
    case 'bg-color':
      return applySpanClassFamily(
        rootEl,
        range,
        BG_CLASS_RE,
        cmd.value ? `ink-bg-${cmd.value}` : null,
      );
    case 'font-size':
      return applySpanClassFamily(
        rootEl,
        range,
        SIZE_CLASS_RE,
        cmd.value && cmd.value !== 'base' ? `ink-size-${cmd.value}` : null,
      );
    case 'highlight': {
      const textNodes = getEditableTextNodesInRange(rootEl, range);
      if (textNodes.length === 0) return null;
      for (const t of textNodes) {
        let anc = findDirectAncestorMatching(t, rootEl, (el) => el.tagName === 'MARK');
        while (anc) {
          isolateNodeFromAncestor(t, anc);
          unwrapElement(anc);
          anc = findDirectAncestorMatching(t, rootEl, (el) => el.tagName === 'MARK');
        }
        if (cmd.value) {
          const mark = document.createElement('mark');
          mark.className = `ink-hl-${cmd.value}`;
          t.parentNode?.insertBefore(mark, t);
          mark.appendChild(t);
        }
      }
      return buildSelectedNodesRange(textNodes);
    }
    case 'link': {
      const href = cmd.href.trim();
      if (!isSafeHref(href)) return null;
      const textNodes = getEditableTextNodesInRange(rootEl, range);
      if (textNodes.length === 0) return null;
      for (const t of textNodes) {
        const existing = findDirectAncestorMatching(t, rootEl, (el) => el.tagName === 'A');
        if (existing) {
          existing.setAttribute('href', href);
        } else {
          const a = document.createElement('a');
          a.setAttribute('href', href);
          t.parentNode?.insertBefore(a, t);
          a.appendChild(t);
        }
      }
      return buildSelectedNodesRange(textNodes);
    }
    case 'unlink': {
      const textNodes = getEditableTextNodesInRange(rootEl, range);
      for (const t of textNodes) {
        const existing = findDirectAncestorMatching(t, rootEl, (el) => el.tagName === 'A');
        if (existing) {
          isolateNodeFromAncestor(t, existing);
          unwrapElement(existing);
        }
      }
      return buildSelectedNodesRange(textNodes);
    }
    case 'clear-format': {
      const textNodes = getEditableTextNodesInRange(rootEl, range);
      const seenCodes = new Set<HTMLElement>();
      for (const t of textNodes) {
        const codeAnc = findDirectAncestorMatching(t, rootEl, (el) => el.tagName === 'CODE');
        if (codeAnc && !seenCodes.has(codeAnc)) {
          seenCodes.add(codeAnc);
          flattenCodeSyntaxSpans(codeAnc);
        }
      }
      const isInlineFormatEl = (el: HTMLElement) =>
        ['STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'MARK', 'SPAN', 'A'].includes(
          el.tagName,
        ) && !el.classList.contains('ink-kbd-combo');
      for (const t of textNodes) {
        let anc = findDirectAncestorMatching(t, rootEl, isInlineFormatEl);
        while (anc) {
          isolateNodeFromAncestor(t, anc);
          unwrapElement(anc);
          anc = findDirectAncestorMatching(t, rootEl, isInlineFormatEl);
        }
      }
      return buildSelectedNodesRange(textNodes);
    }
  }
}

/**
 * Maintains a non-destructive CSS Custom Highlight (`::highlight(ink-editor-selection)`)
 * while right-click menus or toolbar sub-popovers hold focus (`highlight-text-ranges`).
 */
export function setPersistentSelectionHighlight(range: Range | null): void {
  if (
    typeof CSS === 'undefined' ||
    !('highlights' in CSS) ||
    typeof Highlight === 'undefined'
  ) {
    return;
  }

  // MANDATORY: Clear previous highlights before registering new ones
  CSS.highlights.delete('ink-editor-selection');
  if (!range || range.collapsed) return;

  const ancestor = range.commonAncestorContainer;
  const root =
    ancestor.nodeType === Node.TEXT_NODE
      ? ancestor.parentElement
      : (ancestor as HTMLElement);
  if (!root) return;

  const subRanges: Range[] = [];
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentNode = treeWalker.nextNode();
  while (currentNode) {
    if (range.intersectsNode(currentNode)) {
      const len = currentNode.textContent?.length ?? 0;
      const s = currentNode === range.startContainer ? range.startOffset : 0;
      const e = currentNode === range.endContainer ? range.endOffset : len;
      if (e > s) {
        const sub = document.createRange();
        sub.setStart(currentNode, s);
        sub.setEnd(currentNode, e);
        subRanges.push(sub);
      }
    }
    currentNode = treeWalker.nextNode();
  }

  if (subRanges.length > 0) {
    CSS.highlights.set('ink-editor-selection', new Highlight(...subRanges));
  }
}

export function blockAlignClass(align?: TextAlign | null): string {
  if (align === 'center') return 'ink-align-center';
  if (align === 'right') return 'ink-align-right';
  if (align === 'left') return 'ink-align-left';
  return '';
}

export function blockSizeClass(size?: TextSizePreset | string | null): string {
  if (size === 'sm' || size === 'lg' || size === 'xl' || size === '2xl') {
    return `ink-size-${size}`;
  }
  return '';
}

export const RICH_FG_SWATCHES: ReadonlyArray<{
  id: InlineFgColor;
  cssVar: string;
}> = [
  { id: 'violet', cssVar: 'var(--inline-fg-violet)' },
  { id: 'ice', cssVar: 'var(--inline-fg-ice)' },
  { id: 'emerald', cssVar: 'var(--inline-fg-emerald)' },
  { id: 'amber', cssVar: 'var(--inline-fg-amber)' },
  { id: 'rose', cssVar: 'var(--inline-fg-rose)' },
  { id: 'muted', cssVar: 'var(--inline-fg-muted)' },
];

export const RICH_BG_SWATCHES: ReadonlyArray<{
  id: InlineBgColor;
  bgVar: string;
  borderVar: string;
}> = [
  { id: 'violet', bgVar: 'var(--inline-bg-violet)', borderVar: 'var(--inline-bg-violet-border)' },
  { id: 'ice', bgVar: 'var(--inline-bg-ice)', borderVar: 'var(--inline-bg-ice-border)' },
  { id: 'emerald', bgVar: 'var(--inline-bg-emerald)', borderVar: 'var(--inline-bg-emerald-border)' },
  { id: 'amber', bgVar: 'var(--inline-bg-amber)', borderVar: 'var(--inline-bg-amber-border)' },
  { id: 'rose', bgVar: 'var(--inline-bg-rose)', borderVar: 'var(--inline-bg-rose-border)' },
  { id: 'kraft', bgVar: 'var(--inline-bg-kraft)', borderVar: 'var(--inline-bg-kraft-border)' },
];

export const RICH_HL_SWATCHES: ReadonlyArray<{
  id: InlineHighlightColor;
  cssVar: string;
}> = [
  { id: 'amber', cssVar: 'var(--inline-hl-amber)' },
  { id: 'violet', cssVar: 'var(--inline-hl-violet)' },
  { id: 'ice', cssVar: 'var(--inline-hl-ice)' },
  { id: 'emerald', cssVar: 'var(--inline-hl-emerald)' },
  { id: 'rose', cssVar: 'var(--inline-hl-rose)' },
];

export const RICH_FONT_SIZES: readonly TextSizePreset[] = [
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
];

export const QUICK_KBD_KEYS: readonly string[] = [
  'Ctrl',
  '⌘',
  'Shift',
  'Alt',
  '⌥',
  'Enter',
  'Esc',
  'Tab',
  'Space',
  '⌫',
];

