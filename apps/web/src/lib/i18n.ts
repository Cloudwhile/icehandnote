import {
  type ExtendedMessages,
  LOCALE_BUNDLES,
  type LocaleBundle,
  type LocaleMeta,
  type UiMessages,
} from './locales';
import type { LocaleCode } from './types';

export type {
  AuthMessages,
  ExtendedMessages,
  LocaleBundle,
  LocaleMeta,
  StudioMessages,
  StudioSettingsMessages,
  UiMessages,
} from './locales';

export type LocalePreference = 'auto' | LocaleCode;

const LOCALE_PREF_KEY = 'icehandnote_locale_pref';
const LEGACY_LOCALE_PREF_KEY = 'stepnote_locale_pref';

const BUNDLE_MAP = new Map<LocaleCode, LocaleBundle>(
  LOCALE_BUNDLES.map((bundle) => [bundle.meta.code, bundle]),
);

const DEFAULT_FALLBACK_BUNDLE: LocaleBundle = LOCALE_BUNDLES[0];

/**
 * Metadata list for all registered locales, derived directly from `src/lib/locales/`.
 */
export const LOCALES: LocaleMeta[] = LOCALE_BUNDLES.map((b) => b.meta);

const ALL_LOCALE_CODES: LocaleCode[] = LOCALES.map((l) => l.code);

/**
 * Primary UI copy dictionary indexed by locale code (rendered from per-region files).
 */
export const UI_COPY: Record<LocaleCode, UiMessages> = Object.fromEntries(
  LOCALE_BUNDLES.map((b) => [b.meta.code, b.ui]),
) as Record<LocaleCode, UiMessages>;

/**
 * Domain-specific extended copy dictionary indexed by locale code (rendered from per-region files).
 */
export const EXT_COPY: Record<LocaleCode, ExtendedMessages> = Object.fromEntries(
  LOCALE_BUNDLES.map((b) => [b.meta.code, b.ext]),
) as Record<LocaleCode, ExtendedMessages>;

export function getLocaleBundle(locale: LocaleCode): LocaleBundle {
  return BUNDLE_MAP.get(locale) ?? DEFAULT_FALLBACK_BUNDLE;
}

/**
 * Filters `LOCALES` strictly to the site's `enabled_locales` list (falling back to all
 * registered locales only if `enabledLocales` is empty).
 */
export function getEnabledLocaleMetas(
  enabledLocales: readonly LocaleCode[],
): LocaleMeta[] {
  const filtered = LOCALES.filter((l) => enabledLocales.includes(l.code));
  return filtered.length > 0 ? filtered : LOCALES;
}

export function isRegisteredLocale(raw?: string): raw is LocaleCode {
  return Boolean(raw && BUNDLE_MAP.has(raw as LocaleCode));
}

export function normalizeLocale(raw?: string): LocaleCode {
  if (isRegisteredLocale(raw)) {
    return raw;
  }
  return DEFAULT_FALLBACK_BUNDLE.meta.code;
}

export function getStoredLocalePreference(): LocalePreference {
  try {
    const raw =
      localStorage.getItem(LOCALE_PREF_KEY) ??
      localStorage.getItem(LEGACY_LOCALE_PREF_KEY);
    if (raw === 'auto') return 'auto';
    if (isRegisteredLocale(raw ?? undefined)) {
      return raw as LocaleCode;
    }
  } catch {
    // ignore storage restriction
  }
  return 'auto';
}

export function setStoredLocalePreference(pref: LocalePreference): void {
  try {
    localStorage.setItem(LOCALE_PREF_KEY, pref);
  } catch {
    // ignore storage restriction
  }
}

function matchBrowserTagToLocale(tag: string): LocaleCode | null {
  const lower = tag.trim().toLowerCase();
  if (!lower) return null;

  // 1. Exact or specific regional alias match first (e.g. zh-tw / zh-hant before generic zh)
  const specificOrder = [...LOCALE_BUNDLES].sort(
    (a, b) =>
      Math.max(...(b.meta.aliases ?? [b.meta.code]).map((s) => s.length)) -
      Math.max(...(a.meta.aliases ?? [a.meta.code]).map((s) => s.length)),
  );
  for (const bundle of specificOrder) {
    const aliases = bundle.meta.aliases ?? [bundle.meta.code.toLowerCase()];
    for (const alias of aliases) {
      if (alias.includes('-') && (lower === alias || lower.startsWith(`${alias}-`))) {
        return bundle.meta.code;
      }
    }
  }
  // Handle zh-HK / zh-MO / zh-Hant variants via region subtag check
  for (const bundle of specificOrder) {
    for (const alias of bundle.meta.aliases ?? []) {
      const sub = alias.split('-')[1];
      if (sub && lower.startsWith(`${alias.split('-')[0]}-`) && lower.includes(sub)) {
        return bundle.meta.code;
      }
    }
  }

  // 2. Primary language prefix match (e.g. zh -> zh-CN, en-US -> en, ja-JP -> ja)
  const primary = lower.split('-')[0];
  for (const bundle of LOCALE_BUNDLES) {
    const aliases = bundle.meta.aliases ?? [bundle.meta.code.toLowerCase()];
    if (aliases.includes(primary)) {
      return bundle.meta.code;
    }
  }
  return null;
}

export function detectSystemLocale(
  enabledLocales: LocaleCode[],
  fallback: LocaleCode = DEFAULT_FALLBACK_BUNDLE.meta.code,
): LocaleCode {
  const allowed =
    enabledLocales.length > 0 ? enabledLocales : ALL_LOCALE_CODES;
  const candidates: string[] = [];
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      candidates.push(...navigator.languages);
    } else if (navigator.language) {
      candidates.push(navigator.language);
    }
  }

  for (const tag of candidates) {
    const matched = matchBrowserTagToLocale(tag);
    if (matched && allowed.includes(matched)) {
      return matched;
    }
  }

  return allowed.includes(fallback) ? fallback : allowed[0];
}

export function resolvePreferredLocale(
  enabledLocales: LocaleCode[],
  fallback: LocaleCode = DEFAULT_FALLBACK_BUNDLE.meta.code,
): LocaleCode {
  const allowed =
    enabledLocales.length > 0 ? enabledLocales : ALL_LOCALE_CODES;
  const pref = getStoredLocalePreference();
  if (pref !== 'auto' && allowed.includes(pref)) {
    return pref;
  }
  return detectSystemLocale(allowed, fallback);
}
