mod error;
mod mailer;
mod routes;
mod state;

use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderName, HeaderValue, Method},
    routing::{any, delete, get, patch, post, put},
    Router,
};
use error::ApiError;
use icehandnote_core::{
    auth::{validate_and_normalize_email, SiteSettingsDto, UserRole},
    error::ErrorCode,
    SUPPORTED_LOCALES,
};
use icehandnote_db::{
    content_loader::load_content_directory, LocalSeedRepository, PostgresRepository,
    TutorialRepository,
};
use state::{AppState, DynamicRepository, RuntimeSecretsConfig};
use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::info;
use uuid::Uuid;

fn exe_parent_dir() -> Option<PathBuf> {
    env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
}

fn resolve_content_dir(env_dir: Option<&Path>) -> PathBuf {
    if let Ok(p) = env::var("CONTENT_DIR") {
        let raw = PathBuf::from(&p);
        let mut candidates = vec![raw.clone()];
        if raw.is_relative() {
            if let Some(dir) = env_dir {
                candidates.push(dir.join(&raw));
            }
            if let Some(exe_dir) = exe_parent_dir() {
                candidates.push(exe_dir.join(&raw));
            }
        }
        if let Some(found) = candidates.into_iter().find(|c| c.exists()) {
            return found;
        }
        tracing::warn!("CONTENT_DIR={p} does not exist; falling back to auto-detected content directory");
    }
    let mut fallbacks: Vec<PathBuf> = Vec::new();
    if let Some(dir) = env_dir {
        fallbacks.push(dir.join("content"));
    }
    fallbacks.extend(["./content", "../../content", "../content"].map(PathBuf::from));
    if let Some(exe_dir) = exe_parent_dir() {
        fallbacks.push(exe_dir.join("content"));
    }
    fallbacks
        .into_iter()
        .find(|c| c.exists())
        .unwrap_or_else(|| PathBuf::from("./content"))
}

fn resolve_web_dist_dir(env_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = env::var("WEB_DIST_DIR") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let raw = PathBuf::from(trimmed);
            candidates.push(raw.clone());
            if raw.is_relative() {
                if let Some(dir) = env_dir {
                    candidates.push(dir.join(&raw));
                }
                if let Some(exe_dir) = exe_parent_dir() {
                    candidates.push(exe_dir.join(&raw));
                }
            }
        }
    }
    if let Some(dir) = env_dir {
        candidates.push(dir.join("web"));
        candidates.push(dir.join("apps/web/dist"));
    }
    candidates.extend(
        ["./web", "./apps/web/dist", "../web", "../../apps/web/dist"].map(PathBuf::from),
    );
    if let Some(exe_dir) = exe_parent_dir() {
        candidates.push(exe_dir.join("web"));
        candidates.push(exe_dir.join("apps/web/dist"));
    }
    candidates
        .into_iter()
        .find(|dir| dir.join("index.html").is_file())
}

fn resolve_store_path(env_dir: Option<&Path>) -> PathBuf {
    let base = env_dir
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    if let Ok(p) = env::var("LOCAL_STORE_PATH") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let raw = PathBuf::from(trimmed);
            return if raw.is_absolute() {
                raw
            } else {
                base.join(raw)
            };
        }
    }
    if let Ok(d) = env::var("DATA_DIR") {
        let trimmed = d.trim();
        if !trimmed.is_empty() {
            let raw = PathBuf::from(trimmed);
            let dir = if raw.is_absolute() {
                raw
            } else {
                base.join(raw)
            };
            return dir.join("store.json");
        }
    }
    let legacy = base.join(".data").join("dev-store.json");
    if legacy.exists() {
        return legacy;
    }
    base.join("data").join("store.json")
}

async fn bootstrap_initial_admin(repo: &dyn TutorialRepository) -> anyhow::Result<()> {
    let username = env::var("ADMIN_USERNAME")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "admin".to_string());
    let display_name = env::var("ADMIN_DISPLAY_NAME")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "Admin".to_string());
    let email = match env::var("ADMIN_EMAIL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        Some(raw) => match validate_and_normalize_email(&raw) {
            Some(valid) => valid,
            None => {
                tracing::warn!(
                    "Ignoring invalid ADMIN_EMAIL env value; falling back to '{}@localhost'",
                    username
                );
                format!("{username}@localhost")
            }
        },
        None => format!("{username}@localhost"),
    };
    let explicit_pw = env::var("ADMIN_PASSWORD")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if let Some(pw) = explicit_pw {
        let user = repo
            .upsert_local_account(&username, &display_name, &email, UserRole::Admin, &pw)
            .await?;
        info!(
            "Initialized admin account '{}' (id={}) from ADMIN_USERNAME / ADMIN_PASSWORD",
            user.username, user.id
        );
        return Ok(());
    }

    let existing_users = repo.admin_list_users().await?;
    let has_any_admin = existing_users.iter().any(|u| u.role.is_admin());
    if !has_any_admin {
        let raw = Uuid::new_v4().simple().to_string();
        let generated_pw = format!("ihn-{}", &raw[..16]);
        repo.upsert_local_account(
            &username,
            &display_name,
            &email,
            UserRole::Admin,
            &generated_pw,
        )
        .await?;
        info!("============================================================");
        info!("Initial Admin Account Created (first boot):");
        info!("  Username : {username}");
        info!("  Password : {generated_pw}");
        info!("  (Set ADMIN_USERNAME & ADMIN_PASSWORD to customize or reset)");
        info!("============================================================");
    }
    Ok(())
}

fn env_flag(name: &str, default: bool) -> bool {
    env::var(name)
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(default)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let env_file = dotenvy::dotenv().ok();
    let env_dir = env_file.as_deref().and_then(Path::parent).map(Path::to_path_buf);

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "icehandnote_api=info,tower_http=info".into()),
        )
        .init();

    match &env_file {
        Some(p) => info!("Loaded environment from {}", p.display()),
        None => info!("No .env file found; using process environment only"),
    }

    let content_dir = resolve_content_dir(env_dir.as_deref());
    let store_path = resolve_store_path(env_dir.as_deref());
    let data_dir = store_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("./data"));
    let uploads_dir = data_dir.join("uploads");
    let _ = std::fs::create_dir_all(&uploads_dir);
    let secrets_path = data_dir.join("runtime-secrets.json");
    let mut initial_secrets = RuntimeSecretsConfig::load_or_default(&secrets_path);
    let guest_cookie_secret = env::var("GUEST_COOKIE_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() >= 24)
        .unwrap_or_else(|| {
            if initial_secrets.guest_cookie_secret.len() >= 24 {
                initial_secrets.guest_cookie_secret.clone()
            } else {
                let generated = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
                initial_secrets.guest_cookie_secret = generated.clone();
                let _ = initial_secrets.save(&secrets_path);
                generated
            }
        });

    let default_locale = env::var("DEFAULT_LOCALE")
        .ok()
        .filter(|l| SUPPORTED_LOCALES.iter().any(|(code, _)| code == l))
        .unwrap_or_else(|| "zh-CN".to_string());
    let dev_sso_simulator = env_flag("DEV_SSO_SIMULATOR", false);
    let seed_demo_users = env_flag("SEED_DEMO_USERS", false);

    let effective_db_url: Option<String> = match initial_secrets.storage_mode.as_str() {
        "local" => None,
        "postgres" => Some(initial_secrets.database_url.clone())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| env::var("DATABASE_URL").ok().filter(|s| !s.trim().is_empty())),
        _ => env::var("DATABASE_URL").ok().filter(|s| !s.trim().is_empty()),
    };

    let initial_repo: Arc<dyn TutorialRepository> = match effective_db_url {
        Some(db_url) => {
            info!("Connecting to PostgreSQL (seed demo users: {seed_demo_users})...");
            let pg = PostgresRepository::connect_and_migrate(&db_url, seed_demo_users).await?;
            if content_dir.exists() {
                let bundle = load_content_directory(&content_dir)?;
                let count = pg.sync_bundle(&bundle).await?;
                info!("Synced {count} localized step documents into PostgreSQL");
            }
            Arc::new(pg)
        }
        None => {
            info!(
                "Booting LocalSeedRepository (content={}, store={})",
                content_dir.display(),
                store_path.display()
            );
            let local = LocalSeedRepository::from_content_dir_with_options(
                &content_dir,
                store_path.clone(),
                seed_demo_users,
            )?;
            Arc::new(local)
        }
    };

    let repo = Arc::new(DynamicRepository::new(initial_repo));
    bootstrap_initial_admin(&*repo).await?;

    let blog_sso_secret = match env::var("BLOG_SSO_SECRET") {
        Ok(s) if s.len() >= 32 => s,
        Ok(_) => anyhow::bail!("BLOG_SSO_SECRET must be at least 32 characters long."),
        Err(_) => {
            if !dev_sso_simulator {
                tracing::warn!(
                    "BLOG_SSO_SECRET is not set: external cross-site SSO is disabled; password and OAuth login remain available."
                );
            }
            format!("ephemeral-{}-{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
        }
    };
    let blog_origin_url = env::var("BLOG_ORIGIN_URL").unwrap_or_default();
    let blog_wp_api_url = env::var("BLOG_WP_API_URL")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let public_origin = env::var("PUBLIC_ORIGIN")
        .ok()
        .as_deref()
        .and_then(state::normalize_origin_url);
    let trust_proxy_headers = env_flag("TRUST_PROXY_HEADERS", false);
    let default_settings = SiteSettingsDto::default_with_env(&default_locale, &blog_origin_url);

    let state = AppState {
        repo,
        content_dir,
        store_path,
        uploads_dir,
        secrets_path,
        runtime_secrets: Arc::new(tokio::sync::RwLock::new(initial_secrets)),
        oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        mail_guard: Arc::new(mailer::MailDeliveryGuard::load_or_default(Some(
            data_dir.join("mail-guard.json"),
        ))),
        update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
        public_origin: public_origin.clone(),
        trust_proxy_headers,
        guest_cookie_secret,
        blog_sso_secret,
        blog_origin_url: blog_origin_url.clone(),
        blog_wp_api_url,
        dev_sso_simulator,
        default_settings,
        http_client: reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new()),
    };

    let exposed_headers = [
        header::ETAG,
        header::LOCATION,
        header::RETRY_AFTER,
        header::CONTENT_DISPOSITION,
        HeaderName::from_static("x-total-count"),
    ];
    let mut default_allowed_origins: Vec<String> = vec![
        "http://localhost:5173".to_string(),
        "http://127.0.0.1:5173".to_string(),
        "http://localhost:3001".to_string(),
        "http://127.0.0.1:3001".to_string(),
    ];
    if let Some(ref po) = public_origin {
        default_allowed_origins.push(po.clone());
    }
    if let Some(blog_orig) = state::normalize_origin_url(&blog_origin_url) {
        default_allowed_origins.push(blog_orig);
    }

    let cors = if let Ok(raw_cors) = env::var("CORS_ORIGIN") {
        let parsed: Vec<HeaderValue> = raw_cors
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<HeaderValue>().ok())
            .collect();
        if !parsed.is_empty() {
            CorsLayer::new()
                .allow_origin(parsed)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers(Any)
                .expose_headers(exposed_headers)
        } else {
            build_strict_default_cors(default_allowed_origins, exposed_headers)
        }
    } else {
        build_strict_default_cors(default_allowed_origins, exposed_headers)
    };

    let web_dist_dir = resolve_web_dist_dir(env_dir.as_deref());
    if let Some(ref web_dir) = web_dist_dir {
        info!("Serving frontend SPA assets from {}", web_dir.display());
    }

    let app = build_router(state, cors, web_dist_dir);

    let host = env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = env::var("API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);
    let addr: SocketAddr = format!("{host}:{port}").parse()?;

    info!("❄ IceHandnote API listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

fn build_router(
    state: AppState,
    cors: CorsLayer,
    web_dist_dir: Option<PathBuf>,
) -> Router {
    let mut router = Router::new()
        // Public Reader & Health Routes
        .route("/api/v1/health", get(routes::public::health_handler))
        .route("/api/v1/settings", get(routes::public::get_site_settings_handler))
        .route("/api/v1/{locale}/tracks", get(routes::public::list_tracks_handler))
        .route(
            "/api/v1/{locale}/series/{track}/{step}",
            get(routes::public::get_series_article_handler),
        )
        .route(
            "/api/v1/{locale}/tracks/{track}/steps/{chapter}/{step}",
            get(routes::public::get_step_handler),
        )
        .route("/api/v1/{locale}/search", get(routes::public::search_handler))
        .route(
            "/api/v1/me/progress",
            get(routes::public::get_progress_handler)
                .post(routes::public::toggle_progress_handler),
        )
        .route(
            "/api/v1/me/task-checks",
            get(routes::public::get_task_checks_handler)
                .post(routes::public::toggle_task_check_handler),
        )
        .route("/api/v1/steps/{step_id}/like", post(routes::public::like_step_handler))
        .route(
            "/api/v1/me/notes",
            get(routes::public::list_notes_handler).post(routes::public::create_note_handler),
        )
        .route(
            "/api/v1/me/notes/export",
            get(routes::public::export_notes_handler),
        )
        .route(
            "/api/v1/me/notes/{note_id}",
            patch(routes::public::update_note_handler).delete(routes::public::delete_note_handler),
        )
        .route(
            "/api/v1/me/notes/{note_id}/restore",
            post(routes::public::restore_note_handler),
        )
        // Media Upload (Authenticated users + active OAuth onboarding sessions)
        .route(
            "/api/v1/uploads",
            post(routes::uploads::upload_media_handler)
                .layer(DefaultBodyLimit::max(12 * 1024 * 1024)),
        )
        // Auth, Registration, Profile, Password Reset & OAuth/SSO Routes
        .route("/api/v1/auth/me", get(routes::auth::auth_me_handler))
        .route("/api/v1/auth/login", post(routes::auth::auth_login_handler))
        .route(
            "/api/v1/auth/login/verify-otp",
            post(routes::auth::auth_login_verify_otp_handler),
        )
        .route(
            "/api/v1/auth/login/resend-otp",
            post(routes::auth::auth_login_resend_otp_handler),
        )
        .route(
            "/api/v1/auth/register/send-code",
            post(routes::auth::auth_send_register_code_handler),
        )
        .route(
            "/api/v1/auth/check-username",
            get(routes::auth::auth_check_username_handler),
        )
        .route("/api/v1/auth/register", post(routes::auth::auth_register_handler))
        .route("/api/v1/auth/profile", patch(routes::auth::update_my_profile_handler))
        .route(
            "/api/v1/auth/sessions",
            get(routes::auth::auth_list_sessions_handler),
        )
        .route(
            "/api/v1/auth/sessions/revoke-others",
            post(routes::auth::auth_revoke_other_sessions_handler),
        )
        .route(
            "/api/v1/auth/sessions/{session_id}",
            delete(routes::auth::auth_revoke_session_handler),
        )
        .route(
            "/api/v1/auth/forgot-password",
            post(routes::auth::forgot_password_handler),
        )
        .route(
            "/api/v1/auth/verify-reset-otp",
            post(routes::auth::verify_reset_otp_handler),
        )
        .route(
            "/api/v1/auth/reset-password",
            post(routes::auth::reset_password_handler),
        )
        .route(
            "/api/v1/auth/change-password",
            post(routes::auth::change_password_handler),
        )
        .route(
            "/api/v1/auth/me/email/send-code",
            post(routes::auth::send_email_change_code_handler),
        )
        .route(
            "/api/v1/auth/me/email/verify",
            post(routes::auth::verify_email_change_handler),
        )
        .route(
            "/api/v1/auth/me/oauth/{provider}",
            delete(routes::auth::auth_unbind_oauth_handler),
        )
        .route(
            "/api/v1/auth/passkeys",
            get(routes::auth::passkey_list_handler),
        )
        .route(
            "/api/v1/auth/passkeys/register/options",
            post(routes::auth::passkey_register_options_handler),
        )
        .route(
            "/api/v1/auth/passkeys/register/verify",
            post(routes::auth::passkey_register_verify_handler),
        )
        .route(
            "/api/v1/auth/passkeys/{cred_id}",
            patch(routes::auth::passkey_rename_handler)
                .delete(routes::auth::passkey_delete_handler),
        )
        .route(
            "/api/v1/auth/passkeys/login/options",
            post(routes::auth::passkey_login_options_handler),
        )
        .route(
            "/api/v1/auth/passkeys/login/verify",
            post(routes::auth::passkey_login_verify_handler),
        )
        .route(
            "/api/v1/auth/oauth/authorize",
            get(routes::auth::oauth_authorize_handler),
        )
        .route(
            "/api/v1/auth/oauth/bind-ticket",
            post(routes::auth::oauth_create_bind_ticket_handler),
        )
        .route(
            "/api/v1/auth/oauth/callback",
            get(routes::auth::oauth_callback_handler),
        )
        .route(
            "/api/v1/auth/oauth/exchange",
            post(routes::auth::oauth_exchange_handler),
        )
        .route(
            "/api/v1/auth/oauth/onboarding/{token}",
            get(routes::auth::oauth_get_onboarding_handler),
        )
        .route(
            "/api/v1/auth/oauth/complete-registration",
            post(routes::auth::oauth_complete_registration_handler),
        )
        .route(
            "/api/v1/auth/oauth/bind-existing",
            post(routes::auth::oauth_bind_existing_handler),
        )
        .route(
            "/api/v1/auth/sso/verify",
            post(routes::auth::auth_sso_verify_handler),
        )
        .route(
            "/api/v1/auth/dev-sso-ticket",
            post(routes::auth::auth_dev_sso_ticket_handler),
        )
        .route("/api/v1/auth/logout", post(routes::auth::auth_logout_handler))
        // Studio Authoring, Collaboration & Media Routes
        .route(
            "/api/v1/studio/{locale}/overview",
            get(routes::studio::studio_overview_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/{locale}",
            get(routes::studio::studio_get_step_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/{locale}/revisions",
            get(routes::studio::list_step_revisions_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/{locale}/revisions/{rev_id}/diff",
            get(routes::studio::diff_step_revision_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/{locale}/revisions/{rev_id}/restore",
            post(routes::studio::restore_step_revision_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/events",
            get(routes::studio::step_events_sse_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/presence",
            put(routes::studio::upsert_step_presence_handler)
                .delete(routes::studio::delete_step_presence_handler),
        )
        .route("/api/v1/studio/steps", post(routes::studio::studio_save_step_handler))
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}",
            delete(routes::studio::studio_delete_step_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/invites",
            post(routes::studio::create_collaborator_invite_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/collaborators/me",
            delete(routes::studio::leave_step_collaboration_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/collaborators/{user_id}",
            patch(routes::studio::update_step_collaborator_role_handler)
                .delete(routes::studio::remove_step_collaborator_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/transfer-owner",
            post(routes::studio::transfer_step_ownership_handler),
        )
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/audit-logs",
            get(routes::studio::list_step_audit_logs_handler),
        )
        .route(
            "/api/v1/studio/invites/preview",
            post(routes::studio::preview_collaborator_invite_handler),
        )
        .route(
            "/api/v1/studio/invites/accept",
            post(routes::studio::accept_collaborator_invite_handler),
        )
        .route(
            "/api/v1/studio/invites/{invite_id}",
            delete(routes::studio::revoke_collaborator_invite_handler),
        )
        .route(
            "/api/v1/studio/tracks",
            post(routes::studio::studio_create_track_handler),
        )
        .route(
            "/api/v1/studio/tracks/{track}",
            delete(routes::studio::studio_delete_track_handler),
        )
        .route(
            "/api/v1/studio/chapters",
            post(routes::studio::studio_create_chapter_handler),
        )
        .route(
            "/api/v1/studio/tracks/{track}/chapters/{chapter}",
            delete(routes::studio::studio_delete_chapter_handler),
        )
        .route(
            "/api/v1/studio/preview",
            post(routes::studio::studio_preview_handler),
        )
        .route(
            "/api/v1/studio/uploads",
            post(routes::uploads::upload_media_handler)
                .layer(DefaultBodyLimit::max(12 * 1024 * 1024)),
        )
        .route(
            "/api/v1/studio/update-check",
            get(routes::studio::studio_update_check_handler),
        )
        // Admin Governance, Storage, OAuth Secrets, SMTP, Users & Moderation Routes
        .route(
            "/api/v1/admin/settings",
            patch(routes::admin::admin_update_settings_handler),
        )
        .route(
            "/api/v1/admin/storage",
            get(routes::admin::admin_get_storage_handler)
                .put(routes::admin::admin_update_storage_handler),
        )
        .route(
            "/api/v1/admin/storage/test",
            post(routes::admin::admin_test_storage_handler),
        )
        .route(
            "/api/v1/admin/oauth-secret",
            get(routes::admin::admin_get_oauth_secret_handler)
                .put(routes::admin::admin_update_oauth_secret_handler),
        )
        .route(
            "/api/v1/admin/smtp",
            get(routes::admin::admin_get_smtp_handler)
                .put(routes::admin::admin_update_smtp_handler),
        )
        .route(
            "/api/v1/admin/smtp/test",
            post(routes::admin::admin_test_smtp_handler),
        )
        .route(
            "/api/v1/admin/smtp/preview",
            post(routes::admin::admin_preview_smtp_template_handler),
        )
        .route(
            "/api/v1/admin/smtp/guard/reset-circuit",
            post(routes::admin::admin_reset_mail_circuit_handler),
        )
        .route(
            "/api/v1/admin/smtp/guard/clear-suppression",
            post(routes::admin::admin_clear_mail_suppression_handler),
        )
        .route(
            "/api/v1/admin/users",
            get(routes::admin::admin_list_users_handler)
                .post(routes::admin::admin_create_user_handler),
        )
        .route(
            "/api/v1/admin/users/{user_id}",
            delete(routes::admin::admin_delete_user_handler),
        )
        .route(
            "/api/v1/admin/users/{user_id}/role",
            patch(routes::admin::admin_update_role_handler),
        )
        .route(
            "/api/v1/admin/users/{user_id}/ban",
            patch(routes::admin::admin_set_user_ban_handler),
        )
        .route(
            "/api/v1/admin/users/{user_id}/reset-password",
            post(routes::admin::admin_reset_user_password_handler),
        )
        .route(
            "/api/v1/admin/steps/{track}/{chapter}/{step}/takedown",
            post(routes::admin::admin_takedown_step_handler),
        )
        .route(
            "/api/v1/admin/steps/{track}/{chapter}/{step}/restore",
            post(routes::admin::admin_restore_step_handler),
        )
        .route(
            "/api/v1/admin/reload",
            post(routes::admin::reload_content_handler),
        )
        // Secure Static Uploaded Media Endpoint (ETag, 304, CSP sandbox, nosniff)
        .route(
            "/uploads/{ym}/{filename}",
            get(routes::uploads::serve_uploaded_media_handler),
        )
        .route(
            "/api/{*rest}",
            any(|| async { ApiError::new(ErrorCode::NotFound, "API endpoint not found.") }),
        );

    if let Some(web_dir) = web_dist_dir {
        let index_file = Arc::new(web_dir.join("index.html"));
        let index_for_root = Arc::clone(&index_file);
        let index_for_html = Arc::clone(&index_file);
        let index_for_fallback = Arc::clone(&index_file);
        let fallback_state = state.clone();

        router = router
            .route(
                "/",
                get(move |axum::extract::State(st): axum::extract::State<AppState>| {
                    let path = Arc::clone(&index_for_root);
                    async move { serve_bootstrapped_index(st, &path).await }
                }),
            )
            .route(
                "/index.html",
                get(move |axum::extract::State(st): axum::extract::State<AppState>| {
                    let path = Arc::clone(&index_for_html);
                    async move { serve_bootstrapped_index(st, &path).await }
                }),
            )
            .fallback_service(
                ServeDir::new(web_dir)
                    .append_index_html_on_directories(false)
                    .fallback(any(move || {
                        let st = fallback_state.clone();
                        let path = Arc::clone(&index_for_fallback);
                        async move { serve_bootstrapped_index(st, &path).await }
                    })),
            );
    }

    router
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(security_headers_middleware))
        .layer(cors)
        .with_state(state)
}

fn build_strict_default_cors(allowed_origins: Vec<String>, exposed_headers: [HeaderName; 5]) -> CorsLayer {
    let allow_origin = tower_http::cors::AllowOrigin::predicate(
        move |origin: &HeaderValue, request_parts: &axum::http::request::Parts| {
            let Ok(orig_str) = origin.to_str() else {
                return false;
            };
            let Some(norm_origin) = state::normalize_origin_url(orig_str) else {
                return false;
            };
            if allowed_origins.iter().any(|allowed| allowed == &norm_origin) {
                return true;
            }
            if let Some(host_val) = request_parts
                .headers
                .get(header::HOST)
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|h| state::is_valid_authority(h))
            {
                let host_lower = host_val.to_ascii_lowercase();
                return norm_origin == format!("https://{host_lower}")
                    || norm_origin == format!("http://{host_lower}");
            }
            false
        },
    );
    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::IF_MATCH,
            header::IF_NONE_MATCH,
            HeaderName::from_static("idempotency-key"),
            HeaderName::from_static("last-event-id"),
            HeaderName::from_static("x-client-tab-id"),
            HeaderName::from_static("x-device-id"),
            HeaderName::from_static("x-onboarding-token"),
            HeaderName::from_static("x-site-locale"),
        ])
        .expose_headers(exposed_headers)
}

async fn security_headers_middleware(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut resp = next.run(req).await;
    let h = resp.headers_mut();
    h.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    h.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    h.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    if !h.contains_key(header::CONTENT_SECURITY_POLICY) {
        h.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("frame-ancestors 'none'"),
        );
    }
    resp
}

fn escape_html_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn render_bootstrapped_index_html(raw_html: &str, settings: &SiteSettingsDto) -> String {
    let plain_title = icehandnote_core::reading_time::strip_html_tags(&settings.site_name)
        .trim()
        .to_string();
    let escaped_title = escape_html_text(&plain_title);
    let title_tag = format!("<title>{escaped_title}</title>");

    let mut html = if raw_html.contains("<title></title>") {
        raw_html.replacen("<title></title>", &title_tag, 1)
    } else if raw_html.contains("<title>IceHandnote</title>") {
        raw_html.replacen("<title>IceHandnote</title>", &title_tag, 1)
    } else {
        raw_html.to_string()
    };

    let custom_logo = settings.logo_url.trim();
    if !custom_logo.is_empty() && icehandnote_core::is_safe_image_src(custom_logo) {
        let escaped_logo = escape_html_text(custom_logo);
        html = html.replacen(
            "rel=\"icon\"",
            &format!("rel=\"icon\" href=\"{escaped_logo}\""),
            1,
        );
    }

    if let Ok(json) = serde_json::to_string(settings) {
        let safe_json = json
            .replace('<', "\\u003c")
            .replace('>', "\\u003e")
            .replace('&', "\\u0026")
            .replace('\u{2028}', "\\u2028")
            .replace('\u{2029}', "\\u2029");
        let script_tag = format!(
            "<script id=\"ihn-site-settings\">window.__ICEHANDNOTE_SITE_SETTINGS__={safe_json};</script>"
        );
        if html.contains("<!-- ihn-bootstrap-slot -->") {
            html = html.replacen("<!-- ihn-bootstrap-slot -->", &script_tag, 1);
        } else if html.contains("</head>") {
            html = html.replacen("</head>", &format!("{script_tag}\n</head>"), 1);
        }
    }

    html
}

async fn serve_bootstrapped_index(
    state: AppState,
    index_path: &Path,
) -> axum::response::Response {
    use axum::response::IntoResponse;

    let raw_html = match tokio::fs::read_to_string(index_path).await {
        Ok(content) => content,
        Err(_) => {
            return ApiError::new(ErrorCode::NotFound, "Frontend index.html not found.")
                .into_response();
        }
    };
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let rendered = render_bootstrapped_index_html(&raw_html, &settings);

    (
        [
            (
                axum::http::header::CONTENT_TYPE,
                "text/html; charset=utf-8",
            ),
            (axum::http::header::CACHE_CONTROL, "no-cache"),
        ],
        rendered,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn router_registers_all_routes_without_conflict() {
        let content_dir = resolve_content_dir(None);
        let store_path = env::temp_dir().join(format!("icehandnote-test-{}.json", Uuid::new_v4()));
        let uploads_dir = env::temp_dir().join(format!("icehandnote-uploads-{}", Uuid::new_v4()));
        let secrets_path =
            env::temp_dir().join(format!("icehandnote-secrets-{}.json", Uuid::new_v4()));
        let repo = LocalSeedRepository::from_content_dir(&content_dir, store_path.clone()).unwrap();
        let state = AppState {
            repo: Arc::new(DynamicRepository::new(Arc::new(repo))),
            content_dir,
            store_path,
            uploads_dir,
            secrets_path,
            runtime_secrets: Arc::new(tokio::sync::RwLock::new(RuntimeSecretsConfig::default())),
            oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mail_guard: Arc::new(mailer::MailDeliveryGuard::in_memory()),
            bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
            public_origin: None,
            trust_proxy_headers: false,
            guest_cookie_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_sso_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_origin_url: String::new(),
            blog_wp_api_url: None,
            dev_sso_simulator: false,
            default_settings: SiteSettingsDto::default_with_env("zh-CN", ""),
            http_client: reqwest::Client::new(),
        };
        let _router = build_router(state, CorsLayer::permissive(), None);
    }

    #[test]
    fn bootstrapped_index_html_injects_title_logo_and_escaped_json() {
        let mut settings = SiteSettingsDto::default_with_env("zh-CN", "");
        settings.site_name = "<span>Custom</script> & Notes</span>".to_string();
        settings.logo_url = "/uploads/2026-11/brand.png".to_string();

        let template = "<!DOCTYPE html><html><head><title></title><link rel=\"icon\" type=\"image/svg+xml\" data-default-href=\"data:image/svg+xml,default\" /><!-- ihn-bootstrap-slot --></head><body></body></html>";
        let out = render_bootstrapped_index_html(template, &settings);

        assert!(out.contains("<title>Custom &amp; Notes</title>"));
        assert!(out.contains("rel=\"icon\" href=\"/uploads/2026-11/brand.png\""));
        assert!(out.contains("data-default-href=\"data:image/svg+xml,default\""));
        assert!(out.contains("window.__ICEHANDNOTE_SITE_SETTINGS__="));
        assert!(!out.contains("</script> & Notes"));
    }

    #[test]
    fn api_error_produces_rfc9457_problem_details_json() {
        use axum::response::IntoResponse;
        let resp = ApiError::new(ErrorCode::Unauthorized, "Authentication required.").into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
        assert_eq!(
            resp.headers()
                .get(axum::http::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("application/problem+json")
        );
        assert_eq!(
            resp.headers()
                .get(axum::http::header::WWW_AUTHENTICATE)
                .and_then(|v| v.to_str().ok()),
            Some("Bearer realm=\"icehandnote\"")
        );
    }

    #[test]
    fn compares_semver_tags_accurately() {
        use routes::studio::is_newer_semver;
        assert!(is_newer_semver("v0.2.0", "0.1.0"));
        assert!(is_newer_semver("1.0.0", "v0.9.9"));
        assert!(is_newer_semver("v0.1.1", "0.1.0"));
        assert!(!is_newer_semver("v0.1.0", "0.1.0"));
        assert!(!is_newer_semver("v0.1.0-rc.1", "0.1.0"));
        assert!(is_newer_semver("v0.1.0", "0.1.0-rc.1"));
        assert!(is_newer_semver("v0.1.0-rc.2", "v0.1.0-rc.1"));
        assert!(is_newer_semver("v0.1.0-rc.10", "v0.1.0-rc.2"));
        assert!(!is_newer_semver("v0.1.0-rc.1", "v0.1.0-rc.1"));
    }

    #[tokio::test]
    async fn registration_verification_code_enforces_rate_limit_binding_and_consumption() {
        use axum::response::IntoResponse;

        let content_dir = resolve_content_dir(None);
        let store_path =
            env::temp_dir().join(format!("icehandnote-verify-test-{}.json", Uuid::new_v4()));
        let repo = LocalSeedRepository::from_content_dir(&content_dir, store_path.clone()).unwrap();

        let (code_id, code) = repo
            .create_registration_verification_code("alice@example.com")
            .await
            .unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));

        // Immediate resend triggers 429 rate-limit with Retry-After header
        let rate_err = repo
            .create_registration_verification_code("alice@example.com")
            .await
            .unwrap_err();
        let api_err = ApiError::from_anyhow(rate_err);
        assert_eq!(api_err.code, ErrorCode::VerificationCodeRateLimited);
        let resp = api_err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::TOO_MANY_REQUESTS);
        assert!(resp.headers().get(axum::http::header::RETRY_AFTER).is_some());

        // Email binding isolation: code for alice cannot verify bob
        assert!(repo
            .verify_registration_verification_code("bob@example.com", &code)
            .await
            .is_err());

        // Wrong code fails, valid code still succeeds before 5 attempts
        assert!(repo
            .verify_registration_verification_code("alice@example.com", "000000")
            .await
            .is_err());
        let verified_id = repo
            .verify_registration_verification_code("ALICE@EXAMPLE.COM", &code)
            .await
            .unwrap();
        assert_eq!(verified_id, code_id);

        // Consuming invalidates code permanently
        repo.consume_registration_verification_code(verified_id)
            .await
            .unwrap();
        assert!(repo
            .verify_registration_verification_code("alice@example.com", &code)
            .await
            .is_err());

        let _ = std::fs::remove_file(store_path);
    }

    #[tokio::test]
    async fn session_tracking_revocation_and_anomaly_otp_flow_work_end_to_end() {
        let content_dir = resolve_content_dir(None);
        let store_path =
            env::temp_dir().join(format!("icehandnote-session-test-{}.json", Uuid::new_v4()));
        let repo = LocalSeedRepository::from_content_dir(&content_dir, store_path.clone()).unwrap();
        let user = repo
            .register_local_account(
                "alice",
                "Alice",
                "alice@example.com",
                "supersecret123",
                UserRole::Reader,
            )
            .await
            .unwrap();

        // First login: no anomaly baseline yet
        assert_eq!(
            repo.detect_login_anomaly(user.id, "198.51.100.10", "dev:a:chrome")
                .await
                .unwrap(),
            None
        );
        repo.record_trusted_device(user.id, "198.51.100.10", "dev:a:chrome", "Chrome · Windows")
            .await
            .unwrap();

        let tok1 = repo
            .create_session_with_meta(
                user.id,
                "198.51.100.10",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0",
                "Chrome · Windows",
                "dev:a:chrome",
            )
            .await
            .unwrap();

        // Same IP + same device -> no anomaly
        assert_eq!(
            repo.detect_login_anomaly(user.id, "198.51.100.10", "dev:a:chrome")
                .await
                .unwrap(),
            None
        );
        // New IP only -> new_ip
        assert_eq!(
            repo.detect_login_anomaly(user.id, "203.0.113.42", "dev:a:chrome")
                .await
                .unwrap()
                .as_deref(),
            Some("new_ip")
        );
        // New device only -> new_device
        assert_eq!(
            repo.detect_login_anomaly(user.id, "198.51.100.10", "dev:b:safari")
                .await
                .unwrap()
                .as_deref(),
            Some("new_device")
        );
        // Both new -> new_ip_and_device
        assert_eq!(
            repo.detect_login_anomaly(user.id, "203.0.113.42", "dev:b:safari")
                .await
                .unwrap()
                .as_deref(),
            Some("new_ip_and_device")
        );

        // Login OTP challenge flow + immediate resend rate limit
        let (chal_id, otp_code) = repo
            .create_login_otp_challenge(
                user.id,
                &user.email,
                "203.0.113.42",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1",
                "Safari · macOS",
                "dev:b:safari",
                "new_ip_and_device",
            )
            .await
            .unwrap();
        assert!(repo.resend_login_otp_challenge(chal_id).await.is_err());
        assert!(repo
            .verify_login_otp_challenge(chal_id, "000000")
            .await
            .is_err());
        let (verified_user, ip, _ua, label, fp) = repo
            .verify_login_otp_challenge(chal_id, &otp_code)
            .await
            .unwrap();
        assert_eq!(verified_user.id, user.id);
        assert_eq!(ip, "203.0.113.42");
        assert_eq!(label, "Safari · macOS");
        assert_eq!(fp, "dev:b:safari");

        // Second session + list + revoke single + revoke others
        let tok2 = repo
            .create_session_with_meta(
                user.id,
                "203.0.113.42",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1",
                "Safari · macOS",
                "dev:b:safari",
            )
            .await
            .unwrap();
        let sessions = repo.list_user_sessions(user.id, &tok2).await.unwrap();
        assert_eq!(sessions.len(), 2);
        assert!(sessions[0].is_current);
        assert_eq!(sessions[0].ip_address, "203.0.113.42");
        assert_eq!(sessions[1].ip_address, "198.51.100.10");

        let removed = repo.revoke_other_user_sessions(user.id, &tok2).await.unwrap();
        assert_eq!(removed, 1);
        assert!(repo.get_user_by_session(&tok1).await.unwrap().is_none());
        assert!(repo.get_user_by_session(&tok2).await.unwrap().is_some());

        // Password reset via 3-step gated OTP verification -> verified token -> password update
        assert!(repo.is_username_taken("ALICE").await.unwrap());
        assert!(!repo.is_username_taken("alice_brand_new").await.unwrap());

        let (_, _raw_token, reset_otp) = repo
            .create_password_reset_token("alice@example.com")
            .await
            .unwrap()
            .unwrap();
        // Wrong OTP rejected
        assert!(repo
            .verify_password_reset_otp("alice@example.com", "000000")
            .await
            .is_err());
        // Valid OTP returns verified reset_token and invalidates OTP immediately (single-use)
        let verified_token = repo
            .verify_password_reset_otp("ALICE@EXAMPLE.COM", &reset_otp)
            .await
            .unwrap();
        assert!(verified_token.starts_with("ihn_rstv_"));
        assert!(repo
            .verify_password_reset_otp("alice@example.com", &reset_otp)
            .await
            .is_err());

        let updated = repo
            .consume_password_reset_token(&verified_token, "newpassword456")
            .await
            .unwrap();
        assert_eq!(updated.id, user.id);
        assert!(repo
            .authenticate_password("alice", "newpassword456")
            .await
            .unwrap()
            .is_some());

        let _ = std::fs::remove_file(store_path);
    }

    #[tokio::test]
    async fn oauth_token_exchange_handles_strict_post_basic_fallback_and_urlencoded() {
        use axum::{
            http::{header, HeaderMap, StatusCode},
            response::IntoResponse,
        };
        use routes::auth::exchange_oauth_code;

        let mock_app = Router::new()
            // Endpoint 1: Strict RFC 6749 server that rejects dual auth (both Basic header + body secret)
            .route(
                "/strict-oidc/token",
                post(|headers: HeaderMap, body: String| async move {
                    let has_basic = headers.contains_key(header::AUTHORIZATION);
                    let has_body_secret = body.contains("client_secret=");
                    if has_basic && has_body_secret {
                        return (
                            StatusCode::BAD_REQUEST,
                            axum::Json(serde_json::json!({
                                "error": "invalid_client",
                                "error_description": "Multiple client authentication mechanisms provided"
                            })),
                        )
                            .into_response();
                    }
                    if has_body_secret {
                        return (
                            StatusCode::OK,
                            axum::Json(serde_json::json!({
                                "access_token": "tok_strict_post_ok",
                                "token_type": "Bearer"
                            })),
                        )
                            .into_response();
                    }
                    StatusCode::UNAUTHORIZED.into_response()
                }),
            )
            // Endpoint 2: Strict `client_secret_basic`-only server (e.g. Ory Fosite / Authelia default)
            .route(
                "/basic-only/token",
                post(|headers: HeaderMap, body: String| async move {
                    let has_basic = headers.contains_key(header::AUTHORIZATION);
                    let has_body_secret = body.contains("client_secret=");
                    if !has_basic || has_body_secret {
                        return (
                            StatusCode::UNAUTHORIZED,
                            axum::Json(serde_json::json!({
                                "error": "invalid_client",
                                "error_description": "Client authentication failed (client_secret_basic required)"
                            })),
                        )
                            .into_response();
                    }
                    (
                        StatusCode::OK,
                        axum::Json(serde_json::json!({
                            "access_token": "tok_basic_fallback_ok",
                            "token_type": "Bearer"
                        })),
                    )
                        .into_response()
                }),
            )
            // Endpoint 3: Form-urlencoded token response
            .route(
                "/urlencoded/token",
                post(|| async move {
                    (
                        StatusCode::OK,
                        "access_token=gho_form_encoded_ok&scope=read%3Auser&token_type=bearer",
                    )
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, mock_app).await;
        });

        let client = reqwest::Client::new();
        let base = format!("http://{addr}");

        let v1 = exchange_oauth_code(
            &client,
            &format!("{base}/strict-oidc/token"),
            "code1",
            "https://notes.example/api/v1/auth/oauth/callback",
            "cid",
            "sec!@#",
            "verifier1",
        )
        .await
        .expect("strict OIDC server must succeed without dual-auth failure");
        assert_eq!(v1["access_token"], "tok_strict_post_ok");

        let v2 = exchange_oauth_code(
            &client,
            &format!("{base}/basic-only/token"),
            "code2",
            "https://notes.example/api/v1/auth/oauth/callback",
            "cid",
            "sec!@#",
            "verifier2",
        )
        .await
        .expect("basic-only OIDC server must succeed via automatic client_secret_basic fallback");
        assert_eq!(v2["access_token"], "tok_basic_fallback_ok");

        let v3 = exchange_oauth_code(
            &client,
            &format!("{base}/urlencoded/token"),
            "code3",
            "https://notes.example/api/v1/auth/oauth/callback",
            "cid",
            "sec",
            "verifier3",
        )
        .await
        .expect("urlencoded token response must parse cleanly");
        assert_eq!(v3["access_token"], "gho_form_encoded_ok");
    }

    #[tokio::test]
    async fn multi_oauth_bindings_lockout_guard_and_user_ban_email_work() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::TcpListener;

        let content_dir = resolve_content_dir(None);
        let store_path =
            env::temp_dir().join(format!("icehandnote-multioauth-test-{}.json", Uuid::new_v4()));
        let repo = LocalSeedRepository::from_content_dir(&content_dir, store_path.clone()).unwrap();

        // OAuth-only user (no local password)
        let oauth_user = repo
            .complete_oauth_registration(
                "github",
                "gh-sub-1",
                "octocat",
                "Octocat",
                "octocat@example.com",
                UserRole::Reader,
                "oauth",
                "",
                "",
            )
            .await
            .unwrap();
        assert!(!oauth_user.has_password);
        assert_eq!(oauth_user.oauth_bindings, vec!["github".to_string()]);

        // Cannot unbind the sole sign-in method
        let unbind_last_err = repo
            .unbind_oauth_from_user(oauth_user.id, "github")
            .await
            .unwrap_err();
        assert_eq!(
            ApiError::from_anyhow(unbind_last_err).code,
            ErrorCode::CannotUnbindLastAuth
        );

        // Bind a second OAuth provider -> both appear, and unbinding one succeeds
        let multi = repo
            .bind_oauth_to_user(oauth_user.id, "authentik", "ak-sub-99", "")
            .await
            .unwrap();
        assert_eq!(multi.oauth_bindings.len(), 2);
        assert!(multi.oauth_bindings.contains(&"github".to_string()));
        assert!(multi.oauth_bindings.contains(&"authentik".to_string()));

        // Both providers sign in to the exact same user
        let found_ak = repo
            .find_oauth_user("authentik", "ak-sub-99", "")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found_ak.id, oauth_user.id);

        let after_unbind = repo
            .unbind_oauth_from_user(oauth_user.id, "github")
            .await
            .unwrap();
        assert_eq!(after_unbind.oauth_bindings, vec!["authentik".to_string()]);

        // Verify user ban email delivery via local SMTP sink
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let sink = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (r, mut w) = stream.into_split();
            let mut reader = BufReader::new(r);
            w.write_all(b"220 sink.local ESMTP Ready\r\n").await.unwrap();
            let mut raw_data = String::new();
            let mut in_data = false;
            let mut line = String::new();
            loop {
                line.clear();
                let n = reader.read_line(&mut line).await.unwrap();
                if n == 0 {
                    break;
                }
                if in_data {
                    if line.trim_end_matches(['\r', '\n']) == "." {
                        in_data = false;
                        w.write_all(b"250 OK queued\r\n").await.unwrap();
                    } else {
                        raw_data.push_str(&line);
                    }
                    continue;
                }
                let upper = line.to_ascii_uppercase();
                if upper.starts_with("EHLO ") || upper.starts_with("HELO ") {
                    w.write_all(b"250-sink.local\r\n250 OK\r\n").await.unwrap();
                } else if upper.starts_with("DATA") {
                    in_data = true;
                    w.write_all(b"354 End data\r\n").await.unwrap();
                } else if upper.starts_with("QUIT") {
                    w.write_all(b"221 Bye\r\n").await.unwrap();
                    break;
                } else {
                    w.write_all(b"250 OK\r\n").await.unwrap();
                }
            }
            raw_data
        });

        let smtp = icehandnote_core::mail_templates::SmtpSettingsDto {
            enabled: true,
            host: "127.0.0.1".to_string(),
            port,
            encryption: "none".to_string(),
            from_name: "IceHandnote".to_string(),
            from_email: "noreply@icehandnote.dev".to_string(),
            ..Default::default()
        };
        let guard = Arc::new(mailer::MailDeliveryGuard::in_memory());
        let http_client = reqwest::Client::new();
        let mail_ctx = mailer::MailSendContext {
            guard: &guard,
            http_client: &http_client,
            smtp: &smtp,
            creds: mailer::MailCredentials::default(),
            brand: mailer::MailBrandContext {
                site_name: "IceHandnote",
                logo_url: "",
                origin: "https://notes.test",
                locale: "zh-CN",
            },
            dedup_key: Some("test-ban-notice"),
            cooldown_secs: 60,
            allow_disabled_draft: false,
        };
        mailer::send_user_ban_notice_email(
            &mail_ctx,
            &oauth_user.display_name,
            &oauth_user.username,
            "恶意刷屏灌水",
            &oauth_user.email,
        )
        .await
        .expect("account ban notice email must deliver cleanly");
        let captured = sink.await.unwrap();
        assert!(!captured.is_empty());

        let _ = std::fs::remove_file(store_path);
    }

    #[tokio::test]
    async fn collaborator_invite_rejects_malformed_emails_and_normalizes_valid_ones() {
        let content_dir = resolve_content_dir(None);
        let store_path = env::temp_dir().join(format!(
            "icehandnote-invite-email-test-{}.json",
            Uuid::new_v4()
        ));
        let repo = LocalSeedRepository::from_content_dir(&content_dir, store_path.clone()).unwrap();

        let owner = repo
            .upsert_local_account(
                "invite_owner",
                "Invite Owner",
                "owner@icehandnote.dev",
                UserRole::Admin,
                "supersecret123",
            )
            .await
            .unwrap();

        for bad in ["user@gm", "..bad@example.com", "a@localhost", "a@-b.com"] {
            let err = repo
                .create_collaborator_invite(
                    &owner,
                    "getting-started",
                    "01-welcome",
                    "01-welcome-to-icehandnote",
                    bad,
                    "editor",
                    &[],
                )
                .await
                .unwrap_err();
            assert_eq!(
                ApiError::from_anyhow(err).code,
                ErrorCode::InvalidEmail,
                "expected `{bad}` to return ErrorCode::InvalidEmail"
            );
        }

        let (invite, _tok, _title) = repo
            .create_collaborator_invite(
                &owner,
                "getting-started",
                "01-welcome",
                "01-welcome-to-icehandnote",
                "  Collab+Notes@Example.COM ",
                "translator",
                &["en".to_string()],
            )
            .await
            .unwrap();
        assert_eq!(invite.email, "Collab+Notes@example.com");
        assert_eq!(invite.role, "translator");
        assert_eq!(invite.locale_scope, vec!["en".to_string()]);

        let _ = std::fs::remove_file(store_path);
    }

    #[tokio::test]
    async fn series_two_level_lookup_and_article_timestamps_work() {
        let content_dir = resolve_content_dir(None);
        let store_path = env::temp_dir().join(format!(
            "icehandnote-series-test-{}.json",
            Uuid::new_v4()
        ));
        let repo = LocalSeedRepository::from_content_dir(&content_dir, store_path.clone()).unwrap();

        let detail = repo
            .get_step_detail("zh-CN", "getting-started", "-", "01-welcome-to-icehandnote")
            .await
            .unwrap()
            .expect("2-level series lookup must resolve starter chapter");
        assert_eq!(detail.chapters.len(), 1);
        assert_eq!(detail.author_name, "IceHandnote");
        assert_eq!(detail.published_at.to_rfc3339(), "2026-11-22T00:00:00+00:00");
        assert_eq!(detail.updated_at.to_rfc3339(), "2026-11-22T00:00:00+00:00");

        let mut settings = SiteSettingsDto::default_with_env("zh-CN", "");
        assert_eq!(settings.stale_article_days, 180);
        settings.stale_article_days = 9999;
        let sanitized = settings.sanitize().unwrap();
        assert_eq!(sanitized.stale_article_days, 3650);

        let _ = std::fs::remove_file(store_path);
    }

    #[tokio::test]
    async fn studio_save_renames_step_slug_on_disk_and_compiles_pixel_blocks() {
        let src_content = resolve_content_dir(None);
        let tmp_root = env::temp_dir().join(format!("icehandnote-slug-rename-{}", Uuid::new_v4()));
        let tmp_content = tmp_root.join("content");
        let ch_dst = tmp_content.join("getting-started").join("01-welcome");
        std::fs::create_dir_all(&ch_dst).unwrap();
        std::fs::copy(
            src_content.join("getting-started").join("track.toml"),
            tmp_content.join("getting-started").join("track.toml"),
        )
        .unwrap();
        for fname in [
            "01-welcome-to-icehandnote.zh-CN.md",
            "01-welcome-to-icehandnote.zh-TW.md",
            "01-welcome-to-icehandnote.en.md",
            "01-welcome-to-icehandnote.ja.md",
        ] {
            let src = src_content
                .join("getting-started")
                .join("01-welcome")
                .join(fname);
            if src.exists() {
                std::fs::copy(&src, ch_dst.join(fname)).unwrap();
            }
        }

        let store_path = tmp_root.join("store.json");
        let repo =
            LocalSeedRepository::from_content_dir(&tmp_content, store_path.clone()).unwrap();
        let admin = repo
            .upsert_local_account(
                "slug_author",
                "Slug Author",
                "slugauthor@icehandnote.dev",
                UserRole::Admin,
                "supersecret123",
            )
            .await
            .unwrap();

        let saved = repo
            .studio_save_step(
                &admin,
                icehandnote_core::auth::SaveStudioStepInput {
                    track_slug: "getting-started".to_string(),
                    chapter_slug: "-".to_string(),
                    step_slug: "01-welcome-renamed".to_string(),
                    previous_step_slug: Some("01-welcome-to-icehandnote".to_string()),
                    locale: "zh-CN".to_string(),
                    title: "重命名后的欢迎章".to_string(),
                    summary: "测试贴纸与 URL Slug 修改".to_string(),
                    step_number: 1,
                    estimated_minutes: 3,
                    synced_revision: 1,
                    bump_canonical: false,
                    status: "published".to_string(),
                    license: "cc-by-4.0".to_string(),
                    tags: vec!["welcome".to_string()],
                    body_markdown:
                        "正文章节。\n\n:::pixel[lightbulb]{align=\"right\" size=\"lg\" caption=\"像素灯泡\"}\n"
                            .to_string(),
                    write_to_content_dir: true,
                    expected_etag: None,
                    change_note: None,
                },
                &tmp_content,
                false,
            )
            .await
            .expect("renaming step slug must succeed");
        assert_eq!(saved.step_slug, "01-welcome-renamed");

        // Old slug no longer resolves; new slug resolves with compiled PixelSticker block
        assert!(repo
            .get_step_detail("zh-CN", "getting-started", "-", "01-welcome-to-icehandnote")
            .await
            .unwrap()
            .is_none());
        let detail = repo
            .get_step_detail("zh-CN", "getting-started", "-", "01-welcome-renamed")
            .await
            .unwrap()
            .expect("renamed slug must resolve");
        assert!(detail.blocks.iter().any(|b| matches!(
            b,
            icehandnote_core::NotebookBlock::PixelSticker { sprite, .. } if sprite == "lightbulb"
        )));

        // Both active locale and sibling locale markdown files moved on disk
        assert!(ch_dst.join("01-welcome-renamed.zh-CN.md").exists());
        assert!(!ch_dst.join("01-welcome-to-icehandnote.zh-CN.md").exists());
        if src_content
            .join("getting-started")
            .join("01-welcome")
            .join("01-welcome-to-icehandnote.en.md")
            .exists()
        {
            assert!(ch_dst.join("01-welcome-renamed.en.md").exists());
            assert!(!ch_dst.join("01-welcome-to-icehandnote.en.md").exists());
        }

        // Creating a second chapter then attempting to steal the renamed slug returns Conflict
        let _second = repo
            .studio_save_step(
                &admin,
                icehandnote_core::auth::SaveStudioStepInput {
                    track_slug: "getting-started".to_string(),
                    chapter_slug: "-".to_string(),
                    step_slug: "02-second-article".to_string(),
                    previous_step_slug: None,
                    locale: "zh-CN".to_string(),
                    title: "第二章".to_string(),
                    summary: "冲突测试".to_string(),
                    step_number: 2,
                    estimated_minutes: 1,
                    synced_revision: 1,
                    bump_canonical: false,
                    status: "published".to_string(),
                    license: String::new(),
                    tags: vec![],
                    body_markdown: "正文".to_string(),
                    write_to_content_dir: true,
                    expected_etag: None,
                    change_note: None,
                },
                &tmp_content,
                false,
            )
            .await
            .unwrap();

        let conflict_err = repo
            .studio_save_step(
                &admin,
                icehandnote_core::auth::SaveStudioStepInput {
                    track_slug: "getting-started".to_string(),
                    chapter_slug: "-".to_string(),
                    step_slug: "01-welcome-renamed".to_string(),
                    previous_step_slug: Some("02-second-article".to_string()),
                    locale: "zh-CN".to_string(),
                    title: "第二章".to_string(),
                    summary: "冲突测试".to_string(),
                    step_number: 2,
                    estimated_minutes: 1,
                    synced_revision: 1,
                    bump_canonical: false,
                    status: "published".to_string(),
                    license: String::new(),
                    tags: vec![],
                    body_markdown: "正文".to_string(),
                    write_to_content_dir: true,
                    expected_etag: None,
                    change_note: None,
                },
                &tmp_content,
                false,
            )
            .await
            .unwrap_err();
        assert_eq!(
            ApiError::from_anyhow(conflict_err).code,
            ErrorCode::Conflict
        );

        let _ = std::fs::remove_dir_all(tmp_root);
    }

    #[tokio::test]
    async fn notes_enforce_server_auth_idor_protection_rfc7396_if_match_undo_and_export() {
        let content_dir = resolve_content_dir(None);
        let tmp_root = env::temp_dir().join(format!("icehandnote-notes-rfc-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tmp_root).unwrap();
        let store_path = tmp_root.join("store.json");
        let uploads_dir = tmp_root.join("uploads");
        let secrets_path = tmp_root.join("secrets.json");

        let repo =
            LocalSeedRepository::from_content_dir_with_options(&content_dir, store_path.clone(), false)
                .unwrap();
        let victim = repo
            .register_local_account("alice_note", "Alice", "alice@example.com", "StrongPass123!", UserRole::Reader)
            .await
            .unwrap();
        let victim_session = repo.create_session(victim.id).await.unwrap();

        let tracks = repo.list_tracks("zh-CN").await.unwrap();
        let first_step = repo
            .get_step_detail(
                "zh-CN",
                &tracks[0].slug,
                &tracks[0].first_chapter_slug,
                &tracks[0].first_step_slug,
            )
            .await
            .unwrap()
            .unwrap();
        let step_id = first_step.step_id;

        let state = AppState {
            repo: Arc::new(DynamicRepository::new(Arc::new(repo))),
            content_dir,
            store_path,
            uploads_dir,
            secrets_path,
            runtime_secrets: Arc::new(tokio::sync::RwLock::new(RuntimeSecretsConfig::default())),
            oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mail_guard: Arc::new(mailer::MailDeliveryGuard::in_memory()),
            bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
            public_origin: None,
            trust_proxy_headers: false,
            guest_cookie_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_sso_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_origin_url: String::new(),
            blog_wp_api_url: None,
            dev_sso_simulator: false,
            default_settings: SiteSettingsDto::default_with_env("zh-CN", ""),
            http_client: reqwest::Client::new(),
        };
        let app = build_router(state, CorsLayer::permissive(), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });
        let base = format!("http://{addr}");
        let client = reqwest::Client::new();

        // 1. Authenticated user creates note with Idempotency-Key -> 201 + ETag + Location
        let create_body = serde_json::json!({
            "learner_id": "spoofed_client_value",
            "step_id": step_id,
            "locale_code": "zh-CN",
            "block_anchor_id": "p-abc12345",
            "tone": "violet",
            "style": "pin",
            "tag": "idea",
            "content": "**重要** `cargo test` 笔记",
            "target": {
                "source": format!("urn:icehandnote:step:{step_id}:locale:zh-CN"),
                "source_revision": 1,
                "selector": [
                    { "type": "FragmentSelector", "conformsTo": "https://icehandnote.dev/spec/block-id", "value": "p-abc12345" },
                    { "type": "TextQuoteSelector", "exact": "原文摘录", "prefix": "", "suffix": "" }
                ]
            }
        });
        let create_resp = client
            .post(format!("{base}/api/v1/me/notes"))
            .bearer_auth(&victim_session)
            .header("idempotency-key", "idem-test-001")
            .json(&create_body)
            .send()
            .await
            .unwrap();
        assert_eq!(create_resp.status(), reqwest::StatusCode::CREATED);
        let etag_v1 = create_resp
            .headers()
            .get(header::ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(create_resp.headers().get(header::LOCATION).is_some());
        let created_note: icehandnote_core::UserMarginNoteDto = create_resp.json().await.unwrap();
        assert_eq!(created_note.learner_id, format!("user:{}", victim.id));
        assert!(created_note.content_html.contains("<strong>重要</strong>"));
        assert!(created_note.content_html.contains("<code>cargo test</code>"));

        // 2. Replaying same Idempotency-Key returns the exact same note ID without duplicating
        let replay_resp = client
            .post(format!("{base}/api/v1/me/notes"))
            .bearer_auth(&victim_session)
            .header("idempotency-key", "idem-test-001")
            .json(&create_body)
            .send()
            .await
            .unwrap();
        assert_eq!(replay_resp.status(), reqwest::StatusCode::CREATED);
        let replay_note: icehandnote_core::UserMarginNoteDto = replay_resp.json().await.unwrap();
        assert_eq!(replay_note.id, created_note.id);

        // 3. IDOR Attack Defense: unauthenticated caller spoofing `learner_id=user:<victim.id>` sees 0 notes & gets 401 on DELETE
        let idor_list: Vec<icehandnote_core::UserMarginNoteDto> = client
            .get(format!("{base}/api/v1/me/notes?step_id={step_id}&learner_id=user:{}", victim.id))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(idor_list.is_empty(), "IDOR leak: unauthenticated caller must not read victim notes");

        let idor_del = client
            .delete(format!("{base}/api/v1/me/notes/{}?learner_id=user:{}", created_note.id, victim.id))
            .send()
            .await
            .unwrap();
        assert_eq!(idor_del.status(), reqwest::StatusCode::UNAUTHORIZED);

        // 4. Oversized note returns RFC 9110 422 Unprocessable Content
        let too_long = "a".repeat(icehandnote_core::MAX_NOTE_CHARS + 1);
        let long_resp = client
            .post(format!("{base}/api/v1/me/notes"))
            .bearer_auth(&victim_session)
            .json(&serde_json::json!({
                "step_id": step_id,
                "locale_code": "zh-CN",
                "block_anchor_id": "p-abc12345",
                "content": too_long,
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(long_resp.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);

        // 5. RFC 7396 PATCH with matching If-Match succeeds (v1 -> v2), stale If-Match returns 412
        let patch_ok = client
            .patch(format!("{base}/api/v1/me/notes/{}", created_note.id))
            .bearer_auth(&victim_session)
            .header(header::CONTENT_TYPE, "application/merge-patch+json")
            .header(header::IF_MATCH, &etag_v1)
            .body(serde_json::json!({ "content": "已编辑的笔记内容", "tag": "todo" }).to_string())
            .send()
            .await
            .unwrap();
        assert_eq!(patch_ok.status(), reqwest::StatusCode::OK);
        let etag_v2 = patch_ok
            .headers()
            .get(header::ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert_ne!(etag_v1, etag_v2);

        let patch_stale = client
            .patch(format!("{base}/api/v1/me/notes/{}", created_note.id))
            .bearer_auth(&victim_session)
            .header(header::CONTENT_TYPE, "application/merge-patch+json")
            .header(header::IF_MATCH, &etag_v1)
            .body(serde_json::json!({ "content": "过期覆盖" }).to_string())
            .send()
            .await
            .unwrap();
        assert_eq!(patch_stale.status(), reqwest::StatusCode::PRECONDITION_FAILED);

        // 6. Collection ETag + If-None-Match -> 304 Not Modified
        let list_resp = client
            .get(format!("{base}/api/v1/me/notes?step_id={step_id}&locale=zh-CN"))
            .bearer_auth(&victim_session)
            .send()
            .await
            .unwrap();
        assert_eq!(list_resp.status(), reqwest::StatusCode::OK);
        let coll_etag = list_resp
            .headers()
            .get(header::ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();

        let list_304 = client
            .get(format!("{base}/api/v1/me/notes?step_id={step_id}&locale=zh-CN"))
            .bearer_auth(&victim_session)
            .header(header::IF_NONE_MATCH, &coll_etag)
            .send()
            .await
            .unwrap();
        assert_eq!(list_304.status(), reqwest::StatusCode::NOT_MODIFIED);

        // 7. Soft-Delete + Undo Restore
        let del_resp = client
            .delete(format!("{base}/api/v1/me/notes/{}", created_note.id))
            .bearer_auth(&victim_session)
            .header(header::IF_MATCH, &etag_v2)
            .send()
            .await
            .unwrap();
        assert_eq!(del_resp.status(), reqwest::StatusCode::OK);

        let restore_resp = client
            .post(format!("{base}/api/v1/me/notes/{}/restore", created_note.id))
            .bearer_auth(&victim_session)
            .send()
            .await
            .unwrap();
        assert_eq!(restore_resp.status(), reqwest::StatusCode::OK);

        // 8. Export W3C JSON-LD & RFC 7763 Markdown
        let export_jsonld = client
            .get(format!("{base}/api/v1/me/notes/export?format=w3c-jsonld"))
            .bearer_auth(&victim_session)
            .send()
            .await
            .unwrap();
        assert_eq!(export_jsonld.status(), reqwest::StatusCode::OK);
        assert!(export_jsonld
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("application/ld+json"));

        // 9. Signed HttpOnly guest cookie issuance & isolated guest access
        let guest_resp = client
            .post(format!("{base}/api/v1/me/notes"))
            .json(&serde_json::json!({
                "step_id": step_id,
                "locale_code": "zh-CN",
                "block_anchor_id": "p-guest001",
                "content": "匿名访客笔记",
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(guest_resp.status(), reqwest::StatusCode::CREATED);
        let set_cookie = guest_resp
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(set_cookie.starts_with("ihn_guest=v1."));
        assert!(set_cookie.contains("HttpOnly"));
        let cookie_pair = set_cookie.split(';').next().unwrap().to_string();

        let guest_notes: Vec<icehandnote_core::UserMarginNoteDto> = client
            .get(format!("{base}/api/v1/me/notes?step_id={step_id}&locale=zh-CN"))
            .header(header::COOKIE, &cookie_pair)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(guest_notes.len(), 1);
        assert_eq!(guest_notes[0].raw_content, "匿名访客笔记");

        server_task.abort();
        let _ = std::fs::remove_dir_all(tmp_root);
    }

    #[tokio::test]
    async fn collaboration_enforces_occ_etag_bola_email_bound_invites_roles_revisions_and_transfer() {
        let src_content = resolve_content_dir(None);
        let tmp_root = env::temp_dir().join(format!("icehandnote-collab-rfc-{}", Uuid::new_v4()));
        let tmp_content = tmp_root.join("content");
        let ch_dst = tmp_content.join("getting-started").join("01-welcome");
        std::fs::create_dir_all(&ch_dst).unwrap();
        std::fs::copy(
            src_content.join("getting-started").join("track.toml"),
            tmp_content.join("getting-started").join("track.toml"),
        )
        .unwrap();
        std::fs::copy(
            src_content
                .join("getting-started")
                .join("01-welcome")
                .join("01-welcome-to-icehandnote.zh-CN.md"),
            ch_dst.join("01-welcome-to-icehandnote.zh-CN.md"),
        )
        .unwrap();

        let store_path = tmp_root.join("store.json");
        let uploads_dir = tmp_root.join("uploads");
        let secrets_path = tmp_root.join("secrets.json");

        let repo =
            LocalSeedRepository::from_content_dir_with_options(&tmp_content, store_path.clone(), false)
                .unwrap();

        let author_a = repo
            .register_local_account("author_a", "Author A", "alice@collab.example.org", "StrongPass123!", UserRole::Author)
            .await
            .unwrap();
        let author_b = repo
            .register_local_account("author_b", "Author B", "bob@collab.example.org", "StrongPass123!", UserRole::Author)
            .await
            .unwrap();
        let reader_c = repo
            .register_local_account("reader_c", "Reader C", "carol@collab.example.org", "StrongPass123!", UserRole::Reader)
            .await
            .unwrap();

        let tok_a = repo.create_session(author_a.id).await.unwrap();
        let tok_b = repo.create_session(author_b.id).await.unwrap();
        let tok_c = repo.create_session(reader_c.id).await.unwrap();

        let state = AppState {
            repo: Arc::new(DynamicRepository::new(Arc::new(repo))),
            content_dir: tmp_content.clone(),
            store_path,
            uploads_dir,
            secrets_path,
            runtime_secrets: Arc::new(tokio::sync::RwLock::new(RuntimeSecretsConfig::default())),
            oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mail_guard: Arc::new(mailer::MailDeliveryGuard::in_memory()),
            bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
            public_origin: None,
            trust_proxy_headers: false,
            guest_cookie_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_sso_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_origin_url: String::new(),
            blog_wp_api_url: None,
            dev_sso_simulator: false,
            default_settings: SiteSettingsDto::default_with_env("zh-CN", ""),
            http_client: reqwest::Client::new(),
        };
        let app = build_router(state, CorsLayer::permissive(), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });
        let base = format!("http://{addr}");
        let client = reqwest::Client::new();

        // 1. Author A creates a brand-new private draft article -> 200 OK + strong ETag
        let create_resp = client
            .post(format!("{base}/api/v1/studio/steps"))
            .bearer_auth(&tok_a)
            .json(&serde_json::json!({
                "track_slug": "getting-started",
                "chapter_slug": "01-welcome",
                "step_slug": "secret-rfc-draft",
                "locale": "zh-CN",
                "title": "私密协作草稿 v1",
                "summary": "初始草稿摘要",
                "step_number": 9,
                "status": "draft",
                "tags": ["rfc"],
                "body_markdown": "初始内容：第一版正文。",
                "write_to_content_dir": true
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(create_resp.status(), reqwest::StatusCode::OK);
        let etag_v1 = create_resp
            .headers()
            .get(header::ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(etag_v1.starts_with("\"st-1-"));
        let dto_v1: icehandnote_core::auth::StudioStepEditorDto = create_resp.json().await.unwrap();
        assert_eq!(dto_v1.edit_seq, 1);
        assert_eq!(dto_v1.etag, etag_v1);
        assert!(dto_v1.can_edit);
        assert!(dto_v1.can_manage_collaborators);

        // 2. C-03 BOLA Defense: Author B cannot read A's draft, cannot see it in overview, and cannot hijack unowned disk step
        let bola_read = client
            .get(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/zh-CN"))
            .bearer_auth(&tok_b)
            .send()
            .await
            .unwrap();
        assert_eq!(bola_read.status(), reqwest::StatusCode::FORBIDDEN);

        let b_overview: Vec<icehandnote_core::auth::StudioTrackDto> = client
            .get(format!("{base}/api/v1/studio/zh-CN/overview"))
            .bearer_auth(&tok_b)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let leaked_draft = b_overview
            .iter()
            .flat_map(|t| &t.chapters)
            .flat_map(|c| &c.steps)
            .any(|s| s.slug == "secret-rfc-draft");
        assert!(!leaked_draft, "BOLA leak: Author B must not see Author A's unpublished draft");

        let unowned_hijack = client
            .post(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/01-welcome-to-icehandnote/invites"))
            .bearer_auth(&tok_b)
            .json(&serde_json::json!({ "email": "carol@collab.example.org" }))
            .send()
            .await
            .unwrap();
        assert_eq!(unowned_hijack.status(), reqwest::StatusCode::FORBIDDEN);

        // 3. C-01 OCC Defense: Missing If-Match -> 428; stale If-Match -> 412 with RFC 9457 meta; valid If-Match -> 200
        let missing_if_match = client
            .post(format!("{base}/api/v1/studio/steps"))
            .bearer_auth(&tok_a)
            .json(&serde_json::json!({
                "track_slug": "getting-started",
                "chapter_slug": "01-welcome",
                "step_slug": "secret-rfc-draft",
                "locale": "zh-CN",
                "title": "私密协作草稿 v2",
                "summary": "摘要",
                "step_number": 9,
                "status": "draft",
                "tags": ["rfc"],
                "body_markdown": "无条件头覆盖尝试"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(missing_if_match.status(), reqwest::StatusCode::PRECONDITION_REQUIRED);

        let stale_if_match = client
            .post(format!("{base}/api/v1/studio/steps"))
            .bearer_auth(&tok_a)
            .header(header::IF_MATCH, "\"st-99-deadbeef0000\"")
            .json(&serde_json::json!({
                "track_slug": "getting-started",
                "chapter_slug": "01-welcome",
                "step_slug": "secret-rfc-draft",
                "locale": "zh-CN",
                "title": "私密协作草稿 v2",
                "summary": "摘要",
                "step_number": 9,
                "status": "draft",
                "tags": ["rfc"],
                "body_markdown": "过期 ETag 覆盖尝试"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(stale_if_match.status(), reqwest::StatusCode::PRECONDITION_FAILED);
        let conflict_body: serde_json::Value = stale_if_match.json().await.unwrap();
        assert_eq!(conflict_body["code"], "REVISION_CONFLICT");
        assert_eq!(conflict_body["meta"]["current_etag"], etag_v1);
        assert_eq!(
            conflict_body["meta"]["remote_body_markdown"]
                .as_str()
                .unwrap()
                .trim(),
            "初始内容：第一版正文。"
        );

        let valid_v2 = client
            .post(format!("{base}/api/v1/studio/steps"))
            .bearer_auth(&tok_a)
            .header(header::IF_MATCH, &etag_v1)
            .json(&serde_json::json!({
                "track_slug": "getting-started",
                "chapter_slug": "01-welcome",
                "step_slug": "secret-rfc-draft",
                "locale": "zh-CN",
                "title": "私密协作草稿 v2",
                "summary": "更新摘要",
                "step_number": 9,
                "status": "draft",
                "tags": ["rfc"],
                "body_markdown": "第二版正文内容。",
                "change_note": "补充第二节"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(valid_v2.status(), reqwest::StatusCode::OK);
        let etag_v2 = valid_v2
            .headers()
            .get(header::ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(etag_v2.starts_with("\"st-2-"));

        // 4. C-02 & C-07 Invite Security: Fragment URL + Idempotency-Key + Preview + Strict Email Binding + Least Privilege
        let inv_resp = client
            .post(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/invites"))
            .bearer_auth(&tok_a)
            .header("idempotency-key", "inv-key-001")
            .json(&serde_json::json!({
                "email": "carol@collab.example.org",
                "role": "reviewer",
                "locale": "zh-CN"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(inv_resp.status(), reqwest::StatusCode::CREATED);
        let inv_json: serde_json::Value = inv_resp.json().await.unwrap();
        let invite_url = inv_json["invite_url"].as_str().unwrap();
        assert!(invite_url.contains("/zh-CN/invite#token="), "invite token must use URL fragment");
        assert!(!invite_url.contains("?collab_invite="));
        let raw_token = invite_url.split("#token=").nth(1).unwrap().to_string();

        // Idempotency replay returns identical invite id
        let inv_replay: serde_json::Value = client
            .post(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/invites"))
            .bearer_auth(&tok_a)
            .header("idempotency-key", "inv-key-001")
            .json(&serde_json::json!({ "email": "carol@collab.example.org", "role": "reviewer" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(inv_replay["invite"]["id"], inv_json["invite"]["id"]);

        // Non-consuming preview
        let preview: icehandnote_core::auth::InvitePreviewDto = client
            .post(format!("{base}/api/v1/studio/invites/preview"))
            .bearer_auth(&tok_b)
            .json(&serde_json::json!({ "token": &raw_token }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(preview.role, "reviewer");
        assert_eq!(preview.email_matches_viewer, Some(false));

        // Author B (wrong email) is rejected with 403 INVITE_EMAIL_MISMATCH and does NOT consume the token
        let wrong_accept = client
            .post(format!("{base}/api/v1/studio/invites/accept"))
            .bearer_auth(&tok_b)
            .json(&serde_json::json!({ "token": &raw_token }))
            .send()
            .await
            .unwrap();
        assert_eq!(wrong_accept.status(), reqwest::StatusCode::FORBIDDEN);
        let wrong_body: serde_json::Value = wrong_accept.json().await.unwrap();
        assert_eq!(wrong_body["code"], "INVITE_EMAIL_MISMATCH");

        // Reader C (rightful email) accepts -> stays UserRole::Reader + has_collaborations = true!
        let ok_accept = client
            .post(format!("{base}/api/v1/studio/invites/accept"))
            .bearer_auth(&tok_c)
            .json(&serde_json::json!({ "token": &raw_token }))
            .send()
            .await
            .unwrap();
        assert_eq!(ok_accept.status(), reqwest::StatusCode::OK);
        let accept_body: serde_json::Value = ok_accept.json().await.unwrap();
        assert_eq!(accept_body["user"]["role"], "reader");
        assert_eq!(accept_body["user"]["has_collaborations"], true);

        // Consumed token now returns 410 Gone (INVITE_EXPIRED)
        let replay_accept = client
            .post(format!("{base}/api/v1/studio/invites/accept"))
            .bearer_auth(&tok_c)
            .json(&serde_json::json!({ "token": &raw_token }))
            .send()
            .await
            .unwrap();
        assert_eq!(replay_accept.status(), reqwest::StatusCode::GONE);

        // Reader C (reviewer) CAN view the draft, but gets 403 COLLABORATOR_ROLE_FORBIDDEN when attempting to save
        let c_read: icehandnote_core::auth::StudioStepEditorDto = client
            .get(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/zh-CN"))
            .bearer_auth(&tok_c)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(c_read.viewer_role, "reviewer");
        assert!(!c_read.can_edit);
        assert!(c_read.can_leave);

        let reviewer_save = client
            .post(format!("{base}/api/v1/studio/steps"))
            .bearer_auth(&tok_c)
            .header(header::IF_MATCH, &etag_v2)
            .json(&serde_json::json!({
                "track_slug": "getting-started",
                "chapter_slug": "01-welcome",
                "step_slug": "secret-rfc-draft",
                "locale": "zh-CN",
                "title": "审阅者越权改写",
                "summary": "摘要",
                "step_number": 9,
                "status": "draft",
                "tags": ["rfc"],
                "body_markdown": "禁止覆盖"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(reviewer_save.status(), reqwest::StatusCode::FORBIDDEN);

        // 5. C-04 & C-05: Owner upgrades Carol to `editor` -> Carol restores v1 via immutable revision restore -> audit logs -> leave
        let role_patch = client
            .patch(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/collaborators/{}", reader_c.id))
            .bearer_auth(&tok_a)
            .json(&serde_json::json!({ "role": "editor", "locale_scope": [] }))
            .send()
            .await
            .unwrap();
        assert_eq!(role_patch.status(), reqwest::StatusCode::OK);

        let revs: Vec<icehandnote_core::auth::StepRevisionDto> = client
            .get(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/zh-CN/revisions"))
            .bearer_auth(&tok_c)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(revs.len(), 2);
        let rev_v1 = revs.iter().find(|r| r.edit_seq == 1).unwrap();

        let restored: icehandnote_core::auth::StudioStepEditorDto = client
            .post(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/zh-CN/revisions/{}/restore", rev_v1.id))
            .bearer_auth(&tok_c)
            .header(header::IF_MATCH, &etag_v2)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(restored.edit_seq, 3);
        assert_eq!(restored.body_markdown.trim(), "初始内容：第一版正文。");

        let logs: Vec<icehandnote_core::auth::CollaborationAuditLogDto> = client
            .get(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/audit-logs"))
            .bearer_auth(&tok_a)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(logs.iter().any(|l| l.action == "revision_restored"));
        assert!(logs.iter().any(|l| l.action == "role_updated"));

        let leave_resp = client
            .delete(format!("{base}/api/v1/studio/steps/getting-started/01-welcome/secret-rfc-draft/collaborators/me"))
            .bearer_auth(&tok_c)
            .send()
            .await
            .unwrap();
        assert_eq!(leave_resp.status(), reqwest::StatusCode::OK);
        let leave_json: serde_json::Value = leave_resp.json().await.unwrap();
        assert_eq!(leave_json["left"], true);
        assert_eq!(leave_json["user"]["has_collaborations"], false);

        server_task.abort();
        let _ = std::fs::remove_dir_all(tmp_root);
    }

    #[tokio::test]
    async fn login_anomaly_http_and_smtp_risk_control_end_to_end() {
        use icehandnote_core::mail_templates::SmtpSettingsDto;
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        // 1. Local multi-message SMTP sink capturing all delivered alert/OTP emails
        let smtp_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let smtp_port = smtp_listener.local_addr().unwrap().port();
        let delivered_mails: Arc<tokio::sync::Mutex<Vec<String>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let sink_store = delivered_mails.clone();
        let smtp_task = tokio::spawn(async move {
            while let Ok((stream, _)) = smtp_listener.accept().await {
                let store = sink_store.clone();
                tokio::spawn(async move {
                    let (r, mut w) = stream.into_split();
                    let mut reader = BufReader::new(r);
                    let _ = w.write_all(b"220 sink.local ESMTP Ready\r\n").await;
                    let mut in_data = false;
                    let mut body_buf = String::new();
                    let mut line = String::new();
                    loop {
                        line.clear();
                        let Ok(n) = reader.read_line(&mut line).await else {
                            break;
                        };
                        if n == 0 {
                            break;
                        }
                        if in_data {
                            if line.trim_end_matches(['\r', '\n']) == "." {
                                in_data = false;
                                store.lock().await.push(std::mem::take(&mut body_buf));
                                let _ = w.write_all(b"250 OK queued\r\n").await;
                            } else {
                                body_buf.push_str(&line);
                            }
                            continue;
                        }
                        let upper = line.to_ascii_uppercase();
                        if upper.starts_with("EHLO ") || upper.starts_with("HELO ") {
                            let _ = w.write_all(b"250-sink.local\r\n250 OK\r\n").await;
                        } else if upper.starts_with("MAIL FROM:") || upper.starts_with("RCPT TO:") {
                            let _ = w.write_all(b"250 OK\r\n").await;
                        } else if upper.starts_with("DATA") {
                            in_data = true;
                            let _ = w.write_all(b"354 End data with <CR><LF>.<CR><LF>\r\n").await;
                        } else if upper.starts_with("QUIT") {
                            let _ = w.write_all(b"221 Bye\r\n").await;
                            break;
                        } else {
                            let _ = w.write_all(b"250 OK\r\n").await;
                        }
                    }
                });
            }
        });

        let content_dir = resolve_content_dir(None);
        let tmp_root = env::temp_dir().join(format!("icehandnote-risk-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tmp_root).unwrap();
        let store_path = tmp_root.join("store.json");
        let uploads_dir = tmp_root.join("uploads");
        let secrets_path = tmp_root.join("secrets.json");

        let repo =
            LocalSeedRepository::from_content_dir_with_options(&content_dir, store_path.clone(), false)
                .unwrap();
        let alice = repo
            .register_local_account(
                "alice_risk",
                "Alice Risk",
                "alice@icehandnote.dev",
                "StrongPass123!",
                UserRole::Reader,
            )
            .await
            .unwrap();
        let legacy_bob = repo
            .register_local_account(
                "bob_legacy",
                "Bob Legacy",
                "bob@icehandnote.dev",
                "StrongPass123!",
                UserRole::Reader,
            )
            .await
            .unwrap();
        // Simulate pre-0010 legacy session in user_sessions with empty user_trusted_devices
        let _bob_legacy_tok = repo
            .create_session_with_meta(legacy_bob.id, "198.51.100.55", "Chrome/135", "Chrome · Windows", "")
            .await
            .unwrap();

        let runtime_secrets = Arc::new(tokio::sync::RwLock::new(RuntimeSecretsConfig::default()));
        let state = AppState {
            repo: Arc::new(DynamicRepository::new(Arc::new(repo))),
            content_dir,
            store_path,
            uploads_dir,
            secrets_path,
            runtime_secrets: runtime_secrets.clone(),
            oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mail_guard: Arc::new(mailer::MailDeliveryGuard::in_memory()),
            bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
            public_origin: None,
            trust_proxy_headers: true,
            guest_cookie_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_sso_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_origin_url: String::new(),
            blog_wp_api_url: None,
            dev_sso_simulator: false,
            default_settings: SiteSettingsDto::default_with_env("zh-CN", ""),
            http_client: reqwest::Client::new(),
        };
        let app = build_router(state, CorsLayer::permissive(), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });
        let base = format!("http://{addr}");
        let client = reqwest::Client::new();

        // Step 1: First login establishes baseline (CF-Connecting-IP + X-Device-Id)
        let first_login: serde_json::Value = client
            .post(format!("{base}/api/v1/auth/login"))
            .header("cf-connecting-ip", "198.51.100.10")
            .header("x-device-id", "dev_pc_alpha")
            .header(header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0) Chrome/136.0")
            .json(&serde_json::json!({
                "identifier": alice.username,
                "password": "StrongPass123!",
                "locale": "zh-CN"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(first_login["requires_otp"], false);
        let pc_token = first_login["session_token"].as_str().unwrap().to_string();

        // Step 2: Same IP via IPv4-mapped IPv6 + same device -> still trusted
        let repeat_login: serde_json::Value = client
            .post(format!("{base}/api/v1/auth/login"))
            .header("x-forwarded-for", "::ffff:198.51.100.10")
            .header("x-device-id", "dev_pc_alpha")
            .header(header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0) Chrome/136.0")
            .json(&serde_json::json!({
                "identifier": alice.username,
                "password": "StrongPass123!"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(repeat_login["requires_otp"], false);

        // Step 3: Anomalous login while SMTP is OFF proceeds without OTP, and MUST NOT trust the unverified device
        let unverified_bypass: serde_json::Value = client
            .post(format!("{base}/api/v1/auth/login"))
            .header("cf-connecting-ip", "203.0.113.77")
            .header("x-device-id", "dev_phone_beta")
            .header(header::USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")
            .json(&serde_json::json!({
                "identifier": alice.username,
                "password": "StrongPass123!"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(unverified_bypass["requires_otp"], false);

        // Step 4: Enable SMTP -> logging in again from Phone + new IP MUST trigger OTP & send email
        {
            let mut sec = runtime_secrets.write().await;
            sec.smtp = SmtpSettingsDto {
                enabled: true,
                host: "127.0.0.1".to_string(),
                port: smtp_port,
                encryption: "none".to_string(),
                username: String::new(),
                from_name: "IceHandnote".to_string(),
                from_email: "noreply@icehandnote.dev".to_string(),
                ..Default::default()
            };
        }

        let phone_challenge: serde_json::Value = client
            .post(format!("{base}/api/v1/auth/login"))
            .header("cf-connecting-ip", "203.0.113.77")
            .header("x-device-id", "dev_phone_beta")
            .header(header::USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")
            .json(&serde_json::json!({
                "identifier": alice.username,
                "password": "StrongPass123!",
                "locale": "zh-CN"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(phone_challenge["requires_otp"], true);
        assert_eq!(phone_challenge["anomaly_reason"], "new_ip_and_device");
        assert_eq!(phone_challenge["ip_address"], "203.0.113.77");
        let chal_id = phone_challenge["challenge_id"].as_str().unwrap().to_string();

        // Confirm SMTP sink received the anomaly OTP email and extract 6-digit OTP
        let mail_raw = {
            let mails = delivered_mails.lock().await;
            assert_eq!(mails.len(), 1);
            mails[0].clone()
        };
        let unfolded = mail_raw.replace("=\r\n", "").replace("=\n", "");
        let otp_code = unfolded
            .split('>')
            .filter_map(|seg| seg.split('<').next())
            .map(str::trim)
            .find(|tok| tok.len() == 6 && tok.bytes().all(|b| b.is_ascii_digit()))
            .expect("6-digit OTP code in anomaly email")
            .to_string();

        // Step 5: Verify OTP -> issues session and trusts (203.0.113.77, dev_phone_beta)
        let verify_resp = client
            .post(format!("{base}/api/v1/auth/login/verify-otp"))
            .json(&serde_json::json!({
                "challenge_id": chal_id,
                "code": otp_code
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(verify_resp.status(), reqwest::StatusCode::OK);

        // Step 6: Cross-pair login (PC IP + Phone device) MUST still trigger OTP!
        let cross_pair: serde_json::Value = client
            .post(format!("{base}/api/v1/auth/login"))
            .header("cf-connecting-ip", "198.51.100.10")
            .header("x-device-id", "dev_phone_beta")
            .header(header::USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")
            .json(&serde_json::json!({
                "identifier": alice.username,
                "password": "StrongPass123!"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(cross_pair["requires_otp"], true);
        assert_eq!(cross_pair["anomaly_reason"], "new_ip_and_device");
        assert_eq!(delivered_mails.lock().await.len(), 2);

        // Step 7: Revoking other sessions from PC also revokes Phone's trust -> Phone triggers OTP again!
        let revoke_resp = client
            .post(format!("{base}/api/v1/auth/sessions/revoke-others"))
            .bearer_auth(&pc_token)
            .send()
            .await
            .unwrap();
        assert_eq!(revoke_resp.status(), reqwest::StatusCode::OK);

        let after_revoke: serde_json::Value = client
            .post(format!("{base}/api/v1/auth/login"))
            .header("cf-connecting-ip", "203.0.113.77")
            .header("x-device-id", "dev_phone_beta")
            .header(header::USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")
            .json(&serde_json::json!({
                "identifier": alice.username,
                "password": "StrongPass123!"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(after_revoke["requires_otp"], true);
        assert_eq!(delivered_mails.lock().await.len(), 3);

        // Step 8: Cold-start fallback for legacy user (only user_sessions, empty user_trusted_devices)
        // using RFC 7239 Forwarded header
        let legacy_anomaly: serde_json::Value = client
            .post(format!("{base}/api/v1/auth/login"))
            .header(header::FORWARDED, r#"for="203.0.113.88:5555";proto=https"#)
            .header("x-device-id", "dev_new_tablet")
            .header(header::USER_AGENT, "Mozilla/5.0 (iPad; CPU OS 18_0) Safari/604.1")
            .json(&serde_json::json!({
                "identifier": legacy_bob.username,
                "password": "StrongPass123!"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(legacy_anomaly["requires_otp"], true);
        assert_eq!(legacy_anomaly["anomaly_reason"], "new_ip_and_device");
        assert_eq!(legacy_anomaly["ip_address"], "203.0.113.88");
        assert_eq!(delivered_mails.lock().await.len(), 4);

        server_task.abort();
        smtp_task.abort();
        let _ = std::fs::remove_dir_all(tmp_root);
    }

    #[tokio::test]
    async fn collaboration_diff_sse_events_presence_and_bola_acl_end_to_end() {
        let content_dir = resolve_content_dir(None);
        let tmp_root = env::temp_dir().join(format!("icehandnote-sse-diff-{}", Uuid::new_v4()));
        let tmp_content = tmp_root.join("content");
        std::fs::create_dir_all(&tmp_content).unwrap();
        let store_path = tmp_root.join("store.json");
        let uploads_dir = tmp_root.join("uploads");
        let secrets_path = tmp_root.join("secrets.json");

        // Copy minimal seeded content into isolated tmp_content so step saves don't pollute workspace
        let seed_track_dir = content_dir.join("getting-started").join("01-welcome");
        let tmp_step_dir = tmp_content.join("getting-started").join("01-welcome");
        std::fs::create_dir_all(&tmp_step_dir).unwrap();
        std::fs::copy(
            content_dir.join("getting-started").join("track.toml"),
            tmp_content.join("getting-started").join("track.toml"),
        )
        .unwrap();
        std::fs::copy(
            seed_track_dir.join("01-welcome-to-icehandnote.zh-CN.md"),
            tmp_step_dir.join("01-welcome-to-icehandnote.zh-CN.md"),
        )
        .unwrap();

        let repo =
            LocalSeedRepository::from_content_dir_with_options(&tmp_content, store_path.clone(), false)
                .unwrap();
        let owner = repo
            .register_local_account(
                "sse_owner",
                "Owner Author",
                "owner@icehandnote.dev",
                "StrongPass123!",
                UserRole::Author,
            )
            .await
            .unwrap();
        let collab = repo
            .register_local_account(
                "sse_collab",
                "Collab Editor",
                "collab@icehandnote.dev",
                "StrongPass123!",
                UserRole::Author,
            )
            .await
            .unwrap();
        let outsider = repo
            .register_local_account(
                "sse_outsider",
                "Outsider Author",
                "outsider@icehandnote.dev",
                "StrongPass123!",
                UserRole::Author,
            )
            .await
            .unwrap();
        let _ = (&owner, &collab, &outsider);

        let state = AppState {
            repo: Arc::new(DynamicRepository::new(Arc::new(repo))),
            content_dir: tmp_content.clone(),
            store_path,
            uploads_dir,
            secrets_path,
            runtime_secrets: Arc::new(tokio::sync::RwLock::new(RuntimeSecretsConfig::default())),
            oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mail_guard: Arc::new(mailer::MailDeliveryGuard::in_memory()),
            bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
            public_origin: None,
            trust_proxy_headers: false,
            guest_cookie_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_sso_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_origin_url: String::new(),
            blog_wp_api_url: None,
            dev_sso_simulator: false,
            default_settings: SiteSettingsDto::default_with_env("zh-CN", ""),
            http_client: reqwest::Client::new(),
        };
        let app = build_router(state, CorsLayer::permissive(), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });

        let client = reqwest::Client::new();
        let base = format!("http://{addr}");

        async fn login_user(client: &reqwest::Client, base: &str, u: &str) -> String {
            let res: serde_json::Value = client
                .post(format!("{base}/api/v1/auth/login"))
                .json(&serde_json::json!({ "identifier": u, "password": "StrongPass123!" }))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            res["session_token"].as_str().unwrap().to_string()
        }

        let owner_tok = login_user(&client, &base, "sse_owner").await;
        let collab_tok = login_user(&client, &base, "sse_collab").await;
        let outsider_tok = login_user(&client, &base, "sse_outsider").await;

        // 1. Owner creates a brand new collaborative article and saves v1 & v2
        let save_v1 = client
            .post(format!("{base}/api/v1/studio/steps"))
            .bearer_auth(&owner_tok)
            .header("x-client-tab-id", "tab_owner")
            .json(&serde_json::json!({
                "track_slug": "getting-started",
                "chapter_slug": "01-welcome",
                "step_slug": "09-sse-collab-test",
                "locale": "zh-CN",
                "step_number": 9,
                "estimated_minutes": 3,
                "status": "draft",
                "title": "SSE Collab Article",
                "summary": "Initial",
                "author": "Owner Author",
                "license": "cc-by-sa-4.0",
                "tags": [],
                "body_markdown": "## Section A {#sec-a}\n\nLine one\nLine two",
                "write_to_content_dir": true
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(save_v1.status(), reqwest::StatusCode::OK);
        let v1_json: serde_json::Value = save_v1.json().await.unwrap();
        let etag1 = v1_json["etag"].as_str().unwrap().to_string();

        // Owner invites collab_editor
        let inv_res: serde_json::Value = client
            .post(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/invites"
            ))
            .bearer_auth(&owner_tok)
            .json(&serde_json::json!({
                "email": "collab@icehandnote.dev",
                "role": "editor",
                "locale_scope": []
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let inv_url = inv_res["invite_url"].as_str().unwrap();
        let token = inv_url.split("#token=").nth(1).unwrap();
        let acc = client
            .post(format!("{base}/api/v1/studio/invites/accept"))
            .bearer_auth(&collab_tok)
            .json(&serde_json::json!({ "token": token }))
            .send()
            .await
            .unwrap();
        assert_eq!(acc.status(), reqwest::StatusCode::OK);

        // 2. Outsider BOLA ACL checks: SSE /events, PUT /presence, GET /revisions/{id}/diff MUST return 403
        let outsider_sse = client
            .get(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/events"
            ))
            .bearer_auth(&outsider_tok)
            .send()
            .await
            .unwrap();
        assert_eq!(outsider_sse.status(), reqwest::StatusCode::FORBIDDEN);

        let outsider_presence = client
            .put(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/presence"
            ))
            .bearer_auth(&outsider_tok)
            .json(&serde_json::json!({ "locale": "zh-CN", "state": "editing", "tab_id": "bad" }))
            .send()
            .await
            .unwrap();
        assert_eq!(outsider_presence.status(), reqwest::StatusCode::FORBIDDEN);

        // 3. Collaborator opens SSE stream with Bearer header (RFC 9700 §4.3.2 compliant)
        let mut sse_resp = client
            .get(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/events"
            ))
            .bearer_auth(&collab_tok)
            .send()
            .await
            .unwrap();
        assert_eq!(sse_resp.status(), reqwest::StatusCode::OK);
        let ctype = sse_resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(ctype.contains("text/event-stream"), "ctype={ctype}");

        // Initial presence frame arrives
        let first_chunk = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            sse_resp.chunk(),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();
        let first_text = String::from_utf8_lossy(&first_chunk);
        assert!(first_text.contains("event: presence"), "first_text={first_text}");

        // Collaborator advertises presence + Owner saves v2 -> SSE receives both!
        let put_pres = client
            .put(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/presence"
            ))
            .bearer_auth(&collab_tok)
            .json(&serde_json::json!({
                "locale": "zh-CN",
                "state": "editing",
                "tab_id": "tab_collab"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(put_pres.status(), reqwest::StatusCode::OK);
        let pres_body: serde_json::Value = put_pres.json().await.unwrap();
        assert_eq!(pres_body["members"][0]["username"], "sse_collab");

        let save_v2 = client
            .post(format!("{base}/api/v1/studio/steps"))
            .bearer_auth(&owner_tok)
            .header(header::IF_MATCH, &etag1)
            .header("x-client-tab-id", "tab_owner")
            .json(&serde_json::json!({
                "track_slug": "getting-started",
                "chapter_slug": "01-welcome",
                "step_slug": "09-sse-collab-test",
                "locale": "zh-CN",
                "step_number": 9,
                "estimated_minutes": 3,
                "status": "draft",
                "title": "SSE Collab Article",
                "summary": "Initial",
                "author": "Owner Author",
                "license": "cc-by-sa-4.0",
                "tags": [],
                "body_markdown": "## Section A {#sec-a}\n\nLine one updated\nLine two\nLine three",
                "write_to_content_dir": true
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(save_v2.status(), reqwest::StatusCode::OK);

        let mut collected = String::new();
        for _ in 0..8 {
            if let Ok(Ok(Some(chunk))) = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                sse_resp.chunk(),
            )
            .await
            {
                collected.push_str(&String::from_utf8_lossy(&chunk));
                if collected.contains("event: revision_saved") && collected.contains("tab_owner") {
                    break;
                }
            } else {
                break;
            }
        }
        assert!(
            collected.contains("event: revision_saved") && collected.contains("tab_owner"),
            "collected={collected}"
        );

        // 4. Last-Event-ID=1 replays event id > 1 immediately on reconnect!
        let mut replay_resp = client
            .get(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/events"
            ))
            .bearer_auth(&collab_tok)
            .header("last-event-id", "1")
            .send()
            .await
            .unwrap();
        assert_eq!(replay_resp.status(), reqwest::StatusCode::OK);
        let mut replay_text = String::new();
        for _ in 0..6 {
            if let Ok(Ok(Some(chunk))) = tokio::time::timeout(
                std::time::Duration::from_secs(1),
                replay_resp.chunk(),
            )
            .await
            {
                replay_text.push_str(&String::from_utf8_lossy(&chunk));
                if replay_text.contains("event: revision_saved") {
                    break;
                }
            } else {
                break;
            }
        }
        assert!(replay_text.contains("event: revision_saved"), "replay={replay_text}");

        // 5. Diff API returns structured line diff and enforces outsider 403
        let revs: Vec<serde_json::Value> = client
            .get(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/zh-CN/revisions"
            ))
            .bearer_auth(&collab_tok)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(revs.len(), 2);
        let latest_id = revs[0]["id"].as_str().unwrap();

        let outsider_diff = client
            .get(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/zh-CN/revisions/{latest_id}/diff"
            ))
            .bearer_auth(&outsider_tok)
            .send()
            .await
            .unwrap();
        assert_eq!(outsider_diff.status(), reqwest::StatusCode::FORBIDDEN);

        let diff_json: serde_json::Value = client
            .get(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/zh-CN/revisions/{latest_id}/diff"
            ))
            .bearer_auth(&collab_tok)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(diff_json["base_edit_seq"], 1);
        assert_eq!(diff_json["target_edit_seq"], 2);
        assert_eq!(diff_json["additions"], 2);
        assert_eq!(diff_json["deletions"], 1);

        // 6. Leave presence clears tab cleanly
        let del_pres = client
            .delete(format!(
                "{base}/api/v1/studio/steps/getting-started/01-welcome/09-sse-collab-test/presence?tab_id=tab_collab"
            ))
            .bearer_auth(&collab_tok)
            .send()
            .await
            .unwrap();
        assert_eq!(del_pres.status(), reqwest::StatusCode::OK);
        let del_body: serde_json::Value = del_pres.json().await.unwrap();
        assert_eq!(del_body["members"].as_array().unwrap().len(), 0);

        server_task.abort();
        let _ = std::fs::remove_dir_all(tmp_root);
    }

    #[tokio::test]
    async fn hardened_security_headers_bind_ticket_sso_replay_svg_rbac_and_feature_toggles() {
        let tmp_root = env::temp_dir().join(format!("icehandnote-sec-int-{}", Uuid::new_v4()));
        let tmp_content = tmp_root.join("content");
        let seed_track_dir = resolve_content_dir(None)
            .join("getting-started")
            .join("01-welcome");
        let tmp_step_dir = tmp_content.join("getting-started").join("01-welcome");
        std::fs::create_dir_all(&tmp_step_dir).unwrap();
        std::fs::copy(
            resolve_content_dir(None)
                .join("getting-started")
                .join("track.toml"),
            tmp_content.join("getting-started").join("track.toml"),
        )
        .unwrap();
        std::fs::copy(
            seed_track_dir.join("01-welcome-to-icehandnote.zh-CN.md"),
            tmp_step_dir.join("01-welcome-to-icehandnote.zh-CN.md"),
        )
        .unwrap();

        let store_path = tmp_root.join("store.json");
        let uploads_dir = tmp_root.join("uploads");
        let secrets_path = tmp_root.join("secrets.json");

        let repo =
            LocalSeedRepository::from_content_dir_with_options(&tmp_content, store_path.clone(), false)
                .unwrap();
        let admin = repo
            .admin_create_user(
                "sec_admin",
                "Security Admin",
                "sec-admin@icehandnote.dev",
                UserRole::Admin,
                "StrongPass123!",
            )
            .await
            .unwrap();
        let _author = repo
            .register_local_account(
                "sec_author",
                "Security Author",
                "sec-author@icehandnote.dev",
                "StrongPass123!",
                UserRole::Author,
            )
            .await
            .unwrap();

        let mut custom_settings = SiteSettingsDto::default_with_env("zh-CN", "");
        custom_settings.sso_enabled = true;
        custom_settings.oauth_enabled = true;
        custom_settings.oauth_providers = vec![icehandnote_core::settings::OAuthProviderDto {
            id: "github".to_string(),
            enabled: true,
            name: "GitHub".to_string(),
            client_id: "cid".to_string(),
            authorize_url: "https://github.com/login/oauth/authorize".to_string(),
            token_url: "https://github.com/login/oauth/access_token".to_string(),
            userinfo_url: "https://api.github.com/user".to_string(),
            scopes: "read:user".to_string(),
        }];
        custom_settings.enable_likes = false;
        custom_settings.enable_margin_notes = false;
        custom_settings.enable_progress_tracking = false;
        custom_settings.enable_passkeys = false;
        repo.update_site_settings(admin.id, custom_settings.clone())
            .await
            .unwrap();

        let sso_secret = "0123456789abcdef0123456789abcdef".to_string();
        let state = AppState {
            repo: Arc::new(DynamicRepository::new(Arc::new(repo))),
            content_dir: tmp_content,
            store_path,
            uploads_dir,
            secrets_path,
            runtime_secrets: Arc::new(tokio::sync::RwLock::new(RuntimeSecretsConfig::default())),
            oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mail_guard: Arc::new(mailer::MailDeliveryGuard::in_memory()),
            bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
            public_origin: None,
            trust_proxy_headers: false,
            guest_cookie_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_sso_secret: sso_secret.clone(),
            blog_origin_url: String::new(),
            blog_wp_api_url: None,
            dev_sso_simulator: false,
            default_settings: custom_settings,
            http_client: reqwest::Client::new(),
        };

        let app = build_router(state, CorsLayer::permissive(), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let base = format!("http://{addr}");

        // 1. Security response headers
        let health = client.get(format!("{base}/api/v1/health")).send().await.unwrap();
        assert_eq!(health.status(), reqwest::StatusCode::OK);
        let csp = health
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(csp.contains("frame-ancestors 'none'"), "csp={csp}");
        assert_eq!(
            health
                .headers()
                .get("x-frame-options")
                .and_then(|v| v.to_str().ok()),
            Some("DENY")
        );
        assert_eq!(
            health
                .headers()
                .get("x-content-type-options")
                .and_then(|v| v.to_str().ok()),
            Some("nosniff")
        );

        async fn sign_in(client: &reqwest::Client, base: &str, u: &str) -> String {
            let res: serde_json::Value = client
                .post(format!("{base}/api/v1/auth/login"))
                .json(&serde_json::json!({ "identifier": u, "password": "StrongPass123!" }))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            res["session_token"].as_str().unwrap().to_string()
        }
        let admin_tok = sign_in(&client, &base, "sec_admin").await;
        let author_tok = sign_in(&client, &base, "sec_author").await;

        // 2. Disabled feature toggles return 403 Forbidden
        let dummy_step = Uuid::new_v4();
        let like_res = client
            .post(format!("{base}/api/v1/steps/{dummy_step}/like"))
            .send()
            .await
            .unwrap();
        assert_eq!(like_res.status(), reqwest::StatusCode::FORBIDDEN);

        let note_res = client
            .post(format!("{base}/api/v1/me/notes"))
            .bearer_auth(&author_tok)
            .json(&serde_json::json!({
                "step_id": dummy_step,
                "locale_code": "zh-CN",
                "block_anchor_id": "p-1",
                "content": "note"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(note_res.status(), reqwest::StatusCode::FORBIDDEN);

        let prog_res = client
            .post(format!("{base}/api/v1/me/progress"))
            .bearer_auth(&author_tok)
            .json(&serde_json::json!({
                "step_id": dummy_step,
                "completed": true
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(prog_res.status(), reqwest::StatusCode::FORBIDDEN);

        let pk_res = client
            .post(format!("{base}/api/v1/auth/passkeys/register/options"))
            .bearer_auth(&author_tok)
            .json(&serde_json::json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(pk_res.status(), reqwest::StatusCode::FORBIDDEN);

        // 3. Single-use OAuth bind ticket
        let bt_resp = client
            .post(format!("{base}/api/v1/auth/oauth/bind-ticket"))
            .bearer_auth(&author_tok)
            .send()
            .await
            .unwrap();
        assert_eq!(bt_resp.status(), reqwest::StatusCode::OK);
        assert_eq!(
            bt_resp
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok()),
            Some("no-store")
        );
        let bt_json: serde_json::Value = bt_resp.json().await.unwrap();
        let bt = bt_json["bind_ticket"].as_str().unwrap();

        let auth_first = client
            .get(format!(
                "{base}/api/v1/auth/oauth/authorize?provider=github&bind_ticket={bt}"
            ))
            .send()
            .await
            .unwrap();
        assert!(auth_first.status().is_redirection(), "status={}", auth_first.status());

        let auth_replay = client
            .get(format!(
                "{base}/api/v1/auth/oauth/authorize?provider=github&bind_ticket={bt}"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(auth_replay.status(), reqwest::StatusCode::UNAUTHORIZED);

        // 4. SSO jti replay protection
        let now = chrono::Utc::now().timestamp();
        let claims = icehandnote_core::auth::BlogSsoClaims {
            wp_user_id: 99,
            username: "sso_replay_user".to_string(),
            display_name: "SSO Replay".to_string(),
            email: "sso-replay@example.com".to_string(),
            avatar_url: String::new(),
            wp_roles: vec!["subscriber".to_string()],
            blog_origin: "https://blog.example.com".to_string(),
            jti: "replay-jti-001".to_string(),
            iat: now,
            exp: now + 120,
        };
        let sso_tok = icehandnote_core::auth::sign_blog_sso_token(&claims, &sso_secret).unwrap();

        let sso_first = client
            .post(format!("{base}/api/v1/auth/sso/verify"))
            .json(&serde_json::json!({ "sso_token": sso_tok }))
            .send()
            .await
            .unwrap();
        assert_eq!(sso_first.status(), reqwest::StatusCode::OK);

        let sso_replay = client
            .post(format!("{base}/api/v1/auth/sso/verify"))
            .json(&serde_json::json!({ "sso_token": sso_tok }))
            .send()
            .await
            .unwrap();
        assert_eq!(sso_replay.status(), reqwest::StatusCode::UNAUTHORIZED);

        // 5. Non-admin .svg upload forbidden (403); admin allowed (201)
        let svg_body = concat!(
            "--ihnbound\r\n",
            "Content-Disposition: form-data; name=\"file\"; filename=\"icon.svg\"\r\n",
            "Content-Type: image/svg+xml\r\n\r\n",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><rect width=\"16\" height=\"16\"/></svg>\r\n",
            "--ihnbound--\r\n"
        );
        let author_svg = client
            .post(format!("{base}/api/v1/studio/uploads"))
            .bearer_auth(&author_tok)
            .header(header::CONTENT_TYPE, "multipart/form-data; boundary=ihnbound")
            .body(svg_body)
            .send()
            .await
            .unwrap();
        assert_eq!(author_svg.status(), reqwest::StatusCode::FORBIDDEN);

        let admin_svg = client
            .post(format!("{base}/api/v1/studio/uploads"))
            .bearer_auth(&admin_tok)
            .header(header::CONTENT_TYPE, "multipart/form-data; boundary=ihnbound")
            .body(svg_body)
            .send()
            .await
            .unwrap();
        assert_eq!(admin_svg.status(), reqwest::StatusCode::CREATED);

        server_task.abort();
        let _ = std::fs::remove_dir_all(tmp_root);
    }

    #[tokio::test]
    async fn admin_mail_provider_mutual_exclusivity_guard_routes_and_concurrent_forgot_password_dedup()
    {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let tmp_root = env::temp_dir().join(format!("icehandnote-mail-api-{}", Uuid::new_v4()));
        let tmp_content = tmp_root.join("content");
        let uploads_dir = tmp_root.join("uploads");
        std::fs::create_dir_all(&tmp_content).unwrap();
        std::fs::create_dir_all(&uploads_dir).unwrap();
        let store_path = tmp_root.join("store.json");
        let secrets_path = tmp_root.join("secrets.json");

        let repo = LocalSeedRepository::from_content_dir_with_options(
            &tmp_content,
            store_path.clone(),
            false,
        )
        .unwrap();
        let _admin = repo
            .admin_create_user(
                "mail_admin",
                "Mail Admin",
                "mail-admin@icehandnote.dev",
                UserRole::Admin,
                "StrongPass123!",
            )
            .await
            .unwrap();
        let _member = repo
            .register_local_account(
                "mail_member",
                "Mail Member",
                "member@icehandnote.dev",
                "StrongPass123!",
                UserRole::Reader,
            )
            .await
            .unwrap();

        let default_settings = SiteSettingsDto::default_with_env("zh-CN", "");
        let guard = Arc::new(mailer::MailDeliveryGuard::in_memory());
        let state = AppState {
            repo: Arc::new(DynamicRepository::new(Arc::new(repo))),
            content_dir: tmp_content,
            store_path,
            uploads_dir,
            secrets_path,
            runtime_secrets: Arc::new(tokio::sync::RwLock::new(RuntimeSecretsConfig::default())),
            oauth_pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            oauth_onboardings: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            note_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_idempotency: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            invite_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            collab_hub: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mail_guard: guard.clone(),
            bind_tickets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_oauth_binds: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            sso_used_jtis: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            auth_rate_limits: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            update_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
            public_origin: None,
            trust_proxy_headers: false,
            guest_cookie_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_sso_secret: "0123456789abcdef0123456789abcdef".to_string(),
            blog_origin_url: String::new(),
            blog_wp_api_url: None,
            dev_sso_simulator: false,
            default_settings,
            http_client: reqwest::Client::new(),
        };

        let app = build_router(state, CorsLayer::permissive(), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });

        let client = reqwest::Client::new();
        let base = format!("http://{addr}");

        let admin_tok = client
            .post(format!("{base}/api/v1/auth/login"))
            .json(&serde_json::json!({
                "identifier": "mail_admin",
                "password": "StrongPass123!"
            }))
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap()["session_token"]
            .as_str()
            .unwrap()
            .to_string();

        let member_tok = client
            .post(format!("{base}/api/v1/auth/login"))
            .json(&serde_json::json!({
                "identifier": "mail_member",
                "password": "StrongPass123!"
            }))
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap()["session_token"]
            .as_str()
            .unwrap()
            .to_string();

        // 1. Non-admin cannot access mail guard management routes
        let forbidden_reset = client
            .post(format!("{base}/api/v1/admin/smtp/guard/reset-circuit"))
            .bearer_auth(&member_tok)
            .send()
            .await
            .unwrap();
        assert_eq!(forbidden_reset.status(), reqwest::StatusCode::FORBIDDEN);

        let forbidden_clear = client
            .post(format!("{base}/api/v1/admin/smtp/guard/clear-suppression"))
            .bearer_auth(&member_tok)
            .json(&serde_json::json!({ "clear_all": true }))
            .send()
            .await
            .unwrap();
        assert_eq!(forbidden_clear.status(), reqwest::StatusCode::FORBIDDEN);

        // 2. Cloudflare API mode rejects missing Account ID or API Token when enabled
        let mut cf_settings = icehandnote_core::mail_templates::SmtpSettingsDto {
            enabled: true,
            provider: "cloudflare_api".to_string(),
            cloudflare_account_id: "too-short".to_string(),
            from_name: "IceHandnote".to_string(),
            from_email: "noreply@icehandnote.dev".to_string(),
            ..Default::default()
        };
        let bad_acct = client
            .put(format!("{base}/api/v1/admin/smtp"))
            .bearer_auth(&admin_tok)
            .json(&serde_json::json!({
                "settings": cf_settings,
                "cloudflare_api_token": "cf-secret-token-xyz-999"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(bad_acct.status(), reqwest::StatusCode::BAD_REQUEST);

        cf_settings.cloudflare_account_id = "0123456789abcdef0123456789abcdef".to_string();
        let missing_tok = client
            .put(format!("{base}/api/v1/admin/smtp"))
            .bearer_auth(&admin_tok)
            .json(&serde_json::json!({ "settings": cf_settings }))
            .send()
            .await
            .unwrap();
        assert_eq!(missing_tok.status(), reqwest::StatusCode::BAD_REQUEST);

        // 3. Valid Cloudflare API config activates ONLY cloudflare_api and never leaks token
        let cf_secret = "cf-secret-token-xyz-999";
        let ok_cf = client
            .put(format!("{base}/api/v1/admin/smtp"))
            .bearer_auth(&admin_tok)
            .json(&serde_json::json!({
                "settings": cf_settings,
                "cloudflare_api_token": cf_secret
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(ok_cf.status(), reqwest::StatusCode::OK);
        let ok_cf_text = ok_cf.text().await.unwrap();
        assert!(
            !ok_cf_text.contains(cf_secret),
            "Cloudflare API token must never be serialized in HTTP response"
        );
        let ok_cf_json: serde_json::Value = serde_json::from_str(&ok_cf_text).unwrap();
        assert_eq!(ok_cf_json["active_provider"].as_str(), Some("cloudflare_api"));
        assert_eq!(ok_cf_json["has_cloudflare_api_token"].as_bool(), Some(true));

        // 4. Slow local SMTP sink + switching strictly to SMTP (mutual exclusivity)
        let smtp_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let smtp_port = smtp_listener.local_addr().unwrap().port();
        let deliveries = Arc::new(AtomicUsize::new(0));
        let deliveries_bg = deliveries.clone();
        let sink_task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = smtp_listener.accept().await else {
                    break;
                };
                let counter = deliveries_bg.clone();
                tokio::spawn(async move {
                    let (r, mut w) = stream.into_split();
                    let mut reader = BufReader::new(r);
                    let _ = w.write_all(b"220 slow-sink.local ESMTP Ready\r\n").await;
                    let mut in_data = false;
                    let mut line = String::new();
                    loop {
                        line.clear();
                        let Ok(n) = reader.read_line(&mut line).await else {
                            break;
                        };
                        if n == 0 {
                            break;
                        }
                        if in_data {
                            if line.trim_end_matches(['\r', '\n']) == "." {
                                // Simulate 250ms mail server latency jitter
                                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                                counter.fetch_add(1, Ordering::SeqCst);
                                in_data = false;
                                let _ = w.write_all(b"250 OK queued\r\n").await;
                            }
                            continue;
                        }
                        let upper = line.to_ascii_uppercase();
                        if upper.starts_with("EHLO ") || upper.starts_with("HELO ") {
                            let _ = w.write_all(b"250-slow-sink.local\r\n250 OK\r\n").await;
                        } else if upper.starts_with("DATA") {
                            in_data = true;
                            let _ = w.write_all(b"354 End data\r\n").await;
                        } else if upper.starts_with("QUIT") {
                            let _ = w.write_all(b"221 Bye\r\n").await;
                            break;
                        } else {
                            let _ = w.write_all(b"250 OK\r\n").await;
                        }
                    }
                });
            }
        });

        let smtp_settings = icehandnote_core::mail_templates::SmtpSettingsDto {
            enabled: true,
            provider: "smtp".to_string(),
            host: "127.0.0.1".to_string(),
            port: smtp_port,
            encryption: "none".to_string(),
            cloudflare_account_id: cf_settings.cloudflare_account_id.clone(),
            verify_recipient_mx: false,
            from_name: "IceHandnote".to_string(),
            from_email: "noreply@icehandnote.dev".to_string(),
            ..Default::default()
        };
        let ok_smtp = client
            .put(format!("{base}/api/v1/admin/smtp"))
            .bearer_auth(&admin_tok)
            .json(&serde_json::json!({ "settings": smtp_settings }))
            .send()
            .await
            .unwrap();
        assert_eq!(ok_smtp.status(), reqwest::StatusCode::OK);
        let ok_smtp_json: serde_json::Value = ok_smtp.json().await.unwrap();
        assert_eq!(ok_smtp_json["active_provider"].as_str(), Some("smtp"));
        assert_eq!(ok_smtp_json["has_cloudflare_api_token"].as_bool(), Some(true));

        // 5. Concurrent forgot-password requests during slow SMTP latency deliver strictly ONCE
        let req1 = client
            .post(format!("{base}/api/v1/auth/forgot-password"))
            .json(&serde_json::json!({ "email": "member@icehandnote.dev", "locale": "zh-CN" }))
            .send();
        let req2 = client
            .post(format!("{base}/api/v1/auth/forgot-password"))
            .json(&serde_json::json!({ "email": "member@icehandnote.dev", "locale": "zh-CN" }))
            .send();
        let (r1, r2) = tokio::join!(req1, req2);
        let mut statuses = vec![r1.unwrap().status(), r2.unwrap().status()];
        statuses.sort_by_key(|s| s.as_u16());
        assert_eq!(
            statuses,
            vec![
                reqwest::StatusCode::OK,
                reqwest::StatusCode::TOO_MANY_REQUESTS,
            ],
            "concurrent forgot-password under slow mail latency must allow strictly one send"
        );
        assert_eq!(
            deliveries.load(Ordering::SeqCst),
            1,
            "slow SMTP sink must receive strictly 1 email across concurrent requests"
        );

        // 6. Admin guard management endpoints work
        let reset_ok = client
            .post(format!("{base}/api/v1/admin/smtp/guard/reset-circuit"))
            .bearer_auth(&admin_tok)
            .send()
            .await
            .unwrap();
        assert_eq!(reset_ok.status(), reqwest::StatusCode::OK);
        let reset_json: serde_json::Value = reset_ok.json().await.unwrap();
        assert_eq!(reset_json["circuit_open"].as_bool(), Some(false));

        let clear_ok = client
            .post(format!("{base}/api/v1/admin/smtp/guard/clear-suppression"))
            .bearer_auth(&admin_tok)
            .json(&serde_json::json!({ "clear_all": true }))
            .send()
            .await
            .unwrap();
        assert_eq!(clear_ok.status(), reqwest::StatusCode::OK);
        let clear_json: serde_json::Value = clear_ok.json().await.unwrap();
        assert_eq!(clear_json["suppressed_count"].as_u64(), Some(0));

        sink_task.abort();
        server_task.abort();
        let _ = std::fs::remove_dir_all(tmp_root);
    }
}
