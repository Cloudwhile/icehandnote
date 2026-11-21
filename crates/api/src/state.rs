use crate::error::ApiError;
use axum::http::{header, HeaderMap};
use icehandnote_core::{
    auth::{
        compute_device_fingerprint, normalize_supported_locale, parse_user_agent_device,
        BlogSsoClaims, CollaboratorInviteDto, CreateChapterInput, CreateTrackInput,
        SaveStudioStepInput, SiteSettingsDto, StudioStepEditorDto, StudioTrackDto,
        UpdateUserProfileInput, UserProfileDto, UserRole, UserSessionDto,
    },
    error::ErrorCode,
    mail_templates::SmtpSettingsDto,
    ArticleTaskChecksDto, CreateMarginNoteInput, LearnerProgressDto, SearchHitDto, StepDetailDto,
    TrackSummaryDto, UserMarginNoteDto,
};
use icehandnote_db::{content_loader::ContentBundle, TutorialRepository};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};
use uuid::Uuid;

pub type PendingMap = HashMap<String, PendingOAuthAuthorization>;
pub type TicketMap = HashMap<String, OneTimeOAuthTicket>;
pub type OnboardingMap = HashMap<String, PendingOAuthOnboarding>;
pub type CooldownMap = HashMap<String, chrono::DateTime<chrono::Utc>>;

#[derive(Clone)]
pub struct AppState {
    pub repo: Arc<DynamicRepository>,
    pub content_dir: PathBuf,
    pub store_path: PathBuf,
    pub uploads_dir: PathBuf,
    pub secrets_path: PathBuf,
    pub runtime_secrets: Arc<tokio::sync::RwLock<RuntimeSecretsConfig>>,
    pub oauth_pending: Arc<tokio::sync::Mutex<PendingMap>>,
    pub oauth_tickets: Arc<tokio::sync::Mutex<TicketMap>>,
    pub oauth_onboardings: Arc<tokio::sync::Mutex<OnboardingMap>>,
    pub forgot_password_cooldowns: Arc<tokio::sync::Mutex<CooldownMap>>,
    pub blog_sso_secret: String,
    pub blog_origin_url: String,
    pub blog_wp_api_url: Option<String>,
    pub dev_sso_simulator: bool,
    pub default_settings: SiteSettingsDto,
    pub http_client: reqwest::Client,
}

#[derive(Serialize)]
pub struct AuthSessionResponse {
    pub session_token: String,
    pub user: UserProfileDto,
    pub learner_key: String,
}

#[derive(Clone)]
pub struct PendingOAuthAuthorization {
    pub code_verifier: String,
    pub redirect_uri: String,
    pub return_to: String,
    pub bind_user_id: Option<Uuid>,
    pub expires_at: i64,
}

#[derive(Clone)]
pub struct OneTimeOAuthTicket {
    pub user: UserProfileDto,
    pub expires_at: i64,
}

#[derive(Clone)]
pub struct PendingOAuthOnboarding {
    pub provider: String,
    pub provider_display_name: String,
    pub subject: String,
    pub suggested_username: String,
    pub display_name: String,
    pub email: String,
    pub oauth_avatar_url: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RuntimeSecretsConfig {
    /// `"local"` | `"postgres"` | `""`
    #[serde(default)]
    pub storage_mode: String,
    #[serde(default)]
    pub database_url: String,
    #[serde(default)]
    pub oauth_client_secret: String,
    #[serde(default)]
    pub smtp_password: String,
    #[serde(default)]
    pub smtp: SmtpSettingsDto,
}

impl RuntimeSecretsConfig {
    pub fn load_or_default(path: &Path) -> Self {
        let mut cfg: Self = fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();

        if cfg.oauth_client_secret.is_empty() {
            if let Ok(env_sec) = std::env::var("OAUTH_CLIENT_SECRET") {
                if !env_sec.trim().is_empty() {
                    cfg.oauth_client_secret = env_sec.trim().to_string();
                }
            }
        }
        if cfg.smtp.host.is_empty() {
            if let Ok(host) = std::env::var("SMTP_HOST") {
                if !host.trim().is_empty() {
                    cfg.smtp.host = host.trim().to_string();
                    cfg.smtp.enabled = true;
                }
            }
        }
        if let Ok(port_str) = std::env::var("SMTP_PORT") {
            if let Ok(p) = port_str.trim().parse::<u16>() {
                if cfg.smtp.port == 465 && p > 0 {
                    cfg.smtp.port = p;
                }
            }
        }
        if cfg.smtp.username.is_empty() {
            if let Ok(user) = std::env::var("SMTP_USERNAME") {
                if !user.trim().is_empty() {
                    cfg.smtp.username = user.trim().to_string();
                }
            }
        }
        if cfg.smtp_password.is_empty() {
            if let Ok(pw) = std::env::var("SMTP_PASSWORD") {
                if !pw.trim().is_empty() {
                    cfg.smtp_password = pw.trim().to_string();
                }
            }
        }
        if cfg.smtp.from_email.is_empty() {
            if let Ok(fe) = std::env::var("SMTP_FROM_EMAIL") {
                if !fe.trim().is_empty() {
                    cfg.smtp.from_email = fe.trim().to_string();
                }
            }
        }
        if let Ok(fn_env) = std::env::var("SMTP_FROM_NAME") {
            if !fn_env.trim().is_empty() && cfg.smtp.from_name == "IceHandnote" {
                cfg.smtp.from_name = fn_env.trim().to_string();
            }
        }
        cfg
    }

    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let body = serde_json::to_string_pretty(self)?;
        fs::write(path, body)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }
}

pub struct DynamicRepository {
    inner: RwLock<Arc<dyn TutorialRepository>>,
}

impl DynamicRepository {
    pub fn new(initial: Arc<dyn TutorialRepository>) -> Self {
        Self {
            inner: RwLock::new(initial),
        }
    }

    pub fn current(&self) -> Arc<dyn TutorialRepository> {
        self.inner.read().expect("repository lock poisoned").clone()
    }

    pub fn swap(&self, next: Arc<dyn TutorialRepository>) {
        *self.inner.write().expect("repository lock poisoned") = next;
    }
}

#[async_trait::async_trait]
impl TutorialRepository for DynamicRepository {
    fn backend_kind(&self) -> &'static str {
        self.current().backend_kind()
    }

    async fn list_tracks(&self, locale: &str) -> anyhow::Result<Vec<TrackSummaryDto>> {
        self.current().list_tracks(locale).await
    }

    async fn get_step_detail(
        &self,
        locale: &str,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> anyhow::Result<Option<StepDetailDto>> {
        self.current()
            .get_step_detail(locale, track_slug, chapter_slug, step_slug)
            .await
    }

    async fn search(&self, locale: &str, query: &str) -> anyhow::Result<Vec<SearchHitDto>> {
        self.current().search(locale, query).await
    }

    async fn get_progress(&self, learner_id: &str) -> anyhow::Result<LearnerProgressDto> {
        self.current().get_progress(learner_id).await
    }

    async fn toggle_step_complete(
        &self,
        learner_id: &str,
        step_id: Uuid,
        completed: bool,
    ) -> anyhow::Result<LearnerProgressDto> {
        self.current()
            .toggle_step_complete(learner_id, step_id, completed)
            .await
    }

    async fn get_task_checks(
        &self,
        learner_id: &str,
        step_id: Uuid,
    ) -> anyhow::Result<ArticleTaskChecksDto> {
        self.current().get_task_checks(learner_id, step_id).await
    }

    async fn toggle_task_check(
        &self,
        learner_id: &str,
        step_id: Uuid,
        task_item_id: &str,
        checked: bool,
    ) -> anyhow::Result<ArticleTaskChecksDto> {
        self.current()
            .toggle_task_check(learner_id, step_id, task_item_id, checked)
            .await
    }

    async fn like_step(&self, step_id: Uuid) -> anyhow::Result<i64> {
        self.current().like_step(step_id).await
    }

    async fn list_margin_notes(
        &self,
        step_id: Uuid,
        learner_id: &str,
    ) -> anyhow::Result<Vec<UserMarginNoteDto>> {
        self.current().list_margin_notes(step_id, learner_id).await
    }

    async fn create_margin_note(
        &self,
        input: CreateMarginNoteInput,
    ) -> anyhow::Result<UserMarginNoteDto> {
        self.current().create_margin_note(input).await
    }

    async fn delete_margin_note(&self, note_id: Uuid, learner_id: &str) -> anyhow::Result<bool> {
        self.current().delete_margin_note(note_id, learner_id).await
    }

    async fn sync_bundle(&self, bundle: &ContentBundle) -> anyhow::Result<usize> {
        self.current().sync_bundle(bundle).await
    }

    async fn upsert_blog_user(&self, claims: &BlogSsoClaims) -> anyhow::Result<UserProfileDto> {
        self.current().upsert_blog_user(claims).await
    }

    async fn find_oauth_user(
        &self,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> anyhow::Result<Option<UserProfileDto>> {
        self.current()
            .find_oauth_user(provider, subject, oauth_avatar_url)
            .await
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
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .complete_oauth_registration(
                provider,
                subject,
                username,
                display_name,
                email,
                role,
                avatar_source,
                oauth_avatar_url,
                uploaded_avatar_url,
            )
            .await
    }

    async fn bind_oauth_to_user(
        &self,
        user_id: Uuid,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .bind_oauth_to_user(user_id, provider, subject, oauth_avatar_url)
            .await
    }

    async fn register_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        password: &str,
        role: UserRole,
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .register_local_account(username, display_name, email, password, role)
            .await
    }

    async fn is_username_taken(&self, username: &str) -> anyhow::Result<bool> {
        self.current().is_username_taken(username).await
    }

    async fn authenticate_password(
        &self,
        identifier: &str,
        password: &str,
    ) -> anyhow::Result<Option<UserProfileDto>> {
        self.current()
            .authenticate_password(identifier, password)
            .await
    }

    async fn update_user_profile(
        &self,
        user_id: Uuid,
        input: UpdateUserProfileInput,
    ) -> anyhow::Result<UserProfileDto> {
        self.current().update_user_profile(user_id, input).await
    }

    async fn create_password_reset_token(
        &self,
        email: &str,
    ) -> anyhow::Result<Option<(UserProfileDto, String, String)>> {
        self.current().create_password_reset_token(email).await
    }

    async fn verify_password_reset_otp(
        &self,
        email: &str,
        otp_code: &str,
    ) -> anyhow::Result<String> {
        self.current()
            .verify_password_reset_otp(email, otp_code)
            .await
    }

    async fn consume_password_reset_token(
        &self,
        raw_token: &str,
        new_password: &str,
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .consume_password_reset_token(raw_token, new_password)
            .await
    }

    async fn consume_password_reset_otp(
        &self,
        email: &str,
        otp_code: &str,
        new_password: &str,
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .consume_password_reset_otp(email, otp_code, new_password)
            .await
    }

    async fn create_registration_verification_code(
        &self,
        email: &str,
    ) -> anyhow::Result<(Uuid, String)> {
        self.current()
            .create_registration_verification_code(email)
            .await
    }

    async fn verify_registration_verification_code(
        &self,
        email: &str,
        code: &str,
    ) -> anyhow::Result<Uuid> {
        self.current()
            .verify_registration_verification_code(email, code)
            .await
    }

    async fn consume_registration_verification_code(&self, code_id: Uuid) -> anyhow::Result<()> {
        self.current()
            .consume_registration_verification_code(code_id)
            .await
    }

    async fn change_user_password(
        &self,
        user_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> anyhow::Result<()> {
        self.current()
            .change_user_password(user_id, current_password, new_password)
            .await
    }

    async fn create_session(&self, user_id: Uuid) -> anyhow::Result<String> {
        self.current().create_session(user_id).await
    }

    async fn create_session_with_meta(
        &self,
        user_id: Uuid,
        ip_address: &str,
        user_agent: &str,
        device_label: &str,
        device_fingerprint: &str,
    ) -> anyhow::Result<String> {
        self.current()
            .create_session_with_meta(
                user_id,
                ip_address,
                user_agent,
                device_label,
                device_fingerprint,
            )
            .await
    }

    async fn get_user_by_session(&self, raw_token: &str) -> anyhow::Result<Option<UserProfileDto>> {
        self.current().get_user_by_session(raw_token).await
    }

    async fn touch_session(&self, raw_token: &str, ip_address: &str) -> anyhow::Result<()> {
        self.current().touch_session(raw_token, ip_address).await
    }

    async fn list_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> anyhow::Result<Vec<UserSessionDto>> {
        self.current()
            .list_user_sessions(user_id, current_raw_token)
            .await
    }

    async fn revoke_user_session(&self, user_id: Uuid, session_id: Uuid) -> anyhow::Result<bool> {
        self.current()
            .revoke_user_session(user_id, session_id)
            .await
    }

    async fn revoke_other_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> anyhow::Result<usize> {
        self.current()
            .revoke_other_user_sessions(user_id, current_raw_token)
            .await
    }

    async fn delete_session(&self, raw_token: &str) -> anyhow::Result<()> {
        self.current().delete_session(raw_token).await
    }

    async fn detect_login_anomaly(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
    ) -> anyhow::Result<Option<String>> {
        self.current()
            .detect_login_anomaly(user_id, ip_address, device_fingerprint)
            .await
    }

    async fn record_trusted_device(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
        device_label: &str,
    ) -> anyhow::Result<()> {
        self.current()
            .record_trusted_device(user_id, ip_address, device_fingerprint, device_label)
            .await
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
    ) -> anyhow::Result<(Uuid, String)> {
        self.current()
            .create_login_otp_challenge(
                user_id,
                email,
                ip_address,
                user_agent,
                device_label,
                device_fingerprint,
                anomaly_reason,
            )
            .await
    }

    async fn resend_login_otp_challenge(
        &self,
        challenge_id: Uuid,
    ) -> anyhow::Result<(UserProfileDto, String, String, String, String)> {
        self.current()
            .resend_login_otp_challenge(challenge_id)
            .await
    }

    async fn verify_login_otp_challenge(
        &self,
        challenge_id: Uuid,
        code: &str,
    ) -> anyhow::Result<(UserProfileDto, String, String, String, String)> {
        self.current()
            .verify_login_otp_challenge(challenge_id, code)
            .await
    }

    async fn delete_login_otp_challenge(&self, challenge_id: Uuid) -> anyhow::Result<()> {
        self.current()
            .delete_login_otp_challenge(challenge_id)
            .await
    }

    async fn merge_anonymous_learner(
        &self,
        anon_id: &str,
        user_learner_id: &str,
    ) -> anyhow::Result<()> {
        self.current()
            .merge_anonymous_learner(anon_id, user_learner_id)
            .await
    }

    async fn studio_list_tracks(&self, locale: &str) -> anyhow::Result<Vec<StudioTrackDto>> {
        self.current().studio_list_tracks(locale).await
    }

    async fn studio_get_step_editor(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> anyhow::Result<StudioStepEditorDto> {
        self.current()
            .studio_get_step_editor(viewer, track_slug, chapter_slug, step_slug, locale)
            .await
    }

    async fn studio_save_step(
        &self,
        author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
    ) -> anyhow::Result<StudioStepEditorDto> {
        self.current()
            .studio_save_step(author, input, content_dir)
            .await
    }

    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> anyhow::Result<StudioTrackDto> {
        self.current().studio_create_track(input, content_dir).await
    }

    async fn studio_delete_track(
        &self,
        track_slug: &str,
        content_dir: &Path,
    ) -> anyhow::Result<bool> {
        self.current()
            .studio_delete_track(track_slug, content_dir)
            .await
    }

    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        content_dir: &Path,
    ) -> anyhow::Result<()> {
        self.current()
            .studio_create_chapter(input, content_dir)
            .await
    }

    async fn studio_delete_chapter(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        content_dir: &Path,
    ) -> anyhow::Result<bool> {
        self.current()
            .studio_delete_chapter(track_slug, chapter_slug, content_dir)
            .await
    }

    async fn studio_delete_step(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> anyhow::Result<bool> {
        self.current()
            .studio_delete_step(actor, track_slug, chapter_slug, step_slug, content_dir)
            .await
    }

    async fn create_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        email: &str,
    ) -> anyhow::Result<(CollaboratorInviteDto, String, String)> {
        self.current()
            .create_collaborator_invite(actor, track_slug, chapter_slug, step_slug, email)
            .await
    }

    async fn revoke_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        invite_id: Uuid,
    ) -> anyhow::Result<bool> {
        self.current()
            .revoke_collaborator_invite(actor, invite_id)
            .await
    }

    async fn accept_collaborator_invite(
        &self,
        user: &UserProfileDto,
        raw_token: &str,
    ) -> anyhow::Result<(String, String, String)> {
        self.current()
            .accept_collaborator_invite(user, raw_token)
            .await
    }

    async fn remove_step_collaborator(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> anyhow::Result<bool> {
        self.current()
            .remove_step_collaborator(actor, track_slug, chapter_slug, step_slug, target_user_id)
            .await
    }

    async fn admin_takedown_step(
        &self,
        admin: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        reason: &str,
    ) -> anyhow::Result<(String, Vec<UserProfileDto>)> {
        self.current()
            .admin_takedown_step(admin, track_slug, chapter_slug, step_slug, reason)
            .await
    }

    async fn admin_restore_step(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> anyhow::Result<bool> {
        self.current()
            .admin_restore_step(track_slug, chapter_slug, step_slug)
            .await
    }

    async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .upsert_local_account(username, display_name, email, role, password)
            .await
    }

    async fn admin_create_user(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .admin_create_user(username, display_name, email, role, password)
            .await
    }

    async fn admin_list_users(&self) -> anyhow::Result<Vec<UserProfileDto>> {
        self.current().admin_list_users().await
    }

    async fn admin_update_user_role(
        &self,
        target_user_id: Uuid,
        new_role: UserRole,
    ) -> anyhow::Result<Option<UserProfileDto>> {
        self.current()
            .admin_update_user_role(target_user_id, new_role)
            .await
    }

    async fn admin_set_user_ban(
        &self,
        target_user_id: Uuid,
        banned: bool,
        reason: &str,
    ) -> anyhow::Result<Option<UserProfileDto>> {
        self.current()
            .admin_set_user_ban(target_user_id, banned, reason)
            .await
    }

    async fn admin_delete_user(&self, target_user_id: Uuid) -> anyhow::Result<bool> {
        self.current().admin_delete_user(target_user_id).await
    }

    async fn admin_reset_user_password(
        &self,
        target_user_id: Uuid,
        new_password: &str,
    ) -> anyhow::Result<Option<UserProfileDto>> {
        self.current()
            .admin_reset_user_password(target_user_id, new_password)
            .await
    }

    async fn get_site_settings(&self, fallback: &SiteSettingsDto) -> anyhow::Result<SiteSettingsDto> {
        self.current().get_site_settings(fallback).await
    }

    async fn update_site_settings(
        &self,
        updated_by: Uuid,
        settings: SiteSettingsDto,
    ) -> anyhow::Result<SiteSettingsDto> {
        self.current()
            .update_site_settings(updated_by, settings)
            .await
    }
}

pub fn internal_err<E: std::fmt::Display>(err: E) -> ApiError {
    ApiError::new(ErrorCode::InternalError, err.to_string())
}

pub fn repo_err(err: anyhow::Error) -> ApiError {
    ApiError::from_anyhow(err)
}

pub fn repo_err_or(err: anyhow::Error, fallback: ErrorCode) -> ApiError {
    ApiError::from_anyhow_with_fallback(err, fallback)
}

pub fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let auth = headers.get("authorization")?.to_str().ok()?;
    let token = auth.strip_prefix("Bearer ")?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct ClientContext {
    pub ip_address: String,
    pub user_agent: String,
    pub device_label: String,
    pub device_fingerprint: String,
}

pub fn extract_client_ip(headers: &HeaderMap, peer_ip: Option<std::net::IpAddr>) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next().map(str::trim).filter(|s| !s.is_empty()) {
            return first.chars().take(64).collect();
        }
    }
    if let Some(xri) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let clean = xri.trim();
        if !clean.is_empty() {
            return clean.chars().take(64).collect();
        }
    }
    if let Some(ip) = peer_ip {
        return ip.to_string();
    }
    "127.0.0.1".to_string()
}

pub fn extract_client_context(
    headers: &HeaderMap,
    peer_ip: Option<std::net::IpAddr>,
) -> ClientContext {
    let ip_address = extract_client_ip(headers, peer_ip);
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().chars().take(512).collect::<String>())
        .unwrap_or_default();
    let client_device_id = headers
        .get("x-device-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim);
    let (device_label, _) = parse_user_agent_device(&user_agent);
    let device_fingerprint = compute_device_fingerprint(client_device_id, &user_agent);
    ClientContext {
        ip_address,
        user_agent,
        device_label,
        device_fingerprint,
    }
}

pub fn resolve_request_locale(
    explicit: Option<&str>,
    headers: &HeaderMap,
    site_default_locale: &str,
) -> &'static str {
    if let Some(exp) = explicit.filter(|s| !s.trim().is_empty()) {
        return normalize_supported_locale(Some(exp), site_default_locale);
    }
    if let Some(hdr) = headers.get("x-site-locale").and_then(|v| v.to_str().ok()) {
        if !hdr.trim().is_empty() {
            return normalize_supported_locale(Some(hdr), site_default_locale);
        }
    }
    if let Some(al) = headers
        .get(header::ACCEPT_LANGUAGE)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(primary) = al.split(',').next().and_then(|s| s.split(';').next()) {
            return normalize_supported_locale(Some(primary), site_default_locale);
        }
    }
    normalize_supported_locale(None, site_default_locale)
}

pub async fn require_authenticated_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserProfileDto, ApiError> {
    let Some(token) = extract_bearer_token(headers) else {
        return Err(ApiError::new(
            ErrorCode::Unauthorized,
            "Authentication required.",
        ));
    };
    let user = state
        .repo
        .get_user_by_session(&token)
        .await
        .map_err(repo_err)?;
    match user {
        Some(u) => {
            let ip = extract_client_ip(headers, None);
            let _ = state.repo.touch_session(&token, &ip).await;
            Ok(u)
        }
        None => Err(ApiError::new(
            ErrorCode::SessionExpired,
            "Session has expired or is invalid. Please sign in again.",
        )),
    }
}

pub async fn require_author_or_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserProfileDto, ApiError> {
    let user = require_authenticated_user(state, headers).await?;
    if !user.role.can_author() {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Author or administrator privileges required.",
        ));
    }
    Ok(user)
}

pub async fn require_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserProfileDto, ApiError> {
    let user = require_authenticated_user(state, headers).await?;
    if !user.role.is_admin() {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Administrator privileges required.",
        ));
    }
    Ok(user)
}

pub async fn finalize_login_session(
    state: &AppState,
    user: UserProfileDto,
    anon_learner_id: Option<&str>,
    ctx: &ClientContext,
) -> Result<AuthSessionResponse, ApiError> {
    let learner_key = format!("user:{}", user.id);
    if let Some(anon_id) = anon_learner_id {
        state
            .repo
            .merge_anonymous_learner(anon_id, &learner_key)
            .await
            .map_err(repo_err)?;
    }
    let _ = state
        .repo
        .record_trusted_device(
            user.id,
            &ctx.ip_address,
            &ctx.device_fingerprint,
            &ctx.device_label,
        )
        .await;
    let session_token = state
        .repo
        .create_session_with_meta(
            user.id,
            &ctx.ip_address,
            &ctx.user_agent,
            &ctx.device_label,
            &ctx.device_fingerprint,
        )
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::Forbidden))?;
    Ok(AuthSessionResponse {
        session_token,
        user,
        learner_key,
    })
}

pub fn detect_external_origin(headers: &HeaderMap) -> String {
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|p| *p == "https" || *p == "http")
        .unwrap_or("http");
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .unwrap_or("127.0.0.1:3001");
    format!("{proto}://{host}")
}

pub fn mask_database_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let Some(scheme_sep) = trimmed.find("://") else {
        return "postgres://***".to_string();
    };
    let after_scheme = &trimmed[scheme_sep + 3..];
    if let Some(at_idx) = after_scheme.rfind('@') {
        let user_part = &after_scheme[..at_idx];
        let host_part = &after_scheme[at_idx + 1..];
        let user_name = user_part.split(':').next().unwrap_or("user");
        format!("{}://{user_name}:***@{host_part}", &trimmed[..scheme_sep])
    } else {
        trimmed.to_string()
    }
}
