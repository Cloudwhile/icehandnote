/*
 * Unified Studio Settings Panel (`StudioSettingsPanel`):
 * Thin orchestrator composing decoupled `<GeneralSettingsTab>`, `<OAuthSettingsTab>`,
 * `<StorageSettingsTab>`, `<SmtpSettingsTab>`, and `<UpdateCheckStatus>`.
 */

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type {
  LocaleCode,
  SiteSettingsDto,
  StudioSettingsTabId,
} from '../../lib/types';
import { IconPlus } from '../ui/Icons';
import { useToast } from '../ui/ToastProvider';
import { GeneralSettingsTab } from './settings/GeneralSettingsTab';
import {
  OAuthSettingsTab,
  withNormalizedProviders,
} from './settings/OAuthSettingsTab';
import { SettingsSectionCard } from './settings/SettingsSectionCard';
import { SmtpSettingsTab } from './settings/SmtpSettingsTab';
import { StorageSettingsTab } from './settings/StorageSettingsTab';
import { UpdateCheckStatus, useSiteUpdateCheck } from './UpdateCheckStatus';

interface StudioSettingsPanelProps {
  locale: LocaleCode;
  activeTab: StudioSettingsTabId;
  onSelectTab?: (tab: StudioSettingsTabId) => void;
  settings: SiteSettingsDto;
  onSettingsUpdated: (next: SiteSettingsDto) => void;
}

export function StudioSettingsPanel({
  locale,
  activeTab,
  settings,
  onSettingsUpdated,
}: StudioSettingsPanelProps) {
  const st = UI_COPY[locale].studio.settings;
  const extSettings = EXT_COPY[locale].settings;
  const toast = useToast();

  const normalizedIncoming = useMemo(
    () => withNormalizedProviders(settings),
    [settings],
  );
  const [draft, setDraft] = useState<SiteSettingsDto>(normalizedIncoming);
  const [savingGeneral, setSavingGeneral] = useState(false);

  const [oauthAddTrigger, setOauthAddTrigger] = useState(0);
  const [smtpSaveTrigger, setSmtpSaveTrigger] = useState(0);
  const [smtpDirty, setSmtpDirty] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);

  const updateChecker = useSiteUpdateCheck(true);

  useEffect(() => {
    setDraft(normalizedIncoming);
  }, [normalizedIncoming]);

  const handleSmtpStateChange = useCallback((dirty: boolean, saving: boolean) => {
    setSmtpDirty(dirty);
    setSmtpSaving(saving);
  }, []);

  const handleGeneralSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (savingGeneral) return;
    if (draft.enabled_locales.length === 0) {
      toast.warning(st.minOneLocaleError);
      return;
    }
    setSavingGeneral(true);
    try {
      const payload = withNormalizedProviders(draft);
      const saved = await api.adminUpdateSettings(payload);
      const normalizedSaved = withNormalizedProviders(saved);
      setDraft(normalizedSaved);
      onSettingsUpdated(normalizedSaved);
      toast.success(st.savedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingGeneral(false);
    }
  };

  const isGeneralDirty =
    JSON.stringify(draft) !== JSON.stringify(normalizedIncoming);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Sticky Top Header + Contextual Primary Action */}
      <div className="sticky top-0 z-10 -mx-2 px-2 pt-2 pb-3 bg-surface-page/95 backdrop-blur border-b border-border-subtle">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h1
              id="studio-settings-heading"
              className="text-xl font-semibold text-ink-primary m-0"
            >
              {extSettings.settingsTabs[activeTab]}
            </h1>
            <span className="text-xs text-ink-muted hidden sm:inline">
              / {st.title}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeTab === 'general' && (
              <>
                {isGeneralDirty && (
                  <button
                    type="button"
                    onClick={() => setDraft(normalizedIncoming)}
                    className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
                  >
                    {st.resetBtn}
                  </button>
                )}

                <button
                  type="submit"
                  form="studio-settings-form"
                  disabled={savingGeneral || !isGeneralDirty}
                  className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingGeneral ? st.savingBtn : st.saveBtn}
                </button>
              </>
            )}

            {activeTab === 'oauth' && (
              <button
                type="button"
                onClick={() => setOauthAddTrigger((n) => n + 1)}
                className="min-h-9 px-3.5 py-2 rounded-xl text-xs font-semibold ink-btn-primary inline-flex items-center gap-1.5 cursor-pointer"
              >
                <IconPlus className="w-3.5 h-3.5" />
                <span>{extSettings.oauthAddProviderBtn}</span>
              </button>
            )}

            {activeTab === 'smtp' && (
              <button
                type="button"
                disabled={smtpSaving || !smtpDirty}
                onClick={() => setSmtpSaveTrigger((n) => n + 1)}
                className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {smtpSaving ? extSettings.smtpSavingBtn : extSettings.smtpSaveBtn}
              </button>
            )}

            {activeTab === 'updates' && (
              <button
                type="button"
                disabled={updateChecker.checking}
                onClick={() => void updateChecker.checkUpdate()}
                className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
              >
                {updateChecker.checking
                  ? st.checkingUpdateBtn
                  : st.checkUpdateBtn}
              </button>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'general' && (
        <GeneralSettingsTab
          locale={locale}
          draft={draft}
          onChangeDraft={setDraft}
          onSubmit={(e) => void handleGeneralSubmit(e)}
        />
      )}

      {activeTab === 'oauth' && (
        <OAuthSettingsTab
          locale={locale}
          draft={draft}
          openAddTrigger={oauthAddTrigger}
          onDraftAndSettingsSaved={(saved) => {
            setDraft(saved);
            onSettingsUpdated(saved);
          }}
        />
      )}

      {activeTab === 'storage' && <StorageSettingsTab locale={locale} />}

      {activeTab === 'smtp' && (
        <SmtpSettingsTab
          locale={locale}
          settings={settings}
          enabledLocales={draft.enabled_locales}
          saveTrigger={smtpSaveTrigger}
          onDirtyAndSavingChange={handleSmtpStateChange}
        />
      )}

      {activeTab === 'updates' && (
        <SettingsSectionCard>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <dl className="m-0 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <div className="flex items-baseline gap-2">
                <dt className="text-ink-muted">{st.currentVersionLabel}</dt>
                <dd className="m-0 font-mono font-semibold text-ink-primary">
                  {updateChecker.currentVersion}
                </dd>
              </div>

              {updateChecker.result && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-ink-muted">{st.latestVersionLabel}</dt>
                  <dd className="m-0 font-mono text-ink-secondary">
                    {updateChecker.result.latest_version}
                  </dd>
                </div>
              )}
            </dl>

            <UpdateCheckStatus
              locale={locale}
              checking={updateChecker.checking}
              result={updateChecker.result}
              error={updateChecker.error}
            />
          </div>
        </SettingsSectionCard>
      )}
    </div>
  );
}
