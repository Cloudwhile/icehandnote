use crate::{
    content_loader::{load_content_directory, ContentBundle, LoadedStep, LoadedStepTranslation, LoadedTrack},
    studio_auth::{
        apply_save_step_to_bundle_and_disk, build_studio_overview_from_bundle,
        create_chapter_in_bundle_and_disk, create_track_in_bundle_and_disk,
        default_seeded_blog_users, delete_chapter_in_bundle_and_disk,
        delete_step_in_bundle_and_disk, delete_track_in_bundle_and_disk,
        generate_raw_session_token, match_local_user_password, read_step_editor_from_bundle,
        resolve_local_step_authors, upsert_local_blog_user, user_can_edit_local_step_locale,
        user_can_read_local_draft, StoredCollabInviteRecord, StoredEmailVerificationRecord,
        StoredLoginOtpChallengeRecord, StoredOAuthBinding, StoredPasswordResetRecord,
        StoredSessionRecord, StoredStepMetaRecord, StoredTrustedDeviceRecord, StoredUserRecord,
    },
    domain_err, if_match_satisfies, note_quota_for_owner, precondition_failed_err,
    TutorialRepository, NOTE_UNDO_GRACE_MINUTES,
};
use anyhow::Result;
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use icehandnote_core::{
    auth::{
        constant_time_str_eq, evaluate_login_anomaly, generate_action_token,
        generate_email_verification_code, hash_action_token, hash_email_verification_code,
        hash_password, hash_session_token, mask_email_address, normalize_avatar_source,
        normalize_client_ip, normalize_collaborator_role, normalize_locale_scope,
        parse_user_agent_device, verify_password, BlogSsoClaims, CollaborationAuditLogDto,
        CollaboratorInviteDto, CreateChapterInput, CreateTrackInput, InvitePreviewDto,
        SaveStudioStepInput, SiteSettingsDto, StepRevisionDto, StudioStepEditorDto, StudioTrackDto,
        UpdateUserProfileInput, UserPasskeyDto, UserProfileDto, UserRole, UserSessionDto,
        TRUSTED_DEVICE_TTL_DAYS,
    },
    build_highlighted_snippet,
    error::{DomainError, ErrorCode},
    normalize_note_motivation, normalize_note_visuals, sanitize_user_note,
    validate_user_note_content,
    webauthn::StoredPasskeyCredential,
    ArticleTaskChecksDto, ChapterNavDto, CreateMarginNoteInput, LearnerProgressDto,
    ListMarginNotesFilter, SearchHitDto, StepDetailDto, StepNavItemDto, StepNeighborDto,
    TrackSummaryDto, UpdateMarginNoteInput, UserMarginNoteDto,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PersistedUserState {
    #[serde(default)]
    progress: HashMap<String, HashSet<Uuid>>,
    #[serde(default)]
    task_checks: HashMap<String, HashMap<Uuid, HashSet<String>>>,
    #[serde(default)]
    notes: Vec<UserMarginNoteDto>,
    #[serde(default)]
    likes_delta: HashMap<Uuid, i64>,
    #[serde(default)]
    users: Vec<StoredUserRecord>,
    #[serde(default)]
    sessions: Vec<StoredSessionRecord>,
    #[serde(default)]
    password_resets: Vec<StoredPasswordResetRecord>,
    #[serde(default)]
    email_verifications: Vec<StoredEmailVerificationRecord>,
    #[serde(default)]
    trusted_devices: Vec<StoredTrustedDeviceRecord>,
    #[serde(default)]
    login_otp_challenges: Vec<StoredLoginOtpChallengeRecord>,
    #[serde(default)]
    step_meta: HashMap<Uuid, StoredStepMetaRecord>,
    #[serde(default)]
    collab_invites: Vec<StoredCollabInviteRecord>,
    #[serde(default)]
    step_revisions: Vec<StepRevisionDto>,
    #[serde(default)]
    collab_audit_logs: Vec<CollaborationAuditLogDto>,
    #[serde(default)]
    passkeys: Vec<StoredPasskeyCredential>,
    #[serde(default)]
    site_settings: Option<SiteSettingsDto>,
}

pub struct LocalSeedRepository {
    bundle: RwLock<ContentBundle>,
    state: RwLock<PersistedUserState>,
    store_path: PathBuf,
}

impl LocalSeedRepository {
    pub fn from_content_dir(content_dir: &Path, store_path: PathBuf) -> Result<Self> {
        Self::from_content_dir_with_options(content_dir, store_path, false)
    }

    pub fn from_content_dir_with_options(
        content_dir: &Path,
        store_path: PathBuf,
        seed_demo_users: bool,
    ) -> Result<Self> {
        let bundle = load_content_directory(content_dir)?;
        let mut state: PersistedUserState = if store_path.exists() {
            fs::read_to_string(&store_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            PersistedUserState::default()
        };

        if seed_demo_users && state.users.is_empty() {
            state.users = default_seeded_blog_users();
        }

        for rec in &mut state.users {
            if let (Some(prov), Some(sub)) = (rec.oauth_provider.clone(), rec.oauth_sub.clone()) {
                let p_clean = prov.trim().to_ascii_lowercase();
                let s_clean = sub.trim().to_string();
                if !p_clean.is_empty()
                    && !s_clean.is_empty()
                    && !rec
                        .oauth_bindings
                        .iter()
                        .any(|b| b.provider.eq_ignore_ascii_case(&p_clean))
                {
                    rec.oauth_bindings.push(StoredOAuthBinding {
                        provider: p_clean.clone(),
                        subject: s_clean,
                        oauth_avatar_url: rec.profile.oauth_avatar_url.clone(),
                        bound_at: rec.profile.last_login_at,
                    });
                }
            }
            if rec.oauth_provider.is_some() && rec.profile.oauth_provider.is_none() {
                rec.profile.oauth_provider = rec.oauth_provider.clone();
            }
            rec.profile.oauth_bindings = rec
                .oauth_bindings
                .iter()
                .map(|b| b.provider.clone())
                .collect();
            rec.profile.has_password = rec
                .password_hash
                .as_deref()
                .map(|h| !h.trim().is_empty())
                .unwrap_or(false);
        }

        Ok(Self {
            bundle: RwLock::new(bundle),
            state: RwLock::new(state),
            store_path,
        })
    }

    fn persist_state(&self, state: &PersistedUserState) {
        if let Some(parent) = self.store_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = fs::write(&self.store_path, json);
        }
    }

    fn gravatar_base(state: &PersistedUserState) -> &str {
        state
            .site_settings
            .as_ref()
            .map(|s| s.gravatar_base_url.as_str())
            .filter(|u| !u.is_empty())
            .unwrap_or("https://www.gravatar.com/avatar")
    }

    fn user_has_collaborations(user_id: Uuid, step_meta: &HashMap<Uuid, StoredStepMetaRecord>) -> bool {
        step_meta
            .values()
            .any(|m| m.owner_user_id == Some(user_id) || m.is_collaborator(user_id))
    }

    fn resolve_user_dto_in_state(rec: &StoredUserRecord, state: &PersistedUserState) -> UserProfileDto {
        let mut dto = Self::resolve_user_dto(rec, Self::gravatar_base(state));
        dto.has_collaborations = Self::user_has_collaborations(dto.id, &state.step_meta);
        dto
    }

    fn resolve_user_dto(rec: &StoredUserRecord, gravatar_base: &str) -> UserProfileDto {
        let mut p = rec.profile.clone();
        p.oauth_bindings = rec
            .oauth_bindings
            .iter()
            .map(|b| b.provider.clone())
            .collect();
        p.oauth_provider = p
            .oauth_bindings
            .first()
            .cloned()
            .or_else(|| rec.oauth_provider.clone());
        p.has_password = rec
            .password_hash
            .as_deref()
            .map(|h| !h.trim().is_empty())
            .unwrap_or(false);
        p.with_resolved_avatar(gravatar_base)
    }

    fn resolve_track_meta<'a>(track: &'a LoadedTrack, locale: &str) -> (&'a str, &'a str, &'a str) {
        if let Some(m) = track
            .manifest
            .translations
            .get(locale)
            .or_else(|| track.manifest.translations.get("zh-CN"))
            .or_else(|| track.manifest.translations.get("en"))
            .or_else(|| track.manifest.translations.values().next())
        {
            (&m.title, &m.subtitle, &m.description)
        } else {
            (&track.manifest.slug, "", "")
        }
    }

    fn is_step_taken_down(step_id: Uuid, step_meta: &HashMap<Uuid, StoredStepMetaRecord>) -> bool {
        step_meta
            .get(&step_id)
            .and_then(|m| m.takedown_reason.as_ref())
            .is_some()
    }
}

fn is_published(tr: &LoadedStepTranslation) -> bool {
    tr.compiled.frontmatter.status != "draft"
}

fn step_is_public(step: &LoadedStep, step_meta: &HashMap<Uuid, StoredStepMetaRecord>) -> bool {
    !LocalSeedRepository::is_step_taken_down(step.id, step_meta)
        && step.translations.values().any(is_published)
}

fn pick_published<'a>(step: &'a LoadedStep, locale: &str) -> Option<&'a LoadedStepTranslation> {
    step.translations
        .get(locale)
        .filter(|t| is_published(t))
        .or_else(|| step.translations.get(&step.default_locale).filter(|t| is_published(t)))
        .or_else(|| step.translations.values().find(|t| is_published(t)))
}

#[async_trait]
impl TutorialRepository for LocalSeedRepository {
    fn backend_kind(&self) -> &'static str {
        "local-content-seed"
    }

    async fn list_tracks(&self, locale: &str) -> Result<Vec<TrackSummaryDto>> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let mut out = Vec::new();

        for t in &bundle.tracks {
            let (title, subtitle, description) = Self::resolve_track_meta(t, locale);
            let step_count: usize = t
                .chapters
                .iter()
                .map(|c| {
                    c.steps
                        .iter()
                        .filter(|s| step_is_public(s, &state.step_meta))
                        .count()
                })
                .sum();
            let first_ch_with_step = t
                .chapters
                .iter()
                .find(|c| c.steps.iter().any(|s| step_is_public(s, &state.step_meta)))
                .or_else(|| t.chapters.first());
            let first_st = first_ch_with_step
                .and_then(|c| c.steps.iter().find(|s| step_is_public(s, &state.step_meta)));

            out.push(TrackSummaryDto {
                id: t.id,
                slug: t.manifest.slug.clone(),
                difficulty: t.manifest.difficulty.clone(),
                icon_kind: t.manifest.icon_kind.clone(),
                title: title.to_string(),
                subtitle: subtitle.to_string(),
                description: description.to_string(),
                tags: t.manifest.tags.clone(),
                chapter_count: t.chapters.len(),
                step_count,
                first_chapter_slug: first_ch_with_step
                    .map(|c| c.slug.clone())
                    .unwrap_or_default(),
                first_step_slug: first_st.map(|s| s.slug.clone()).unwrap_or_default(),
            });
        }
        Ok(out)
    }

    async fn get_step_detail(
        &self,
        locale: &str,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Option<StepDetailDto>> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let gravatar_base = Self::gravatar_base(&state);

        let Some(track) = bundle.tracks.iter().find(|t| t.manifest.slug == track_slug) else {
            return Ok(None);
        };
        let (track_title, _, _) = Self::resolve_track_meta(track, locale);

        let mut all_nav_steps: Vec<StepNavItemDto> = Vec::new();
        let mut flat_steps: Vec<(String, String, String, Uuid)> = Vec::new();

        for ch in &track.chapters {
            for s in ch.steps.iter().filter(|s| step_is_public(s, &state.step_meta)) {
                let tr_req = s.translations.get(locale).filter(|t| is_published(t));
                let tr_any = pick_published(s, locale);
                let s_title = tr_any
                    .map(|tr| tr.compiled.frontmatter.title.clone())
                    .unwrap_or_else(|| s.slug.clone());
                let has_req = tr_req.is_some();
                let canonical_rev = s.canonical_revision.max(1);
                let has_drift = tr_req.is_some_and(|t| {
                    t.compiled.frontmatter.synced_revision.max(1) < canonical_rev
                });

                flat_steps.push((ch.slug.clone(), s.slug.clone(), s_title.clone(), s.id));
                all_nav_steps.push(StepNavItemDto {
                    id: s.id,
                    slug: s.slug.clone(),
                    step_number: s.step_number,
                    title: s_title,
                    estimated_minutes: s.estimated_minutes,
                    has_requested_locale: has_req,
                    has_revision_drift: has_drift,
                });
            }
        }

        let primary_ch_slug = track
            .chapters
            .first()
            .map(|c| c.slug.clone())
            .unwrap_or_else(|| "chapters".to_string());
        let chapters_nav = vec![ChapterNavDto {
            slug: primary_ch_slug,
            number: 1,
            title: track_title.to_string(),
            steps: all_nav_steps,
        }];

        let found = if chapter_slug.is_empty() || chapter_slug == "-" {
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
                .or_else(|| {
                    track
                        .chapters
                        .iter()
                        .find_map(|c| c.steps.iter().find(|s| s.slug == step_slug).map(|s| (c, s)))
                })
        };
        let Some((ch, step)) = found else {
            return Ok(None);
        };
        let ch_title = ch
            .titles
            .get(locale)
            .or_else(|| ch.titles.get("zh-CN"))
            .or_else(|| ch.titles.get("en"))
            .cloned()
            .unwrap_or_else(|| ch.slug.clone());

        if Self::is_step_taken_down(step.id, &state.step_meta) {
            return Ok(None);
        }

        let Some(tr) = pick_published(step, locale) else {
            return Ok(None);
        };

        let current_idx = flat_steps.iter().position(|(_, _, _, id)| *id == step.id);
        let prev_step = current_idx
            .and_then(|i| i.checked_sub(1))
            .and_then(|pi| flat_steps.get(pi))
            .map(|(cs, ss, t, _)| StepNeighborDto {
                chapter_slug: cs.clone(),
                step_slug: ss.clone(),
                title: t.clone(),
            });
        let next_step = current_idx
            .and_then(|i| flat_steps.get(i + 1))
            .map(|(cs, ss, t, _)| StepNeighborDto {
                chapter_slug: cs.clone(),
                step_slug: ss.clone(),
                title: t.clone(),
            });

        let synced_rev = tr.compiled.frontmatter.synced_revision.max(1);
        let likes_delta = state.likes_delta.get(&step.id).copied().unwrap_or(0);
        let authors = resolve_local_step_authors(
            step.id,
            &tr.compiled.frontmatter.author,
            &state.step_meta,
            &state.users,
            gravatar_base,
        );
        let primary_author_name = authors
            .first()
            .map(|a| a.display_name.clone())
            .unwrap_or_default();

        let canonical_rev = step.canonical_revision.max(1);
        let is_fallback = tr.locale != locale;
        Ok(Some(StepDetailDto {
            step_id: step.id,
            track_slug: track.manifest.slug.clone(),
            track_title: track_title.to_string(),
            chapter_slug: ch.slug.clone(),
            chapter_title: ch_title,
            step_slug: step.slug.clone(),
            step_number: step.step_number,
            total_steps_in_track: flat_steps.len(),
            requested_locale: locale.to_string(),
            resolved_locale: tr.locale.clone(),
            is_fallback,
            available_locales: step
                .translations
                .values()
                .filter(|t| is_published(t))
                .map(|t| t.locale.clone())
                .collect(),
            canonical_revision: canonical_rev,
            synced_revision: synced_rev,
            version: synced_rev,
            has_revision_drift: !is_fallback && synced_rev < canonical_rev,
            estimated_minutes: tr.compiled.frontmatter.estimated_minutes,
            title: tr.compiled.frontmatter.title.clone(),
            summary: tr.compiled.frontmatter.summary.clone(),
            license: icehandnote_core::normalize_license_code(&tr.compiled.frontmatter.license),
            author_name: primary_author_name,
            authors,
            tags: tr.compiled.frontmatter.tags.clone(),
            blocks: tr.compiled.blocks.clone(),
            toc: tr.compiled.toc.clone(),
            chapters: chapters_nav,
            prev_step,
            next_step,
            likes_count: step.initial_likes + likes_delta,
            published_at: tr.published_at,
            updated_at: tr.updated_at,
        }))
    }

    async fn search(&self, locale: &str, query: &str) -> Result<Vec<SearchHitDto>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let lower_q = q.to_lowercase();
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let mut hits = Vec::new();

        for track in &bundle.tracks {
            let (track_title, _, _) = Self::resolve_track_meta(track, locale);
            for ch in &track.chapters {
                for step in &ch.steps {
                    if Self::is_step_taken_down(step.id, &state.step_meta) {
                        continue;
                    }
                    let Some(tr) = pick_published(step, locale) else {
                        continue;
                    };

                    let title_match = tr.compiled.frontmatter.title.to_lowercase().contains(&lower_q);
                    let body_match = tr.compiled.plain_text.to_lowercase().contains(&lower_q);
                    let tag_match = tr
                        .compiled
                        .frontmatter
                        .tags
                        .iter()
                        .any(|tg| tg.to_lowercase().contains(&lower_q));

                    if title_match || body_match || tag_match {
                        hits.push(SearchHitDto {
                            track_slug: track.manifest.slug.clone(),
                            track_title: track_title.to_string(),
                            chapter_slug: ch.slug.clone(),
                            step_slug: step.slug.clone(),
                            locale: tr.locale.clone(),
                            title: tr.compiled.frontmatter.title.clone(),
                            snippet_html: build_highlighted_snippet(&tr.compiled.plain_text, q),
                            tags: tr.compiled.frontmatter.tags.clone(),
                        });
                    }
                }
            }
        }
        hits.truncate(12);
        Ok(hits)
    }

    async fn get_progress(&self, learner_id: &str) -> Result<LearnerProgressDto> {
        let state = self.state.read().await;
        let completed_step_ids = state
            .progress
            .get(learner_id)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default();
        Ok(LearnerProgressDto {
            learner_id: learner_id.to_string(),
            completed_step_ids,
        })
    }

    async fn toggle_step_complete(
        &self,
        learner_id: &str,
        step_id: Uuid,
        completed: bool,
    ) -> Result<LearnerProgressDto> {
        let mut state = self.state.write().await;
        let entry = state.progress.entry(learner_id.to_string()).or_default();
        if completed {
            entry.insert(step_id);
        } else {
            entry.remove(&step_id);
        }
        let ids: Vec<Uuid> = entry.iter().copied().collect();
        self.persist_state(&state);
        Ok(LearnerProgressDto {
            learner_id: learner_id.to_string(),
            completed_step_ids: ids,
        })
    }

    async fn get_task_checks(
        &self,
        learner_id: &str,
        step_id: Uuid,
    ) -> Result<ArticleTaskChecksDto> {
        let state = self.state.read().await;
        let checked_item_ids = state
            .task_checks
            .get(learner_id)
            .and_then(|m| m.get(&step_id))
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        Ok(ArticleTaskChecksDto {
            learner_id: learner_id.to_string(),
            step_id,
            checked_item_ids,
        })
    }

    async fn toggle_task_check(
        &self,
        learner_id: &str,
        step_id: Uuid,
        task_item_id: &str,
        checked: bool,
    ) -> Result<ArticleTaskChecksDto> {
        let clean_item: String = task_item_id.trim().chars().take(80).collect();
        let mut state = self.state.write().await;
        let step_set = state
            .task_checks
            .entry(learner_id.to_string())
            .or_default()
            .entry(step_id)
            .or_default();
        if !clean_item.is_empty() {
            if checked {
                step_set.insert(clean_item);
            } else {
                step_set.remove(&clean_item);
            }
        }
        let ids: Vec<String> = step_set.iter().cloned().collect();
        self.persist_state(&state);
        Ok(ArticleTaskChecksDto {
            learner_id: learner_id.to_string(),
            step_id,
            checked_item_ids: ids,
        })
    }

    async fn like_step(&self, step_id: Uuid) -> Result<i64> {
        let bundle = self.bundle.read().await;
        let base_likes = bundle
            .tracks
            .iter()
            .flat_map(|t| &t.chapters)
            .flat_map(|c| &c.steps)
            .find(|s| s.id == step_id)
            .map(|s| s.initial_likes)
            .unwrap_or(0);
        drop(bundle);

        let mut state = self.state.write().await;
        let delta = state.likes_delta.entry(step_id).or_insert(0);
        *delta += 1;
        let total = base_likes + *delta;
        self.persist_state(&state);
        Ok(total)
    }

    async fn list_margin_notes(
        &self,
        step_id: Uuid,
        learner_id: &str,
    ) -> Result<Vec<UserMarginNoteDto>> {
        let (items, _) = self
            .list_margin_notes_filtered(
                learner_id,
                &ListMarginNotesFilter {
                    step_id: Some(step_id),
                    limit: 500,
                    ..Default::default()
                },
            )
            .await?;
        Ok(items)
    }

    async fn list_margin_notes_filtered(
        &self,
        learner_id: &str,
        filter: &ListMarginNotesFilter,
    ) -> Result<(Vec<UserMarginNoteDto>, usize)> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;

        let locale_opt = filter
            .locale_code
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let tag_opt = filter
            .tag
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "all");
        let q_lower = filter
            .q
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase());

        // Build lookup map of step metadata for cross-article "My Notes" & export enrichment
        let mut step_meta: HashMap<Uuid, (String, String, String, HashMap<String, String>, String)> =
            HashMap::new();
        for t in &bundle.tracks {
            for c in &t.chapters {
                for s in &c.steps {
                    let titles: HashMap<String, String> = s
                        .translations
                        .iter()
                        .map(|(loc, tr)| (loc.clone(), tr.compiled.frontmatter.title.clone()))
                        .collect();
                    step_meta.insert(
                        s.id,
                        (
                            t.manifest.slug.clone(),
                            c.slug.clone(),
                            s.slug.clone(),
                            titles,
                            s.default_locale.clone(),
                        ),
                    );
                }
            }
        }

        let mut matched: Vec<UserMarginNoteDto> = state
            .notes
            .iter()
            .filter(|n| n.learner_id == learner_id && n.deleted_at.is_none())
            .filter(|n| filter.step_id.map_or(true, |sid| n.step_id == sid))
            .filter(|n| locale_opt.map_or(true, |loc| n.locale_code == loc))
            .map(|n| {
                let mut cloned = n.clone();
                cloned.hydrate_legacy_fields();
                if let Some((t_slug, c_slug, s_slug, titles, def_loc)) = step_meta.get(&cloned.step_id)
                {
                    cloned.track_slug = Some(t_slug.clone());
                    cloned.chapter_slug = Some(c_slug.clone());
                    cloned.step_slug = Some(s_slug.clone());
                    cloned.step_title = titles
                        .get(&cloned.locale_code)
                        .or_else(|| titles.get(def_loc))
                        .or_else(|| titles.values().next())
                        .cloned()
                        .or_else(|| Some(s_slug.clone()));
                }
                cloned
            })
            .filter(|n| tag_opt.map_or(true, |tg| n.tag == tg))
            .filter(|n| {
                q_lower.as_ref().map_or(true, |q| {
                    n.raw_content.to_lowercase().contains(q)
                        || n.step_title
                            .as_deref()
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(q)
                })
            })
            .collect();

        if filter.step_id.is_some() {
            matched.sort_by_key(|n| n.created_at);
        } else {
            matched.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| b.created_at.cmp(&a.created_at)));
        }

        let total = matched.len();
        let limit = filter.limit.clamp(1, 500);
        let page: Vec<UserMarginNoteDto> = matched
            .into_iter()
            .skip(filter.offset)
            .take(limit)
            .collect();
        Ok((page, total))
    }

    async fn create_margin_note(&self, input: CreateMarginNoteInput) -> Result<UserMarginNoteDto> {
        let clean_content = validate_user_note_content(&input.content)?;
        let quota = note_quota_for_owner(&input.learner_id);
        let mut state = self.state.write().await;
        let existing_count = state
            .notes
            .iter()
            .filter(|n| {
                n.learner_id == input.learner_id
                    && n.step_id == input.step_id
                    && n.deleted_at.is_none()
            })
            .count();
        if existing_count >= quota {
            return Err(DomainError::new(
                ErrorCode::NoteQuotaExceeded,
                format!("Reached the maximum of {quota} notes for this article."),
            )
            .with_meta(serde_json::json!({ "quota": quota }))
            .into());
        }

        let (tone, style, tag) = normalize_note_visuals(
            input.tone.as_deref(),
            input.style.as_deref(),
            input.tag.as_deref(),
            Some(&input.note_color),
        );
        let note_color = format!("{tone}:{style}:{tag}");
        let motivation = normalize_note_motivation(input.motivation.as_deref(), &tag);
        let content_html = sanitize_user_note(&clean_content);
        let now = Utc::now();

        let dto = UserMarginNoteDto {
            id: Uuid::new_v4(),
            learner_id: input.learner_id,
            step_id: input.step_id,
            locale_code: input.locale_code,
            block_anchor_id: input.block_anchor_id,
            note_color,
            tone,
            style,
            tag,
            motivation,
            target: input.target,
            body_format: "text/markdown".to_string(),
            content_html,
            raw_content: clean_content,
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: None,
            track_slug: None,
            chapter_slug: None,
            step_slug: None,
            step_title: None,
        };
        state.notes.push(dto.clone());
        self.persist_state(&state);
        Ok(dto)
    }

    async fn update_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        input: UpdateMarginNoteInput,
        expected_etag: Option<&str>,
    ) -> Result<UserMarginNoteDto> {
        let mut state = self.state.write().await;
        let Some(note) = state
            .notes
            .iter_mut()
            .find(|n| n.id == note_id && n.learner_id == learner_id && n.deleted_at.is_none())
        else {
            return Err(domain_err(ErrorCode::NoteNotFound, "Note not found."));
        };

        note.hydrate_legacy_fields();
        if let Some(if_match) = expected_etag {
            if !if_match_satisfies(if_match, &note.etag()) {
                return Err(precondition_failed_err(if_match, note));
            }
        }

        if let Some(ref c) = input.content {
            let validated = validate_user_note_content(c)?;
            note.content_html = sanitize_user_note(&validated);
            note.raw_content = validated;
        }

        let (next_tone, next_style, next_tag) = normalize_note_visuals(
            input.tone.as_deref().or(Some(&note.tone)),
            input.style.as_deref().or(Some(&note.style)),
            input.tag.as_deref().or(Some(&note.tag)),
            input.note_color.as_deref(),
        );
        note.tone = next_tone;
        note.style = next_style;
        note.tag = next_tag;
        note.note_color = format!("{}:{}:{}", note.tone, note.style, note.tag);
        note.motivation =
            normalize_note_motivation(input.motivation.as_deref().or(Some(&note.motivation)), &note.tag);
        if let Some(ref anchor) = input.block_anchor_id {
            let trimmed = anchor.trim();
            if !trimmed.is_empty() {
                note.block_anchor_id = trimmed.to_string();
            }
        }
        if let Some(target) = input.target {
            note.target = Some(target);
        }
        note.version = note.version.max(1) + 1;
        note.updated_at = Utc::now();
        let updated = note.clone();
        self.persist_state(&state);
        Ok(updated)
    }

    async fn delete_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
        expected_etag: Option<&str>,
    ) -> Result<Option<DateTime<Utc>>> {
        let mut state = self.state.write().await;
        let now = Utc::now();
        let cutoff = now - Duration::minutes(NOTE_UNDO_GRACE_MINUTES);
        state
            .notes
            .retain(|n| n.deleted_at.map_or(true, |dt| dt >= cutoff));

        let Some(note) = state
            .notes
            .iter_mut()
            .find(|n| n.id == note_id && n.learner_id == learner_id && n.deleted_at.is_none())
        else {
            return Ok(None);
        };
        note.hydrate_legacy_fields();
        if let Some(if_match) = expected_etag {
            if !if_match_satisfies(if_match, &note.etag()) {
                return Err(precondition_failed_err(if_match, note));
            }
        }
        note.deleted_at = Some(now);
        note.updated_at = now;
        self.persist_state(&state);
        Ok(Some(now + Duration::minutes(NOTE_UNDO_GRACE_MINUTES)))
    }

    async fn restore_margin_note(
        &self,
        note_id: Uuid,
        learner_id: &str,
    ) -> Result<UserMarginNoteDto> {
        let mut state = self.state.write().await;
        let now = Utc::now();
        let cutoff = now - Duration::minutes(NOTE_UNDO_GRACE_MINUTES);
        let Some(note) = state.notes.iter_mut().find(|n| {
            n.id == note_id
                && n.learner_id == learner_id
                && n.deleted_at.map_or(false, |dt| dt >= cutoff)
        }) else {
            return Err(domain_err(
                ErrorCode::NoteNotFound,
                "Deleted note could not be restored or the undo window has expired.",
            ));
        };
        note.deleted_at = None;
        note.version = note.version.max(1) + 1;
        note.updated_at = now;
        note.hydrate_legacy_fields();
        let restored = note.clone();
        self.persist_state(&state);
        Ok(restored)
    }

    async fn sync_bundle(&self, bundle: &ContentBundle) -> Result<usize> {
        let count: usize = bundle
            .tracks
            .iter()
            .flat_map(|t| &t.chapters)
            .flat_map(|c| &c.steps)
            .map(|s| s.translations.len())
            .sum();
        let mut guard = self.bundle.write().await;
        *guard = bundle.clone();
        Ok(count)
    }

    async fn upsert_blog_user(&self, claims: &BlogSsoClaims) -> Result<UserProfileDto> {
        let mut state = self.state.write().await;
        let profile = upsert_local_blog_user(&mut state.users, claims);
        if profile.is_banned {
            let err = DomainError::new(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            );
            let err = if profile.ban_reason.trim().is_empty() {
                err
            } else {
                err.with_meta(serde_json::json!({ "reason": profile.ban_reason.trim() }))
            };
            return Err(err.into());
        }
        let grav = Self::gravatar_base(&state).to_string();
        self.persist_state(&state);
        Ok(profile.with_resolved_avatar(&grav))
    }

    async fn find_oauth_user(
        &self,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> Result<Option<UserProfileDto>> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let clean_sub = subject.trim();
        if clean_provider.is_empty() || clean_sub.is_empty() {
            return Ok(None);
        }
        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        if let Some(existing) = state.users.iter_mut().find(|u| {
            u.oauth_bindings.iter().any(|b| {
                b.provider.eq_ignore_ascii_case(&clean_provider) && b.subject == clean_sub
            }) || (u.oauth_provider.as_deref().map(|p| p.eq_ignore_ascii_case(&clean_provider))
                == Some(true)
                && u.oauth_sub.as_deref() == Some(clean_sub))
        }) {
            if !oauth_avatar_url.trim().is_empty() {
                existing.profile.oauth_avatar_url = oauth_avatar_url.trim().to_string();
                if let Some(b) = existing
                    .oauth_bindings
                    .iter_mut()
                    .find(|b| b.provider.eq_ignore_ascii_case(&clean_provider))
                {
                    b.oauth_avatar_url = oauth_avatar_url.trim().to_string();
                }
            }
            existing.profile.last_login_at = Utc::now();
            let dto = Self::resolve_user_dto(existing, &grav);
            self.persist_state(&state);
            return Ok(Some(dto));
        }
        Ok(None)
    }

    async fn complete_oauth_registration(
        &self,
        provider: &str,
        subject: &str,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        avatar_source: &str,
        oauth_avatar_url: &str,
        uploaded_avatar_url: &str,
    ) -> Result<UserProfileDto> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let clean_sub = subject.trim();
        let clean_username = username.trim();
        let clean_email = email.trim();

        let mut state = self.state.write().await;
        if state.users.iter().any(|u| {
            u.oauth_bindings.iter().any(|b| {
                b.provider.eq_ignore_ascii_case(&clean_provider) && b.subject == clean_sub
            }) || (u.oauth_provider.as_deref().map(|p| p.eq_ignore_ascii_case(&clean_provider))
                == Some(true)
                && u.oauth_sub.as_deref() == Some(clean_sub))
        }) {
            return Err(domain_err(
                ErrorCode::OAuthAlreadyBound,
                "This OAuth identity is already linked to an account.",
            ));
        }
        if state
            .users
            .iter()
            .any(|u| u.profile.username.eq_ignore_ascii_case(clean_username))
        {
            return Err(domain_err(
                ErrorCode::UsernameTaken,
                "Username is already taken.",
            ));
        }
        if state
            .users
            .iter()
            .any(|u| u.profile.email.eq_ignore_ascii_case(clean_email))
        {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "Email address is already registered.",
            ));
        }

        let safe_role = if role == UserRole::Author {
            UserRole::Author
        } else {
            UserRole::Reader
        };
        let norm_source = normalize_avatar_source(avatar_source);
        let grav = Self::gravatar_base(&state).to_string();
        let clean_display = if display_name.trim().is_empty() {
            clean_username.to_string()
        } else {
            display_name.trim().to_string()
        };
        let now = Utc::now();

        let prof = UserProfileDto {
            id: Uuid::new_v4(),
            wp_user_id: None,
            username: clean_username.to_string(),
            display_name: clean_display,
            email: clean_email.to_string(),
            avatar_url: String::new(),
            avatar_source: norm_source,
            oauth_avatar_url: oauth_avatar_url.trim().to_string(),
            uploaded_avatar_url: uploaded_avatar_url.trim().to_string(),
            oauth_provider: Some(clean_provider.clone()),
            oauth_bindings: vec![clean_provider.clone()],
            has_password: false,
            bio: String::new(),
            role: safe_role,
            has_collaborations: false,
            auth_source: clean_provider.clone(),
            is_banned: false,
            ban_reason: String::new(),
            last_login_at: now,
        }
        .with_resolved_avatar(&grav);

        state.users.push(StoredUserRecord {
            profile: prof.clone(),
            password_hash: None,
            oauth_provider: Some(clean_provider.clone()),
            oauth_sub: Some(clean_sub.to_string()),
            oauth_bindings: vec![StoredOAuthBinding {
                provider: clean_provider,
                subject: clean_sub.to_string(),
                oauth_avatar_url: oauth_avatar_url.trim().to_string(),
                bound_at: now,
            }],
        });
        self.persist_state(&state);
        Ok(prof)
    }

    async fn bind_oauth_to_user(
        &self,
        user_id: Uuid,
        provider: &str,
        subject: &str,
        oauth_avatar_url: &str,
    ) -> Result<UserProfileDto> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let clean_sub = subject.trim();
        let mut state = self.state.write().await;

        if state.users.iter().any(|u| {
            u.profile.id != user_id
                && (u.oauth_bindings.iter().any(|b| {
                    b.provider.eq_ignore_ascii_case(&clean_provider) && b.subject == clean_sub
                }) || (u
                    .oauth_provider
                    .as_deref()
                    .map(|p| p.eq_ignore_ascii_case(&clean_provider))
                    == Some(true)
                    && u.oauth_sub.as_deref() == Some(clean_sub)))
        }) {
            return Err(domain_err(
                ErrorCode::OAuthAlreadyBound,
                "This OAuth identity is already linked to another user.",
            ));
        }

        let grav = Self::gravatar_base(&state).to_string();
        let Some(rec) = state.users.iter_mut().find(|u| u.profile.id == user_id) else {
            return Err(domain_err(ErrorCode::UserNotFound, "Target user not found."));
        };

        if let Some(existing_b) = rec
            .oauth_bindings
            .iter_mut()
            .find(|b| b.provider.eq_ignore_ascii_case(&clean_provider))
        {
            existing_b.subject = clean_sub.to_string();
            if !oauth_avatar_url.trim().is_empty() {
                existing_b.oauth_avatar_url = oauth_avatar_url.trim().to_string();
            }
        } else {
            rec.oauth_bindings.push(StoredOAuthBinding {
                provider: clean_provider.clone(),
                subject: clean_sub.to_string(),
                oauth_avatar_url: oauth_avatar_url.trim().to_string(),
                bound_at: Utc::now(),
            });
        }

        if rec.oauth_provider.is_none() {
            rec.oauth_provider = Some(clean_provider.clone());
            rec.oauth_sub = Some(clean_sub.to_string());
        }
        if !oauth_avatar_url.trim().is_empty() {
            rec.profile.oauth_avatar_url = oauth_avatar_url.trim().to_string();
            if rec.profile.avatar_source == "default" && rec.profile.avatar_url.is_empty() {
                rec.profile.avatar_source = "oauth".to_string();
            }
        }
        let dto = Self::resolve_user_dto(rec, &grav);
        self.persist_state(&state);
        Ok(dto)
    }

    async fn unbind_oauth_from_user(
        &self,
        user_id: Uuid,
        provider: &str,
    ) -> Result<UserProfileDto> {
        let clean_provider = provider.trim().to_ascii_lowercase();
        let mut state = self.state.write().await;
        let passkey_count = state.passkeys.iter().filter(|pk| pk.user_id == user_id).count();
        let grav = Self::gravatar_base(&state).to_string();
        let Some(rec) = state.users.iter_mut().find(|u| u.profile.id == user_id) else {
            return Err(domain_err(ErrorCode::UserNotFound, "User not found."));
        };
        let has_pw = rec
            .password_hash
            .as_deref()
            .map(|h| !h.trim().is_empty())
            .unwrap_or(false);
        let remaining_oauth = rec
            .oauth_bindings
            .iter()
            .filter(|b| !b.provider.eq_ignore_ascii_case(&clean_provider))
            .count();
        if !has_pw && passkey_count == 0 && remaining_oauth == 0 {
            return Err(domain_err(
                ErrorCode::CannotUnbindLastAuth,
                "Cannot unlink your only sign-in method. Set a password or register a passkey first.",
            ));
        }

        rec.oauth_bindings
            .retain(|b| !b.provider.eq_ignore_ascii_case(&clean_provider));
        if let Some(first) = rec.oauth_bindings.first() {
            rec.oauth_provider = Some(first.provider.clone());
            rec.oauth_sub = Some(first.subject.clone());
        } else {
            rec.oauth_provider = None;
            rec.oauth_sub = None;
        }
        let dto = Self::resolve_user_dto(rec, &grav);
        self.persist_state(&state);
        Ok(dto)
    }

    async fn list_user_passkeys(&self, user_id: Uuid) -> Result<Vec<UserPasskeyDto>> {
        let state = self.state.read().await;
        let mut items: Vec<UserPasskeyDto> = state
            .passkeys
            .iter()
            .filter(|pk| pk.user_id == user_id)
            .map(StoredPasskeyCredential::to_dto)
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    }

    async fn save_user_passkey(&self, cred: StoredPasskeyCredential) -> Result<UserPasskeyDto> {
        let mut state = self.state.write().await;
        if state
            .passkeys
            .iter()
            .any(|pk| pk.credential_id == cred.credential_id)
        {
            return Err(domain_err(
                ErrorCode::Conflict,
                "This passkey credential is already registered.",
            ));
        }
        let dto = cred.to_dto();
        state.passkeys.push(cred);
        self.persist_state(&state);
        Ok(dto)
    }

    async fn find_passkey_by_credential_id(
        &self,
        credential_id: &str,
    ) -> Result<Option<(StoredPasskeyCredential, UserProfileDto)>> {
        let clean_id = credential_id.trim();
        let state = self.state.read().await;
        let Some(pk) = state
            .passkeys
            .iter()
            .find(|pk| pk.credential_id == clean_id)
            .cloned()
        else {
            return Ok(None);
        };
        let grav = Self::gravatar_base(&state);
        let Some(user_rec) = state.users.iter().find(|u| u.profile.id == pk.user_id) else {
            return Ok(None);
        };
        let dto = Self::resolve_user_dto(user_rec, grav);
        Ok(Some((pk, dto)))
    }

    async fn touch_passkey_usage(&self, credential_id: &str, new_counter: u32) -> Result<()> {
        let clean_id = credential_id.trim();
        let mut state = self.state.write().await;
        if let Some(pk) = state
            .passkeys
            .iter_mut()
            .find(|pk| pk.credential_id == clean_id)
        {
            pk.counter = new_counter;
            pk.last_used_at = Some(Utc::now());
            self.persist_state(&state);
        }
        Ok(())
    }

    async fn rename_user_passkey(
        &self,
        user_id: Uuid,
        credential_id: &str,
        new_name: &str,
    ) -> Result<Option<UserPasskeyDto>> {
        let clean_id = credential_id.trim();
        let clean_name: String = new_name.trim().chars().take(80).collect();
        if clean_name.is_empty() {
            return Err(domain_err(
                ErrorCode::BadRequest,
                "Passkey name cannot be empty.",
            ));
        }
        let mut state = self.state.write().await;
        let Some(pk) = state
            .passkeys
            .iter_mut()
            .find(|pk| pk.user_id == user_id && pk.credential_id == clean_id)
        else {
            return Ok(None);
        };
        pk.name = clean_name;
        let dto = pk.to_dto();
        self.persist_state(&state);
        Ok(Some(dto))
    }

    async fn delete_user_passkey(&self, user_id: Uuid, credential_id: &str) -> Result<bool> {
        let clean_id = credential_id.trim();
        let mut state = self.state.write().await;
        let exists = state
            .passkeys
            .iter()
            .any(|pk| pk.user_id == user_id && pk.credential_id == clean_id);
        if !exists {
            return Ok(false);
        }
        let remaining_passkeys = state
            .passkeys
            .iter()
            .filter(|pk| pk.user_id == user_id && pk.credential_id != clean_id)
            .count();
        if let Some(rec) = state.users.iter().find(|u| u.profile.id == user_id) {
            let has_pw = rec
                .password_hash
                .as_deref()
                .map(|h| !h.trim().is_empty())
                .unwrap_or(false);
            if !has_pw && rec.oauth_bindings.is_empty() && remaining_passkeys == 0 {
                return Err(domain_err(
                    ErrorCode::CannotUnbindLastAuth,
                    "Cannot remove your only sign-in method. Set a password or link an OAuth account first.",
                ));
            }
        }
        let before = state.passkeys.len();
        state
            .passkeys
            .retain(|pk| !(pk.user_id == user_id && pk.credential_id == clean_id));
        let removed = state.passkeys.len() < before;
        if removed {
            self.persist_state(&state);
        }
        Ok(removed)
    }

    async fn register_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        password: &str,
        role: UserRole,
    ) -> Result<UserProfileDto> {
        let clean_username = username.trim();
        let clean_email = email.trim();

        let mut state = self.state.write().await;
        if state
            .users
            .iter()
            .any(|u| u.profile.username.eq_ignore_ascii_case(clean_username))
        {
            return Err(domain_err(
                ErrorCode::UsernameTaken,
                "Username is already taken.",
            ));
        }
        if state
            .users
            .iter()
            .any(|u| u.profile.email.eq_ignore_ascii_case(clean_email))
        {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "Email address is already registered.",
            ));
        }

        let safe_role = if role == UserRole::Author {
            UserRole::Author
        } else {
            UserRole::Reader
        };
        let clean_display = if display_name.trim().is_empty() {
            clean_username.to_string()
        } else {
            display_name.trim().to_string()
        };
        let pw_hash = hash_password(clean_username, password);
        let grav = Self::gravatar_base(&state).to_string();
        let prof = UserProfileDto {
            id: Uuid::new_v4(),
            wp_user_id: None,
            username: clean_username.to_string(),
            display_name: clean_display,
            email: clean_email.to_string(),
            avatar_url: String::new(),
            avatar_source: "default".to_string(),
            oauth_avatar_url: String::new(),
            uploaded_avatar_url: String::new(),
            oauth_provider: None,
            oauth_bindings: Vec::new(),
            has_password: true,
            bio: String::new(),
            role: safe_role,
            has_collaborations: false,
            auth_source: "local".to_string(),
            is_banned: false,
            ban_reason: String::new(),
            last_login_at: Utc::now(),
        }
        .with_resolved_avatar(&grav);

        state.users.push(StoredUserRecord {
            profile: prof.clone(),
            password_hash: Some(pw_hash),
            oauth_provider: None,
            oauth_sub: None,
            oauth_bindings: Vec::new(),
        });
        self.persist_state(&state);
        Ok(prof)
    }

    async fn is_username_taken(&self, username: &str) -> Result<bool> {
        let clean = username.trim();
        if clean.is_empty() {
            return Ok(false);
        }
        let state = self.state.read().await;
        Ok(state
            .users
            .iter()
            .any(|u| u.profile.username.eq_ignore_ascii_case(clean)))
    }

    async fn authenticate_password(
        &self,
        identifier: &str,
        password: &str,
    ) -> Result<Option<UserProfileDto>> {
        let mut state = self.state.write().await;
        let Some(matched) = match_local_user_password(&state.users, identifier, password) else {
            return Ok(None);
        };
        if matched.is_banned {
            let err = DomainError::new(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            );
            let err = if matched.ban_reason.trim().is_empty() {
                err
            } else {
                err.with_meta(serde_json::json!({ "reason": matched.ban_reason.trim() }))
            };
            return Err(err.into());
        }
        let now = Utc::now();
        let grav = Self::gravatar_base(&state).to_string();
        let mut resolved = matched;
        if let Some(rec) = state.users.iter_mut().find(|u| u.profile.id == resolved.id) {
            rec.profile.last_login_at = now;
            resolved = Self::resolve_user_dto(rec, &grav);
        }
        resolved.has_collaborations = Self::user_has_collaborations(resolved.id, &state.step_meta);
        self.persist_state(&state);
        Ok(Some(resolved))
    }

    async fn update_user_profile(
        &self,
        user_id: Uuid,
        input: UpdateUserProfileInput,
    ) -> Result<UserProfileDto> {
        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        let Some(rec) = state.users.iter_mut().find(|u| u.profile.id == user_id) else {
            return Err(domain_err(ErrorCode::UserNotFound, "User not found."));
        };
        let clean_display: String = input.display_name.trim().chars().take(64).collect();
        if !clean_display.is_empty() {
            rec.profile.display_name = clean_display;
        }
        rec.profile.bio = input.bio.trim().chars().take(300).collect();
        rec.profile.avatar_source = normalize_avatar_source(&input.avatar_source);
        if !input.uploaded_avatar_url.trim().is_empty() {
            rec.profile.uploaded_avatar_url =
                input.uploaded_avatar_url.trim().chars().take(512).collect();
        }
        rec.profile = Self::resolve_user_dto(rec, &grav);
        let out = rec.profile.clone();
        self.persist_state(&state);
        Ok(out)
    }

    async fn is_email_taken_by_other(&self, email: &str, exclude_user_id: Uuid) -> Result<bool> {
        let clean = email.trim();
        if clean.is_empty() {
            return Ok(false);
        }
        let state = self.state.read().await;
        Ok(state.users.iter().any(|u| {
            u.profile.id != exclude_user_id && u.profile.email.eq_ignore_ascii_case(clean)
        }))
    }

    async fn update_user_email(
        &self,
        user_id: Uuid,
        new_email: &str,
    ) -> Result<UserProfileDto> {
        let clean = new_email.trim();
        let mut state = self.state.write().await;
        if state
            .users
            .iter()
            .any(|u| u.profile.id != user_id && u.profile.email.eq_ignore_ascii_case(clean))
        {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "This email address is already registered to another account.",
            ));
        }
        let grav = Self::gravatar_base(&state).to_string();
        let Some(rec) = state.users.iter_mut().find(|u| u.profile.id == user_id) else {
            return Err(domain_err(ErrorCode::UserNotFound, "User not found."));
        };
        rec.profile.email = clean.to_string();
        rec.profile = Self::resolve_user_dto(rec, &grav);
        let out = rec.profile.clone();
        self.persist_state(&state);
        Ok(out)
    }

    async fn create_password_reset_token(
        &self,
        email: &str,
    ) -> Result<Option<(UserProfileDto, String, String)>> {
        let clean_email = email.trim();
        if clean_email.is_empty() {
            return Ok(None);
        }
        let mut state = self.state.write().await;
        let now = Utc::now();
        state.password_resets.retain(|r| r.expires_at > now);
        let grav = Self::gravatar_base(&state).to_string();
        let Some(user_rec) = state
            .users
            .iter()
            .find(|u| u.profile.email.eq_ignore_ascii_case(clean_email) && !u.profile.is_banned)
        else {
            return Ok(None);
        };
        let user_dto = Self::resolve_user_dto(user_rec, &grav);
        let (raw_token, token_hash) = generate_action_token("ihn_rst", "pw_reset_v1");
        let (raw_otp, code_hash) = generate_email_verification_code(&user_dto.email);
        state.password_resets.push(StoredPasswordResetRecord {
            token_hash,
            code_hash,
            attempts: 0,
            user_id: user_dto.id,
            expires_at: now + Duration::minutes(30),
            created_at: now,
        });
        self.persist_state(&state);
        Ok(Some((user_dto, raw_token, raw_otp)))
    }

    async fn verify_password_reset_otp(&self, email: &str, otp_code: &str) -> Result<String> {
        let clean_email = email.trim();
        let clean_code = otp_code.trim();
        let mut state = self.state.write().await;
        let now = Utc::now();
        state.password_resets.retain(|r| r.expires_at > now);

        let Some((user_id, user_email)) = state
            .users
            .iter()
            .find(|u| u.profile.email.eq_ignore_ascii_case(clean_email) && !u.profile.is_banned)
            .map(|u| (u.profile.id, u.profile.email.clone()))
        else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };

        let Some(rec) = state
            .password_resets
            .iter_mut()
            .filter(|r| r.user_id == user_id && !r.code_hash.is_empty())
            .max_by_key(|r| r.created_at)
        else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };

        if rec.attempts >= 5 {
            state.password_resets.retain(|r| r.user_id != user_id);
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please request a new reset code.",
            ));
        }

        let candidate = hash_email_verification_code(&user_email, clean_code);
        if !constant_time_str_eq(&rec.code_hash, &candidate) {
            rec.attempts += 1;
            if rec.attempts >= 5 {
                state.password_resets.retain(|r| r.user_id != user_id);
            }
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid.",
            ));
        }

        // OTP verified! Consume code_hash (single-use OTP) and rotate to a fresh verified reset token
        let (raw_verified_token, verified_hash) = generate_action_token("ihn_rstv", "pw_reset_v1");
        rec.code_hash.clear();
        rec.token_hash = verified_hash;
        rec.expires_at = rec.expires_at.max(now + Duration::minutes(15));
        self.persist_state(&state);
        Ok(raw_verified_token)
    }

    async fn consume_password_reset_token(
        &self,
        raw_token: &str,
        new_password: &str,
    ) -> Result<UserProfileDto> {
        let token_hash = hash_action_token("pw_reset_v1", raw_token);
        let mut state = self.state.write().await;
        let now = Utc::now();
        state.password_resets.retain(|r| r.expires_at > now);

        let Some(pos) = state
            .password_resets
            .iter()
            .position(|r| r.token_hash == token_hash)
        else {
            return Err(domain_err(
                ErrorCode::ResetTokenInvalid,
                "Password reset link is invalid or has expired.",
            ));
        };
        let reset_rec = state.password_resets.remove(pos);
        state.password_resets.retain(|r| r.user_id != reset_rec.user_id);

        let grav = Self::gravatar_base(&state).to_string();
        let Some(user_rec) = state
            .users
            .iter_mut()
            .find(|u| u.profile.id == reset_rec.user_id)
        else {
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        if user_rec.profile.is_banned {
            return Err(domain_err(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            ));
        }
        user_rec.password_hash = Some(hash_password(&user_rec.profile.username, new_password));
        let uid = user_rec.profile.id;
        let dto = Self::resolve_user_dto(user_rec, &grav);
        state.sessions.retain(|s| s.user_id != uid);
        state.trusted_devices.retain(|d| d.user_id != uid);
        self.persist_state(&state);
        Ok(dto)
    }

    async fn consume_password_reset_otp(
        &self,
        email: &str,
        otp_code: &str,
        new_password: &str,
    ) -> Result<UserProfileDto> {
        let clean_email = email.trim();
        let clean_code = otp_code.trim();
        let mut state = self.state.write().await;
        let now = Utc::now();
        state.password_resets.retain(|r| r.expires_at > now);

        let Some(user_id) = state
            .users
            .iter()
            .find(|u| u.profile.email.eq_ignore_ascii_case(clean_email) && !u.profile.is_banned)
            .map(|u| u.profile.id)
        else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };

        let Some(rec) = state
            .password_resets
            .iter_mut()
            .filter(|r| r.user_id == user_id && !r.code_hash.is_empty())
            .max_by_key(|r| r.created_at)
        else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid or has expired.",
            ));
        };

        if rec.attempts >= 5 {
            state.password_resets.retain(|r| r.user_id != user_id);
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please request a new reset code.",
            ));
        }

        let candidate = hash_email_verification_code(clean_email, clean_code);
        if !constant_time_str_eq(&rec.code_hash, &candidate) {
            rec.attempts += 1;
            if rec.attempts >= 5 {
                state.password_resets.retain(|r| r.user_id != user_id);
            }
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Password reset verification code is invalid.",
            ));
        }

        state.password_resets.retain(|r| r.user_id != user_id);
        let grav = Self::gravatar_base(&state).to_string();
        let Some(user_rec) = state.users.iter_mut().find(|u| u.profile.id == user_id) else {
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        user_rec.password_hash = Some(hash_password(&user_rec.profile.username, new_password));
        let dto = Self::resolve_user_dto(user_rec, &grav);
        state.sessions.retain(|s| s.user_id != user_id);
        state.trusted_devices.retain(|d| d.user_id != user_id);
        self.persist_state(&state);
        Ok(dto)
    }

    async fn create_registration_verification_code(&self, email: &str) -> Result<(Uuid, String)> {
        let clean_email = email.trim().to_ascii_lowercase();
        let mut state = self.state.write().await;
        let now = Utc::now();
        // Clean up expired records older than 24h while keeping recently expired records for accurate expiry feedback
        state
            .email_verifications
            .retain(|r| r.expires_at + Duration::hours(24) > now && r.used_at.is_none());

        if state
            .users
            .iter()
            .any(|u| u.profile.email.eq_ignore_ascii_case(&clean_email))
        {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "This email address is already registered.",
            ));
        }

        if let Some(latest) = state
            .email_verifications
            .iter()
            .filter(|r| r.email.eq_ignore_ascii_case(&clean_email) && r.used_at.is_none())
            .max_by_key(|r| r.created_at)
        {
            let elapsed = (now - latest.created_at).num_seconds();
            if elapsed < 60 {
                let retry_after = (60 - elapsed).max(1);
                return Err(DomainError::new(
                    ErrorCode::VerificationCodeRateLimited,
                    format!(
                        "Please wait {retry_after} seconds before requesting another verification code."
                    ),
                )
                .with_meta(serde_json::json!({ "retry_after_secs": retry_after }))
                .into());
            }
        }

        let (raw_code, code_hash) = generate_email_verification_code(&clean_email);
        let id = Uuid::new_v4();
        state
            .email_verifications
            .retain(|r| !r.email.eq_ignore_ascii_case(&clean_email));
        state.email_verifications.push(StoredEmailVerificationRecord {
            id,
            email: clean_email,
            code_hash,
            attempts: 0,
            expires_at: now + Duration::minutes(10),
            created_at: now,
            used_at: None,
        });
        self.persist_state(&state);
        Ok((id, raw_code))
    }

    async fn verify_registration_verification_code(
        &self,
        email: &str,
        code: &str,
    ) -> Result<Uuid> {
        let clean_email = email.trim().to_ascii_lowercase();
        let clean_code = code.trim();
        let mut state = self.state.write().await;
        let now = Utc::now();

        let Some(rec) = state
            .email_verifications
            .iter_mut()
            .filter(|r| r.email.eq_ignore_ascii_case(&clean_email) && r.used_at.is_none())
            .max_by_key(|r| r.created_at)
        else {
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Verification code is invalid. Please request a new code.",
            ));
        };

        if rec.expires_at <= now {
            let expired_id = rec.id;
            state.email_verifications.retain(|r| r.id != expired_id);
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeExpired,
                "Verification code has expired. Please request a new code.",
            ));
        }

        if rec.attempts >= 5 {
            let locked_id = rec.id;
            state.email_verifications.retain(|r| r.id != locked_id);
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid verification attempts. Please request a new code.",
            ));
        }

        let candidate_hash = hash_email_verification_code(&clean_email, clean_code);
        if !constant_time_str_eq(&rec.code_hash, &candidate_hash) {
            rec.attempts += 1;
            let exceeded = rec.attempts >= 5;
            let bad_id = rec.id;
            if exceeded {
                state.email_verifications.retain(|r| r.id != bad_id);
            }
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Verification code is invalid. Please check your email and try again.",
            ));
        }

        Ok(rec.id)
    }

    async fn consume_registration_verification_code(&self, code_id: Uuid) -> Result<()> {
        let mut state = self.state.write().await;
        let before = state.email_verifications.len();
        state.email_verifications.retain(|r| r.id != code_id);
        if state.email_verifications.len() != before {
            self.persist_state(&state);
        }
        Ok(())
    }

    async fn change_user_password(
        &self,
        user_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> Result<()> {
        let mut state = self.state.write().await;
        let Some(rec) = state.users.iter_mut().find(|u| u.profile.id == user_id) else {
            return Err(domain_err(ErrorCode::UserNotFound, "User not found."));
        };
        if let Some(ref existing_hash) = rec.password_hash {
            if !verify_password(&rec.profile.username, current_password, existing_hash) {
                return Err(domain_err(
                    ErrorCode::InvalidCurrentPassword,
                    "Current password is incorrect.",
                ));
            }
        }
        rec.password_hash = Some(hash_password(&rec.profile.username, new_password));
        self.persist_state(&state);
        Ok(())
    }

    async fn create_session(&self, user_id: Uuid) -> Result<String> {
        self.create_session_with_meta(user_id, "", "", "", "").await
    }

    async fn create_session_with_meta(
        &self,
        user_id: Uuid,
        ip_address: &str,
        user_agent: &str,
        device_label: &str,
        device_fingerprint: &str,
    ) -> Result<String> {
        let (raw, token_hash, expires_at) = generate_raw_session_token();
        let now = Utc::now();
        let mut state = self.state.write().await;
        if state
            .users
            .iter()
            .any(|u| u.profile.id == user_id && u.profile.is_banned)
        {
            return Err(domain_err(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            ));
        }
        state.sessions.retain(|s| s.expires_at > now);
        let label = if device_label.trim().is_empty() {
            parse_user_agent_device(user_agent).0
        } else {
            device_label.trim().to_string()
        };
        state.sessions.push(StoredSessionRecord {
            id: Uuid::new_v4(),
            token_hash,
            user_id,
            ip_address: ip_address.trim().to_string(),
            user_agent: user_agent.trim().chars().take(512).collect(),
            device_label: label,
            device_fingerprint: device_fingerprint.trim().to_string(),
            created_at: now,
            last_seen_at: now,
            expires_at,
        });
        self.persist_state(&state);
        Ok(raw)
    }

    async fn get_user_by_session(&self, raw_token: &str) -> Result<Option<UserProfileDto>> {
        let hashed = hash_session_token(raw_token);
        let state = self.state.read().await;
        let now = Utc::now();
        let Some(sess) = state
            .sessions
            .iter()
            .find(|s| s.token_hash == hashed && s.expires_at > now)
        else {
            return Ok(None);
        };
        Ok(state
            .users
            .iter()
            .find(|u| u.profile.id == sess.user_id && !u.profile.is_banned)
            .map(|u| Self::resolve_user_dto_in_state(u, &state)))
    }

    async fn touch_session(&self, raw_token: &str, ip_address: &str) -> Result<()> {
        let hashed = hash_session_token(raw_token);
        let now = Utc::now();
        let mut state = self.state.write().await;
        if let Some(sess) = state
            .sessions
            .iter_mut()
            .find(|s| s.token_hash == hashed && s.expires_at > now)
        {
            let should_persist = (now - sess.last_seen_at).num_seconds() >= 60
                || (!ip_address.trim().is_empty() && sess.ip_address.is_empty());
            if should_persist {
                sess.last_seen_at = now;
                if sess.ip_address.is_empty() && !ip_address.trim().is_empty() {
                    sess.ip_address = ip_address.trim().to_string();
                }
                self.persist_state(&state);
            }
        }
        Ok(())
    }

    async fn list_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> Result<Vec<UserSessionDto>> {
        let current_hash = hash_session_token(current_raw_token);
        let state = self.state.read().await;
        let now = Utc::now();
        let mut out: Vec<UserSessionDto> = state
            .sessions
            .iter()
            .filter(|s| s.user_id == user_id && s.expires_at > now)
            .map(|s| {
                let (parsed_label, kind) = parse_user_agent_device(&s.user_agent);
                let label = if s.device_label.trim().is_empty() {
                    parsed_label
                } else {
                    s.device_label.clone()
                };
                UserSessionDto {
                    id: s.id,
                    ip_address: if s.ip_address.is_empty() {
                        "unknown".to_string()
                    } else {
                        s.ip_address.clone()
                    },
                    user_agent: s.user_agent.clone(),
                    device_label: label,
                    device_kind: kind,
                    created_at: s.created_at,
                    last_seen_at: s.last_seen_at,
                    expires_at: s.expires_at,
                    is_current: s.token_hash == current_hash,
                }
            })
            .collect();
        out.sort_by(|a, b| {
            b.is_current
                .cmp(&a.is_current)
                .then_with(|| b.last_seen_at.cmp(&a.last_seen_at))
        });
        Ok(out)
    }

    async fn revoke_user_session(&self, user_id: Uuid, session_id: Uuid) -> Result<bool> {
        let mut state = self.state.write().await;
        let now = Utc::now();
        let Some(pos) = state
            .sessions
            .iter()
            .position(|s| s.user_id == user_id && s.id == session_id)
        else {
            return Ok(false);
        };
        let removed_sess = state.sessions.remove(pos);
        let rem_ip = normalize_client_ip(&removed_sess.ip_address);
        let rem_fp = removed_sess.device_fingerprint.trim().to_string();
        let still_active_same_pair = state.sessions.iter().any(|s| {
            s.user_id == user_id
                && s.expires_at > now
                && normalize_client_ip(&s.ip_address) == rem_ip
                && s.device_fingerprint.trim() == rem_fp
        });
        if !still_active_same_pair && (!rem_ip.is_empty() || !rem_fp.is_empty()) {
            state.trusted_devices.retain(|d| {
                !(d.user_id == user_id
                    && normalize_client_ip(&d.ip_address) == rem_ip
                    && d.device_fingerprint.trim() == rem_fp)
            });
        }
        self.persist_state(&state);
        Ok(true)
    }

    async fn revoke_other_user_sessions(
        &self,
        user_id: Uuid,
        current_raw_token: &str,
    ) -> Result<usize> {
        let current_hash = hash_session_token(current_raw_token);
        let now = Utc::now();
        let mut state = self.state.write().await;
        let before = state.sessions.len();
        state
            .sessions
            .retain(|s| s.user_id != user_id || s.token_hash == current_hash);
        let removed = before.saturating_sub(state.sessions.len());
        let kept_pairs: HashSet<(String, String)> = state
            .sessions
            .iter()
            .filter(|s| s.user_id == user_id && s.expires_at > now)
            .map(|s| {
                (
                    normalize_client_ip(&s.ip_address),
                    s.device_fingerprint.trim().to_string(),
                )
            })
            .collect();
        let trusted_before = state.trusted_devices.len();
        if !kept_pairs.is_empty() {
            state.trusted_devices.retain(|d| {
                d.user_id != user_id
                    || kept_pairs.contains(&(
                        normalize_client_ip(&d.ip_address),
                        d.device_fingerprint.trim().to_string(),
                    ))
            });
        }
        if removed > 0 || state.trusted_devices.len() != trusted_before {
            self.persist_state(&state);
        }
        Ok(removed)
    }

    async fn delete_session(&self, raw_token: &str) -> Result<()> {
        let hashed = hash_session_token(raw_token);
        let mut state = self.state.write().await;
        state.sessions.retain(|s| s.token_hash != hashed);
        self.persist_state(&state);
        Ok(())
    }

    async fn detect_login_anomaly(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
    ) -> Result<Option<String>> {
        let now = Utc::now();
        let ttl_cutoff = now - Duration::days(TRUSTED_DEVICE_TTL_DAYS);
        let state = self.state.read().await;
        let all_trusted: Vec<&StoredTrustedDeviceRecord> = state
            .trusted_devices
            .iter()
            .filter(|d| d.user_id == user_id)
            .collect();
        let has_any_trusted_history = !all_trusted.is_empty();
        let active_trusted: Vec<(String, String)> = all_trusted
            .into_iter()
            .filter(|d| d.last_seen_at >= ttl_cutoff)
            .map(|d| (d.ip_address.clone(), d.device_fingerprint.clone()))
            .collect();
        let session_fallback_pairs: Vec<(String, String)> = if has_any_trusted_history {
            Vec::new()
        } else {
            state
                .sessions
                .iter()
                .filter(|s| {
                    s.user_id == user_id
                        && (!s.ip_address.trim().is_empty()
                            || !s.device_fingerprint.trim().is_empty())
                })
                .map(|s| (s.ip_address.clone(), s.device_fingerprint.clone()))
                .collect()
        };
        Ok(evaluate_login_anomaly(
            ip_address,
            device_fingerprint,
            &active_trusted,
            has_any_trusted_history,
            &session_fallback_pairs,
        )
        .map(str::to_string))
    }

    async fn record_trusted_device(
        &self,
        user_id: Uuid,
        ip_address: &str,
        device_fingerprint: &str,
        device_label: &str,
    ) -> Result<()> {
        let clean_ip = normalize_client_ip(ip_address);
        let clean_fp = device_fingerprint.trim();
        if clean_ip.is_empty() && clean_fp.is_empty() {
            return Ok(());
        }
        let now = Utc::now();
        let mut state = self.state.write().await;
        if let Some(existing) = state.trusted_devices.iter_mut().find(|d| {
            d.user_id == user_id
                && normalize_client_ip(&d.ip_address) == clean_ip
                && d.device_fingerprint.trim() == clean_fp
        }) {
            existing.ip_address = clean_ip;
            existing.last_seen_at = now;
            if !device_label.trim().is_empty() {
                existing.device_label = device_label.trim().to_string();
            }
        } else {
            state.trusted_devices.push(StoredTrustedDeviceRecord {
                id: Uuid::new_v4(),
                user_id,
                ip_address: clean_ip,
                device_fingerprint: clean_fp.to_string(),
                device_label: device_label.trim().to_string(),
                first_seen_at: now,
                last_seen_at: now,
            });
        }
        self.persist_state(&state);
        Ok(())
    }

    async fn create_login_otp_challenge(
        &self,
        user_id: Uuid,
        email: &str,
        ip_address: &str,
        user_agent: &str,
        device_label: &str,
        device_fingerprint: &str,
        anomaly_reason: &str,
    ) -> Result<(Uuid, String)> {
        let now = Utc::now();
        let mut state = self.state.write().await;
        state.login_otp_challenges.retain(|c| c.expires_at > now);
        let (raw_code, code_hash) = generate_email_verification_code(email);
        let id = Uuid::new_v4();
        state.login_otp_challenges.retain(|c| c.user_id != user_id);
        state.login_otp_challenges.push(StoredLoginOtpChallengeRecord {
            id,
            user_id,
            email: email.trim().to_ascii_lowercase(),
            ip_address: ip_address.trim().to_string(),
            user_agent: user_agent.trim().chars().take(512).collect(),
            device_label: device_label.trim().to_string(),
            device_fingerprint: device_fingerprint.trim().to_string(),
            anomaly_reason: anomaly_reason.trim().to_string(),
            code_hash,
            attempts: 0,
            expires_at: now + Duration::minutes(10),
            created_at: now,
            last_sent_at: now,
        });
        self.persist_state(&state);
        Ok((id, raw_code))
    }

    async fn resend_login_otp_challenge(
        &self,
        challenge_id: Uuid,
    ) -> Result<(UserProfileDto, String, String, String, String)> {
        let now = Utc::now();
        let mut state = self.state.write().await;
        state.login_otp_challenges.retain(|c| c.expires_at > now);
        let Some(pos) = state
            .login_otp_challenges
            .iter()
            .position(|c| c.id == challenge_id)
        else {
            return Err(domain_err(
                ErrorCode::OtpChallengeExpired,
                "Verification session has expired. Please sign in again.",
            ));
        };
        let elapsed = (now - state.login_otp_challenges[pos].last_sent_at).num_seconds();
        if elapsed < 60 {
            let retry_after = (60 - elapsed).max(1);
            return Err(DomainError::new(
                ErrorCode::VerificationCodeRateLimited,
                format!(
                    "Please wait {retry_after} seconds before requesting another verification code."
                ),
            )
            .with_meta(serde_json::json!({ "retry_after_secs": retry_after }))
            .into());
        }

        let email = state.login_otp_challenges[pos].email.clone();
        let user_id = state.login_otp_challenges[pos].user_id;
        let ip = state.login_otp_challenges[pos].ip_address.clone();
        let device = state.login_otp_challenges[pos].device_label.clone();
        let reason = state.login_otp_challenges[pos].anomaly_reason.clone();
        let (raw_code, code_hash) = generate_email_verification_code(&email);
        state.login_otp_challenges[pos].code_hash = code_hash;
        state.login_otp_challenges[pos].attempts = 0;
        state.login_otp_challenges[pos].expires_at = now + Duration::minutes(10);
        state.login_otp_challenges[pos].last_sent_at = now;

        let grav = Self::gravatar_base(&state).to_string();
        let Some(user_rec) = state.users.iter().find(|u| u.profile.id == user_id) else {
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        let user = Self::resolve_user_dto(user_rec, &grav);
        self.persist_state(&state);
        Ok((user, raw_code, ip, device, reason))
    }

    async fn verify_login_otp_challenge(
        &self,
        challenge_id: Uuid,
        code: &str,
    ) -> Result<(UserProfileDto, String, String, String, String)> {
        let now = Utc::now();
        let clean_code = code.trim();
        let mut state = self.state.write().await;
        let Some(pos) = state
            .login_otp_challenges
            .iter()
            .position(|c| c.id == challenge_id)
        else {
            return Err(domain_err(
                ErrorCode::OtpChallengeInvalid,
                "Verification session is invalid or has expired.",
            ));
        };
        if state.login_otp_challenges[pos].expires_at <= now {
            state.login_otp_challenges.remove(pos);
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::OtpChallengeExpired,
                "Verification code has expired. Please request a new code.",
            ));
        }
        if state.login_otp_challenges[pos].attempts >= 5 {
            state.login_otp_challenges.remove(pos);
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Too many invalid attempts. Please sign in again.",
            ));
        }
        let expected_hash = state.login_otp_challenges[pos].code_hash.clone();
        let email = state.login_otp_challenges[pos].email.clone();
        let candidate = hash_email_verification_code(&email, clean_code);
        if !constant_time_str_eq(&expected_hash, &candidate) {
            state.login_otp_challenges[pos].attempts += 1;
            if state.login_otp_challenges[pos].attempts >= 5 {
                state.login_otp_challenges.remove(pos);
            }
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::VerificationCodeInvalid,
                "Invalid verification code. Please check your email and try again.",
            ));
        }
        let rec = state.login_otp_challenges.remove(pos);
        let grav = Self::gravatar_base(&state).to_string();
        let Some(user_rec) = state.users.iter().find(|u| u.profile.id == rec.user_id) else {
            self.persist_state(&state);
            return Err(domain_err(ErrorCode::UserNotFound, "Account not found."));
        };
        if user_rec.profile.is_banned {
            self.persist_state(&state);
            return Err(domain_err(
                ErrorCode::AccountBanned,
                "This account has been suspended.",
            ));
        }
        let user = Self::resolve_user_dto(user_rec, &grav);
        self.persist_state(&state);
        Ok((
            user,
            rec.ip_address,
            rec.user_agent,
            rec.device_label,
            rec.device_fingerprint,
        ))
    }

    async fn delete_login_otp_challenge(&self, challenge_id: Uuid) -> Result<()> {
        let mut state = self.state.write().await;
        let before = state.login_otp_challenges.len();
        state.login_otp_challenges.retain(|c| c.id != challenge_id);
        if state.login_otp_challenges.len() != before {
            self.persist_state(&state);
        }
        Ok(())
    }

    async fn merge_anonymous_learner(&self, anon_id: &str, user_learner_id: &str) -> Result<()> {
        let clean_anon = anon_id.trim();
        if clean_anon.is_empty()
            || clean_anon == user_learner_id
            || clean_anon.starts_with("user:")
        {
            return Ok(());
        }
        let mut state = self.state.write().await;
        if let Some(anon_steps) = state.progress.get(anon_id).cloned() {
            state
                .progress
                .entry(user_learner_id.to_string())
                .or_default()
                .extend(anon_steps);
        }
        if let Some(anon_tasks) = state.task_checks.get(anon_id).cloned() {
            let target_map = state
                .task_checks
                .entry(user_learner_id.to_string())
                .or_default();
            for (step_id, items) in anon_tasks {
                target_map.entry(step_id).or_default().extend(items);
            }
        }
        for note in &mut state.notes {
            if note.learner_id == anon_id {
                note.learner_id = user_learner_id.to_string();
            }
        }
        self.persist_state(&state);
        Ok(())
    }

    async fn studio_list_tracks(
        &self,
        viewer: &UserProfileDto,
        locale: &str,
    ) -> Result<Vec<StudioTrackDto>> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let grav = Self::gravatar_base(&state);
        Ok(build_studio_overview_from_bundle(
            &bundle,
            Some(viewer),
            locale,
            &state.step_meta,
            &state.users,
            grav,
        ))
    }

    async fn studio_get_step_editor(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<StudioStepEditorDto> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let grav = Self::gravatar_base(&state);
        read_step_editor_from_bundle(
            viewer,
            &bundle,
            track_slug,
            chapter_slug,
            step_slug,
            locale,
            &state.step_meta,
            &state.collab_invites,
            &state.users,
            grav,
        )
    }

    async fn studio_save_step(
        &self,
        author: &UserProfileDto,
        input: SaveStudioStepInput,
        content_dir: &Path,
        require_if_match: bool,
    ) -> Result<StudioStepEditorDto> {
        let mut bundle = self.bundle.write().await;
        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        let PersistedUserState {
            ref mut step_meta,
            ref mut step_revisions,
            ref mut collab_audit_logs,
            ref collab_invites,
            ref users,
            ..
        } = *state;
        let saved = apply_save_step_to_bundle_and_disk(
            author,
            &mut bundle,
            step_meta,
            step_revisions,
            collab_audit_logs,
            collab_invites,
            users,
            &grav,
            &input,
            content_dir,
            require_if_match,
        )?;
        self.persist_state(&state);
        Ok(saved)
    }

    async fn studio_create_track(
        &self,
        input: CreateTrackInput,
        content_dir: &Path,
    ) -> Result<StudioTrackDto> {
        let mut bundle = self.bundle.write().await;
        create_track_in_bundle_and_disk(&mut bundle, &input, content_dir)
    }

    async fn studio_delete_track(&self, track_slug: &str, content_dir: &Path) -> Result<bool> {
        let mut bundle = self.bundle.write().await;
        let (removed, step_ids) = delete_track_in_bundle_and_disk(&mut bundle, track_slug, content_dir)?;
        if removed && !step_ids.is_empty() {
            let mut state = self.state.write().await;
            for sid in &step_ids {
                state.step_meta.remove(sid);
                state.likes_delta.remove(sid);
            }
            state.collab_invites.retain(|i| !step_ids.contains(&i.step_id));
            state.notes.retain(|n| !step_ids.contains(&n.step_id));
            self.persist_state(&state);
        }
        Ok(removed)
    }

    async fn studio_create_chapter(
        &self,
        input: CreateChapterInput,
        content_dir: &Path,
    ) -> Result<()> {
        let mut bundle = self.bundle.write().await;
        create_chapter_in_bundle_and_disk(&mut bundle, &input, content_dir)
    }

    async fn studio_delete_chapter(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        content_dir: &Path,
    ) -> Result<bool> {
        let mut bundle = self.bundle.write().await;
        let (removed, step_ids) =
            delete_chapter_in_bundle_and_disk(&mut bundle, track_slug, chapter_slug, content_dir)?;
        if removed && !step_ids.is_empty() {
            let mut state = self.state.write().await;
            for sid in &step_ids {
                state.step_meta.remove(sid);
                state.likes_delta.remove(sid);
            }
            state.collab_invites.retain(|i| !step_ids.contains(&i.step_id));
            state.notes.retain(|n| !step_ids.contains(&n.step_id));
            self.persist_state(&state);
        }
        Ok(removed)
    }

    async fn studio_delete_step(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        content_dir: &Path,
    ) -> Result<bool> {
        let mut bundle = self.bundle.write().await;
        let mut state = self.state.write().await;
        if let Some(track) = bundle.tracks.iter().find(|t| t.manifest.slug == track_slug) {
            if let Some(ch) = track.chapters.iter().find(|c| c.slug == chapter_slug) {
                if let Some(step) = ch.steps.iter().find(|s| s.slug == step_slug) {
                    if !actor.role.is_admin() {
                        let owner = state.step_meta.get(&step.id).and_then(|m| m.owner_user_id);
                        if owner != Some(actor.id) {
                            return Err(domain_err(
                                ErrorCode::StepDeleteForbidden,
                                "Only the article owner or an administrator can delete this article.",
                            ));
                        }
                    }
                }
            }
        }
        let (removed, sid_opt) = delete_step_in_bundle_and_disk(
            &mut bundle,
            track_slug,
            chapter_slug,
            step_slug,
            content_dir,
        )?;
        if let Some(sid) = sid_opt {
            state.step_meta.remove(&sid);
            state.likes_delta.remove(&sid);
            state.collab_invites.retain(|i| i.step_id != sid);
            state.step_revisions.retain(|r| r.step_id != sid);
            state.collab_audit_logs.retain(|l| l.step_id != sid);
            state.notes.retain(|n| n.step_id != sid);
            self.persist_state(&state);
        }
        Ok(removed)
    }

    async fn create_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        email: &str,
        role: &str,
        locale_scope: &[String],
    ) -> Result<(CollaboratorInviteDto, String, String)> {
        let Some(clean_email) = icehandnote_core::auth::validate_and_normalize_email(email) else {
            return Err(domain_err(
                ErrorCode::InvalidEmail,
                "Please provide a valid email address.",
            ));
        };
        let clean_email = clean_email.as_str();
        let norm_role = normalize_collaborator_role(Some(role));
        let norm_scope = if norm_role == "translator" {
            normalize_locale_scope(locale_scope)
        } else {
            Vec::new()
        };

        let bundle = self.bundle.read().await;
        let Some(track) = bundle.tracks.iter().find(|t| t.manifest.slug == track_slug) else {
            return Err(domain_err(ErrorCode::TrackNotFound, "Track not found."));
        };
        let Some(ch) = track.chapters.iter().find(|c| c.slug == chapter_slug) else {
            return Err(domain_err(ErrorCode::ChapterNotFound, "Chapter not found."));
        };
        let Some(step) = ch.steps.iter().find(|s| s.slug == step_slug) else {
            return Err(domain_err(
                ErrorCode::StepSaveRequired,
                "Please save the article before inviting collaborators.",
            ));
        };
        let step_id = step.id;
        let step_title = step
            .translations
            .get(&step.default_locale)
            .or_else(|| step.translations.values().next())
            .map(|t| t.compiled.frontmatter.title.clone())
            .unwrap_or_else(|| step.slug.clone());
        drop(bundle);

        let mut state = self.state.write().await;
        let owner_opt = state.step_meta.get(&step_id).and_then(|m| m.owner_user_id);
        // C-03: Never allow non-admin authors to claim unowned (owner_user_id = None) articles
        if !actor.role.is_admin() && owner_opt != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::InviteForbidden,
                "Only the article owner or an administrator can send collaboration invites.",
            ));
        }

        // Reject inviting someone who is already a member of this article
        if let Some(existing_user) = state
            .users
            .iter()
            .find(|u| u.profile.email.eq_ignore_ascii_case(clean_email))
        {
            let uid = existing_user.profile.id;
            if owner_opt == Some(uid)
                || state
                    .step_meta
                    .get(&step_id)
                    .map_or(false, |m| m.is_collaborator(uid))
            {
                return Err(domain_err(
                    ErrorCode::InviteAlreadyMember,
                    "This user is already a collaborator on this article.",
                ));
            }
        }

        let now = Utc::now();
        // Deduplicate: supersede any previous active invite for the same (step_id, email)
        for existing in &mut state.collab_invites {
            if existing.step_id == step_id
                && existing.email.eq_ignore_ascii_case(clean_email)
                && existing.consumed_at.is_none()
                && existing.revoked_at.is_none()
            {
                existing.revoked_at = Some(now);
            }
        }
        // Prune very old finished invites (> 30 days) while keeping recent ones for 410 Gone accuracy
        let prune_cutoff = now - Duration::days(30);
        state
            .collab_invites
            .retain(|i| i.expires_at > prune_cutoff && i.created_at > prune_cutoff);

        let (raw_token, token_hash) = generate_action_token("ihn_inv", "collab_invite_v1");
        let inv = StoredCollabInviteRecord {
            id: Uuid::new_v4(),
            step_id,
            email: clean_email.to_string(),
            token_hash,
            role: norm_role.clone(),
            locale_scope: norm_scope.clone(),
            invited_by: Some(actor.id),
            expires_at: now + Duration::days(7),
            created_at: now,
            consumed_at: None,
            revoked_at: None,
        };
        let dto = CollaboratorInviteDto {
            id: inv.id,
            email: inv.email.clone(),
            role: inv.role.clone(),
            locale_scope: inv.locale_scope.clone(),
            created_at: inv.created_at,
            expires_at: inv.expires_at,
        };
        state.collab_invites.push(inv);
        state.collab_audit_logs.push(CollaborationAuditLogDto {
            id: Uuid::new_v4(),
            step_id,
            actor_user_id: Some(actor.id),
            actor_name: actor.display_name.clone(),
            action: "invite_created".to_string(),
            detail: format!("{} ({norm_role})", mask_email_address(clean_email)),
            created_at: now,
        });
        self.persist_state(&state);
        Ok((dto, raw_token, step_title))
    }

    async fn preview_collaborator_invite(
        &self,
        viewer: Option<&UserProfileDto>,
        raw_token: &str,
    ) -> Result<InvitePreviewDto> {
        let token_hash = hash_action_token("collab_invite_v1", raw_token.trim());
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let now = Utc::now();

        let Some(inv) = state
            .collab_invites
            .iter()
            .find(|i| i.token_hash == token_hash)
        else {
            return Err(domain_err(
                ErrorCode::InviteNotFound,
                "Collaboration invitation was not found.",
            ));
        };
        if inv.consumed_at.is_some() || inv.revoked_at.is_some() || inv.expires_at <= now {
            return Err(domain_err(
                ErrorCode::InviteExpired,
                "This collaboration invitation has expired, been revoked, or already been used.",
            ));
        }

        let mut target_info = None;
        for t in &bundle.tracks {
            for c in &t.chapters {
                for s in &c.steps {
                    if s.id == inv.step_id {
                        let title = s
                            .translations
                            .get(&s.default_locale)
                            .or_else(|| s.translations.values().next())
                            .map(|tr| tr.compiled.frontmatter.title.clone())
                            .unwrap_or_else(|| s.slug.clone());
                        target_info = Some((
                            t.manifest.slug.clone(),
                            c.slug.clone(),
                            s.slug.clone(),
                            title,
                        ));
                        break;
                    }
                }
            }
        }
        let Some((track_slug, chapter_slug, step_slug, article_title)) = target_info else {
            return Err(domain_err(
                ErrorCode::InviteTargetDeleted,
                "The invited article no longer exists.",
            ));
        };

        let invited_by_name = inv
            .invited_by
            .and_then(|uid| state.users.iter().find(|u| u.profile.id == uid))
            .map(|u| u.profile.display_name.clone())
            .unwrap_or_else(|| "Author".to_string());
        let email_matches_viewer = viewer.map(|v| v.email.trim().eq_ignore_ascii_case(&inv.email));

        Ok(InvitePreviewDto {
            invite_id: inv.id,
            masked_email: mask_email_address(&inv.email),
            role: normalize_collaborator_role(Some(&inv.role)),
            locale_scope: inv.locale_scope.clone(),
            track_slug,
            chapter_slug,
            step_slug,
            article_title,
            invited_by_name,
            expires_at: inv.expires_at,
            email_matches_viewer,
        })
    }

    async fn revoke_collaborator_invite(
        &self,
        actor: &UserProfileDto,
        invite_id: Uuid,
    ) -> Result<bool> {
        let mut state = self.state.write().await;
        let Some(pos) = state.collab_invites.iter().position(|i| {
            i.id == invite_id && i.consumed_at.is_none() && i.revoked_at.is_none()
        }) else {
            return Ok(false);
        };
        let step_id = state.collab_invites[pos].step_id;
        let inv_email = state.collab_invites[pos].email.clone();
        let owner = state.step_meta.get(&step_id).and_then(|m| m.owner_user_id);
        if !actor.role.is_admin() && owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::InviteForbidden,
                "You do not have permission to revoke this invitation.",
            ));
        }
        let now = Utc::now();
        state.collab_invites[pos].revoked_at = Some(now);
        state.collab_audit_logs.push(CollaborationAuditLogDto {
            id: Uuid::new_v4(),
            step_id,
            actor_user_id: Some(actor.id),
            actor_name: actor.display_name.clone(),
            action: "invite_revoked".to_string(),
            detail: mask_email_address(&inv_email),
            created_at: now,
        });
        self.persist_state(&state);
        Ok(true)
    }

    async fn accept_collaborator_invite(
        &self,
        user: &UserProfileDto,
        raw_token: &str,
    ) -> Result<(String, String, String)> {
        let token_hash = hash_action_token("collab_invite_v1", raw_token.trim());
        let bundle = self.bundle.read().await;
        let mut state = self.state.write().await;
        let now = Utc::now();

        let Some(pos) = state
            .collab_invites
            .iter()
            .position(|i| i.token_hash == token_hash)
        else {
            return Err(domain_err(
                ErrorCode::InviteNotFound,
                "Collaboration invitation was not found.",
            ));
        };
        if state.collab_invites[pos].consumed_at.is_some()
            || state.collab_invites[pos].revoked_at.is_some()
            || state.collab_invites[pos].expires_at <= now
        {
            return Err(domain_err(
                ErrorCode::InviteExpired,
                "This collaboration invitation has expired, been revoked, or already been used.",
            ));
        }

        // C-02: Strict email binding BEFORE consuming the token (so mismatched clickers cannot burn the link!)
        let inv_email = state.collab_invites[pos].email.clone();
        if !user.email.trim().eq_ignore_ascii_case(&inv_email) {
            return Err(DomainError::new(
                ErrorCode::InviteEmailMismatch,
                "This invitation was issued for a different email address. Sign in with the invited account.",
            )
            .with_meta(serde_json::json!({ "expected_email": mask_email_address(&inv_email) }))
            .into());
        }

        let step_id = state.collab_invites[pos].step_id;
        let inv_role = normalize_collaborator_role(Some(&state.collab_invites[pos].role));
        let inv_scope = state.collab_invites[pos].locale_scope.clone();

        let mut target_loc = None;
        for t in &bundle.tracks {
            for c in &t.chapters {
                for s in &c.steps {
                    if s.id == step_id {
                        target_loc =
                            Some((t.manifest.slug.clone(), c.slug.clone(), s.slug.clone()));
                        break;
                    }
                }
            }
        }
        let Some(slugs) = target_loc else {
            return Err(domain_err(
                ErrorCode::InviteTargetDeleted,
                "The invited article no longer exists.",
            ));
        };

        // Check if already a member (409 Conflict)
        if let Some(meta) = state.step_meta.get(&step_id) {
            if meta.owner_user_id == Some(user.id) || meta.is_collaborator(user.id) {
                return Err(domain_err(
                    ErrorCode::InviteAlreadyMember,
                    "You are already a collaborator on this article.",
                ));
            }
        }

        // Consume invite & grant scoped collaborator role WITHOUT site-wide reader->author privilege escalation!
        state.collab_invites[pos].consumed_at = Some(now);
        let meta = state.step_meta.entry(step_id).or_default();
        meta.set_collaborator(user.id, &inv_role, &inv_scope);

        state.collab_audit_logs.push(CollaborationAuditLogDto {
            id: Uuid::new_v4(),
            step_id,
            actor_user_id: Some(user.id),
            actor_name: user.display_name.clone(),
            action: "invite_accepted".to_string(),
            detail: format!("{} ({inv_role})", user.display_name),
            created_at: now,
        });
        self.persist_state(&state);
        Ok(slugs)
    }

    async fn remove_step_collaborator(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> Result<bool> {
        let bundle = self.bundle.read().await;
        let Some(step_id) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| t.chapters.iter().find(|c| c.slug == chapter_slug))
            .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
            .map(|s| s.id)
        else {
            return Ok(false);
        };
        drop(bundle);

        let mut state = self.state.write().await;
        let owner_opt = state.step_meta.get(&step_id).and_then(|m| m.owner_user_id);
        if !actor.role.is_admin() && owner_opt != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Only the article owner or an administrator can remove collaborators.",
            ));
        }
        let target_name = state
            .users
            .iter()
            .find(|u| u.profile.id == target_user_id)
            .map(|u| u.profile.display_name.clone())
            .unwrap_or_else(|| target_user_id.to_string());
        let changed = state
            .step_meta
            .get_mut(&step_id)
            .map_or(false, |meta| meta.remove_collaborator(target_user_id));
        if changed {
            state.collab_audit_logs.push(CollaborationAuditLogDto {
                id: Uuid::new_v4(),
                step_id,
                actor_user_id: Some(actor.id),
                actor_name: actor.display_name.clone(),
                action: "collaborator_removed".to_string(),
                detail: target_name,
                created_at: Utc::now(),
            });
            self.persist_state(&state);
        }
        Ok(changed)
    }

    async fn update_step_collaborator_role(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
        role: &str,
        locale_scope: &[String],
    ) -> Result<bool> {
        let bundle = self.bundle.read().await;
        let Some(step_id) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| t.chapters.iter().find(|c| c.slug == chapter_slug))
            .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
            .map(|s| s.id)
        else {
            return Ok(false);
        };
        drop(bundle);

        let mut state = self.state.write().await;
        let owner_opt = state.step_meta.get(&step_id).and_then(|m| m.owner_user_id);
        if !actor.role.is_admin() && owner_opt != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Only the article owner or an administrator can update collaborator roles.",
            ));
        }
        let is_member = state
            .step_meta
            .get(&step_id)
            .map_or(false, |m| m.is_collaborator(target_user_id));
        if !is_member {
            return Ok(false);
        }
        let norm_role = normalize_collaborator_role(Some(role));
        let norm_scope = if norm_role == "translator" {
            normalize_locale_scope(locale_scope)
        } else {
            Vec::new()
        };
        let target_name = state
            .users
            .iter()
            .find(|u| u.profile.id == target_user_id)
            .map(|u| u.profile.display_name.clone())
            .unwrap_or_else(|| target_user_id.to_string());
        if let Some(meta) = state.step_meta.get_mut(&step_id) {
            meta.set_collaborator(target_user_id, &norm_role, &norm_scope);
        }
        state.collab_audit_logs.push(CollaborationAuditLogDto {
            id: Uuid::new_v4(),
            step_id,
            actor_user_id: Some(actor.id),
            actor_name: actor.display_name.clone(),
            action: "role_updated".to_string(),
            detail: format!("{target_name} -> {norm_role}"),
            created_at: Utc::now(),
        });
        self.persist_state(&state);
        Ok(true)
    }

    async fn leave_step_collaboration(
        &self,
        user: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<bool> {
        let bundle = self.bundle.read().await;
        let Some(step_id) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| t.chapters.iter().find(|c| c.slug == chapter_slug))
            .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
            .map(|s| s.id)
        else {
            return Ok(false);
        };
        drop(bundle);

        let mut state = self.state.write().await;
        let owner_opt = state.step_meta.get(&step_id).and_then(|m| m.owner_user_id);
        if owner_opt == Some(user.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Article owners must transfer ownership before leaving.",
            ));
        }
        let changed = state
            .step_meta
            .get_mut(&step_id)
            .map_or(false, |meta| meta.remove_collaborator(user.id));
        if changed {
            state.collab_audit_logs.push(CollaborationAuditLogDto {
                id: Uuid::new_v4(),
                step_id,
                actor_user_id: Some(user.id),
                actor_name: user.display_name.clone(),
                action: "collaborator_left".to_string(),
                detail: user.display_name.clone(),
                created_at: Utc::now(),
            });
            self.persist_state(&state);
        }
        Ok(changed)
    }

    async fn transfer_step_ownership(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        target_user_id: Uuid,
    ) -> Result<bool> {
        let bundle = self.bundle.read().await;
        let Some(step_id) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| t.chapters.iter().find(|c| c.slug == chapter_slug))
            .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
            .map(|s| s.id)
        else {
            return Ok(false);
        };
        drop(bundle);

        let mut state = self.state.write().await;
        let prev_owner = state.step_meta.get(&step_id).and_then(|m| m.owner_user_id);
        if !actor.role.is_admin() && prev_owner != Some(actor.id) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "Only the article owner or an administrator can transfer ownership.",
            ));
        }
        let Some(target_user) = state
            .users
            .iter()
            .find(|u| u.profile.id == target_user_id && !u.profile.is_banned)
        else {
            return Err(domain_err(
                ErrorCode::UserNotFound,
                "Target user not found.",
            ));
        };
        let target_name = target_user.profile.display_name.clone();
        let meta = state.step_meta.entry(step_id).or_default();
        if let Some(old_oid) = prev_owner {
            if old_oid != target_user_id {
                meta.set_collaborator(old_oid, "editor", &[]);
            }
        }
        meta.remove_collaborator(target_user_id);
        meta.owner_user_id = Some(target_user_id);
        meta.author_name_fallback = target_name.clone();

        state.collab_audit_logs.push(CollaborationAuditLogDto {
            id: Uuid::new_v4(),
            step_id,
            actor_user_id: Some(actor.id),
            actor_name: actor.display_name.clone(),
            action: "owner_transferred".to_string(),
            detail: format!("-> {target_name}"),
            created_at: Utc::now(),
        });
        self.persist_state(&state);
        Ok(true)
    }

    async fn list_step_revisions(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
    ) -> Result<Vec<StepRevisionDto>> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let Some(step) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| {
                if chapter_slug.is_empty() || chapter_slug == "-" {
                    t.chapters
                        .iter()
                        .find_map(|c| c.steps.iter().find(|s| s.slug == step_slug))
                } else {
                    t.chapters
                        .iter()
                        .find(|c| c.slug == chapter_slug)
                        .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
                        .or_else(|| {
                            t.chapters
                                .iter()
                                .find_map(|c| c.steps.iter().find(|s| s.slug == step_slug))
                        })
                }
            })
        else {
            return Ok(Vec::new());
        };
        let can_read_drafts = user_can_read_local_draft(viewer, step.id, &state.step_meta);
        if !can_read_drafts {
            let has_pub = step
                .translations
                .get(locale)
                .map_or(false, |tr| tr.compiled.frontmatter.status != "draft");
            if !has_pub {
                return Err(domain_err(
                    ErrorCode::DraftAccessForbidden,
                    "You do not have permission to view this article's revision history.",
                ));
            }
        }
        let mut revs: Vec<StepRevisionDto> = state
            .step_revisions
            .iter()
            .filter(|r| r.step_id == step.id && r.locale_code == locale)
            .filter(|r| can_read_drafts || r.status != "draft")
            .cloned()
            .collect();
        revs.sort_by(|a, b| {
            b.edit_seq
                .cmp(&a.edit_seq)
                .then_with(|| b.created_at.cmp(&a.created_at))
        });
        revs.truncate(50);
        Ok(revs)
    }

    async fn restore_step_revision(
        &self,
        actor: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        locale: &str,
        revision_id: Uuid,
        expected_etag: Option<&str>,
        content_dir: &Path,
    ) -> Result<StudioStepEditorDto> {
        let mut bundle = self.bundle.write().await;
        let mut state = self.state.write().await;
        let Some((resolved_ch_slug, step_id, step_number, cur_license, cur_tags, cur_status)) =
            bundle
                .tracks
                .iter()
                .find(|t| t.manifest.slug == track_slug)
                .and_then(|t| {
                    t.chapters
                        .iter()
                        .find(|c| c.slug == chapter_slug)
                        .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug).map(|s| (c, s)))
                        .or_else(|| {
                            t.chapters.iter().find_map(|c| {
                                c.steps.iter().find(|s| s.slug == step_slug).map(|s| (c, s))
                            })
                        })
                })
                .map(|(c, s)| {
                    let tr = s.translations.get(locale);
                    (
                        c.slug.clone(),
                        s.id,
                        s.step_number,
                        tr.map(|t| t.compiled.frontmatter.license.clone())
                            .unwrap_or_default(),
                        tr.map(|t| t.compiled.frontmatter.tags.clone())
                            .unwrap_or_default(),
                        tr.map(|t| t.compiled.frontmatter.status.clone())
                            .unwrap_or_else(|| "draft".to_string()),
                    )
                })
        else {
            return Err(domain_err(ErrorCode::StepNotFound, "Article not found."));
        };

        user_can_edit_local_step_locale(actor, step_id, locale, &state.step_meta)?;

        let Some(rev) = state
            .step_revisions
            .iter()
            .find(|r| r.id == revision_id && r.step_id == step_id && r.locale_code == locale)
            .cloned()
        else {
            return Err(domain_err(
                ErrorCode::RevisionNotFound,
                "Revision snapshot not found.",
            ));
        };

        let input = SaveStudioStepInput {
            track_slug: track_slug.to_string(),
            chapter_slug: resolved_ch_slug,
            step_slug: step_slug.to_string(),
            previous_step_slug: None,
            locale: locale.to_string(),
            title: rev.title.clone(),
            summary: rev.summary.clone(),
            step_number,
            estimated_minutes: 1,
            synced_revision: rev.synced_revision,
            bump_canonical: false,
            status: cur_status,
            license: cur_license,
            tags: cur_tags,
            body_markdown: rev.body_markdown.clone(),
            write_to_content_dir: true,
            expected_etag: expected_etag.map(ToString::to_string),
            change_note: Some(format!("Restored from #{}", rev.edit_seq)),
        };

        let grav = Self::gravatar_base(&state).to_string();
        let PersistedUserState {
            ref mut step_meta,
            ref mut step_revisions,
            ref mut collab_audit_logs,
            ref collab_invites,
            ref users,
            ..
        } = *state;
        let saved = apply_save_step_to_bundle_and_disk(
            actor,
            &mut bundle,
            step_meta,
            step_revisions,
            collab_audit_logs,
            collab_invites,
            users,
            &grav,
            &input,
            content_dir,
            true,
        )?;
        collab_audit_logs.push(CollaborationAuditLogDto {
            id: Uuid::new_v4(),
            step_id,
            actor_user_id: Some(actor.id),
            actor_name: actor.display_name.clone(),
            action: "revision_restored".to_string(),
            detail: format!("{locale} <- #{}", rev.edit_seq),
            created_at: Utc::now(),
        });
        self.persist_state(&state);
        Ok(saved)
    }

    async fn list_step_audit_logs(
        &self,
        viewer: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<Vec<CollaborationAuditLogDto>> {
        let bundle = self.bundle.read().await;
        let state = self.state.read().await;
        let Some(step_id) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| {
                t.chapters
                    .iter()
                    .find(|c| c.slug == chapter_slug)
                    .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
                    .or_else(|| {
                        t.chapters
                            .iter()
                            .find_map(|c| c.steps.iter().find(|s| s.slug == step_slug))
                    })
            })
            .map(|s| s.id)
        else {
            return Ok(Vec::new());
        };
        if !user_can_read_local_draft(viewer, step_id, &state.step_meta) {
            return Err(domain_err(
                ErrorCode::CollaboratorForbidden,
                "You do not have permission to view this article's collaboration audit log.",
            ));
        }
        let mut logs: Vec<CollaborationAuditLogDto> = state
            .collab_audit_logs
            .iter()
            .filter(|l| l.step_id == step_id)
            .cloned()
            .collect();
        logs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        logs.truncate(50);
        Ok(logs)
    }

    async fn admin_takedown_step(
        &self,
        admin: &UserProfileDto,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
        reason: &str,
    ) -> Result<(String, Vec<UserProfileDto>)> {
        let clean_reason = reason.trim();
        if clean_reason.is_empty() {
            return Err(domain_err(
                ErrorCode::TakedownReasonRequired,
                "A takedown reason is required.",
            ));
        }
        let bundle = self.bundle.read().await;
        let Some(step) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| t.chapters.iter().find(|c| c.slug == chapter_slug))
            .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
        else {
            return Err(domain_err(ErrorCode::StepNotFound, "Article not found."));
        };
        let step_id = step.id;
        let title = step
            .translations
            .get(&step.default_locale)
            .or_else(|| step.translations.values().next())
            .map(|t| t.compiled.frontmatter.title.clone())
            .unwrap_or_else(|| step.slug.clone());
        drop(bundle);

        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        let meta = state.step_meta.entry(step_id).or_default();
        meta.takedown_reason = Some(clean_reason.to_string());
        meta.takedown_at = Some(Utc::now());
        meta.takedown_by = Some(admin.display_name.clone());

        let mut notify_ids = Vec::new();
        if let Some(oid) = meta.owner_user_id {
            notify_ids.push(oid);
        }
        for cid in &meta.collaborator_ids {
            if !notify_ids.contains(cid) {
                notify_ids.push(*cid);
            }
        }
        let recipients: Vec<UserProfileDto> = state
            .users
            .iter()
            .filter(|u| notify_ids.contains(&u.profile.id))
            .map(|u| Self::resolve_user_dto(u, &grav))
            .collect();

        self.persist_state(&state);
        Ok((title, recipients))
    }

    async fn admin_restore_step(
        &self,
        track_slug: &str,
        chapter_slug: &str,
        step_slug: &str,
    ) -> Result<bool> {
        let bundle = self.bundle.read().await;
        let Some(step_id) = bundle
            .tracks
            .iter()
            .find(|t| t.manifest.slug == track_slug)
            .and_then(|t| t.chapters.iter().find(|c| c.slug == chapter_slug))
            .and_then(|c| c.steps.iter().find(|s| s.slug == step_slug))
            .map(|s| s.id)
        else {
            return Ok(false);
        };
        drop(bundle);

        let mut state = self.state.write().await;
        if let Some(meta) = state.step_meta.get_mut(&step_id) {
            meta.takedown_reason = None;
            meta.takedown_at = None;
            meta.takedown_by = None;
            self.persist_state(&state);
            return Ok(true);
        }
        Ok(false)
    }

    async fn upsert_local_account(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto> {
        let clean_username = username.trim();
        if clean_username.is_empty() {
            return Err(domain_err(
                ErrorCode::InvalidUsername,
                "Username cannot be empty.",
            ));
        }
        let clean_display = if display_name.trim().is_empty() {
            clean_username
        } else {
            display_name.trim()
        };
        let clean_email = if email.trim().is_empty() {
            format!("{clean_username}@localhost")
        } else {
            email.trim().to_string()
        };
        let pw_hash = hash_password(clean_username, password);
        let now = Utc::now();

        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        let user_profile = if let Some(existing) = state
            .users
            .iter_mut()
            .find(|u| u.profile.username.eq_ignore_ascii_case(clean_username))
        {
            existing.profile.display_name = clean_display.to_string();
            existing.profile.email = clean_email;
            existing.profile.role = role;
            existing.profile.is_banned = false;
            existing.profile.ban_reason.clear();
            existing.password_hash = Some(pw_hash);
            let uid = existing.profile.id;
            let prof = Self::resolve_user_dto(existing, &grav);
            state.sessions.retain(|s| s.user_id != uid);
            prof
        } else {
            let prof = UserProfileDto {
                id: Uuid::new_v4(),
                wp_user_id: None,
                username: clean_username.to_string(),
                display_name: clean_display.to_string(),
                email: clean_email,
                avatar_url: String::new(),
                avatar_source: "default".to_string(),
                oauth_avatar_url: String::new(),
                uploaded_avatar_url: String::new(),
                oauth_provider: None,
                oauth_bindings: Vec::new(),
                has_password: true,
                bio: String::new(),
                role,
                has_collaborations: false,
                auth_source: "local".to_string(),
                is_banned: false,
                ban_reason: String::new(),
                last_login_at: now,
            }
            .with_resolved_avatar(&grav);
            state.users.push(StoredUserRecord {
                profile: prof.clone(),
                password_hash: Some(pw_hash),
                oauth_provider: None,
                oauth_sub: None,
                oauth_bindings: Vec::new(),
            });
            prof
        };

        self.persist_state(&state);
        Ok(user_profile)
    }

    async fn admin_create_user(
        &self,
        username: &str,
        display_name: &str,
        email: &str,
        role: UserRole,
        password: &str,
    ) -> Result<UserProfileDto> {
        let clean_username = username.trim();
        let clean_email = email.trim();
        let mut state = self.state.write().await;
        if state
            .users
            .iter()
            .any(|u| u.profile.username.eq_ignore_ascii_case(clean_username))
        {
            return Err(domain_err(
                ErrorCode::UsernameTaken,
                "Username is already taken.",
            ));
        }
        if !clean_email.is_empty()
            && state
                .users
                .iter()
                .any(|u| u.profile.email.eq_ignore_ascii_case(clean_email))
        {
            return Err(domain_err(
                ErrorCode::EmailTaken,
                "Email address is already in use.",
            ));
        }
        let grav = Self::gravatar_base(&state).to_string();
        let eff_email = if clean_email.is_empty() {
            format!("{clean_username}@localhost")
        } else {
            clean_email.to_string()
        };
        let eff_display = if display_name.trim().is_empty() {
            clean_username.to_string()
        } else {
            display_name.trim().to_string()
        };
        let pw_hash = hash_password(clean_username, password);
        let prof = UserProfileDto {
            id: Uuid::new_v4(),
            wp_user_id: None,
            username: clean_username.to_string(),
            display_name: eff_display,
            email: eff_email,
            avatar_url: String::new(),
            avatar_source: "default".to_string(),
            oauth_avatar_url: String::new(),
            uploaded_avatar_url: String::new(),
            oauth_provider: None,
            oauth_bindings: Vec::new(),
            has_password: true,
            bio: String::new(),
            role,
            has_collaborations: false,
            auth_source: "local".to_string(),
            is_banned: false,
            ban_reason: String::new(),
            last_login_at: Utc::now(),
        }
        .with_resolved_avatar(&grav);

        state.users.push(StoredUserRecord {
            profile: prof.clone(),
            password_hash: Some(pw_hash),
            oauth_provider: None,
            oauth_sub: None,
            oauth_bindings: Vec::new(),
        });
        self.persist_state(&state);
        Ok(prof)
    }

    async fn admin_list_users(&self) -> Result<Vec<UserProfileDto>> {
        let state = self.state.read().await;
        let grav = Self::gravatar_base(&state);
        Ok(state
            .users
            .iter()
            .map(|u| Self::resolve_user_dto(u, grav))
            .collect())
    }

    async fn admin_update_user_role(
        &self,
        target_user_id: Uuid,
        new_role: UserRole,
    ) -> Result<Option<UserProfileDto>> {
        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        let mut updated = None;
        if let Some(rec) = state
            .users
            .iter_mut()
            .find(|u| u.profile.id == target_user_id)
        {
            rec.profile.role = new_role;
            updated = Some(Self::resolve_user_dto(rec, &grav));
        }
        if updated.is_some() {
            self.persist_state(&state);
        }
        Ok(updated)
    }

    async fn admin_set_user_ban(
        &self,
        target_user_id: Uuid,
        banned: bool,
        reason: &str,
    ) -> Result<Option<UserProfileDto>> {
        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        let mut updated = None;
        if let Some(rec) = state
            .users
            .iter_mut()
            .find(|u| u.profile.id == target_user_id)
        {
            rec.profile.is_banned = banned;
            rec.profile.ban_reason = if banned {
                reason.trim().chars().take(240).collect()
            } else {
                String::new()
            };
            updated = Some(Self::resolve_user_dto(rec, &grav));
        }
        if banned {
            state.sessions.retain(|s| s.user_id != target_user_id);
        }
        if updated.is_some() {
            self.persist_state(&state);
        }
        Ok(updated)
    }

    async fn admin_delete_user(&self, target_user_id: Uuid) -> Result<bool> {
        let mut state = self.state.write().await;
        let before = state.users.len();
        state.users.retain(|u| u.profile.id != target_user_id);
        let removed = state.users.len() < before;
        if removed {
            state.sessions.retain(|s| s.user_id != target_user_id);
            state.password_resets.retain(|r| r.user_id != target_user_id);
            state.passkeys.retain(|pk| pk.user_id != target_user_id);
            for meta in state.step_meta.values_mut() {
                if meta.owner_user_id == Some(target_user_id) {
                    meta.owner_user_id = None;
                }
                meta.collaborator_ids.retain(|id| *id != target_user_id);
            }
            self.persist_state(&state);
        }
        Ok(removed)
    }

    async fn admin_reset_user_password(
        &self,
        target_user_id: Uuid,
        new_password: &str,
    ) -> Result<Option<UserProfileDto>> {
        let mut state = self.state.write().await;
        let grav = Self::gravatar_base(&state).to_string();
        let mut updated = None;
        if let Some(rec) = state
            .users
            .iter_mut()
            .find(|u| u.profile.id == target_user_id)
        {
            rec.password_hash = Some(hash_password(&rec.profile.username, new_password));
            updated = Some(Self::resolve_user_dto(rec, &grav));
        }
        if updated.is_some() {
            state.sessions.retain(|s| s.user_id != target_user_id);
            self.persist_state(&state);
        }
        Ok(updated)
    }

    async fn get_site_settings(&self, fallback: &SiteSettingsDto) -> Result<SiteSettingsDto> {
        let state = self.state.read().await;
        Ok(state
            .site_settings
            .clone()
            .unwrap_or_else(|| fallback.clone()))
    }

    async fn update_site_settings(
        &self,
        _updated_by: Uuid,
        settings: SiteSettingsDto,
    ) -> Result<SiteSettingsDto> {
        let clean = settings.sanitize()?;
        let mut state = self.state.write().await;
        state.site_settings = Some(clean.clone());
        self.persist_state(&state);
        Ok(clean)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reports_revision_drift_only_on_outdated_non_fallback_translations() {
        let root = std::env::temp_dir().join(format!("ihn_drift_test_{}", Uuid::new_v4()));
        let ch_dir = root.join("track-a").join("01-ch");
        fs::create_dir_all(&ch_dir).unwrap();

        fs::write(
            root.join("track-a").join("track.toml"),
            r#"slug = "track-a"
difficulty = "beginner"
[translations.zh-CN]
title = "Track A"
subtitle = "Sub"
description = "Desc"
[[chapters]]
slug = "01-ch"
number = 1
[chapters.titles]
zh-CN = "Ch 1"
"#,
        )
        .unwrap();

        fs::write(
            ch_dir.join("01-step.zh-CN.md"),
            "+++\ntitle = \"中文标题\"\nsummary = \"摘要\"\nstep_number = 1\nsynced_revision = 2\ncanonical_revision = 2\nstatus = \"published\"\n+++\n\n正文\n",
        )
        .unwrap();
        fs::write(
            ch_dir.join("01-step.en.md"),
            "+++\ntitle = \"English & Title\"\nsummary = \"Sum\"\nstep_number = 1\nsynced_revision = 1\ncanonical_revision = 2\nstatus = \"published\"\n+++\n\nBody\n",
        )
        .unwrap();

        let store_path = root.join("store.json");
        let repo = LocalSeedRepository::from_content_dir(&root, store_path).unwrap();

        let en_detail = repo
            .get_step_detail("en", "track-a", "01-ch", "01-step")
            .await
            .unwrap()
            .unwrap();
        assert!(!en_detail.is_fallback);
        assert_eq!(en_detail.synced_revision, 1);
        assert_eq!(en_detail.canonical_revision, 2);
        assert!(en_detail.has_revision_drift);
        assert!(en_detail.chapters[0].steps[0].has_revision_drift);

        let zh_detail = repo
            .get_step_detail("zh-CN", "track-a", "01-ch", "01-step")
            .await
            .unwrap()
            .unwrap();
        assert!(!zh_detail.is_fallback);
        assert!(!zh_detail.has_revision_drift);

        let ja_fallback = repo
            .get_step_detail("ja", "track-a", "01-ch", "01-step")
            .await
            .unwrap()
            .unwrap();
        assert!(ja_fallback.is_fallback);
        assert!(!ja_fallback.has_revision_drift);

        let _ = fs::remove_dir_all(&root);
    }
}
