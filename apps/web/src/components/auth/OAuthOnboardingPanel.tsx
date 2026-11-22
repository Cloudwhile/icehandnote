/*
 * Decoupled OAuth Onboarding Flow (`AuthFlowPage` Mode: `'onboarding'`).
 * Reuses `<UnderlineTabs>`, `<AvatarSourcePicker>`, `<UsernameField>`, `<RadioCardGroup>`, `<PasswordInput>`, and `<FieldErrorText>`.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '../../lib/email';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type {
  AvatarSource,
  LocaleCode,
  OAuthOnboardingInfoDto,
  UserProfileDto,
} from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { FieldErrorText, RadioCardGroup } from '../ui/FormControls';
import { PasswordInput } from '../ui/PasswordInput';
import { UnderlineTabs } from '../ui/Tabs';
import { useToast } from '../ui/ToastProvider';
import { AvatarSourcePicker } from './AvatarSourcePicker';
import { type UsernameCheckState, UsernameField } from './UsernameField';

export interface OAuthOnboardingPanelProps {
  locale: LocaleCode;
  onboardingToken: string;
  fallbackProviderLabel: string;
  onProviderNameResolved: (name: string) => void;
  onSuccess: (user: UserProfileDto, welcomeMessage: string) => void;
}

export function OAuthOnboardingPanel({
  locale,
  onboardingToken,
  fallbackProviderLabel,
  onProviderNameResolved,
  onSuccess,
}: OAuthOnboardingPanelProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const copy = UI_COPY[locale].auth;
  const extAuth = EXT_COPY[locale].auth;

  const formRef = useRef<HTMLFormElement | null>(null);
  const usernameRef = useRef<HTMLInputElement | null>(null);

  const [info, setInfo] = useState<OAuthOnboardingInfoDto | null>(null);
  const [tab, setTab] = useState<'register' | 'bind'>('register');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameCheckState>('idle');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'reader' | 'author'>('reader');
  const [avatarSource, setAvatarSource] = useState<AvatarSource>('oauth');
  const [uploadedAvatar, setUploadedAvatar] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [bindIdentifier, setBindIdentifier] = useState('');
  const [bindPassword, setBindPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useAccessibleFormValidation(formRef, [tab, Boolean(info)]);

  useEffect(() => {
    if (!onboardingToken) {
      navigate(`/${locale}/auth/login`, { replace: true });
      return;
    }
    let active = true;
    setInfo(null);
    void api
      .getOAuthOnboarding(onboardingToken)
      .then((res) => {
        if (!active) return;
        setInfo(res);
        onProviderNameResolved(res.provider_name);
        setUsername(res.suggested_username);
        setDisplayName(res.display_name);
        setEmail(res.email);
        setRole('reader');
        setAvatarSource(
          res.oauth_avatar_url
            ? 'oauth'
            : res.gravatar_preview_url
              ? 'gravatar'
              : 'default',
        );
        setTab(res.allow_registration ? 'register' : 'bind');
      })
      .catch((err) => {
        if (!active) return;
        toast.error(err);
        navigate(`/${locale}/auth/login`, { replace: true });
      });
    return () => {
      active = false;
    };
  }, [locale, navigate, onboardingToken, onProviderNameResolved, toast]);

  if (!info) {
    return (
      <div className="py-6 flex flex-col gap-3" aria-busy="true">
        <div className="h-14 rounded-xl bg-surface-raised animate-pulse" />
        <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
        <div className="h-10 rounded-xl bg-surface-raised animate-pulse" />
      </div>
    );
  }

  const handleAvatarUpload = async (file: File) => {
    if (uploadingAvatar || !onboardingToken) return;
    setUploadingAvatar(true);
    try {
      const res = await api.uploadMedia(file, onboardingToken);
      setUploadedAvatar(res.url);
      setAvatarSource('upload');
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !onboardingToken) return;
    if (usernameStatus === 'taken') {
      toast.error('USERNAME_TAKEN');
      usernameRef.current?.focus();
      return;
    }
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      toast.error('INVALID_EMAIL');
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.completeOAuthRegistration({
        onboarding_token: onboardingToken,
        username: username.trim(),
        display_name: displayName.trim() || username.trim(),
        email: normalizedEmail,
        role: info.allow_author_registration ? role : 'reader',
        avatar_source: avatarSource,
        uploaded_avatar_url: uploadedAvatar,
      });
      onSuccess(session.user, extAuth.registeredWelcomeMsg(session.user.display_name));
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBindSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !onboardingToken) return;
    setSubmitting(true);
    try {
      const session = await api.bindExistingOAuth({
        onboarding_token: onboardingToken,
        identifier: bindIdentifier.trim(),
        password: bindPassword,
      });
      onSuccess(session.user, extAuth.oauthBoundSuccessMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const avatarPreview =
    avatarSource === 'upload'
      ? uploadedAvatar
      : avatarSource === 'oauth'
        ? info.oauth_avatar_url
        : avatarSource === 'gravatar'
          ? info.gravatar_preview_url
          : '';

  const availableAvatarSources: AvatarSource[] = [
    ...(info.oauth_avatar_url ? (['oauth'] as const) : []),
    ...(info.gravatar_preview_url ? (['gravatar'] as const) : []),
    'default',
    'upload',
  ];

  const tabItems = [
    ...(info.allow_registration
      ? [{ value: 'register' as const, label: extAuth.onboardingRegisterTab, id: 'onb-tab-register' }]
      : []),
    { value: 'bind' as const, label: extAuth.onboardingBindTab, id: 'onb-tab-bind' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <UnderlineTabs
        items={tabItems}
        value={tab}
        onChange={setTab}
        ariaLabel={extAuth.onboardingTitle(info.provider_name || fallbackProviderLabel)}
        fill
      />

      {tab === 'register' && info.allow_registration ? (
        <div role="tabpanel" aria-labelledby="onb-tab-register">
          <form
            ref={formRef}
            method="POST"
            onSubmit={(e) => void handleRegisterSubmit(e)}
            className="flex flex-col gap-4"
          >
            <AvatarSourcePicker
              locale={locale}
              name={displayName || username || 'U'}
              avatarSource={avatarSource}
              onChangeSource={setAvatarSource}
              sources={availableAvatarSources}
              previewUrl={avatarPreview}
              uploading={uploadingAvatar}
              onSelectUploadFile={(file) => void handleAvatarUpload(file)}
              title={extAuth.onboardingAvatarLabel}
              compact
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
              <UsernameField
                id="onb-user"
                locale={locale}
                value={username}
                onChange={setUsername}
                enabled={tab === 'register'}
                inputRef={usernameRef}
                onStatusChange={setUsernameStatus}
              />

              <div className="auth-field">
                <label htmlFor="onb-name" className="ink-field-label">
                  {copy.displayNameLabel}
                </label>
                <input
                  id="onb-name"
                  name="display_name"
                  type="text"
                  maxLength={64}
                  autoComplete="name"
                  enterKeyHint="next"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="onb-email" className="ink-field-label">
                {copy.emailLabel}
              </label>
              <input
                id="onb-email"
                name="email"
                type="email"
                required
                maxLength={MAX_EMAIL_LENGTH}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="done"
                data-error="onb-email-err"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input"
              />
              <FieldErrorText
                id="onb-email-err"
                prefixLabel={extAuth.errorPrefixLabel}
                message={extAuth.errEmailInvalid}
              />
            </div>

            {info.allow_author_registration && (
              <RadioCardGroup
                name="onb_role"
                legend={extAuth.accountRoleLabel}
                value={role}
                onChange={setRole}
                options={[
                  {
                    value: 'reader',
                    title: extAuth.roleReader,
                    hint: extAuth.roleReaderHint,
                  },
                  {
                    value: 'author',
                    title: extAuth.roleAuthor,
                    hint: extAuth.roleAuthorHint,
                  },
                ]}
              />
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
            >
              {submitting ? copy.registerSubmitting : extAuth.onboardingCreateBtn}
            </button>
          </form>
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby="onb-tab-bind">
          <form
            ref={formRef}
            method="POST"
            onSubmit={(e) => void handleBindSubmit(e)}
            className="flex flex-col gap-4"
          >
            <p className="text-xs text-ink-muted leading-relaxed auth-copy-pretty">
              {extAuth.onboardingBindDesc}
            </p>
            <div className="auth-field">
              <label htmlFor="onb-bind-id" className="ink-field-label">
                {copy.identifierLabel}
              </label>
              <input
                id="onb-bind-id"
                name="username"
                type="text"
                required
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                data-error="onb-bind-id-err"
                value={bindIdentifier}
                onChange={(e) => setBindIdentifier(e.target.value)}
                className="auth-input"
              />
              <FieldErrorText
                id="onb-bind-id-err"
                prefixLabel={extAuth.errorPrefixLabel}
                message={extAuth.errIdentifierRequired}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="onb-bind-pw" className="ink-field-label">
                {copy.passwordLabel}
              </label>
              <PasswordInput
                id="onb-bind-pw"
                name="password"
                locale={locale}
                variant="auth"
                required
                autoComplete="current-password"
                enterKeyHint="done"
                dataError="onb-bind-pw-err"
                value={bindPassword}
                onChange={(e) => setBindPassword(e.target.value)}
              />
              <FieldErrorText
                id="onb-bind-pw-err"
                prefixLabel={extAuth.errorPrefixLabel}
                message={extAuth.errPasswordLength}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
            >
              {submitting ? copy.submitting : extAuth.onboardingBindBtn}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
