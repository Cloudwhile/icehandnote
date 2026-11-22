/*
 * Decoupled Account Security Tab (`UserProfileModal` Tab: `'security'`):
 * Handles Email Change OTP, WebAuthn Passkeys, OAuth Provider Bindings, and Password Change.
 * Reuses `<OtpInput>`, `useOtpCooldown`, `<PasswordInput>`, and `<StatusBadge>`.
 */

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, getSessionToken } from '../../lib/api';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '../../lib/email';
import { EXT_COPY } from '../../lib/i18n';
import {
  detectPasskeyCapabilities,
  parsePasskeyCreationOptions,
  serializePasskeyCredential,
  signalUnknownPasskey,
  syncAcceptedPasskeys,
} from '../../lib/passkeys';
import {
  getEffectiveOAuthProviders,
  type LocaleCode,
  type SiteSettingsDto,
  type UserPasskeyDto,
  type UserProfileDto,
} from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { FieldErrorText } from '../ui/FormControls';
import { IconCheck, IconKey, IconPen, IconTrash } from '../ui/Icons';
import { PasswordInput } from '../ui/PasswordInput';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/ToastProvider';
import { useOtpCooldown } from './otpCooldown';
import { OtpInput } from './OtpInput';

export function formatAccountTimestamp(iso: string, locale: LocaleCode): string {
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

export interface ProfileSecurityTabProps {
  open: boolean;
  locale: LocaleCode;
  user: UserProfileDto;
  siteSettings: SiteSettingsDto;
  initialOpenEmailChange?: boolean;
  onUserUpdated: (next: UserProfileDto) => void;
  onPasskeyIdentityResolved?: (rpId: string, userId: string) => void;
}

export function ProfileSecurityTab({
  open,
  locale,
  user,
  siteSettings,
  initialOpenEmailChange = false,
  onUserUpdated,
  onPasskeyIdentityResolved,
}: ProfileSecurityTabProps) {
  const p = EXT_COPY[locale].profile;
  const extAuth = EXT_COPY[locale].auth;
  const toast = useToast();
  const pwFormRef = useRef<HTMLFormElement | null>(null);
  const emailFormRef = useRef<HTMLFormElement | null>(null);

  const [changingEmail, setChangingEmail] = useState(initialOpenEmailChange);
  const [newEmailInput, setNewEmailInput] = useState('');
  const [emailCodeSentTo, setEmailCodeSentTo] = useState('');
  const [emailOtpCode, setEmailOtpCode] = useState('');
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  const {
    cooldown: emailCooldownSecs,
    startCooldown: startEmailCooldown,
    applyRateLimitError,
  } = useOtpCooldown('email_change', emailCodeSentTo || newEmailInput);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [unbindingProvider, setUnbindingProvider] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<UserPasskeyDto[]>([]);
  const [passkeyRpId, setPasskeyRpId] = useState('');
  const [passkeyUserId, setPasskeyUserId] = useState('');
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [renamingPasskeyId, setRenamingPasskeyId] = useState<string | null>(null);
  const [renamingPasskeyText, setRenamingPasskeyText] = useState('');
  const [savingPasskeyId, setSavingPasskeyId] = useState<string | null>(null);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);

  useAccessibleFormValidation(pwFormRef, [open]);
  useAccessibleFormValidation(emailFormRef, [open, changingEmail, Boolean(emailCodeSentTo)]);

  useEffect(() => {
    if (initialOpenEmailChange) {
      setChangingEmail(true);
    }
  }, [initialOpenEmailChange]);

  const loadPasskeys = useCallback(async () => {
    if (!siteSettings.enable_passkeys) return;
    setLoadingPasskeys(true);
    try {
      const [caps, res] = await Promise.all([
        detectPasskeyCapabilities(),
        api.listMyPasskeys(),
      ]);
      setPasskeySupported(caps.supported);
      setPasskeys(res.passkeys);
      setPasskeyRpId(res.rp_id);
      setPasskeyUserId(res.user_id);
      onPasskeyIdentityResolved?.(res.rp_id, res.user_id);
      void syncAcceptedPasskeys(
        res.rp_id,
        res.user_id,
        res.passkeys.map((pk) => pk.id),
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setLoadingPasskeys(false);
    }
  }, [onPasskeyIdentityResolved, siteSettings.enable_passkeys, toast]);

  useEffect(() => {
    if (!open || !siteSettings.enable_passkeys) return;
    void loadPasskeys();
  }, [open, siteSettings.enable_passkeys, loadPasskeys]);

  const handleSendEmailChangeCode = async () => {
    const clean = normalizeEmail(newEmailInput);
    if (!clean) {
      emailFormRef.current?.reportValidity();
      toast.error('INVALID_EMAIL');
      return;
    }
    if (sendingEmailCode || emailCooldownSecs > 0) {
      return;
    }
    if (clean.toLowerCase() === (user.email || '').trim().toLowerCase()) {
      toast.warning(p.emailSameAsCurrentErr);
      return;
    }
    setSendingEmailCode(true);
    try {
      const res = await api.sendEmailChangeCode(clean, locale);
      setEmailCodeSentTo(clean);
      setEmailOtpCode('');
      startEmailCooldown(res.cooldown_seconds || 60, clean);
      toast.success(p.emailCodeSentMsg);
    } catch (err) {
      applyRateLimitError(err, clean);
      toast.error(err);
    } finally {
      setSendingEmailCode(false);
    }
  };

  const handleVerifyEmailChange = async (e: FormEvent) => {
    e.preventDefault();
    const targetEmail = normalizeEmail(emailCodeSentTo || newEmailInput);
    const cleanCode = emailOtpCode.trim();
    if (!targetEmail) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (cleanCode.length < 6 || verifyingEmail) return;
    setVerifyingEmail(true);
    try {
      const updated = await api.verifyEmailChange(targetEmail, cleanCode);
      onUserUpdated(updated);
      setChangingEmail(false);
      setNewEmailInput('');
      setEmailCodeSentTo('');
      setEmailOtpCode('');
      startEmailCooldown(0, targetEmail);
      toast.success(p.emailChangedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (savingPw) return;
    if (newPassword !== confirmPassword) {
      toast.warning(extAuth.passwordMismatchMsg);
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

  const handleUnbindOAuth = async (providerId: string, label: string) => {
    if (unbindingProvider) return;
    setUnbindingProvider(providerId);
    try {
      const updated = await api.unbindOAuthProvider(providerId);
      onUserUpdated(updated);
      toast.success(p.oauthUnboundMsg(label));
    } catch (err) {
      toast.error(err);
    } finally {
      setUnbindingProvider(null);
    }
  };

  const handleAddPasskey = async () => {
    if (addingPasskey || !passkeySupported) return;
    setAddingPasskey(true);
    try {
      const optRes = await api.getPasskeyRegisterOptions(false);
      const serverRp = optRes.options.rp as { id?: string } | undefined;
      const effectiveRpId = serverRp?.id || passkeyRpId;
      const publicKey = parsePasskeyCreationOptions(optRes.options);

      let cred: Credential | null = null;
      try {
        cred = await navigator.credentials.create({ publicKey });
      } catch (domErr) {
        const name = domErr instanceof DOMException ? domErr.name : '';
        if (name === 'InvalidStateError') {
          toast.warning(extAuth.passkeyAlreadyExistsMsg);
        } else if (name === 'SecurityError') {
          toast.error(extAuth.passkeySecurityErrorMsg);
        } else if (name !== 'NotAllowedError' && name !== 'AbortError') {
          toast.error(domErr);
        }
        return;
      }
      if (!cred) return;

      const encoded = serializePasskeyCredential(cred as PublicKeyCredential);
      try {
        const created = await api.verifyPasskeyRegister(optRes.ceremony_id, encoded);
        const nextList = [created, ...passkeys.filter((pk) => pk.id !== created.id)];
        setPasskeys(nextList);
        if (effectiveRpId && passkeyUserId) {
          void syncAcceptedPasskeys(
            effectiveRpId,
            passkeyUserId,
            nextList.map((pk) => pk.id),
          );
        }
        toast.success(p.passkeyCreatedMsg);
      } catch (verifyErr) {
        if (effectiveRpId && typeof encoded.id === 'string') {
          void signalUnknownPasskey(effectiveRpId, encoded.id);
        }
        toast.error(verifyErr);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setAddingPasskey(false);
    }
  };

  const handleSavePasskeyRename = async (credId: string) => {
    const clean = renamingPasskeyText.trim();
    if (!clean || savingPasskeyId) return;
    setSavingPasskeyId(credId);
    try {
      const updated = await api.renamePasskey(credId, clean);
      setPasskeys((prev) =>
        prev.map((item) => (item.id === credId ? updated : item)),
      );
      setRenamingPasskeyId(null);
      setRenamingPasskeyText('');
      toast.success(p.passkeyRenamedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingPasskeyId(null);
    }
  };

  const handleDeletePasskey = async (credId: string) => {
    if (deletingPasskeyId) return;
    setDeletingPasskeyId(credId);
    try {
      await api.deletePasskey(credId);
      const nextList = passkeys.filter((item) => item.id !== credId);
      setPasskeys(nextList);
      if (passkeyRpId && passkeyUserId) {
        void syncAcceptedPasskeys(
          passkeyRpId,
          passkeyUserId,
          nextList.map((pk) => pk.id),
        );
      }
      toast.success(p.passkeyDeletedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeletingPasskeyId(null);
    }
  };

  const sessionToken = getSessionToken();
  const returnPath =
    typeof window !== 'undefined' ? window.location.pathname : `/${locale}`;
  const enabledOAuthProviders = getEffectiveOAuthProviders(siteSettings).filter(
    (prov) => prov.enabled && prov.client_id.trim().length > 0,
  );
  const boundProviderSet = new Set(
    (user.oauth_bindings && user.oauth_bindings.length > 0
      ? user.oauth_bindings
      : user.oauth_provider
        ? [user.oauth_provider]
        : []
    )
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
  const oauthDisplayList: Array<{ id: string; label: string; enabled: boolean }> = [
    ...enabledOAuthProviders.map((prov) => ({
      id: prov.id.trim().toLowerCase(),
      label: prov.name.trim() || prov.id || 'OAuth',
      enabled: true,
    })),
  ];
  for (const boundId of boundProviderSet) {
    if (!oauthDisplayList.some((item) => item.id === boundId)) {
      oauthDisplayList.push({
        id: boundId,
        label: boundId,
        enabled: false,
      });
    }
  }

  const isPasswordFormReady =
    newPassword.length >= 8 && confirmPassword.length >= 8;

  return (
    <div
      role="tabpanel"
      aria-labelledby="profile-tab-security"
      className="mt-5 space-y-6"
    >
      {/* 1. Email Address Change with New-Email OTP Verification */}
      <div className="p-4 rounded-xl bg-surface-raised border border-border-subtle space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-semibold text-ink-primary">
              {p.emailSectionTitle}
            </div>
            <div className="text-xs font-mono text-ink-muted truncate">
              {user.email || '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setChangingEmail((v) => !v);
              setEmailCodeSentTo('');
              setEmailOtpCode('');
            }}
            className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer shrink-0 transition-colors"
          >
            {changingEmail ? p.cancelChangeEmailBtn : p.changeEmailBtn}
          </button>
        </div>

        {changingEmail && (
          <form
            ref={emailFormRef}
            method="POST"
            onSubmit={(e) => {
              if (!emailCodeSentTo) {
                e.preventDefault();
                void handleSendEmailChangeCode();
                return;
              }
              void handleVerifyEmailChange(e);
            }}
            className="pt-3 border-t border-dashed border-border-subtle space-y-3.5 ui-panel-enter"
          >
            <div className="auth-field">
              <label htmlFor="sec-new-email" className="ink-field-label">
                {p.newEmailLabel}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="sec-new-email"
                  name="email"
                  type="email"
                  required
                  maxLength={MAX_EMAIL_LENGTH}
                  autoComplete="email"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  data-error="sec-new-email-err"
                  value={newEmailInput}
                  onChange={(e) => {
                    setNewEmailInput(e.target.value);
                    if (
                      emailCodeSentTo &&
                      e.target.value.trim().toLowerCase() !==
                        emailCodeSentTo.toLowerCase()
                    ) {
                      setEmailCodeSentTo('');
                      setEmailOtpCode('');
                    }
                  }}
                  placeholder={p.newEmailPlaceholder}
                  className="flex-1 min-w-44 ink-field-input text-xs font-mono"
                />
                <button
                  type="button"
                  disabled={sendingEmailCode || emailCooldownSecs > 0}
                  onClick={() => void handleSendEmailChangeCode()}
                  className="min-h-9 px-3 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed tabular-nums"
                >
                  {sendingEmailCode
                    ? p.sendingEmailCodeBtn
                    : emailCooldownSecs > 0
                      ? p.resendEmailCodeIn(emailCooldownSecs)
                      : p.sendEmailCodeBtn}
                </button>
              </div>
              <FieldErrorText
                id="sec-new-email-err"
                prefixLabel={extAuth.errorPrefixLabel}
                message={extAuth.errEmailInvalid}
              />
            </div>

            {emailCodeSentTo && (
              <div className="space-y-3 ui-panel-enter">
                <div>
                  <label htmlFor="sec-new-email-otp" className="ink-field-label">
                    {p.emailOtpLabel}
                  </label>
                  <OtpInput
                    id="sec-new-email-otp"
                    value={emailOtpCode}
                    onChange={setEmailOtpCode}
                    disabled={verifyingEmail}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={verifyingEmail || emailOtpCode.trim().length < 6}
                    className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {verifyingEmail
                      ? p.verifyingEmailChangeBtn
                      : p.verifyEmailChangeBtn}
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </div>

      {/* 2. Passkeys Management */}
      {siteSettings.enable_passkeys && (
        <div className="p-4 rounded-xl bg-surface-raised border border-border-subtle space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <div className="text-xs font-semibold text-ink-primary flex items-center gap-1.5">
                <IconKey className="w-3.5 h-3.5 text-ink-secondary" />
                <span>{p.passkeySectionTitle}</span>
              </div>
              <div className="text-xs text-ink-muted">{p.passkeySectionDesc}</div>
            </div>
            {passkeySupported && (
              <button
                type="button"
                disabled={addingPasskey}
                onClick={() => void handleAddPasskey()}
                className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer shrink-0 disabled:opacity-55"
              >
                {addingPasskey ? p.passkeyAddingBtn : p.passkeyAddBtn}
              </button>
            )}
          </div>

          {!passkeySupported ? (
            <div className="text-xs text-ink-muted">{p.passkeyUnsupportedHint}</div>
          ) : loadingPasskeys ? (
            <div className="h-12 rounded-xl bg-surface-sheet/70 animate-pulse" />
          ) : passkeys.length === 0 ? (
            <div className="px-3 py-2.5 rounded-xl bg-surface-sheet/60 border border-dashed border-border-subtle text-xs text-ink-muted">
              {p.passkeyEmptyText}
            </div>
          ) : (
            <ul className="list-none p-0 space-y-2">
              {passkeys.map((pk) => {
                const isRenaming = renamingPasskeyId === pk.id;
                return (
                  <li
                    key={pk.id}
                    className="p-3 rounded-xl bg-surface-sheet border border-border-subtle flex flex-wrap items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            maxLength={80}
                            autoFocus
                            value={renamingPasskeyText}
                            onChange={(e) => setRenamingPasskeyText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleSavePasskeyRename(pk.id);
                              } else if (e.key === 'Escape') {
                                setRenamingPasskeyId(null);
                              }
                            }}
                            className="flex-1 min-w-32 px-2.5 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                          />
                          <button
                            type="button"
                            disabled={
                              savingPasskeyId === pk.id ||
                              !renamingPasskeyText.trim()
                            }
                            onClick={() => void handleSavePasskeyRename(pk.id)}
                            className="min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-50"
                          >
                            {p.passkeyRenameSaveBtn}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingPasskeyId(null)}
                            className="min-h-7 px-2 py-0.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary cursor-pointer"
                          >
                            {p.cancelChangeEmailBtn}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-ink-primary truncate">
                            {pk.name}
                          </span>
                          <StatusBadge tone="neutral">
                            {pk.device_type === 'multiDevice' || pk.backed_up
                              ? p.passkeySyncedBadge
                              : p.passkeyDeviceBoundBadge}
                          </StatusBadge>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
                        <span>
                          {p.passkeyCreatedLabel}:{' '}
                          {formatAccountTimestamp(pk.created_at, locale)}
                        </span>
                        <span>
                          {p.passkeyLastUsedLabel}:{' '}
                          {pk.last_used_at
                            ? formatAccountTimestamp(pk.last_used_at, locale)
                            : p.passkeyNeverUsedText}
                        </span>
                      </div>
                    </div>

                    {!isRenaming && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingPasskeyId(pk.id);
                            setRenamingPasskeyText(pk.name);
                          }}
                          className="min-h-7 px-2 py-1 rounded-lg text-xs text-ink-secondary hover:text-ink-primary bg-surface-raised border border-border-subtle hover:border-border-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <IconPen className="w-3 h-3" />
                          <span>{p.passkeyRenameBtn}</span>
                        </button>
                        <button
                          type="button"
                          disabled={deletingPasskeyId === pk.id}
                          onClick={() => void handleDeletePasskey(pk.id)}
                          className="min-h-7 px-2 py-1 rounded-lg text-xs text-accent-danger hover:bg-surface-raised inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          <IconTrash className="w-3 h-3" />
                          <span>{p.passkeyDeleteBtn}</span>
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 3. Multi-OAuth Bindings */}
      {oauthDisplayList.length > 0 && (
        <div className="p-4 rounded-xl bg-surface-raised border border-border-subtle space-y-2.5">
          <div className="text-xs font-semibold text-ink-primary">
            {p.oauthLinkTitle}
          </div>
          <div className="space-y-2">
            {oauthDisplayList.map((prov) => {
              const isBound = boundProviderSet.has(prov.id);
              const bindUrl = sessionToken
                ? `/api/v1/auth/oauth/authorize?provider=${encodeURIComponent(prov.id)}&bind_token=${encodeURIComponent(sessionToken)}&return_to=${encodeURIComponent(returnPath)}`
                : '';
              return (
                <div
                  key={prov.id}
                  className="px-3 py-2 rounded-xl bg-surface-sheet border border-border-subtle flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-ink-primary truncate">
                      {prov.label}
                    </span>
                    {isBound && (
                      <StatusBadge tone="success" pill>
                        <IconCheck className="w-3 h-3" />
                        <span>{p.oauthLinkedBadge(prov.label)}</span>
                      </StatusBadge>
                    )}
                  </div>

                  {isBound ? (
                    <button
                      type="button"
                      disabled={unbindingProvider === prov.id}
                      onClick={() => void handleUnbindOAuth(prov.id, prov.label)}
                      className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-secondary hover:text-accent-danger bg-surface-raised border border-border-subtle hover:border-accent-danger cursor-pointer disabled:opacity-50 transition-colors"
                    >
                      {unbindingProvider === prov.id
                        ? p.oauthUnbindingBtn
                        : p.oauthUnbindBtn}
                    </button>
                  ) : (
                    prov.enabled &&
                    bindUrl && (
                      <a
                        href={bindUrl}
                        className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary no-underline inline-flex items-center transition-colors"
                      >
                        {p.oauthBindBtn(prov.label)}
                      </a>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Change Password Form (Unified `<PasswordInput>`) */}
      <form
        ref={pwFormRef}
        method="POST"
        onSubmit={(e) => void handleChangePassword(e)}
        className="space-y-4"
      >
        <h3 className="text-sm font-semibold text-ink-primary">
          {p.changePasswordTitle}
        </h3>
        <div className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="sec-cur-pw" className="ink-field-label">
              {p.currentPasswordLabel}
            </label>
            <PasswordInput
              id="sec-cur-pw"
              locale={locale}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="sec-new-pw" className="ink-field-label">
              {p.newPasswordLabel}
            </label>
            <PasswordInput
              id="sec-new-pw"
              locale={locale}
              required
              minLength={8}
              autoComplete="new-password"
              showStrengthMeter
              strengthId="sec-new-pw-strength"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="sec-confirm-pw" className="ink-field-label">
              {p.confirmPasswordLabel}
            </label>
            <PasswordInput
              id="sec-confirm-pw"
              locale={locale}
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={savingPw || !isPasswordFormReady}
            className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingPw ? p.changingPasswordBtn : p.changePasswordBtn}
          </button>
        </div>
      </form>
    </div>
  );
}
