import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { api, clearAuthSession, getSessionToken } from '../../lib/api';
import { UI_COPY } from '../../lib/i18n';
import { RC3_COPY } from '../../lib/i18nRc3';
import type {
  AvatarSource,
  LocaleCode,
  SiteSettingsDto,
  UserProfileDto,
  UserSessionDto,
} from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { IconMonitor, IconSmartphone, IconUpload } from '../ui/Icons';
import { ModalDialog } from '../ui/ModalDialog';
import { useToast } from '../ui/ToastProvider';
import { UserAvatar } from '../ui/UserAvatar';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';

interface UserProfileModalProps {
  open: boolean;
  onClose: () => void;
  locale: LocaleCode;
  user: UserProfileDto | null;
  siteSettings: SiteSettingsDto;
  onUserUpdated: (next: UserProfileDto) => void;
  onCurrentSessionRevoked?: () => void;
}

function formatSessionTimestamp(iso: string, locale: LocaleCode): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dt);
  } catch {
    return dt.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function UserProfileModal({
  open,
  onClose,
  locale,
  user,
  siteSettings,
  onUserUpdated,
  onCurrentSessionRevoked,
}: UserProfileModalProps) {
  const titleId = useId();
  const copy = UI_COPY[locale].auth;
  const p = RC3_COPY[locale].profile;
  const authRc3 = RC3_COPY[locale].auth;
  const toast = useToast();

  const [tab, setTab] = useState<'profile' | 'security' | 'sessions'>('profile');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarSource, setAvatarSource] = useState<AvatarSource>('default');
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pwFormRef = useRef<HTMLFormElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabOrder = ['profile', 'security', 'sessions'] as const;

  useAccessibleFormValidation(pwFormRef, [open, tab]);

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if ('focusGroup' in HTMLElement.prototype) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabOrder.length;
    else if (e.key === 'ArrowLeft')
      nextIdx = (idx - 1 + tabOrder.length) % tabOrder.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabOrder.length - 1;
    if (nextIdx >= 0) {
      e.preventDefault();
      setTab(tabOrder[nextIdx]);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  // Active sessions state
  const [sessions, setSessions] = useState<UserSessionDto[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const list = await api.listMySessions();
      setSessions(list);
    } catch (err) {
      toast.error(err);
    } finally {
      setLoadingSessions(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open || !user) return;
    setTab('profile');
    setDisplayName(user.display_name);
    setBio(user.bio ?? '');
    setAvatarSource(user.avatar_source ?? 'default');
    setUploadedAvatarUrl(user.uploaded_avatar_url ?? '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, [open, user]);

  useEffect(() => {
    if (!open || !user || tab !== 'sessions') return;
    void loadSessions();
  }, [open, user, tab, loadSessions]);

  if (!user) return null;

  const handleRevokeSession = async (session: UserSessionDto) => {
    if (revokingId) return;
    setRevokingId(session.id);
    try {
      await api.revokeMySession(session.id);
      if (session.is_current) {
        clearAuthSession();
        toast.info(p.sessionRevokedMsg);
        onClose();
        onCurrentSessionRevoked?.();
        return;
      }
      setSessions((prev) => prev.filter((item) => item.id !== session.id));
      toast.success(p.sessionRevokedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOtherSessions = async () => {
    if (revokingOthers) return;
    setRevokingOthers(true);
    try {
      const res = await api.revokeOtherSessions();
      setSessions((prev) => prev.filter((item) => item.is_current));
      toast.success(p.sessionOthersRevokedMsg(res.revoked_count));
    } catch (err) {
      toast.error(err);
    } finally {
      setRevokingOthers(false);
    }
  };

  const handleUploadAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploading) return;
    setUploading(true);
    try {
      const res = await api.uploadMedia(file);
      setUploadedAvatarUrl(res.url);
      setAvatarSource('upload');
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      const updated = await api.updateMyProfile({
        display_name: displayName.trim() || user.username,
        bio: bio.trim(),
        avatar_source: avatarSource,
        uploaded_avatar_url: uploadedAvatarUrl,
      });
      onUserUpdated(updated);
      toast.success(p.profileSavedMsg);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (savingPw) return;
    if (newPassword !== confirmPassword) {
      toast.warning(authRc3.passwordMismatchMsg);
      return;
    }
    setSavingPw(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(p.passwordChangedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingPw(false);
    }
  };

  const previewUrl =
    avatarSource === 'upload'
      ? uploadedAvatarUrl
      : avatarSource === 'oauth'
        ? user.oauth_avatar_url ?? ''
        : avatarSource === 'gravatar'
          ? user.avatar_source === 'gravatar'
            ? user.avatar_url
            : ''
          : '';

  const sessionToken = getSessionToken();
  const returnPath =
    typeof window !== 'undefined' ? window.location.pathname : `/${locale}`;
  const bindOAuthUrl = sessionToken
    ? `/api/v1/auth/oauth/authorize?bind_token=${encodeURIComponent(sessionToken)}&return_to=${encodeURIComponent(returnPath)}`
    : '';
  const providerLabel = siteSettings.oauth_provider_name.trim() || 'OAuth';

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-lg"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-border-subtle">
          <h2 id={titleId} className="text-lg font-semibold text-ink-primary m-0">
            {p.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink-primary border border-border-subtle hover:border-border-ink cursor-pointer shrink-0 transition-colors"
          >
            {copy.close}
          </button>
        </div>

        <div
          role="tablist"
          aria-label={p.title}
          className="mt-5 mwg-tablist"
          {...({ focusgroup: 'tablist nomemory' } as Record<string, unknown>)}
        >
          {(
            [
              ['profile', p.tabProfile],
              ['security', p.tabSecurity],
              ['sessions', p.tabSessions],
            ] as const
          ).map(([key, label], idx) => {
            const active = tab === key;
            return (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                id={`profile-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className="mwg-tab mwg-tab-fill"
                {...(active ? ({ focusgroupstart: '' } as Record<string, unknown>) : {})}
              >
                {label}
              </button>
            );
          })}
        </div>

        {tab === 'profile' ? (
          <div role="tabpanel" aria-labelledby="profile-tab-profile">
          <form method="POST" onSubmit={(e) => void handleSaveProfile(e)} className="mt-5 space-y-5">
            <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-surface-raised border border-border-subtle">
              <UserAvatar
                name={displayName || user.username}
                avatarUrl={previewUrl}
                sizeClass="w-12 h-12"
                textClass="text-base"
              />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="text-xs font-semibold text-ink-secondary">
                  {p.avatarSourceLabel}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['default', p.avatarDefault] as const,
                      ['gravatar', p.avatarGravatar] as const,
                      ...(user.oauth_avatar_url
                        ? ([['oauth', p.avatarOAuth]] as const)
                        : []),
                      ['upload', p.avatarUpload] as const,
                    ] as readonly (readonly [AvatarSource, string])[]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAvatarSource(key)}
                      className={`min-h-7 px-2.5 py-0.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                        avatarSource === key
                          ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                          : 'bg-surface-sheet border-border-subtle text-ink-muted hover:text-ink-primary'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {avatarSource === 'upload' && (
                  <div className="pt-0.5">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                      onChange={(e) => void handleUploadAvatar(e)}
                      className="sr-only"
                    />
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                      className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
                    >
                      <IconUpload className="w-3.5 h-3.5 text-ink-muted" />
                      <span>{uploading ? p.uploadingAvatarBtn : p.uploadAvatarBtn}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3.5">
              <div>
                <label htmlFor="prof-display-name" className="ink-field-label">
                  {p.displayNameLabel}
                </label>
                <input
                  id="prof-display-name"
                  type="text"
                  required
                  maxLength={64}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="ink-field-input"
                />
              </div>

              <div>
                <label htmlFor="prof-bio" className="ink-field-label">
                  {p.bioLabel}
                </label>
                <textarea
                  id="prof-bio"
                  rows={3}
                  maxLength={300}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={p.bioPlaceholder}
                  className="ink-field-input"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="submit"
                disabled={savingProfile}
                className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
              >
                {savingProfile ? p.savingProfileBtn : p.saveProfileBtn}
              </button>
            </div>
          </form>
          </div>
        ) : tab === 'security' ? (
          <div role="tabpanel" aria-labelledby="profile-tab-security" className="mt-5 space-y-6">
            {siteSettings.oauth_enabled && (
              <div className="p-4 rounded-xl bg-surface-raised border border-border-subtle flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-ink-primary">
                    {p.oauthLinkTitle}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {user.oauth_provider
                      ? p.oauthLinkedBadge(user.oauth_provider)
                      : p.oauthNotLinkedText}
                  </div>
                </div>
                {!user.oauth_provider && bindOAuthUrl && (
                  <a
                    href={bindOAuthUrl}
                    className="min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-primary no-underline inline-flex items-center transition-colors"
                  >
                    {p.oauthBindBtn(providerLabel)}
                  </a>
                )}
              </div>
            )}

            <form
              ref={pwFormRef}
              method="POST"
              onSubmit={(e) => void handleChangePassword(e)}
              className="space-y-4"
            >
              <h3 className="text-sm font-semibold text-ink-primary m-0">
                {p.changePasswordTitle}
              </h3>
              <div className="flex flex-col gap-3.5">
                <div>
                  <label htmlFor="sec-cur-pw" className="ink-field-label">
                    {p.currentPasswordLabel}
                  </label>
                  <input
                    id="sec-cur-pw"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="ink-field-input"
                  />
                </div>
                <div>
                  <label htmlFor="sec-new-pw" className="ink-field-label">
                    {p.newPasswordLabel}
                  </label>
                  <input
                    id="sec-new-pw"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="ink-field-input"
                  />
                  <PasswordStrengthMeter
                    password={newPassword}
                    locale={locale}
                    id="sec-new-pw-strength"
                  />
                </div>
                <div>
                  <label htmlFor="sec-confirm-pw" className="ink-field-label">
                    {p.confirmPasswordLabel}
                  </label>
                  <input
                    id="sec-confirm-pw"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="ink-field-input"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={savingPw}
                  className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                >
                  {savingPw ? p.changingPasswordBtn : p.changePasswordBtn}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div role="tabpanel" aria-labelledby="profile-tab-sessions" className="mt-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-ink-primary m-0">
                  {p.sessionsTitle}
                </h3>
                <p className="text-xs text-ink-muted m-0 leading-relaxed">
                  {p.sessionsDesc}
                </p>
              </div>
              {sessions.some((s) => !s.is_current) && (
                <button
                  type="button"
                  disabled={revokingOthers}
                  onClick={() => void handleRevokeOtherSessions()}
                  className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-accent-danger text-accent-danger cursor-pointer disabled:opacity-60 shrink-0 transition-colors"
                >
                  {p.sessionRevokeOthersBtn}
                </button>
              )}
            </div>

            {loadingSessions ? (
              <div className="space-y-2.5" aria-busy="true">
                <div className="h-18 rounded-xl bg-surface-raised animate-pulse" />
                <div className="h-18 rounded-xl bg-surface-raised animate-pulse" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-5 rounded-xl bg-surface-raised border border-border-subtle text-center text-xs text-ink-muted">
                {p.sessionsEmpty}
              </div>
            ) : (
              <ul className="list-none m-0 p-0 space-y-2.5 max-h-80 overflow-y-auto pr-0.5">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="p-3.5 rounded-xl bg-surface-raised border border-border-subtle flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        aria-hidden="true"
                        className="w-9 h-9 rounded-xl bg-surface-sheet border border-border-subtle flex items-center justify-center text-ink-secondary shrink-0 mt-0.5"
                      >
                        {session.device_kind === 'mobile' ? (
                          <IconSmartphone className="w-4 h-4" />
                        ) : (
                          <IconMonitor className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-ink-primary truncate">
                            {session.device_label}
                          </span>
                          {session.is_current && (
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 border"
                              style={{
                                backgroundColor:
                                  'color-mix(in srgb, var(--accent-success-ink) 14%, transparent)',
                                borderColor:
                                  'color-mix(in srgb, var(--accent-success-ink) 38%, transparent)',
                                color: 'var(--accent-success-ink)',
                              }}
                            >
                              {p.sessionCurrentBadge}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                          <span className="font-mono text-ink-secondary">
                            {p.sessionIpLabel}: {session.ip_address}
                          </span>
                          <span>
                            {p.sessionLastSeenLabel}:{' '}
                            {formatSessionTimestamp(session.last_seen_at, locale)}
                          </span>
                        </div>
                        <div className="text-xs text-ink-muted">
                          {p.sessionCreatedLabel}:{' '}
                          {formatSessionTimestamp(session.created_at, locale)}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={revokingId === session.id}
                      onClick={() => void handleRevokeSession(session)}
                      className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-accent-danger text-ink-secondary hover:text-accent-danger cursor-pointer disabled:opacity-55 shrink-0 transition-colors"
                    >
                      {p.sessionRevokeBtn}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
