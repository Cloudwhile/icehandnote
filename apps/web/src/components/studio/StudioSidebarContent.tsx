/*
 * Refactoring UI Constraint Brief (Unified Studio Sidebar):
 * - Quiet recessed rail (`--surface-sunken`) keeping visual focus on the right workspace (§2.4).
 * - Article Tree is unified directly under the `创作器` (Editor) navigation item so picking or
 *   creating articles is a single cohesive hierarchy (eliminates detached `目录` section & redundant footer).
 */

import { useEffect, useMemo, useState } from 'react';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { SafeHtml, stripHtmlTags } from '../../lib/sanitizer';
import type {
  LocaleCode,
  SiteSettingsDto,
  StudioSettingsTabId,
  StudioTrackDto,
} from '../../lib/types';
import {
  IconChevronDown,
  IconGrid,
  IconLayers,
  IconPen,
  IconSettings,
  IconShield,
} from '../ui/Icons';
import { StatusBadge } from '../ui/StatusBadge';

export type StudioSectionId =
  | 'overview'
  | 'editor'
  | 'catalog'
  | 'users'
  | 'settings';

const SETTINGS_SUB_ITEMS: readonly StudioSettingsTabId[] = [
  'general',
  'oauth',
  'storage',
  'smtp',
  'updates',
];

interface StudioSidebarContentProps {
  locale: LocaleCode;
  siteSettings?: SiteSettingsDto;
  settingsReady?: boolean;
  activeSection: StudioSectionId;
  onSelectSection: (section: StudioSectionId) => void;
  activeSettingsTab: StudioSettingsTabId;
  onSelectSettingsTab: (tab: StudioSettingsTabId) => void;
  enabledOAuthCount: number;
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
  siteSettings,
  settingsReady = true,
  activeSection,
  onSelectSection,
  activeSettingsTab,
  onSelectSettingsTab,
  enabledOAuthCount,
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
  const settingsTabs = EXT_COPY[locale].settings.settingsTabs;
  const [treeQuery, setTreeQuery] = useState('');
  const [editorTreeOpen, setEditorTreeOpen] = useState(
    activeSection === 'editor',
  );
  const [settingsTreeOpen, setSettingsTreeOpen] = useState(
    activeSection === 'settings',
  );

  // Auto-expand the nested article tree or settings sub-menu when entering those sections
  useEffect(() => {
    if (activeSection === 'editor') {
      setEditorTreeOpen(true);
    }
    if (activeSection === 'settings') {
      setSettingsTreeOpen(true);
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
              <StatusBadge tone="warn" pill mono className="px-1.5">
                {pendingCount}
              </StatusBadge>
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
                            title={stripHtmlTags(track.title)}
                          >
                            <SafeHtml as="span" html={track.title} />
                          </span>
                        </summary>

                        <div className="ms-2.5 ps-2 border-s border-border-subtle space-y-2 py-1">
                          {track.chapters.map((ch) => (
                            <div key={ch.chapter_id} className="space-y-0.5">
                              <div className="px-1 flex items-center justify-between gap-1">
                                <span
                                  className="text-xs text-ink-muted studio-ellipsis"
                                  title={stripHtmlTags(ch.title)}
                                >
                                  <SafeHtml as="span" html={ch.title} />
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onQuickNewStep(track.slug, ch.slug);
                                    onCloseMobileDrawer?.();
                                  }}
                                  aria-label={s.addStepInChapterAria(stripHtmlTags(ch.title))}
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
                                          <SafeHtml as="span" html={st.title} />
                                        </span>
                                        {st.takedown_reason && (
                                          <StatusBadge
                                            tone="danger"
                                            mono
                                            className="px-1 py-0"
                                            title={st.takedown_reason}
                                          >
                                            {EXT_COPY[locale].studio.takenDownBadge}
                                          </StatusBadge>
                                        )}
                                        {hasDraft && (
                                          <StatusBadge
                                            tone="info"
                                            mono
                                            className="px-1 py-0"
                                            title={s.hasDraftTitle}
                                          >
                                            {s.draftChip}
                                          </StatusBadge>
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

              <div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-current={activeSection === 'settings' ? 'page' : undefined}
                    onClick={() => {
                      setSettingsTreeOpen(true);
                      onSelectSection('settings');
                    }}
                    className="studio-nav-item flex-1 min-w-0"
                  >
                    <IconSettings className="w-4 h-4 text-ink-muted" />
                    <span className="flex-1 studio-ellipsis">
                      {s.sections.settings}
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-expanded={settingsTreeOpen}
                    aria-label={s.sections.settings}
                    onClick={() => setSettingsTreeOpen((v) => !v)}
                    className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-sheet cursor-pointer shrink-0 transition-colors"
                  >
                    <IconChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        settingsTreeOpen ? '' : '-rotate-90'
                      }`}
                    />
                  </button>
                </div>

                {settingsTreeOpen && (
                  <ul className="ui-panel-enter m-0 ms-3.5 mt-1 mb-1.5 ps-2.5 py-0.5 list-none border-s border-border-subtle space-y-0.5">
                    {SETTINGS_SUB_ITEMS.map((subId) => {
                      const isSubActive =
                        activeSection === 'settings' && activeSettingsTab === subId;
                      return (
                        <li key={subId}>
                          <button
                            type="button"
                            aria-current={isSubActive ? 'location' : undefined}
                            onClick={() => {
                              onSelectSettingsTab(subId);
                              onSelectSection('settings');
                              onCloseMobileDrawer?.();
                            }}
                            className={`w-full min-h-8 px-2.5 py-1 rounded-lg text-xs flex items-center justify-between gap-2 text-start cursor-pointer transition-colors ${
                              isSubActive
                                ? 'bg-action-subtle text-ink-primary font-semibold'
                                : 'text-ink-secondary hover:bg-surface-sheet hover:text-ink-primary'
                            }`}
                          >
                            <span className="studio-ellipsis">
                              {settingsTabs[subId]}
                            </span>
                            {subId === 'oauth' && enabledOAuthCount > 0 && (
                              <span className="text-xs font-mono text-ink-muted tabular-nums shrink-0">
                                {enabledOAuthCount}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </nav>
      </div>

      <div className="mt-auto px-4 py-3 border-t border-border-subtle">
        <a
          href="https://github.com/Cloudwhile/icehandnote"
          target="_blank"
          rel="noopener noreferrer"
          className="font-hand text-sm font-semibold text-ink-secondary hover:text-link-ink no-underline inline-flex items-center gap-1.5 min-h-7 min-w-0 max-w-full transition-colors"
        >
          {settingsReady && siteSettings?.site_name ? (
            <>
              <SafeHtml
                as="span"
                html={siteSettings.site_name}
                className="studio-ellipsis max-w-28"
              />
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span className="shrink-0">Cloudwhile</span>
          <span className="font-mono text-xs text-ink-muted shrink-0">
            AGPL-3.0
          </span>
        </a>
      </div>
    </div>
  );
}
