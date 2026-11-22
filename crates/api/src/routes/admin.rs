use crate::{
    error::ApiError,
    mailer::{
        is_smtp_ready, send_takedown_notice_email, send_test_email, send_user_ban_notice_email,
        MailBrandContext,
    },
    state::{
        build_postgres_url, detect_external_origin, extract_client_context, internal_err,
        mask_database_url, parse_postgres_url, repo_err, repo_err_or, require_admin,
        resolve_request_locale, AppState, PostgresConnectionFields,
    },
};
use axum::{
    extract::{ConnectInfo, Path as AxumPath, State},
    http::{Extensions, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use icehandnote_core::{
    auth::{
        is_deliverable_email, is_valid_email, slugify_oauth_provider_id,
        validate_and_normalize_email, SiteSettingsDto, UserRole,
    },
    error::ErrorCode,
    mail_templates::{render_mail_preview, SmtpSettingsDto},
};
use icehandnote_db::{
    content_loader::load_content_directory, LocalSeedRepository, PostgresRepository,
    TutorialRepository,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Instant};
use uuid::Uuid;

// ============================================================================
// 1. Site Settings & Content Reload
// ============================================================================

pub async fn admin_update_settings_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SiteSettingsDto>,
) -> Result<impl IntoResponse, ApiError> {
    let admin = require_admin(&state, &headers).await?;
    let clean = body
        .sanitize()
        .map_err(|e| repo_err_or(e, ErrorCode::BadRequest))?;
    let saved = state
        .repo
        .update_site_settings(admin.id, clean)
        .await
        .map_err(repo_err)?;
    Ok(Json(saved))
}

pub async fn reload_content_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let bundle = load_content_directory(&state.content_dir).map_err(internal_err)?;
    let synced = state.repo.sync_bundle(&bundle).await.map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "synced_documents": synced })))
}

// ============================================================================
// 2. Live Storage Backend Inspection, Connection Test & Hot-Switch
// ============================================================================

#[derive(Serialize)]
pub struct StorageStatusResponse {
    pub active_backend: &'static str,
    pub configured_mode: String,
    pub database_url_masked: String,
    pub has_saved_url: bool,
    pub has_saved_password: bool,
    pub postgres: PostgresConnectionFields,
}

#[derive(Deserialize)]
pub struct TestStorageBody {
    #[serde(default)]
    pub database_url: String,
    #[serde(default)]
    pub postgres: Option<PostgresConnectionFields>,
    #[serde(default)]
    pub clear_password: bool,
}

#[derive(Serialize)]
pub struct TestStorageResponse {
    pub ok: bool,
    pub latency_ms: u64,
}

#[derive(Deserialize)]
pub struct SwitchStorageBody {
    pub mode: String, // "local" | "postgres"
    #[serde(default)]
    pub database_url: String,
    #[serde(default)]
    pub postgres: Option<PostgresConnectionFields>,
    #[serde(default)]
    pub clear_password: bool,
    #[serde(default = "default_true")]
    pub sync_content: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize)]
pub struct SwitchStorageResponse {
    pub active_backend: &'static str,
    pub configured_mode: String,
    pub database_url_masked: String,
    pub has_saved_url: bool,
    pub has_saved_password: bool,
    pub postgres: PostgresConnectionFields,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_session_token: Option<String>,
}

fn resolve_saved_or_env_db_url(saved: &str) -> String {
    if !saved.trim().is_empty() {
        return saved.trim().to_string();
    }
    std::env::var("DATABASE_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default()
}

fn extract_saved_pg_status(saved_or_env_url: &str) -> (PostgresConnectionFields, bool) {
    match parse_postgres_url(saved_or_env_url) {
        Some((fields, pw_opt)) => (fields, pw_opt.is_some()),
        None => (PostgresConnectionFields::default(), false),
    }
}

fn resolve_target_db_url(
    database_url: &str,
    postgres: Option<&PostgresConnectionFields>,
    clear_password: bool,
    saved_url: &str,
) -> Result<Option<String>, ApiError> {
    let fallback_saved = resolve_saved_or_env_db_url(saved_url);
    if let Some(pg) = postgres {
        let effective_pw = if !pg.password.is_empty() {
            pg.password.clone()
        } else if clear_password {
            String::new()
        } else {
            parse_postgres_url(&fallback_saved)
                .and_then(|(_, pw)| pw)
                .unwrap_or_default()
        };
        let built = build_postgres_url(pg, &effective_pw)?;
        return Ok(Some(built));
    }

    let trimmed = database_url.trim();
    if !trimmed.is_empty() && !trimmed.contains(":***@") {
        return Ok(Some(trimmed.to_string()));
    }
    if !fallback_saved.is_empty() {
        return Ok(Some(fallback_saved));
    }
    Ok(None)
}

pub async fn admin_get_storage_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let active_kind = if state.repo.backend_kind() == "postgresql-17" {
        "postgres"
    } else {
        "local"
    };
    let secrets = state.runtime_secrets.read().await;
    let effective_saved = resolve_saved_or_env_db_url(&secrets.database_url);
    let configured_mode = if secrets.storage_mode.is_empty() {
        active_kind.to_string()
    } else {
        secrets.storage_mode.clone()
    };
    let (postgres, has_saved_password) = extract_saved_pg_status(&effective_saved);

    Ok(Json(StorageStatusResponse {
        active_backend: active_kind,
        configured_mode,
        database_url_masked: mask_database_url(&effective_saved),
        has_saved_url: !effective_saved.is_empty(),
        has_saved_password,
        postgres,
    }))
}

pub async fn admin_test_storage_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TestStorageBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let saved_url = state.runtime_secrets.read().await.database_url.clone();
    let Some(db_url) = resolve_target_db_url(
        &body.database_url,
        body.postgres.as_ref(),
        body.clear_password,
        &saved_url,
    )?
    else {
        return Err(ApiError::new(
            ErrorCode::StorageUrlRequired,
            "PostgreSQL connection configuration is required.",
        ));
    };

    let start = Instant::now();
    let pg = PostgresRepository::connect_and_migrate(&db_url, false)
        .await
        .map_err(|e| {
            ApiError::new(
                ErrorCode::StorageConnectionFailed,
                format!("PostgreSQL connection failed: {e}"),
            )
        })?;
    let _ = pg
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    let latency_ms = start.elapsed().as_millis() as u64;

    Ok(Json(TestStorageResponse {
        ok: true,
        latency_ms,
    }))
}

pub async fn admin_update_storage_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<SwitchStorageBody>,
) -> Result<impl IntoResponse, ApiError> {
    let current_admin = require_admin(&state, &headers).await?;
    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    let current_settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());

    let target_mode = body.mode.trim().to_ascii_lowercase();
    if target_mode != "local" && target_mode != "postgres" {
        return Err(ApiError::new(
            ErrorCode::StorageModeInvalid,
            "Storage mode must be 'local' or 'postgres'.",
        ));
    }

    let mut new_session_token: Option<String> = None;
    let saved_url_snapshot = state.runtime_secrets.read().await.database_url.clone();

    let (next_repo, persisted_url): (Arc<dyn TutorialRepository>, String) =
        if target_mode == "postgres" {
            let Some(db_url) = resolve_target_db_url(
                &body.database_url,
                body.postgres.as_ref(),
                body.clear_password,
                &saved_url_snapshot,
            )?
            else {
                return Err(ApiError::new(
                    ErrorCode::StorageUrlRequired,
                    "PostgreSQL connection configuration is required.",
                ));
            };
            let pg = PostgresRepository::connect_and_migrate(&db_url, false)
                .await
                .map_err(|e| {
                    ApiError::new(
                        ErrorCode::StorageConnectionFailed,
                        format!("PostgreSQL connection failed: {e}"),
                    )
                })?;
            if body.sync_content && state.content_dir.exists() {
                if let Ok(bundle) = load_content_directory(&state.content_dir) {
                    let _ = pg.sync_bundle(&bundle).await;
                }
            }
            let arc_pg: Arc<dyn TutorialRepository> = Arc::new(pg);
            (arc_pg, db_url)
        } else {
            let local =
                LocalSeedRepository::from_content_dir(&state.content_dir, state.store_path.clone())
                    .map_err(internal_err)?;
            (Arc::new(local), saved_url_snapshot)
        };

    let existing_users = next_repo.admin_list_users().await.unwrap_or_default();
    let target_admin_id = if let Some(found) = existing_users
        .iter()
        .find(|u| u.username.eq_ignore_ascii_case(&current_admin.username) && u.role.is_admin())
    {
        found.id
    } else if let Some(any_admin) = existing_users.iter().find(|u| u.role.is_admin()) {
        any_admin.id
    } else {
        let fallback_pw = std::env::var("ADMIN_PASSWORD")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("ihn-{}", &Uuid::new_v4().simple().to_string()[..16]));
        let created = next_repo
            .upsert_local_account(
                &current_admin.username,
                &current_admin.display_name,
                &current_admin.email,
                UserRole::Admin,
                &fallback_pw,
            )
            .await
            .map_err(repo_err)?;
        created.id
    };

    let _ = next_repo
        .update_site_settings(target_admin_id, current_settings)
        .await;
    if let Err(err) = next_repo
        .record_trusted_device(
            target_admin_id,
            &ctx.ip_address,
            &ctx.device_fingerprint,
            &ctx.device_label,
        )
        .await
    {
        tracing::warn!(
            user_id = %target_admin_id,
            ip = %ctx.ip_address,
            error = %err,
            "Failed to seed trusted device during storage backend switch"
        );
    }
    if let Ok(tok) = next_repo
        .create_session_with_meta(
            target_admin_id,
            &ctx.ip_address,
            &ctx.user_agent,
            &ctx.device_label,
            &ctx.device_fingerprint,
        )
        .await
    {
        new_session_token = Some(tok);
    }

    state.repo.swap(next_repo);

    {
        let mut secrets = state.runtime_secrets.write().await;
        secrets.storage_mode = target_mode.clone();
        if !persisted_url.is_empty() {
            secrets.database_url = persisted_url.clone();
        }
        secrets.save(&state.secrets_path).map_err(internal_err)?;
    }

    let active_kind = if state.repo.backend_kind() == "postgresql-17" {
        "postgres"
    } else {
        "local"
    };
    let effective_after = resolve_saved_or_env_db_url(&persisted_url);
    let (postgres, has_saved_password) = extract_saved_pg_status(&effective_after);

    Ok(Json(SwitchStorageResponse {
        active_backend: active_kind,
        configured_mode: target_mode,
        database_url_masked: mask_database_url(&effective_after),
        has_saved_url: !effective_after.is_empty(),
        has_saved_password,
        postgres,
        new_session_token,
    }))
}

// ============================================================================
// 3. OAuth Client Secret & SMTP Mail Settings
// ============================================================================

#[derive(Serialize)]
pub struct OAuthSecretStatusResponse {
    pub has_client_secret: bool,
    pub provider_secrets: HashMap<String, bool>,
}

#[derive(Deserialize)]
pub struct UpdateOAuthSecretBody {
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub clear: bool,
}

pub async fn admin_get_oauth_secret_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let secrets = state.runtime_secrets.read().await;
    let has = !secrets.oauth_client_secret.trim().is_empty();
    let provider_secrets = secrets.provider_secret_status_map();
    Ok(Json(OAuthSecretStatusResponse {
        has_client_secret: has,
        provider_secrets,
    }))
}

pub async fn admin_update_oauth_secret_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateOAuthSecretBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let mut secrets = state.runtime_secrets.write().await;
    let target_pid = body
        .provider_id
        .as_deref()
        .map(|s| {
            let slug = slugify_oauth_provider_id(s);
            if slug.is_empty() {
                s.trim().to_ascii_lowercase()
            } else {
                slug
            }
        })
        .filter(|s| !s.is_empty());

    if let Some(pid) = target_pid {
        if body.clear {
            secrets.oauth_client_secrets.remove(&pid);
            if pid == "default" {
                secrets.oauth_client_secret.clear();
            }
        } else if !body.client_secret.trim().is_empty() {
            secrets
                .oauth_client_secrets
                .insert(pid, body.client_secret.trim().to_string());
        }
    } else if body.clear {
        secrets.oauth_client_secret.clear();
    } else if !body.client_secret.trim().is_empty() {
        secrets.oauth_client_secret = body.client_secret.trim().to_string();
    }
    secrets.save(&state.secrets_path).map_err(internal_err)?;
    Ok(Json(OAuthSecretStatusResponse {
        has_client_secret: !secrets.oauth_client_secret.trim().is_empty(),
        provider_secrets: secrets.provider_secret_status_map(),
    }))
}

#[derive(Serialize)]
pub struct SmtpStatusResponse {
    pub settings: SmtpSettingsDto,
    pub has_password: bool,
}

#[derive(Deserialize)]
pub struct UpdateSmtpBody {
    pub settings: SmtpSettingsDto,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub clear_password: bool,
}

#[derive(Deserialize)]
pub struct TestSmtpBody {
    pub to_email: String,
    #[serde(default)]
    pub settings: Option<SmtpSettingsDto>,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub locale: Option<String>,
}

pub async fn admin_get_smtp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let secrets = state.runtime_secrets.read().await;
    Ok(Json(SmtpStatusResponse {
        settings: secrets.smtp.clone(),
        has_password: !secrets.smtp_password.trim().is_empty(),
    }))
}

pub async fn admin_update_smtp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateSmtpBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let clean = body.settings.sanitize();
    if (clean.enabled || !clean.from_email.is_empty()) && !is_valid_email(&clean.from_email) {
        return Err(ApiError::new(
            ErrorCode::InvalidEmail,
            "Please provide a valid sender email address.",
        ));
    }
    let mut secrets = state.runtime_secrets.write().await;
    secrets.smtp = clean.clone();
    if body.clear_password {
        secrets.smtp_password.clear();
    } else if !body.password.trim().is_empty() {
        secrets.smtp_password = body.password.trim().to_string();
    }
    secrets.save(&state.secrets_path).map_err(internal_err)?;
    Ok(Json(SmtpStatusResponse {
        settings: clean,
        has_password: !secrets.smtp_password.trim().is_empty(),
    }))
}

#[derive(Deserialize)]
pub struct PreviewSmtpTemplateBody {
    pub template_kind: String,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub html: Option<String>,
    #[serde(default)]
    pub email_footer_text: Option<String>,
}

#[derive(Serialize)]
pub struct PreviewSmtpTemplateResponse {
    pub subject: String,
    pub html: String,
}

pub async fn admin_preview_smtp_template_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PreviewSmtpTemplateBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let site_settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let saved_footer = {
        let secrets = state.runtime_secrets.read().await;
        secrets.smtp.email_footer_text.clone()
    };
    let effective_footer = body
        .email_footer_text
        .as_deref()
        .unwrap_or(saved_footer.as_str());
    let origin = detect_external_origin(&headers);
    let target_locale =
        resolve_request_locale(body.locale.as_deref(), &headers, &site_settings.default_locale);
    let (subject, html) = render_mail_preview(
        &body.template_kind,
        target_locale,
        body.subject.as_deref(),
        body.html.as_deref(),
        Some(effective_footer),
        &site_settings.site_name,
        &site_settings.logo_url,
        &origin,
    );
    Ok(Json(PreviewSmtpTemplateResponse { subject, html }))
}

pub async fn admin_test_smtp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TestSmtpBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let to_email = validate_and_normalize_email(&body.to_email).ok_or_else(|| {
        ApiError::new(
            ErrorCode::InvalidEmail,
            "Please provide a valid test recipient email address.",
        )
    })?;

    let (cfg, pw) = {
        let secrets = state.runtime_secrets.read().await;
        let effective_cfg = body
            .settings
            .map(SmtpSettingsDto::sanitize)
            .unwrap_or_else(|| secrets.smtp.clone());
        let effective_pw = if !body.password.trim().is_empty() {
            body.password.trim().to_string()
        } else {
            secrets.smtp_password.clone()
        };
        (effective_cfg, effective_pw)
    };
    if !is_valid_email(&cfg.from_email) {
        return Err(ApiError::new(
            ErrorCode::InvalidEmail,
            "Please provide a valid sender email address.",
        ));
    }

    let site_settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let origin = detect_external_origin(&headers);
    let target_locale =
        resolve_request_locale(body.locale.as_deref(), &headers, &site_settings.default_locale);

    send_test_email(
        &cfg,
        &pw,
        MailBrandContext {
            site_name: &site_settings.site_name,
            logo_url: &site_settings.logo_url,
            origin: &origin,
            locale: target_locale,
        },
        &to_email,
    )
    .await
    .map_err(|e| {
        ApiError::new(
            ErrorCode::SmtpSendFailed,
            format!("Failed to send test email: {e}"),
        )
    })?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ============================================================================
// 4. Admin User Governance (List / Create / Role / Ban / Reset Password / Delete)
// ============================================================================

#[derive(Deserialize)]
pub struct AdminCreateUserBody {
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub email: String,
    pub role: UserRole,
    pub password: String,
}

#[derive(Deserialize)]
pub struct UpdateRoleBody {
    pub role: UserRole,
}

#[derive(Deserialize)]
pub struct SetUserBanBody {
    pub banned: bool,
    #[serde(default)]
    pub reason: String,
}

#[derive(Deserialize)]
pub struct AdminResetPasswordBody {
    pub new_password: String,
}

pub async fn admin_list_users_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let users = state.repo.admin_list_users().await.map_err(repo_err)?;
    Ok(Json(users))
}

pub async fn admin_create_user_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AdminCreateUserBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let clean_username = body.username.trim();
    if clean_username.len() < 2
        || clean_username.len() > 32
        || !clean_username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ApiError::new(
            ErrorCode::InvalidUsername,
            "Username must be 2–32 characters using letters, digits, underscores, or hyphens.",
        ));
    }
    let clean_email = if body.email.trim().is_empty() {
        String::new()
    } else {
        validate_and_normalize_email(&body.email).ok_or_else(|| {
            ApiError::new(
                ErrorCode::InvalidEmail,
                "Please provide a valid email address.",
            )
        })?
    };
    if body.password.chars().count() < 8 {
        return Err(ApiError::new(
            ErrorCode::PasswordTooShort,
            "Password must be at least 8 characters long.",
        ));
    }
    let created = state
        .repo
        .admin_create_user(
            clean_username,
            body.display_name.trim(),
            &clean_email,
            body.role,
            &body.password,
        )
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::Conflict))?;
    Ok((StatusCode::CREATED, Json(created)))
}

pub async fn admin_update_role_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<Uuid>,
    Json(body): Json<UpdateRoleBody>,
) -> Result<impl IntoResponse, ApiError> {
    let admin = require_admin(&state, &headers).await?;
    if admin.id == user_id && !body.role.is_admin() {
        return Err(ApiError::new(
            ErrorCode::CannotModifySelf,
            "Cannot demote the currently signed-in administrator.",
        ));
    }
    let updated = state
        .repo
        .admin_update_user_role(user_id, body.role)
        .await
        .map_err(repo_err)?;
    match updated {
        Some(u) => Ok(Json(u)),
        None => Err(ApiError::new(ErrorCode::UserNotFound, "User not found.")),
    }
}

pub async fn admin_set_user_ban_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<Uuid>,
    Json(body): Json<SetUserBanBody>,
) -> Result<impl IntoResponse, ApiError> {
    let admin = require_admin(&state, &headers).await?;
    if admin.id == user_id && body.banned {
        return Err(ApiError::new(
            ErrorCode::CannotModifySelf,
            "Cannot suspend the currently signed-in administrator.",
        ));
    }
    let updated = state
        .repo
        .admin_set_user_ban(user_id, body.banned, &body.reason)
        .await
        .map_err(repo_err)?;
    match updated {
        Some(u) => {
            if body.banned {
                let email = u.email.trim().to_string();
                if is_deliverable_email(&email) {
                    let (smtp_cfg, smtp_pw) = {
                        let secrets = state.runtime_secrets.read().await;
                        (secrets.smtp.clone(), secrets.smtp_password.clone())
                    };
                    if is_smtp_ready(&smtp_cfg) {
                        let settings = state
                            .repo
                            .get_site_settings(&state.default_settings)
                            .await
                            .unwrap_or_else(|_| state.default_settings.clone());
                        let origin = detect_external_origin(&headers);
                        let target_locale =
                            resolve_request_locale(None, &headers, &settings.default_locale)
                                .to_string();
                        let display_name = u.display_name.clone();
                        let username = u.username.clone();
                        let reason = body.reason.clone();
                        tokio::spawn(async move {
                            if let Err(err) = send_user_ban_notice_email(
                                &smtp_cfg,
                                &smtp_pw,
                                MailBrandContext {
                                    site_name: &settings.site_name,
                                    logo_url: &settings.logo_url,
                                    origin: &origin,
                                    locale: &target_locale,
                                },
                                &display_name,
                                &username,
                                &reason,
                                &email,
                            )
                            .await
                            {
                                tracing::warn!(
                                    "Failed to send account suspension email to {}: {err}",
                                    email
                                );
                            }
                        });
                    }
                }
            }
            Ok(Json(u))
        }
        None => Err(ApiError::new(ErrorCode::UserNotFound, "User not found.")),
    }
}

pub async fn admin_reset_user_password_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<Uuid>,
    Json(body): Json<AdminResetPasswordBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    if body.new_password.chars().count() < 8 {
        return Err(ApiError::new(
            ErrorCode::PasswordTooShort,
            "Password must be at least 8 characters long.",
        ));
    }
    let updated = state
        .repo
        .admin_reset_user_password(user_id, &body.new_password)
        .await
        .map_err(repo_err)?;
    match updated {
        Some(u) => Ok(Json(u)),
        None => Err(ApiError::new(ErrorCode::UserNotFound, "User not found.")),
    }
}

pub async fn admin_delete_user_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let admin = require_admin(&state, &headers).await?;
    if admin.id == user_id {
        return Err(ApiError::new(
            ErrorCode::CannotModifySelf,
            "Cannot delete the currently signed-in administrator.",
        ));
    }
    let deleted = state
        .repo
        .admin_delete_user(user_id)
        .await
        .map_err(repo_err)?;
    if deleted {
        Ok(Json(serde_json::json!({ "deleted": true })))
    } else {
        Err(ApiError::new(ErrorCode::UserNotFound, "User not found."))
    }
}

// ============================================================================
// 5. Admin Article Takedown & Restore (with optional SMTP author notifications)
// ============================================================================

#[derive(Deserialize)]
pub struct TakedownStepBody {
    pub reason: String,
}

#[derive(Serialize)]
pub struct TakedownStepResponse {
    pub ok: bool,
    pub notified_count: usize,
    pub emails_sent: usize,
}

pub async fn admin_takedown_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
    Json(body): Json<TakedownStepBody>,
) -> Result<impl IntoResponse, ApiError> {
    let admin = require_admin(&state, &headers).await?;
    let reason = body.reason.trim();
    if reason.is_empty() {
        return Err(ApiError::new(
            ErrorCode::TakedownReasonRequired,
            "A takedown reason is required.",
        ));
    }

    let (article_title, recipients) = state
        .repo
        .admin_takedown_step(&admin, &track, &chapter, &step, reason)
        .await
        .map_err(repo_err)?;

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let origin = detect_external_origin(&headers);
    let target_locale = resolve_request_locale(None, &headers, &settings.default_locale);
    let action_url = format!("{origin}/{target_locale}/studio");

    let (smtp_cfg, smtp_pw) = {
        let secrets = state.runtime_secrets.read().await;
        (secrets.smtp.clone(), secrets.smtp_password.clone())
    };
    let mut emails_sent = 0usize;
    if is_smtp_ready(&smtp_cfg) {
        // Dispatch takedown notifications concurrently so multiple collaborators never stall the HTTP request
        let mut tasks = tokio::task::JoinSet::new();
        for recipient in &recipients {
            let email = recipient.email.trim().to_string();
            if !is_deliverable_email(&email) {
                continue;
            }
            let smtp_cfg_cl = smtp_cfg.clone();
            let smtp_pw_cl = smtp_pw.clone();
            let site_name_cl = settings.site_name.clone();
            let logo_url_cl = settings.logo_url.clone();
            let origin_cl = origin.clone();
            let locale_cl = target_locale.to_string();
            let display_name_cl = recipient.display_name.clone();
            let article_title_cl = article_title.clone();
            let reason_cl = reason.to_string();
            let action_url_cl = action_url.clone();
            tasks.spawn(async move {
                let res = send_takedown_notice_email(
                    &smtp_cfg_cl,
                    &smtp_pw_cl,
                    MailBrandContext {
                        site_name: &site_name_cl,
                        logo_url: &logo_url_cl,
                        origin: &origin_cl,
                        locale: &locale_cl,
                    },
                    &display_name_cl,
                    &article_title_cl,
                    &reason_cl,
                    &action_url_cl,
                    &email,
                )
                .await;
                (email, res)
            });
        }
        while let Some(joined) = tasks.join_next().await {
            match joined {
                Ok((_email, Ok(()))) => emails_sent += 1,
                Ok((email, Err(e))) => {
                    tracing::warn!("Failed to send takedown email to {}: {e}", email);
                }
                Err(e) => {
                    tracing::warn!("Takedown email dispatch task error: {e}");
                }
            }
        }
    }

    Ok(Json(TakedownStepResponse {
        ok: true,
        notified_count: recipients.len(),
        emails_sent,
    }))
}

pub async fn admin_restore_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let restored = state
        .repo
        .admin_restore_step(&track, &chapter, &step)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "restored": restored })))
}
