/*
 * Decoupled General Site Settings Tab (`StudioSettingsPanel` Tab: `'general'`).
 * Reuses `<SettingsSectionCard>`, `<CheckboxPillGroup>`, `<RadioPillGroup>`, `<SwitchRow>`, and `<FileUploadButton>`.
 */

import { type FormEvent, useState } from 'react';
import { api } from '../../../lib/api';
import { EXT_COPY, LOCALES, UI_COPY } from '../../../lib/i18n';
import { normalizeLicenseId } from '../../../lib/licenses';
import { CcLicenseSelector } from '../../notebook/CcLicenseCard';
import type {
  DefaultThemeSetting,
  LicenseId,
  LocaleCode,
  SiteSettingsDto,
} from '../../../lib/types';
import { FileUploadButton } from '../../ui/FileUploadButton';
import {
  CheckboxPillGroup,
  RadioPillGroup,
  SwitchRow,
} from '../../ui/FormControls';
import { useToast } from '../../ui/ToastProvider';
import { SettingsSectionCard } from './SettingsSectionCard';

export interface GeneralSettingsTabProps {
  locale: LocaleCode;
  draft: SiteSettingsDto;
  onChangeDraft: (updater: (prev: SiteSettingsDto) => SiteSettingsDto) => void;
  onSubmit: (e: FormEvent) => void;
}

const LOGO_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon,image/svg+xml';

export function GeneralSettingsTab({
  locale,
  draft,
  onChangeDraft,
  onSubmit,
}: GeneralSettingsTabProps) {
  const copy = UI_COPY[locale];
  const st = copy.studio.settings;
  const extSettings = EXT_COPY[locale].settings;
  const toast = useToast();
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleLogoUpload = async (file: File) => {
    if (uploadingLogo) return;
    setUploadingLogo(true);
    try {
      const uploaded = await api.uploadStudioMedia(file);
      onChangeDraft((prev) => ({ ...prev, logo_url: uploaded.url }));
      toast.success(extSettings.logoUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingLogo(false);
    }
  };

  const toggleLocale = (code: LocaleCode) => {
    onChangeDraft((prev) => {
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

  return (
    <form
      id="studio-settings-form"
      onSubmit={onSubmit}
      className="space-y-6"
      aria-labelledby="studio-settings-heading"
    >
      {/* Group 1: General Site Identity & Logo */}
      <SettingsSectionCard title={st.generalGroup}>
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
              onChange={(e) =>
                onChangeDraft((prev) => ({ ...prev, site_name: e.target.value }))
              }
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
                onChangeDraft((prev) => ({ ...prev, brand_badge: e.target.value }))
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
              onChange={(e) =>
                onChangeDraft((prev) => ({ ...prev, logo_url: e.target.value }))
              }
              placeholder={st.logoUrlPlaceholder}
              className="flex-1 min-w-48 px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
            />
            <FileUploadButton
              accept={LOGO_ACCEPT}
              uploading={uploadingLogo}
              label={st.uploadLogoBtn}
              uploadingLabel={st.uploadingLogoBtn}
              onSelectFile={(file) => void handleLogoUpload(file)}
            />
            {draft.logo_url?.trim() && (
              <button
                type="button"
                onClick={() =>
                  onChangeDraft((prev) => ({ ...prev, logo_url: '' }))
                }
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
              onChange={(e) =>
                onChangeDraft((prev) => ({ ...prev, hero_title: e.target.value }))
              }
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
                onChangeDraft((prev) => ({
                  ...prev,
                  hero_tagline: e.target.value,
                }))
              }
              placeholder={st.heroTaglinePlaceholder}
              className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label
              htmlFor="set-footer-text"
              className="text-xs font-semibold text-ink-secondary"
            >
              {st.footerTextLabel}
            </label>
            <span className="text-xs font-mono text-ink-muted tabular-nums">
              {(draft.footer_text ?? '').length} / 500
            </span>
          </div>
          <textarea
            id="set-footer-text"
            name="footer_text"
            rows={3}
            maxLength={500}
            spellCheck={false}
            value={draft.footer_text}
            onChange={(e) =>
              onChangeDraft((prev) => ({ ...prev, footer_text: e.target.value }))
            }
            placeholder={st.footerTextPlaceholder}
            className="ink-field-input ink-auto-textarea leading-relaxed"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                onChangeDraft((prev) => ({
                  ...prev,
                  default_author_name: e.target.value,
                }))
              }
              placeholder={st.defaultAuthorPlaceholder}
              className="ink-field-input"
            />
          </div>

          <div className="sm:col-span-2">
            <span className="ink-field-label block mb-2">
              {st.defaultLicenseLabel}
            </span>
            <CcLicenseSelector
              locale={locale}
              value={
                normalizeLicenseId(draft.default_license) || 'cc-by-nc-sa-4.0'
              }
              onChange={(id) =>
                onChangeDraft((prev) => ({
                  ...prev,
                  default_license: (normalizeLicenseId(id) ||
                    'cc-by-nc-sa-4.0') as LicenseId,
                }))
              }
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="set-gravatar-base" className="ink-field-label">
              {extSettings.gravatarBaseUrlLabel}
            </label>
            <input
              id="set-gravatar-base"
              type="url"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              value={draft.gravatar_base_url ?? ''}
              onChange={(e) =>
                onChangeDraft((prev) => ({
                  ...prev,
                  gravatar_base_url: e.target.value,
                }))
              }
              placeholder={extSettings.gravatarBaseUrlPlaceholder}
              className="ink-field-input font-mono text-xs sm:text-sm"
            />
          </div>
        </div>
      </SettingsSectionCard>

      {/* Group 2: Localization & Appearance */}
      <SettingsSectionCard title={st.localeThemeGroup}>
        <CheckboxPillGroup
          name="enabled_locales"
          legend={st.enabledLocalesLabel}
          values={draft.enabled_locales}
          onToggle={toggleLocale}
          options={LOCALES.map((loc) => ({
            value: loc.code,
            label: loc.label,
            badge: loc.code,
          }))}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-dashed border-border-subtle">
          <RadioPillGroup
            name="default_locale"
            legend={st.defaultLocaleLabel}
            value={draft.default_locale}
            onChange={(next) =>
              onChangeDraft((prev) => ({ ...prev, default_locale: next }))
            }
            options={LOCALES.filter((loc) =>
              draft.enabled_locales.includes(loc.code),
            ).map((loc) => ({
              value: loc.code,
              label: loc.label,
            }))}
          />

          <RadioPillGroup<DefaultThemeSetting>
            name="default_theme"
            legend={st.defaultThemeLabel}
            value={draft.default_theme}
            onChange={(next) =>
              onChangeDraft((prev) => ({ ...prev, default_theme: next }))
            }
            options={[
              { value: 'system', label: st.themeSystem },
              { value: 'dark', label: st.themeDark },
              { value: 'light', label: st.themeLight },
            ]}
          />
        </div>
      </SettingsSectionCard>

      {/* Group 3: Registration, Reader Features & Auto-Save */}
      <SettingsSectionCard title={st.featuresGroup} dividedBody>
        <SwitchRow
          name="allow_registration"
          label={st.allowRegistrationLabel}
          checked={draft.allow_registration}
          onChange={(checked) =>
            onChangeDraft((prev) => ({ ...prev, allow_registration: checked }))
          }
        />

        {draft.allow_registration && (
          <SwitchRow
            name="allow_author_registration"
            label={extSettings.allowAuthorRegistrationLabel}
            checked={draft.allow_author_registration}
            onChange={(checked) =>
              onChangeDraft((prev) => ({
                ...prev,
                allow_author_registration: checked,
              }))
            }
          />
        )}

        {(
          [
            ['enable_passkeys', extSettings.enablePasskeysLabel],
            ['enable_margin_notes', st.enableMarginNotesLabel],
            ['enable_likes', st.enableLikesLabel],
            ['enable_progress_tracking', st.enableProgressLabel],
          ] as const
        ).map(([key, label]) => (
          <SwitchRow
            key={key}
            name={key}
            label={label}
            checked={draft[key]}
            onChange={(checked) =>
              onChangeDraft((prev) => ({ ...prev, [key]: checked }))
            }
          />
        ))}

        <div className="px-5 py-3.5 space-y-3">
          <SwitchRow
            name="enable_draft_autosave"
            label={st.enableDraftAutosaveLabel}
            checked={draft.enable_draft_autosave}
            onChange={(checked) =>
              onChangeDraft((prev) => ({
                ...prev,
                enable_draft_autosave: checked,
              }))
            }
            variant="inline"
            className="w-full justify-between text-sm text-ink-primary"
          />

          {draft.enable_draft_autosave && (
            <div className="ui-panel-enter pt-2.5 border-t border-dashed border-border-subtle">
              <RadioPillGroup
                name="draft_autosave_interval_secs"
                legend={st.draftAutosaveIntervalLabel}
                size="sm"
                mono
                value={draft.draft_autosave_interval_secs}
                onChange={(secs) =>
                  onChangeDraft((prev) => ({
                    ...prev,
                    draft_autosave_interval_secs: secs,
                  }))
                }
                options={[10, 15, 30, 60].map((secs) => ({
                  value: secs,
                  label: st.autosaveIntervalOption(secs),
                }))}
              />
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-border-subtle/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <label
              htmlFor="set-stale-article-days"
              className="block text-sm font-semibold text-ink-primary"
            >
              {st.staleArticleDaysLabel}
            </label>
            <p className="text-xs text-ink-muted mt-0.5 m-0">
              {st.staleArticleDaysHint}
            </p>
          </div>
          <input
            id="set-stale-article-days"
            name="stale_article_days"
            type="number"
            min={0}
            max={3650}
            value={draft.stale_article_days}
            onChange={(e) => {
              const raw = Number.parseInt(e.target.value || '0', 10);
              const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(3650, raw)) : 180;
              onChangeDraft((prev) => ({
                ...prev,
                stale_article_days: clamped,
              }));
            }}
            className="w-28 shrink-0 px-3 py-1.5 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono tabular-nums ink-input-inset"
          />
        </div>
      </SettingsSectionCard>

      {/* Group 4: External Site & WordPress SSO Integration */}
      <SettingsSectionCard title={st.integrationGroup}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                onChangeDraft((prev) => ({
                  ...prev,
                  blog_origin_url: e.target.value,
                }))
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
                onChangeDraft((prev) => ({
                  ...prev,
                  blog_nav_label: e.target.value,
                }))
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
                onChangeDraft((prev) => ({
                  ...prev,
                  sso_query_param: e.target.value,
                }))
              }
              className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
            />
          </div>
        </div>

        <SwitchRow
          name="sso_enabled"
          label={st.ssoEnabledLabel}
          checked={draft.sso_enabled}
          onChange={(checked) =>
            onChangeDraft((prev) => ({ ...prev, sso_enabled: checked }))
          }
          variant="inline"
          className="w-full justify-between pt-3 border-t border-border-subtle text-sm text-ink-primary"
        />
      </SettingsSectionCard>
    </form>
  );
}
