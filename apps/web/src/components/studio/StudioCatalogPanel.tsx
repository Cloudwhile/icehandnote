/*
 * Decoupled Studio Catalog Matrix & Track/Chapter Creation Panel (`StudioPage` Section C).
 * Reuses `<StatusBadge>`, `<NotebookEmptyState>`, and `<ConfirmDialog tone="danger">`.
 */

import { type FormEvent, useEffect, useMemo, useState } from 'react';
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
  const [firstChSlugInput, setFirstChSlugInput] = useState('01-basics');
  const [firstChTitleInput, setFirstChTitleInput] = useState('');

  // Create Chapter form state
  const [newChTrack, setNewChTrack] = useState(tracks[0]?.slug ?? '');
  const [newChSlug, setNewChSlug] = useState('');
  const [newChNumber, setNewChNumber] = useState(2);
  const [newChTitle, setNewChTitle] = useState('');

  const [deleteCatalogTarget, setDeleteCatalogTarget] = useState<
    | { kind: 'track'; trackSlug: string }
    | { kind: 'chapter'; trackSlug: string; chapterSlug: string }
    | null
  >(null);
  const [deletingCatalog, setDeletingCatalog] = useState(false);

  useEffect(() => {
    if (tracks.length > 0 && (!newChTrack || !tracks.some((t) => t.slug === newChTrack))) {
      setNewChTrack(tracks[0].slug);
    }
  }, [tracks, newChTrack]);

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
        first_chapter_slug: firstChSlugInput.trim() || '01-basics',
        first_chapter_title: firstChTitleInput.trim() || trackTitleInput.trim(),
      });
      await onRefreshOverview();
      setTrackSlugInput('');
      setTrackTitleInput('');
      setTrackDescInput('');
      toast.success(s.trackCreatedBanner(stripHtmlTags(created.title)));
      onOpenEditorTarget(
        created.slug,
        created.chapters[0]?.slug ?? '01-basics',
        '01-intro',
        locale,
      );
    } catch (err) {
      toast.error(err);
    }
  };

  const handleCreateChapter = async (e: FormEvent) => {
    e.preventDefault();
    if (!newChSlug.trim() || !newChTitle.trim()) return;
    try {
      await api.studioCreateChapter({
        track_slug: newChTrack,
        slug: newChSlug.trim(),
        number: newChNumber,
        title_zh_tw: newChTitle.trim(),
      });
      await onRefreshOverview();
      setNewChSlug('');
      setNewChTitle('');
      toast.success(s.chapterCreatedBanner(newChTrack));
    } catch (err) {
      toast.error(err);
    }
  };

  const handleConfirmDeleteCatalog = async () => {
    if (!deleteCatalogTarget || deletingCatalog) return;
    setDeletingCatalog(true);
    try {
      if (deleteCatalogTarget.kind === 'track') {
        await api.studioDeleteTrack(deleteCatalogTarget.trackSlug);
        toast.success(extCopy.studio.trackDeletedMsg);
      } else {
        await api.studioDeleteChapter(
          deleteCatalogTarget.trackSlug,
          deleteCatalogTarget.chapterSlug,
        );
        toast.success(extCopy.studio.chapterDeletedMsg);
      }
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

            {t.chapters.map((ch) => (
              <div
                key={ch.chapter_id}
                className="rounded-xl p-4 bg-surface-raised space-y-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-primary">
                    <SafeHtml as="span" html={ch.title} />{' '}
                    <span className="font-mono text-xs text-ink-muted">
                      ({ch.slug})
                    </span>
                  </span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onQuickNewStep(t.slug, ch.slug)}
                      className="min-h-7 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
                    >
                      {s.addStepHereBtn}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteCatalogTarget({
                            kind: 'chapter',
                            trackSlug: t.slug,
                            chapterSlug: ch.slug,
                          })
                        }
                        className="min-h-7 text-xs font-semibold text-accent-danger hover:underline cursor-pointer"
                      >
                        {extCopy.studio.deleteChapterBtn}
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {ch.steps.map((st) => (
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
                              {loc.code}{' '}
                              {!found
                                ? s.addLocaleAction
                                : found.status === 'draft'
                                  ? s.draftParen
                                  : drifted
                                    ? `⚠v${found.synced_revision}`
                                    : `✓v${found.synced_revision}`}
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
            ))}
          </div>
        ))
      )}

      {/* Create New Track & Chapter Forms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div>
              <label
                htmlFor="new-track-diff"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.difficultyLabel}
              </label>
              <select
                id="new-track-diff"
                value={trackDifficulty}
                onChange={(e) => setTrackDifficulty(e.target.value)}
                className="ink-select w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs"
              >
                <option value="beginner">{copy.difficultyLabels.beginner}</option>
                <option value="intermediate">
                  {copy.difficultyLabels.intermediate}
                </option>
                <option value="advanced">{copy.difficultyLabels.advanced}</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="new-track-chslug"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.firstChapterSlugLabel}
              </label>
              <input
                id="new-track-chslug"
                type="text"
                value={firstChSlugInput}
                onChange={(e) => setFirstChSlugInput(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono"
              />
            </div>
            <div>
              <label
                htmlFor="new-track-chtitle"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.firstChapterTitleLabel}
              </label>
              <input
                id="new-track-chtitle"
                type="text"
                value={firstChTitleInput}
                onChange={(e) => setFirstChTitleInput(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs"
              />
            </div>
          </div>
          <button
            type="submit"
            className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
          >
            {s.createTrackSubmit}
          </button>
        </form>

        <form
          onSubmit={(e) => void handleCreateChapter(e)}
          className="studio-panel p-5"
        >
          <h3 className="text-base font-semibold text-ink-primary mb-5">
            {s.createChapterTitle}
          </h3>
          <div className="mb-5">
            <label
              htmlFor="ch-parent-track"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.parentTrackLabel}
            </label>
            <select
              id="ch-parent-track"
              value={newChTrack}
              onChange={(e) => setNewChTrack(e.target.value)}
              className="ink-select w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm"
            >
              {tracks.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {stripHtmlTags(t.title)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="sm:col-span-2">
              <label
                htmlFor="new-ch-slug"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.chapterSlugLabel}
              </label>
              <input
                id="new-ch-slug"
                type="text"
                required
                value={newChSlug}
                onChange={(e) => setNewChSlug(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm font-mono ink-input-inset"
              />
            </div>
            <div>
              <label
                htmlFor="new-ch-num"
                className="block mb-1.5 text-xs font-semibold text-ink-secondary"
              >
                {s.chapterNumLabel}
              </label>
              <input
                id="new-ch-num"
                type="number"
                min={1}
                value={newChNumber}
                onChange={(e) => setNewChNumber(Number(e.target.value) || 1)}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm tabular-nums"
              />
            </div>
          </div>
          <div className="mb-5">
            <label
              htmlFor="new-ch-title"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.chapterTitleLabel}
            </label>
            <input
              id="new-ch-title"
              type="text"
              required
              value={newChTitle}
              onChange={(e) => setNewChTitle(e.target.value)}
              placeholder={s.chapterTitlePlaceholder}
              className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
            />
          </div>
          <button
            type="submit"
            className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer"
          >
            {s.createChapterSubmit}
          </button>
        </form>
      </div>

      {/* Delete Track / Chapter Confirmation Modal */}
      <ConfirmDialog
        open={Boolean(deleteCatalogTarget)}
        onClose={() => setDeleteCatalogTarget(null)}
        tone="danger"
        busy={deletingCatalog}
        title={
          deleteCatalogTarget?.kind === 'track'
            ? extCopy.studio.deleteTrackDialogTitle(deleteCatalogTarget.trackSlug)
            : extCopy.studio.deleteChapterDialogTitle(
                deleteCatalogTarget?.kind === 'chapter'
                  ? deleteCatalogTarget.chapterSlug
                  : '',
              )
        }
        description={
          deleteCatalogTarget?.kind === 'track'
            ? extCopy.studio.deleteTrackDialogDesc
            : extCopy.studio.deleteChapterDialogDesc
        }
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={s.deleteConfirmBtn}
        onConfirm={() => void handleConfirmDeleteCatalog()}
      />
    </div>
  );
}
