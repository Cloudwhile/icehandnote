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
        email_change_otps: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        passkey_ceremonies: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
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
        .layer(cors)
        .with_state(state)
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
    if !custom_logo.is_empty() {
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
        mailer::send_user_ban_notice_email(
            &smtp,
            "",
            mailer::MailBrandContext {
                site_name: "IceHandnote",
                logo_url: "",
                origin: "https://notes.test",
                locale: "zh-CN",
            },
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
            .register_local_account(
                "invite_owner",
                "Invite Owner",
                "owner@icehandnote.dev",
                "supersecret123",
                UserRole::Author,
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
            )
            .await
            .unwrap();
        assert_eq!(invite.email, "Collab+Notes@example.com");

        let _ = std::fs::remove_file(store_path);
    }
}
