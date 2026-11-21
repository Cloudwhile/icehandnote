use crate::{
    error::ApiError,
    state::{repo_err, AppState},
};
use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use icehandnote_core::{error::ErrorCode, CreateMarginNoteInput, LocaleInfo, SUPPORTED_LOCALES};
use icehandnote_db::TutorialRepository;
use serde::{Deserialize, Serialize};
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
pub struct LearnerQuery {
    pub learner_id: String,
}

#[derive(Deserialize)]
pub struct NotesQuery {
    pub step_id: Uuid,
    pub learner_id: String,
}

#[derive(Deserialize)]
pub struct ToggleProgressBody {
    pub learner_id: String,
    pub step_id: Uuid,
    pub completed: bool,
}

#[derive(Deserialize)]
pub struct ToggleTaskCheckBody {
    pub learner_id: String,
    pub step_id: Uuid,
    pub task_item_id: String,
    pub checked: bool,
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
    Query(q): Query<LearnerQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let dto = state
        .repo
        .get_progress(&q.learner_id)
        .await
        .map_err(repo_err)?;
    Ok(Json(dto))
}

pub async fn toggle_progress_handler(
    State(state): State<AppState>,
    Json(body): Json<ToggleProgressBody>,
) -> Result<impl IntoResponse, ApiError> {
    let dto = state
        .repo
        .toggle_step_complete(&body.learner_id, body.step_id, body.completed)
        .await
        .map_err(repo_err)?;
    Ok(Json(dto))
}

pub async fn get_task_checks_handler(
    State(state): State<AppState>,
    Query(q): Query<NotesQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let dto = state
        .repo
        .get_task_checks(&q.learner_id, q.step_id)
        .await
        .map_err(repo_err)?;
    Ok(Json(dto))
}

pub async fn toggle_task_check_handler(
    State(state): State<AppState>,
    Json(body): Json<ToggleTaskCheckBody>,
) -> Result<impl IntoResponse, ApiError> {
    let dto = state
        .repo
        .toggle_task_check(
            &body.learner_id,
            body.step_id,
            &body.task_item_id,
            body.checked,
        )
        .await
        .map_err(repo_err)?;
    Ok(Json(dto))
}

pub async fn like_step_handler(
    State(state): State<AppState>,
    AxumPath(step_id): AxumPath<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let likes_count = state.repo.like_step(step_id).await.map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "likes_count": likes_count })))
}

pub async fn list_notes_handler(
    State(state): State<AppState>,
    Query(q): Query<NotesQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let notes = state
        .repo
        .list_margin_notes(q.step_id, &q.learner_id)
        .await
        .map_err(repo_err)?;
    Ok(Json(notes))
}

pub async fn create_note_handler(
    State(state): State<AppState>,
    Json(input): Json<CreateMarginNoteInput>,
) -> Result<impl IntoResponse, ApiError> {
    if input.content.trim().is_empty() {
        return Err(ApiError::new(
            ErrorCode::NoteContentEmpty,
            "Margin note content cannot be empty.",
        ));
    }
    let note = state
        .repo
        .create_margin_note(input)
        .await
        .map_err(repo_err)?;
    Ok((StatusCode::CREATED, Json(note)))
}

pub async fn delete_note_handler(
    State(state): State<AppState>,
    AxumPath(note_id): AxumPath<Uuid>,
    Query(q): Query<LearnerQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let deleted = state
        .repo
        .delete_margin_note(note_id, &q.learner_id)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}
