import { useEffect, useRef } from 'react';

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

export function stripHtmlTags(raw: string): string {
  if (!raw || !raw.includes('<')) return raw;
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

let domPurifyPromise:
  | Promise<{ sanitize: (s: string, cfg: Record<string, unknown>) => string }>
  | undefined;

function loadDOMPurify() {
  domPurifyPromise ??= import('dompurify').then(
    (mod) => (mod.default ?? mod) as never,
  );
  return domPurifyPromise;
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
}

interface SafeHtmlProps {
  html: string;
  className?: string;
  as?: 'div' | 'span' | 'p';
}

export function SafeHtml({ html, className, as = 'div' }: SafeHtmlProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    void safeSetHtml(node, html, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [html]);

  const Tag = as;
  return <Tag ref={ref as never} className={className} />;
}
