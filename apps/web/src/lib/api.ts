import type {
  ArticleTaskChecksDto,
  AuthMeResponse,
  AuthSessionResponse,
  LearnerProgressDto,
  LocaleCode,
  SearchHitDto,
  SiteSettingsDto,
  StepDetailDto,
  StudioPreviewResponse,
  StudioStepEditorDto,
  StudioTrackDto,
  TrackSummaryDto,
  UpdateCheckResponse,
  UserMarginNoteDto,
  UserProfileDto,
  UserRole,
} from './types';

const ANON_LEARNER_KEY = 'icehandnote_learner_id';
const LEGACY_ANON_LEARNER_KEY = 'stepnote_learner_id';
const SESSION_TOKEN_KEY = 'icehandnote_session_token';
const LEGACY_SESSION_TOKEN_KEY = 'stepnote_session_token';
const USER_LEARNER_KEY = 'icehandnote_user_learner_key';
const LEGACY_USER_LEARNER_KEY = 'stepnote_user_learner_key';

export function getAnonymousLearnerId(): string {
  try {
    let existing =
      localStorage.getItem(ANON_LEARNER_KEY) ??
      localStorage.getItem(LEGACY_ANON_LEARNER_KEY);
    if (!existing) {
      existing = `learner_${crypto.randomUUID().slice(0, 12)}`;
    }
    localStorage.setItem(ANON_LEARNER_KEY, existing);
    return existing;
  } catch {
    return 'learner_guest';
  }
}

export function getActiveLearnerId(): string {
  try {
    return (
      localStorage.getItem(USER_LEARNER_KEY) ||
      localStorage.getItem(LEGACY_USER_LEARNER_KEY) ||
      getAnonymousLearnerId()
    );
  } catch {
    return getAnonymousLearnerId();
  }
}

export function getSessionToken(): string | null {
  try {
    return (
      localStorage.getItem(SESSION_TOKEN_KEY) ??
      localStorage.getItem(LEGACY_SESSION_TOKEN_KEY)
    );
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSessionResponse): void {
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, session.session_token);
    localStorage.setItem(USER_LEARNER_KEY, session.learner_key);
  } catch {
    // ignore storage restriction
  }
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(USER_LEARNER_KEY);
    localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USER_LEARNER_KEY);
  } catch {
    // ignore
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () =>
    fetchJson<{
      status: string;
      project: string;
      storage_backend: string;
      blog_origin_url: string;
      default_locale: string;
    }>('/api/v1/health'),

  getSettings: () => fetchJson<SiteSettingsDto>('/api/v1/settings'),

  // Public Reader
  listTracks: (locale: LocaleCode) =>
    fetchJson<TrackSummaryDto[]>(`/api/v1/${locale}/tracks`),

  getStepDetail: (
    locale: LocaleCode,
    track: string,
    chapter: string,
    step: string,
  ) =>
    fetchJson<StepDetailDto>(
      `/api/v1/${locale}/tracks/${encodeURIComponent(track)}/steps/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}`,
    ),

  search: (locale: LocaleCode, query: string) =>
    fetchJson<SearchHitDto[]>(
      `/api/v1/${locale}/search?q=${encodeURIComponent(query)}`,
    ),

  getProgress: () =>
    fetchJson<LearnerProgressDto>(
      `/api/v1/me/progress?learner_id=${encodeURIComponent(getActiveLearnerId())}`,
    ),

  toggleStepComplete: (stepId: string, completed: boolean) =>
    fetchJson<LearnerProgressDto>('/api/v1/me/progress', {
      method: 'POST',
      body: JSON.stringify({
        learner_id: getActiveLearnerId(),
        step_id: stepId,
        completed,
      }),
    }),

  getTaskChecks: (stepId: string) =>
    fetchJson<ArticleTaskChecksDto>(
      `/api/v1/me/task-checks?step_id=${encodeURIComponent(stepId)}&learner_id=${encodeURIComponent(getActiveLearnerId())}`,
    ),

  toggleTaskCheck: (stepId: string, taskItemId: string, checked: boolean) =>
    fetchJson<ArticleTaskChecksDto>('/api/v1/me/task-checks', {
      method: 'POST',
      body: JSON.stringify({
        learner_id: getActiveLearnerId(),
        step_id: stepId,
        task_item_id: taskItemId,
        checked,
      }),
    }),

  likeStep: (stepId: string) =>
    fetchJson<{ likes_count: number }>(`/api/v1/steps/${stepId}/like`, {
      method: 'POST',
    }),

  listMarginNotes: (stepId: string) =>
    fetchJson<UserMarginNoteDto[]>(
      `/api/v1/me/notes?step_id=${encodeURIComponent(stepId)}&learner_id=${encodeURIComponent(getActiveLearnerId())}`,
    ),

  createMarginNote: (payload: {
    step_id: string;
    locale_code: LocaleCode;
    block_anchor_id: string;
    note_color: string;
    content: string;
  }) =>
    fetchJson<UserMarginNoteDto>('/api/v1/me/notes', {
      method: 'POST',
      body: JSON.stringify({
        learner_id: getActiveLearnerId(),
        ...payload,
      }),
    }),

  deleteMarginNote: (noteId: string) =>
    fetchJson<{ deleted: boolean }>(
      `/api/v1/me/notes/${encodeURIComponent(noteId)}?learner_id=${encodeURIComponent(getActiveLearnerId())}`,
      { method: 'DELETE' },
    ),

  // Auth & External SSO Bridge
  authMe: () => fetchJson<AuthMeResponse>('/api/v1/auth/me'),

  loginWithPassword: async (identifier: string, password: string) => {
    const res = await fetchJson<AuthSessionResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier,
        password,
        anonymous_learner_id: getAnonymousLearnerId(),
      }),
    });
    saveAuthSession(res);
    return res;
  },

  verifySsoToken: async (ssoToken: string) => {
    const res = await fetchJson<AuthSessionResponse>('/api/v1/auth/sso/verify', {
      method: 'POST',
      body: JSON.stringify({
        sso_token: ssoToken,
        anonymous_learner_id: getAnonymousLearnerId(),
      }),
    });
    saveAuthSession(res);
    return res;
  },

  logout: async () => {
    try {
      await fetchJson<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      clearAuthSession();
    }
  },

  // Studio Authoring (Author + Admin)
  studioOverview: (locale: LocaleCode) =>
    fetchJson<StudioTrackDto[]>(`/api/v1/studio/${locale}/overview`),

  studioGetStep: (
    track: string,
    chapter: string,
    step: string,
    locale: string,
  ) =>
    fetchJson<StudioStepEditorDto>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/${encodeURIComponent(locale)}`,
    ),

  studioSaveStep: (payload: {
    track_slug: string;
    chapter_slug: string;
    step_slug: string;
    locale: string;
    title: string;
    summary: string;
    step_number: number;
    estimated_minutes: number;
    synced_revision: number;
    bump_canonical: boolean;
    status: string;
    license?: string;
    tags: string[];
    body_markdown: string;
    write_to_content_dir?: boolean;
  }) =>
    fetchJson<StudioStepEditorDto>('/api/v1/studio/steps', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  studioDeleteStep: (track: string, chapter: string, step: string) =>
    fetchJson<{ deleted: boolean }>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}`,
      { method: 'DELETE' },
    ),

  studioCreateTrack: (payload: {
    slug: string;
    difficulty: string;
    icon_kind: string;
    tags: string[];
    title_zh_tw: string;
    subtitle_zh_tw: string;
    description_zh_tw: string;
    first_chapter_slug: string;
    first_chapter_title: string;
  }) =>
    fetchJson<StudioTrackDto>('/api/v1/studio/tracks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  studioCreateChapter: (payload: {
    track_slug: string;
    slug: string;
    number: number;
    title_zh_tw: string;
  }) =>
    fetchJson<{ ok: boolean }>('/api/v1/studio/chapters', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  studioPreview: (payload: {
    title: string;
    summary: string;
    body_markdown: string;
  }) =>
    fetchJson<StudioPreviewResponse>('/api/v1/studio/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  checkSiteUpdate: async (): Promise<UpdateCheckResponse> => {
    try {
      return await fetchJson<UpdateCheckResponse>('/api/v1/studio/update-check', {
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      ) {
        throw new Error('Update check timed out', { cause: err });
      }
      throw err;
    }
  },

  // Admin Governance (Admin only)
  adminUpdateSettings: (settings: SiteSettingsDto) =>
    fetchJson<SiteSettingsDto>('/api/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),

  adminListUsers: () => fetchJson<UserProfileDto[]>('/api/v1/admin/users'),

  adminUpdateUserRole: (userId: string, role: UserRole) =>
    fetchJson<UserProfileDto>(`/api/v1/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
};

export function runDirectionalTransition(
  updateDOM: () => void,
  direction: 'forward' | 'backward',
): void {
  const doc = document as Document & {
    startViewTransition?: (arg: { update: () => void; types?: string[] }) => unknown;
  };
  if (typeof doc.startViewTransition !== 'function') {
    updateDOM();
    return;
  }
  try {
    doc.startViewTransition({
      update: updateDOM,
      types: [direction],
    });
  } catch {
    updateDOM();
  }
}
