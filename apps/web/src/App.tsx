import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { CommandSearchDialog } from './components/navigation/CommandSearchDialog';
import { SiteFooter } from './components/navigation/SiteFooter';
import { TopNavbar } from './components/navigation/TopNavbar';
import { NotebookEmptyState } from './components/notebook/NotebookEmptyState';
import { ToastProvider, useToast } from './components/ui/ToastProvider';
import {
  api,
  getCachedSessionUser,
  saveCachedSessionUser,
} from './lib/api';
import { formatOAuthRedirectError } from './lib/apiError';
import {
  detectSystemLocale,
  EXT_COPY,
  getStoredLocalePreference,
  isRegisteredLocale,
  type LocalePreference,
  normalizeLocale,
  resolvePreferredLocale,
  setStoredLocalePreference,
  UI_COPY,
} from './lib/i18n';
import { savePendingOAuthOtpChallenge } from './lib/passkeys';
import { clearUserOfflineNoteOps } from './lib/offlineNoteQueue';
import { stripHtmlTags } from './lib/sanitizer';
import { toSafeHttpUrl } from './lib/urlSafety';
import {
  readCachedRouteTitle,
  readInitialSiteSettings,
  syncFavicon,
  writeCachedRouteTitle,
  writeSiteSettingsCache,
} from './lib/siteSettings';
import { useColorScheme } from './lib/theme';
import type {
  LocaleCode,
  SiteSettingsDto,
  UserProfileDto,
} from './lib/types';
import { HomePage } from './pages/HomePage';
import { StepReaderPage } from './pages/StepReaderPage';

const AuthFlowPage = lazy(() =>
  import('./pages/AuthFlowPage').then((m) => ({ default: m.AuthFlowPage })),
);
const StudioPage = lazy(() =>
  import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })),
);
const UserProfileModal = lazy(() =>
  import('./components/auth/UserProfileModal').then((m) => ({
    default: m.UserProfileModal,
  })),
);
const MyNotesModal = lazy(() =>
  import('./components/notebook/MyNotesModal').then((m) => ({
    default: m.MyNotesModal,
  })),
);
const CollabInviteModal = lazy(() =>
  import('./components/studio/CollabInviteModal').then((m) => ({
    default: m.CollabInviteModal,
  })),
);

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

function buildSsoEntryUrl(settings: SiteSettingsDto): string {
  const safeOrigin = toSafeHttpUrl(settings.blog_origin_url).replace(/\/+$/, '');
  if (!safeOrigin) return '';
  const param = settings.sso_query_param?.trim() || 'sso_login';
  return `${safeOrigin}/?${encodeURIComponent(param)}=1`;
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
  const extAuth = EXT_COPY[locale].auth;

  const [initialBoot] = useState(() => readInitialSiteSettings());
  const [siteSettings, setSiteSettings] = useState<SiteSettingsDto>(
    initialBoot.settings,
  );
  const [settingsResolved, setSettingsResolved] = useState(false);
  const settingsReady = initialBoot.ready || settingsResolved;

  const [localePref, setLocalePref] = useState<LocalePreference>(() =>
    getStoredLocalePreference(),
  );
  const { resolved: theme, toggleScheme } = useColorScheme(
    siteSettings.default_theme,
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesMounted, setNotesMounted] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMounted, setProfileMounted] = useState(false);
  const [activeCollabInvite, setActiveCollabInvite] = useState('');
  const [inviteMounted, setInviteMounted] = useState(false);
  const [lastInviteToken, setLastInviteToken] = useState('');
  const [pendingCollabInvite, setPendingCollabInvite] = useState('');

  useEffect(() => {
    if (profileOpen) setProfileMounted(true);
  }, [profileOpen]);
  useEffect(() => {
    if (notesOpen) setNotesMounted(true);
  }, [notesOpen]);
  useEffect(() => {
    if (activeCollabInvite) {
      setInviteMounted(true);
      setLastInviteToken(activeCollabInvite);
    }
  }, [activeCollabInvite]);
  const [user, setUserState] = useState<UserProfileDto | null>(() =>
    getCachedSessionUser(),
  );
  const [authResolved, setAuthResolved] = useState(false);
  const [blogSsoEntryUrl, setBlogSsoEntryUrl] = useState(() =>
    buildSsoEntryUrl(initialBoot.settings),
  );

  const updateUser = useCallback((next: UserProfileDto | null) => {
    setUserState(next);
    saveCachedSessionUser(next);
  }, []);

  useEffect(() => {
    const onExpired = () => {
      void clearUserOfflineNoteOps();
      updateUser(null);
    };
    window.addEventListener('ihn:session-expired', onExpired);
    return () => window.removeEventListener('ihn:session-expired', onExpired);
  }, [updateUser]);

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

  // Sync `<html lang="...">`, anti-flash `<title>`, and custom favicon
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const isTrackReaderRoute = location.pathname.startsWith(`/${locale}/tracks/`);

  useEffect(() => {
    if (!settingsReady) return;
    if (isTrackReaderRoute) {
      const cachedArticleTitle = readCachedRouteTitle(location.pathname);
      if (cachedArticleTitle) {
        document.title = cachedArticleTitle;
        return;
      }
    }
    const cleanTitle = stripHtmlTags(siteSettings.site_name).trim();
    if (cleanTitle) {
      document.title = cleanTitle;
      if (!isTrackReaderRoute) {
        writeCachedRouteTitle(location.pathname, cleanTitle);
      }
    }
  }, [isTrackReaderRoute, location.pathname, settingsReady, siteSettings.site_name]);

  useEffect(() => {
    syncFavicon(siteSettings.logo_url, settingsReady);
  }, [settingsReady, siteSettings.logo_url]);

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

  // Load live Site Settings once on mount and refresh persistent cache
  useEffect(() => {
    let active = true;
    void api
      .getSettings()
      .then((s) => {
        if (!active) return;
        writeSiteSettingsCache(s);
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
  }, []);

  // Enforce `enabled_locales`: if the current URL locale is disabled in Site Settings, redirect cleanly
  useEffect(() => {
    if (!settingsResolved || !isKnownLocale) return;
    if (
      siteSettings.enabled_locales.length > 0 &&
      !siteSettings.enabled_locales.includes(locale)
    ) {
      if (localePref !== 'auto' && !siteSettings.enabled_locales.includes(localePref)) {
        setStoredLocalePreference('auto');
        setLocalePref('auto');
      }
      const fallbackLoc = resolvePreferredLocale(
        siteSettings.enabled_locales,
        siteSettings.default_locale,
      );
      if (fallbackLoc !== locale) {
        navigateToLocale(fallbackLoc, true);
      }
    }
  }, [
    isKnownLocale,
    locale,
    localePref,
    navigateToLocale,
    settingsResolved,
    siteSettings.default_locale,
    siteSettings.enabled_locales,
  ]);

  // 1. Restore session once on initial mount (unless an SSO/OAuth ticket exchange will establish it)
  useEffect(() => {
    const initialParams = new URLSearchParams(window.location.search);
    if (initialParams.get('sso_token') || initialParams.get('oauth_ticket')) return;

    let active = true;
    void api
      .authMe()
      .then((me) => {
        if (!active) return;
        updateUser(me.authenticated ? (me.user ?? null) : null);
        setBlogSsoEntryUrl(me.blog_sso_entry_url);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAuthResolved(true);
      });

    return () => {
      active = false;
    };
  }, [updateUser]);

  // 2. Verify incoming `?sso_token=...` from external SSO provider
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const ssoToken = searchParams.get('sso_token');
    if (!ssoToken) return;

    let active = true;
    void api
      .verifySsoToken(ssoToken, locale)
      .then((res) => {
        if (!active) return;
        if (res.requires_otp) {
          savePendingOAuthOtpChallenge(res);
          toast.warning(extAuth.anomalyTitle);
          const ret = location.pathname.startsWith(`/${locale}/auth`)
            ? `/${locale}`
            : location.pathname;
          navigate(
            `/${locale}/auth/login?otp_challenge=1&return_to=${encodeURIComponent(ret)}`,
            { replace: true },
          );
          return;
        }
        updateUser(res.user);
        toast.success(extAuth.signedInWelcomeMsg(res.user.display_name));
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
  }, [location.pathname, location.search, locale, extAuth, navigate, stripQueryParams, toast, updateUser]);

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
        .exchangeOAuthTicket(oauthTicket, locale)
        .then((res) => {
          if (!active) return;
          if (res.requires_otp) {
            savePendingOAuthOtpChallenge(res);
            toast.warning(extAuth.anomalyTitle);
            const ret =
              location.pathname.startsWith(`/${locale}/auth`)
                ? `/${locale}`
                : location.pathname;
            navigate(
              `/${locale}/auth/login?otp_challenge=1&return_to=${encodeURIComponent(ret)}`,
              { replace: true },
            );
            return;
          }
          updateUser(res.user);
          toast.success(extAuth.signedInWelcomeMsg(res.user.display_name));
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
          updateUser(me.authenticated ? (me.user ?? null) : null);
          toast.success(extAuth.oauthBoundSuccessMsg);
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
  }, [
    locale,
    location.pathname,
    location.search,
    navigate,
    extAuth,
    stripQueryParams,
    toast,
    updateUser,
  ]);

  const handleCollabInviteAccepted = useCallback(
    (res: {
      track_slug: string;
      chapter_slug: string;
      step_slug: string;
      user?: UserProfileDto | null;
    }) => {
      setActiveCollabInvite('');
      setPendingCollabInvite('');
      if (res.user) {
        updateUser(res.user);
      }
      const query = new URLSearchParams({
        section: 'editor',
        track: res.track_slug,
        chapter: res.chapter_slug,
        step: res.step_slug,
      });
      navigate(`/${locale}/studio?${query.toString()}`, { replace: true });
    },
    [locale, navigate, updateUser],
  );

  // 4. Handle incoming RFC 9700 Fragment (`/{locale}/invite#token=...`) or legacy `?collab_invite=...`
  // Opens a two-step safe confirmation modal (preview -> explicit user accept) and scrubs token from URL immediately.
  useEffect(() => {
    if (!authResolved) return;
    let extractedToken = '';
    const isInvitePath = location.pathname === `/${locale}/invite`;
    if (location.hash) {
      const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
      const fragTok = hashParams.get('token');
      if (fragTok && fragTok.trim()) {
        extractedToken = fragTok.trim();
        window.history.replaceState(
          null,
          '',
          isInvitePath ? `/${locale}` : `${location.pathname}${location.search}`,
        );
      }
    }
    if (!extractedToken) {
      const sp = new URLSearchParams(location.search);
      const queryTok = sp.get('collab_invite');
      if (queryTok && queryTok.trim()) {
        extractedToken = queryTok.trim();
        stripQueryParams(['collab_invite']);
      }
    }
    if (!extractedToken) return;

    setActiveCollabInvite(extractedToken);
    if (isInvitePath) {
      navigate(`/${locale}`, { replace: true });
    }
  }, [
    authResolved,
    locale,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    stripQueryParams,
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
    try {
      await api.logout();
    } finally {
      await clearUserOfflineNoteOps();
      updateUser(null);
      toast.info(extAuth.signedOutMsg);
    }
  };

  const handleSettingsUpdated = (next: SiteSettingsDto) => {
    writeSiteSettingsCache(next);
    setSiteSettings(next);
    setBlogSsoEntryUrl(buildSsoEntryUrl(next));
  };

  const handleAuthenticated = (authenticatedUser: UserProfileDto) => {
    updateUser(authenticatedUser);
    if (pendingCollabInvite) {
      const token = pendingCollabInvite;
      setPendingCollabInvite('');
      setActiveCollabInvite(token);
    }
  };

  const isStudioRoute = location.pathname.startsWith(`/${locale}/studio`);
  const isAuthRoute =
    location.pathname.startsWith(`/${locale}/auth/`) ||
    location.pathname === `/${locale}/auth` ||
    location.pathname === `/${locale}/login` ||
    location.pathname === `/${locale}/register`;
  const canAuthor = Boolean(
    user &&
      (user.role === 'author' ||
        user.role === 'admin' ||
        user.has_collaborations),
  );
  const useStudioDashboardShell = isStudioRoute && canAuthor;
  // Also suppress public chrome while Studio auth is still resolving so refreshing `/studio` never flashes TopNavbar/SiteFooter
  const hideChrome =
    isAuthRoute || useStudioDashboardShell || (isStudioRoute && !authResolved);

  const authFlowCommonProps = {
    locale,
    localePref,
    onChangeLocalePref: handleLocalePrefChange,
    theme,
    onToggleTheme: toggleScheme,
    siteSettings,
    settingsReady,
    settingsResolved,
    blogSsoEntryUrl,
    user,
    authResolved,
    onAuthenticated: handleAuthenticated,
  };

  return (
    <div
      className={
        useStudioDashboardShell
          ? 'min-h-svh w-full overflow-x-clip flex flex-col lg:h-dvh lg:overflow-hidden'
          : 'min-h-svh w-full overflow-x-clip flex flex-col'
      }
    >
      {!hideChrome && (
        <TopNavbar
          locale={locale}
          localePref={localePref}
          onChangeLocalePref={handleLocalePrefChange}
          theme={theme}
          onToggleTheme={toggleScheme}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNotes={() => setNotesOpen(true)}
          user={user}
          siteSettings={siteSettings}
          settingsReady={settingsReady}
          onOpenAuth={() => openAuthPage('login')}
          onOpenProfile={() => setProfileOpen(true)}
          onLogout={() => void handleLogout()}
        />
      )}

      <div className="flex-1 flex flex-col">
        {!isKnownLocale ? (
          <NotFoundPage locale={locale} />
        ) : (
          <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
            <Routes>
              <Route
                index
                element={
                  <HomePage
                    locale={locale}
                    siteSettings={siteSettings}
                    settingsReady={settingsReady}
                    onOpenSearch={() => setSearchOpen(true)}
                  />
                }
              />
              <Route
                path="invite"
                element={
                  <HomePage
                    locale={locale}
                    siteSettings={siteSettings}
                    settingsReady={settingsReady}
                    onOpenSearch={() => setSearchOpen(true)}
                  />
                }
              />
              <Route
                path="series/:track/:step"
                element={
                  <StepReaderPage
                    locale={locale}
                    theme={theme}
                    siteSettings={siteSettings}
                    settingsReady={settingsReady}
                    authScopeKey={user ? `user:${user.id}` : 'anon'}
                    onChangeLocale={handleLocaleSwitch}
                  />
                }
              />
              <Route
                path="tracks/:track/:step"
                element={
                  <StepReaderPage
                    locale={locale}
                    theme={theme}
                    siteSettings={siteSettings}
                    settingsReady={settingsReady}
                    authScopeKey={user ? `user:${user.id}` : 'anon'}
                    onChangeLocale={handleLocaleSwitch}
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
                    settingsReady={settingsReady}
                    authScopeKey={user ? `user:${user.id}` : 'anon'}
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
                    settingsReady={settingsReady}
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
          </Suspense>
        )}
      </div>

      {!hideChrome && (
        <SiteFooter
          locale={locale}
          siteSettings={siteSettings}
          settingsReady={settingsReady}
        />
      )}

      <CommandSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        locale={locale}
      />

      {profileMounted && (
        <Suspense fallback={null}>
          <UserProfileModal
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
            locale={locale}
            user={user}
            siteSettings={siteSettings}
            onUserUpdated={(next) => updateUser(next)}
            onCurrentSessionRevoked={() => updateUser(null)}
          />
        </Suspense>
      )}

      {notesMounted && (
        <Suspense fallback={null}>
          <MyNotesModal
            open={notesOpen}
            onClose={() => setNotesOpen(false)}
            locale={locale}
          />
        </Suspense>
      )}

      {inviteMounted && lastInviteToken && (
        <Suspense fallback={null}>
          <CollabInviteModal
            open={Boolean(activeCollabInvite)}
            token={activeCollabInvite || lastInviteToken}
            locale={locale}
            user={user}
            onClose={() => setActiveCollabInvite('')}
            onRequireSignIn={() => {
              const tok = activeCollabInvite;
              setPendingCollabInvite(tok);
              setActiveCollabInvite('');
              toast.info(extAuth.collabLoginRequiredMsg);
              navigate(`/${locale}/auth/login`, { replace: true });
            }}
            onAccepted={handleCollabInviteAccepted}
          />
        </Suspense>
      )}
    </div>
  );
}

function LocaleShell() {
  const params = useParams();
  const isKnownLocale = isRegisteredLocale(params.locale);
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
    const initial = readInitialSiteSettings();
    if (initial.ready) {
      const target = resolvePreferredLocale(
        initial.settings.enabled_locales,
        initial.settings.default_locale,
      );
      navigate(`/${target}${suffix}`, { replace: true });
      return () => {
        active = false;
      };
    }

    fetch('/api/v1/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SiteSettingsDto | null) => {
        if (!active) return;
        if (s && typeof s.site_name === 'string') {
          writeSiteSettingsCache(s);
        }
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
