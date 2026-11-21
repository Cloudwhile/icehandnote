/*
 * Standalone Full-Page Identity & Security Shell (`AuthFlowPage`):
 * Composes shared `<SiteBrand>`, `<LocaleSwitcher>`, `<ThemeToggleButton>`, and decoupled flow panels:
 * - `<LoginFlowPanel>`
 * - `<RegisterFlowPanel>`
 * - `<PasswordResetFlowPanel>`
 * - `<OAuthOnboardingPanel>`
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LoginFlowPanel } from '../components/auth/LoginFlowPanel';
import { OAuthOnboardingPanel } from '../components/auth/OAuthOnboardingPanel';
import { PasswordResetFlowPanel } from '../components/auth/PasswordResetFlowPanel';
import { RegisterFlowPanel } from '../components/auth/RegisterFlowPanel';
import { LocaleSwitcher } from '../components/navigation/LocaleSwitcher';
import { SiteBrand } from '../components/navigation/SiteBrand';
import { ThemeToggleButton } from '../components/navigation/ThemeToggleButton';
import { IconArrowLeft, IconShield } from '../components/ui/Icons';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/ToastProvider';
import { EXT_COPY, type LocalePreference, UI_COPY } from '../lib/i18n';
import type { ResolvedTheme } from '../lib/theme';
import {
  getEffectiveOAuthProviders,
  type LocaleCode,
  type SiteSettingsDto,
  type UserProfileDto,
} from '../lib/types';

export type AuthFlowMode = 'login' | 'register' | 'forgot' | 'reset' | 'onboarding';

interface AuthFlowPageProps {
  mode: AuthFlowMode;
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
  settingsResolved: boolean;
  blogSsoEntryUrl: string;
  user: UserProfileDto | null;
  authResolved: boolean;
  onAuthenticated: (user: UserProfileDto) => void;
}

function sanitizeReturnTo(raw: string | null, locale: LocaleCode): string {
  if (!raw) return `/${locale}`;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return `/${locale}`;
  if (
    /^\/[^/]+\/auth(\/|$)/.test(trimmed) ||
    /^\/[^/]+\/(login|register)(\/|$)/.test(trimmed)
  ) {
    return `/${locale}`;
  }
  return trimmed;
}

export function AuthFlowPage({
  mode,
  locale,
  localePref,
  onChangeLocalePref,
  theme,
  onToggleTheme,
  siteSettings,
  settingsReady = true,
  settingsResolved,
  blogSsoEntryUrl,
  user,
  authResolved,
  onAuthenticated,
}: AuthFlowPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const copy = UI_COPY[locale].auth;
  const extAuth = EXT_COPY[locale].auth;

  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get('return_to'), locale),
    [locale, searchParams],
  );
  const returnQuerySuffix = useMemo(() => {
    const raw = searchParams.get('return_to');
    if (!raw || sanitizeReturnTo(raw, locale) === `/${locale}`) return '';
    return `?return_to=${encodeURIComponent(raw)}`;
  }, [locale, searchParams]);

  const resetTokenFromUrl = searchParams.get('reset_token') ?? '';
  const resetEmailFromUrl = searchParams.get('email') ?? '';
  const onboardingTokenFromUrl = searchParams.get('oauth_onboarding') ?? '';

  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const [hasLoginChallenge, setHasLoginChallenge] = useState(false);
  const [regStep, setRegStep] = useState<'details' | 'otp'>('details');
  const [hasVerifiedResetToken, setHasVerifiedResetToken] = useState(
    Boolean(resetTokenFromUrl),
  );
  const [onboardingProviderName, setOnboardingProviderName] = useState('');

  useEffect(() => {
    setHasLoginChallenge(false);
    setRegStep('details');
    setHasVerifiedResetToken(Boolean(resetTokenFromUrl));
  }, [mode, resetTokenFromUrl]);

  // Redirect authenticated users away from plain login/register pages
  useEffect(() => {
    if (!authResolved || !user) return;
    if (mode === 'login' || mode === 'register') {
      navigate(returnTo, { replace: true });
    }
  }, [authResolved, mode, navigate, returnTo, user]);

  const focusHeading = useCallback(() => {
    stepHeadingRef.current?.focus();
  }, []);

  const handleSuccess = useCallback(
    (authenticatedUser: UserProfileDto, message: string) => {
      toast.success(message);
      onAuthenticated(authenticatedUser);
      navigate(returnTo, { replace: true });
    },
    [navigate, onAuthenticated, returnTo, toast],
  );

  const enabledOAuthProviders = getEffectiveOAuthProviders(siteSettings).filter(
    (p) => p.enabled && p.client_id.trim().length > 0,
  );
  const fallbackOAuthLabel =
    enabledOAuthProviders[0]?.name.trim() ||
    siteSettings.oauth_provider_name.trim() ||
    'OAuth';

  const pageHeading =
    mode === 'login'
      ? hasLoginChallenge
        ? extAuth.anomalyTitle
        : copy.title
      : mode === 'register'
        ? copy.registerTitle
        : mode === 'forgot'
          ? extAuth.forgotPasswordTitle
          : mode === 'reset'
            ? hasVerifiedResetToken
              ? extAuth.resetPasswordTitle
              : extAuth.authStepVerifyOtp
            : extAuth.onboardingTitle(onboardingProviderName || fallbackOAuthLabel);

  const pageSubtitle =
    mode === 'login'
      ? hasLoginChallenge
        ? ''
        : extAuth.loginSubtitle
      : mode === 'register'
        ? settingsResolved && siteSettings.allow_registration && regStep === 'details'
          ? extAuth.registerSubtitle
          : ''
        : mode === 'forgot'
          ? extAuth.forgotPasswordDesc
          : mode === 'reset' && !hasVerifiedResetToken
            ? extAuth.resetOtpHint
            : '';

  return (
    <div className="min-h-svh w-full flex flex-col auth-canvas-bg">
      {/* Minimal Distraction-Free Auth Top Bar */}
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <SiteBrand
          locale={locale}
          siteSettings={siteSettings}
          settingsReady={settingsReady}
          surfaceClass="bg-surface-sheet"
        />

        <div className="flex items-center gap-2 shrink-0">
          <LocaleSwitcher
            locale={locale}
            localePref={localePref}
            onChangeLocalePref={onChangeLocalePref}
            siteSettings={siteSettings}
            surfaceClass="bg-surface-sheet"
          />

          <ThemeToggleButton
            locale={locale}
            theme={theme}
            onToggleTheme={onToggleTheme}
            surfaceClass="bg-surface-sheet"
          />

          <Link
            to={`/${locale}`}
            className="hidden sm:inline-flex items-center gap-1 min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold text-ink-muted hover:text-ink-primary hover:bg-surface-raised no-underline transition-colors"
          >
            <IconArrowLeft className="w-3.5 h-3.5" />
            <span>{extAuth.backToHome}</span>
          </Link>
        </div>
      </header>

      {/* Main Centered Stationery Sheet */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-[448px] mx-auto">
          <div className="notebook-sheet-stack">
            <div className="notebook-sheet-card p-6 sm:p-8">
              <div className="mb-6">
                <div className="flex items-center gap-2.5">
                  {mode === 'login' && hasLoginChallenge && (
                    <StatusBadge tone="warn" className="w-7 h-7 justify-center px-0">
                      <IconShield className="w-4 h-4" />
                    </StatusBadge>
                  )}
                  <h1
                    id="auth-page-heading"
                    ref={stepHeadingRef}
                    tabIndex={-1}
                    className="text-xl sm:text-2xl font-semibold text-ink-primary m-0 leading-tight tracking-tight auth-heading-balance focus:outline-none"
                  >
                    {pageHeading}
                  </h1>
                </div>
                {pageSubtitle && (
                  <p className="mt-2 text-xs text-ink-muted m-0 leading-relaxed auth-copy-pretty">
                    {pageSubtitle}
                  </p>
                )}
              </div>

              {mode === 'login' && (
                <LoginFlowPanel
                  locale={locale}
                  siteSettings={siteSettings}
                  settingsResolved={settingsResolved}
                  blogSsoEntryUrl={blogSsoEntryUrl}
                  user={user}
                  returnTo={returnTo}
                  returnQuerySuffix={returnQuerySuffix}
                  onChallengeChange={setHasLoginChallenge}
                  onFocusHeading={focusHeading}
                  onSuccess={handleSuccess}
                />
              )}

              {mode === 'register' && (
                <RegisterFlowPanel
                  locale={locale}
                  siteSettings={siteSettings}
                  settingsResolved={settingsResolved}
                  returnQuerySuffix={returnQuerySuffix}
                  onStepChange={setRegStep}
                  onFocusHeading={focusHeading}
                  onSuccess={handleSuccess}
                />
              )}

              {(mode === 'forgot' || mode === 'reset') && (
                <PasswordResetFlowPanel
                  mode={mode}
                  locale={locale}
                  resetEmailFromUrl={resetEmailFromUrl}
                  resetTokenFromUrl={resetTokenFromUrl}
                  returnQuerySuffix={returnQuerySuffix}
                  onTokenVerifiedChange={setHasVerifiedResetToken}
                  onFocusHeading={focusHeading}
                  onSuccess={handleSuccess}
                />
              )}

              {mode === 'onboarding' && (
                <OAuthOnboardingPanel
                  locale={locale}
                  onboardingToken={onboardingTokenFromUrl}
                  fallbackProviderLabel={fallbackOAuthLabel}
                  onProviderNameResolved={setOnboardingProviderName}
                  onSuccess={handleSuccess}
                />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
