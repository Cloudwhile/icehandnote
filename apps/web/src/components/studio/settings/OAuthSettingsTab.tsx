/*
 * Decoupled Multi-OAuth 2.0 / OIDC Settings Tab (`StudioSettingsPanel` Tab: `'oauth'`).
 * Reuses `<SettingsSectionCard>`, `<StatusBadge>`, `<SwitchRow>`, `<ModalDialog>`, `<RadioPillGroup>`, and `<PasswordInput>`.
 */

import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import {
  getEffectiveOAuthProviders,
  type LocaleCode,
  type OAuthProviderDto,
  type SiteSettingsDto,
} from '../../../lib/types';
import { RadioPillGroup, SwitchRow } from '../../ui/FormControls';
import { IconCheck, IconCopy, IconPen, IconPlus, IconTrash } from '../../ui/Icons';
import { ModalDialog, ModalHeader } from '../../ui/ModalDialog';
import { PasswordInput } from '../../ui/PasswordInput';
import { StatusBadge } from '../../ui/StatusBadge';
import { useToast } from '../../ui/ToastProvider';
import { SettingsSectionCard } from './SettingsSectionCard';

export type OAuthPresetKind = 'github' | 'google' | 'authentik' | 'custom';

export function normalizeProviderSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function withNormalizedProviders(settings: SiteSettingsDto): SiteSettingsDto {
  const providers = getEffectiveOAuthProviders(settings);
  const primary = providers.find((p) => p.enabled) ?? providers[0];
  return {
    ...settings,
    oauth_providers: providers,
    oauth_enabled: providers.some((p) => p.enabled),
    oauth_provider_name: primary?.name ?? '',
    oauth_client_id: primary?.client_id ?? '',
    oauth_authorize_url: primary?.authorize_url ?? '',
    oauth_token_url: primary?.token_url ?? '',
    oauth_userinfo_url: primary?.userinfo_url ?? '',
    oauth_scopes: primary?.scopes || 'openid profile email',
  };
}

function isValidHttpEndpoint(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

function isOAuthProviderComplete(p: OAuthProviderDto): boolean {
  return (
    p.name.trim().length > 0 &&
    normalizeProviderSlug(p.id).length >= 1 &&
    p.client_id.trim().length > 0 &&
    isValidHttpEndpoint(p.authorize_url) &&
    isValidHttpEndpoint(p.token_url) &&
    isValidHttpEndpoint(p.userinfo_url)
  );
}

function extractEndpointHost(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '—';
  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').split('/')[0] || trimmed;
  }
}

function createOAuthPreset(
  kind: OAuthPresetKind,
  existingIds: Set<string>,
): OAuthProviderDto {
  const presets: Record<
    OAuthPresetKind,
    Omit<OAuthProviderDto, 'id'> & { baseId: string }
  > = {
    github: {
      baseId: 'github',
      enabled: true,
      name: 'GitHub',
      client_id: '',
      authorize_url: 'https://github.com/login/oauth/authorize',
      token_url: 'https://github.com/login/oauth/access_token',
      userinfo_url: 'https://api.github.com/user',
      scopes: 'read:user user:email',
    },
    google: {
      baseId: 'google',
      enabled: true,
      name: 'Google',
      client_id: '',
      authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_url: 'https://oauth2.googleapis.com/token',
      userinfo_url: 'https://openidconnect.googleapis.com/v1/userinfo',
      scopes: 'openid profile email',
    },
    authentik: {
      baseId: 'authentik',
      enabled: true,
      name: 'Authentik',
      client_id: '',
      authorize_url: 'https://auth.example.com/application/o/authorize/',
      token_url: 'https://auth.example.com/application/o/token/',
      userinfo_url: 'https://auth.example.com/application/o/userinfo/',
      scopes: 'openid profile email',
    },
    custom: {
      baseId: 'custom-oidc',
      enabled: true,
      name: '',
      client_id: '',
      authorize_url: '',
      token_url: '',
      userinfo_url: '',
      scopes: 'openid profile email',
    },
  };

  const p = presets[kind];
  let id = p.baseId;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${p.baseId}-${n}`;
    n += 1;
  }
  return {
    id,
    enabled: p.enabled,
    name: p.name,
    client_id: p.client_id,
    authorize_url: p.authorize_url,
    token_url: p.token_url,
    userinfo_url: p.userinfo_url,
    scopes: p.scopes,
  };
}

export interface OAuthSettingsTabProps {
  locale: LocaleCode;
  draft: SiteSettingsDto;
  openAddTrigger: number;
  onDraftAndSettingsSaved: (saved: SiteSettingsDto) => void;
}

export function OAuthSettingsTab({
  locale,
  draft,
  openAddTrigger,
  onDraftAndSettingsSaved,
}: OAuthSettingsTabProps) {
  const st = UI_COPY[locale].studio.settings;
  const extSettings = EXT_COPY[locale].settings;
  const toast = useToast();

  const [hasLegacyOAuthSecret, setHasLegacyOAuthSecret] = useState(false);
  const [providerSecretStatus, setProviderSecretStatus] = useState<
    Record<string, boolean>
  >({});
  const [savingSecret, setSavingSecret] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [modalPreset, setModalPreset] = useState<OAuthPresetKind>('github');
  const [modalDraft, setModalDraft] = useState<OAuthProviderDto>(() =>
    createOAuthPreset('github', new Set()),
  );
  const [modalSecret, setModalSecret] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [savingModal, setSavingModal] = useState(false);

  const providers = draft.oauth_providers ?? [];

  useEffect(() => {
    let active = true;
    void api
      .adminGetOAuthSecretStatus()
      .then((res) => {
        if (!active) return;
        setHasLegacyOAuthSecret(res.has_client_secret);
        setProviderSecretStatus(res.provider_secrets ?? {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const openAddModal = () => {
    const existingIds = new Set(
      providers.map((p) => normalizeProviderSlug(p.id)).filter(Boolean),
    );
    const preferredOrder: OAuthPresetKind[] = [
      'github',
      'google',
      'authentik',
      'custom',
    ];
    const defaultKind =
      preferredOrder.find((k) => {
        const base = k === 'custom' ? 'custom-oidc' : k;
        return !existingIds.has(base);
      }) ?? 'custom';
    setEditingIndex(null);
    setModalPreset(defaultKind);
    setModalDraft(createOAuthPreset(defaultKind, existingIds));
    setModalSecret('');
    setIdManuallyEdited(false);
    setModalOpen(true);
  };

  useEffect(() => {
    if (openAddTrigger > 0) {
      openAddModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAddTrigger]);

  const hasSavedSecretForProvider = (providerId: string): boolean => {
    const key = normalizeProviderSlug(providerId);
    if (key && providerSecretStatus[key]) return true;
    if (providers.length === 1 && hasLegacyOAuthSecret) return true;
    return false;
  };

  const handleSelectModalPreset = (kind: OAuthPresetKind) => {
    const existingIds = new Set(
      providers
        .filter((_, idx) => idx !== editingIndex)
        .map((p) => normalizeProviderSlug(p.id))
        .filter(Boolean),
    );
    const preset = createOAuthPreset(kind, existingIds);
    setModalPreset(kind);
    setIdManuallyEdited(false);
    setModalDraft((prev) => ({
      ...preset,
      client_id: prev.client_id,
      enabled: prev.enabled,
    }));
  };

  const openEditModal = (idx: number) => {
    const target = providers[idx];
    if (!target) return;
    setEditingIndex(idx);
    setModalDraft({ ...target });
    setModalSecret('');
    setIdManuallyEdited(true);
    setModalOpen(true);
  };

  const persistNextProviders = async (
    nextProviders: OAuthProviderDto[],
    secretUpdate?: {
      newId: string;
      secretValue?: string;
      oldIdToClear?: string;
    },
  ) => {
    const nextPayload = withNormalizedProviders({
      ...draft,
      oauth_providers: nextProviders,
    });
    const saved = await api.adminUpdateSettings(nextPayload);
    const normalizedSaved = withNormalizedProviders(saved);
    if (secretUpdate) {
      const savedProviders = normalizedSaved.oauth_providers ?? [];
      const canonicalNewId =
        savedProviders.find(
          (p) => normalizeProviderSlug(p.id) === secretUpdate.newId,
        )?.id ?? secretUpdate.newId;

      if (
        secretUpdate.oldIdToClear &&
        secretUpdate.oldIdToClear !== canonicalNewId
      ) {
        const cleared = await api.adminUpdateOAuthSecret({
          provider_id: secretUpdate.oldIdToClear,
          clear: true,
        });
        setHasLegacyOAuthSecret(cleared.has_client_secret);
        setProviderSecretStatus(cleared.provider_secrets ?? {});
      }
      if (secretUpdate.secretValue && secretUpdate.secretValue.trim().length > 0) {
        const secRes = await api.adminUpdateOAuthSecret({
          provider_id: canonicalNewId,
          client_secret: secretUpdate.secretValue.trim(),
        });
        setHasLegacyOAuthSecret(secRes.has_client_secret);
        setProviderSecretStatus(secRes.provider_secrets ?? {});
      }
    }
    onDraftAndSettingsSaved(normalizedSaved);
  };

  const handleSaveModal = async (e: FormEvent) => {
    e.preventDefault();
    if (savingModal) return;
    const cleanId = normalizeProviderSlug(modalDraft.id || modalDraft.name);
    const duplicate =
      cleanId.length >= 1 &&
      providers.some(
        (p, idx) =>
          idx !== editingIndex && normalizeProviderSlug(p.id) === cleanId,
      );
    if (duplicate) {
      toast.warning(extSettings.oauthDuplicateIdErr);
      return;
    }
    const editingOriginal =
      editingIndex !== null ? providers[editingIndex] : undefined;
    const hasExistingSecret = editingOriginal
      ? hasSavedSecretForProvider(editingOriginal.id)
      : false;
    const finalized: OAuthProviderDto = {
      id: cleanId,
      enabled: modalDraft.enabled,
      name: modalDraft.name.trim(),
      client_id: modalDraft.client_id.trim(),
      authorize_url: modalDraft.authorize_url.trim(),
      token_url: modalDraft.token_url.trim(),
      userinfo_url: modalDraft.userinfo_url.trim(),
      scopes: modalDraft.scopes.trim() || 'openid profile email',
    };
    if (
      !isOAuthProviderComplete(finalized) ||
      (!modalSecret.trim() && !hasExistingSecret)
    ) {
      toast.warning(extSettings.oauthRequiredHint);
      return;
    }

    setSavingModal(true);
    try {
      const nextList =
        editingIndex !== null
          ? providers.map((item, idx) => (idx === editingIndex ? finalized : item))
          : [...providers, finalized];
      const oldCleanId = editingOriginal
        ? normalizeProviderSlug(editingOriginal.id)
        : undefined;
      await persistNextProviders(nextList, {
        newId: cleanId,
        secretValue: modalSecret.trim() || undefined,
        oldIdToClear:
          oldCleanId && oldCleanId !== cleanId ? oldCleanId : undefined,
      });
      setModalOpen(false);
      setModalSecret('');
      toast.success(extSettings.oauthProviderSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingModal(false);
    }
  };

  const handleToggleEnabled = async (idx: number, nextEnabled: boolean) => {
    if (savingSecret || savingModal) return;
    const target = providers[idx];
    if (!target) return;
    if (
      nextEnabled &&
      (!isOAuthProviderComplete(target) || !hasSavedSecretForProvider(target.id))
    ) {
      openEditModal(idx);
      return;
    }
    setSavingSecret(true);
    try {
      const nextList = providers.map((item, i) =>
        i === idx ? { ...item, enabled: nextEnabled } : item,
      );
      await persistNextProviders(nextList);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingSecret(false);
    }
  };

  const handleRemoveProvider = async (idx: number) => {
    if (savingSecret || savingModal) return;
    const removed = providers[idx];
    if (!removed) return;
    setSavingSecret(true);
    try {
      const nextList = providers.filter((_, i) => i !== idx);
      const cleanRemovedId = normalizeProviderSlug(removed.id);
      await persistNextProviders(nextList);
      if (cleanRemovedId) {
        const secRes = await api.adminUpdateOAuthSecret({
          provider_id: cleanRemovedId,
          clear: true,
        });
        setHasLegacyOAuthSecret(secRes.has_client_secret);
        setProviderSecretStatus(secRes.provider_secrets ?? {});
      }
      toast.success(extSettings.oauthProviderRemovedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingSecret(false);
    }
  };

  const callbackUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/v1/auth/oauth/callback`
      : '/api/v1/auth/oauth/callback';

  const handleCopyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      toast.success(extSettings.copiedMsg);
    } catch {
      toast.info(callbackUrl);
    }
  };

  const enabledProvidersCount = providers.filter((p) => p.enabled).length;
  const cleanModalId = normalizeProviderSlug(modalDraft.id || modalDraft.name);
  const hasDuplicateId =
    cleanModalId.length >= 1 &&
    providers.some(
      (p, idx) =>
        idx !== editingIndex && normalizeProviderSlug(p.id) === cleanModalId,
    );
  const editingOriginal =
    editingIndex !== null ? providers[editingIndex] : undefined;
  const hasExistingModalSecret = editingOriginal
    ? hasSavedSecretForProvider(editingOriginal.id)
    : false;
  const canSubmitModal =
    modalDraft.name.trim().length > 0 &&
    cleanModalId.length >= 1 &&
    !hasDuplicateId &&
    modalDraft.client_id.trim().length > 0 &&
    isValidHttpEndpoint(modalDraft.authorize_url) &&
    isValidHttpEndpoint(modalDraft.token_url) &&
    isValidHttpEndpoint(modalDraft.userinfo_url) &&
    (modalSecret.trim().length > 0 || hasExistingModalSecret);

  return (
    <div
      className="space-y-5"
      role="region"
      aria-labelledby="studio-settings-heading"
    >
      <SettingsSectionCard
        title={st.oauthGroup}
        trailing={
          <span className="text-xs font-mono text-ink-muted tabular-nums">
            {extSettings.oauthProvidersCount(enabledProvidersCount, providers.length)}
          </span>
        }
      >
        <div className="space-y-2">
          <p className="text-xs text-ink-secondary">
            {extSettings.oauthSharedCallbackHint}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-xl bg-surface-sunken text-ink-secondary border border-border-subtle text-xs font-mono truncate">
              {callbackUrl}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyCallback()}
              className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <IconCopy className="w-3.5 h-3.5 text-ink-muted" />
              <span>{extSettings.copyCallbackBtn}</span>
            </button>
          </div>
        </div>
      </SettingsSectionCard>

      {providers.length === 0 ? (
        <div className="studio-panel p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-ink-primary">
            {extSettings.oauthEmptyTitle}
          </p>
          <p className="text-xs text-ink-muted max-w-md mx-auto leading-relaxed">
            {extSettings.oauthEmptyDesc}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={openAddModal}
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary inline-flex items-center gap-1.5 cursor-pointer"
            >
              <IconPlus className="w-3.5 h-3.5" />
              <span>{extSettings.oauthAddProviderBtn}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider, idx) => {
            const secretSaved = hasSavedSecretForProvider(provider.id);
            const complete = isOAuthProviderComplete(provider) && secretSaved;
            const titleText =
              provider.name.trim() || provider.id || `OAuth #${idx + 1}`;
            const maskedClientId =
              provider.client_id.trim().length > 18
                ? `${provider.client_id.trim().slice(0, 10)}…${provider.client_id.trim().slice(-4)}`
                : provider.client_id.trim() || '—';

            return (
              <section
                key={provider.id || `idx-${idx}`}
                className="studio-panel overflow-hidden"
              >
                <div className="p-4 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink-primary truncate">
                        {titleText}
                      </h3>
                      <code className="px-1.5 py-0.5 rounded-md text-xs font-mono bg-surface-sunken text-ink-muted border border-border-subtle shrink-0">
                        {provider.id || `provider-${idx + 1}`}
                      </code>
                      {!complete ? (
                        <StatusBadge tone="warn">
                          {extSettings.oauthIncompleteBadge}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone={provider.enabled ? 'success' : 'neutral'}>
                          {provider.enabled
                            ? extSettings.oauthStatusEnabled
                            : extSettings.oauthStatusDisabled}
                        </StatusBadge>
                      )}
                      <span
                        className={`text-xs font-mono shrink-0 inline-flex items-center gap-1 ${
                          secretSaved ? 'text-accent-success' : 'text-ink-muted'
                        }`}
                      >
                        {secretSaved ? (
                          <>
                            <IconCheck className="w-3 h-3" />
                            <span>{st.oauthSecretSavedBadge}</span>
                          </>
                        ) : (
                          extSettings.oauthMissingSecretBadge
                        )}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted font-mono">
                      <span>Client ID: {maskedClientId}</span>
                      <span>
                        Host: {extractEndpointHost(provider.authorize_url)}
                      </span>
                      <span className="truncate max-w-60">
                        Scopes: {provider.scopes || 'openid profile email'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <SwitchRow
                      label={st.oauthEnabledLabel}
                      checked={provider.enabled && complete}
                      disabled={savingSecret || savingModal}
                      onChange={(checked) =>
                        void handleToggleEnabled(idx, checked)
                      }
                      variant="inline"
                      className="me-1"
                    />

                    <button
                      type="button"
                      onClick={() => openEditModal(idx)}
                      className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <IconPen className="w-3.5 h-3.5 text-ink-muted" />
                      <span>{extSettings.oauthEditProviderBtn}</span>
                    </button>

                    <button
                      type="button"
                      disabled={savingSecret || savingModal}
                      onClick={() => void handleRemoveProvider(idx)}
                      className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                      <span>{extSettings.oauthRemoveProviderBtn}</span>
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Validated Add / Edit OAuth Provider Modal */}
      <ModalDialog
        open={modalOpen}
        onClose={() => {
          if (!savingModal) setModalOpen(false);
        }}
        ariaLabelledBy="oauth-provider-modal-title"
        maxWidthClass="max-w-xl"
        stableScrollbarGutter
      >
        <form
          onSubmit={(e) => void handleSaveModal(e)}
          className="p-5 sm:p-6 flex flex-col gap-4"
        >
          <ModalHeader
            titleId="oauth-provider-modal-title"
            title={
              editingIndex !== null
                ? extSettings.oauthModalEditTitle(
                    editingOriginal?.name || editingOriginal?.id || 'OAuth',
                  )
                : extSettings.oauthModalAddTitle
            }
            closeLabel={UI_COPY[locale].closeLabel}
            onClose={() => {
              if (!savingModal) setModalOpen(false);
            }}
          />

          <div className="px-3.5 py-2 rounded-xl bg-surface-raised border border-border-subtle">
            <SwitchRow
              label={st.oauthEnabledLabel}
              checked={modalDraft.enabled}
              onChange={(checked) =>
                setModalDraft((prev) => ({ ...prev, enabled: checked }))
              }
              variant="inline"
              className="w-full justify-between font-semibold text-ink-primary"
            />
          </div>

          {editingIndex === null && (
            <RadioPillGroup<OAuthPresetKind>
              name="oauth_modal_preset"
              legend={extSettings.oauthPresetLegend}
              size="sm"
              value={modalPreset}
              onChange={handleSelectModalPreset}
              options={[
                { value: 'github', label: 'GitHub' },
                { value: 'google', label: 'Google' },
                { value: 'authentik', label: 'Authentik / OIDC' },
                { value: 'custom', label: extSettings.oauthPresetCustom },
              ]}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="oauth-modal-name"
                className="block mb-1 text-xs font-semibold text-ink-secondary"
              >
                {st.oauthProviderNameLabel}
              </label>
              <input
                id="oauth-modal-name"
                type="text"
                required
                maxLength={48}
                value={modalDraft.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setModalDraft((prev) => ({
                    ...prev,
                    name: nextName,
                    id:
                      editingIndex === null &&
                      modalPreset === 'custom' &&
                      !idManuallyEdited
                        ? normalizeProviderSlug(nextName) || prev.id
                        : prev.id,
                  }));
                }}
                placeholder="GitHub / Google / Authentik"
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs ink-input-inset"
              />
            </div>

            <div>
              <label
                htmlFor="oauth-modal-id"
                className="block mb-1 text-xs font-semibold text-ink-secondary"
              >
                {extSettings.oauthProviderIdLabel}
              </label>
              <input
                id="oauth-modal-id"
                type="text"
                required
                maxLength={32}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={modalDraft.id}
                onChange={(e) => {
                  setIdManuallyEdited(true);
                  setModalDraft((prev) => ({ ...prev, id: e.target.value }));
                }}
                onBlur={() =>
                  setModalDraft((prev) => ({
                    ...prev,
                    id: normalizeProviderSlug(prev.id),
                  }))
                }
                placeholder="github"
                title={extSettings.oauthProviderIdHint}
                className={`w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border text-xs font-mono ink-input-inset ${
                  hasDuplicateId ? 'border-accent-danger' : 'border-border-subtle'
                }`}
              />
              {hasDuplicateId && (
                <p className="mt-1 mb-0 text-xs text-accent-danger">
                  {extSettings.oauthDuplicateIdErr}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="oauth-modal-scopes"
                className="block mb-1 text-xs font-semibold text-ink-secondary"
              >
                {st.oauthScopesLabel}
              </label>
              <input
                id="oauth-modal-scopes"
                type="text"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={modalDraft.scopes}
                onChange={(e) =>
                  setModalDraft((prev) => ({ ...prev, scopes: e.target.value }))
                }
                placeholder="openid profile email"
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="oauth-modal-cid"
                className="block mb-1 text-xs font-semibold text-ink-secondary"
              >
                {st.oauthClientIdLabel}
              </label>
              <input
                id="oauth-modal-cid"
                type="text"
                required
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={modalDraft.client_id}
                onChange={(e) =>
                  setModalDraft((prev) => ({
                    ...prev,
                    client_id: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label
                  htmlFor="oauth-modal-secret"
                  className="text-xs font-semibold text-ink-secondary"
                >
                  {st.oauthClientSecretLabel}
                </label>
                {hasExistingModalSecret && (
                  <span className="text-xs font-mono text-accent-success inline-flex items-center gap-1">
                    <IconCheck className="w-3 h-3" />
                    <span>{st.oauthSecretSavedBadge}</span>
                  </span>
                )}
              </div>
              <PasswordInput
                id="oauth-modal-secret"
                locale={locale}
                variant="compact"
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                required={!hasExistingModalSecret}
                value={modalSecret}
                onChange={(e) => setModalSecret(e.target.value)}
                placeholder={hasExistingModalSecret ? '••••••••' : ''}
              />
            </div>
          </div>

          <div className="space-y-2.5">
            {(
              [
                [
                  'oauth-modal-auth',
                  st.oauthAuthorizeUrlLabel,
                  'authorize_url',
                  'https://example.com/oauth/authorize',
                ],
                [
                  'oauth-modal-token',
                  st.oauthTokenUrlLabel,
                  'token_url',
                  'https://example.com/oauth/token',
                ],
                [
                  'oauth-modal-userinfo',
                  st.oauthUserinfoUrlLabel,
                  'userinfo_url',
                  'https://example.com/oauth/userinfo',
                ],
              ] as const
            ).map(([inputId, labelText, fieldKey, placeholderText]) => (
              <div key={inputId}>
                <label
                  htmlFor={inputId}
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {labelText}
                </label>
                <input
                  id={inputId}
                  type="url"
                  required
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={modalDraft[fieldKey]}
                  onChange={(e) =>
                    setModalDraft((prev) => ({
                      ...prev,
                      [fieldKey]: e.target.value,
                    }))
                  }
                  placeholder={placeholderText}
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                />
              </div>
            ))}
          </div>

          <p className="text-xs text-ink-muted leading-relaxed">
            {extSettings.oauthRequiredHint}
          </p>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={savingModal}
              onClick={() => setModalOpen(false)}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {extSettings.oauthCancelBtn}
            </button>
            <button
              type="submit"
              disabled={savingModal || !canSubmitModal}
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingModal ? extSettings.oauthSavingProviderBtn : extSettings.oauthSaveProviderBtn}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
