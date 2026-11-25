/*
 * Decoupled Mail Delivery (SMTP / Cloudflare Email Sending API) & Live Template Preview Tab.
 * Hierarchy: Primary = Active channel badge, enable switch, mutually exclusive transport selector + credentials;
 * Secondary = Sender identity, pre-flight MX guard switch, live Delivery Guard & circuit status panel;
 * Tertiary = Custom footer, test email strip, collapsible template preview.
 * Tokens: surface-raised, surface-sheet, border-border-subtle, ink-primary/secondary/muted, StatusBadge tones.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getActiveStorageScopeKey } from '../../../lib/api';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '../../../lib/email';
import { EXT_COPY, getEnabledLocaleMetas } from '../../../lib/i18n';
import type {
  LocaleCode,
  MailGuardStatusDto,
  MailProviderKind,
  SiteSettingsDto,
  SmtpSettingsDto,
  SmtpStatusResponseDto,
} from '../../../lib/types';
import {
  readViewCache,
  scopedViewCacheKey,
  writeViewCache,
} from '../../../lib/viewCache';
import { RadioCardGroup, SwitchRow } from '../../ui/FormControls';
import { IconAlertCircle, IconCheck, IconChevronRight, IconShield } from '../../ui/Icons';
import { InkSelect } from '../../ui/InkSelect';
import { PasswordInput } from '../../ui/PasswordInput';
import { StatusBadge } from '../../ui/StatusBadge';
import { SegmentedControl, UnderlineTabs } from '../../ui/Tabs';
import { useToast } from '../../ui/ToastProvider';
import { SettingsSectionCard } from './SettingsSectionCard';

export const DEFAULT_SMTP_STATE: SmtpSettingsDto = {
  enabled: false,
  provider: 'smtp',
  host: '',
  port: 465,
  encryption: 'tls',
  username: '',
  cloudflare_account_id: '',
  verify_recipient_mx: true,
  from_name: '',
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
  ban_subject: '',
  ban_html: '',
};

type MailTemplateKind =
  | 'register_code'
  | 'login_anomaly'
  | 'email_change'
  | 'invite'
  | 'reset'
  | 'takedown'
  | 'account_ban';

function neutralizeEmailPreviewLinks(rawBodyHtml: string): string {
  if (typeof DOMParser === 'undefined' || !rawBodyHtml.trim()) {
    return rawBodyHtml;
  }
  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(rawBodyHtml, 'text/html');
    parsed.body.querySelectorAll('a').forEach((anchor) => {
      const targetHref = anchor.getAttribute('href');
      if (targetHref !== null) {
        if (targetHref.trim() && !anchor.getAttribute('title')) {
          anchor.setAttribute('title', targetHref.trim());
        }
        anchor.removeAttribute('href');
      }
      anchor.removeAttribute('target');
      anchor.setAttribute('role', 'link');
      const existingStyle = anchor.getAttribute('style') ?? '';
      if (!existingStyle.toLowerCase().includes('cursor')) {
        anchor.setAttribute(
          'style',
          existingStyle
            ? `${existingStyle.replace(/;+\s*$/, '')};cursor:default`
            : 'cursor:default',
        );
      }
    });
    parsed.body.querySelectorAll('form').forEach((form) => {
      form.removeAttribute('action');
    });
    return parsed.body.innerHTML;
  } catch {
    return rawBodyHtml;
  }
}

function buildSandboxedEmailDoc(bodyHtml: string): string {
  const safeBody = neutralizeEmailPreviewLinks(bodyHtml);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background-color:#f4efe3;background-image:radial-gradient(#cfc5b0 1px,transparent 1px);background-size:18px 18px;overflow-x:auto;overflow-y:hidden;}a,[role="link"]{color:#4c1d95;}</style></head><body>${safeBody}</body></html>`;
}

export interface SmtpSettingsTabProps {
  locale: LocaleCode;
  settings: SiteSettingsDto;
  enabledLocales: LocaleCode[];
  saveTrigger: number;
  onDirtyAndSavingChange: (dirty: boolean, saving: boolean) => void;
}

export function SmtpSettingsTab({
  locale,
  settings,
  enabledLocales,
  saveTrigger,
  onDirtyAndSavingChange,
}: SmtpSettingsTabProps) {
  const extSettings = EXT_COPY[locale].settings;
  const toast = useToast();

  const storageScope = getActiveStorageScopeKey();
  const smtpCacheKey = scopedViewCacheKey(storageScope, 'studio:smtp:status');
  const [cachedInitialStatus] = useState<SmtpStatusResponseDto | null>(() =>
    readViewCache<SmtpStatusResponseDto>(smtpCacheKey),
  );

  const [loaded, setLoaded] = useState(() => Boolean(cachedInitialStatus));
  const [smtpDraft, setSmtpDraft] = useState<SmtpSettingsDto>(() =>
    cachedInitialStatus
      ? { ...DEFAULT_SMTP_STATE, ...cachedInitialStatus.settings }
      : DEFAULT_SMTP_STATE,
  );
  const [savedBaseline, setSavedBaseline] = useState<SmtpSettingsDto>(() =>
    cachedInitialStatus
      ? { ...DEFAULT_SMTP_STATE, ...cachedInitialStatus.settings }
      : DEFAULT_SMTP_STATE,
  );
  const [hasPassword, setHasPassword] = useState(
    () => cachedInitialStatus?.has_password ?? false,
  );
  const [passwordInput, setPasswordInput] = useState('');
  const [hasCfToken, setHasCfToken] = useState(
    () => cachedInitialStatus?.has_cloudflare_api_token ?? false,
  );
  const [cfTokenInput, setCfTokenInput] = useState('');
  const [activeProvider, setActiveProvider] =
    useState<MailProviderKind | null>(
      () => cachedInitialStatus?.active_provider ?? null,
    );
  const [guardStatus, setGuardStatus] = useState<MailGuardStatusDto | null>(
    () => cachedInitialStatus?.guard_status ?? null,
  );
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testEmailAddr, setTestEmailAddr] = useState('');
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [guardBusy, setGuardBusy] = useState(false);

  const savingRef = useRef(false);
  const testingRef = useRef(false);
  const guardActionRef = useRef(false);
  const isDirtyRef = useRef(false);

  const [templatesOpen, setTemplatesOpen] = useState(true);
  const [activeTemplateKind, setActiveTemplateKind] =
    useState<MailTemplateKind>('register_code');
  const [templateViewMode, setTemplateViewMode] = useState<'preview' | 'source'>(
    'preview',
  );
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>(
    () =>
      typeof window !== 'undefined' && window.innerWidth < 640
        ? 'mobile'
        : 'desktop',
  );
  const [previewLocale, setPreviewLocale] = useState<LocaleCode>(locale);
  const previewCacheKey = scopedViewCacheKey(
    storageScope,
    `studio:smtp:preview:${activeTemplateKind}:${previewLocale}`,
  );
  const previewHeightCacheKey = scopedViewCacheKey(
    storageScope,
    `studio:smtp:height:${previewViewport}`,
  );
  const previewHeightCacheKeyRef = useRef(previewHeightCacheKey);
  previewHeightCacheKeyRef.current = previewHeightCacheKey;
  const hasCompletedInitialPreviewRef = useRef(false);

  const [templatePreview, setTemplatePreview] = useState<{
    subject: string;
    html: string;
  } | null>(() =>
    readViewCache<{ subject: string; html: string }>(previewCacheKey),
  );
  const [loadingPreview, setLoadingPreview] = useState(false);

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewResizeObserverRef = useRef<ResizeObserver | null>(null);
  const onDirtyAndSavingChangeRef = useRef(onDirtyAndSavingChange);
  onDirtyAndSavingChangeRef.current = onDirtyAndSavingChange;
  const [previewIframeHeight, setPreviewIframeHeight] = useState<number>(
    () => readViewCache<number>(previewHeightCacheKey) ?? 480,
  );

  useEffect(() => {
    const cachedHeight = readViewCache<number>(previewHeightCacheKey);
    if (cachedHeight && cachedHeight > 40) {
      setPreviewIframeHeight(cachedHeight);
    }
  }, [previewHeightCacheKey]);

  useEffect(() => {
    setPreviewLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (enabledLocales.length > 0 && !enabledLocales.includes(previewLocale)) {
      setPreviewLocale(enabledLocales[0]);
    }
  }, [enabledLocales, previewLocale]);

  const applyStatusResponse = useCallback(
    (
      res: SmtpStatusResponseDto,
      options?: { preserveDirtyDraft?: boolean },
    ) => {
      writeViewCache(smtpCacheKey, res);
      const merged = { ...DEFAULT_SMTP_STATE, ...res.settings };
      if (!(options?.preserveDirtyDraft && isDirtyRef.current)) {
        setSmtpDraft(merged);
      }
      setSavedBaseline(merged);
      setHasPassword(res.has_password);
      setHasCfToken(res.has_cloudflare_api_token);
      setActiveProvider(res.active_provider);
      setGuardStatus(res.guard_status);
    },
    [smtpCacheKey],
  );

  useEffect(() => {
    let active = true;
    void api
      .adminGetSmtp()
      .then((res) => {
        if (!active) return;
        applyStatusResponse(res, { preserveDirtyDraft: true });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [applyStatusResponse]);

  const isDirty =
    loaded &&
    (JSON.stringify(smtpDraft) !== JSON.stringify(savedBaseline) ||
      passwordInput.trim().length > 0 ||
      cfTokenInput.trim().length > 0);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    onDirtyAndSavingChangeRef.current(isDirty, savingSmtp);
  }, [isDirty, savingSmtp]);

  const handleSaveSmtp = useCallback(async () => {
    if (savingRef.current || !loaded) return;
    let nextDraft = smtpDraft;
    if (smtpDraft.enabled || smtpDraft.from_email.trim()) {
      const normalizedFrom = normalizeEmail(smtpDraft.from_email);
      if (!normalizedFrom) {
        toast.error('INVALID_EMAIL');
        return;
      }
      if (normalizedFrom !== smtpDraft.from_email) {
        nextDraft = { ...smtpDraft, from_email: normalizedFrom };
      }
    }
    savingRef.current = true;
    setSavingSmtp(true);
    try {
      const res = await api.adminUpdateSmtp({
        settings: nextDraft,
        password: passwordInput.trim() || undefined,
        cloudflare_api_token: cfTokenInput.trim() || undefined,
      });
      applyStatusResponse(res);
      setPasswordInput('');
      setCfTokenInput('');
      toast.success(extSettings.smtpSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      savingRef.current = false;
      setSavingSmtp(false);
    }
  }, [
    applyStatusResponse,
    cfTokenInput,
    extSettings.smtpSavedMsg,
    loaded,
    passwordInput,
    smtpDraft,
    toast,
  ]);

  useEffect(() => {
    if (saveTrigger > 0) {
      void handleSaveSmtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTrigger]);

  const handleClearPassword = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingSmtp(true);
    try {
      const res = await api.adminUpdateSmtp({
        settings: smtpDraft,
        clear_password: true,
      });
      applyStatusResponse(res);
      setPasswordInput('');
      toast.success(extSettings.smtpSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      savingRef.current = false;
      setSavingSmtp(false);
    }
  };

  const handleClearCfToken = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingSmtp(true);
    try {
      const nextSettings: SmtpSettingsDto =
        smtpDraft.provider === 'cloudflare_api' && smtpDraft.enabled
          ? { ...smtpDraft, enabled: false }
          : smtpDraft;
      const res = await api.adminUpdateSmtp({
        settings: nextSettings,
        clear_cloudflare_api_token: true,
      });
      applyStatusResponse(res);
      setCfTokenInput('');
      toast.success(extSettings.smtpSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      savingRef.current = false;
      setSavingSmtp(false);
    }
  };

  const handleTestSmtp = async () => {
    const normalizedTo = normalizeEmail(testEmailAddr);
    if (!normalizedTo) {
      toast.error('INVALID_EMAIL');
      return;
    }
    const normalizedFrom = normalizeEmail(smtpDraft.from_email);
    if (!normalizedFrom) {
      toast.error('INVALID_EMAIL');
      return;
    }
    if (testingRef.current) return;
    testingRef.current = true;
    setTestingSmtp(true);
    try {
      const res = await api.adminTestSmtp({
        to_email: normalizedTo,
        settings: { ...smtpDraft, from_email: normalizedFrom },
        password: passwordInput.trim() || undefined,
        cloudflare_api_token: cfTokenInput.trim() || undefined,
        locale,
      });
      if (res.guard_status) {
        setGuardStatus(res.guard_status);
      }
      toast.success(extSettings.smtpTestSentMsg);
    } catch (err) {
      toast.error(err);
      void api
        .adminGetSmtp()
        .then((fresh) => {
          setGuardStatus(fresh.guard_status);
        })
        .catch(() => {});
    } finally {
      testingRef.current = false;
      setTestingSmtp(false);
    }
  };

  const handleResetCircuit = async () => {
    if (guardActionRef.current) return;
    guardActionRef.current = true;
    setGuardBusy(true);
    try {
      const nextGuard = await api.adminResetMailCircuit();
      setGuardStatus(nextGuard);
      toast.success(extSettings.mailGuardCircuitResetMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      guardActionRef.current = false;
      setGuardBusy(false);
    }
  };

  const handleClearSuppression = async (payload: {
    email?: string;
    clear_all?: boolean;
  }) => {
    if (guardActionRef.current) return;
    guardActionRef.current = true;
    setGuardBusy(true);
    try {
      const nextGuard = await api.adminClearMailSuppression(payload);
      setGuardStatus(nextGuard);
      toast.success(extSettings.mailGuardSuppressedClearedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      guardActionRef.current = false;
      setGuardBusy(false);
    }
  };

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
              : activeTemplateKind === 'account_ban'
                ? smtpDraft.ban_subject
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
              : activeTemplateKind === 'account_ban'
                ? smtpDraft.ban_html
                : smtpDraft.takedown_html;

  useEffect(() => {
    if (activeTemplateKind === 'email_change' && templateViewMode !== 'preview') {
      setTemplateViewMode('preview');
    }
  }, [activeTemplateKind, templateViewMode]);

  useEffect(() => {
    if (!loaded || !templatesOpen || templateViewMode !== 'preview') {
      return;
    }
    let active = true;
    const cachedPreview = readViewCache<{ subject: string; html: string }>(
      previewCacheKey,
    );
    if (cachedPreview) {
      setTemplatePreview(cachedPreview);
      setLoadingPreview(false);
    } else {
      setLoadingPreview(true);
    }
    const delayMs =
      !hasCompletedInitialPreviewRef.current || !cachedPreview ? 0 : 180;
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
          if (!active) return;
          hasCompletedInitialPreviewRef.current = true;
          writeViewCache(previewCacheKey, res);
          setTemplatePreview(res);
        })
        .catch(() => {
          if (active && !cachedPreview) setTemplatePreview(null);
        })
        .finally(() => {
          if (active) setLoadingPreview(false);
        });
    }, delayMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    loaded,
    templatesOpen,
    templateViewMode,
    activeTemplateKind,
    currentTplSubject,
    currentTplHtml,
    smtpDraft.email_footer_text,
    previewLocale,
    previewCacheKey,
    settings.logo_url,
    settings.site_name,
  ]);

  const measurePreviewIframe = useCallback(() => {
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return;
      if (!doc.body.dataset.navGuarded) {
        doc.body.dataset.navGuarded = '1';
        doc.addEventListener(
          'click',
          (ev) => {
            const target = ev.target as Element | null;
            if (target?.closest?.('a, button, [role="link"]')) {
              ev.preventDefault();
            }
          },
          true,
        );
        doc.addEventListener('submit', (ev) => ev.preventDefault(), true);
      }
      const firstChild = doc.body.firstElementChild as HTMLElement | null;
      const syncHeight = () => {
        const target = doc.body.firstElementChild as HTMLElement | null;
        const measured = target
          ? Math.ceil(target.getBoundingClientRect().height)
          : Math.ceil(doc.body.scrollHeight);
        if (measured > 40) {
          setPreviewIframeHeight(measured);
          writeViewCache(previewHeightCacheKeyRef.current, measured);
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
      // ignore cross-origin guard
    }
  }, []);

  useEffect(() => {
    return () => {
      previewResizeObserverRef.current?.disconnect();
      previewResizeObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      measurePreviewIframe();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [previewViewport, templatePreview?.html, measurePreviewIframe]);

  const updateCurrentTemplateField = (field: 'subject' | 'html', value: string) => {
    if (activeTemplateKind === 'email_change') return;
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
      if (activeTemplateKind === 'account_ban') {
        return field === 'subject'
          ? { ...prev, ban_subject: value }
          : { ...prev, ban_html: value };
      }
      return field === 'subject'
        ? { ...prev, takedown_subject: value }
        : { ...prev, takedown_html: value };
    });
  };

  const isCloudflareProvider = smtpDraft.provider === 'cloudflare_api';

  const headerTrailing = loaded ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeProvider === 'cloudflare_api' ? (
        <StatusBadge tone="success" pill>
          <IconCheck className="w-3 h-3" />
          <span>{extSettings.smtpActiveBadgeCloudflare}</span>
        </StatusBadge>
      ) : activeProvider === 'smtp' ? (
        <StatusBadge tone="success" pill>
          <IconCheck className="w-3 h-3" />
          <span>{extSettings.smtpActiveBadgeSmtp}</span>
        </StatusBadge>
      ) : (
        <StatusBadge tone="neutral" pill>
          <span>{extSettings.smtpActiveBadgeDisabled}</span>
        </StatusBadge>
      )}
      {guardStatus?.circuit_open && (
        <StatusBadge tone="danger" pill>
          <IconAlertCircle className="w-3 h-3" />
          <span>{extSettings.mailGuardCircuitOpen}</span>
        </StatusBadge>
      )}
    </div>
  ) : undefined;

  return (
    <SettingsSectionCard title={extSettings.smtpGroup} trailing={headerTrailing}>
      {!loaded ? (
        <div className="space-y-4 ui-skeleton-delayed" aria-busy="true">
          <div className="h-9 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
          <div className="h-24 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
          <div className="h-24 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
        </div>
      ) : (
        <div className="space-y-5">
          <SwitchRow
            label={extSettings.smtpEnabledLabel}
            checked={smtpDraft.enabled}
            onChange={(checked) =>
              setSmtpDraft((prev) => ({ ...prev, enabled: checked }))
            }
            variant="inline"
            className="w-full justify-between text-sm text-ink-primary"
          />

          {/* Mutually Exclusive Delivery Transport Selector */}
          <div className="space-y-1.5">
            <RadioCardGroup<MailProviderKind>
              name="mail-delivery-provider"
              legend={extSettings.smtpProviderLabel}
              value={smtpDraft.provider}
              onChange={(nextProvider) =>
                setSmtpDraft((prev) => ({ ...prev, provider: nextProvider }))
              }
              columnsClass="grid-cols-1 sm:grid-cols-2"
              options={[
                {
                  value: 'smtp',
                  title: extSettings.smtpProviderSmtp,
                  hint: extSettings.smtpProviderSmtpHint,
                },
                {
                  value: 'cloudflare_api',
                  title: extSettings.smtpProviderCloudflare,
                  hint: extSettings.smtpProviderCloudflareHint,
                },
              ]}
            />
            <p className="text-xs text-ink-muted m-0 leading-relaxed">
              {extSettings.smtpProviderExclusiveHint}
            </p>
          </div>

          {/* Active Transport Credentials (Strictly One Provider Shown) */}
          {isCloudflareProvider ? (
            <div className="p-4 rounded-xl bg-surface-raised/50 border border-border-subtle space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor="cf-account-id"
                    className="block mb-1 text-xs font-semibold text-ink-secondary"
                  >
                    {extSettings.cfAccountIdLabel}
                  </label>
                  <input
                    id="cf-account-id"
                    name="cloudflare_account_id"
                    type="text"
                    maxLength={64}
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-describedby="cf-setup-hint"
                    value={smtpDraft.cloudflare_account_id}
                    onChange={(e) =>
                      setSmtpDraft({
                        ...smtpDraft,
                        cloudflare_account_id: e.target.value,
                      })
                    }
                    placeholder={extSettings.cfAccountIdPlaceholder}
                    className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label
                      htmlFor="cf-api-token"
                      className="text-xs font-semibold text-ink-secondary"
                    >
                      {extSettings.cfApiTokenLabel}
                    </label>
                    {hasCfToken && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-accent-success inline-flex items-center gap-1">
                          <IconCheck className="w-3 h-3" />
                          <span>{extSettings.cfApiTokenSavedBadge}</span>
                        </span>
                        <button
                          type="button"
                          disabled={savingSmtp}
                          onClick={() => void handleClearCfToken()}
                          className="text-accent-danger hover:underline cursor-pointer disabled:opacity-50"
                        >
                          {extSettings.cfClearTokenBtn}
                        </button>
                      </div>
                    )}
                  </div>
                  <PasswordInput
                    id="cf-api-token"
                    name="cloudflare_api_token"
                    locale={locale}
                    variant="compact"
                    autoComplete="new-password"
                    aria-describedby="cf-setup-hint"
                    value={cfTokenInput}
                    onChange={(e) => setCfTokenInput(e.target.value)}
                    placeholder={hasCfToken ? '••••••••' : ''}
                  />
                </div>
              </div>
              <p
                id="cf-setup-hint"
                className="text-xs text-ink-muted m-0 leading-relaxed"
              >
                {extSettings.cfSetupHint}
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-surface-raised/50 border border-border-subtle space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                <div className="sm:col-span-6">
                  <label
                    htmlFor="smtp-host"
                    className="block mb-1 text-xs font-semibold text-ink-secondary"
                  >
                    {extSettings.smtpHostLabel}
                  </label>
                  <input
                    id="smtp-host"
                    name="smtp_host"
                    type="text"
                    autoCorrect="off"
                    autoCapitalize="none"
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
                    {extSettings.smtpPortLabel}
                  </label>
                  <input
                    id="smtp-port"
                    name="smtp_port"
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
                    {extSettings.smtpEncryptionLabel}
                  </label>
                  <InkSelect
                    id="smtp-enc"
                    value={smtpDraft.encryption}
                    onChange={(nextEnc) =>
                      setSmtpDraft({
                        ...smtpDraft,
                        encryption: nextEnc as 'tls' | 'starttls' | 'none',
                      })
                    }
                    options={[
                      { value: 'tls', label: extSettings.smtpEncTls },
                      { value: 'starttls', label: extSettings.smtpEncStarttls },
                      { value: 'none', label: extSettings.smtpEncNone },
                    ]}
                    triggerClassName="w-full min-h-9 px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border-border-subtle text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor="smtp-user"
                    className="block mb-1 text-xs font-semibold text-ink-secondary"
                  >
                    {extSettings.smtpUsernameLabel}
                  </label>
                  <input
                    id="smtp-user"
                    name="smtp_username"
                    type="text"
                    autoCorrect="off"
                    autoCapitalize="none"
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
                      {extSettings.smtpPasswordLabel}
                    </label>
                    {hasPassword && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-accent-success inline-flex items-center gap-1">
                          <IconCheck className="w-3 h-3" />
                          <span>{extSettings.smtpPasswordSavedBadge}</span>
                        </span>
                        <button
                          type="button"
                          disabled={savingSmtp}
                          onClick={() => void handleClearPassword()}
                          className="text-accent-danger hover:underline cursor-pointer disabled:opacity-50"
                        >
                          {extSettings.smtpClearPasswordBtn}
                        </button>
                      </div>
                    )}
                  </div>
                  <PasswordInput
                    id="smtp-pw"
                    name="smtp_password"
                    locale={locale}
                    variant="compact"
                    autoComplete="new-password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder={hasPassword ? '••••••••' : ''}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Shared Sender Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="smtp-from-name"
                className="block mb-1 text-xs font-semibold text-ink-secondary"
              >
                {extSettings.smtpFromNameLabel}
              </label>
              <input
                id="smtp-from-name"
                name="from_name"
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
                {extSettings.smtpFromEmailLabel}
              </label>
              <input
                id="smtp-from-email"
                name="from_email"
                type="email"
                maxLength={MAX_EMAIL_LENGTH}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={smtpDraft.from_email}
                onChange={(e) =>
                  setSmtpDraft({ ...smtpDraft, from_email: e.target.value })
                }
                placeholder="noreply@example.com"
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
              />
            </div>
          </div>

          {/* Pre-flight MX / Domain Existence Verification & Delivery Guard */}
          <div className="space-y-3 pt-2 border-t border-border-subtle">
            <div className="space-y-1">
              <SwitchRow
                name="verify_recipient_mx"
                label={extSettings.verifyRecipientMxLabel}
                checked={smtpDraft.verify_recipient_mx}
                onChange={(checked) =>
                  setSmtpDraft((prev) => ({ ...prev, verify_recipient_mx: checked }))
                }
                variant="inline"
                className="w-full justify-between text-xs font-semibold text-ink-secondary"
              />
              <p className="text-xs text-ink-muted m-0 leading-relaxed">
                {extSettings.verifyRecipientMxHint}
              </p>
            </div>

            {guardStatus && (
              <div
                role="status"
                aria-live="polite"
                className="p-3.5 rounded-xl bg-surface-raised/50 border border-border-subtle space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-primary">
                    <IconShield className="w-3.5 h-3.5 text-ink-muted" />
                    <span>{extSettings.mailGuardTitle}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {guardStatus.circuit_open ? (
                      <>
                        <StatusBadge tone="danger" pill>
                          <IconAlertCircle className="w-3 h-3" />
                          <span>{extSettings.mailGuardCircuitOpen}</span>
                        </StatusBadge>
                        <button
                          type="button"
                          disabled={guardBusy}
                          onClick={() => void handleResetCircuit()}
                          className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          {extSettings.mailGuardResetCircuitBtn}
                        </button>
                      </>
                    ) : (
                      <StatusBadge tone="success" pill>
                        <IconCheck className="w-3 h-3" />
                        <span>{extSettings.mailGuardCircuitHealthy}</span>
                      </StatusBadge>
                    )}
                  </div>
                </div>

                {guardStatus.circuit_open && (
                  <p
                    className="text-xs m-0 px-3 py-2 rounded-lg border leading-relaxed"
                    style={{
                      backgroundColor: 'var(--alert-danger-bg)',
                      borderColor: 'var(--alert-danger-border)',
                      color: 'var(--alert-danger-body)',
                    }}
                  >
                    {extSettings.mailGuardCircuitOpenDetail(
                      guardStatus.circuit_retry_after_secs,
                      guardStatus.circuit_reason || 'Rate limit / hard bounce spike',
                    )}
                  </p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="px-2.5 py-1.5 rounded-lg bg-surface-sheet border border-border-subtle">
                    <div className="text-[11px] text-ink-muted">
                      {extSettings.mailGuardStatSent}
                    </div>
                    <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                      {guardStatus.total_sent}
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-surface-sheet border border-border-subtle">
                    <div className="text-[11px] text-ink-muted">
                      {extSettings.mailGuardStatBounced}
                    </div>
                    <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                      {guardStatus.total_bounced}
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-surface-sheet border border-border-subtle">
                    <div className="text-[11px] text-ink-muted">
                      {extSettings.mailGuardStatBlocked}
                    </div>
                    <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                      {guardStatus.total_blocked_domain +
                        guardStatus.total_blocked_suppressed}
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-surface-sheet border border-border-subtle">
                    <div className="text-[11px] text-ink-muted">
                      {extSettings.mailGuardStatDeduped}
                    </div>
                    <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                      {guardStatus.total_deduped}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-dashed border-border-subtle space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink-secondary">
                      {extSettings.mailGuardSuppressedTitle(
                        guardStatus.suppressed_count,
                      )}
                    </span>
                    {guardStatus.suppressed_count > 0 && (
                      <button
                        type="button"
                        disabled={guardBusy}
                        onClick={() =>
                          void handleClearSuppression({ clear_all: true })
                        }
                        className="text-xs text-accent-danger hover:underline cursor-pointer disabled:opacity-50"
                      >
                        {extSettings.mailGuardClearAllSuppressedBtn}
                      </button>
                    )}
                  </div>

                  {guardStatus.suppressed_recipients.length === 0 ? (
                    <p className="text-xs text-ink-muted m-0">
                      {extSettings.mailGuardSuppressedEmpty}
                    </p>
                  ) : (
                    <ul className="m-0 p-0 list-none space-y-1.5 max-h-40 overflow-y-auto">
                      {guardStatus.suppressed_recipients.map((entry) => (
                        <li
                          key={entry.email}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-surface-sheet border border-border-subtle text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-ink-primary truncate">
                                {entry.email}
                              </span>
                              <StatusBadge tone="neutral" mono>
                                {entry.provider}
                              </StatusBadge>
                            </div>
                            <p className="text-[11px] text-ink-muted m-0 truncate">
                              {entry.reason}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={guardBusy}
                            onClick={() =>
                              void handleClearSuppression({ email: entry.email })
                            }
                            className="shrink-0 min-h-7 px-2 py-0.5 rounded-md text-xs text-ink-secondary hover:text-ink-primary hover:bg-surface-raised cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            {extSettings.mailGuardRemoveSuppressedBtn}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Custom HTML Email Footer */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label
                htmlFor="smtp-email-footer"
                className="text-xs font-semibold text-ink-secondary"
              >
                {extSettings.smtpEmailFooterLabel}
              </label>
              <span className="text-xs font-mono text-ink-muted tabular-nums">
                {smtpDraft.email_footer_text.length} / 1200
              </span>
            </div>
            <textarea
              id="smtp-email-footer"
              rows={3}
              maxLength={1200}
              spellCheck={false}
              value={smtpDraft.email_footer_text}
              onChange={(e) =>
                setSmtpDraft({ ...smtpDraft, email_footer_text: e.target.value })
              }
              placeholder={extSettings.smtpEmailFooterPlaceholder}
              className="ink-field-input ink-auto-textarea text-xs font-mono leading-relaxed"
            />
            <p className="mt-1 text-xs text-ink-muted m-0">
              {extSettings.smtpEmailFooterHint}
            </p>
          </div>

          {/* Send Test Email */}
          <div className="pt-3 border-t border-dashed border-border-subtle flex flex-wrap items-end gap-2.5">
            <div className="flex-1 min-w-48">
              <label
                htmlFor="smtp-test-to"
                className="block mb-1 text-xs font-semibold text-ink-secondary"
              >
                {extSettings.smtpTestEmailLabel}
              </label>
              <input
                id="smtp-test-to"
                type="email"
                maxLength={MAX_EMAIL_LENGTH}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
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
              className="min-h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer disabled:opacity-60 transition-colors"
            >
              {testingSmtp ? extSettings.smtpTestingBtn : extSettings.smtpTestBtn}
            </button>
          </div>

          {/* Collapsible Custom Email Templates & Exact-Height Live Preview */}
          <div className="pt-2 border-t border-border-subtle">
            <button
              type="button"
              aria-expanded={templatesOpen}
              onClick={() => setTemplatesOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 min-h-8 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
            >
              <IconChevronRight
                className={`w-3.5 h-3.5 motion-safe:transition-transform ${
                  templatesOpen ? 'rotate-90' : ''
                }`}
              />
              <span>{extSettings.smtpTemplatesToggle}</span>
            </button>

            {templatesOpen && (
              <div className="mt-4 space-y-4 ui-panel-enter">
                <p className="text-xs text-ink-muted font-mono leading-relaxed">
                  {extSettings.smtpVarsHint}
                </p>

                <div className="space-y-2.5">
                  <UnderlineTabs<MailTemplateKind>
                    ariaLabel={extSettings.smtpTemplatesToggle}
                    idPrefix="smtp-tpl-tab"
                    className="max-w-full"
                    value={activeTemplateKind}
                    onChange={setActiveTemplateKind}
                    items={[
                      { value: 'register_code', label: extSettings.smtpRegisterCodeTab },
                      { value: 'login_anomaly', label: extSettings.smtpLoginAnomalyTab },
                      { value: 'email_change', label: extSettings.smtpEmailChangeTab },
                      { value: 'invite', label: extSettings.smtpInviteTab },
                      { value: 'reset', label: extSettings.smtpResetTab },
                      { value: 'takedown', label: extSettings.smtpTakedownTab },
                      { value: 'account_ban', label: extSettings.smtpBanTab },
                    ]}
                  />

                  {activeTemplateKind !== 'email_change' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <SegmentedControl<'preview' | 'source'>
                        value={templateViewMode}
                        onChange={setTemplateViewMode}
                        options={[
                          { value: 'preview', label: extSettings.smtpTemplatePreviewTab },
                          { value: 'source', label: extSettings.smtpTemplateSourceTab },
                        ]}
                      />

                      <button
                        type="button"
                        onClick={() => {
                          updateCurrentTemplateField('subject', '');
                          updateCurrentTemplateField('html', '');
                        }}
                        className="min-h-8 px-2.5 py-1 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer transition-colors"
                      >
                        {extSettings.smtpResetDefaultBtn}
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-3 sm:p-4 rounded-xl bg-surface-raised/50 border border-border-subtle space-y-3.5">
                  {activeTemplateKind !== 'email_change' && (
                    <div>
                      <label htmlFor="smtp-tpl-active-subj" className="ink-field-label">
                        {activeTemplateKind === 'register_code'
                          ? extSettings.smtpRegisterSubjectLabel
                          : activeTemplateKind === 'login_anomaly'
                            ? extSettings.smtpLoginAnomalySubjectLabel
                            : activeTemplateKind === 'invite'
                              ? extSettings.smtpInviteSubjectLabel
                              : activeTemplateKind === 'reset'
                                ? extSettings.smtpResetSubjectLabel
                                : activeTemplateKind === 'account_ban'
                                  ? extSettings.smtpBanSubjectLabel
                                  : extSettings.smtpTakedownSubjectLabel}
                      </label>
                      <input
                        id="smtp-tpl-active-subj"
                        type="text"
                        value={currentTplSubject}
                        placeholder={extSettings.smtpAutoLocalePlaceholder}
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
                      <label htmlFor="smtp-tpl-active-html" className="ink-field-label">
                        {activeTemplateKind === 'register_code'
                          ? extSettings.smtpRegisterHtmlLabel
                          : activeTemplateKind === 'login_anomaly'
                            ? extSettings.smtpLoginAnomalyHtmlLabel
                            : activeTemplateKind === 'invite'
                              ? extSettings.smtpInviteHtmlLabel
                              : activeTemplateKind === 'reset'
                                ? extSettings.smtpResetHtmlLabel
                                : activeTemplateKind === 'account_ban'
                                  ? extSettings.smtpBanHtmlLabel
                                  : extSettings.smtpTakedownHtmlLabel}
                      </label>
                      <textarea
                        id="smtp-tpl-active-html"
                        rows={10}
                        value={currentTplHtml}
                        placeholder={extSettings.smtpAutoLocalePlaceholder}
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
                          className="flex-1 text-xs text-ink-primary min-w-0 basis-44 truncate"
                          title={templatePreview?.subject || currentTplSubject || ''}
                        >
                          <span className="font-semibold text-ink-muted">
                            {extSettings.smtpPreviewSubjectPrefix}
                          </span>
                          <span className="font-semibold">
                            {templatePreview?.subject || currentTplSubject || '…'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                          <SegmentedControl<LocaleCode>
                            size="xs"
                            ariaLabel={extSettings.smtpPreviewLocaleLabel}
                            value={previewLocale}
                            onChange={setPreviewLocale}
                            options={getEnabledLocaleMetas(enabledLocales).map(
                              (loc) => ({
                                value: loc.code,
                                label: loc.short,
                              }),
                            )}
                          />

                          <SegmentedControl<'desktop' | 'mobile'>
                            size="xs"
                            value={previewViewport}
                            onChange={setPreviewViewport}
                            options={[
                              { value: 'desktop', label: extSettings.smtpViewportDesktop },
                              { value: 'mobile', label: extSettings.smtpViewportMobile },
                            ]}
                          />
                        </div>
                      </div>

                      <div className="rounded-xl bg-surface-sunken border border-border-subtle p-2 sm:p-3 overflow-x-auto ink-thin-scrollbar">
                        {loadingPreview && !templatePreview ? (
                          <div className="w-full h-60 flex items-center justify-center text-xs text-ink-muted">
                            {extSettings.smtpPreviewLoading}
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
                            style={{
                              height: `${previewIframeHeight}px`,
                              backgroundColor: '#f4efe3',
                            }}
                            className={`block mx-auto rounded-xl border border-border-subtle overflow-hidden transition-[width] ${
                              previewViewport === 'mobile'
                                ? 'w-full max-w-[375px]'
                                : 'w-full min-w-[560px] max-w-[620px]'
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
      )}
    </SettingsSectionCard>
  );
}
