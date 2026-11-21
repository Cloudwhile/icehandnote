pub mod content_loader;
pub mod local_seed;
pub mod postgres;
pub mod studio_auth;

pub use local_seed::LocalSeedRepository;
pub use postgres::PostgresRepository;

pub(crate) fn domain_err(
    code: icehandnote_core::error::ErrorCode,
    detail: impl Into<String>,
) -> anyhow::Error {
    icehandnote_core::error::DomainError::new(code, detail).into()
}

use anyhow::Result;
use async_trait::async_trait;
use content_loader::ContentBundle;
use icehandnote_core::{
    auth::{
        BlogSsoClaims, CollaboratorInviteDto, CreateChapterInput, CreateTrackInput,
        SaveStudioStepInput, SiteSettingsDto, StudioStepEditorDto, StudioTrackDto,
        UpdateUserProfileInput, UserProfileDto, UserRole, UserSessionDto,
    },
    ArticleTaskChecksDto, CreateMarginNoteInput, LearnerProgressDto, SearchHitDto, StepDetailDto,
    TrackSummaryDto, UserMarginNoteDto,
};
use std::path::Path;
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
    async fn studio_list_tracks(&self, locale: &str) -> Result<Vec<StudioTrackDto>>;
    async fn studio_get_step_editor(
        &self,
        viewer: &UserProfileDto,
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
    async fn create_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        email: &str,
    ) -> Result<(CollaboratorInviteDto, String, String)>;
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
