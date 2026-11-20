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
 * - If the target matches the OS preference, removes the localStorage override and resets `<meta>` to `light dark`.
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

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'light dark';
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
  }, []);

  const toggleScheme = () => {
    const current = getResolvedTheme();
    const target: ResolvedTheme = current === 'dark' ? 'light' : 'dark';
    const osScheme = getSystemScheme();
    const meta = document.querySelector('meta[name="color-scheme"]');

    try {
      if (target === osScheme) {
        localStorage.removeItem('color-scheme');
        if (meta) meta.setAttribute('content', 'light dark');
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
