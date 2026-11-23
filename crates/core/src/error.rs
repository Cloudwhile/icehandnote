use serde::{Deserialize, Serialize};
use std::fmt;

/// Canonical machine-readable error codes shared between the RFC 9457 Problem Details API
/// and the frontend i18n Toast / Alert interceptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    BadRequest,
    Unauthorized,
    SessionExpired,
    Forbidden,
    NotFound,
    Conflict,
    PayloadTooLarge,
    UnsupportedMediaType,
    BadGateway,
    ServiceUnavailable,
    InternalError,
    // Auth & Account
    InvalidCredentials,
    AccountBanned,
    RegistrationDisabled,
    UsernameTaken,
    EmailTaken,
    InvalidUsername,
    InvalidEmail,
    PasswordTooShort,
    InvalidCurrentPassword,
    ResetTokenInvalid,
    VerificationCodeRequired,
    VerificationCodeInvalid,
    VerificationCodeExpired,
    VerificationCodeRateLimited,
    OtpChallengeInvalid,
    OtpChallengeExpired,
    SessionNotFound,
    SsoInvalidSignature,
    DevSsoDisabled,
    // OAuth & Passkeys
    OAuthNotConfigured,
    OAuthSessionExpired,
    OAuthTicketInvalid,
    OAuthAlreadyBound,
    CannotUnbindLastAuth,
    PasskeysDisabled,
    PasskeyInvalid,
    PasskeyNotFound,
    // Uploads
    UploadEmpty,
    UploadTooLarge,
    UploadMissingField,
    MediaNotFound,
    // Content & Studio
    StepNotFound,
    TrackNotFound,
    ChapterNotFound,
    TrackSlugExists,
    ChapterSlugExists,
    InvalidSlug,
    StepSaveRequired,
    StepTakenDown,
    StepEditForbidden,
    StepDeleteForbidden,
    NoteContentEmpty,
    NoteTooLong,
    NoteNotFound,
    NoteQuotaExceeded,
    PreconditionFailed,
    PreconditionRequired,
    RateLimited,
    TitleOrSlugRequired,
    // Collaboration
    RevisionConflict,
    RevisionNotFound,
    DraftAccessForbidden,
    InviteInvalid,
    InviteNotFound,
    InviteExpired,
    InviteEmailMismatch,
    InviteAlreadyMember,
    InviteForbidden,
    InviteTargetDeleted,
    CollaboratorForbidden,
    CollaboratorRoleForbidden,
    // Admin / Settings / Storage / SMTP
    CannotModifySelf,
    UserNotFound,
    SiteNameRequired,
    InvalidUrl,
    InvalidLogoUrl,
    MinOneLocale,
    StorageUrlRequired,
    StorageModeInvalid,
    StorageConnectionFailed,
    SmtpNotConfigured,
    SmtpSendFailed,
    MailDomainInvalid,
    MailRecipientSuppressed,
    MailCircuitOpen,
    MailSendInProgress,
    TakedownReasonRequired,
    UpstreamError,
}

impl ErrorCode {
    pub fn as_code_str(&self) -> &'static str {
        match self {
            Self::BadRequest => "BAD_REQUEST",
            Self::Unauthorized => "UNAUTHORIZED",
            Self::SessionExpired => "SESSION_EXPIRED",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "NOT_FOUND",
            Self::Conflict => "CONFLICT",
            Self::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
            Self::UnsupportedMediaType => "UNSUPPORTED_MEDIA_TYPE",
            Self::BadGateway => "BAD_GATEWAY",
            Self::ServiceUnavailable => "SERVICE_UNAVAILABLE",
            Self::InternalError => "INTERNAL_ERROR",
            Self::InvalidCredentials => "INVALID_CREDENTIALS",
            Self::AccountBanned => "ACCOUNT_BANNED",
            Self::RegistrationDisabled => "REGISTRATION_DISABLED",
            Self::UsernameTaken => "USERNAME_TAKEN",
            Self::EmailTaken => "EMAIL_TAKEN",
            Self::InvalidUsername => "INVALID_USERNAME",
            Self::InvalidEmail => "INVALID_EMAIL",
            Self::PasswordTooShort => "PASSWORD_TOO_SHORT",
            Self::InvalidCurrentPassword => "INVALID_CURRENT_PASSWORD",
            Self::ResetTokenInvalid => "RESET_TOKEN_INVALID",
            Self::VerificationCodeRequired => "VERIFICATION_CODE_REQUIRED",
            Self::VerificationCodeInvalid => "VERIFICATION_CODE_INVALID",
            Self::VerificationCodeExpired => "VERIFICATION_CODE_EXPIRED",
            Self::VerificationCodeRateLimited => "VERIFICATION_CODE_RATE_LIMITED",
            Self::OtpChallengeInvalid => "OTP_CHALLENGE_INVALID",
            Self::OtpChallengeExpired => "OTP_CHALLENGE_EXPIRED",
            Self::SessionNotFound => "SESSION_NOT_FOUND",
            Self::SsoInvalidSignature => "SSO_INVALID_SIGNATURE",
            Self::DevSsoDisabled => "DEV_SSO_DISABLED",
            Self::OAuthNotConfigured => "OAUTH_NOT_CONFIGURED",
            Self::OAuthSessionExpired => "OAUTH_SESSION_EXPIRED",
            Self::OAuthTicketInvalid => "OAUTH_TICKET_INVALID",
            Self::OAuthAlreadyBound => "OAUTH_ALREADY_BOUND",
            Self::CannotUnbindLastAuth => "CANNOT_UNBIND_LAST_AUTH",
            Self::PasskeysDisabled => "PASSKEYS_DISABLED",
            Self::PasskeyInvalid => "PASSKEY_INVALID",
            Self::PasskeyNotFound => "PASSKEY_NOT_FOUND",
            Self::UploadEmpty => "UPLOAD_EMPTY",
            Self::UploadTooLarge => "UPLOAD_TOO_LARGE",
            Self::UploadMissingField => "UPLOAD_MISSING_FIELD",
            Self::MediaNotFound => "MEDIA_NOT_FOUND",
            Self::StepNotFound => "STEP_NOT_FOUND",
            Self::TrackNotFound => "TRACK_NOT_FOUND",
            Self::ChapterNotFound => "CHAPTER_NOT_FOUND",
            Self::TrackSlugExists => "TRACK_SLUG_EXISTS",
            Self::ChapterSlugExists => "CHAPTER_SLUG_EXISTS",
            Self::InvalidSlug => "INVALID_SLUG",
            Self::StepSaveRequired => "STEP_SAVE_REQUIRED",
            Self::StepTakenDown => "STEP_TAKEN_DOWN",
            Self::StepEditForbidden => "STEP_EDIT_FORBIDDEN",
            Self::StepDeleteForbidden => "STEP_DELETE_FORBIDDEN",
            Self::NoteContentEmpty => "NOTE_CONTENT_EMPTY",
            Self::NoteTooLong => "NOTE_TOO_LONG",
            Self::NoteNotFound => "NOTE_NOT_FOUND",
            Self::NoteQuotaExceeded => "NOTE_QUOTA_EXCEEDED",
            Self::PreconditionFailed => "PRECONDITION_FAILED",
            Self::PreconditionRequired => "PRECONDITION_REQUIRED",
            Self::RateLimited => "RATE_LIMITED",
            Self::TitleOrSlugRequired => "TITLE_OR_SLUG_REQUIRED",
            Self::RevisionConflict => "REVISION_CONFLICT",
            Self::RevisionNotFound => "REVISION_NOT_FOUND",
            Self::DraftAccessForbidden => "DRAFT_ACCESS_FORBIDDEN",
            Self::InviteInvalid => "INVITE_INVALID",
            Self::InviteNotFound => "INVITE_NOT_FOUND",
            Self::InviteExpired => "INVITE_EXPIRED",
            Self::InviteEmailMismatch => "INVITE_EMAIL_MISMATCH",
            Self::InviteAlreadyMember => "INVITE_ALREADY_MEMBER",
            Self::InviteForbidden => "INVITE_FORBIDDEN",
            Self::InviteTargetDeleted => "INVITE_TARGET_DELETED",
            Self::CollaboratorForbidden => "COLLABORATOR_FORBIDDEN",
            Self::CollaboratorRoleForbidden => "COLLABORATOR_ROLE_FORBIDDEN",
            Self::CannotModifySelf => "CANNOT_MODIFY_SELF",
            Self::UserNotFound => "USER_NOT_FOUND",
            Self::SiteNameRequired => "SITE_NAME_REQUIRED",
            Self::InvalidUrl => "INVALID_URL",
            Self::InvalidLogoUrl => "INVALID_LOGO_URL",
            Self::MinOneLocale => "MIN_ONE_LOCALE",
            Self::StorageUrlRequired => "STORAGE_URL_REQUIRED",
            Self::StorageModeInvalid => "STORAGE_MODE_INVALID",
            Self::StorageConnectionFailed => "STORAGE_CONNECTION_FAILED",
            Self::SmtpNotConfigured => "SMTP_NOT_CONFIGURED",
            Self::SmtpSendFailed => "SMTP_SEND_FAILED",
            Self::MailDomainInvalid => "MAIL_DOMAIN_INVALID",
            Self::MailRecipientSuppressed => "MAIL_RECIPIENT_SUPPRESSED",
            Self::MailCircuitOpen => "MAIL_CIRCUIT_OPEN",
            Self::MailSendInProgress => "MAIL_SEND_IN_PROGRESS",
            Self::TakedownReasonRequired => "TAKEDOWN_REASON_REQUIRED",
            Self::UpstreamError => "UPSTREAM_ERROR",
        }
    }

    pub fn type_uri(&self) -> String {
        format!(
            "urn:icehandnote:error:{}",
            self.as_code_str().to_ascii_lowercase()
        )
    }

    pub fn http_status_code(&self) -> u16 {
        match self {
            Self::BadRequest
            | Self::InvalidUsername
            | Self::InvalidEmail
            | Self::PasswordTooShort
            | Self::InvalidCurrentPassword
            | Self::ResetTokenInvalid
            | Self::VerificationCodeRequired
            | Self::VerificationCodeInvalid
            | Self::VerificationCodeExpired
            | Self::OtpChallengeInvalid
            | Self::OtpChallengeExpired
            | Self::UploadEmpty
            | Self::UploadMissingField
            | Self::InvalidSlug
            | Self::StepSaveRequired
            | Self::NoteContentEmpty
            | Self::TitleOrSlugRequired
            | Self::InviteInvalid
            | Self::CannotModifySelf
            | Self::SiteNameRequired
            | Self::InvalidUrl
            | Self::InvalidLogoUrl
            | Self::MinOneLocale
            | Self::StorageUrlRequired
            | Self::StorageModeInvalid
            | Self::TakedownReasonRequired
            | Self::OAuthNotConfigured
            | Self::CannotUnbindLastAuth
            | Self::PasskeyInvalid => 400,

            Self::Unauthorized
            | Self::SessionExpired
            | Self::InvalidCredentials
            | Self::SsoInvalidSignature
            | Self::OAuthSessionExpired
            | Self::OAuthTicketInvalid => 401,

            Self::Forbidden
            | Self::AccountBanned
            | Self::RegistrationDisabled
            | Self::DevSsoDisabled
            | Self::PasskeysDisabled
            | Self::StepTakenDown
            | Self::StepEditForbidden
            | Self::StepDeleteForbidden
            | Self::DraftAccessForbidden
            | Self::InviteEmailMismatch
            | Self::InviteForbidden
            | Self::CollaboratorForbidden
            | Self::CollaboratorRoleForbidden => 403,

            Self::NotFound
            | Self::MediaNotFound
            | Self::StepNotFound
            | Self::TrackNotFound
            | Self::ChapterNotFound
            | Self::NoteNotFound
            | Self::RevisionNotFound
            | Self::InviteNotFound
            | Self::InviteTargetDeleted
            | Self::UserNotFound
            | Self::SessionNotFound
            | Self::PasskeyNotFound => 404,

            Self::Conflict
            | Self::UsernameTaken
            | Self::EmailTaken
            | Self::OAuthAlreadyBound
            | Self::TrackSlugExists
            | Self::ChapterSlugExists
            | Self::InviteAlreadyMember => 409,

            Self::InviteExpired => 410,
            Self::PreconditionFailed | Self::RevisionConflict => 412,
            Self::PayloadTooLarge | Self::UploadTooLarge => 413,
            Self::UnsupportedMediaType => 415,
            Self::NoteTooLong
            | Self::NoteQuotaExceeded
            | Self::MailDomainInvalid
            | Self::MailRecipientSuppressed => 422,
            Self::PreconditionRequired => 428,
            Self::VerificationCodeRateLimited | Self::RateLimited | Self::MailSendInProgress => 429,
            Self::BadGateway
            | Self::StorageConnectionFailed
            | Self::SmtpSendFailed
            | Self::UpstreamError => 502,
            Self::ServiceUnavailable | Self::SmtpNotConfigured | Self::MailCircuitOpen => 503,
            Self::InternalError => 500,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DomainError {
    pub code: ErrorCode,
    pub detail: String,
    pub meta: Option<serde_json::Value>,
}

impl DomainError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
            meta: None,
        }
    }

    pub fn with_meta(mut self, meta: serde_json::Value) -> Self {
        self.meta = Some(meta);
        self
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.detail)
    }
}

impl std::error::Error for DomainError {}
