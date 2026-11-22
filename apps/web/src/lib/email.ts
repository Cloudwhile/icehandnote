/**
 * RFC 5321/5322/1035/5891 email validation and normalization utilities
 * (1:1 parity with Rust `icehandnote_core::auth::validate_and_normalize_email`).
 */

export const MAX_EMAIL_LENGTH = 180;

const ASCII_ATEXT_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]$/;
const ASCII_DOMAIN_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SINKHOLE_TLDS = new Set(['localhost', 'local', 'invalid']);

/**
 * Validates a bare `addr-spec` email address and returns its normalized form
 * (`local` case preserved + DNS `domain` lowercased), or `null` when invalid.
 */
export function normalizeEmail(raw: string): string | null {
  const clean = raw.trim();
  if (!clean || clean.length > MAX_EMAIL_LENGTH) {
    return null;
  }

  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || /\s/.test(clean[i])) {
      return null;
    }
  }

  const atIndex = clean.indexOf('@');
  if (atIndex <= 0 || atIndex !== clean.lastIndexOf('@')) {
    return null;
  }

  const local = clean.slice(0, atIndex);
  const domain = clean.slice(atIndex + 1);

  if (
    local.length === 0 ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  ) {
    return null;
  }

  for (let i = 0; i < local.length; i += 1) {
    const ch = local[i];
    if (ch !== '.' && !ASCII_ATEXT_RE.test(ch)) {
      return null;
    }
  }

  if (
    domain.length < 3 ||
    domain.length > 253 ||
    domain.startsWith('.') ||
    domain.endsWith('.')
  ) {
    return null;
  }

  const domainLower = domain.toLowerCase();
  const labels = domainLower.split('.');
  if (labels.length < 2) {
    return null;
  }

  for (const label of labels) {
    if (!ASCII_DOMAIN_LABEL_RE.test(label)) {
      return null;
    }
    if (
      label.startsWith('xn--') &&
      (label.length < 6 || label.slice(4).startsWith('-'))
    ) {
      return null;
    }
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2 || tld.length > 63 || SINKHOLE_TLDS.has(tld)) {
    return null;
  }

  const isAlphaTld = /^[a-z]{2,63}$/.test(tld);
  const isPunycodeTld =
    tld.startsWith('xn--') &&
    tld.length >= 6 &&
    !tld.slice(4).startsWith('-') &&
    /[a-z]/.test(tld.slice(4));

  if (!isAlphaTld && !isPunycodeTld) {
    return null;
  }

  return `${local}@${domainLower}`;
}

export function isValidEmail(raw: string): boolean {
  return normalizeEmail(raw) !== null;
}
