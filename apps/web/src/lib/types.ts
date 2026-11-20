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

export type NotebookBlock =
  | {
      type: 'heading';
      block_id: string;
      level: number;
      number: string;
      text: string;
      is_task?: boolean;
      default_checked?: boolean;
    }
  | {
      type: 'paragraph';
      block_id: string;
      html: string;
      margin_note?: string | null;
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
      type: 'quote';
      block_id: string;
      html: string;
    };

export interface TocItem {
  id: string;
  level: number;
  number: string;
  text: string;
  is_task?: boolean;
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

export interface StepDetailDto {
  step_id: string;
  track_slug: string;
  track_title: string;
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
  has_revision_drift: boolean;
  estimated_minutes: number;
  title: string;
  summary: string;
  license?: string;
  author_name?: string;
  tags: string[];
  blocks: NotebookBlock[];
  toc: TocItem[];
  chapters: ChapterNavDto[];
  prev_step?: StepNeighborDto | null;
  next_step?: StepNeighborDto | null;
  likes_count: number;
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

export interface UserMarginNoteDto {
  id: string;
  learner_id: string;
  step_id: string;
  locale_code: string;
  block_anchor_id: string;
  note_color: string;
  content_html: string;
  raw_content: string;
  created_at: string;
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
  bio: string;
  role: UserRole;
  auth_source: string;
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
  estimated_minutes: number;
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
  is_published: boolean;
  chapters: StudioChapterDto[];
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
  status: string;
  license?: string;
  tags: string[];
  body_markdown: string;
}

export interface StudioPreviewResponse {
  blocks: NotebookBlock[];
  toc: TocItem[];
}

export type DefaultThemeSetting = 'system' | 'dark' | 'light';

export interface SiteSettingsDto {
  site_name: string;
  brand_badge: string;
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
  enable_margin_notes: boolean;
  enable_likes: boolean;
  enable_progress_tracking: boolean;
  enable_draft_autosave: boolean;
  draft_autosave_interval_secs: number;
}

export const DEFAULT_SITE_SETTINGS: SiteSettingsDto = {
  site_name: 'IceHandnote',
  brand_badge: '',
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
  enable_margin_notes: true,
  enable_likes: true,
  enable_progress_tracking: true,
  enable_draft_autosave: true,
  draft_autosave_interval_secs: 15,
};

export const APP_VERSION = 'v0.1.0-rc.2';

export interface UpdateCheckResponse {
  current_version: string;
  latest_version: string;
  channel: 'release' | 'ghcr' | 'source';
  has_update: boolean;
  release_url: string;
  published_at: string | null;
}

