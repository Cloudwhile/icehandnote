import { stripHtmlTags } from './sanitizer';
import { DEFAULT_SITE_SETTINGS, type SiteSettingsDto } from './types';
import { toSafeHttpUrl, toSafeMediaUrl } from './urlSafety';

export const SITE_SETTINGS_CACHE_KEY = 'icehandnote_site_settings_cache';
export const ROUTE_TITLE_PREFIX = 'icehandnote_route_title:';

declare global {
  interface Window {
    __ICEHANDNOTE_SITE_SETTINGS__?: Partial<SiteSettingsDto>;
  }
}

function coerceSiteSettings(raw: unknown): SiteSettingsDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SiteSettingsDto>;
  if (typeof candidate.site_name !== 'string') return null;
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...candidate,
    logo_url: toSafeMediaUrl(candidate.logo_url),
    blog_origin_url: toSafeHttpUrl(candidate.blog_origin_url),
    stale_article_days:
      typeof candidate.stale_article_days === 'number' &&
      Number.isFinite(candidate.stale_article_days)
        ? candidate.stale_article_days
        : DEFAULT_SITE_SETTINGS.stale_article_days,
    enabled_locales:
      Array.isArray(candidate.enabled_locales) && candidate.enabled_locales.length > 0
        ? candidate.enabled_locales
        : DEFAULT_SITE_SETTINGS.enabled_locales,
  };
}

export function writeSiteSettingsCache(settings: SiteSettingsDto): void {
  try {
    localStorage.setItem(SITE_SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage quota / privacy mode errors
  }
}

/**
 * Synchronously resolves initial Site Settings before first React paint:
 * 1. Server-injected `window.__ICEHANDNOTE_SITE_SETTINGS__` (zero-flash even on cold first visit)
 * 2. Client `localStorage` snapshot (`ready: true` on every refresh in both Vite dev & production)
 * 3. `DEFAULT_SITE_SETTINGS` with `ready: false` while `/api/v1/settings` resolves on cold dev boot
 */
export function readInitialSiteSettings(): {
  settings: SiteSettingsDto;
  ready: boolean;
} {
  if (typeof window !== 'undefined' && window.__ICEHANDNOTE_SITE_SETTINGS__) {
    const hydrated = coerceSiteSettings(window.__ICEHANDNOTE_SITE_SETTINGS__);
    if (hydrated) {
      writeSiteSettingsCache(hydrated);
      return { settings: hydrated, ready: true };
    }
  }

  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(SITE_SETTINGS_CACHE_KEY)
        : null;
    if (raw) {
      const hydrated = coerceSiteSettings(JSON.parse(raw));
      if (hydrated) {
        return { settings: hydrated, ready: true };
      }
    }
  } catch {
    // ignore invalid cache JSON
  }

  return { settings: DEFAULT_SITE_SETTINGS, ready: false };
}

export function readCachedRouteTitle(pathname: string): string | null {
  try {
    const cached = sessionStorage.getItem(`${ROUTE_TITLE_PREFIX}${pathname}`);
    return cached && cached.trim() ? cached.trim() : null;
  } catch {
    return null;
  }
}

export function writeCachedRouteTitle(pathname: string, title: string): void {
  const clean = title.trim();
  if (!clean) return;
  try {
    sessionStorage.setItem(`${ROUTE_TITLE_PREFIX}${pathname}`, clean);
  } catch {
    // ignore storage errors
  }
}

/**
 * Syncs `<link rel="icon">` without ever losing the original `data-default-href` SVG icon
 * or flashing the default icon before `settingsReady` resolves.
 */
export function syncFavicon(logoUrl: string, settingsReady: boolean): void {
  if (typeof document === 'undefined') return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;

  const existingDefault = link.getAttribute('data-default-href');
  if (!existingDefault && link.href) {
    link.setAttribute('data-default-href', link.href);
  }
  const defaultHref = link.getAttribute('data-default-href') ?? '';
  const nextLogo = toSafeMediaUrl(logoUrl);

  if (nextLogo) {
    if (link.getAttribute('href') !== nextLogo) {
      link.href = nextLogo;
    }
  } else if (settingsReady && defaultHref) {
    if (link.getAttribute('href') !== defaultHref) {
      link.href = defaultHref;
    }
  }
}

export function formatPlainBrandName(
  settings: SiteSettingsDto,
  settingsReady: boolean,
  fallback = '',
): string {
  if (!settingsReady) return '';
  return stripHtmlTags(settings.site_name).trim() || fallback;
}
