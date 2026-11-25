use crate::error::ApiError;
use axum::http::{header, HeaderMap, HeaderValue};
use icehandnote_core::{
    auth::{
        compute_device_fingerprint, normalize_ip_candidate, normalize_supported_locale,
        parse_user_agent_device, percent_encode_component, slugify_oauth_provider_id,
        BlogSsoClaims, CollaborationAuditLogDto, CollaboratorInviteDto, CreateChapterInput,
        CreateTrackInput, InvitePreviewDto, SaveStudioStepInput, SiteSettingsDto, StepRevisionDto,
        StudioStepEditorDto, StudioTrackDto, UpdateTrackMetaInput, UpdateUserProfileInput,
        UserProfileDto, UserRole, UserSessionDto, VerifiedLoginChallengeDto,
    },
    crypto::{sign_guest_learner_cookie, verify_guest_learner_cookie},
    error::ErrorCode,
    mail_templates::SmtpSettingsDto,
    webauthn::{StoredPasskeyCredential, UserPasskeyDto},
    ArticleTaskChecksDto, CreateMarginNoteInput, LearnerProgressDto, ListMarginNotesFilter,
    SearchHitDto, StepDetailDto, TrackSummaryDto, UpdateMarginNoteInput, UserMarginNoteDto,
};
use icehandnote_db::{content_loader::ContentBundle, TutorialRepository};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};
use uuid::Uuid;

pub type PendingMap = HashMap<String, PendingOAuthAuthorization>;
pub type TicketMap = HashMap<String, OneTimeOAuthTicket>;
pub type OnboardingMap = HashMap<String, PendingOAuthOnboarding>;
pub type BindTicketMap = HashMap<String, (Uuid, i64)>;
pub type PendingOAuthBindMap = HashMap<Uuid, PendingOAuthBind>;
pub type SsoUsedJtiMap = HashMap<String, i64>;
pub type AuthRateLimitMap = HashMap<String, Vec<chrono::DateTime<chrono::Utc>>>;
pub type CooldownMap = HashMap<String, chrono::DateTime<chrono::Utc>>;
pub type EmailChangeOtpMap = HashMap<Uuid, PendingEmailChangeOtp>;
pub type PasskeyCeremonyMap = HashMap<Uuid, PendingPasskeyCeremony>;
pub type NoteIdempotencyMap = HashMap<String, (UserMarginNoteDto, chrono::DateTime<chrono::Utc>)>;
pub type NoteRateLimitMap = HashMap<String, Vec<chrono::DateTime<chrono::Utc>>>;
pub type InviteIdempotencyMap = HashMap<String, (serde_json::Value, chrono::DateTime<chrono::Utc>)>;
pub type InviteRateLimitMap = HashMap<Uuid, Vec<chrono::DateTime<chrono::Utc>>>;
pub type CollabHubMap = HashMap<Uuid, CollabRoomState>;

pub const COLLAB_PRESENCE_TTL_SECONDS: i64 = 45;
const COLLAB_BACKLOG_LIMIT: usize = 50;
pub const EPHEMERAL_MAP_MAX_ENTRIES: usize = 4096;

#[derive(Debug, Clone)]
pub enum CollabControlSignal {
    RevokeUser(Uuid),
    CloseRoom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresenceMemberDto {
    pub user_id: Uuid,
    pub display_name: String,
    pub username: String,
    #[serde(default)]
    pub avatar_url: String,
    pub locale: String,
    pub state: String,
    pub tab_id: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub struct StoredCollabEvent {
    pub id: u64,
    pub event_name: String,
    pub data_json: String,
}

pub struct CollabRoomState {
    pub next_event_seq: u64,
    pub backlog: VecDeque<StoredCollabEvent>,
    pub subscribers: Vec<tokio::sync::mpsc::Sender<StoredCollabEvent>>,
    pub presence: HashMap<String, PresenceMemberDto>,
    pub ctrl_tx: tokio::sync::broadcast::Sender<CollabControlSignal>,
}

impl Default for CollabRoomState {
    fn default() -> Self {
        Self::new()
    }
}

impl CollabRoomState {
    pub fn new() -> Self {
        let (ctrl_tx, _) = tokio::sync::broadcast::channel(16);
        Self {
            next_event_seq: 0,
            backlog: VecDeque::with_capacity(32),
            subscribers: Vec::new(),
            presence: HashMap::new(),
            ctrl_tx,
        }
    }
}

pub const GUEST_COOKIE_NAME: &str = "ihn_guest";

#[derive(Clone)]
pub struct PendingPasskeyCeremony {
    pub kind: &'static str, // "register" | "login"
    pub user_id: Option<Uuid>,
    pub challenge: String,
    pub rp_id: String,
    pub allowed_origins: Vec<String>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct PendingEmailChangeOtp {
    pub new_email: String,
    pub code_hash: String,
    pub attempts: u8,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct PendingOAuthBind {
    pub user_id: Uuid,
    pub provider: String,
    pub subject: String,
    pub avatar_url: String,
    pub expires_at: i64,
}

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
    pub bind_tickets: Arc<tokio::sync::Mutex<BindTicketMap>>,
    pub pending_oauth_binds: Arc<tokio::sync::Mutex<PendingOAuthBindMap>>,
    pub sso_used_jtis: Arc<tokio::sync::Mutex<SsoUsedJtiMap>>,
    pub auth_rate_limits: Arc<tokio::sync::Mutex<AuthRateLimitMap>>,
    pub forgot_password_cooldowns: Arc<tokio::sync::Mutex<CooldownMap>>,
    pub email_change_otps: Arc<tokio::sync::Mutex<EmailChangeOtpMap>>,
    pub passkey_ceremonies: Arc<tokio::sync::Mutex<PasskeyCeremonyMap>>,
    pub note_idempotency: Arc<tokio::sync::Mutex<NoteIdempotencyMap>>,
    pub note_rate_limits: Arc<tokio::sync::Mutex<NoteRateLimitMap>>,
    pub invite_idempotency: Arc<tokio::sync::Mutex<InviteIdempotencyMap>>,
    pub invite_rate_limits: Arc<tokio::sync::Mutex<InviteRateLimitMap>>,
    pub collab_hub: Arc<tokio::sync::Mutex<CollabHubMap>>,
    pub mail_guard: Arc<crate::mailer::MailDeliveryGuard>,
    pub update_check_cache: Arc<tokio::sync::Mutex<Option<(std::time::Instant, serde_json::Value)>>>,
    pub public_origin: Option<String>,
    pub trust_proxy_headers: bool,
    pub guest_cookie_secret: String,
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
    pub provider_id: String,
    pub provider_name: String,
    pub client_id: String,
    pub token_url: String,
    pub userinfo_url: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub return_to: String,
    pub bind_user_id: Option<Uuid>,
    pub expires_at: i64,
}

#[derive(Clone)]
pub struct OneTimeOAuthTicket {
    pub user: UserProfileDto,
    pub pending_bind: Option<PendingOAuthBind>,
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
    pub verified_email: Option<String>,
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
    /// Legacy single-provider secret (retained for backward compatibility & `OAUTH_CLIENT_SECRET` env)
    #[serde(default)]
    pub oauth_client_secret: String,
    /// Per-provider OAuth client secrets keyed by normalized provider `id`
    #[serde(default)]
    pub oauth_client_secrets: HashMap<String, String>,
    #[serde(default)]
    pub smtp_password: String,
    #[serde(default)]
    pub cloudflare_api_token: String,
    #[serde(default)]
    pub smtp: SmtpSettingsDto,
    /// HMAC-SHA256 signing key for HttpOnly anonymous guest learner cookies (`ihn_guest`).
    #[serde(default)]
    pub guest_cookie_secret: String,
}

impl RuntimeSecretsConfig {
    pub fn resolve_oauth_client_secret(&self, provider_id: &str) -> String {
        let key = provider_id.trim().to_ascii_lowercase();
        if !key.is_empty() {
            if let Some(sec) = self
                .oauth_client_secrets
                .get(&key)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                return sec.to_string();
            }
            let slug_key = slugify_oauth_provider_id(&key);
            if !slug_key.is_empty() && slug_key != key {
                if let Some(sec) = self
                    .oauth_client_secrets
                    .get(&slug_key)
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    return sec.to_string();
                }
            }
        }
        let legacy = self.oauth_client_secret.trim();
        if !legacy.is_empty() {
            return legacy.to_string();
        }
        // If only a single OAuth secret exists in the map (e.g. saved before provider ID normalization), use it safely
        let non_empty: Vec<&str> = self
            .oauth_client_secrets
            .values()
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .collect();
        if non_empty.len() == 1 {
            return non_empty[0].to_string();
        }
        String::new()
    }

    pub fn provider_secret_status_map(&self) -> HashMap<String, bool> {
        self.oauth_client_secrets
            .iter()
            .filter_map(|(k, v)| {
                let clean_k = k.trim().to_ascii_lowercase();
                if clean_k.is_empty() || v.trim().is_empty() {
                    None
                } else {
                    Some((clean_k, true))
                }
            })
            .collect()
    }

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
        if cfg.smtp.cloudflare_account_id.is_empty() {
            if let Ok(acc_id) = std::env::var("CLOUDFLARE_ACCOUNT_ID") {
                if !acc_id.trim().is_empty() {
                    cfg.smtp.cloudflare_account_id = acc_id.trim().to_string();
                }
            }
        }
        if cfg.cloudflare_api_token.is_empty() {
            if let Ok(cf_tok) = std::env::var("CLOUDFLARE_EMAIL_API_TOKEN") {
                if !cf_tok.trim().is_empty() {
                    cfg.cloudflare_api_token = cf_tok.trim().to_string();
                }
            }
        }
        // Only auto-activate Cloudflare API from env when SMTP is not already configured (strict mutual exclusivity)
        if !cfg.smtp.enabled
            && cfg.smtp.host.trim().is_empty()
            && !cfg.smtp.cloudflare_account_id.trim().is_empty()
            && !cfg.cloudflare_api_token.trim().is_empty()
        {
            cfg.smtp.provider = "cloudflare_api".to_string();
            cfg.smtp.enabled = true;
        }
        cfg.smtp = cfg.smtp.sanitize();
        let has_env_db_url = std::env::var("DATABASE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .is_some();
        if cfg.database_url.is_empty() && !has_env_db_url {
            if let Ok(pg_host) = std::env::var("POSTGRES_HOST") {
                if !pg_host.trim().is_empty() {
                    let pg_port = std::env::var("POSTGRES_PORT")
                        .ok()
                        .and_then(|p| p.trim().parse::<u16>().ok())
                        .filter(|&p| p > 0)
                        .unwrap_or(5432);
                    let pg_db = std::env::var("POSTGRES_DB")
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(default_pg_database);
                    let pg_user = std::env::var("POSTGRES_USER")
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(default_pg_username);
                    let pg_pw = std::env::var("POSTGRES_PASSWORD").unwrap_or_default();
                    let pg_ssl = std::env::var("POSTGRES_SSLMODE")
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(default_pg_ssl_mode);
                    let fields = PostgresConnectionFields {
                        host: pg_host,
                        port: pg_port,
                        database: pg_db,
                        username: pg_user,
                        password: String::new(),
                        ssl_mode: pg_ssl,
                    };
                    if let Ok(built) = build_postgres_url(&fields, &pg_pw) {
                        cfg.database_url = built;
                        if cfg.storage_mode.is_empty() {
                            cfg.storage_mode = "postgres".to_string();
                        }
                    }
                }
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

    async fn list_margin_notes_filtered(
        &self,
        learner_id: &str,
        filter: &ListMarginNotesFilter,
    ) -> anyhow::Result<(Vec<UserMarginNoteDto>, usize)> {
        self.current()
            .list_margin_notes_filtered(learner_id, filter)
            .await
    }

    async fn create_margin_note(
        &self,
        input: CreateMarginNoteInput,
    ) -> anyhow::Result<UserMarginNoteDto> {
        self.current().create_margin_note(input).await
    }

    async fn update_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        input: UpdateMarginNoteInput,
        expected_etag: Option<&str>,
    ) -> anyhow::Result<UserMarginNoteDto> {
        self.current()
            .update_margin_note(note_id, learner_id, input, expected_etag)
            .await
    }

    async fn delete_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        expected_etag: Option<&str>,
    ) -> anyhow::Result<Option<chrono::DateTime<chrono::Utc>>> {
        self.current()
            .delete_margin_note(note_id, learner_id, expected_etag)
            .await
    }

    async fn restore_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
    ) -> anyhow::Result<UserMarginNoteDto> {
        self.current()
            .restore_margin_note(note_id, learner_id)
            .await
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

    async fn unbind_oauth_from_user(
        &self,
        user_id: Uuid,
        provider: &str,
    ) -> anyhow::Result<UserProfileDto> {
        self.current()
            .unbind_oauth_from_user(user_id, provider)
            .await
    }

    async fn list_user_passkeys(&self, user_id: Uuid) -> anyhow::Result<Vec<UserPasskeyDto>> {
        self.current().list_user_passkeys(user_id).await
    }

    async fn save_user_passkey(
        &self,
        cred: StoredPasskeyCredential,
    ) -> anyhow::Result<UserPasskeyDto> {
        self.current().save_user_passkey(cred).await
    }

    async fn find_passkey_by_credential_id(
        &self,
        credential_id: &str,
    ) -> anyhow::Result<Option<(StoredPasskeyCredential, UserProfileDto)>> {
        self.current()
            .find_passkey_by_credential_id(credential_id)
            .await
    }

    async fn touch_passkey_usage(
        &self,
        credential_id: &str,
        new_counter: u32,
    ) -> anyhow::Result<()> {
        self.current()
            .touch_passkey_usage(credential_id, new_counter)
            .await
    }

    async fn rename_user_passkey(
        &self,
        user_id: Uuid,
        credential_id: &str,
        new_name: &str,
    ) -> anyhow::Result<Option<UserPasskeyDto>> {
        self.current()
            .rename_user_passkey(user_id, credential_id, new_name)
            .await
    }

    async fn delete_user_passkey(
        &self,
        user_id: Uuid,
        credential_id: &str,
    ) -> anyhow::Result<bool> {
        self.current()
            .delete_user_passkey(user_id, credential_id)
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

    async fn is_email_taken_by_other(
        &self,
        email: &str,
        exclude_user_id: Uuid,
    ) -> anyhow::Result<bool> {
        self.current()
            .is_email_taken_by_other(email, exclude_user_id)
            .await
    }

    async fn update_user_email(
        &self,
        user_id: Uuid,
        new_email: &str,
    ) -> anyhow::Result<UserProfileDto> {
        self.current().update_user_email(user_id, new_email).await
    }

    async fn create_password_reset_token(
        &self,
        email: &str,
    ) -> anyhow::Result<Option<(UserProfileDto, String, String)>> {
        self.current().create_password_reset_token(email).await
    }

    async fn validate_password_reset_token(&self, raw_token: &str) -> anyhow::Result<i64> {
        self.current().validate_password_reset_token(raw_token).await
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
    ) -> anyhow::Result<VerifiedLoginChallengeDto> {
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

    async fn studio_list_tracks(
        &self,
        viewer: &UserProfileDto,
        locale: &str,
    ) -> anyhow::Result<Vec<StudioTrackDto>> {
        self.current().studio_list_tracks(viewer, locale).await
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

    async fn resolve_step_collab_access(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> anyhow::Result<Option<(Uuid, String, Vec<String>)>> {
        self.current()
            .resolve_step_collab_access(viewer, track_slug, chapter_slug, step_slug)
            .await
    }

    async fn studio_save_step(
        &self,
        author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
        require_if_match: bool,
    ) -> anyhow::Result<StudioStepEditorDto> {
        self.current()
            .studio_save_step(author, input, content_dir, require_if_match)
            .await
    }

    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> anyhow::Result<StudioTrackDto> {
        self.current().studio_create_track(input, content_dir).await
    }

    async fn studio_update_track_meta(
        &self,
        track_slug: &str,
        input: UpdateTrackMetaInput,
        content_dir: &Path,
    ) -> anyhow::Result<bool> {
        self.current()
            .studio_update_track_meta(track_slug, input, content_dir)
            .await
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
        role: &str,
        locale_scope: &[String],
    ) -> anyhow::Result<(CollaboratorInviteDto, String, String)> {
        self.current()
            .create_collaborator_invite(
                actor,
                track_slug,
                chapter_slug,
                step_slug,
                email,
                role,
                locale_scope,
            )
            .await
    }

    async fn preview_collaborator_invite(
        &self,
        viewer: Option<&UserProfileDto>,
        raw_token: &str,
    ) -> anyhow::Result<InvitePreviewDto> {
        self.current()
            .preview_collaborator_invite(viewer, raw_token)
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

    async fn update_step_collaborator_role(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
        role: &str,
        locale_scope: &[String],
    ) -> anyhow::Result<bool> {
        self.current()
            .update_step_collaborator_role(
                actor,
                track_slug,
                chapter_slug,
                step_slug,
                target_user_id,
                role,
                locale_scope,
            )
            .await
    }

    async fn leave_step_collaboration(
        &self,
        user: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> anyhow::Result<bool> {
        self.current()
            .leave_step_collaboration(user, track_slug, chapter_slug, step_slug)
            .await
    }

    async fn transfer_step_ownership(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> anyhow::Result<bool> {
        self.current()
            .transfer_step_ownership(actor, track_slug, chapter_slug, step_slug, target_user_id)
            .await
    }

    async fn list_step_revisions(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> anyhow::Result<Vec<StepRevisionDto>> {
        self.current()
            .list_step_revisions(viewer, track_slug, chapter_slug, step_slug, locale)
            .await
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
    ) -> anyhow::Result<StudioStepEditorDto> {
        self.current()
            .restore_step_revision(
                actor,
                track_slug,
                chapter_slug,
                step_slug,
                locale,
                revision_id,
                expected_etag,
                content_dir,
            )
            .await
    }

    async fn list_step_audit_logs(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> anyhow::Result<Vec<CollaborationAuditLogDto>> {
        self.current()
            .list_step_audit_logs(viewer, track_slug, chapter_slug, step_slug)
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
    tracing::error!("internal error: {err}");
    ApiError::new(
        ErrorCode::InternalError,
        "An unexpected internal error occurred.",
    )
}

pub fn repo_err(err: anyhow::Error) -> ApiError {
    ApiError::from_anyhow(err)
}

pub fn repo_err_or(err: anyhow::Error, fallback: ErrorCode) -> ApiError {
    ApiError::from_anyhow_with_fallback(err, fallback)
}

pub fn enforce_map_capacity<K, V, F>(map: &mut HashMap<K, V>, max_entries: usize, is_expired: F)
where
    K: Eq + std::hash::Hash + Clone,
    F: Fn(&V) -> bool,
{
    if map.len() < max_entries {
        return;
    }
    map.retain(|_, v| !is_expired(v));
    if map.len() >= max_entries {
        let drop_count = map.len() - max_entries + 1;
        let victims: Vec<K> = map.keys().take(drop_count).cloned().collect();
        for k in victims {
            map.remove(&k);
        }
    }
}

pub async fn check_sliding_rate_limit(
    state: &AppState,
    key: &str,
    max_hits: usize,
    window_secs: i64,
    detail: &str,
) -> Result<(), ApiError> {
    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::seconds(window_secs);
    let mut map = state.auth_rate_limits.lock().await;
    if map.len() >= EPHEMERAL_MAP_MAX_ENTRIES {
        map.retain(|_, hits| {
            hits.retain(|t| *t > cutoff);
            !hits.is_empty()
        });
        if map.len() >= EPHEMERAL_MAP_MAX_ENTRIES {
            let drop_count = map.len() - EPHEMERAL_MAP_MAX_ENTRIES + 1;
            let victims: Vec<String> = map.keys().take(drop_count).cloned().collect();
            for k in victims {
                map.remove(&k);
            }
        }
    }
    let hits = map.entry(key.to_string()).or_default();
    hits.retain(|t| *t > cutoff);
    if hits.len() >= max_hits {
        let oldest = hits.first().copied().unwrap_or(now);
        let retry_after = (window_secs - (now - oldest).num_seconds()).max(1);
        return Err(ApiError::new(ErrorCode::RateLimited, detail)
            .with_meta(serde_json::json!({ "retry_after_secs": retry_after })));
    }
    hits.push(now);
    Ok(())
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
    pub guest_cookie_raw: Option<String>,
}

pub fn extract_cookie_value(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
    for val in headers.get_all(header::COOKIE) {
        let Ok(raw) = val.to_str() else { continue };
        for pair in raw.split(';') {
            let trimmed = pair.trim();
            if let Some((k, v)) = trimmed.split_once('=') {
                if k.trim() == cookie_name {
                    let clean = v.trim();
                    if !clean.is_empty() {
                        return Some(clean.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Resolve the server-authoritative owner key for `/api/v1/me/*` endpoints (RFC 6750 + RFC 6265bis).
/// - Authenticated Bearer token -> `Some("user:<uuid>")` (invalid Bearer returns 401).
/// - Unauthenticated visitor -> verifies HMAC-signed `ihn_guest` HttpOnly cookie -> `Some("guest:<id>")`.
/// - When `issue_guest_if_missing` is true and no valid cookie exists, mints a fresh signed cookie
///   and returns its `Set-Cookie` header value.
///
/// Never trusts client-supplied `learner_id` parameters.
pub async fn resolve_me_owner(
    state: &AppState,
    headers: &HeaderMap,
    issue_guest_if_missing: bool,
) -> Result<(Option<String>, Option<HeaderValue>), ApiError> {
    if let Some(token) = extract_bearer_token(headers) {
        let user = state
            .repo
            .get_user_by_session(&token)
            .await
            .map_err(repo_err)?;
        return match user {
            Some(u) => {
                let ip = extract_client_ip(headers, None, state.trust_proxy_headers);
                let _ = state.repo.touch_session(&token, &ip).await;
                Ok((Some(format!("user:{}", u.id)), None))
            }
            None => Err(ApiError::new(
                ErrorCode::SessionExpired,
                "Session has expired or is invalid. Please sign in again.",
            )),
        };
    }

    if let Some(raw_cookie) = extract_cookie_value(headers, GUEST_COOKIE_NAME) {
        if let Some(guest_id) = verify_guest_learner_cookie(&raw_cookie, &state.guest_cookie_secret)
        {
            return Ok((Some(format!("guest:{guest_id}")), None));
        }
    }

    if !issue_guest_if_missing {
        return Ok((None, None));
    }

    let guest_id = Uuid::new_v4().simple().to_string();
    let signed = sign_guest_learner_cookie(&guest_id, &state.guest_cookie_secret)
        .map_err(internal_err)?;
    let is_https = detect_external_origin(state, headers).starts_with("https://");
    let cookie_str = if is_https {
        format!(
            "{GUEST_COOKIE_NAME}={signed}; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure"
        )
    } else {
        format!(
            "{GUEST_COOKIE_NAME}={signed}; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=31536000"
        )
    };
    let set_cookie = HeaderValue::from_str(&cookie_str).map_err(internal_err)?;
    Ok((Some(format!("guest:{guest_id}")), Some(set_cookie)))
}

/// Sliding-window write rate limiter for notes (30 writes per 60 seconds per owner; RFC 6585 429).
pub async fn check_note_write_rate_limit(state: &AppState, owner_key: &str) -> Result<(), ApiError> {
    const WINDOW_SECS: i64 = 60;
    const MAX_WRITES: usize = 30;
    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::seconds(WINDOW_SECS);
    let mut map = state.note_rate_limits.lock().await;
    if map.len() > 4096 {
        map.retain(|_, hits| {
            hits.retain(|t| *t > cutoff);
            !hits.is_empty()
        });
    }
    let hits = map.entry(owner_key.to_string()).or_default();
    hits.retain(|t| *t > cutoff);
    if hits.len() >= MAX_WRITES {
        let oldest = hits.first().copied().unwrap_or(now);
        let retry_after = (WINDOW_SECS - (now - oldest).num_seconds()).max(1);
        return Err(ApiError::new(
            ErrorCode::RateLimited,
            "Too many note updates. Please wait a moment and try again.",
        )
        .with_meta(serde_json::json!({ "retry_after_secs": retry_after })));
    }
    hits.push(now);
    Ok(())
}

fn extract_forwarded_for_ip(headers: &HeaderMap) -> Option<String> {
    for val in headers.get_all(header::FORWARDED) {
        let Ok(raw) = val.to_str() else { continue };
        for entry in raw.split(',') {
            for pair in entry.split(';') {
                let trimmed = pair.trim();
                if let Some((k, v)) = trimmed.split_once('=') {
                    if k.trim().eq_ignore_ascii_case("for") {
                        if let Some(ip) = normalize_ip_candidate(v) {
                            return Some(ip);
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn extract_client_ip(
    headers: &HeaderMap,
    peer_ip: Option<std::net::IpAddr>,
    trust_proxy_headers: bool,
) -> String {
    if trust_proxy_headers {
        for single_hdr in [
            "cf-connecting-ip",
            "true-client-ip",
            "eo-connecting-ip",
            "ali-cdn-real-ip",
        ] {
            if let Some(val) = headers.get(single_hdr).and_then(|v| v.to_str().ok()) {
                if let Some(ip) = normalize_ip_candidate(val) {
                    return ip;
                }
            }
        }
        if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            for candidate in xff.split(',') {
                if let Some(ip) = normalize_ip_candidate(candidate) {
                    return ip;
                }
            }
        }
        for single_hdr in ["x-real-ip", "x-client-ip"] {
            if let Some(val) = headers.get(single_hdr).and_then(|v| v.to_str().ok()) {
                if let Some(ip) = normalize_ip_candidate(val) {
                    return ip;
                }
            }
        }
        if let Some(ip) = extract_forwarded_for_ip(headers) {
            return ip;
        }
    }
    if let Some(ip) = peer_ip {
        if let Some(norm) = normalize_ip_candidate(&ip.to_string()) {
            return norm;
        }
        return ip.to_string();
    }
    "127.0.0.1".to_string()
}

pub fn extract_client_context(
    state: &AppState,
    headers: &HeaderMap,
    peer_ip: Option<std::net::IpAddr>,
) -> ClientContext {
    let ip_address = extract_client_ip(headers, peer_ip, state.trust_proxy_headers);
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
    let guest_cookie_raw = extract_cookie_value(headers, GUEST_COOKIE_NAME);
    ClientContext {
        ip_address,
        user_agent,
        device_label,
        device_fingerprint,
        guest_cookie_raw,
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
            let ip = extract_client_ip(headers, None, state.trust_proxy_headers);
            let _ = state.repo.touch_session(&token, &ip).await;
            Ok(u)
        }
        None => Err(ApiError::new(
            ErrorCode::SessionExpired,
            "Session has expired or is invalid. Please sign in again.",
        )),
    }
}

/// Sliding-window rate limiter for collaboration invitations (10 invites per 10 minutes per actor; RFC 6585 429).
pub async fn check_invite_rate_limit(state: &AppState, actor_id: Uuid) -> Result<(), ApiError> {
    const WINDOW_SECS: i64 = 600;
    const MAX_INVITES: usize = 10;
    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::seconds(WINDOW_SECS);
    let mut map = state.invite_rate_limits.lock().await;
    if map.len() > 2048 {
        map.retain(|_, hits| {
            hits.retain(|t| *t > cutoff);
            !hits.is_empty()
        });
    }
    let hits = map.entry(actor_id).or_default();
    hits.retain(|t| *t > cutoff);
    if hits.len() >= MAX_INVITES {
        let oldest = hits.first().copied().unwrap_or(now);
        let retry_after = (WINDOW_SECS - (now - oldest).num_seconds()).max(1);
        return Err(ApiError::new(
            ErrorCode::RateLimited,
            "Too many collaboration invitations sent. Please wait before sending another.",
        )
        .with_meta(serde_json::json!({ "retry_after_secs": retry_after })));
    }
    hits.push(now);
    Ok(())
}

pub async fn optional_authenticated_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Option<UserProfileDto> {
    let token = extract_bearer_token(headers)?;
    state.repo.get_user_by_session(&token).await.ok().flatten()
}

pub async fn require_studio_access(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserProfileDto, ApiError> {
    let user = require_authenticated_user(state, headers).await?;
    if !user.can_access_studio() {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Author, collaborator, or administrator privileges required.",
        ));
    }
    Ok(user)
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

pub fn sanitize_collab_tab_id(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(48)
        .collect();
    if cleaned.is_empty() {
        "default".to_string()
    } else {
        cleaned
    }
}

fn prune_and_collect_presence(
    room: &mut CollabRoomState,
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<PresenceMemberDto> {
    let cutoff = now - chrono::Duration::seconds(COLLAB_PRESENCE_TTL_SECONDS);
    room.presence.retain(|_, member| member.updated_at >= cutoff);
    let mut members: Vec<PresenceMemberDto> = room.presence.values().cloned().collect();
    members.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.user_id.cmp(&b.user_id))
    });
    members
}

fn emit_collab_event_in_room(
    room: &mut CollabRoomState,
    event_name: &str,
    payload: &serde_json::Value,
) {
    room.next_event_seq = room.next_event_seq.saturating_add(1);
    let evt = StoredCollabEvent {
        id: room.next_event_seq,
        event_name: event_name.to_string(),
        data_json: payload.to_string(),
    };
    room.backlog.push_back(evt.clone());
    while room.backlog.len() > COLLAB_BACKLOG_LIMIT {
        room.backlog.pop_front();
    }
    room.subscribers.retain(|tx| {
        !matches!(
            tx.try_send(evt.clone()),
            Err(tokio::sync::mpsc::error::TrySendError::Closed(_))
        )
    });
}

pub async fn emit_collab_event(
    state: &AppState,
    step_id: Uuid,
    event_name: &str,
    payload: &serde_json::Value,
) {
    let mut hub = state.collab_hub.lock().await;
    if hub.len() > 512 {
        hub.retain(|_, r| !r.subscribers.is_empty() || !r.presence.is_empty() || !r.backlog.is_empty());
    }
    let room = hub.entry(step_id).or_default();
    emit_collab_event_in_room(room, event_name, payload);
}

pub async fn upsert_collab_presence(
    state: &AppState,
    step_id: Uuid,
    user: &UserProfileDto,
    locale: &str,
    presence_state: &str,
    tab_id: &str,
) -> Vec<PresenceMemberDto> {
    let clean_tab = sanitize_collab_tab_id(tab_id);
    let clean_locale = normalize_supported_locale(Some(locale), "zh-CN").to_string();
    let clean_state = if presence_state.trim() == "editing" {
        "editing".to_string()
    } else {
        "viewing".to_string()
    };
    let now = chrono::Utc::now();
    let presence_key = format!("{}:{clean_tab}", user.id);

    let mut hub = state.collab_hub.lock().await;
    let room = hub.entry(step_id).or_default();
    room.presence.insert(
        presence_key,
        PresenceMemberDto {
            user_id: user.id,
            display_name: user.display_name.clone(),
            username: user.username.clone(),
            avatar_url: user.avatar_url.clone(),
            locale: clean_locale,
            state: clean_state,
            tab_id: clean_tab,
            updated_at: now,
        },
    );
    let members = prune_and_collect_presence(room, now);
    emit_collab_event_in_room(
        room,
        "presence",
        &serde_json::json!({ "members": &members }),
    );
    members
}

pub async fn remove_collab_presence(
    state: &AppState,
    step_id: Uuid,
    user_id: Uuid,
    tab_id: Option<&str>,
) -> Vec<PresenceMemberDto> {
    let now = chrono::Utc::now();
    let mut hub = state.collab_hub.lock().await;
    let Some(room) = hub.get_mut(&step_id) else {
        return Vec::new();
    };
    if let Some(raw_tab) = tab_id.filter(|s| !s.trim().is_empty()) {
        let key = format!("{user_id}:{}", sanitize_collab_tab_id(raw_tab));
        room.presence.remove(&key);
    } else {
        let prefix = format!("{user_id}:");
        room.presence.retain(|k, _| !k.starts_with(&prefix));
    }
    let members = prune_and_collect_presence(room, now);
    emit_collab_event_in_room(
        room,
        "presence",
        &serde_json::json!({ "members": &members }),
    );
    members
}

pub async fn snapshot_and_subscribe_collab_events(
    state: &AppState,
    step_id: Uuid,
    last_event_id: Option<u64>,
) -> (
    Vec<PresenceMemberDto>,
    Vec<StoredCollabEvent>,
    tokio::sync::mpsc::Receiver<StoredCollabEvent>,
    tokio::sync::broadcast::Receiver<CollabControlSignal>,
) {
    let now = chrono::Utc::now();
    let mut hub = state.collab_hub.lock().await;
    let room = hub.entry(step_id).or_default();
    let members = prune_and_collect_presence(room, now);
    let replay = match last_event_id {
        Some(since) => room
            .backlog
            .iter()
            .filter(|evt| evt.id > since)
            .cloned()
            .collect(),
        None => Vec::new(),
    };
    let (tx, rx) = tokio::sync::mpsc::channel(64);
    room.subscribers.push(tx);
    let ctrl_rx = room.ctrl_tx.subscribe();
    (members, replay, rx, ctrl_rx)
}

pub async fn evict_collab_user_from_room(state: &AppState, step_id: Uuid, user_id: Uuid) {
    let now = chrono::Utc::now();
    let mut hub = state.collab_hub.lock().await;
    if let Some(room) = hub.get_mut(&step_id) {
        let prefix = format!("{user_id}:");
        room.presence.retain(|k, _| !k.starts_with(&prefix));
        let members = prune_and_collect_presence(room, now);
        emit_collab_event_in_room(
            room,
            "presence",
            &serde_json::json!({ "members": &members }),
        );
        let _ = room.ctrl_tx.send(CollabControlSignal::RevokeUser(user_id));
    }
}

pub async fn evict_collab_user_everywhere(state: &AppState, user_id: Uuid) {
    let now = chrono::Utc::now();
    let mut hub = state.collab_hub.lock().await;
    let prefix = format!("{user_id}:");
    for room in hub.values_mut() {
        let had = room.presence.keys().any(|k| k.starts_with(&prefix));
        if had {
            room.presence.retain(|k, _| !k.starts_with(&prefix));
            let members = prune_and_collect_presence(room, now);
            emit_collab_event_in_room(
                room,
                "presence",
                &serde_json::json!({ "members": &members }),
            );
        }
        let _ = room.ctrl_tx.send(CollabControlSignal::RevokeUser(user_id));
    }
}

pub async fn close_collab_room(state: &AppState, step_id: Uuid) {
    let mut hub = state.collab_hub.lock().await;
    if let Some(mut room) = hub.remove(&step_id) {
        room.presence.clear();
        let _ = room.ctrl_tx.send(CollabControlSignal::CloseRoom);
    }
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
    _anon_learner_id: Option<&str>,
    ctx: &ClientContext,
    trust_device: bool,
) -> Result<AuthSessionResponse, ApiError> {
    let learner_key = format!("user:{}", user.id);
    // Only merge server-verified HttpOnly guest cookie notes/progress (never untrusted client learner_id strings)
    if let Some(ref raw_cookie) = ctx.guest_cookie_raw {
        if let Some(guest_id) = verify_guest_learner_cookie(raw_cookie, &state.guest_cookie_secret)
        {
            let guest_owner = format!("guest:{guest_id}");
            state
                .repo
                .merge_anonymous_learner(&guest_owner, &learner_key)
                .await
                .map_err(repo_err)?;
        }
    }
    if trust_device {
        if let Err(err) = state
            .repo
            .record_trusted_device(
                user.id,
                &ctx.ip_address,
                &ctx.device_fingerprint,
                &ctx.device_label,
            )
            .await
        {
            tracing::warn!(
                user_id = %user.id,
                ip = %ctx.ip_address,
                device = %ctx.device_label,
                error = %err,
                "Failed to persist trusted device record after sign-in"
            );
        }
    }
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

pub fn is_valid_authority(raw: &str) -> bool {
    let s = raw.trim();
    if s.is_empty() || s.len() > 255 {
        return false;
    }
    if s.chars().any(|c| {
        c.is_whitespace() || c.is_control() || matches!(c, '/' | '\\' | '@' | '?' | '#')
    }) {
        return false;
    }
    if let Some(after_open) = s.strip_prefix('[') {
        let Some((ipv6_part, rest)) = after_open.split_once(']') else {
            return false;
        };
        if ipv6_part.parse::<std::net::Ipv6Addr>().is_err() {
            return false;
        }
        return if rest.is_empty() {
            true
        } else if let Some(port_str) = rest.strip_prefix(':') {
            !port_str.is_empty() && port_str.parse::<u16>().is_ok_and(|p| p > 0)
        } else {
            false
        };
    }

    let host_part = match s.split_once(':') {
        Some((h, port_str)) => {
            if port_str.is_empty() || !port_str.parse::<u16>().is_ok_and(|p| p > 0) {
                return false;
            }
            h
        }
        None => s,
    };
    if host_part.is_empty() || host_part.len() > 253 {
        return false;
    }
    if host_part.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    if host_part.starts_with('.') || host_part.ends_with('.') {
        return false;
    }
    host_part.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

pub fn normalize_origin_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let lower = trimmed.to_ascii_lowercase();
    let (scheme, after_scheme) = if lower.starts_with("https://") {
        ("https", &trimmed["https://".len()..])
    } else if lower.starts_with("http://") {
        ("http", &trimmed["http://".len()..])
    } else {
        return None;
    };
    let authority_raw = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if !is_valid_authority(authority_raw) {
        return None;
    }
    let normalized_auth = if scheme == "https" {
        authority_raw.strip_suffix(":443").unwrap_or(authority_raw)
    } else {
        authority_raw.strip_suffix(":80").unwrap_or(authority_raw)
    };
    Some(format!("{scheme}://{}", normalized_auth.to_ascii_lowercase()))
}

pub fn detect_external_origin(state: &AppState, headers: &HeaderMap) -> String {
    if let Some(ref configured) = state.public_origin {
        return configured.clone();
    }

    let host = if state.trust_proxy_headers {
        headers
            .get("x-forwarded-host")
            .or_else(|| headers.get(header::HOST))
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next())
            .map(str::trim)
            .filter(|h| is_valid_authority(h))
            .unwrap_or("127.0.0.1:3001")
    } else {
        headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
            .filter(|h| is_valid_authority(h))
            .unwrap_or("127.0.0.1:3001")
    };

    let same_host_https_ref = [header::ORIGIN, header::REFERER]
        .into_iter()
        .filter_map(|h| headers.get(h).and_then(|v| v.to_str().ok()))
        .any(|val| {
            if let Some(after) = val.trim().strip_prefix("https://") {
                let ref_host = after.split('/').next().unwrap_or("").trim();
                !ref_host.is_empty() && ref_host.eq_ignore_ascii_case(host)
            } else {
                false
            }
        });

    let proto = if state.trust_proxy_headers {
        let forwarded_proto = headers
            .get("x-forwarded-proto")
            .or_else(|| headers.get("x-forwarded-scheme"))
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next())
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|p| p == "https" || p == "http");

        let cf_https = headers
            .get("cf-visitor")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_ascii_lowercase().contains("\"https\""))
            .unwrap_or(false);

        let rfc_forwarded_https = headers
            .get(header::FORWARDED)
            .and_then(|v| v.to_str().ok())
            .map(|s| {
                let lower = s.to_ascii_lowercase();
                lower.contains("proto=https") || lower.contains("proto=\"https\"")
            })
            .unwrap_or(false);

        if let Some(p) = forwarded_proto {
            if p == "https" {
                "https"
            } else {
                "http"
            }
        } else if cf_https || rfc_forwarded_https || same_host_https_ref {
            "https"
        } else {
            "http"
        }
    } else if same_host_https_ref {
        "https"
    } else {
        "http"
    };

    format!("{proto}://{host}")
}

fn strip_host_port(authority: &str) -> String {
    let trimmed = authority.trim();
    if let Some(after_open) = trimmed.strip_prefix('[') {
        if let Some((ipv6, _)) = after_open.split_once(']') {
            return ipv6.to_ascii_lowercase();
        }
    }
    trimmed
        .split(':')
        .next()
        .unwrap_or("localhost")
        .trim()
        .to_ascii_lowercase()
}

pub fn resolve_webauthn_rp_and_origins(state: &AppState, headers: &HeaderMap) -> (String, Vec<String>) {
    let detected_origin = detect_external_origin(state, headers);
    let authority = detected_origin
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("localhost");
    let detected_host = strip_host_port(authority);

    let rp_id = std::env::var("PASSKEY_RP_ID")
        .ok()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if detected_host == "127.0.0.1" || detected_host == "::1" || detected_host.is_empty() {
                "localhost".to_string()
            } else {
                detected_host.clone()
            }
        });

    let mut origins: Vec<String> = Vec::new();
    let mut push_unique = |orig: String| {
        let clean = orig.trim().trim_end_matches('/').to_string();
        if !clean.is_empty() && !origins.iter().any(|o| o.eq_ignore_ascii_case(&clean)) {
            origins.push(clean);
        }
    };

    push_unique(detected_origin.clone());
    if rp_id != "localhost" {
        push_unique(format!("https://{authority}"));
        push_unique(format!("https://{rp_id}"));
    } else {
        let port_suffix = authority
            .rsplit_once(':')
            .map(|(_, p)| format!(":{p}"))
            .unwrap_or_default();
        push_unique(format!("http://localhost{port_suffix}"));
        push_unique("http://localhost".to_string());
    }

    if let Some(req_origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let clean_orig = req_origin.trim().trim_end_matches('/');
        if clean_orig.starts_with("https://") || clean_orig.starts_with("http://localhost") {
            let orig_auth = clean_orig
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap_or("");
            let orig_host = strip_host_port(orig_auth);
            if orig_host == rp_id || orig_host.ends_with(&format!(".{rp_id}")) {
                push_unique(clean_orig.to_string());
            }
        }
    }

    if let Ok(extra) = std::env::var("PASSKEY_ALLOWED_ORIGINS") {
        for part in extra.split(',') {
            let trimmed = part.trim();
            if !trimmed.is_empty() {
                push_unique(trimmed.to_string());
            }
        }
    }

    (rp_id, origins)
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

fn default_pg_host() -> String {
    "127.0.0.1".to_string()
}

fn default_pg_port() -> u16 {
    5432
}

fn default_pg_database() -> String {
    "icehandnote".to_string()
}

fn default_pg_username() -> String {
    "postgres".to_string()
}

fn default_pg_ssl_mode() -> String {
    "prefer".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostgresConnectionFields {
    #[serde(default = "default_pg_host")]
    pub host: String,
    #[serde(default = "default_pg_port")]
    pub port: u16,
    #[serde(default = "default_pg_database")]
    pub database: String,
    #[serde(default = "default_pg_username")]
    pub username: String,
    #[serde(default, skip_serializing)]
    pub password: String,
    #[serde(default = "default_pg_ssl_mode")]
    pub ssl_mode: String,
}

impl Default for PostgresConnectionFields {
    fn default() -> Self {
        Self {
            host: default_pg_host(),
            port: default_pg_port(),
            database: default_pg_database(),
            username: default_pg_username(),
            password: String::new(),
            ssl_mode: default_pg_ssl_mode(),
        }
    }
}

pub fn normalize_pg_ssl_mode(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "disable" => "disable",
        "allow" | "prefer" => "prefer",
        "require" => "require",
        "verify-ca" => "verify-ca",
        "verify-full" => "verify-full",
        _ => "prefer",
    }
}

pub fn percent_decode_component(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn parse_postgres_url(raw: &str) -> Option<(PostgresConnectionFields, Option<String>)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    let after_scheme = if lower.starts_with("postgresql://") {
        &trimmed["postgresql://".len()..]
    } else if lower.starts_with("postgres://") {
        &trimmed["postgres://".len()..]
    } else {
        return None;
    };

    let (without_query, query_opt) = match after_scheme.split_once('?') {
        Some((head, q)) => (head, Some(q.split('#').next().unwrap_or(q))),
        None => (after_scheme.split('#').next().unwrap_or(after_scheme), None),
    };

    let mut ssl_mode = default_pg_ssl_mode();
    if let Some(query) = query_opt {
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k.trim().eq_ignore_ascii_case("sslmode") {
                    ssl_mode = normalize_pg_ssl_mode(&percent_decode_component(v)).to_string();
                }
            }
        }
    }

    let (username, password_opt, authority_and_path) = match without_query.rfind('@') {
        Some(at_idx) => {
            let userinfo = &without_query[..at_idx];
            let rest = &without_query[at_idx + 1..];
            match userinfo.split_once(':') {
                Some((u, p)) => {
                    let decoded_u = percent_decode_component(u);
                    let decoded_p = percent_decode_component(p);
                    (
                        if decoded_u.trim().is_empty() {
                            default_pg_username()
                        } else {
                            decoded_u
                        },
                        if decoded_p.is_empty() {
                            None
                        } else {
                            Some(decoded_p)
                        },
                        rest,
                    )
                }
                None => {
                    let decoded_u = percent_decode_component(userinfo);
                    (
                        if decoded_u.trim().is_empty() {
                            default_pg_username()
                        } else {
                            decoded_u
                        },
                        None,
                        rest,
                    )
                }
            }
        }
        None => (default_pg_username(), None, without_query),
    };

    let (host_port, db_raw) = match authority_and_path.split_once('/') {
        Some((hp, db)) => (hp, db.trim_end_matches('/')),
        None => (authority_and_path, ""),
    };

    let database = {
        let decoded_db = percent_decode_component(db_raw);
        if decoded_db.trim().is_empty() {
            default_pg_database()
        } else {
            decoded_db
        }
    };

    let (host, port) = if let Some(after_open) = host_port.strip_prefix('[') {
        if let Some((ipv6_host, after_close)) = after_open.split_once(']') {
            let parsed_port = after_close
                .strip_prefix(':')
                .and_then(|p| p.parse::<u16>().ok())
                .filter(|&p| p > 0)
                .unwrap_or_else(default_pg_port);
            (ipv6_host.to_string(), parsed_port)
        } else {
            return None;
        }
    } else if host_port.matches(':').count() == 1 {
        let (h, p_str) = host_port.split_once(':')?;
        let parsed_port = p_str
            .parse::<u16>()
            .ok()
            .filter(|&p| p > 0)
            .unwrap_or_else(default_pg_port);
        (h.to_string(), parsed_port)
    } else {
        (host_port.to_string(), default_pg_port())
    };

    if host.trim().is_empty() {
        return None;
    }

    Some((
        PostgresConnectionFields {
            host: host.trim().to_string(),
            port,
            database,
            username,
            password: String::new(),
            ssl_mode,
        },
        password_opt,
    ))
}

pub fn build_postgres_url(
    fields: &PostgresConnectionFields,
    effective_password: &str,
) -> Result<String, ApiError> {
    let raw_host = fields
        .host
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim();
    if raw_host.is_empty() {
        return Err(ApiError::new(
            ErrorCode::StorageUrlRequired,
            "PostgreSQL host is required.",
        ));
    }
    if raw_host
        .chars()
        .any(|c| c.is_whitespace() || matches!(c, '/' | '?' | '#' | '@'))
    {
        return Err(ApiError::new(
            ErrorCode::BadRequest,
            "PostgreSQL host contains invalid characters.",
        ));
    }

    let port = if fields.port == 0 {
        default_pg_port()
    } else {
        fields.port
    };
    let db_trimmed = fields.database.trim();
    if db_trimmed.is_empty() {
        return Err(ApiError::new(
            ErrorCode::BadRequest,
            "PostgreSQL database name is required.",
        ));
    }
    let user_trimmed = fields.username.trim();
    if user_trimmed.is_empty() {
        return Err(ApiError::new(
            ErrorCode::BadRequest,
            "PostgreSQL username is required.",
        ));
    }

    let host_fmt = if raw_host.contains(':') {
        format!("[{raw_host}]")
    } else {
        raw_host.to_string()
    };
    let enc_user = percent_encode_component(user_trimmed);
    let enc_db = percent_encode_component(db_trimmed);
    let ssl_mode = normalize_pg_ssl_mode(&fields.ssl_mode);
    let auth = if effective_password.is_empty() {
        enc_user
    } else {
        format!("{enc_user}:{}", percent_encode_component(effective_password))
    };

    Ok(format!(
        "postgres://{auth}@{host_fmt}:{port}/{enc_db}?sslmode={ssl_mode}"
    ))
}

#[cfg(test)]
mod pg_url_tests {
    use super::*;

    #[test]
    fn roundtrips_special_characters_and_ssl_mode() {
        let input = PostgresConnectionFields {
            host: "db.internal.example".to_string(),
            port: 5433,
            database: "icehand/notes?v1".to_string(),
            username: "app@admin:1".to_string(),
            password: String::new(),
            ssl_mode: "require".to_string(),
        };
        let raw_pw = "p@ss:w/rd#1?%!";
        let url = build_postgres_url(&input, raw_pw).expect("build url");
        assert!(url.contains("sslmode=require"));
        assert!(!url.contains("p@ss:w/rd#1?%!"));

        let (parsed, parsed_pw) = parse_postgres_url(&url).expect("parse url");
        assert_eq!(parsed, input);
        assert_eq!(parsed_pw.as_deref(), Some(raw_pw));
    }

    #[test]
    fn handles_ipv6_and_empty_password() {
        let input = PostgresConnectionFields {
            host: "::1".to_string(),
            port: 5432,
            database: "icehandnote".to_string(),
            username: "postgres".to_string(),
            password: String::new(),
            ssl_mode: "disable".to_string(),
        };
        let url = build_postgres_url(&input, "").expect("build ipv6 url");
        assert_eq!(
            url,
            "postgres://postgres@[::1]:5432/icehandnote?sslmode=disable"
        );
        let (parsed, parsed_pw) = parse_postgres_url(&url).expect("parse ipv6 url");
        assert_eq!(parsed, input);
        assert_eq!(parsed_pw, None);
    }

    #[test]
    fn never_serializes_raw_password_in_dto() {
        let parsed: PostgresConnectionFields = serde_json::from_str(
            r#"{"host":"10.0.0.8","port":5432,"database":"notes","username":"pguser","password":"super-secret-password","ssl_mode":"verify-full"}"#,
        )
        .expect("deserialize with password");
        assert_eq!(parsed.password, "super-secret-password");
        assert_eq!(parsed.ssl_mode, "verify-full");

        let json = serde_json::to_string(&parsed).expect("serialize");
        assert!(!json.contains("super-secret-password"));
        assert!(!json.contains("\"password\""));
    }
}
