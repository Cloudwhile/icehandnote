import { useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { PassportAuthModal } from './components/auth/PassportAuthModal';
import { CommandSearchDialog } from './components/navigation/CommandSearchDialog';
import { SiteFooter } from './components/navigation/SiteFooter';
import { TopNavbar } from './components/navigation/TopNavbar';
import { NotebookEmptyState } from './components/notebook/NotebookEmptyState';
import { api } from './lib/api';
import {
  detectSystemLocale,
  getStoredLocalePreference,
  type LocalePreference,
  normalizeLocale,
  resolvePreferredLocale,
  setStoredLocalePreference,
  UI_COPY,
} from './lib/i18n';
import { useColorScheme } from './lib/theme';
import {
  DEFAULT_SITE_SETTINGS,
  type LocaleCode,
  type SiteSettingsDto,
  type UserProfileDto,
} from './lib/types';
import { HomePage } from './pages/HomePage';
import { StepReaderPage } from './pages/StepReaderPage';
import { StudioPage } from './pages/StudioPage';

function NotFoundPage({ locale }: { locale: LocaleCode }) {
  const copy = UI_COPY[locale];
  const navigate = useNavigate();

  return (
    <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-16">
      <div className="notebook-sheet-stack">
        <div className="notebook-sheet-card p-8">
          <NotebookEmptyState
            title={copy.pageNotFoundTitle}
            description={copy.pageNotFoundBody}
            actionLabel={copy.backHomeCta}
            onAction={() => navigate(`/${locale}`)}
          />
        </div>
      </div>
    </main>
  );
}

function LocaleShell() {
  const params = useParams();
  const isKnownLocale =
    params.locale === 'zh-CN' ||
    params.locale === 'en' ||
    params.locale === 'zh-TW' ||
    params.locale === 'ja';
  const locale = normalizeLocale(params.locale);
  const location = useLocation();
  const navigate = useNavigate();

  const [siteSettings, setSiteSettings] = useState<SiteSettingsDto>(
    DEFAULT_SITE_SETTINGS,
  );
  const [localePref, setLocalePref] = useState<LocalePreference>(() =>
    getStoredLocalePreference(),
  );
  const { resolved: theme, toggleScheme } = useColorScheme(
    siteSettings.default_theme,
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [blogSsoEntryUrl, setBlogSsoEntryUrl] = useState('');

  const navigateToLocale = useCallback(
    (nextLocale: LocaleCode, replace = false) => {
      const segments = location.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        segments[0] = nextLocale;
        navigate(`/${segments.join('/')}${location.search}${location.hash}`, {
          replace,
        });
      } else {
        navigate(`/${nextLocale}`, { replace });
      }
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  // Sync `<html lang="...">` and dynamic `<title>` from live site settings
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (siteSettings.site_name) {
      document.title = siteSettings.site_name;
    }
  }, [siteSettings.site_name]);

  // Live sync when OS/browser language changes while user preference is `auto` (Follow System)
  useEffect(() => {
    if (localePref !== 'auto') return;
    const onLanguageChange = () => {
      const sys = detectSystemLocale(
        siteSettings.enabled_locales,
        siteSettings.default_locale,
      );
      if (sys !== locale) {
        navigateToLocale(sys, true);
      }
    };
    window.addEventListener('languagechange', onLanguageChange);
    return () => window.removeEventListener('languagechange', onLanguageChange);
  }, [
    locale,
    localePref,
    navigateToLocale,
    siteSettings.default_locale,
    siteSettings.enabled_locales,
  ]);

  const buildSsoEntryUrl = useCallback((settings: SiteSettingsDto): string => {
    const origin = settings.blog_origin_url.trim().replace(/\/+$/, '');
    if (!origin) return '';
    const param = settings.sso_query_param?.trim() || 'sso_login';
    return `${origin}/?${encodeURIComponent(param)}=1`;
  }, []);

  // Load live Site Settings once on mount
  useEffect(() => {
    let active = true;
    void api
      .getSettings()
      .then((s) => {
        if (!active) return;
        setSiteSettings(s);
        setBlogSsoEntryUrl(buildSsoEntryUrl(s));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [buildSsoEntryUrl]);

  // 1. Restore session once on initial mount
  useEffect(() => {
    const initialParams = new URLSearchParams(window.location.search);
    if (initialParams.get('sso_token')) return;

    let active = true;
    void api
      .authMe()
      .then((me) => {
        if (!active) return;
        setUser(me.user ?? null);
        setBlogSsoEntryUrl(me.blog_sso_entry_url);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAuthResolved(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // 2. Verify incoming `?sso_token=...` from external SSO provider
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const ssoToken = searchParams.get('sso_token');
    if (!ssoToken) return;

    let active = true;
    void api
      .verifySsoToken(ssoToken)
      .then((session) => {
        if (!active) return;
        setUser(session.user);
        searchParams.delete('sso_token');
        const rest = searchParams.toString();
        navigate(`${location.pathname}${rest ? `?${rest}` : ''}`, {
          replace: true,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAuthResolved(true);
      });

    return () => {
      active = false;
    };
  }, [location.pathname, location.search, navigate]);

  // Global `⌘K` / `Ctrl+K` shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleLocalePrefChange = useCallback(
    (nextPref: LocalePreference) => {
      setStoredLocalePreference(nextPref);
      setLocalePref(nextPref);
      const targetLocale =
        nextPref === 'auto'
          ? detectSystemLocale(
              siteSettings.enabled_locales,
              siteSettings.default_locale,
            )
          : nextPref;
      if (targetLocale !== locale) {
        navigateToLocale(targetLocale);
      }
    },
    [
      locale,
      navigateToLocale,
      siteSettings.default_locale,
      siteSettings.enabled_locales,
    ],
  );

  const handleLocaleSwitch = useCallback(
    (nextLocale: LocaleCode) => {
      handleLocalePrefChange(nextLocale);
    },
    [handleLocalePrefChange],
  );

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  const handleSettingsUpdated = (next: SiteSettingsDto) => {
    setSiteSettings(next);
    setBlogSsoEntryUrl(buildSsoEntryUrl(next));
  };

  const isStudioRoute = location.pathname.startsWith(`/${locale}/studio`);
  const canAuthor = Boolean(user && (user.role === 'author' || user.role === 'admin'));
  const useStudioDashboardShell = isStudioRoute && canAuthor;

  return (
    <div className="min-h-svh w-full overflow-x-clip flex flex-col">
      {!useStudioDashboardShell && (
        <TopNavbar
          locale={locale}
          localePref={localePref}
          onChangeLocalePref={handleLocalePrefChange}
          theme={theme}
          onToggleTheme={toggleScheme}
          onOpenSearch={() => setSearchOpen(true)}
          user={user}
          siteSettings={siteSettings}
          onOpenAuth={() => setAuthOpen(true)}
          onLogout={() => void handleLogout()}
        />
      )}

      <div className="flex-1 flex flex-col">
        {!isKnownLocale ? (
          <NotFoundPage locale={locale} />
        ) : (
          <Routes>
            <Route
              index
              element={
                <HomePage
                  locale={locale}
                  siteSettings={siteSettings}
                  onOpenSearch={() => setSearchOpen(true)}
                />
              }
            />
            <Route
              path="tracks/:track/:chapter/:step"
              element={
                <StepReaderPage
                  locale={locale}
                  theme={theme}
                  siteSettings={siteSettings}
                  onChangeLocale={handleLocaleSwitch}
                />
              }
            />
            <Route
              path="studio"
              element={
                <StudioPage
                  locale={locale}
                  localePref={localePref}
                  onChangeLocalePref={handleLocalePrefChange}
                  theme={theme}
                  onToggleTheme={toggleScheme}
                  onOpenSearch={() => setSearchOpen(true)}
                  user={user}
                  authResolved={authResolved}
                  siteSettings={siteSettings}
                  onSettingsUpdated={handleSettingsUpdated}
                  onOpenAuth={() => setAuthOpen(true)}
                  onLogout={() => void handleLogout()}
                />
              }
            />
            <Route path="*" element={<NotFoundPage locale={locale} />} />
          </Routes>
        )}
      </div>

      {!useStudioDashboardShell && (
        <SiteFooter locale={locale} siteSettings={siteSettings} />
      )}

      <CommandSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        locale={locale}
      />

      <PassportAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        locale={locale}
        ssoEnabled={siteSettings.sso_enabled && Boolean(siteSettings.blog_origin_url)}
        blogSsoEntryUrl={blogSsoEntryUrl}
        onAuthenticated={(u) => setUser(u)}
      />
    </div>
  );
}

function RootRedirect({ subpath = '' }: { subpath?: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    fetch('/api/v1/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { default_locale?: string; enabled_locales?: string[] } | null) => {
        if (!active) return;
        const enabled = (s?.enabled_locales ?? ['zh-CN', 'en', 'zh-TW', 'ja']).map(
          normalizeLocale,
        );
        const fallback = normalizeLocale(s?.default_locale);
        const target = resolvePreferredLocale(enabled, fallback);
        navigate(`/${target}${subpath}`, { replace: true });
      })
      .catch(() => {
        if (active) {
          const target = resolvePreferredLocale(
            ['zh-CN', 'en', 'zh-TW', 'ja'],
            'zh-CN',
          );
          navigate(`/${target}${subpath}`, { replace: true });
        }
      });
    return () => {
      active = false;
    };
  }, [navigate, subpath]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/studio" element={<RootRedirect subpath="/studio" />} />
        <Route path="/:locale/*" element={<LocaleShell />} />
      </Routes>
    </BrowserRouter>
  );
}
