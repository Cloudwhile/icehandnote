/*
 * Controlled-Safe WYSIWYG Rich Inline Editor (`RichEditable`):
 * - Displays formatted bold, italic, underline, strikethrough, inline code (`ink-inline-code`),
 *   keyboard keycap combos (`.ink-kbd-combo` + `.ink-kbd`), highlighter strokes (`mark.ink-hl-*`),
 *   text colors (`ink-fg-*`), pill backgrounds (`ink-bg-*`), font sizes (`ink-size-*`), and links
 *   directly on the paper with ZERO raw Markdown tokens shown.
 * - Preserves live DOM & caret across keystrokes and CJK IME composition; automatically converts
 *   just-typed `**...**`, `~~...~~`, and `` `...` `` when closing delimiter is typed.
 * - Preserves active `Selection` across focus transitions into `[data-testid="flow-inline-toolbar"]`
 *   and `[data-testid="editor-context-menu"]` so formatting & right-click never drop selection.
 */

import {
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  type ActiveInlineFormats,
  applyRichInlineCommand,
  editorDomToInlineMarkdown,
  inlineMarkdownToHtml,
  inspectActiveInlineFormats,
  type RichInlineCommand,
} from '../../../lib/richInline';
import {
  enhanceRichHtmlElement,
  highlightInlineCodeHtml,
} from '../../../lib/inlineCodeHighlight';
import {
  ensureSanitizerReady,
  setSanitizedHtmlSync,
} from '../../../lib/sanitizer';
import { isImeComposing } from './BlockFloatingControls';

export interface RichSelectionReport {
  blockId: string;
  el: HTMLElement;
  range: Range;
  rect: { top: number; bottom: number; left: number; width: number };
  formats: ActiveInlineFormats;
}

export interface RichCaretContext {
  el: HTMLElement;
  value: string;
  caretOffset: number;
  textBeforeCaret: string;
  isCollapsed: boolean;
}

export interface RichEditableProps {
  blockId: string;
  value: string;
  onChange: (nextValue: string) => void;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  flowInputRole?: string;
  extraDataAttrs?: Record<string, string | number | undefined>;
  disableAutoMarkdownShortcuts?: boolean;
  onSelectionReport?: (report: RichSelectionReport | null) => void;
  onCaretSnapshot?: (ctx: RichCaretContext) => void;
  onEnterKey?: (e: ReactKeyboardEvent<HTMLDivElement>, ctx: { beforeMd: string; afterMd: string; atEnd: boolean; atStart: boolean }) => boolean;
  onBackspaceAtStart?: (remainingMd: string) => boolean;
  onMoveVertical?: (direction: -1 | 1) => boolean;
  onArrowNavKey?: (e: ReactKeyboardEvent<HTMLDivElement>, ctx: { atStart: boolean; atEnd: boolean }) => boolean;
  onPrefixTransform?: (plainText: string, caretOffset: number) => boolean;
  onFocusField?: () => void;
  onBlurField?: () => void;
}

function getLinearTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u200B/g, '').length;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return 1;
  let sum = 0;
  el.childNodes.forEach((c) => {
    sum += getLinearTextLength(c);
  });
  return sum;
}

function getPlainOffsetInRoot(root: HTMLElement, container: Node, offset: number): number {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  try {
    pre.setEnd(container, offset);
  } catch {
    return getLinearTextLength(root);
  }
  const frag = pre.cloneContents();
  let sum = 0;
  frag.childNodes.forEach((c) => {
    sum += getLinearTextLength(c);
  });
  return sum;
}

function placeCaretAtOffset(root: HTMLElement, targetOffset: number): void {
  const total = getLinearTextLength(root);
  const clamped = Math.max(0, Math.min(targetOffset, total));
  const sel = window.getSelection();
  if (!sel) return;

  if (total === 0) {
    const r = document.createRange();
    r.selectNodeContents(root);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }

  let acc = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let lastText: Text | null = null;
  let node = walker.nextNode();
  while (node) {
    const txt = node as Text;
    if (!txt.parentElement?.closest('[contenteditable="false"]')) {
      lastText = txt;
      const len = (txt.textContent ?? '').length;
      if (acc + len >= clamped) {
        const r = document.createRange();
        r.setStart(txt, Math.max(0, clamped - acc));
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
      acc += len;
    }
    node = walker.nextNode();
  }

  const r = document.createRange();
  if (lastText) {
    r.setStart(lastText, lastText.length);
  } else {
    r.selectNodeContents(root);
    r.collapse(false);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Focuses a `[data-rich-editable="true"]` element and places its caret reliably. */
export function focusRichEditable(
  el: HTMLElement,
  caret: number | 'start' | 'end' = 'start',
): void {
  el.focus({ preventScroll: true });
  if (caret === 'start') {
    placeCaretAtOffset(el, 0);
  } else if (caret === 'end') {
    placeCaretAtOffset(el, getLinearTextLength(el));
  } else {
    placeCaretAtOffset(el, caret);
  }
}

/** Applies an inline formatting command onto a `RichEditable` element, restores selection, and fires `input` to sync state. */
export function executeRichCommandOnElement(
  el: HTMLElement,
  savedRange: Range | null,
  cmd: RichInlineCommand,
): Range | null {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  let workingRange: Range | null = savedRange ? savedRange.cloneRange() : null;
  if (
    (!workingRange || !el.contains(workingRange.commonAncestorContainer)) &&
    sel &&
    sel.rangeCount > 0 &&
    el.contains(sel.getRangeAt(0).commonAncestorContainer)
  ) {
    workingRange = sel.getRangeAt(0).cloneRange();
  }
  if (!workingRange) {
    workingRange = document.createRange();
    workingRange.selectNodeContents(el);
    workingRange.collapse(false);
  }

  const nextRange = applyRichInlineCommand(el, workingRange, cmd);
  if (nextRange && sel) {
    sel.removeAllRanges();
    sel.addRange(nextRange);
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return nextRange ? nextRange.cloneRange() : null;
}

function tryLiveAutoConvertInlineMarkdown(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const textNode = range.startContainer as Text;
  if (!root.contains(textNode) || textNode.parentElement?.closest('code,kbd')) {
    return false;
  }
  const caret = range.startOffset;
  const before = (textNode.textContent ?? '').slice(0, caret);
  const after = (textNode.textContent ?? '').slice(caret);

  const codeMatch = before.match(/(?:^|[\s\u00A0(（【"'‘“])(`([^`\n]+)`)$/);
  const boldMatch = before.match(/(?:^|[\s\u00A0(（【"'‘“])(\*\*([^\s*][^*\n]*?)\*\*)$/);
  const strikeMatch = before.match(/(?:^|[\s\u00A0(（【"'‘“])(~~([^\s~][^~\n]*?)~~)$/);

  let matchedRaw = '';
  let elTag: 'code' | 'strong' | 's' | null = null;
  let innerText = '';

  if (codeMatch) {
    matchedRaw = codeMatch[1];
    innerText = codeMatch[2];
    elTag = 'code';
  } else if (boldMatch) {
    matchedRaw = boldMatch[1];
    innerText = boldMatch[2];
    elTag = 'strong';
  } else if (strikeMatch) {
    matchedRaw = strikeMatch[1];
    innerText = strikeMatch[2];
    elTag = 's';
  }

  if (!elTag || !innerText) return false;

  const prefixText = before.slice(0, before.length - matchedRaw.length);
  const el = document.createElement(elTag);
  if (elTag === 'code') {
    el.className = 'ink-inline-code';
    el.innerHTML = highlightInlineCodeHtml(innerText);
  } else {
    el.textContent = innerText;
  }

  const parent = textNode.parentNode;
  if (!parent) return false;

  const beforeNode = document.createTextNode(prefixText);
  const afterNode = document.createTextNode(after ? after : '\u200B');

  parent.insertBefore(beforeNode, textNode);
  parent.insertBefore(el, textNode);
  parent.insertBefore(afterNode, textNode);
  parent.removeChild(textNode);

  const nextRange = document.createRange();
  nextRange.setStart(afterNode, after ? 0 : 1);
  nextRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(nextRange);
  return true;
}

export function RichEditable({
  blockId,
  value,
  onChange,
  multiline = true,
  placeholder = '',
  ariaLabel,
  className = '',
  flowInputRole = 'primary',
  extraDataAttrs,
  disableAutoMarkdownShortcuts = false,
  onSelectionReport,
  onCaretSnapshot,
  onEnterKey,
  onBackspaceAtStart,
  onMoveVertical,
  onArrowNavKey,
  onPrefixTransform,
  onFocusField,
  onBlurField,
}: RichEditableProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const isComposingRef = useRef(false);
  const lastCompEndRef = useRef<number | null>(null);

  useEffect(() => {
    ensureSanitizerReady();
  }, []);

  // Hydrate clean HTML only on initial mount or when external prop diverges from DOM edits
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (lastEmittedRef.current === value) return;
    lastEmittedRef.current = value;
    setSanitizedHtmlSync(el, inlineMarkdownToHtml(value, multiline));
    const isEmpty = value.trim().length === 0 && !/<(?:kbd|code|mark|span)/i.test(value);
    el.setAttribute('data-empty', isEmpty ? 'true' : 'false');
  }, [value, multiline]);

  const syncSelectionAndCaret = () => {
    const el = elRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    if (range.collapsed) {
      onSelectionReport?.(null);
      if (onCaretSnapshot) {
        const caretOffset = getPlainOffsetInRoot(el, range.startContainer, range.startOffset);
        const rawText = (el.textContent ?? '').replace(/\u200B/g, '');
        onCaretSnapshot({
          el,
          value: lastEmittedRef.current ?? value,
          caretOffset,
          textBeforeCaret: rawText.slice(0, caretOffset),
          isCollapsed: true,
        });
      }
      return;
    }

    const r = range.getBoundingClientRect();
    const fallbackRect = el.getBoundingClientRect();
    const box =
      r.width > 0 || r.height > 0
        ? r
        : {
            top: fallbackRect.top,
            bottom: fallbackRect.bottom,
            left: fallbackRect.left,
            width: 0,
          };
    onSelectionReport?.({
      blockId,
      el,
      range: range.cloneRange(),
      rect: { top: box.top, bottom: box.bottom, left: box.left, width: box.width },
      formats: inspectActiveInlineFormats(el, range),
    });
  };

  const syncSelectionRef = useRef(syncSelectionAndCaret);
  syncSelectionRef.current = syncSelectionAndCaret;

  useEffect(() => {
    const onDocSelectionChange = () => {
      const el = elRef.current;
      if (!el || document.activeElement !== el || isComposingRef.current) return;
      syncSelectionRef.current();
    };
    document.addEventListener('selectionchange', onDocSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onDocSelectionChange);
    };
  }, []);

  const emitDomValue = () => {
    const el = elRef.current;
    if (!el) return;
    const md = editorDomToInlineMarkdown(el, multiline);
    lastEmittedRef.current = md;
    const empty = md.trim().length === 0;
    el.setAttribute('data-empty', empty ? 'true' : 'false');
    onChange(md);
    syncSelectionAndCaret();
  };

  const handleInput = () => {
    const el = elRef.current;
    if (!el) return;
    if (!isComposingRef.current && !disableAutoMarkdownShortcuts) {
      tryLiveAutoConvertInlineMarkdown(el);
    }

    if (!isComposingRef.current && onPrefixTransform && !el.querySelector('strong,em,u,s,code,kbd,mark,span,a')) {
      const plain = (el.textContent ?? '').replace(/\u200B/g, '');
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed && el.contains(sel.getRangeAt(0).startContainer)) {
        const off = getPlainOffsetInRoot(el, sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
        if (onPrefixTransform(plain, off)) {
          return;
        }
      }
    }

    emitDomValue();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = elRef.current;
    if (!el) return;
    if (isImeComposing(e, lastCompEndRef.current)) return;

    // Keyboard shortcuts: Ctrl/Cmd + B / I / U / E
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u' || k === 'e') {
        e.preventDefault();
        const cmd: RichInlineCommand =
          k === 'b'
            ? { type: 'bold' }
            : k === 'i'
              ? { type: 'italic' }
              : k === 'u'
                ? { type: 'underline' }
                : { type: 'inline-code' };
        executeRichCommandOnElement(el, null, cmd);
        return;
      }
    }

    const sel = window.getSelection();
    const hasRange = Boolean(
      sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer),
    );
    const range = hasRange ? sel!.getRangeAt(0) : null;
    const totalLen = getLinearTextLength(el);
    const caretStartOffset = range
      ? getPlainOffsetInRoot(el, range.startContainer, range.startOffset)
      : 0;
    const caretEndOffset = range
      ? getPlainOffsetInRoot(el, range.endContainer, range.endOffset)
      : 0;
    const atStart = Boolean(range && range.collapsed && caretStartOffset === 0);
    const atEnd = Boolean(range && range.collapsed && caretEndOffset >= totalLen);

    if (e.key === 'Enter' && onEnterKey && range) {
      // Shift+Enter inserts a soft <br> when multiline is enabled
      if (e.shiftKey && multiline) {
        e.preventDefault();
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        if (!br.nextSibling) {
          el.appendChild(document.createTextNode('\u200B'));
        }
        const nr = document.createRange();
        nr.setStartAfter(br);
        nr.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(nr);
        emitDomValue();
        return;
      }

      // Compute clean before/after Markdown around the Range before letting parent block split
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(el);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeHolder = document.createElement('div');
      beforeHolder.appendChild(beforeRange.cloneContents());
      const beforeMd = editorDomToInlineMarkdown(beforeHolder, multiline);

      const afterRange = document.createRange();
      afterRange.selectNodeContents(el);
      afterRange.setStart(range.endContainer, range.endOffset);
      const afterHolder = document.createElement('div');
      afterHolder.appendChild(afterRange.cloneContents());
      const afterMd = editorDomToInlineMarkdown(afterHolder, multiline);

      if (onEnterKey(e, { beforeMd, afterMd, atEnd, atStart })) {
        return;
      }
    }

    if (e.key === 'Backspace' && atStart && onBackspaceAtStart) {
      const md = editorDomToInlineMarkdown(el, multiline);
      if (onBackspaceAtStart(md)) {
        e.preventDefault();
        return;
      }
    }

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && onMoveVertical) {
      if (e.key === 'ArrowUp' && (atStart || (!multiline && caretStartOffset <= 12))) {
        if (onMoveVertical(-1)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'ArrowDown' && (atEnd || !multiline)) {
        if (onMoveVertical(1)) {
          e.preventDefault();
          return;
        }
      }
    }

    if (onArrowNavKey) {
      if (onArrowNavKey(e, { atStart, atEnd })) {
        return;
      }
    }

    // Allow ArrowRight at end of inline <code> element to step cleanly outside the code chip
    if (e.key === 'ArrowRight' && range && range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE) {
      const codeAnc = range.startContainer.parentElement?.closest('code');
      if (codeAnc && el.contains(codeAnc)) {
        const afterRange = document.createRange();
        afterRange.selectNodeContents(codeAnc);
        afterRange.setStart(range.startContainer, range.startOffset);
        if (afterRange.toString().length === 0) {
          e.preventDefault();
          let nextNode = codeAnc.nextSibling;
          if (!nextNode || nextNode.nodeType !== Node.TEXT_NODE) {
            nextNode = document.createTextNode('\u200B');
            codeAnc.parentNode?.insertBefore(nextNode, codeAnc.nextSibling);
          }
          const nr = document.createRange();
          nr.setStart(nextNode, nextNode.textContent === '\u200B' ? 1 : 0);
          nr.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(nr);
        }
      }
    }
  };

  const handlePaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    if (items.some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
      // Let VisualBlockEditor handle clipboard image uploads cleanly
      return;
    }

    const plain = e.clipboardData?.getData('text/plain') ?? '';
    if (!plain) return;

    // Multi-line or block-level Markdown pasted into an empty paragraph is handled by VisualBlockEditor
    const curEmpty = !(lastEmittedRef.current ?? value).trim();
    if (
      curEmpty &&
      multiline &&
      (plain.includes('\n') ||
        /^(#{1,4}\s|-\s\[[ xX]\]\s|:::|```|>\s|!\[)/.test(plain.trim()))
    ) {
      return;
    }

    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const sanitizedText = multiline ? plain.replace(/\r\n/g, '\n') : plain.replace(/[\r\n]+/g, ' ');
    const htmlChunk = inlineMarkdownToHtml(sanitizedText, multiline);
    const holder = document.createElement('div');
    setSanitizedHtmlSync(holder, htmlChunk);
    const frag = document.createDocumentFragment();
    let lastInserted: ChildNode | null = null;
    while (holder.firstChild) {
      lastInserted = holder.firstChild;
      frag.appendChild(holder.firstChild);
    }
    range.insertNode(frag);
    if (lastInserted) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(lastInserted);
      nextRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nextRange);
    }
    emitDomValue();
  };

  const handleFocus = () => {
    onFocusField?.();
    requestAnimationFrame(() => syncSelectionAndCaret());
  };

  const handleBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as HTMLElement | null;
    if (
      next?.closest(
        '[data-testid="flow-inline-toolbar"], [data-testid="editor-context-menu"], .ink-menu-popover',
      )
    ) {
      return;
    }
    if (elRef.current) {
      enhanceRichHtmlElement(elRef.current);
    }
    onBlurField?.();
  };

  return (
    <div
      ref={elRef}
      role="textbox"
      aria-multiline={multiline}
      aria-label={ariaLabel || placeholder || undefined}
      contentEditable
      suppressContentEditableWarning
      data-rich-editable="true"
      data-rich-block-id={blockId}
      data-flow-input={flowInputRole}
      data-placeholder={placeholder}
      data-empty={value.trim().length === 0 ? 'true' : 'false'}
      {...(extraDataAttrs ?? {})}
      onInput={handleInput}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        lastCompEndRef.current = e.timeStamp;
        handleInput();
      }}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onKeyUp={syncSelectionAndCaret}
      onMouseUp={syncSelectionAndCaret}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={`rich-editable ${multiline ? '' : 'rich-editable--single-line'} ${className}`.trim()}
    />
  );
}
