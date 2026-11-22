import { useEffect, useRef } from 'react';
import {
  enhanceRichHtmlElement,
  type RichLinkVariant,
} from './inlineCodeHighlight';

const ALLOWED_ELEMENTS = [
  'p',
  'b',
  'i',
  'u',
  's',
  'strong',
  'em',
  'code',
  'a',
  'br',
  'del',
  'ins',
  'sub',
  'sup',
  'small',
  'span',
  'mark',
  'kbd',
  'ruby',
  'rt',
  'rp',
  'abbr',
  'img',
];
const ALLOWED_ATTRIBUTES = [
  'href',
  'target',
  'rel',
  'class',
  'src',
  'alt',
  'title',
  'loading',
];

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(raw: string): string {
  if (!raw || !raw.includes('&')) return raw;
  return raw.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (full, dec?: string, hex?: string, named?: string) => {
      if (dec !== undefined) {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : full;
      }
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : full;
      }
      if (named !== undefined) {
        return NAMED_HTML_ENTITIES[named.toLowerCase()] ?? full;
      }
      return full;
    },
  );
}

export function stripHtmlTags(raw: string): string {
  if (!raw) return raw;
  const noTags = raw.includes('<') ? raw.replace(/<[^>]*>/g, ' ') : raw;
  return decodeHtmlEntities(noTags).replace(/\s+/g, ' ').trim();
}

type DomPurifyLike = {
  sanitize: (s: string, cfg: Record<string, unknown>) => string;
};

let cachedDomPurify: DomPurifyLike | undefined;
let domPurifyPromise: Promise<DomPurifyLike> | undefined;

function loadDOMPurify() {
  domPurifyPromise ??= import('dompurify').then((mod) => {
    const resolved = (mod.default ?? mod) as unknown as DomPurifyLike;
    cachedDomPurify = resolved;
    return resolved;
  });
  return domPurifyPromise;
}

/** Pre-loads DOMPurify in browsers lacking native `Element.prototype.setHTML` so synchronous WYSIWYG updates are sanitized cleanly. */
export function ensureSanitizerReady(): void {
  if (typeof Element !== 'undefined' && !('setHTML' in Element.prototype)) {
    void loadDOMPurify();
  }
}

/** Synchronous sanitization helper for contentEditable DOM hydration (`sanitize-untrusted-html`). */
export function setSanitizedHtmlSync(el: HTMLElement, html: string): void {
  if ('setHTML' in Element.prototype) {
    (
      el as HTMLElement & {
        setHTML: (
          input: string,
          opts?: { sanitizer?: { elements?: string[]; attributes?: string[] } },
        ) => void;
      }
    ).setHTML(html, {
      sanitizer: { elements: ALLOWED_ELEMENTS, attributes: ALLOWED_ATTRIBUTES },
    });
    enhanceRichHtmlElement(el);
    return;
  }

  if (cachedDomPurify) {
    el.innerHTML = cachedDomPurify.sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_ELEMENTS, '#text'],
      ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false,
    });
    enhanceRichHtmlElement(el);
    return;
  }

  void safeSetHtml(el, html);
}

/**
 * Safely renders rich HTML fragments using the native Sanitizer API (`Element.prototype.setHTML`)
 * when available, dynamically loading `dompurify` only in browsers lacking native support.
 * Checks `isCancelled` before DOM mutation to prevent async race conditions on rapid updates.
 */
export async function safeSetHtml(
  el: HTMLElement,
  html: string,
  isCancelled?: () => boolean,
  opts?: { linkVariant?: RichLinkVariant },
): Promise<void> {
  if (isCancelled?.()) return;

  if ('setHTML' in Element.prototype) {
    (
      el as HTMLElement & {
        setHTML: (
          input: string,
          opts?: { sanitizer?: { elements?: string[]; attributes?: string[] } },
        ) => void;
      }
    ).setHTML(html, {
      sanitizer: { elements: ALLOWED_ELEMENTS, attributes: ALLOWED_ATTRIBUTES },
    });
    enhanceRichHtmlElement(el, opts);
    return;
  }

  const DOMPurify = await loadDOMPurify();
  if (isCancelled?.()) return;
  el.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_ELEMENTS, '#text'],
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: false,
  });
  enhanceRichHtmlElement(el, opts);
}

interface SafeHtmlProps {
  html: string;
  className?: string;
  as?: 'div' | 'span' | 'p';
  linkVariant?: RichLinkVariant;
}

export function SafeHtml({
  html,
  className,
  as = 'div',
  linkVariant = 'prose',
}: SafeHtmlProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    void safeSetHtml(node, html, () => cancelled, { linkVariant });
    return () => {
      cancelled = true;
    };
  }, [html, linkVariant]);

  const Tag = as;
  return <Tag ref={ref as never} className={className} />;
}
