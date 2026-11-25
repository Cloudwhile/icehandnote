use crate::content_loader::{
    deterministic_uuid, ChapterManifest, ContentBundle, LoadedChapter, LoadedStep,
    LoadedStepTranslation, LoadedTrack, TrackLocaleMeta, TrackManifest,
};
use crate::{domain_err, if_match_satisfies, revision_conflict_err};
use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use icehandnote_core::{
    auth::{
        compute_step_content_sha256_with_cover, compute_step_etag,
        extract_body_without_frontmatter, generate_uuid_v7, hash_password, hash_session_token,
        normalize_collaborator_role, normalize_locale_scope, normalize_track_icon_kind,
        sanitize_track_custom_label, sanitize_track_tags, verify_password, ArticleAuthorDto,
        BlogSsoClaims, CollaborationAuditLogDto, CollaboratorInviteDto, CreateChapterInput,
        CreateTrackInput, SaveStudioStepInput, StepRevisionDto, StudioChapterDto,
        StudioLocaleBadgeDto, StudioStepEditorDto, StudioStepRowDto, StudioTrackDto,
        UpdateTrackMetaInput, UserProfileDto, UserRole,
    },
    compile_notebook_markdown,
    error::ErrorCode,
    reading_time::estimate_reading_minutes,
    sanitize_custom_html,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredOAuthBinding {
    pub provider: String,
    pub subject: String,
    #[serde(default)]
    pub oauth_avatar_url: String,
    #[serde(default = "default_now_utc")]
    pub bound_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredUserRecord {
    pub profile: UserProfileDto,
    pub password_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_sub: Option<String>,
    #[serde(default)]
    pub oauth_bindings: Vec<StoredOAuthBinding>,
}

fn default_session_uuid() -> Uuid {
    Uuid::new_v4()
}

fn default_now_utc() -> DateTime<Utc> {
    Utc::now()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSessionRecord {
    #[serde(default = "default_session_uuid")]
    pub id: Uuid,
    pub token_hash: String,
    pub user_id: Uuid,
    #[serde(default)]
    pub ip_address: String,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default)]
    pub device_label: String,
    #[serde(default)]
    pub device_fingerprint: String,
    #[serde(default = "default_now_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(default = "default_now_utc")]
    pub last_seen_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTrustedDeviceRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub ip_address: String,
    pub device_fingerprint: String,
    #[serde(default)]
    pub device_label: String,
    pub first_seen_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredLoginOtpChallengeRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub ip_address: String,
    pub user_agent: String,
    pub device_label: String,
    pub device_fingerprint: String,
    pub anomaly_reason: String,
    pub code_hash: String,
    #[serde(default)]
    pub attempts: i32,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub last_sent_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPasswordResetRecord {
    pub token_hash: String,
    #[serde(default)]
    pub code_hash: String,
    #[serde(default)]
    pub attempts: i32,
    pub user_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEmailVerificationRecord {
    pub id: Uuid,
    pub email: String,
    pub code_hash: String,
    #[serde(default)]
    pub attempts: i32,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub used_at: Option<DateTime<Utc>>,
}

fn default_editor_role_str() -> String {
    "editor".to_string()
}

fn default_one_seq() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCollaboratorGrant {
    #[serde(default = "default_editor_role_str")]
    pub role: String,
    #[serde(default)]
    pub locale_scope: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTranslationEditMeta {
    #[serde(default = "default_one_seq")]
    pub edit_seq: i64,
    #[serde(default)]
    pub content_sha256: String,
    #[serde(default)]
    pub last_editor_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StoredStepMetaRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<Uuid>,
    #[serde(default)]
    pub collaborator_ids: Vec<Uuid>,
    #[serde(default)]
    pub collaborator_roles: HashMap<Uuid, StoredCollaboratorGrant>,
    #[serde(default)]
    pub translation_meta: HashMap<String, StoredTranslationEditMeta>,
    #[serde(default)]
    pub author_name_fallback: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_by: Option<String>,
}

impl StoredStepMetaRecord {
    pub fn is_collaborator(&self, user_id: Uuid) -> bool {
        self.collaborator_ids.contains(&user_id) || self.collaborator_roles.contains_key(&user_id)
    }

    pub fn collaborator_grant(&self, user_id: Uuid) -> Option<(String, Vec<String>)> {
        if let Some(grant) = self.collaborator_roles.get(&user_id) {
            return Some((
                normalize_collaborator_role(Some(&grant.role)),
                grant.locale_scope.clone(),
            ));
        }
        if self.collaborator_ids.contains(&user_id) {
            return Some(("editor".to_string(), Vec::new()));
        }
        None
    }

    pub fn set_collaborator(&mut self, user_id: Uuid, role: &str, locale_scope: &[String]) {
        if !self.collaborator_ids.contains(&user_id) {
            self.collaborator_ids.push(user_id);
        }
        self.collaborator_roles.insert(
            user_id,
            StoredCollaboratorGrant {
                role: normalize_collaborator_role(Some(role)),
                locale_scope: normalize_locale_scope(locale_scope),
            },
        );
    }

    pub fn remove_collaborator(&mut self, user_id: Uuid) -> bool {
        let before = self.collaborator_ids.len();
        self.collaborator_ids.retain(|id| *id != user_id);
        let removed_role = self.collaborator_roles.remove(&user_id).is_some();
        self.collaborator_ids.len() < before || removed_role
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCollabInviteRecord {
    pub id: Uuid,
    pub step_id: Uuid,
    pub email: String,
    pub token_hash: String,
    #[serde(default = "default_editor_role_str")]
    pub role: String,
    #[serde(default)]
    pub locale_scope: Vec<String>,
    pub invited_by: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consumed_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<DateTime<Utc>>,
}

pub fn default_seeded_blog_users() -> Vec<StoredUserRecord> {
    let now = Utc::now();
    vec![StoredUserRecord {
        profile: UserProfileDto {
            id: deterministic_uuid("user:wp:1:admin"),
            wp_user_id: None,
            username: "admin".to_string(),
            display_name: "Admin".to_string(),
            email: "admin@example.com".to_string(),
            avatar_url: String::new(),
            avatar_source: "default".to_string(),
            oauth_avatar_url: String::new(),
            uploaded_avatar_url: String::new(),
            oauth_provider: None,
            oauth_bindings: Vec::new(),
            has_password: true,
            bio: "Site Administrator".to_string(),
            role: UserRole::Admin,
            has_collaborations: false,
            auth_source: "local".to_string(),
            is_banned: false,
            ban_reason: String::new(),
            last_login_at: now,
        },
        password_hash: Some(hash_password("admin", "icehandnote2026")),
        oauth_provider: None,
        oauth_sub: None,
        oauth_bindings: Vec::new(),
    }]
}

pub fn generate_raw_session_token() -> (String, String, DateTime<Utc>) {
    let raw = format!("ict_sess_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hashed = hash_session_token(&raw);
    let expires_at = Utc::now() + Duration::days(30);
    (raw, hashed, expires_at)
}

pub fn match_local_user_password(
    users: &[StoredUserRecord],
    identifier: &str,
    password: &str,
) -> Option<UserProfileDto> {
    let ident = identifier.trim().to_ascii_lowercase();
    for rec in users {
        let matches_id = rec.profile.username.to_ascii_lowercase() == ident
            || rec.profile.email.to_ascii_lowercase() == ident;
        if !matches_id {
            continue;
        }
        if let Some(ref pw_hash) = rec.password_hash {
            if verify_password(&rec.profile.username, password, pw_hash) {
                return Some(rec.profile.clone());
            }
        }
    }
    None
}

pub fn upsert_local_blog_user(
    users: &mut Vec<StoredUserRecord>,
    claims: &BlogSsoClaims,
) -> UserProfileDto {
    let now = Utc::now();
    let wp_role = UserRole::from_wordpress_roles(&claims.wp_roles);
    let clean_avatar = if icehandnote_core::is_safe_image_src(&claims.avatar_url) {
        claims.avatar_url.trim().to_string()
    } else {
        String::new()
    };

    if let Some(existing) = users.iter_mut().find(|u| {
        u.profile.wp_user_id == Some(claims.wp_user_id)
            || (u.profile.wp_user_id.is_none()
                && !claims.email.is_empty()
                && u.profile.email.eq_ignore_ascii_case(&claims.email))
    }) {
        if existing.profile.is_banned {
            return existing.profile.clone();
        }
        existing.profile.wp_user_id = Some(claims.wp_user_id);
        existing.profile.display_name = claims.display_name.clone();
        if !clean_avatar.is_empty() {
            existing.profile.oauth_avatar_url = clean_avatar.clone();
            if existing.profile.avatar_source == "default" && existing.profile.avatar_url.is_empty() {
                existing.profile.avatar_url = clean_avatar;
            }
        }
        if wp_role.is_admin() || (wp_role.can_author() && !existing.profile.role.is_admin()) {
            existing.profile.role = wp_role;
        }
        existing.profile.last_login_at = now;
        return existing.profile.clone();
    }

    let source_host = claims
        .blog_origin
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .trim();
    let auth_source = if source_host.is_empty() {
        "external-sso".to_string()
    } else {
        source_host.to_string()
    };
    let avatar_source = if clean_avatar.is_empty() {
        "default".to_string()
    } else {
        "oauth".to_string()
    };
    let profile = UserProfileDto {
        id: Uuid::new_v4(),
        wp_user_id: Some(claims.wp_user_id),
        username: claims.username.clone(),
        display_name: claims.display_name.clone(),
        email: claims.email.clone(),
        avatar_url: clean_avatar.clone(),
        avatar_source,
        oauth_avatar_url: clean_avatar,
        uploaded_avatar_url: String::new(),
        oauth_provider: None,
        oauth_bindings: Vec::new(),
        has_password: false,
        bio: String::new(),
        role: wp_role,
        has_collaborations: false,
        auth_source,
        is_banned: false,
        ban_reason: String::new(),
        last_login_at: now,
    };
    users.push(StoredUserRecord {
        profile: profile.clone(),
        password_hash: None,
        oauth_provider: None,
        oauth_sub: None,
        oauth_bindings: Vec::new(),
    });
    profile
}

pub fn resolve_local_step_authors(
    step_id: Uuid,
    frontmatter_author: &str,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
    users: &[StoredUserRecord],
    gravatar_base_url: &str,
) -> Vec<ArticleAuthorDto> {
    let mut authors = Vec::new();
    if let Some(meta) = step_meta.get(&step_id) {
        if let Some(owner_id) = meta.owner_user_id {
            if let Some(u) = users.iter().find(|r| r.profile.id == owner_id) {
                let resolved = u.profile.clone().with_resolved_avatar(gravatar_base_url);
                authors.push(ArticleAuthorDto {
                    user_id: Some(resolved.id),
                    username: resolved.username,
                    display_name: resolved.display_name,
                    avatar_url: resolved.avatar_url,
                    is_owner: true,
                    role: "owner".to_string(),
                    locale_scope: Vec::new(),
                });
            }
        }
        let mut seen_ids = Vec::new();
        for cid in &meta.collaborator_ids {
            if Some(*cid) == meta.owner_user_id || seen_ids.contains(cid) {
                continue;
            }
            seen_ids.push(*cid);
            if let Some(u) = users.iter().find(|r| r.profile.id == *cid) {
                let resolved = u.profile.clone().with_resolved_avatar(gravatar_base_url);
                let (role, scope) = meta
                    .collaborator_grant(*cid)
                    .unwrap_or_else(|| ("editor".to_string(), Vec::new()));
                authors.push(ArticleAuthorDto {
                    user_id: Some(resolved.id),
                    username: resolved.username,
                    display_name: resolved.display_name,
                    avatar_url: resolved.avatar_url,
                    is_owner: false,
                    role,
                    locale_scope: scope,
                });
            }
        }
        for (cid, grant) in &meta.collaborator_roles {
            if Some(*cid) == meta.owner_user_id || seen_ids.contains(cid) {
                continue;
            }
            seen_ids.push(*cid);
            if let Some(u) = users.iter().find(|r| r.profile.id == *cid) {
                let resolved = u.profile.clone().with_resolved_avatar(gravatar_base_url);
                authors.push(ArticleAuthorDto {
                    user_id: Some(resolved.id),
                    username: resolved.username,
                    display_name: resolved.display_name,
                    avatar_url: resolved.avatar_url,
                    is_owner: false,
                    role: normalize_collaborator_role(Some(&grant.role)),
                    locale_scope: grant.locale_scope.clone(),
                });
            }
        }
        if authors.is_empty() && !meta.author_name_fallback.trim().is_empty() {
            authors.push(ArticleAuthorDto {
                user_id: None,
                username: meta.author_name_fallback.trim().to_string(),
                display_name: meta.author_name_fallback.trim().to_string(),
                avatar_url: String::new(),
                is_owner: true,
                role: "owner".to_string(),
                locale_scope: Vec::new(),
            });
        }
    }
    if authors.is_empty() && !frontmatter_author.trim().is_empty() {
        authors.push(ArticleAuthorDto {
            user_id: None,
            username: frontmatter_author.trim().to_string(),
            display_name: frontmatter_author.trim().to_string(),
            avatar_url: String::new(),
            is_owner: true,
            role: "owner".to_string(),
            locale_scope: Vec::new(),
        });
    }
    authors
}

pub fn resolve_local_viewer_role(
    user: &UserProfileDto,
    step_id: Uuid,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
) -> (String, Vec<String>) {
    if user.role.is_admin() {
        return ("admin".to_string(), Vec::new());
    }
    if let Some(meta) = step_meta.get(&step_id) {
        if meta.owner_user_id == Some(user.id) {
            return ("owner".to_string(), Vec::new());
        }
        if let Some((role, scope)) = meta.collaborator_grant(user.id) {
            return (role, scope);
        }
    }
    ("none".to_string(), Vec::new())
}

pub fn user_can_read_local_draft(
    user: &UserProfileDto,
    step_id: Uuid,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
) -> bool {
    let (role, _) = resolve_local_viewer_role(user, step_id, step_meta);
    role != "none"
}

pub fn user_can_edit_local_step_locale(
    user: &UserProfileDto,
    step_id: Uuid,
    locale: &str,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
) -> Result<()> {
    let (role, scope) = resolve_local_viewer_role(user, step_id, step_meta);
    match role.as_str() {
        "admin" | "owner" | "editor" => Ok(()),
        "translator" => {
            if scope.is_empty() || scope.iter().any(|l| l == locale) {
                Ok(())
            } else {
                Err(domain_err(
                    ErrorCode::CollaboratorRoleForbidden,
                    format!("Your translator role is scoped to [{}] and cannot edit locale '{locale}'.", scope.join(", ")),
                ))
            }
        }
        "reviewer" => Err(domain_err(
            ErrorCode::CollaboratorRoleForbidden,
            "Reviewers have read-only access and cannot overwrite article content.",
        )),
        _ => Err(domain_err(
            ErrorCode::StepEditForbidden,
            "You do not have permission to edit this article.",
        )),
    }
}

pub fn user_can_edit_local_step(
    user: &UserProfileDto,
    step_id: Uuid,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
) -> bool {
    let (role, _) = resolve_local_viewer_role(user, step_id, step_meta);
    matches!(role.as_str(), "admin" | "owner" | "editor" | "translator")
}

pub fn compute_loaded_translation_etag(
    step_id: Uuid,
    locale: &str,
    tr: &LoadedStepTranslation,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
) -> (i64, String, String) {
    if let Some(tm) = step_meta
        .get(&step_id)
        .and_then(|m| m.translation_meta.get(locale))
    {
        if !tm.content_sha256.is_empty() {
            let seq = tm.edit_seq.max(1);
            return (
                seq,
                tm.content_sha256.clone(),
                compute_step_etag(seq, &tm.content_sha256),
            );
        }
    }
    let body = extract_body_without_frontmatter(&tr.raw_markdown);
    let lic = icehandnote_core::normalize_license_code(&tr.compiled.frontmatter.license);
    let cover = icehandnote_core::sanitize_cover_image_url(&tr.compiled.frontmatter.cover);
    let sha = compute_step_content_sha256_with_cover(
        &tr.compiled.frontmatter.title,
        &tr.compiled.frontmatter.summary,
        &tr.compiled.frontmatter.status,
        &lic,
        &tr.compiled.frontmatter.tags,
        &body,
        &cover,
    );
    let seq = step_meta
        .get(&step_id)
        .and_then(|m| m.translation_meta.get(locale))
        .map(|tm| tm.edit_seq.max(1))
        .unwrap_or(1);
    (seq, sha.clone(), compute_step_etag(seq, &sha))
}

pub fn build_studio_overview_from_bundle(
    bundle: &ContentBundle,
    viewer: Option<&UserProfileDto>,
    locale: &str,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
    users: &[StoredUserRecord],
    gravatar_base_url: &str,
) -> Vec<StudioTrackDto> {
    let is_reader_only = viewer.is_some_and(|v| !v.role.can_author());
    bundle
        .tracks
        .iter()
        .filter_map(|t| {
            let title = t
                .manifest
                .translations
                .get(locale)
                .or_else(|| t.manifest.translations.get("zh-CN"))
                .or_else(|| t.manifest.translations.get("en"))
                .or_else(|| t.manifest.translations.values().next())
                .map(|m| m.title.clone())
                .unwrap_or_else(|| t.manifest.slug.clone());

            let chapters: Vec<StudioChapterDto> = t
                .chapters
                .iter()
                .filter_map(|c| {
                    let ch_title = c
                        .titles
                        .get(locale)
                        .or_else(|| c.titles.get("zh-CN"))
                        .or_else(|| c.titles.get("en"))
                        .or_else(|| c.titles.values().next())
                        .cloned()
                        .unwrap_or_else(|| c.slug.clone());

                    let steps: Vec<StudioStepRowDto> = c
                        .steps
                        .iter()
                        .filter_map(|s| {
                            let can_see_drafts = viewer
                                .is_none_or(|v| user_can_read_local_draft(v, s.id, step_meta));
                            if is_reader_only && !can_see_drafts {
                                return None;
                            }
                            let visible_translations: Vec<&LoadedStepTranslation> = s
                                .translations
                                .values()
                                .filter(|tr| {
                                    can_see_drafts || tr.compiled.frontmatter.status != "draft"
                                })
                                .collect();
                            if visible_translations.is_empty() && !can_see_drafts {
                                return None;
                            }

                            let tr_pref = visible_translations
                                .iter()
                                .copied()
                                .find(|tr| tr.locale == locale)
                                .or_else(|| {
                                    visible_translations
                                        .iter()
                                        .copied()
                                        .find(|tr| tr.locale == s.default_locale)
                                })
                                .or_else(|| visible_translations.first().copied());

                            let step_title = tr_pref
                                .map(|tr| tr.compiled.frontmatter.title.clone())
                                .unwrap_or_else(|| s.slug.clone());
                            let fm_author = tr_pref
                                .map(|tr| tr.compiled.frontmatter.author.as_str())
                                .unwrap_or("");

                            let translations = visible_translations
                                .into_iter()
                                .map(|tr| StudioLocaleBadgeDto {
                                    locale: tr.locale.clone(),
                                    status: tr.compiled.frontmatter.status.clone(),
                                    synced_revision: tr.compiled.frontmatter.synced_revision,
                                    updated_at: tr.updated_at,
                                })
                                .collect();

                            let meta = step_meta.get(&s.id);
                            let authors = resolve_local_step_authors(
                                s.id,
                                fm_author,
                                step_meta,
                                users,
                                gravatar_base_url,
                            );

                            Some(StudioStepRowDto {
                                step_id: s.id,
                                slug: s.slug.clone(),
                                step_number: s.step_number,
                                title: step_title,
                                canonical_revision: s.canonical_revision,
                                version: s.canonical_revision.max(1),
                                estimated_minutes: s.estimated_minutes,
                                authors,
                                takedown_reason: meta.and_then(|m| m.takedown_reason.clone()),
                                takedown_at: meta.and_then(|m| m.takedown_at),
                                takedown_by: meta.and_then(|m| m.takedown_by.clone()),
                                translations,
                            })
                        })
                        .collect();

                    if is_reader_only && steps.is_empty() {
                        return None;
                    }

                    Some(StudioChapterDto {
                        chapter_id: c.id,
                        slug: c.slug.clone(),
                        number: c.number,
                        title: ch_title,
                        steps,
                    })
                })
                .collect();

            if is_reader_only && chapters.is_empty() {
                return None;
            }

            Some(StudioTrackDto {
                track_id: t.id,
                slug: t.manifest.slug.clone(),
                title,
                difficulty: sanitize_track_custom_label(&t.manifest.difficulty),
                icon_kind: normalize_track_icon_kind(&t.manifest.icon_kind),
                tags: sanitize_track_tags(&t.manifest.tags),
                is_published: true,
                chapters,
            })
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub fn read_step_editor_from_bundle(
    viewer: &UserProfileDto,
    bundle: &ContentBundle,
    track_slug: &str,
    chapter_slug: &str,
    step_slug: &str,
    locale: &str,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
    invites: &[StoredCollabInviteRecord],
    users: &[StoredUserRecord],
    gravatar_base_url: &str,
) -> Result<StudioStepEditorDto> {
    let now = Utc::now();
    if let Some(track) = bundle.tracks.iter().find(|t| t.manifest.slug == track_slug) {
        let matched = if chapter_slug.is_empty() || chapter_slug == "-" {
            track
                .chapters
                .iter()
                .find_map(|c| c.steps.iter().find(|s| s.slug == step_slug).map(|s| (c, s)))
        } else {
            track
                .chapters
                .iter()
                .find(|c| c.slug == chapter_slug)
                .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug).map(|s| (c, s)))
        };
        if let Some((ch, step)) = matched {
            let meta = step_meta.get(&step.id);
            let owner_id = meta.and_then(|m| m.owner_user_id);
            let can_read_drafts = user_can_read_local_draft(viewer, step.id, step_meta);
            let (viewer_role, _) = resolve_local_viewer_role(viewer, step.id, step_meta);
            let can_edit =
                user_can_edit_local_step_locale(viewer, step.id, locale, step_meta).is_ok();
            // Strict C-03: unowned legacy documents can only be managed by administrators
            let can_manage_collaborators =
                viewer.role.is_admin() || owner_id == Some(viewer.id);
            let can_leave = owner_id != Some(viewer.id)
                && meta.is_some_and(|m| m.is_collaborator(viewer.id));

            let pending_invites: Vec<CollaboratorInviteDto> = if can_manage_collaborators {
                invites
                    .iter()
                    .filter(|inv| {
                        inv.step_id == step.id
                            && inv.consumed_at.is_none()
                            && inv.revoked_at.is_none()
                            && inv.expires_at > now
                    })
                    .map(|inv| CollaboratorInviteDto {
                        id: inv.id,
                        email: inv.email.clone(),
                        role: normalize_collaborator_role(Some(&inv.role)),
                        locale_scope: inv.locale_scope.clone(),
                        created_at: inv.created_at,
                        expires_at: inv.expires_at,
                    })
                    .collect()
            } else {
                Vec::new()
            };

            if let Some(tr) = step.translations.get(locale) {
                if tr.compiled.frontmatter.status == "draft" && !can_read_drafts {
                    return Err(domain_err(
                        ErrorCode::DraftAccessForbidden,
                        "You do not have permission to view this unpublished draft.",
                    ));
                }
                let authors = resolve_local_step_authors(
                    step.id,
                    &tr.compiled.frontmatter.author,
                    step_meta,
                    users,
                    gravatar_base_url,
                );
                let ver = tr
                    .compiled
                    .frontmatter
                    .synced_revision
                    .max(step.canonical_revision)
                    .max(1);
                let (edit_seq, _, etag) =
                    compute_loaded_translation_etag(step.id, locale, tr, step_meta);
                return Ok(StudioStepEditorDto {
                    track_slug: track_slug.to_string(),
                    chapter_slug: ch.slug.clone(),
                    step_slug: step_slug.to_string(),
                    locale: locale.to_string(),
                    exists: true,
                    title: tr.compiled.frontmatter.title.clone(),
                    summary: tr.compiled.frontmatter.summary.clone(),
                    step_number: step.step_number,
                    estimated_minutes: tr.compiled.frontmatter.estimated_minutes,
                    synced_revision: ver,
                    canonical_revision: step.canonical_revision.max(1),
                    version: ver,
                    edit_seq,
                    etag,
                    status: tr.compiled.frontmatter.status.clone(),
                    cover_image: icehandnote_core::sanitize_cover_image_url(
                        &tr.compiled.frontmatter.cover,
                    ),
                    license: icehandnote_core::normalize_license_code(
                        &tr.compiled.frontmatter.license,
                    ),
                    tags: tr.compiled.frontmatter.tags.clone(),
                    body_markdown: extract_body_without_frontmatter(&tr.raw_markdown),
                    owner_user_id: owner_id,
                    authors,
                    pending_invites,
                    can_edit,
                    can_manage_collaborators,
                    can_leave,
                    viewer_role,
                    takedown_reason: meta.and_then(|m| m.takedown_reason.clone()),
                    takedown_at: meta.and_then(|m| m.takedown_at),
                    takedown_by: meta.and_then(|m| m.takedown_by.clone()),
                    published_at: tr.published_at,
                    updated_at: tr.updated_at,
                });
            }

            // Requested locale doesn't exist yet; only fall back to a translation the viewer is allowed to read!
            let base_tr = step
                .translations
                .get(&step.default_locale)
                .filter(|t| can_read_drafts || t.compiled.frontmatter.status != "draft")
                .or_else(|| {
                    step.translations
                        .values()
                        .find(|t| can_read_drafts || t.compiled.frontmatter.status != "draft")
                });
            if base_tr.is_none() && !can_read_drafts {
                return Err(domain_err(
                    ErrorCode::DraftAccessForbidden,
                    "You do not have permission to view this unpublished draft.",
                ));
            }
            let authors = resolve_local_step_authors(
                step.id,
                base_tr
                    .map(|t| t.compiled.frontmatter.author.as_str())
                    .unwrap_or(""),
                step_meta,
                users,
                gravatar_base_url,
            );
            let ver = step.canonical_revision.max(1);
            return Ok(StudioStepEditorDto {
                track_slug: track_slug.to_string(),
                chapter_slug: ch.slug.clone(),
                step_slug: step_slug.to_string(),
                locale: locale.to_string(),
                exists: false,
                title: String::new(),
                summary: String::new(),
                step_number: step.step_number,
                estimated_minutes: step.estimated_minutes,
                synced_revision: ver,
                canonical_revision: ver,
                version: ver,
                edit_seq: 0,
                etag: String::new(),
                status: "draft".to_string(),
                cover_image: base_tr
                    .map(|t| icehandnote_core::sanitize_cover_image_url(&t.compiled.frontmatter.cover))
                    .unwrap_or_default(),
                license: base_tr
                    .map(|t| {
                        icehandnote_core::normalize_license_code(&t.compiled.frontmatter.license)
                    })
                    .unwrap_or_default(),
                tags: base_tr
                    .map(|t| t.compiled.frontmatter.tags.clone())
                    .unwrap_or_default(),
                body_markdown: base_tr
                    .map(|t| extract_body_without_frontmatter(&t.raw_markdown))
                    .unwrap_or_default(),
                owner_user_id: owner_id,
                authors,
                pending_invites,
                can_edit,
                can_manage_collaborators,
                can_leave,
                viewer_role,
                takedown_reason: meta.and_then(|m| m.takedown_reason.clone()),
                takedown_at: meta.and_then(|m| m.takedown_at),
                takedown_by: meta.and_then(|m| m.takedown_by.clone()),
                published_at: base_tr.map(|b| b.published_at).unwrap_or(now),
                updated_at: base_tr.map(|b| b.updated_at).unwrap_or(now),
            });
        }
    }

    // Creating a brand-new article requires site-wide author/admin privileges
    if !viewer.role.can_author() {
        return Err(domain_err(
            ErrorCode::StepEditForbidden,
            "Only authors or administrators can create new articles.",
        ));
    }

    let self_author = ArticleAuthorDto {
        user_id: Some(viewer.id),
        username: viewer.username.clone(),
        display_name: viewer.display_name.clone(),
        avatar_url: viewer.avatar_url.clone(),
        is_owner: true,
        role: "owner".to_string(),
        locale_scope: Vec::new(),
    };

    Ok(StudioStepEditorDto {
        track_slug: track_slug.to_string(),
        chapter_slug: chapter_slug.to_string(),
        step_slug: step_slug.to_string(),
        locale: locale.to_string(),
        exists: false,
        title: String::new(),
        summary: String::new(),
        step_number: 1,
        estimated_minutes: 1,
        synced_revision: 1,
        canonical_revision: 1,
        version: 1,
        edit_seq: 0,
        etag: String::new(),
        status: "draft".to_string(),
        cover_image: String::new(),
        license: String::new(),
        tags: Vec::new(),
        body_markdown: String::new(),
        owner_user_id: Some(viewer.id),
        authors: vec![self_author],
        pending_invites: Vec::new(),
        can_edit: true,
        can_manage_collaborators: true,
        can_leave: false,
        viewer_role: if viewer.role.is_admin() {
            "admin".to_string()
        } else {
            "owner".to_string()
        },
        takedown_reason: None,
        takedown_at: None,
        takedown_by: None,
        published_at: now,
        updated_at: now,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn apply_save_step_to_bundle_and_disk(
    author: &UserProfileDto,
    bundle: &mut ContentBundle,
    step_meta: &mut HashMap<Uuid, StoredStepMetaRecord>,
    step_revisions: &mut Vec<StepRevisionDto>,
    audit_logs: &mut Vec<CollaborationAuditLogDto>,
    invites: &[StoredCollabInviteRecord],
    users: &[StoredUserRecord],
    gravatar_base_url: &str,
    input: &SaveStudioStepInput,
    content_dir: &Path,
    require_if_match: bool,
) -> Result<StudioStepEditorDto> {
    let clean_track_slug = input.track_slug.trim();
    if !is_valid_slug_segment(clean_track_slug) {
        return Err(domain_err(
            ErrorCode::InvalidSlug,
            "Invalid series URL slug.",
        ));
    }
    if !crate::is_supported_locale_code(&input.locale) {
        return Err(domain_err(
            ErrorCode::BadRequest,
            "Unsupported locale code.",
        ));
    }
    let target_slug = input.step_slug.trim();
    if !is_valid_step_slug_segment(target_slug) {
        return Err(domain_err(
            ErrorCode::InvalidSlug,
            "Invalid article URL slug.",
        ));
    }
    let prev_slug_opt = input
        .previous_step_slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != target_slug);
    if let Some(prev_slug) = prev_slug_opt {
        if !is_valid_step_slug_segment(prev_slug) {
            return Err(domain_err(
                ErrorCode::InvalidSlug,
                "Invalid previous article URL slug.",
            ));
        }
    }
    let lookup_slug = prev_slug_opt.unwrap_or(target_slug);

    let Some(track) = bundle
        .tracks
        .iter_mut()
        .find(|t| t.manifest.slug == clean_track_slug)
    else {
        return Err(domain_err(
            ErrorCode::TrackNotFound,
            format!("Track not found: {}", clean_track_slug),
        ));
    };
    let mut resolved_ch_slug = input.chapter_slug.trim().to_string();
    if resolved_ch_slug.is_empty() || resolved_ch_slug == "-" {
        if let Some(found) = track
            .chapters
            .iter()
            .find(|c| c.steps.iter().any(|s| s.slug == lookup_slug))
        {
            resolved_ch_slug = found.slug.clone();
        } else if let Some(first) = track.chapters.first() {
            resolved_ch_slug = first.slug.clone();
        } else {
            let mut titles = BTreeMap::new();
            for (loc, meta) in &track.manifest.translations {
                titles.insert(loc.clone(), meta.title.clone());
            }
            let ch_id = deterministic_uuid(&format!("chapter:{clean_track_slug}:chapters"));
            track.manifest.chapters.push(ChapterManifest {
                slug: "chapters".to_string(),
                number: 1,
                titles: titles.clone(),
            });
            track.chapters.push(LoadedChapter {
                id: ch_id,
                slug: "chapters".to_string(),
                number: 1,
                titles,
                steps: Vec::new(),
            });
            resolved_ch_slug = "chapters".to_string();
        }
    } else if !is_valid_slug_segment(&resolved_ch_slug) {
        return Err(domain_err(
            ErrorCode::InvalidSlug,
            "Invalid chapter URL slug.",
        ));
    }
    if prev_slug_opt.is_some()
        && track
            .chapters
            .iter()
            .any(|c| c.steps.iter().any(|s| s.slug == target_slug))
    {
        return Err(domain_err(
            ErrorCode::Conflict,
            format!(
                "An article with URL slug '{target_slug}' already exists in this series."
            ),
        ));
    }
    let Some(ch) = track
        .chapters
        .iter_mut()
        .find(|c| c.slug == resolved_ch_slug)
    else {
        return Err(domain_err(
            ErrorCode::ChapterNotFound,
            format!("Chapter not found: {resolved_ch_slug}"),
        ));
    };

    if prev_slug_opt.is_some() && !ch.steps.iter().any(|s| s.slug == lookup_slug) {
        return Err(domain_err(
            ErrorCode::StepNotFound,
            format!("Article not found: {lookup_slug}"),
        ));
    }

    let existing_step_ref = ch.steps.iter().find(|s| s.slug == lookup_slug);
    let is_existing_step = existing_step_ref.is_some();
    let step_id = existing_step_ref
        .map(|s| s.id)
        .unwrap_or_else(|| {
            deterministic_uuid(&format!(
                "step:{}:{resolved_ch_slug}:{target_slug}",
                input.track_slug
            ))
        });

    if is_existing_step {
        user_can_edit_local_step_locale(author, step_id, &input.locale, step_meta)?;
        if prev_slug_opt.is_some() {
            let (viewer_role, _) = resolve_local_viewer_role(author, step_id, step_meta);
            if viewer_role == "translator" {
                return Err(domain_err(
                    ErrorCode::CollaboratorRoleForbidden,
                    "Translators cannot rename an article URL slug across locales.",
                ));
            }
        }
    } else if !author.role.can_author() {
        return Err(domain_err(
            ErrorCode::StepEditForbidden,
            "Only authors or administrators can create new articles.",
        ));
    }

    let clean_status = if input.status == "draft" {
        "draft"
    } else {
        "published"
    };

    if let Some(meta) = step_meta.get(&step_id) {
        if meta.takedown_reason.is_some() && clean_status == "published" && !author.role.is_admin()
        {
            return Err(domain_err(
                ErrorCode::StepTakenDown,
                "This article has been taken down by an administrator. Save as draft and contact an administrator to restore it.",
            ));
        }
    }

    let now = Utc::now();
    let existing_step_opt = ch.steps.iter().find(|s| s.slug == lookup_slug);
    let existing_tr_opt = existing_step_opt.and_then(|s| s.translations.get(&input.locale));

    // RFC 9110 + RFC 6585 Optimistic Concurrency Control (If-Match / ETag)
    let current_edit_seq = if let Some(tr) = existing_tr_opt {
        let (cur_seq, _, cur_etag) =
            compute_loaded_translation_etag(step_id, &input.locale, tr, step_meta);
        match input
            .expected_etag
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(expected) => {
                if !if_match_satisfies(expected, &cur_etag) {
                    let updated_by = step_meta
                        .get(&step_id)
                        .and_then(|m| m.translation_meta.get(&input.locale))
                        .map(|tm| tm.last_editor_name.clone())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| tr.compiled.frontmatter.author.clone());
                    let remote_body = extract_body_without_frontmatter(&tr.raw_markdown);
                    return Err(revision_conflict_err(
                        expected,
                        &cur_etag,
                        cur_seq,
                        &updated_by,
                        tr.updated_at,
                        &tr.compiled.frontmatter.title,
                        &tr.compiled.frontmatter.summary,
                        &remote_body,
                    ));
                }
            }
            None if require_if_match => {
                return Err(domain_err(
                    ErrorCode::PreconditionRequired,
                    "An If-Match header with the current article ETag is required before saving.",
                ));
            }
            None => {}
        }
        cur_seq
    } else {
        0
    };
    let next_edit_seq = current_edit_seq + 1;

    let current_ver = existing_tr_opt
        .map(|tr| tr.compiled.frontmatter.synced_revision.max(1))
        .or_else(|| existing_step_opt.map(|s| s.canonical_revision.max(1)))
        .unwrap_or(1);

    let next_version = if existing_tr_opt.is_some() && clean_status == "published" {
        current_ver + 1
    } else {
        current_ver
    };
    let next_canonical = existing_step_opt
        .map(|s| s.canonical_revision.max(next_version))
        .unwrap_or(next_version);
    let published_at = match existing_tr_opt {
        Some(tr)
            if tr.compiled.frontmatter.status == "draft"
                && clean_status == "published"
                && tr.compiled.frontmatter.published_at.is_none() =>
        {
            now
        }
        Some(tr) => tr.published_at,
        None => now,
    };

    let computed_minutes = estimate_reading_minutes(&input.body_markdown);
    let clean_title = sanitize_custom_html(&input.title, 320);
    let clean_summary = sanitize_custom_html(&input.summary, 640);
    let clean_cover = icehandnote_core::sanitize_cover_image_url(&input.cover_image);
    let clean_license = icehandnote_core::normalize_license_code(&input.license);

    let new_sha256 = compute_step_content_sha256_with_cover(
        &clean_title,
        &clean_summary,
        clean_status,
        &clean_license,
        &input.tags,
        &input.body_markdown,
        &clean_cover,
    );

    let meta_entry = step_meta.entry(step_id).or_default();
    if meta_entry.owner_user_id.is_none() && (!is_existing_step || author.role.is_admin()) {
        meta_entry.owner_user_id = Some(author.id);
    }
    if meta_entry.author_name_fallback.is_empty() {
        meta_entry.author_name_fallback = author.display_name.clone();
    }
    meta_entry.translation_meta.insert(
        input.locale.clone(),
        StoredTranslationEditMeta {
            edit_seq: next_edit_seq,
            content_sha256: new_sha256.clone(),
            last_editor_name: author.display_name.clone(),
        },
    );

    let published_iso = published_at.to_rfc3339();
    let updated_iso = now.to_rfc3339();
    let raw_md = icehandnote_core::auth::format_step_markdown_file_with_cover(
        &clean_title,
        &clean_summary,
        input.step_number,
        computed_minutes,
        next_version,
        next_canonical,
        clean_status,
        &clean_license,
        &meta_entry.author_name_fallback,
        Some(&published_iso),
        Some(&updated_iso),
        &input.tags,
        Some(step_id),
        &clean_cover,
        &input.body_markdown,
    );
    let compiled = compile_notebook_markdown(&raw_md);

    if input.write_to_content_dir {
        fs::create_dir_all(content_dir)?;
        let ch_dir = content_dir.join(clean_track_slug).join(&resolved_ch_slug);
        crate::ensure_within_dir(content_dir, &ch_dir)?;
        fs::create_dir_all(&ch_dir)?;
        if let Some(prev_slug) = prev_slug_opt {
            rename_step_markdown_files(&ch_dir, prev_slug, target_slug);
        }
        let file_path = ch_dir.join(format!("{target_slug}.{}.md", input.locale));
        crate::ensure_within_dir(&ch_dir, &file_path)?;
        crate::atomic_write_str(&file_path, &raw_md)?;
    }

    if let Some(step) = ch.steps.iter_mut().find(|s| s.slug == lookup_slug) {
        step.slug = target_slug.to_string();
        step.step_number = input.step_number;
        step.estimated_minutes = computed_minutes;
        step.canonical_revision = next_canonical;
        step.translations.insert(
            input.locale.clone(),
            LoadedStepTranslation {
                locale: input.locale.clone(),
                raw_markdown: raw_md,
                compiled,
                published_at,
                updated_at: now,
            },
        );
        ch.steps.sort_by_key(|s| (s.step_number, s.slug.clone()));
    } else {
        let mut translations = BTreeMap::new();
        translations.insert(
            input.locale.clone(),
            LoadedStepTranslation {
                locale: input.locale.clone(),
                raw_markdown: raw_md,
                compiled,
                published_at,
                updated_at: now,
            },
        );
        ch.steps.push(LoadedStep {
            id: step_id,
            slug: target_slug.to_string(),
            step_number: input.step_number,
            default_locale: input.locale.clone(),
            canonical_revision: next_canonical,
            estimated_minutes: computed_minutes,
            initial_likes: 0,
            translations,
        });
        ch.steps.sort_by_key(|s| (s.step_number, s.slug.clone()));
    }

    let change_note = input
        .change_note
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .chars()
        .take(240)
        .collect::<String>();

    // Record immutable revision snapshot (keep up to 100 per step+locale in local JSON store)
    step_revisions.push(StepRevisionDto {
        id: generate_uuid_v7(),
        step_id,
        locale_code: input.locale.clone(),
        edit_seq: next_edit_seq,
        synced_revision: next_version,
        status: clean_status.to_string(),
        title: clean_title.clone(),
        summary: clean_summary.clone(),
        body_markdown: input.body_markdown.clone(),
        content_sha256: new_sha256,
        author_user_id: Some(author.id),
        author_name: author.display_name.clone(),
        change_note: change_note.clone(),
        created_at: now,
    });
    let per_key_count = step_revisions
        .iter()
        .filter(|r| r.step_id == step_id && r.locale_code == input.locale)
        .count();
    if per_key_count > 100 {
        if let Some(pos) = step_revisions
            .iter()
            .position(|r| r.step_id == step_id && r.locale_code == input.locale)
        {
            step_revisions.remove(pos);
        }
    }

    audit_logs.push(CollaborationAuditLogDto {
        id: generate_uuid_v7(),
        step_id,
        actor_user_id: Some(author.id),
        actor_name: author.display_name.clone(),
        action: "revision_saved".to_string(),
        detail: if change_note.is_empty() {
            format!("{} #{} ({clean_status})", input.locale, next_edit_seq)
        } else {
            format!(
                "{} #{} ({clean_status}) · {change_note}",
                input.locale, next_edit_seq
            )
        },
        created_at: now,
    });

    read_step_editor_from_bundle(
        author,
        bundle,
        &input.track_slug,
        &resolved_ch_slug,
        target_slug,
        &input.locale,
        step_meta,
        invites,
        users,
        gravatar_base_url,
    )
}

pub(crate) fn is_valid_slug_segment(slug: &str) -> bool {
    crate::is_valid_slug_segment(slug)
}

pub(crate) fn is_valid_step_slug_segment(slug: &str) -> bool {
    crate::is_valid_step_slug_segment(slug)
}

pub(crate) fn rename_step_markdown_files(ch_dir: &Path, prev_slug: &str, new_slug: &str) {
    if prev_slug == new_slug
        || !is_valid_step_slug_segment(prev_slug)
        || !is_valid_step_slug_segment(new_slug)
        || crate::is_symlink_path(ch_dir)
    {
        return;
    }
    let Ok(entries) = fs::read_dir(ch_dir) else {
        return;
    };
    let prefix = format!("{prev_slug}.");
    for entry in entries.flatten() {
        let path = entry.path();
        if crate::is_symlink_path(&path) || !path.is_file() {
            continue;
        }
        let Some(fname) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if let Some(rest) = fname.strip_prefix(&prefix) {
            if let Some(loc_part) = rest.strip_suffix(".md") {
                if crate::is_supported_locale_code(loc_part) {
                    let target_path = ch_dir.join(format!("{new_slug}.{rest}"));
                    if target_path != path && !crate::is_symlink_path(&target_path) {
                        let _ = fs::rename(&path, &target_path);
                    }
                }
            }
        }
    }
}

pub fn create_track_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    input: &CreateTrackInput,
    content_dir: &Path,
) -> Result<StudioTrackDto> {
    let clean_slug = input.slug.trim().to_ascii_lowercase();
    if !is_valid_slug_segment(&clean_slug) {
        return Err(domain_err(ErrorCode::InvalidSlug, "Invalid track slug."));
    }
    if bundle.tracks.iter().any(|t| t.manifest.slug == clean_slug) {
        return Err(domain_err(
            ErrorCode::TrackSlugExists,
            format!("Track slug already exists: {clean_slug}"),
        ));
    }

    let first_ch_slug = if input.first_chapter_slug.trim().is_empty() {
        "chapters".to_string()
    } else {
        input.first_chapter_slug.trim().to_ascii_lowercase()
    };
    if !is_valid_slug_segment(&first_ch_slug) {
        return Err(domain_err(ErrorCode::InvalidSlug, "Invalid chapter slug."));
    }

    let clean_title = sanitize_custom_html(&input.title_zh_tw, 240);
    let clean_sub = sanitize_custom_html(&input.subtitle_zh_tw, 320);
    let clean_desc = sanitize_custom_html(&input.description_zh_tw, 600);
    let clean_ch_title = {
        let raw_ch = sanitize_custom_html(&input.first_chapter_title, 240);
        if raw_ch.is_empty() {
            clean_title.clone()
        } else {
            raw_ch
        }
    };

    let mut translations = BTreeMap::new();
    for loc in ["zh-CN", "en", "zh-TW", "ja"] {
        translations.insert(
            loc.to_string(),
            TrackLocaleMeta {
                title: clean_title.clone(),
                subtitle: clean_sub.clone(),
                description: clean_desc.clone(),
            },
        );
    }

    let mut ch_titles = BTreeMap::new();
    for loc in ["zh-CN", "en", "zh-TW", "ja"] {
        ch_titles.insert(loc.to_string(), clean_ch_title.clone());
    }

    let ch_manifest = ChapterManifest {
        slug: first_ch_slug.clone(),
        number: 1,
        titles: ch_titles.clone(),
    };

    let sort_order = (bundle.tracks.len() as i32) + 1;
    let manifest = TrackManifest {
        slug: clean_slug.clone(),
        difficulty: sanitize_track_custom_label(&input.difficulty),
        icon_kind: normalize_track_icon_kind(&input.icon_kind),
        sort_order,
        tags: sanitize_track_tags(&input.tags),
        translations,
        chapters: vec![ch_manifest],
    };

    fs::create_dir_all(content_dir)?;
    let track_dir = content_dir.join(&clean_slug);
    crate::ensure_within_dir(content_dir, &track_dir)?;
    fs::create_dir_all(track_dir.join(&first_ch_slug))?;
    let toml_text = toml::to_string_pretty(&manifest)?;
    let manifest_path = track_dir.join("track.toml");
    crate::ensure_within_dir(&track_dir, &manifest_path)?;
    crate::atomic_write_str(&manifest_path, &toml_text)?;

    let track_id = deterministic_uuid(&format!("track:{clean_slug}"));
    let ch_id = deterministic_uuid(&format!("chapter:{clean_slug}:{first_ch_slug}"));

    bundle.tracks.push(LoadedTrack {
        id: track_id,
        manifest,
        chapters: vec![LoadedChapter {
            id: ch_id,
            slug: first_ch_slug,
            number: 1,
            titles: ch_titles,
            steps: Vec::new(),
        }],
    });

    Ok(build_studio_overview_from_bundle(
        bundle,
        None,
        "zh-CN",
        &HashMap::new(),
        &[],
        "https://www.gravatar.com/avatar",
    )
    .into_iter()
    .find(|t| t.slug == clean_slug)
    .unwrap())
}

pub fn update_track_meta_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    track_slug: &str,
    input: &UpdateTrackMetaInput,
    content_dir: &Path,
) -> Result<bool> {
    let clean = track_slug.trim();
    if !is_valid_slug_segment(clean) {
        return Err(domain_err(ErrorCode::InvalidSlug, "Invalid track slug."));
    }
    let Some(track) = bundle.tracks.iter_mut().find(|t| t.manifest.slug == clean) else {
        return Ok(false);
    };
    if let Some(ref raw_icon) = input.icon_kind {
        track.manifest.icon_kind = normalize_track_icon_kind(raw_icon);
    }
    if let Some(ref raw_diff) = input.difficulty {
        track.manifest.difficulty = sanitize_track_custom_label(raw_diff);
    }
    if let Some(ref raw_tags) = input.tags {
        track.manifest.tags = sanitize_track_tags(raw_tags);
    }
    let track_dir = content_dir.join(clean);
    if track_dir.exists()
        && !crate::is_symlink_path(&track_dir)
        && crate::ensure_within_dir(content_dir, &track_dir).is_ok()
    {
        let toml_text = toml::to_string_pretty(&track.manifest)?;
        let manifest_path = track_dir.join("track.toml");
        crate::ensure_within_dir(&track_dir, &manifest_path)?;
        crate::atomic_write_str(&manifest_path, &toml_text)?;
    }
    Ok(true)
}

pub fn delete_track_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    track_slug: &str,
    content_dir: &Path,
) -> Result<(bool, Vec<Uuid>)> {
    let clean = track_slug.trim();
    if !is_valid_slug_segment(clean) {
        return Ok((false, Vec::new()));
    }
    let mut removed_step_ids = Vec::new();
    if let Some(t) = bundle.tracks.iter().find(|t| t.manifest.slug == clean) {
        for ch in &t.chapters {
            for s in &ch.steps {
                removed_step_ids.push(s.id);
            }
        }
    }
    let before = bundle.tracks.len();
    bundle.tracks.retain(|t| t.manifest.slug != clean);
    let removed = bundle.tracks.len() < before;
    if removed && content_dir.exists() {
        let track_dir = content_dir.join(clean);
        if track_dir.exists()
            && !crate::is_symlink_path(&track_dir)
            && crate::ensure_within_dir(content_dir, &track_dir).is_ok()
        {
            let _ = fs::remove_dir_all(&track_dir);
        }
    }
    Ok((removed, removed_step_ids))
}

pub fn create_chapter_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    input: &CreateChapterInput,
    content_dir: &Path,
) -> Result<()> {
    let clean_track = input.track_slug.trim();
    if !is_valid_slug_segment(clean_track) {
        return Err(domain_err(ErrorCode::InvalidSlug, "Invalid track slug."));
    }
    let Some(track) = bundle
        .tracks
        .iter_mut()
        .find(|t| t.manifest.slug == clean_track)
    else {
        return Err(domain_err(
            ErrorCode::TrackNotFound,
            format!("Track not found: {}", clean_track),
        ));
    };
    let clean_slug = input.slug.trim().to_ascii_lowercase();
    if !is_valid_slug_segment(&clean_slug) {
        return Err(domain_err(ErrorCode::InvalidSlug, "Invalid chapter slug."));
    }
    if track.chapters.iter().any(|c| c.slug == clean_slug) {
        return Err(domain_err(
            ErrorCode::ChapterSlugExists,
            format!("Chapter slug already exists: {clean_slug}"),
        ));
    }

    let clean_title = sanitize_custom_html(&input.title_zh_tw, 240);
    let mut titles = BTreeMap::new();
    for loc in ["zh-CN", "en", "zh-TW", "ja"] {
        titles.insert(loc.to_string(), clean_title.clone());
    }

    track.manifest.chapters.push(ChapterManifest {
        slug: clean_slug.clone(),
        number: input.number,
        titles: titles.clone(),
    });

    fs::create_dir_all(content_dir)?;
    let track_dir = content_dir.join(clean_track);
    crate::ensure_within_dir(content_dir, &track_dir)?;
    let ch_dir = track_dir.join(&clean_slug);
    crate::ensure_within_dir(&track_dir, &ch_dir)?;
    fs::create_dir_all(&ch_dir)?;
    let manifest_path = track_dir.join("track.toml");
    crate::ensure_within_dir(&track_dir, &manifest_path)?;
    crate::atomic_write_str(&manifest_path, &toml::to_string_pretty(&track.manifest)?)?;

    let ch_id = deterministic_uuid(&format!("chapter:{clean_track}:{clean_slug}"));
    track.chapters.push(LoadedChapter {
        id: ch_id,
        slug: clean_slug,
        number: input.number,
        titles,
        steps: Vec::new(),
    });
    track.chapters.sort_by_key(|c| c.number);
    Ok(())
}

pub fn delete_chapter_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    track_slug: &str,
    chapter_slug: &str,
    content_dir: &Path,
) -> Result<(bool, Vec<Uuid>)> {
    if !is_valid_slug_segment(track_slug) || !is_valid_slug_segment(chapter_slug) {
        return Ok((false, Vec::new()));
    }
    let Some(track) = bundle
        .tracks
        .iter_mut()
        .find(|t| t.manifest.slug == track_slug)
    else {
        return Ok((false, Vec::new()));
    };
    let mut removed_step_ids = Vec::new();
    if let Some(ch) = track.chapters.iter().find(|c| c.slug == chapter_slug) {
        for s in &ch.steps {
            removed_step_ids.push(s.id);
        }
    }
    let before = track.chapters.len();
    track.chapters.retain(|c| c.slug != chapter_slug);
    track.manifest.chapters.retain(|c| c.slug != chapter_slug);
    let removed = track.chapters.len() < before;

    if removed && content_dir.exists() {
        let track_dir = content_dir.join(track_slug);
        if track_dir.exists()
            && !crate::is_symlink_path(&track_dir)
            && crate::ensure_within_dir(content_dir, &track_dir).is_ok()
        {
            if let Ok(toml_str) = toml::to_string_pretty(&track.manifest) {
                let _ = crate::atomic_write_str(&track_dir.join("track.toml"), &toml_str);
            }
            let ch_dir = track_dir.join(chapter_slug);
            if ch_dir.exists()
                && !crate::is_symlink_path(&ch_dir)
                && crate::ensure_within_dir(&track_dir, &ch_dir).is_ok()
            {
                let _ = fs::remove_dir_all(&ch_dir);
            }
        }
    }
    Ok((removed, removed_step_ids))
}

pub fn delete_step_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    track_slug: &str,
    chapter_slug: &str,
    step_slug: &str,
    content_dir: &Path,
) -> Result<(bool, Option<Uuid>)> {
    if !is_valid_slug_segment(track_slug)
        || !is_valid_slug_segment(chapter_slug)
        || !is_valid_step_slug_segment(step_slug)
    {
        return Ok((false, None));
    }
    let Some(track) = bundle.tracks.iter_mut().find(|t| t.manifest.slug == track_slug) else {
        return Ok((false, None));
    };
    let Some(ch) = track.chapters.iter_mut().find(|c| c.slug == chapter_slug) else {
        return Ok((false, None));
    };
    let found_id = ch.steps.iter().find(|s| s.slug == step_slug).map(|s| s.id);
    let before = ch.steps.len();
    ch.steps.retain(|s| s.slug != step_slug);
    let removed = ch.steps.len() < before;

    if removed && content_dir.exists() {
        let ch_dir = content_dir.join(track_slug).join(chapter_slug);
        if ch_dir.exists()
            && !crate::is_symlink_path(&ch_dir)
            && crate::ensure_within_dir(content_dir, &ch_dir).is_ok()
        {
            for entry in fs::read_dir(&ch_dir)?.flatten() {
                let p = entry.path();
                if crate::is_symlink_path(&p) || !p.is_file() {
                    continue;
                }
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with(&format!("{step_slug}.")) && name.ends_with(".md") {
                        let _ = fs::remove_file(p);
                    }
                }
            }
        }
    }
    Ok((removed, found_id))
}
