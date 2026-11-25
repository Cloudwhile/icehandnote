import { ApiError, parseApiErrorResponse } from './apiError';
import { clearUserViewCaches } from './viewCache';
import type {
  AcceptInviteResponseDto,
  ArticleTaskChecksDto,
  AuthMeResponse,
  AuthSessionResponse,
  AvatarSource,
  CheckUsernameResponse,
  CollaborationAuditLogDto,
  CollaboratorRole,
  CreateInviteResponseDto,
  InvitePreviewDto,
  LearnerProgressDto,
  LocaleCode,
  LoginResultResponse,
  OAuthOnboardingInfoDto,
  PasskeyListResponseDto,
  PostgresConnectionFieldsDto,
  PresenceMemberDto,
  RevisionDiffDto,
  SearchHitDto,
  SiteSettingsDto,
  SmtpSettingsDto,
  SmtpStatusResponseDto,
  StepDetailDto,
  StepRevisionDto,
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
  UserPasskeyDto,
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
const USER_PROFILE_CACHE_KEY = 'icehandnote_user_profile_cache';
const DEVICE_ID_KEY = 'icehandnote_device_id';
const CLIENT_TAB_KEY = 'icehandnote_tab_id';

function generateRandomHex16(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 16);
}

let volatileDeviceId: string | null = null;
let volatileTabId: string | null = null;

export function getClientTabId(): string {
  try {
    let existing = sessionStorage.getItem(CLIENT_TAB_KEY)?.trim() ?? '';
    if (!existing) {
      existing = `tab_${generateRandomHex16()}`;
      sessionStorage.setItem(CLIENT_TAB_KEY, existing);
    }
    return existing;
  } catch {
    volatileTabId ??= `tab_${generateRandomHex16()}`;
    return volatileTabId;
  }
}

export function isLikelyOfflineNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err instanceof TypeError;
}

export function getClientDeviceId(): string {
  try {
    let existing = localStorage.getItem(DEVICE_ID_KEY)?.trim() ?? '';
    if (!existing || existing === 'dev_browser') {
      existing = `dev_${generateRandomHex16()}`;
      localStorage.setItem(DEVICE_ID_KEY, existing);
    }
    return existing;
  } catch {
    volatileDeviceId ??= `dev_${generateRandomHex16()}`;
    return volatileDeviceId;
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

export function saveCachedSessionUser(user: UserProfileDto | null): void {
  try {
    if (user && getSessionToken()) {
      localStorage.setItem(USER_PROFILE_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_PROFILE_CACHE_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

export function getCachedSessionUser(): UserProfileDto | null {
  try {
    if (!getSessionToken()) {
      localStorage.removeItem(USER_PROFILE_CACHE_KEY);
      return null;
    }
    const raw = localStorage.getItem(USER_PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfileDto>;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.username !== 'string') {
      return null;
    }
    return parsed as UserProfileDto;
  } catch {
    return null;
  }
}

let pendingAuthMe: Promise<AuthMeResponse> | null = null;
let initialAuthChecked = false;

export function saveAuthSession(session: AuthSessionResponse): void {
  initialAuthChecked = true;
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, session.session_token);
    localStorage.setItem(USER_LEARNER_KEY, session.learner_key);
    localStorage.setItem(USER_PROFILE_CACHE_KEY, JSON.stringify(session.user));
  } catch {
    // ignore storage restriction
  }
}

export function saveRawSessionToken(token: string): void {
  initialAuthChecked = true;
  try {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    }
  } catch {
    // ignore storage restriction
  }
}

export function getActiveStorageScopeKey(): string {
  if (getSessionToken()) {
    const cached = getCachedSessionUser();
    if (cached?.id) {
      return `user:${cached.id}`;
    }
    try {
      const userLearnerKey =
        localStorage.getItem(USER_LEARNER_KEY) ??
        localStorage.getItem(LEGACY_USER_LEARNER_KEY);
      if (userLearnerKey) {
        return `user:${userLearnerKey}`;
      }
    } catch {
      // ignore storage restriction
    }
    return 'user:active';
  }
  return `anon:${getAnonymousLearnerId()}`;
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(USER_LEARNER_KEY);
    localStorage.removeItem(USER_PROFILE_CACHE_KEY);
    localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USER_LEARNER_KEY);
    const taskCheckPrefix = 'icehandnote_task_checks::user:';
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(taskCheckPrefix)) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
  void import('./offlineNoteQueue')
    .then((m) => m.clearUserOfflineNoteOps())
    .catch(() => {});
  clearUserViewCaches();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  // Prevent expired localStorage Bearer tokens from racing initial boot and returning 401 on guest-capable `/api/v1/me/*`
  if (url.startsWith('/api/v1/me/') && getSessionToken()) {
    if (pendingAuthMe) {
      await pendingAuthMe.catch(() => {});
    } else if (!initialAuthChecked) {
      await api.authMe().catch(() => {});
    }
  }

  const token = getSessionToken();
  const activeLocale =
    typeof document !== 'undefined' && document.documentElement.lang
      ? document.documentElement.lang
      : 'zh-CN';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': getClientDeviceId(),
    'X-Client-Tab-Id': getClientTabId(),
    'X-Site-Locale': activeLocale,
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  if (!res.ok) {
    const err = await parseApiErrorResponse(res);
    if (res.status === 401 && token && err.code === 'SESSION_EXPIRED') {
      clearAuthSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ihn:session-expired'));
      }
    }
    throw err;
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

  getSeriesArticleDetail: (
    locale: LocaleCode,
    track: string,
    step: string,
  ) =>
    fetchJson<StepDetailDto>(
      `/api/v1/${locale}/series/${encodeURIComponent(track)}/${encodeURIComponent(step)}`,
    ),

  search: (locale: LocaleCode, query: string) =>
    fetchJson<SearchHitDto[]>(
      `/api/v1/${locale}/search?q=${encodeURIComponent(query)}`,
    ),

  getProgress: () => fetchJson<LearnerProgressDto>('/api/v1/me/progress'),

  toggleStepComplete: (stepId: string, completed: boolean) =>
    fetchJson<LearnerProgressDto>('/api/v1/me/progress', {
      method: 'POST',
      body: JSON.stringify({
        step_id: stepId,
        completed,
      }),
    }),

  getTaskChecks: (stepId: string) =>
    fetchJson<ArticleTaskChecksDto>(
      `/api/v1/me/task-checks?step_id=${encodeURIComponent(stepId)}`,
    ),

  toggleTaskCheck: (stepId: string, taskItemId: string, checked: boolean) =>
    fetchJson<ArticleTaskChecksDto>('/api/v1/me/task-checks', {
      method: 'POST',
      body: JSON.stringify({
        step_id: stepId,
        task_item_id: taskItemId,
        checked,
      }),
    }),

  likeStep: (stepId: string) =>
    fetchJson<{ likes_count: number }>(`/api/v1/steps/${stepId}/like`, {
      method: 'POST',
    }),

  listMarginNotes: (stepId: string, locale?: LocaleCode) => {
    const qs = new URLSearchParams({ step_id: stepId });
    if (locale) qs.set('locale', locale);
    return fetchJson<UserMarginNoteDto[]>(`/api/v1/me/notes?${qs.toString()}`);
  },

  listAllMarginNotes: (opts?: {
    locale?: string;
    tag?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (opts?.locale) qs.set('locale', opts.locale);
    if (opts?.tag && opts.tag !== 'all') qs.set('tag', opts.tag);
    if (opts?.q?.trim()) qs.set('q', opts.q.trim());
    if (opts?.limit) qs.set('limit', String(opts.limit));
    if (opts?.offset) qs.set('offset', String(opts.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return fetchJson<UserMarginNoteDto[]>(`/api/v1/me/notes${suffix}`);
  },

  createMarginNote: (payload: {
    step_id: string;
    locale_code: LocaleCode;
    block_anchor_id: string;
    note_color: string;
    tone?: string;
    style?: string;
    tag?: string;
    motivation?: string;
    target?: import('./types').AnnotationTarget;
    content: string;
    idempotencyKey?: string;
  }) => {
    const { idempotencyKey, ...body } = payload;
    const key =
      idempotencyKey ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return fetchJson<UserMarginNoteDto>('/api/v1/me/notes', {
      method: 'POST',
      headers: {
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
    });
  },

  updateMarginNote: (
    noteId: string,
    patch: {
      content?: string;
      note_color?: string;
      tone?: string;
      style?: string;
      tag?: string;
      motivation?: string;
      block_anchor_id?: string;
      target?: import('./types').AnnotationTarget;
    },
    expectedEtag?: string,
  ) =>
    fetchJson<UserMarginNoteDto>(`/api/v1/me/notes/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/merge-patch+json',
        ...(expectedEtag ? { 'If-Match': expectedEtag } : {}),
      },
      body: JSON.stringify(patch),
    }),

  deleteMarginNote: (noteId: string, expectedEtag?: string) =>
    fetchJson<{ deleted: boolean; id: string; undo_expires_at?: string | null }>(
      `/api/v1/me/notes/${encodeURIComponent(noteId)}`,
      {
        method: 'DELETE',
        headers: expectedEtag ? { 'If-Match': expectedEtag } : undefined,
      },
    ),

  restoreMarginNote: (noteId: string) =>
    fetchJson<UserMarginNoteDto>(
      `/api/v1/me/notes/${encodeURIComponent(noteId)}/restore`,
      { method: 'POST' },
    ),

  exportMarginNotes: async (
    format: 'markdown' | 'w3c-jsonld',
    opts?: { stepId?: string; locale?: string; tag?: string },
  ): Promise<{ blob: Blob; filename: string }> => {
    const qs = new URLSearchParams({ format });
    if (opts?.stepId) qs.set('step_id', opts.stepId);
    if (opts?.locale) qs.set('locale', opts.locale);
    if (opts?.tag && opts.tag !== 'all') qs.set('tag', opts.tag);
    const token = getSessionToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`/api/v1/me/notes/export?${qs.toString()}`, {
      credentials: 'same-origin',
      headers,
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res);
    }
    const blob = await res.blob();
    const filename =
      format === 'w3c-jsonld'
        ? 'icehandnote-annotations.jsonld'
        : 'icehandnote-notes.md';
    return { blob, filename };
  },

  // Media Upload (Authenticated users or OAuth onboarding)
  uploadMedia: (file: File, onboardingToken?: string) =>
    uploadMediaFile(file, '/api/v1/uploads', onboardingToken),

  uploadStudioMedia: (file: File) =>
    uploadMediaFile(file, '/api/v1/studio/uploads'),

  // Auth, Profile, Password Reset & OAuth / SSO
  authMe: async () => {
    if (pendingAuthMe) {
      return pendingAuthMe;
    }
    const req = fetchJson<AuthMeResponse>('/api/v1/auth/me')
      .then((me) => {
        if (me.authenticated && me.user) {
          saveCachedSessionUser(me.user);
        } else {
          clearAuthSession();
        }
        return me;
      })
      .finally(() => {
        initialAuthChecked = true;
        if (pendingAuthMe === req) {
          pendingAuthMe = null;
        }
      });
    pendingAuthMe = req;
    return req;
  },

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

  verifyLoginOtp: async (
    challengeId: string,
    code: string,
    locale?: LocaleCode,
  ) => {
    const res = await fetchJson<AuthSessionResponse>('/api/v1/auth/login/verify-otp', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challengeId,
        code,
        anonymous_learner_id: getAnonymousLearnerId(),
        locale,
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
    fetchJson<{ ok: boolean; cooldown_seconds?: number; expires_in_seconds?: number }>(
      '/api/v1/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ email, locale }),
      },
    ),

  validateResetToken: (token: string, signal?: AbortSignal) =>
    fetchJson<{ valid: boolean; expires_in_seconds: number }>(
      `/api/v1/auth/reset-password/validate?token=${encodeURIComponent(token)}`,
      { signal },
    ),

  verifyResetOtp: (email: string, otp_code: string) =>
    fetchJson<{ ok: boolean; reset_token: string; expires_in_seconds?: number }>(
      '/api/v1/auth/verify-reset-otp',
      {
        method: 'POST',
        body: JSON.stringify({ email, otp_code }),
      },
    ),

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

  sendEmailChangeCode: (new_email: string, locale?: LocaleCode) =>
    fetchJson<{
      ok: boolean;
      cooldown_seconds: number;
      expires_in_seconds: number;
    }>('/api/v1/auth/me/email/send-code', {
      method: 'POST',
      body: JSON.stringify({ new_email, locale }),
    }),

  verifyEmailChange: (new_email: string, code: string) =>
    fetchJson<UserProfileDto>('/api/v1/auth/me/email/verify', {
      method: 'POST',
      body: JSON.stringify({ new_email, code }),
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
    verification_code?: string;
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
    locale?: LocaleCode;
  }): Promise<LoginResultResponse> => {
    const res = await fetchJson<LoginResultResponse>(
      '/api/v1/auth/oauth/bind-existing',
      {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          anonymous_learner_id: getAnonymousLearnerId(),
        }),
      },
    );
    if (!res.requires_otp) {
      saveAuthSession(res);
    }
    return res;
  },

  exchangeOAuthTicket: async (
    ticket: string,
    locale?: LocaleCode,
  ): Promise<LoginResultResponse> => {
    const res = await fetchJson<LoginResultResponse>('/api/v1/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        ticket,
        anonymous_learner_id: getAnonymousLearnerId(),
        locale,
      }),
    });
    if (!res.requires_otp) {
      saveAuthSession(res);
    }
    return res;
  },

  createOAuthBindTicket: () =>
    fetchJson<{ bind_ticket: string }>('/api/v1/auth/oauth/bind-ticket', {
      method: 'POST',
      body: '{}',
    }),

  unbindOAuthProvider: (provider: string) =>
    fetchJson<UserProfileDto>(
      `/api/v1/auth/me/oauth/${encodeURIComponent(provider)}`,
      { method: 'DELETE' },
    ),

  listMyPasskeys: () => fetchJson<PasskeyListResponseDto>('/api/v1/auth/passkeys'),

  getPasskeyRegisterOptions: (promotion = false) =>
    fetchJson<{ ceremony_id: string; options: Record<string, unknown> }>(
      '/api/v1/auth/passkeys/register/options',
      {
        method: 'POST',
        body: JSON.stringify({ promotion }),
      },
    ),

  verifyPasskeyRegister: (
    ceremony_id: string,
    credential: Record<string, unknown>,
    nickname?: string,
  ) =>
    fetchJson<UserPasskeyDto>('/api/v1/auth/passkeys/register/verify', {
      method: 'POST',
      body: JSON.stringify({ ceremony_id, credential, nickname }),
    }),

  renamePasskey: (credentialId: string, name: string) =>
    fetchJson<UserPasskeyDto>(
      `/api/v1/auth/passkeys/${encodeURIComponent(credentialId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      },
    ),

  deletePasskey: (credentialId: string) =>
    fetchJson<{ deleted: boolean }>(
      `/api/v1/auth/passkeys/${encodeURIComponent(credentialId)}`,
      { method: 'DELETE' },
    ),

  getPasskeyLoginOptions: () =>
    fetchJson<{ ceremony_id: string; options: Record<string, unknown> }>(
      '/api/v1/auth/passkeys/login/options',
      {
        method: 'POST',
        body: '{}',
      },
    ),

  verifyPasskeyLogin: async (
    ceremony_id: string,
    credential: Record<string, unknown>,
    locale?: LocaleCode,
  ): Promise<LoginResultResponse> => {
    const res = await fetchJson<LoginResultResponse>(
      '/api/v1/auth/passkeys/login/verify',
      {
        method: 'POST',
        body: JSON.stringify({
          ceremony_id,
          credential,
          anonymous_learner_id: getAnonymousLearnerId(),
          locale,
        }),
      },
    );
    if (!res.requires_otp) {
      saveAuthSession(res);
    }
    return res;
  },

  verifySsoToken: async (
    ssoToken: string,
    locale?: LocaleCode,
  ): Promise<LoginResultResponse> => {
    const res = await fetchJson<LoginResultResponse>('/api/v1/auth/sso/verify', {
      method: 'POST',
      body: JSON.stringify({
        sso_token: ssoToken,
        anonymous_learner_id: getAnonymousLearnerId(),
        locale,
      }),
    });
    if (!res.requires_otp) {
      saveAuthSession(res);
    }
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
    previous_step_slug?: string;
    locale: string;
    title: string;
    summary: string;
    step_number: number;
    estimated_minutes: number;
    synced_revision: number;
    bump_canonical: boolean;
    status: string;
    cover_image?: string;
    license?: string;
    tags: string[];
    body_markdown: string;
    write_to_content_dir?: boolean;
    expected_etag?: string;
    change_note?: string;
  }) => {
    const headers: Record<string, string> = {};
    if (payload.expected_etag) {
      headers['If-Match'] = payload.expected_etag;
    }
    return fetchJson<StudioStepEditorDto>('/api/v1/studio/steps', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  },

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
    first_chapter_slug?: string;
    first_chapter_title?: string;
  }) =>
    fetchJson<StudioTrackDto>('/api/v1/studio/tracks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  studioUpdateTrackMeta: (
    track: string,
    payload: {
      icon_kind?: string;
      difficulty?: string;
      tags?: string[];
    },
  ) =>
    fetchJson<{
      ok: boolean;
      icon_kind?: string | null;
      difficulty?: string | null;
      tags?: string[] | null;
    }>(`/api/v1/studio/tracks/${encodeURIComponent(track)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  studioUpdateTrackIcon: (track: string, icon_kind: string) =>
    fetchJson<{ ok: boolean; icon_kind?: string | null }>(
      `/api/v1/studio/tracks/${encodeURIComponent(track)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ icon_kind }),
      },
    ),

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
    role: CollaboratorRole = 'editor',
    localeScope: string[] = [],
  ) =>
    fetchJson<CreateInviteResponseDto>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/invites`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key':
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `inv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify({
          email,
          locale,
          role,
          locale_scope: localeScope,
        }),
      },
    ),

  previewCollaboratorInvite: (token: string) =>
    fetchJson<InvitePreviewDto>('/api/v1/studio/invites/preview', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

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

  updateStepCollaboratorRole: (
    track: string,
    chapter: string,
    step: string,
    userId: string,
    role: CollaboratorRole,
    localeScope: string[] = [],
  ) =>
    fetchJson<{ updated: boolean }>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/collaborators/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role, locale_scope: localeScope }),
      },
    ),

  leaveStepCollaboration: (track: string, chapter: string, step: string) =>
    fetchJson<{ left: boolean; user?: UserProfileDto | null }>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/collaborators/me`,
      { method: 'DELETE' },
    ),

  transferStepOwnership: (
    track: string,
    chapter: string,
    step: string,
    targetUserId: string,
  ) =>
    fetchJson<{ transferred: boolean }>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/transfer-owner`,
      {
        method: 'POST',
        body: JSON.stringify({ target_user_id: targetUserId }),
      },
    ),

  listStepRevisions: (
    track: string,
    chapter: string,
    step: string,
    locale: string,
  ) =>
    fetchJson<StepRevisionDto[]>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/${encodeURIComponent(locale)}/revisions`,
    ),

  getStepRevisionDiff: (
    track: string,
    chapter: string,
    step: string,
    locale: string,
    revisionId: string,
    againstRevisionId?: string,
  ) => {
    const qs = againstRevisionId
      ? `?against=${encodeURIComponent(againstRevisionId)}`
      : '';
    return fetchJson<RevisionDiffDto>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/${encodeURIComponent(locale)}/revisions/${encodeURIComponent(revisionId)}/diff${qs}`,
    );
  },

  putStepPresence: (
    track: string,
    chapter: string,
    step: string,
    body: { locale: string; state: 'viewing' | 'editing'; tab_id?: string },
  ) =>
    fetchJson<{ members: PresenceMemberDto[] }>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/presence`,
      {
        method: 'PUT',
        body: JSON.stringify({
          locale: body.locale,
          state: body.state,
          tab_id: body.tab_id ?? getClientTabId(),
        }),
      },
    ),

  deleteStepPresence: (
    track: string,
    chapter: string,
    step: string,
    tabId?: string,
  ) => {
    const cleanTab = encodeURIComponent(tabId ?? getClientTabId());
    return fetchJson<{ ok: boolean; members: PresenceMemberDto[] }>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/presence?tab_id=${cleanTab}`,
      { method: 'DELETE' },
    );
  },

  restoreStepRevision: (
    track: string,
    chapter: string,
    step: string,
    locale: string,
    revisionId: string,
    expectedEtag?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (expectedEtag) {
      headers['If-Match'] = expectedEtag;
    }
    return fetchJson<StudioStepEditorDto>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/${encodeURIComponent(locale)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      {
        method: 'POST',
        headers,
      },
    );
  },

  listStepAuditLogs: (track: string, chapter: string, step: string) =>
    fetchJson<CollaborationAuditLogDto[]>(
      `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/audit-logs`,
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

  adminTestStorage: (
    payload:
      | string
      | {
          database_url?: string;
          postgres?: PostgresConnectionFieldsDto;
          clear_password?: boolean;
        },
  ) =>
    fetchJson<{ ok: boolean; latency_ms: number }>('/api/v1/admin/storage/test', {
      method: 'POST',
      body: JSON.stringify(
        typeof payload === 'string' ? { database_url: payload } : payload,
      ),
    }),

  adminUpdateStorage: async (payload: {
    mode: 'local' | 'postgres';
    database_url?: string;
    postgres?: PostgresConnectionFieldsDto;
    clear_password?: boolean;
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
    fetchJson<{
      has_client_secret: boolean;
      provider_secrets: Record<string, boolean>;
    }>('/api/v1/admin/oauth-secret'),

  adminUpdateOAuthSecret: (payload: {
    provider_id?: string;
    client_secret?: string;
    clear?: boolean;
  }) =>
    fetchJson<{
      has_client_secret: boolean;
      provider_secrets: Record<string, boolean>;
    }>('/api/v1/admin/oauth-secret', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  adminGetSmtp: () => fetchJson<SmtpStatusResponseDto>('/api/v1/admin/smtp'),

  adminUpdateSmtp: (payload: {
    settings: SmtpSettingsDto;
    password?: string;
    clear_password?: boolean;
    cloudflare_api_token?: string;
    clear_cloudflare_api_token?: boolean;
  }) =>
    fetchJson<SmtpStatusResponseDto>('/api/v1/admin/smtp', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  adminTestSmtp: (payload: {
    to_email: string;
    settings?: SmtpSettingsDto;
    password?: string;
    cloudflare_api_token?: string;
    locale?: LocaleCode;
  }) =>
    fetchJson<{
      ok: boolean;
      provider?: import('./types').MailProviderKind;
      guard_status?: import('./types').MailGuardStatusDto;
    }>('/api/v1/admin/smtp/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminResetMailCircuit: () =>
    fetchJson<import('./types').MailGuardStatusDto>(
      '/api/v1/admin/smtp/guard/reset-circuit',
      {
        method: 'POST',
      },
    ),

  adminClearMailSuppression: (payload: {
    email?: string;
    clear_all?: boolean;
  }) =>
    fetchJson<import('./types').MailGuardStatusDto>(
      '/api/v1/admin/smtp/guard/clear-suppression',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  adminPreviewSmtpTemplate: (payload: {
    template_kind:
      | 'register_code'
      | 'login_otp'
      | 'login_anomaly'
      | 'email_change'
      | 'invite'
      | 'reset'
      | 'takedown'
      | 'account_ban'
      | 'test';
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

export { runDirectionalTransition } from './motion';
