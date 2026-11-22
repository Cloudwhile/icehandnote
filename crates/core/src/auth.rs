pub use crate::crypto::*;
pub use crate::settings::*;
pub use crate::webauthn::UserPasskeyDto;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Reader,
    Author,
    Admin,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Reader => "reader",
            Self::Author => "author",
            Self::Admin => "admin",
        }
    }

    pub fn from_db(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "admin" => Self::Admin,
            "author" => Self::Author,
            _ => Self::Reader,
        }
    }

    pub fn from_wordpress_roles(wp_roles: &[String]) -> Self {
        let normalized: Vec<String> = wp_roles.iter().map(|r| r.to_ascii_lowercase()).collect();
        if normalized.iter().any(|r| r == "administrator") {
            Self::Admin
        } else if normalized.iter().any(|r| r == "editor" || r == "author") {
            Self::Author
        } else {
            Self::Reader
        }
    }

    pub fn can_author(&self) -> bool {
        matches!(self, Self::Author | Self::Admin)
    }

    pub fn is_admin(&self) -> bool {
        matches!(self, Self::Admin)
    }
}

fn default_avatar_source() -> String {
    "default".to_string()
}

pub fn normalize_avatar_source(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "oauth" => "oauth".to_string(),
        "gravatar" => "gravatar".to_string(),
        "upload" => "upload".to_string(),
        _ => "default".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileDto {
    pub id: Uuid,
    pub wp_user_id: Option<i64>,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub avatar_url: String,
    #[serde(default = "default_avatar_source")]
    pub avatar_source: String,
    #[serde(default)]
    pub oauth_avatar_url: String,
    #[serde(default)]
    pub uploaded_avatar_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_provider: Option<String>,
    #[serde(default)]
    pub oauth_bindings: Vec<String>,
    #[serde(default)]
    pub has_password: bool,
    pub bio: String,
    pub role: UserRole,
    pub auth_source: String,
    #[serde(default)]
    pub is_banned: bool,
    #[serde(default)]
    pub ban_reason: String,
    pub last_login_at: DateTime<Utc>,
}

impl UserProfileDto {
    pub fn with_resolved_avatar(mut self, gravatar_base_url: &str) -> Self {
        self.avatar_url = crate::crypto::resolve_avatar_url(
            &self.avatar_source,
            &self.email,
            &self.oauth_avatar_url,
            &self.uploaded_avatar_url,
            &self.avatar_url,
            gravatar_base_url,
        );
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleAuthorDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Uuid>,
    pub username: String,
    pub display_name: String,
    #[serde(default)]
    pub avatar_url: String,
    #[serde(default)]
    pub is_owner: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollaboratorInviteDto {
    pub id: Uuid,
    pub email: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSessionDto {
    pub id: Uuid,
    pub ip_address: String,
    pub user_agent: String,
    pub device_label: String,
    pub device_kind: String, // "desktop" | "mobile" | "tablet" | "unknown"
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub is_current: bool,
}

pub fn normalize_supported_locale(raw: Option<&str>, fallback: &str) -> &'static str {
    let pick = |candidate: &str| -> Option<&'static str> {
        let lower = candidate.trim().to_ascii_lowercase();
        if lower.is_empty() {
            return None;
        }
        if lower == "zh-cn" || lower.starts_with("zh-hans") || lower == "zh" {
            Some("zh-CN")
        } else if lower == "zh-tw"
            || lower == "zh-hk"
            || lower == "zh-mo"
            || lower.starts_with("zh-hant")
        {
            Some("zh-TW")
        } else if lower == "ja" || lower.starts_with("ja-") {
            Some("ja")
        } else if lower == "en" || lower.starts_with("en-") {
            Some("en")
        } else {
            None
        }
    };
    if let Some(r) = raw {
        if let Some(found) = pick(r) {
            return found;
        }
    }
    pick(fallback).unwrap_or("en")
}

/// Maximum accepted email address length matching database `VARCHAR(180)` storage limits.
pub const MAX_EMAIL_LEN: usize = 180;

fn is_valid_email_atext(b: u8) -> bool {
    b.is_ascii_alphanumeric()
        || matches!(
            b,
            b'!' | b'#'
                | b'$'
                | b'%'
                | b'&'
                | b'\''
                | b'*'
                | b'+'
                | b'-'
                | b'/'
                | b'='
                | b'?'
                | b'^'
                | b'_'
                | b'`'
                | b'{'
                | b'|'
                | b'}'
                | b'~'
        )
}

/// Validate a bare RFC 5321/5322/1035/5891 email `addr-spec` and canonicalize it
/// (trims whitespace, preserves local-part case, lowercases the DNS domain).
pub fn validate_and_normalize_email(raw: &str) -> Option<String> {
    let clean = raw.trim();
    if clean.is_empty() || clean.len() > MAX_EMAIL_LEN {
        return None;
    }
    if clean.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }

    let (local, domain) = clean.split_once('@')?;
    if domain.contains('@') {
        return None;
    }

    if local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || !local.bytes().all(|b| b == b'.' || is_valid_email_atext(b))
    {
        return None;
    }

    if domain.len() < 3
        || domain.len() > 253
        || domain.starts_with('.')
        || domain.ends_with('.')
    {
        return None;
    }

    let domain_lower = domain.to_ascii_lowercase();
    let labels: Vec<&str> = domain_lower.split('.').collect();
    if labels.len() < 2 {
        return None;
    }

    for &label in &labels {
        let bytes = label.as_bytes();
        if bytes.is_empty() || bytes.len() > 63 {
            return None;
        }
        if !bytes[0].is_ascii_alphanumeric() || !bytes[bytes.len() - 1].is_ascii_alphanumeric() {
            return None;
        }
        if !bytes.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'-') {
            return None;
        }
        if label.starts_with("xn--") && (label.len() < 6 || label[4..].starts_with('-')) {
            return None;
        }
    }

    let tld = *labels.last()?;
    if tld.len() < 2 || tld.len() > 63 {
        return None;
    }
    if matches!(tld, "localhost" | "local" | "invalid") {
        return None;
    }
    let valid_tld = tld.bytes().all(|b| b.is_ascii_alphabetic())
        || (tld.starts_with("xn--")
            && tld.len() >= 6
            && !tld[4..].starts_with('-')
            && tld[4..].bytes().any(|b| b.is_ascii_alphabetic()));
    if !valid_tld {
        return None;
    }

    Some(format!("{local}@{domain_lower}"))
}

/// Returns `true` when `raw` parses as a syntactically valid routable `addr-spec` email.
pub fn is_valid_email(raw: &str) -> bool {
    validate_and_normalize_email(raw).is_some()
}

/// Returns `true` when an email is both valid AND not an RFC 2606 / RFC 6761 documentation,
/// test, or Null-MX sinkhole address (`@localhost`, `.invalid`, `.test`, `example.com`, etc.),
/// so automatic background notifications are skipped cleanly.
pub fn is_deliverable_email(raw: &str) -> bool {
    let Some(norm) = validate_and_normalize_email(raw) else {
        return false;
    };
    let Some((_, domain_lower)) = norm.split_once('@') else {
        return false;
    };
    let is_reserved_sinkhole = matches!(
        domain_lower,
        "example.com" | "example.net" | "example.org"
    ) || domain_lower.ends_with(".example.com")
        || domain_lower.ends_with(".example.net")
        || domain_lower.ends_with(".example.org")
        || domain_lower.ends_with(".example")
        || domain_lower.ends_with(".test");
    !is_reserved_sinkhole
}

/// Mask an email address for UI hints (e.g. `alice@example.com` -> `al***@example.com`).
pub fn mask_email_address(email: &str) -> String {
    let trimmed = email.trim();
    let Some((local, domain)) = trimmed.split_once('@') else {
        return "***".to_string();
    };
    let chars: Vec<char> = local.chars().collect();
    let masked_local = if chars.len() <= 2 {
        format!("{}***", chars.first().copied().unwrap_or('*'))
    } else {
        let head: String = chars.iter().take(2).collect();
        let tail = chars.last().copied().unwrap_or('*');
        format!("{head}***{tail}")
    };
    format!("{masked_local}@{domain}")
}

/// Parse a raw User-Agent string into `(human_device_label, device_kind)`.
pub fn parse_user_agent_device(ua: &str) -> (String, String) {
    let lower = ua.to_ascii_lowercase();
    if lower.trim().is_empty() {
        return ("Unknown Device".to_string(), "unknown".to_string());
    }

    let browser = if lower.contains("edg/") || lower.contains("edga/") || lower.contains("edgios/")
    {
        "Edge"
    } else if lower.contains("opr/") || lower.contains("opera") {
        "Opera"
    } else if lower.contains("firefox/") || lower.contains("fxios/") {
        "Firefox"
    } else if lower.contains("chrome/") || lower.contains("crios/") {
        "Chrome"
    } else if lower.contains("safari/") && !lower.contains("chrome/") {
        "Safari"
    } else if lower.contains("curl/") {
        "curl"
    } else {
        "Browser"
    };

    let (os, kind) = if lower.contains("ipad") || lower.contains("tablet") {
        ("iPadOS / Tablet", "tablet")
    } else if lower.contains("iphone") {
        ("iOS", "mobile")
    } else if lower.contains("android") {
        if lower.contains("mobile") {
            ("Android", "mobile")
        } else {
            ("Android Tablet", "tablet")
        }
    } else if lower.contains("windows nt") || lower.contains("windows") {
        ("Windows", "desktop")
    } else if lower.contains("mac os x") || lower.contains("macintosh") {
        ("macOS", "desktop")
    } else if lower.contains("cros") {
        ("ChromeOS", "desktop")
    } else if lower.contains("linux") {
        ("Linux", "desktop")
    } else {
        ("Unknown OS", "unknown")
    };

    (format!("{browser} · {os}"), kind.to_string())
}

/// Derive a stable normalized device fingerprint from optional client device ID + UA browser/OS.
pub fn compute_device_fingerprint(client_device_id: Option<&str>, ua: &str) -> String {
    let (label, _) = parse_user_agent_device(ua);
    let clean_id = client_device_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(64).collect::<String>())
        .unwrap_or_default();
    if clean_id.is_empty() {
        format!("ua:{}", label.to_ascii_lowercase())
    } else {
        format!("dev:{}:{}", clean_id, label.to_ascii_lowercase())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioLocaleBadgeDto {
    pub locale: String,
    pub status: String, // "published" | "draft"
    pub synced_revision: i32,
    pub updated_at: DateTime<Utc>,
}

fn default_one() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioStepRowDto {
    pub step_id: Uuid,
    pub slug: String,
    pub step_number: i32,
    pub title: String,
    pub canonical_revision: i32,
    #[serde(default = "default_one")]
    pub version: i32,
    pub estimated_minutes: i32,
    #[serde(default)]
    pub authors: Vec<ArticleAuthorDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_by: Option<String>,
    pub translations: Vec<StudioLocaleBadgeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioChapterDto {
    pub chapter_id: Uuid,
    pub slug: String,
    pub number: i32,
    pub title: String,
    pub steps: Vec<StudioStepRowDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioTrackDto {
    pub track_id: Uuid,
    pub slug: String,
    pub title: String,
    pub difficulty: String,
    pub icon_kind: String,
    pub is_published: bool,
    pub chapters: Vec<StudioChapterDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioStepEditorDto {
    pub track_slug: String,
    pub chapter_slug: String,
    pub step_slug: String,
    pub locale: String,
    pub exists: bool,
    pub title: String,
    pub summary: String,
    pub step_number: i32,
    pub estimated_minutes: i32,
    pub synced_revision: i32,
    pub canonical_revision: i32,
    #[serde(default = "default_one")]
    pub version: i32,
    pub status: String,
    #[serde(default)]
    pub license: String,
    pub tags: Vec<String>,
    pub body_markdown: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<Uuid>,
    #[serde(default)]
    pub authors: Vec<ArticleAuthorDto>,
    #[serde(default)]
    pub pending_invites: Vec<CollaboratorInviteDto>,
    #[serde(default)]
    pub can_manage_collaborators: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_by: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveStudioStepInput {
    pub track_slug: String,
    pub chapter_slug: String,
    pub step_slug: String,
    pub locale: String,
    pub title: String,
    pub summary: String,
    pub step_number: i32,
    #[serde(default)]
    pub estimated_minutes: i32,
    #[serde(default = "default_one")]
    pub synced_revision: i32,
    #[serde(default)]
    pub bump_canonical: bool,
    pub status: String,
    #[serde(default)]
    pub license: String,
    pub tags: Vec<String>,
    pub body_markdown: String,
    #[serde(default = "default_write_disk")]
    pub write_to_content_dir: bool,
}

fn default_write_disk() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateTrackInput {
    pub slug: String,
    pub difficulty: String,
    pub icon_kind: String,
    pub tags: Vec<String>,
    pub title_zh_tw: String,
    pub subtitle_zh_tw: String,
    pub description_zh_tw: String,
    pub first_chapter_slug: String,
    pub first_chapter_title: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateChapterInput {
    pub track_slug: String,
    pub slug: String,
    pub number: i32,
    pub title_zh_tw: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateUserProfileInput {
    pub display_name: String,
    #[serde(default)]
    pub bio: String,
    pub avatar_source: String,
    #[serde(default)]
    pub uploaded_avatar_url: String,
}

pub fn format_step_markdown_file(
    title: &str,
    summary: &str,
    step_number: i32,
    estimated_minutes: i32,
    synced_revision: i32,
    canonical_revision: i32,
    status: &str,
    license: &str,
    tags: &[String],
    body_markdown: &str,
) -> String {
    format_step_markdown_file_with_author(
        title,
        summary,
        step_number,
        estimated_minutes,
        synced_revision,
        canonical_revision,
        status,
        license,
        "",
        tags,
        body_markdown,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn format_step_markdown_file_with_author(
    title: &str,
    summary: &str,
    step_number: i32,
    estimated_minutes: i32,
    synced_revision: i32,
    canonical_revision: i32,
    status: &str,
    license: &str,
    author: &str,
    tags: &[String],
    body_markdown: &str,
) -> String {
    let escaped_title = title.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_summary = summary.replace('\\', "\\\\").replace('"', "\\\"");
    let clean_status = if status == "draft" {
        "draft"
    } else {
        "published"
    };
    let clean_license = crate::normalize_license_code(license);
    let license_line = if clean_license.is_empty() {
        String::new()
    } else {
        format!("license = \"{clean_license}\"\n")
    };
    let author_line = if author.trim().is_empty() {
        String::new()
    } else {
        let escaped_author = author.trim().replace('\\', "\\\\").replace('"', "\\\"");
        format!("author = \"{escaped_author}\"\n")
    };
    let tags_toml = tags
        .iter()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "+++\ntitle = \"{escaped_title}\"\nsummary = \"{escaped_summary}\"\nstep_number = {step_number}\nestimated_minutes = {estimated_minutes}\nsynced_revision = {synced_revision}\ncanonical_revision = {canonical_revision}\nstatus = \"{clean_status}\"\n{license_line}{author_line}tags = [{tags_toml}]\n+++\n\n{}\n",
        body_markdown.trim()
    )
}

pub fn extract_body_without_frontmatter(raw: &str) -> String {
    let normalized = raw.trim_start_matches('\u{feff}');
    if let Some(rest) = normalized.strip_prefix("+++") {
        if let Some(end_idx) = rest.find("\n+++") {
            let body = &rest[end_idx + 4..];
            return body.trim_start_matches(['\r', '\n']).to_string();
        }
    }
    normalized.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use sha2::{Digest, Sha256};

    #[test]
    fn signs_and_verifies_blog_sso_ticket() {
        let secret = "icehandnote-super-secret-bridge-key-2026";
        let now = Utc::now().timestamp();
        let claims = BlogSsoClaims {
            wp_user_id: 1,
            username: "admin".to_string(),
            display_name: "Admin".to_string(),
            email: "admin@example.com".to_string(),
            avatar_url: "https://blog.example.com/avatar.png".to_string(),
            wp_roles: vec!["administrator".to_string()],
            blog_origin: "https://blog.example.com".to_string(),
            iat: now,
            exp: now + 300,
        };

        let token = sign_blog_sso_token(&claims, secret).unwrap();
        let verified = verify_blog_sso_token(&token, secret).unwrap();
        assert_eq!(verified.wp_user_id, 1);
        assert_eq!(
            UserRole::from_wordpress_roles(&verified.wp_roles),
            UserRole::Admin
        );
        assert!(verify_blog_sso_token(&token, "wrong-secret").is_err());
    }

    #[test]
    fn argon2_password_round_trip_and_legacy_fallback() {
        let hash = hash_password("admin", "correct horse battery");
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password("admin", "correct horse battery", &hash));
        assert!(!verify_password("admin", "wrong", &hash));
        assert_ne!(hash, hash_password("admin", "correct horse battery"));

        let legacy = crate::crypto::legacy_sha256_password("demo_reader", "reader2026");
        assert!(is_legacy_password_hash(&legacy));
        assert!(verify_password("demo_reader", "reader2026", &legacy));
        assert!(!verify_password("demo_reader", "nope", &legacy));
    }

    #[test]
    fn sanitizes_site_settings_and_allows_safe_custom_html() {
        let mut s = SiteSettingsDto::default_with_env("zh-CN", "https://blog.example.com/");
        assert_eq!(s.blog_origin_url, "https://blog.example.com");
        assert_eq!(s.blog_nav_label, "blog.example.com");
        s.hero_title =
            "欢迎来到 <mark>IceHandnote</mark><script>alert(1)</script>".to_string();
        s.gravatar_base_url = "https://cravatar.cn/avatar/".to_string();
        let clean = s.sanitize().unwrap();
        assert!(clean.hero_title.contains("<mark>IceHandnote</mark>"));
        assert!(!clean.hero_title.contains("<script"));
        assert_eq!(clean.gravatar_base_url, "https://cravatar.cn/avatar");
    }

    #[test]
    fn computes_gravatar_md5_and_resolves_avatar_sources() {
        assert_eq!(md5_lower_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_lower_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        let url = build_gravatar_url("  MyEmailAddress@example.com ", "https://cravatar.cn/avatar/");
        assert_eq!(
            url,
            "https://cravatar.cn/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?d=identicon&s=160"
        );
    }

    #[test]
    fn generates_oauth_flow_tokens_and_sanitizes_redirects() {
        let (state, verifier, challenge) = generate_oauth_flow_tokens();
        assert!(state.len() >= 43);
        assert!(verifier.len() >= 43);
        let expected_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, expected_challenge);
        assert!(constant_time_str_eq(&state, &state));
        assert!(!constant_time_str_eq(&state, &verifier));

        assert_eq!(
            sanitize_internal_return_path(Some("/zh-CN/studio"), "zh-CN"),
            "/zh-CN/studio"
        );
        assert_eq!(
            sanitize_internal_return_path(Some("//evil.example.com"), "zh-CN"),
            "/zh-CN"
        );
    }

    #[test]
    fn validates_normalizes_and_checks_deliverable_emails() {
        // Valid formats & canonical normalization
        assert_eq!(
            validate_and_normalize_email("  Alice+notes@Example.COM  ").as_deref(),
            Some("Alice+notes@example.com")
        );
        assert_eq!(
            validate_and_normalize_email("user.name_1-2!#$%&'*+/=?^`{|}~@sub.domain.co.uk")
                .as_deref(),
            Some("user.name_1-2!#$%&'*+/=?^`{|}~@sub.domain.co.uk")
        );
        assert_eq!(
            validate_and_normalize_email("a@x.com").as_deref(),
            Some("a@x.com")
        );
        assert_eq!(
            validate_and_normalize_email("hi@t.co").as_deref(),
            Some("hi@t.co")
        );
        assert_eq!(
            validate_and_normalize_email("dev@XN--55QX5D.XN--FIQS8S").as_deref(),
            Some("dev@xn--55qx5d.xn--fiqs8s")
        );

        // Invalid syntax / non-routable sinkholes
        let invalid_cases = [
            "",
            "   ",
            "plainaddress",
            "@example.com",
            "alice@",
            "a@b@example.com",
            "user@localhost",
            "user@gm",
            "a@b",
            "user@gmail.c",
            "user@127.0.0.1",
            "user@foo.123",
            "user@gmail.c0m",
            ".alice@example.com",
            "alice.@example.com",
            "al..ice@example.com",
            "alice@.example.com",
            "alice@example..com",
            "alice@example.com.",
            "alice@-example.com",
            "alice@example-.com",
            "alice@xn--.com",
            "alice@sub.xn---123",
            "wp-1@users.sso.invalid",
            "alice@printer.local",
            "alice@app.localhost",
            "alice\r\nBcc:evil@example.com",
            "alice bob@example.com",
            "<alice@example.com>",
            "alice＠example.com",
            "alice@example。com",
        ];
        for bad in invalid_cases {
            assert!(
                !is_valid_email(bad),
                "expected `{bad}` to be rejected as invalid email"
            );
        }

        // Length limits
        let ok_64_local = format!("{}@example.com", "a".repeat(64));
        assert!(is_valid_email(&ok_64_local));
        let bad_65_local = format!("{}@example.com", "a".repeat(65));
        assert!(!is_valid_email(&bad_65_local));
        let bad_64_label = format!("a@{}.com", "b".repeat(64));
        assert!(!is_valid_email(&bad_64_label));
        let over_180_total = format!("{}@{}.com", "a".repeat(50), "b".repeat(130));
        assert!(over_180_total.len() > MAX_EMAIL_LEN);
        assert!(!is_valid_email(&over_180_total));

        // Deliverability filter
        assert!(!is_deliverable_email("admin@example.com"));
        assert!(!is_deliverable_email("sub@mail.example.org"));
        assert!(!is_deliverable_email("qa@sandbox.example"));
        assert!(!is_deliverable_email("qa@staging.test"));
        assert!(!is_deliverable_email("admin@localhost"));
        assert!(!is_deliverable_email("wp-1@users.sso.invalid"));
        assert!(is_deliverable_email("noreply@icehandnote.dev"));
        assert!(is_deliverable_email("Alice+tag@Gmail.COM"));
    }
}
