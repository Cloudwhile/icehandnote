use crate::error::{DomainError, ErrorCode};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthProviderDto {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub authorize_url: String,
    #[serde(default)]
    pub token_url: String,
    #[serde(default)]
    pub userinfo_url: String,
    #[serde(default = "default_oauth_scopes")]
    pub scopes: String,
}

impl OAuthProviderDto {
    pub fn is_complete(&self) -> bool {
        !self.client_id.trim().is_empty()
            && !self.authorize_url.trim().is_empty()
            && !self.token_url.trim().is_empty()
            && !self.userinfo_url.trim().is_empty()
    }

    pub fn display_name(&self) -> &str {
        let trimmed = self.name.trim();
        if trimmed.is_empty() {
            let id_trimmed = self.id.trim();
            if id_trimmed.is_empty() {
                "OAuth"
            } else {
                id_trimmed
            }
        } else {
            trimmed
        }
    }
}

pub fn slugify_oauth_provider_id(raw: &str) -> String {
    let mut out = String::new();
    let mut prev_sep = false;
    for ch in raw.trim().to_ascii_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_sep = false;
        } else if (ch == '-' || ch == '_' || ch.is_ascii_whitespace()) && !out.is_empty() && !prev_sep
        {
            out.push(if ch == '_' { '_' } else { '-' });
            prev_sep = true;
        }
        if out.len() >= 32 {
            break;
        }
    }
    let trimmed = out.trim_matches(['-', '_']).to_string();
    if !trimmed.is_empty() {
        trimmed
    } else {
        String::new()
    }
}

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
    /// Multi-provider OAuth 2.0 / OIDC configurations (preferred over legacy single-provider fields).
    #[serde(default)]
    pub oauth_providers: Vec<OAuthProviderDto>,
    #[serde(default = "default_true")]
    pub enable_passkeys: bool,
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
            oauth_providers: {
                let enabled = env_non_empty("OAUTH_ENABLED")
                    .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                    .unwrap_or(false);
                let name = env_non_empty("OAUTH_PROVIDER_NAME").unwrap_or_default();
                let client_id = env_non_empty("OAUTH_CLIENT_ID").unwrap_or_default();
                let authorize_url = env_non_empty("OAUTH_AUTHORIZE_URL").unwrap_or_default();
                let token_url = env_non_empty("OAUTH_TOKEN_URL").unwrap_or_default();
                let userinfo_url = env_non_empty("OAUTH_USERINFO_URL").unwrap_or_default();
                let scopes = env_non_empty("OAUTH_SCOPES").unwrap_or_else(default_oauth_scopes);
                if enabled || !client_id.is_empty() || !authorize_url.is_empty() {
                    let mut id = slugify_oauth_provider_id(&name);
                    if id.is_empty() {
                        id = "default".to_string();
                    }
                    vec![OAuthProviderDto {
                        id,
                        enabled,
                        name,
                        client_id,
                        authorize_url,
                        token_url,
                        userinfo_url,
                        scopes,
                    }]
                } else {
                    Vec::new()
                }
            },
            enable_passkeys: env_non_empty("ENABLE_PASSKEYS")
                .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(true),
            enable_margin_notes: true,
            enable_likes: true,
            enable_progress_tracking: true,
            enable_draft_autosave: true,
            draft_autosave_interval_secs: default_autosave_interval_secs(),
        }
    }

    /// Returns the effective list of configured OAuth providers (falling back to legacy
    /// single-provider fields when `oauth_providers` is empty).
    pub fn effective_oauth_providers(&self) -> Vec<OAuthProviderDto> {
        if !self.oauth_providers.is_empty() {
            return self.oauth_providers.clone();
        }
        if self.oauth_enabled
            || !self.oauth_client_id.trim().is_empty()
            || !self.oauth_authorize_url.trim().is_empty()
        {
            let mut id = slugify_oauth_provider_id(&self.oauth_provider_name);
            if id.is_empty() {
                id = "default".to_string();
            }
            return vec![OAuthProviderDto {
                id,
                enabled: self.oauth_enabled,
                name: self.oauth_provider_name.clone(),
                client_id: self.oauth_client_id.clone(),
                authorize_url: self.oauth_authorize_url.clone(),
                token_url: self.oauth_token_url.clone(),
                userinfo_url: self.oauth_userinfo_url.clone(),
                scopes: if self.oauth_scopes.trim().is_empty() {
                    default_oauth_scopes()
                } else {
                    self.oauth_scopes.clone()
                },
            }];
        }
        Vec::new()
    }

    /// Resolves a specific OAuth provider by ID (case-insensitive) or returns the first enabled
    /// provider when `provider_id` is omitted.
    pub fn find_oauth_provider(&self, provider_id: Option<&str>) -> Option<OAuthProviderDto> {
        let providers = self.effective_oauth_providers();
        if let Some(raw_id) = provider_id.map(str::trim).filter(|s| !s.is_empty()) {
            let needle = raw_id.to_ascii_lowercase();
            providers
                .into_iter()
                .find(|p| p.id.eq_ignore_ascii_case(&needle))
        } else {
            providers.into_iter().find(|p| p.enabled)
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

        // Backward compatibility: if a legacy payload populated flat OAuth fields without
        // `oauth_providers`, lift it into `oauth_providers`.
        if self.oauth_providers.is_empty()
            && (self.oauth_enabled
                || !self.oauth_client_id.is_empty()
                || !self.oauth_authorize_url.is_empty())
        {
            let mut id = slugify_oauth_provider_id(&self.oauth_provider_name);
            if id.is_empty() {
                id = "default".to_string();
            }
            self.oauth_providers.push(OAuthProviderDto {
                id,
                enabled: self.oauth_enabled,
                name: self.oauth_provider_name.clone(),
                client_id: self.oauth_client_id.clone(),
                authorize_url: self.oauth_authorize_url.clone(),
                token_url: self.oauth_token_url.clone(),
                userinfo_url: self.oauth_userinfo_url.clone(),
                scopes: self.oauth_scopes.clone(),
            });
        }

        // Sanitize & deduplicate multi-OAuth provider entries (max 20)
        let mut seen_ids = HashSet::new();
        let mut clean_providers = Vec::with_capacity(self.oauth_providers.len().min(20));
        for (idx, mut p) in self.oauth_providers.into_iter().take(20).enumerate() {
            p.name = p.name.trim().chars().take(48).collect();
            p.client_id = p.client_id.trim().chars().take(256).collect();
            p.authorize_url = p.authorize_url.trim().chars().take(512).collect();
            p.token_url = p.token_url.trim().chars().take(512).collect();
            p.userinfo_url = p.userinfo_url.trim().chars().take(512).collect();
            p.scopes = p.scopes.trim().chars().take(256).collect();
            if p.name.is_empty()
                && p.client_id.is_empty()
                && p.authorize_url.is_empty()
                && p.token_url.is_empty()
                && p.userinfo_url.is_empty()
            {
                continue;
            }
            if !p.is_complete() {
                p.enabled = false;
            }
            if p.scopes.is_empty() {
                p.scopes = default_oauth_scopes();
            }
            for url in [&p.authorize_url, &p.token_url, &p.userinfo_url] {
                if !url.is_empty()
                    && !url.starts_with("https://")
                    && !url.starts_with("http://")
                {
                    return Err(DomainError::new(
                        ErrorCode::InvalidUrl,
                        "OAuth endpoint URL must start with https:// or http://.",
                    )
                    .into());
                }
            }
            let base_id = {
                let from_id = slugify_oauth_provider_id(&p.id);
                if !from_id.is_empty() {
                    from_id
                } else {
                    let from_name = slugify_oauth_provider_id(&p.name);
                    if !from_name.is_empty() {
                        from_name
                    } else {
                        format!("provider-{}", idx + 1)
                    }
                }
            };
            let mut final_id = base_id.clone();
            let mut suffix = 2usize;
            while seen_ids.contains(&final_id) {
                let candidate = format!("{base_id}-{suffix}");
                final_id = candidate.chars().take(32).collect();
                suffix += 1;
            }
            seen_ids.insert(final_id.clone());
            p.id = final_id;
            clean_providers.push(p);
        }
        self.oauth_providers = clean_providers;

        // Keep legacy summary fields synced with `oauth_providers` for older clients
        if let Some(primary) = self
            .oauth_providers
            .iter()
            .find(|p| p.enabled)
            .or_else(|| self.oauth_providers.first())
        {
            self.oauth_enabled = self.oauth_providers.iter().any(|p| p.enabled);
            self.oauth_provider_name = primary.name.clone();
            self.oauth_client_id = primary.client_id.clone();
            self.oauth_authorize_url = primary.authorize_url.clone();
            self.oauth_token_url = primary.token_url.clone();
            self.oauth_userinfo_url = primary.userinfo_url.clone();
            self.oauth_scopes = primary.scopes.clone();
        } else {
            self.oauth_enabled = false;
            self.oauth_provider_name.clear();
            self.oauth_client_id.clear();
            self.oauth_authorize_url.clear();
            self.oauth_token_url.clear();
            self.oauth_userinfo_url.clear();
            self.oauth_scopes = default_oauth_scopes();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_multiple_oauth_providers_and_preserves_legacy_fallback() {
        let mut settings = SiteSettingsDto::default_with_env("zh-CN", "");
        settings.oauth_providers = vec![
            OAuthProviderDto {
                id: "GitHub Main".to_string(),
                enabled: true,
                name: "GitHub".to_string(),
                client_id: "gh_client_1".to_string(),
                authorize_url: "https://github.com/login/oauth/authorize".to_string(),
                token_url: "https://github.com/login/oauth/access_token".to_string(),
                userinfo_url: "https://api.github.com/user".to_string(),
                scopes: "read:user user:email".to_string(),
            },
            OAuthProviderDto {
                id: "github-main".to_string(),
                enabled: false,
                name: "Google Workspace".to_string(),
                client_id: "goog_client_2".to_string(),
                authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
                token_url: "https://oauth2.googleapis.com/token".to_string(),
                userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo".to_string(),
                scopes: "".to_string(),
            },
        ];

        let clean = settings.sanitize().expect("settings sanitize");
        assert_eq!(clean.oauth_providers.len(), 2);
        assert_eq!(clean.oauth_providers[0].id, "github-main");
        assert_eq!(clean.oauth_providers[1].id, "github-main-2");
        assert_eq!(clean.oauth_providers[1].scopes, "openid profile email");
        assert!(clean.oauth_enabled);
        assert_eq!(clean.oauth_provider_name, "GitHub");
        assert_eq!(
            clean
                .find_oauth_provider(Some("github-main-2"))
                .map(|p| p.name),
            Some("Google Workspace".to_string())
        );

        // Legacy payload lifts seamlessly into oauth_providers
        let mut legacy = SiteSettingsDto::default_with_env("en", "");
        legacy.oauth_enabled = true;
        legacy.oauth_provider_name = "Authentik".to_string();
        legacy.oauth_client_id = "ak_123".to_string();
        legacy.oauth_authorize_url = "https://auth.example.com/authorize".to_string();
        legacy.oauth_token_url = "https://auth.example.com/token".to_string();
        legacy.oauth_userinfo_url = "https://auth.example.com/userinfo".to_string();
        let lifted = legacy.sanitize().expect("legacy lift");
        assert_eq!(lifted.oauth_providers.len(), 1);
        assert_eq!(lifted.oauth_providers[0].id, "authentik");
        assert!(lifted.oauth_providers[0].enabled);

        // Blank entries are dropped and incomplete entries cannot stay enabled
        let mut with_blanks = SiteSettingsDto::default_with_env("zh-CN", "");
        with_blanks.oauth_providers = vec![
            OAuthProviderDto {
                id: "custom-oidc".to_string(),
                enabled: true,
                name: "".to_string(),
                client_id: "".to_string(),
                authorize_url: "".to_string(),
                token_url: "".to_string(),
                userinfo_url: "".to_string(),
                scopes: "openid profile email".to_string(),
            },
            OAuthProviderDto {
                id: "github".to_string(),
                enabled: true,
                name: "GitHub".to_string(),
                client_id: "".to_string(),
                authorize_url: "https://github.com/login/oauth/authorize".to_string(),
                token_url: "https://github.com/login/oauth/access_token".to_string(),
                userinfo_url: "https://api.github.com/user".to_string(),
                scopes: "read:user user:email".to_string(),
            },
        ];
        let scrubbed = with_blanks.sanitize().expect("scrub blanks");
        assert_eq!(scrubbed.oauth_providers.len(), 1);
        assert_eq!(scrubbed.oauth_providers[0].id, "github");
        assert!(!scrubbed.oauth_providers[0].enabled);
    }
}
