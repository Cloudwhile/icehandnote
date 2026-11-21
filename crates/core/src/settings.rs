use crate::error::{DomainError, ErrorCode};
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteSettingsDto {
    pub site_name: String,
    #[serde(default)]
    pub brand_badge: String,
    #[serde(default)]
    pub logo_url: String,
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
    pub allow_registration: bool,
    #[serde(default = "default_true")]
    pub allow_author_registration: bool,
    #[serde(default = "default_gravatar_base_url")]
    pub gravatar_base_url: String,
    #[serde(default)]
    pub blog_origin_url: String,
    #[serde(default)]
    pub blog_nav_label: String,
    #[serde(default = "default_sso_query_param")]
    pub sso_query_param: String,
    #[serde(default = "default_true")]
    pub sso_enabled: bool,
    #[serde(default)]
    pub oauth_enabled: bool,
    #[serde(default)]
    pub oauth_provider_name: String,
    #[serde(default)]
    pub oauth_client_id: String,
    #[serde(default)]
    pub oauth_authorize_url: String,
    #[serde(default)]
    pub oauth_token_url: String,
    #[serde(default)]
    pub oauth_userinfo_url: String,
    #[serde(default = "default_oauth_scopes")]
    pub oauth_scopes: String,
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

fn default_oauth_scopes() -> String {
    "openid profile email".to_string()
}

fn default_gravatar_base_url() -> String {
    "https://www.gravatar.com/avatar".to_string()
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
        let blog_nav_label =
            env_non_empty("BLOG_NAV_LABEL").unwrap_or_else(|| extract_host_label(&clean_blog));
        Self {
            site_name,
            brand_badge: env_non_empty("SITE_BRAND_BADGE").unwrap_or_default(),
            logo_url: env_non_empty("SITE_LOGO_URL").unwrap_or_default(),
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
            allow_registration: env_non_empty("ALLOW_REGISTRATION")
                .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(false),
            allow_author_registration: env_non_empty("ALLOW_AUTHOR_REGISTRATION")
                .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(true),
            gravatar_base_url: env_non_empty("GRAVATAR_BASE_URL")
                .unwrap_or_else(default_gravatar_base_url),
            blog_origin_url: clean_blog,
            blog_nav_label,
            sso_query_param: env_non_empty("BLOG_SSO_QUERY_PARAM")
                .unwrap_or_else(default_sso_query_param),
            sso_enabled: true,
            oauth_enabled: env_non_empty("OAUTH_ENABLED")
                .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(false),
            oauth_provider_name: env_non_empty("OAUTH_PROVIDER_NAME").unwrap_or_default(),
            oauth_client_id: env_non_empty("OAUTH_CLIENT_ID").unwrap_or_default(),
            oauth_authorize_url: env_non_empty("OAUTH_AUTHORIZE_URL").unwrap_or_default(),
            oauth_token_url: env_non_empty("OAUTH_TOKEN_URL").unwrap_or_default(),
            oauth_userinfo_url: env_non_empty("OAUTH_USERINFO_URL").unwrap_or_default(),
            oauth_scopes: env_non_empty("OAUTH_SCOPES").unwrap_or_else(default_oauth_scopes),
            enable_margin_notes: true,
            enable_likes: true,
            enable_progress_tracking: true,
            enable_draft_autosave: true,
            draft_autosave_interval_secs: default_autosave_interval_secs(),
        }
    }

    pub fn sanitize(mut self) -> Result<Self> {
        self.site_name = crate::sanitize_custom_html(&self.site_name, 160);
        if crate::reading_time::strip_html_tags(&self.site_name)
            .trim()
            .is_empty()
        {
            return Err(DomainError::new(
                ErrorCode::SiteNameRequired,
                "Site name cannot be empty.",
            )
            .into());
        }
        self.brand_badge = crate::sanitize_custom_html(&self.brand_badge, 120);
        self.logo_url = self.logo_url.trim().chars().take(512).collect();
        if !self.logo_url.is_empty()
            && !self.logo_url.starts_with("/uploads/")
            && !self.logo_url.starts_with("https://")
            && !self.logo_url.starts_with("http://")
        {
            return Err(DomainError::new(
                ErrorCode::InvalidLogoUrl,
                "Logo URL must start with /uploads/, https://, or http://.",
            )
            .into());
        }
        self.hero_title = crate::sanitize_custom_html(&self.hero_title, 320);
        self.hero_tagline = crate::sanitize_custom_html(&self.hero_tagline, 600);
        self.footer_text = crate::sanitize_custom_html(&self.footer_text, 500);
        self.default_author_name = crate::sanitize_custom_html(&self.default_author_name, 120);

        let normalized_lic = crate::normalize_license_code(&self.default_license);
        self.default_license = if normalized_lic.is_empty() {
            default_site_license()
        } else {
            normalized_lic
        };

        self.gravatar_base_url = self
            .gravatar_base_url
            .trim()
            .trim_end_matches('/')
            .chars()
            .take(256)
            .collect();
        if self.gravatar_base_url.is_empty() {
            self.gravatar_base_url = default_gravatar_base_url();
        } else if !self.gravatar_base_url.starts_with("https://")
            && !self.gravatar_base_url.starts_with("http://")
        {
            return Err(DomainError::new(
                ErrorCode::InvalidUrl,
                "Gravatar base URL must start with https:// or http://.",
            )
            .into());
        }

        self.blog_nav_label = crate::sanitize_custom_html(&self.blog_nav_label, 160);
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
            return Err(DomainError::new(
                ErrorCode::InvalidUrl,
                "External site origin URL must start with https:// or http://.",
            )
            .into());
        }

        self.oauth_provider_name = self.oauth_provider_name.trim().chars().take(48).collect();
        self.oauth_client_id = self.oauth_client_id.trim().chars().take(256).collect();
        self.oauth_authorize_url = self.oauth_authorize_url.trim().chars().take(512).collect();
        self.oauth_token_url = self.oauth_token_url.trim().chars().take(512).collect();
        self.oauth_userinfo_url = self.oauth_userinfo_url.trim().chars().take(512).collect();
        self.oauth_scopes = self.oauth_scopes.trim().chars().take(256).collect();
        if self.oauth_scopes.is_empty() {
            self.oauth_scopes = default_oauth_scopes();
        }
        for url in [
            &self.oauth_authorize_url,
            &self.oauth_token_url,
            &self.oauth_userinfo_url,
        ] {
            if !url.is_empty() && !url.starts_with("https://") && !url.starts_with("http://") {
                return Err(DomainError::new(
                    ErrorCode::InvalidUrl,
                    "OAuth endpoint URL must start with https:// or http://.",
                )
                .into());
            }
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
            return Err(DomainError::new(
                ErrorCode::MinOneLocale,
                "At least one locale must remain enabled.",
            )
            .into());
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
