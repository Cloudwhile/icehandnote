use crate::{
    error::ApiError,
    state::{
        check_note_write_rate_limit, check_sliding_rate_limit, detect_external_origin,
        extract_client_ip, repo_err, resolve_me_owner, AppState,
    },
};
use axum::{
    extract::{ConnectInfo, Path as AxumPath, Query, State},
    http::{header, Extensions, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use icehandnote_core::{
    error::ErrorCode, export_notes_as_markdown, export_notes_as_w3c_jsonld,
    validate_user_note_content, ArticleTaskChecksDto, CreateMarginNoteInput, LearnerProgressDto,
    ListMarginNotesFilter, LocaleInfo, UpdateMarginNoteInput, UserMarginNoteDto,
    SUPPORTED_LOCALES,
};
use icehandnote_db::TutorialRepository;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use uuid::Uuid;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub project: String,
    pub storage_backend: &'static str,
    pub blog_origin_url: String,
    pub default_locale: String,
    pub locales: Vec<LocaleInfo>,
}

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub q: String,
}

#[derive(Deserialize)]
pub struct TaskChecksQuery {
    pub step_id: Uuid,
    /// Deprecated client field — ignored for security; identity is derived strictly server-side.
    #[serde(default)]
    #[allow(dead_code)]
    pub learner_id: Option<String>,
}

#[derive(Deserialize)]
pub struct NotesListQuery {
    #[serde(default)]
    pub step_id: Option<Uuid>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
    /// Deprecated client field — ignored for security; identity is derived strictly server-side.
    #[serde(default)]
    #[allow(dead_code)]
    pub learner_id: Option<String>,
}

#[derive(Deserialize)]
pub struct NotesExportQuery {
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub step_id: Option<Uuid>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
}

#[derive(Deserialize)]
pub struct ToggleProgressBody {
    /// Deprecated client field — ignored for security; identity is derived strictly server-side.
    #[serde(default)]
    #[allow(dead_code)]
    pub learner_id: Option<String>,
    pub step_id: Uuid,
    pub completed: bool,
}

#[derive(Deserialize)]
pub struct ToggleTaskCheckBody {
    /// Deprecated client field — ignored for security; identity is derived strictly server-side.
    #[serde(default)]
    #[allow(dead_code)]
    pub learner_id: Option<String>,
    pub step_id: Uuid,
    pub task_item_id: String,
    pub checked: bool,
}

fn attach_optional_cookie(resp: &mut Response, set_cookie: Option<HeaderValue>) {
    if let Some(cookie) = set_cookie {
        resp.headers_mut().append(header::SET_COOKIE, cookie);
    }
}

fn compute_notes_collection_etag(notes: &[UserMarginNoteDto], total: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(total.to_string().as_bytes());
    for n in notes {
        hasher.update(b"|");
        hasher.update(n.id.as_bytes());
        hasher.update(b":");
        hasher.update(n.version.to_string().as_bytes());
        hasher.update(b":");
        hasher.update(n.updated_at.timestamp_millis().to_string().as_bytes());
    }
    let hex = hex::encode(hasher.finalize());
    format!("W/\"notes-{}-{}\"", total, &hex[..16])
}

fn if_none_match_hit(headers: &HeaderMap, current_etag: &str) -> bool {
    fn strip_weak(s: &str) -> &str {
        let t = s.trim();
        t.strip_prefix("W/").unwrap_or(t)
    }
    let Some(raw) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    let cur = strip_weak(current_etag);
    raw.split(',')
        .map(str::trim)
        .any(|tag| tag == "*" || strip_weak(tag) == cur)
}

pub async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
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

pub async fn get_site_settings_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    Ok(Json(settings))
}

pub async fn list_tracks_handler(
    State(state): State<AppState>,
    AxumPath(locale): AxumPath<String>,
) -> Result<impl IntoResponse, ApiError> {
    let tracks = state.repo.list_tracks(&locale).await.map_err(repo_err)?;
    Ok(Json(tracks))
}

pub async fn get_step_handler(
    State(state): State<AppState>,
    AxumPath((locale, track, chapter, step)): AxumPath<(String, String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let detail = state
        .repo
        .get_step_detail(&locale, &track, &chapter, &step)
        .await
        .map_err(repo_err)?;

    match detail {
        Some(dto) => Ok(Json(dto)),
        None => Err(ApiError::new(
            ErrorCode::StepNotFound,
            "Article not found or unavailable.",
        )),
    }
}

pub async fn get_series_article_handler(
    State(state): State<AppState>,
    AxumPath((locale, track, step)): AxumPath<(String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let detail = state
        .repo
        .get_step_detail(&locale, &track, "-", &step)
        .await
        .map_err(repo_err)?;

    match detail {
        Some(dto) => Ok(Json(dto)),
        None => Err(ApiError::new(
            ErrorCode::StepNotFound,
            "Article not found or unavailable.",
        )),
    }
}

pub async fn search_handler(
    State(state): State<AppState>,
    AxumPath(locale): AxumPath<String>,
    Query(q): Query<SearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let hits = state.repo.search(&locale, &q.q).await.map_err(repo_err)?;
    Ok(Json(hits))
}

pub async fn get_progress_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let dto = match owner_opt {
        Some(owner) => state.repo.get_progress(&owner).await.map_err(repo_err)?,
        None => LearnerProgressDto {
            learner_id: String::new(),
            completed_step_ids: Vec::new(),
        },
    };
    let mut resp = Json(dto).into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    Ok(resp)
}

pub async fn toggle_progress_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ToggleProgressBody>,
) -> Result<Response, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.enable_progress_tracking {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Progress tracking is disabled on this site.",
        ));
    }
    let (owner_opt, set_cookie) = resolve_me_owner(&state, &headers, true).await?;
    let owner = owner_opt.ok_or_else(|| {
        ApiError::new(ErrorCode::Unauthorized, "Unable to resolve learner session.")
    })?;
    let dto = state
        .repo
        .toggle_step_complete(&owner, body.step_id, body.completed)
        .await
        .map_err(repo_err)?;
    let mut resp = Json(dto).into_response();
    attach_optional_cookie(&mut resp, set_cookie);
    Ok(resp)
}

pub async fn get_task_checks_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<TaskChecksQuery>,
) -> Result<Response, ApiError> {
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let dto = match owner_opt {
        Some(owner) => state
            .repo
            .get_task_checks(&owner, q.step_id)
            .await
            .map_err(repo_err)?,
        None => ArticleTaskChecksDto {
            learner_id: String::new(),
            step_id: q.step_id,
            checked_item_ids: Vec::new(),
        },
    };
    let mut resp = Json(dto).into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    Ok(resp)
}

pub async fn toggle_task_check_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ToggleTaskCheckBody>,
) -> Result<Response, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.enable_progress_tracking {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Progress tracking is disabled on this site.",
        ));
    }
    let (owner_opt, set_cookie) = resolve_me_owner(&state, &headers, true).await?;
    let owner = owner_opt.ok_or_else(|| {
        ApiError::new(ErrorCode::Unauthorized, "Unable to resolve learner session.")
    })?;
    let dto = state
        .repo
        .toggle_task_check(&owner, body.step_id, &body.task_item_id, body.checked)
        .await
        .map_err(repo_err)?;
    let mut resp = Json(dto).into_response();
    attach_optional_cookie(&mut resp, set_cookie);
    Ok(resp)
}

pub async fn like_step_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    AxumPath(step_id): AxumPath<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.enable_likes {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Article likes are disabled on this site.",
        ));
    }
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let actor_key = owner_opt.unwrap_or_else(|| {
        let ip = extract_client_ip(
            &headers,
            extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
            state.trust_proxy_headers,
        );
        format!("ip:{ip}")
    });
    check_sliding_rate_limit(
        &state,
        &format!("like:{step_id}:{actor_key}"),
        1,
        60,
        "You have already liked this article recently. Please try again later.",
    )
    .await?;

    let likes_count = state.repo.like_step(step_id).await.map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "likes_count": likes_count })))
}

/// RFC 9110 conditional GET (`ETag` + `If-None-Match` -> 304) with server-derived identity (RFC 6750 / RFC 6265bis).
/// Supports both single-article lookup (`?step_id=&locale=`) and cross-article "My Notes" search (`?tag=&q=&limit=&offset=`).
pub async fn list_notes_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<NotesListQuery>,
) -> Result<Response, ApiError> {
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let Some(owner) = owner_opt else {
        let mut resp = Json(Vec::<UserMarginNoteDto>::new()).into_response();
        resp.headers_mut()
            .insert("x-total-count", HeaderValue::from_static("0"));
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-cache"),
        );
        return Ok(resp);
    };

    let filter = ListMarginNotesFilter {
        step_id: q.step_id,
        locale_code: q.locale,
        tag: q.tag,
        q: q.q,
        limit: q.limit.unwrap_or(200).clamp(1, 500),
        offset: q.offset.unwrap_or(0),
    };
    let (notes, total) = state
        .repo
        .list_margin_notes_filtered(&owner, &filter)
        .await
        .map_err(repo_err)?;

    let etag = compute_notes_collection_etag(&notes, total);
    if if_none_match_hit(&headers, &etag) {
        let mut resp = StatusCode::NOT_MODIFIED.into_response();
        if let Ok(hv) = HeaderValue::from_str(&etag) {
            resp.headers_mut().insert(header::ETAG, hv);
        }
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-cache"),
        );
        return Ok(resp);
    }

    let mut resp = Json(notes).into_response();
    if let Ok(hv) = HeaderValue::from_str(&etag) {
        resp.headers_mut().insert(header::ETAG, hv);
    }
    if let Ok(hv) = HeaderValue::from_str(&total.to_string()) {
        resp.headers_mut().insert("x-total-count", hv);
    }
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    Ok(resp)
}

/// Create a new margin note / W3C annotation with server-enforced identity, `Idempotency-Key` deduplication,
/// rate limiting (RFC 6585 429), explicit length validation (RFC 9110 422), `Location`, and `ETag`.
pub async fn create_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<CreateMarginNoteInput>,
) -> Result<Response, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.enable_margin_notes {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Margin notes are disabled on this site.",
        ));
    }
    let (owner_opt, set_cookie) = resolve_me_owner(&state, &headers, true).await?;
    let owner = owner_opt.ok_or_else(|| {
        ApiError::new(ErrorCode::Unauthorized, "Unable to resolve learner session.")
    })?;

    // Check IETF `Idempotency-Key` header before mutating state
    let idem_cache_key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|k| !k.is_empty() && k.len() <= 128)
        .map(|k| format!("{owner}::{k}"));

    if let Some(ref cache_key) = idem_cache_key {
        let now = chrono::Utc::now();
        let mut map = state.note_idempotency.lock().await;
        map.retain(|_, (_, exp)| *exp > now);
        if let Some((cached, _)) = map.get(cache_key) {
            let mut resp = (StatusCode::CREATED, Json(cached.clone())).into_response();
            if let Ok(hv) = HeaderValue::from_str(&cached.etag()) {
                resp.headers_mut().insert(header::ETAG, hv);
            }
            if let Ok(loc) = HeaderValue::from_str(&format!("/api/v1/me/notes/{}", cached.id)) {
                resp.headers_mut().insert(header::LOCATION, loc);
            }
            attach_optional_cookie(&mut resp, set_cookie);
            return Ok(resp);
        }
    }

    // Validate before consuming rate-limit budget for empty/oversized inputs
    validate_user_note_content(&input.content).map_err(ApiError::from)?;
    check_note_write_rate_limit(&state, &owner).await?;

    // Server-authoritative owner key (ignores any client-passed learner_id)
    input.learner_id = owner;
    let note = state
        .repo
        .create_margin_note(input)
        .await
        .map_err(repo_err)?;

    if let Some(cache_key) = idem_cache_key {
        let mut map = state.note_idempotency.lock().await;
        if map.len() > 2048 {
            let now = chrono::Utc::now();
            map.retain(|_, (_, exp)| *exp > now);
        }
        map.insert(
            cache_key,
            (note.clone(), chrono::Utc::now() + chrono::Duration::minutes(10)),
        );
    }

    let etag = note.etag();
    let location = format!("/api/v1/me/notes/{}", note.id);
    let mut resp = (StatusCode::CREATED, Json(note)).into_response();
    if let Ok(hv) = HeaderValue::from_str(&etag) {
        resp.headers_mut().insert(header::ETAG, hv);
    }
    if let Ok(loc) = HeaderValue::from_str(&location) {
        resp.headers_mut().insert(header::LOCATION, loc);
    }
    attach_optional_cookie(&mut resp, set_cookie);
    Ok(resp)
}

/// RFC 7396 JSON Merge Patch partial update with RFC 9110 `If-Match` optimistic concurrency (`412`).
pub async fn update_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(note_id): AxumPath<Uuid>,
    body_bytes: axum::body::Bytes,
) -> Result<Response, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.enable_margin_notes {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Margin notes are disabled on this site.",
        ));
    }
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let Some(owner) = owner_opt else {
        return Err(ApiError::new(
            ErrorCode::Unauthorized,
            "Authentication or an active guest session is required to edit notes.",
        ));
    };

    // Accept both `application/merge-patch+json` (RFC 7396) and `application/json`
    if let Some(ct) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        let mime = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        if !mime.is_empty()
            && mime != "application/json"
            && mime != "application/merge-patch+json"
        {
            return Err(ApiError::new(
                ErrorCode::UnsupportedMediaType,
                "Expected Content-Type application/merge-patch+json or application/json.",
            ));
        }
    }

    let input: UpdateMarginNoteInput = serde_json::from_slice(&body_bytes).map_err(|e| {
        ApiError::new(
            ErrorCode::BadRequest,
            format!("Invalid JSON merge patch payload: {e}"),
        )
    })?;

    if let Some(ref content) = input.content {
        validate_user_note_content(content).map_err(ApiError::from)?;
    }
    check_note_write_rate_limit(&state, &owner).await?;

    let if_match = headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let updated = state
        .repo
        .update_margin_note(note_id, &owner, input, if_match)
        .await
        .map_err(repo_err)?;

    let etag = updated.etag();
    let mut resp = Json(updated).into_response();
    if let Ok(hv) = HeaderValue::from_str(&etag) {
        resp.headers_mut().insert(header::ETAG, hv);
    }
    Ok(resp)
}

/// Soft-delete a margin note (supports optional `If-Match` and returns an undo expiration window).
pub async fn delete_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(note_id): AxumPath<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.enable_margin_notes {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Margin notes are disabled on this site.",
        ));
    }
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let Some(owner) = owner_opt else {
        return Err(ApiError::new(
            ErrorCode::Unauthorized,
            "Authentication or an active guest session is required to delete notes.",
        ));
    };

    let if_match = headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let undo_until = state
        .repo
        .delete_margin_note(note_id, &owner, if_match)
        .await
        .map_err(repo_err)?;

    Ok(Json(serde_json::json!({
        "deleted": undo_until.is_some(),
        "id": note_id,
        "undo_expires_at": undo_until.map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
    })))
}

/// Restore a recently soft-deleted margin note within the undo grace window.
pub async fn restore_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(note_id): AxumPath<Uuid>,
) -> Result<Response, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.enable_margin_notes {
        return Err(ApiError::new(
            ErrorCode::Forbidden,
            "Margin notes are disabled on this site.",
        ));
    }
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let Some(owner) = owner_opt else {
        return Err(ApiError::new(
            ErrorCode::Unauthorized,
            "Authentication or an active guest session is required to restore notes.",
        ));
    };

    let restored = state
        .repo
        .restore_margin_note(note_id, &owner)
        .await
        .map_err(repo_err)?;

    let etag = restored.etag();
    let mut resp = Json(restored).into_response();
    if let Ok(hv) = HeaderValue::from_str(&etag) {
        resp.headers_mut().insert(header::ETAG, hv);
    }
    Ok(resp)
}

/// Export the caller's notes as RFC 7763 `text/markdown` or W3C Web Annotation JSON-LD.
pub async fn export_notes_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<NotesExportQuery>,
) -> Result<Response, ApiError> {
    let (owner_opt, _) = resolve_me_owner(&state, &headers, false).await?;
    let notes = if let Some(owner) = owner_opt {
        let filter = ListMarginNotesFilter {
            step_id: q.step_id,
            locale_code: q.locale,
            tag: q.tag,
            q: None,
            limit: 500,
            offset: 0,
        };
        state
            .repo
            .list_margin_notes_filtered(&owner, &filter)
            .await
            .map_err(repo_err)?
            .0
    } else {
        Vec::new()
    };

    let format = q
        .format
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "markdown".to_string());

    if format == "w3c-jsonld" || format == "jsonld" || format == "json" {
        let origin = detect_external_origin(&state, &headers);
        let payload = export_notes_as_w3c_jsonld(&notes, &origin);
        let body = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string());
        let mut resp = (StatusCode::OK, body).into_response();
        resp.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static(
                "application/ld+json; profile=\"http://www.w3.org/ns/anno.jsonld\"; charset=utf-8",
            ),
        );
        resp.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename=\"icehandnote-annotations.jsonld\""),
        );
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        );
        return Ok(resp);
    }

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let md = export_notes_as_markdown(&notes, &settings.site_name);
    let mut resp = (StatusCode::OK, md).into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/markdown; charset=utf-8"),
    );
    resp.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"icehandnote-notes.md\""),
    );
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok(resp)
}
