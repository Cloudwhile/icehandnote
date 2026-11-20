/*
 * Refactoring UI Constraint Brief (Unified Studio Sidebar):
 * - Quiet recessed rail (`--surface-sunken`) keeping visual focus on the right workspace (§2.4).
 * - Article Tree is unified directly under the `创作器` (Editor) navigation item so picking or
 *   creating articles is a single cohesive hierarchy (eliminates detached `目录` section & redundant footer).
 */

import { useEffect, useMemo, useState } from 'react';
import { UI_COPY } from '../../lib/i18n';
import type { LocaleCode, StudioTrackDto } from '../../lib/types';
import {
  IconChevronDown,
  IconGrid,
  IconLayers,
  IconPen,
  IconSettings,
  IconShield,
} from '../ui/Icons';

export type StudioSectionId =
  | 'overview'
  | 'editor'
  | 'catalog'
  | 'users'
  | 'settings';

interface StudioSidebarContentProps {
  locale: LocaleCode;
  activeSection: StudioSectionId;
  onSelectSection: (section: StudioSectionId) => void;
  isAdmin: boolean;
  tracks: StudioTrackDto[];
  usersCount: number;
  pendingCount: number;
  selTrack: string;
  selChapter: string;
  selStep: string;
  onPickStep: (trackSlug: string, chapterSlug: string, stepSlug: string) => void;
  onQuickNewStep: (trackSlug: string, chapterSlug: string) => void;
  onCloseMobileDrawer?: () => void;
}

export function StudioSidebarContent({
  locale,
  activeSection,
  onSelectSection,
  isAdmin,
  tracks,
  usersCount,
  pendingCount,
  selTrack,
  selChapter,
  selStep,
  onPickStep,
  onQuickNewStep,
  onCloseMobileDrawer,
}: StudioSidebarContentProps) {
  const s = UI_COPY[locale].studio;
  const [treeQuery, setTreeQuery] = useState('');
  const [editorTreeOpen, setEditorTreeOpen] = useState(
    activeSection === 'editor',
  );

  // Auto-expand the nested article tree whenever the author enters Editor mode
  useEffect(() => {
    if (activeSection === 'editor') {
      setEditorTreeOpen(true);
    }
  }, [activeSection]);

  const filteredTracks = useMemo(() => {
    const q = treeQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks
      .map((t) => {
        const trackMatches =
          t.title.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
        const chapters = t.chapters
          .map((ch) => {
            const chMatches =
              trackMatches ||
              ch.title.toLowerCase().includes(q) ||
              ch.slug.toLowerCase().includes(q);
            const steps = chMatches
              ? ch.steps
              : ch.steps.filter(
                  (st) =>
                    st.title.toLowerCase().includes(q) ||
                    st.slug.toLowerCase().includes(q),
                );
            return { ...ch, steps };
          })
          .filter((ch) => ch.steps.length > 0 || trackMatches);
        return { ...t, chapters };
      })
      .filter((t) => t.chapters.length > 0);
  }, [tracks, treeQuery]);

  const navigateSection = (section: StudioSectionId) => {
    onSelectSection(section);
    onCloseMobileDrawer?.();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 p-3 studio-scroll-pane">
        <nav aria-label={s.navAriaLabel} className="space-y-1">
          {/* 1. Overview */}
          <button
            type="button"
            aria-current={activeSection === 'overview' ? 'page' : undefined}
            onClick={() => navigateSection('overview')}
            className="studio-nav-item"
          >
            <IconGrid className="w-4 h-4 text-ink-muted" />
            <span className="flex-1 studio-ellipsis">
              {s.sections.overview}
            </span>
            {pendingCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-full text-xs font-mono font-semibold tabular-nums shrink-0"
                style={{
                  backgroundColor: 'var(--alert-warn-badge-bg)',
                  color: 'var(--alert-warn-badge-fg)',
                }}
              >
                {pendingCount}
              </span>
            )}
          </button>

          {/* 2. Unified Editor + Nested Article Explorer Tree */}
          <div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-current={activeSection === 'editor' ? 'page' : undefined}
                onClick={() => {
                  setEditorTreeOpen(true);
                  onSelectSection('editor');
                }}
                className="studio-nav-item flex-1 min-w-0"
              >
                <IconPen className="w-4 h-4 text-ink-muted" />
                <span className="flex-1 studio-ellipsis">
                  {s.sections.editor}
                </span>
              </button>

              <button
                type="button"
                aria-expanded={editorTreeOpen}
                aria-label={s.explorerHeading}
                onClick={() => setEditorTreeOpen((v) => !v)}
                className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-sheet cursor-pointer shrink-0 transition-colors"
              >
                <IconChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    editorTreeOpen ? '' : '-rotate-90'
                  }`}
                />
              </button>
            </div>

            {editorTreeOpen && (
              <div className="ui-panel-enter ms-3.5 mt-1.5 mb-2 ps-2.5 border-s border-border-subtle space-y-2">
                <input
                  type="text"
                  role="searchbox"
                  aria-label={s.filterTreeAria}
                  value={treeQuery}
                  onChange={(e) => setTreeQuery(e.target.value)}
                  placeholder={s.filterTreePlaceholder}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-sheet text-ink-primary border border-border-subtle text-xs placeholder:text-ink-muted ink-input-inset"
                />

                <div className="space-y-1">
                  {filteredTracks.map((track) => {
                    const isCurrentTrack = track.slug === selTrack;
                    return (
                      <details
                        key={track.track_id}
                        open={isCurrentTrack || Boolean(treeQuery.trim())}
                        className="group"
                      >
                        <summary className="list-none px-1.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-ink-primary hover:bg-surface-sheet/70">
                          <span
                            aria-hidden="true"
                            className="text-xs text-ink-muted transition-transform group-open:rotate-90 shrink-0"
                          >
                            ▸
                          </span>
                          <span
                            className="flex-1 studio-ellipsis"
                            title={track.title}
                          >
                            {track.title}
                          </span>
                        </summary>

                        <div className="ms-2.5 ps-2 border-s border-border-subtle space-y-2 py-1">
                          {track.chapters.map((ch) => (
                            <div key={ch.chapter_id} className="space-y-0.5">
                              <div className="px-1 flex items-center justify-between gap-1">
                                <span
                                  className="text-xs text-ink-muted studio-ellipsis"
                                  title={ch.title}
                                >
                                  {ch.title}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onQuickNewStep(track.slug, ch.slug);
                                    onCloseMobileDrawer?.();
                                  }}
                                  aria-label={s.addStepInChapterAria(ch.title)}
                                  title={s.addStepInChapterTitle}
                                  className="min-w-6 min-h-6 inline-flex items-center justify-center rounded text-xs font-mono text-link-ink hover:bg-action-subtle cursor-pointer shrink-0"
                                >
                                  +
                                </button>
                              </div>

                              <ul className="m-0 p-0 list-none space-y-0.5">
                                {ch.steps.map((st) => {
                                  const active =
                                    activeSection === 'editor' &&
                                    track.slug === selTrack &&
                                    ch.slug === selChapter &&
                                    st.slug === selStep;
                                  const hasDraft = st.translations.some(
                                    (tr) => tr.status === 'draft',
                                  );
                                  const hasDrift = st.translations.some(
                                    (tr) =>
                                      tr.synced_revision < st.canonical_revision,
                                  );

                                  return (
                                    <li key={st.step_id}>
                                      <button
                                        type="button"
                                        aria-current={
                                          active ? 'location' : undefined
                                        }
                                        onClick={() => {
                                          onPickStep(
                                            track.slug,
                                            ch.slug,
                                            st.slug,
                                          );
                                          onCloseMobileDrawer?.();
                                        }}
                                        className={`w-full min-h-8 px-2 py-1 rounded-lg text-xs flex items-center gap-1.5 text-start cursor-pointer transition-colors ${
                                          active
                                            ? 'bg-action-subtle text-ink-primary font-semibold'
                                            : 'text-ink-secondary hover:bg-surface-sheet hover:text-ink-primary'
                                        }`}
                                      >
                                        <span className="font-mono text-xs text-ink-muted tabular-nums shrink-0">
                                          {st.step_number}.
                                        </span>
                                        <span className="flex-1 studio-ellipsis">
                                          {st.title}
                                        </span>
                                        {hasDraft && (
                                          <span
                                            className="text-xs font-mono px-1 rounded shrink-0"
                                            style={{
                                              backgroundColor:
                                                'var(--alert-note-badge-bg)',
                                              color:
                                                'var(--alert-note-badge-fg)',
                                            }}
                                            title={s.hasDraftTitle}
                                          >
                                            {s.draftChip}
                                          </span>
                                        )}
                                        {hasDrift && (
                                          <span
                                            aria-label={s.hasDriftTitle}
                                            title={s.hasDriftTitle}
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{
                                              backgroundColor:
                                                'var(--marker-h3)',
                                            }}
                                          />
                                        )}
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </details>
                    );
                  })}

                  {filteredTracks.length === 0 && (
                    <p className="px-2 py-2 text-xs text-ink-muted m-0">
                      {s.noTreeMatches(treeQuery)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Catalog Matrix */}
          <button
            type="button"
            aria-current={activeSection === 'catalog' ? 'page' : undefined}
            onClick={() => navigateSection('catalog')}
            className="studio-nav-item"
          >
            <IconLayers className="w-4 h-4 text-ink-muted" />
            <span className="flex-1 studio-ellipsis">{s.sections.catalog}</span>
            <span className="text-xs font-mono text-ink-muted tabular-nums shrink-0">
              {tracks.length}
            </span>
          </button>

          {/* 4 & 5. Admin Sections */}
          {isAdmin && (
            <>
              <button
                type="button"
                aria-current={activeSection === 'users' ? 'page' : undefined}
                onClick={() => navigateSection('users')}
                className="studio-nav-item"
              >
                <IconShield className="w-4 h-4 text-ink-muted" />
                <span className="flex-1 studio-ellipsis">
                  {s.sections.users}
                </span>
                {usersCount > 0 && (
                  <span className="text-xs font-mono text-ink-muted tabular-nums shrink-0">
                    {usersCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                aria-current={activeSection === 'settings' ? 'page' : undefined}
                onClick={() => navigateSection('settings')}
                className="studio-nav-item"
              >
                <IconSettings className="w-4 h-4 text-ink-muted" />
                <span className="flex-1 studio-ellipsis">
                  {s.sections.settings}
                </span>
              </button>
            </>
          )}
        </nav>
      </div>

      <div className="mt-auto px-4 py-3 border-t border-border-subtle">
        <a
          href="https://github.com/Cloudwhile/icehandnote"
          target="_blank"
          rel="noopener noreferrer"
          className="font-hand text-sm font-semibold text-ink-secondary hover:text-link-ink no-underline inline-flex items-center gap-1.5 transition-colors"
        >
          <span>IceHandnote · Cloudwhile</span>
          <span className="font-mono text-xs text-ink-muted">AGPL-3.0</span>
        </a>
      </div>
    </div>
  );
}
