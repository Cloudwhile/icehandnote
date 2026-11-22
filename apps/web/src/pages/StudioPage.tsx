/*
 * Studio Admin & Authoring Dashboard Shell (`StudioPage`):
 * - Decoupled into modular panels: `<StudioTopbar>`, `<StudioSidebarContent>`,
 *   `<StudioOverviewPanel>`, `<StudioEditorPanel>`, `<StudioCatalogPanel>`,
 *   `<StudioUsersPanel>`, and `<StudioSettingsPanel>`.
 * - Synchronizes `activeSection`, `activeSettingsTab`, and editor target (`track`/`chapter`/`step`/`edit_locale`)
 *   bidirectionally with URL query parameters so refreshing the browser preserves active tabs and editing context.
 */

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { NotebookEmptyState } from '../components/notebook/NotebookEmptyState';
import {
  StudioCatalogPanel,
  type TakedownStepTarget,
} from '../components/studio/StudioCatalogPanel';
import {
  type StepModerationPatch,
  StudioEditorPanel,
} from '../components/studio/StudioEditorPanel';
import { StudioMobileDrawer } from '../components/studio/StudioMobileDrawer';
import { StudioOverviewPanel } from '../components/studio/StudioOverviewPanel';
import { StudioSettingsPanel } from '../components/studio/StudioSettingsPanel';
import {
  StudioSidebarContent,
  type StudioSectionId,
} from '../components/studio/StudioSidebarContent';
import { StudioTopbar } from '../components/studio/StudioTopbar';
import { StudioUsersPanel } from '../components/studio/StudioUsersPanel';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IconSnowflake } from '../components/ui/Icons';
import { InkSelect } from '../components/ui/InkSelect';
import { useToast } from '../components/ui/ToastProvider';
import { api } from '../lib/api';
import { runLayoutTransition } from '../lib/motion';
import {
  EXT_COPY,
  isRegisteredLocale,
  LOCALES,
  type LocalePreference,
  UI_COPY,
} from '../lib/i18n';
import { stripHtmlTags } from '../lib/sanitizer';
import type { ResolvedTheme } from '../lib/theme';
import {
  getEffectiveOAuthProviders,
  type LocaleCode,
  type SiteSettingsDto,
  type StudioSettingsTabId,
  type StudioTrackDto,
  type UserProfileDto,
} from '../lib/types';

const VALID_STUDIO_SECTIONS: readonly StudioSectionId[] = [
  'overview',
  'editor',
  'catalog',
  'users',
  'settings',
];

const VALID_SETTINGS_TABS: readonly StudioSettingsTabId[] = [
  'general',
  'oauth',
  'storage',
  'smtp',
  'updates',
];

const TRANSIENT_AUTH_PARAMS = [
  'sso_token',
  'oauth_ticket',
  'oauth_onboarding',
  'oauth_bound',
  'oauth_error',
  'collab_invite',
  'reset_token',
];

function parseSectionFromParams(sp: URLSearchParams): StudioSectionId {
  const raw = sp.get('section');
  if (raw && (VALID_STUDIO_SECTIONS as readonly string[]).includes(raw)) {
    return raw as StudioSectionId;
  }
  if (sp.get('track') && sp.get('chapter') && sp.get('step')) {
    return 'editor';
  }
  return 'overview';
}

function parseSettingsTabFromParams(sp: URLSearchParams): StudioSettingsTabId {
  const raw = sp.get('tab');
  if (raw && (VALID_SETTINGS_TABS as readonly string[]).includes(raw)) {
    return raw as StudioSettingsTabId;
  }
  return 'general';
}

interface StudioPageProps {
  locale: LocaleCode;
  localePref: LocalePreference;
  onChangeLocalePref: (next: LocalePreference) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  user: UserProfileDto | null;
  authResolved: boolean;
  siteSettings: SiteSettingsDto;
  settingsReady?: boolean;
  onSettingsUpdated: (next: SiteSettingsDto) => void;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function StudioPage({
  locale,
  localePref,
  onChangeLocalePref,
  theme,
  onToggleTheme,
  onOpenSearch,
  user,
  authResolved,
  siteSettings,
  settingsReady = true,
  onSettingsUpdated,
  onOpenAuth,
  onOpenProfile,
  onLogout,
}: StudioPageProps) {
  const copy = UI_COPY[locale];
  const s = copy.studio;
  const extCopy = EXT_COPY[locale];
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const lastSyncedSearchRef = useRef(location.search);

  // URL-persisted Studio section & settings sub-tab state
  const [activeSection, setActiveSection] = useState<StudioSectionId>(() =>
    parseSectionFromParams(searchParams),
  );
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<StudioSettingsTabId>(() =>
      parseSettingsTabFromParams(searchParams),
    );

  // URL-persisted active editor target
  const [selTrack, setSelTrack] = useState(
    () => searchParams.get('track') ?? '',
  );
  const [selChapter, setSelChapter] = useState(
    () => searchParams.get('chapter') ?? '',
  );
  const [selStep, setSelStep] = useState(() => searchParams.get('step') ?? '');
  const [editLocale, setEditLocale] = useState<LocaleCode>(() => {
    const raw = searchParams.get('edit_locale') ?? undefined;
    return isRegisteredLocale(raw) ? raw : locale;
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const [tracks, setTracks] = useState<StudioTrackDto[]>([]);
  const [usersList, setUsersList] = useState<UserProfileDto[]>([]);

  // Quick new step modal (shared across Overview, Sidebar, Editor, and Catalog)
  const [creatingNewStep, setCreatingNewStep] = useState(false);
  const [newStepSlug, setNewStepSlug] = useState('');

  // Shared Admin Takedown modal (triggered from Editor or Catalog)
  const [takedownTarget, setTakedownTarget] =
    useState<TakedownStepTarget | null>(null);
  const [takedownReasonInput, setTakedownReasonInput] = useState('');
  const [submittingTakedown, setSubmittingTakedown] = useState(false);
  const [moderationPatch, setModerationPatch] =
    useState<StepModerationPatch | null>(null);

  const canAuthor = Boolean(
    user &&
      (user.role === 'author' ||
        user.role === 'admin' ||
        user.has_collaborations),
  );
  const isAdmin = Boolean(user && user.role === 'admin');

  const enabledOAuthCount = useMemo(
    () =>
      getEffectiveOAuthProviders(siteSettings).filter(
        (p) => p.enabled && p.client_id.trim(),
      ).length,
    [siteSettings],
  );

  const scrollWorkspaceToTop = useCallback(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, []);

  const handleSelectSettingsTab = useCallback(
    (tab: StudioSettingsTabId) => {
      setActiveSettingsTab(tab);
      scrollWorkspaceToTop();
    },
    [scrollWorkspaceToTop],
  );

  // Guard admin-only sections once auth resolves for non-admin authors
  useEffect(() => {
    if (
      authResolved &&
      user &&
      !isAdmin &&
      (activeSection === 'users' || activeSection === 'settings')
    ) {
      setActiveSection('overview');
    }
  }, [activeSection, authResolved, isAdmin, user]);

  // Ensure `editLocale` remains within `siteSettings.enabled_locales`
  useEffect(() => {
    if (
      siteSettings.enabled_locales.length > 0 &&
      !siteSettings.enabled_locales.includes(editLocale)
    ) {
      const nextLoc = siteSettings.enabled_locales.includes(locale)
        ? locale
        : siteSettings.enabled_locales.includes(siteSettings.default_locale)
          ? siteSettings.default_locale
          : siteSettings.enabled_locales[0];
      setEditLocale(nextLoc);
    }
  }, [
    editLocale,
    locale,
    siteSettings.default_locale,
    siteSettings.enabled_locales,
  ]);

  // Reset main pane / window scroll position when switching Studio sections
  useEffect(() => {
    scrollWorkspaceToTop();
  }, [activeSection, scrollWorkspaceToTop]);

  // Honor external URL changes (e.g., browser Back/Forward or co-author invite redirect)
  useEffect(() => {
    if (location.search === lastSyncedSearchRef.current) return;
    lastSyncedSearchRef.current = location.search;
    const sp = new URLSearchParams(location.search);
    setActiveSection(parseSectionFromParams(sp));
    setActiveSettingsTab(parseSettingsTabFromParams(sp));
    const t = sp.get('track');
    const c = sp.get('chapter');
    const st = sp.get('step');
    const el = sp.get('edit_locale') ?? undefined;
    if (t) setSelTrack(t);
    if (c) setSelChapter(c);
    if (st) setSelStep(st);
    if (isRegisteredLocale(el)) setEditLocale(el);
  }, [location.search]);

  // Persist active Studio section, settings tab, and editor target into URL query params
  useEffect(() => {
    if (!canAuthor) return;
    const currentSp = new URLSearchParams(location.search);
    if (TRANSIENT_AUTH_PARAMS.some((key) => currentSp.has(key))) {
      return;
    }

    const next = new URLSearchParams(location.search);
    next.delete('section');
    next.delete('tab');
    next.delete('track');
    next.delete('chapter');
    next.delete('step');
    next.delete('edit_locale');

    if (activeSection !== 'overview') {
      next.set('section', activeSection);
    }
    if (activeSection === 'settings' && activeSettingsTab !== 'general') {
      next.set('tab', activeSettingsTab);
    }
    if (activeSection === 'editor') {
      if (selTrack) next.set('track', selTrack);
      if (selChapter) next.set('chapter', selChapter);
      if (selStep) next.set('step', selStep);
      if (editLocale && editLocale !== locale) {
        next.set('edit_locale', editLocale);
      }
    }

    const nextQuery = next.toString();
    const desiredSearch = nextQuery ? `?${nextQuery}` : '';
    if (desiredSearch !== location.search) {
      lastSyncedSearchRef.current = desiredSearch;
      setSearchParams(next, { replace: true });
    }
  }, [
    activeSection,
    activeSettingsTab,
    canAuthor,
    editLocale,
    locale,
    location.search,
    selChapter,
    selStep,
    selTrack,
    setSearchParams,
  ]);

  const refreshOverview = useCallback(async () => {
    if (!canAuthor) return undefined;
    try {
      const list = await api.studioOverview(locale);
      setTracks(list);
      if (list.length > 0) {
        setSelTrack((prevTrack) => {
          const matchedTrack = prevTrack
            ? list.find((t) => t.slug === prevTrack)
            : undefined;
          if (matchedTrack) {
            const firstC = matchedTrack.chapters[0];
            setSelChapter((prevCh) => {
              const matchedCh = prevCh
                ? matchedTrack.chapters.find((c) => c.slug === prevCh)
                : undefined;
              const resolvedCh = matchedCh ?? firstC;
              setSelStep((prevStep) => prevStep || resolvedCh?.steps[0]?.slug || '');
              return resolvedCh?.slug ?? '';
            });
            return matchedTrack.slug;
          }
          const firstT = list[0];
          const firstC = firstT.chapters[0];
          const firstS = firstC?.steps[0];
          setSelChapter(firstC?.slug ?? '');
          setSelStep(firstS?.slug ?? '');
          return firstT.slug;
        });
      }
      return list;
    } catch {
      return undefined;
    }
  }, [canAuthor, locale]);

  useEffect(() => {
    if (!authResolved || !canAuthor) return;
    void refreshOverview();
  }, [authResolved, canAuthor, refreshOverview]);

  useEffect(() => {
    if (!authResolved || !isAdmin) return;
    void api
      .adminListUsers()
      .then(setUsersList)
      .catch(() => {});
  }, [authResolved, isAdmin, activeSection]);

  const handleSwitchSection = useCallback((next: StudioSectionId) => {
    runLayoutTransition(mainScrollRef.current, () => {
      setActiveSection(next);
    });
  }, []);

  const pendingCount = useMemo(() => {
    const enabled =
      siteSettings.enabled_locales.length > 0
        ? siteSettings.enabled_locales
        : LOCALES.map((l) => l.code);
    let count = 0;
    for (const t of tracks) {
      for (const ch of t.chapters) {
        for (const st of ch.steps) {
          for (const locCode of enabled) {
            const tr = st.translations.find((item) => item.locale === locCode);
            if (
              !tr ||
              tr.status === 'draft' ||
              tr.synced_revision < st.canonical_revision
            ) {
              count += 1;
            }
          }
        }
      }
    }
    return count;
  }, [tracks, siteSettings.enabled_locales]);

  // Gate 0: Wait for initial auth check so authenticated refreshes never flash the login gate
  if (!authResolved && !user) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 py-16">
        <div className="rounded-2xl p-8 bg-surface-sheet border-2 border-border-ink text-center text-sm font-mono text-ink-muted inline-flex items-center justify-center gap-2 w-full">
          <IconSnowflake className="w-4 h-4 text-accent-ice" />
          <span>{s.verifyingGate}</span>
        </div>
      </main>
    );
  }

  // Gate 1: Unauthenticated
  if (!user) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 py-16">
        <div className="notebook-sheet-stack">
          <div className="notebook-sheet-card p-8">
            <NotebookEmptyState
              title={s.unauthTitle}
              description={s.unauthDesc}
              actionLabel={s.unauthCta}
              onAction={onOpenAuth}
            />
          </div>
        </div>
      </main>
    );
  }

  // Gate 2: Reader role (403)
  if (!canAuthor) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 py-16">
        <div className="notebook-sheet-stack">
          <div className="notebook-sheet-card p-8">
            <NotebookEmptyState
              title={s.readerGateTitle(user.display_name)}
              description={s.readerGateDesc}
              actionLabel={s.readerGateCta}
              onAction={() => navigate(`/${locale}`)}
            />
          </div>
        </div>
      </main>
    );
  }

  const handleTrackSelect = (nextTrackSlug: string) => {
    setSelTrack(nextTrackSlug);
    const t = tracks.find((item) => item.slug === nextTrackSlug);
    const ch = t?.chapters[0];
    if (ch) {
      setSelChapter(ch.slug);
      if (ch.steps[0]) setSelStep(ch.steps[0].slug);
    }
  };

  const handlePickStepFromSidebar = (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
  ) => {
    setSelTrack(trackSlug);
    setSelChapter(chapterSlug);
    setSelStep(stepSlug);
    setCreatingNewStep(false);
    handleSwitchSection('editor');
  };

  const makeNextDraftSlug = (trackSlug: string): string => {
    const track = tracks.find((t) => t.slug === trackSlug);
    const existing = new Set(
      (track?.chapters ?? []).flatMap((c) => c.steps.map((st) => st.slug)),
    );
    const baseNum = existing.size + 1;
    let candidate = `draft-${String(baseNum).padStart(2, '0')}`;
    let suffix = 2;
    while (existing.has(candidate)) {
      candidate = `draft-${String(baseNum).padStart(2, '0')}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  };

  const handleQuickNewStepFromSidebar = (
    trackSlug: string,
    chapterSlug: string,
  ) => {
    const draftSlug = makeNextDraftSlug(trackSlug);
    setSelTrack(trackSlug);
    setSelChapter(chapterSlug);
    setSelStep(draftSlug);
    setCreatingNewStep(false);
    handleSwitchSection('editor');
  };

  const handleOpenEditorTarget = (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
    targetLocale: LocaleCode,
  ) => {
    setSelTrack(trackSlug);
    setSelChapter(chapterSlug);
    setSelStep(stepSlug);
    setEditLocale(targetLocale);
    setCreatingNewStep(false);
    handleSwitchSection('editor');
  };

  const handleStartNewStep = (e: FormEvent) => {
    e.preventDefault();
    const rawClean = newStepSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/^-+|-+$/g, '');
    const clean =
      rawClean && rawClean !== '-' ? rawClean : makeNextDraftSlug(selTrack);
    const defaultChSlug =
      tracks.find((t) => t.slug === selTrack)?.chapters[0]?.slug ||
      selChapter ||
      'chapters';
    setSelChapter(defaultChSlug);
    setSelStep(clean);
    setNewStepSlug('');
    setCreatingNewStep(false);
    handleSwitchSection('editor');
  };

  const handleRequestTakedown = (target: TakedownStepTarget) => {
    setTakedownReasonInput('');
    setTakedownTarget(target);
  };

  const handleConfirmTakedown = async (e: FormEvent) => {
    e.preventDefault();
    if (!takedownTarget || !takedownReasonInput.trim() || submittingTakedown) {
      return;
    }
    setSubmittingTakedown(true);
    try {
      const reason = takedownReasonInput.trim();
      const res = await api.adminTakedownStep(
        takedownTarget.trackSlug,
        takedownTarget.chapterSlug,
        takedownTarget.stepSlug,
        reason,
      );
      toast.success(extCopy.studio.takedownSuccessMsg(res.emails_sent));
      setModerationPatch((prev) => ({
        stepKey: `${takedownTarget.trackSlug}/${takedownTarget.chapterSlug}/${takedownTarget.stepSlug}`,
        reason,
        by: user.display_name,
        seq: (prev?.seq ?? 0) + 1,
      }));
      setTakedownTarget(null);
      setTakedownReasonInput('');
      await refreshOverview();
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmittingTakedown(false);
    }
  };

  const handleRestoreStep = async (
    trackSlug: string,
    chapterSlug: string,
    stepSlug: string,
  ) => {
    try {
      await api.adminRestoreStep(trackSlug, chapterSlug, stepSlug);
      toast.success(extCopy.studio.restoredSuccessMsg);
      setModerationPatch((prev) => ({
        stepKey: `${trackSlug}/${chapterSlug}/${stepSlug}`,
        reason: null,
        by: null,
        seq: (prev?.seq ?? 0) + 1,
      }));
      await refreshOverview();
    } catch (err) {
      toast.error(err);
    }
  };

  const sharedSidebarProps = {
    locale,
    siteSettings,
    settingsReady,
    activeSection,
    onSelectSection: handleSwitchSection,
    activeSettingsTab,
    onSelectSettingsTab: handleSelectSettingsTab,
    enabledOAuthCount,
    isAdmin,
    tracks,
    usersCount: usersList.length,
    pendingCount,
    selTrack,
    selChapter,
    selStep,
    onPickStep: handlePickStepFromSidebar,
    onQuickNewStep: handleQuickNewStepFromSidebar,
  };

  return (
    <div
      className="studio-shell"
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      <StudioTopbar
        locale={locale}
        localePref={localePref}
        onChangeLocalePref={onChangeLocalePref}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenSearch={onOpenSearch}
        user={user}
        siteSettings={siteSettings}
        settingsReady={settingsReady}
        mobileDrawerOpen={mobileDrawerOpen}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebarCollapsed={() => setSidebarCollapsed((v) => !v)}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />

      <aside className="studio-sidebar" aria-label={s.sidebarAriaLabel}>
        <StudioSidebarContent {...sharedSidebarProps} />
      </aside>

      <StudioMobileDrawer
        locale={locale}
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
      >
        <StudioSidebarContent
          {...sharedSidebarProps}
          onCloseMobileDrawer={() => setMobileDrawerOpen(false)}
        />
      </StudioMobileDrawer>

      <main ref={mainScrollRef} className="studio-main">
        <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-6">
          {activeSection === 'overview' && (
            <div key="studio-sec-overview" className="ui-panel-enter">
              <StudioOverviewPanel
                locale={locale}
                isAdmin={isAdmin}
                tracks={tracks}
                usersList={usersList}
                siteSettings={siteSettings}
                settingsReady={settingsReady}
                onOpenEditorTarget={handleOpenEditorTarget}
                onStartQuickNewStep={() => {
                  setCreatingNewStep(true);
                  handleSwitchSection('editor');
                }}
                onSwitchSection={handleSwitchSection}
              />
            </div>
          )}

          {activeSection === 'editor' && (
            <div key="studio-sec-editor" className="ui-panel-enter">
              <StudioEditorPanel
                locale={locale}
                theme={theme}
                user={user}
                isAdmin={isAdmin}
                siteSettings={siteSettings}
                settingsReady={settingsReady}
                tracks={tracks}
                selTrack={selTrack}
                selChapter={selChapter}
                selStep={selStep}
                editLocale={editLocale}
                onChangeEditLocale={setEditLocale}
                onStepDeleted={(nextSlug) => setSelStep(nextSlug)}
                onStepSlugSaved={(nextSlug) => setSelStep(nextSlug)}
                onRefreshOverview={refreshOverview}
                onOpenNewStepModal={() => setCreatingNewStep(true)}
                onSwitchSection={handleSwitchSection}
                onRequestTakedown={handleRequestTakedown}
                onRestoreStep={(t, c, st) => void handleRestoreStep(t, c, st)}
                moderationPatch={moderationPatch}
              />
            </div>
          )}

          {activeSection === 'catalog' && (
            <div key="studio-sec-catalog" className="ui-panel-enter">
              <StudioCatalogPanel
                locale={locale}
                isAdmin={isAdmin}
                tracks={tracks}
                siteSettings={siteSettings}
                onRefreshOverview={refreshOverview}
                onOpenEditorTarget={handleOpenEditorTarget}
                onQuickNewStep={handleQuickNewStepFromSidebar}
                onRequestTakedown={handleRequestTakedown}
                onRestoreStep={(t, c, st) => void handleRestoreStep(t, c, st)}
              />
            </div>
          )}

          {isAdmin && activeSection === 'users' && (
            <div key="studio-sec-users" className="ui-panel-enter">
              <StudioUsersPanel
                locale={locale}
                currentUser={user}
                usersList={usersList}
                onUsersListChange={setUsersList}
              />
            </div>
          )}

          {isAdmin && activeSection === 'settings' && (
            <div
              key={`studio-sec-settings-${activeSettingsTab}`}
              className="ui-panel-enter"
            >
              <StudioSettingsPanel
                locale={locale}
                activeTab={activeSettingsTab}
                onSelectTab={handleSelectSettingsTab}
                settings={siteSettings}
                onSettingsUpdated={onSettingsUpdated}
              />
            </div>
          )}
        </div>
      </main>

      {/* Shared New Article Dialog */}
      <ConfirmDialog
        open={creatingNewStep}
        onClose={() => setCreatingNewStep(false)}
        title={s.addStepInChapterTitle}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={s.createBtn}
        maxWidthClass="max-w-md"
        onSubmit={handleStartNewStep}
      >
        <div className="space-y-3">
          <div>
            <label
              htmlFor="modal-new-track"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.stepTrackLabel}
            </label>
            <InkSelect
              id="modal-new-track"
              value={selTrack}
              onChange={handleTrackSelect}
              options={tracks.map((t) => ({
                value: t.slug,
                label: `${stripHtmlTags(t.title)} (${t.slug})`,
              }))}
              triggerClassName="w-full min-h-9 px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border-border-subtle text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="modal-new-slug"
              className="block mb-1.5 text-xs font-semibold text-ink-secondary"
            >
              {s.stepSlugLabel}
            </label>
            <input
              id="modal-new-slug"
              type="text"
              value={newStepSlug}
              onChange={(e) => setNewStepSlug(e.target.value)}
              placeholder={extCopy.studio.publishedUrl.autoSlugPlaceholder}
              className="ink-field-input font-mono"
            />
          </div>
        </div>
      </ConfirmDialog>

      {/* Shared Admin Takedown Article Modal */}
      <ConfirmDialog
        open={Boolean(takedownTarget)}
        onClose={() => setTakedownTarget(null)}
        tone="danger"
        busy={submittingTakedown}
        title={extCopy.studio.takedownDialogTitle(takedownTarget?.title ?? '')}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={extCopy.studio.takedownConfirmBtn}
        maxWidthClass="max-w-md"
        onSubmit={(e) => void handleConfirmTakedown(e)}
      >
        <div>
          <label
            htmlFor="admin-takedown-reason"
            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
          >
            {extCopy.studio.takedownReasonLabel}
          </label>
          <textarea
            id="admin-takedown-reason"
            rows={3}
            required
            value={takedownReasonInput}
            onChange={(e) => setTakedownReasonInput(e.target.value)}
            placeholder={extCopy.studio.takedownReasonPlaceholder}
            className="ink-field-input"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
