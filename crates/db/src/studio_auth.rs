use crate::content_loader::{
    deterministic_uuid, ChapterManifest, ContentBundle, LoadedChapter, LoadedStep,
    LoadedStepTranslation, LoadedTrack, TrackLocaleMeta, TrackManifest,
};
use crate::domain_err;
use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use icehandnote_core::{
    auth::{
        extract_body_without_frontmatter, format_step_markdown_file_with_author, hash_password,
        hash_session_token, verify_password, ArticleAuthorDto, BlogSsoClaims,
        CollaboratorInviteDto, CreateChapterInput, CreateTrackInput, SaveStudioStepInput,
        StudioChapterDto, StudioLocaleBadgeDto, StudioStepEditorDto, StudioStepRowDto,
        StudioTrackDto, UserProfileDto, UserRole,
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
pub struct StoredUserRecord {
    pub profile: UserProfileDto,
    pub password_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_sub: Option<String>,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StoredStepMetaRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<Uuid>,
    #[serde(default)]
    pub collaborator_ids: Vec<Uuid>,
    #[serde(default)]
    pub author_name_fallback: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takedown_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCollabInviteRecord {
    pub id: Uuid,
    pub step_id: Uuid,
    pub email: String,
    pub token_hash: String,
    pub invited_by: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
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
            bio: "Site Administrator".to_string(),
            role: UserRole::Admin,
            auth_source: "local".to_string(),
            is_banned: false,
            ban_reason: String::new(),
            last_login_at: now,
        },
        password_hash: Some(hash_password("admin", "icehandnote2026")),
        oauth_provider: None,
        oauth_sub: None,
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

    if let Some(existing) = users.iter_mut().find(|u| {
        u.profile.wp_user_id == Some(claims.wp_user_id)
            || (u.profile.wp_user_id.is_none()
                && !claims.email.is_empty()
                && u.profile.email.eq_ignore_ascii_case(&claims.email))
    }) {
        existing.profile.wp_user_id = Some(claims.wp_user_id);
        existing.profile.display_name = claims.display_name.clone();
        if !claims.avatar_url.is_empty() {
            existing.profile.oauth_avatar_url = claims.avatar_url.clone();
            if existing.profile.avatar_source == "default" && existing.profile.avatar_url.is_empty() {
                existing.profile.avatar_url = claims.avatar_url.clone();
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
    let avatar_source = if claims.avatar_url.trim().is_empty() {
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
        avatar_url: claims.avatar_url.clone(),
        avatar_source,
        oauth_avatar_url: claims.avatar_url.clone(),
        uploaded_avatar_url: String::new(),
        oauth_provider: None,
        bio: String::new(),
        role: wp_role,
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
                });
            }
        }
        for cid in &meta.collaborator_ids {
            if Some(*cid) == meta.owner_user_id {
                continue;
            }
            if let Some(u) = users.iter().find(|r| r.profile.id == *cid) {
                let resolved = u.profile.clone().with_resolved_avatar(gravatar_base_url);
                authors.push(ArticleAuthorDto {
                    user_id: Some(resolved.id),
                    username: resolved.username,
                    display_name: resolved.display_name,
                    avatar_url: resolved.avatar_url,
                    is_owner: false,
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
        });
    }
    authors
}

pub fn user_can_edit_local_step(
    user: &UserProfileDto,
    step_id: Uuid,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
) -> bool {
    if user.role.is_admin() {
        return true;
    }
    if !user.role.can_author() {
        return false;
    }
    let Some(meta) = step_meta.get(&step_id) else {
        return true;
    };
    match meta.owner_user_id {
        None => true,
        Some(owner_id) => owner_id == user.id || meta.collaborator_ids.contains(&user.id),
    }
}

pub fn build_studio_overview_from_bundle(
    bundle: &ContentBundle,
    locale: &str,
    step_meta: &HashMap<Uuid, StoredStepMetaRecord>,
    users: &[StoredUserRecord],
    gravatar_base_url: &str,
) -> Vec<StudioTrackDto> {
    bundle
        .tracks
        .iter()
        .map(|t| {
            let title = t
                .manifest
                .translations
                .get(locale)
                .or_else(|| t.manifest.translations.get("zh-CN"))
                .or_else(|| t.manifest.translations.get("en"))
                .or_else(|| t.manifest.translations.values().next())
                .map(|m| m.title.clone())
                .unwrap_or_else(|| t.manifest.slug.clone());

            let chapters = t
                .chapters
                .iter()
                .map(|c| {
                    let ch_title = c
                        .titles
                        .get(locale)
                        .or_else(|| c.titles.get("zh-CN"))
                        .or_else(|| c.titles.get("en"))
                        .or_else(|| c.titles.values().next())
                        .cloned()
                        .unwrap_or_else(|| c.slug.clone());

                    let steps = c
                        .steps
                        .iter()
                        .map(|s| {
                            let tr_pref = s
                                .translations
                                .get(locale)
                                .or_else(|| s.translations.get(&s.default_locale))
                                .or_else(|| s.translations.values().next());

                            let step_title = tr_pref
                                .map(|tr| tr.compiled.frontmatter.title.clone())
                                .unwrap_or_else(|| s.slug.clone());
                            let fm_author = tr_pref
                                .map(|tr| tr.compiled.frontmatter.author.as_str())
                                .unwrap_or("");

                            let translations = s
                                .translations
                                .values()
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

                            StudioStepRowDto {
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
                            }
                        })
                        .collect();

                    StudioChapterDto {
                        chapter_id: c.id,
                        slug: c.slug.clone(),
                        number: c.number,
                        title: ch_title,
                        steps,
                    }
                })
                .collect();

            StudioTrackDto {
                track_id: t.id,
                slug: t.manifest.slug.clone(),
                title,
                difficulty: t.manifest.difficulty.clone(),
                icon_kind: t.manifest.icon_kind.clone(),
                is_published: true,
                chapters,
            }
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
) -> StudioStepEditorDto {
    let now = Utc::now();
    if let Some(track) = bundle.tracks.iter().find(|t| t.manifest.slug == track_slug) {
        if let Some(ch) = track.chapters.iter().find(|c| c.slug == chapter_slug) {
            if let Some(step) = ch.steps.iter().find(|s| s.slug == step_slug) {
                let meta = step_meta.get(&step.id);
                let owner_id = meta.and_then(|m| m.owner_user_id);
                let can_manage_collaborators = viewer.role.is_admin()
                    || owner_id.is_none()
                    || owner_id == Some(viewer.id);

                let pending_invites: Vec<CollaboratorInviteDto> = invites
                    .iter()
                    .filter(|inv| inv.step_id == step.id && inv.expires_at > now)
                    .map(|inv| CollaboratorInviteDto {
                        id: inv.id,
                        email: inv.email.clone(),
                        created_at: inv.created_at,
                        expires_at: inv.expires_at,
                    })
                    .collect();

                if let Some(tr) = step.translations.get(locale) {
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
                    return StudioStepEditorDto {
                        track_slug: track_slug.to_string(),
                        chapter_slug: chapter_slug.to_string(),
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
                        status: tr.compiled.frontmatter.status.clone(),
                        license: icehandnote_core::normalize_license_code(
                            &tr.compiled.frontmatter.license,
                        ),
                        tags: tr.compiled.frontmatter.tags.clone(),
                        body_markdown: extract_body_without_frontmatter(&tr.raw_markdown),
                        owner_user_id: owner_id,
                        authors,
                        pending_invites,
                        can_manage_collaborators,
                        takedown_reason: meta.and_then(|m| m.takedown_reason.clone()),
                        takedown_at: meta.and_then(|m| m.takedown_at),
                        takedown_by: meta.and_then(|m| m.takedown_by.clone()),
                    };
                }

                let base_tr = step
                    .translations
                    .get(&step.default_locale)
                    .or_else(|| step.translations.values().next());
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
                return StudioStepEditorDto {
                    track_slug: track_slug.to_string(),
                    chapter_slug: chapter_slug.to_string(),
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
                    status: "draft".to_string(),
                    license: base_tr
                        .map(|t| icehandnote_core::normalize_license_code(&t.compiled.frontmatter.license))
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
                    can_manage_collaborators,
                    takedown_reason: meta.and_then(|m| m.takedown_reason.clone()),
                    takedown_at: meta.and_then(|m| m.takedown_at),
                    takedown_by: meta.and_then(|m| m.takedown_by.clone()),
                };
            }
        }
    }

    let self_author = ArticleAuthorDto {
        user_id: Some(viewer.id),
        username: viewer.username.clone(),
        display_name: viewer.display_name.clone(),
        avatar_url: viewer.avatar_url.clone(),
        is_owner: true,
    };

    StudioStepEditorDto {
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
        status: "published".to_string(),
        license: String::new(),
        tags: Vec::new(),
        body_markdown: String::new(),
        owner_user_id: Some(viewer.id),
        authors: vec![self_author],
        pending_invites: Vec::new(),
        can_manage_collaborators: true,
        takedown_reason: None,
        takedown_at: None,
        takedown_by: None,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn apply_save_step_to_bundle_and_disk(
    author: &UserProfileDto,
    bundle: &mut ContentBundle,
    step_meta: &mut HashMap<Uuid, StoredStepMetaRecord>,
    invites: &[StoredCollabInviteRecord],
    users: &[StoredUserRecord],
    gravatar_base_url: &str,
    input: &SaveStudioStepInput,
    content_dir: &Path,
) -> Result<StudioStepEditorDto> {
    let Some(track) = bundle
        .tracks
        .iter_mut()
        .find(|t| t.manifest.slug == input.track_slug)
    else {
        return Err(domain_err(
            ErrorCode::TrackNotFound,
            format!("Track not found: {}", input.track_slug),
        ));
    };
    let Some(ch) = track
        .chapters
        .iter_mut()
        .find(|c| c.slug == input.chapter_slug)
    else {
        return Err(domain_err(
            ErrorCode::ChapterNotFound,
            format!("Chapter not found: {}", input.chapter_slug),
        ));
    };

    let step_id = ch
        .steps
        .iter()
        .find(|s| s.slug == input.step_slug)
        .map(|s| s.id)
        .unwrap_or_else(|| {
            deterministic_uuid(&format!(
                "step:{}:{}:{}",
                input.track_slug, input.chapter_slug, input.step_slug
            ))
        });

    if !user_can_edit_local_step(author, step_id, step_meta) {
        return Err(domain_err(
            ErrorCode::StepEditForbidden,
            "You do not have permission to edit this article.",
        ));
    }

    let clean_status = if input.status == "draft" {
        "draft"
    } else {
        "published"
    };

    if let Some(meta) = step_meta.get(&step_id) {
        if meta.takedown_reason.is_some() && clean_status == "published" && !author.role.is_admin() {
            return Err(domain_err(
                ErrorCode::StepTakenDown,
                "This article has been taken down by an administrator. Save as draft and contact an administrator to restore it.",
            ));
        }
    }

    // Clean automatic version calculation:
    // - Brand-new article starts at v1
    // - Saving a draft never inflates version numbers
    // - Publishing updates on an already-existing translation increments version by +1
    let existing_step_opt = ch.steps.iter().find(|s| s.slug == input.step_slug);
    let existing_tr_opt = existing_step_opt.and_then(|s| s.translations.get(&input.locale));
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

    let computed_minutes = estimate_reading_minutes(&input.body_markdown);
    let clean_title = sanitize_custom_html(&input.title, 320);
    let clean_summary = sanitize_custom_html(&input.summary, 640);

    let meta_entry = step_meta.entry(step_id).or_default();
    if meta_entry.owner_user_id.is_none() {
        meta_entry.owner_user_id = Some(author.id);
    }
    if meta_entry.author_name_fallback.is_empty() {
        meta_entry.author_name_fallback = author.display_name.clone();
    }

    let raw_md = format_step_markdown_file_with_author(
        &clean_title,
        &clean_summary,
        input.step_number,
        computed_minutes,
        next_version,
        next_canonical,
        clean_status,
        &input.license,
        &meta_entry.author_name_fallback,
        &input.tags,
        &input.body_markdown,
    );
    let compiled = compile_notebook_markdown(&raw_md);
    let now = Utc::now();

    if input.write_to_content_dir {
        let ch_dir = content_dir.join(&input.track_slug).join(&input.chapter_slug);
        fs::create_dir_all(&ch_dir)?;
        let file_path = ch_dir.join(format!("{}.{}.md", input.step_slug, input.locale));
        fs::write(&file_path, &raw_md)?;
    }

    if let Some(step) = ch.steps.iter_mut().find(|s| s.slug == input.step_slug) {
        step.step_number = input.step_number;
        step.estimated_minutes = computed_minutes;
        step.canonical_revision = next_canonical;
        step.translations.insert(
            input.locale.clone(),
            LoadedStepTranslation {
                locale: input.locale.clone(),
                raw_markdown: raw_md,
                compiled,
                updated_at: now,
            },
        );
    } else {
        let mut translations = BTreeMap::new();
        translations.insert(
            input.locale.clone(),
            LoadedStepTranslation {
                locale: input.locale.clone(),
                raw_markdown: raw_md,
                compiled,
                updated_at: now,
            },
        );
        ch.steps.push(LoadedStep {
            id: step_id,
            slug: input.step_slug.clone(),
            step_number: input.step_number,
            default_locale: input.locale.clone(),
            canonical_revision: next_canonical,
            estimated_minutes: computed_minutes,
            initial_likes: 0,
            translations,
        });
        ch.steps.sort_by_key(|s| (s.step_number, s.slug.clone()));
    }

    Ok(read_step_editor_from_bundle(
        author,
        bundle,
        &input.track_slug,
        &input.chapter_slug,
        &input.step_slug,
        &input.locale,
        step_meta,
        invites,
        users,
        gravatar_base_url,
    ))
}

fn is_valid_slug_segment(slug: &str) -> bool {
    !slug.is_empty()
        && !slug.contains('/')
        && !slug.contains('\\')
        && !slug.contains("..")
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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
        "01-getting-started".to_string()
    } else {
        input.first_chapter_slug.trim().to_ascii_lowercase()
    };
    if !is_valid_slug_segment(&first_ch_slug) {
        return Err(domain_err(ErrorCode::InvalidSlug, "Invalid chapter slug."));
    }

    let clean_title = sanitize_custom_html(&input.title_zh_tw, 240);
    let clean_sub = sanitize_custom_html(&input.subtitle_zh_tw, 320);
    let clean_desc = sanitize_custom_html(&input.description_zh_tw, 600);
    let clean_ch_title = sanitize_custom_html(&input.first_chapter_title, 240);

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
        difficulty: input.difficulty.clone(),
        icon_kind: input.icon_kind.clone(),
        sort_order,
        tags: input.tags.clone(),
        translations,
        chapters: vec![ch_manifest],
    };

    let track_dir = content_dir.join(&clean_slug);
    fs::create_dir_all(track_dir.join(&first_ch_slug))?;
    let toml_text = toml::to_string_pretty(&manifest)?;
    fs::write(track_dir.join("track.toml"), toml_text)?;

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
        "zh-CN",
        &HashMap::new(),
        &[],
        "https://www.gravatar.com/avatar",
    )
    .into_iter()
    .find(|t| t.slug == clean_slug)
    .unwrap())
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
    if removed {
        let track_dir = content_dir.join(clean);
        if track_dir.exists() {
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
    let Some(track) = bundle
        .tracks
        .iter_mut()
        .find(|t| t.manifest.slug == input.track_slug)
    else {
        return Err(domain_err(
            ErrorCode::TrackNotFound,
            format!("Track not found: {}", input.track_slug),
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

    let track_dir = content_dir.join(&input.track_slug);
    fs::create_dir_all(track_dir.join(&clean_slug))?;
    fs::write(
        track_dir.join("track.toml"),
        toml::to_string_pretty(&track.manifest)?,
    )?;

    let ch_id = deterministic_uuid(&format!("chapter:{}:{clean_slug}", input.track_slug));
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

    if removed {
        let track_dir = content_dir.join(track_slug);
        if track_dir.exists() {
            let _ = fs::write(
                track_dir.join("track.toml"),
                toml::to_string_pretty(&track.manifest).unwrap_or_default(),
            );
            let ch_dir = track_dir.join(chapter_slug);
            if ch_dir.exists() {
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
        || !is_valid_slug_segment(step_slug)
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

    if removed {
        let ch_dir = content_dir.join(track_slug).join(chapter_slug);
        if ch_dir.exists() {
            for entry in fs::read_dir(&ch_dir)?.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with(&format!("{step_slug}.")) && name.ends_with(".md") {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
    Ok((removed, found_id))
}
