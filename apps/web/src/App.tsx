import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { UserProfileModal } from './components/auth/UserProfileModal';
import { CommandSearchDialog } from './components/navigation/CommandSearchDialog';
import { SiteFooter } from './components/navigation/SiteFooter';
import { TopNavbar } from './components/navigation/TopNavbar';
import { NotebookEmptyState } from './components/notebook/NotebookEmptyState';
import { ToastProvider, useToast } from './components/ui/ToastProvider';
import { api } from './lib/api';
import { formatOAuthRedirectError } from './lib/apiError';
import {
  detectSystemLocale,
  getStoredLocalePreference,
  type LocalePreference,
  normalizeLocale,
  resolvePreferredLocale,
  setStoredLocalePreference,
  UI_COPY,
} from './lib/i18n';
import { RC3_COPY } from './lib/i18nRc3';
import { stripHtmlTags } from './lib/sanitizer';
import { useColorScheme } from './lib/theme';
import {
  DEFAULT_SITE_SETTINGS,
  type LocaleCode,
  type SiteSettingsDto,
  type UserProfileDto,
} from './lib/types';
import { AuthFlowPage } from './pages/AuthFlowPage';
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

function LocaleShellInner({
  locale,
  isKnownLocale,
}: {
  locale: LocaleCode;
  isKnownLocale: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const rc3Auth = RC3_COPY[locale].auth;

  const [siteSettings, setSiteSettings] = useState<SiteSettingsDto>(
    DEFAULT_SITE_SETTINGS,
  );
  const [settingsResolved, setSettingsResolved] = useState(false);
  const [localePref, setLocalePref] = useState<LocalePreference>(() =>
    getStoredLocalePreference(),
  );
  const { resolved: theme, toggleScheme } = useColorScheme(
    siteSettings.default_theme,
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingCollabInvite, setPendingCollabInvite] = useState('');
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [blogSsoEntryUrl, setBlogSsoEntryUrl] = useState('');
  const defaultFaviconHrefRef = useRef<string | null>(null);

  const openAuthPage = useCallback(
    (mode: 'login' | 'register' = 'login') => {
      const current = `${location.pathname}${location.search}`;
      const isAuthPath =
        location.pathname.startsWith(`/${locale}/auth/`) ||
        location.pathname === `/${locale}/login` ||
        location.pathname === `/${locale}/register`;
      const query =
        !isAuthPath && current && current !== `/${locale}`
          ? `?return_to=${encodeURIComponent(current)}`
          : '';
      navigate(`/${locale}/auth/${mode}${query}`);
    },
    [locale, location.pathname, location.search, navigate],
  );

  const stripQueryParams = useCallback(
    (keys: string[]) => {
      const sp = new URLSearchParams(location.search);
      let changed = false;
      for (const k of keys) {
        if (sp.has(k)) {
          sp.delete(k);
          changed = true;
        }
      }
      if (changed) {
        const rest = sp.toString();
        navigate(`${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`, {
          replace: true,
        });
      }
    },
    [location.hash, location.pathname, location.search, navigate],
  );

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

  // Sync `<html lang="...">`, plain-text `<title>`, and optional custom favicon
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const cleanTitle = stripHtmlTags(siteSettings.site_name);
    if (cleanTitle) {
      document.title = cleanTitle;
    }
  }, [siteSettings.site_name]);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    if (defaultFaviconHrefRef.current === null) {
      defaultFaviconHrefRef.current = link.href;
    }
    const nextLogo = siteSettings.logo_url.trim();
    if (nextLogo) {
      link.href = nextLogo;
    } else if (defaultFaviconHrefRef.current) {
      link.href = defaultFaviconHrefRef.current;
    }
  }, [siteSettings.logo_url]);

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
      .catch(() => {})
      .finally(() => {
        if (active) setSettingsResolved(true);
      });
    return () => {
      active = false;
    };
  }, [buildSsoEntryUrl]);

  // 1. Restore session once on initial mount (unless an SSO/OAuth ticket exchange will establish it)
  useEffect(() => {
    const initialParams = new URLSearchParams(window.location.search);
    if (initialParams.get('sso_token') || initialParams.get('oauth_ticket')) return;

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
        toast.success(rc3Auth.signedInWelcomeMsg(session.user.display_name));
        stripQueryParams(['sso_token']);
      })
      .catch((err) => {
        if (!active) return;
        toast.error(err);
        stripQueryParams(['sso_token']);
      })
      .finally(() => {
        if (active) setAuthResolved(true);
      });

    return () => {
      active = false;
    };
  }, [location.search, rc3Auth, stripQueryParams, toast]);

  // 3. Handle OAuth callback query parameters (`oauth_ticket`, `oauth_onboarding`, `oauth_bound`, `oauth_error`)
  //    and password reset link (`reset_token`)
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const oauthTicket = sp.get('oauth_ticket');
    const oauthOnboarding = sp.get('oauth_onboarding');
    const oauthBound = sp.get('oauth_bound');
    const oauthError = sp.get('oauth_error');
    const pwReset = sp.get('reset_token');

    if (oauthError) {
      toast.push('error', formatOAuthRedirectError(oauthError, locale), 6000);
      stripQueryParams(['oauth_error']);
      return;
    }

    if (oauthTicket) {
      let active = true;
      void api
        .exchangeOAuthTicket(oauthTicket)
        .then((session) => {
          if (!active) return;
          setUser(session.user);
          toast.success(rc3Auth.signedInWelcomeMsg(session.user.display_name));
          stripQueryParams(['oauth_ticket']);
        })
        .catch((err) => {
          if (!active) return;
          toast.error(err);
          stripQueryParams(['oauth_ticket']);
        })
        .finally(() => {
          if (active) setAuthResolved(true);
        });
      return () => {
        active = false;
      };
    }

    if (oauthOnboarding && location.pathname !== `/${locale}/auth/onboarding`) {
      navigate(
        `/${locale}/auth/onboarding?oauth_onboarding=${encodeURIComponent(oauthOnboarding)}`,
        { replace: true },
      );
      return;
    }

    if (oauthBound === '1') {
      void api
        .authMe()
        .then((me) => {
          setUser(me.user ?? null);
          toast.success(rc3Auth.oauthBoundSuccessMsg);
        })
        .catch((err) => toast.error(err));
      stripQueryParams(['oauth_bound']);
      return;
    }

    if (pwReset && location.pathname !== `/${locale}/auth/reset-password`) {
      navigate(
        `/${locale}/auth/reset-password?reset_token=${encodeURIComponent(pwReset)}`,
        { replace: true },
      );
    }
  }, [locale, location.pathname, location.search, navigate, rc3Auth, stripQueryParams, toast]);

  const acceptInviteToken = useCallback(
    async (token: string) => {
      try {
        const res = await api.acceptCollaboratorInvite(token);
        if (res.user) {
          setUser(res.user);
        }
        toast.success(rc3Auth.collabAcceptedMsg);
        const query = new URLSearchParams({
          track: res.track_slug,
          chapter: res.chapter_slug,
          step: res.step_slug,
        });
        navigate(`/${locale}/studio?${query.toString()}`, { replace: true });
      } catch (err) {
        toast.error(err);
      }
    },
    [locale, navigate, rc3Auth.collabAcceptedMsg, toast],
  );

  // 4. Handle incoming `?collab_invite=...` once auth resolution completes
  useEffect(() => {
    if (!authResolved) return;
    const sp = new URLSearchParams(location.search);
    const inviteToken = sp.get('collab_invite');
    if (!inviteToken) return;

    stripQueryParams(['collab_invite']);
    if (user) {
      void acceptInviteToken(inviteToken);
    } else {
      setPendingCollabInvite(inviteToken);
      toast.info(rc3Auth.collabLoginRequiredMsg);
      navigate(`/${locale}/auth/login`, { replace: true });
    }
  }, [
    acceptInviteToken,
    authResolved,
    locale,
    location.search,
    navigate,
    rc3Auth.collabLoginRequiredMsg,
    stripQueryParams,
    toast,
    user,
  ]);

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
    toast.info(rc3Auth.signedOutMsg);
  };

  const handleSettingsUpdated = (next: SiteSettingsDto) => {
    setSiteSettings(next);
    setBlogSsoEntryUrl(buildSsoEntryUrl(next));
  };

  const handleAuthenticated = (authenticatedUser: UserProfileDto) => {
    setUser(authenticatedUser);
    if (pendingCollabInvite) {
      const token = pendingCollabInvite;
      setPendingCollabInvite('');
      void acceptInviteToken(token);
    }
  };

  const isStudioRoute = location.pathname.startsWith(`/${locale}/studio`);
  const isAuthRoute =
    location.pathname.startsWith(`/${locale}/auth/`) ||
    location.pathname === `/${locale}/auth` ||
    location.pathname === `/${locale}/login` ||
    location.pathname === `/${locale}/register`;
  const canAuthor = Boolean(user && (user.role === 'author' || user.role === 'admin'));
  const useStudioDashboardShell = isStudioRoute && canAuthor;
  const hideChrome = useStudioDashboardShell || isAuthRoute;

  const authFlowCommonProps = {
    locale,
    localePref,
    onChangeLocalePref: handleLocalePrefChange,
    theme,
    onToggleTheme: toggleScheme,
    siteSettings,
    settingsResolved,
    blogSsoEntryUrl,
    user,
    authResolved,
    onAuthenticated: handleAuthenticated,
  };

  return (
    <div className="min-h-svh w-full overflow-x-clip flex flex-col">
      {!hideChrome && (
        <TopNavbar
          locale={locale}
          localePref={localePref}
          onChangeLocalePref={handleLocalePrefChange}
          theme={theme}
          onToggleTheme={toggleScheme}
          onOpenSearch={() => setSearchOpen(true)}
          user={user}
          siteSettings={siteSettings}
          onOpenAuth={() => openAuthPage('login')}
          onOpenProfile={() => setProfileOpen(true)}
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
                  onOpenAuth={() => openAuthPage('login')}
                  onOpenProfile={() => setProfileOpen(true)}
                  onLogout={() => void handleLogout()}
                />
              }
            />
            <Route path="auth/login" element={<AuthFlowPage mode="login" {...authFlowCommonProps} />} />
            <Route path="login" element={<AuthFlowPage mode="login" {...authFlowCommonProps} />} />
            <Route path="auth/register" element={<AuthFlowPage mode="register" {...authFlowCommonProps} />} />
            <Route path="register" element={<AuthFlowPage mode="register" {...authFlowCommonProps} />} />
            <Route path="auth/forgot-password" element={<AuthFlowPage mode="forgot" {...authFlowCommonProps} />} />
            <Route path="auth/reset-password" element={<AuthFlowPage mode="reset" {...authFlowCommonProps} />} />
            <Route path="auth/onboarding" element={<AuthFlowPage mode="onboarding" {...authFlowCommonProps} />} />
            <Route path="*" element={<NotFoundPage locale={locale} />} />
          </Routes>
        )}
      </div>

      {!hideChrome && (
        <SiteFooter locale={locale} siteSettings={siteSettings} />
      )}

      <CommandSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        locale={locale}
      />

      <UserProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        locale={locale}
        user={user}
        siteSettings={siteSettings}
        onUserUpdated={(next) => setUser(next)}
        onCurrentSessionRevoked={() => setUser(null)}
      />
    </div>
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

  return (
    <ToastProvider locale={locale}>
      <LocaleShellInner locale={locale} isKnownLocale={isKnownLocale} />
    </ToastProvider>
  );
}

function RootRedirect({ subpath = '' }: { subpath?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    let active = true;
    const suffix = `${subpath}${location.search}${location.hash}`;
    fetch('/api/v1/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { default_locale?: string; enabled_locales?: string[] } | null) => {
        if (!active) return;
        const enabled = (s?.enabled_locales ?? ['zh-CN', 'en', 'zh-TW', 'ja']).map(
          normalizeLocale,
        );
        const fallback = normalizeLocale(s?.default_locale);
        const target = resolvePreferredLocale(enabled, fallback);
        navigate(`/${target}${suffix}`, { replace: true });
      })
      .catch(() => {
        if (active) {
          const target = resolvePreferredLocale(
            ['zh-CN', 'en', 'zh-TW', 'ja'],
            'zh-CN',
          );
          navigate(`/${target}${suffix}`, { replace: true });
        }
      });
    return () => {
      active = false;
    };
  }, [location.hash, location.search, navigate, subpath]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/studio" element={<RootRedirect subpath="/studio" />} />
        <Route path="/login" element={<RootRedirect subpath="/auth/login" />} />
        <Route path="/register" element={<RootRedirect subpath="/auth/register" />} />
        <Route path="/auth/login" element={<RootRedirect subpath="/auth/login" />} />
        <Route path="/auth/register" element={<RootRedirect subpath="/auth/register" />} />
        <Route path="/auth/forgot-password" element={<RootRedirect subpath="/auth/forgot-password" />} />
        <Route path="/auth/reset-password" element={<RootRedirect subpath="/auth/reset-password" />} />
        <Route path="/auth/onboarding" element={<RootRedirect subpath="/auth/onboarding" />} />
        <Route path="/:locale/*" element={<LocaleShell />} />
      </Routes>
    </BrowserRouter>
  );
}
