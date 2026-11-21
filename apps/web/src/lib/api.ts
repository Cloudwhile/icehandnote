import { parseApiErrorResponse } from './apiError';
import type {
  AcceptInviteResponseDto,
  ArticleTaskChecksDto,
  AuthMeResponse,
  AuthSessionResponse,
  AvatarSource,
  CheckUsernameResponse,
  CreateInviteResponseDto,
  LearnerProgressDto,
  LocaleCode,
  LoginResultResponse,
  OAuthOnboardingInfoDto,
  SearchHitDto,
  SiteSettingsDto,
  SmtpSettingsDto,
  SmtpStatusResponseDto,
  StepDetailDto,
  StorageStatusDto,
  StudioPreviewResponse,
  StudioStepEditorDto,
  StudioTrackDto,
  SwitchStorageResponseDto,
  TakedownStepResponseDto,
  TrackSummaryDto,
  UpdateCheckResponse,
  UploadMediaResponseDto,
  UserMarginNoteDto,
  UserProfileDto,
  UserRole,
  UserSessionDto,
} from './types';

const ANON_LEARNER_KEY = 'icehandnote_learner_id';
const LEGACY_ANON_LEARNER_KEY = 'stepnote_learner_id';
const SESSION_TOKEN_KEY = 'icehandnote_session_token';
const LEGACY_SESSION_TOKEN_KEY = 'stepnote_session_token';
const USER_LEARNER_KEY = 'icehandnote_user_learner_key';
const LEGACY_USER_LEARNER_KEY = 'stepnote_user_learner_key';
const DEVICE_ID_KEY = 'icehandnote_device_id';

export function getClientDeviceId(): string {
  try {
    let existing = localStorage.getItem(DEVICE_ID_KEY);
    if (!existing) {
      existing = `dev_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      localStorage.setItem(DEVICE_ID_KEY, existing);
    }
    return existing;
  } catch {
    return 'dev_browser';
  }
}

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

export function saveRawSessionToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    }
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
  const activeLocale =
    typeof document !== 'undefined' && document.documentElement.lang
      ? document.documentElement.lang
      : 'zh-CN';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': getClientDeviceId(),
    'X-Site-Locale': activeLocale,
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
    throw await parseApiErrorResponse(res);
  }
  return (await res.json()) as T;
}

async function uploadMediaFile(
  file: File,
  endpoint: string,
  onboardingToken?: string,
): Promise<UploadMediaResponseDto> {
  const token = getSessionToken();
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (onboardingToken) {
    headers['X-Onboarding-Token'] = onboardingToken;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) {
    throw await parseApiErrorResponse(res);
  }
  return (await res.json()) as UploadMediaResponseDto;
}

export const api = {
  health: () =>
    fetchJson<{
      status: string;
      version: string;
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

  // Media Upload (Authenticated users or OAuth onboarding)
  uploadMedia: (file: File, onboardingToken?: string) =>
    uploadMediaFile(file, '/api/v1/uploads', onboardingToken),

  uploadStudioMedia: (file: File) =>
    uploadMediaFile(file, '/api/v1/studio/uploads'),

  // Auth, Profile, Password Reset & OAuth / SSO
  authMe: () => fetchJson<AuthMeResponse>('/api/v1/auth/me'),

  loginWithPassword: async (
    identifier: string,
    password: string,
    locale?: LocaleCode,
  ): Promise<LoginResultResponse> => {
    const res = await fetchJson<LoginResultResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier,
        password,
        anonymous_learner_id: getAnonymousLearnerId(),
        locale,
      }),
    });
    if (!res.requires_otp) {
      saveAuthSession(res);
    }
    return res;
  },

  verifyLoginOtp: async (challengeId: string, code: string) => {
    const res = await fetchJson<AuthSessionResponse>('/api/v1/auth/login/verify-otp', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challengeId,
        code,
        anonymous_learner_id: getAnonymousLearnerId(),
      }),
    });
    saveAuthSession(res);
    return res;
  },

  resendLoginOtp: (challengeId: string, locale?: LocaleCode) =>
    fetchJson<{ ok: boolean; cooldown_seconds: number; expires_in_seconds: number }>(
      '/api/v1/auth/login/resend-otp',
      {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challengeId, locale }),
      },
    ),

  sendRegisterVerificationCode: (email: string, locale?: LocaleCode) =>
    fetchJson<{ ok: boolean; expires_in_seconds: number; cooldown_seconds: number }>(
      '/api/v1/auth/register/send-code',
      {
        method: 'POST',
        body: JSON.stringify({ email, locale }),
      },
    ),

  checkUsername: (username: string, signal?: AbortSignal) =>
    fetchJson<CheckUsernameResponse>(
      `/api/v1/auth/check-username?username=${encodeURIComponent(username)}`,
      { signal },
    ),

  registerAccount: async (payload: {
    username: string;
    email: string;
    password: string;
    verification_code: string;
    display_name?: string;
    role?: 'reader' | 'author';
  }) => {
    const res = await fetchJson<AuthSessionResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        anonymous_learner_id: getAnonymousLearnerId(),
      }),
    });
    saveAuthSession(res);
    return res;
  },

  listMySessions: () => fetchJson<UserSessionDto[]>('/api/v1/auth/sessions'),

  revokeMySession: (sessionId: string) =>
    fetchJson<{ revoked: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    ),

  revokeOtherSessions: () =>
    fetchJson<{ revoked_count: number }>('/api/v1/auth/sessions/revoke-others', {
      method: 'POST',
    }),

  updateMyProfile: (payload: {
    display_name: string;
    bio: string;
    avatar_source: AvatarSource;
    uploaded_avatar_url: string;
  }) =>
    fetchJson<UserProfileDto>('/api/v1/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  forgotPassword: (email: string, locale?: LocaleCode) =>
    fetchJson<{ ok: boolean; cooldown_seconds?: number }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, locale }),
    }),

  verifyResetOtp: (email: string, otp_code: string) =>
    fetchJson<{ ok: boolean; reset_token: string }>('/api/v1/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp_code }),
    }),

  resetPassword: async (payload: {
    token?: string;
    email?: string;
    otp_code?: string;
    new_password: string;
  }) => {
    const res = await fetchJson<AuthSessionResponse>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: payload.token ?? '',
        email: payload.email ?? '',
        otp_code: payload.otp_code ?? '',
        new_password: payload.new_password,
        anonymous_learner_id: getAnonymousLearnerId(),
      }),
    });
    saveAuthSession(res);
    return res;
  },

  changePassword: (current_password: string, new_password: string) =>
    fetchJson<{ ok: boolean }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),

  getOAuthOnboarding: (token: string) =>
    fetchJson<OAuthOnboardingInfoDto>(
      `/api/v1/auth/oauth/onboarding/${encodeURIComponent(token)}`,
    ),

  completeOAuthRegistration: async (payload: {
    onboarding_token: string;
    username: string;
    display_name: string;
    email: string;
    role?: 'reader' | 'author';
    avatar_source: AvatarSource;
    uploaded_avatar_url?: string;
  }) => {
    const res = await fetchJson<AuthSessionResponse>(
      '/api/v1/auth/oauth/complete-registration',
      {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          anonymous_learner_id: getAnonymousLearnerId(),
        }),
      },
    );
    saveAuthSession(res);
    return res;
  },

  bindExistingOAuth: async (payload: {
    onboarding_token: string;
    identifier: string;
    password: string;
  }) => {
    const res = await fetchJson<AuthSessionResponse>(
      '/api/v1/auth/oauth/bind-existing',
      {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          anonymous_learner_id: getAnonymousLearnerId(),
        }),
      },
    );
    saveAuthSession(res);
    return res;
  },

  exchangeOAuthTicket: async (ticket: string) => {
    const res = await fetchJson<AuthSessionResponse>('/api/v1/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        ticket,
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

  // Studio Authoring & Co-Author Collaboration
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

  studioDeleteTrack: (track: string) =>
    fetchJson<{ deleted: boolean }>(
      `/api/v1/studio/tracks/${encodeURIComponent(track)}`,
      { method: 'DELETE' },
    ),

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

  studioDeleteChapter: (track: string, chapter: string) =>
    fetchJson<{ deleted: boolean }>(
      `/api/v1/studio/tracks/${encodeURIComponent(track)}/chapters/${encodeURIComponent(chapter)}`,
      { method: 'DELETE' },
    ),

  studioPreview: (payload: {
    title: string;
    summary: string;
    body_markdown: string;
  }) =>
    fetchJson<StudioPreviewResponse>('/api/v1/studio/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createCollaboratorInvite: (
    track: string,
    chapter: string,
    step: string,
    email: string,
    locale?: LocaleCode,
  ) =>
    fetchJson<CreateInviteResponseDto>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/invites`,
      {
        method: 'POST',
        body: JSON.stringify({ email, locale }),
      },
    ),

  revokeCollaboratorInvite: (inviteId: string) =>
    fetchJson<{ deleted: boolean }>(
      `/api/v1/studio/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE' },
    ),

  acceptCollaboratorInvite: (token: string) =>
    fetchJson<AcceptInviteResponseDto>('/api/v1/studio/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  removeStepCollaborator: (
    track: string,
    chapter: string,
    step: string,
    userId: string,
  ) =>
    fetchJson<{ removed: boolean }>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/collaborators/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),

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

  adminGetStorage: () => fetchJson<StorageStatusDto>('/api/v1/admin/storage'),

  adminTestStorage: (database_url: string) =>
    fetchJson<{ ok: boolean; latency_ms: number }>('/api/v1/admin/storage/test', {
      method: 'POST',
      body: JSON.stringify({ database_url }),
    }),

  adminUpdateStorage: async (payload: {
    mode: 'local' | 'postgres';
    database_url?: string;
    sync_content?: boolean;
  }): Promise<SwitchStorageResponseDto> => {
    const res = await fetchJson<SwitchStorageResponseDto>('/api/v1/admin/storage', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (res.new_session_token) {
      saveRawSessionToken(res.new_session_token);
    }
    return res;
  },

  adminGetOAuthSecretStatus: () =>
    fetchJson<{ has_client_secret: boolean }>('/api/v1/admin/oauth-secret'),

  adminUpdateOAuthSecret: (payload: { client_secret?: string; clear?: boolean }) =>
    fetchJson<{ has_client_secret: boolean }>('/api/v1/admin/oauth-secret', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  adminGetSmtp: () => fetchJson<SmtpStatusResponseDto>('/api/v1/admin/smtp'),

  adminUpdateSmtp: (payload: {
    settings: SmtpSettingsDto;
    password?: string;
    clear_password?: boolean;
  }) =>
    fetchJson<SmtpStatusResponseDto>('/api/v1/admin/smtp', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  adminTestSmtp: (payload: {
    to_email: string;
    settings?: SmtpSettingsDto;
    password?: string;
    locale?: LocaleCode;
  }) =>
    fetchJson<{ ok: boolean }>('/api/v1/admin/smtp/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminPreviewSmtpTemplate: (payload: {
    template_kind: 'register_code' | 'login_anomaly' | 'invite' | 'reset' | 'takedown' | 'test';
    locale?: LocaleCode;
    subject?: string;
    html?: string;
    email_footer_text?: string;
  }) =>
    fetchJson<{ subject: string; html: string }>('/api/v1/admin/smtp/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminListUsers: () => fetchJson<UserProfileDto[]>('/api/v1/admin/users'),

  adminCreateUser: (payload: {
    username: string;
    display_name?: string;
    email?: string;
    role: UserRole;
    password: string;
  }) =>
    fetchJson<UserProfileDto>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateUserRole: (userId: string, role: UserRole) =>
    fetchJson<UserProfileDto>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/role`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      },
    ),

  adminSetUserBan: (userId: string, banned: boolean, reason = '') =>
    fetchJson<UserProfileDto>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/ban`,
      {
        method: 'PATCH',
        body: JSON.stringify({ banned, reason }),
      },
    ),

  adminResetUserPassword: (userId: string, new_password: string) =>
    fetchJson<UserProfileDto>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: 'POST',
        body: JSON.stringify({ new_password }),
      },
    ),

  adminDeleteUser: (userId: string) =>
    fetchJson<{ deleted: boolean }>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),

  adminTakedownStep: (
    track: string,
    chapter: string,
    step: string,
    reason: string,
  ) =>
    fetchJson<TakedownStepResponseDto>(
      `/api/v1/admin/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/takedown`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    ),

  adminRestoreStep: (track: string, chapter: string, step: string) =>
    fetchJson<{ restored: boolean }>(
      `/api/v1/admin/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/restore`,
      { method: 'POST' },
    ),
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
