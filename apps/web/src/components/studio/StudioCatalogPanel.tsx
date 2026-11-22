/*
 * Decoupled Studio Catalog Matrix & Track/Chapter Creation Panel (`StudioPage` Section C).
 * Reuses `<StatusBadge>`, `<NotebookEmptyState>`, and `<ConfirmDialog tone="danger">`.
 */

import { type FormEvent, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, getEnabledLocaleMetas, UI_COPY } from '../../lib/i18n';
import { SafeHtml, stripHtmlTags } from '../../lib/sanitizer';
import type {
  LocaleCode,
  SiteSettingsDto,
  StudioTrackDto,
} from '../../lib/types';
import { NotebookEmptyState } from '../notebook/NotebookEmptyState';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { IconAlertTriangle, IconCheck } from '../ui/Icons';
import { InkSelect } from '../ui/InkSelect';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/ToastProvider';

export interface TakedownStepTarget {
  trackSlug: string;
  chapterSlug: string;
  stepSlug: string;
  title: string;
}

export interface StudioCatalogPanelProps {
  locale: LocaleCode;
  isAdmin: boolean;
  tracks: StudioTrackDto[];
  siteSettings: SiteSettingsDto;
  onRefreshOverview: () => Promise<StudioTrackDto[] | undefined>;
  onOpenEditorTarget: (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
    targetLocale: LocaleCode,
  ) => void;
  onQuickNewStep: (trackSlug: string, chapterSlug: string) => void;
  onRequestTakedown: (target: TakedownStepTarget) => void;
  onRestoreStep: (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
  ) => void;
}

export function StudioCatalogPanel({
  locale,
  isAdmin,
  tracks,
  siteSettings,
  onRefreshOverview,
  onOpenEditorTarget,
  onQuickNewStep,
  onRequestTakedown,
  onRestoreStep,
}: StudioCatalogPanelProps) {
  const copy = UI_COPY[locale];
  const s = copy.studio;
  const extCopy = EXT_COPY[locale];
  const toast = useToast();

  const enabledStudioLocales = useMemo(
    () => getEnabledLocaleMetas(siteSettings.enabled_locales),
    [siteSettings.enabled_locales],
  );

  // Create Track form state
  const [trackSlugInput, setTrackSlugInput] = useState('');
  const [trackTitleInput, setTrackTitleInput] = useState('');
  const [trackDescInput, setTrackDescInput] = useState('');
  const [trackDifficulty, setTrackDifficulty] = useState('intermediate');
  const [deleteCatalogTarget, setDeleteCatalogTarget] = useState<{
    kind: 'track';
    trackSlug: string;
  } | null>(null);
  const [deletingCatalog, setDeletingCatalog] = useState(false);

  const handleCreateTrack = async (e: FormEvent) => {
    e.preventDefault();
    if (!trackSlugInput.trim() || !trackTitleInput.trim()) return;
    try {
      const created = await api.studioCreateTrack({
        slug: trackSlugInput.trim(),
        difficulty: trackDifficulty,
        icon_kind: 'snowflake',
        tags: [],
        title_zh_tw: trackTitleInput.trim(),
        subtitle_zh_tw: trackDescInput.trim(),
        description_zh_tw: trackDescInput.trim(),
        first_chapter_slug: 'chapters',
        first_chapter_title: trackTitleInput.trim(),
      });
      await onRefreshOverview();
      setTrackSlugInput('');
      setTrackTitleInput('');
      setTrackDescInput('');
      toast.success(s.trackCreatedBanner(stripHtmlTags(created.title)));
      onOpenEditorTarget(
        created.slug,
        created.chapters[0]?.slug ?? 'chapters',
        '01-intro',
        locale,
      );
    } catch (err) {
      toast.error(err);
    }
  };

  const handleConfirmDeleteCatalog = async () => {
    if (!deleteCatalogTarget || deletingCatalog) return;
    setDeletingCatalog(true);
    try {
      await api.studioDeleteTrack(deleteCatalogTarget.trackSlug);
      toast.success(extCopy.studio.trackDeletedMsg);
      setDeleteCatalogTarget(null);
      await onRefreshOverview();
    } catch (err) {
      toast.error(err);
    } finally {
      setDeletingCatalog(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink-primary">
        {s.catalogTitle}
      </h1>

      {tracks.length === 0 ? (
        <div className="studio-panel p-6">
          <NotebookEmptyState
            title={s.catalogEmptyTitle}
            description={s.catalogEmptyDesc}
          />
        </div>
      ) : (
        tracks.map((t) => (
          <div key={t.track_id} className="studio-panel p-5 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-mono text-xs text-ink-muted">
                  {t.slug}
                </span>
                <h2 className="text-base font-semibold text-ink-primary">
                  <SafeHtml as="span" html={t.title} />
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-surface-raised text-ink-secondary">
                  {copy.difficultyLabels[t.difficulty] ?? t.difficulty}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteCatalogTarget({
                        kind: 'track',
                        trackSlug: t.slug,
                      })
                    }
                    className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised cursor-pointer"
                  >
                    {extCopy.studio.deleteTrackBtn}
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl p-4 bg-surface-raised space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink-muted tabular-nums">
                  {copy.formatTrackCounts(
                    t.chapters.length,
                    t.chapters.reduce((acc, c) => acc + c.steps.length, 0),
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onQuickNewStep(t.slug, t.chapters[0]?.slug ?? 'chapters')
                  }
                  className="min-h-7 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
                >
                  {s.addStepHereBtn}
                </button>
              </div>

              <div className="space-y-2">
                {t.chapters
                  .flatMap((ch) => ch.steps.map((st) => ({ ch, st })))
                  .map(({ ch, st }) => (
                    <div
                      key={st.step_id}
                      className="p-3 rounded-xl bg-surface-sheet flex flex-wrap items-baseline justify-between gap-3"
                    >
                      <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-xs text-ink-muted tabular-nums">
                          #{st.step_number}
                        </span>
                        <span className="text-sm font-semibold text-ink-primary">
                          <SafeHtml as="span" html={st.title} />
                        </span>
                        <span className="font-mono text-xs text-ink-muted tabular-nums">
                          {s.canonicalRevMeta(st.version ?? st.canonical_revision)}
                        </span>
                        {st.authors && st.authors.length > 0 && (
                          <span className="text-xs text-ink-muted">
                            · {st.authors.map((a) => a.display_name).join(', ')}
                          </span>
                        )}
                        {st.takedown_reason && (
                          <StatusBadge
                            tone="danger"
                            mono
                            className="px-1.5"
                            title={st.takedown_reason}
                          >
                            {extCopy.studio.takenDownBadge}
                          </StatusBadge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {enabledStudioLocales.map((loc) => {
                          const found = st.translations.find(
                            (tr) => tr.locale === loc.code,
                          );
                          const drifted =
                            found &&
                            found.synced_revision < st.canonical_revision;
                          return (
                            <button
                              key={loc.code}
                              type="button"
                              onClick={() =>
                                onOpenEditorTarget(
                                  t.slug,
                                  ch.slug,
                                  st.slug,
                                  loc.code,
                                )
                              }
                              className="min-h-7 px-2.5 py-1 rounded-lg text-xs font-mono border cursor-pointer transition-colors"
                              style={
                                !found
                                  ? {
                                      borderColor: 'var(--border-subtle)',
                                      color: 'var(--ink-muted)',
                                    }
                                  : found.status === 'draft'
                                    ? {
                                        backgroundColor: 'var(--alert-note-bg)',
                                        borderColor: 'var(--alert-note-border)',
                                        color: 'var(--alert-note-title)',
                                      }
                                    : drifted
                                      ? {
                                          backgroundColor: 'var(--alert-warn-bg)',
                                          borderColor: 'var(--alert-warn-border)',
                                          color: 'var(--alert-warn-title)',
                                        }
                                      : {
                                          backgroundColor: 'var(--action-subtle)',
                                          borderColor: 'var(--border-subtle)',
                                          color: 'var(--ink-primary)',
                                        }
                              }
                            >
                              <span className="inline-flex items-center gap-1">
                                <span>{loc.code}</span>
                                {!found ? (
                                  <span>{s.addLocaleAction}</span>
                                ) : found.status === 'draft' ? (
                                  <span>{s.draftParen}</span>
                                ) : drifted ? (
                                  <span className="inline-flex items-center gap-0.5">
                                    <IconAlertTriangle className="w-3 h-3" />
                                    <span>v{found.synced_revision}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5">
                                    <IconCheck className="w-3 h-3" />
                                    <span>v{found.synced_revision}</span>
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}

                        {isAdmin &&
                          (st.takedown_reason ? (
                            <button
                              type="button"
                              onClick={() =>
                                onRestoreStep(t.slug, ch.slug, st.slug)
                              }
                              className="min-h-7 px-2 py-1 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle cursor-pointer"
                            >
                              {extCopy.studio.restoreBtn}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                onRequestTakedown({
                                  trackSlug: t.slug,
                                  chapterSlug: ch.slug,
                                  stepSlug: st.slug,
                                  title: stripHtmlTags(st.title) || st.slug,
                                })
                              }
                              className="min-h-7 px-2 py-1 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised cursor-pointer"
                            >
                              {extCopy.studio.takedownBtn}
                            </button>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ))
      )}

      {/* Create New Series Form (2-level: Series -> Chapters) */}
      <div className="max-w-xl">
        <form
          onSubmit={(e) => void handleCreateTrack(e)}
          className="studio-panel p-5"
        >
          <h3 className="text-base font-semibold text-ink-primary mb-5">
            {s.createTrackTitle}
          </h3>
          <div className="mb-5">
            <label
              htmlFor="new-track-slug"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.trackSlugLabel}
            </label>
            <input
              id="new-track-slug"
              type="text"
              required
              value={trackSlugInput}
              onChange={(e) => setTrackSlugInput(e.target.value)}
              placeholder={s.trackSlugPlaceholder}
              className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
            />
          </div>
          <div className="mb-5">
            <label
              htmlFor="new-track-title"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.trackTitleLabel}
            </label>
            <input
              id="new-track-title"
              type="text"
              required
              value={trackTitleInput}
              onChange={(e) => setTrackTitleInput(e.target.value)}
              placeholder={s.trackTitlePlaceholder}
              className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
            />
          </div>
          <div className="mb-5">
            <label
              htmlFor="new-track-desc"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.trackDescLabel}
            </label>
            <input
              id="new-track-desc"
              type="text"
              value={trackDescInput}
              onChange={(e) => setTrackDescInput(e.target.value)}
              placeholder={s.trackDescPlaceholder}
              className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
            />
          </div>
          <div className="mb-5">
            <label
              htmlFor="new-track-diff"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.difficultyLabel}
            </label>
            <InkSelect
              id="new-track-diff"
              value={trackDifficulty}
              onChange={setTrackDifficulty}
              options={[
                { value: 'beginner', label: copy.difficultyLabels.beginner },
                {
                  value: 'intermediate',
                  label: copy.difficultyLabels.intermediate,
                },
                { value: 'advanced', label: copy.difficultyLabels.advanced },
              ]}
              triggerClassName="w-full min-h-9 px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border-border-subtle text-xs"
            />
          </div>
          <button
            type="submit"
            className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
          >
            {s.createTrackSubmit}
          </button>
        </form>
      </div>

      {/* Delete Series Confirmation Modal */}
      <ConfirmDialog
        open={Boolean(deleteCatalogTarget)}
        onClose={() => setDeleteCatalogTarget(null)}
        tone="danger"
        busy={deletingCatalog}
        title={extCopy.studio.deleteTrackDialogTitle(
          deleteCatalogTarget?.trackSlug ?? '',
        )}
        description={extCopy.studio.deleteTrackDialogDesc}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={s.deleteConfirmBtn}
        onConfirm={() => void handleConfirmDeleteCatalog()}
      />
    </div>
  );
}
