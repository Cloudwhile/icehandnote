use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use icehandnote_core::error::{DomainError, ErrorCode};
use serde::Serialize;

/// RFC 9457 Problem Details payload (`application/problem+json`).
#[derive(Debug, Serialize)]
pub struct ProblemDetails {
    #[serde(rename = "type")]
    pub problem_type: String,
    pub title: String,
    pub status: u16,
    pub detail: String,
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

/// Structured HTTP API error enforcing RFC 9457 Problem Details + RFC 9110/6750 semantics.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: ErrorCode,
    pub detail: String,
    pub meta: Option<serde_json::Value>,
}

impl ApiError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        let status = StatusCode::from_u16(code.http_status_code())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        Self {
            status,
            code,
            detail: detail.into(),
            meta: None,
        }
    }

    pub fn with_meta(mut self, meta: serde_json::Value) -> Self {
        self.meta = Some(meta);
        self
    }

    pub fn from_anyhow(err: anyhow::Error) -> Self {
        if let Some(domain) = err.downcast_ref::<DomainError>() {
            let status = StatusCode::from_u16(domain.code.http_status_code())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            return Self {
                status,
                code: domain.code,
                detail: domain.detail.clone(),
                meta: domain.meta.clone(),
            };
        }
        Self::new(ErrorCode::InternalError, err.to_string())
    }

    pub fn from_anyhow_with_fallback(err: anyhow::Error, fallback: ErrorCode) -> Self {
        if let Some(domain) = err.downcast_ref::<DomainError>() {
            let status = StatusCode::from_u16(domain.code.http_status_code())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            return Self {
                status,
                code: domain.code,
                detail: domain.detail.clone(),
                meta: domain.meta.clone(),
            };
        }
        Self::new(fallback, err.to_string())
    }
}

impl From<DomainError> for ApiError {
    fn from(domain: DomainError) -> Self {
        let status = StatusCode::from_u16(domain.code.http_status_code())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        Self {
            status,
            code: domain.code,
            detail: domain.detail,
            meta: domain.meta,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let title = self
            .status
            .canonical_reason()
            .unwrap_or("Error")
            .to_string();
        let retry_after_secs = if self.status == StatusCode::TOO_MANY_REQUESTS {
            self.meta
                .as_ref()
                .and_then(|m| m.get("retry_after_secs"))
                .and_then(|v| v.as_i64())
                .map(|s| s.max(1))
        } else {
            None
        };
        let body = ProblemDetails {
            problem_type: self.code.type_uri(),
            title,
            status: self.status.as_u16(),
            detail: self.detail,
            code: self.code,
            meta: self.meta,
        };
        let mut resp = (self.status, Json(body)).into_response();
        resp.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        if self.status == StatusCode::UNAUTHORIZED {
            resp.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                HeaderValue::from_static("Bearer realm=\"icehandnote\""),
            );
        }
        if let Some(secs) = retry_after_secs {
            if let Ok(val) = HeaderValue::from_str(&secs.to_string()) {
                resp.headers_mut().insert(header::RETRY_AFTER, val);
            }
        }
        resp
    }
}
