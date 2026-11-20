use crate::content_loader::{
    deterministic_uuid, ChapterManifest, ContentBundle, LoadedChapter, LoadedStep,
    LoadedStepTranslation, LoadedTrack, TrackLocaleMeta, TrackManifest,
};
use anyhow::{bail, Result};
use chrono::{Duration, Utc};
use icehandnote_core::{
    auth::{
        extract_body_without_frontmatter, format_step_markdown_file, hash_password,
        hash_session_token, verify_password, BlogSsoClaims, CreateChapterInput, CreateTrackInput,
        SaveStudioStepInput, StudioChapterDto, StudioLocaleBadgeDto, StudioStepEditorDto,
        StudioStepRowDto, StudioTrackDto, UserProfileDto, UserRole,
    },
    compile_notebook_markdown,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredUserRecord {
    pub profile: UserProfileDto,
    pub password_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSessionRecord {
    pub token_hash: String,
    pub user_id: Uuid,
    pub expires_at: chrono::DateTime<Utc>,
}

pub fn default_seeded_blog_users() -> Vec<StoredUserRecord> {
    let now = Utc::now();
    vec![
        StoredUserRecord {
            profile: UserProfileDto {
                id: deterministic_uuid("user:wp:1:admin"),
                wp_user_id: Some(1),
                username: "admin".to_string(),
                display_name: "Admin".to_string(),
                email: "admin@example.com".to_string(),
                avatar_url: "".to_string(),
                bio: "Site Administrator".to_string(),
                role: UserRole::Admin,
                auth_source: "local".to_string(),
                last_login_at: now,
            },
            password_hash: Some(hash_password("admin", "icehandnote2026")),
        },
        StoredUserRecord {
            profile: UserProfileDto {
                id: deterministic_uuid("user:wp:12:demo_author"),
                wp_user_id: Some(12),
                username: "demo_author".to_string(),
                display_name: "Author".to_string(),
                email: "author@example.com".to_string(),
                avatar_url: "".to_string(),
                bio: "Contributing Author".to_string(),
                role: UserRole::Author,
                auth_source: "local".to_string(),
                last_login_at: now,
            },
            password_hash: Some(hash_password("demo_author", "author2026")),
        },
        StoredUserRecord {
            profile: UserProfileDto {
                id: deterministic_uuid("user:wp:108:demo_reader"),
                wp_user_id: Some(108),
                username: "demo_reader".to_string(),
                display_name: "Reader".to_string(),
                email: "reader@example.com".to_string(),
                avatar_url: "".to_string(),
                bio: "Subscribed Reader".to_string(),
                role: UserRole::Reader,
                auth_source: "local".to_string(),
                last_login_at: now,
            },
            password_hash: Some(hash_password("demo_reader", "reader2026")),
        },
    ]
}

pub fn generate_raw_session_token() -> (String, String, chrono::DateTime<Utc>) {
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

    // Match strictly by WordPress user ID or email — never by username alone,
    // otherwise a WP user who happens to share a local username could take over that account.
    if let Some(existing) = users.iter_mut().find(|u| {
        u.profile.wp_user_id == Some(claims.wp_user_id)
            || (u.profile.wp_user_id.is_none()
                && !claims.email.is_empty()
                && u.profile.email.eq_ignore_ascii_case(&claims.email))
    }) {
        existing.profile.wp_user_id = Some(claims.wp_user_id);
        existing.profile.display_name = claims.display_name.clone();
        if !claims.avatar_url.is_empty() {
            existing.profile.avatar_url = claims.avatar_url.clone();
        }
        // Upgrade role if WordPress role is higher, while preserving local promotions
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
    let profile = UserProfileDto {
        id: Uuid::new_v4(),
        wp_user_id: Some(claims.wp_user_id),
        username: claims.username.clone(),
        display_name: claims.display_name.clone(),
        email: claims.email.clone(),
        avatar_url: claims.avatar_url.clone(),
        bio: if source_host.is_empty() {
            "外部 SSO 同步账号".to_string()
        } else {
            format!("同步自 {source_host} 账号")
        },
        role: wp_role,
        auth_source,
        last_login_at: now,
    };
    users.push(StoredUserRecord {
        profile: profile.clone(),
        password_hash: None,
    });
    profile
}

pub fn build_studio_overview_from_bundle(
    bundle: &ContentBundle,
    locale: &str,
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
                            let step_title = s
                                .translations
                                .get(locale)
                                .or_else(|| s.translations.get(&s.default_locale))
                                .or_else(|| s.translations.values().next())
                                .map(|tr| tr.compiled.frontmatter.title.clone())
                                .unwrap_or_else(|| s.slug.clone());

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

                            StudioStepRowDto {
                                step_id: s.id,
                                slug: s.slug.clone(),
                                step_number: s.step_number,
                                title: step_title,
                                canonical_revision: s.canonical_revision,
                                estimated_minutes: s.estimated_minutes,
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

pub fn read_step_editor_from_bundle(
    bundle: &ContentBundle,
    track_slug: &str,
    chapter_slug: &str,
    step_slug: &str,
    locale: &str,
) -> StudioStepEditorDto {
    if let Some(track) = bundle.tracks.iter().find(|t| t.manifest.slug == track_slug) {
        if let Some(ch) = track.chapters.iter().find(|c| c.slug == chapter_slug) {
            if let Some(step) = ch.steps.iter().find(|s| s.slug == step_slug) {
                if let Some(tr) = step.translations.get(locale) {
                    return StudioStepEditorDto {
                        track_slug: track_slug.to_string(),
                        chapter_slug: chapter_slug.to_string(),
                        step_slug: step_slug.to_string(),
                        locale: locale.to_string(),
                        exists: true,
                        title: tr.compiled.frontmatter.title.clone(),
                        summary: tr.compiled.frontmatter.summary.clone(),
                        step_number: step.step_number,
                        estimated_minutes: step.estimated_minutes,
                        synced_revision: tr.compiled.frontmatter.synced_revision,
                        canonical_revision: step.canonical_revision,
                        status: tr.compiled.frontmatter.status.clone(),
                        license: icehandnote_core::normalize_license_code(
                            &tr.compiled.frontmatter.license,
                        ),
                        tags: tr.compiled.frontmatter.tags.clone(),
                        body_markdown: extract_body_without_frontmatter(&tr.raw_markdown),
                    };
                }

                // Step exists in another locale: prefill metadata to assist translation!
                let base_tr = step
                    .translations
                    .get(&step.default_locale)
                    .or_else(|| step.translations.values().next());
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
                    synced_revision: step.canonical_revision,
                    canonical_revision: step.canonical_revision,
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
                };
            }
        }
    }

    // Brand-new step template
    StudioStepEditorDto {
        track_slug: track_slug.to_string(),
        chapter_slug: chapter_slug.to_string(),
        step_slug: step_slug.to_string(),
        locale: locale.to_string(),
        exists: false,
        title: String::new(),
        summary: String::new(),
        step_number: 1,
        estimated_minutes: 10,
        synced_revision: 1,
        canonical_revision: 1,
        status: "published".to_string(),
        license: String::new(),
        tags: Vec::new(),
        body_markdown: String::new(),
    }
}

pub fn apply_save_step_to_bundle_and_disk(
    bundle: &mut ContentBundle,
    input: &SaveStudioStepInput,
    content_dir: &Path,
) -> Result<StudioStepEditorDto> {
    let Some(track) = bundle
        .tracks
        .iter_mut()
        .find(|t| t.manifest.slug == input.track_slug)
    else {
        bail!("找不到專題：{}", input.track_slug);
    };
    let Some(ch) = track
        .chapters
        .iter_mut()
        .find(|c| c.slug == input.chapter_slug)
    else {
        bail!("找不到章節：{}", input.chapter_slug);
    };

    let existing_canonical = ch
        .steps
        .iter()
        .find(|s| s.slug == input.step_slug)
        .map(|s| s.canonical_revision)
        .unwrap_or(1);

    let next_canonical = if input.bump_canonical {
        existing_canonical + 1
    } else {
        existing_canonical.max(input.synced_revision)
    };
    let next_synced = if input.bump_canonical {
        next_canonical
    } else {
        input.synced_revision.max(1)
    };

    let raw_md = format_step_markdown_file(
        &input.title,
        &input.summary,
        input.step_number,
        input.estimated_minutes,
        next_synced,
        next_canonical,
        &input.status,
        &input.license,
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
        step.estimated_minutes = input.estimated_minutes;
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
        let step_id = deterministic_uuid(&format!(
            "step:{}:{}:{}",
            input.track_slug, input.chapter_slug, input.step_slug
        ));
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
            estimated_minutes: input.estimated_minutes,
            initial_likes: 1,
            translations,
        });
        ch.steps.sort_by_key(|s| (s.step_number, s.slug.clone()));
    }

    Ok(read_step_editor_from_bundle(
        bundle,
        &input.track_slug,
        &input.chapter_slug,
        &input.step_slug,
        &input.locale,
    ))
}

pub fn create_track_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    input: &CreateTrackInput,
    content_dir: &Path,
) -> Result<StudioTrackDto> {
    let clean_slug = input.slug.trim().to_ascii_lowercase();
    if clean_slug.is_empty() || clean_slug.contains('/') || clean_slug.contains('\\') {
        bail!("無效的專題 Slug");
    }
    if bundle.tracks.iter().any(|t| t.manifest.slug == clean_slug) {
        bail!("專題 Slug 已存在：{clean_slug}");
    }

    let first_ch_slug = if input.first_chapter_slug.trim().is_empty() {
        "01-getting-started".to_string()
    } else {
        input.first_chapter_slug.trim().to_ascii_lowercase()
    };

    let mut translations = BTreeMap::new();
    for loc in ["zh-CN", "en", "zh-TW", "ja"] {
        translations.insert(
            loc.to_string(),
            TrackLocaleMeta {
                title: input.title_zh_tw.clone(),
                subtitle: input.subtitle_zh_tw.clone(),
                description: input.description_zh_tw.clone(),
            },
        );
    }

    let mut ch_titles = BTreeMap::new();
    for loc in ["zh-CN", "en", "zh-TW", "ja"] {
        ch_titles.insert(loc.to_string(), input.first_chapter_title.clone());
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

    Ok(build_studio_overview_from_bundle(bundle, "zh-CN")
        .into_iter()
        .find(|t| t.slug == clean_slug)
        .unwrap())
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
        bail!("找不到專題：{}", input.track_slug);
    };
    let clean_slug = input.slug.trim().to_ascii_lowercase();
    if track.chapters.iter().any(|c| c.slug == clean_slug) {
        bail!("章節 Slug 已存在：{clean_slug}");
    }

    let mut titles = BTreeMap::new();
    for loc in ["zh-CN", "en", "zh-TW", "ja"] {
        titles.insert(loc.to_string(), input.title_zh_tw.clone());
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

pub fn delete_step_in_bundle_and_disk(
    bundle: &mut ContentBundle,
    track_slug: &str,
    chapter_slug: &str,
    step_slug: &str,
    content_dir: &Path,
) -> Result<bool> {
    let Some(track) = bundle.tracks.iter_mut().find(|t| t.manifest.slug == track_slug) else {
        return Ok(false);
    };
    let Some(ch) = track.chapters.iter_mut().find(|c| c.slug == chapter_slug) else {
        return Ok(false);
    };
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
    Ok(removed)
}
