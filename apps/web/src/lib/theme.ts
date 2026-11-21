import { useEffect, useState } from 'react';

export type ResolvedTheme = 'light' | 'dark';

function getSystemScheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getCurrentMetaContent(): string {
  if (typeof document === 'undefined') return 'light dark';
  return document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? 'light dark';
}

export function getResolvedTheme(): ResolvedTheme {
  const meta = getCurrentMetaContent();
  if (meta === 'dark' || meta === 'light') return meta;
  return getSystemScheme();
}

/**
 * Implements the Modern Web Guidance `dark-mode-toggle` two-state smart toggle:
 * - Toggles to the opposite of the currently rendered scheme.
 * - Only clears `localStorage` when `defaultSiteTheme === 'system'` and the target matches OS preference
 *   (or when reverting back to an explicit admin-configured site default), so switching away from a forced
 *   site `default_theme` always persists in `localStorage` across page reloads.
 * - Never retroactively deletes a stored override on `matchMedia` change.
 */
export function useColorScheme(defaultSiteTheme: 'system' | 'dark' | 'light' = 'system') {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => getResolvedTheme());

  // Apply admin-configured site default theme when visitor has no explicit localStorage override
  useEffect(() => {
    try {
      const saved = localStorage.getItem('color-scheme');
      if (saved === 'dark' || saved === 'light') return;
    } catch {
      // ignore storage errors
    }
    const meta = document.querySelector('meta[name="color-scheme"]');
    const content =
      defaultSiteTheme === 'dark' || defaultSiteTheme === 'light'
        ? defaultSiteTheme
        : 'light dark';
    if (meta) meta.setAttribute('content', content);
    setResolved(
      defaultSiteTheme === 'dark' || defaultSiteTheme === 'light'
        ? defaultSiteTheme
        : getSystemScheme(),
    );
  }, [defaultSiteTheme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncFromEnv = () => setResolved(getResolvedTheme());
    const unoverriddenMeta =
      defaultSiteTheme === 'dark' || defaultSiteTheme === 'light'
        ? defaultSiteTheme
        : 'light dark';

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : unoverriddenMeta;
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.setAttribute('content', next);
        syncFromEnv();
      }
    };

    media.addEventListener('change', syncFromEnv);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', syncFromEnv);
      window.removeEventListener('storage', onStorage);
    };
  }, [defaultSiteTheme]);

  const toggleScheme = () => {
    const current = getResolvedTheme();
    const target: ResolvedTheme = current === 'dark' ? 'light' : 'dark';
    const osScheme = getSystemScheme();
    const meta = document.querySelector('meta[name="color-scheme"]');
    const returnsToSystem = defaultSiteTheme === 'system' && target === osScheme;
    const returnsToForcedSiteDefault =
      (defaultSiteTheme === 'dark' || defaultSiteTheme === 'light') &&
      target === defaultSiteTheme;

    try {
      if (returnsToSystem) {
        localStorage.removeItem('color-scheme');
        if (meta) meta.setAttribute('content', 'light dark');
      } else if (returnsToForcedSiteDefault) {
        localStorage.removeItem('color-scheme');
        if (meta) meta.setAttribute('content', defaultSiteTheme);
      } else {
        localStorage.setItem('color-scheme', target);
        if (meta) meta.setAttribute('content', target);
      }
    } catch {
      if (meta) meta.setAttribute('content', target);
    }

    setResolved(target);
  };

  return { resolved, toggleScheme };
}
