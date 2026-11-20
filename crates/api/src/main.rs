use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{any, delete, get, patch, post},
    Json, Router,
};
use chrono::Utc;
use icehandnote_core::{
    auth::{
        format_step_markdown_file, sign_blog_sso_token, verify_blog_sso_token, BlogSsoClaims,
        CreateChapterInput, CreateTrackInput, SaveStudioStepInput, SiteSettingsDto, UserProfileDto,
        UserRole,
    },
    compile_notebook_markdown, CreateMarginNoteInput, LocaleInfo, SUPPORTED_LOCALES,
};
use icehandnote_db::{
    content_loader::load_content_directory, LocalSeedRepository, PostgresRepository,
    TutorialRepository,
};
use serde::{Deserialize, Serialize};
use std::{
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

#[derive(Clone)]
struct AppState {
    repo: Arc<dyn TutorialRepository>,
    content_dir: PathBuf,
    blog_sso_secret: String,
    blog_origin_url: String,
    blog_wp_api_url: Option<String>,
    dev_sso_simulator: bool,
    default_settings: SiteSettingsDto,
    http_client: reqwest::Client,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    project: String,
    storage_backend: &'static str,
    blog_origin_url: String,
    default_locale: String,
    locales: Vec<LocaleInfo>,
}

#[derive(Serialize)]
struct UpdateCheckResponse {
    current_version: String,
    latest_version: String,
    channel: &'static str,
    has_update: bool,
    release_url: String,
    published_at: Option<String>,
}

#[derive(Deserialize)]
struct SearchQuery {
    #[serde(default)]
    q: String,
}

#[derive(Deserialize)]
struct LearnerQuery {
    learner_id: String,
}

#[derive(Deserialize)]
struct NotesQuery {
    step_id: Uuid,
    learner_id: String,
}

#[derive(Deserialize)]
struct ToggleProgressBody {
    learner_id: String,
    step_id: Uuid,
    completed: bool,
}

#[derive(Deserialize)]
struct ToggleTaskCheckBody {
    learner_id: String,
    step_id: Uuid,
    task_item_id: String,
    checked: bool,
}

#[derive(Deserialize)]
struct LoginRequest {
    identifier: String,
    password: String,
    #[serde(default)]
    anonymous_learner_id: Option<String>,
}

#[derive(Deserialize)]
struct SsoVerifyRequest {
    sso_token: String,
    #[serde(default)]
    anonymous_learner_id: Option<String>,
}

#[derive(Deserialize)]
struct DevSsoTicketRequest {
    preset: String,
}

#[derive(Serialize)]
struct AuthSessionResponse {
    session_token: String,
    user: UserProfileDto,
    learner_key: String,
}

#[derive(Serialize)]
struct AuthMeResponse {
    authenticated: bool,
    user: Option<UserProfileDto>,
    learner_key: Option<String>,
    dev_sso_enabled: bool,
    blog_sso_entry_url: String,
}

#[derive(Deserialize)]
struct StudioPreviewBody {
    #[serde(default)]
    title: String,
    #[serde(default)]
    summary: String,
    body_markdown: String,
}

#[derive(Deserialize)]
struct UpdateRoleBody {
    role: UserRole,
}

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
        tracing::warn!("CONTENT_DIR={p} 不存在，改用自動偵測的 content 目錄");
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
    let base = env_dir.map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    if let Ok(p) = env::var("LOCAL_STORE_PATH") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let raw = PathBuf::from(trimmed);
            return if raw.is_absolute() { raw } else { base.join(raw) };
        }
    }
    if let Ok(d) = env::var("DATA_DIR") {
        let trimmed = d.trim();
        if !trimmed.is_empty() {
            let raw = PathBuf::from(trimmed);
            let dir = if raw.is_absolute() { raw } else { base.join(raw) };
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

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let auth = headers.get("authorization")?.to_str().ok()?;
    let token = auth.strip_prefix("Bearer ")?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

async fn require_authenticated_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserProfileDto, (StatusCode, String)> {
    let Some(token) = extract_bearer_token(headers) else {
        return Err((StatusCode::UNAUTHORIZED, "请先登录账号".to_string()));
    };
    let user = state
        .repo
        .get_user_by_session(&token)
        .await
        .map_err(internal_err)?;
    match user {
        Some(u) => Ok(u),
        None => Err((
            StatusCode::UNAUTHORIZED,
            "登录状态已过期，请重新登录".to_string(),
        )),
    }
}

async fn require_author_or_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserProfileDto, (StatusCode, String)> {
    let user = require_authenticated_user(state, headers).await?;
    if !user.role.can_author() {
        return Err((StatusCode::FORBIDDEN, "权限不足".to_string()));
    }
    Ok(user)
}

async fn require_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserProfileDto, (StatusCode, String)> {
    let user = require_authenticated_user(state, headers).await?;
    if !user.role.is_admin() {
        return Err((StatusCode::FORBIDDEN, "权限不足".to_string()));
    }
    Ok(user)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load `.env` from the current directory or the nearest parent directory
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
    let default_locale = env::var("DEFAULT_LOCALE")
        .ok()
        .filter(|l| SUPPORTED_LOCALES.iter().any(|(code, _)| code == l))
        .unwrap_or_else(|| "zh-CN".to_string());
    let dev_sso_simulator = env_flag("DEV_SSO_SIMULATOR", false);
    let seed_demo_users = env_flag("SEED_DEMO_USERS", false);

    let repo: Arc<dyn TutorialRepository> = match env::var("DATABASE_URL") {
        Ok(db_url) if !db_url.trim().is_empty() => {
            info!("Connecting to PostgreSQL (seed demo users: {seed_demo_users})...");
            let pg = PostgresRepository::connect_and_migrate(&db_url, seed_demo_users).await?;
            if content_dir.exists() {
                let bundle = load_content_directory(&content_dir)?;
                let count = pg.sync_bundle(&bundle).await?;
                info!("Synced {count} localized step documents into PostgreSQL");
            }
            Arc::new(pg)
        }
        _ => {
            info!(
                "DATABASE_URL not set; booting LocalSeedRepository (content={}, store={})",
                content_dir.display(),
                store_path.display()
            );
            let local = LocalSeedRepository::from_content_dir_with_options(
                &content_dir,
                store_path,
                seed_demo_users,
            )?;
            Arc::new(local)
        }
    };

    bootstrap_initial_admin(&*repo).await?;

    let blog_sso_secret = match env::var("BLOG_SSO_SECRET") {
        Ok(s) if s.len() >= 32 => s,
        Ok(_) => anyhow::bail!("BLOG_SSO_SECRET 長度至少需 32 個字元"),
        Err(_) => {
            if !dev_sso_simulator {
                tracing::warn!(
                    "BLOG_SSO_SECRET 未设置：外部主站跨站单点登录将停用，仅可使用账号密码登录"
                );
            }
            // Random per-process secret: no externally forgeable tickets when unset
            format!("ephemeral-{}-{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
        }
    };
    let blog_origin_url = env::var("BLOG_ORIGIN_URL").unwrap_or_default();
    let blog_wp_api_url = env::var("BLOG_WP_API_URL").ok().filter(|s| !s.trim().is_empty());
    let default_settings = SiteSettingsDto::default_with_env(&default_locale, &blog_origin_url);

    let state = AppState {
        repo,
        content_dir,
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

    info!("❄ IceHandNote API listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn build_router(
    state: AppState,
    cors: CorsLayer,
    web_dist_dir: Option<PathBuf>,
) -> Router {
    let mut router = Router::new()
        .route("/api/v1/health", get(health_handler))
        .route("/api/v1/settings", get(get_site_settings_handler))
        // Public Reader Routes
        .route("/api/v1/{locale}/tracks", get(list_tracks_handler))
        .route(
            "/api/v1/{locale}/tracks/{track}/steps/{chapter}/{step}",
            get(get_step_handler),
        )
        .route("/api/v1/{locale}/search", get(search_handler))
        .route(
            "/api/v1/me/progress",
            get(get_progress_handler).post(toggle_progress_handler),
        )
        .route(
            "/api/v1/me/task-checks",
            get(get_task_checks_handler).post(toggle_task_check_handler),
        )
        .route("/api/v1/steps/{step_id}/like", post(like_step_handler))
        .route(
            "/api/v1/me/notes",
            get(list_notes_handler).post(create_note_handler),
        )
        .route("/api/v1/me/notes/{note_id}", delete(delete_note_handler))
        // Auth & External SSO Bridge Routes
        .route("/api/v1/auth/me", get(auth_me_handler))
        .route("/api/v1/auth/login", post(auth_login_handler))
        .route("/api/v1/auth/sso/verify", post(auth_sso_verify_handler))
        .route("/api/v1/auth/dev-sso-ticket", post(auth_dev_sso_ticket_handler))
        .route("/api/v1/auth/logout", post(auth_logout_handler))
        // Studio Authoring Routes (Author + Admin)
        .route("/api/v1/studio/{locale}/overview", get(studio_overview_handler))
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}/{locale}",
            get(studio_get_step_handler),
        )
        .route("/api/v1/studio/steps", post(studio_save_step_handler))
        .route(
            "/api/v1/studio/steps/{track}/{chapter}/{step}",
            delete(studio_delete_step_handler),
        )
        .route("/api/v1/studio/tracks", post(studio_create_track_handler))
        .route("/api/v1/studio/chapters", post(studio_create_chapter_handler))
        .route("/api/v1/studio/preview", post(studio_preview_handler))
        .route("/api/v1/studio/update-check", get(studio_update_check_handler))
        // Admin Governance Routes (Admin only)
        .route("/api/v1/admin/settings", patch(admin_update_settings_handler))
        .route("/api/v1/admin/users", get(admin_list_users_handler))
        .route(
            "/api/v1/admin/users/{user_id}/role",
            patch(admin_update_role_handler),
        )
        .route("/api/v1/admin/reload", post(reload_content_handler))
        .route(
            "/api/{*rest}",
            any(|| async { (StatusCode::NOT_FOUND, "API endpoint not found") }),
        );

    if let Some(web_dir) = web_dist_dir {
        let index_file = web_dir.join("index.html");
        router = router.fallback_service(
            ServeDir::new(web_dir).not_found_service(ServeFile::new(index_file)),
        );
    }

    router
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let locales = SUPPORTED_LOCALES
        .iter()
        .map(|(code, name)| LocaleInfo {
            code: (*code).to_string(),
            display_name: (*name).to_string(),
        })
        .collect();

    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        project: settings.site_name,
        storage_backend: state.repo.backend_kind(),
        blog_origin_url: settings.blog_origin_url,
        default_locale: settings.default_locale,
        locales,
    })
}

async fn get_site_settings_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(internal_err)?;
    Ok(Json(settings))
}

async fn admin_update_settings_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SiteSettingsDto>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let admin = require_admin(&state, &headers).await?;
    let clean = body
        .sanitize()
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let saved = state
        .repo
        .update_site_settings(admin.id, clean)
        .await
        .map_err(internal_err)?;
    Ok(Json(saved))
}

// ============================================================================
// Auth & External SSO Bridge Handlers
// ============================================================================

async fn auth_me_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let user = if let Some(token) = extract_bearer_token(&headers) {
        state
            .repo
            .get_user_by_session(&token)
            .await
            .map_err(internal_err)?
    } else {
        None
    };

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let learner_key = user.as_ref().map(|u| format!("user:{}", u.id));
    let origin = if settings.blog_origin_url.is_empty() {
        state.blog_origin_url.as_str()
    } else {
        settings.blog_origin_url.as_str()
    };
    let sso_param = if settings.sso_query_param.trim().is_empty() {
        "sso_login"
    } else {
        settings.sso_query_param.trim()
    };
    let blog_sso_entry_url = if origin.trim().is_empty() {
        String::new()
    } else {
        format!("{}/?{}=1", origin.trim().trim_end_matches('/'), sso_param)
    };

    Ok(Json(AuthMeResponse {
        authenticated: user.is_some(),
        user,
        learner_key,
        dev_sso_enabled: state.dev_sso_simulator,
        blog_sso_entry_url,
    }))
}

/// Optional live WordPress REST API credential verification when `BLOG_WP_API_URL` is configured
async fn try_wordpress_remote_login(
    state: &AppState,
    identifier: &str,
    password: &str,
) -> Option<BlogSsoClaims> {
    let wp_base = state.blog_wp_api_url.as_ref()?.trim_end_matches('/');
    let endpoint = format!("{wp_base}/wp-json/wp/v2/users/me?context=edit");
    let resp = state
        .http_client
        .get(&endpoint)
        .basic_auth(identifier, Some(password))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let val: serde_json::Value = resp.json().await.ok()?;
    let wp_user_id = val.get("id")?.as_i64()?;
    let username = val.get("slug").and_then(|v| v.as_str())?.to_string();
    let display_name = val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&username)
        .to_string();
    let email = val
        .get("email")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let avatar_url = val
        .get("avatar_urls")
        .and_then(|a| a.get("96"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let wp_roles: Vec<String> = val
        .get("roles")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let now = Utc::now().timestamp();
    Some(BlogSsoClaims {
        wp_user_id,
        username,
        display_name,
        email,
        avatar_url,
        wp_roles,
        blog_origin: state.blog_origin_url.clone(),
        iat: now,
        exp: now + 300,
    })
}

async fn finalize_login_session(
    state: &AppState,
    user: UserProfileDto,
    anon_learner_id: Option<&str>,
) -> Result<AuthSessionResponse, (StatusCode, String)> {
    let learner_key = format!("user:{}", user.id);
    if let Some(anon_id) = anon_learner_id {
        state
            .repo
            .merge_anonymous_learner(anon_id, &learner_key)
            .await
            .map_err(internal_err)?;
    }
    let session_token = state
        .repo
        .create_session(user.id)
        .await
        .map_err(internal_err)?;
    Ok(AuthSessionResponse {
        session_token,
        user,
        learner_key,
    })
}

async fn auth_login_handler(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // 1. Check synced/local users first
    if let Some(user) = state
        .repo
        .authenticate_password(&body.identifier, &body.password)
        .await
        .map_err(internal_err)?
    {
        let session = finalize_login_session(&state, user, body.anonymous_learner_id.as_deref()).await?;
        return Ok(Json(session));
    }

    // 2. If BLOG_WP_API_URL is set, bridge directly against WordPress REST API
    if let Some(claims) = try_wordpress_remote_login(&state, &body.identifier, &body.password).await {
        let user = state
            .repo
            .upsert_blog_user(&claims)
            .await
            .map_err(internal_err)?;
        let session = finalize_login_session(&state, user, body.anonymous_learner_id.as_deref()).await?;
        return Ok(Json(session));
    }

    Err((
        StatusCode::UNAUTHORIZED,
        "账号或密码不正确，请检查后重试".to_string(),
    ))
}

async fn auth_sso_verify_handler(
    State(state): State<AppState>,
    Json(body): Json<SsoVerifyRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let claims = verify_blog_sso_token(&body.sso_token, &state.blog_sso_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("SSO 签名验证失败：{e}")))?;

    let user = state
        .repo
        .upsert_blog_user(&claims)
        .await
        .map_err(internal_err)?;
    let session = finalize_login_session(&state, user, body.anonymous_learner_id.as_deref()).await?;
    Ok(Json(session))
}

async fn auth_dev_sso_ticket_handler(
    State(state): State<AppState>,
    Json(body): Json<DevSsoTicketRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if !state.dev_sso_simulator {
        return Err((StatusCode::FORBIDDEN, "Dev SSO simulator is disabled".to_string()));
    }
    let now = Utc::now().timestamp();
    let claims = match body.preset.as_str() {
        "admin" | "sylvia" => BlogSsoClaims {
            wp_user_id: 1,
            username: "admin".to_string(),
            display_name: "Admin".to_string(),
            email: "admin@example.com".to_string(),
            avatar_url: String::new(),
            wp_roles: vec!["administrator".to_string()],
            blog_origin: state.blog_origin_url.clone(),
            iat: now,
            exp: now + 300,
        },
        "author" => BlogSsoClaims {
            wp_user_id: 12,
            username: "demo_author".to_string(),
            display_name: "Author".to_string(),
            email: "author@example.com".to_string(),
            avatar_url: String::new(),
            wp_roles: vec!["author".to_string()],
            blog_origin: state.blog_origin_url.clone(),
            iat: now,
            exp: now + 300,
        },
        _ => BlogSsoClaims {
            wp_user_id: 108,
            username: "demo_reader".to_string(),
            display_name: "Reader".to_string(),
            email: "reader@example.com".to_string(),
            avatar_url: String::new(),
            wp_roles: vec!["subscriber".to_string()],
            blog_origin: state.blog_origin_url.clone(),
            iat: now,
            exp: now + 300,
        },
    };

    let sso_token = sign_blog_sso_token(&claims, &state.blog_sso_secret).map_err(internal_err)?;
    Ok(Json(serde_json::json!({ "sso_token": sso_token })))
}

async fn auth_logout_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if let Some(token) = extract_bearer_token(&headers) {
        state.repo.delete_session(&token).await.map_err(internal_err)?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ============================================================================
// Studio Authoring & Admin Handlers
// ============================================================================

async fn studio_overview_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(locale): AxumPath<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _author = require_author_or_admin(&state, &headers).await?;
    let tracks = state
        .repo
        .studio_list_tracks(&locale)
        .await
        .map_err(internal_err)?;
    Ok(Json(tracks))
}

async fn studio_get_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step, locale)): AxumPath<(String, String, String, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _author = require_author_or_admin(&state, &headers).await?;
    let dto = state
        .repo
        .studio_get_step_editor(&track, &chapter, &step, &locale)
        .await
        .map_err(internal_err)?;
    Ok(Json(dto))
}

async fn studio_save_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SaveStudioStepInput>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let author = require_author_or_admin(&state, &headers).await?;
    if input.title.trim().is_empty() || input.step_slug.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "標題與步驟 Slug 不可為空".to_string()));
    }
    let saved = state
        .repo
        .studio_save_step(&author, input, &state.content_dir)
        .await
        .map_err(internal_err)?;
    Ok(Json(saved))
}

async fn studio_delete_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _author = require_author_or_admin(&state, &headers).await?;
    let deleted = state
        .repo
        .studio_delete_step(&track, &chapter, &step, &state.content_dir)
        .await
        .map_err(internal_err)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

async fn studio_create_track_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateTrackInput>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _author = require_author_or_admin(&state, &headers).await?;
    let created = state
        .repo
        .studio_create_track(input, &state.content_dir)
        .await
        .map_err(internal_err)?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn studio_create_chapter_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateChapterInput>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _author = require_author_or_admin(&state, &headers).await?;
    state
        .repo
        .studio_create_chapter(input, &state.content_dir)
        .await
        .map_err(internal_err)?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({ "ok": true }))))
}

async fn studio_preview_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<StudioPreviewBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _author = require_author_or_admin(&state, &headers).await?;
    let formatted = format_step_markdown_file(
        &body.title,
        &body.summary,
        1,
        10,
        1,
        1,
        "draft",
        "",
        &[],
        &body.body_markdown,
    );
    let compiled = compile_notebook_markdown(&formatted);
    Ok(Json(compiled))
}

async fn admin_list_users_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _admin = require_admin(&state, &headers).await?;
    let users = state.repo.admin_list_users().await.map_err(internal_err)?;
    Ok(Json(users))
}

async fn admin_update_role_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<Uuid>,
    Json(body): Json<UpdateRoleBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let admin = require_admin(&state, &headers).await?;
    if admin.id == user_id && !body.role.is_admin() {
        return Err((
            StatusCode::BAD_REQUEST,
            "無法降級當前登入中的管理員自身權限".to_string(),
        ));
    }
    let updated = state
        .repo
        .admin_update_user_role(user_id, body.role)
        .await
        .map_err(internal_err)?;
    match updated {
        Some(u) => Ok(Json(u)),
        None => Err((StatusCode::NOT_FOUND, "找不到指定用戶".to_string())),
    }
}

// ============================================================================
// Public Reader Handlers
// ============================================================================

async fn list_tracks_handler(
    State(state): State<AppState>,
    AxumPath(locale): AxumPath<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let tracks = state
        .repo
        .list_tracks(&locale)
        .await
        .map_err(internal_err)?;
    Ok(Json(tracks))
}

async fn get_step_handler(
    State(state): State<AppState>,
    AxumPath((locale, track, chapter, step)): AxumPath<(String, String, String, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let detail = state
        .repo
        .get_step_detail(&locale, &track, &chapter, &step)
        .await
        .map_err(internal_err)?;

    match detail {
        Some(dto) => Ok(Json(dto)),
        None => Err((StatusCode::NOT_FOUND, "Tutorial step not found".to_string())),
    }
}

async fn search_handler(
    State(state): State<AppState>,
    AxumPath(locale): AxumPath<String>,
    Query(q): Query<SearchQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let hits = state
        .repo
        .search(&locale, &q.q)
        .await
        .map_err(internal_err)?;
    Ok(Json(hits))
}

async fn get_progress_handler(
    State(state): State<AppState>,
    Query(q): Query<LearnerQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let dto = state
        .repo
        .get_progress(&q.learner_id)
        .await
        .map_err(internal_err)?;
    Ok(Json(dto))
}

async fn toggle_progress_handler(
    State(state): State<AppState>,
    Json(body): Json<ToggleProgressBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let dto = state
        .repo
        .toggle_step_complete(&body.learner_id, body.step_id, body.completed)
        .await
        .map_err(internal_err)?;
    Ok(Json(dto))
}

async fn get_task_checks_handler(
    State(state): State<AppState>,
    Query(q): Query<NotesQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let dto = state
        .repo
        .get_task_checks(&q.learner_id, q.step_id)
        .await
        .map_err(internal_err)?;
    Ok(Json(dto))
}

async fn toggle_task_check_handler(
    State(state): State<AppState>,
    Json(body): Json<ToggleTaskCheckBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let dto = state
        .repo
        .toggle_task_check(
            &body.learner_id,
            body.step_id,
            &body.task_item_id,
            body.checked,
        )
        .await
        .map_err(internal_err)?;
    Ok(Json(dto))
}

async fn like_step_handler(
    State(state): State<AppState>,
    AxumPath(step_id): AxumPath<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let likes_count = state.repo.like_step(step_id).await.map_err(internal_err)?;
    Ok(Json(serde_json::json!({ "likes_count": likes_count })))
}

async fn list_notes_handler(
    State(state): State<AppState>,
    Query(q): Query<NotesQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let notes = state
        .repo
        .list_margin_notes(q.step_id, &q.learner_id)
        .await
        .map_err(internal_err)?;
    Ok(Json(notes))
}

async fn create_note_handler(
    State(state): State<AppState>,
    Json(input): Json<CreateMarginNoteInput>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if input.content.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Note content cannot be empty".to_string(),
        ));
    }
    let note = state
        .repo
        .create_margin_note(input)
        .await
        .map_err(internal_err)?;
    Ok((StatusCode::CREATED, Json(note)))
}

async fn delete_note_handler(
    State(state): State<AppState>,
    AxumPath(note_id): AxumPath<Uuid>,
    Query(q): Query<LearnerQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let deleted = state
        .repo
        .delete_margin_note(note_id, &q.learner_id)
        .await
        .map_err(internal_err)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

async fn reload_content_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _admin = require_admin(&state, &headers).await?;
    let bundle = load_content_directory(&state.content_dir).map_err(internal_err)?;
    let synced = state.repo.sync_bundle(&bundle).await.map_err(internal_err)?;
    Ok(Json(serde_json::json!({ "synced_documents": synced })))
}

fn parse_semver_key(raw: &str) -> Option<(u64, u64, u64, bool, Vec<(bool, u64, String)>)> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    let without_build = trimmed.split('+').next().unwrap_or(trimmed);
    let (core, pre_opt) = match without_build.split_once('-') {
        Some((c, p)) if !p.trim().is_empty() => (c, Some(p.trim())),
        _ => (without_build, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    let pre_tokens = pre_opt
        .map(|pre| {
            pre.split('.')
                .map(|seg| match seg.parse::<u64>() {
                    Ok(n) => (false, n, String::new()),
                    Err(_) => (true, 0, seg.to_ascii_lowercase()),
                })
                .collect()
        })
        .unwrap_or_default();
    // Stable release (pre_opt.is_none() == true) sorts higher than pre-release of same version
    Some((major, minor, patch, pre_opt.is_none(), pre_tokens))
}

fn is_newer_semver(latest: &str, current: &str) -> bool {
    match (parse_semver_key(latest), parse_semver_key(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

async fn fetch_latest_ghcr_digest(client: &reqwest::Client, repo: &str) -> Option<String> {
    let repo_lower = repo.to_ascii_lowercase();
    let token_url = format!("https://ghcr.io/token?scope=repository:{repo_lower}:pull");
    let token_val: serde_json::Value = client
        .get(&token_url)
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    let token = token_val.get("token")?.as_str()?;

    let manifest_url = format!("https://ghcr.io/v2/{repo_lower}/manifests/latest");
    let head = client
        .head(&manifest_url)
        .bearer_auth(token)
        .header(
            "Accept",
            "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
        )
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;

    head.headers()
        .get("docker-content-digest")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("sha256:") && s.len() >= 19)
}

async fn studio_update_check_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _user = require_author_or_admin(&state, &headers).await?;

    let raw_pkg_ver = env!("CARGO_PKG_VERSION");
    let current_digest = env::var("IMAGE_DIGEST")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let current_version = match &current_digest {
        Some(d) => {
            let hex = d.strip_prefix("sha256:").unwrap_or(d);
            let short = &hex[..hex.len().min(12)];
            format!("sha256-{short}")
        }
        None => format!("v{raw_pkg_ver}"),
    };

    let repo = env::var("UPDATE_CHECK_REPO")
        .ok()
        .map(|s| s.trim().trim_matches('/').to_string())
        .filter(|s| s.contains('/'))
        .unwrap_or_else(|| "Cloudwhile/icehandnote".to_string());
    let pkg_name = repo.rsplit('/').next().unwrap_or("icehandnote");

    let gh_releases_url = format!("https://api.github.com/repos/{repo}/releases?per_page=10");
    let release_resp = state
        .http_client
        .get(&gh_releases_url)
        .header("User-Agent", format!("IceHandnote/{raw_pkg_ver}"))
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Update check request failed: {e}")))?;

    if release_resp.status().is_success() {
        let releases: Vec<serde_json::Value> = release_resp.json().await.map_err(internal_err)?;
        let current_is_prerelease = raw_pkg_ver.contains('-');
        // Prefer stable releases when running stable, falling back to pre-releases if only RC/beta exists
        let chosen = releases
            .iter()
            .filter(|r| !r.get("draft").and_then(|d| d.as_bool()).unwrap_or(false))
            .find(|r| {
                current_is_prerelease
                    || !r.get("prerelease").and_then(|p| p.as_bool()).unwrap_or(false)
            })
            .or_else(|| {
                releases
                    .iter()
                    .find(|r| !r.get("draft").and_then(|d| d.as_bool()).unwrap_or(false))
            });

        if let Some(val) = chosen {
            let tag_name = val
                .get("tag_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let html_url = val
                .get("html_url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("https://github.com/{repo}/releases"));
            let published_at = val
                .get("published_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if !tag_name.is_empty() {
                let has_update = is_newer_semver(&tag_name, raw_pkg_ver) || current_digest.is_some();
                return Ok(Json(UpdateCheckResponse {
                    current_version,
                    latest_version: tag_name,
                    channel: "release",
                    has_update,
                    release_url: html_url,
                    published_at,
                }));
            }
        }
    } else if release_resp.status() != StatusCode::NOT_FOUND {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("Upstream returned HTTP {}", release_resp.status()),
        ));
    }

    // No published GitHub Release tag yet: resolve GHCR latest container sha256 digest
    if let Some(digest) = fetch_latest_ghcr_digest(&state.http_client, &repo).await {
        let hex = digest.strip_prefix("sha256:").unwrap_or(&digest);
        let short = &hex[..hex.len().min(12)];
        let latest_version = format!("sha256-{short}");
        let has_update = current_digest
            .as_deref()
            .map(|cur| cur != digest && cur != latest_version)
            .unwrap_or(false);

        return Ok(Json(UpdateCheckResponse {
            current_version,
            latest_version,
            channel: "ghcr",
            has_update,
            release_url: format!("https://github.com/{repo}/pkgs/container/{pkg_name}"),
            published_at: None,
        }));
    }

    Ok(Json(UpdateCheckResponse {
        current_version: current_version.clone(),
        latest_version: current_version,
        channel: "source",
        has_update: false,
        release_url: format!("https://github.com/{repo}/releases"),
        published_at: None,
    }))
}

fn internal_err<E: std::fmt::Display>(err: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn router_registers_all_routes_without_conflict() {
        let content_dir = resolve_content_dir(None);
        let store_path = env::temp_dir().join(format!("icehandnote-test-{}.json", Uuid::new_v4()));
        let repo = LocalSeedRepository::from_content_dir(&content_dir, store_path).unwrap();
        let state = AppState {
            repo: Arc::new(repo),
            content_dir,
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
    fn compares_semver_tags_accurately() {
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
}
