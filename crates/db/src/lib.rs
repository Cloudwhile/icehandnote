pub mod content_loader;
pub mod local_seed;
pub mod postgres;
pub mod studio_auth;

pub use local_seed::LocalSeedRepository;
pub use postgres::PostgresRepository;

use std::fs;
use std::path::{Component, Path, PathBuf};

pub(crate) fn is_valid_slug_segment(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 96
        && !slug.contains('/')
        && !slug.contains('\\')
        && !slug.contains("..")
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn is_valid_step_slug_segment(slug: &str) -> bool {
    is_valid_slug_segment(slug) && slug != "-"
}

pub(crate) fn is_supported_locale_code(locale: &str) -> bool {
    let trimmed = locale.trim();
    icehandnote_core::SUPPORTED_LOCALES
        .iter()
        .any(|(code, _)| *code == trimmed)
}

pub(crate) fn is_symlink_path(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

pub(crate) fn ensure_within_dir(base: &Path, target: &Path) -> anyhow::Result<PathBuf> {
    let checked = target.strip_prefix(base).unwrap_or(target);
    if checked
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        anyhow::bail!("Refusing parent-directory traversal in {}", target.display());
    }
    let canon_base = fs::canonicalize(base)?;
    let mut suffix = PathBuf::new();
    let mut cursor = target.to_path_buf();
    while !cursor.exists() {
        if is_symlink_path(&cursor) {
            anyhow::bail!("Refusing symlink path inside directory: {}", cursor.display());
        }
        let Some(name) = cursor.file_name() else {
            break;
        };
        suffix = PathBuf::from(name).join(suffix);
        let Some(parent) = cursor.parent() else {
            break;
        };
        cursor = parent.to_path_buf();
    }
    if is_symlink_path(&cursor) {
        anyhow::bail!("Refusing symlink path inside directory: {}", cursor.display());
    }
    let canon_existing = fs::canonicalize(&cursor)?;
    let resolved = if suffix.as_os_str().is_empty() {
        canon_existing
    } else {
        canon_existing.join(&suffix)
    };
    if !resolved.starts_with(&canon_base) {
        anyhow::bail!(
            "Path {} escapes base directory {}",
            resolved.display(),
            canon_base.display()
        );
    }
    Ok(resolved)
}

pub(crate) fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    use std::io::Write as _;
    if is_symlink_path(path) {
        anyhow::bail!("Refusing to overwrite symlink at {}", path.display());
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp_name = format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    );
    let tmp_path = parent.join(tmp_name);
    let write_res = (|| -> anyhow::Result<()> {
        let mut f = fs::File::create(&tmp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(())
    })();
    if let Err(err) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }
    if let Err(err) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(err.into());
    }
    Ok(())
}

pub(crate) fn atomic_write_str(path: &Path, text: &str) -> anyhow::Result<()> {
    atomic_write_bytes(path, text.as_bytes())
}

pub(crate) fn escape_like_pattern(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '%' => out.push_str("\\%"),
            '_' => out.push_str("\\_"),
            c => out.push(c),
        }
    }
    out
}

pub(crate) fn domain_err(
    code: icehandnote_core::error::ErrorCode,
    detail: impl Into<String>,
) -> anyhow::Error {
    icehandnote_core::error::DomainError::new(code, detail).into()
}

pub(crate) const GUEST_NOTES_PER_STEP_LIMIT: usize = 50;
pub(crate) const USER_NOTES_PER_STEP_LIMIT: usize = 500;
pub(crate) const NOTE_UNDO_GRACE_MINUTES: i64 = 15;

pub(crate) fn note_quota_for_owner(owner_key: &str) -> usize {
    if owner_key.starts_with("user:") {
        USER_NOTES_PER_STEP_LIMIT
    } else {
        GUEST_NOTES_PER_STEP_LIMIT
    }
}

/// RFC 9110 §13.1.1 strong comparison for `If-Match` conditional requests.
pub(crate) fn if_match_satisfies(if_match_raw: &str, current_etag: &str) -> bool {
    let trimmed = if_match_raw.trim();
    if trimmed == "*" {
        return true;
    }
    trimmed.split(',').map(str::trim).any(|candidate| {
        !candidate.is_empty()
            && !candidate.starts_with("W/")
            && !current_etag.starts_with("W/")
            && candidate == current_etag
    })
}

pub(crate) fn precondition_failed_err(
    expected_etag: &str,
    current: &UserMarginNoteDto,
) -> anyhow::Error {
    icehandnote_core::error::DomainError::new(
        icehandnote_core::error::ErrorCode::PreconditionFailed,
        "This note was modified elsewhere. Refresh before saving your changes.",
    )
    .with_meta(serde_json::json!({
        "expected_etag": expected_etag,
        "current_etag": current.etag(),
        "current_version": current.version,
        "updated_at": current.updated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    }))
    .into()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn revision_conflict_err(
    expected_etag: &str,
    current_etag: &str,
    current_edit_seq: i64,
    updated_by: &str,
    updated_at: DateTime<Utc>,
    remote_title: &str,
    remote_summary: &str,
    remote_body_markdown: &str,
) -> anyhow::Error {
    icehandnote_core::error::DomainError::new(
        icehandnote_core::error::ErrorCode::RevisionConflict,
        "This article was updated by another collaborator since you loaded it.",
    )
    .with_meta(serde_json::json!({
        "expected_etag": expected_etag,
        "current_etag": current_etag,
        "current_edit_seq": current_edit_seq,
        "updated_by": updated_by,
        "updated_at": updated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "remote_title": remote_title,
        "remote_summary": remote_summary,
        "remote_body_markdown": remote_body_markdown,
    }))
    .into()
}

use anyhow::Result;
use async_trait::async_trait;
use content_loader::ContentBundle;
use icehandnote_core::{
    auth::{
        BlogSsoClaims, CollaborationAuditLogDto, CollaboratorInviteDto, CreateChapterInput,
        CreateTrackInput, InvitePreviewDto, SaveStudioStepInput, SiteSettingsDto, StepRevisionDto,
        StudioStepEditorDto, StudioTrackDto, UpdateUserProfileInput, UserPasskeyDto,
        UserProfileDto, UserRole, UserSessionDto,
    },
    webauthn::StoredPasskeyCredential,
    ArticleTaskChecksDto, CreateMarginNoteInput, LearnerProgressDto, ListMarginNotesFilter,
    SearchHitDto, StepDetailDto, TrackSummaryDto, UpdateMarginNoteInput, UserMarginNoteDto,
};
use chrono::{DateTime, Utc};
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
    async fn list_margin_notes_filtered(
        &self,
        learner_id: &str,
        filter: &ListMarginNotesFilter,
    ) -> Result<(Vec<UserMarginNoteDto>, usize)>;
    async fn create_margin_note(&self, input: CreateMarginNoteInput) -> Result<UserMarginNoteDto>;
    async fn update_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        input: UpdateMarginNoteInput,
        expected_etag: Option<&str>,
    ) -> Result<UserMarginNoteDto>;
    async fn delete_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        expected_etag: Option<&str>,
    ) -> Result<Option<DateTime<Utc>>>;
    async fn restore_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
    ) -> Result<UserMarginNoteDto>;
    async fn sync_bundle(&self, bundle: &ContentBundle) -> Result<usize>;

    // Auth, OAuth Onboarding/Binding, Profile & Password Reset
    async fn upsert_blog_user(&self, claims: &BlogSsoClaims) -> Result<UserProfileDto>;
    async fn find_oauth_user(
        &self,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> Result<Option<UserProfileDto>>;
    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<UserProfileDto>;
    async fn bind_oauth_to_user(
        &self,
        user_id: Uuid,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> Result<UserProfileDto>;
    async fn unbind_oauth_from_user(
        &self,
        user_id: Uuid,
        provider: &str,
    ) -> Result<UserProfileDto>;
    async fn list_user_passkeys(&self, user_id: Uuid) -> Result<Vec<UserPasskeyDto>>;
    async fn save_user_passkey(&self, cred: StoredPasskeyCredential) -> Result<UserPasskeyDto>;
    async fn find_passkey_by_credential_id(
        &self,
        credential_id: &str,
    ) -> Result<Option<(StoredPasskeyCredential, UserProfileDto)>>;
    async fn touch_passkey_usage(&self, credential_id: &str, new_counter: u32) -> Result<()>;
    async fn rename_user_passkey(
        &self,
        user_id: Uuid,
        credential_id: &str,
        new_name: &str,
    ) -> Result<Option<UserPasskeyDto>>;
    async fn delete_user_passkey(&self, user_id: Uuid, credential_id: &str) -> Result<bool>;
    async fn register_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        password: &str,
        role: UserRole,
    ) -> Result<UserProfileDto>;
    async fn is_username_taken(&self, username: &str) -> Result<bool>;
    async fn authenticate_password(
        &self,
        identifier: &str,
        password: &str,
    ) -> Result<Option<UserProfileDto>>;
    async fn update_user_profile(
        &self,
        user_id: Uuid,
        input: UpdateUserProfileInput,
    ) -> Result<UserProfileDto>;
    async fn is_email_taken_by_other(&self, email: &str, exclude_user_id: Uuid) -> Result<bool>;
    async fn update_user_email(
        &self,
        user_id: Uuid,
        new_email: &str,
    ) -> Result<UserProfileDto>;
    async fn create_password_reset_token(
        &self,
        email: &str,
    ) -> Result<Option<(UserProfileDto, String, String)>>;
    async fn verify_password_reset_otp(&self, email: &str, otp_code: &str) -> Result<String>;
    async fn consume_password_reset_token(
        &self,
        raw_token: &str,
        new_password: &str,
    ) -> Result<UserProfileDto>;
    async fn consume_password_reset_otp(
        &self,
        email: &str,
        otp_code: &str,
        new_password: &str,
    ) -> Result<UserProfileDto>;
    async fn create_registration_verification_code(&self, email: &str) -> Result<(Uuid, String)>;
    async fn verify_registration_verification_code(
        &self,
        email: &str,
        code: &str,
    ) -> Result<Uuid>;
    async fn consume_registration_verification_code(&self, code_id: Uuid) -> Result<()>;
    async fn change_user_password(
        &self,
        user_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> Result<()>;
    async fn create_session(&self, user_id: Uuid) -> Result<String>;
    async fn create_session_with_meta(
        &self,
        user_id: Uuid,
        ip_address: &str,
        user_agent: &str,
        device_label: &str,
        device_fingerprint: &str,
    ) -> Result<String>;
    async fn get_user_by_session(&self, raw_token: &str) -> Result<Option<UserProfileDto>>;
    async fn touch_session(&self, raw_token: &str, ip_address: &str) -> Result<()>;
    async fn list_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> Result<Vec<UserSessionDto>>;
    async fn revoke_user_session(&self, user_id: Uuid, session_id: Uuid) -> Result<bool>;
    async fn revoke_other_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> Result<usize>;
    async fn delete_session(&self, raw_token: &str) -> Result<()>;
    async fn detect_login_anomaly(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
    ) -> Result<Option<String>>;
    async fn record_trusted_device(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
        device_label: &str,
    ) -> Result<()>;
    #[allow(clippy::too_many_arguments)]
    async fn create_login_otp_challenge(
        &self,
        user_id: Uuid,
        email: &str,
        ip_address: &str,
        user_agent: &str,
        device_label: &str,
        device_fingerprint: &str,
        anomaly_reason: &str,
    ) -> Result<(Uuid, String)>;
    async fn resend_login_otp_challenge(
        &self,
        challenge_id: Uuid,
    ) -> Result<(UserProfileDto, String, String, String, String)>;
    async fn verify_login_otp_challenge(
        &self,
        challenge_id: Uuid,
        code: &str,
    ) -> Result<(UserProfileDto, String, String, String, String)>;
    async fn delete_login_otp_challenge(&self, challenge_id: Uuid) -> Result<()>;
    async fn merge_anonymous_learner(&self, anon_id: &str, user_learner_id: &str) -> Result<()>;

    // Studio Authoring, Track/Chapter Deletion & Co-Author Collaboration
    async fn studio_list_tracks(
        &self,
        viewer: &UserProfileDto,
        locale: &str,
    ) -> Result<Vec<StudioTrackDto>>;
    async fn studio_get_step_editor(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<StudioStepEditorDto>;
    async fn resolve_step_collab_access(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Option<(Uuid, String, Vec<String>)>>;
    async fn studio_save_step(
        &self,
        author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
        require_if_match: bool,
    ) -> Result<StudioStepEditorDto>;
    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> Result<StudioTrackDto>;
    async fn studio_delete_track(&self, track_slug: &str, content_dir: &Path) -> Result<bool>;
    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        content_dir: &Path,
    ) -> Result<()>;
    async fn studio_delete_chapter(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        content_dir: &Path,
    ) -> Result<bool>;
    async fn studio_delete_step(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> Result<bool>;
    #[allow(clippy::too_many_arguments)]
    async fn create_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        email: &str,
        role: &str,
        locale_scope: &[String],
    ) -> Result<(CollaboratorInviteDto, String, String)>;
    async fn preview_collaborator_invite(
        &self,
        viewer: Option<&UserProfileDto>,
        raw_token: &str,
    ) -> Result<InvitePreviewDto>;
    async fn revoke_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        invite_id: Uuid,
    ) -> Result<bool>;
    async fn accept_collaborator_invite(
        &self,
        user: &UserProfileDto,
        raw_token: &str,
    ) -> Result<(String, String, String)>;
    async fn remove_step_collaborator(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> Result<bool>;
    #[allow(clippy::too_many_arguments)]
    async fn update_step_collaborator_role(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
        role: &str,
        locale_scope: &[String],
    ) -> Result<bool>;
    async fn leave_step_collaboration(
        &self,
        user: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<bool>;
    async fn transfer_step_ownership(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> Result<bool>;
    async fn list_step_revisions(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<Vec<StepRevisionDto>>;
    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<StudioStepEditorDto>;
    async fn list_step_audit_logs(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Vec<CollaborationAuditLogDto>>;

    // Admin Moderation, User Governance & Site Settings
    async fn admin_takedown_step(
        &self,
        admin: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        reason: &str,
    ) -> Result<(String, Vec<UserProfileDto>)>;
    async fn admin_restore_step(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<bool>;
    async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto>;
    async fn admin_create_user(
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
    async fn admin_set_user_ban(
        &self,
        target_user_id: Uuid,
        banned: bool,
        reason: &str,
    ) -> Result<Option<UserProfileDto>>;
    async fn admin_delete_user(&self, target_user_id: Uuid) -> Result<bool>;
    async fn admin_reset_user_password(
        &self,
        target_user_id: Uuid,
        new_password: &str,
    ) -> Result<Option<UserProfileDto>>;

    async fn get_site_settings(&self, fallback: &SiteSettingsDto) -> Result<SiteSettingsDto>;
    async fn update_site_settings(
        &self,
        updated_by: Uuid,
        settings: SiteSettingsDto,
    ) -> Result<SiteSettingsDto>;
}
