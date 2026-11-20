pub mod content_loader;
pub mod studio_auth;

use anyhow::Result;
use async_trait::async_trait;
use chrono::Utc;
use content_loader::{deterministic_uuid, load_content_directory, ContentBundle, LoadedTrack};
use icehandnote_core::{
    auth::{
        extract_body_without_frontmatter, format_step_markdown_file, hash_session_token,
        verify_password, BlogSsoClaims, CreateChapterInput, CreateTrackInput, SaveStudioStepInput,
        SiteSettingsDto, StudioChapterDto, StudioLocaleBadgeDto, StudioStepEditorDto,
        StudioStepRowDto, StudioTrackDto, UserProfileDto, UserRole,
    },
    build_highlighted_snippet, compile_notebook_markdown, sanitize_user_note, ArticleTaskChecksDto,
    ChapterNavDto, CreateMarginNoteInput, LearnerProgressDto, NotebookBlock, SearchHitDto,
    StepDetailDto, StepNavItemDto, StepNeighborDto, TocItem, TrackSummaryDto, UserMarginNoteDto,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use studio_auth::{
    apply_save_step_to_bundle_and_disk, build_studio_overview_from_bundle,
    create_chapter_in_bundle_and_disk, create_track_in_bundle_and_disk, default_seeded_blog_users,
    delete_step_in_bundle_and_disk, generate_raw_session_token, match_local_user_password,
    read_step_editor_from_bundle, upsert_local_blog_user, StoredSessionRecord, StoredUserRecord,
};
use tokio::sync::RwLock;
use uuid::Uuid;

#[async_trait]
pub trait TutorialRepository: Send + Sync {
    fn backend_kind(&self) -> &'static str;
    async fn list_tracks(&self, locale: &str) -> Result<Vec<TrackSummaryDto>>;
    async fn get_step_detail(
        &self,
        locale: &str,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Option<StepDetailDto>>;
    async fn search(&self, locale: &str, query: &str) -> Result<Vec<SearchHitDto>>;
    async fn get_progress(&self, learner_id: &str) -> Result<LearnerProgressDto>;
    async fn toggle_step_complete(
        &self,
        learner_id: &str,
        step_id: Uuid,
        completed: bool,
    ) -> Result<LearnerProgressDto>;
    async fn get_task_checks(
        &self,
        learner_id: &str,
        step_id: Uuid,
    ) -> Result<ArticleTaskChecksDto>;
    async fn toggle_task_check(
        &self,
        learner_id: &str,
        step_id: Uuid,
        task_item_id: &str,
        checked: bool,
    ) -> Result<ArticleTaskChecksDto>;
    async fn like_step(&self, step_id: Uuid) -> Result<i64>;
    async fn list_margin_notes(
        &self,
        step_id: Uuid,
        learner_id: &str,
    ) -> Result<Vec<UserMarginNoteDto>>;
    async fn create_margin_note(&self, input: CreateMarginNoteInput) -> Result<UserMarginNoteDto>;
    async fn delete_margin_note(&self, note_id: Uuid, learner_id: &str) -> Result<bool>;
    async fn sync_bundle(&self, bundle: &ContentBundle) -> Result<usize>;

    // Auth & External SSO User Bridge
    async fn upsert_blog_user(&self, claims: &BlogSsoClaims) -> Result<UserProfileDto>;
    async fn authenticate_password(
        &self,
        identifier: &str,
        password: &str,
    ) -> Result<Option<UserProfileDto>>;
    async fn create_session(&self, user_id: Uuid) -> Result<String>;
    async fn get_user_by_session(&self, raw_token: &str) -> Result<Option<UserProfileDto>>;
    async fn delete_session(&self, raw_token: &str) -> Result<()>;
    async fn merge_anonymous_learner(&self, anon_id: &str, user_learner_id: &str) -> Result<()>;

    // Studio Authoring (Author + Admin)
    async fn studio_list_tracks(&self, locale: &str) -> Result<Vec<StudioTrackDto>>;
    async fn studio_get_step_editor(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<StudioStepEditorDto>;
    async fn studio_save_step(
        &self,
        author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
    ) -> Result<StudioStepEditorDto>;
    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> Result<StudioTrackDto>;
    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        content_dir: &Path,
    ) -> Result<()>;
    async fn studio_delete_step(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> Result<bool>;

    // Admin User Governance (Admin only)
    async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto>;
    async fn admin_list_users(&self) -> Result<Vec<UserProfileDto>>;
    async fn admin_update_user_role(
        &self,
        target_user_id: Uuid,
        new_role: UserRole,
    ) -> Result<Option<UserProfileDto>>;

    // Site Settings (Public read, Admin write)
    async fn get_site_settings(&self, fallback: &SiteSettingsDto) -> Result<SiteSettingsDto>;
    async fn update_site_settings(
        &self,
        updated_by: Uuid,
        settings: SiteSettingsDto,
    ) -> Result<SiteSettingsDto>;
}

// ============================================================================
// 1. Production PostgreSQL 17 Repository (SQLx + PgPool + Trigram/PGroonga FTS)
// ============================================================================

pub struct PostgresRepository {
    pool: PgPool,
}

impl PostgresRepository {
    pub async fn connect_and_migrate(database_url: &str, seed_demo_users: bool) -> Result<Self> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(database_url)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0001_init_schema.sql"))
            .execute(&pool)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0002_users_and_studio.sql"))
            .execute(&pool)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0003_site_settings.sql"))
            .execute(&pool)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0004_task_step_checks.sql"))
            .execute(&pool)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0005_drop_glossary.sql"))
            .execute(&pool)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0006_step_license.sql"))
            .execute(&pool)
            .await?;

        // Demo accounts have publicly documented passwords: only seed when explicitly requested
        if !seed_demo_users {
            return Ok(Self { pool });
        }
        for rec in default_seeded_blog_users() {
            sqlx::query(
                r#"
                INSERT INTO users (id, wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, password_hash)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (username) DO NOTHING
                "#,
            )
            .bind(rec.profile.id)
            .bind(rec.profile.wp_user_id)
            .bind(&rec.profile.username)
            .bind(&rec.profile.display_name)
            .bind(&rec.profile.email)
            .bind(&rec.profile.avatar_url)
            .bind(&rec.profile.bio)
            .bind(rec.profile.role.as_str())
            .bind(&rec.profile.auth_source)
            .bind(&rec.password_hash)
            .execute(&pool)
            .await?;
        }

        Ok(Self { pool })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Create or update a local (password-based) account. Used by `icehandnote-cli create-admin`.
    pub async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto> {
        let pw_hash = icehandnote_core::auth::hash_password(username, password);
        let row = sqlx::query(
            r#"
            INSERT INTO users (username, display_name, email, bio, role, auth_source, password_hash)
            VALUES ($1, $2, $3, '', $4, 'local', $5)
            ON CONFLICT (username) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                email = EXCLUDED.email,
                role = EXCLUDED.role,
                password_hash = EXCLUDED.password_hash
            RETURNING id, wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, last_login_at
            "#,
        )
        .bind(username)
        .bind(display_name)
        .bind(email)
        .bind(role.as_str())
        .bind(&pw_hash)
        .fetch_one(&self.pool)
        .await?;
        // Revoke existing sessions so a password reset takes effect immediately
        let user = Self::row_to_user(&row)?;
        sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
            .bind(user.id)
            .execute(&self.pool)
            .await?;
        Ok(user)
    }

    fn row_to_user(r: &sqlx::postgres::PgRow) -> Result<UserProfileDto> {
        let role_str: String = r.try_get("role")?;
        Ok(UserProfileDto {
            id: r.try_get("id")?,
            wp_user_id: r.try_get("wp_user_id")?,
            username: r.try_get("username")?,
            display_name: r.try_get("display_name")?,
            email: r.try_get("email")?,
            avatar_url: r.try_get("avatar_url")?,
            bio: r.try_get("bio")?,
            role: UserRole::from_db(&role_str),
            auth_source: r.try_get("auth_source")?,
            last_login_at: r.try_get("last_login_at")?,
        })
    }
}

#[async_trait]
impl TutorialRepository for PostgresRepository {
    fn backend_kind(&self) -> &'static str {
        "postgresql-17"
    }

    async fn list_tracks(&self, locale: &str) -> Result<Vec<TrackSummaryDto>> {
        let rows = sqlx::query(
            r#"
            SELECT
                t.id,
                t.slug,
                t.difficulty,
                t.icon_kind,
                t.tags,
                COALESCE(tt_req.title, tt_def.title, t.slug) AS title,
                COALESCE(tt_req.subtitle, tt_def.subtitle, '') AS subtitle,
                COALESCE(tt_req.description, tt_def.description, '') AS description,
                (SELECT COUNT(*) FROM chapters c WHERE c.track_id = t.id) AS chapter_count,
                (SELECT COUNT(*) FROM steps s JOIN chapters c ON s.chapter_id = c.id
                  WHERE c.track_id = t.id
                    AND EXISTS (SELECT 1 FROM step_translations p WHERE p.step_id = s.id AND p.status = 'published')
                ) AS step_count,
                COALESCE((SELECT c.slug FROM chapters c WHERE c.track_id = t.id ORDER BY c.chapter_number ASC LIMIT 1), '') AS first_chapter_slug,
                COALESCE((
                    SELECT s.slug
                    FROM steps s
                    JOIN chapters c ON s.chapter_id = c.id
                    WHERE c.track_id = t.id
                      AND EXISTS (SELECT 1 FROM step_translations p WHERE p.step_id = s.id AND p.status = 'published')
                    ORDER BY c.chapter_number ASC, s.step_number ASC
                    LIMIT 1
                ), '') AS first_step_slug
            FROM tracks t
            LEFT JOIN track_translations tt_req ON tt_req.track_id = t.id AND tt_req.locale_code = $1
            LEFT JOIN track_translations tt_def ON tt_def.track_id = t.id AND tt_def.locale_code = 'zh-CN'
            WHERE t.is_published = TRUE
            ORDER BY t.sort_order ASC, t.slug ASC
            "#,
        )
        .bind(locale)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(TrackSummaryDto {
                id: r.try_get("id")?,
                slug: r.try_get("slug")?,
                difficulty: r.try_get("difficulty")?,
                icon_kind: r.try_get("icon_kind")?,
                title: r.try_get("title")?,
                subtitle: r.try_get("subtitle")?,
                description: r.try_get("description")?,
                tags: r.try_get("tags")?,
                chapter_count: r.try_get::<i64, _>("chapter_count")? as usize,
                step_count: r.try_get::<i64, _>("step_count")? as usize,
                first_chapter_slug: r.try_get("first_chapter_slug")?,
                first_step_slug: r.try_get("first_step_slug")?,
            });
        }
        Ok(out)
    }

    async fn get_step_detail(
        &self,
        locale: &str,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Option<StepDetailDto>> {
        let step_row = sqlx::query(
            r#"
            SELECT
                t.id AS track_id,
                COALESCE(tt_req.title, tt_def.title, t.slug) AS track_title,
                c.id AS chapter_id,
                COALESCE(ct_req.title, ct_def.title, c.slug) AS chapter_title,
                s.id AS step_id,
                s.step_number,
                s.default_locale,
                s.canonical_revision,
                s.estimated_minutes,
                s.likes_count
            FROM tracks t
            JOIN chapters c ON c.track_id = t.id AND c.slug = $2
            JOIN steps s ON s.chapter_id = c.id AND s.slug = $3
            LEFT JOIN track_translations tt_req ON tt_req.track_id = t.id AND tt_req.locale_code = $1
            LEFT JOIN track_translations tt_def ON tt_def.track_id = t.id AND tt_def.locale_code = 'zh-CN'
            LEFT JOIN chapter_translations ct_req ON ct_req.chapter_id = c.id AND ct_req.locale_code = $1
            LEFT JOIN chapter_translations ct_def ON ct_def.chapter_id = c.id AND ct_def.locale_code = 'zh-CN'
            WHERE t.slug = $4
            "#,
        )
        .bind(locale)
        .bind(chapter_slug)
        .bind(step_slug)
        .bind(track_slug)
        .fetch_optional(&self.pool)
        .await?;

        let Some(sr) = step_row else {
            return Ok(None);
        };

        let track_id: Uuid = sr.try_get("track_id")?;
        let step_id: Uuid = sr.try_get("step_id")?;
        let default_locale: String = sr.try_get("default_locale")?;
        let canonical_revision: i32 = sr.try_get("canonical_revision")?;

        let avail_rows = sqlx::query(
            "SELECT locale_code FROM step_translations WHERE step_id = $1 AND status = 'published' ORDER BY locale_code ASC",
        )
        .bind(step_id)
        .fetch_all(&self.pool)
        .await?;
        let available_locales: Vec<String> = avail_rows
            .into_iter()
            .filter_map(|r| r.try_get("locale_code").ok())
            .collect();

        let tr_row = sqlx::query(
            r#"
            SELECT locale_code, title, summary, license, author_name, tags, compiled_blocks, toc_tree, synced_revision, updated_at
            FROM step_translations
            WHERE step_id = $1 AND status = 'published'
            ORDER BY CASE WHEN locale_code = $2 THEN 0 WHEN locale_code = $3 THEN 1 ELSE 2 END, locale_code
            LIMIT 1
            "#,
        )
        .bind(step_id)
        .bind(locale)
        .bind(&default_locale)
        .fetch_optional(&self.pool)
        .await?;

        let Some(tr) = tr_row else {
            return Ok(None);
        };

        let resolved_locale: String = tr.try_get("locale_code")?;
        let synced_revision: i32 = tr.try_get("synced_revision")?;
        let blocks_val: serde_json::Value = tr.try_get("compiled_blocks")?;
        let toc_val: serde_json::Value = tr.try_get("toc_tree")?;
        let blocks: Vec<NotebookBlock> = serde_json::from_value(blocks_val)?;
        let toc: Vec<TocItem> = serde_json::from_value(toc_val)?;

        // Build chapter navigation tree for the track
        let nav_rows = sqlx::query(
            r#"
            SELECT
                c.slug AS chapter_slug,
                c.chapter_number,
                COALESCE(ct_req.title, ct_def.title, c.slug) AS chapter_title,
                s.id AS step_id,
                s.slug AS step_slug,
                s.step_number,
                s.estimated_minutes,
                s.canonical_revision,
                COALESCE(st_req.title, st_def.title, s.slug) AS step_title,
                (st_req.id IS NOT NULL) AS has_req,
                COALESCE(st_req.synced_revision, s.canonical_revision) AS req_rev
            FROM chapters c
            JOIN steps s ON s.chapter_id = c.id
            LEFT JOIN chapter_translations ct_req ON ct_req.chapter_id = c.id AND ct_req.locale_code = $2
            LEFT JOIN chapter_translations ct_def ON ct_def.chapter_id = c.id AND ct_def.locale_code = 'zh-CN'
            LEFT JOIN step_translations st_req ON st_req.step_id = s.id AND st_req.locale_code = $2 AND st_req.status = 'published'
            LEFT JOIN step_translations st_def ON st_def.step_id = s.id AND st_def.locale_code = s.default_locale AND st_def.status = 'published'
            WHERE c.track_id = $1
              AND EXISTS (SELECT 1 FROM step_translations p WHERE p.step_id = s.id AND p.status = 'published')
            ORDER BY c.chapter_number ASC, s.step_number ASC
            "#,
        )
        .bind(track_id)
        .bind(locale)
        .fetch_all(&self.pool)
        .await?;

        let mut chapters: Vec<ChapterNavDto> = Vec::new();
        let mut flat_steps: Vec<(String, String, String, Uuid)> = Vec::new();

        for nr in nav_rows {
            let c_slug: String = nr.try_get("chapter_slug")?;
            let c_num: i32 = nr.try_get("chapter_number")?;
            let c_title: String = nr.try_get("chapter_title")?;
            let s_id: Uuid = nr.try_get("step_id")?;
            let s_slug: String = nr.try_get("step_slug")?;
            let s_num: i32 = nr.try_get("step_number")?;
            let s_mins: i32 = nr.try_get("estimated_minutes")?;
            let s_crev: i32 = nr.try_get("canonical_revision")?;
            let s_title: String = nr.try_get("step_title")?;
            let has_req: bool = nr.try_get("has_req")?;
            let req_rev: i32 = nr.try_get("req_rev")?;

            flat_steps.push((c_slug.clone(), s_slug.clone(), s_title.clone(), s_id));

            if chapters.last().map(|c| c.slug.as_str()) != Some(c_slug.as_str()) {
                chapters.push(ChapterNavDto {
                    slug: c_slug,
                    number: c_num,
                    title: c_title,
                    steps: Vec::new(),
                });
            }
            if let Some(last_ch) = chapters.last_mut() {
                last_ch.steps.push(StepNavItemDto {
                    id: s_id,
                    slug: s_slug,
                    step_number: s_num,
                    title: s_title,
                    estimated_minutes: s_mins,
                    has_requested_locale: has_req,
                    has_revision_drift: has_req && req_rev < s_crev,
                });
            }
        }

        let current_idx = flat_steps.iter().position(|(_, _, _, id)| *id == step_id);
        let prev_step = current_idx
            .and_then(|i| i.checked_sub(1))
            .and_then(|pi| flat_steps.get(pi))
            .map(|(cs, ss, t, _)| StepNeighborDto {
                chapter_slug: cs.clone(),
                step_slug: ss.clone(),
                title: t.clone(),
            });
        let next_step = current_idx
            .and_then(|i| flat_steps.get(i + 1))
            .map(|(cs, ss, t, _)| StepNeighborDto {
                chapter_slug: cs.clone(),
                step_slug: ss.clone(),
                title: t.clone(),
            });

        Ok(Some(StepDetailDto {
            step_id,
            track_slug: track_slug.to_string(),
            track_title: sr.try_get("track_title")?,
            chapter_slug: chapter_slug.to_string(),
            chapter_title: sr.try_get("chapter_title")?,
            step_slug: step_slug.to_string(),
            step_number: sr.try_get("step_number")?,
            total_steps_in_track: flat_steps.len(),
            requested_locale: locale.to_string(),
            resolved_locale: resolved_locale.clone(),
            is_fallback: resolved_locale != locale,
            available_locales,
            canonical_revision,
            synced_revision,
            has_revision_drift: synced_revision < canonical_revision,
            estimated_minutes: sr.try_get("estimated_minutes")?,
            title: tr.try_get("title")?,
            summary: tr.try_get("summary")?,
            license: icehandnote_core::normalize_license_code(
                &tr.try_get::<String, _>("license").unwrap_or_default(),
            ),
            author_name: {
                let raw_author: String = tr.try_get("author_name").unwrap_or_default();
                if raw_author == "Author" {
                    String::new()
                } else {
                    raw_author
                }
            },
            tags: tr.try_get("tags")?,
            blocks,
            toc,
            chapters,
            prev_step,
            next_step,
            likes_count: sr.try_get("likes_count")?,
            updated_at: tr.try_get("updated_at")?,
        }))
    }

    async fn search(&self, locale: &str, query: &str) -> Result<Vec<SearchHitDto>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = format!("%{q}%");
        let rows = sqlx::query(
            r#"
            SELECT
                t.slug AS track_slug,
                COALESCE(tt.title, t.slug) AS track_title,
                c.slug AS chapter_slug,
                s.slug AS step_slug,
                st.locale_code,
                st.title,
                st.plain_text,
                st.tags
            FROM step_translations st
            JOIN steps s ON s.id = st.step_id
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id
            LEFT JOIN track_translations tt ON tt.track_id = t.id AND tt.locale_code = $1
            WHERE (st.locale_code = $1 OR st.locale_code = s.default_locale)
              AND st.status = 'published'
              AND (st.title ILIKE $2 OR st.plain_text ILIKE $2)
            ORDER BY CASE WHEN st.locale_code = $1 THEN 0 ELSE 1 END, s.step_number ASC
            LIMIT 12
            "#,
        )
        .bind(locale)
        .bind(&pattern)
        .fetch_all(&self.pool)
        .await?;

        let mut seen = HashSet::new();
        let mut hits = Vec::new();
        for r in rows {
            let track_slug: String = r.try_get("track_slug")?;
            let step_slug: String = r.try_get("step_slug")?;
            if !seen.insert((track_slug.clone(), step_slug.clone())) {
                continue;
            }
            let plain: String = r.try_get("plain_text")?;
            hits.push(SearchHitDto {
                track_slug,
                track_title: r.try_get("track_title")?,
                chapter_slug: r.try_get("chapter_slug")?,
                step_slug,
                locale: r.try_get("locale_code")?,
                title: r.try_get("title")?,
                snippet_html: build_highlighted_snippet(&plain, q),
                tags: r.try_get("tags")?,
            });
        }
        Ok(hits)
    }

    async fn get_progress(&self, learner_id: &str) -> Result<LearnerProgressDto> {
        let rows = sqlx::query(
            "SELECT step_id FROM learner_step_progress WHERE learner_id = $1 ORDER BY completed_at ASC",
        )
        .bind(learner_id)
        .fetch_all(&self.pool)
        .await?;

        let completed_step_ids = rows
            .into_iter()
            .filter_map(|r| r.try_get("step_id").ok())
            .collect();
        Ok(LearnerProgressDto {
            learner_id: learner_id.to_string(),
            completed_step_ids,
        })
    }

    async fn toggle_step_complete(
        &self,
        learner_id: &str,
        step_id: Uuid,
        completed: bool,
    ) -> Result<LearnerProgressDto> {
        if completed {
            sqlx::query(
                "INSERT INTO learner_step_progress (learner_id, step_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(learner_id)
            .bind(step_id)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query("DELETE FROM learner_step_progress WHERE learner_id = $1 AND step_id = $2")
                .bind(learner_id)
                .bind(step_id)
                .execute(&self.pool)
                .await?;
        }
        self.get_progress(learner_id).await
    }

    async fn get_task_checks(
        &self,
        learner_id: &str,
        step_id: Uuid,
    ) -> Result<ArticleTaskChecksDto> {
        let rows = sqlx::query(
            r#"
            SELECT task_item_id
            FROM learner_task_checks
            WHERE learner_id = $1 AND step_id = $2
            ORDER BY checked_at ASC
            "#,
        )
        .bind(learner_id)
        .bind(step_id)
        .fetch_all(&self.pool)
        .await?;

        let checked_item_ids = rows
            .into_iter()
            .filter_map(|r| r.try_get("task_item_id").ok())
            .collect();
        Ok(ArticleTaskChecksDto {
            learner_id: learner_id.to_string(),
            step_id,
            checked_item_ids,
        })
    }

    async fn toggle_task_check(
        &self,
        learner_id: &str,
        step_id: Uuid,
        task_item_id: &str,
        checked: bool,
    ) -> Result<ArticleTaskChecksDto> {
        let clean_item: String = task_item_id.trim().chars().take(80).collect();
        if !clean_item.is_empty() {
            if checked {
                sqlx::query(
                    r#"
                    INSERT INTO learner_task_checks (learner_id, step_id, task_item_id)
                    VALUES ($1, $2, $3)
                    ON CONFLICT DO NOTHING
                    "#,
                )
                .bind(learner_id)
                .bind(step_id)
                .bind(&clean_item)
                .execute(&self.pool)
                .await?;
            } else {
                sqlx::query(
                    r#"
                    DELETE FROM learner_task_checks
                    WHERE learner_id = $1 AND step_id = $2 AND task_item_id = $3
                    "#,
                )
                .bind(learner_id)
                .bind(step_id)
                .bind(&clean_item)
                .execute(&self.pool)
                .await?;
            }
        }
        self.get_task_checks(learner_id, step_id).await
    }

    async fn like_step(&self, step_id: Uuid) -> Result<i64> {
        let row = sqlx::query(
            "UPDATE steps SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count",
        )
        .bind(step_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get("likes_count")?)
    }

    async fn list_margin_notes(
        &self,
        step_id: Uuid,
        learner_id: &str,
    ) -> Result<Vec<UserMarginNoteDto>> {
        let rows = sqlx::query(
            r#"
            SELECT id, learner_id, step_id, locale_code, block_anchor_id, note_color, content_html, raw_content, created_at
            FROM user_margin_notes
            WHERE step_id = $1 AND learner_id = $2
            ORDER BY created_at ASC
            "#,
        )
        .bind(step_id)
        .bind(learner_id)
        .fetch_all(&self.pool)
        .await?;

        let mut notes = Vec::with_capacity(rows.len());
        for r in rows {
            notes.push(UserMarginNoteDto {
                id: r.try_get("id")?,
                learner_id: r.try_get("learner_id")?,
                step_id: r.try_get("step_id")?,
                locale_code: r.try_get("locale_code")?,
                block_anchor_id: r.try_get("block_anchor_id")?,
                note_color: r.try_get("note_color")?,
                content_html: r.try_get("content_html")?,
                raw_content: r.try_get("raw_content")?,
                created_at: r.try_get("created_at")?,
            });
        }
        Ok(notes)
    }

    async fn create_margin_note(&self, input: CreateMarginNoteInput) -> Result<UserMarginNoteDto> {
        let content_html = sanitize_user_note(&input.content);
        let id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO user_margin_notes (id, learner_id, step_id, locale_code, block_anchor_id, note_color, raw_content, content_html, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
        )
        .bind(id)
        .bind(&input.learner_id)
        .bind(input.step_id)
        .bind(&input.locale_code)
        .bind(&input.block_anchor_id)
        .bind(&input.note_color)
        .bind(&input.content)
        .bind(&content_html)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(UserMarginNoteDto {
            id,
            learner_id: input.learner_id,
            step_id: input.step_id,
            locale_code: input.locale_code,
            block_anchor_id: input.block_anchor_id,
            note_color: input.note_color,
            content_html,
            raw_content: input.content,
            created_at: now,
        })
    }

    async fn delete_margin_note(&self, note_id: Uuid, learner_id: &str) -> Result<bool> {
        let res = sqlx::query("DELETE FROM user_margin_notes WHERE id = $1 AND learner_id = $2")
            .bind(note_id)
            .bind(learner_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn sync_bundle(&self, bundle: &ContentBundle) -> Result<usize> {
        let mut tx = self.pool.begin().await?;
        let mut upserted_translations = 0usize;

        for track in &bundle.tracks {
            sqlx::query(
                r#"
                INSERT INTO tracks (id, slug, difficulty, icon_kind, tags, sort_order, is_published)
                VALUES ($1, $2, $3, $4, $5, $6, TRUE)
                ON CONFLICT (slug) DO UPDATE
                SET difficulty = EXCLUDED.difficulty,
                    icon_kind = EXCLUDED.icon_kind,
                    tags = EXCLUDED.tags,
                    sort_order = EXCLUDED.sort_order
                "#,
            )
            .bind(track.id)
            .bind(&track.manifest.slug)
            .bind(&track.manifest.difficulty)
            .bind(&track.manifest.icon_kind)
            .bind(&track.manifest.tags)
            .bind(track.manifest.sort_order)
            .execute(&mut *tx)
            .await?;

            for (loc, meta) in &track.manifest.translations {
                sqlx::query(
                    r#"
                    INSERT INTO track_translations (track_id, locale_code, title, subtitle, description)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (track_id, locale_code) DO UPDATE
                    SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, description = EXCLUDED.description
                    "#,
                )
                .bind(track.id)
                .bind(loc)
                .bind(&meta.title)
                .bind(&meta.subtitle)
                .bind(&meta.description)
                .execute(&mut *tx)
                .await?;
            }

            for ch in &track.chapters {
                sqlx::query(
                    r#"
                    INSERT INTO chapters (id, track_id, slug, chapter_number)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (track_id, slug) DO UPDATE
                    SET chapter_number = EXCLUDED.chapter_number
                    "#,
                )
                .bind(ch.id)
                .bind(track.id)
                .bind(&ch.slug)
                .bind(ch.number)
                .execute(&mut *tx)
                .await?;

                for (loc, title) in &ch.titles {
                    sqlx::query(
                        r#"
                        INSERT INTO chapter_translations (chapter_id, locale_code, title)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (chapter_id, locale_code) DO UPDATE SET title = EXCLUDED.title
                        "#,
                    )
                    .bind(ch.id)
                    .bind(loc)
                    .bind(title)
                    .execute(&mut *tx)
                    .await?;
                }

                for step in &ch.steps {
                    sqlx::query(
                        r#"
                        INSERT INTO steps (id, chapter_id, slug, step_number, default_locale, canonical_revision, estimated_minutes, likes_count)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (chapter_id, slug) DO UPDATE
                        SET step_number = EXCLUDED.step_number,
                            default_locale = EXCLUDED.default_locale,
                            canonical_revision = EXCLUDED.canonical_revision,
                            estimated_minutes = EXCLUDED.estimated_minutes
                        "#,
                    )
                    .bind(step.id)
                    .bind(ch.id)
                    .bind(&step.slug)
                    .bind(step.step_number)
                    .bind(&step.default_locale)
                    .bind(step.canonical_revision)
                    .bind(step.estimated_minutes)
                    .bind(step.initial_likes)
                    .execute(&mut *tx)
                    .await?;

                    for tr in step.translations.values() {
                        let blocks_json = serde_json::to_value(&tr.compiled.blocks)?;
                        let toc_json = serde_json::to_value(&tr.compiled.toc)?;
                        let status_val = if tr.compiled.frontmatter.status == "draft" {
                            "draft"
                        } else {
                            "published"
                        };
                        let clean_license = icehandnote_core::normalize_license_code(
                            &tr.compiled.frontmatter.license,
                        );
                        sqlx::query(
                            r#"
                            INSERT INTO step_translations (
                                step_id, locale_code, title, summary, license, tags, raw_markdown,
                                compiled_blocks, toc_tree, plain_text, synced_revision, status, updated_at
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                            ON CONFLICT (step_id, locale_code) DO UPDATE
                            SET title = EXCLUDED.title,
                                summary = EXCLUDED.summary,
                                license = EXCLUDED.license,
                                tags = EXCLUDED.tags,
                                raw_markdown = EXCLUDED.raw_markdown,
                                compiled_blocks = EXCLUDED.compiled_blocks,
                                toc_tree = EXCLUDED.toc_tree,
                                plain_text = EXCLUDED.plain_text,
                                synced_revision = EXCLUDED.synced_revision,
                                status = EXCLUDED.status,
                                updated_at = EXCLUDED.updated_at
                            "#,
                        )
                        .bind(step.id)
                        .bind(&tr.locale)
                        .bind(&tr.compiled.frontmatter.title)
                        .bind(&tr.compiled.frontmatter.summary)
                        .bind(&clean_license)
                        .bind(&tr.compiled.frontmatter.tags)
                        .bind(&tr.raw_markdown)
                        .bind(blocks_json)
                        .bind(toc_json)
                        .bind(&tr.compiled.plain_text)
                        .bind(tr.compiled.frontmatter.synced_revision)
                        .bind(status_val)
                        .bind(tr.updated_at)
                        .execute(&mut *tx)
                        .await?;

                        upserted_translations += 1;
                    }
                }
            }
        }

        tx.commit().await?;
        Ok(upserted_translations)
    }

    async fn upsert_blog_user(&self, claims: &BlogSsoClaims) -> Result<UserProfileDto> {
        let wp_role = UserRole::from_wordpress_roles(&claims.wp_roles);
        let mut tx = self.pool.begin().await?;

        // 1) Already linked by WordPress user ID → refresh profile, keep the higher role
        // 2) Otherwise link an existing *unlinked* local account with the same email
        // 3) Otherwise create a new account (de-duplicating the username)
        let linked: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE wp_user_id = $1")
            .bind(claims.wp_user_id)
            .fetch_optional(&mut *tx)
            .await?;
        let by_email: Option<Uuid> = if linked.is_none() && !claims.email.trim().is_empty() {
            sqlx::query_scalar(
                "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND wp_user_id IS NULL",
            )
            .bind(&claims.email)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            None
        };

        let row = if let Some(id) = linked.or(by_email) {
            sqlx::query(
                r#"
                UPDATE users
                SET wp_user_id = $2,
                    display_name = $3,
                    avatar_url = CASE WHEN $4 <> '' THEN $4 ELSE avatar_url END,
                    role = CASE
                        WHEN role = 'admin' OR $5 = 'admin' THEN 'admin'
                        WHEN role = 'author' OR $5 = 'author' THEN 'author'
                        ELSE 'reader'
                    END,
                    last_login_at = NOW()
                WHERE id = $1
                RETURNING id, wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, last_login_at
                "#,
            )
            .bind(id)
            .bind(claims.wp_user_id)
            .bind(&claims.display_name)
            .bind(&claims.avatar_url)
            .bind(wp_role.as_str())
            .fetch_one(&mut *tx)
            .await?
        } else {
            let taken: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(username) = LOWER($1))")
                    .bind(&claims.username)
                    .fetch_one(&mut *tx)
                    .await?;
            let username = if taken {
                format!("{}_wp{}", claims.username, claims.wp_user_id)
            } else {
                claims.username.clone()
            };
            let email = if claims.email.trim().is_empty() {
                format!("wp-{}@users.sso.invalid", claims.wp_user_id)
            } else {
                claims.email.clone()
            };
            let source_host = claims
                .blog_origin
                .trim()
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap_or("")
                .trim();
            let auth_source = if source_host.is_empty() {
                "external-sso".to_string()
            } else {
                source_host.chars().take(32).collect()
            };
            let bio = if source_host.is_empty() {
                "外部 SSO 同步账号".to_string()
            } else {
                format!("同步自 {source_host} 账号")
            };
            sqlx::query(
                r#"
                INSERT INTO users (wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, last_login_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                RETURNING id, wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, last_login_at
                "#,
            )
            .bind(claims.wp_user_id)
            .bind(&username)
            .bind(&claims.display_name)
            .bind(&email)
            .bind(&claims.avatar_url)
            .bind(&bio)
            .bind(wp_role.as_str())
            .bind(&auth_source)
            .fetch_one(&mut *tx)
            .await?
        };

        tx.commit().await?;
        Self::row_to_user(&row)
    }

    async fn authenticate_password(
        &self,
        identifier: &str,
        password: &str,
    ) -> Result<Option<UserProfileDto>> {
        let ident = identifier.trim().to_ascii_lowercase();
        let row_opt = sqlx::query(
            r#"
            SELECT id, wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, last_login_at, password_hash
            FROM users
            WHERE LOWER(username) = $1 OR LOWER(email) = $1
            LIMIT 1
            "#,
        )
        .bind(&ident)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row_opt else {
            return Ok(None);
        };
        let pw_hash: Option<String> = row.try_get("password_hash")?;
        let username: String = row.try_get("username")?;
        let Some(expected) = pw_hash else {
            return Ok(None);
        };
        if !verify_password(&username, password, &expected) {
            return Ok(None);
        }

        let user_id: Uuid = row.try_get("id")?;
        let _ = sqlx::query("UPDATE users SET last_login_at = NOW() WHERE id = $1")
            .bind(user_id)
            .execute(&self.pool)
            .await;

        Ok(Some(Self::row_to_user(&row)?))
    }

    async fn create_session(&self, user_id: Uuid) -> Result<String> {
        let (raw, hashed, expires_at) = generate_raw_session_token();
        sqlx::query(
            "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        )
        .bind(&hashed)
        .bind(user_id)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(raw)
    }

    async fn get_user_by_session(&self, raw_token: &str) -> Result<Option<UserProfileDto>> {
        let hashed = hash_session_token(raw_token);
        let row_opt = sqlx::query(
            r#"
            SELECT u.id, u.wp_user_id, u.username, u.display_name, u.email, u.avatar_url, u.bio, u.role, u.auth_source, u.last_login_at
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > NOW()
            LIMIT 1
            "#,
        )
        .bind(&hashed)
        .fetch_optional(&self.pool)
        .await?;

        match row_opt {
            Some(r) => Ok(Some(Self::row_to_user(&r)?)),
            None => Ok(None),
        }
    }

    async fn delete_session(&self, raw_token: &str) -> Result<()> {
        let hashed = hash_session_token(raw_token);
        sqlx::query("DELETE FROM user_sessions WHERE token_hash = $1")
            .bind(&hashed)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn merge_anonymous_learner(&self, anon_id: &str, user_learner_id: &str) -> Result<()> {
        if anon_id.trim().is_empty() || anon_id == user_learner_id {
            return Ok(());
        }
        sqlx::query(
            r#"
            INSERT INTO learner_step_progress (learner_id, step_id, completed_at)
            SELECT $2, step_id, completed_at FROM learner_step_progress WHERE learner_id = $1
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(anon_id)
        .bind(user_learner_id)
        .execute(&self.pool)
        .await?;

        sqlx::query("UPDATE user_margin_notes SET learner_id = $2 WHERE learner_id = $1")
            .bind(anon_id)
            .bind(user_learner_id)
            .execute(&self.pool)
            .await?;

        sqlx::query(
            r#"
            INSERT INTO learner_task_checks (learner_id, step_id, task_item_id, checked_at)
            SELECT $2, step_id, task_item_id, checked_at
            FROM learner_task_checks
            WHERE learner_id = $1
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(anon_id)
        .bind(user_learner_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn studio_list_tracks(&self, locale: &str) -> Result<Vec<StudioTrackDto>> {
        let t_rows = sqlx::query(
            r#"
            SELECT t.id, t.slug, t.difficulty, t.icon_kind, t.is_published,
                   COALESCE(tt_req.title, tt_def.title, t.slug) AS title
            FROM tracks t
            LEFT JOIN track_translations tt_req ON tt_req.track_id = t.id AND tt_req.locale_code = $1
            LEFT JOIN track_translations tt_def ON tt_def.track_id = t.id AND tt_def.locale_code = 'zh-CN'
            ORDER BY t.sort_order ASC, t.slug ASC
            "#,
        )
        .bind(locale)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::new();
        for tr in t_rows {
            let track_id: Uuid = tr.try_get("id")?;
            let c_rows = sqlx::query(
                r#"
                SELECT c.id, c.slug, c.chapter_number,
                       COALESCE(ct_req.title, ct_def.title, c.slug) AS title
                FROM chapters c
                LEFT JOIN chapter_translations ct_req ON ct_req.chapter_id = c.id AND ct_req.locale_code = $2
                LEFT JOIN chapter_translations ct_def ON ct_def.chapter_id = c.id AND ct_def.locale_code = 'zh-CN'
                WHERE c.track_id = $1
                ORDER BY c.chapter_number ASC
                "#,
            )
            .bind(track_id)
            .bind(locale)
            .fetch_all(&self.pool)
            .await?;

            let mut chapters = Vec::new();
            for cr in c_rows {
                let ch_id: Uuid = cr.try_get("id")?;
                let s_rows = sqlx::query(
                    r#"
                    SELECT s.id, s.slug, s.step_number, s.canonical_revision, s.estimated_minutes,
                           COALESCE(st_req.title, st_def.title, s.slug) AS title
                    FROM steps s
                    LEFT JOIN step_translations st_req ON st_req.step_id = s.id AND st_req.locale_code = $2
                    LEFT JOIN step_translations st_def ON st_def.step_id = s.id AND st_def.locale_code = s.default_locale
                    WHERE s.chapter_id = $1
                    ORDER BY s.step_number ASC, s.slug ASC
                    "#,
                )
                .bind(ch_id)
                .bind(locale)
                .fetch_all(&self.pool)
                .await?;

                let mut steps = Vec::new();
                for sr in s_rows {
                    let s_id: Uuid = sr.try_get("id")?;
                    let b_rows = sqlx::query(
                        "SELECT locale_code, status, synced_revision, updated_at FROM step_translations WHERE step_id = $1 ORDER BY locale_code ASC",
                    )
                    .bind(s_id)
                    .fetch_all(&self.pool)
                    .await?;

                    let translations = b_rows
                        .into_iter()
                        .filter_map(|br| {
                            Some(StudioLocaleBadgeDto {
                                locale: br.try_get("locale_code").ok()?,
                                status: br.try_get("status").ok()?,
                                synced_revision: br.try_get("synced_revision").ok()?,
                                updated_at: br.try_get("updated_at").ok()?,
                            })
                        })
                        .collect();

                    steps.push(StudioStepRowDto {
                        step_id: s_id,
                        slug: sr.try_get("slug")?,
                        step_number: sr.try_get("step_number")?,
                        title: sr.try_get("title")?,
                        canonical_revision: sr.try_get("canonical_revision")?,
                        estimated_minutes: sr.try_get("estimated_minutes")?,
                        translations,
                    });
                }

                chapters.push(StudioChapterDto {
                    chapter_id: ch_id,
                    slug: cr.try_get("slug")?,
                    number: cr.try_get("chapter_number")?,
                    title: cr.try_get("title")?,
                    steps,
                });
            }

            out.push(StudioTrackDto {
                track_id,
                slug: tr.try_get("slug")?,
                title: tr.try_get("title")?,
                difficulty: tr.try_get("difficulty")?,
                icon_kind: tr.try_get("icon_kind")?,
                is_published: tr.try_get("is_published")?,
                chapters,
            });
        }
        Ok(out)
    }

    async fn studio_get_step_editor(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<StudioStepEditorDto> {
        let step_row = sqlx::query(
            r#"
            SELECT s.id, s.step_number, s.estimated_minutes, s.canonical_revision, s.default_locale
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id AND c.slug = $2
            JOIN tracks t ON t.id = c.track_id AND t.slug = $1
            WHERE s.slug = $3
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .fetch_optional(&self.pool)
        .await?;

        let Some(sr) = step_row else {
            return Ok(StudioStepEditorDto {
                track_slug: track_slug.to_string(),
                chapter_slug: chapter_slug.to_string(),
                step_slug: step_slug.to_string(),
                locale: locale.to_string(),
                exists: false,
                title: String::new(),
                summary: String::new(),
                step_number: 1,
                estimated_minutes: 10,
                synced_revision: 1,
                canonical_revision: 1,
                status: "published".to_string(),
                license: String::new(),
                tags: Vec::new(),
                body_markdown: String::new(),
            });
        };

        let step_id: Uuid = sr.try_get("id")?;
        let step_number: i32 = sr.try_get("step_number")?;
        let estimated_minutes: i32 = sr.try_get("estimated_minutes")?;
        let canonical_revision: i32 = sr.try_get("canonical_revision")?;
        let default_locale: String = sr.try_get("default_locale")?;

        let tr_opt = sqlx::query(
            "SELECT title, summary, license, tags, raw_markdown, synced_revision, status FROM step_translations WHERE step_id = $1 AND locale_code = $2",
        )
        .bind(step_id)
        .bind(locale)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(tr) = tr_opt {
            let raw: String = tr.try_get("raw_markdown")?;
            let raw_lic: String = tr.try_get("license").unwrap_or_default();
            return Ok(StudioStepEditorDto {
                track_slug: track_slug.to_string(),
                chapter_slug: chapter_slug.to_string(),
                step_slug: step_slug.to_string(),
                locale: locale.to_string(),
                exists: true,
                title: tr.try_get("title")?,
                summary: tr.try_get("summary")?,
                step_number,
                estimated_minutes,
                synced_revision: tr.try_get("synced_revision")?,
                canonical_revision,
                status: tr.try_get("status")?,
                license: icehandnote_core::normalize_license_code(&raw_lic),
                tags: tr.try_get("tags")?,
                body_markdown: extract_body_without_frontmatter(&raw),
            });
        }

        // Prefill license & tags from canonical locale when creating a new translation
        let fallback_tr = sqlx::query(
            "SELECT license, tags, raw_markdown FROM step_translations WHERE step_id = $1 ORDER BY CASE WHEN locale_code = $2 THEN 0 ELSE 1 END, locale_code LIMIT 1",
        )
        .bind(step_id)
        .bind(&default_locale)
        .fetch_optional(&self.pool)
        .await?;

        let (prefill_license, prefill_tags, prefill_body) = if let Some(fb) = fallback_tr {
            let lic: String = fb.try_get("license").unwrap_or_default();
            let tgs: Vec<String> = fb.try_get("tags").unwrap_or_default();
            let raw: String = fb.try_get("raw_markdown").unwrap_or_default();
            (
                icehandnote_core::normalize_license_code(&lic),
                tgs,
                extract_body_without_frontmatter(&raw),
            )
        } else {
            (String::new(), Vec::new(), String::new())
        };

        Ok(StudioStepEditorDto {
            track_slug: track_slug.to_string(),
            chapter_slug: chapter_slug.to_string(),
            step_slug: step_slug.to_string(),
            locale: locale.to_string(),
            exists: false,
            title: String::new(),
            summary: String::new(),
            step_number,
            estimated_minutes,
            synced_revision: canonical_revision,
            canonical_revision,
            status: "draft".to_string(),
            license: prefill_license,
            tags: prefill_tags,
            body_markdown: prefill_body,
        })
    }

    async fn studio_save_step(
        &self,
        author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
    ) -> Result<StudioStepEditorDto> {
        let ch_row = sqlx::query(
            "SELECT c.id FROM chapters c JOIN tracks t ON t.id = c.track_id WHERE t.slug = $1 AND c.slug = $2",
        )
        .bind(&input.track_slug)
        .bind(&input.chapter_slug)
        .fetch_one(&self.pool)
        .await?;
        let ch_id: Uuid = ch_row.try_get("id")?;

        let existing_step = sqlx::query("SELECT id, canonical_revision FROM steps WHERE chapter_id = $1 AND slug = $2")
            .bind(ch_id)
            .bind(&input.step_slug)
            .fetch_optional(&self.pool)
            .await?;

        let (step_id, next_canonical) = if let Some(sr) = existing_step {
            let sid: Uuid = sr.try_get("id")?;
            let crev: i32 = sr.try_get("canonical_revision")?;
            let next_c = if input.bump_canonical { crev + 1 } else { crev.max(input.synced_revision) };
            sqlx::query("UPDATE steps SET step_number = $2, estimated_minutes = $3, canonical_revision = $4 WHERE id = $1")
                .bind(sid)
                .bind(input.step_number)
                .bind(input.estimated_minutes)
                .bind(next_c)
                .execute(&self.pool)
                .await?;
            (sid, next_c)
        } else {
            let sid = deterministic_uuid(&format!("step:{}:{}:{}", input.track_slug, input.chapter_slug, input.step_slug));
            let next_c = input.synced_revision.max(1);
            sqlx::query(
                "INSERT INTO steps (id, chapter_id, slug, step_number, default_locale, canonical_revision, estimated_minutes) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(sid)
            .bind(ch_id)
            .bind(&input.step_slug)
            .bind(input.step_number)
            .bind(&input.locale)
            .bind(next_c)
            .bind(input.estimated_minutes)
            .execute(&self.pool)
            .await?;
            (sid, next_c)
        };

        let next_synced = if input.bump_canonical { next_canonical } else { input.synced_revision.max(1) };
        let clean_status = if input.status == "draft" { "draft" } else { "published" };
        let clean_license = icehandnote_core::normalize_license_code(&input.license);

        let raw_md = format_step_markdown_file(
            &input.title,
            &input.summary,
            input.step_number,
            input.estimated_minutes,
            next_synced,
            next_canonical,
            clean_status,
            &clean_license,
            &input.tags,
            &input.body_markdown,
        );
        let compiled = compile_notebook_markdown(&raw_md);
        let blocks_json = serde_json::to_value(&compiled.blocks)?;
        let toc_json = serde_json::to_value(&compiled.toc)?;

        sqlx::query(
            r#"
            INSERT INTO step_translations (
                step_id, locale_code, title, summary, license, tags, raw_markdown,
                compiled_blocks, toc_tree, plain_text, synced_revision, status, author_id, author_name, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
            ON CONFLICT (step_id, locale_code) DO UPDATE
            SET title = EXCLUDED.title,
                summary = EXCLUDED.summary,
                license = EXCLUDED.license,
                tags = EXCLUDED.tags,
                raw_markdown = EXCLUDED.raw_markdown,
                compiled_blocks = EXCLUDED.compiled_blocks,
                toc_tree = EXCLUDED.toc_tree,
                plain_text = EXCLUDED.plain_text,
                synced_revision = EXCLUDED.synced_revision,
                status = EXCLUDED.status,
                author_id = EXCLUDED.author_id,
                author_name = EXCLUDED.author_name,
                updated_at = NOW()
            "#,
        )
        .bind(step_id)
        .bind(&input.locale)
        .bind(&input.title)
        .bind(&input.summary)
        .bind(&clean_license)
        .bind(&input.tags)
        .bind(&raw_md)
        .bind(blocks_json)
        .bind(toc_json)
        .bind(&compiled.plain_text)
        .bind(next_synced)
        .bind(clean_status)
        .bind(author.id)
        .bind(&author.display_name)
        .execute(&self.pool)
        .await?;

        if input.write_to_content_dir {
            let ch_dir = content_dir.join(&input.track_slug).join(&input.chapter_slug);
            let _ = fs::create_dir_all(&ch_dir);
            let _ = fs::write(
                ch_dir.join(format!("{}.{}.md", input.step_slug, input.locale)),
                &raw_md,
            );
        }

        self.studio_get_step_editor(&input.track_slug, &input.chapter_slug, &input.step_slug, &input.locale)
            .await
    }

    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> Result<StudioTrackDto> {
        let track_id = deterministic_uuid(&format!("track:{}", input.slug));
        sqlx::query(
            "INSERT INTO tracks (id, slug, difficulty, icon_kind, tags, is_published) VALUES ($1, $2, $3, $4, $5, TRUE)",
        )
        .bind(track_id)
        .bind(&input.slug)
        .bind(&input.difficulty)
        .bind(&input.icon_kind)
        .bind(&input.tags)
        .execute(&self.pool)
        .await?;

        for loc in ["zh-CN", "en", "zh-TW", "ja"] {
            sqlx::query(
                "INSERT INTO track_translations (track_id, locale_code, title, subtitle, description) VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(track_id)
            .bind(loc)
            .bind(&input.title_zh_tw)
            .bind(&input.subtitle_zh_tw)
            .bind(&input.description_zh_tw)
            .execute(&self.pool)
            .await?;
        }

        let ch_slug = if input.first_chapter_slug.trim().is_empty() {
            "01-getting-started".to_string()
        } else {
            input.first_chapter_slug.clone()
        };
        self.studio_create_chapter(
            CreateChapterInput {
                track_slug: input.slug.clone(),
                slug: ch_slug,
                number: 1,
                title_zh_tw: input.first_chapter_title,
            },
            content_dir,
        )
        .await?;

        let all = self.studio_list_tracks("zh-CN").await?;
        Ok(all.into_iter().find(|t| t.slug == input.slug).unwrap())
    }

    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        _content_dir: &Path,
    ) -> Result<()> {
        let trow = sqlx::query("SELECT id FROM tracks WHERE slug = $1")
            .bind(&input.track_slug)
            .fetch_one(&self.pool)
            .await?;
        let track_id: Uuid = trow.try_get("id")?;
        let ch_id = deterministic_uuid(&format!("chapter:{}:{}", input.track_slug, input.slug));

        sqlx::query("INSERT INTO chapters (id, track_id, slug, chapter_number) VALUES ($1, $2, $3, $4)")
            .bind(ch_id)
            .bind(track_id)
            .bind(&input.slug)
            .bind(input.number)
            .execute(&self.pool)
            .await?;

        for loc in ["zh-CN", "en", "zh-TW", "ja"] {
            sqlx::query("INSERT INTO chapter_translations (chapter_id, locale_code, title) VALUES ($1, $2, $3)")
                .bind(ch_id)
                .bind(loc)
                .bind(&input.title_zh_tw)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    async fn studio_delete_step(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> Result<bool> {
        let res = sqlx::query(
            r#"
            DELETE FROM steps s
            USING chapters c, tracks t
            WHERE s.chapter_id = c.id AND c.track_id = t.id
              AND t.slug = $1 AND c.slug = $2 AND s.slug = $3
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .execute(&self.pool)
        .await?;

        let ch_dir = content_dir.join(track_slug).join(chapter_slug);
        if ch_dir.exists() {
            if let Ok(entries) = fs::read_dir(&ch_dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.starts_with(&format!("{step_slug}.")) && name.ends_with(".md") {
                            let _ = fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
        Ok(res.rows_affected() > 0)
    }

    async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto> {
        PostgresRepository::upsert_local_account(self, username, display_name, email, role, password)
            .await
    }

    async fn admin_list_users(&self) -> Result<Vec<UserProfileDto>> {
        let rows = sqlx::query(
            "SELECT id, wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, last_login_at FROM users ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut list = Vec::with_capacity(rows.len());
        for r in rows {
            list.push(Self::row_to_user(&r)?);
        }
        Ok(list)
    }

    async fn admin_update_user_role(
        &self,
        target_user_id: Uuid,
        new_role: UserRole,
    ) -> Result<Option<UserProfileDto>> {
        let row_opt = sqlx::query(
            r#"
            UPDATE users
            SET role = $2
            WHERE id = $1
            RETURNING id, wp_user_id, username, display_name, email, avatar_url, bio, role, auth_source, last_login_at
            "#,
        )
        .bind(target_user_id)
        .bind(new_role.as_str())
        .fetch_optional(&self.pool)
        .await?;

        match row_opt {
            Some(r) => Ok(Some(Self::row_to_user(&r)?)),
            None => Ok(None),
        }
    }

    async fn get_site_settings(&self, fallback: &SiteSettingsDto) -> Result<SiteSettingsDto> {
        let row_opt = sqlx::query("SELECT settings FROM site_settings WHERE id = 1")
            .fetch_optional(&self.pool)
            .await?;

        if let Some(row) = row_opt {
            let val: serde_json::Value = row.try_get("settings")?;
            if let Ok(parsed) = serde_json::from_value::<SiteSettingsDto>(val) {
                return Ok(parsed);
            }
        }

        // Seed initial defaults on first read so DB immediately holds a canonical row
        let initial = fallback.clone();
        let json_val = serde_json::to_value(&initial)?;
        sqlx::query(
            r#"
            INSERT INTO site_settings (id, settings, updated_at)
            VALUES (1, $1, NOW())
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(json_val)
        .execute(&self.pool)
        .await?;

        Ok(initial)
    }

    async fn update_site_settings(
        &self,
        updated_by: Uuid,
        settings: SiteSettingsDto,
    ) -> Result<SiteSettingsDto> {
        let clean = settings.sanitize()?;
        let json_val = serde_json::to_value(&clean)?;
        sqlx::query(
            r#"
            INSERT INTO site_settings (id, settings, updated_at, updated_by)
            VALUES (1, $1, NOW(), $2)
            ON CONFLICT (id) DO UPDATE
            SET settings = EXCLUDED.settings,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
            "#,
        )
        .bind(json_val)
        .bind(updated_by)
        .execute(&self.pool)
        .await?;

        Ok(clean)
    }
}

// ============================================================================
// 2. Local Seed & Persistent File Repository (Zero-daemon local fallback)
// ============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PersistedUserState {
    #[serde(default)]
    progress: HashMap<String, HashSet<Uuid>>,
    #[serde(default)]
    task_checks: HashMap<String, HashMap<Uuid, HashSet<String>>>,
    #[serde(default)]
    notes: Vec<UserMarginNoteDto>,
    #[serde(default)]
    likes_delta: HashMap<Uuid, i64>,
    #[serde(default)]
    users: Vec<StoredUserRecord>,
    #[serde(default)]
    sessions: Vec<StoredSessionRecord>,
    #[serde(default)]
    site_settings: Option<SiteSettingsDto>,
}

pub struct LocalSeedRepository {
    bundle: RwLock<ContentBundle>,
    state: RwLock<PersistedUserState>,
    store_path: PathBuf,
}

impl LocalSeedRepository {
    pub fn from_content_dir(content_dir: &Path, store_path: PathBuf) -> Result<Self> {
        Self::from_content_dir_with_options(content_dir, store_path, false)
    }

    pub fn from_content_dir_with_options(
        content_dir: &Path,
        store_path: PathBuf,
        seed_demo_users: bool,
    ) -> Result<Self> {
        let bundle = load_content_directory(content_dir)?;
        let mut state: PersistedUserState = if store_path.exists() {
            fs::read_to_string(&store_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            PersistedUserState::default()
        };

        if seed_demo_users && state.users.is_empty() {
            state.users = default_seeded_blog_users();
        }

        let repo = Self {
            bundle: RwLock::new(bundle),
            state: RwLock::new(state),
            store_path,
        };
        Ok(repo)
    }

    fn persist_state(&self, state: &PersistedUserState) {
        if let Some(parent) = self.store_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = fs::write(&self.store_path, json);
        }
    }

    fn resolve_track_meta<'a>(track: &'a LoadedTrack, locale: &str) -> (&'a str, &'a str, &'a str) {
        if let Some(m) = track
            .manifest
            .translations
            .get(locale)
            .or_else(|| track.manifest.translations.get("zh-CN"))
            .or_else(|| track.manifest.translations.get("en"))
            .or_else(|| track.manifest.translations.values().next())
        {
            (&m.title, &m.subtitle, &m.description)
        } else {
            (&track.manifest.slug, "", "")
        }
    }
}

fn is_published(tr: &content_loader::LoadedStepTranslation) -> bool {
    tr.compiled.frontmatter.status != "draft"
}

fn step_has_published(step: &content_loader::LoadedStep) -> bool {
    step.translations.values().any(is_published)
}

/// Pick the best *published* translation: requested locale → step default → any published.
fn pick_published<'a>(
    step: &'a content_loader::LoadedStep,
    locale: &str,
) -> Option<&'a content_loader::LoadedStepTranslation> {
    step.translations
        .get(locale)
        .filter(|t| is_published(t))
        .or_else(|| step.translations.get(&step.default_locale).filter(|t| is_published(t)))
        .or_else(|| step.translations.values().find(|t| is_published(t)))
}

#[async_trait]
impl TutorialRepository for LocalSeedRepository {
    fn backend_kind(&self) -> &'static str {
        "local-content-seed"
    }

    async fn list_tracks(&self, locale: &str) -> Result<Vec<TrackSummaryDto>> {
        let bundle = self.bundle.read().await;
        let mut out = Vec::new();

        for t in &bundle.tracks {
            let (title, subtitle, description) = Self::resolve_track_meta(t, locale);
            let step_count: usize = t
                .chapters
                .iter()
                .map(|c| c.steps.iter().filter(|s| step_has_published(s)).count())
                .sum();
            let first_ch = t.chapters.first();
            let first_st = first_ch.and_then(|c| c.steps.iter().find(|s| step_has_published(s)));

            out.push(TrackSummaryDto {
                id: t.id,
                slug: t.manifest.slug.clone(),
                difficulty: t.manifest.difficulty.clone(),
                icon_kind: t.manifest.icon_kind.clone(),
                title: title.to_string(),
                subtitle: subtitle.to_string(),
                description: description.to_string(),
                tags: t.manifest.tags.clone(),
                chapter_count: t.chapters.len(),
                step_count,
                first_chapter_slug: first_ch.map(|c| c.slug.clone()).unwrap_or_default(),
                first_step_slug: first_st.map(|s| s.slug.clone()).unwrap_or_default(),
            });
        }
        Ok(out)
    }

    async fn get_step_detail(
        &self,
        locale: &str,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Option<StepDetailDto>> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;

        let Some(track) = bundle.tracks.iter().find(|t| t.manifest.slug == track_slug) else {
            return Ok(None);
        };
        let (track_title, _, _) = Self::resolve_track_meta(track, locale);

        let mut chapters_nav = Vec::new();
        let mut flat_steps: Vec<(String, String, String, Uuid)> = Vec::new();

        for ch in &track.chapters {
            let ch_title = ch
                .titles
                .get(locale)
                .or_else(|| ch.titles.get("zh-CN"))
                .or_else(|| ch.titles.get("en"))
                .or_else(|| ch.titles.values().next())
                .cloned()
                .unwrap_or_else(|| ch.slug.clone());

            let mut nav_steps = Vec::new();
            for s in ch.steps.iter().filter(|s| step_has_published(s)) {
                let tr_req = s.translations.get(locale).filter(|t| is_published(t));
                let tr_any = pick_published(s, locale);
                let s_title = tr_any
                    .map(|tr| tr.compiled.frontmatter.title.clone())
                    .unwrap_or_else(|| s.slug.clone());
                let has_req = tr_req.is_some();
                let has_drift = tr_req
                    .map(|tr| tr.compiled.frontmatter.synced_revision < s.canonical_revision)
                    .unwrap_or(false);

                flat_steps.push((ch.slug.clone(), s.slug.clone(), s_title.clone(), s.id));
                nav_steps.push(StepNavItemDto {
                    id: s.id,
                    slug: s.slug.clone(),
                    step_number: s.step_number,
                    title: s_title,
                    estimated_minutes: s.estimated_minutes,
                    has_requested_locale: has_req,
                    has_revision_drift: has_drift,
                });
            }

            chapters_nav.push(ChapterNavDto {
                slug: ch.slug.clone(),
                number: ch.number,
                title: ch_title,
                steps: nav_steps,
            });
        }

        let Some(ch) = track.chapters.iter().find(|c| c.slug == chapter_slug) else {
            return Ok(None);
        };
        let ch_title = ch
            .titles
            .get(locale)
            .or_else(|| ch.titles.get("zh-CN"))
            .or_else(|| ch.titles.get("en"))
            .cloned()
            .unwrap_or_else(|| ch.slug.clone());

        let Some(step) = ch.steps.iter().find(|s| s.slug == step_slug) else {
            return Ok(None);
        };

        let Some(tr) = pick_published(step, locale) else {
            return Ok(None);
        };

        let current_idx = flat_steps.iter().position(|(_, _, _, id)| *id == step.id);
        let prev_step = current_idx
            .and_then(|i| i.checked_sub(1))
            .and_then(|pi| flat_steps.get(pi))
            .map(|(cs, ss, t, _)| StepNeighborDto {
                chapter_slug: cs.clone(),
                step_slug: ss.clone(),
                title: t.clone(),
            });
        let next_step = current_idx
            .and_then(|i| flat_steps.get(i + 1))
            .map(|(cs, ss, t, _)| StepNeighborDto {
                chapter_slug: cs.clone(),
                step_slug: ss.clone(),
                title: t.clone(),
            });

        let synced_rev = tr.compiled.frontmatter.synced_revision;
        let likes_delta = state.likes_delta.get(&step.id).copied().unwrap_or(0);

        Ok(Some(StepDetailDto {
            step_id: step.id,
            track_slug: track.manifest.slug.clone(),
            track_title: track_title.to_string(),
            chapter_slug: ch.slug.clone(),
            chapter_title: ch_title,
            step_slug: step.slug.clone(),
            step_number: step.step_number,
            total_steps_in_track: flat_steps.len(),
            requested_locale: locale.to_string(),
            resolved_locale: tr.locale.clone(),
            is_fallback: tr.locale != locale,
            available_locales: step
                .translations
                .values()
                .filter(|t| is_published(t))
                .map(|t| t.locale.clone())
                .collect(),
            canonical_revision: step.canonical_revision,
            synced_revision: synced_rev,
            has_revision_drift: synced_rev < step.canonical_revision,
            estimated_minutes: step.estimated_minutes,
            title: tr.compiled.frontmatter.title.clone(),
            summary: tr.compiled.frontmatter.summary.clone(),
            license: icehandnote_core::normalize_license_code(&tr.compiled.frontmatter.license),
            author_name: String::new(),
            tags: tr.compiled.frontmatter.tags.clone(),
            blocks: tr.compiled.blocks.clone(),
            toc: tr.compiled.toc.clone(),
            chapters: chapters_nav,
            prev_step,
            next_step,
            likes_count: step.initial_likes + likes_delta,
            updated_at: tr.updated_at,
        }))
    }

    async fn search(&self, locale: &str, query: &str) -> Result<Vec<SearchHitDto>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let lower_q = q.to_lowercase();
        let bundle = self.bundle.read().await;
        let mut hits = Vec::new();

        for track in &bundle.tracks {
            let (track_title, _, _) = Self::resolve_track_meta(track, locale);
            for ch in &track.chapters {
                for step in &ch.steps {
                    let Some(tr) = pick_published(step, locale) else {
                        continue;
                    };

                    let title_match = tr.compiled.frontmatter.title.to_lowercase().contains(&lower_q);
                    let body_match = tr.compiled.plain_text.to_lowercase().contains(&lower_q);
                    let tag_match = tr
                        .compiled
                        .frontmatter
                        .tags
                        .iter()
                        .any(|tg| tg.to_lowercase().contains(&lower_q));

                    if title_match || body_match || tag_match {
                        hits.push(SearchHitDto {
                            track_slug: track.manifest.slug.clone(),
                            track_title: track_title.to_string(),
                            chapter_slug: ch.slug.clone(),
                            step_slug: step.slug.clone(),
                            locale: tr.locale.clone(),
                            title: tr.compiled.frontmatter.title.clone(),
                            snippet_html: build_highlighted_snippet(&tr.compiled.plain_text, q),
                            tags: tr.compiled.frontmatter.tags.clone(),
                        });
                    }
                }
            }
        }
        hits.truncate(12);
        Ok(hits)
    }

    async fn get_progress(&self, learner_id: &str) -> Result<LearnerProgressDto> {
        let state = self.state.read().await;
        let completed_step_ids = state
            .progress
            .get(learner_id)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default();
        Ok(LearnerProgressDto {
            learner_id: learner_id.to_string(),
            completed_step_ids,
        })
    }

    async fn toggle_step_complete(
        &self,
        learner_id: &str,
        step_id: Uuid,
        completed: bool,
    ) -> Result<LearnerProgressDto> {
        let mut state = self.state.write().await;
        let entry = state.progress.entry(learner_id.to_string()).or_default();
        if completed {
            entry.insert(step_id);
        } else {
            entry.remove(&step_id);
        }
        let ids: Vec<Uuid> = entry.iter().copied().collect();
        self.persist_state(&state);
        Ok(LearnerProgressDto {
            learner_id: learner_id.to_string(),
            completed_step_ids: ids,
        })
    }

    async fn get_task_checks(
        &self,
        learner_id: &str,
        step_id: Uuid,
    ) -> Result<ArticleTaskChecksDto> {
        let state = self.state.read().await;
        let checked_item_ids = state
            .task_checks
            .get(learner_id)
            .and_then(|m| m.get(&step_id))
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        Ok(ArticleTaskChecksDto {
            learner_id: learner_id.to_string(),
            step_id,
            checked_item_ids,
        })
    }

    async fn toggle_task_check(
        &self,
        learner_id: &str,
        step_id: Uuid,
        task_item_id: &str,
        checked: bool,
    ) -> Result<ArticleTaskChecksDto> {
        let clean_item: String = task_item_id.trim().chars().take(80).collect();
        let mut state = self.state.write().await;
        let step_set = state
            .task_checks
            .entry(learner_id.to_string())
            .or_default()
            .entry(step_id)
            .or_default();
        if !clean_item.is_empty() {
            if checked {
                step_set.insert(clean_item);
            } else {
                step_set.remove(&clean_item);
            }
        }
        let ids: Vec<String> = step_set.iter().cloned().collect();
        self.persist_state(&state);
        Ok(ArticleTaskChecksDto {
            learner_id: learner_id.to_string(),
            step_id,
            checked_item_ids: ids,
        })
    }

    async fn like_step(&self, step_id: Uuid) -> Result<i64> {
        let bundle = self.bundle.read().await;
        let base_likes = bundle
            .tracks
            .iter()
            .flat_map(|t| &t.chapters)
            .flat_map(|c| &c.steps)
            .find(|s| s.id == step_id)
            .map(|s| s.initial_likes)
            .unwrap_or(0);
        drop(bundle);

        let mut state = self.state.write().await;
        let delta = state.likes_delta.entry(step_id).or_insert(0);
        *delta += 1;
        let total = base_likes + *delta;
        self.persist_state(&state);
        Ok(total)
    }

    async fn list_margin_notes(
        &self,
        step_id: Uuid,
        learner_id: &str,
    ) -> Result<Vec<UserMarginNoteDto>> {
        let state = self.state.read().await;
        Ok(state
            .notes
            .iter()
            .filter(|n| n.step_id == step_id && n.learner_id == learner_id)
            .cloned()
            .collect())
    }

    async fn create_margin_note(&self, input: CreateMarginNoteInput) -> Result<UserMarginNoteDto> {
        let content_html = sanitize_user_note(&input.content);
        let dto = UserMarginNoteDto {
            id: Uuid::new_v4(),
            learner_id: input.learner_id,
            step_id: input.step_id,
            locale_code: input.locale_code,
            block_anchor_id: input.block_anchor_id,
            note_color: input.note_color,
            content_html,
            raw_content: input.content,
            created_at: Utc::now(),
        };
        let mut state = self.state.write().await;
        state.notes.push(dto.clone());
        self.persist_state(&state);
        Ok(dto)
    }

    async fn delete_margin_note(&self, note_id: Uuid, learner_id: &str) -> Result<bool> {
        let mut state = self.state.write().await;
        let before = state.notes.len();
        state
            .notes
            .retain(|n| !(n.id == note_id && n.learner_id == learner_id));
        let changed = state.notes.len() < before;
        if changed {
            self.persist_state(&state);
        }
        Ok(changed)
    }

    async fn sync_bundle(&self, bundle: &ContentBundle) -> Result<usize> {
        let count: usize = bundle
            .tracks
            .iter()
            .flat_map(|t| &t.chapters)
            .flat_map(|c| &c.steps)
            .map(|s| s.translations.len())
            .sum();
        let mut guard = self.bundle.write().await;
        *guard = bundle.clone();
        Ok(count)
    }

    async fn upsert_blog_user(&self, claims: &BlogSsoClaims) -> Result<UserProfileDto> {
        let mut state = self.state.write().await;
        let profile = upsert_local_blog_user(&mut state.users, claims);
        self.persist_state(&state);
        Ok(profile)
    }

    async fn authenticate_password(
        &self,
        identifier: &str,
        password: &str,
    ) -> Result<Option<UserProfileDto>> {
        let mut state = self.state.write().await;
        let Some(matched) = match_local_user_password(&state.users, identifier, password) else {
            return Ok(None);
        };
        let now = Utc::now();
        if let Some(rec) = state.users.iter_mut().find(|u| u.profile.id == matched.id) {
            rec.profile.last_login_at = now;
        }
        self.persist_state(&state);
        Ok(Some(UserProfileDto {
            last_login_at: now,
            ..matched
        }))
    }

    async fn create_session(&self, user_id: Uuid) -> Result<String> {
        let (raw, token_hash, expires_at) = generate_raw_session_token();
        let mut state = self.state.write().await;
        state.sessions.retain(|s| s.expires_at > Utc::now());
        state.sessions.push(StoredSessionRecord {
            token_hash,
            user_id,
            expires_at,
        });
        self.persist_state(&state);
        Ok(raw)
    }

    async fn get_user_by_session(&self, raw_token: &str) -> Result<Option<UserProfileDto>> {
        let hashed = hash_session_token(raw_token);
        let state = self.state.read().await;
        let now = Utc::now();
        let Some(sess) = state
            .sessions
            .iter()
            .find(|s| s.token_hash == hashed && s.expires_at > now)
        else {
            return Ok(None);
        };
        Ok(state
            .users
            .iter()
            .find(|u| u.profile.id == sess.user_id)
            .map(|u| u.profile.clone()))
    }

    async fn delete_session(&self, raw_token: &str) -> Result<()> {
        let hashed = hash_session_token(raw_token);
        let mut state = self.state.write().await;
        state.sessions.retain(|s| s.token_hash != hashed);
        self.persist_state(&state);
        Ok(())
    }

    async fn merge_anonymous_learner(&self, anon_id: &str, user_learner_id: &str) -> Result<()> {
        if anon_id.trim().is_empty() || anon_id == user_learner_id {
            return Ok(());
        }
        let mut state = self.state.write().await;
        if let Some(anon_steps) = state.progress.get(anon_id).cloned() {
            state
                .progress
                .entry(user_learner_id.to_string())
                .or_default()
                .extend(anon_steps);
        }
        if let Some(anon_tasks) = state.task_checks.get(anon_id).cloned() {
            let target_map = state
                .task_checks
                .entry(user_learner_id.to_string())
                .or_default();
            for (step_id, items) in anon_tasks {
                target_map.entry(step_id).or_default().extend(items);
            }
        }
        for note in &mut state.notes {
            if note.learner_id == anon_id {
                note.learner_id = user_learner_id.to_string();
            }
        }
        self.persist_state(&state);
        Ok(())
    }

    async fn studio_list_tracks(&self, locale: &str) -> Result<Vec<StudioTrackDto>> {
        let bundle = self.bundle.read().await;
        Ok(build_studio_overview_from_bundle(&bundle, locale))
    }

    async fn studio_get_step_editor(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<StudioStepEditorDto> {
        let bundle = self.bundle.read().await;
        Ok(read_step_editor_from_bundle(
            &bundle,
            track_slug,
            chapter_slug,
            step_slug,
            locale,
        ))
    }

    async fn studio_save_step(
        &self,
        _author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
    ) -> Result<StudioStepEditorDto> {
        let mut bundle = self.bundle.write().await;
        apply_save_step_to_bundle_and_disk(&mut bundle, &input, content_dir)
    }

    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> Result<StudioTrackDto> {
        let mut bundle = self.bundle.write().await;
        create_track_in_bundle_and_disk(&mut bundle, &input, content_dir)
    }

    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        content_dir: &Path,
    ) -> Result<()> {
        let mut bundle = self.bundle.write().await;
        create_chapter_in_bundle_and_disk(&mut bundle, &input, content_dir)
    }

    async fn studio_delete_step(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> Result<bool> {
        let mut bundle = self.bundle.write().await;
        delete_step_in_bundle_and_disk(&mut bundle, track_slug, chapter_slug, step_slug, content_dir)
    }

    async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto> {
        let clean_username = username.trim();
        if clean_username.is_empty() {
            anyhow::bail!("Username cannot be empty");
        }
        let clean_display = if display_name.trim().is_empty() {
            clean_username
        } else {
            display_name.trim()
        };
        let clean_email = if email.trim().is_empty() {
            format!("{clean_username}@localhost")
        } else {
            email.trim().to_string()
        };
        let pw_hash = icehandnote_core::auth::hash_password(clean_username, password);
        let now = Utc::now();

        let mut state = self.state.write().await;
        let user_profile = if let Some(existing) = state
            .users
            .iter_mut()
            .find(|u| u.profile.username.eq_ignore_ascii_case(clean_username))
        {
            existing.profile.display_name = clean_display.to_string();
            existing.profile.email = clean_email;
            existing.profile.role = role;
            existing.password_hash = Some(pw_hash);
            let uid = existing.profile.id;
            let prof = existing.profile.clone();
            state.sessions.retain(|s| s.user_id != uid);
            prof
        } else {
            let prof = UserProfileDto {
                id: Uuid::new_v4(),
                wp_user_id: None,
                username: clean_username.to_string(),
                display_name: clean_display.to_string(),
                email: clean_email,
                avatar_url: String::new(),
                bio: String::new(),
                role,
                auth_source: "local".to_string(),
                last_login_at: now,
            };
            state.users.push(StoredUserRecord {
                profile: prof.clone(),
                password_hash: Some(pw_hash),
            });
            prof
        };

        self.persist_state(&state);
        Ok(user_profile)
    }

    async fn admin_list_users(&self) -> Result<Vec<UserProfileDto>> {
        let state = self.state.read().await;
        Ok(state.users.iter().map(|u| u.profile.clone()).collect())
    }

    async fn admin_update_user_role(
        &self,
        target_user_id: Uuid,
        new_role: UserRole,
    ) -> Result<Option<UserProfileDto>> {
        let mut state = self.state.write().await;
        let mut updated = None;
        if let Some(rec) = state
            .users
            .iter_mut()
            .find(|u| u.profile.id == target_user_id)
        {
            rec.profile.role = new_role;
            updated = Some(rec.profile.clone());
        }
        if updated.is_some() {
            self.persist_state(&state);
        }
        Ok(updated)
    }

    async fn get_site_settings(&self, fallback: &SiteSettingsDto) -> Result<SiteSettingsDto> {
        let state = self.state.read().await;
        Ok(state.site_settings.clone().unwrap_or_else(|| fallback.clone()))
    }

    async fn update_site_settings(
        &self,
        _updated_by: Uuid,
        settings: SiteSettingsDto,
    ) -> Result<SiteSettingsDto> {
        let clean = settings.sanitize()?;
        let mut state = self.state.write().await;
        state.site_settings = Some(clean.clone());
        self.persist_state(&state);
        Ok(clean)
    }
}
