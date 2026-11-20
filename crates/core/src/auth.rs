use anyhow::{anyhow, bail, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileDto {
    pub id: Uuid,
    pub wp_user_id: Option<i64>,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub avatar_url: String,
    pub bio: String,
    pub role: UserRole,
    pub auth_source: String,
    pub last_login_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlogSsoClaims {
    pub wp_user_id: i64,
    pub username: String,
    pub display_name: String,
    pub email: String,
    #[serde(default)]
    pub avatar_url: String,
    #[serde(default)]
    pub wp_roles: Vec<String>,
    #[serde(default = "default_blog_origin")]
    pub blog_origin: String,
    pub iat: i64,
    pub exp: i64,
}

fn default_blog_origin() -> String {
    String::new()
}

pub fn sign_blog_sso_token(claims: &BlogSsoClaims, secret: &str) -> Result<String> {
    let json = serde_json::to_vec(claims)?;
    let b64 = URL_SAFE_NO_PAD.encode(json);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| anyhow!("Invalid SSO secret key length"))?;
    mac.update(b64.as_bytes());
    let sig_hex = hex::encode(mac.finalize().into_bytes());
    Ok(format!("{b64}.{sig_hex}"))
}

pub fn verify_blog_sso_token(token: &str, secret: &str) -> Result<BlogSsoClaims> {
    let Some((b64, sig_hex)) = token.trim().split_once('.') else {
        bail!("Malformed SSO token");
    };
    let sig_bytes = hex::decode(sig_hex).map_err(|_| anyhow!("Invalid SSO signature encoding"))?;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| anyhow!("Invalid SSO secret key length"))?;
    mac.update(b64.as_bytes());
    mac.verify_slice(&sig_bytes)
        .map_err(|_| anyhow!("Invalid external SSO signature"))?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(b64)
        .map_err(|_| anyhow!("Invalid base64url payload"))?;
    let claims: BlogSsoClaims = serde_json::from_slice(&payload_bytes)?;

    let now = Utc::now().timestamp();
    if claims.exp < now {
        bail!("SSO ticket has expired");
    }
    Ok(claims)
}

pub fn hash_session_token(raw_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"icetowne_session_v1:");
    hasher.update(raw_token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Hash a password with Argon2id (PHC string format, random per-password salt).
pub fn hash_password(_username: &str, password: &str) -> String {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut OsRng);
    argon2::Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .unwrap_or_default()
}

fn legacy_sha256_password(username: &str, password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"icetowne_pw_v1:");
    hasher.update(username.trim().to_ascii_lowercase().as_bytes());
    hasher.update(b":");
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

/// Verify a password against an Argon2 PHC hash, falling back to the legacy
/// salted-SHA256 format still present in older local `.data/dev-store.json` files.
pub fn verify_password(username: &str, password: &str, expected_hash: &str) -> bool {
    if expected_hash.starts_with("$argon2") {
        use argon2::password_hash::{PasswordHash, PasswordVerifier};
        return PasswordHash::new(expected_hash)
            .map(|parsed| {
                argon2::Argon2::default()
                    .verify_password(password.as_bytes(), &parsed)
                    .is_ok()
            })
            .unwrap_or(false);
    }

    let computed = legacy_sha256_password(username, password);
    if computed.len() != expected_hash.len() {
        return false;
    }
    // Constant-time byte comparison
    let mut diff = 0u8;
    for (a, b) in computed.bytes().zip(expected_hash.bytes()) {
        diff |= a ^ b;
    }
    diff == 0
}

pub fn is_legacy_password_hash(hash: &str) -> bool {
    !hash.starts_with("$argon2")
}

// ============================================================================
// Studio Authoring & Admin Management DTOs
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioLocaleBadgeDto {
    pub locale: String,
    pub status: String, // "published" | "draft"
    pub synced_revision: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioStepRowDto {
    pub step_id: Uuid,
    pub slug: String,
    pub step_number: i32,
    pub title: String,
    pub canonical_revision: i32,
    pub estimated_minutes: i32,
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
    pub status: String,
    #[serde(default)]
    pub license: String,
    pub tags: Vec<String>,
    pub body_markdown: String,
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
    pub estimated_minutes: i32,
    pub synced_revision: i32,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteSettingsDto {
    pub site_name: String,
    #[serde(default)]
    pub brand_badge: String,
    #[serde(default)]
    pub hero_title: String,
    #[serde(default)]
    pub hero_tagline: String,
    #[serde(default)]
    pub footer_text: String,
    #[serde(default = "default_author_name")]
    pub default_author_name: String,
    #[serde(default = "default_site_license")]
    pub default_license: String,
    pub default_locale: String,
    pub enabled_locales: Vec<String>,
    pub default_theme: String,
    #[serde(default)]
    pub blog_origin_url: String,
    #[serde(default)]
    pub blog_nav_label: String,
    #[serde(default = "default_sso_query_param")]
    pub sso_query_param: String,
    #[serde(default = "default_true")]
    pub sso_enabled: bool,
    #[serde(default = "default_true")]
    pub enable_margin_notes: bool,
    #[serde(default = "default_true")]
    pub enable_likes: bool,
    #[serde(default = "default_true")]
    pub enable_progress_tracking: bool,
    #[serde(default = "default_true")]
    pub enable_draft_autosave: bool,
    #[serde(default = "default_autosave_interval_secs")]
    pub draft_autosave_interval_secs: i32,
}

fn default_true() -> bool {
    true
}

fn default_author_name() -> String {
    String::new()
}

fn default_site_license() -> String {
    "cc-by-nc-sa-4.0".to_string()
}

fn default_sso_query_param() -> String {
    "sso_login".to_string()
}

fn default_autosave_interval_secs() -> i32 {
    15
}

fn env_non_empty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn extract_host_label(url: &str) -> String {
    url.trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

impl SiteSettingsDto {
    pub fn default_with_env(default_locale: &str, blog_origin_url: &str) -> Self {
        let valid_default = if crate::SUPPORTED_LOCALES
            .iter()
            .any(|(code, _)| *code == default_locale)
        {
            default_locale.to_string()
        } else {
            "zh-CN".to_string()
        };
        let clean_blog = blog_origin_url.trim().trim_end_matches('/').to_string();
        let site_name = env_non_empty("SITE_NAME").unwrap_or_else(|| "IceHandnote".to_string());
        let hero_title = env_non_empty("SITE_HERO_TITLE").unwrap_or_else(|| site_name.clone());
        let blog_nav_label = env_non_empty("BLOG_NAV_LABEL")
            .unwrap_or_else(|| extract_host_label(&clean_blog));
        Self {
            site_name,
            brand_badge: env_non_empty("SITE_BRAND_BADGE").unwrap_or_default(),
            hero_title,
            hero_tagline: env_non_empty("SITE_HERO_TAGLINE").unwrap_or_default(),
            footer_text: env_non_empty("SITE_FOOTER_TEXT")
                .unwrap_or_else(|| "© IceHandnote · CC BY-NC-SA 4.0".to_string()),
            default_author_name: env_non_empty("SITE_AUTHOR_NAME")
                .unwrap_or_else(default_author_name),
            default_license: env_non_empty("SITE_DEFAULT_LICENSE")
                .map(|v| crate::normalize_license_code(&v))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(default_site_license),
            default_locale: valid_default,
            enabled_locales: crate::SUPPORTED_LOCALES
                .iter()
                .map(|(code, _)| (*code).to_string())
                .collect(),
            default_theme: "system".to_string(),
            blog_origin_url: clean_blog,
            blog_nav_label,
            sso_query_param: env_non_empty("BLOG_SSO_QUERY_PARAM")
                .unwrap_or_else(default_sso_query_param),
            sso_enabled: true,
            enable_margin_notes: true,
            enable_likes: true,
            enable_progress_tracking: true,
            enable_draft_autosave: true,
            draft_autosave_interval_secs: default_autosave_interval_secs(),
        }
    }

    pub fn sanitize(mut self) -> Result<Self> {
        self.site_name = self.site_name.trim().chars().take(64).collect();
        if self.site_name.is_empty() {
            bail!("站点名称不能为空");
        }
        self.brand_badge = self.brand_badge.trim().chars().take(24).collect();
        self.hero_title = self.hero_title.trim().chars().take(120).collect();
        self.hero_tagline = self.hero_tagline.trim().chars().take(240).collect();
        self.footer_text = self.footer_text.trim().chars().take(200).collect();
        self.default_author_name = self.default_author_name.trim().chars().take(48).collect();
        let normalized_lic = crate::normalize_license_code(&self.default_license);
        self.default_license = if normalized_lic.is_empty() {
            default_site_license()
        } else {
            normalized_lic
        };
        self.blog_nav_label = self.blog_nav_label.trim().chars().take(48).collect();
        self.blog_origin_url = self.blog_origin_url.trim().trim_end_matches('/').to_string();
        let clean_param: String = self
            .sso_query_param
            .trim()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .take(48)
            .collect();
        self.sso_query_param = if clean_param.is_empty() {
            default_sso_query_param()
        } else {
            clean_param
        };

        if !self.blog_origin_url.is_empty()
            && !self.blog_origin_url.starts_with("https://")
            && !self.blog_origin_url.starts_with("http://")
        {
            bail!("主站地址必须以 https:// 或 http:// 开头");
        }

        let mut deduped = Vec::new();
        for loc in self.enabled_locales {
            if crate::SUPPORTED_LOCALES.iter().any(|(code, _)| *code == loc)
                && !deduped.contains(&loc)
            {
                deduped.push(loc);
            }
        }
        if deduped.is_empty() {
            bail!("至少需要启用一种语言");
        }
        self.enabled_locales = deduped;

        if !self.enabled_locales.contains(&self.default_locale) {
            self.default_locale = self.enabled_locales[0].clone();
        }

        self.default_theme = match self.default_theme.trim().to_ascii_lowercase().as_str() {
            "dark" => "dark".to_string(),
            "light" => "light".to_string(),
            _ => "system".to_string(),
        };

        self.draft_autosave_interval_secs = self.draft_autosave_interval_secs.clamp(5, 300);

        Ok(self)
    }
}

/// Format structured editor fields back into clean `+++` TOML Frontmatter + Markdown body
/// so Studio edits and Git `content/` files stay 100% round-trip compatible!
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
    let escaped_title = title.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_summary = summary.replace('\\', "\\\\").replace('"', "\\\"");
    let clean_status = if status == "draft" { "draft" } else { "published" };
    let clean_license = crate::normalize_license_code(license);
    let license_line = if clean_license.is_empty() {
        String::new()
    } else {
        format!("license = \"{clean_license}\"\n")
    };
    let tags_toml = tags
        .iter()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "+++\ntitle = \"{escaped_title}\"\nsummary = \"{escaped_summary}\"\nstep_number = {step_number}\nestimated_minutes = {estimated_minutes}\nsynced_revision = {synced_revision}\ncanonical_revision = {canonical_revision}\nstatus = \"{clean_status}\"\n{license_line}tags = [{tags_toml}]\n+++\n\n{}\n",
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
        // Two hashes of the same password differ (random salt)
        assert_ne!(hash, hash_password("admin", "correct horse battery"));

        let legacy = legacy_sha256_password("demo_reader", "reader2026");
        assert!(is_legacy_password_hash(&legacy));
        assert!(verify_password("demo_reader", "reader2026", &legacy));
        assert!(!verify_password("demo_reader", "nope", &legacy));
    }

    #[test]
    fn sanitizes_site_settings() {
        let mut s = SiteSettingsDto::default_with_env("zh-CN", "https://blog.example.com/");
        assert_eq!(s.blog_origin_url, "https://blog.example.com");
        assert_eq!(s.blog_nav_label, "blog.example.com");
        s.enabled_locales = vec!["en".to_string(), "invalid".to_string(), "en".to_string()];
        s.default_locale = "ja".to_string();
        s.default_theme = "DARK".to_string();
        s.draft_autosave_interval_secs = 2;
        s.sso_query_param = "custom_sso?!".to_string();
        let clean = s.sanitize().unwrap();
        assert_eq!(clean.enabled_locales, vec!["en".to_string()]);
        assert_eq!(clean.default_locale, "en");
        assert_eq!(clean.default_theme, "dark");
        assert_eq!(clean.draft_autosave_interval_secs, 5);
        assert_eq!(clean.sso_query_param, "custom_sso");

        let mut high = clean.clone();
        high.draft_autosave_interval_secs = 999;
        assert_eq!(high.sanitize().unwrap().draft_autosave_interval_secs, 300);

        // Backwards-compat: existing PostgreSQL JSONB row without new fields deserializes cleanly
        let legacy_json = serde_json::json!({
            "site_name": "IceHandnote",
            "default_locale": "zh-CN",
            "enabled_locales": ["zh-CN"],
            "default_theme": "system"
        });
        let legacy: SiteSettingsDto = serde_json::from_value(legacy_json).unwrap();
        assert!(legacy.enable_draft_autosave);
        assert_eq!(legacy.draft_autosave_interval_secs, 15);
        assert_eq!(legacy.default_author_name, "");
        assert_eq!(legacy.default_license, "cc-by-nc-sa-4.0");
        assert_eq!(legacy.sso_query_param, "sso_login");

        let mut custom_lic = clean.clone();
        custom_lic.default_license = "CC BY 4.0".to_string();
        assert_eq!(custom_lic.sanitize().unwrap().default_license, "cc-by-4.0");

        let formatted = format_step_markdown_file(
            "CC Test",
            "Summary",
            1,
            8,
            1,
            1,
            "published",
            "CC BY-SA 4.0",
            &["Rust".to_string()],
            "Body",
        );
        let compiled = crate::compile_notebook_markdown(&formatted);
        assert_eq!(compiled.frontmatter.license, "cc-by-sa-4.0");

        let mut bad = clean.clone();
        bad.blog_origin_url = "javascript:alert(1)".to_string();
        assert!(bad.sanitize().is_err());
    }
}
