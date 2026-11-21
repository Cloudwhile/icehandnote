import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../../lib/api';
import { LOCALES, UI_COPY } from '../../lib/i18n';
import { RC3_COPY } from '../../lib/i18nRc3';
import { ALL_LICENSE_OPTIONS, normalizeLicenseId } from '../../lib/licenses';
import {
  APP_VERSION,
  getEffectiveOAuthProviders,
  type DefaultThemeSetting,
  type LicenseId,
  type LocaleCode,
  type OAuthProviderDto,
  type SiteSettingsDto,
  type SmtpSettingsDto,
  type StorageStatusDto,
  type StudioSettingsTabId,
  type UpdateCheckResponse,
} from '../../lib/types';
import { IconCheck, IconCopy, IconTrash, IconUpload } from '../ui/Icons';
import { useToast } from '../ui/ToastProvider';

interface StudioSettingsPanelProps {
  locale: LocaleCode;
  activeTab: StudioSettingsTabId;
  onSelectTab: (tab: StudioSettingsTabId) => void;
  settings: SiteSettingsDto;
  onSettingsUpdated: (next: SiteSettingsDto) => void;
}

const SETTINGS_TAB_ORDER: readonly StudioSettingsTabId[] = [
  'general',
  'oauth',
  'storage',
  'smtp',
  'updates',
];

const DEFAULT_SMTP_STATE: SmtpSettingsDto = {
  enabled: false,
  host: '',
  port: 465,
  encryption: 'tls',
  username: '',
  from_name: 'IceHandnote',
  from_email: '',
  email_footer_text: '',
  register_code_subject: '',
  register_code_html: '',
  login_anomaly_subject: '',
  login_anomaly_html: '',
  invite_subject: '',
  invite_html: '',
  reset_subject: '',
  reset_html: '',
  takedown_subject: '',
  takedown_html: '',
};

type MailTemplateKind =
  | 'register_code'
  | 'login_anomaly'
  | 'email_change'
  | 'invite'
  | 'reset'
  | 'takedown';

type OAuthPresetKind = 'github' | 'google' | 'authentik' | 'custom';

function normalizeProviderSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
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

function withNormalizedProviders(settings: SiteSettingsDto): SiteSettingsDto {
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

function buildSandboxedEmailDoc(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background-color:#f4efe3;background-image:radial-gradient(#cfc5b0 1px,transparent 1px);background-size:18px 18px;overflow:hidden;}a{color:#4c1d95;}</style></head><body>${bodyHtml}</body></html>`;
}

export function StudioSettingsPanel({
  locale,
  activeTab,
  onSelectTab,
  settings,
  onSettingsUpdated,
}: StudioSettingsPanelProps) {
  const copy = UI_COPY[locale];
  const st = copy.studio.settings;
  const rc3 = RC3_COPY[locale].settings;
  const toast = useToast();

  const normalizedIncoming = useMemo(
    () => withNormalizedProviders(settings),
    [settings],
  );
  const [draft, setDraft] = useState<SiteSettingsDto>(normalizedIncoming);
  const [saving, setSaving] = useState(false);

  // Logo upload
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Storage Backend state
  const [storageStatus, setStorageStatus] = useState<StorageStatusDto | null>(null);
  const [storageMode, setStorageMode] = useState<'local' | 'postgres'>('local');
  const [postgresUrl, setPostgresUrl] = useState('');
  const [syncContent, setSyncContent] = useState(true);
  const [testingStorage, setTestingStorage] = useState(false);
  const [switchingStorage, setSwitchingStorage] = useState(false);

  // Multi-OAuth per-provider client secret state
  const [hasLegacyOAuthSecret, setHasLegacyOAuthSecret] = useState(false);
  const [providerSecretStatus, setProviderSecretStatus] = useState<
    Record<string, boolean>
  >({});
  const [providerSecretInputs, setProviderSecretInputs] = useState<
    Record<string, string>
  >({});
  const [savingOAuthSecret, setSavingOAuthSecret] = useState(false);

  // SMTP & Mail Templates state
  const [smtpDraft, setSmtpDraft] = useState<SmtpSettingsDto>(DEFAULT_SMTP_STATE);
  const [savedSmtpBaseline, setSavedSmtpBaseline] =
    useState<SmtpSettingsDto>(DEFAULT_SMTP_STATE);
  const [hasSmtpPassword, setHasSmtpPassword] = useState(false);
  const [smtpPasswordInput, setSmtpPasswordInput] = useState('');
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testEmailAddr, setTestEmailAddr] = useState('');
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(true);
  const [activeTemplateKind, setActiveTemplateKind] =
    useState<MailTemplateKind>('register_code');
  const [templateViewMode, setTemplateViewMode] = useState<'preview' | 'source'>(
    'preview',
  );
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>(
    'desktop',
  );
  const [previewLocale, setPreviewLocale] = useState<LocaleCode>(locale);
  const [templatePreview, setTemplatePreview] = useState<{
    subject: string;
    html: string;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewResizeObserverRef = useRef<ResizeObserver | null>(null);
  const [previewIframeHeight, setPreviewIframeHeight] = useState<number>(480);

  // Update check state
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResponse | null>(null);
  const [updateError, setUpdateError] = useState(false);

  useEffect(() => {
    setDraft(normalizedIncoming);
  }, [normalizedIncoming]);

  useEffect(() => {
    setPreviewLocale(locale);
  }, [locale]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.adminGetStorage().catch(() => null),
      api.adminGetOAuthSecretStatus().catch(() => null),
      api.adminGetSmtp().catch(() => null),
    ]).then(([stRes, secRes, smtpRes]) => {
      if (!active) return;
      if (stRes) {
        setStorageStatus(stRes);
        setStorageMode(stRes.active_backend);
        setPostgresUrl(stRes.database_url_masked || '');
      }
      if (secRes) {
        setHasLegacyOAuthSecret(secRes.has_client_secret);
        setProviderSecretStatus(secRes.provider_secrets ?? {});
      }
      if (smtpRes) {
        const merged = { ...DEFAULT_SMTP_STATE, ...smtpRes.settings };
        setSmtpDraft(merged);
        setSavedSmtpBaseline(merged);
        setHasSmtpPassword(smtpRes.has_password);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const currentTplSubject =
    activeTemplateKind === 'register_code'
      ? smtpDraft.register_code_subject
      : activeTemplateKind === 'login_anomaly'
        ? smtpDraft.login_anomaly_subject
        : activeTemplateKind === 'email_change'
          ? ''
          : activeTemplateKind === 'invite'
            ? smtpDraft.invite_subject
            : activeTemplateKind === 'reset'
              ? smtpDraft.reset_subject
              : smtpDraft.takedown_subject;

  const currentTplHtml =
    activeTemplateKind === 'register_code'
      ? smtpDraft.register_code_html
      : activeTemplateKind === 'login_anomaly'
        ? smtpDraft.login_anomaly_html
        : activeTemplateKind === 'email_change'
          ? ''
          : activeTemplateKind === 'invite'
            ? smtpDraft.invite_html
            : activeTemplateKind === 'reset'
              ? smtpDraft.reset_html
              : smtpDraft.takedown_html;

  useEffect(() => {
    if (activeTab !== 'smtp' || !templatesOpen || templateViewMode !== 'preview') {
      return;
    }
    let active = true;
    setLoadingPreview(true);
    const timer = window.setTimeout(() => {
      void api
        .adminPreviewSmtpTemplate({
          template_kind: activeTemplateKind,
          subject: currentTplSubject,
          html: currentTplHtml,
          locale: previewLocale,
          email_footer_text: smtpDraft.email_footer_text,
        })
        .then((res) => {
          if (active) setTemplatePreview(res);
        })
        .catch(() => {
          if (active) setTemplatePreview(null);
        })
        .finally(() => {
          if (active) setLoadingPreview(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    activeTab,
    templatesOpen,
    templateViewMode,
    activeTemplateKind,
    currentTplSubject,
    currentTplHtml,
    smtpDraft.email_footer_text,
    previewLocale,
    settings.logo_url,
    settings.site_name,
  ]);

  const measurePreviewIframe = useCallback(() => {
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return;
      const firstChild = doc.body.firstElementChild as HTMLElement | null;
      const syncHeight = () => {
        const target = doc.body.firstElementChild as HTMLElement | null;
        const measured = target
          ? Math.ceil(target.getBoundingClientRect().height)
          : Math.ceil(doc.body.scrollHeight);
        if (measured > 40) {
          setPreviewIframeHeight(measured);
        }
      };
      syncHeight();
      void doc.fonts?.ready?.then(syncHeight);
      previewResizeObserverRef.current?.disconnect();
      if (typeof ResizeObserver !== 'undefined') {
        const obs = new ResizeObserver(syncHeight);
        obs.observe(firstChild ?? doc.body);
        previewResizeObserverRef.current = obs;
      }
    } catch {
      // ignore cross-origin guard if browser blocks contentDocument access
    }
  }, []);

  useEffect(() => {
    return () => {
      previewResizeObserverRef.current?.disconnect();
      previewResizeObserverRef.current = null;
    };
  }, []);

  // Re-measure natural height whenever switching between desktop (560px) and mobile (375px)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      measurePreviewIframe();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [previewViewport, templatePreview?.html, measurePreviewIframe]);

  const updateCurrentTemplateField = (field: 'subject' | 'html', value: string) => {
    setSmtpDraft((prev) => {
      if (activeTemplateKind === 'register_code') {
        return field === 'subject'
          ? { ...prev, register_code_subject: value }
          : { ...prev, register_code_html: value };
      }
      if (activeTemplateKind === 'login_anomaly') {
        return field === 'subject'
          ? { ...prev, login_anomaly_subject: value }
          : { ...prev, login_anomaly_html: value };
      }
      if (activeTemplateKind === 'invite') {
        return field === 'subject'
          ? { ...prev, invite_subject: value }
          : { ...prev, invite_html: value };
      }
      if (activeTemplateKind === 'reset') {
        return field === 'subject'
          ? { ...prev, reset_subject: value }
          : { ...prev, reset_html: value };
      }
      return field === 'subject'
        ? { ...prev, takedown_subject: value }
        : { ...prev, takedown_html: value };
    });
  };

  const resetCurrentTemplateToDefault = () => {
    updateCurrentTemplateField('subject', '');
    updateCurrentTemplateField('html', '');
  };

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateError(false);
    try {
      const res = await api.checkSiteUpdate();
      setUpdateResult(res);
    } catch (err) {
      setUpdateError(true);
      toast.error(err);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploadingLogo) return;
    setUploadingLogo(true);
    try {
      const uploaded = await api.uploadStudioMedia(file);
      setDraft((prev) => ({ ...prev, logo_url: uploaded.url }));
      toast.success(rc3.logoUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingLogo(false);
    }
  };

  const toggleLocale = (code: LocaleCode) => {
    setDraft((prev) => {
      const exists = prev.enabled_locales.includes(code);
      if (exists && prev.enabled_locales.length <= 1) {
        toast.warning(st.minOneLocaleError);
        return prev;
      }
      const nextLocales = exists
        ? prev.enabled_locales.filter((c) => c !== code)
        : [...prev.enabled_locales, code];
      const nextDefault = nextLocales.includes(prev.default_locale)
        ? prev.default_locale
        : nextLocales[0];
      return {
        ...prev,
        enabled_locales: nextLocales,
        default_locale: nextDefault,
      };
    });
  };

  const providers = draft.oauth_providers ?? [];

  const setProvidersList = (nextProviders: OAuthProviderDto[]) => {
    setDraft((prev) =>
      withNormalizedProviders({
        ...prev,
        oauth_providers: nextProviders,
        oauth_enabled: nextProviders.some((p) => p.enabled),
        oauth_client_id: nextProviders[0]?.client_id ?? '',
        oauth_provider_name: nextProviders[0]?.name ?? '',
        oauth_authorize_url: nextProviders[0]?.authorize_url ?? '',
        oauth_token_url: nextProviders[0]?.token_url ?? '',
        oauth_userinfo_url: nextProviders[0]?.userinfo_url ?? '',
        oauth_scopes: nextProviders[0]?.scopes || 'openid profile email',
      }),
    );
  };

  const handleAddOAuthProvider = (kind: OAuthPresetKind) => {
    const existing = new Set(providers.map((p) => p.id.toLowerCase()));
    const created = createOAuthPreset(kind, existing);
    setProvidersList([...providers, created]);
  };

  const handleUpdateOAuthProvider = (
    idx: number,
    patch: Partial<OAuthProviderDto>,
  ) => {
    const next = providers.map((item, i) =>
      i === idx ? { ...item, ...patch } : item,
    );
    setProvidersList(next);
  };

  const handleRemoveOAuthProvider = (idx: number) => {
    const removed = providers[idx];
    const next = providers.filter((_, i) => i !== idx);
    setProvidersList(next);
    if (removed) {
      setProviderSecretInputs((prev) => {
        const copyMap = { ...prev };
        delete copyMap[removed.id];
        return copyMap;
      });
    }
  };

  const hasSavedSecretForProvider = (providerId: string): boolean => {
    const key = normalizeProviderSlug(providerId);
    if (key && providerSecretStatus[key]) return true;
    if (providers.length === 1 && hasLegacyOAuthSecret) return true;
    return false;
  };

  const handleClearProviderSecret = async (providerId: string) => {
    if (savingOAuthSecret) return;
    const key = normalizeProviderSlug(providerId);
    setSavingOAuthSecret(true);
    try {
      const sec = await api.adminUpdateOAuthSecret({
        provider_id: key || undefined,
        clear: true,
      });
      setHasLegacyOAuthSecret(sec.has_client_secret);
      setProviderSecretStatus(sec.provider_secrets ?? {});
      setProviderSecretInputs((prev) => ({ ...prev, [providerId]: '' }));
      toast.success(rc3.oauthSecretClearedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingOAuthSecret(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (draft.enabled_locales.length === 0) {
      toast.warning(st.minOneLocaleError);
      return;
    }
    setSaving(true);
    try {
      const payload = withNormalizedProviders(draft);
      const saved = await api.adminUpdateSettings(payload);
      const savedProviders = saved.oauth_providers ?? [];

      // Persist any entered per-provider client secrets mapped to the finalized provider IDs
      const secretEntries = Object.entries(providerSecretInputs).filter(
        ([, secret]) => secret.trim().length > 0,
      );
      let latestSecRes: {
        has_client_secret: boolean;
        provider_secrets: Record<string, boolean>;
      } | null = null;
      for (const [rawKey, secretVal] of secretEntries) {
        const matchedIdx = providers.findIndex((p) => p.id === rawKey);
        const finalId =
          (matchedIdx >= 0 ? savedProviders[matchedIdx]?.id : undefined) ||
          normalizeProviderSlug(rawKey);
        if (finalId) {
          latestSecRes = await api.adminUpdateOAuthSecret({
            provider_id: finalId,
            client_secret: secretVal.trim(),
          });
        }
      }
      if (latestSecRes) {
        setHasLegacyOAuthSecret(latestSecRes.has_client_secret);
        setProviderSecretStatus(latestSecRes.provider_secrets ?? {});
        setProviderSecretInputs({});
      }

      const normalizedSaved = withNormalizedProviders(saved);
      setDraft(normalizedSaved);
      onSettingsUpdated(normalizedSaved);
      toast.success(st.savedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleTestStorage = async () => {
    if (testingStorage) return;
    setTestingStorage(true);
    try {
      const res = await api.adminTestStorage(postgresUrl);
      toast.success(st.testConnectionOk(res.latency_ms));
    } catch (err) {
      toast.error(err);
    } finally {
      setTestingStorage(false);
    }
  };

  const handleApplyStorage = async () => {
    if (switchingStorage) return;
    setSwitchingStorage(true);
    try {
      const res = await api.adminUpdateStorage({
        mode: storageMode,
        database_url: postgresUrl,
        sync_content: syncContent,
      });
      setStorageStatus(res);
      setStorageMode(res.active_backend);
      setPostgresUrl(res.database_url_masked || '');
      toast.success(st.storageSwitchedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSwitchingStorage(false);
    }
  };

  const handleSaveSmtp = async () => {
    if (savingSmtp) return;
    setSavingSmtp(true);
    try {
      const res = await api.adminUpdateSmtp({
        settings: smtpDraft,
        password: smtpPasswordInput.trim() || undefined,
      });
      const savedMerged = { ...DEFAULT_SMTP_STATE, ...res.settings };
      setSmtpDraft(savedMerged);
      setSavedSmtpBaseline(savedMerged);
      setHasSmtpPassword(res.has_password);
      setSmtpPasswordInput('');
      toast.success(rc3.smtpSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleClearSmtpPassword = async () => {
    if (savingSmtp) return;
    setSavingSmtp(true);
    try {
      const res = await api.adminUpdateSmtp({
        settings: smtpDraft,
        clear_password: true,
      });
      setHasSmtpPassword(res.has_password);
      setSmtpPasswordInput('');
      toast.success(rc3.smtpSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleTestSmtp = async () => {
    if (!testEmailAddr.trim() || testingSmtp) return;
    setTestingSmtp(true);
    try {
      await api.adminTestSmtp({
        to_email: testEmailAddr.trim(),
        settings: smtpDraft,
        password: smtpPasswordInput.trim() || undefined,
        locale,
      });
      toast.success(rc3.smtpTestSentMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setTestingSmtp(false);
    }
  };

  const callbackUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/v1/auth/oauth/callback`
      : '/api/v1/auth/oauth/callback';

  const handleCopyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      toast.success(rc3.copiedMsg);
    } catch {
      toast.info(callbackUrl);
    }
  };

  const hasPendingSecretInput = Object.values(providerSecretInputs).some(
    (v) => v.trim().length > 0,
  );
  const isDirty =
    JSON.stringify(draft) !== JSON.stringify(normalizedIncoming) ||
    hasPendingSecretInput;
  const isSmtpDirty =
    JSON.stringify(smtpDraft) !== JSON.stringify(savedSmtpBaseline) ||
    smtpPasswordInput.trim().length > 0;
  const isStorageDirty = Boolean(
    storageStatus &&
      (storageMode !== storageStatus.active_backend ||
        (storageMode === 'postgres' &&
          postgresUrl.trim() !==
            (storageStatus.database_url_masked || '').trim())),
  );

  const isSiteSettingsFormTab = activeTab === 'general' || activeTab === 'oauth';
  const enabledProvidersCount = providers.filter((p) => p.enabled).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Sticky Top Header + Sub-Category Tabs + Contextual Primary Action */}
      <div className="sticky top-0 z-10 -mx-2 px-2 pt-2 pb-3 bg-surface-page/95 backdrop-blur space-y-3 border-b border-border-subtle">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h1
              id="studio-settings-heading"
              className="text-xl font-semibold text-ink-primary m-0"
            >
              {rc3.settingsTabs[activeTab]}
            </h1>
            <span className="text-xs text-ink-muted hidden sm:inline">
              / {st.title}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isSiteSettingsFormTab && (
              <>
                {isDirty && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(normalizedIncoming);
                      setProviderSecretInputs({});
                    }}
                    className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
                  >
                    {st.resetBtn}
                  </button>
                )}

                <button
                  type="submit"
                  form="studio-settings-form"
                  disabled={saving || !isDirty}
                  className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? st.savingBtn : st.saveBtn}
                </button>
              </>
            )}

            {activeTab === 'smtp' && (
              <button
                type="button"
                disabled={savingSmtp || !isSmtpDirty}
                onClick={() => void handleSaveSmtp()}
                className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingSmtp ? rc3.smtpSavingBtn : rc3.smtpSaveBtn}
              </button>
            )}

            {activeTab === 'updates' && (
              <button
                type="button"
                disabled={checkingUpdate}
                onClick={() => void handleCheckUpdate()}
                className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
              >
                {checkingUpdate ? st.checkingUpdateBtn : st.checkUpdateBtn}
              </button>
            )}
          </div>
        </div>

        {/* Synchronized Sub-Category Tabs (`modern-web-guidance/tabs`) */}
        <div
          role="tablist"
          aria-label={st.title}
          className="mwg-tablist max-w-full"
          {...({ focusgroup: 'tablist nomemory' } as Record<string, unknown>)}
        >
          {SETTINGS_TAB_ORDER.map((tabId, idx) => {
            const active = activeTab === tabId;
            return (
              <button
                key={tabId}
                id={`settings-subtab-${tabId}`}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={(e) => {
                  onSelectTab(tabId);
                  e.currentTarget.scrollIntoView({
                    block: 'nearest',
                    inline: 'nearest',
                  });
                }}
                onKeyDown={(e) => {
                  if ('focusGroup' in HTMLElement.prototype) return;
                  let nextIdx = -1;
                  if (e.key === 'ArrowRight')
                    nextIdx = (idx + 1) % SETTINGS_TAB_ORDER.length;
                  else if (e.key === 'ArrowLeft')
                    nextIdx =
                      (idx - 1 + SETTINGS_TAB_ORDER.length) %
                      SETTINGS_TAB_ORDER.length;
                  else if (e.key === 'Home') nextIdx = 0;
                  else if (e.key === 'End') nextIdx = SETTINGS_TAB_ORDER.length - 1;
                  if (nextIdx >= 0) {
                    e.preventDefault();
                    const nextId = SETTINGS_TAB_ORDER[nextIdx];
                    onSelectTab(nextId);
                    const nextBtn = document.getElementById(
                      `settings-subtab-${nextId}`,
                    );
                    nextBtn?.focus();
                    nextBtn?.scrollIntoView({
                      block: 'nearest',
                      inline: 'nearest',
                    });
                  }
                }}
                className="mwg-tab"
                {...(active
                  ? ({ focusgroupstart: '' } as Record<string, unknown>)
                  : {})}
              >
                <span>{rc3.settingsTabs[tabId]}</span>
                {tabId === 'oauth' && providers.length > 0 && (
                  <span className="ms-1.5 text-xs font-mono opacity-75 tabular-nums">
                    ({enabledProvidersCount})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ================================================================= */}
      {/* SUB-CATEGORY 1: General Site Settings (Identity + Locale + Features + SSO) */}
      {/* ================================================================= */}
      {activeTab === 'general' && (
        <form
          id="studio-settings-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-6"
          aria-labelledby="studio-settings-heading"
        >
          {/* Group 1: General Site Identity & Logo */}
          <section className="studio-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40">
              <h2 className="text-sm font-semibold text-ink-primary m-0">
                {st.generalGroup}
              </h2>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="set-site-name"
                    className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                  >
                    {st.siteNameLabel}
                  </label>
                  <input
                    id="set-site-name"
                    name="site_name"
                    type="text"
                    required
                    maxLength={160}
                    value={draft.site_name}
                    onChange={(e) => setDraft({ ...draft, site_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                  />
                </div>

                <div>
                  <label
                    htmlFor="set-brand-badge"
                    className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                  >
                    {st.brandBadgeLabel}
                  </label>
                  <input
                    id="set-brand-badge"
                    name="brand_badge"
                    type="text"
                    maxLength={120}
                    value={draft.brand_badge}
                    onChange={(e) =>
                      setDraft({ ...draft, brand_badge: e.target.value })
                    }
                    placeholder={st.brandBadgePlaceholder}
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                  />
                </div>
              </div>

              {/* Site Logo Upload & URL */}
              <div>
                <label
                  htmlFor="set-logo-url"
                  className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                >
                  {st.siteLogoLabel}
                </label>
                <div className="relative flex flex-wrap items-center gap-2.5">
                  {draft.logo_url?.trim() && (
                    <img
                      src={draft.logo_url}
                      alt=""
                      className="w-9 h-9 rounded-xl object-contain border border-border-subtle bg-surface-raised p-1 shrink-0"
                    />
                  )}
                  <input
                    id="set-logo-url"
                    type="text"
                    spellCheck={false}
                    autoCapitalize="none"
                    value={draft.logo_url ?? ''}
                    onChange={(e) => setDraft({ ...draft, logo_url: e.target.value })}
                    placeholder={st.logoUrlPlaceholder}
                    className="flex-1 min-w-48 px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                  />
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon,image/svg+xml"
                    onChange={(e) => void handleLogoUpload(e)}
                    className="sr-only"
                  />
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={() => logoInputRef.current?.click()}
                    className="min-h-9 px-3 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <IconUpload className="w-3.5 h-3.5 text-ink-muted" />
                    <span>{uploadingLogo ? st.uploadingLogoBtn : st.uploadLogoBtn}</span>
                  </button>
                  {draft.logo_url?.trim() && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, logo_url: '' })}
                      className="min-h-9 px-2.5 py-1.5 rounded-xl text-xs text-ink-muted hover:text-accent-danger cursor-pointer"
                    >
                      {st.clearLogoBtn}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="set-hero-title"
                    className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                  >
                    {st.heroTitleLabel}
                  </label>
                  <input
                    id="set-hero-title"
                    name="hero_title"
                    type="text"
                    maxLength={320}
                    value={draft.hero_title}
                    onChange={(e) => setDraft({ ...draft, hero_title: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                  />
                </div>

                <div>
                  <label
                    htmlFor="set-hero-tagline"
                    className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                  >
                    {st.heroTaglineLabel}
                  </label>
                  <input
                    id="set-hero-tagline"
                    name="hero_tagline"
                    type="text"
                    maxLength={600}
                    value={draft.hero_tagline}
                    onChange={(e) =>
                      setDraft({ ...draft, hero_tagline: e.target.value })
                    }
                    placeholder={st.heroTaglinePlaceholder}
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="set-footer-text" className="ink-field-label">
                    {st.footerTextLabel}
                  </label>
                  <input
                    id="set-footer-text"
                    name="footer_text"
                    type="text"
                    maxLength={500}
                    value={draft.footer_text}
                    onChange={(e) =>
                      setDraft({ ...draft, footer_text: e.target.value })
                    }
                    placeholder={st.footerTextPlaceholder}
                    className="ink-field-input"
                  />
                </div>

                <div>
                  <label htmlFor="set-default-author" className="ink-field-label">
                    {st.defaultAuthorLabel}
                  </label>
                  <input
                    id="set-default-author"
                    name="default_author_name"
                    type="text"
                    maxLength={120}
                    value={draft.default_author_name ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, default_author_name: e.target.value })
                    }
                    placeholder={st.defaultAuthorPlaceholder}
                    className="ink-field-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="set-default-license" className="ink-field-label">
                    {st.defaultLicenseLabel}
                  </label>
                  <select
                    id="set-default-license"
                    name="default_license"
                    value={
                      normalizeLicenseId(draft.default_license) || 'cc-by-nc-sa-4.0'
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        default_license: (normalizeLicenseId(e.target.value) ||
                          'cc-by-nc-sa-4.0') as LicenseId,
                      })
                    }
                    className="ink-select w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm"
                  >
                    {ALL_LICENSE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {copy.licenseNames[opt.id]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="set-gravatar-base" className="ink-field-label">
                    {rc3.gravatarBaseUrlLabel}
                  </label>
                  <input
                    id="set-gravatar-base"
                    type="url"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    value={draft.gravatar_base_url ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, gravatar_base_url: e.target.value })
                    }
                    placeholder={rc3.gravatarBaseUrlPlaceholder}
                    className="ink-field-input font-mono text-xs sm:text-sm"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Group 2: Localization & Appearance */}
          <section className="studio-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40">
              <h2 className="text-sm font-semibold text-ink-primary m-0">
                {st.localeThemeGroup}
              </h2>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              <fieldset className="m-0 p-0 border-0">
                <legend className="text-xs font-semibold text-ink-secondary mb-2.5 p-0">
                  {st.enabledLocalesLabel}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {LOCALES.map((loc) => {
                    const checked = draft.enabled_locales.includes(loc.code);
                    return (
                      <label
                        key={loc.code}
                        className={`relative inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                          checked
                            ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                            : 'bg-surface-raised border-border-subtle text-ink-muted hover:border-ink-muted'
                        }`}
                      >
                        <input
                          type="checkbox"
                          name="enabled_locales"
                          value={loc.code}
                          checked={checked}
                          onChange={() => toggleLocale(loc.code)}
                          className="sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`w-4 h-4 rounded inline-flex items-center justify-center border shrink-0 ${
                            checked
                              ? 'bg-action-bg border-action-bg text-action-fg'
                              : 'bg-surface-sheet border-border-subtle'
                          }`}
                        >
                          {checked && <IconCheck className="w-2.5 h-2.5" />}
                        </span>
                        <span>{loc.label}</span>
                        <span className="font-mono text-ink-muted">{loc.code}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-dashed border-border-subtle">
                <fieldset className="m-0 p-0 border-0">
                  <legend className="text-xs font-semibold text-ink-secondary mb-2.5 p-0">
                    {st.defaultLocaleLabel}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {LOCALES.filter((loc) =>
                      draft.enabled_locales.includes(loc.code),
                    ).map((loc) => {
                      const active = draft.default_locale === loc.code;
                      return (
                        <label
                          key={loc.code}
                          className={`relative inline-flex items-center gap-1.5 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                            active
                              ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                              : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-ink-muted'
                          }`}
                        >
                          <input
                            type="radio"
                            name="default_locale"
                            value={loc.code}
                            checked={active}
                            onChange={() =>
                              setDraft({ ...draft, default_locale: loc.code })
                            }
                            className="sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className={`w-4 h-4 rounded-full inline-flex items-center justify-center border shrink-0 ${
                              active
                                ? 'bg-action-bg border-action-bg text-action-fg'
                                : 'bg-surface-sheet border-border-subtle'
                            }`}
                          >
                            {active && <IconCheck className="w-2.5 h-2.5" />}
                          </span>
                          <span>{loc.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="m-0 p-0 border-0">
                  <legend className="text-xs font-semibold text-ink-secondary mb-2.5 p-0">
                    {st.defaultThemeLabel}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['system', st.themeSystem],
                        ['dark', st.themeDark],
                        ['light', st.themeLight],
                      ] as [DefaultThemeSetting, string][]
                    ).map(([value, label]) => {
                      const active = draft.default_theme === value;
                      return (
                        <label
                          key={value}
                          className={`relative inline-flex items-center gap-1.5 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                            active
                              ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                              : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-ink-muted'
                          }`}
                        >
                          <input
                            type="radio"
                            name="default_theme"
                            value={value}
                            checked={active}
                            onChange={() =>
                              setDraft({ ...draft, default_theme: value })
                            }
                            className="sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className={`w-4 h-4 rounded-full inline-flex items-center justify-center border shrink-0 ${
                              active
                                ? 'bg-action-bg border-action-bg text-action-fg'
                                : 'bg-surface-sheet border-border-subtle'
                            }`}
                          >
                            {active && <IconCheck className="w-2.5 h-2.5" />}
                          </span>
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            </div>
          </section>

          {/* Group 3: Registration, Reader Features & Auto-Save */}
          <section className="studio-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40">
              <h2 className="text-sm font-semibold text-ink-primary m-0">
                {st.featuresGroup}
              </h2>
            </div>

            <div className="divide-y divide-border-subtle">
              <label className="flex items-center justify-between gap-4 px-5 py-3.5 cursor-pointer hover:bg-surface-raised/50 transition-colors">
                <span className="text-sm text-ink-primary">
                  {st.allowRegistrationLabel}
                </span>
                <input
                  type="checkbox"
                  name="allow_registration"
                  checked={draft.allow_registration}
                  onChange={(e) =>
                    setDraft({ ...draft, allow_registration: e.target.checked })
                  }
                  {...({ switch: '' } as Record<string, unknown>)}
                />
              </label>

              {draft.allow_registration && (
                <label className="flex items-center justify-between gap-4 px-5 py-3.5 cursor-pointer hover:bg-surface-raised/50 transition-colors">
                  <span className="text-sm text-ink-primary">
                    {rc3.allowAuthorRegistrationLabel}
                  </span>
                  <input
                    type="checkbox"
                    name="allow_author_registration"
                    checked={draft.allow_author_registration}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        allow_author_registration: e.target.checked,
                      })
                    }
                    {...({ switch: '' } as Record<string, unknown>)}
                  />
                </label>
              )}

              {(
                [
                  ['enable_margin_notes', st.enableMarginNotesLabel],
                  ['enable_likes', st.enableLikesLabel],
                  ['enable_progress_tracking', st.enableProgressLabel],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 cursor-pointer hover:bg-surface-raised/50 transition-colors"
                >
                  <span className="text-sm text-ink-primary">{label}</span>
                  <input
                    type="checkbox"
                    name={key}
                    checked={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.checked })
                    }
                    {...({ switch: '' } as Record<string, unknown>)}
                  />
                </label>
              ))}

              <div className="px-5 py-3.5 space-y-3">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <span className="text-sm text-ink-primary">
                    {st.enableDraftAutosaveLabel}
                  </span>
                  <input
                    type="checkbox"
                    name="enable_draft_autosave"
                    checked={draft.enable_draft_autosave}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        enable_draft_autosave: e.target.checked,
                      })
                    }
                    className="shrink-0"
                    {...({ switch: '' } as Record<string, unknown>)}
                  />
                </label>

                {draft.enable_draft_autosave && (
                  <fieldset className="ui-panel-enter m-0 pt-2.5 border-0 border-t border-dashed border-border-subtle">
                    <legend className="text-xs font-semibold text-ink-secondary mb-2 p-0">
                      {st.draftAutosaveIntervalLabel}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {[10, 15, 30, 60].map((secs) => {
                        const active = draft.draft_autosave_interval_secs === secs;
                        return (
                          <label
                            key={secs}
                            className={`relative inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-xl text-xs font-mono tabular-nums border cursor-pointer transition-colors ${
                              active
                                ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                                : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-ink-muted'
                            }`}
                          >
                            <input
                              type="radio"
                              name="draft_autosave_interval_secs"
                              value={secs}
                              checked={active}
                              onChange={() =>
                                setDraft({
                                  ...draft,
                                  draft_autosave_interval_secs: secs,
                                })
                              }
                              className="sr-only"
                            />
                            <span
                              aria-hidden="true"
                              className={`w-3.5 h-3.5 rounded-full inline-flex items-center justify-center border shrink-0 ${
                                active
                                  ? 'bg-action-bg border-action-bg text-action-fg'
                                  : 'bg-surface-sheet border-border-subtle'
                              }`}
                            >
                              {active && <IconCheck className="w-2.5 h-2.5" />}
                            </span>
                            <span>{st.autosaveIntervalOption(secs)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              </div>
            </div>
          </section>

          {/* Group 4: External Site & WordPress SSO Integration */}
          <section className="studio-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40">
              <h2 className="text-sm font-semibold text-ink-primary m-0">
                {st.integrationGroup}
              </h2>
            </div>

            <div className="p-5 sm:p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                <div>
                  <label
                    htmlFor="set-blog-origin"
                    className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                  >
                    {st.blogOriginUrlLabel}
                  </label>
                  <input
                    id="set-blog-origin"
                    name="blog_origin_url"
                    type="url"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    value={draft.blog_origin_url}
                    onChange={(e) =>
                      setDraft({ ...draft, blog_origin_url: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                  />
                </div>

                <div>
                  <label
                    htmlFor="set-blog-label"
                    className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                  >
                    {st.blogNavLabelLabel}
                  </label>
                  <input
                    id="set-blog-label"
                    name="blog_nav_label"
                    type="text"
                    maxLength={160}
                    value={draft.blog_nav_label}
                    onChange={(e) =>
                      setDraft({ ...draft, blog_nav_label: e.target.value })
                    }
                    placeholder={st.blogNavLabelPlaceholder}
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                  />
                </div>

                <div>
                  <label
                    htmlFor="set-sso-param"
                    className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                  >
                    {st.ssoQueryParamLabel}
                  </label>
                  <input
                    id="set-sso-param"
                    name="sso_query_param"
                    type="text"
                    maxLength={48}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    value={draft.sso_query_param ?? 'sso_login'}
                    onChange={(e) =>
                      setDraft({ ...draft, sso_query_param: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between gap-4 pt-3 border-t border-border-subtle cursor-pointer">
                <span className="text-sm text-ink-primary">{st.ssoEnabledLabel}</span>
                <input
                  type="checkbox"
                  name="sso_enabled"
                  checked={draft.sso_enabled}
                  onChange={(e) =>
                    setDraft({ ...draft, sso_enabled: e.target.checked })
                  }
                  {...({ switch: '' } as Record<string, unknown>)}
                />
              </label>
            </div>
          </section>
        </form>
      )}

      {/* ================================================================= */}
      {/* SUB-CATEGORY 2: Multi-OAuth 2.0 / OIDC Identity Providers         */}
      {/* ================================================================= */}
      {activeTab === 'oauth' && (
        <form
          id="studio-settings-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-5"
          aria-labelledby="studio-settings-heading"
        >
          {/* Shared Callback URI + Quick-Add Preset Toolbar */}
          <section className="studio-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-primary m-0">
                {st.oauthGroup}
              </h2>
              <span className="text-xs font-mono text-ink-muted tabular-nums">
                {rc3.oauthProvidersCount(enabledProvidersCount, providers.length)}
              </span>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs text-ink-secondary m-0">
                  {rc3.oauthSharedCallbackHint}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded-xl bg-surface-sunken text-ink-secondary border border-border-subtle text-xs font-mono truncate">
                    {callbackUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopyCallback()}
                    className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <IconCopy className="w-3.5 h-3.5 text-ink-muted" />
                    <span>{rc3.copyCallbackBtn}</span>
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-dashed border-border-subtle flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAddOAuthProvider('github')}
                  className="min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer transition-colors"
                >
                  {rc3.oauthAddGithubBtn}
                </button>
                <button
                  type="button"
                  onClick={() => handleAddOAuthProvider('google')}
                  className="min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer transition-colors"
                >
                  {rc3.oauthAddGoogleBtn}
                </button>
                <button
                  type="button"
                  onClick={() => handleAddOAuthProvider('authentik')}
                  className="min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer transition-colors"
                >
                  {rc3.oauthAddAuthentikBtn}
                </button>
                <button
                  type="button"
                  onClick={() => handleAddOAuthProvider('custom')}
                  className="min-h-8 px-3 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer"
                >
                  {rc3.oauthAddCustomBtn}
                </button>
              </div>
            </div>
          </section>

          {providers.length === 0 ? (
            <div className="studio-panel p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-ink-primary m-0">
                {rc3.oauthEmptyTitle}
              </p>
              <p className="text-xs text-ink-muted m-0 max-w-md mx-auto leading-relaxed">
                {rc3.oauthEmptyDesc}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {providers.map((provider, idx) => {
                const secretSaved = hasSavedSecretForProvider(provider.id);
                const secretInput = providerSecretInputs[provider.id] ?? '';
                const titleText =
                  provider.name.trim() || provider.id || `OAuth #${idx + 1}`;
                return (
                  <section
                    key={`${provider.id}-${idx}`}
                    className="studio-panel overflow-hidden"
                  >
                    <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <h3 className="text-sm font-semibold text-ink-primary m-0 truncate">
                          {titleText}
                        </h3>
                        <code className="px-1.5 py-0.5 rounded-md text-xs font-mono bg-surface-sunken text-ink-muted border border-border-subtle shrink-0">
                          {provider.id || `provider-${idx + 1}`}
                        </code>
                        <span
                          className="px-2 py-0.5 rounded-md text-xs font-semibold shrink-0"
                          style={
                            provider.enabled
                              ? {
                                  backgroundColor: 'var(--alert-mint-badge-bg)',
                                  color: 'var(--alert-mint-badge-fg)',
                                }
                              : {
                                  backgroundColor: 'var(--surface-sunken)',
                                  color: 'var(--ink-muted)',
                                }
                          }
                        >
                          {provider.enabled
                            ? rc3.oauthStatusEnabled
                            : rc3.oauthStatusDisabled}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <label className="inline-flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
                          <span>{st.oauthEnabledLabel}</span>
                          <input
                            type="checkbox"
                            checked={provider.enabled}
                            onChange={(e) =>
                              handleUpdateOAuthProvider(idx, {
                                enabled: e.target.checked,
                              })
                            }
                            {...({ switch: '' } as Record<string, unknown>)}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => handleRemoveOAuthProvider(idx)}
                          className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                          <span>{rc3.oauthRemoveProviderBtn}</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-5 sm:p-6 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label
                            htmlFor={`oauth-name-${idx}`}
                            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                          >
                            {st.oauthProviderNameLabel}
                          </label>
                          <input
                            id={`oauth-name-${idx}`}
                            type="text"
                            maxLength={48}
                            value={provider.name}
                            onChange={(e) =>
                              handleUpdateOAuthProvider(idx, {
                                name: e.target.value,
                              })
                            }
                            placeholder="GitHub / Google / Authentik"
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor={`oauth-id-${idx}`}
                            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                          >
                            {rc3.oauthProviderIdLabel}
                          </label>
                          <input
                            id={`oauth-id-${idx}`}
                            type="text"
                            maxLength={32}
                            spellCheck={false}
                            autoCapitalize="none"
                            value={provider.id}
                            onChange={(e) => {
                              const prevId = provider.id;
                              const nextId = e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9_-]/g, '');
                              handleUpdateOAuthProvider(idx, { id: nextId });
                              if (
                                prevId !== nextId &&
                                providerSecretInputs[prevId] !== undefined
                              ) {
                                setProviderSecretInputs((prevMap) => {
                                  const nextMap = { ...prevMap };
                                  nextMap[nextId] = nextMap[prevId];
                                  delete nextMap[prevId];
                                  return nextMap;
                                });
                              }
                            }}
                            placeholder="github"
                            title={rc3.oauthProviderIdHint}
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor={`oauth-scopes-${idx}`}
                            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                          >
                            {st.oauthScopesLabel}
                          </label>
                          <input
                            id={`oauth-scopes-${idx}`}
                            type="text"
                            spellCheck={false}
                            value={provider.scopes}
                            onChange={(e) =>
                              handleUpdateOAuthProvider(idx, {
                                scopes: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor={`oauth-cid-${idx}`}
                            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                          >
                            {st.oauthClientIdLabel}
                          </label>
                          <input
                            id={`oauth-cid-${idx}`}
                            type="text"
                            spellCheck={false}
                            value={provider.client_id}
                            onChange={(e) =>
                              handleUpdateOAuthProvider(idx, {
                                client_id: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <label
                              htmlFor={`oauth-secret-${idx}`}
                              className="text-xs font-semibold text-ink-secondary"
                            >
                              {st.oauthClientSecretLabel}
                            </label>
                            {secretSaved && (
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-accent-success">
                                  ✓ {st.oauthSecretSavedBadge}
                                </span>
                                <button
                                  type="button"
                                  disabled={savingOAuthSecret}
                                  onClick={() =>
                                    void handleClearProviderSecret(provider.id)
                                  }
                                  className="text-accent-danger hover:underline cursor-pointer"
                                >
                                  {st.oauthClearSecretBtn}
                                </button>
                              </div>
                            )}
                          </div>
                          <input
                            id={`oauth-secret-${idx}`}
                            type="password"
                            autoComplete="new-password"
                            value={secretInput}
                            onChange={(e) =>
                              setProviderSecretInputs((prev) => ({
                                ...prev,
                                [provider.id]: e.target.value,
                              }))
                            }
                            placeholder={secretSaved ? '••••••••' : ''}
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label
                            htmlFor={`oauth-auth-${idx}`}
                            className="block mb-1 text-xs font-semibold text-ink-secondary"
                          >
                            {st.oauthAuthorizeUrlLabel}
                          </label>
                          <input
                            id={`oauth-auth-${idx}`}
                            type="url"
                            spellCheck={false}
                            value={provider.authorize_url}
                            onChange={(e) =>
                              handleUpdateOAuthProvider(idx, {
                                authorize_url: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`oauth-token-${idx}`}
                            className="block mb-1 text-xs font-semibold text-ink-secondary"
                          >
                            {st.oauthTokenUrlLabel}
                          </label>
                          <input
                            id={`oauth-token-${idx}`}
                            type="url"
                            spellCheck={false}
                            value={provider.token_url}
                            onChange={(e) =>
                              handleUpdateOAuthProvider(idx, {
                                token_url: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`oauth-user-${idx}`}
                            className="block mb-1 text-xs font-semibold text-ink-secondary"
                          >
                            {st.oauthUserinfoUrlLabel}
                          </label>
                          <input
                            id={`oauth-user-${idx}`}
                            type="url"
                            spellCheck={false}
                            value={provider.userinfo_url}
                            onChange={(e) =>
                              handleUpdateOAuthProvider(idx, {
                                userinfo_url: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </form>
      )}

      {/* ================================================================= */}
      {/* SUB-CATEGORY 3: Data Storage Backend Hot-Switch                   */}
      {/* ================================================================= */}
      {activeTab === 'storage' && (
        <section className="studio-panel overflow-hidden">
          <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-primary m-0">
              {st.storageGroup}
            </h2>
            {storageStatus && (
              <span className="px-2 py-0.5 rounded-lg text-xs font-mono bg-action-subtle text-link-ink font-semibold">
                {st.storageActiveBadge(storageStatus.active_backend)}
              </span>
            )}
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['local', st.storageModeLocal],
                  ['postgres', st.storageModePostgres],
                ] as const
              ).map(([val, label]) => {
                const active = storageMode === val;
                return (
                  <label
                    key={val}
                    className={`relative inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                      active
                        ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                        : 'bg-surface-raised border-border-subtle text-ink-secondary hover:border-ink-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name="storage_mode"
                      value={val}
                      checked={active}
                      onChange={() => setStorageMode(val)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`w-4 h-4 rounded-full inline-flex items-center justify-center border shrink-0 ${
                        active
                          ? 'bg-action-bg border-action-bg text-action-fg'
                          : 'bg-surface-sheet border-border-subtle'
                      }`}
                    >
                      {active && <IconCheck className="w-2.5 h-2.5" />}
                    </span>
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>

            {storageMode === 'postgres' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="set-pg-url" className="ink-field-label">
                    {st.postgresUrlLabel}
                  </label>
                  <input
                    id="set-pg-url"
                    type="text"
                    spellCheck={false}
                    autoCapitalize="none"
                    value={postgresUrl}
                    onChange={(e) => setPostgresUrl(e.target.value)}
                    placeholder={st.postgresUrlPlaceholder}
                    className="ink-field-input font-mono text-xs"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncContent}
                    onChange={(e) => setSyncContent(e.target.checked)}
                  />
                  <span>{st.storageSyncContentLabel}</span>
                </label>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {storageMode === 'postgres' && (
                <button
                  type="button"
                  disabled={testingStorage}
                  onClick={() => void handleTestStorage()}
                  className="min-h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer disabled:opacity-60 transition-colors"
                >
                  {testingStorage ? st.testingConnectionBtn : st.testConnectionBtn}
                </button>
              )}
              <button
                type="button"
                disabled={switchingStorage || !isStorageDirty}
                onClick={() => void handleApplyStorage()}
                className="min-h-9 px-4 py-1.5 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {switchingStorage ? st.applyingStorageBtn : st.applyStorageBtn}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* SUB-CATEGORY 4: SMTP Mail Delivery, HTML Footer & Auto-Height Preview */}
      {/* ================================================================= */}
      {activeTab === 'smtp' && (
        <section className="studio-panel overflow-hidden">
          <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-primary m-0">
              {rc3.smtpGroup}
            </h2>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm text-ink-primary">{rc3.smtpEnabledLabel}</span>
              <input
                type="checkbox"
                checked={smtpDraft.enabled}
                onChange={(e) =>
                  setSmtpDraft({ ...smtpDraft, enabled: e.target.checked })
                }
                {...({ switch: '' } as Record<string, unknown>)}
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
              <div className="sm:col-span-6">
                <label
                  htmlFor="smtp-host"
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {rc3.smtpHostLabel}
                </label>
                <input
                  id="smtp-host"
                  type="text"
                  spellCheck={false}
                  value={smtpDraft.host}
                  onChange={(e) =>
                    setSmtpDraft({ ...smtpDraft, host: e.target.value })
                  }
                  placeholder="smtp.example.com"
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="smtp-port"
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {rc3.smtpPortLabel}
                </label>
                <input
                  id="smtp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={smtpDraft.port}
                  onChange={(e) =>
                    setSmtpDraft({
                      ...smtpDraft,
                      port: Number(e.target.value) || 465,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono tabular-nums"
                />
              </div>
              <div className="sm:col-span-4">
                <label
                  htmlFor="smtp-enc"
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {rc3.smtpEncryptionLabel}
                </label>
                <select
                  id="smtp-enc"
                  value={smtpDraft.encryption}
                  onChange={(e) =>
                    setSmtpDraft({
                      ...smtpDraft,
                      encryption: e.target.value as 'tls' | 'starttls' | 'none',
                    })
                  }
                  className="ink-select w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                >
                  <option value="tls">{rc3.smtpEncTls}</option>
                  <option value="starttls">{rc3.smtpEncStarttls}</option>
                  <option value="none">{rc3.smtpEncNone}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="smtp-user"
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {rc3.smtpUsernameLabel}
                </label>
                <input
                  id="smtp-user"
                  type="text"
                  spellCheck={false}
                  value={smtpDraft.username}
                  onChange={(e) =>
                    setSmtpDraft({ ...smtpDraft, username: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label
                    htmlFor="smtp-pw"
                    className="text-xs font-semibold text-ink-secondary"
                  >
                    {rc3.smtpPasswordLabel}
                  </label>
                  {hasSmtpPassword && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-accent-success">
                        ✓ {rc3.smtpPasswordSavedBadge}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleClearSmtpPassword()}
                        className="text-accent-danger hover:underline cursor-pointer"
                      >
                        {rc3.smtpClearPasswordBtn}
                      </button>
                    </div>
                  )}
                </div>
                <input
                  id="smtp-pw"
                  type="password"
                  autoComplete="new-password"
                  value={smtpPasswordInput}
                  onChange={(e) => setSmtpPasswordInput(e.target.value)}
                  placeholder={hasSmtpPassword ? '••••••••' : ''}
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="smtp-from-name"
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {rc3.smtpFromNameLabel}
                </label>
                <input
                  id="smtp-from-name"
                  type="text"
                  value={smtpDraft.from_name}
                  onChange={(e) =>
                    setSmtpDraft({ ...smtpDraft, from_name: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs ink-input-inset"
                />
              </div>
              <div>
                <label
                  htmlFor="smtp-from-email"
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {rc3.smtpFromEmailLabel}
                </label>
                <input
                  id="smtp-from-email"
                  type="email"
                  value={smtpDraft.from_email}
                  onChange={(e) =>
                    setSmtpDraft({ ...smtpDraft, from_email: e.target.value })
                  }
                  placeholder="noreply@example.com"
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                />
              </div>
            </div>

            {/* Custom HTML Email Footer */}
            <div>
              <label
                htmlFor="smtp-email-footer"
                className="block mb-1 text-xs font-semibold text-ink-secondary"
              >
                {rc3.smtpEmailFooterLabel}
              </label>
              <textarea
                id="smtp-email-footer"
                rows={2}
                maxLength={1200}
                value={smtpDraft.email_footer_text}
                onChange={(e) =>
                  setSmtpDraft({ ...smtpDraft, email_footer_text: e.target.value })
                }
                placeholder={rc3.smtpEmailFooterPlaceholder}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono leading-relaxed ink-input-inset"
              />
              <p className="mt-1 text-xs text-ink-muted m-0">
                {rc3.smtpEmailFooterHint}
              </p>
            </div>

            {/* Send Test Email */}
            <div className="pt-3 border-t border-dashed border-border-subtle flex flex-wrap items-end gap-2.5">
              <div className="flex-1 min-w-48">
                <label
                  htmlFor="smtp-test-to"
                  className="block mb-1 text-xs font-semibold text-ink-secondary"
                >
                  {rc3.smtpTestEmailLabel}
                </label>
                <input
                  id="smtp-test-to"
                  type="email"
                  value={testEmailAddr}
                  onChange={(e) => setTestEmailAddr(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                />
              </div>
              <button
                type="button"
                disabled={testingSmtp || !testEmailAddr.trim()}
                onClick={() => void handleTestSmtp()}
                className="min-h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-60"
              >
                {testingSmtp ? rc3.smtpTestingBtn : rc3.smtpTestBtn}
              </button>
            </div>

            {/* Collapsible Custom Email Templates & Exact-Height Live Preview */}
            <div className="pt-2 border-t border-border-subtle">
              <button
                type="button"
                aria-expanded={templatesOpen}
                onClick={() => setTemplatesOpen((v) => !v)}
                className="text-xs font-semibold text-link-ink hover:underline cursor-pointer"
              >
                {templatesOpen ? '▾ ' : '▸ '}
                {rc3.smtpTemplatesToggle}
              </button>

              {templatesOpen && (
                <div className="mt-4 space-y-4 ui-panel-enter">
                  <p className="text-xs text-ink-muted m-0 font-mono leading-relaxed">
                    {rc3.smtpVarsHint}
                  </p>

                  <div className="space-y-2.5">
                    <div
                      role="tablist"
                      aria-label={rc3.smtpTemplatesToggle}
                      className="mwg-tablist max-w-full"
                      {...({
                        focusgroup: 'tablist nomemory',
                      } as Record<string, unknown>)}
                    >
                      {(
                        [
                          ['register_code', rc3.smtpRegisterCodeTab],
                          ['login_anomaly', rc3.smtpLoginAnomalyTab],
                          ['email_change', rc3.smtpEmailChangeTab],
                          ['invite', rc3.smtpInviteTab],
                          ['reset', rc3.smtpResetTab],
                          ['takedown', rc3.smtpTakedownTab],
                        ] as const
                      ).map(([kind, label], idx, list) => {
                        const active = activeTemplateKind === kind;
                        return (
                          <button
                            key={kind}
                            id={`smtp-tpl-tab-${kind}`}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            onClick={(e) => {
                              setActiveTemplateKind(kind);
                              e.currentTarget.scrollIntoView({
                                block: 'nearest',
                                inline: 'nearest',
                              });
                            }}
                            onKeyDown={(e) => {
                              if ('focusGroup' in HTMLElement.prototype) return;
                              let nextIdx = -1;
                              if (e.key === 'ArrowRight')
                                nextIdx = (idx + 1) % list.length;
                              else if (e.key === 'ArrowLeft')
                                nextIdx = (idx - 1 + list.length) % list.length;
                              else if (e.key === 'Home') nextIdx = 0;
                              else if (e.key === 'End') nextIdx = list.length - 1;
                              if (nextIdx >= 0) {
                                e.preventDefault();
                                const nextKind = list[nextIdx][0];
                                setActiveTemplateKind(nextKind);
                                const nextBtn = document.getElementById(
                                  `smtp-tpl-tab-${nextKind}`,
                                );
                                nextBtn?.focus();
                                nextBtn?.scrollIntoView({
                                  block: 'nearest',
                                  inline: 'nearest',
                                });
                              }
                            }}
                            className="mwg-tab"
                            {...(active
                              ? ({ focusgroupstart: '' } as Record<string, unknown>)
                              : {})}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        role="group"
                        className="inline-flex items-center gap-1 p-0.5 rounded-xl bg-surface-raised border border-border-subtle"
                      >
                        <button
                          type="button"
                          aria-pressed={templateViewMode === 'preview'}
                          onClick={() => setTemplateViewMode('preview')}
                          className={`min-h-7 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-colors ${
                            templateViewMode === 'preview'
                              ? 'font-semibold bg-surface-sheet text-ink-primary border border-border-subtle'
                              : 'text-ink-muted hover:text-ink-primary border border-transparent'
                          }`}
                        >
                          {rc3.smtpTemplatePreviewTab}
                        </button>
                        <button
                          type="button"
                          aria-pressed={templateViewMode === 'source'}
                          onClick={() => setTemplateViewMode('source')}
                          className={`min-h-7 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-colors ${
                            templateViewMode === 'source'
                              ? 'font-semibold bg-surface-sheet text-ink-primary border border-border-subtle'
                              : 'text-ink-muted hover:text-ink-primary border border-transparent'
                          }`}
                        >
                          {rc3.smtpTemplateSourceTab}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={resetCurrentTemplateToDefault}
                        className="min-h-8 px-2.5 py-1 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer transition-colors"
                      >
                        {rc3.smtpResetDefaultBtn}
                      </button>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-raised/50 border border-border-subtle space-y-3.5">
                    {activeTemplateKind !== 'email_change' && (
                      <div>
                        <label htmlFor="smtp-tpl-active-subj" className="ink-field-label">
                          {activeTemplateKind === 'register_code'
                            ? rc3.smtpRegisterSubjectLabel
                            : activeTemplateKind === 'login_anomaly'
                              ? rc3.smtpLoginAnomalySubjectLabel
                              : activeTemplateKind === 'invite'
                                ? rc3.smtpInviteSubjectLabel
                                : activeTemplateKind === 'reset'
                                  ? rc3.smtpResetSubjectLabel
                                  : rc3.smtpTakedownSubjectLabel}
                        </label>
                        <input
                          id="smtp-tpl-active-subj"
                          type="text"
                          value={currentTplSubject}
                          placeholder={rc3.smtpAutoLocalePlaceholder}
                          onChange={(e) =>
                            updateCurrentTemplateField('subject', e.target.value)
                          }
                          className="ink-field-input text-xs"
                        />
                      </div>
                    )}

                    {templateViewMode === 'source' &&
                    activeTemplateKind !== 'email_change' ? (
                      <div>
                        <label
                          htmlFor="smtp-tpl-active-html"
                          className="ink-field-label"
                        >
                          {activeTemplateKind === 'register_code'
                            ? rc3.smtpRegisterHtmlLabel
                            : activeTemplateKind === 'login_anomaly'
                              ? rc3.smtpLoginAnomalyHtmlLabel
                              : activeTemplateKind === 'invite'
                                ? rc3.smtpInviteHtmlLabel
                                : activeTemplateKind === 'reset'
                                  ? rc3.smtpResetHtmlLabel
                                  : rc3.smtpTakedownHtmlLabel}
                        </label>
                        <textarea
                          id="smtp-tpl-active-html"
                          rows={10}
                          value={currentTplHtml}
                          placeholder={rc3.smtpAutoLocalePlaceholder}
                          onChange={(e) =>
                            updateCurrentTemplateField('html', e.target.value)
                          }
                          className="ink-field-input text-xs font-mono leading-relaxed"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 rounded-xl bg-surface-sheet border border-border-subtle">
                          <div
                            className="flex-1 text-xs text-ink-primary min-w-44 truncate"
                            title={templatePreview?.subject || currentTplSubject || ''}
                          >
                            <span className="font-semibold text-ink-muted">
                              {rc3.smtpPreviewSubjectPrefix}
                            </span>
                            <span className="font-semibold">
                              {templatePreview?.subject || currentTplSubject || '…'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <div
                              role="group"
                              aria-label={rc3.smtpPreviewLocaleLabel}
                              className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-raised border border-border-subtle"
                            >
                              {LOCALES.map((loc) => (
                                <button
                                  key={loc.code}
                                  type="button"
                                  aria-pressed={previewLocale === loc.code}
                                  onClick={() => setPreviewLocale(loc.code)}
                                  className={`px-2 py-0.5 rounded-md text-xs cursor-pointer transition-colors ${
                                    previewLocale === loc.code
                                      ? 'font-semibold bg-surface-sheet text-ink-primary'
                                      : 'text-ink-muted hover:text-ink-primary'
                                  }`}
                                >
                                  {loc.short}
                                </button>
                              ))}
                            </div>

                            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-surface-raised border border-border-subtle">
                              <button
                                type="button"
                                aria-pressed={previewViewport === 'desktop'}
                                onClick={() => setPreviewViewport('desktop')}
                                className={`px-2 py-0.5 rounded-md text-xs cursor-pointer transition-colors ${
                                  previewViewport === 'desktop'
                                    ? 'font-semibold bg-surface-sheet text-ink-primary'
                                    : 'text-ink-muted hover:text-ink-primary'
                                }`}
                              >
                                {rc3.smtpViewportDesktop}
                              </button>
                              <button
                                type="button"
                                aria-pressed={previewViewport === 'mobile'}
                                onClick={() => setPreviewViewport('mobile')}
                                className={`px-2 py-0.5 rounded-md text-xs cursor-pointer transition-colors ${
                                  previewViewport === 'mobile'
                                    ? 'font-semibold bg-surface-sheet text-ink-primary'
                                    : 'text-ink-muted hover:text-ink-primary'
                                }`}
                              >
                                {rc3.smtpViewportMobile}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl bg-surface-sunken border border-border-subtle p-3 flex justify-center overflow-x-auto">
                          {loadingPreview && !templatePreview ? (
                            <div className="w-full h-60 flex items-center justify-center text-xs text-ink-muted">
                              {rc3.smtpPreviewLoading}
                            </div>
                          ) : (
                            <iframe
                              ref={previewIframeRef}
                              title={templatePreview?.subject || activeTemplateKind}
                              sandbox="allow-same-origin"
                              scrolling="no"
                              onLoad={measurePreviewIframe}
                              srcDoc={buildSandboxedEmailDoc(
                                templatePreview?.html ?? '',
                              )}
                              style={{ height: `${previewIframeHeight}px` }}
                              className={`block rounded-xl border border-border-subtle overflow-hidden transition-[width] ${
                                previewViewport === 'mobile'
                                  ? 'w-[375px] max-w-full'
                                  : 'w-full max-w-[620px]'
                              }`}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* SUB-CATEGORY 5: Version & Site Update Check                       */}
      {/* ================================================================= */}
      {activeTab === 'updates' && (
        <section className="studio-panel overflow-hidden">
          <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-primary m-0">
              {st.updateGroup}
            </h2>
          </div>

          <div className="p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
            <dl className="m-0 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <div className="flex items-baseline gap-2">
                <dt className="text-ink-muted">{st.currentVersionLabel}</dt>
                <dd className="m-0 font-mono font-semibold text-ink-primary">
                  {updateResult?.current_version ?? APP_VERSION}
                </dd>
              </div>

              {updateResult && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-ink-muted">{st.latestVersionLabel}</dt>
                  <dd className="m-0 font-mono text-ink-secondary">
                    {updateResult.latest_version}
                  </dd>
                </div>
              )}
            </dl>

            <div
              role="status"
              aria-live="polite"
              className="flex flex-wrap items-center gap-3 text-xs"
            >
              {!checkingUpdate && updateError && (
                <span className="font-semibold text-accent-danger">
                  {st.updateCheckFailed}
                </span>
              )}

              {!checkingUpdate && !updateError && updateResult && (
                <>
                  {updateResult.has_update ? (
                    <span
                      className="px-2 py-0.5 rounded font-mono font-semibold"
                      style={{
                        backgroundColor: 'var(--alert-warn-badge-bg)',
                        color: 'var(--alert-warn-badge-fg)',
                      }}
                    >
                      {st.updateAvailableBadge(updateResult.latest_version)}
                    </span>
                  ) : (
                    <span className="font-semibold text-accent-success">
                      ✓ {st.upToDateBadge}
                    </span>
                  )}

                  <a
                    href={updateResult.release_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center min-h-7 py-1 font-semibold text-link-ink no-underline hover:underline"
                  >
                    {st.viewReleaseLink}
                  </a>
                </>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
