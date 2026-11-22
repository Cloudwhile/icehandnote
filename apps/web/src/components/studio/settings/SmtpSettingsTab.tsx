/*
 * Decoupled SMTP Delivery & Live Email Template Preview Tab (`StudioSettingsPanel` Tab: `'smtp'`).
 * Reuses `<SettingsSectionCard>`, `<SwitchRow>`, `<PasswordInput>`, `<UnderlineTabs>`, and `<SegmentedControl>`.
 * Holds skeleton until `adminGetSmtp` resolves so refreshing on SMTP tab never flashes `'IceHandnote'` in `from_name`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '../../../lib/email';
import { EXT_COPY, getEnabledLocaleMetas } from '../../../lib/i18n';
import type {
  LocaleCode,
  SiteSettingsDto,
  SmtpSettingsDto,
} from '../../../lib/types';
import { SwitchRow } from '../../ui/FormControls';
import { IconCheck } from '../../ui/Icons';
import { InkSelect } from '../../ui/InkSelect';
import { PasswordInput } from '../../ui/PasswordInput';
import { SegmentedControl, UnderlineTabs } from '../../ui/Tabs';
import { useToast } from '../../ui/ToastProvider';
import { SettingsSectionCard } from './SettingsSectionCard';

export const DEFAULT_SMTP_STATE: SmtpSettingsDto = {
  enabled: false,
  host: '',
  port: 465,
  encryption: 'tls',
  username: '',
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background-color:#f4efe3;background-image:radial-gradient(#cfc5b0 1px,transparent 1px);background-size:18px 18px;overflow:hidden;}a,[role="link"]{color:#4c1d95;}</style></head><body>${safeBody}</body></html>`;
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

  const [loaded, setLoaded] = useState(false);
  const [smtpDraft, setSmtpDraft] = useState<SmtpSettingsDto>(DEFAULT_SMTP_STATE);
  const [savedBaseline, setSavedBaseline] =
    useState<SmtpSettingsDto>(DEFAULT_SMTP_STATE);
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
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
  const onDirtyAndSavingChangeRef = useRef(onDirtyAndSavingChange);
  onDirtyAndSavingChangeRef.current = onDirtyAndSavingChange;
  const [previewIframeHeight, setPreviewIframeHeight] = useState<number>(480);

  useEffect(() => {
    setPreviewLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (enabledLocales.length > 0 && !enabledLocales.includes(previewLocale)) {
      setPreviewLocale(enabledLocales[0]);
    }
  }, [enabledLocales, previewLocale]);

  useEffect(() => {
    let active = true;
    void api
      .adminGetSmtp()
      .then((res) => {
        if (!active) return;
        const merged = { ...DEFAULT_SMTP_STATE, ...res.settings };
        setSmtpDraft(merged);
        setSavedBaseline(merged);
        setHasPassword(res.has_password);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const isDirty =
    loaded &&
    (JSON.stringify(smtpDraft) !== JSON.stringify(savedBaseline) ||
      passwordInput.trim().length > 0);

  useEffect(() => {
    onDirtyAndSavingChangeRef.current(isDirty, savingSmtp);
  }, [isDirty, savingSmtp]);

  const handleSaveSmtp = useCallback(async () => {
    if (savingSmtp || !loaded) return;
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
    setSavingSmtp(true);
    try {
      const res = await api.adminUpdateSmtp({
        settings: nextDraft,
        password: passwordInput.trim() || undefined,
      });
      const savedMerged = { ...DEFAULT_SMTP_STATE, ...res.settings };
      setSmtpDraft(savedMerged);
      setSavedBaseline(savedMerged);
      setHasPassword(res.has_password);
      setPasswordInput('');
      toast.success(extSettings.smtpSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingSmtp(false);
    }
  }, [loaded, passwordInput, extSettings.smtpSavedMsg, savingSmtp, smtpDraft, toast]);

  useEffect(() => {
    if (saveTrigger > 0) {
      void handleSaveSmtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTrigger]);

  const handleClearPassword = async () => {
    if (savingSmtp) return;
    setSavingSmtp(true);
    try {
      const res = await api.adminUpdateSmtp({
        settings: smtpDraft,
        clear_password: true,
      });
      setHasPassword(res.has_password);
      setPasswordInput('');
      toast.success(extSettings.smtpSavedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
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
    if (testingSmtp) return;
    setTestingSmtp(true);
    try {
      await api.adminTestSmtp({
        to_email: normalizedTo,
        settings: { ...smtpDraft, from_email: normalizedFrom },
        password: passwordInput.trim() || undefined,
        locale,
      });
      toast.success(extSettings.smtpTestSentMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setTestingSmtp(false);
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
    if (!loaded || !templatesOpen || templateViewMode !== 'preview') {
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
    loaded,
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

  return (
    <SettingsSectionCard title={extSettings.smtpGroup}>
      {!loaded ? (
        <div className="space-y-4" aria-busy="true">
          <div className="h-9 rounded-xl bg-surface-raised animate-pulse" />
          <div className="h-24 rounded-xl bg-surface-raised animate-pulse" />
          <div className="h-24 rounded-xl bg-surface-raised animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4">
          <SwitchRow
            label={extSettings.smtpEnabledLabel}
            checked={smtpDraft.enabled}
            onChange={(checked) =>
              setSmtpDraft((prev) => ({ ...prev, enabled: checked }))
            }
            variant="inline"
            className="w-full justify-between text-sm text-ink-primary"
          />

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
                {extSettings.smtpPortLabel}
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
                      onClick={() => void handleClearPassword()}
                      className="text-accent-danger hover:underline cursor-pointer"
                    >
                      {extSettings.smtpClearPasswordBtn}
                    </button>
                  </div>
                )}
              </div>
              <PasswordInput
                id="smtp-pw"
                locale={locale}
                variant="compact"
                autoComplete="new-password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={hasPassword ? '••••••••' : ''}
              />
            </div>
          </div>

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
              className="inline-flex items-center gap-1 min-h-8 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
            >
              <span>{templatesOpen ? '▾' : '▸'}</span>
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
                </div>

                <div className="p-4 rounded-xl bg-surface-raised/50 border border-border-subtle space-y-3.5">
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
                          className="flex-1 text-xs text-ink-primary min-w-44 truncate"
                          title={templatePreview?.subject || currentTplSubject || ''}
                        >
                          <span className="font-semibold text-ink-muted">
                            {extSettings.smtpPreviewSubjectPrefix}
                          </span>
                          <span className="font-semibold">
                            {templatePreview?.subject || currentTplSubject || '…'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
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

                      <div className="rounded-xl bg-surface-sunken border border-border-subtle p-3 flex justify-center overflow-x-auto">
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
      )}
    </SettingsSectionCard>
  );
}
