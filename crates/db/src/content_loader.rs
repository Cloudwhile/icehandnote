use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use icehandnote_core::{compile_notebook_markdown, CompiledDocument};
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

pub fn load_content_directory(content_root: &Path) -> Result<ContentBundle> {
    let mut bundle = ContentBundle::default();
    if !content_root.exists() {
        return Ok(bundle);
    }

    let mut track_dirs: Vec<_> = fs::read_dir(content_root)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    track_dirs.sort_by_key(|e| e.file_name());

    for entry in track_dirs {
        let track_dir = entry.path();
        let manifest_path = track_dir.join("track.toml");
        if !manifest_path.exists() {
            continue;
        }
        let manifest_str = fs::read_to_string(&manifest_path)
            .with_context(|| format!("reading {}", manifest_path.display()))?;
        let manifest: TrackManifest = toml::from_str(&manifest_str)
            .with_context(|| format!("parsing {}", manifest_path.display()))?;

        let track_id = deterministic_uuid(&format!("track:{}", manifest.slug));
        let mut chapters = Vec::new();

        for ch_meta in &manifest.chapters {
            let ch_id = deterministic_uuid(&format!("chapter:{}:{}", manifest.slug, ch_meta.slug));
            let ch_dir = track_dir.join(&ch_meta.slug);
            let mut step_files_by_slug: BTreeMap<String, BTreeMap<String, (String, DateTime<Utc>)>> =
                BTreeMap::new();

            if ch_dir.exists() {
                for f_entry in fs::read_dir(&ch_dir)?.flatten() {
                    let p = f_entry.path();
                    if !p.is_file() {
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
                    let raw_md = fs::read_to_string(&p)?;
                    let mtime = fs::metadata(&p)
                        .and_then(|m| m.modified())
                        .map(DateTime::<Utc>::from)
                        .unwrap_or_else(|_| Utc::now());

                    step_files_by_slug
                        .entry(step_slug)
                        .or_default()
                        .insert(locale, (raw_md, mtime));
                }
            }

            let mut loaded_steps = Vec::new();
            for (step_slug, locale_map) in step_files_by_slug {
                let mut translations = BTreeMap::new();
                let mut canonical_rev = 1;
                let mut step_num = 1;
                let mut est_mins = 10;

                for (loc, (raw_md, updated_at)) in locale_map {
                    let compiled = compile_notebook_markdown(&raw_md);
                    if loc == "zh-CN" || canonical_rev == 1 {
                        step_num = compiled.frontmatter.step_number;
                        est_mins = compiled.frontmatter.estimated_minutes;
                    }
                    if let Some(c_rev) = compiled.frontmatter.canonical_revision {
                        canonical_rev = canonical_rev.max(c_rev);
                    }
                    canonical_rev = canonical_rev.max(compiled.frontmatter.synced_revision);

                    translations.insert(
                        loc.clone(),
                        LoadedStepTranslation {
                            locale: loc,
                            raw_markdown: raw_md,
                            compiled,
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

                let step_id = deterministic_uuid(&format!(
                    "step:{}:{}:{}",
                    manifest.slug, ch_meta.slug, step_slug
                ));
                let initial_likes = (12 + (step_num as i64 * 7)) % 65 + 8;

                loaded_steps.push(LoadedStep {
                    id: step_id,
                    slug: step_slug,
                    step_number: step_num,
                    default_locale,
                    canonical_revision: canonical_rev,
                    estimated_minutes: est_mins,
                    initial_likes,
                    translations,
                });
            }

            loaded_steps.sort_by_key(|s| (s.step_number, s.slug.clone()));

            chapters.push(LoadedChapter {
                id: ch_id,
                slug: ch_meta.slug.clone(),
                number: ch_meta.number,
                titles: ch_meta.titles.clone(),
                steps: loaded_steps,
            });
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
