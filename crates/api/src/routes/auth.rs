use crate::{
    error::ApiError,
    mailer::{
        is_smtp_ready, send_email_change_code_email, send_login_anomaly_otp_email,
        send_password_reset_email, send_registration_code_email, MailBrandContext,
    },
    state::{
        detect_external_origin, extract_bearer_token, extract_client_context,
        finalize_login_session, internal_err, repo_err, repo_err_or, require_authenticated_user,
        resolve_request_locale, AppState, AuthSessionResponse, ClientContext, OneTimeOAuthTicket,
        PendingEmailChangeOtp, PendingOAuthAuthorization, PendingOAuthOnboarding,
    },
};
use axum::{
    extract::{ConnectInfo, Path as AxumPath, Query, State},
    http::{header, Extensions, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use chrono::Utc;
use icehandnote_core::{
    auth::{
        build_gravatar_url, constant_time_str_eq, encode_basic_client_credentials, form_urlencode,
        generate_email_verification_code, generate_oauth_flow_tokens, hash_email_verification_code,
        mask_email_address, percent_encode_component, sanitize_internal_return_path,
        sign_blog_sso_token, verify_blog_sso_token, BlogSsoClaims, UpdateUserProfileInput,
        UserProfileDto, UserRole,
    },
    error::ErrorCode,
};
use icehandnote_db::TutorialRepository;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid::Uuid;

const OAUTH_STATE_COOKIE: &str = "ihn_oauth_state";

#[derive(Serialize)]
pub struct AuthMeResponse {
    pub authenticated: bool,
    pub user: Option<UserProfileDto>,
    pub learner_key: Option<String>,
    pub dev_sso_enabled: bool,
    pub blog_sso_entry_url: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub identifier: String,
    pub password: String,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginVerifyOtpRequest {
    pub challenge_id: Uuid,
    pub code: String,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginResendOtpRequest {
    pub challenge_id: Uuid,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Deserialize)]
pub struct SendRegisterCodeRequest {
    pub email: String,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub verification_code: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub role: Option<UserRole>,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Deserialize)]
pub struct VerifyResetOtpRequest {
    pub email: String,
    pub otp_code: String,
}

#[derive(Deserialize)]
pub struct CheckUsernameQuery {
    #[serde(default)]
    pub username: String,
}

#[derive(Serialize)]
pub struct CheckUsernameResponse {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

#[derive(Deserialize)]
pub struct ResetPasswordRequest {
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub otp_code: String,
    pub new_password: String,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    #[serde(default)]
    pub current_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct SendEmailChangeCodeRequest {
    pub new_email: String,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Deserialize)]
pub struct VerifyEmailChangeRequest {
    pub new_email: String,
    pub code: String,
}

#[derive(Deserialize)]
pub struct SsoVerifyRequest {
    pub sso_token: String,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
}

#[derive(Deserialize)]
pub struct DevSsoTicketRequest {
    pub preset: String,
}

#[derive(Deserialize)]
pub struct OAuthAuthorizeQuery {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub return_to: Option<String>,
    #[serde(default)]
    pub bind_token: Option<String>,
}

#[derive(Deserialize)]
pub struct OAuthCallbackQuery {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct OAuthExchangeRequest {
    pub ticket: String,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
}

#[derive(Serialize)]
pub struct OAuthOnboardingInfoResponse {
    pub provider: String,
    pub provider_name: String,
    pub suggested_username: String,
    pub display_name: String,
    pub email: String,
    pub oauth_avatar_url: String,
    pub gravatar_preview_url: String,
    pub allow_registration: bool,
    pub allow_author_registration: bool,
}

#[derive(Deserialize)]
pub struct CompleteOAuthRegistrationRequest {
    pub onboarding_token: String,
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    pub email: String,
    #[serde(default)]
    pub role: Option<UserRole>,
    #[serde(default = "default_avatar_source")]
    pub avatar_source: String,
    #[serde(default)]
    pub uploaded_avatar_url: String,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
}

fn default_avatar_source() -> String {
    "oauth".to_string()
}

#[derive(Deserialize)]
pub struct BindExistingOAuthRequest {
    pub onboarding_token: String,
    pub identifier: String,
    pub password: String,
    #[serde(default)]
    pub anonymous_learner_id: Option<String>,
}

fn validate_username(raw: &str) -> Result<&str, ApiError> {
    let clean = raw.trim();
    if clean.len() < 2
        || clean.len() > 32
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ApiError::new(
            ErrorCode::InvalidUsername,
            "Username must be 2–32 characters using letters, digits, underscores, or hyphens.",
        ));
    }
    Ok(clean)
}

fn validate_email(raw: &str) -> Result<&str, ApiError> {
    let clean = raw.trim();
    if !clean.contains('@') || clean.len() > 160 {
        return Err(ApiError::new(
            ErrorCode::InvalidEmail,
            "Please provide a valid email address.",
        ));
    }
    Ok(clean)
}

fn validate_password(raw: &str) -> Result<(), ApiError> {
    if raw.chars().count() < 8 {
        return Err(ApiError::new(
            ErrorCode::PasswordTooShort,
            "Password must be at least 8 characters long.",
        ));
    }
    Ok(())
}

pub async fn auth_me_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let user = if let Some(token) = extract_bearer_token(&headers) {
        state
            .repo
            .get_user_by_session(&token)
            .await
            .map_err(repo_err)?
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

async fn complete_password_login_or_challenge(
    state: &AppState,
    headers: &HeaderMap,
    user: UserProfileDto,
    anon_learner_id: Option<&str>,
    req_locale: Option<&str>,
    ctx: &ClientContext,
) -> Result<Response, ApiError> {
    let anomaly = state
        .repo
        .detect_login_anomaly(user.id, &ctx.ip_address, &ctx.device_fingerprint)
        .await
        .map_err(repo_err)?;

    if let Some(anomaly_reason) = anomaly {
        let (smtp_cfg, smtp_pw) = {
            let secrets = state.runtime_secrets.read().await;
            (secrets.smtp.clone(), secrets.smtp_password.clone())
        };
        let clean_email = user.email.trim();
        let email_deliverable = !clean_email.is_empty()
            && clean_email.contains('@')
            && !clean_email.to_ascii_lowercase().ends_with("@localhost");

        if is_smtp_ready(&smtp_cfg) && email_deliverable {
            let settings = state
                .repo
                .get_site_settings(&state.default_settings)
                .await
                .unwrap_or_else(|_| state.default_settings.clone());
            let origin = detect_external_origin(headers);
            let target_locale =
                resolve_request_locale(req_locale, headers, &settings.default_locale);

            let (challenge_id, raw_code) = state
                .repo
                .create_login_otp_challenge(
                    user.id,
                    clean_email,
                    &ctx.ip_address,
                    &ctx.user_agent,
                    &ctx.device_label,
                    &ctx.device_fingerprint,
                    &anomaly_reason,
                )
                .await
                .map_err(repo_err)?;

            if let Err(err) = send_login_anomaly_otp_email(
                &smtp_cfg,
                &smtp_pw,
                MailBrandContext {
                    site_name: &settings.site_name,
                    logo_url: &settings.logo_url,
                    origin: &origin,
                    locale: target_locale,
                },
                &user.display_name,
                &ctx.ip_address,
                &ctx.device_label,
                &anomaly_reason,
                &raw_code,
                10,
                clean_email,
            )
            .await
            {
                let _ = state.repo.delete_login_otp_challenge(challenge_id).await;
                return Err(ApiError::new(
                    ErrorCode::SmtpSendFailed,
                    format!("Failed to send unusual sign-in verification email: {err}"),
                ));
            }

            return Ok(Json(serde_json::json!({
                "requires_otp": true,
                "challenge_id": challenge_id,
                "masked_email": mask_email_address(clean_email),
                "anomaly_reason": anomaly_reason,
                "ip_address": ctx.ip_address,
                "device_label": ctx.device_label,
                "cooldown_seconds": 60,
                "expires_in_seconds": 600,
            }))
            .into_response());
        } else {
            tracing::warn!(
                user_id = %user.id,
                reason = %anomaly_reason,
                ip = %ctx.ip_address,
                "Anomalous login detected but SMTP is unconfigured or user has no deliverable email; proceeding without email OTP challenge."
            );
        }
    }

    let session = finalize_login_session(state, user, anon_learner_id, ctx).await?;
    Ok(Json(serde_json::json!({
        "requires_otp": false,
        "session_token": session.session_token,
        "user": session.user,
        "learner_key": session.learner_key,
    }))
    .into_response())
}

pub async fn auth_login_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    match state
        .repo
        .authenticate_password(&body.identifier, &body.password)
        .await
    {
        Ok(Some(user)) => {
            return complete_password_login_or_challenge(
                &state,
                &headers,
                user,
                body.anonymous_learner_id.as_deref(),
                body.locale.as_deref(),
                &ctx,
            )
            .await;
        }
        Ok(None) => {}
        Err(e) => return Err(repo_err_or(e, ErrorCode::Forbidden)),
    }

    if let Some(claims) = try_wordpress_remote_login(&state, &body.identifier, &body.password).await
    {
        let user = state
            .repo
            .upsert_blog_user(&claims)
            .await
            .map_err(|e| repo_err_or(e, ErrorCode::Forbidden))?;
        return complete_password_login_or_challenge(
            &state,
            &headers,
            user,
            body.anonymous_learner_id.as_deref(),
            body.locale.as_deref(),
            &ctx,
        )
        .await;
    }

    Err(ApiError::new(
        ErrorCode::InvalidCredentials,
        "Invalid username, email, or password.",
    ))
}

pub async fn auth_login_verify_otp_handler(
    State(state): State<AppState>,
    Json(body): Json<LoginVerifyOtpRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let clean_code = body.code.trim();
    if clean_code.is_empty() {
        return Err(ApiError::new(
            ErrorCode::VerificationCodeRequired,
            "Email verification code is required.",
        ));
    }
    let (user, ip_address, user_agent, device_label, device_fingerprint) = state
        .repo
        .verify_login_otp_challenge(body.challenge_id, clean_code)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::VerificationCodeInvalid))?;

    let verified_ctx = ClientContext {
        ip_address,
        user_agent,
        device_label,
        device_fingerprint,
    };
    let session =
        finalize_login_session(&state, user, body.anonymous_learner_id.as_deref(), &verified_ctx)
            .await?;
    Ok(Json(session))
}

pub async fn auth_login_resend_otp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginResendOtpRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (smtp_cfg, smtp_pw) = {
        let secrets = state.runtime_secrets.read().await;
        (secrets.smtp.clone(), secrets.smtp_password.clone())
    };
    if !is_smtp_ready(&smtp_cfg) {
        return Err(ApiError::new(
            ErrorCode::SmtpNotConfigured,
            "Email service is not configured on this site. Please contact an administrator.",
        ));
    }
    let (user, raw_code, ip_address, device_label, anomaly_reason) = state
        .repo
        .resend_login_otp_challenge(body.challenge_id)
        .await
        .map_err(repo_err)?;

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let origin = detect_external_origin(&headers);
    let target_locale =
        resolve_request_locale(body.locale.as_deref(), &headers, &settings.default_locale);

    send_login_anomaly_otp_email(
        &smtp_cfg,
        &smtp_pw,
        MailBrandContext {
            site_name: &settings.site_name,
            logo_url: &settings.logo_url,
            origin: &origin,
            locale: target_locale,
        },
        &user.display_name,
        &ip_address,
        &device_label,
        &anomaly_reason,
        &raw_code,
        10,
        &user.email,
    )
    .await
    .map_err(|e| {
        ApiError::new(
            ErrorCode::SmtpSendFailed,
            format!("Failed to resend unusual sign-in verification email: {e}"),
        )
    })?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "cooldown_seconds": 60,
        "expires_in_seconds": 600,
    })))
}

pub async fn auth_send_register_code_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SendRegisterCodeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.allow_registration {
        return Err(ApiError::new(
            ErrorCode::RegistrationDisabled,
            "Public account registration is currently disabled.",
        ));
    }

    let clean_email = validate_email(&body.email)?;
    let (smtp_cfg, smtp_pw) = {
        let secrets = state.runtime_secrets.read().await;
        (secrets.smtp.clone(), secrets.smtp_password.clone())
    };
    if !is_smtp_ready(&smtp_cfg) {
        return Err(ApiError::new(
            ErrorCode::SmtpNotConfigured,
            "Email service is not configured on this site. Please contact an administrator.",
        ));
    }

    let (code_id, raw_code) = state
        .repo
        .create_registration_verification_code(clean_email)
        .await
        .map_err(repo_err)?;

    let origin = detect_external_origin(&headers);
    let target_locale =
        resolve_request_locale(body.locale.as_deref(), &headers, &settings.default_locale);

    if let Err(err) = send_registration_code_email(
        &smtp_cfg,
        &smtp_pw,
        MailBrandContext {
            site_name: &settings.site_name,
            logo_url: &settings.logo_url,
            origin: &origin,
            locale: target_locale,
        },
        clean_email,
        &raw_code,
        10,
    )
    .await
    {
        let _ = state
            .repo
            .consume_registration_verification_code(code_id)
            .await;
        return Err(ApiError::new(
            ErrorCode::SmtpSendFailed,
            format!("Failed to send registration verification email: {err}"),
        ));
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "expires_in_seconds": 600,
        "cooldown_seconds": 60,
    })))
}

pub async fn auth_check_username_handler(
    State(state): State<AppState>,
    Query(q): Query<CheckUsernameQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let clean = q.username.trim();
    if clean.len() < 3
        || clean.len() > 32
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Ok(Json(CheckUsernameResponse {
            available: false,
            reason: Some("invalid_format"),
        }));
    }
    let taken = state
        .repo
        .is_username_taken(clean)
        .await
        .map_err(repo_err)?;
    if taken {
        return Ok(Json(CheckUsernameResponse {
            available: false,
            reason: Some("taken"),
        }));
    }
    Ok(Json(CheckUsernameResponse {
        available: true,
        reason: None,
    }))
}

pub async fn auth_register_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.allow_registration {
        return Err(ApiError::new(
            ErrorCode::RegistrationDisabled,
            "Public account registration is currently disabled.",
        ));
    }

    let clean_username = validate_username(&body.username)?;
    let clean_email = validate_email(&body.email)?;
    validate_password(&body.password)?;

    let clean_code = body.verification_code.trim();
    if clean_code.is_empty() {
        return Err(ApiError::new(
            ErrorCode::VerificationCodeRequired,
            "Email verification code is required.",
        ));
    }

    let verified_code_id = state
        .repo
        .verify_registration_verification_code(clean_email, clean_code)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::VerificationCodeInvalid))?;

    let desired_role = match body.role {
        Some(UserRole::Author) if settings.allow_author_registration => UserRole::Author,
        _ => UserRole::Reader,
    };

    let created = state
        .repo
        .register_local_account(
            clean_username,
            body.display_name.trim(),
            clean_email,
            &body.password,
            desired_role,
        )
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::Conflict))?;

    let _ = state
        .repo
        .consume_registration_verification_code(verified_code_id)
        .await;

    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    let session =
        finalize_login_session(&state, created, body.anonymous_learner_id.as_deref(), &ctx).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

pub async fn update_my_profile_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<UpdateUserProfileInput>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let updated = state
        .repo
        .update_user_profile(user.id, input)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::BadRequest))?;
    Ok(Json(updated))
}

pub async fn forgot_password_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let clean_email = validate_email(&body.email)?;
    let (smtp_cfg, smtp_pw) = {
        let secrets = state.runtime_secrets.read().await;
        (secrets.smtp.clone(), secrets.smtp_password.clone())
    };
    if !is_smtp_ready(&smtp_cfg) {
        return Err(ApiError::new(
            ErrorCode::SmtpNotConfigured,
            "Email service is not configured on this site. Please contact an administrator.",
        ));
    }

    let email_key = clean_email.to_ascii_lowercase();
    let now = Utc::now();
    {
        let mut cooldowns = state.forgot_password_cooldowns.lock().await;
        cooldowns.retain(|_, ts| (now - *ts).num_seconds() < 300);
        if let Some(last_sent) = cooldowns.get(&email_key) {
            let elapsed = (now - *last_sent).num_seconds();
            if elapsed < 60 {
                let retry_after = (60 - elapsed).max(1);
                return Err(ApiError::new(
                    ErrorCode::VerificationCodeRateLimited,
                    format!(
                        "Please wait {retry_after} seconds before requesting another verification code."
                    ),
                )
                .with_meta(serde_json::json!({ "retry_after_secs": retry_after })));
            }
        }
    }

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let origin = detect_external_origin(&headers);
    let target_locale =
        resolve_request_locale(body.locale.as_deref(), &headers, &settings.default_locale);

    if let Some((user, raw_token, raw_otp)) = state
        .repo
        .create_password_reset_token(clean_email)
        .await
        .map_err(repo_err)?
    {
        let action_url = format!(
            "{origin}/{target_locale}/auth/reset-password?reset_token={}",
            percent_encode_component(&raw_token)
        );
        send_password_reset_email(
            &smtp_cfg,
            &smtp_pw,
            MailBrandContext {
                site_name: &settings.site_name,
                logo_url: &settings.logo_url,
                origin: &origin,
                locale: target_locale,
            },
            &user.display_name,
            &raw_otp,
            &action_url,
            &user.email,
        )
        .await
        .map_err(|e| {
            ApiError::new(
                ErrorCode::SmtpSendFailed,
                format!("Failed to send password reset email: {e}"),
            )
        })?;
    }

    {
        let mut cooldowns = state.forgot_password_cooldowns.lock().await;
        cooldowns.insert(email_key, now);
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "cooldown_seconds": 60,
    })))
}

pub async fn verify_reset_otp_handler(
    State(state): State<AppState>,
    Json(body): Json<VerifyResetOtpRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let clean_email = validate_email(&body.email)?;
    let clean_code = body.otp_code.trim();
    if clean_code.len() < 6 {
        return Err(ApiError::new(
            ErrorCode::VerificationCodeRequired,
            "Please enter the 6-digit password reset verification code.",
        ));
    }
    let reset_token = state
        .repo
        .verify_password_reset_otp(clean_email, clean_code)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::VerificationCodeInvalid))?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "reset_token": reset_token,
    })))
}

pub async fn reset_password_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<impl IntoResponse, ApiError> {
    validate_password(&body.new_password)?;
    let user = if !body.otp_code.trim().is_empty() {
        let clean_email = validate_email(&body.email)?;
        state
            .repo
            .consume_password_reset_otp(clean_email, body.otp_code.trim(), &body.new_password)
            .await
            .map_err(|e| repo_err_or(e, ErrorCode::VerificationCodeInvalid))?
    } else if !body.token.trim().is_empty() {
        state
            .repo
            .consume_password_reset_token(body.token.trim(), &body.new_password)
            .await
            .map_err(|e| repo_err_or(e, ErrorCode::ResetTokenInvalid))?
    } else {
        return Err(ApiError::new(
            ErrorCode::VerificationCodeRequired,
            "Please provide either a reset verification code or reset link token.",
        ));
    };
    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    let session =
        finalize_login_session(&state, user, body.anonymous_learner_id.as_deref(), &ctx).await?;
    Ok(Json(session))
}

pub async fn auth_list_sessions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let current_token = extract_bearer_token(&headers).unwrap_or_default();
    let sessions = state
        .repo
        .list_user_sessions(user.id, &current_token)
        .await
        .map_err(repo_err)?;
    Ok(Json(sessions))
}

pub async fn auth_revoke_session_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(session_id): AxumPath<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let revoked = state
        .repo
        .revoke_user_session(user.id, session_id)
        .await
        .map_err(repo_err)?;
    if !revoked {
        return Err(ApiError::new(
            ErrorCode::SessionNotFound,
            "Session not found or already revoked.",
        ));
    }
    Ok(Json(serde_json::json!({ "revoked": true })))
}

pub async fn auth_revoke_other_sessions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let current_token = extract_bearer_token(&headers).unwrap_or_default();
    let revoked_count = state
        .repo
        .revoke_other_user_sessions(user.id, &current_token)
        .await
        .map_err(repo_err)?;
    Ok(Json(serde_json::json!({ "revoked_count": revoked_count })))
}

pub async fn change_password_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    validate_password(&body.new_password)?;
    state
        .repo
        .change_user_password(user.id, &body.current_password, &body.new_password)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::InvalidCurrentPassword))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn send_email_change_code_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SendEmailChangeCodeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let clean_email = validate_email(&body.new_email)?;
    if clean_email.eq_ignore_ascii_case(user.email.trim()) {
        return Err(ApiError::new(
            ErrorCode::BadRequest,
            "The new email address is identical to your current email.",
        ));
    }

    if state
        .repo
        .is_email_taken_by_other(clean_email, user.id)
        .await
        .map_err(repo_err)?
    {
        return Err(ApiError::new(
            ErrorCode::EmailTaken,
            "This email address is already registered to another account.",
        ));
    }

    let (smtp_cfg, smtp_pw) = {
        let secrets = state.runtime_secrets.read().await;
        (secrets.smtp.clone(), secrets.smtp_password.clone())
    };
    if !is_smtp_ready(&smtp_cfg) {
        return Err(ApiError::new(
            ErrorCode::SmtpNotConfigured,
            "Email service is not configured on this site. Please contact an administrator.",
        ));
    }

    let now = Utc::now();
    {
        let mut map = state.email_change_otps.lock().await;
        map.retain(|_, v| v.expires_at > now);
        if let Some(existing) = map.get(&user.id) {
            let elapsed = (now - existing.created_at).num_seconds();
            if elapsed < 60 {
                let retry_after = (60 - elapsed).max(1);
                return Err(ApiError::new(
                    ErrorCode::VerificationCodeRateLimited,
                    format!(
                        "Please wait {retry_after} seconds before requesting another verification code."
                    ),
                )
                .with_meta(serde_json::json!({ "retry_after_secs": retry_after })));
            }
        }
    }

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let origin = detect_external_origin(&headers);
    let target_locale =
        resolve_request_locale(body.locale.as_deref(), &headers, &settings.default_locale);

    let (raw_code, code_hash) = generate_email_verification_code(clean_email);
    send_email_change_code_email(
        &smtp_cfg,
        &smtp_pw,
        MailBrandContext {
            site_name: &settings.site_name,
            logo_url: &settings.logo_url,
            origin: &origin,
            locale: target_locale,
        },
        &user.display_name,
        clean_email,
        &raw_code,
        10,
    )
    .await
    .map_err(|e| {
        ApiError::new(
            ErrorCode::SmtpSendFailed,
            format!("Failed to send email change verification code: {e}"),
        )
    })?;

    {
        let mut map = state.email_change_otps.lock().await;
        map.insert(
            user.id,
            PendingEmailChangeOtp {
                new_email: clean_email.to_string(),
                code_hash,
                attempts: 0,
                created_at: now,
                expires_at: now + chrono::Duration::minutes(10),
            },
        );
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "cooldown_seconds": 60,
        "expires_in_seconds": 600,
    })))
}

pub async fn verify_email_change_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<VerifyEmailChangeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated_user(&state, &headers).await?;
    let clean_email = validate_email(&body.new_email)?;
    let clean_code = body.code.trim();
    if clean_code.len() < 6 {
        return Err(ApiError::new(
            ErrorCode::VerificationCodeRequired,
            "Please enter the 6-digit verification code sent to your new email.",
        ));
    }

    let now = Utc::now();
    let submitted_hash = hash_email_verification_code(clean_email, clean_code);
    {
        let mut map = state.email_change_otps.lock().await;
        let Some(entry) = map.get_mut(&user.id) else {
            return Err(ApiError::new(
                ErrorCode::VerificationCodeInvalid,
                "Verification code is invalid or expired.",
            ));
        };
        if entry.expires_at <= now {
            map.remove(&user.id);
            return Err(ApiError::new(
                ErrorCode::VerificationCodeExpired,
                "Verification code has expired. Please request a new code.",
            ));
        }
        if !entry.new_email.eq_ignore_ascii_case(clean_email) {
            return Err(ApiError::new(
                ErrorCode::VerificationCodeInvalid,
                "Email address does not match the verification code.",
            ));
        }
        if !constant_time_str_eq(&entry.code_hash, &submitted_hash) {
            entry.attempts = entry.attempts.saturating_add(1);
            if entry.attempts >= 5 {
                map.remove(&user.id);
            }
            return Err(ApiError::new(
                ErrorCode::VerificationCodeInvalid,
                "Incorrect verification code.",
            ));
        }
        map.remove(&user.id);
    }

    let updated = state
        .repo
        .update_user_email(user.id, clean_email)
        .await
        .map_err(repo_err)?;

    Ok(Json(updated))
}

fn extract_cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw_cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in raw_cookies.split(';') {
        let trimmed = part.trim();
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == name {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn build_state_cookie(value: &str, max_age_secs: i64, is_https: bool) -> String {
    let secure_attr = if is_https { "; Secure" } else { "" };
    format!(
        "{OAUTH_STATE_COOKIE}={value}; Path=/api/v1/auth/oauth; Max-Age={max_age_secs}; HttpOnly; SameSite=Lax{secure_attr}"
    )
}

fn append_query_param(path: &str, key: &str, val: &str) -> String {
    let sep = if path.contains('?') { '&' } else { '?' };
    format!(
        "{path}{sep}{}={}",
        percent_encode_component(key),
        percent_encode_component(val)
    )
}

fn sanitize_suggested_username(raw: &str) -> String {
    let filtered: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(24)
        .collect();
    if filtered.len() >= 2 {
        filtered.to_ascii_lowercase()
    } else {
        format!("user_{}", &uuid::Uuid::new_v4().simple().to_string()[..6])
    }
}

pub async fn oauth_authorize_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<OAuthAuthorizeQuery>,
) -> Result<Response, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;

    let Some(provider) = settings.find_oauth_provider(q.provider.as_deref()) else {
        return Err(ApiError::new(
            ErrorCode::OAuthNotConfigured,
            "OAuth sign-in is not configured on this site.",
        ));
    };

    if !provider.enabled || !provider.is_complete() {
        return Err(ApiError::new(
            ErrorCode::OAuthNotConfigured,
            "Selected OAuth provider is disabled or incomplete.",
        ));
    }

    let mut bind_user_id = None;
    if let Some(bt) = q.bind_token.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(Some(u)) = state.repo.get_user_by_session(bt).await {
            bind_user_id = Some(u.id);
        }
    }

    let origin = detect_external_origin(&headers);
    let is_https = origin.starts_with("https://");
    let redirect_uri = format!("{origin}/api/v1/auth/oauth/callback");
    let return_to = sanitize_internal_return_path(q.return_to.as_deref(), &settings.default_locale);

    let (oauth_state, code_verifier, code_challenge) = generate_oauth_flow_tokens();
    let now = Utc::now().timestamp();

    {
        let mut pending = state.oauth_pending.lock().await;
        pending.retain(|_, v| v.expires_at > now);
        pending.insert(
            oauth_state.clone(),
            PendingOAuthAuthorization {
                provider_id: provider.id.clone(),
                provider_name: provider.display_name().to_string(),
                client_id: provider.client_id.trim().to_string(),
                token_url: provider.token_url.trim().to_string(),
                userinfo_url: provider.userinfo_url.trim().to_string(),
                code_verifier,
                redirect_uri: redirect_uri.clone(),
                return_to,
                bind_user_id,
                expires_at: now + 600,
            },
        );
    }

    let query_str = form_urlencode(&[
        ("response_type", "code"),
        ("client_id", provider.client_id.trim()),
        ("redirect_uri", &redirect_uri),
        ("scope", provider.scopes.trim()),
        ("state", &oauth_state),
        ("code_challenge", &code_challenge),
        ("code_challenge_method", "S256"),
    ]);
    let sep = if provider.authorize_url.contains('?') {
        '&'
    } else {
        '?'
    };
    let target_url = format!("{}{sep}{query_str}", provider.authorize_url.trim());

    let mut resp = Redirect::temporary(&target_url).into_response();
    if let Ok(cookie_hv) = HeaderValue::from_str(&build_state_cookie(&oauth_state, 600, is_https))
    {
        resp.headers_mut().insert(header::SET_COOKIE, cookie_hv);
    }
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    Ok(resp)
}

pub async fn oauth_callback_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<OAuthCallbackQuery>,
) -> Response {
    let origin = detect_external_origin(&headers);
    let is_https = origin.starts_with("https://");
    let clear_cookie = build_state_cookie("", 0, is_https);

    let settings = match state.repo.get_site_settings(&state.default_settings).await {
        Ok(s) => s,
        Err(_) => state.default_settings.clone(),
    };
    let default_return = format!("/{}", settings.default_locale);

    let redirect_with_param = |ret: &str, key: &str, val: &str| -> Response {
        let loc = append_query_param(ret, key, val);
        let mut r = Redirect::temporary(&loc).into_response();
        if let Ok(hv) = HeaderValue::from_str(&clear_cookie) {
            r.headers_mut().insert(header::SET_COOKIE, hv);
        }
        r.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        r.headers_mut()
            .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
        r
    };

    let Some(query_state) = q.state.as_deref().filter(|s| !s.is_empty()) else {
        return redirect_with_param(&default_return, "oauth_error", "invalid_state");
    };
    let Some(cookie_state) = extract_cookie_value(&headers, OAUTH_STATE_COOKIE) else {
        return redirect_with_param(&default_return, "oauth_error", "missing_state");
    };
    if !constant_time_str_eq(query_state, &cookie_state) {
        return redirect_with_param(&default_return, "oauth_error", "state_mismatch");
    }

    let now = Utc::now().timestamp();
    let pending_entry = {
        let mut pending = state.oauth_pending.lock().await;
        pending.retain(|_, v| v.expires_at > now);
        pending.remove(query_state)
    };
    let Some(flow) = pending_entry else {
        return redirect_with_param(&default_return, "oauth_error", "expired_state");
    };

    if let Some(err_code) = q.error.as_deref().filter(|s| !s.is_empty()) {
        return redirect_with_param(&flow.return_to, "oauth_error", err_code);
    }
    let Some(code) = q.code.as_deref().filter(|s| !s.is_empty()) else {
        return redirect_with_param(&flow.return_to, "oauth_error", "missing_code");
    };

    let client_secret = state
        .runtime_secrets
        .read()
        .await
        .resolve_oauth_client_secret(&flow.provider_id);

    let mut form_pairs: Vec<(&str, &str)> = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &flow.redirect_uri),
        ("client_id", flow.client_id.trim()),
        ("code_verifier", &flow.code_verifier),
    ];
    if !client_secret.is_empty() {
        form_pairs.push(("client_secret", &client_secret));
    }
    let form_body = form_urlencode(&form_pairs);

    let mut token_req = state
        .http_client
        .post(flow.token_url.trim())
        .header(
            header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, "IceHandnote")
        .timeout(std::time::Duration::from_secs(12))
        .body(form_body);

    if !client_secret.is_empty() {
        let basic = encode_basic_client_credentials(flow.client_id.trim(), &client_secret);
        token_req = token_req.header(header::AUTHORIZATION, format!("Basic {basic}"));
    }

    let token_val: serde_json::Value = match token_req.send().await {
        Ok(resp) if resp.status().is_success() => match resp.json().await {
            Ok(v) => v,
            Err(_) => {
                return redirect_with_param(&flow.return_to, "oauth_error", "invalid_token_response")
            }
        },
        _ => return redirect_with_param(&flow.return_to, "oauth_error", "token_exchange_failed"),
    };

    if let Some(tok_err) = token_val.get("error").and_then(|v| v.as_str()) {
        if !tok_err.is_empty() {
            return redirect_with_param(&flow.return_to, "oauth_error", "token_rejected");
        }
    }

    if let Some(tok_type) = token_val.get("token_type").and_then(|v| v.as_str()) {
        if !tok_type.is_empty() && !tok_type.eq_ignore_ascii_case("bearer") {
            return redirect_with_param(&flow.return_to, "oauth_error", "unsupported_token_type");
        }
    }

    let Some(access_token) = token_val
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return redirect_with_param(&flow.return_to, "oauth_error", "missing_access_token");
    };

    let profile_val: serde_json::Value = match state
        .http_client
        .get(flow.userinfo_url.trim())
        .bearer_auth(access_token)
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, "IceHandnote")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json().await {
            Ok(v) => v,
            Err(_) => {
                return redirect_with_param(&flow.return_to, "oauth_error", "invalid_userinfo")
            }
        },
        _ => return redirect_with_param(&flow.return_to, "oauth_error", "userinfo_failed"),
    };

    let subject = profile_val
        .get("sub")
        .and_then(|v| {
            v.as_str()
                .map(str::to_string)
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        })
        .or_else(|| {
            profile_val.get("id").and_then(|v| {
                v.as_str()
                    .map(str::to_string)
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
            })
        })
        .unwrap_or_default();

    if subject.trim().is_empty() {
        return redirect_with_param(&flow.return_to, "oauth_error", "missing_subject");
    }

    let username_hint = profile_val
        .get("preferred_username")
        .or_else(|| profile_val.get("login"))
        .or_else(|| profile_val.get("username"))
        .and_then(|v| v.as_str())
        .unwrap_or(&subject);

    let display_name = profile_val
        .get("name")
        .or_else(|| profile_val.get("display_name"))
        .and_then(|v| v.as_str())
        .unwrap_or(username_hint);

    let mut email = profile_val
        .get("email")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if email.is_empty() && flow.userinfo_url.contains("api.github.com/user") {
        if let Ok(em_resp) = state
            .http_client
            .get("https://api.github.com/user/emails")
            .bearer_auth(access_token)
            .header(header::ACCEPT, "application/json")
            .header(header::USER_AGENT, "IceHandnote")
            .timeout(std::time::Duration::from_secs(6))
            .send()
            .await
        {
            if let Ok(arr) = em_resp.json::<Vec<serde_json::Value>>().await {
                if let Some(primary) = arr.iter().find(|item| {
                    item.get("primary").and_then(|v| v.as_bool()).unwrap_or(false)
                        && item
                            .get("verified")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                }) {
                    if let Some(addr) = primary.get("email").and_then(|v| v.as_str()) {
                        email = addr.to_string();
                    }
                }
            }
        }
    }

    let avatar_url = profile_val
        .get("picture")
        .or_else(|| profile_val.get("avatar_url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let provider_display_name = if flow.provider_name.trim().is_empty() {
        "OAuth".to_string()
    } else {
        flow.provider_name.trim().to_string()
    };
    let provider_key = if flow.provider_id.trim().is_empty() {
        provider_display_name.to_ascii_lowercase()
    } else {
        flow.provider_id.trim().to_ascii_lowercase()
    };

    // Case 1: Logged-in user initiated explicit account binding
    if let Some(target_uid) = flow.bind_user_id {
        match state
            .repo
            .bind_oauth_to_user(target_uid, &provider_key, &subject, avatar_url)
            .await
        {
            Ok(_) => return redirect_with_param(&flow.return_to, "oauth_bound", "1"),
            Err(_) => {
                return redirect_with_param(&flow.return_to, "oauth_error", "account_already_bound")
            }
        }
    }

    // Case 2: Existing bound OAuth account -> sign in immediately
    match state
        .repo
        .find_oauth_user(&provider_key, &subject, avatar_url)
        .await
    {
        Ok(Some(user)) => {
            if user.is_banned {
                return redirect_with_param(&flow.return_to, "oauth_error", "account_banned");
            }
            let (one_time_ticket, _, _) = generate_oauth_flow_tokens();
            {
                let mut tickets = state.oauth_tickets.lock().await;
                tickets.retain(|_, v| v.expires_at > now);
                tickets.insert(
                    one_time_ticket.clone(),
                    OneTimeOAuthTicket {
                        user,
                        expires_at: now + 60,
                    },
                );
            }
            return redirect_with_param(&flow.return_to, "oauth_ticket", &one_time_ticket);
        }
        Ok(None) => {}
        Err(_) => return redirect_with_param(&flow.return_to, "oauth_error", "account_lookup_failed"),
    }

    // Case 3: New OAuth entrant -> redirect to site onboarding modal (register role OR bind existing account)
    let (onboarding_token, _, _) = generate_oauth_flow_tokens();
    let suggested_username = sanitize_suggested_username(username_hint);
    let onboarding_display_name = display_name.trim().to_string();
    {
        let mut onboardings = state.oauth_onboardings.lock().await;
        onboardings.retain(|_, v| v.expires_at > now);
        onboardings.insert(
            onboarding_token.clone(),
            PendingOAuthOnboarding {
                provider: provider_key,
                provider_display_name,
                subject,
                suggested_username,
                display_name: onboarding_display_name,
                email: email.trim().to_string(),
                oauth_avatar_url: avatar_url.trim().to_string(),
                expires_at: now + 900,
            },
        );
    }

    redirect_with_param(&flow.return_to, "oauth_onboarding", &onboarding_token)
}

pub async fn oauth_get_onboarding_handler(
    State(state): State<AppState>,
    AxumPath(token): AxumPath<String>,
) -> Result<impl IntoResponse, ApiError> {
    let now = Utc::now().timestamp();
    let entry = {
        let mut onboardings = state.oauth_onboardings.lock().await;
        onboardings.retain(|_, v| v.expires_at > now);
        onboardings.get(token.trim()).cloned()
    };
    let Some(info) = entry else {
        return Err(ApiError::new(
            ErrorCode::OAuthSessionExpired,
            "OAuth authorization session has expired. Please start sign-in again.",
        ));
    };

    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .unwrap_or_else(|_| state.default_settings.clone());
    let gravatar_preview_url = if info.email.is_empty() {
        String::new()
    } else {
        build_gravatar_url(&info.email, &settings.gravatar_base_url)
    };

    Ok(Json(OAuthOnboardingInfoResponse {
        provider: info.provider,
        provider_name: info.provider_display_name,
        suggested_username: info.suggested_username,
        display_name: info.display_name,
        email: info.email,
        oauth_avatar_url: info.oauth_avatar_url,
        gravatar_preview_url,
        allow_registration: settings.allow_registration,
        allow_author_registration: settings.allow_author_registration,
    }))
}

pub async fn oauth_complete_registration_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<CompleteOAuthRegistrationRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state
        .repo
        .get_site_settings(&state.default_settings)
        .await
        .map_err(repo_err)?;
    if !settings.allow_registration {
        return Err(ApiError::new(
            ErrorCode::RegistrationDisabled,
            "New account registration is disabled. Please link an existing account instead.",
        ));
    }

    let clean_username = validate_username(&body.username)?;
    let clean_email = validate_email(&body.email)?;

    let now = Utc::now().timestamp();
    let info = {
        let mut onboardings = state.oauth_onboardings.lock().await;
        onboardings.retain(|_, v| v.expires_at > now);
        onboardings.get(body.onboarding_token.trim()).cloned()
    };
    let Some(onboarding) = info else {
        return Err(ApiError::new(
            ErrorCode::OAuthSessionExpired,
            "OAuth authorization session has expired. Please start sign-in again.",
        ));
    };

    let chosen_role = match body.role {
        Some(UserRole::Author) if settings.allow_author_registration => UserRole::Author,
        _ => UserRole::Reader,
    };

    let user = state
        .repo
        .complete_oauth_registration(
            &onboarding.provider,
            &onboarding.subject,
            clean_username,
            body.display_name.trim(),
            clean_email,
            chosen_role,
            &body.avatar_source,
            &onboarding.oauth_avatar_url,
            &body.uploaded_avatar_url,
        )
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::Conflict))?;

    {
        let mut onboardings = state.oauth_onboardings.lock().await;
        onboardings.remove(body.onboarding_token.trim());
    }

    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    let session =
        finalize_login_session(&state, user, body.anonymous_learner_id.as_deref(), &ctx).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

pub async fn oauth_bind_existing_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<BindExistingOAuthRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let now = Utc::now().timestamp();
    let info = {
        let mut onboardings = state.oauth_onboardings.lock().await;
        onboardings.retain(|_, v| v.expires_at > now);
        onboardings.get(body.onboarding_token.trim()).cloned()
    };
    let Some(onboarding) = info else {
        return Err(ApiError::new(
            ErrorCode::OAuthSessionExpired,
            "OAuth authorization session has expired. Please start sign-in again.",
        ));
    };

    let matched = state
        .repo
        .authenticate_password(&body.identifier, &body.password)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::Forbidden))?;
    let Some(local_user) = matched else {
        return Err(ApiError::new(
            ErrorCode::InvalidCredentials,
            "Invalid account credentials for binding.",
        ));
    };

    let bound_user = state
        .repo
        .bind_oauth_to_user(
            local_user.id,
            &onboarding.provider,
            &onboarding.subject,
            &onboarding.oauth_avatar_url,
        )
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::Conflict))?;

    {
        let mut onboardings = state.oauth_onboardings.lock().await;
        onboardings.remove(body.onboarding_token.trim());
    }

    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    let session =
        finalize_login_session(&state, bound_user, body.anonymous_learner_id.as_deref(), &ctx)
            .await?;
    Ok(Json(session))
}

pub async fn oauth_exchange_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<OAuthExchangeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let now = Utc::now().timestamp();
    let entry = {
        let mut tickets = state.oauth_tickets.lock().await;
        tickets.retain(|_, v| v.expires_at > now);
        tickets.remove(body.ticket.trim())
    };
    let Some(valid) = entry else {
        return Err(ApiError::new(
            ErrorCode::OAuthTicketInvalid,
            "OAuth login ticket is invalid or has expired.",
        ));
    };

    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    let session: AuthSessionResponse = finalize_login_session(
        &state,
        valid.user,
        body.anonymous_learner_id.as_deref(),
        &ctx,
    )
    .await?;

    let mut resp = Json(session).into_response();
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(resp)
}

pub async fn auth_sso_verify_handler(
    State(state): State<AppState>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<SsoVerifyRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let claims = verify_blog_sso_token(&body.sso_token, &state.blog_sso_secret).map_err(|e| {
        ApiError::new(
            ErrorCode::SsoInvalidSignature,
            format!("External SSO signature verification failed: {e}"),
        )
    })?;

    let user = state
        .repo
        .upsert_blog_user(&claims)
        .await
        .map_err(|e| repo_err_or(e, ErrorCode::Forbidden))?;
    let ctx = extract_client_context(
        &headers,
        extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip()),
    );
    let session =
        finalize_login_session(&state, user, body.anonymous_learner_id.as_deref(), &ctx).await?;
    Ok(Json(session))
}

pub async fn auth_dev_sso_ticket_handler(
    State(state): State<AppState>,
    Json(body): Json<DevSsoTicketRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if !state.dev_sso_simulator {
        return Err(ApiError::new(
            ErrorCode::DevSsoDisabled,
            "Development SSO simulator is disabled.",
        ));
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

pub async fn auth_logout_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(token) = extract_bearer_token(&headers) {
        state.repo.delete_session(&token).await.map_err(repo_err)?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
