export type LocaleCode = 'zh-CN' | 'en' | 'zh-TW' | 'ja';

export type TaskScope = 'section' | 'paragraph';

export type AlertKind =
  | 'tip'
  | 'note'
  | 'info'
  | 'idea'
  | 'question'
  | 'check'
  | 'bookmark'
  | 'warning'
  | 'danger';

export type StickerStyle =
  | 'tape'
  | 'pin'
  | 'torn'
  | 'clip'
  | 'stamp'
  | 'looseleaf'
  | 'tag';

export type StickerTone =
  | 'amber'
  | 'mint'
  | 'ice'
  | 'violet'
  | 'coral'
  | 'kraft';

export type CodeCardStyle = 'washi' | 'spiral' | 'index' | 'torn';

export type MarginStickerTag = 'note' | 'idea' | 'ask' | 'star' | 'todo';

export type LicenseId =
  | 'cc-by-4.0'
  | 'cc-by-sa-4.0'
  | 'cc-by-nc-4.0'
  | 'cc-by-nc-sa-4.0'
  | 'cc-by-nd-4.0'
  | 'cc-by-nc-nd-4.0'
  | 'cc0-1.0'
  | 'all-rights-reserved'
  | 'none';

export type AvatarSource = 'default' | 'gravatar' | 'oauth' | 'upload';

export interface SketchNode {
  id: string;
  label: string;
  sublabel?: string | null;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  tone: string;
}

export interface SketchEdge {
  from: string;
  to: string;
  label?: string | null;
}

export interface SketchSpec {
  nodes: SketchNode[];
  edges: SketchEdge[];
}

export interface StepTaskItem {
  item_id: string;
  title_html: string;
  detail_html?: string | null;
  default_checked?: boolean;
}

export type TextAlign = 'left' | 'center' | 'right';
export type TextSizePreset = 'sm' | 'base' | 'lg' | 'xl' | '2xl';

export type NotebookBlock =
  | {
      type: 'heading';
      block_id: string;
      level: number;
      number: string;
      text: string;
      is_task?: boolean;
      default_checked?: boolean;
      align?: TextAlign | null;
    }
  | {
      type: 'paragraph';
      block_id: string;
      html: string;
      margin_note?: string | null;
      align?: TextAlign | null;
      size?: string | null;
    }
  | {
      type: 'alert';
      block_id: string;
      kind: AlertKind;
      title: string;
      body_html: string;
      detail_summary?: string | null;
      detail_html?: string | null;
      style?: string | null;
      tone?: string | null;
      badge?: string | null;
      align?: TextAlign | null;
      size?: string | null;
    }
  | {
      type: 'code_card';
      block_id: string;
      language: string;
      filename?: string | null;
      code: string;
      margin_note?: string | null;
      style?: string | null;
    }
  | {
      type: 'rough_diagram';
      block_id: string;
      caption?: string | null;
      spec: SketchSpec;
    }
  | {
      type: 'list';
      block_id: string;
      ordered: boolean;
      items_html: string[];
    }
  | {
      type: 'steps';
      block_id: string;
      title: string;
      scope?: TaskScope;
      items: StepTaskItem[];
    }
  | {
      type: 'image';
      block_id: string;
      src: string;
      alt: string;
      caption?: string | null;
      margin_note?: string | null;
    }
  | {
      type: 'pixel_sticker';
      block_id: string;
      sprite: string;
      align?: string | null;
      size?: string | null;
      anchor?: string | null;
      x?: number | null;
      y?: number | null;
      rotate?: number | null;
      scale?: number | null;
      flip?: boolean | null;
      locked?: boolean | null;
      layer?: string | null;
      caption?: string | null;
    }
  | {
      type: 'quote';
      block_id: string;
      html: string;
      align?: TextAlign | null;
      size?: string | null;
    };

export interface TocItem {
  id: string;
  level: number;
  number: string;
  text: string;
  is_task?: boolean;
}

export interface TrackArticleCardDto {
  step_id: string;
  chapter_slug: string;
  chapter_title?: string;
  step_slug: string;
  step_number: number;
  title: string;
  summary: string;
  cover_image?: string;
  estimated_minutes: number;
  tags: string[];
  author_name?: string;
  published_at: string;
}

export interface TrackSummaryDto {
  id: string;
  slug: string;
  difficulty: string;
  icon_kind: string;
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  chapter_count: number;
  step_count: number;
  first_chapter_slug: string;
  first_step_slug: string;
  articles?: TrackArticleCardDto[];
}

export interface StepNavItemDto {
  id: string;
  slug: string;
  step_number: number;
  title: string;
  estimated_minutes: number;
  has_requested_locale: boolean;
  has_revision_drift: boolean;
}

export interface ChapterNavDto {
  slug: string;
  number: number;
  title: string;
  steps: StepNavItemDto[];
}

export interface StepNeighborDto {
  chapter_slug: string;
  step_slug: string;
  title: string;
}

export type CollaboratorRole = 'editor' | 'translator' | 'reviewer';

export interface ArticleAuthorDto {
  user_id?: string | null;
  username: string;
  display_name: string;
  avatar_url: string;
  is_owner: boolean;
  role?: 'owner' | CollaboratorRole | string;
  locale_scope?: string[];
}

export interface CollaboratorInviteDto {
  id: string;
  email: string;
  role?: CollaboratorRole | string;
  locale_scope?: string[];
  created_at: string;
  expires_at: string;
}

export interface InvitePreviewDto {
  invite_id: string;
  masked_email: string;
  role: CollaboratorRole | string;
  locale_scope: string[];
  track_slug: string;
  chapter_slug: string;
  step_slug: string;
  article_title: string;
  invited_by_name: string;
  expires_at: string;
  email_matches_viewer?: boolean | null;
}

export interface StepRevisionDto {
  id: string;
  step_id: string;
  locale_code: string;
  edit_seq: number;
  synced_revision: number;
  status: string;
  title: string;
  summary: string;
  body_markdown: string;
  content_sha256: string;
  author_user_id?: string | null;
  author_name: string;
  change_note: string;
  created_at: string;
}

export interface CollaborationAuditLogDto {
  id: string;
  step_id: string;
  actor_user_id?: string | null;
  actor_name: string;
  action: string;
  detail: string;
  created_at: string;
}

export interface RevisionConflictMeta {
  expected_etag: string;
  current_etag: string;
  current_edit_seq: number;
  updated_by: string;
  updated_at: string;
  remote_title: string;
  remote_summary: string;
  remote_body_markdown: string;
}

export type DiffOpKind = 'equal' | 'delete' | 'insert';

export interface DiffLineDto {
  op: DiffOpKind;
  left_line?: number | null;
  right_line?: number | null;
  text: string;
}

export interface RevisionDiffDto {
  base_revision_id?: string | null;
  base_edit_seq: number;
  target_revision_id: string;
  target_edit_seq: number;
  locale_code: string;
  additions: number;
  deletions: number;
  unchanged: number;
  lines: DiffLineDto[];
}

export interface PresenceMemberDto {
  user_id: string;
  display_name: string;
  username: string;
  avatar_url?: string;
  locale: string;
  state: 'viewing' | 'editing' | string;
  tab_id: string;
  updated_at: string;
}

export interface CollabRevisionSavedEvent {
  track_slug: string;
  chapter_slug: string;
  step_slug: string;
  locale: string;
  edit_seq: number;
  etag: string;
  author_user_id?: string | null;
  author_name: string;
  tab_id: string;
}

export interface StepDetailDto {
  step_id: string;
  track_slug: string;
  track_title: string;
  track_icon_kind?: string;
  chapter_slug: string;
  chapter_title: string;
  step_slug: string;
  step_number: number;
  total_steps_in_track: number;
  requested_locale: string;
  resolved_locale: string;
  is_fallback: boolean;
  available_locales: string[];
  canonical_revision: number;
  synced_revision: number;
  version?: number;
  has_revision_drift: boolean;
  estimated_minutes: number;
  title: string;
  summary: string;
  cover_image?: string;
  license?: string;
  author_name?: string;
  authors?: ArticleAuthorDto[];
  tags: string[];
  blocks: NotebookBlock[];
  toc: TocItem[];
  chapters: ChapterNavDto[];
  prev_step?: StepNeighborDto | null;
  next_step?: StepNeighborDto | null;
  likes_count: number;
  published_at: string;
  updated_at: string;
}

export interface SearchHitDto {
  track_slug: string;
  track_title: string;
  chapter_slug: string;
  step_slug: string;
  locale: string;
  title: string;
  snippet_html: string;
  tags: string[];
}

export type AnnotationSelector =
  | {
      type: 'FragmentSelector';
      conformsTo: string;
      value: string;
    }
  | {
      type: 'TextQuoteSelector';
      exact: string;
      prefix?: string;
      suffix?: string;
    }
  | {
      type: 'TextPositionSelector';
      start: number;
      end: number;
    };

export interface AnnotationTarget {
  source: string;
  source_revision: number;
  selector: AnnotationSelector[];
}

export interface UserMarginNoteDto {
  id: string;
  learner_id: string;
  step_id: string;
  locale_code: string;
  block_anchor_id: string;
  note_color: string;
  tone?: string;
  style?: string;
  tag?: string;
  motivation?: string;
  target?: AnnotationTarget | null;
  body_format?: string;
  content_html: string;
  raw_content: string;
  version?: number;
  created_at: string;
  updated_at?: string;
  pendingSync?: boolean;
  track_slug?: string;
  chapter_slug?: string;
  step_slug?: string;
  step_title?: string;
}

export interface LearnerProgressDto {
  learner_id: string;
  completed_step_ids: string[];
}

export interface ArticleTaskChecksDto {
  learner_id: string;
  step_id: string;
  checked_item_ids: string[];
}

export type UserRole = 'reader' | 'author' | 'admin';

export interface UserProfileDto {
  id: string;
  wp_user_id?: number | null;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string;
  avatar_source?: AvatarSource;
  oauth_avatar_url?: string;
  uploaded_avatar_url?: string;
  oauth_provider?: string | null;
  oauth_bindings?: string[];
  has_password?: boolean;
  bio: string;
  role: UserRole;
  has_collaborations?: boolean;
  auth_source: string;
  is_banned?: boolean;
  ban_reason?: string;
  last_login_at: string;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: UserProfileDto | null;
  learner_key?: string | null;
  dev_sso_enabled: boolean;
  blog_sso_entry_url: string;
}

export interface AuthSessionResponse {
  session_token: string;
  user: UserProfileDto;
  learner_key: string;
}

export interface LoginOtpChallengeResponse {
  requires_otp: true;
  challenge_id: string;
  masked_email: string;
  anomaly_reason: 'new_ip' | 'new_device' | 'new_ip_and_device' | string;
  ip_address: string;
  device_label: string;
  cooldown_seconds: number;
  expires_in_seconds: number;
}

export interface CheckUsernameResponse {
  available: boolean;
  reason?: 'invalid_format' | 'taken';
}

export type LoginResultResponse =
  | ({ requires_otp?: false } & AuthSessionResponse)
  | LoginOtpChallengeResponse;

export interface UserPasskeyDto {
  id: string;
  name: string;
  aaguid: string;
  device_type: 'singleDevice' | 'multiDevice' | string;
  backed_up: boolean;
  transports: string[];
  created_at: string;
  last_used_at?: string | null;
}

export interface PasskeyListResponseDto {
  enabled: boolean;
  rp_id: string;
  user_id: string;
  passkeys: UserPasskeyDto[];
}

export interface UserSessionDto {
  id: string;
  ip_address: string;
  user_agent: string;
  device_label: string;
  device_kind: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  is_current: boolean;
}

export interface OAuthOnboardingInfoDto {
  provider: string;
  provider_name: string;
  suggested_username: string;
  display_name: string;
  email: string;
  email_verified: boolean;
  smtp_enabled: boolean;
  oauth_avatar_url: string;
  gravatar_preview_url: string;
  allow_registration: boolean;
  allow_author_registration: boolean;
}

export interface StudioLocaleBadgeDto {
  locale: string;
  status: string;
  synced_revision: number;
  updated_at: string;
}

export interface StudioStepRowDto {
  step_id: string;
  slug: string;
  step_number: number;
  title: string;
  canonical_revision: number;
  version?: number;
  estimated_minutes: number;
  authors?: ArticleAuthorDto[];
  takedown_reason?: string | null;
  takedown_at?: string | null;
  takedown_by?: string | null;
  translations: StudioLocaleBadgeDto[];
}

export interface StudioChapterDto {
  chapter_id: string;
  slug: string;
  number: number;
  title: string;
  steps: StudioStepRowDto[];
}

export interface StudioTrackDto {
  track_id: string;
  slug: string;
  title: string;
  difficulty: string;
  icon_kind: string;
  tags?: string[];
  is_published: boolean;
  chapters: StudioChapterDto[];
}

/**
 * Resolve optional author-defined series badge, filtering out legacy machine-enum
 * difficulty strings (`beginner`, `intermediate`, `advanced`).
 */
export function resolveCustomTrackBadge(raw?: string | null): string {
  const clean = (raw ?? '').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower === 'beginner' || lower === 'intermediate' || lower === 'advanced') {
    return '';
  }
  return clean;
}

export interface StudioStepEditorDto {
  track_slug: string;
  chapter_slug: string;
  step_slug: string;
  locale: string;
  exists: boolean;
  title: string;
  summary: string;
  step_number: number;
  estimated_minutes: number;
  synced_revision: number;
  canonical_revision: number;
  version?: number;
  edit_seq?: number;
  etag?: string;
  status: string;
  cover_image?: string;
  license?: string;
  tags: string[];
  body_markdown: string;
  owner_user_id?: string | null;
  authors?: ArticleAuthorDto[];
  pending_invites?: CollaboratorInviteDto[];
  can_edit?: boolean;
  can_manage_collaborators?: boolean;
  can_leave?: boolean;
  viewer_role?: string;
  takedown_reason?: string | null;
  takedown_at?: string | null;
  takedown_by?: string | null;
  published_at?: string;
  updated_at?: string;
}

export interface StudioPreviewResponse {
  frontmatter?: {
    estimated_minutes?: number;
  };
  blocks: NotebookBlock[];
  toc: TocItem[];
}

export interface CreateInviteResponseDto {
  invite: CollaboratorInviteDto;
  invite_url: string;
  email_sent: boolean;
  email_error?: string | null;
}

export interface AcceptInviteResponseDto {
  ok: boolean;
  track_slug: string;
  chapter_slug: string;
  step_slug: string;
  user?: UserProfileDto | null;
}

export interface TakedownStepResponseDto {
  ok: boolean;
  notified_count: number;
  emails_sent: number;
}

export type DefaultThemeSetting = 'system' | 'dark' | 'light';

export type StudioSettingsTabId =
  | 'general'
  | 'oauth'
  | 'storage'
  | 'smtp'
  | 'updates';

export interface OAuthProviderDto {
  id: string;
  enabled: boolean;
  name: string;
  client_id: string;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  scopes: string;
}

export interface SiteSettingsDto {
  site_name: string;
  brand_badge: string;
  logo_url: string;
  hero_title: string;
  hero_tagline: string;
  footer_text: string;
  default_author_name: string;
  default_license: LicenseId;
  default_locale: LocaleCode;
  enabled_locales: LocaleCode[];
  default_theme: DefaultThemeSetting;
  blog_origin_url: string;
  blog_nav_label: string;
  sso_query_param: string;
  sso_enabled: boolean;
  allow_registration: boolean;
  allow_author_registration: boolean;
  gravatar_base_url: string;
  oauth_enabled: boolean;
  oauth_provider_name: string;
  oauth_client_id: string;
  oauth_authorize_url: string;
  oauth_token_url: string;
  oauth_userinfo_url: string;
  oauth_scopes: string;
  oauth_providers?: OAuthProviderDto[];
  enable_passkeys: boolean;
  enable_margin_notes: boolean;
  enable_likes: boolean;
  enable_progress_tracking: boolean;
  enable_draft_autosave: boolean;
  draft_autosave_interval_secs: number;
  stale_article_days: number;
}

export function getEffectiveOAuthProviders(
  settings: SiteSettingsDto,
): OAuthProviderDto[] {
  if (settings.oauth_providers && settings.oauth_providers.length > 0) {
    return settings.oauth_providers;
  }
  if (
    settings.oauth_enabled ||
    settings.oauth_client_id.trim() ||
    settings.oauth_authorize_url.trim()
  ) {
    const fallbackId =
      settings.oauth_provider_name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'default';
    return [
      {
        id: fallbackId,
        enabled: settings.oauth_enabled,
        name: settings.oauth_provider_name,
        client_id: settings.oauth_client_id,
        authorize_url: settings.oauth_authorize_url,
        token_url: settings.oauth_token_url,
        userinfo_url: settings.oauth_userinfo_url,
        scopes: settings.oauth_scopes || 'openid profile email',
      },
    ];
  }
  return [];
}

export const DEFAULT_SITE_SETTINGS: SiteSettingsDto = {
  site_name: 'IceHandnote',
  brand_badge: '',
  logo_url: '',
  hero_title: 'IceHandnote',
  hero_tagline: '',
  footer_text: '© IceHandnote · CC BY-NC-SA 4.0',
  default_author_name: '',
  default_license: 'cc-by-nc-sa-4.0',
  default_locale: 'zh-CN',
  enabled_locales: ['zh-CN', 'en', 'zh-TW', 'ja'],
  default_theme: 'system',
  blog_origin_url: '',
  blog_nav_label: '',
  sso_query_param: 'sso_login',
  sso_enabled: true,
  allow_registration: false,
  allow_author_registration: true,
  gravatar_base_url: 'https://www.gravatar.com/avatar',
  oauth_enabled: false,
  oauth_provider_name: '',
  oauth_client_id: '',
  oauth_authorize_url: '',
  oauth_token_url: '',
  oauth_userinfo_url: '',
  oauth_scopes: 'openid profile email',
  oauth_providers: [],
  enable_passkeys: true,
  enable_margin_notes: true,
  enable_likes: true,
  enable_progress_tracking: true,
  enable_draft_autosave: true,
  draft_autosave_interval_secs: 15,
  stale_article_days: 180,
};

export const APP_VERSION = 'v0.1.0-rc.6';

export type PostgresSslMode =
  | 'prefer'
  | 'disable'
  | 'require'
  | 'verify-ca'
  | 'verify-full';

export interface PostgresConnectionFieldsDto {
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl_mode: PostgresSslMode;
}

export interface StorageStatusDto {
  active_backend: 'local' | 'postgres';
  configured_mode: string;
  database_url_masked: string;
  has_saved_url: boolean;
  has_saved_password: boolean;
  postgres: PostgresConnectionFieldsDto;
}

export interface SwitchStorageResponseDto extends StorageStatusDto {
  new_session_token?: string;
}

export type MailProviderKind = 'smtp' | 'cloudflare_api';

export interface SmtpSettingsDto {
  enabled: boolean;
  provider: MailProviderKind;
  host: string;
  port: number;
  encryption: 'tls' | 'starttls' | 'none';
  username: string;
  cloudflare_account_id: string;
  verify_recipient_mx: boolean;
  from_name: string;
  from_email: string;
  email_footer_text: string;
  register_code_subject: string;
  register_code_html: string;
  login_anomaly_subject: string;
  login_anomaly_html: string;
  invite_subject: string;
  invite_html: string;
  reset_subject: string;
  reset_html: string;
  takedown_subject: string;
  takedown_html: string;
  ban_subject: string;
  ban_html: string;
}

export interface SmtpTemplatePreviewDto {
  subject: string;
  html: string;
}

export interface SuppressedRecipientDto {
  email: string;
  reason: string;
  provider: string;
  suppressed_at: string;
}

export interface MailGuardStatusDto {
  circuit_open: boolean;
  circuit_reason: string | null;
  circuit_provider: string | null;
  circuit_retry_after_secs: number;
  rolling_sent: number;
  rolling_hard_failures: number;
  consecutive_hard_failures: number;
  suppressed_count: number;
  suppressed_recipients: SuppressedRecipientDto[];
  total_sent: number;
  total_bounced: number;
  total_blocked_domain: number;
  total_blocked_suppressed: number;
  total_deduped: number;
}

export interface SmtpStatusResponseDto {
  settings: SmtpSettingsDto;
  has_password: boolean;
  has_cloudflare_api_token: boolean;
  active_provider: MailProviderKind | null;
  guard_status: MailGuardStatusDto;
}

export interface UploadMediaResponseDto {
  url: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256?: string;
}

export interface UpdateCheckResponse {
  current_version: string;
  latest_version: string;
  channel: 'release' | 'ghcr' | 'source';
  has_update: boolean;
  release_url: string;
  published_at: string | null;
}
