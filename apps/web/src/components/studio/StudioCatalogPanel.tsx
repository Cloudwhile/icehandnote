/*
 * Decoupled Studio Catalog Matrix & Track/Chapter Creation Panel (`StudioPage` Section C).
 * Reuses `<StatusBadge>`, `<NotebookEmptyState>`, and `<ConfirmDialog tone="danger">`.
 */

import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, getEnabledLocaleMetas, UI_COPY } from '../../lib/i18n';
import { SafeHtml, stripHtmlTags } from '../../lib/sanitizer';
import {
  type LocaleCode,
  resolveCustomTrackBadge,
  type SiteSettingsDto,
  type StudioTrackDto,
} from '../../lib/types';
import { NotebookEmptyState } from '../notebook/NotebookEmptyState';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  ALL_TRACK_ICON_KINDS,
  IconAlertTriangle,
  IconCheck,
  IconClose,
  IconPlus,
  IconTag,
  TrackHandIcon,
} from '../ui/Icons';
import { PopupMenu } from '../ui/PopupMenu';
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

function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((part) => part.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, 8);
}

function TrackMetaEditorForm({
  locale,
  track,
  busy,
  onSave,
  onClose,
}: {
  locale: LocaleCode;
  track: StudioTrackDto;
  busy: boolean;
  onSave: (badge: string, tags: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const extStudio = EXT_COPY[locale].studio;
  const badgeId = useId();
  const tagsId = useId();
  const [badgeInput, setBadgeInput] = useState(() =>
    resolveCustomTrackBadge(track.difficulty),
  );
  const [tagsInput, setTagsInput] = useState(() => (track.tags ?? []).join(', '));

  useEffect(() => {
    setBadgeInput(resolveCustomTrackBadge(track.difficulty));
  }, [track.difficulty]);

  useEffect(() => {
    setTagsInput((track.tags ?? []).join(', '));
  }, [track.tags]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void onSave(badgeInput.trim(), parseTagsInput(tagsInput)).then(() => {
      onClose();
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) {
          e.preventDefault();
        }
      }}
      className="p-3 space-y-3 w-64"
    >
      <div>
        <label
          htmlFor={badgeId}
          className="block mb-1 text-xs font-semibold text-ink-secondary"
        >
          {extStudio.trackBadgeLabel}
        </label>
        <input
          id={badgeId}
          name="track_badge"
          type="text"
          maxLength={24}
          value={badgeInput}
          onChange={(e) => setBadgeInput(e.target.value)}
          placeholder={extStudio.trackBadgePlaceholder}
          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs ink-input-inset"
        />
      </div>

      <div>
        <label
          htmlFor={tagsId}
          className="block mb-1 text-xs font-semibold text-ink-secondary"
        >
          {extStudio.trackTagsLabel}
        </label>
        <input
          id={tagsId}
          name="track_tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={extStudio.trackTagsPlaceholder}
          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs ink-input-inset"
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          disabled={busy || !badgeInput.trim()}
          onClick={() => setBadgeInput('')}
          className="min-h-7 px-2 py-1 rounded-lg text-xs text-ink-muted hover:text-ink-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {extStudio.clearTrackMetaBtn}
        </button>

        <button
          type="submit"
          disabled={busy}
          className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
        >
          {extStudio.saveTrackMetaBtn}
        </button>
      </div>
    </form>
  );
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

  // Create Track form state (collapsed cleanly behind CTA when tracks already exist)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [trackSlugInput, setTrackSlugInput] = useState('');
  const [trackTitleInput, setTrackTitleInput] = useState('');
  const [trackDescInput, setTrackDescInput] = useState('');
  const [trackBadgeInput, setTrackBadgeInput] = useState('');
  const [trackTagsInput, setTrackTagsInput] = useState('');
  const [trackIconKind, setTrackIconKind] = useState<string>('snowflake');
  const [updatingTrackSlug, setUpdatingTrackSlug] = useState<string | null>(
    null,
  );
  const [deleteCatalogTarget, setDeleteCatalogTarget] = useState<{
    kind: 'track';
    trackSlug: string;
  } | null>(null);
  const [deletingCatalog, setDeletingCatalog] = useState(false);

  const createFormVisible = tracks.length === 0 || showCreateForm;

  const handleCreateTrack = async (e: FormEvent) => {
    e.preventDefault();
    if (!trackSlugInput.trim() || !trackTitleInput.trim()) return;
    try {
      const created = await api.studioCreateTrack({
        slug: trackSlugInput.trim(),
        difficulty: trackBadgeInput.trim(),
        icon_kind: trackIconKind,
        tags: parseTagsInput(trackTagsInput),
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
      setTrackBadgeInput('');
      setTrackTagsInput('');
      setTrackIconKind('snowflake');
      setShowCreateForm(false);
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

  const handleChangeExistingTrackIcon = async (
    slug: string,
    nextKind: string,
  ) => {
    if (updatingTrackSlug) return;
    setUpdatingTrackSlug(slug);
    try {
      await api.studioUpdateTrackMeta(slug, { icon_kind: nextKind });
      await onRefreshOverview();
      toast.success(extCopy.studio.trackIconUpdatedToast);
    } catch (err) {
      toast.error(err);
    } finally {
      setUpdatingTrackSlug(null);
    }
  };

  const handleSaveTrackLabels = async (
    slug: string,
    nextBadge: string,
    nextTags: string[],
  ) => {
    if (updatingTrackSlug) return;
    setUpdatingTrackSlug(slug);
    try {
      await api.studioUpdateTrackMeta(slug, {
        difficulty: nextBadge,
        tags: nextTags,
      });
      await onRefreshOverview();
      toast.success(extCopy.studio.trackMetaUpdatedToast);
    } catch (err) {
      toast.error(err);
    } finally {
      setUpdatingTrackSlug(null);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary m-0">
          {s.catalogTitle}
        </h1>
        {tracks.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="min-h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary inline-flex items-center gap-1.5 cursor-pointer"
          >
            {createFormVisible ? (
              <IconClose className="w-3.5 h-3.5" />
            ) : (
              <IconPlus className="w-3.5 h-3.5" />
            )}
            <span>{s.addTrackShort.replace(/^\+\s*/, '')}</span>
          </button>
        )}
      </div>

      {tracks.length === 0 ? (
        <div className="studio-panel p-6">
          <NotebookEmptyState
            title={s.catalogEmptyTitle}
            description={s.catalogEmptyDesc}
          />
        </div>
      ) : (
        tracks.map((t) => {
          const customBadge = resolveCustomTrackBadge(t.difficulty);
          const trackTags = t.tags ?? [];
          return (
            <div key={t.track_id} className="studio-panel p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <PopupMenu
                    variant="panel"
                    align="start"
                    showChevron={false}
                    triggerDisabled={updatingTrackSlug === t.slug}
                    triggerAriaLabel={`${extCopy.studio.trackIconLabel}: ${stripHtmlTags(t.title)}`}
                    triggerTitle={extCopy.studio.trackIconLabel}
                    triggerClassName="w-10 h-10 rounded-xl border border-border-subtle bg-surface-raised hover:border-border-ink text-link-ink inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                    triggerLabel={<TrackHandIcon kind={t.icon_kind} className="w-5 h-5" />}
                  >
                    {({ close }) => (
                      <div className="p-2.5 space-y-2 w-56">
                        <div className="text-xs font-semibold text-ink-secondary">
                          {extCopy.studio.trackIconLabel}
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {ALL_TRACK_ICON_KINDS.map((kind) => {
                            const selected = t.icon_kind === kind;
                            return (
                              <button
                                key={kind}
                                type="button"
                                aria-label={kind}
                                aria-pressed={selected}
                                onClick={() => {
                                  close();
                                  if (!selected) {
                                    void handleChangeExistingTrackIcon(t.slug, kind);
                                  }
                                }}
                                className={`h-9 rounded-lg border inline-flex items-center justify-center cursor-pointer transition-colors ${
                                  selected
                                    ? 'border-action-bg bg-action-subtle text-link-ink'
                                    : 'border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-ink hover:text-ink-primary'
                                }`}
                              >
                                <TrackHandIcon kind={kind} className="w-4 h-4" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </PopupMenu>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-muted">
                        {t.slug}
                      </span>
                      {trackTags.map((tag) => (
                        <span key={tag} className="font-mono text-xs text-ink-muted">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <h2 className="text-base font-semibold text-ink-primary m-0">
                      <SafeHtml as="span" html={t.title} />
                    </h2>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {customBadge && (
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface-raised border border-border-subtle text-ink-secondary">
                      {customBadge}
                    </span>
                  )}

                  <PopupMenu
                    variant="panel"
                    align="end"
                    showChevron={false}
                    triggerDisabled={updatingTrackSlug === t.slug}
                    triggerAriaLabel={`${extCopy.studio.editTrackMetaBtn}: ${stripHtmlTags(t.title)}`}
                    triggerClassName="min-h-7 px-2.5 py-1 rounded-lg border border-border-subtle bg-surface-raised hover:border-border-ink text-xs font-semibold text-ink-secondary inline-flex items-center gap-1 cursor-pointer transition-colors"
                    triggerLabel={
                      <>
                        <IconTag className="w-3.5 h-3.5 text-ink-muted" />
                        <span>{extCopy.studio.editTrackMetaBtn}</span>
                      </>
                    }
                  >
                    {({ close }) => (
                      <TrackMetaEditorForm
                        locale={locale}
                        track={t}
                        busy={updatingTrackSlug === t.slug}
                        onClose={close}
                        onSave={(nextBadge, nextTags) =>
                          handleSaveTrackLabels(t.slug, nextBadge, nextTags)
                        }
                      />
                    )}
                  </PopupMenu>

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

                {(() => {
                  const allSteps = t.chapters.flatMap((ch) =>
                    ch.steps.map((st) => ({ ch, st })),
                  );
                  if (allSteps.length === 0) {
                    return (
                      <NotebookEmptyState
                        title={s.catalogEmptyTitle}
                        description={s.catalogEmptyDesc}
                      />
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {allSteps.map(({ ch, st }) => (
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
                                              backgroundColor: 'var(--surface-sheet)',
                                              borderColor: 'var(--border-subtle)',
                                              color: 'var(--ink-secondary)',
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
                  );
                })()}
              </div>
            </div>
          );
        })
      )}

      {/* Create New Series Form (author-customizable optional badge & tags, no preset difficulty enum) */}
      {createFormVisible && (
        <div className="max-w-xl">
          <form
            onSubmit={(e) => void handleCreateTrack(e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                e.preventDefault();
              }
            }}
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
                name="slug"
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
                name="title"
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
                name="description"
                type="text"
                value={trackDescInput}
                onChange={(e) => setTrackDescInput(e.target.value)}
                placeholder={s.trackDescPlaceholder}
                className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
              />
            </div>
            <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="new-track-badge"
                  className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                >
                  {extCopy.studio.trackBadgeLabel}
                </label>
                <input
                  id="new-track-badge"
                  name="badge"
                  type="text"
                  maxLength={24}
                  value={trackBadgeInput}
                  onChange={(e) => setTrackBadgeInput(e.target.value)}
                  placeholder={extCopy.studio.trackBadgePlaceholder}
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs ink-input-inset"
                />
              </div>
              <div>
                <label
                  htmlFor="new-track-tags"
                  className="block mb-1.5 text-xs font-semibold text-ink-secondary"
                >
                  {extCopy.studio.trackTagsLabel}
                </label>
                <input
                  id="new-track-tags"
                  name="tags"
                  type="text"
                  value={trackTagsInput}
                  onChange={(e) => setTrackTagsInput(e.target.value)}
                  placeholder={extCopy.studio.trackTagsPlaceholder}
                  className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs ink-input-inset"
                />
              </div>
            </div>
            <div className="mb-5">
              <span className="block mb-2 text-xs font-semibold text-ink-secondary">
                {extCopy.studio.trackIconLabel}
              </span>
              <div className="grid grid-cols-8 gap-1.5">
                {ALL_TRACK_ICON_KINDS.map((kind) => {
                  const selected = trackIconKind === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-label={kind}
                      title={kind}
                      aria-pressed={selected}
                      onClick={() => setTrackIconKind(kind)}
                      className={`h-9 rounded-xl border inline-flex items-center justify-center cursor-pointer transition-colors ${
                        selected
                          ? 'border-action-bg bg-action-subtle text-link-ink'
                          : 'border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-ink hover:text-ink-primary'
                      }`}
                    >
                      <TrackHandIcon kind={kind} className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="submit"
              className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
            >
              {s.createTrackSubmit}
            </button>
          </form>
        </div>
      )}

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
