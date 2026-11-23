import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import {
  enhanceRichHtmlElement,
  type RichLinkVariant,
} from './inlineCodeHighlight';
import { isSafeHref, toSafeMediaUrl } from './urlSafety';

const SAFE_CLASS_TOKEN_RE = /^(?:ink|hljs|nb)-[a-z0-9-]+$/i;

function enforceSafeRichDom(root: HTMLElement): void {
  root.querySelectorAll('[class]').forEach((node) => {
    const kept = Array.from(node.classList).filter((cls) =>
      SAFE_CLASS_TOKEN_RE.test(cls),
    );
    if (kept.length > 0) {
      node.setAttribute('class', kept.join(' '));
    } else {
      node.removeAttribute('class');
    }
  });

  root.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (!href || !isSafeHref(href)) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('target');
      anchor.removeAttribute('rel');
      return;
    }
    const target = anchor.getAttribute('target')?.trim().toLowerCase();
    if (target === '_blank' || /^https?:\/\//i.test(href.trim())) {
      anchor.setAttribute('rel', 'noopener noreferrer');
    } else if (target) {
      anchor.removeAttribute('target');
    }
  });

  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const safeSrc = toSafeMediaUrl(src);
    if (!safeSrc) {
      img.removeAttribute('src');
    } else if (safeSrc !== src) {
      img.setAttribute('src', safeSrc);
    }
  });
}

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

/**
 * No-op compatibility export: `DOMPurify` is statically bundled so synchronous and
 * asynchronous HTML sanitization never suffer async loader races.
 */
export function ensureSanitizerReady(): void {}

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
    enforceSafeRichDom(el);
    enhanceRichHtmlElement(el);
    return;
  }

  el.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_ELEMENTS, '#text'],
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: false,
  });
  enforceSafeRichDom(el);
  enhanceRichHtmlElement(el);
}

/**
 * Safely renders rich HTML fragments using the native Sanitizer API (`Element.prototype.setHTML`)
 * when available, or synchronous `DOMPurify` in browsers lacking native support.
 * Checks `isCancelled` before DOM mutation.
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
    enforceSafeRichDom(el);
    enhanceRichHtmlElement(el, opts);
    return;
  }

  el.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_ELEMENTS, '#text'],
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: false,
  });
  enforceSafeRichDom(el);
  enhanceRichHtmlElement(el, opts);
}

interface SafeHtmlProps {
  html: string;
  className?: string;
  as?: 'div' | 'span' | 'p';
  linkVariant?: RichLinkVariant;
  onRendered?: (el: HTMLElement) => void;
}

export function SafeHtml({
  html,
  className,
  as = 'div',
  linkVariant = 'prose',
  onRendered,
}: SafeHtmlProps) {
  const ref = useRef<HTMLElement | null>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    void safeSetHtml(node, html, () => cancelled, { linkVariant }).then(() => {
      if (!cancelled && ref.current) {
        onRenderedRef.current?.(ref.current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [html, linkVariant]);

  const Tag = as;
  return <Tag ref={ref as never} className={className} />;
}
