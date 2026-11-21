mod error;
mod mailer;
mod routes;
mod state;

use axum::{
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method},
    routing::{any, delete, get, patch, post},
    Router,
};
use error::ApiError;
use icehandnote_core::{
    auth::{SiteSettingsDto, UserRole},
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
    services::{ServeDir, ServeFile},
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
    let email = env::var("ADMIN_EMAIL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| format!("{username}@localhost"));
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
    let initial_secrets = RuntimeSecretsConfig::load_or_default(&secrets_path);

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
        forgot_password_cooldowns: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        blog_sso_secret,
        blog_origin_url,
        blog_wp_api_url,
        dev_sso_simulator,
        default_settings,
        http_client: reqwest::Client::new(),
    };

    let cors = if let Ok(origin) = env::var("CORS_ORIGIN") {
        if let Ok(hv) = origin.parse::<HeaderValue>() {
            CorsLayer::new()
                .allow_origin(hv)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers(Any)
        } else {
            CorsLayer::permissive()
        }
    } else {
        CorsLayer::permissive()
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
            "/api/v1/me/notes/{note_id}",
            delete(routes::public::delete_note_handler),
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
            "/api/v1/auth/oauth/authorize",
            get(routes::auth::oauth_authorize_handler),
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
            "/api/v1/studio/steps/{track}/{chapter}/{step}/collaborators/{user_id}",
            delete(routes::studio::remove_step_collaborator_handler),
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
        let index_file = web_dir.join("index.html");
        router = router.fallback_service(
            ServeDir::new(web_dir).fallback(ServeFile::new(index_file)),
        );
    }

    router
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
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
}
