use crate::{
    content_loader::{deterministic_uuid, ContentBundle},
    studio_auth::{default_seeded_blog_users, generate_raw_session_token},
    domain_err, TutorialRepository,
};
use anyhow::Result;
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use icehandnote_core::{
    auth::{
        constant_time_str_eq, extract_body_without_frontmatter,
        format_step_markdown_file_with_author, generate_action_token,
        generate_email_verification_code, hash_action_token, hash_email_verification_code,
        hash_password, hash_session_token, normalize_avatar_source, parse_user_agent_device,
        verify_password, ArticleAuthorDto, BlogSsoClaims,
        CollaboratorInviteDto, CreateChapterInput, CreateTrackInput, SaveStudioStepInput,
        SiteSettingsDto, StudioChapterDto, StudioLocaleBadgeDto, StudioStepEditorDto,
        StudioStepRowDto, StudioTrackDto, UpdateUserProfileInput, UserPasskeyDto, UserProfileDto,
        UserRole, UserSessionDto,
    },
    build_highlighted_snippet, compile_notebook_markdown,
    error::{DomainError, ErrorCode},
    reading_time::estimate_reading_minutes, sanitize_user_note,
    webauthn::StoredPasskeyCredential,
    ArticleTaskChecksDto,
    ChapterNavDto, CreateMarginNoteInput, LearnerProgressDto, NotebookBlock, SearchHitDto,
    StepDetailDto, StepNavItemDto, StepNeighborDto, TocItem, TrackSummaryDto, UserMarginNoteDto,
};
use sqlx::{postgres::PgRow, PgPool, Row};
use std::{collections::HashSet, fs, path::Path};
use uuid::Uuid;

const USER_SELECT_COLS: &str = "id, wp_user_id, username, display_name, email, avatar_url, \
    avatar_source, oauth_avatar_url, uploaded_avatar_url, oauth_provider, bio, role, \
    auth_source, is_banned, ban_reason, last_login_at, \
    (password_hash IS NOT NULL AND password_hash <> '') AS has_password, \
    ARRAY(SELECT provider FROM user_oauth_bindings uob WHERE uob.user_id = users.id ORDER BY uob.bound_at ASC) AS oauth_bindings";

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

        for sql in [
            include_str!("../migrations/0001_init_schema.sql"),
            include_str!("../migrations/0002_users_and_studio.sql"),
            include_str!("../migrations/0003_site_settings.sql"),
            include_str!("../migrations/0004_task_step_checks.sql"),
            include_str!("../migrations/0005_drop_glossary.sql"),
            include_str!("../migrations/0006_step_license.sql"),
            include_str!("../migrations/0007_oauth_identity.sql"),
            include_str!("../migrations/0008_collaboration_and_moderation.sql"),
            include_str!("../migrations/0009_email_verification_codes.sql"),
            include_str!("../migrations/0010_sessions_and_login_otp.sql"),
            include_str!("../migrations/0011_multi_oauth_and_passkeys.sql"),
        ] {
            sqlx::raw_sql(sql).execute(&pool).await?;
        }

        if seed_demo_users {
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
        }

        Ok(Self { pool })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    async fn fetch_gravatar_base(&self) -> String {
        if let Ok(Some(row)) = sqlx::query("SELECT settings FROM site_settings WHERE id = 1")
            .fetch_optional(&self.pool)
            .await
        {
            if let Ok(val) = row.try_get::<serde_json::Value, _>("settings") {
                if let Some(url) = val.get("gravatar_base_url").and_then(|v| v.as_str()) {
                    if !url.trim().is_empty() {
                        return url.trim().to_string();
                    }
                }
            }
        }
        "https://www.gravatar.com/avatar".to_string()
    }

    fn row_to_user(r: &PgRow, gravatar_base: &str) -> Result<UserProfileDto> {
        let role_str: String = r.try_get("role")?;
        let legacy_provider: Option<String> = r.try_get("oauth_provider").ok().flatten();
        let mut oauth_bindings: Vec<String> = r.try_get("oauth_bindings").unwrap_or_default();
        if oauth_bindings.is_empty() {
            if let Some(ref lp) = legacy_provider {
                if !lp.trim().is_empty() {
                    oauth_bindings.push(lp.trim().to_ascii_lowercase());
                }
            }
        }
        let primary_oauth = oauth_bindings.first().cloned().or(legacy_provider);
        let has_password: bool = r.try_get("has_password").unwrap_or(false);
        let prof = UserProfileDto {
            id: r.try_get("id")?,
            wp_user_id: r.try_get("wp_user_id")?,
            username: r.try_get("username")?,
            display_name: r.try_get("display_name")?,
            email: r.try_get("email")?,
            avatar_url: r.try_get("avatar_url").unwrap_or_default(),
            avatar_source: r
                .try_get::<String, _>("avatar_source")
                .unwrap_or_else(|_| "default".to_string()),
            oauth_avatar_url: r.try_get("oauth_avatar_url").unwrap_or_default(),
            uploaded_avatar_url: r.try_get("uploaded_avatar_url").unwrap_or_default(),
            oauth_provider: primary_oauth,
            oauth_bindings,
            has_password,
            bio: r.try_get("bio").unwrap_or_default(),
            role: UserRole::from_db(&role_str),
            auth_source: r.try_get("auth_source")?,
            is_banned: r.try_get("is_banned").unwrap_or(false),
            ban_reason: r.try_get("ban_reason").unwrap_or_default(),
            last_login_at: r.try_get("last_login_at")?,
        };
        Ok(prof.with_resolved_avatar(gravatar_base))
    }

    fn row_to_stored_passkey(r: &PgRow) -> Result<StoredPasskeyCredential> {
        let counter_i64: i64 = r.try_get("counter").unwrap_or(0);
        Ok(StoredPasskeyCredential {
            credential_id: r.try_get("credential_id")?,
            user_id: r.try_get("user_id")?,
            public_key_b64: r.try_get("public_key_b64")?,
            alg: r.try_get("alg").unwrap_or(-7),
            counter: u32::try_from(counter_i64.max(0)).unwrap_or(0),
            aaguid: r.try_get("aaguid").unwrap_or_default(),
            name: r.try_get("name").unwrap_or_else(|_| "Passkey".to_string()),
            transports: r.try_get("transports").unwrap_or_default(),
            device_type: r
                .try_get("device_type")
                .unwrap_or_else(|_| "multiDevice".to_string()),
            backed_up: r.try_get("backed_up").unwrap_or(true),
            created_at: r.try_get("created_at")?,
            last_used_at: r.try_get("last_used_at").ok().flatten(),
        })
    }

    async fn load_step_authors(
        &self,
        step_id: Uuid,
        owner_user_id: Option<Uuid>,
        fallback_author_name: &str,
        gravatar_base: &str,
    ) -> Result<Vec<ArticleAuthorDto>> {
        let mut authors = Vec::new();
        if let Some(oid) = owner_user_id {
            let q = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
            if let Some(ur) = sqlx::query(&q)
                .bind(oid)
                .fetch_optional(&self.pool)
                .await?
            {
                let dto = Self::row_to_user(&ur, gravatar_base)?;
                authors.push(ArticleAuthorDto {
                    user_id: Some(dto.id),
                    username: dto.username,
                    display_name: dto.display_name,
                    avatar_url: dto.avatar_url,
                    is_owner: true,
                });
            }
        }

        let collab_q = format!(
            "SELECT u.id, u.wp_user_id, u.username, u.display_name, u.email, u.avatar_url, \
             u.avatar_source, u.oauth_avatar_url, u.uploaded_avatar_url, u.oauth_provider, u.bio, \
             u.role, u.auth_source, u.is_banned, u.ban_reason, u.last_login_at \
             FROM step_collaborators sc JOIN users u ON u.id = sc.user_id \
             WHERE sc.step_id = $1 ORDER BY sc.added_at ASC"
        );
        let crows = sqlx::query(&collab_q)
            .bind(step_id)
            .fetch_all(&self.pool)
            .await?;
        for cr in crows {
            let dto = Self::row_to_user(&cr, gravatar_base)?;
            if authors.iter().any(|a| a.user_id == Some(dto.id)) {
                continue;
            }
            authors.push(ArticleAuthorDto {
                user_id: Some(dto.id),
                username: dto.username,
                display_name: dto.display_name,
                avatar_url: dto.avatar_url,
                is_owner: false,
            });
        }

        let clean_fb = fallback_author_name.trim();
        if authors.is_empty() && !clean_fb.is_empty() && clean_fb != "Author" {
            authors.push(ArticleAuthorDto {
                user_id: None,
                username: String::new(),
                display_name: clean_fb.to_string(),
                avatar_url: String::new(),
                is_owner: true,
            });
        }

        Ok(authors)
    }

    async fn can_edit_step(&self, actor: &UserProfileDto, step_id: Uuid) -> Result<bool> {
        if actor.role.is_admin() {
            return Ok(true);
        }
        if !actor.role.can_author() {
            return Ok(false);
        }
        let owner_opt: Option<Option<Uuid>> =
            sqlx::query_scalar("SELECT owner_user_id FROM steps WHERE id = $1")
                .bind(step_id)
                .fetch_optional(&self.pool)
                .await?;
        match owner_opt {
            None => Ok(true),
            Some(None) => Ok(true),
            Some(Some(oid)) if oid == actor.id => Ok(true),
            Some(Some(_)) => {
                let is_collab: bool = sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM step_collaborators WHERE step_id = $1 AND user_id = $2)",
                )
                .bind(step_id)
                .bind(actor.id)
                .fetch_one(&self.pool)
                .await?;
                Ok(is_collab)
            }
        }
    }

    pub async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto> {
        let clean_username = username.trim();
        if clean_username.is_empty() {
            return Err(domain_err(
                ErrorCode::InvalidUsername,
                "Username cannot be empty.",
            ));
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
        let pw_hash = hash_password(clean_username, password);
        let q = format!(
            r#"
            INSERT INTO users (username, display_name, email, bio, role, auth_source, password_hash, is_banned, ban_reason)
            VALUES ($1, $2, $3, '', $4, 'local', $5, FALSE, '')
            ON CONFLICT (username) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                email = EXCLUDED.email,
                role = EXCLUDED.role,
                password_hash = EXCLUDED.password_hash,
                is_banned = FALSE,
                ban_reason = ''
            RETURNING {USER_SELECT_COLS}
            "#
        );
        let row = sqlx::query(&q)
            .bind(clean_username)
            .bind(clean_display)
            .bind(&clean_email)
            .bind(role.as_str())
            .bind(&pw_hash)
            .fetch_one(&self.pool)
            .await?;
        let grav = self.fetch_gravatar_base().await;
        let user = Self::row_to_user(&row, &grav)?;
        sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
            .bind(user.id)
            .execute(&self.pool)
            .await?;
        Ok(user)
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
                    AND s.takedown_reason IS NULL
                    AND EXISTS (SELECT 1 FROM step_translations p WHERE p.step_id = s.id AND p.status = 'published')
                ) AS step_count,
                COALESCE((
                    SELECT c.slug
                    FROM chapters c
                    WHERE c.track_id = t.id
                      AND EXISTS (
                          SELECT 1 FROM steps s
                          WHERE s.chapter_id = c.id
                            AND s.takedown_reason IS NULL
                            AND EXISTS (SELECT 1 FROM step_translations p WHERE p.step_id = s.id AND p.status = 'published')
                      )
                    ORDER BY c.chapter_number ASC LIMIT 1
                ), COALESCE((SELECT c.slug FROM chapters c WHERE c.track_id = t.id ORDER BY c.chapter_number ASC LIMIT 1), '')) AS first_chapter_slug,
                COALESCE((
                    SELECT s.slug
                    FROM steps s
                    JOIN chapters c ON s.chapter_id = c.id
                    WHERE c.track_id = t.id
                      AND s.takedown_reason IS NULL
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
                s.likes_count,
                s.owner_user_id,
                s.author_name AS step_author_name,
                s.takedown_reason
            FROM tracks t
            JOIN chapters c ON c.track_id = t.id AND c.slug = $2
            JOIN steps s ON s.chapter_id = c.id AND s.slug = $3
            LEFT JOIN track_translations tt_req ON tt_req.track_id = t.id AND tt_req.locale_code = $1
            LEFT JOIN track_translations tt_def ON tt_def.track_id = t.id AND tt_def.locale_code = 'zh-CN'
            LEFT JOIN chapter_translations ct_req ON ct_req.chapter_id = c.id AND ct_req.locale_code = $1
            LEFT JOIN chapter_translations ct_def ON ct_def.chapter_id = c.id AND ct_def.locale_code = 'zh-CN'
            WHERE t.slug = $4 AND s.takedown_reason IS NULL
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
        let canonical_revision: i32 = sr.try_get::<i32, _>("canonical_revision")?.max(1);
        let owner_user_id: Option<Uuid> = sr.try_get("owner_user_id").ok().flatten();
        let step_author_name: String = sr.try_get("step_author_name").unwrap_or_default();

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
        let synced_revision: i32 = tr.try_get::<i32, _>("synced_revision")?.max(1);
        let blocks_val: serde_json::Value = tr.try_get("compiled_blocks")?;
        let toc_val: serde_json::Value = tr.try_get("toc_tree")?;
        let blocks: Vec<NotebookBlock> = serde_json::from_value(blocks_val)?;
        let toc: Vec<TocItem> = serde_json::from_value(toc_val)?;

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
                COALESCE(st_req.title, st_def.title, s.slug) AS step_title,
                (st_req.id IS NOT NULL) AS has_req
            FROM chapters c
            JOIN steps s ON s.chapter_id = c.id
            LEFT JOIN chapter_translations ct_req ON ct_req.chapter_id = c.id AND ct_req.locale_code = $2
            LEFT JOIN chapter_translations ct_def ON ct_def.chapter_id = c.id AND ct_def.locale_code = 'zh-CN'
            LEFT JOIN step_translations st_req ON st_req.step_id = s.id AND st_req.locale_code = $2 AND st_req.status = 'published'
            LEFT JOIN step_translations st_def ON st_def.step_id = s.id AND st_def.locale_code = s.default_locale AND st_def.status = 'published'
            WHERE c.track_id = $1
              AND s.takedown_reason IS NULL
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
            let s_title: String = nr.try_get("step_title")?;
            let has_req: bool = nr.try_get("has_req")?;

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
                    has_revision_drift: false,
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

        let tr_author: String = tr.try_get("author_name").unwrap_or_default();
        let fallback_author = if !tr_author.trim().is_empty() && tr_author != "Author" {
            tr_author
        } else {
            step_author_name
        };
        let grav = self.fetch_gravatar_base().await;
        let authors = self
            .load_step_authors(step_id, owner_user_id, &fallback_author, &grav)
            .await?;
        let primary_author_name = authors
            .first()
            .map(|a| a.display_name.clone())
            .unwrap_or_default();

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
            version: synced_revision,
            has_revision_drift: false,
            estimated_minutes: sr.try_get("estimated_minutes")?,
            title: tr.try_get("title")?,
            summary: tr.try_get("summary")?,
            license: icehandnote_core::normalize_license_code(
                &tr.try_get::<String, _>("license").unwrap_or_default(),
            ),
            author_name: primary_author_name,
            authors,
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
              AND s.takedown_reason IS NULL
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
                                step_id, locale_code, title, summary, license, author_name, tags, raw_markdown,
                                compiled_blocks, toc_tree, plain_text, synced_revision, status, updated_at
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                            ON CONFLICT (step_id, locale_code) DO UPDATE
                            SET title = EXCLUDED.title,
                                summary = EXCLUDED.summary,
                                license = EXCLUDED.license,
                                author_name = CASE WHEN EXCLUDED.author_name <> '' THEN EXCLUDED.author_name ELSE step_translations.author_name END,
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
                        .bind(&tr.compiled.frontmatter.author)
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
            let q = format!(
                r#"
                UPDATE users
                SET wp_user_id = $2,
                    display_name = $3,
                    oauth_avatar_url = CASE WHEN $4 <> '' THEN $4 ELSE oauth_avatar_url END,
                    role = CASE
                        WHEN role = 'admin' OR $5 = 'admin' THEN 'admin'
                        WHEN role = 'author' OR $5 = 'author' THEN 'author'
                        ELSE 'reader'
                    END,
                    last_login_at = NOW()
                WHERE id = $1
                RETURNING {USER_SELECT_COLS}
                "#
            );
            sqlx::query(&q)
                .bind(id)
                .bind(claims.wp_user_id)
                .bind(&claims.display_name)
                .bind(&claims.avatar_url)
                .bind(wp_role.as_str())
                .fetch_one(&mut *tx)
                .await?
        } else {
            let taken: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(username) = LOWER($1))",
            )
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
            let avatar_source = if claims.avatar_url.trim().is_empty() {
                "default"
            } else {
                "oauth"
            };
            let q = format!(
                r#"
                INSERT INTO users (wp_user_id, username, display_name, email, avatar_url, avatar_source, oauth_avatar_url, bio, role, auth_source, last_login_at)
                VALUES ($1, $2, $3, $4, $5, $6, $5, '', $7, $8, NOW())
                RETURNING {USER_SELECT_COLS}
                "#
            );
            sqlx::query(&q)
                .bind(claims.wp_user_id)
                .bind(&username)
                .bind(&claims.display_name)
                .bind(&email)
                .bind(&claims.avatar_url)
                .bind(avatar_source)
                .bind(wp_role.as_str())
                .bind(&auth_source)
                .fetch_one(&mut *tx)
                .await?
        };

        tx.commit().await?;
        let grav = self.fetch_gravatar_base().await;
        let user = Self::row_to_user(&row, &grav)?;
        if user.is_banned {
            let err = DomainError::new(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            );
            let err = if user.ban_reason.trim().is_empty() {
                err
            } else {
                err.with_meta(serde_json::json!({ "reason": user.ban_reason.trim() }))
            };
            return Err(err.into());
        }
        Ok(user)
    }

    async fn find_oauth_user(
        &self,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> Result<Option<UserProfileDto>> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let clean_sub = subject.trim();
        if clean_provider.is_empty() || clean_sub.is_empty() {
            return Ok(None);
        }
        let target_uid: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT user_id FROM user_oauth_bindings
            WHERE LOWER(provider) = $1 AND subject = $2
            UNION
            SELECT id FROM users
            WHERE LOWER(oauth_provider) = $1 AND oauth_sub = $2
            LIMIT 1
            "#,
        )
        .bind(&clean_provider)
        .bind(clean_sub)
        .fetch_optional(&self.pool)
        .await?;

        let Some(uid) = target_uid else {
            return Ok(None);
        };

        if !oauth_avatar_url.trim().is_empty() {
            let _ = sqlx::query(
                "UPDATE user_oauth_bindings SET oauth_avatar_url = $3 WHERE user_id = $1 AND LOWER(provider) = $2",
            )
            .bind(uid)
            .bind(&clean_provider)
            .bind(oauth_avatar_url.trim())
            .execute(&self.pool)
            .await;
        }

        let q = format!(
            r#"
            UPDATE users
            SET oauth_avatar_url = CASE WHEN $2 <> '' THEN $2 ELSE oauth_avatar_url END,
                last_login_at = NOW()
            WHERE id = $1
            RETURNING {USER_SELECT_COLS}
            "#
        );
        let row_opt = sqlx::query(&q)
            .bind(uid)
            .bind(oauth_avatar_url.trim())
            .fetch_optional(&self.pool)
            .await?;

        match row_opt {
            Some(r) => {
                let grav = self.fetch_gravatar_base().await;
                Ok(Some(Self::row_to_user(&r, &grav)?))
            }
            None => Ok(None),
        }
    }

    async fn complete_oauth_registration(
        &self,
        provider: &str,
        subject: &str,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        avatar_source: &str,
        oauth_avatar_url: &str,
        uploaded_avatar_url: &str,
    ) -> Result<UserProfileDto> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let clean_sub = subject.trim();
        let clean_username = username.trim();
        let clean_email = email.trim();

        let existing_oauth: Option<i32> = sqlx::query_scalar(
            r#"
            SELECT 1 FROM user_oauth_bindings WHERE LOWER(provider) = $1 AND subject = $2
            UNION
            SELECT 1 FROM users WHERE LOWER(oauth_provider) = $1 AND oauth_sub = $2
            LIMIT 1
            "#,
        )
        .bind(&clean_provider)
        .bind(clean_sub)
        .fetch_optional(&self.pool)
        .await?;
        if existing_oauth.is_some() {
            return Err(domain_err(
                ErrorCode::OAuthAlreadyBound,
                "This OAuth identity is already linked to an account.",
            ));
        }

        let user_taken: Option<i32> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)")
                .bind(clean_username)
                .fetch_optional(&self.pool)
                .await?;
        if user_taken.is_some() {
            return Err(domain_err(
                ErrorCode::UsernameTaken,
                "Username is already taken.",
            ));
        }

        let email_taken: Option<i32> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)")
                .bind(clean_email)
                .fetch_optional(&self.pool)
                .await?;
        if email_taken.is_some() {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "Email address is already registered.",
            ));
        }

        let safe_role = if role == UserRole::Author {
            UserRole::Author
        } else {
            UserRole::Reader
        };
        let norm_source = normalize_avatar_source(avatar_source);
        let clean_display = if display_name.trim().is_empty() {
            clean_username
        } else {
            display_name.trim()
        };

        let mut tx = self.pool.begin().await?;
        let inserted_id: Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO users (
                username, display_name, email, avatar_source, oauth_avatar_url,
                uploaded_avatar_url, bio, role, auth_source, oauth_provider, oauth_sub, last_login_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $8, $9, NOW())
            RETURNING id
            "#,
        )
        .bind(clean_username)
        .bind(clean_display)
        .bind(clean_email)
        .bind(&norm_source)
        .bind(oauth_avatar_url.trim())
        .bind(uploaded_avatar_url.trim())
        .bind(safe_role.as_str())
        .bind(&clean_provider)
        .bind(clean_sub)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO user_oauth_bindings (id, user_id, provider, subject, oauth_avatar_url)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, provider) DO UPDATE
            SET subject = EXCLUDED.subject, oauth_avatar_url = EXCLUDED.oauth_avatar_url
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(inserted_id)
        .bind(&clean_provider)
        .bind(clean_sub)
        .bind(oauth_avatar_url.trim())
        .execute(&mut *tx)
        .await?;

        let q = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
        let row = sqlx::query(&q)
            .bind(inserted_id)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;

        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&row, &grav)
    }

    async fn bind_oauth_to_user(
        &self,
        user_id: Uuid,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> Result<UserProfileDto> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let clean_sub = subject.trim();
        let conflict: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT user_id FROM user_oauth_bindings
            WHERE LOWER(provider) = $1 AND subject = $2 AND user_id <> $3
            UNION
            SELECT id FROM users
            WHERE LOWER(oauth_provider) = $1 AND oauth_sub = $2 AND id <> $3
            LIMIT 1
            "#,
        )
        .bind(&clean_provider)
        .bind(clean_sub)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        if conflict.is_some() {
            return Err(domain_err(
                ErrorCode::OAuthAlreadyBound,
                "This OAuth identity is already linked to another user.",
            ));
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO user_oauth_bindings (id, user_id, provider, subject, oauth_avatar_url)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, provider) DO UPDATE
            SET subject = EXCLUDED.subject,
                oauth_avatar_url = CASE WHEN EXCLUDED.oauth_avatar_url <> '' THEN EXCLUDED.oauth_avatar_url ELSE user_oauth_bindings.oauth_avatar_url END
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(&clean_provider)
        .bind(clean_sub)
        .bind(oauth_avatar_url.trim())
        .execute(&mut *tx)
        .await?;

        let q = format!(
            r#"
            UPDATE users
            SET oauth_provider = COALESCE(NULLIF(oauth_provider, ''), $2),
                oauth_sub = COALESCE(NULLIF(oauth_sub, ''), $3),
                oauth_avatar_url = CASE WHEN $4 <> '' THEN $4 ELSE oauth_avatar_url END,
                avatar_source = CASE WHEN avatar_source = 'default' AND $4 <> '' THEN 'oauth' ELSE avatar_source END
            WHERE id = $1
            RETURNING {USER_SELECT_COLS}
            "#
        );
        let row_opt = sqlx::query(&q)
            .bind(user_id)
            .bind(&clean_provider)
            .bind(clean_sub)
            .bind(oauth_avatar_url.trim())
            .fetch_optional(&mut *tx)
            .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(ErrorCode::UserNotFound, "Target user not found."));
        };
        tx.commit().await?;
        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&row, &grav)
    }

    async fn unbind_oauth_from_user(
        &self,
        user_id: Uuid,
        provider: &str,
    ) -> Result<UserProfileDto> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let has_pw: bool = sqlx::query_scalar(
            "SELECT COALESCE(password_hash IS NOT NULL AND password_hash <> '', FALSE) FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| domain_err(ErrorCode::UserNotFound, "User not found."))?;

        let passkey_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM user_passkeys WHERE user_id = $1")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;
        let remaining_oauth: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM user_oauth_bindings WHERE user_id = $1 AND LOWER(provider) <> $2",
        )
        .bind(user_id)
        .bind(&clean_provider)
        .fetch_one(&self.pool)
        .await?;

        if !has_pw && passkey_count == 0 && remaining_oauth == 0 {
            return Err(domain_err(
                ErrorCode::CannotUnbindLastAuth,
                "Cannot unlink your only sign-in method. Set a password or register a passkey first.",
            ));
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "DELETE FROM user_oauth_bindings WHERE user_id = $1 AND LOWER(provider) = $2",
        )
        .bind(user_id)
        .bind(&clean_provider)
        .execute(&mut *tx)
        .await?;

        let next_primary: Option<(String, String)> = sqlx::query_as(
            "SELECT provider, subject FROM user_oauth_bindings WHERE user_id = $1 ORDER BY bound_at ASC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;

        let q = format!(
            r#"
            UPDATE users
            SET oauth_provider = $2,
                oauth_sub = $3
            WHERE id = $1
            RETURNING {USER_SELECT_COLS}
            "#
        );
        let row = sqlx::query(&q)
            .bind(user_id)
            .bind(next_primary.as_ref().map(|(p, _)| p.as_str()))
            .bind(next_primary.as_ref().map(|(_, s)| s.as_str()))
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;

        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&row, &grav)
    }

    async fn list_user_passkeys(&self, user_id: Uuid) -> Result<Vec<UserPasskeyDto>> {
        let rows = sqlx::query(
            r#"
            SELECT credential_id, user_id, public_key_b64, alg, counter, aaguid, name,
                   transports, device_type, backed_up, created_at, last_used_at
            FROM user_passkeys
            WHERE user_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(Self::row_to_stored_passkey(&r)?.to_dto());
        }
        Ok(out)
    }

    async fn save_user_passkey(&self, cred: StoredPasskeyCredential) -> Result<UserPasskeyDto> {
        let existing: Option<i32> = sqlx::query_scalar(
            "SELECT 1 FROM user_passkeys WHERE credential_id = $1",
        )
        .bind(&cred.credential_id)
        .fetch_optional(&self.pool)
        .await?;
        if existing.is_some() {
            return Err(domain_err(
                ErrorCode::Conflict,
                "This passkey credential is already registered.",
            ));
        }

        sqlx::query(
            r#"
            INSERT INTO user_passkeys (
                credential_id, user_id, public_key_b64, alg, counter, aaguid,
                name, transports, device_type, backed_up, created_at, last_used_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            "#,
        )
        .bind(&cred.credential_id)
        .bind(cred.user_id)
        .bind(&cred.public_key_b64)
        .bind(cred.alg)
        .bind(i64::from(cred.counter))
        .bind(&cred.aaguid)
        .bind(&cred.name)
        .bind(&cred.transports)
        .bind(&cred.device_type)
        .bind(cred.backed_up)
        .bind(cred.created_at)
        .bind(cred.last_used_at)
        .execute(&self.pool)
        .await?;

        Ok(cred.to_dto())
    }

    async fn find_passkey_by_credential_id(
        &self,
        credential_id: &str,
    ) -> Result<Option<(StoredPasskeyCredential, UserProfileDto)>> {
        let clean_id = credential_id.trim();
        let pk_row_opt = sqlx::query(
            r#"
            SELECT credential_id, user_id, public_key_b64, alg, counter, aaguid, name,
                   transports, device_type, backed_up, created_at, last_used_at
            FROM user_passkeys
            WHERE credential_id = $1
            LIMIT 1
            "#,
        )
        .bind(clean_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(pk_row) = pk_row_opt else {
            return Ok(None);
        };
        let stored_pk = Self::row_to_stored_passkey(&pk_row)?;
        let q = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
        let Some(u_row) = sqlx::query(&q)
            .bind(stored_pk.user_id)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Ok(None);
        };
        let grav = self.fetch_gravatar_base().await;
        let user_dto = Self::row_to_user(&u_row, &grav)?;
        Ok(Some((stored_pk, user_dto)))
    }

    async fn touch_passkey_usage(&self, credential_id: &str, new_counter: u32) -> Result<()> {
        sqlx::query(
            "UPDATE user_passkeys SET counter = $2, last_used_at = NOW() WHERE credential_id = $1",
        )
        .bind(credential_id.trim())
        .bind(i64::from(new_counter))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn rename_user_passkey(
        &self,
        user_id: Uuid,
        credential_id: &str,
        new_name: &str,
    ) -> Result<Option<UserPasskeyDto>> {
        let clean_name: String = new_name.trim().chars().take(80).collect();
        if clean_name.is_empty() {
            return Err(domain_err(
                ErrorCode::BadRequest,
                "Passkey name cannot be empty.",
            ));
        }
        let row_opt = sqlx::query(
            r#"
            UPDATE user_passkeys
            SET name = $3
            WHERE user_id = $1 AND credential_id = $2
            RETURNING credential_id, user_id, public_key_b64, alg, counter, aaguid, name,
                      transports, device_type, backed_up, created_at, last_used_at
            "#,
        )
        .bind(user_id)
        .bind(credential_id.trim())
        .bind(&clean_name)
        .fetch_optional(&self.pool)
        .await?;
        match row_opt {
            Some(r) => Ok(Some(Self::row_to_stored_passkey(&r)?.to_dto())),
            None => Ok(None),
        }
    }

    async fn delete_user_passkey(&self, user_id: Uuid, credential_id: &str) -> Result<bool> {
        let clean_id = credential_id.trim();
        let exists: Option<i32> = sqlx::query_scalar(
            "SELECT 1 FROM user_passkeys WHERE user_id = $1 AND credential_id = $2",
        )
        .bind(user_id)
        .bind(clean_id)
        .fetch_optional(&self.pool)
        .await?;
        if exists.is_none() {
            return Ok(false);
        }

        let has_pw: bool = sqlx::query_scalar(
            "SELECT COALESCE(password_hash IS NOT NULL AND password_hash <> '', FALSE) FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or(false);
        let oauth_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM user_oauth_bindings WHERE user_id = $1")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;
        let remaining_passkeys: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM user_passkeys WHERE user_id = $1 AND credential_id <> $2",
        )
        .bind(user_id)
        .bind(clean_id)
        .fetch_one(&self.pool)
        .await?;

        if !has_pw && oauth_count == 0 && remaining_passkeys == 0 {
            return Err(domain_err(
                ErrorCode::CannotUnbindLastAuth,
                "Cannot remove your only sign-in method. Set a password or link an OAuth account first.",
            ));
        }

        let res = sqlx::query(
            "DELETE FROM user_passkeys WHERE user_id = $1 AND credential_id = $2",
        )
        .bind(user_id)
        .bind(clean_id)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn register_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        password: &str,
        role: UserRole,
    ) -> Result<UserProfileDto> {
        let clean_username = username.trim();
        let clean_email = email.trim();
        let user_taken: Option<i32> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)")
                .bind(clean_username)
                .fetch_optional(&self.pool)
                .await?;
        if user_taken.is_some() {
            return Err(domain_err(
                ErrorCode::UsernameTaken,
                "Username is already taken.",
            ));
        }
        let email_taken: Option<i32> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)")
                .bind(clean_email)
                .fetch_optional(&self.pool)
                .await?;
        if email_taken.is_some() {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "Email address is already registered.",
            ));
        }

        let safe_role = if role == UserRole::Author {
            UserRole::Author
        } else {
            UserRole::Reader
        };
        let clean_display = if display_name.trim().is_empty() {
            clean_username
        } else {
            display_name.trim()
        };
        let pw_hash = hash_password(clean_username, password);
        let q = format!(
            r#"
            INSERT INTO users (username, display_name, email, bio, role, auth_source, password_hash)
            VALUES ($1, $2, $3, '', $4, 'local', $5)
            RETURNING {USER_SELECT_COLS}
            "#
        );
        let row = sqlx::query(&q)
            .bind(clean_username)
            .bind(clean_display)
            .bind(clean_email)
            .bind(safe_role.as_str())
            .bind(&pw_hash)
            .fetch_one(&self.pool)
            .await?;

        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&row, &grav)
    }

    async fn is_username_taken(&self, username: &str) -> Result<bool> {
        let clean = username.trim();
        if clean.is_empty() {
            return Ok(false);
        }
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(username) = LOWER($1))",
        )
        .bind(clean)
        .fetch_one(&self.pool)
        .await?;
        Ok(exists)
    }

    async fn authenticate_password(
        &self,
        identifier: &str,
        password: &str,
    ) -> Result<Option<UserProfileDto>> {
        let ident = identifier.trim().to_ascii_lowercase();
        let q = format!(
            "SELECT {USER_SELECT_COLS}, password_hash FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1 LIMIT 1"
        );
        let row_opt = sqlx::query(&q)
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

        let grav = self.fetch_gravatar_base().await;
        let user = Self::row_to_user(&row, &grav)?;
        if user.is_banned {
            let err = DomainError::new(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            );
            let err = if user.ban_reason.trim().is_empty() {
                err
            } else {
                err.with_meta(serde_json::json!({ "reason": user.ban_reason.trim() }))
            };
            return Err(err.into());
        }

        let _ = sqlx::query("UPDATE users SET last_login_at = NOW() WHERE id = $1")
            .bind(user.id)
            .execute(&self.pool)
            .await;

        Ok(Some(user))
    }

    async fn update_user_profile(
        &self,
        user_id: Uuid,
        input: UpdateUserProfileInput,
    ) -> Result<UserProfileDto> {
        let clean_display: String = input.display_name.trim().chars().take(64).collect();
        let clean_bio: String = input.bio.trim().chars().take(300).collect();
        let norm_source = normalize_avatar_source(&input.avatar_source);
        let clean_uploaded: String = input.uploaded_avatar_url.trim().chars().take(512).collect();

        let q = format!(
            r#"
            UPDATE users
            SET display_name = CASE WHEN $2 <> '' THEN $2 ELSE display_name END,
                bio = $3,
                avatar_source = $4,
                uploaded_avatar_url = CASE WHEN $5 <> '' THEN $5 ELSE uploaded_avatar_url END
            WHERE id = $1
            RETURNING {USER_SELECT_COLS}
            "#
        );
        let row_opt = sqlx::query(&q)
            .bind(user_id)
            .bind(&clean_display)
            .bind(&clean_bio)
            .bind(&norm_source)
            .bind(&clean_uploaded)
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(ErrorCode::UserNotFound, "User not found."));
        };
        let grav = self.fetch_gravatar_base().await;
        let dto = Self::row_to_user(&row, &grav)?;
        let _ = sqlx::query("UPDATE users SET avatar_url = $2 WHERE id = $1")
            .bind(dto.id)
            .bind(&dto.avatar_url)
            .execute(&self.pool)
            .await;
        Ok(dto)
    }

    async fn is_email_taken_by_other(&self, email: &str, exclude_user_id: Uuid) -> Result<bool> {
        let clean = email.trim();
        if clean.is_empty() {
            return Ok(false);
        }
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2)",
        )
        .bind(clean)
        .bind(exclude_user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(exists)
    }

    async fn update_user_email(
        &self,
        user_id: Uuid,
        new_email: &str,
    ) -> Result<UserProfileDto> {
        let clean = new_email.trim();
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2)",
        )
        .bind(clean)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        if exists {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "This email address is already registered to another account.",
            ));
        }

        let q = format!(
            "UPDATE users SET email = $2 WHERE id = $1 RETURNING {USER_SELECT_COLS}"
        );
        let row_opt = sqlx::query(&q)
            .bind(user_id)
            .bind(clean)
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(ErrorCode::UserNotFound, "User not found."));
        };
        let grav = self.fetch_gravatar_base().await;
        let dto = Self::row_to_user(&row, &grav)?;
        let _ = sqlx::query("UPDATE users SET avatar_url = $2 WHERE id = $1")
            .bind(dto.id)
            .bind(&dto.avatar_url)
            .execute(&self.pool)
            .await;
        Ok(dto)
    }

    async fn create_password_reset_token(
        &self,
        email: &str,
    ) -> Result<Option<(UserProfileDto, String, String)>> {
        let clean_email = email.trim();
        if clean_email.is_empty() {
            return Ok(None);
        }
        let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE expires_at <= NOW()")
            .execute(&self.pool)
            .await;
        let q = format!(
            "SELECT {USER_SELECT_COLS} FROM users WHERE LOWER(email) = LOWER($1) AND NOT is_banned LIMIT 1"
        );
        let Some(row) = sqlx::query(&q)
            .bind(clean_email)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Ok(None);
        };
        let grav = self.fetch_gravatar_base().await;
        let user = Self::row_to_user(&row, &grav)?;
        let (raw_token, token_hash) = generate_action_token("ihn_rst", "pw_reset_v1");
        let (raw_otp, code_hash) = generate_email_verification_code(&user.email);
        let expires_at = Utc::now() + Duration::minutes(30);
        sqlx::query(
            "INSERT INTO password_reset_tokens (token_hash, code_hash, attempts, user_id, expires_at) VALUES ($1, $2, 0, $3, $4)",
        )
        .bind(&token_hash)
        .bind(&code_hash)
        .bind(user.id)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(Some((user, raw_token, raw_otp)))
    }

    async fn verify_password_reset_otp(&self, email: &str, otp_code: &str) -> Result<String> {
        let clean_email = email.trim();
        let clean_code = otp_code.trim();
        let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE expires_at <= NOW()")
            .execute(&self.pool)
            .await;

        let urow_opt = sqlx::query(
            "SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) AND NOT is_banned LIMIT 1",
        )
        .bind(clean_email)
        .fetch_optional(&self.pool)
        .await?;
        let Some(urow) = urow_opt else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };
        let user_id: Uuid = urow.try_get("id")?;
        let user_email: String = urow.try_get("email")?;

        let row_opt = sqlx::query(
            "SELECT token_hash, code_hash, attempts, expires_at FROM password_reset_tokens WHERE user_id = $1 AND code_hash <> '' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };
        let old_token_hash: String = row.try_get("token_hash")?;
        let expected_hash: String = row.try_get("code_hash")?;
        let attempts: i32 = row.try_get("attempts").unwrap_or(0);
        let existing_exp: DateTime<Utc> = row.try_get("expires_at")?;

        if attempts >= 5 {
            let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                .bind(user_id)
                .execute(&self.pool)
                .await;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please request a new reset code.",
            ));
        }

        let candidate = hash_email_verification_code(&user_email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate) {
            if attempts + 1 >= 5 {
                let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                    .bind(user_id)
                    .execute(&self.pool)
                    .await;
            } else {
                let _ = sqlx::query(
                    "UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE token_hash = $1",
                )
                .bind(&old_token_hash)
                .execute(&self.pool)
                .await;
            }
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid.",
            ));
        }

        let (raw_verified_token, verified_hash) = generate_action_token("ihn_rstv", "pw_reset_v1");
        let min_exp = Utc::now() + Duration::minutes(15);
        let next_exp = existing_exp.max(min_exp);
        sqlx::query(
            "UPDATE password_reset_tokens SET token_hash = $2, code_hash = '', expires_at = $3 WHERE token_hash = $1",
        )
        .bind(&old_token_hash)
        .bind(&verified_hash)
        .bind(next_exp)
        .execute(&self.pool)
        .await?;

        Ok(raw_verified_token)
    }

    async fn consume_password_reset_token(
        &self,
        raw_token: &str,
        new_password: &str,
    ) -> Result<UserProfileDto> {
        let token_hash = hash_action_token("pw_reset_v1", raw_token);
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM password_reset_tokens WHERE expires_at <= NOW()")
            .execute(&mut *tx)
            .await?;
        let user_id_opt: Option<Uuid> = sqlx::query_scalar(
            "DELETE FROM password_reset_tokens WHERE token_hash = $1 RETURNING user_id",
        )
        .bind(&token_hash)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(user_id) = user_id_opt else {
            return Err(domain_err(
                ErrorCode::ResetTokenInvalid,
                "Password reset link is invalid or has expired.",
            ));
        };
        sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        let q_select = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
        let Some(urow) = sqlx::query(&q_select)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?
        else {
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        let username: String = urow.try_get("username")?;
        let banned: bool = urow.try_get("is_banned").unwrap_or(false);
        if banned {
            return Err(domain_err(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            ));
        }
        let pw_hash = hash_password(&username, new_password);
        sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
            .bind(user_id)
            .bind(&pw_hash)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&urow, &grav)
    }

    async fn consume_password_reset_otp(
        &self,
        email: &str,
        otp_code: &str,
        new_password: &str,
    ) -> Result<UserProfileDto> {
        let clean_email = email.trim();
        let clean_code = otp_code.trim();
        let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE expires_at <= NOW()")
            .execute(&self.pool)
            .await;

        let q_user = format!(
            "SELECT {USER_SELECT_COLS} FROM users WHERE LOWER(email) = LOWER($1) AND NOT is_banned LIMIT 1"
        );
        let Some(urow) = sqlx::query(&q_user)
            .bind(clean_email)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };
        let user_id: Uuid = urow.try_get("id")?;
        let username: String = urow.try_get("username")?;
        let user_email: String = urow.try_get("email")?;

        let row_opt = sqlx::query(
            "SELECT token_hash, code_hash, attempts FROM password_reset_tokens WHERE user_id = $1 AND code_hash <> '' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };
        let token_hash: String = row.try_get("token_hash")?;
        let expected_hash: String = row.try_get("code_hash")?;
        let attempts: i32 = row.try_get("attempts").unwrap_or(0);
        if attempts >= 5 {
            let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                .bind(user_id)
                .execute(&self.pool)
                .await;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please request a new reset code.",
            ));
        }

        let candidate = hash_email_verification_code(&user_email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate) {
            if attempts + 1 >= 5 {
                let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                    .bind(user_id)
                    .execute(&self.pool)
                    .await;
            } else {
                let _ = sqlx::query(
                    "UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE token_hash = $1",
                )
                .bind(&token_hash)
                .execute(&self.pool)
                .await;
            }
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid.",
            ));
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        let pw_hash = hash_password(&username, new_password);
        sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
            .bind(user_id)
            .bind(&pw_hash)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&urow, &grav)
    }

    async fn create_registration_verification_code(&self, email: &str) -> Result<(Uuid, String)> {
        let clean_email = email.trim().to_ascii_lowercase();
        let now = Utc::now();
        let _ = sqlx::query(
            "DELETE FROM email_verification_codes WHERE used_at IS NOT NULL OR expires_at <= NOW() - INTERVAL '24 hours'",
        )
        .execute(&self.pool)
        .await;

        let email_exists: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1")
                .bind(&clean_email)
                .fetch_optional(&self.pool)
                .await?;
        if email_exists.is_some() {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "This email address is already registered.",
            ));
        }

        let latest_created: Option<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT created_at FROM email_verification_codes WHERE LOWER(email) = LOWER($1) AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
        )
        .bind(&clean_email)
        .fetch_optional(&self.pool)
        .await?;
        if let Some(created_at) = latest_created {
            let elapsed = (now - created_at).num_seconds();
            if elapsed < 60 {
                let retry_after = (60 - elapsed).max(1);
                return Err(DomainError::new(
                    ErrorCode::VerificationCodeRateLimited,
                    format!(
                        "Please wait {retry_after} seconds before requesting another verification code."
                    ),
                )
                .with_meta(serde_json::json!({ "retry_after_secs": retry_after }))
                .into());
            }
        }

        let (raw_code, code_hash) = generate_email_verification_code(&clean_email);
        let id = Uuid::new_v4();
        let expires_at = now + Duration::minutes(10);

        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM email_verification_codes WHERE LOWER(email) = LOWER($1)")
            .bind(&clean_email)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO email_verification_codes (id, email, code_hash, attempts, expires_at, created_at) VALUES ($1, $2, $3, 0, $4, $5)",
        )
        .bind(id)
        .bind(&clean_email)
        .bind(&code_hash)
        .bind(expires_at)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        Ok((id, raw_code))
    }

    async fn verify_registration_verification_code(
        &self,
        email: &str,
        code: &str,
    ) -> Result<Uuid> {
        let clean_email = email.trim().to_ascii_lowercase();
        let clean_code = code.trim();
        let now = Utc::now();

        let row_opt = sqlx::query(
            "SELECT id, code_hash, attempts, expires_at FROM email_verification_codes WHERE LOWER(email) = LOWER($1) AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
        )
        .bind(&clean_email)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row_opt else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Verification code is invalid. Please request a new code.",
            ));
        };

        let id: Uuid = row.try_get("id")?;
        let expected_hash: String = row.try_get("code_hash")?;
        let attempts: i32 = row.try_get("attempts").unwrap_or(0);
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;

        if expires_at <= now {
            let _ = sqlx::query("DELETE FROM email_verification_codes WHERE id = $1")
                .bind(id)
                .execute(&self.pool)
                .await;
            return Err(domain_err(
                ErrorCode::VerificationCodeExpired,
                "Verification code has expired. Please request a new code.",
            ));
        }

        if attempts >= 5 {
            let _ = sqlx::query("DELETE FROM email_verification_codes WHERE id = $1")
                .bind(id)
                .execute(&self.pool)
                .await;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid verification attempts. Please request a new code.",
            ));
        }

        let candidate_hash = hash_email_verification_code(&clean_email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate_hash) {
            if attempts + 1 >= 5 {
                let _ = sqlx::query("DELETE FROM email_verification_codes WHERE id = $1")
                    .bind(id)
                    .execute(&self.pool)
                    .await;
            } else {
                let _ = sqlx::query(
                    "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1",
                )
                .bind(id)
                .execute(&self.pool)
                .await;
            }
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Verification code is invalid. Please check your email and try again.",
            ));
        }

        Ok(id)
    }

    async fn consume_registration_verification_code(&self, code_id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM email_verification_codes WHERE id = $1")
            .bind(code_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn change_user_password(
        &self,
        user_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> Result<()> {
        let row_opt =
            sqlx::query("SELECT username, password_hash FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(ErrorCode::UserNotFound, "User not found."));
        };
        let username: String = row.try_get("username")?;
        let existing_hash: Option<String> = row.try_get("password_hash")?;
        if let Some(expected) = existing_hash {
            if !verify_password(&username, current_password, &expected) {
                return Err(domain_err(
                    ErrorCode::InvalidCurrentPassword,
                    "Current password is incorrect.",
                ));
            }
        }
        let pw_hash = hash_password(&username, new_password);
        sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
            .bind(user_id)
            .bind(&pw_hash)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn create_session(&self, user_id: Uuid) -> Result<String> {
        self.create_session_with_meta(user_id, "", "", "", "").await
    }

    async fn create_session_with_meta(
        &self,
        user_id: Uuid,
        ip_address: &str,
        user_agent: &str,
        device_label: &str,
        device_fingerprint: &str,
    ) -> Result<String> {
        let banned: Option<bool> =
            sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;
        if banned == Some(true) {
            return Err(domain_err(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            ));
        }
        let (raw, hashed, expires_at) = generate_raw_session_token();
        let sess_id = Uuid::new_v4();
        let now = Utc::now();
        let label = if device_label.trim().is_empty() {
            parse_user_agent_device(user_agent).0
        } else {
            device_label.trim().to_string()
        };
        let clean_ua: String = user_agent.trim().chars().take(512).collect();
        sqlx::query(
            r#"
            INSERT INTO user_sessions (
                id, token_hash, user_id, ip_address, user_agent, device_label,
                device_fingerprint, created_at, last_seen_at, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
            "#,
        )
        .bind(sess_id)
        .bind(&hashed)
        .bind(user_id)
        .bind(ip_address.trim())
        .bind(&clean_ua)
        .bind(&label)
        .bind(device_fingerprint.trim())
        .bind(now)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(raw)
    }

    async fn get_user_by_session(&self, raw_token: &str) -> Result<Option<UserProfileDto>> {
        let hashed = hash_session_token(raw_token);
        let row_opt = sqlx::query(
            r#"
            SELECT u.id, u.wp_user_id, u.username, u.display_name, u.email, u.avatar_url,
                   u.avatar_source, u.oauth_avatar_url, u.uploaded_avatar_url, u.oauth_provider,
                   u.bio, u.role, u.auth_source, u.is_banned, u.ban_reason, u.last_login_at,
                   (u.password_hash IS NOT NULL AND u.password_hash <> '') AS has_password,
                   ARRAY(SELECT provider FROM user_oauth_bindings uob WHERE uob.user_id = u.id ORDER BY uob.bound_at ASC) AS oauth_bindings
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > NOW() AND NOT u.is_banned
            LIMIT 1
            "#,
        )
        .bind(&hashed)
        .fetch_optional(&self.pool)
        .await?;

        match row_opt {
            Some(r) => {
                let grav = self.fetch_gravatar_base().await;
                Ok(Some(Self::row_to_user(&r, &grav)?))
            }
            None => Ok(None),
        }
    }

    async fn touch_session(&self, raw_token: &str, ip_address: &str) -> Result<()> {
        let hashed = hash_session_token(raw_token);
        let clean_ip = ip_address.trim();
        let _ = sqlx::query(
            r#"
            UPDATE user_sessions
            SET last_seen_at = NOW(),
                ip_address = CASE WHEN ip_address = '' AND $2 <> '' THEN $2 ELSE ip_address END
            WHERE token_hash = $1
              AND expires_at > NOW()
              AND (last_seen_at < NOW() - INTERVAL '60 seconds' OR (ip_address = '' AND $2 <> ''))
            "#,
        )
        .bind(&hashed)
        .bind(clean_ip)
        .execute(&self.pool)
        .await;
        Ok(())
    }

    async fn list_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> Result<Vec<UserSessionDto>> {
        let current_hash = hash_session_token(current_raw_token);
        let rows = sqlx::query(
            r#"
            SELECT id, token_hash, ip_address, user_agent, device_label, created_at, last_seen_at, expires_at
            FROM user_sessions
            WHERE user_id = $1 AND expires_at > NOW()
            ORDER BY (token_hash = $2) DESC, last_seen_at DESC
            "#,
        )
        .bind(user_id)
        .bind(&current_hash)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let token_hash: String = r.try_get("token_hash")?;
            let ua: String = r.try_get("user_agent").unwrap_or_default();
            let raw_label: String = r.try_get("device_label").unwrap_or_default();
            let ip: String = r.try_get("ip_address").unwrap_or_default();
            let (parsed_label, kind) = parse_user_agent_device(&ua);
            out.push(UserSessionDto {
                id: r.try_get("id")?,
                ip_address: if ip.is_empty() {
                    "unknown".to_string()
                } else {
                    ip
                },
                user_agent: ua,
                device_label: if raw_label.trim().is_empty() {
                    parsed_label
                } else {
                    raw_label
                },
                device_kind: kind,
                created_at: r.try_get("created_at")?,
                last_seen_at: r.try_get("last_seen_at")?,
                expires_at: r.try_get("expires_at")?,
                is_current: token_hash == current_hash,
            });
        }
        Ok(out)
    }

    async fn revoke_user_session(&self, user_id: Uuid, session_id: Uuid) -> Result<bool> {
        let res = sqlx::query("DELETE FROM user_sessions WHERE user_id = $1 AND id = $2")
            .bind(user_id)
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn revoke_other_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> Result<usize> {
        let current_hash = hash_session_token(current_raw_token);
        let res = sqlx::query(
            "DELETE FROM user_sessions WHERE user_id = $1 AND token_hash <> $2",
        )
        .bind(user_id)
        .bind(&current_hash)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() as usize)
    }

    async fn delete_session(&self, raw_token: &str) -> Result<()> {
        let hashed = hash_session_token(raw_token);
        sqlx::query("DELETE FROM user_sessions WHERE token_hash = $1")
            .bind(&hashed)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn detect_login_anomaly(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
    ) -> Result<Option<String>> {
        let clean_ip = ip_address.trim();
        let clean_fp = device_fingerprint.trim();
        let rows = sqlx::query(
            "SELECT ip_address, device_fingerprint FROM user_trusted_devices WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        if rows.is_empty() {
            return Ok(None);
        }
        let ip_known = clean_ip.is_empty()
            || rows
                .iter()
                .any(|r| r.try_get::<String, _>("ip_address").unwrap_or_default() == clean_ip);
        let dev_known = clean_fp.is_empty()
            || rows.iter().any(|r| {
                r.try_get::<String, _>("device_fingerprint")
                    .unwrap_or_default()
                    == clean_fp
            });
        match (ip_known, dev_known) {
            (false, false) => Ok(Some("new_ip_and_device".to_string())),
            (false, true) => Ok(Some("new_ip".to_string())),
            (true, false) => Ok(Some("new_device".to_string())),
            (true, true) => Ok(None),
        }
    }

    async fn record_trusted_device(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
        device_label: &str,
    ) -> Result<()> {
        let clean_ip = ip_address.trim();
        let clean_fp = device_fingerprint.trim();
        if clean_ip.is_empty() && clean_fp.is_empty() {
            return Ok(());
        }
        sqlx::query(
            r#"
            INSERT INTO user_trusted_devices (id, user_id, ip_address, device_fingerprint, device_label, first_seen_at, last_seen_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (user_id, ip_address, device_fingerprint)
            DO UPDATE SET last_seen_at = NOW(), device_label = CASE WHEN $5 <> '' THEN $5 ELSE user_trusted_devices.device_label END
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(clean_ip)
        .bind(clean_fp)
        .bind(device_label.trim())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn create_login_otp_challenge(
        &self,
        user_id: Uuid,
        email: &str,
        ip_address: &str,
        user_agent: &str,
        device_label: &str,
        device_fingerprint: &str,
        anomaly_reason: &str,
    ) -> Result<(Uuid, String)> {
        let now = Utc::now();
        let expires_at = now + Duration::minutes(10);
        let id = Uuid::new_v4();
        let clean_email = email.trim().to_ascii_lowercase();
        let (raw_code, code_hash) = generate_email_verification_code(&clean_email);
        let clean_ua: String = user_agent.trim().chars().take(512).collect();

        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM login_otp_challenges WHERE user_id = $1 OR expires_at <= NOW()")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"
            INSERT INTO login_otp_challenges (
                id, user_id, email, ip_address, user_agent, device_label,
                device_fingerprint, anomaly_reason, code_hash, attempts, expires_at, created_at, last_sent_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $11)
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(&clean_email)
        .bind(ip_address.trim())
        .bind(&clean_ua)
        .bind(device_label.trim())
        .bind(device_fingerprint.trim())
        .bind(anomaly_reason.trim())
        .bind(&code_hash)
        .bind(expires_at)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((id, raw_code))
    }

    async fn resend_login_otp_challenge(
        &self,
        challenge_id: Uuid,
    ) -> Result<(UserProfileDto, String, String, String, String)> {
        let now = Utc::now();
        let row_opt = sqlx::query(
            "SELECT user_id, email, ip_address, device_label, anomaly_reason, expires_at, last_sent_at FROM login_otp_challenges WHERE id = $1",
        )
        .bind(challenge_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(
                ErrorCode::OtpChallengeExpired,
                "Verification session has expired. Please sign in again.",
            ));
        };
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
        if expires_at <= now {
            let _ = sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
                .bind(challenge_id)
                .execute(&self.pool)
                .await;
            return Err(domain_err(
                ErrorCode::OtpChallengeExpired,
                "Verification session has expired. Please sign in again.",
            ));
        }
        let last_sent_at: DateTime<Utc> = row.try_get("last_sent_at")?;
        let elapsed = (now - last_sent_at).num_seconds();
        if elapsed < 60 {
            let retry_after = (60 - elapsed).max(1);
            return Err(DomainError::new(
                ErrorCode::VerificationCodeRateLimited,
                format!(
                    "Please wait {retry_after} seconds before requesting another verification code."
                ),
            )
            .with_meta(serde_json::json!({ "retry_after_secs": retry_after }))
            .into());
        }
        let user_id: Uuid = row.try_get("user_id")?;
        let email: String = row.try_get("email")?;
        let ip_address: String = row.try_get("ip_address")?;
        let device_label: String = row.try_get("device_label")?;
        let anomaly_reason: String = row.try_get("anomaly_reason")?;
        let (raw_code, code_hash) = generate_email_verification_code(&email);

        sqlx::query(
            "UPDATE login_otp_challenges SET code_hash = $2, attempts = 0, expires_at = $3, last_sent_at = $4 WHERE id = $1",
        )
        .bind(challenge_id)
        .bind(&code_hash)
        .bind(now + Duration::minutes(10))
        .bind(now)
        .execute(&self.pool)
        .await?;

        let q_user = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
        let Some(urow) = sqlx::query(&q_user)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        let grav = self.fetch_gravatar_base().await;
        let user = Self::row_to_user(&urow, &grav)?;
        Ok((user, raw_code, ip_address, device_label, anomaly_reason))
    }

    async fn verify_login_otp_challenge(
        &self,
        challenge_id: Uuid,
        code: &str,
    ) -> Result<(UserProfileDto, String, String, String, String)> {
        let now = Utc::now();
        let clean_code = code.trim();
        let row_opt = sqlx::query(
            "SELECT user_id, email, ip_address, user_agent, device_label, device_fingerprint, code_hash, attempts, expires_at FROM login_otp_challenges WHERE id = $1",
        )
        .bind(challenge_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(
                ErrorCode::OtpChallengeInvalid,
                "Verification session is invalid or has expired.",
            ));
        };
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
        if expires_at <= now {
            let _ = sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
                .bind(challenge_id)
                .execute(&self.pool)
                .await;
            return Err(domain_err(
                ErrorCode::OtpChallengeExpired,
                "Verification code has expired. Please request a new code.",
            ));
        }
        let attempts: i32 = row.try_get("attempts").unwrap_or(0);
        if attempts >= 5 {
            let _ = sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
                .bind(challenge_id)
                .execute(&self.pool)
                .await;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please sign in again.",
            ));
        }
        let email: String = row.try_get("email")?;
        let expected_hash: String = row.try_get("code_hash")?;
        let candidate = hash_email_verification_code(&email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate) {
            if attempts + 1 >= 5 {
                let _ = sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
                    .bind(challenge_id)
                    .execute(&self.pool)
                    .await;
            } else {
                let _ = sqlx::query(
                    "UPDATE login_otp_challenges SET attempts = attempts + 1 WHERE id = $1",
                )
                .bind(challenge_id)
                .execute(&self.pool)
                .await;
            }
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Invalid verification code. Please check your email and try again.",
            ));
        }
        let user_id: Uuid = row.try_get("user_id")?;
        let ip_address: String = row.try_get("ip_address")?;
        let user_agent: String = row.try_get("user_agent")?;
        let device_label: String = row.try_get("device_label")?;
        let device_fingerprint: String = row.try_get("device_fingerprint")?;

        let _ = sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
            .bind(challenge_id)
            .execute(&self.pool)
            .await;

        let q_user = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
        let Some(urow) = sqlx::query(&q_user)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        let banned: bool = urow.try_get("is_banned").unwrap_or(false);
        if banned {
            return Err(domain_err(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            ));
        }
        let grav = self.fetch_gravatar_base().await;
        let user = Self::row_to_user(&urow, &grav)?;
        Ok((user, ip_address, user_agent, device_label, device_fingerprint))
    }

    async fn delete_login_otp_challenge(&self, challenge_id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
            .bind(challenge_id)
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
        let grav = self.fetch_gravatar_base().await;
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
                           s.owner_user_id, s.author_name, s.takedown_reason, s.takedown_at, s.takedown_by,
                           COALESCE(st_req.title, st_def.title, s.slug) AS title,
                           COALESCE(st_req.author_name, st_def.author_name, s.author_name, '') AS tr_author
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
                    let owner_id: Option<Uuid> = sr.try_get("owner_user_id").ok().flatten();
                    let tr_author: String = sr.try_get("tr_author").unwrap_or_default();
                    let crev: i32 = sr.try_get::<i32, _>("canonical_revision")?.max(1);

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

                    let authors = self
                        .load_step_authors(s_id, owner_id, &tr_author, &grav)
                        .await?;

                    steps.push(StudioStepRowDto {
                        step_id: s_id,
                        slug: sr.try_get("slug")?,
                        step_number: sr.try_get("step_number")?,
                        title: sr.try_get("title")?,
                        canonical_revision: crev,
                        version: crev,
                        estimated_minutes: sr.try_get("estimated_minutes")?,
                        authors,
                        takedown_reason: sr.try_get("takedown_reason").ok().flatten(),
                        takedown_at: sr.try_get("takedown_at").ok().flatten(),
                        takedown_by: sr.try_get("takedown_by").ok().flatten(),
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
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<StudioStepEditorDto> {
        let step_row = sqlx::query(
            r#"
            SELECT s.id, s.step_number, s.estimated_minutes, s.canonical_revision, s.default_locale,
                   s.owner_user_id, s.author_name, s.takedown_reason, s.takedown_at, s.takedown_by
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
                estimated_minutes: 1,
                synced_revision: 1,
                canonical_revision: 1,
                version: 1,
                status: "published".to_string(),
                license: String::new(),
                tags: Vec::new(),
                body_markdown: String::new(),
                owner_user_id: Some(viewer.id),
                authors: vec![ArticleAuthorDto {
                    user_id: Some(viewer.id),
                    username: viewer.username.clone(),
                    display_name: viewer.display_name.clone(),
                    avatar_url: viewer.avatar_url.clone(),
                    is_owner: true,
                }],
                pending_invites: Vec::new(),
                can_manage_collaborators: false,
                takedown_reason: None,
                takedown_at: None,
                takedown_by: None,
            });
        };

        let step_id: Uuid = sr.try_get("id")?;
        let step_number: i32 = sr.try_get("step_number")?;
        let estimated_minutes: i32 = sr.try_get("estimated_minutes")?;
        let canonical_revision: i32 = sr.try_get::<i32, _>("canonical_revision")?.max(1);
        let default_locale: String = sr.try_get("default_locale")?;
        let owner_user_id: Option<Uuid> = sr.try_get("owner_user_id").ok().flatten();
        let step_author_name: String = sr.try_get("author_name").unwrap_or_default();
        let takedown_reason: Option<String> = sr.try_get("takedown_reason").ok().flatten();
        let takedown_at: Option<DateTime<Utc>> = sr.try_get("takedown_at").ok().flatten();
        let takedown_by: Option<String> = sr.try_get("takedown_by").ok().flatten();

        let can_manage_collaborators = viewer.role.is_admin()
            || owner_user_id.is_none()
            || owner_user_id == Some(viewer.id);

        let inv_rows = if can_manage_collaborators {
            sqlx::query(
                "SELECT id, email, created_at, expires_at FROM collaboration_invites WHERE step_id = $1 AND expires_at > NOW() ORDER BY created_at DESC",
            )
            .bind(step_id)
            .fetch_all(&self.pool)
            .await?
        } else {
            Vec::new()
        };
        let pending_invites: Vec<CollaboratorInviteDto> = inv_rows
            .into_iter()
            .filter_map(|ir| {
                Some(CollaboratorInviteDto {
                    id: ir.try_get("id").ok()?,
                    email: ir.try_get("email").ok()?,
                    created_at: ir.try_get("created_at").ok()?,
                    expires_at: ir.try_get("expires_at").ok()?,
                })
            })
            .collect();

        let grav = self.fetch_gravatar_base().await;

        let tr_opt = sqlx::query(
            "SELECT title, summary, license, author_name, tags, raw_markdown, synced_revision, status FROM step_translations WHERE step_id = $1 AND locale_code = $2",
        )
        .bind(step_id)
        .bind(locale)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(tr) = tr_opt {
            let raw: String = tr.try_get("raw_markdown")?;
            let raw_lic: String = tr.try_get("license").unwrap_or_default();
            let tr_auth: String = tr.try_get("author_name").unwrap_or_default();
            let fb_auth = if !tr_auth.trim().is_empty() {
                tr_auth
            } else {
                step_author_name
            };
            let synced_rev: i32 = tr.try_get::<i32, _>("synced_revision")?.max(1);
            let authors = self
                .load_step_authors(step_id, owner_user_id, &fb_auth, &grav)
                .await?;
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
                synced_revision: synced_rev,
                canonical_revision,
                version: synced_rev,
                status: tr.try_get("status")?,
                license: icehandnote_core::normalize_license_code(&raw_lic),
                tags: tr.try_get("tags")?,
                body_markdown: extract_body_without_frontmatter(&raw),
                owner_user_id,
                authors,
                pending_invites,
                can_manage_collaborators,
                takedown_reason,
                takedown_at,
                takedown_by,
            });
        }

        let fallback_tr = sqlx::query(
            "SELECT license, author_name, tags, raw_markdown FROM step_translations WHERE step_id = $1 ORDER BY CASE WHEN locale_code = $2 THEN 0 ELSE 1 END, locale_code LIMIT 1",
        )
        .bind(step_id)
        .bind(&default_locale)
        .fetch_optional(&self.pool)
        .await?;

        let (prefill_license, prefill_tags, prefill_body, fb_auth) = if let Some(fb) = fallback_tr {
            let lic: String = fb.try_get("license").unwrap_or_default();
            let tgs: Vec<String> = fb.try_get("tags").unwrap_or_default();
            let raw: String = fb.try_get("raw_markdown").unwrap_or_default();
            let au: String = fb.try_get("author_name").unwrap_or_default();
            (
                icehandnote_core::normalize_license_code(&lic),
                tgs,
                extract_body_without_frontmatter(&raw),
                au,
            )
        } else {
            (String::new(), Vec::new(), String::new(), step_author_name)
        };

        let authors = self
            .load_step_authors(step_id, owner_user_id, &fb_auth, &grav)
            .await?;

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
            version: canonical_revision,
            status: "draft".to_string(),
            license: prefill_license,
            tags: prefill_tags,
            body_markdown: prefill_body,
            owner_user_id,
            authors,
            pending_invites,
            can_manage_collaborators,
            takedown_reason,
            takedown_at,
            takedown_by,
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

        let existing_step = sqlx::query(
            "SELECT id, canonical_revision, owner_user_id, takedown_reason FROM steps WHERE chapter_id = $1 AND slug = $2",
        )
        .bind(ch_id)
        .bind(&input.step_slug)
        .fetch_optional(&self.pool)
        .await?;

        let clean_status = if input.status == "draft" {
            "draft"
        } else {
            "published"
        };
        let predicted_minutes = estimate_reading_minutes(&input.body_markdown);

        let (step_id, next_version) = if let Some(sr) = existing_step {
            let sid: Uuid = sr.try_get("id")?;
            if !self.can_edit_step(author, sid).await? {
                return Err(domain_err(
                    ErrorCode::StepEditForbidden,
                    "You do not have permission to edit this article.",
                ));
            }
            let td_reason: Option<String> = sr.try_get("takedown_reason").ok().flatten();
            if td_reason.is_some() && clean_status == "published" && !author.role.is_admin() {
                return Err(domain_err(
                    ErrorCode::StepTakenDown,
                    "This article has been taken down by an administrator. Save as draft and contact an administrator to restore it.",
                ));
            }
            let prev_ver: Option<i32> = sqlx::query_scalar(
                "SELECT synced_revision FROM step_translations WHERE step_id = $1 AND locale_code = $2",
            )
            .bind(sid)
            .bind(&input.locale)
            .fetch_optional(&self.pool)
            .await?;

            let crev: i32 = sr.try_get::<i32, _>("canonical_revision")?.max(1);
            let next_v = match prev_ver {
                Some(pv) if clean_status == "published" => pv.max(1) + 1,
                Some(pv) => pv.max(1),
                None => 1,
            };
            let next_c = crev.max(next_v);
            sqlx::query(
                r#"
                UPDATE steps
                SET step_number = $2,
                    estimated_minutes = $3,
                    canonical_revision = $4,
                    owner_user_id = COALESCE(owner_user_id, $5),
                    author_name = CASE WHEN author_name = '' THEN $6 ELSE author_name END
                WHERE id = $1
                "#,
            )
            .bind(sid)
            .bind(input.step_number)
            .bind(predicted_minutes)
            .bind(next_c)
            .bind(author.id)
            .bind(&author.display_name)
            .execute(&self.pool)
            .await?;
            (sid, next_v)
        } else {
            let sid = deterministic_uuid(&format!(
                "step:{}:{}:{}",
                input.track_slug, input.chapter_slug, input.step_slug
            ));
            sqlx::query(
                r#"
                INSERT INTO steps (id, chapter_id, slug, step_number, default_locale, canonical_revision, estimated_minutes, owner_user_id, author_name)
                VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)
                "#,
            )
            .bind(sid)
            .bind(ch_id)
            .bind(&input.step_slug)
            .bind(input.step_number)
            .bind(&input.locale)
            .bind(predicted_minutes)
            .bind(author.id)
            .bind(&author.display_name)
            .execute(&self.pool)
            .await?;
            (sid, 1)
        };

        let clean_license = icehandnote_core::normalize_license_code(&input.license);
        let raw_md = format_step_markdown_file_with_author(
            &input.title,
            &input.summary,
            input.step_number,
            predicted_minutes,
            next_version,
            next_version,
            clean_status,
            &clean_license,
            &author.display_name,
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
        .bind(&compiled.frontmatter.title)
        .bind(&compiled.frontmatter.summary)
        .bind(&clean_license)
        .bind(&input.tags)
        .bind(&raw_md)
        .bind(blocks_json)
        .bind(toc_json)
        .bind(&compiled.plain_text)
        .bind(next_version)
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

        self.studio_get_step_editor(
            author,
            &input.track_slug,
            &input.chapter_slug,
            &input.step_slug,
            &input.locale,
        )
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

        let clean_title = icehandnote_core::sanitize_custom_html(&input.title_zh_tw, 240);
        let clean_sub = icehandnote_core::sanitize_custom_html(&input.subtitle_zh_tw, 360);
        let clean_desc = icehandnote_core::sanitize_custom_html(&input.description_zh_tw, 800);

        for loc in ["zh-CN", "en", "zh-TW", "ja"] {
            sqlx::query(
                "INSERT INTO track_translations (track_id, locale_code, title, subtitle, description) VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(track_id)
            .bind(loc)
            .bind(&clean_title)
            .bind(&clean_sub)
            .bind(&clean_desc)
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
        Ok(all
            .into_iter()
            .find(|t| t.slug == input.slug)
            .expect("newly created track must exist"))
    }

    async fn studio_delete_track(&self, track_slug: &str, content_dir: &Path) -> Result<bool> {
        let clean = track_slug.trim();
        if clean.is_empty() || clean.contains("..") || clean.contains('/') || clean.contains('\\') {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid track slug."));
        }
        let res = sqlx::query("DELETE FROM tracks WHERE slug = $1")
            .bind(clean)
            .execute(&self.pool)
            .await?;
        let track_dir = content_dir.join(clean);
        if track_dir.exists() {
            let _ = fs::remove_dir_all(&track_dir);
        }
        Ok(res.rows_affected() > 0)
    }

    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        content_dir: &Path,
    ) -> Result<()> {
        let trow = sqlx::query("SELECT id FROM tracks WHERE slug = $1")
            .bind(&input.track_slug)
            .fetch_one(&self.pool)
            .await?;
        let track_id: Uuid = trow.try_get("id")?;
        let ch_id = deterministic_uuid(&format!("chapter:{}:{}", input.track_slug, input.slug));
        let clean_title = icehandnote_core::sanitize_custom_html(&input.title_zh_tw, 240);

        sqlx::query(
            "INSERT INTO chapters (id, track_id, slug, chapter_number) VALUES ($1, $2, $3, $4)",
        )
        .bind(ch_id)
        .bind(track_id)
        .bind(&input.slug)
        .bind(input.number)
        .execute(&self.pool)
        .await?;

        for loc in ["zh-CN", "en", "zh-TW", "ja"] {
            sqlx::query(
                "INSERT INTO chapter_translations (chapter_id, locale_code, title) VALUES ($1, $2, $3)",
            )
            .bind(ch_id)
            .bind(loc)
            .bind(&clean_title)
            .execute(&self.pool)
            .await?;
        }
        let _ = fs::create_dir_all(content_dir.join(&input.track_slug).join(&input.slug));
        Ok(())
    }

    async fn studio_delete_chapter(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        content_dir: &Path,
    ) -> Result<bool> {
        let clean_t = track_slug.trim();
        let clean_c = chapter_slug.trim();
        if clean_t.contains("..") || clean_c.contains("..") {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid path slug."));
        }
        let res = sqlx::query(
            "DELETE FROM chapters c USING tracks t WHERE c.track_id = t.id AND t.slug = $1 AND c.slug = $2",
        )
        .bind(clean_t)
        .bind(clean_c)
        .execute(&self.pool)
        .await?;
        let ch_dir = content_dir.join(clean_t).join(clean_c);
        if ch_dir.exists() {
            let _ = fs::remove_dir_all(&ch_dir);
        }
        Ok(res.rows_affected() > 0)
    }

    async fn studio_delete_step(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> Result<bool> {
        if !actor.role.is_admin() {
            let owner_opt: Option<Option<Uuid>> = sqlx::query_scalar(
                r#"
                SELECT s.owner_user_id
                FROM steps s
                JOIN chapters c ON c.id = s.chapter_id
                JOIN tracks t ON t.id = c.track_id
                WHERE t.slug = $1 AND c.slug = $2 AND s.slug = $3
                "#,
            )
            .bind(track_slug)
            .bind(chapter_slug)
            .bind(step_slug)
            .fetch_optional(&self.pool)
            .await?;
            if let Some(Some(oid)) = owner_opt {
                if oid != actor.id {
                    return Err(domain_err(
                        ErrorCode::StepDeleteForbidden,
                        "Only the article owner or an administrator can delete this article.",
                    ));
                }
            }
        }

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

    async fn create_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        email: &str,
    ) -> Result<(CollaboratorInviteDto, String, String)> {
        let Some(clean_email) = icehandnote_core::auth::validate_and_normalize_email(email) else {
            return Err(domain_err(
                ErrorCode::InvalidEmail,
                "Please provide a valid email address.",
            ));
        };
        let clean_email = clean_email.as_str();
        let srow_opt = sqlx::query(
            r#"
            SELECT s.id, s.owner_user_id,
                   COALESCE((SELECT title FROM step_translations st WHERE st.step_id = s.id ORDER BY CASE WHEN st.locale_code = s.default_locale THEN 0 ELSE 1 END LIMIT 1), s.slug) AS title
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id
            WHERE t.slug = $1 AND c.slug = $2 AND s.slug = $3
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .fetch_optional(&self.pool)
        .await?;
        let Some(srow) = srow_opt else {
            return Err(domain_err(
                ErrorCode::StepSaveRequired,
                "Please save the article before inviting collaborators.",
            ));
        };
        let step_id: Uuid = srow.try_get("id")?;
        let owner_opt: Option<Uuid> = srow.try_get("owner_user_id").ok().flatten();
        let step_title: String = srow.try_get("title")?;

        if !actor.role.is_admin() && owner_opt.is_some() && owner_opt != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::InviteForbidden,
                "Only the article owner or an administrator can send collaboration invites.",
            ));
        }
        if owner_opt.is_none() {
            sqlx::query("UPDATE steps SET owner_user_id = $2 WHERE id = $1 AND owner_user_id IS NULL")
                .bind(step_id)
                .bind(actor.id)
                .execute(&self.pool)
                .await?;
        }

        let _ = sqlx::query("DELETE FROM collaboration_invites WHERE expires_at <= NOW()")
            .execute(&self.pool)
            .await;

        let (raw_token, token_hash) = generate_action_token("ihn_inv", "collab_invite_v1");
        let id = Uuid::new_v4();
        let now = Utc::now();
        let expires_at = now + Duration::days(7);

        sqlx::query(
            r#"
            INSERT INTO collaboration_invites (id, step_id, email, token_hash, invited_by, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(id)
        .bind(step_id)
        .bind(clean_email)
        .bind(&token_hash)
        .bind(actor.id)
        .bind(expires_at)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok((
            CollaboratorInviteDto {
                id,
                email: clean_email.to_string(),
                created_at: now,
                expires_at,
            },
            raw_token,
            step_title,
        ))
    }

    async fn revoke_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        invite_id: Uuid,
    ) -> Result<bool> {
        let row_opt = sqlx::query(
            "SELECT ci.step_id, s.owner_user_id FROM collaboration_invites ci JOIN steps s ON s.id = ci.step_id WHERE ci.id = $1",
        )
        .bind(invite_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row_opt else {
            return Ok(false);
        };
        let owner: Option<Uuid> = row.try_get("owner_user_id").ok().flatten();
        if !actor.role.is_admin() && owner.is_some() && owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::InviteForbidden,
                "You do not have permission to revoke this invitation.",
            ));
        }
        let res = sqlx::query("DELETE FROM collaboration_invites WHERE id = $1")
            .bind(invite_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn accept_collaborator_invite(
        &self,
        user: &UserProfileDto,
        raw_token: &str,
    ) -> Result<(String, String, String)> {
        let token_hash = hash_action_token("collab_invite_v1", raw_token);
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM collaboration_invites WHERE expires_at <= NOW()")
            .execute(&mut *tx)
            .await?;

        let step_id_opt: Option<Uuid> = sqlx::query_scalar(
            "DELETE FROM collaboration_invites WHERE token_hash = $1 RETURNING step_id",
        )
        .bind(&token_hash)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(step_id) = step_id_opt else {
            return Err(domain_err(
                ErrorCode::InviteInvalid,
                "Collaboration invitation link is invalid or has expired.",
            ));
        };

        let loc_opt = sqlx::query(
            r#"
            SELECT t.slug AS track_slug, c.slug AS chapter_slug, s.slug AS step_slug
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id
            WHERE s.id = $1
            "#,
        )
        .bind(step_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(loc) = loc_opt else {
            return Err(domain_err(
                ErrorCode::InviteTargetDeleted,
                "The invited article no longer exists.",
            ));
        };

        sqlx::query(
            "INSERT INTO step_collaborators (step_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(step_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("UPDATE users SET role = 'author' WHERE id = $1 AND role = 'reader'")
            .bind(user.id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok((
            loc.try_get("track_slug")?,
            loc.try_get("chapter_slug")?,
            loc.try_get("step_slug")?,
        ))
    }

    async fn remove_step_collaborator(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> Result<bool> {
        let srow_opt = sqlx::query(
            r#"
            SELECT s.id, s.owner_user_id
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id
            WHERE t.slug = $1 AND c.slug = $2 AND s.slug = $3
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .fetch_optional(&self.pool)
        .await?;
        let Some(srow) = srow_opt else {
            return Ok(false);
        };
        let step_id: Uuid = srow.try_get("id")?;
        let owner: Option<Uuid> = srow.try_get("owner_user_id").ok().flatten();
        if !actor.role.is_admin() && owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Only the article owner or an administrator can remove collaborators.",
            ));
        }
        let res = sqlx::query(
            "DELETE FROM step_collaborators WHERE step_id = $1 AND user_id = $2",
        )
        .bind(step_id)
        .bind(target_user_id)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn admin_takedown_step(
        &self,
        admin: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        reason: &str,
    ) -> Result<(String, Vec<UserProfileDto>)> {
        let clean_reason = reason.trim();
        if clean_reason.is_empty() {
            return Err(domain_err(
                ErrorCode::TakedownReasonRequired,
                "A takedown reason is required.",
            ));
        }
        let srow_opt = sqlx::query(
            r#"
            UPDATE steps s
            SET takedown_reason = $4,
                takedown_at = NOW(),
                takedown_by = $5
            FROM chapters c, tracks t
            WHERE s.chapter_id = c.id AND c.track_id = t.id
              AND t.slug = $1 AND c.slug = $2 AND s.slug = $3
            RETURNING s.id, s.owner_user_id,
              COALESCE((SELECT title FROM step_translations st WHERE st.step_id = s.id ORDER BY CASE WHEN st.locale_code = s.default_locale THEN 0 ELSE 1 END LIMIT 1), s.slug) AS title
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .bind(clean_reason)
        .bind(&admin.display_name)
        .fetch_optional(&self.pool)
        .await?;
        let Some(srow) = srow_opt else {
            return Err(domain_err(ErrorCode::StepNotFound, "Article not found."));
        };
        let step_id: Uuid = srow.try_get("id")?;
        let owner_id: Option<Uuid> = srow.try_get("owner_user_id").ok().flatten();
        let title: String = srow.try_get("title")?;

        let q = format!(
            r#"
            SELECT {USER_SELECT_COLS}
            FROM users
            WHERE id = $1
               OR id IN (SELECT user_id FROM step_collaborators WHERE step_id = $2)
            "#
        );
        let urows = sqlx::query(&q)
            .bind(owner_id)
            .bind(step_id)
            .fetch_all(&self.pool)
            .await?;
        let grav = self.fetch_gravatar_base().await;
        let mut recipients = Vec::new();
        for ur in urows {
            recipients.push(Self::row_to_user(&ur, &grav)?);
        }
        Ok((title, recipients))
    }

    async fn admin_restore_step(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<bool> {
        let res = sqlx::query(
            r#"
            UPDATE steps s
            SET takedown_reason = NULL,
                takedown_at = NULL,
                takedown_by = NULL
            FROM chapters c, tracks t
            WHERE s.chapter_id = c.id AND c.track_id = t.id
              AND t.slug = $1 AND c.slug = $2 AND s.slug = $3
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .execute(&self.pool)
        .await?;
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

    async fn admin_create_user(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto> {
        let clean_username = username.trim();
        let clean_email = email.trim();
        let user_taken: Option<i32> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)")
                .bind(clean_username)
                .fetch_optional(&self.pool)
                .await?;
        if user_taken.is_some() {
            return Err(domain_err(
                ErrorCode::UsernameTaken,
                "Username is already taken.",
            ));
        }
        if !clean_email.is_empty() {
            let email_taken: Option<i32> =
                sqlx::query_scalar("SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)")
                    .bind(clean_email)
                    .fetch_optional(&self.pool)
                    .await?;
            if email_taken.is_some() {
                return Err(domain_err(
                    ErrorCode::EmailTaken,
                    "Email address is already in use.",
                ));
            }
        }
        let eff_email = if clean_email.is_empty() {
            format!("{clean_username}@localhost")
        } else {
            clean_email.to_string()
        };
        let eff_display = if display_name.trim().is_empty() {
            clean_username
        } else {
            display_name.trim()
        };
        let pw_hash = hash_password(clean_username, password);
        let q = format!(
            r#"
            INSERT INTO users (username, display_name, email, bio, role, auth_source, password_hash)
            VALUES ($1, $2, $3, '', $4, 'local', $5)
            RETURNING {USER_SELECT_COLS}
            "#
        );
        let row = sqlx::query(&q)
            .bind(clean_username)
            .bind(eff_display)
            .bind(&eff_email)
            .bind(role.as_str())
            .bind(&pw_hash)
            .fetch_one(&self.pool)
            .await?;
        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&row, &grav)
    }

    async fn admin_list_users(&self) -> Result<Vec<UserProfileDto>> {
        let q = format!("SELECT {USER_SELECT_COLS} FROM users ORDER BY created_at ASC");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        let grav = self.fetch_gravatar_base().await;
        let mut list = Vec::with_capacity(rows.len());
        for r in rows {
            list.push(Self::row_to_user(&r, &grav)?);
        }
        Ok(list)
    }

    async fn admin_update_user_role(
        &self,
        target_user_id: Uuid,
        new_role: UserRole,
    ) -> Result<Option<UserProfileDto>> {
        let q = format!(
            "UPDATE users SET role = $2 WHERE id = $1 RETURNING {USER_SELECT_COLS}"
        );
        let row_opt = sqlx::query(&q)
            .bind(target_user_id)
            .bind(new_role.as_str())
            .fetch_optional(&self.pool)
            .await?;

        match row_opt {
            Some(r) => {
                let grav = self.fetch_gravatar_base().await;
                Ok(Some(Self::row_to_user(&r, &grav)?))
            }
            None => Ok(None),
        }
    }

    async fn admin_set_user_ban(
        &self,
        target_user_id: Uuid,
        banned: bool,
        reason: &str,
    ) -> Result<Option<UserProfileDto>> {
        let clean_reason: String = if banned {
            reason.trim().chars().take(240).collect()
        } else {
            String::new()
        };
        let q = format!(
            "UPDATE users SET is_banned = $2, ban_reason = $3 WHERE id = $1 RETURNING {USER_SELECT_COLS}"
        );
        let row_opt = sqlx::query(&q)
            .bind(target_user_id)
            .bind(banned)
            .bind(&clean_reason)
            .fetch_optional(&self.pool)
            .await?;

        if banned {
            sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
                .bind(target_user_id)
                .execute(&self.pool)
                .await?;
        }
        match row_opt {
            Some(r) => {
                let grav = self.fetch_gravatar_base().await;
                Ok(Some(Self::row_to_user(&r, &grav)?))
            }
            None => Ok(None),
        }
    }

    async fn admin_delete_user(&self, target_user_id: Uuid) -> Result<bool> {
        let res = sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(target_user_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn admin_reset_user_password(
        &self,
        target_user_id: Uuid,
        new_password: &str,
    ) -> Result<Option<UserProfileDto>> {
        let q_sel = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
        let Some(row) = sqlx::query(&q_sel)
            .bind(target_user_id)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Ok(None);
        };
        let username: String = row.try_get("username")?;
        let pw_hash = hash_password(&username, new_password);
        sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
            .bind(target_user_id)
            .bind(&pw_hash)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
            .bind(target_user_id)
            .execute(&self.pool)
            .await?;
        let grav = self.fetch_gravatar_base().await;
        Ok(Some(Self::row_to_user(&row, &grav)?))
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
            INSERT INTO site_settings (id, settings, updated_by, updated_at)
            VALUES (1, $1, $2, NOW())
            ON CONFLICT (id) DO UPDATE
            SET settings = EXCLUDED.settings,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
            "#,
        )
        .bind(json_val)
        .bind(updated_by)
        .execute(&self.pool)
        .await?;
        Ok(clean)
    }
}
