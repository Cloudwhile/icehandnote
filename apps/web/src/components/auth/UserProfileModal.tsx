/*
 * Unified User Profile & Security Modal (`UserProfileModal`):
 * Composes `<ModalDialog>`, `<ModalHeader>`, `<UnderlineTabs>`, `<AvatarSourcePicker>`,
 * `<ProfileSecurityTab>`, and `<ProfileSessionsTab>`.
 */

import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { syncPasskeyUserDetails } from '../../lib/passkeys';
import type {
  AvatarSource,
  LocaleCode,
  SiteSettingsDto,
  UserProfileDto,
} from '../../lib/types';
import { ModalDialog, ModalHeader } from '../ui/ModalDialog';
import { UnderlineTabs } from '../ui/Tabs';
import { useToast } from '../ui/ToastProvider';
import { AvatarSourcePicker } from './AvatarSourcePicker';
import { ProfileSecurityTab } from './ProfileSecurityTab';
import { ProfileSessionsTab } from './ProfileSessionsTab';

interface UserProfileModalProps {
  open: boolean;
  onClose: () => void;
  locale: LocaleCode;
  user: UserProfileDto | null;
  siteSettings: SiteSettingsDto;
  onUserUpdated: (next: UserProfileDto) => void;
  onCurrentSessionRevoked?: () => void;
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
  const p = EXT_COPY[locale].profile;
  const toast = useToast();

  const [tab, setTab] = useState<'profile' | 'security' | 'sessions'>('profile');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarSource, setAvatarSource] = useState<AvatarSource>('default');
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [openEmailChange, setOpenEmailChange] = useState(false);
  const [passkeyIdentity, setPasskeyIdentity] = useState<{
    rpId: string;
    userId: string;
  } | null>(null);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!user) return;
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setTab('profile');
      setOpenEmailChange(false);
    }
    setDisplayName(user.display_name);
    setBio(user.bio ?? '');
    setAvatarSource(user.avatar_source ?? 'default');
    setUploadedAvatarUrl(user.uploaded_avatar_url ?? '');
  }, [open, user]);

  if (!user) return null;

  const handleUploadAvatar = async (file: File) => {
    if (uploading) return;
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
      if (siteSettings.enable_passkeys) {
        if (passkeyIdentity?.rpId && passkeyIdentity?.userId) {
          void syncPasskeyUserDetails(
            passkeyIdentity.rpId,
            passkeyIdentity.userId,
            updated.username,
            updated.display_name,
          );
        } else {
          void api
            .listMyPasskeys()
            .then((pkRes) =>
              syncPasskeyUserDetails(
                pkRes.rp_id,
                pkRes.user_id,
                updated.username,
                updated.display_name,
              ),
            )
            .catch(() => {});
        }
      }
      onUserUpdated(updated);
      toast.success(p.profileSavedMsg);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingProfile(false);
    }
  };

  const isProfileDirty =
    displayName.trim() !== (user.display_name || '').trim() ||
    bio.trim() !== (user.bio || '').trim() ||
    avatarSource !== (user.avatar_source || 'default') ||
    (avatarSource === 'upload' &&
      uploadedAvatarUrl.trim() !== (user.uploaded_avatar_url || '').trim());

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

  const availableAvatarSources: AvatarSource[] = [
    'default',
    'gravatar',
    ...(user.oauth_avatar_url ? (['oauth'] as const) : []),
    'upload',
  ];

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-lg"
    >
      <div className="p-5 sm:p-6">
        <ModalHeader
          titleId={titleId}
          title={p.title}
          closeLabel={copy.close}
          onClose={onClose}
        />

        <UnderlineTabs
          ariaLabel={p.title}
          idPrefix="profile-tab"
          fill
          className="mt-5"
          value={tab}
          onChange={(next) => {
            setTab(next);
            if (next !== 'security') setOpenEmailChange(false);
          }}
          items={[
            { value: 'profile', label: p.tabProfile },
            { value: 'security', label: p.tabSecurity },
            { value: 'sessions', label: p.tabSessions },
          ]}
        />

        {tab === 'profile' ? (
          <div role="tabpanel" aria-labelledby="profile-tab-profile">
            <form
              method="POST"
              onSubmit={(e) => void handleSaveProfile(e)}
              className="mt-5 space-y-5"
            >
              <AvatarSourcePicker
                locale={locale}
                name={displayName || user.username}
                avatarSource={avatarSource}
                onChangeSource={setAvatarSource}
                sources={availableAvatarSources}
                previewUrl={previewUrl}
                uploading={uploading}
                onSelectUploadFile={(file) => void handleUploadAvatar(file)}
              />

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
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-ink-secondary">
                      {p.currentEmailLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenEmailChange(true);
                        setTab('security');
                      }}
                      className="inline-flex items-center min-h-7 -my-1 px-1 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
                    >
                      {p.changeEmailBtn}
                    </button>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-surface-sunken text-ink-secondary border border-border-subtle text-xs font-mono truncate">
                    {user.email || '—'}
                  </div>
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
                  disabled={savingProfile || !isProfileDirty}
                  className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingProfile ? p.savingProfileBtn : p.saveProfileBtn}
                </button>
              </div>
            </form>
          </div>
        ) : tab === 'security' ? (
          <ProfileSecurityTab
            open={open}
            locale={locale}
            user={user}
            siteSettings={siteSettings}
            initialOpenEmailChange={openEmailChange}
            onUserUpdated={onUserUpdated}
            onPasskeyIdentityResolved={(rpId, userId) =>
              setPasskeyIdentity({ rpId, userId })
            }
          />
        ) : (
          <ProfileSessionsTab
            open={open}
            locale={locale}
            onClose={onClose}
            onCurrentSessionRevoked={onCurrentSessionRevoked}
          />
        )}
      </div>
    </ModalDialog>
  );
}
