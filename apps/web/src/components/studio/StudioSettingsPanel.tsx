/*
 * Refactoring UI Constraint Brief (Workflow C Refined — Focused Single-Column Site Settings):
 * - Eliminates the empty 4-column left void: centered `max-w-3xl` single-column stack where each
 *   `.studio-panel` carries a crisp header bar and balanced full-width form body (§3.3.2 & §3.6).
 * - Group spacing (§3.6): `mb-1.5` label-to-input < `mb-5` between fields.
 * - Action Pyramid (§2.8): ONE Primary submit button (`保存设置`, `ink-btn-primary`); quiet tertiary Reset.
 * - Modern Web Guidance:
 *   - `forms`: semantic `<form>`, `<fieldset>`/`<legend>`, exposed `<input type="radio">` for 2–4 choices,
 *     `spellcheck="false"`/`autoCorrect="off"` on URLs, explicit `<button type="submit">`.
 *   - `switch`: native `<input type="checkbox" switch>` with accessible labels & visible focus ring.
 */

import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { LOCALES, UI_COPY } from '../../lib/i18n';
import { ALL_LICENSE_OPTIONS, normalizeLicenseId } from '../../lib/licenses';
import {
  APP_VERSION,
  type DefaultThemeSetting,
  type LicenseId,
  type LocaleCode,
  type SiteSettingsDto,
  type UpdateCheckResponse,
} from '../../lib/types';

interface StudioSettingsPanelProps {
  locale: LocaleCode;
  settings: SiteSettingsDto;
  onSettingsUpdated: (next: SiteSettingsDto) => void;
}

export function StudioSettingsPanel({
  locale,
  settings,
  onSettingsUpdated,
}: StudioSettingsPanelProps) {
  const copy = UI_COPY[locale];
  const st = copy.studio.settings;
  const [draft, setDraft] = useState<SiteSettingsDto>(settings);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResponse | null>(
    null,
  );
  const [updateError, setUpdateError] = useState(false);

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateError(false);
    try {
      const res = await api.checkSiteUpdate();
      setUpdateResult(res);
    } catch {
      setUpdateError(true);
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const toggleLocale = (code: LocaleCode) => {
    setFeedback(null);
    setDraft((prev) => {
      const exists = prev.enabled_locales.includes(code);
      if (exists && prev.enabled_locales.length <= 1) {
        setFeedback({ ok: false, text: st.minOneLocaleError });
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (draft.enabled_locales.length === 0) {
      setFeedback({ ok: false, text: st.minOneLocaleError });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await api.adminUpdateSettings(draft);
      setDraft(saved);
      onSettingsUpdated(saved);
      setFeedback({ ok: true, text: st.savedMsg });
    } catch (err) {
      setFeedback({
        ok: false,
        text: st.saveFailedMsg(
          err instanceof Error ? err.message : 'Unknown error',
        ),
      });
    } finally {
      setSaving(false);
    }
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="max-w-3xl mx-auto space-y-6"
      aria-labelledby="studio-settings-heading"
    >
      {/* Top Header + Save Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-border-subtle">
        <h1
          id="studio-settings-heading"
          className="text-xl font-semibold text-ink-primary m-0"
        >
          {st.title}
        </h1>

        <div className="flex items-center gap-3">
          <span
            role="status"
            aria-live="polite"
            className={`text-xs font-mono ${
              feedback
                ? feedback.ok
                  ? 'text-accent-success'
                  : 'text-accent-danger'
                : 'text-ink-muted'
            }`}
          >
            {feedback?.text ?? ''}
          </span>

          {isDirty && (
            <button
              type="button"
              onClick={() => {
                setDraft(settings);
                setFeedback(null);
              }}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer"
            >
              {st.resetBtn}
            </button>
          )}

          <button
            type="submit"
            disabled={saving}
            className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
          >
            {saving ? st.savingBtn : st.saveBtn}
          </button>
        </div>
      </div>

      {/* Group 1: General Site Identity */}
      <section className="studio-panel overflow-hidden">
        <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40">
          <h2 className="text-sm font-semibold text-ink-primary m-0">
            {st.generalGroup}
          </h2>
        </div>

        <div className="p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
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
                maxLength={64}
                value={draft.site_name}
                onChange={(e) =>
                  setDraft({ ...draft, site_name: e.target.value })
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
                maxLength={24}
                value={draft.brand_badge}
                onChange={(e) =>
                  setDraft({ ...draft, brand_badge: e.target.value })
                }
                placeholder={st.brandBadgePlaceholder}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
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
                maxLength={120}
                value={draft.hero_title}
                onChange={(e) =>
                  setDraft({ ...draft, hero_title: e.target.value })
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
                maxLength={240}
                value={draft.hero_tagline}
                onChange={(e) =>
                  setDraft({ ...draft, hero_tagline: e.target.value })
                }
                placeholder={st.heroTaglinePlaceholder}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            <div className="sm:col-span-5">
              <label
                htmlFor="set-footer-text"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {st.footerTextLabel}
              </label>
              <input
                id="set-footer-text"
                name="footer_text"
                type="text"
                maxLength={200}
                value={draft.footer_text}
                onChange={(e) =>
                  setDraft({ ...draft, footer_text: e.target.value })
                }
                placeholder={st.footerTextPlaceholder}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="set-default-author"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {st.defaultAuthorLabel}
              </label>
              <input
                id="set-default-author"
                name="default_author_name"
                type="text"
                maxLength={48}
                value={draft.default_author_name ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, default_author_name: e.target.value })
                }
                placeholder={st.defaultAuthorPlaceholder}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
              />
            </div>

            <div className="sm:col-span-4">
              <label
                htmlFor="set-default-license"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
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
          {/* Multi-select enabled locales (`forms` matrix: checkboxes) */}
          <fieldset className="m-0 p-0 border-0">
            <legend className="text-xs font-semibold text-ink-secondary mb-2.5 p-0">
              {st.enabledLocalesLabel}
            </legend>
            <div className="flex flex-wrap gap-2.5">
              {LOCALES.map((loc) => {
                const checked = draft.enabled_locales.includes(loc.code);
                return (
                  <label
                    key={loc.code}
                    className={`inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                        : 'bg-surface-raised border-border-subtle text-ink-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="enabled_locales"
                      value={loc.code}
                      checked={checked}
                      onChange={() => toggleLocale(loc.code)}
                    />
                    <span>{loc.label}</span>
                    <span className="font-mono text-ink-muted">{loc.code}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1 border-t border-dashed border-border-subtle">
            {/* Exclusive 2-4 options: visible radio group (`forms` matrix) */}
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
                      className={`inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                        active
                          ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                          : 'bg-surface-raised border-border-subtle text-ink-secondary'
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
                      />
                      <span>{loc.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Exclusive 3 theme choices: visible radio group (`forms` matrix) */}
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
                      className={`inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-xl text-xs border cursor-pointer transition-colors ${
                        active
                          ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                          : 'bg-surface-raised border-border-subtle text-ink-secondary'
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
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </div>
      </section>

      {/* Group 3: Feature Toggles & Unified Article Draft Auto-Save */}
      <section className="studio-panel overflow-hidden">
        <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40">
          <h2 className="text-sm font-semibold text-ink-primary m-0">
            {st.featuresGroup}
          </h2>
        </div>

        <div className="divide-y divide-border-subtle">
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
                        className={`inline-flex items-center gap-2 min-h-8 px-3 py-1 rounded-xl text-xs font-mono tabular-nums border cursor-pointer transition-colors ${
                          active
                            ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                            : 'bg-surface-raised border-border-subtle text-ink-secondary'
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
                        />
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

      {/* Group 4: External Site & SSO Integration */}
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
                maxLength={48}
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
            <span className="text-sm text-ink-primary">
              {st.ssoEnabledLabel}
            </span>
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

      {/* Group 5: Version & Site Update Check */}
      <section className="studio-panel overflow-hidden">
        <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-primary m-0">
            {st.updateGroup}
          </h2>
          <button
            type="button"
            disabled={checkingUpdate}
            onClick={() => void handleCheckUpdate()}
            className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-60"
          >
            {checkingUpdate ? st.checkingUpdateBtn : st.checkUpdateBtn}
          </button>
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
    </form>
  );
}
