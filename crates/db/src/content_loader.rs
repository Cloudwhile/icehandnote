use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use icehandnote_core::{compile_notebook_markdown, parse_flexible_utc, CompiledDocument};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

const CONTENT_UUID_NS: Uuid = Uuid::from_bytes([
    0x69, 0x63, 0x65, 0x74, 0x6f, 0x77, 0x6e, 0x65, 0x5f, 0x73, 0x74, 0x65, 0x70, 0x5f, 0x76, 0x31,
]);

pub fn deterministic_uuid(name: &str) -> Uuid {
    Uuid::new_v5(&CONTENT_UUID_NS, name.as_bytes())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrackManifest {
    pub slug: String,
    pub difficulty: String,
    #[serde(default = "default_icon")]
    pub icon_kind: String,
    #[serde(default)]
    pub sort_order: i32,
    #[serde(default)]
    pub tags: Vec<String>,
    pub translations: BTreeMap<String, TrackLocaleMeta>,
    #[serde(default)]
    pub chapters: Vec<ChapterManifest>,
}

fn default_icon() -> String {
    "snowflake".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrackLocaleMeta {
    pub title: String,
    pub subtitle: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChapterManifest {
    pub slug: String,
    pub number: i32,
    pub titles: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct LoadedStepTranslation {
    pub locale: String,
    pub raw_markdown: String,
    pub compiled: CompiledDocument,
    pub published_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct LoadedStep {
    pub id: Uuid,
    pub slug: String,
    pub step_number: i32,
    pub default_locale: String,
    pub canonical_revision: i32,
    pub estimated_minutes: i32,
    pub initial_likes: i64,
    pub translations: BTreeMap<String, LoadedStepTranslation>,
}

#[derive(Debug, Clone)]
pub struct LoadedChapter {
    pub id: Uuid,
    pub slug: String,
    pub number: i32,
    pub titles: BTreeMap<String, String>,
    pub steps: Vec<LoadedStep>,
}

#[derive(Debug, Clone)]
pub struct LoadedTrack {
    pub id: Uuid,
    pub manifest: TrackManifest,
    pub chapters: Vec<LoadedChapter>,
}

#[derive(Debug, Clone, Default)]
pub struct ContentBundle {
    pub tracks: Vec<LoadedTrack>,
}

type StepFileMap = BTreeMap<String, BTreeMap<String, (String, DateTime<Utc>, DateTime<Utc>)>>;

fn load_steps_from_dir(
    track_slug: &str,
    ch_slug: &str,
    dir: &Path,
) -> Result<Vec<LoadedStep>> {
    let mut step_files_by_slug: StepFileMap = BTreeMap::new();

    if dir.exists() {
        if crate::is_symlink_path(dir) {
            anyhow::bail!("Refusing symlink chapter directory: {}", dir.display());
        }
        for f_entry in fs::read_dir(dir)?.flatten() {
            let p = f_entry.path();
            if crate::is_symlink_path(&p)
                || !p.is_file()
                || crate::ensure_within_dir(dir, &p).is_err()
            {
                continue;
            }
            let Some(fname) = p.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if !fname.ends_with(".md") {
                continue;
            }
            // Expected filename: `{step_slug}.{locale}.md`, e.g., `01-setup.zh-CN.md`
            let without_md = &fname[..fname.len() - 3];
            let Some(dot_idx) = without_md.rfind('.') else {
                continue;
            };
            let step_slug = without_md[..dot_idx].to_string();
            let locale = without_md[dot_idx + 1..].to_string();
            if !crate::is_valid_step_slug_segment(&step_slug)
                || !crate::is_supported_locale_code(&locale)
            {
                continue;
            }
            let raw_md = fs::read_to_string(&p)?;
            let meta = fs::metadata(&p).ok();
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now);
            let ctime = meta
                .as_ref()
                .and_then(|m| m.created().ok())
                .map(DateTime::<Utc>::from)
                .unwrap_or(mtime);

            step_files_by_slug
                .entry(step_slug)
                .or_default()
                .insert(locale, (raw_md, ctime, mtime));
        }
    }

    let mut loaded_steps = Vec::new();
    for (step_slug, locale_map) in step_files_by_slug {
        let mut translations = BTreeMap::new();
        let mut canonical_rev = 1;

        for (loc, (raw_md, ctime, mtime)) in locale_map {
            let compiled = compile_notebook_markdown(&raw_md);
            if let Some(c_rev) = compiled.frontmatter.canonical_revision {
                canonical_rev = canonical_rev.max(c_rev);
            }
            canonical_rev = canonical_rev.max(compiled.frontmatter.synced_revision);

            let updated_at = compiled
                .frontmatter
                .updated_at
                .as_deref()
                .and_then(parse_flexible_utc)
                .unwrap_or(mtime);
            let published_at = compiled
                .frontmatter
                .published_at
                .as_deref()
                .and_then(parse_flexible_utc)
                .unwrap_or_else(|| ctime.min(updated_at));

            translations.insert(
                loc.clone(),
                LoadedStepTranslation {
                    locale: loc,
                    raw_markdown: raw_md,
                    compiled,
                    published_at,
                    updated_at,
                },
            );
        }

        let default_locale = if translations.contains_key("zh-CN") {
            "zh-CN".to_string()
        } else if translations.contains_key("en") {
            "en".to_string()
        } else if translations.contains_key("zh-TW") {
            "zh-TW".to_string()
        } else {
            translations
                .keys()
                .next()
                .cloned()
                .unwrap_or_else(|| "zh-CN".to_string())
        };

        let meta_tr = translations
            .get(&default_locale)
            .or_else(|| translations.values().next());
        let step_num = meta_tr
            .map(|t| t.compiled.frontmatter.step_number)
            .unwrap_or(1);
        let est_mins = meta_tr
            .map(|t| t.compiled.frontmatter.estimated_minutes)
            .unwrap_or(10);

        let step_id = translations
            .get(&default_locale)
            .and_then(|t| t.compiled.frontmatter.step_id)
            .or_else(|| translations.values().find_map(|t| t.compiled.frontmatter.step_id))
            .unwrap_or_else(|| deterministic_uuid(&format!("step:{track_slug}:{ch_slug}:{step_slug}")));
        loaded_steps.push(LoadedStep {
            id: step_id,
            slug: step_slug,
            step_number: step_num,
            default_locale,
            canonical_revision: canonical_rev,
            estimated_minutes: est_mins,
            initial_likes: 0,
            translations,
        });
    }

    loaded_steps.sort_by_key(|s| (s.step_number, s.slug.clone()));
    Ok(loaded_steps)
}

pub fn load_content_directory(content_root: &Path) -> Result<ContentBundle> {
    let mut bundle = ContentBundle::default();
    if !content_root.exists() {
        return Ok(bundle);
    }
    if crate::is_symlink_path(content_root) {
        anyhow::bail!(
            "Refusing symlink content directory: {}",
            content_root.display()
        );
    }

    let mut track_dirs: Vec<_> = fs::read_dir(content_root)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            !crate::is_symlink_path(&p)
                && p.is_dir()
                && crate::ensure_within_dir(content_root, &p).is_ok()
        })
        .collect();
    track_dirs.sort_by_key(|e| e.file_name());

    for entry in track_dirs {
        let track_dir = entry.path();
        let manifest_path = track_dir.join("track.toml");
        if !manifest_path.exists()
            || crate::is_symlink_path(&manifest_path)
            || crate::ensure_within_dir(&track_dir, &manifest_path).is_err()
        {
            continue;
        }
        let manifest_str = fs::read_to_string(&manifest_path)
            .with_context(|| format!("reading {}", manifest_path.display()))?;
        let manifest: TrackManifest = toml::from_str(&manifest_str)
            .with_context(|| format!("parsing {}", manifest_path.display()))?;
        if !crate::is_valid_slug_segment(&manifest.slug) {
            anyhow::bail!(
                "Invalid track slug '{}' in {}",
                manifest.slug,
                manifest_path.display()
            );
        }

        let track_id = deterministic_uuid(&format!("track:{}", manifest.slug));
        let mut chapters = Vec::new();

        for ch_meta in &manifest.chapters {
            if !crate::is_valid_slug_segment(&ch_meta.slug) {
                anyhow::bail!(
                    "Invalid chapter slug '{}' in {}",
                    ch_meta.slug,
                    manifest_path.display()
                );
            }
            let ch_id = deterministic_uuid(&format!("chapter:{}:{}", manifest.slug, ch_meta.slug));
            let ch_dir = track_dir.join(&ch_meta.slug);
            crate::ensure_within_dir(&track_dir, &ch_dir)?;
            let loaded_steps = load_steps_from_dir(&manifest.slug, &ch_meta.slug, &ch_dir)?;

            chapters.push(LoadedChapter {
                id: ch_id,
                slug: ch_meta.slug.clone(),
                number: ch_meta.number,
                titles: ch_meta.titles.clone(),
                steps: loaded_steps,
            });
        }

        // Also support 2-level flat `{step}.{locale}.md` directly inside `track_dir`
        let root_steps = load_steps_from_dir(&manifest.slug, "chapters", &track_dir)?;
        if !root_steps.is_empty() {
            if let Some(first_ch) = chapters.first_mut() {
                for st in root_steps {
                    if !first_ch.steps.iter().any(|existing| existing.slug == st.slug) {
                        first_ch.steps.push(st);
                    }
                }
                first_ch
                    .steps
                    .sort_by_key(|s| (s.step_number, s.slug.clone()));
            } else {
                let mut titles = BTreeMap::new();
                for (loc, meta) in &manifest.translations {
                    titles.insert(loc.clone(), meta.title.clone());
                }
                chapters.push(LoadedChapter {
                    id: deterministic_uuid(&format!("chapter:{}:chapters", manifest.slug)),
                    slug: "chapters".to_string(),
                    number: 1,
                    titles,
                    steps: root_steps,
                });
            }
        }

        chapters.sort_by_key(|c| c.number);
        bundle.tracks.push(LoadedTrack {
            id: track_id,
            manifest,
            chapters,
        });
    }

    bundle.tracks.sort_by_key(|t| t.manifest.sort_order);
    Ok(bundle)
}
