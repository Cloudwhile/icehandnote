import type { LocaleCode } from './types';

const CONTROL_OR_SPACE_RE = /[\s\u0000-\u001f\u007f]/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Validates that a URL is an absolute `http:` or `https:` URL with no control characters or spaces.
 * Returns the trimmed URL or `''` if invalid.
 */
export function toSafeHttpUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_OR_SPACE_RE.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : '';
  } catch {
    return '';
  }
}

/**
 * Validates that a media/logo URL is either an `http:`/`https:` URL or a single-slash same-origin path
 * (rejecting protocol-relative `//`, `/\`, `javascript:`, `data:`, and `vbscript:`).
 */
export function toSafeMediaUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_OR_SPACE_RE.test(trimmed)) return '';
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return '';
    try {
      const parsed = new URL(trimmed, 'https://icehandnote.local');
      return parsed.origin === 'https://icehandnote.local' ? trimmed : '';
    } catch {
      return '';
    }
  }
  return toSafeHttpUrl(trimmed);
}

/**
 * Validates inline anchor `href` values: allows `http:`, `https:`, in-page `#fragment`,
 * and single-slash same-origin paths (excluding `//` and `/\`).
 */
export function isSafeHref(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_OR_SPACE_RE.test(trimmed)) return false;
  if (trimmed.startsWith('#')) return true;
  return Boolean(toSafeMediaUrl(trimmed));
}

/**
 * Sanitizes internal post-auth `return_to` paths against open redirects (`//`, `/\`, `\`, control chars).
 */
export function sanitizeReturnTo(
  raw: string | null | undefined,
  locale: LocaleCode,
): string {
  const fallback = `/${locale}`;
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (
    !trimmed ||
    CONTROL_CHAR_RE.test(trimmed) ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.includes('\\')
  ) {
    return fallback;
  }
  try {
    const parsed = new URL(trimmed, 'https://icehandnote.local');
    if (parsed.origin !== 'https://icehandnote.local') return fallback;
  } catch {
    return fallback;
  }
  return trimmed;
}
