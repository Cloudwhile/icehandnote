use crate::{
    content_loader::{deterministic_uuid, ContentBundle},
    domain_err, if_match_satisfies, note_quota_for_owner, precondition_failed_err,
    revision_conflict_err,
    studio_auth::generate_raw_session_token,
    TutorialRepository, NOTE_UNDO_GRACE_MINUTES,
};
use anyhow::Result;
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use icehandnote_core::{
    auth::{
        compute_step_content_sha256_with_cover, compute_step_etag, constant_time_str_eq,
        evaluate_login_anomaly, extract_body_without_frontmatter,
        generate_action_token,
        generate_email_verification_code, generate_uuid_v7, hash_action_token,
        hash_email_verification_code,
        hash_password, hash_session_token, mask_email_address, normalize_avatar_source,
        normalize_client_ip, normalize_collaborator_role, normalize_locale_scope,
        normalize_track_icon_kind, parse_user_agent_device, sanitize_track_custom_label,
        sanitize_track_tags, verify_password, ArticleAuthorDto,
        BlogSsoClaims, CollaborationAuditLogDto, CollaboratorInviteDto, CreateChapterInput,
        CreateTrackInput, InvitePreviewDto, SaveStudioStepInput, SiteSettingsDto, StepRevisionDto,
        StudioChapterDto, StudioLocaleBadgeDto, StudioStepEditorDto, StudioStepRowDto,
        StudioTrackDto, UpdateTrackMetaInput, UpdateUserProfileInput, UserPasskeyDto,
        UserProfileDto, UserRole, UserSessionDto, TRUSTED_DEVICE_TTL_DAYS,
    },
    build_highlighted_snippet, compile_notebook_markdown,
    error::{DomainError, ErrorCode},
    normalize_note_motivation, normalize_note_visuals,
    reading_time::estimate_reading_minutes, sanitize_cover_image_url, sanitize_user_note,
    validate_user_note_content,
    webauthn::StoredPasskeyCredential,
    AnnotationTarget, ArticleTaskChecksDto, ChapterNavDto, CreateMarginNoteInput,
    LearnerProgressDto, ListMarginNotesFilter, NotebookBlock, SearchHitDto, StepDetailDto,
    StepNavItemDto, StepNeighborDto, TocItem, TrackArticleCardDto, TrackSummaryDto,
    UpdateMarginNoteInput, UserMarginNoteDto,
};
use sqlx::{postgres::PgRow, PgPool, Row};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};
use uuid::Uuid;

const USER_SELECT_COLS: &str = "id, wp_user_id, username, display_name, email, avatar_url, \
    avatar_source, oauth_avatar_url, uploaded_avatar_url, oauth_provider, bio, role, \
    auth_source, is_banned, ban_reason, last_login_at, \
    (password_hash IS NOT NULL AND password_hash <> '') AS has_password, \
    (EXISTS (SELECT 1 FROM step_collaborators sc WHERE sc.user_id = users.id) OR EXISTS (SELECT 1 FROM steps s WHERE s.owner_user_id = users.id)) AS has_collaborations, \
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

        sqlx::raw_sql(
            "CREATE TABLE IF NOT EXISTS _icehandnote_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
        )
        .execute(&pool)
        .await?;

        for (name, sql) in [
            ("0001_init_schema.sql", include_str!("../migrations/0001_init_schema.sql")),
            ("0002_users_and_studio.sql", include_str!("../migrations/0002_users_and_studio.sql")),
            ("0003_site_settings.sql", include_str!("../migrations/0003_site_settings.sql")),
            ("0004_task_step_checks.sql", include_str!("../migrations/0004_task_step_checks.sql")),
            ("0005_drop_glossary.sql", include_str!("../migrations/0005_drop_glossary.sql")),
            ("0006_step_license.sql", include_str!("../migrations/0006_step_license.sql")),
            ("0007_oauth_identity.sql", include_str!("../migrations/0007_oauth_identity.sql")),
            ("0008_collaboration_and_moderation.sql", include_str!("../migrations/0008_collaboration_and_moderation.sql")),
            ("0009_email_verification_codes.sql", include_str!("../migrations/0009_email_verification_codes.sql")),
            ("0010_sessions_and_login_otp.sql", include_str!("../migrations/0010_sessions_and_login_otp.sql")),
            ("0011_multi_oauth_and_passkeys.sql", include_str!("../migrations/0011_multi_oauth_and_passkeys.sql")),
            ("0012_step_published_at.sql", include_str!("../migrations/0012_step_published_at.sql")),
            ("0013_annotations_and_notes.sql", include_str!("../migrations/0013_annotations_and_notes.sql")),
            ("0014_collaboration_rfc.sql", include_str!("../migrations/0014_collaboration_rfc.sql")),
            ("0015_hardening_and_indexes.sql", include_str!("../migrations/0015_hardening_and_indexes.sql")),
            ("0016_step_cover_image.sql", include_str!("../migrations/0016_step_cover_image.sql")),
            ("0017_track_custom_label.sql", include_str!("../migrations/0017_track_custom_label.sql")),
        ] {
            let applied: Option<i32> =
                sqlx::query_scalar("SELECT 1 FROM _icehandnote_migrations WHERE name = $1")
                    .bind(name)
                    .fetch_optional(&pool)
                    .await?;
            if applied.is_none() {
                sqlx::raw_sql(sql).execute(&pool).await?;
                sqlx::query(
                    "INSERT INTO _icehandnote_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
                )
                .bind(name)
                .execute(&pool)
                .await?;
            }
        }

        if seed_demo_users {
            for rec in crate::studio_auth::default_seeded_blog_users() {
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

    pub async fn ping_readonly(database_url: &str) -> Result<()> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(database_url)
            .await?;
        let _: i32 = sqlx::query_scalar("SELECT 1").fetch_one(&pool).await?;
        pool.close().await;
        Ok(())
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
            has_collaborations: r.try_get("has_collaborations").unwrap_or(false),
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
                    role: "owner".to_string(),
                    locale_scope: Vec::new(),
                });
            }
        }

        let collab_q = "SELECT u.id, u.wp_user_id, u.username, u.display_name, u.email, u.avatar_url, \
             u.avatar_source, u.oauth_avatar_url, u.uploaded_avatar_url, u.oauth_provider, u.bio, \
             u.role, u.auth_source, u.is_banned, u.ban_reason, u.last_login_at, \
             sc.role AS collab_role, sc.locale_scope AS collab_locale_scope \
             FROM step_collaborators sc JOIN users u ON u.id = sc.user_id \
             WHERE sc.step_id = $1 ORDER BY sc.added_at ASC";
        let crows = sqlx::query(collab_q)
            .bind(step_id)
            .fetch_all(&self.pool)
            .await?;
        for cr in crows {
            let dto = Self::row_to_user(&cr, gravatar_base)?;
            if authors.iter().any(|a| a.user_id == Some(dto.id)) {
                continue;
            }
            let c_role: String = cr
                .try_get::<String, _>("collab_role")
                .unwrap_or_else(|_| "editor".to_string());
            let c_scope: Vec<String> = cr.try_get("collab_locale_scope").unwrap_or_default();
            authors.push(ArticleAuthorDto {
                user_id: Some(dto.id),
                username: dto.username,
                display_name: dto.display_name,
                avatar_url: dto.avatar_url,
                is_owner: false,
                role: normalize_collaborator_role(Some(&c_role)),
                locale_scope: c_scope,
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
                role: "owner".to_string(),
                locale_scope: Vec::new(),
            });
        }

        Ok(authors)
    }

    async fn resolve_viewer_step_role(
        &self,
        actor: &UserProfileDto,
        step_id: Uuid,
        owner_opt: Option<Uuid>,
    ) -> Result<(String, Vec<String>)> {
        if actor.role.is_admin() {
            return Ok(("admin".to_string(), Vec::new()));
        }
        if owner_opt == Some(actor.id) {
            return Ok(("owner".to_string(), Vec::new()));
        }
        let collab = sqlx::query(
            "SELECT role, locale_scope FROM step_collaborators WHERE step_id = $1 AND user_id = $2",
        )
        .bind(step_id)
        .bind(actor.id)
        .fetch_optional(&self.pool)
        .await?;
        if let Some(row) = collab {
            let role: String = row
                .try_get::<String, _>("role")
                .unwrap_or_else(|_| "editor".to_string());
            let scope: Vec<String> = row.try_get("locale_scope").unwrap_or_default();
            return Ok((normalize_collaborator_role(Some(&role)), scope));
        }
        Ok(("none".to_string(), Vec::new()))
    }

    fn check_role_can_edit_locale(role: &str, scope: &[String], locale: &str) -> Result<()> {
        match role {
            "admin" | "owner" | "editor" => Ok(()),
            "translator" => {
                if scope.is_empty() || scope.iter().any(|l| l == locale) {
                    Ok(())
                } else {
                    Err(domain_err(
                        ErrorCode::CollaboratorRoleForbidden,
                        format!(
                            "Your translator role is scoped to [{}] and cannot edit locale '{locale}'.",
                            scope.join(", ")
                        ),
                    ))
                }
            }
            "reviewer" => Err(domain_err(
                ErrorCode::CollaboratorRoleForbidden,
                "Reviewers have read-only access and cannot overwrite article content.",
            )),
            _ => Err(domain_err(
                ErrorCode::StepEditForbidden,
                "You do not have permission to edit this article.",
            )),
        }
    }

    async fn record_audit_log(
        &self,
        step_id: Uuid,
        actor: &UserProfileDto,
        action: &str,
        detail: &str,
    ) {
        let _ = sqlx::query(
            "INSERT INTO collaboration_audit_logs (id, step_id, actor_user_id, actor_name, action, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
        )
        .bind(generate_uuid_v7())
        .bind(step_id)
        .bind(actor.id)
        .bind(&actor.display_name)
        .bind(action)
        .bind(detail)
        .execute(&self.pool)
        .await;
    }

    async fn lookup_step_id_and_owner(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Option<(Uuid, String, Option<Uuid>)>> {
        let row_opt = sqlx::query(
            r#"
            SELECT s.id, c.slug AS chapter_slug, s.owner_user_id
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id AND t.slug = $1
            WHERE s.slug = $3
            ORDER BY CASE WHEN c.slug = $2 THEN 0 ELSE 1 END, c.chapter_number ASC, s.step_number ASC
            LIMIT 1
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .fetch_optional(&self.pool)
        .await?;
        match row_opt {
            Some(r) => Ok(Some((
                r.try_get("id")?,
                r.try_get("chapter_slug")?,
                r.try_get("owner_user_id").ok().flatten(),
            ))),
            None => Ok(None),
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

        let mut track_ids: Vec<Uuid> = Vec::with_capacity(rows.len());
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let tid: Uuid = r.try_get("id")?;
            track_ids.push(tid);
            let raw_diff: String = r.try_get("difficulty")?;
            let raw_icon: String = r.try_get("icon_kind")?;
            let raw_tags: Vec<String> = r.try_get("tags")?;
            out.push(TrackSummaryDto {
                id: tid,
                slug: r.try_get("slug")?,
                difficulty: sanitize_track_custom_label(&raw_diff),
                icon_kind: normalize_track_icon_kind(&raw_icon),
                title: r.try_get("title")?,
                subtitle: r.try_get("subtitle")?,
                description: r.try_get("description")?,
                tags: sanitize_track_tags(&raw_tags),
                chapter_count: r.try_get::<i64, _>("chapter_count")? as usize,
                step_count: r.try_get::<i64, _>("step_count")? as usize,
                first_chapter_slug: r.try_get("first_chapter_slug")?,
                first_step_slug: r.try_get("first_step_slug")?,
                articles: Vec::new(),
            });
        }

        if !track_ids.is_empty() {
            let art_rows = sqlx::query(
                r#"
                SELECT
                    c.track_id,
                    c.slug AS chapter_slug,
                    COALESCE(ct_req.title, ct_def.title, c.slug) AS chapter_title,
                    s.id AS step_id,
                    s.slug AS step_slug,
                    s.step_number,
                    s.estimated_minutes,
                    tr.title,
                    tr.summary,
                    COALESCE(tr.cover_image, '') AS cover_image,
                    tr.tags,
                    CASE
                        WHEN u.display_name IS NOT NULL AND u.display_name <> '' THEN u.display_name
                        WHEN tr.author_name <> '' AND tr.author_name <> 'Author' THEN tr.author_name
                        WHEN s.author_name <> '' AND s.author_name <> 'Author' THEN s.author_name
                        ELSE ''
                    END AS author_name,
                    tr.published_at
                FROM chapters c
                JOIN steps s ON s.chapter_id = c.id
                LEFT JOIN chapter_translations ct_req ON ct_req.chapter_id = c.id AND ct_req.locale_code = $1
                LEFT JOIN chapter_translations ct_def ON ct_def.chapter_id = c.id AND ct_def.locale_code = 'zh-CN'
                JOIN LATERAL (
                    SELECT title, summary, cover_image, tags, author_name, published_at
                    FROM step_translations st
                    WHERE st.step_id = s.id AND st.status = 'published'
                    ORDER BY CASE WHEN st.locale_code = $1 THEN 0 WHEN st.locale_code = s.default_locale THEN 1 ELSE 2 END, st.locale_code
                    LIMIT 1
                ) tr ON TRUE
                LEFT JOIN users u ON u.id = s.owner_user_id
                WHERE c.track_id = ANY($2)
                  AND s.takedown_reason IS NULL
                ORDER BY c.chapter_number ASC, s.step_number ASC, s.slug ASC
                "#,
            )
            .bind(locale)
            .bind(&track_ids)
            .fetch_all(&self.pool)
            .await?;

            let mut by_track: HashMap<Uuid, Vec<TrackArticleCardDto>> = HashMap::new();
            for ar in art_rows {
                let tid: Uuid = ar.try_get("track_id")?;
                let raw_cover: String = ar.try_get("cover_image").unwrap_or_default();
                by_track.entry(tid).or_default().push(TrackArticleCardDto {
                    step_id: ar.try_get("step_id")?,
                    chapter_slug: ar.try_get("chapter_slug")?,
                    chapter_title: ar.try_get("chapter_title")?,
                    step_slug: ar.try_get("step_slug")?,
                    step_number: ar.try_get("step_number")?,
                    title: ar.try_get("title")?,
                    summary: ar.try_get("summary")?,
                    cover_image: sanitize_cover_image_url(&raw_cover),
                    estimated_minutes: ar.try_get("estimated_minutes")?,
                    tags: ar.try_get("tags").unwrap_or_default(),
                    author_name: ar.try_get("author_name").unwrap_or_default(),
                    published_at: ar.try_get("published_at")?,
                });
            }
            for item in &mut out {
                if let Some(list) = by_track.remove(&item.id) {
                    item.articles = list;
                }
            }
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
                t.icon_kind AS track_icon_kind,
                COALESCE(tt_req.title, tt_def.title, t.slug) AS track_title,
                c.id AS chapter_id,
                c.slug AS chapter_slug,
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
            JOIN chapters c ON c.track_id = t.id
            JOIN steps s ON s.chapter_id = c.id AND s.slug = $3
            LEFT JOIN track_translations tt_req ON tt_req.track_id = t.id AND tt_req.locale_code = $1
            LEFT JOIN track_translations tt_def ON tt_def.track_id = t.id AND tt_def.locale_code = 'zh-CN'
            LEFT JOIN chapter_translations ct_req ON ct_req.chapter_id = c.id AND ct_req.locale_code = $1
            LEFT JOIN chapter_translations ct_def ON ct_def.chapter_id = c.id AND ct_def.locale_code = 'zh-CN'
            WHERE t.slug = $4
              AND s.takedown_reason IS NULL
              AND ($2 = '' OR $2 = '-' OR c.slug = $2)
            ORDER BY c.chapter_number ASC, s.step_number ASC
            LIMIT 1
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
        let track_icon_kind: String = sr
            .try_get::<String, _>("track_icon_kind")
            .unwrap_or_else(|_| "snowflake".to_string());
        let resolved_chapter_slug: String = sr.try_get("chapter_slug")?;
        let track_title_resolved: String = sr.try_get("track_title")?;
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
            SELECT locale_code, title, summary, COALESCE(cover_image, '') AS cover_image, license, author_name, tags, compiled_blocks, toc_tree, synced_revision, published_at, updated_at
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
                (st_req.id IS NOT NULL) AS has_req,
                (st_req.id IS NOT NULL AND GREATEST(st_req.synced_revision, 1) < GREATEST(s.canonical_revision, 1)) AS has_drift
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
            let has_drift: bool = nr.try_get("has_drift").unwrap_or(false);

            flat_steps.push((c_slug.clone(), s_slug.clone(), s_title.clone(), s_id));
            let nav_item = StepNavItemDto {
                id: s_id,
                slug: s_slug,
                step_number: s_num,
                title: s_title,
                estimated_minutes: s_mins,
                has_requested_locale: has_req,
                has_revision_drift: has_drift,
            };
            if let Some(last) = chapters.last_mut().filter(|ch| ch.slug == c_slug) {
                last.steps.push(nav_item);
            } else {
                chapters.push(ChapterNavDto {
                    slug: c_slug,
                    number: c_num,
                    title: c_title,
                    steps: vec![nav_item],
                });
            }
        }

        if chapters.is_empty() {
            chapters.push(ChapterNavDto {
                slug: resolved_chapter_slug.clone(),
                number: 1,
                title: track_title_resolved.clone(),
                steps: Vec::new(),
            });
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
        let updated_at: DateTime<Utc> = tr.try_get("updated_at")?;
        let published_at: DateTime<Utc> = tr.try_get("published_at").unwrap_or(updated_at);

        let is_fallback = resolved_locale != locale;
        let raw_cover: String = tr.try_get("cover_image").unwrap_or_default();
        Ok(Some(StepDetailDto {
            step_id,
            track_slug: track_slug.to_string(),
            track_title: track_title_resolved,
            track_icon_kind,
            chapter_slug: resolved_chapter_slug,
            chapter_title: sr.try_get("chapter_title")?,
            step_slug: step_slug.to_string(),
            step_number: sr.try_get("step_number")?,
            total_steps_in_track: flat_steps.len(),
            requested_locale: locale.to_string(),
            resolved_locale,
            is_fallback,
            available_locales,
            canonical_revision,
            synced_revision,
            version: synced_revision,
            has_revision_drift: !is_fallback && synced_revision < canonical_revision,
            estimated_minutes: sr.try_get("estimated_minutes")?,
            title: tr.try_get("title")?,
            summary: tr.try_get("summary")?,
            cover_image: sanitize_cover_image_url(&raw_cover),
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
            published_at,
            updated_at,
        }))
    }

    async fn search(&self, locale: &str, query: &str) -> Result<Vec<SearchHitDto>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = format!("%{}%", crate::escape_like_pattern(q));
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
              AND (
                  st.title ILIKE $2 ESCAPE '\'
                  OR st.plain_text ILIKE $2 ESCAPE '\'
                  OR EXISTS (SELECT 1 FROM unnest(st.tags) tg WHERE tg ILIKE $2 ESCAPE '\')
              )
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
        let (items, _) = self
            .list_margin_notes_filtered(
                learner_id,
                &ListMarginNotesFilter {
                    step_id: Some(step_id),
                    limit: 500,
                    ..Default::default()
                },
            )
            .await?;
        Ok(items)
    }

    async fn list_margin_notes_filtered(
        &self,
        learner_id: &str,
        filter: &ListMarginNotesFilter,
    ) -> Result<(Vec<UserMarginNoteDto>, usize)> {
        let limit = filter.limit.clamp(1, 500) as i64;
        let offset = filter.offset as i64;
        let locale_opt = filter
            .locale_code
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let tag_opt = filter
            .tag
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "all");
        let q_pattern = filter
            .q
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| format!("%{}%", crate::escape_like_pattern(s)));

        let total: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM user_margin_notes n
            WHERE n.learner_id = $1
              AND n.deleted_at IS NULL
              AND ($2::uuid IS NULL OR n.step_id = $2)
              AND ($3::text IS NULL OR n.locale_code = $3)
              AND ($4::text IS NULL OR n.tag = $4)
              AND ($5::text IS NULL OR n.raw_content ILIKE $5 ESCAPE '\')
            "#,
        )
        .bind(learner_id)
        .bind(filter.step_id)
        .bind(locale_opt)
        .bind(tag_opt)
        .bind(&q_pattern)
        .fetch_one(&self.pool)
        .await?;

        let order_sql = if filter.step_id.is_some() {
            "ORDER BY n.created_at ASC"
        } else {
            "ORDER BY n.updated_at DESC, n.created_at DESC"
        };

        let sql = format!(
            r#"
            SELECT n.id, n.learner_id, n.step_id, n.locale_code, n.block_anchor_id,
                   n.note_color, n.tone, n.style, n.tag, n.motivation, n.target, n.body_format,
                   n.content_html, n.raw_content, n.version, n.created_at, n.updated_at, n.deleted_at,
                   t.slug AS track_slug, c.slug AS chapter_slug, s.slug AS step_slug,
                   COALESCE(st_loc.title, st_def.title, s.slug) AS step_title
            FROM user_margin_notes n
            JOIN steps s ON s.id = n.step_id
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id
            LEFT JOIN step_translations st_loc ON st_loc.step_id = s.id AND st_loc.locale_code = n.locale_code AND st_loc.status = 'published'
            LEFT JOIN step_translations st_def ON st_def.step_id = s.id AND st_def.locale_code = s.default_locale AND st_def.status = 'published'
            WHERE n.learner_id = $1
              AND n.deleted_at IS NULL
              AND ($2::uuid IS NULL OR n.step_id = $2)
              AND ($3::text IS NULL OR n.locale_code = $3)
              AND ($4::text IS NULL OR n.tag = $4)
              AND ($5::text IS NULL OR n.raw_content ILIKE $5 ESCAPE '\')
            {order_sql}
            LIMIT $6 OFFSET $7
            "#
        );

        let rows = sqlx::query(&sql)
            .bind(learner_id)
            .bind(filter.step_id)
            .bind(locale_opt)
            .bind(tag_opt)
            .bind(&q_pattern)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        let mut notes = Vec::with_capacity(rows.len());
        for r in rows {
            let target: Option<AnnotationTarget> = r
                .try_get::<Option<serde_json::Value>, _>("target")
                .ok()
                .flatten()
                .and_then(|v| serde_json::from_value(v).ok());
            let mut dto = UserMarginNoteDto {
                id: r.try_get("id")?,
                learner_id: r.try_get("learner_id")?,
                step_id: r.try_get("step_id")?,
                locale_code: r.try_get("locale_code")?,
                block_anchor_id: r.try_get("block_anchor_id")?,
                note_color: r.try_get("note_color")?,
                tone: r.try_get("tone")?,
                style: r.try_get("style")?,
                tag: r.try_get("tag")?,
                motivation: r.try_get("motivation")?,
                target,
                body_format: r.try_get("body_format")?,
                content_html: r.try_get("content_html")?,
                raw_content: r.try_get("raw_content")?,
                version: r.try_get("version")?,
                created_at: r.try_get("created_at")?,
                updated_at: r.try_get("updated_at")?,
                deleted_at: r.try_get("deleted_at")?,
                track_slug: r.try_get("track_slug").ok(),
                chapter_slug: r.try_get("chapter_slug").ok(),
                step_slug: r.try_get("step_slug").ok(),
                step_title: r.try_get("step_title").ok(),
            };
            dto.hydrate_legacy_fields();
            notes.push(dto);
        }
        Ok((notes, total.max(0) as usize))
    }

    async fn create_margin_note(&self, input: CreateMarginNoteInput) -> Result<UserMarginNoteDto> {
        let clean_content = validate_user_note_content(&input.content)?;
        let quota = note_quota_for_owner(&input.learner_id);
        let existing_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM user_margin_notes WHERE learner_id = $1 AND step_id = $2 AND deleted_at IS NULL",
        )
        .bind(&input.learner_id)
        .bind(input.step_id)
        .fetch_one(&self.pool)
        .await?;
        if existing_count as usize >= quota {
            return Err(DomainError::new(
                ErrorCode::NoteQuotaExceeded,
                format!("Reached the maximum of {quota} notes for this article."),
            )
            .with_meta(serde_json::json!({ "quota": quota }))
            .into());
        }

        let (tone, style, tag) = normalize_note_visuals(
            input.tone.as_deref(),
            input.style.as_deref(),
            input.tag.as_deref(),
            Some(&input.note_color),
        );
        let note_color = format!("{tone}:{style}:{tag}");
        let motivation = normalize_note_motivation(input.motivation.as_deref(), &tag);
        let content_html = sanitize_user_note(&clean_content);
        let target_json = input
            .target
            .as_ref()
            .and_then(|t| serde_json::to_value(t).ok());
        let id = generate_uuid_v7();
        let now = Utc::now();
        let body_format = "text/markdown".to_string();

        sqlx::query(
            r#"
            INSERT INTO user_margin_notes (
                id, learner_id, step_id, locale_code, block_anchor_id,
                note_color, tone, style, tag, motivation, target, body_format,
                raw_content, content_html, version, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, $15, $15)
            "#,
        )
        .bind(id)
        .bind(&input.learner_id)
        .bind(input.step_id)
        .bind(&input.locale_code)
        .bind(&input.block_anchor_id)
        .bind(&note_color)
        .bind(&tone)
        .bind(&style)
        .bind(&tag)
        .bind(&motivation)
        .bind(&target_json)
        .bind(&body_format)
        .bind(&clean_content)
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
            note_color,
            tone,
            style,
            tag,
            motivation,
            target: input.target,
            body_format,
            content_html,
            raw_content: clean_content,
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: None,
            track_slug: None,
            chapter_slug: None,
            step_slug: None,
            step_title: None,
        })
    }

    async fn update_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        input: UpdateMarginNoteInput,
        expected_etag: Option<&str>,
    ) -> Result<UserMarginNoteDto> {
        let row_opt = sqlx::query(
            r#"
            SELECT id, learner_id, step_id, locale_code, block_anchor_id,
                   note_color, tone, style, tag, motivation, target, body_format,
                   content_html, raw_content, version, created_at, updated_at, deleted_at
            FROM user_margin_notes
            WHERE id = $1 AND learner_id = $2 AND deleted_at IS NULL
            "#,
        )
        .bind(note_id)
        .bind(learner_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(r) = row_opt else {
            return Err(domain_err(ErrorCode::NoteNotFound, "Note not found."));
        };

        let existing_target: Option<AnnotationTarget> = r
            .try_get::<Option<serde_json::Value>, _>("target")
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_value(v).ok());
        let mut current = UserMarginNoteDto {
            id: r.try_get("id")?,
            learner_id: r.try_get("learner_id")?,
            step_id: r.try_get("step_id")?,
            locale_code: r.try_get("locale_code")?,
            block_anchor_id: r.try_get("block_anchor_id")?,
            note_color: r.try_get("note_color")?,
            tone: r.try_get("tone")?,
            style: r.try_get("style")?,
            tag: r.try_get("tag")?,
            motivation: r.try_get("motivation")?,
            target: existing_target,
            body_format: r.try_get("body_format")?,
            content_html: r.try_get("content_html")?,
            raw_content: r.try_get("raw_content")?,
            version: r.try_get("version")?,
            created_at: r.try_get("created_at")?,
            updated_at: r.try_get("updated_at")?,
            deleted_at: r.try_get("deleted_at")?,
            track_slug: None,
            chapter_slug: None,
            step_slug: None,
            step_title: None,
        };
        current.hydrate_legacy_fields();

        if let Some(if_match) = expected_etag {
            if !if_match_satisfies(if_match, &current.etag()) {
                return Err(precondition_failed_err(if_match, &current));
            }
        }

        let (next_raw, next_html) = if let Some(ref c) = input.content {
            let validated = validate_user_note_content(c)?;
            let rendered = sanitize_user_note(&validated);
            (validated, rendered)
        } else {
            (current.raw_content.clone(), current.content_html.clone())
        };

        let (next_tone, next_style, next_tag) = normalize_note_visuals(
            input.tone.as_deref().or(Some(&current.tone)),
            input.style.as_deref().or(Some(&current.style)),
            input.tag.as_deref().or(Some(&current.tag)),
            input.note_color.as_deref(),
        );
        let next_note_color = format!("{next_tone}:{next_style}:{next_tag}");
        let next_motivation = normalize_note_motivation(
            input.motivation.as_deref().or(Some(&current.motivation)),
            &next_tag,
        );
        let next_anchor = input
            .block_anchor_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| current.block_anchor_id.clone());
        let next_target = input.target.or(current.target.clone());
        let next_target_json = next_target
            .as_ref()
            .and_then(|t| serde_json::to_value(t).ok());
        let next_version = current.version.max(1) + 1;
        let now = Utc::now();

        let res = sqlx::query(
            r#"
            UPDATE user_margin_notes
            SET block_anchor_id = $3,
                note_color = $4,
                tone = $5,
                style = $6,
                tag = $7,
                motivation = $8,
                target = $9,
                raw_content = $10,
                content_html = $11,
                version = $12,
                updated_at = $13
            WHERE id = $1 AND learner_id = $2 AND version = $14 AND deleted_at IS NULL
            "#,
        )
        .bind(note_id)
        .bind(learner_id)
        .bind(&next_anchor)
        .bind(&next_note_color)
        .bind(&next_tone)
        .bind(&next_style)
        .bind(&next_tag)
        .bind(&next_motivation)
        .bind(&next_target_json)
        .bind(&next_raw)
        .bind(&next_html)
        .bind(next_version)
        .bind(now)
        .bind(current.version)
        .execute(&self.pool)
        .await?;

        if res.rows_affected() == 0 {
            return Err(precondition_failed_err(
                expected_etag.unwrap_or(""),
                &current,
            ));
        }

        Ok(UserMarginNoteDto {
            id: current.id,
            learner_id: current.learner_id,
            step_id: current.step_id,
            locale_code: current.locale_code,
            block_anchor_id: next_anchor,
            note_color: next_note_color,
            tone: next_tone,
            style: next_style,
            tag: next_tag,
            motivation: next_motivation,
            target: next_target,
            body_format: current.body_format,
            content_html: next_html,
            raw_content: next_raw,
            version: next_version,
            created_at: current.created_at,
            updated_at: now,
            deleted_at: None,
            track_slug: None,
            chapter_slug: None,
            step_slug: None,
            step_title: None,
        })
    }

    async fn delete_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        expected_etag: Option<&str>,
    ) -> Result<Option<DateTime<Utc>>> {
        // Purge expired soft-deleted tombstones lazily
        let _ = sqlx::query(
            "DELETE FROM user_margin_notes WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '15 minutes'",
        )
        .execute(&self.pool)
        .await;

        let row_opt = sqlx::query(
            "SELECT version, updated_at FROM user_margin_notes WHERE id = $1 AND learner_id = $2 AND deleted_at IS NULL",
        )
        .bind(note_id)
        .bind(learner_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row_opt else {
            return Ok(None);
        };
        let cur_ver: i32 = row.try_get("version").unwrap_or(1);
        let cur_upd: DateTime<Utc> = row.try_get("updated_at").unwrap_or_else(|_| Utc::now());
        let cur_etag = format!("\"ann-{}-v{}\"", note_id.simple(), cur_ver.max(1));
        if let Some(if_match) = expected_etag {
            if !if_match_satisfies(if_match, &cur_etag) {
                return Err(DomainError::new(
                    ErrorCode::PreconditionFailed,
                    "This note was modified elsewhere. Refresh before deleting.",
                )
                .with_meta(serde_json::json!({
                    "expected_etag": if_match,
                    "current_etag": cur_etag,
                    "current_version": cur_ver,
                    "updated_at": cur_upd.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                }))
                .into());
            }
        }

        let now = Utc::now();
        let res = sqlx::query(
            "UPDATE user_margin_notes SET deleted_at = $3, updated_at = $3 WHERE id = $1 AND learner_id = $2 AND deleted_at IS NULL AND version = $4",
        )
        .bind(note_id)
        .bind(learner_id)
        .bind(now)
        .bind(cur_ver)
        .execute(&self.pool)
        .await?;

        if res.rows_affected() > 0 {
            Ok(Some(now + Duration::minutes(NOTE_UNDO_GRACE_MINUTES)))
        } else if expected_etag.is_some() {
            Err(DomainError::new(
                ErrorCode::PreconditionFailed,
                "This note was modified elsewhere. Refresh before deleting.",
            )
            .with_meta(serde_json::json!({
                "expected_etag": expected_etag,
                "current_etag": cur_etag,
                "current_version": cur_ver,
                "updated_at": cur_upd.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            }))
            .into())
        } else {
            Ok(None)
        }
    }

    async fn restore_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
    ) -> Result<UserMarginNoteDto> {
        let now = Utc::now();
        let cutoff = now - Duration::minutes(NOTE_UNDO_GRACE_MINUTES);
        let row_opt = sqlx::query(
            r#"
            UPDATE user_margin_notes
            SET deleted_at = NULL, version = version + 1, updated_at = $3
            WHERE id = $1 AND learner_id = $2 AND deleted_at IS NOT NULL AND deleted_at >= $4
            RETURNING id, learner_id, step_id, locale_code, block_anchor_id,
                      note_color, tone, style, tag, motivation, target, body_format,
                      content_html, raw_content, version, created_at, updated_at, deleted_at
            "#,
        )
        .bind(note_id)
        .bind(learner_id)
        .bind(now)
        .bind(cutoff)
        .fetch_optional(&self.pool)
        .await?;

        let Some(r) = row_opt else {
            return Err(domain_err(
                ErrorCode::NoteNotFound,
                "Deleted note could not be restored or the undo window has expired.",
            ));
        };

        let target: Option<AnnotationTarget> = r
            .try_get::<Option<serde_json::Value>, _>("target")
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_value(v).ok());
        let mut dto = UserMarginNoteDto {
            id: r.try_get("id")?,
            learner_id: r.try_get("learner_id")?,
            step_id: r.try_get("step_id")?,
            locale_code: r.try_get("locale_code")?,
            block_anchor_id: r.try_get("block_anchor_id")?,
            note_color: r.try_get("note_color")?,
            tone: r.try_get("tone")?,
            style: r.try_get("style")?,
            tag: r.try_get("tag")?,
            motivation: r.try_get("motivation")?,
            target,
            body_format: r.try_get("body_format")?,
            content_html: r.try_get("content_html")?,
            raw_content: r.try_get("raw_content")?,
            version: r.try_get("version")?,
            created_at: r.try_get("created_at")?,
            updated_at: r.try_get("updated_at")?,
            deleted_at: r.try_get("deleted_at")?,
            track_slug: None,
            chapter_slug: None,
            step_slug: None,
            step_title: None,
        };
        dto.hydrate_legacy_fields();
        Ok(dto)
    }

    async fn sync_bundle(&self, bundle: &ContentBundle) -> Result<usize> {
        let mut tx = self.pool.begin().await?;
        let mut upserted_translations = 0usize;

        for track in &bundle.tracks {
            let db_track_id: Uuid = sqlx::query_scalar(
                r#"
                INSERT INTO tracks (id, slug, difficulty, icon_kind, tags, sort_order, is_published)
                VALUES ($1, $2, $3, $4, $5, $6, TRUE)
                ON CONFLICT (slug) DO UPDATE
                SET difficulty = EXCLUDED.difficulty,
                    icon_kind = EXCLUDED.icon_kind,
                    tags = EXCLUDED.tags,
                    sort_order = EXCLUDED.sort_order
                RETURNING id
                "#,
            )
            .bind(track.id)
            .bind(&track.manifest.slug)
            .bind(sanitize_track_custom_label(&track.manifest.difficulty))
            .bind(normalize_track_icon_kind(&track.manifest.icon_kind))
            .bind(sanitize_track_tags(&track.manifest.tags))
            .bind(track.manifest.sort_order)
            .fetch_one(&mut *tx)
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
                .bind(db_track_id)
                .bind(loc)
                .bind(&meta.title)
                .bind(&meta.subtitle)
                .bind(&meta.description)
                .execute(&mut *tx)
                .await?;
            }

            for ch in &track.chapters {
                let db_ch_id: Uuid = sqlx::query_scalar(
                    r#"
                    INSERT INTO chapters (id, track_id, slug, chapter_number)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (track_id, slug) DO UPDATE
                    SET chapter_number = EXCLUDED.chapter_number
                    RETURNING id
                    "#,
                )
                .bind(ch.id)
                .bind(db_track_id)
                .bind(&ch.slug)
                .bind(ch.number)
                .fetch_one(&mut *tx)
                .await?;

                for (loc, title) in &ch.titles {
                    sqlx::query(
                        r#"
                        INSERT INTO chapter_translations (chapter_id, locale_code, title)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (chapter_id, locale_code) DO UPDATE SET title = EXCLUDED.title
                        "#,
                    )
                    .bind(db_ch_id)
                    .bind(loc)
                    .bind(title)
                    .execute(&mut *tx)
                    .await?;
                }

                for step in &ch.steps {
                    let db_step_id: Uuid = sqlx::query_scalar(
                        r#"
                        INSERT INTO steps (id, chapter_id, slug, step_number, default_locale, canonical_revision, estimated_minutes, likes_count)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (chapter_id, slug) DO UPDATE
                        SET step_number = EXCLUDED.step_number,
                            default_locale = EXCLUDED.default_locale,
                            canonical_revision = EXCLUDED.canonical_revision,
                            estimated_minutes = EXCLUDED.estimated_minutes
                        RETURNING id
                        "#,
                    )
                    .bind(step.id)
                    .bind(db_ch_id)
                    .bind(&step.slug)
                    .bind(step.step_number)
                    .bind(&step.default_locale)
                    .bind(step.canonical_revision)
                    .bind(step.estimated_minutes)
                    .bind(step.initial_likes)
                    .fetch_one(&mut *tx)
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
                        let clean_cover = sanitize_cover_image_url(&tr.compiled.frontmatter.cover);
                        let body = extract_body_without_frontmatter(&tr.raw_markdown);
                        let sha256 = compute_step_content_sha256_with_cover(
                            &tr.compiled.frontmatter.title,
                            &tr.compiled.frontmatter.summary,
                            status_val,
                            &clean_license,
                            &tr.compiled.frontmatter.tags,
                            &body,
                            &clean_cover,
                        );
                        sqlx::query(
                            r#"
                            INSERT INTO step_translations (
                                step_id, locale_code, title, summary, license, cover_image, author_name, tags, raw_markdown,
                                compiled_blocks, toc_tree, plain_text, synced_revision, content_sha256, status, published_at, updated_at
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                            ON CONFLICT (step_id, locale_code) DO UPDATE
                            SET title = EXCLUDED.title,
                                summary = EXCLUDED.summary,
                                license = EXCLUDED.license,
                                cover_image = EXCLUDED.cover_image,
                                author_name = CASE WHEN EXCLUDED.author_name <> '' THEN EXCLUDED.author_name ELSE step_translations.author_name END,
                                tags = EXCLUDED.tags,
                                raw_markdown = EXCLUDED.raw_markdown,
                                compiled_blocks = EXCLUDED.compiled_blocks,
                                toc_tree = EXCLUDED.toc_tree,
                                plain_text = EXCLUDED.plain_text,
                                synced_revision = EXCLUDED.synced_revision,
                                content_sha256 = EXCLUDED.content_sha256,
                                status = EXCLUDED.status,
                                published_at = EXCLUDED.published_at,
                                updated_at = EXCLUDED.updated_at
                            "#,
                        )
                        .bind(db_step_id)
                        .bind(&tr.locale)
                        .bind(&tr.compiled.frontmatter.title)
                        .bind(&tr.compiled.frontmatter.summary)
                        .bind(&clean_license)
                        .bind(&clean_cover)
                        .bind(&tr.compiled.frontmatter.author)
                        .bind(&tr.compiled.frontmatter.tags)
                        .bind(&tr.raw_markdown)
                        .bind(blocks_json)
                        .bind(toc_json)
                        .bind(&tr.compiled.plain_text)
                        .bind(tr.compiled.frontmatter.synced_revision)
                        .bind(&sha256)
                        .bind(status_val)
                        .bind(tr.published_at)
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
        let clean_avatar = if icehandnote_core::is_safe_image_src(&claims.avatar_url) {
            claims.avatar_url.trim().to_string()
        } else {
            String::new()
        };
        let mut tx = self.pool.begin().await?;

        let linked = sqlx::query("SELECT id, is_banned, ban_reason FROM users WHERE wp_user_id = $1 FOR UPDATE")
            .bind(claims.wp_user_id)
            .fetch_optional(&mut *tx)
            .await?;
        let existing_match = if let Some(row) = linked {
            Some(row)
        } else if !claims.email.trim().is_empty() {
            sqlx::query(
                "SELECT id, is_banned, ban_reason FROM users WHERE LOWER(email) = LOWER($1) AND wp_user_id IS NULL FOR UPDATE",
            )
            .bind(&claims.email)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            None
        };

        let row = if let Some(existing_row) = existing_match {
            let id: Uuid = existing_row.try_get("id")?;
            let is_banned: bool = existing_row.try_get("is_banned").unwrap_or(false);
            let ban_reason: String = existing_row.try_get("ban_reason").unwrap_or_default();
            if is_banned {
                let err = DomainError::new(
                    ErrorCode::AccountBanned,
                    "This account has been suspended.",
                );
                let err = if ban_reason.trim().is_empty() {
                    err
                } else {
                    err.with_meta(serde_json::json!({ "reason": ban_reason.trim() }))
                };
                return Err(err.into());
            }
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
                .bind(&clean_avatar)
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
            let avatar_source = if clean_avatar.is_empty() {
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
                .bind(&clean_avatar)
                .bind(avatar_source)
                .bind(wp_role.as_str())
                .bind(&auth_source)
                .fetch_one(&mut *tx)
                .await?
        };

        tx.commit().await?;
        let grav = self.fetch_gravatar_base().await;
        Self::row_to_user(&row, &grav)
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

        let clean_oauth_avatar = if icehandnote_core::is_safe_image_src(oauth_avatar_url) {
            oauth_avatar_url.trim().to_string()
        } else {
            String::new()
        };
        if !clean_oauth_avatar.is_empty() {
            let _ = sqlx::query(
                "UPDATE user_oauth_bindings SET oauth_avatar_url = $3 WHERE user_id = $1 AND LOWER(provider) = $2",
            )
            .bind(uid)
            .bind(&clean_provider)
            .bind(&clean_oauth_avatar)
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
            .bind(&clean_oauth_avatar)
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
        let clean_oauth_avatar = if icehandnote_core::is_safe_image_src(oauth_avatar_url) {
            oauth_avatar_url.trim().to_string()
        } else {
            String::new()
        };
        let clean_uploaded_avatar = if uploaded_avatar_url.trim().is_empty() {
            String::new()
        } else if icehandnote_core::is_safe_image_src(uploaded_avatar_url) {
            uploaded_avatar_url.trim().chars().take(512).collect()
        } else {
            return Err(domain_err(
                ErrorCode::InvalidUrl,
                "Avatar URL must be a valid https://, http://, or / path.",
            ));
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
        .bind(&clean_oauth_avatar)
        .bind(&clean_uploaded_avatar)
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

        let clean_oauth_avatar = if icehandnote_core::is_safe_image_src(oauth_avatar_url) {
            oauth_avatar_url.trim().to_string()
        } else {
            String::new()
        };
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
        .bind(&clean_oauth_avatar)
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
            .bind(&clean_oauth_avatar)
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

        if icehandnote_core::crypto::is_legacy_password_hash(&expected) {
            let upgraded = hash_password(&username, password);
            let _ = sqlx::query("UPDATE users SET password_hash = $2, last_login_at = NOW() WHERE id = $1")
                .bind(user.id)
                .bind(&upgraded)
                .execute(&self.pool)
                .await;
        } else {
            let _ = sqlx::query("UPDATE users SET last_login_at = NOW() WHERE id = $1")
                .bind(user.id)
                .execute(&self.pool)
                .await;
        }

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
        let raw_uploaded = input.uploaded_avatar_url.trim();
        let clean_uploaded: String = if raw_uploaded.is_empty() {
            String::new()
        } else if icehandnote_core::is_safe_image_src(raw_uploaded) {
            raw_uploaded.chars().take(512).collect()
        } else {
            return Err(domain_err(
                ErrorCode::InvalidUrl,
                "Avatar URL must be a valid https://, http://, or / path.",
            ));
        };

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
        let mut tx = self.pool.begin().await?;
        let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE expires_at <= NOW()")
            .execute(&mut *tx)
            .await;

        let urow_opt = sqlx::query(
            "SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) AND NOT is_banned LIMIT 1",
        )
        .bind(clean_email)
        .fetch_optional(&mut *tx)
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
            "SELECT token_hash, code_hash, attempts, expires_at FROM password_reset_tokens WHERE user_id = $1 AND code_hash <> '' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
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
            sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please request a new reset code.",
            ));
        }

        let candidate = hash_email_verification_code(&user_email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate) {
            if attempts + 1 >= 5 {
                sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                    .bind(user_id)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query(
                    "UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE token_hash = $1",
                )
                .bind(&old_token_hash)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
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
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

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
        sqlx::query("DELETE FROM user_trusted_devices WHERE user_id = $1")
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
        let mut tx = self.pool.begin().await?;
        let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE expires_at <= NOW()")
            .execute(&mut *tx)
            .await;

        let q_user = format!(
            "SELECT {USER_SELECT_COLS} FROM users WHERE LOWER(email) = LOWER($1) AND NOT is_banned LIMIT 1"
        );
        let Some(urow) = sqlx::query(&q_user)
            .bind(clean_email)
            .fetch_optional(&mut *tx)
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
            "SELECT token_hash, code_hash, attempts FROM password_reset_tokens WHERE user_id = $1 AND code_hash <> '' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
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
            sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please request a new reset code.",
            ));
        }

        let candidate = hash_email_verification_code(&user_email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate) {
            if attempts + 1 >= 5 {
                sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
                    .bind(user_id)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query(
                    "UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE token_hash = $1",
                )
                .bind(&token_hash)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid.",
            ));
        }

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
        sqlx::query("DELETE FROM user_trusted_devices WHERE user_id = $1")
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
        let mut tx = self.pool.begin().await?;

        let row_opt = sqlx::query(
            "SELECT id, code_hash, attempts, expires_at FROM email_verification_codes WHERE LOWER(email) = LOWER($1) AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        )
        .bind(&clean_email)
        .fetch_optional(&mut *tx)
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
            sqlx::query("DELETE FROM email_verification_codes WHERE id = $1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(domain_err(
                ErrorCode::VerificationCodeExpired,
                "Verification code has expired. Please request a new code.",
            ));
        }

        if attempts >= 5 {
            sqlx::query("DELETE FROM email_verification_codes WHERE id = $1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid verification attempts. Please request a new code.",
            ));
        }

        let candidate_hash = hash_email_verification_code(&clean_email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate_hash) {
            if attempts + 1 >= 5 {
                sqlx::query("DELETE FROM email_verification_codes WHERE id = $1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query(
                    "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1",
                )
                .bind(id)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Verification code is invalid. Please check your email and try again.",
            ));
        }
        tx.commit().await?;

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
                   (EXISTS (SELECT 1 FROM step_collaborators sc WHERE sc.user_id = u.id) OR EXISTS (SELECT 1 FROM steps stp WHERE stp.owner_user_id = u.id)) AS has_collaborations,
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
        let removed_opt = sqlx::query(
            "DELETE FROM user_sessions WHERE user_id = $1 AND id = $2 RETURNING ip_address, device_fingerprint",
        )
        .bind(user_id)
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = removed_opt else {
            return Ok(false);
        };
        let rem_ip = normalize_client_ip(&row.try_get::<String, _>("ip_address").unwrap_or_default());
        let rem_fp = row
            .try_get::<String, _>("device_fingerprint")
            .unwrap_or_default()
            .trim()
            .to_string();
        if !rem_ip.is_empty() || !rem_fp.is_empty() {
            let remaining_rows = sqlx::query(
                "SELECT ip_address, device_fingerprint FROM user_sessions WHERE user_id = $1 AND expires_at > NOW()",
            )
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
            let still_active = remaining_rows.iter().any(|r| {
                let ip = normalize_client_ip(
                    &r.try_get::<String, _>("ip_address").unwrap_or_default(),
                );
                let fp = r
                    .try_get::<String, _>("device_fingerprint")
                    .unwrap_or_default();
                ip == rem_ip && fp.trim() == rem_fp
            });
            if !still_active {
                let trusted_rows = sqlx::query(
                    "SELECT id, ip_address, device_fingerprint FROM user_trusted_devices WHERE user_id = $1",
                )
                .bind(user_id)
                .fetch_all(&self.pool)
                .await?;
                for tr in trusted_rows {
                    let tid: Uuid = tr.try_get("id")?;
                    let tip = normalize_client_ip(
                        &tr.try_get::<String, _>("ip_address").unwrap_or_default(),
                    );
                    let tfp = tr
                        .try_get::<String, _>("device_fingerprint")
                        .unwrap_or_default();
                    if tip == rem_ip && tfp.trim() == rem_fp {
                        let _ = sqlx::query("DELETE FROM user_trusted_devices WHERE id = $1")
                            .bind(tid)
                            .execute(&self.pool)
                            .await;
                    }
                }
            }
        }
        Ok(true)
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

        let remaining_rows = sqlx::query(
            "SELECT ip_address, device_fingerprint FROM user_sessions WHERE user_id = $1 AND expires_at > NOW()",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        let kept_pairs: HashSet<(String, String)> = remaining_rows
            .into_iter()
            .map(|r| {
                let ip = normalize_client_ip(
                    &r.try_get::<String, _>("ip_address").unwrap_or_default(),
                );
                let fp = r
                    .try_get::<String, _>("device_fingerprint")
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                (ip, fp)
            })
            .collect();
        if !kept_pairs.is_empty() {
            let trusted_rows = sqlx::query(
                "SELECT id, ip_address, device_fingerprint FROM user_trusted_devices WHERE user_id = $1",
            )
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
            for tr in trusted_rows {
                let tid: Uuid = tr.try_get("id")?;
                let tip = normalize_client_ip(
                    &tr.try_get::<String, _>("ip_address").unwrap_or_default(),
                );
                let tfp = tr
                    .try_get::<String, _>("device_fingerprint")
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if !kept_pairs.contains(&(tip, tfp)) {
                    let _ = sqlx::query("DELETE FROM user_trusted_devices WHERE id = $1")
                        .bind(tid)
                        .execute(&self.pool)
                        .await;
                }
            }
        }
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
        let ttl_cutoff = Utc::now() - Duration::days(TRUSTED_DEVICE_TTL_DAYS);
        let rows = sqlx::query(
            "SELECT ip_address, device_fingerprint, last_seen_at FROM user_trusted_devices WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        let has_any_trusted_history = !rows.is_empty();
        let active_trusted: Vec<(String, String)> = rows
            .into_iter()
            .filter_map(|r| {
                let seen: DateTime<Utc> = r.try_get("last_seen_at").ok()?;
                if seen < ttl_cutoff {
                    return None;
                }
                let ip = r.try_get::<String, _>("ip_address").unwrap_or_default();
                let fp = r
                    .try_get::<String, _>("device_fingerprint")
                    .unwrap_or_default();
                Some((ip, fp))
            })
            .collect();
        let session_fallback_pairs: Vec<(String, String)> = if has_any_trusted_history {
            Vec::new()
        } else {
            sqlx::query(
                "SELECT ip_address, device_fingerprint FROM user_sessions WHERE user_id = $1 AND (ip_address <> '' OR device_fingerprint <> '')",
            )
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|r| {
                (
                    r.try_get::<String, _>("ip_address").unwrap_or_default(),
                    r.try_get::<String, _>("device_fingerprint").unwrap_or_default(),
                )
            })
            .collect()
        };
        Ok(evaluate_login_anomaly(
            ip_address,
            device_fingerprint,
            &active_trusted,
            has_any_trusted_history,
            &session_fallback_pairs,
        )
        .map(str::to_string))
    }

    async fn record_trusted_device(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
        device_label: &str,
    ) -> Result<()> {
        let clean_ip = normalize_client_ip(ip_address);
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
        .bind(&clean_ip)
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
        let mut tx = self.pool.begin().await?;
        let row_opt = sqlx::query(
            "SELECT user_id, email, ip_address, user_agent, device_label, device_fingerprint, code_hash, attempts, expires_at FROM login_otp_challenges WHERE id = $1 FOR UPDATE",
        )
        .bind(challenge_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row_opt else {
            return Err(domain_err(
                ErrorCode::OtpChallengeInvalid,
                "Verification session is invalid or has expired.",
            ));
        };
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
        if expires_at <= now {
            sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
                .bind(challenge_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(domain_err(
                ErrorCode::OtpChallengeExpired,
                "Verification code has expired. Please request a new code.",
            ));
        }
        let attempts: i32 = row.try_get("attempts").unwrap_or(0);
        if attempts >= 5 {
            sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
                .bind(challenge_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
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
                sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
                    .bind(challenge_id)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query(
                    "UPDATE login_otp_challenges SET attempts = attempts + 1 WHERE id = $1",
                )
                .bind(challenge_id)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
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

        sqlx::query("DELETE FROM login_otp_challenges WHERE id = $1")
            .bind(challenge_id)
            .execute(&mut *tx)
            .await?;

        let q_user = format!("SELECT {USER_SELECT_COLS} FROM users WHERE id = $1");
        let Some(urow) = sqlx::query(&q_user)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?
        else {
            tx.commit().await?;
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        tx.commit().await?;
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
        let clean_anon = anon_id.trim();
        if clean_anon.is_empty()
            || clean_anon == user_learner_id
            || clean_anon.starts_with("user:")
        {
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

    async fn studio_list_tracks(
        &self,
        viewer: &UserProfileDto,
        locale: &str,
    ) -> Result<Vec<StudioTrackDto>> {
        let grav = self.fetch_gravatar_base().await;
        let is_reader_only = !viewer.role.can_author();
        let t_rows = sqlx::query(
            r#"
            SELECT t.id, t.slug, t.difficulty, t.icon_kind, t.tags, t.is_published,
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

                    let (viewer_role, _) = self
                        .resolve_viewer_step_role(viewer, s_id, owner_id)
                        .await?;
                    let can_see_drafts = viewer_role != "none";
                    if is_reader_only && !can_see_drafts {
                        continue;
                    }

                    let b_rows = sqlx::query(
                        "SELECT locale_code, status, synced_revision, updated_at FROM step_translations WHERE step_id = $1 ORDER BY locale_code ASC",
                    )
                    .bind(s_id)
                    .fetch_all(&self.pool)
                    .await?;

                    let translations: Vec<StudioLocaleBadgeDto> = b_rows
                        .into_iter()
                        .filter_map(|br| {
                            let status: String = br.try_get("status").ok()?;
                            if !can_see_drafts && status == "draft" {
                                return None;
                            }
                            Some(StudioLocaleBadgeDto {
                                locale: br.try_get("locale_code").ok()?,
                                status,
                                synced_revision: br.try_get("synced_revision").ok()?,
                                updated_at: br.try_get("updated_at").ok()?,
                            })
                        })
                        .collect();

                    if translations.is_empty() && !can_see_drafts {
                        continue;
                    }

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

                if is_reader_only && steps.is_empty() {
                    continue;
                }

                chapters.push(StudioChapterDto {
                    chapter_id: ch_id,
                    slug: cr.try_get("slug")?,
                    number: cr.try_get("chapter_number")?,
                    title: cr.try_get("title")?,
                    steps,
                });
            }

            if is_reader_only && chapters.is_empty() {
                continue;
            }

            let raw_diff: String = tr.try_get("difficulty")?;
            let raw_icon: String = tr.try_get("icon_kind")?;
            let raw_tags: Vec<String> = tr.try_get("tags")?;
            out.push(StudioTrackDto {
                track_id,
                slug: tr.try_get("slug")?,
                title: tr.try_get("title")?,
                difficulty: sanitize_track_custom_label(&raw_diff),
                icon_kind: normalize_track_icon_kind(&raw_icon),
                tags: sanitize_track_tags(&raw_tags),
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
        let track_slug = track_slug.trim();
        let chapter_slug = chapter_slug.trim();
        let step_slug = step_slug.trim();
        let locale = locale.trim();
        let step_row = sqlx::query(
            r#"
            SELECT s.id, c.slug AS chapter_slug, s.step_number, s.estimated_minutes, s.canonical_revision, s.default_locale,
                   s.owner_user_id, s.author_name, s.takedown_reason, s.takedown_at, s.takedown_by
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id AND t.slug = $1
            WHERE s.slug = $3
              AND ($2 = '' OR $2 = '-' OR c.slug = $2)
            ORDER BY c.chapter_number ASC, s.step_number ASC
            LIMIT 1
            "#,
        )
        .bind(track_slug)
        .bind(chapter_slug)
        .bind(step_slug)
        .fetch_optional(&self.pool)
        .await?;

        let now_utc = Utc::now();
        let Some(sr) = step_row else {
            if !viewer.role.can_author() {
                return Err(domain_err(
                    ErrorCode::StepEditForbidden,
                    "Only authors or administrators can create new articles.",
                ));
            }
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
                edit_seq: 0,
                etag: String::new(),
                status: "draft".to_string(),
                cover_image: String::new(),
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
                    role: "owner".to_string(),
                    locale_scope: Vec::new(),
                }],
                pending_invites: Vec::new(),
                can_edit: true,
                can_manage_collaborators: false,
                can_leave: false,
                viewer_role: if viewer.role.is_admin() {
                    "admin".to_string()
                } else {
                    "owner".to_string()
                },
                takedown_reason: None,
                takedown_at: None,
                takedown_by: None,
                published_at: now_utc,
                updated_at: now_utc,
            });
        };

        let resolved_chapter_slug: String = sr.try_get("chapter_slug")?;
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

        let (viewer_role, viewer_scope) = self
            .resolve_viewer_step_role(viewer, step_id, owner_user_id)
            .await?;
        let can_read_drafts = viewer_role != "none";
        let can_edit =
            Self::check_role_can_edit_locale(&viewer_role, &viewer_scope, locale).is_ok();
        // C-03: Only owner or admin can manage collaborators (never unowned takeover)
        let can_manage_collaborators =
            viewer.role.is_admin() || owner_user_id == Some(viewer.id);
        let can_leave = owner_user_id != Some(viewer.id)
            && matches!(viewer_role.as_str(), "editor" | "translator" | "reviewer");

        let inv_rows = if can_manage_collaborators {
            sqlx::query(
                "SELECT id, email, role, locale_scope, created_at, expires_at FROM collaboration_invites WHERE step_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC",
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
                    role: normalize_collaborator_role(ir.try_get::<String, _>("role").ok().as_deref()),
                    locale_scope: ir.try_get("locale_scope").unwrap_or_default(),
                    created_at: ir.try_get("created_at").ok()?,
                    expires_at: ir.try_get("expires_at").ok()?,
                })
            })
            .collect();

        let grav = self.fetch_gravatar_base().await;

        let tr_opt = sqlx::query(
            "SELECT title, summary, COALESCE(cover_image, '') AS cover_image, license, author_name, tags, raw_markdown, synced_revision, edit_seq, content_sha256, status, published_at, updated_at FROM step_translations WHERE step_id = $1 AND locale_code = $2",
        )
        .bind(step_id)
        .bind(locale)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(tr) = tr_opt {
            let status: String = tr.try_get("status")?;
            if status == "draft" && !can_read_drafts {
                return Err(domain_err(
                    ErrorCode::DraftAccessForbidden,
                    "You do not have permission to view this unpublished draft.",
                ));
            }
            let raw: String = tr.try_get("raw_markdown")?;
            let raw_lic: String = tr.try_get("license").unwrap_or_default();
            let clean_lic = icehandnote_core::normalize_license_code(&raw_lic);
            let raw_cover: String = tr.try_get("cover_image").unwrap_or_default();
            let clean_cover = sanitize_cover_image_url(&raw_cover);
            let tr_auth: String = tr.try_get("author_name").unwrap_or_default();
            let fb_auth = if !tr_auth.trim().is_empty() {
                tr_auth
            } else {
                step_author_name
            };
            let synced_rev: i32 = tr.try_get::<i32, _>("synced_revision")?.max(1);
            let title: String = tr.try_get("title")?;
            let summary: String = tr.try_get("summary")?;
            let tags: Vec<String> = tr.try_get("tags")?;
            let body_markdown = extract_body_without_frontmatter(&raw);
            let edit_seq: i64 = tr.try_get::<i64, _>("edit_seq").unwrap_or(1).max(1);
            let stored_sha: String = tr.try_get("content_sha256").unwrap_or_default();
            let eff_sha = if stored_sha.is_empty() {
                compute_step_content_sha256_with_cover(
                    &title,
                    &summary,
                    &status,
                    &clean_lic,
                    &tags,
                    &body_markdown,
                    &clean_cover,
                )
            } else {
                stored_sha
            };
            let etag = compute_step_etag(edit_seq, &eff_sha);

            let authors = self
                .load_step_authors(step_id, owner_user_id, &fb_auth, &grav)
                .await?;
            let updated_at: DateTime<Utc> = tr.try_get("updated_at").unwrap_or(now_utc);
            let published_at: DateTime<Utc> = tr.try_get("published_at").unwrap_or(updated_at);
            return Ok(StudioStepEditorDto {
                track_slug: track_slug.to_string(),
                chapter_slug: resolved_chapter_slug,
                step_slug: step_slug.to_string(),
                locale: locale.to_string(),
                exists: true,
                title,
                summary,
                step_number,
                estimated_minutes,
                synced_revision: synced_rev,
                canonical_revision,
                version: synced_rev,
                edit_seq,
                etag,
                status,
                cover_image: clean_cover,
                license: clean_lic,
                tags,
                body_markdown,
                owner_user_id,
                authors,
                pending_invites,
                can_edit,
                can_manage_collaborators,
                can_leave,
                viewer_role,
                takedown_reason,
                takedown_at,
                takedown_by,
                published_at,
                updated_at,
            });
        }

        let fallback_tr = sqlx::query(
            "SELECT COALESCE(cover_image, '') AS cover_image, license, author_name, tags, raw_markdown, status, published_at, updated_at FROM step_translations WHERE step_id = $1 AND ($3 OR status <> 'draft') ORDER BY CASE WHEN locale_code = $2 THEN 0 ELSE 1 END, locale_code LIMIT 1",
        )
        .bind(step_id)
        .bind(&default_locale)
        .bind(can_read_drafts)
        .fetch_optional(&self.pool)
        .await?;

        if fallback_tr.is_none() && !can_read_drafts {
            return Err(domain_err(
                ErrorCode::DraftAccessForbidden,
                "You do not have permission to view this unpublished draft.",
            ));
        }

        let (prefill_cover, prefill_license, prefill_tags, prefill_body, fb_auth, fb_pub, fb_upd) =
            if let Some(fb) = fallback_tr {
                let cov: String = fb.try_get("cover_image").unwrap_or_default();
                let lic: String = fb.try_get("license").unwrap_or_default();
                let tgs: Vec<String> = fb.try_get("tags").unwrap_or_default();
                let raw: String = fb.try_get("raw_markdown").unwrap_or_default();
                let au: String = fb.try_get("author_name").unwrap_or_default();
                let upd: DateTime<Utc> = fb.try_get("updated_at").unwrap_or(now_utc);
                let pub_at: DateTime<Utc> = fb.try_get("published_at").unwrap_or(upd);
                (
                    sanitize_cover_image_url(&cov),
                    icehandnote_core::normalize_license_code(&lic),
                    tgs,
                    extract_body_without_frontmatter(&raw),
                    au,
                    pub_at,
                    upd,
                )
            } else {
                (
                    String::new(),
                    String::new(),
                    Vec::new(),
                    String::new(),
                    step_author_name,
                    now_utc,
                    now_utc,
                )
            };

        let authors = self
            .load_step_authors(step_id, owner_user_id, &fb_auth, &grav)
            .await?;

        Ok(StudioStepEditorDto {
            track_slug: track_slug.to_string(),
            chapter_slug: resolved_chapter_slug,
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
            edit_seq: 0,
            etag: String::new(),
            status: "draft".to_string(),
            cover_image: prefill_cover,
            license: prefill_license,
            tags: prefill_tags,
            body_markdown: prefill_body,
            owner_user_id,
            authors,
            pending_invites,
            can_edit,
            can_manage_collaborators,
            can_leave,
            viewer_role,
            takedown_reason,
            takedown_at,
            takedown_by,
            published_at: fb_pub,
            updated_at: fb_upd,
        })
    }

    async fn resolve_step_collab_access(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Option<(Uuid, String, Vec<String>)>> {
        let clean_track = track_slug.trim();
        let clean_ch = chapter_slug.trim();
        let clean_step = step_slug.trim();
        let row_opt = sqlx::query(
            r#"
            SELECT s.id, s.owner_user_id
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id AND t.slug = $1
            WHERE s.slug = $3
              AND ($2 = '' OR $2 = '-' OR c.slug = $2)
            ORDER BY c.chapter_number ASC, s.step_number ASC
            LIMIT 1
            "#,
        )
        .bind(clean_track)
        .bind(clean_ch)
        .bind(clean_step)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row_opt else {
            return Ok(None);
        };
        let step_id: Uuid = row.try_get("id")?;
        let owner_opt: Option<Uuid> = row.try_get("owner_user_id").ok().flatten();
        let (role, scope) = self
            .resolve_viewer_step_role(viewer, step_id, owner_opt)
            .await?;
        Ok(Some((step_id, role, scope)))
    }

    async fn studio_save_step(
        &self,
        author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
        require_if_match: bool,
    ) -> Result<StudioStepEditorDto> {
        let clean_track_slug = input.track_slug.trim();
        if !crate::is_valid_slug_segment(clean_track_slug) {
            return Err(domain_err(
                ErrorCode::InvalidSlug,
                "Invalid series URL slug.",
            ));
        }
        if !crate::is_supported_locale_code(&input.locale) {
            return Err(domain_err(
                ErrorCode::BadRequest,
                "Unsupported locale code.",
            ));
        }
        let target_slug = input.step_slug.trim();
        if !crate::studio_auth::is_valid_step_slug_segment(target_slug) {
            return Err(domain_err(
                ErrorCode::InvalidSlug,
                "Invalid article URL slug.",
            ));
        }
        let prev_slug_opt = input
            .previous_step_slug
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != target_slug);
        if let Some(prev_slug) = prev_slug_opt {
            if !crate::studio_auth::is_valid_step_slug_segment(prev_slug) {
                return Err(domain_err(
                    ErrorCode::InvalidSlug,
                    "Invalid previous article URL slug.",
                ));
            }
        }
        let lookup_slug = prev_slug_opt.unwrap_or(target_slug);

        let mut resolved_ch_slug = input.chapter_slug.trim().to_string();
        if resolved_ch_slug.is_empty() || resolved_ch_slug == "-" {
            let owner_ch: Option<String> = sqlx::query_scalar(
                "SELECT c.slug FROM chapters c JOIN tracks t ON t.id = c.track_id JOIN steps s ON s.chapter_id = c.id WHERE t.slug = $1 AND s.slug = $2 LIMIT 1",
            )
            .bind(clean_track_slug)
            .bind(lookup_slug)
            .fetch_optional(&self.pool)
            .await?;
            if let Some(cs) = owner_ch {
                resolved_ch_slug = cs;
            } else {
                let first_ch: Option<String> = sqlx::query_scalar(
                    "SELECT c.slug FROM chapters c JOIN tracks t ON t.id = c.track_id WHERE t.slug = $1 ORDER BY c.chapter_number ASC LIMIT 1",
                )
                .bind(clean_track_slug)
                .fetch_optional(&self.pool)
                .await?;
                if let Some(cs) = first_ch {
                    resolved_ch_slug = cs;
                } else {
                    self.studio_create_chapter(
                        CreateChapterInput {
                            track_slug: clean_track_slug.to_string(),
                            slug: "chapters".to_string(),
                            number: 1,
                            title_zh_tw: clean_track_slug.to_string(),
                        },
                        content_dir,
                    )
                    .await?;
                    resolved_ch_slug = "chapters".to_string();
                }
            }
        } else if !crate::is_valid_slug_segment(&resolved_ch_slug) {
            return Err(domain_err(
                ErrorCode::InvalidSlug,
                "Invalid chapter URL slug.",
            ));
        }

        let clean_status = if input.status == "draft" {
            "draft"
        } else {
            "published"
        };
        let predicted_minutes = estimate_reading_minutes(&input.body_markdown);
        let now_utc = Utc::now();

        let mut tx = self.pool.begin().await?;

        if prev_slug_opt.is_some() {
            let conflict_id: Option<Uuid> = sqlx::query_scalar(
                "SELECT s.id FROM steps s JOIN chapters c ON c.id = s.chapter_id JOIN tracks t ON t.id = c.track_id WHERE t.slug = $1 AND s.slug = $2 LIMIT 1",
            )
            .bind(clean_track_slug)
            .bind(target_slug)
            .fetch_optional(&mut *tx)
            .await?;
            if conflict_id.is_some() {
                return Err(domain_err(
                    ErrorCode::Conflict,
                    format!(
                        "An article with URL slug '{target_slug}' already exists in this series."
                    ),
                ));
            }
        }

        let ch_row = sqlx::query(
            "SELECT c.id FROM chapters c JOIN tracks t ON t.id = c.track_id WHERE t.slug = $1 AND c.slug = $2",
        )
        .bind(clean_track_slug)
        .bind(&resolved_ch_slug)
        .fetch_one(&mut *tx)
        .await?;
        let ch_id: Uuid = ch_row.try_get("id")?;

        let existing_step = sqlx::query(
            "SELECT id, canonical_revision, owner_user_id, author_name, takedown_reason FROM steps WHERE chapter_id = $1 AND slug = $2 FOR UPDATE",
        )
        .bind(ch_id)
        .bind(lookup_slug)
        .fetch_optional(&mut *tx)
        .await?;

        if prev_slug_opt.is_some() && existing_step.is_none() {
            return Err(domain_err(
                ErrorCode::StepNotFound,
                format!("Article not found: {lookup_slug}"),
            ));
        }

        let (step_id, next_version, next_canonical, next_edit_seq, resolved_published_at, step_author_name) =
            if let Some(sr) = existing_step {
                let sid: Uuid = sr.try_get("id")?;
                let owner_opt: Option<Uuid> = sr.try_get("owner_user_id").ok().flatten();
                let (viewer_role, viewer_scope) = self
                    .resolve_viewer_step_role(author, sid, owner_opt)
                    .await?;
                Self::check_role_can_edit_locale(&viewer_role, &viewer_scope, &input.locale)?;
                if prev_slug_opt.is_some() && viewer_role == "translator" {
                    return Err(domain_err(
                        ErrorCode::CollaboratorRoleForbidden,
                        "Translators cannot rename an article URL slug across locales.",
                    ));
                }

                let td_reason: Option<String> = sr.try_get("takedown_reason").ok().flatten();
                if td_reason.is_some() && clean_status == "published" && !author.role.is_admin() {
                    return Err(domain_err(
                        ErrorCode::StepTakenDown,
                        "This article has been taken down by an administrator. Save as draft and contact an administrator to restore it.",
                    ));
                }
                let prev_row = sqlx::query(
                    "SELECT title, summary, COALESCE(cover_image, '') AS cover_image, license, tags, raw_markdown, synced_revision, edit_seq, content_sha256, status, author_name, last_editor_name, published_at, updated_at FROM step_translations WHERE step_id = $1 AND locale_code = $2 FOR UPDATE",
                )
                .bind(sid)
                .bind(&input.locale)
                .fetch_optional(&mut *tx)
                .await?;

                let existing_step_author: String = sr
                    .try_get::<String, _>("author_name")
                    .unwrap_or_default();
                let preserved_author = if existing_step_author.trim().is_empty() {
                    author.display_name.clone()
                } else {
                    existing_step_author
                };

                let crev: i32 = sr.try_get::<i32, _>("canonical_revision")?.max(1);
                let (next_v, next_seq, pub_at) = if let Some(pr) = prev_row {
                    let pv: i32 = pr.try_get("synced_revision").unwrap_or(1);
                    let prev_status: String = pr.try_get("status").unwrap_or_default();
                    let prev_pub: DateTime<Utc> = pr.try_get("published_at").unwrap_or(now_utc);
                    let cur_seq: i64 = pr.try_get::<i64, _>("edit_seq").unwrap_or(1).max(1);
                    let prev_title: String = pr.try_get("title").unwrap_or_default();
                    let prev_summary: String = pr.try_get("summary").unwrap_or_default();
                    let prev_cover: String = sanitize_cover_image_url(
                        &pr.try_get::<String, _>("cover_image").unwrap_or_default(),
                    );
                    let prev_lic: String = icehandnote_core::normalize_license_code(
                        &pr.try_get::<String, _>("license").unwrap_or_default(),
                    );
                    let prev_tags: Vec<String> = pr.try_get("tags").unwrap_or_default();
                    let prev_raw: String = pr.try_get("raw_markdown").unwrap_or_default();
                    let prev_body = extract_body_without_frontmatter(&prev_raw);
                    let stored_sha: String = pr.try_get("content_sha256").unwrap_or_default();
                    let cur_sha = if stored_sha.is_empty() {
                        compute_step_content_sha256_with_cover(
                            &prev_title,
                            &prev_summary,
                            &prev_status,
                            &prev_lic,
                            &prev_tags,
                            &prev_body,
                            &prev_cover,
                        )
                    } else {
                        stored_sha
                    };
                    let cur_etag = compute_step_etag(cur_seq, &cur_sha);

                    match input
                        .expected_etag
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        Some(expected) => {
                            if !if_match_satisfies(expected, &cur_etag) {
                                let last_ed: String = pr.try_get("last_editor_name").unwrap_or_default();
                                let auth_name: String = pr.try_get("author_name").unwrap_or_default();
                                let updated_by = if !last_ed.is_empty() { last_ed } else { auth_name };
                                let prev_upd: DateTime<Utc> =
                                    pr.try_get("updated_at").unwrap_or(now_utc);
                                return Err(revision_conflict_err(
                                    expected,
                                    &cur_etag,
                                    cur_seq,
                                    &updated_by,
                                    prev_upd,
                                    &prev_title,
                                    &prev_summary,
                                    &prev_body,
                                ));
                            }
                        }
                        None if require_if_match => {
                            return Err(domain_err(
                                ErrorCode::PreconditionRequired,
                                "An If-Match header with the current article ETag is required before saving.",
                            ));
                        }
                        None => {}
                    }

                    let nv = if clean_status == "published" {
                        pv.max(1) + 1
                    } else {
                        pv.max(1)
                    };
                    let p_at = if prev_status == "draft" && clean_status == "published" {
                        now_utc
                    } else {
                        prev_pub
                    };
                    (nv, cur_seq + 1, p_at)
                } else {
                    (1, 1, now_utc)
                };
                let next_c = crev.max(next_v);
                sqlx::query(
                    r#"
                    UPDATE steps
                    SET slug = $2,
                        step_number = $3,
                        estimated_minutes = $4,
                        canonical_revision = $5,
                        owner_user_id = CASE WHEN owner_user_id IS NULL AND $8 THEN $6 ELSE owner_user_id END,
                        author_name = CASE WHEN author_name = '' THEN $7 ELSE author_name END
                    WHERE id = $1
                    "#,
                )
                .bind(sid)
                .bind(target_slug)
                .bind(input.step_number)
                .bind(predicted_minutes)
                .bind(next_c)
                .bind(author.id)
                .bind(&author.display_name)
                .bind(author.role.is_admin())
                .execute(&mut *tx)
                .await?;
                (sid, next_v, next_c, next_seq, pub_at, preserved_author)
            } else {
                if !author.role.can_author() {
                    return Err(domain_err(
                        ErrorCode::StepEditForbidden,
                        "Only authors or administrators can create new articles.",
                    ));
                }
                let sid = deterministic_uuid(&format!(
                    "step:{clean_track_slug}:{resolved_ch_slug}:{target_slug}",
                ));
                sqlx::query(
                    r#"
                    INSERT INTO steps (id, chapter_id, slug, step_number, default_locale, canonical_revision, estimated_minutes, owner_user_id, author_name)
                    VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)
                    "#,
                )
                .bind(sid)
                .bind(ch_id)
                .bind(target_slug)
                .bind(input.step_number)
                .bind(&input.locale)
                .bind(predicted_minutes)
                .bind(author.id)
                .bind(&author.display_name)
                .execute(&mut *tx)
                .await?;
                (sid, 1, 1, 1, now_utc, author.display_name.clone())
            };

        let clean_license = icehandnote_core::normalize_license_code(&input.license);
        let clean_cover = sanitize_cover_image_url(&input.cover_image);
        let pub_iso = resolved_published_at.to_rfc3339();
        let upd_iso = now_utc.to_rfc3339();
        let raw_md = icehandnote_core::auth::format_step_markdown_file_with_cover(
            &input.title,
            &input.summary,
            input.step_number,
            predicted_minutes,
            next_version,
            next_canonical,
            clean_status,
            &clean_license,
            &step_author_name,
            Some(&pub_iso),
            Some(&upd_iso),
            &input.tags,
            Some(step_id),
            &clean_cover,
            &input.body_markdown,
        );
        let compiled = compile_notebook_markdown(&raw_md);
        let blocks_json = serde_json::to_value(&compiled.blocks)?;
        let toc_json = serde_json::to_value(&compiled.toc)?;
        let new_sha256 = compute_step_content_sha256_with_cover(
            &compiled.frontmatter.title,
            &compiled.frontmatter.summary,
            clean_status,
            &clean_license,
            &input.tags,
            &input.body_markdown,
            &clean_cover,
        );

        sqlx::query(
            r#"
            INSERT INTO step_translations (
                step_id, locale_code, title, summary, license, cover_image, tags, raw_markdown,
                compiled_blocks, toc_tree, plain_text, synced_revision, edit_seq, content_sha256,
                last_editor_name, status, author_id, author_name, published_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            ON CONFLICT (step_id, locale_code) DO UPDATE
            SET title = EXCLUDED.title,
                summary = EXCLUDED.summary,
                license = EXCLUDED.license,
                cover_image = EXCLUDED.cover_image,
                tags = EXCLUDED.tags,
                raw_markdown = EXCLUDED.raw_markdown,
                compiled_blocks = EXCLUDED.compiled_blocks,
                toc_tree = EXCLUDED.toc_tree,
                plain_text = EXCLUDED.plain_text,
                synced_revision = EXCLUDED.synced_revision,
                edit_seq = EXCLUDED.edit_seq,
                content_sha256 = EXCLUDED.content_sha256,
                last_editor_name = EXCLUDED.last_editor_name,
                status = EXCLUDED.status,
                author_id = EXCLUDED.author_id,
                author_name = EXCLUDED.author_name,
                published_at = EXCLUDED.published_at,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(step_id)
        .bind(&input.locale)
        .bind(&compiled.frontmatter.title)
        .bind(&compiled.frontmatter.summary)
        .bind(&clean_license)
        .bind(&clean_cover)
        .bind(&input.tags)
        .bind(&raw_md)
        .bind(blocks_json)
        .bind(toc_json)
        .bind(&compiled.plain_text)
        .bind(next_version)
        .bind(next_edit_seq)
        .bind(&new_sha256)
        .bind(&author.display_name)
        .bind(clean_status)
        .bind(author.id)
        .bind(&step_author_name)
        .bind(resolved_published_at)
        .bind(now_utc)
        .execute(&mut *tx)
        .await?;

        let change_note: String = input
            .change_note
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .chars()
            .take(240)
            .collect();

        sqlx::query(
            r#"
            INSERT INTO step_revisions (
                id, step_id, locale_code, edit_seq, synced_revision, status,
                title, summary, body_markdown, content_sha256, author_user_id, author_name, change_note, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            "#,
        )
        .bind(generate_uuid_v7())
        .bind(step_id)
        .bind(&input.locale)
        .bind(next_edit_seq)
        .bind(next_version)
        .bind(clean_status)
        .bind(&compiled.frontmatter.title)
        .bind(&compiled.frontmatter.summary)
        .bind(&input.body_markdown)
        .bind(&new_sha256)
        .bind(author.id)
        .bind(&author.display_name)
        .bind(&change_note)
        .bind(now_utc)
        .execute(&mut *tx)
        .await?;

        let audit_detail = if change_note.is_empty() {
            format!("{} #{} ({clean_status})", input.locale, next_edit_seq)
        } else {
            format!(
                "{} #{} ({clean_status}) · {change_note}",
                input.locale, next_edit_seq
            )
        };
        let _ = sqlx::query(
            "INSERT INTO collaboration_audit_logs (id, step_id, actor_user_id, actor_name, action, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
        )
        .bind(generate_uuid_v7())
        .bind(step_id)
        .bind(author.id)
        .bind(&author.display_name)
        .bind("revision_saved")
        .bind(&audit_detail)
        .execute(&mut *tx)
        .await;

        tx.commit().await?;

        if input.write_to_content_dir {
            fs::create_dir_all(content_dir)?;
            let ch_dir = content_dir.join(clean_track_slug).join(&resolved_ch_slug);
            crate::ensure_within_dir(content_dir, &ch_dir)?;
            fs::create_dir_all(&ch_dir)?;
            if let Some(prev_slug) = prev_slug_opt {
                crate::studio_auth::rename_step_markdown_files(&ch_dir, prev_slug, target_slug);
            }
            let file_path = ch_dir.join(format!("{target_slug}.{}.md", input.locale));
            crate::ensure_within_dir(&ch_dir, &file_path)?;
            crate::atomic_write_str(&file_path, &raw_md)?;
        }

        self.studio_get_step_editor(
            author,
            clean_track_slug,
            &resolved_ch_slug,
            target_slug,
            &input.locale,
        )
        .await
    }

    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> Result<StudioTrackDto> {
        let clean_slug = input.slug.trim().to_ascii_lowercase();
        if !crate::is_valid_slug_segment(&clean_slug) {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid track slug."));
        }
        let ch_slug = if input.first_chapter_slug.trim().is_empty() {
            "chapters".to_string()
        } else {
            input.first_chapter_slug.trim().to_ascii_lowercase()
        };
        if !crate::is_valid_slug_segment(&ch_slug) {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid chapter slug."));
        }

        let clean_icon = normalize_track_icon_kind(&input.icon_kind);
        let clean_diff = sanitize_track_custom_label(&input.difficulty);
        let clean_tags = sanitize_track_tags(&input.tags);
        let track_id = deterministic_uuid(&format!("track:{clean_slug}"));
        sqlx::query(
            "INSERT INTO tracks (id, slug, difficulty, icon_kind, tags, is_published) VALUES ($1, $2, $3, $4, $5, TRUE)",
        )
        .bind(track_id)
        .bind(&clean_slug)
        .bind(&clean_diff)
        .bind(&clean_icon)
        .bind(&clean_tags)
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

        let ch_title = if input.first_chapter_title.trim().is_empty() {
            clean_title.clone()
        } else {
            input.first_chapter_title
        };
        self.studio_create_chapter(
            CreateChapterInput {
                track_slug: clean_slug.clone(),
                slug: ch_slug,
                number: 1,
                title_zh_tw: ch_title,
            },
            content_dir,
        )
        .await?;

        let sys_admin = UserProfileDto {
            id: Uuid::nil(),
            wp_user_id: None,
            username: "system".to_string(),
            display_name: "System".to_string(),
            email: String::new(),
            avatar_url: String::new(),
            avatar_source: "default".to_string(),
            oauth_avatar_url: String::new(),
            uploaded_avatar_url: String::new(),
            oauth_provider: None,
            oauth_bindings: Vec::new(),
            has_password: false,
            bio: String::new(),
            role: UserRole::Admin,
            has_collaborations: false,
            auth_source: "system".to_string(),
            is_banned: false,
            ban_reason: String::new(),
            last_login_at: Utc::now(),
        };
        let all = self.studio_list_tracks(&sys_admin, "zh-CN").await?;
        Ok(all
            .into_iter()
            .find(|t| t.slug == clean_slug)
            .expect("newly created track must exist"))
    }

    async fn studio_update_track_meta(
        &self,
        track_slug: &str,
        input: UpdateTrackMetaInput,
        content_dir: &Path,
    ) -> Result<bool> {
        let clean = track_slug.trim();
        if !crate::is_valid_slug_segment(clean) {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid track slug."));
        }
        let clean_icon = input.icon_kind.as_deref().map(normalize_track_icon_kind);
        let clean_diff = input.difficulty.as_deref().map(sanitize_track_custom_label);
        let clean_tags = input.tags.as_deref().map(sanitize_track_tags);
        let res = sqlx::query(
            r#"
            UPDATE tracks
            SET icon_kind = COALESCE($2, icon_kind),
                difficulty = COALESCE($3, difficulty),
                tags = COALESCE($4, tags)
            WHERE slug = $1
            "#,
        )
        .bind(clean)
        .bind(&clean_icon)
        .bind(&clean_diff)
        .bind(&clean_tags)
        .execute(&self.pool)
        .await?;
        let updated = res.rows_affected() > 0;
        if updated && content_dir.exists() {
            let track_dir = content_dir.join(clean);
            let manifest_path = track_dir.join("track.toml");
            if manifest_path.exists()
                && !crate::is_symlink_path(&track_dir)
                && crate::ensure_within_dir(&track_dir, &manifest_path).is_ok()
            {
                if let Ok(raw) = fs::read_to_string(&manifest_path) {
                    if let Ok(mut manifest) = toml::from_str::<crate::content_loader::TrackManifest>(&raw) {
                        if let Some(ref ic) = clean_icon {
                            manifest.icon_kind = ic.clone();
                        }
                        if let Some(ref df) = clean_diff {
                            manifest.difficulty = df.clone();
                        }
                        if let Some(ref tg) = clean_tags {
                            manifest.tags = tg.clone();
                        }
                        if let Ok(toml_text) = toml::to_string_pretty(&manifest) {
                            let _ = crate::atomic_write_str(&manifest_path, &toml_text);
                        }
                    }
                }
            }
        }
        Ok(updated)
    }

    async fn studio_delete_track(&self, track_slug: &str, content_dir: &Path) -> Result<bool> {
        let clean = track_slug.trim();
        if !crate::is_valid_slug_segment(clean) {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid track slug."));
        }
        let res = sqlx::query("DELETE FROM tracks WHERE slug = $1")
            .bind(clean)
            .execute(&self.pool)
            .await?;
        let removed = res.rows_affected() > 0;
        if removed && content_dir.exists() {
            let track_dir = content_dir.join(clean);
            if track_dir.exists()
                && !crate::is_symlink_path(&track_dir)
                && crate::ensure_within_dir(content_dir, &track_dir).is_ok()
            {
                let _ = fs::remove_dir_all(&track_dir);
            }
        }
        Ok(removed)
    }

    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        content_dir: &Path,
    ) -> Result<()> {
        let clean_track = input.track_slug.trim();
        let clean_ch = input.slug.trim().to_ascii_lowercase();
        if !crate::is_valid_slug_segment(clean_track) || !crate::is_valid_slug_segment(&clean_ch) {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid path slug."));
        }
        let trow = sqlx::query("SELECT id FROM tracks WHERE slug = $1")
            .bind(clean_track)
            .fetch_one(&self.pool)
            .await?;
        let track_id: Uuid = trow.try_get("id")?;
        let ch_id = deterministic_uuid(&format!("chapter:{clean_track}:{clean_ch}"));
        let clean_title = icehandnote_core::sanitize_custom_html(&input.title_zh_tw, 240);

        sqlx::query(
            "INSERT INTO chapters (id, track_id, slug, chapter_number) VALUES ($1, $2, $3, $4)",
        )
        .bind(ch_id)
        .bind(track_id)
        .bind(&clean_ch)
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
        fs::create_dir_all(content_dir)?;
        let ch_dir = content_dir.join(clean_track).join(&clean_ch);
        crate::ensure_within_dir(content_dir, &ch_dir)?;
        let _ = fs::create_dir_all(&ch_dir);
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
        if !crate::is_valid_slug_segment(clean_t) || !crate::is_valid_slug_segment(clean_c) {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid path slug."));
        }
        let res = sqlx::query(
            "DELETE FROM chapters c USING tracks t WHERE c.track_id = t.id AND t.slug = $1 AND c.slug = $2",
        )
        .bind(clean_t)
        .bind(clean_c)
        .execute(&self.pool)
        .await?;
        let removed = res.rows_affected() > 0;
        if removed && content_dir.exists() {
            let ch_dir = content_dir.join(clean_t).join(clean_c);
            if ch_dir.exists()
                && !crate::is_symlink_path(&ch_dir)
                && crate::ensure_within_dir(content_dir, &ch_dir).is_ok()
            {
                let _ = fs::remove_dir_all(&ch_dir);
            }
        }
        Ok(removed)
    }

    async fn studio_delete_step(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> Result<bool> {
        let clean_t = track_slug.trim();
        let clean_c = chapter_slug.trim();
        let clean_s = step_slug.trim();
        if !crate::is_valid_slug_segment(clean_t)
            || !crate::is_valid_slug_segment(clean_c)
            || !crate::is_valid_step_slug_segment(clean_s)
        {
            return Err(domain_err(ErrorCode::InvalidSlug, "Invalid path slug."));
        }
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
            .bind(clean_t)
            .bind(clean_c)
            .bind(clean_s)
            .fetch_optional(&self.pool)
            .await?;
            if let Some(owner_val) = owner_opt {
                if owner_val != Some(actor.id) {
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
        .bind(clean_t)
        .bind(clean_c)
        .bind(clean_s)
        .execute(&self.pool)
        .await?;

        let removed = res.rows_affected() > 0;
        if removed && content_dir.exists() {
            let ch_dir = content_dir.join(clean_t).join(clean_c);
            if ch_dir.exists()
                && !crate::is_symlink_path(&ch_dir)
                && crate::ensure_within_dir(content_dir, &ch_dir).is_ok()
            {
                if let Ok(entries) = fs::read_dir(&ch_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if crate::is_symlink_path(&p) || !p.is_file() {
                            continue;
                        }
                        if let Some(name) = entry.file_name().to_str() {
                            if name.starts_with(&format!("{clean_s}.")) && name.ends_with(".md") {
                                let _ = fs::remove_file(p);
                            }
                        }
                    }
                }
            }
        }
        Ok(removed)
    }

    async fn create_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        email: &str,
        role: &str,
        locale_scope: &[String],
    ) -> Result<(CollaboratorInviteDto, String, String)> {
        let Some(clean_email) = icehandnote_core::auth::validate_and_normalize_email(email) else {
            return Err(domain_err(
                ErrorCode::InvalidEmail,
                "Please provide a valid email address.",
            ));
        };
        let clean_email = clean_email.as_str();
        let norm_role = normalize_collaborator_role(Some(role));
        let norm_scope = if norm_role == "translator" {
            normalize_locale_scope(locale_scope)
        } else {
            Vec::new()
        };

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

        // C-03: Never allow non-admin authors to hijack unowned articles
        if !actor.role.is_admin() && owner_opt != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::InviteForbidden,
                "Only the article owner or an administrator can send collaboration invites.",
            ));
        }

        let already_member: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM users u
                WHERE LOWER(u.email) = LOWER($2)
                  AND (u.id = $3 OR EXISTS (SELECT 1 FROM step_collaborators sc WHERE sc.step_id = $1 AND sc.user_id = u.id))
            )
            "#,
        )
        .bind(step_id)
        .bind(clean_email)
        .bind(owner_opt)
        .fetch_one(&self.pool)
        .await?;
        if already_member {
            return Err(domain_err(
                ErrorCode::InviteAlreadyMember,
                "This user is already a collaborator on this article.",
            ));
        }

        // Supersede any existing active invite for (step_id, lower(email))
        sqlx::query(
            "UPDATE collaboration_invites SET revoked_at = NOW() WHERE step_id = $1 AND LOWER(email) = LOWER($2) AND consumed_at IS NULL AND revoked_at IS NULL",
        )
        .bind(step_id)
        .bind(clean_email)
        .execute(&self.pool)
        .await?;

        let (raw_token, token_hash) = generate_action_token("ihn_inv", "collab_invite_v1");
        let id = Uuid::new_v4();
        let now = Utc::now();
        let expires_at = now + Duration::days(7);

        sqlx::query(
            r#"
            INSERT INTO collaboration_invites (id, step_id, email, token_hash, role, locale_scope, invited_by, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
        )
        .bind(id)
        .bind(step_id)
        .bind(clean_email)
        .bind(&token_hash)
        .bind(&norm_role)
        .bind(&norm_scope)
        .bind(actor.id)
        .bind(expires_at)
        .bind(now)
        .execute(&self.pool)
        .await?;

        self.record_audit_log(
            step_id,
            actor,
            "invite_created",
            &format!("{} ({norm_role})", mask_email_address(clean_email)),
        )
        .await;

        Ok((
            CollaboratorInviteDto {
                id,
                email: clean_email.to_string(),
                role: norm_role,
                locale_scope: norm_scope,
                created_at: now,
                expires_at,
            },
            raw_token,
            step_title,
        ))
    }

    async fn preview_collaborator_invite(
        &self,
        viewer: Option<&UserProfileDto>,
        raw_token: &str,
    ) -> Result<InvitePreviewDto> {
        let token_hash = hash_action_token("collab_invite_v1", raw_token.trim());
        let row_opt = sqlx::query(
            r#"
            SELECT ci.id, ci.step_id, ci.email, ci.role, ci.locale_scope, ci.expires_at,
                   ci.consumed_at, ci.revoked_at,
                   COALESCE(u.display_name, 'Author') AS invited_by_name
            FROM collaboration_invites ci
            LEFT JOIN users u ON u.id = ci.invited_by
            WHERE ci.token_hash = $1
            "#,
        )
        .bind(&token_hash)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row_opt else {
            return Err(domain_err(
                ErrorCode::InviteNotFound,
                "Collaboration invitation was not found.",
            ));
        };
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
        let consumed_at: Option<DateTime<Utc>> = row.try_get("consumed_at").ok().flatten();
        let revoked_at: Option<DateTime<Utc>> = row.try_get("revoked_at").ok().flatten();
        if consumed_at.is_some() || revoked_at.is_some() || expires_at <= Utc::now() {
            return Err(domain_err(
                ErrorCode::InviteExpired,
                "This collaboration invitation has expired, been revoked, or already been used.",
            ));
        }

        let step_id: Uuid = row.try_get("step_id")?;
        let loc_opt = sqlx::query(
            r#"
            SELECT t.slug AS track_slug, c.slug AS chapter_slug, s.slug AS step_slug,
                   COALESCE((SELECT title FROM step_translations st WHERE st.step_id = s.id ORDER BY CASE WHEN st.locale_code = s.default_locale THEN 0 ELSE 1 END LIMIT 1), s.slug) AS article_title
            FROM steps s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN tracks t ON t.id = c.track_id
            WHERE s.id = $1
            "#,
        )
        .bind(step_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(loc) = loc_opt else {
            return Err(domain_err(
                ErrorCode::InviteTargetDeleted,
                "The invited article no longer exists.",
            ));
        };

        let inv_email: String = row.try_get("email")?;
        let inv_role: String = row
            .try_get::<String, _>("role")
            .unwrap_or_else(|_| "editor".to_string());
        let inv_scope: Vec<String> = row.try_get("locale_scope").unwrap_or_default();
        let invited_by_name: String = row.try_get("invited_by_name").unwrap_or_default();
        let email_matches_viewer = viewer.map(|v| v.email.trim().eq_ignore_ascii_case(&inv_email));

        Ok(InvitePreviewDto {
            invite_id: row.try_get("id")?,
            masked_email: mask_email_address(&inv_email),
            role: normalize_collaborator_role(Some(&inv_role)),
            locale_scope: inv_scope,
            track_slug: loc.try_get("track_slug")?,
            chapter_slug: loc.try_get("chapter_slug")?,
            step_slug: loc.try_get("step_slug")?,
            article_title: loc.try_get("article_title")?,
            invited_by_name,
            expires_at,
            email_matches_viewer,
        })
    }

    async fn revoke_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        invite_id: Uuid,
    ) -> Result<bool> {
        let row_opt = sqlx::query(
            "SELECT ci.step_id, ci.email, s.owner_user_id FROM collaboration_invites ci JOIN steps s ON s.id = ci.step_id WHERE ci.id = $1 AND ci.consumed_at IS NULL AND ci.revoked_at IS NULL",
        )
        .bind(invite_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row_opt else {
            return Ok(false);
        };
        let step_id: Uuid = row.try_get("step_id")?;
        let inv_email: String = row.try_get("email")?;
        let owner: Option<Uuid> = row.try_get("owner_user_id").ok().flatten();
        if !actor.role.is_admin() && owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::InviteForbidden,
                "You do not have permission to revoke this invitation.",
            ));
        }
        let res = sqlx::query(
            "UPDATE collaboration_invites SET revoked_at = NOW() WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL",
        )
        .bind(invite_id)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() > 0 {
            self.record_audit_log(
                step_id,
                actor,
                "invite_revoked",
                &mask_email_address(&inv_email),
            )
            .await;
            return Ok(true);
        }
        Ok(false)
    }

    async fn accept_collaborator_invite(
        &self,
        user: &UserProfileDto,
        raw_token: &str,
    ) -> Result<(String, String, String)> {
        let token_hash = hash_action_token("collab_invite_v1", raw_token.trim());
        let mut tx = self.pool.begin().await?;

        let inv_opt = sqlx::query(
            "SELECT id, step_id, email, role, locale_scope, expires_at, consumed_at, revoked_at FROM collaboration_invites WHERE token_hash = $1 FOR UPDATE",
        )
        .bind(&token_hash)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(inv_row) = inv_opt else {
            return Err(domain_err(
                ErrorCode::InviteNotFound,
                "Collaboration invitation was not found.",
            ));
        };
        let inv_id: Uuid = inv_row.try_get("id")?;
        let step_id: Uuid = inv_row.try_get("step_id")?;
        let inv_email: String = inv_row.try_get("email")?;
        let inv_role = normalize_collaborator_role(
            inv_row.try_get::<String, _>("role").ok().as_deref(),
        );
        let inv_scope: Vec<String> = inv_row.try_get("locale_scope").unwrap_or_default();
        let expires_at: DateTime<Utc> = inv_row.try_get("expires_at")?;
        let consumed_at: Option<DateTime<Utc>> = inv_row.try_get("consumed_at").ok().flatten();
        let revoked_at: Option<DateTime<Utc>> = inv_row.try_get("revoked_at").ok().flatten();

        if consumed_at.is_some() || revoked_at.is_some() || expires_at <= Utc::now() {
            return Err(domain_err(
                ErrorCode::InviteExpired,
                "This collaboration invitation has expired, been revoked, or already been used.",
            ));
        }

        // C-02: Strict email binding BEFORE consuming token
        if !user.email.trim().eq_ignore_ascii_case(&inv_email) {
            return Err(DomainError::new(
                ErrorCode::InviteEmailMismatch,
                "This invitation was issued for a different email address. Sign in with the invited account.",
            )
            .with_meta(serde_json::json!({ "expected_email": mask_email_address(&inv_email) }))
            .into());
        }

        let loc_opt = sqlx::query(
            r#"
            SELECT t.slug AS track_slug, c.slug AS chapter_slug, s.slug AS step_slug, s.owner_user_id
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
        let owner_opt: Option<Uuid> = loc.try_get("owner_user_id").ok().flatten();
        let already_collab: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM step_collaborators WHERE step_id = $1 AND user_id = $2)",
        )
        .bind(step_id)
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
        if owner_opt == Some(user.id) || already_collab {
            return Err(domain_err(
                ErrorCode::InviteAlreadyMember,
                "You are already a collaborator on this article.",
            ));
        }

        sqlx::query("UPDATE collaboration_invites SET consumed_at = NOW() WHERE id = $1")
            .bind(inv_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query(
            r#"
            INSERT INTO step_collaborators (step_id, user_id, role, locale_scope)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (step_id, user_id) DO UPDATE SET role = EXCLUDED.role, locale_scope = EXCLUDED.locale_scope
            "#,
        )
        .bind(step_id)
        .bind(user.id)
        .bind(&inv_role)
        .bind(&inv_scope)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO collaboration_audit_logs (id, step_id, actor_user_id, actor_name, action, detail, created_at) VALUES ($1, $2, $3, $4, 'invite_accepted', $5, NOW())",
        )
        .bind(generate_uuid_v7())
        .bind(step_id)
        .bind(user.id)
        .bind(&user.display_name)
        .bind(format!("{} ({inv_role})", user.display_name))
        .execute(&mut *tx)
        .await?;

        // Note (C-02): Intentionally do NOT globally escalate `reader` -> `author`.
        // Scoped Studio access is granted via `UserProfileDto::has_collaborations`.
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
        let Some((step_id, _, owner)) = self
            .lookup_step_id_and_owner(track_slug, chapter_slug, step_slug)
            .await?
        else {
            return Ok(false);
        };
        if !actor.role.is_admin() && owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Only the article owner or an administrator can remove collaborators.",
            ));
        }
        let target_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id = $1")
            .bind(target_user_id)
            .fetch_optional(&self.pool)
            .await?
            .unwrap_or_else(|| target_user_id.to_string());
        let res = sqlx::query(
            "DELETE FROM step_collaborators WHERE step_id = $1 AND user_id = $2",
        )
        .bind(step_id)
        .bind(target_user_id)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() > 0 {
            self.record_audit_log(step_id, actor, "collaborator_removed", &target_name)
                .await;
            return Ok(true);
        }
        Ok(false)
    }

    async fn update_step_collaborator_role(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
        role: &str,
        locale_scope: &[String],
    ) -> Result<bool> {
        let Some((step_id, _, owner)) = self
            .lookup_step_id_and_owner(track_slug, chapter_slug, step_slug)
            .await?
        else {
            return Ok(false);
        };
        if !actor.role.is_admin() && owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Only the article owner or an administrator can update collaborator roles.",
            ));
        }
        let norm_role = normalize_collaborator_role(Some(role));
        let norm_scope = if norm_role == "translator" {
            normalize_locale_scope(locale_scope)
        } else {
            Vec::new()
        };
        let res = sqlx::query(
            "UPDATE step_collaborators SET role = $3, locale_scope = $4 WHERE step_id = $1 AND user_id = $2",
        )
        .bind(step_id)
        .bind(target_user_id)
        .bind(&norm_role)
        .bind(&norm_scope)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() > 0 {
            let target_name: String =
                sqlx::query_scalar("SELECT display_name FROM users WHERE id = $1")
                    .bind(target_user_id)
                    .fetch_optional(&self.pool)
                    .await?
                    .unwrap_or_else(|| target_user_id.to_string());
            self.record_audit_log(
                step_id,
                actor,
                "role_updated",
                &format!("{target_name} -> {norm_role}"),
            )
            .await;
            return Ok(true);
        }
        Ok(false)
    }

    async fn leave_step_collaboration(
        &self,
        user: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<bool> {
        let Some((step_id, _, owner)) = self
            .lookup_step_id_and_owner(track_slug, chapter_slug, step_slug)
            .await?
        else {
            return Ok(false);
        };
        if owner == Some(user.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Article owners must transfer ownership before leaving.",
            ));
        }
        let res = sqlx::query(
            "DELETE FROM step_collaborators WHERE step_id = $1 AND user_id = $2",
        )
        .bind(step_id)
        .bind(user.id)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() > 0 {
            self.record_audit_log(step_id, user, "collaborator_left", &user.display_name)
                .await;
            return Ok(true);
        }
        Ok(false)
    }

    async fn transfer_step_ownership(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> Result<bool> {
        let Some((step_id, _, prev_owner)) = self
            .lookup_step_id_and_owner(track_slug, chapter_slug, step_slug)
            .await?
        else {
            return Ok(false);
        };
        if !actor.role.is_admin() && prev_owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Only the article owner or an administrator can transfer ownership.",
            ));
        }
        let target_name_opt: Option<String> = sqlx::query_scalar(
            "SELECT display_name FROM users WHERE id = $1 AND is_banned = FALSE",
        )
        .bind(target_user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(target_name) = target_name_opt else {
            return Err(domain_err(
                ErrorCode::UserNotFound,
                "Target user not found.",
            ));
        };

        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE steps SET owner_user_id = $2, author_name = $3 WHERE id = $1")
            .bind(step_id)
            .bind(target_user_id)
            .bind(&target_name)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM step_collaborators WHERE step_id = $1 AND user_id = $2")
            .bind(step_id)
            .bind(target_user_id)
            .execute(&mut *tx)
            .await?;
        if let Some(old_oid) = prev_owner {
            if old_oid != target_user_id {
                sqlx::query(
                    "INSERT INTO step_collaborators (step_id, user_id, role, locale_scope) VALUES ($1, $2, 'editor', '{}') ON CONFLICT (step_id, user_id) DO UPDATE SET role = 'editor', locale_scope = '{}'",
                )
                .bind(step_id)
                .bind(old_oid)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        self.record_audit_log(
            step_id,
            actor,
            "owner_transferred",
            &format!("-> {target_name}"),
        )
        .await;
        Ok(true)
    }

    async fn list_step_revisions(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<Vec<StepRevisionDto>> {
        let Some((step_id, _, owner)) = self
            .lookup_step_id_and_owner(track_slug, chapter_slug, step_slug)
            .await?
        else {
            return Ok(Vec::new());
        };
        let (viewer_role, _) = self
            .resolve_viewer_step_role(viewer, step_id, owner)
            .await?;
        let can_read_drafts = viewer_role != "none";
        if !can_read_drafts {
            let has_pub: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM step_translations WHERE step_id = $1 AND locale_code = $2 AND status <> 'draft')",
            )
            .bind(step_id)
            .bind(locale)
            .fetch_one(&self.pool)
            .await?;
            if !has_pub {
                return Err(domain_err(
                    ErrorCode::DraftAccessForbidden,
                    "You do not have permission to view this article's revision history.",
                ));
            }
        }
        let rows = sqlx::query(
            r#"
            SELECT id, step_id, locale_code, edit_seq, synced_revision, status,
                   title, summary, body_markdown, content_sha256, author_user_id, author_name, change_note, created_at
            FROM step_revisions
            WHERE step_id = $1 AND locale_code = $2 AND ($3 OR status <> 'draft')
            ORDER BY edit_seq DESC, created_at DESC
            LIMIT 50
            "#,
        )
        .bind(step_id)
        .bind(locale)
        .bind(can_read_drafts)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|r| {
                Some(StepRevisionDto {
                    id: r.try_get("id").ok()?,
                    step_id: r.try_get("step_id").ok()?,
                    locale_code: r.try_get("locale_code").ok()?,
                    edit_seq: r.try_get("edit_seq").ok()?,
                    synced_revision: r.try_get("synced_revision").ok()?,
                    status: r.try_get("status").ok()?,
                    title: r.try_get("title").ok()?,
                    summary: r.try_get("summary").unwrap_or_default(),
                    body_markdown: r.try_get("body_markdown").ok()?,
                    content_sha256: r.try_get("content_sha256").unwrap_or_default(),
                    author_user_id: r.try_get("author_user_id").ok().flatten(),
                    author_name: r.try_get("author_name").unwrap_or_default(),
                    change_note: r.try_get("change_note").unwrap_or_default(),
                    created_at: r.try_get("created_at").ok()?,
                })
            })
            .collect())
    }

    async fn restore_step_revision(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
        revision_id: Uuid,
        expected_etag: Option<&str>,
        content_dir: &Path,
    ) -> Result<StudioStepEditorDto> {
        let Some((step_id, resolved_ch_slug, owner)) = self
            .lookup_step_id_and_owner(track_slug, chapter_slug, step_slug)
            .await?
        else {
            return Err(domain_err(ErrorCode::StepNotFound, "Article not found."));
        };
        let (viewer_role, viewer_scope) = self
            .resolve_viewer_step_role(actor, step_id, owner)
            .await?;
        Self::check_role_can_edit_locale(&viewer_role, &viewer_scope, locale)?;

        let rev_opt = sqlx::query(
            "SELECT edit_seq, synced_revision, title, summary, body_markdown FROM step_revisions WHERE id = $1 AND step_id = $2 AND locale_code = $3",
        )
        .bind(revision_id)
        .bind(step_id)
        .bind(locale)
        .fetch_optional(&self.pool)
        .await?;
        let Some(rev) = rev_opt else {
            return Err(domain_err(
                ErrorCode::RevisionNotFound,
                "Revision snapshot not found.",
            ));
        };

        let meta_row = sqlx::query(
            r#"
            SELECT s.step_number, COALESCE(st.status, 'draft') AS status,
                   COALESCE(st.cover_image, '') AS cover_image,
                   COALESCE(st.license, '') AS license, COALESCE(st.tags, '{}') AS tags
            FROM steps s
            LEFT JOIN step_translations st ON st.step_id = s.id AND st.locale_code = $2
            WHERE s.id = $1
            "#,
        )
        .bind(step_id)
        .bind(locale)
        .fetch_one(&self.pool)
        .await?;

        let rev_seq: i64 = rev.try_get("edit_seq")?;
        let input = SaveStudioStepInput {
            track_slug: track_slug.to_string(),
            chapter_slug: resolved_ch_slug,
            step_slug: step_slug.to_string(),
            previous_step_slug: None,
            locale: locale.to_string(),
            title: rev.try_get("title")?,
            summary: rev.try_get("summary").unwrap_or_default(),
            step_number: meta_row.try_get("step_number")?,
            estimated_minutes: 1,
            synced_revision: rev.try_get("synced_revision").unwrap_or(1),
            bump_canonical: false,
            status: meta_row.try_get("status")?,
            cover_image: meta_row.try_get("cover_image").unwrap_or_default(),
            license: meta_row.try_get("license").unwrap_or_default(),
            tags: meta_row.try_get("tags").unwrap_or_default(),
            body_markdown: rev.try_get("body_markdown")?,
            write_to_content_dir: true,
            expected_etag: expected_etag.map(ToString::to_string),
            change_note: Some(format!("Restored from #{rev_seq}")),
        };
        let saved = self
            .studio_save_step(actor, input, content_dir, true)
            .await?;
        self.record_audit_log(
            step_id,
            actor,
            "revision_restored",
            &format!("{locale} <- #{rev_seq}"),
        )
        .await;
        Ok(saved)
    }

    async fn list_step_audit_logs(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Vec<CollaborationAuditLogDto>> {
        let Some((step_id, _, owner)) = self
            .lookup_step_id_and_owner(track_slug, chapter_slug, step_slug)
            .await?
        else {
            return Ok(Vec::new());
        };
        let (viewer_role, _) = self
            .resolve_viewer_step_role(viewer, step_id, owner)
            .await?;
        if viewer_role == "none" {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "You do not have permission to view this article's collaboration audit log.",
            ));
        }
        let rows = sqlx::query(
            "SELECT id, step_id, actor_user_id, actor_name, action, detail, created_at FROM collaboration_audit_logs WHERE step_id = $1 ORDER BY created_at DESC LIMIT 50",
        )
        .bind(step_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|r| {
                Some(CollaborationAuditLogDto {
                    id: r.try_get("id").ok()?,
                    step_id: r.try_get("step_id").ok()?,
                    actor_user_id: r.try_get("actor_user_id").ok().flatten(),
                    actor_name: r.try_get("actor_name").unwrap_or_default(),
                    action: r.try_get("action").ok()?,
                    detail: r.try_get("detail").unwrap_or_default(),
                    created_at: r.try_get("created_at").ok()?,
                })
            })
            .collect())
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
