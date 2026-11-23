use crate::{
    error::ApiError,
    state::{
        check_sliding_rate_limit, extract_client_ip, internal_err, require_authenticated_user,
        AppState,
    },
};
use axum::{
    body::Body,
    extract::{ConnectInfo, Multipart, Path as AxumPath, State},
    http::{header, Extensions, HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{Datelike, Utc};
use icehandnote_core::{
    auth::{percent_encode_component, UserProfileDto},
    error::ErrorCode,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, net::SocketAddr, time::UNIX_EPOCH};
use uuid::Uuid;

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_RASTER_UNPRIVILEGED_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct UploadMediaResponse {
    pub url: String,
    pub filename: String,
    pub content_type: &'static str,
    pub size_bytes: usize,
    pub sha256: String,
}

fn has_dangerous_svg_attr_or_css(lower: &str) -> bool {
    // Scan attributes inside `<...>` so even whitespace-padded `onload =` or `href =` cannot evade
    let bytes = lower.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            i += 1;
            // Skip closing/comment tags
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'/' {
                while i < bytes.len() && bytes[i] != b'>' {
                    i += 1;
                }
                continue;
            }
            // Skip tag name
            while i < bytes.len()
                && !bytes[i].is_ascii_whitespace()
                && bytes[i] != b'>'
                && bytes[i] != b'/'
            {
                i += 1;
            }
            let mut in_quote: Option<u8> = None;
            while i < bytes.len() {
                let b = bytes[i];
                if let Some(q) = in_quote {
                    if b == q {
                        in_quote = None;
                    }
                    i += 1;
                    continue;
                }
                if b == b'"' || b == b'\'' {
                    in_quote = Some(b);
                    i += 1;
                    continue;
                }
                if b == b'>' {
                    i += 1;
                    break;
                }
                if b.is_ascii_alphabetic() || b == b':' || b == b'-' || b == b'_' {
                    let start = i;
                    while i < bytes.len()
                        && (bytes[i].is_ascii_alphanumeric()
                            || bytes[i] == b':'
                            || bytes[i] == b'-'
                            || bytes[i] == b'_')
                    {
                        i += 1;
                    }
                    let attr = &lower[start..i];
                    let mut j = i;
                    while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                        j += 1;
                    }
                    if j < bytes.len()
                        && bytes[j] == b'='
                        && (attr == "href"
                            || attr == "xlink:href"
                            || (attr.starts_with("on") && attr.len() > 2))
                    {
                        return true;
                    }
                    continue;
                }
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    false
}

fn is_safe_svg(bytes: &[u8]) -> bool {
    if bytes.contains(&0) {
        return false;
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("<svg") || (lower.starts_with("<?xml") && lower.contains("<svg"))) {
        return false;
    }
    for forbidden in [
        "<!doctype",
        "<!entity",
        "<script",
        "javascript:",
        "vbscript:",
        "data:text/html",
        "<foreignobject",
        "<iframe",
        "<embed",
        "<object",
        "<use",
        "<image",
        "<set",
        "<animate",
        "<handler",
        "<listener",
        "<audio",
        "<video",
        "xlink:href",
        "@import",
        "url(",
        "url (",
    ] {
        if lower.contains(forbidden) {
            return false;
        }
    }
    !has_dangerous_svg_attr_or_css(&lower)
}

pub fn detect_safe_image_format(
    bytes: &[u8],
    orig_name: &str,
    declared_mime: Option<&str>,
) -> Option<(&'static str, &'static str)> {
    let detected = if bytes.len() >= 8 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" {
        Some(("png", "image/png"))
    } else if bytes.len() >= 3 && &bytes[..3] == b"\xFF\xD8\xFF" {
        Some(("jpg", "image/jpeg"))
    } else if bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        Some(("gif", "image/gif"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else if bytes.len() >= 4
        && (&bytes[..4] == b"\x00\x00\x01\x00" || &bytes[..4] == b"\x00\x00\x02\x00")
    {
        Some(("ico", "image/x-icon"))
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis" || &bytes[8..12] == b"mif1")
    {
        Some(("avif", "image/avif"))
    } else if (orig_name.to_ascii_lowercase().ends_with(".svg")
        || declared_mime
            .map(|m| m.eq_ignore_ascii_case("image/svg+xml"))
            .unwrap_or(false))
        && is_safe_svg(bytes)
    {
        Some(("svg", "image/svg+xml"))
    } else {
        None
    }?;

    if let Some(raw_mime) = declared_mime {
        let base_mime = raw_mime
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !base_mime.is_empty() && base_mime != "application/octet-stream" {
            let compatible = match detected.1 {
                "image/jpeg" => base_mime == "image/jpeg" || base_mime == "image/jpg",
                "image/x-icon" => {
                    base_mime == "image/x-icon" || base_mime == "image/vnd.microsoft.icon"
                }
                expected => base_mime == expected,
            };
            if !compatible {
                return None;
            }
        }
    }

    Some(detected)
}

enum UploaderKind {
    Authenticated(Box<UserProfileDto>),
    Onboarding,
}

struct UploaderContext {
    kind: UploaderKind,
    rate_key: String,
}

async fn authorize_uploader(
    state: &AppState,
    headers: &HeaderMap,
    peer_ip: Option<std::net::IpAddr>,
) -> Result<UploaderContext, ApiError> {
    if let Ok(user) = require_authenticated_user(state, headers).await {
        return Ok(UploaderContext {
            rate_key: format!("upload:user:{}", user.id),
            kind: UploaderKind::Authenticated(Box::new(user)),
        });
    }
    if let Some(tok) = headers
        .get("x-onboarding-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let now = Utc::now().timestamp();
        let onboardings = state.oauth_onboardings.lock().await;
        if onboardings.get(tok).map(|o| o.expires_at > now).unwrap_or(false) {
            let ip = extract_client_ip(headers, peer_ip, state.trust_proxy_headers);
            return Ok(UploaderContext {
                rate_key: format!("upload:onb:{ip}"),
                kind: UploaderKind::Onboarding,
            });
        }
    }
    Err(ApiError::new(
        ErrorCode::Unauthorized,
        "Authentication required to upload media.",
    ))
}

pub async fn upload_media_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Response, ApiError> {
    let peer_ip = extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
    let uploader = authorize_uploader(&state, &headers, peer_ip).await?;
    check_sliding_rate_limit(
        &state,
        &uploader.rate_key,
        30,
        60,
        "Too many media uploads. Please wait a moment and try again.",
    )
    .await?;

    let req_ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !req_ct.to_ascii_lowercase().starts_with("multipart/form-data") {
        return Err(ApiError::new(
            ErrorCode::UnsupportedMediaType,
            "Content-Type must be multipart/form-data.",
        ));
    }

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::new(ErrorCode::BadRequest, format!("Failed to parse multipart form: {e}")))?
    {
        let field_name = field.name().unwrap_or("");
        if field_name != "file" && !field_name.is_empty() {
            continue;
        }
        let orig_name = field.file_name().unwrap_or("image").to_string();
        let part_mime = field.content_type().map(str::to_string);
        let bytes = field
            .bytes()
            .await
            .map_err(|e| ApiError::new(ErrorCode::BadRequest, format!("Failed to read uploaded bytes: {e}")))?;

        if bytes.is_empty() {
            return Err(ApiError::new(
                ErrorCode::UploadEmpty,
                "Uploaded file is empty.",
            ));
        }
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(ApiError::new(
                ErrorCode::UploadTooLarge,
                "Image exceeds the 10 MB size limit.",
            ));
        }

        let Some((ext, content_type)) =
            detect_safe_image_format(&bytes, &orig_name, part_mime.as_deref())
        else {
            return Err(ApiError::new(
                ErrorCode::UnsupportedMediaType,
                "Unsupported or mismatched image format (PNG, JPEG, WebP, GIF, AVIF, ICO, or safe SVG required).",
            ));
        };

        let is_admin = matches!(&uploader.kind, UploaderKind::Authenticated(u) if u.role.is_admin());
        let is_privileged_uploader = matches!(
            &uploader.kind,
            UploaderKind::Authenticated(u) if u.role.can_author()
        );
        if ext == "svg" && !is_admin {
            return Err(ApiError::new(
                ErrorCode::Forbidden,
                "Only administrators may upload SVG files.",
            ));
        }
        if !is_privileged_uploader {
            if !matches!(ext, "png" | "jpg" | "gif" | "webp") {
                return Err(ApiError::new(
                    ErrorCode::Forbidden,
                    "Avatars must be PNG, JPEG, GIF, or WebP images.",
                ));
            }
            if bytes.len() > MAX_RASTER_UNPRIVILEGED_BYTES {
                return Err(ApiError::new(
                    ErrorCode::UploadTooLarge,
                    "Uploaded image exceeds the 2 MB size limit.",
                ));
            }
        }

        let sha256_hex = hex::encode(Sha256::digest(&bytes));
        let now = Utc::now();
        let ym_folder = format!("{:04}{:02}", now.year(), now.month());
        let target_dir = state.uploads_dir.join(&ym_folder);
        fs::create_dir_all(&target_dir).map_err(internal_err)?;

        let stored_name = format!("{}.{ext}", Uuid::new_v4().simple());
        let file_path = target_dir.join(&stored_name);
        fs::write(&file_path, &bytes).map_err(internal_err)?;

        let url = format!("/uploads/{ym_folder}/{stored_name}");
        let payload = UploadMediaResponse {
            url: url.clone(),
            filename: stored_name,
            content_type,
            size_bytes: bytes.len(),
            sha256: sha256_hex,
        };

        let mut resp = (StatusCode::CREATED, Json(payload)).into_response();
        if let Ok(loc_hv) = HeaderValue::from_str(&url) {
            resp.headers_mut().insert(header::LOCATION, loc_hv);
        }
        return Ok(resp);
    }

    Err(ApiError::new(
        ErrorCode::UploadMissingField,
        "No file field found in multipart payload.",
    ))
}

fn mime_for_ext(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

pub async fn serve_uploaded_media_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((ym, filename)): AxumPath<(String, String)>,
) -> Result<Response, ApiError> {
    if ym.len() != 6 || !ym.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::new(ErrorCode::BadRequest, "Invalid upload path."));
    }
    if filename.is_empty()
        || filename.len() > 120
        || filename.contains("..")
        || !filename
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(ApiError::new(ErrorCode::BadRequest, "Invalid filename."));
    }

    let ext = filename.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let Some(content_type) = mime_for_ext(&ext) else {
        return Err(ApiError::new(
            ErrorCode::UnsupportedMediaType,
            "Unsupported media extension.",
        ));
    };

    let full_path = state.uploads_dir.join(&ym).join(&filename);
    let meta = tokio::fs::symlink_metadata(&full_path)
        .await
        .map_err(|_| ApiError::new(ErrorCode::MediaNotFound, "Media file not found."))?;
    if meta.file_type().is_symlink() || !meta.file_type().is_file() {
        return Err(ApiError::new(
            ErrorCode::MediaNotFound,
            "Media file not found.",
        ));
    }
    if meta.len() > MAX_IMAGE_BYTES as u64 {
        return Err(ApiError::new(
            ErrorCode::UploadTooLarge,
            "Media file exceeds maximum allowed size.",
        ));
    }

    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let etag_val = format!("W/\"u-{}-{}\"", meta.len(), mtime_ns);

    if let Some(inm) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if inm.split(',').any(|tag| tag.trim() == etag_val || tag.trim() == "*") {
            let mut not_mod = StatusCode::NOT_MODIFIED.into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag_val) {
                not_mod.headers_mut().insert(header::ETAG, hv);
            }
            not_mod.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
            return Ok(not_mod);
        }
    }

    let bytes = tokio::fs::read(&full_path)
        .await
        .map_err(|_| ApiError::new(ErrorCode::MediaNotFound, "Media file not found."))?;

    let encoded_name = percent_encode_component(&filename);
    let disposition = if ext == "svg" {
        format!("attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_name}")
    } else {
        format!("inline; filename=\"{filename}\"; filename*=UTF-8''{encoded_name}")
    };

    let mut resp = Response::new(Body::from(bytes.clone()));
    *resp.status_mut() = StatusCode::OK;
    let h = resp.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type),
    );
    if let Ok(len_hv) = HeaderValue::from_str(&bytes.len().to_string()) {
        h.insert(header::CONTENT_LENGTH, len_hv);
    }
    if let Ok(etag_hv) = HeaderValue::from_str(&etag_val) {
        h.insert(header::ETAG, etag_hv);
    }
    if let Ok(disp_hv) = HeaderValue::from_str(&disposition) {
        h.insert(header::CONTENT_DISPOSITION, disp_hv);
    }
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    h.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(if ext == "svg" {
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox"
        } else {
            "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox"
        }),
    );
    Ok(resp)
}
