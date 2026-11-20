/*
 * Refactoring UI Constraint Brief (Workflow C Refined — Calm Dashboard Overview):
 * - Calm elevation (§8.5 & §6.4.1): `.studio-panel` (`1px solid var(--border-subtle)`) replaces heavy 2px white cages,
 *   neon top borders, and stacked notebook tabs inside the admin workspace.
 * - Zero fluff copy: concise heading, 4 clean KPI tiles, compact divided translation/draft queue,
 *   track coverage bars, and live Site Config summary (replacing redundant shortcut buttons).
 * - Action Pyramid (§2.8): ONE Primary CTA (`+ 新步骤`, `ink-btn-primary`).
 */

import { useState } from 'react';
import { api } from '../../lib/api';
import { LOCALES, UI_COPY } from '../../lib/i18n';
import {
  APP_VERSION,
  type LocaleCode,
  type SiteSettingsDto,
  type StudioTrackDto,
  type UpdateCheckResponse,
  type UserProfileDto,
} from '../../lib/types';
import type { StudioSectionId } from './StudioSidebarContent';

interface PendingTranslationItem {
  trackSlug: string;
  chapterSlug: string;
  stepSlug: string;
  stepTitle: string;
  stepNumber: number;
  locale: LocaleCode;
  kind: 'draft' | 'drifted' | 'missing';
  syncedRev: number;
  canonicalRev: number;
}

interface StudioOverviewPanelProps {
  locale: LocaleCode;
  isAdmin: boolean;
  tracks: StudioTrackDto[];
  usersList: UserProfileDto[];
  siteSettings: SiteSettingsDto;
  onOpenEditorTarget: (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
    targetLocale: LocaleCode,
  ) => void;
  onStartQuickNewStep: () => void;
  onSwitchSection: (section: StudioSectionId) => void;
}

export function StudioOverviewPanel({
  locale,
  isAdmin,
  tracks,
  usersList,
  siteSettings,
  onOpenEditorTarget,
  onStartQuickNewStep,
  onSwitchSection,
}: StudioOverviewPanelProps) {
  const s = UI_COPY[locale].studio;
  const st = s.settings;
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [updateErr, setUpdateErr] = useState(false);

  const handleQuickUpdateCheck = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateErr(false);
    try {
      const res = await api.checkSiteUpdate();
      setUpdateInfo(res);
    } catch {
      setUpdateErr(true);
    } finally {
      setCheckingUpdate(false);
    }
  };
  const activeLocales = LOCALES.filter((l) =>
    siteSettings.enabled_locales.includes(l.code),
  );
  const localesToTrack = activeLocales.length > 0 ? activeLocales : LOCALES;

  let chapterCount = 0;
  let stepCount = 0;
  let publishedDocs = 0;
  let draftDocs = 0;
  const pendingQueue: PendingTranslationItem[] = [];

  for (const track of tracks) {
    chapterCount += track.chapters.length;
    for (const ch of track.chapters) {
      stepCount += ch.steps.length;
      for (const st of ch.steps) {
        for (const loc of localesToTrack) {
          const found = st.translations.find((tr) => tr.locale === loc.code);
          if (!found) {
            pendingQueue.push({
              trackSlug: track.slug,
              chapterSlug: ch.slug,
              stepSlug: st.slug,
              stepTitle: st.title,
              stepNumber: st.step_number,
              locale: loc.code,
              kind: 'missing',
              syncedRev: 0,
              canonicalRev: st.canonical_revision,
            });
          } else if (found.status === 'draft') {
            draftDocs += 1;
            pendingQueue.push({
              trackSlug: track.slug,
              chapterSlug: ch.slug,
              stepSlug: st.slug,
              stepTitle: st.title,
              stepNumber: st.step_number,
              locale: loc.code,
              kind: 'draft',
              syncedRev: found.synced_revision,
              canonicalRev: st.canonical_revision,
            });
          } else {
            publishedDocs += 1;
            if (found.synced_revision < st.canonical_revision) {
              pendingQueue.push({
                trackSlug: track.slug,
                chapterSlug: ch.slug,
                stepSlug: st.slug,
                stepTitle: st.title,
                stepNumber: st.step_number,
                locale: loc.code,
                kind: 'drifted',
                syncedRev: found.synced_revision,
                canonicalRev: st.canonical_revision,
              });
            }
          }
        }
      }
    }
  }

  const priorityOrder = { draft: 0, drifted: 1, missing: 2 } as const;
  pendingQueue.sort((a, b) => priorityOrder[a.kind] - priorityOrder[b.kind]);

  const totalLocaleSlots = stepCount * localesToTrack.length;
  const coveragePercent =
    totalLocaleSlots > 0
      ? Math.round((publishedDocs / totalLocaleSlots) * 100)
      : 0;
  const authorOrAdminCount = usersList.filter(
    (u) => u.role === 'author' || u.role === 'admin',
  ).length;

  return (
    <div className="space-y-6">
      {/* Clean Header Row + ONE Primary Action */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink-primary m-0">
          {s.overviewTitle}
        </h1>

        <button
          type="button"
          onClick={onStartQuickNewStep}
          className="min-h-9 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer"
        >
          {s.startNewNoteCta}
        </button>
      </div>

      {/* 4 Calm Stat Tiles (subtle surface + 1px border, clear label-value hierarchy §2.5.3) */}
      <section
        aria-label={s.kpiRegionAria}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="studio-panel p-4 space-y-1.5">
          <div className="text-xs text-ink-muted">{s.kpiTracksLabel}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink-primary tabular-nums">
              {tracks.length}
            </span>
            <span className="text-xs text-ink-muted tabular-nums">
              {s.kpiTracksSub(chapterCount)}
            </span>
          </div>
        </div>

        <div className="studio-panel p-4 space-y-1.5">
          <div className="text-xs text-ink-muted">{s.kpiStepsLabel}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink-primary tabular-nums">
              {stepCount}
            </span>
            <span className="text-xs text-ink-muted tabular-nums">
              {s.kpiStepsSub(publishedDocs, draftDocs)}
            </span>
          </div>
        </div>

        <div className="studio-panel p-4 space-y-1.5">
          <div className="text-xs text-ink-muted">{s.kpiCoverageLabel}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink-primary tabular-nums">
              {coveragePercent}%
            </span>
            <span className="text-xs font-mono text-ink-muted tabular-nums">
              {publishedDocs}/{totalLocaleSlots}
            </span>
          </div>
        </div>

        <div className="studio-panel p-4 space-y-1.5">
          <div className="text-xs text-ink-muted">
            {isAdmin ? s.kpiResidentsLabel : s.kpiPendingLabel}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink-primary tabular-nums">
              {isAdmin ? usersList.length : pendingQueue.length}
            </span>
            <span className="text-xs text-ink-muted tabular-nums">
              {isAdmin
                ? s.kpiResidentsSub(authorOrAdminCount)
                : s.kpiPendingSub}
            </span>
          </div>
        </div>
      </section>

      {/* Main 2-Column Row: Left Pending Queue (7) | Right Track Health + Site Config (5) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-7 studio-panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-primary m-0">
              {s.queueTitle}
            </h2>
            <span className="text-xs font-mono text-ink-muted tabular-nums">
              {s.queueCount(pendingQueue.length)}
            </span>
          </div>

          {pendingQueue.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-accent-success font-semibold">
              {s.queueAllSyncedTitle}
            </div>
          ) : (
            <ul className="m-0 p-0 list-none divide-y divide-border-subtle">
              {pendingQueue.slice(0, 8).map((item) => {
                const badgeStyle =
                  item.kind === 'draft'
                    ? {
                        backgroundColor: 'var(--alert-note-badge-bg)',
                        color: 'var(--alert-note-badge-fg)',
                        label: s.badgeDraft,
                      }
                    : item.kind === 'drifted'
                      ? {
                          backgroundColor: 'var(--alert-warn-badge-bg)',
                          color: 'var(--alert-warn-badge-fg)',
                          label: s.badgeDrifted(item.syncedRev, item.canonicalRev),
                        }
                      : {
                          backgroundColor: 'var(--surface-raised)',
                          color: 'var(--ink-muted)',
                          label: s.badgeMissing,
                        };

                return (
                  <li
                    key={`${item.trackSlug}/${item.chapterSlug}/${item.stepSlug}/${item.locale}`}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-raised/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2.5">
                      <span className="w-12 text-center py-0.5 rounded text-xs font-mono bg-surface-raised text-ink-secondary shrink-0">
                        {item.locale}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-xs font-mono font-semibold shrink-0"
                        style={{
                          backgroundColor: badgeStyle.backgroundColor,
                          color: badgeStyle.color,
                        }}
                      >
                        {badgeStyle.label}
                      </span>
                      <span className="text-sm text-ink-primary studio-ellipsis">
                        {item.stepTitle}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onOpenEditorTarget(
                          item.trackSlug,
                          item.chapterSlug,
                          item.stepSlug,
                          item.locale,
                        )
                      }
                      className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle cursor-pointer shrink-0 transition-colors"
                    >
                      {item.kind === 'draft'
                        ? s.actionContinueDraft
                        : item.kind === 'drifted'
                          ? s.actionSyncDrift
                          : s.actionAddTranslation}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {pendingQueue.length > 8 && (
            <div className="px-5 py-2.5 border-t border-border-subtle text-end">
              <button
                type="button"
                onClick={() => onSwitchSection('catalog')}
                className="inline-flex items-center min-h-7 px-1.5 rounded-lg text-xs font-semibold text-link-ink hover:underline cursor-pointer"
              >
                {s.viewAllInMatrix(pendingQueue.length)}
              </button>
            </div>
          )}
        </section>

        <div className="xl:col-span-5 space-y-5">
          {/* Track Coverage */}
          <section className="studio-panel p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-primary m-0">
                {s.trackHealthTitle}
              </h2>
              <button
                type="button"
                onClick={() => onSwitchSection('catalog')}
                className="inline-flex items-center min-h-7 px-1.5 -me-1.5 rounded-lg text-xs font-semibold text-link-ink hover:underline cursor-pointer"
              >
                {s.manageMatrixLink}
              </button>
            </div>

            <div className="space-y-3.5">
              {tracks.map((t) => {
                const steps = t.chapters.flatMap((c) => c.steps);
                const maxDocs = steps.length * localesToTrack.length;
                const pubCount = steps.reduce(
                  (acc, st) =>
                    acc +
                    st.translations.filter(
                      (tr) =>
                        tr.status !== 'draft' &&
                        localesToTrack.some((l) => l.code === tr.locale),
                    ).length,
                  0,
                );
                const pct =
                  maxDocs > 0 ? Math.round((pubCount / maxDocs) * 100) : 0;

                return (
                  <div key={t.track_id} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-ink-primary studio-ellipsis">
                        {t.title}
                      </span>
                      <span className="text-xs font-mono text-ink-muted tabular-nums shrink-0">
                        {pct}% ({pubCount}/{maxDocs})
                      </span>
                    </div>
                    <div
                      aria-hidden="true"
                      className="w-full h-1.5 rounded-full bg-surface-sunken overflow-hidden"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            pct === 100
                              ? 'var(--palette-success-500)'
                              : 'var(--action-bg)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Live Site Config Snapshot */}
          <section className="studio-panel p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-primary m-0">
                {s.siteConfigCardTitle}
              </h2>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => onSwitchSection('settings')}
                  className="inline-flex items-center min-h-7 px-1.5 -me-1.5 rounded-lg text-xs font-semibold text-link-ink hover:underline cursor-pointer"
                >
                  {s.openSettingsLink}
                </button>
              )}
            </div>

            <dl className="m-0 divide-y divide-border-subtle text-xs">
              <div className="py-2 flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{s.configSiteName}</dt>
                <dd className="m-0 font-semibold text-ink-primary studio-ellipsis">
                  {siteSettings.site_name}
                </dd>
              </div>
              <div className="py-2 flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{s.configDefaultLocale}</dt>
                <dd className="m-0 font-mono text-ink-primary">
                  {siteSettings.default_locale}
                </dd>
              </div>
              <div className="py-2 flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{s.configEnabledLocales}</dt>
                <dd className="m-0 font-mono text-ink-secondary">
                  {siteSettings.enabled_locales.join(', ')}
                </dd>
              </div>
              <div className="py-2 flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{s.configSsoStatus}</dt>
                <dd className="m-0 font-mono text-ink-secondary">
                  {siteSettings.sso_enabled
                    ? s.statusEnabled
                    : s.statusDisabled}
                </dd>
              </div>
              <div className="py-2 flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{s.configDraftAutosave}</dt>
                <dd className="m-0 font-mono text-ink-secondary tabular-nums">
                  {siteSettings.enable_draft_autosave
                    ? `${s.statusEnabled} · ${siteSettings.draft_autosave_interval_secs}s`
                    : s.statusDisabled}
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{st.currentVersionLabel}</dt>
                <dd className="m-0 flex items-center gap-2">
                  <span className="font-mono text-ink-primary">
                    {updateInfo?.current_version ?? APP_VERSION}
                  </span>
                  <span role="status" aria-live="polite" className="inline-flex items-center">
                    {!checkingUpdate && updateErr ? (
                      <span className="text-accent-danger font-semibold">
                        {st.updateCheckFailed}
                      </span>
                    ) : !checkingUpdate && updateInfo ? (
                      updateInfo.has_update ? (
                        <a
                          href={updateInfo.release_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono font-semibold text-link-ink no-underline hover:underline"
                        >
                          {st.updateAvailableBadge(updateInfo.latest_version)} ↗
                        </a>
                      ) : (
                        <span className="text-accent-success font-semibold">
                          ✓ {st.upToDateBadge}
                        </span>
                      )
                    ) : null}
                  </span>
                  <button
                    type="button"
                    disabled={checkingUpdate}
                    onClick={() => void handleQuickUpdateCheck()}
                    className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle cursor-pointer disabled:opacity-60 transition-colors"
                  >
                    {checkingUpdate ? st.checkingUpdateBtn : st.checkUpdateBtn}
                  </button>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
