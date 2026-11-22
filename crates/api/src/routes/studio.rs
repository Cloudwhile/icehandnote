use crate::{
    error::ApiError,
    mailer::{is_smtp_ready, send_collaborator_invite_email, MailBrandContext},
    state::{
        check_invite_rate_limit, detect_external_origin, extract_bearer_token, internal_err,
        optional_authenticated_user, repo_err, repo_err_or, require_admin,
        require_authenticated_user, require_author_or_admin, require_studio_access,
        resolve_request_locale, AppState,
    },
};
use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use icehandnote_core::{
    auth::{
        format_step_markdown_file, normalize_collaborator_role, normalize_locale_scope,
        percent_encode_component, CollaboratorInviteDto, CreateChapterInput, CreateTrackInput,
        SaveStudioStepInput, UserProfileDto,
    },
    compile_notebook_markdown,
    error::ErrorCode,
};
use icehandnote_db::TutorialRepository;
use serde::{Deserialize, Serialize};
use std::env;
use uuid::Uuid;

fn extract_if_match(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn if_none_match_matches(headers: &HeaderMap, current_etag: &str) -> bool {
    if current_etag.is_empty() {
        return false;
    }
    let Some(raw) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    fn strip_weak(s: &str) -> &str {
        s.trim().strip_prefix("W/").unwrap_or(s.trim()).trim()
    }
    let cur = strip_weak(current_etag);
    raw.split(',')
        .map(str::trim)
        .any(|c| c == "*" || strip_weak(c) == cur)
}

#[derive(Deserialize)]
pub struct StudioPreviewBody {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub body_markdown: String,
}

#[derive(Serialize)]
pub struct UpdateCheckResponse {
    pub current_version: String,
    pub latest_version: String,
    pub channel: &'static str,
    pub has_update: bool,
    pub release_url: String,
    pub published_at: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateInviteBody {
    pub email: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub locale_scope: Vec<String>,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Serialize)]
pub struct CreateInviteResponse {
    pub invite: CollaboratorInviteDto,
    pub invite_url: String,
    pub email_sent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_error: Option<String>,
}

#[derive(Deserialize)]
pub struct AcceptInviteBody {
    pub token: String,
}

#[derive(Serialize)]
pub struct AcceptInviteResponse {
    pub ok: bool,
    pub track_slug: String,
    pub chapter_slug: String,
    pub step_slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<UserProfileDto>,
}

#[derive(Deserialize)]
pub struct UpdateCollaboratorRoleBody {
    pub role: String,
    #[serde(default)]
    pub locale_scope: Vec<String>,
}

#[derive(Deserialize)]
pub struct TransferOwnerBody {
    pub target_user_id: Uuid,
}

pub async fn studio_overview_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(locale): AxumPath<String>,
) -> Result<impl IntoResponse, ApiError> {
    let viewer = require_studio_access(&state, &headers).await?;
    let tracks = state
        .repo
        .studio_list_tracks(&viewer, &locale)
        .await
        .map_err(repo_err)?;
    Ok(Json(tracks))
}

pub async fn studio_get_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step, locale)): AxumPath<(String, String, String, String)>,
) -> Result<axum::response::Response, ApiError> {
    let viewer = require_studio_access(&state, &headers).await?;
    let dto = state
        .repo
        .studio_get_step_editor(&viewer, &track, &chapter, &step, &locale)
        .await
        .map_err(repo_err)?;

    let mut resp_headers = HeaderMap::new();
    if !dto.etag.is_empty() {
        if let Ok(hv) = HeaderValue::from_str(&dto.etag) {
            resp_headers.insert(header::ETAG, hv);
        }
        if if_none_match_matches(&headers, &dto.etag) {
            return Ok((StatusCode::NOT_MODIFIED, resp_headers).into_response());
        }
    }
    Ok((StatusCode::OK, resp_headers, Json(dto)).into_response())
}

pub async fn studio_save_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<SaveStudioStepInput>,
) -> Result<axum::response::Response, ApiError> {
    let author = require_studio_access(&state, &headers).await?;
    if input.title.trim().is_empty() || input.step_slug.trim().is_empty() {
        return Err(ApiError::new(
            ErrorCode::TitleOrSlugRequired,
            "Title and article slug are required.",
        ));
    }
    if let Some(if_match) = extract_if_match(&headers) {
        input.expected_etag = Some(if_match);
    }
    let saved = state
        .repo
        .studio_save_step(&author, input, &state.content_dir, true)
        .await
        .map_err(repo_err)?;
    let mut resp_headers = HeaderMap::new();
    if !saved.etag.is_empty() {
        if let Ok(hv) = HeaderValue::from_str(&saved.etag) {
            resp_headers.insert(header::ETAG, hv);
        }
    }
    Ok((StatusCode::OK, resp_headers, Json(saved)).into_response())
}

pub async fn studio_delete_step_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = require_author_or_admin(&state, &headers).await?;
    let deleted = state
        .repo
        .studio_delete_step(&actor, &track, &chapter, &step, &state.content_dir)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

pub async fn studio_create_track_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateTrackInput>,
) -> Result<impl IntoResponse, ApiError> {
    let _author = require_author_or_admin(&state, &headers).await?;
    let created = state
        .repo
        .studio_create_track(input, &state.content_dir)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::BadRequest))?;
    Ok((StatusCode::CREATED, Json(created)))
}

pub async fn studio_delete_track_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(track): AxumPath<String>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let deleted = state
        .repo
        .studio_delete_track(&track, &state.content_dir)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

pub async fn studio_create_chapter_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateChapterInput>,
) -> Result<impl IntoResponse, ApiError> {
    let _author = require_author_or_admin(&state, &headers).await?;
    state
        .repo
        .studio_create_chapter(input, &state.content_dir)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::BadRequest))?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({ "ok": true }))))
}

pub async fn studio_delete_chapter_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter)): AxumPath<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let _admin = require_admin(&state, &headers).await?;
    let deleted = state
        .repo
        .studio_delete_chapter(&track, &chapter, &state.content_dir)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

pub async fn studio_preview_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<StudioPreviewBody>,
) -> Result<impl IntoResponse, ApiError> {
    let _member = require_studio_access(&state, &headers).await?;
    let formatted = format_step_markdown_file(
        &body.title,
        &body.summary,
        1,
        1,
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

pub async fn create_collaborator_invite_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
    Json(body): Json<CreateInviteBody>,
) -> Result<axum::response::Response, ApiError> {
    let actor = require_author_or_admin(&state, &headers).await?;

    let idem_key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .map(|k| format!("{}:{track}/{chapter}/{step}:{k}", actor.id));

    if let Some(ref cache_key) = idem_key {
        let now = chrono::Utc::now();
        let mut cache = state.invite_idempotency.lock().await;
        cache.retain(|_, (_, exp)| *exp > now);
        if let Some((cached_json, _)) = cache.get(cache_key) {
            return Ok((StatusCode::CREATED, Json(cached_json.clone())).into_response());
        }
    }

    check_invite_rate_limit(&state, actor.id).await?;

    let role = normalize_collaborator_role(body.role.as_deref());
    let locale_scope = normalize_locale_scope(&body.locale_scope);

    let (invite, raw_token, article_title) = state
        .repo
        .create_collaborator_invite(
            &actor,
            &track,
            &chapter,
            &step,
            &body.email,
            &role,
            &locale_scope,
        )
        .await
        .map_err(repo_err)?;

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let target_locale =
        resolve_request_locale(body.locale.as_deref(), &headers, &settings.default_locale);
    let origin = detect_external_origin(&headers);
    // RFC 9700 §4.3.2: Pass sensitive single-use invite token in URL Fragment (never query string / server logs / Referer)
    let invite_url = format!(
        "{origin}/{target_locale}/invite#token={}",
        percent_encode_component(&raw_token)
    );

    let (smtp_cfg, smtp_pw) = {
        let secrets = state.runtime_secrets.read().await;
        (secrets.smtp.clone(), secrets.smtp_password.clone())
    };
    let mut email_sent = false;
    let mut email_error = None;
    if is_smtp_ready(&smtp_cfg) {
        match send_collaborator_invite_email(
            &smtp_cfg,
            &smtp_pw,
            MailBrandContext {
                site_name: &settings.site_name,
                logo_url: &settings.logo_url,
                origin: &origin,
                locale: target_locale,
            },
            &actor.display_name,
            &article_title,
            &invite_url,
            &invite.email,
        )
        .await
        {
            Ok(()) => email_sent = true,
            Err(e) => {
                tracing::warn!("Failed to send collaborator invite email: {e}");
                email_error = Some(e.to_string());
            }
        }
    }

    let payload = CreateInviteResponse {
        invite,
        invite_url,
        email_sent,
        email_error,
    };

    if let Some(cache_key) = idem_key {
        if let Ok(val) = serde_json::to_value(&payload) {
            let mut cache = state.invite_idempotency.lock().await;
            cache.insert(cache_key, (val, chrono::Utc::now() + chrono::Duration::hours(24)));
        }
    }

    Ok((StatusCode::CREATED, Json(payload)).into_response())
}

pub async fn preview_collaborator_invite_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AcceptInviteBody>,
) -> Result<impl IntoResponse, ApiError> {
    let viewer = optional_authenticated_user(&state, &headers).await;
    let preview = state
        .repo
        .preview_collaborator_invite(viewer.as_ref(), body.token.trim())
        .await
        .map_err(repo_err)?;
    Ok(Json(preview))
}

pub async fn revoke_collaborator_invite_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(invite_id): AxumPath<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = require_author_or_admin(&state, &headers).await?;
    let deleted = state
        .repo
        .revoke_collaborator_invite(&actor, invite_id)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

pub async fn accept_collaborator_invite_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AcceptInviteBody>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let (track_slug, chapter_slug, step_slug) = state
        .repo
        .accept_collaborator_invite(&user, body.token.trim())
        .await
        .map_err(repo_err)?;

    let refreshed_user = if let Some(tok) = extract_bearer_token(&headers) {
        state.repo.get_user_by_session(&tok).await.ok().flatten()
    } else {
        None
    };

    Ok(Json(AcceptInviteResponse {
        ok: true,
        track_slug,
        chapter_slug,
        step_slug,
        user: refreshed_user,
    }))
}

pub async fn remove_step_collaborator_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step, user_id)): AxumPath<(String, String, String, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = require_author_or_admin(&state, &headers).await?;
    let removed = state
        .repo
        .remove_step_collaborator(&actor, &track, &chapter, &step, user_id)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "removed": removed })))
}

pub async fn update_step_collaborator_role_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step, user_id)): AxumPath<(String, String, String, Uuid)>,
    Json(body): Json<UpdateCollaboratorRoleBody>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = require_author_or_admin(&state, &headers).await?;
    let updated = state
        .repo
        .update_step_collaborator_role(
            &actor,
            &track,
            &chapter,
            &step,
            user_id,
            &body.role,
            &body.locale_scope,
        )
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "updated": updated })))
}

pub async fn leave_step_collaboration_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let left = state
        .repo
        .leave_step_collaboration(&user, &track, &chapter, &step)
        .await
        .map_err(repo_err)?;
    let refreshed_user = if let Some(tok) = extract_bearer_token(&headers) {
        state.repo.get_user_by_session(&tok).await.ok().flatten()
    } else {
        None
    };
    Ok(Json(serde_json::json!({ "left": left, "user": refreshed_user })))
}

pub async fn transfer_step_ownership_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
    Json(body): Json<TransferOwnerBody>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = require_author_or_admin(&state, &headers).await?;
    let transferred = state
        .repo
        .transfer_step_ownership(&actor, &track, &chapter, &step, body.target_user_id)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "transferred": transferred })))
}

pub async fn list_step_revisions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step, locale)): AxumPath<(String, String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let viewer = require_studio_access(&state, &headers).await?;
    let revisions = state
        .repo
        .list_step_revisions(&viewer, &track, &chapter, &step, &locale)
        .await
        .map_err(repo_err)?;
    Ok(Json(revisions))
}

pub async fn restore_step_revision_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step, locale, rev_id)): AxumPath<(String, String, String, String, Uuid)>,
) -> Result<axum::response::Response, ApiError> {
    let actor = require_studio_access(&state, &headers).await?;
    let expected_etag = extract_if_match(&headers);
    let saved = state
        .repo
        .restore_step_revision(
            &actor,
            &track,
            &chapter,
            &step,
            &locale,
            rev_id,
            expected_etag.as_deref(),
            &state.content_dir,
        )
        .await
        .map_err(repo_err)?;
    let mut resp_headers = HeaderMap::new();
    if !saved.etag.is_empty() {
        if let Ok(hv) = HeaderValue::from_str(&saved.etag) {
            resp_headers.insert(header::ETAG, hv);
        }
    }
    Ok((StatusCode::OK, resp_headers, Json(saved)).into_response())
}

pub async fn list_step_audit_logs_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((track, chapter, step)): AxumPath<(String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let viewer = require_studio_access(&state, &headers).await?;
    let logs = state
        .repo
        .list_step_audit_logs(&viewer, &track, &chapter, &step)
        .await
        .map_err(repo_err)?;
    Ok(Json(logs))
}

pub(crate) fn parse_semver_key(
    raw: &str,
) -> Option<(u64, u64, u64, bool, Vec<(bool, u64, String)>)> {
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
    Some((major, minor, patch, pre_opt.is_none(), pre_tokens))
}

pub(crate) fn is_newer_semver(latest: &str, current: &str) -> bool {
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

pub async fn studio_update_check_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
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
        .map_err(|e| {
            ApiError::new(
                ErrorCode::UpstreamError,
                format!("Update check request failed: {e}"),
            )
        })?;

    if release_resp.status().is_success() {
        let releases: Vec<serde_json::Value> = release_resp.json().await.map_err(internal_err)?;
        let current_is_prerelease = raw_pkg_ver.contains('-');
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
        return Err(ApiError::new(
            ErrorCode::UpstreamError,
            format!("Upstream returned HTTP {}.", release_resp.status()),
        ));
    }

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
