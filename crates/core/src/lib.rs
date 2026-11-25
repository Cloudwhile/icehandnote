pub mod auth;
pub mod crypto;
pub mod error;
pub mod mail_templates;
pub mod reading_time;
pub mod settings;
pub mod webauthn;

pub use crypto::generate_uuid_v7;

use ammonia::Builder as HtmlSanitizer;
use chrono::{DateTime, Utc};
use pulldown_cmark::{html, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub const SUPPORTED_LOCALES: &[(&str, &str)] = &[
    ("zh-CN", "简体中文"),
    ("en", "English"),
    ("zh-TW", "繁體中文"),
    ("ja", "日本語"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertKind {
    Tip,
    Note,
    Info,
    Idea,
    Question,
    Check,
    Bookmark,
    Warning,
    Danger,
}

impl AlertKind {
    pub fn from_directive(tag: &str) -> Option<Self> {
        match tag.trim().to_ascii_lowercase().as_str() {
            "tip" => Some(Self::Tip),
            "note" | "sticker" => Some(Self::Note),
            "info" => Some(Self::Info),
            "idea" | "spark" => Some(Self::Idea),
            "question" | "ask" | "qa" => Some(Self::Question),
            "check" | "done" | "summary" => Some(Self::Check),
            "bookmark" | "mark" | "ref" => Some(Self::Bookmark),
            "warning" | "warn" => Some(Self::Warning),
            "danger" | "error" => Some(Self::Danger),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SketchNode {
    pub id: String,
    pub label: String,
    pub sublabel: Option<String>,
    pub x: f32,
    pub y: f32,
    pub width: Option<f32>,
    pub height: Option<f32>,
    /// "violet" | "ice" | "amber" | "coral" | "paper"
    #[serde(default = "default_sketch_tone")]
    pub tone: String,
}

fn default_sketch_tone() -> String {
    "violet".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SketchEdge {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SketchSpec {
    pub nodes: Vec<SketchNode>,
    pub edges: Vec<SketchEdge>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TaskScope {
    /// Section-level milestone task (`节任务`)
    #[default]
    Section,
    /// Paragraph-level lightweight inline task (`段任务`)
    Paragraph,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepTaskItem {
    pub item_id: String,
    pub title_html: String,
    pub detail_html: Option<String>,
    #[serde(default)]
    pub default_checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotebookBlock {
    Heading {
        block_id: String,
        level: u8,
        number: String,
        text: String,
        /// When true, the entire section under this heading is a checkable task milestone (`节任务`)
        #[serde(default)]
        is_task: bool,
        #[serde(default)]
        default_checked: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        align: Option<String>,
    },
    Paragraph {
        block_id: String,
        html: String,
        margin_note: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        align: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        size: Option<String>,
    },
    Alert {
        block_id: String,
        kind: AlertKind,
        title: String,
        body_html: String,
        detail_summary: Option<String>,
        detail_html: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tone: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        badge: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        align: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        size: Option<String>,
    },
    CodeCard {
        block_id: String,
        language: String,
        filename: Option<String>,
        code: String,
        margin_note: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<String>,
    },
    RoughDiagram {
        block_id: String,
        caption: Option<String>,
        spec: SketchSpec,
    },
    List {
        block_id: String,
        ordered: bool,
        items_html: Vec<String>,
    },
    Steps {
        block_id: String,
        title: String,
        #[serde(default)]
        scope: TaskScope,
        items: Vec<StepTaskItem>,
    },
    Quote {
        block_id: String,
        html: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        align: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        size: Option<String>,
    },
    Image {
        block_id: String,
        src: String,
        alt: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        margin_note: Option<String>,
    },
    /// Embedded die-cut pixel-art sticker illustration inside article content
    #[serde(rename = "pixel_sticker")]
    PixelSticker {
        block_id: String,
        sprite: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        align: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        size: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        x: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        y: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rotate: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scale: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flip: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        locked: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        layer: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TocItem {
    pub id: String,
    pub level: u8,
    pub number: String,
    pub text: String,
    #[serde(default)]
    pub is_task: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StepFrontmatter {
    #[serde(default)]
    pub step_id: Option<Uuid>,
    pub title: String,
    pub summary: String,
    #[serde(default = "default_step_num")]
    pub step_number: i32,
    #[serde(default = "default_minutes")]
    pub estimated_minutes: i32,
    #[serde(default = "default_rev")]
    pub synced_revision: i32,
    #[serde(default)]
    pub canonical_revision: Option<i32>,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub author: String,
    #[serde(default, alias = "cover_image", alias = "banner")]
    pub cover: String,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Parse an RFC 3339 timestamp or `YYYY-MM-DD` calendar date string into UTC `DateTime<Utc>`.
pub fn parse_flexible_utc(raw: &str) -> Option<DateTime<Utc>> {
    let clean = raw.trim();
    if clean.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(clean) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(clean, "%Y-%m-%d") {
        return date
            .and_hms_opt(0, 0, 0)
            .map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc));
    }
    None
}

/// Normalize Creative Commons / copyright license identifiers into canonical slugs.
/// Returns `""` when empty or unrecognized (meaning: inherit site-wide default license).
pub fn normalize_license_code(raw: &str) -> String {
    let cleaned = raw
        .trim()
        .to_ascii_lowercase()
        .replace(['_', ' '], "-");
    match cleaned.as_str() {
        "" | "default" | "site-default" => String::new(),
        "cc-by-4.0" | "cc-by" | "by" | "by-4.0" => "cc-by-4.0".to_string(),
        "cc-by-sa-4.0" | "cc-by-sa" | "by-sa" | "by-sa-4.0" => "cc-by-sa-4.0".to_string(),
        "cc-by-nc-4.0" | "cc-by-nc" | "by-nc" | "by-nc-4.0" => "cc-by-nc-4.0".to_string(),
        "cc-by-nc-sa-4.0" | "cc-by-nc-sa" | "by-nc-sa" | "by-nc-sa-4.0" => {
            "cc-by-nc-sa-4.0".to_string()
        }
        "cc-by-nd-4.0" | "cc-by-nd" | "by-nd" | "by-nd-4.0" => "cc-by-nd-4.0".to_string(),
        "cc-by-nc-nd-4.0" | "cc-by-nc-nd" | "by-nc-nd" | "by-nc-nd-4.0" => {
            "cc-by-nc-nd-4.0".to_string()
        }
        "cc0-1.0" | "cc0" | "public-domain" | "zero" => "cc0-1.0".to_string(),
        "all-rights-reserved" | "copyright" | "arr" => "all-rights-reserved".to_string(),
        "none" | "hidden" => "none".to_string(),
        _ => String::new(),
    }
}

fn default_status() -> String {
    "published".to_string()
}

fn default_step_num() -> i32 {
    1
}
fn default_minutes() -> i32 {
    8
}
fn default_rev() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledDocument {
    pub frontmatter: StepFrontmatter,
    pub blocks: Vec<NotebookBlock>,
    pub toc: Vec<TocItem>,
    pub plain_text: String,
    pub compiled_html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocaleInfo {
    pub code: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackArticleCardDto {
    pub step_id: Uuid,
    pub chapter_slug: String,
    #[serde(default)]
    pub chapter_title: String,
    pub step_slug: String,
    pub step_number: i32,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub cover_image: String,
    pub estimated_minutes: i32,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub author_name: String,
    #[serde(default = "Utc::now")]
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackSummaryDto {
    pub id: Uuid,
    pub slug: String,
    pub difficulty: String,
    pub icon_kind: String,
    pub title: String,
    pub subtitle: String,
    pub description: String,
    pub tags: Vec<String>,
    pub chapter_count: usize,
    pub step_count: usize,
    pub first_chapter_slug: String,
    pub first_step_slug: String,
    #[serde(default)]
    pub articles: Vec<TrackArticleCardDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterNavDto {
    pub slug: String,
    pub number: i32,
    pub title: String,
    pub steps: Vec<StepNavItemDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepNavItemDto {
    pub id: Uuid,
    pub slug: String,
    pub step_number: i32,
    pub title: String,
    pub estimated_minutes: i32,
    pub has_requested_locale: bool,
    pub has_revision_drift: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepNeighborDto {
    pub chapter_slug: String,
    pub step_slug: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepDetailDto {
    pub step_id: Uuid,
    pub track_slug: String,
    pub track_title: String,
    #[serde(default)]
    pub track_icon_kind: String,
    pub chapter_slug: String,
    pub chapter_title: String,
    pub step_slug: String,
    pub step_number: i32,
    pub total_steps_in_track: usize,
    pub requested_locale: String,
    pub resolved_locale: String,
    pub is_fallback: bool,
    pub available_locales: Vec<String>,
    pub canonical_revision: i32,
    pub synced_revision: i32,
    #[serde(default = "default_rev")]
    pub version: i32,
    pub has_revision_drift: bool,
    pub estimated_minutes: i32,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub cover_image: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub author_name: String,
    #[serde(default)]
    pub authors: Vec<auth::ArticleAuthorDto>,
    pub tags: Vec<String>,
    pub blocks: Vec<NotebookBlock>,
    pub toc: Vec<TocItem>,
    pub chapters: Vec<ChapterNavDto>,
    pub prev_step: Option<StepNeighborDto>,
    pub next_step: Option<StepNeighborDto>,
    pub likes_count: i64,
    #[serde(default = "Utc::now")]
    pub published_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHitDto {
    pub track_slug: String,
    pub track_title: String,
    pub chapter_slug: String,
    pub step_slug: String,
    pub locale: String,
    pub title: String,
    pub snippet_html: String,
    pub tags: Vec<String>,
}

pub const MAX_NOTE_CHARS: usize = 2000;

/// W3C Web Annotation Data Model (`REC-annotation-model-20170223`) Selector variants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AnnotationSelector {
    FragmentSelector {
        #[serde(rename = "conformsTo", default = "default_fragment_conforms_to")]
        conforms_to: String,
        value: String,
    },
    TextQuoteSelector {
        exact: String,
        #[serde(default)]
        prefix: String,
        #[serde(default)]
        suffix: String,
    },
    TextPositionSelector {
        start: usize,
        end: usize,
    },
}

fn default_fragment_conforms_to() -> String {
    "https://icehandnote.dev/spec/block-id".to_string()
}

/// W3C Web Annotation SpecificResource target binding a note to both a stable block anchor
/// and fuzzy text quote context so notes survive upstream edits without disappearing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct AnnotationTarget {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_revision: i32,
    #[serde(default)]
    pub selector: Vec<AnnotationSelector>,
}

fn default_note_tone() -> String {
    "amber".to_string()
}

fn default_note_style() -> String {
    "tape".to_string()
}

fn default_note_tag() -> String {
    "note".to_string()
}

fn default_note_motivation() -> String {
    "commenting".to_string()
}

fn default_note_body_format() -> String {
    "text/markdown".to_string()
}

fn default_note_version() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMarginNoteDto {
    pub id: Uuid,
    pub learner_id: String,
    pub step_id: Uuid,
    pub locale_code: String,
    pub block_anchor_id: String,
    /// Legacy combined `"<tone>:<style>:<tag>"` string kept synchronized for backwards compatibility.
    pub note_color: String,
    #[serde(default = "default_note_tone")]
    pub tone: String,
    #[serde(default = "default_note_style")]
    pub style: String,
    #[serde(default = "default_note_tag")]
    pub tag: String,
    #[serde(default = "default_note_motivation")]
    pub motivation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<AnnotationTarget>,
    #[serde(default = "default_note_body_format")]
    pub body_format: String,
    pub content_html: String,
    pub raw_content: String,
    #[serde(default = "default_note_version")]
    pub version: i32,
    pub created_at: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<DateTime<Utc>>,
    // Cross-article navigation metadata populated for "My Notes" global queries & export
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_title: Option<String>,
}

impl UserMarginNoteDto {
    /// Strong RFC 9110 ETag tied to note identity and monotonically increasing version.
    pub fn etag(&self) -> String {
        format!("\"ann-{}-v{}\"", self.id.simple(), self.version.max(1))
    }

    /// Backfill orthogonal `tone`/`style`/`tag` and `updated_at` when loading legacy records.
    pub fn hydrate_legacy_fields(&mut self) {
        let (ltone, lstyle, ltag) = normalize_note_visuals(
            Some(&self.tone),
            Some(&self.style),
            Some(&self.tag),
            Some(&self.note_color),
        );
        self.tone = ltone;
        self.style = lstyle;
        self.tag = ltag;
        self.note_color = format!("{}:{}:{}", self.tone, self.style, self.tag);
        if self.version < 1 {
            self.version = 1;
        }
        if self.motivation.trim().is_empty() {
            self.motivation = default_note_motivation();
        }
        if self.body_format.trim().is_empty() {
            self.body_format = default_note_body_format();
        }
    }
}

pub fn normalize_note_tone(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "amber" | "yellow" => Some("amber"),
        "violet" | "purple" => Some("violet"),
        "ice" | "blue" => Some("ice"),
        "mint" | "green" => Some("mint"),
        "coral" | "pink" | "rose" => Some("coral"),
        "paper" | "neutral" | "gray" => Some("paper"),
        _ => None,
    }
}

pub fn normalize_note_style(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "tape" => Some("tape"),
        "pin" => Some("pin"),
        "torn" => Some("torn"),
        "clip" => Some("clip"),
        "stamp" => Some("stamp"),
        "tag" => Some("tag"),
        "looseleaf" => Some("looseleaf"),
        _ => None,
    }
}

pub fn normalize_note_tag(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "note" => Some("note"),
        "idea" => Some("idea"),
        "ask" => Some("ask"),
        "star" => Some("star"),
        "todo" => Some("todo"),
        _ => None,
    }
}

pub fn normalize_note_motivation(raw: Option<&str>, tag: &str) -> String {
    if let Some(m) = raw {
        match m.trim().to_ascii_lowercase().as_str() {
            "commenting" => return "commenting".to_string(),
            "highlighting" => return "highlighting".to_string(),
            "questioning" => return "questioning".to_string(),
            "bookmarking" => return "bookmarking".to_string(),
            _ => {}
        }
    }
    match tag {
        "ask" => "questioning".to_string(),
        "star" => "bookmarking".to_string(),
        _ => "commenting".to_string(),
    }
}

/// Normalize `(tone, style, tag)` from explicit fields or legacy `"<tone>:<style>:<tag>"` encoding.
pub fn normalize_note_visuals(
    tone: Option<&str>,
    style: Option<&str>,
    tag: Option<&str>,
    legacy_color: Option<&str>,
) -> (String, String, String) {
    let mut legacy_parts = legacy_color
        .unwrap_or("")
        .split(':')
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let l_tone = legacy_parts.next().and_then(normalize_note_tone);
    let l_style = legacy_parts.next().and_then(normalize_note_style);
    let l_tag = legacy_parts.next().and_then(normalize_note_tag);

    let resolved_tone = tone
        .and_then(normalize_note_tone)
        .or(l_tone)
        .unwrap_or("amber");
    let resolved_style = style
        .and_then(normalize_note_style)
        .or(l_style)
        .unwrap_or("tape");
    let resolved_tag = tag
        .and_then(normalize_note_tag)
        .or(l_tag)
        .unwrap_or("note");

    (
        resolved_tone.to_string(),
        resolved_style.to_string(),
        resolved_tag.to_string(),
    )
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMarginNoteInput {
    #[serde(default)]
    pub learner_id: String,
    pub step_id: Uuid,
    pub locale_code: String,
    pub block_anchor_id: String,
    #[serde(default)]
    pub note_color: String,
    #[serde(default)]
    pub tone: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub motivation: Option<String>,
    #[serde(default)]
    pub target: Option<AnnotationTarget>,
    pub content: String,
}

/// RFC 7396 JSON Merge Patch payload for partial updates to an existing annotation/note.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateMarginNoteInput {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub note_color: Option<String>,
    #[serde(default)]
    pub tone: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub motivation: Option<String>,
    #[serde(default)]
    pub block_anchor_id: Option<String>,
    #[serde(default)]
    pub target: Option<AnnotationTarget>,
}

#[derive(Debug, Clone, Default)]
pub struct ListMarginNotesFilter {
    pub step_id: Option<Uuid>,
    pub locale_code: Option<String>,
    pub tag: Option<String>,
    pub q: Option<String>,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearnerProgressDto {
    pub learner_id: String,
    pub completed_step_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleTaskChecksDto {
    pub learner_id: String,
    pub step_id: Uuid,
    pub checked_item_ids: Vec<String>,
}

/// Validate user note length against `MAX_NOTE_CHARS`, returning trimmed text or `DomainError`.
pub fn validate_user_note_content(raw: &str) -> Result<String, error::DomainError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(error::DomainError::new(
            error::ErrorCode::NoteContentEmpty,
            "Margin note content cannot be empty.",
        ));
    }
    let char_count = trimmed.chars().count();
    if char_count > MAX_NOTE_CHARS {
        return Err(error::DomainError::new(
            error::ErrorCode::NoteTooLong,
            format!("Margin note exceeds the {MAX_NOTE_CHARS}-character limit ({char_count} characters)."),
        )
        .with_meta(serde_json::json!({
            "max_chars": MAX_NOTE_CHARS,
            "actual_chars": char_count,
        })));
    }
    Ok(trimmed.to_string())
}

/// Compile user-submitted Markdown note text into safe inline/simple-block HTML.
/// Drops raw HTML events at the Markdown AST layer and enforces a strict `ammonia` whitelist
/// (defense-in-depth against XSS while genuinely supporting `**bold**`, `*italic*`, `` `code` ``,
/// `~~strikethrough~~`, and short lists).
pub fn sanitize_user_note(raw: &str) -> String {
    let trimmed: String = raw.trim().chars().take(MAX_NOTE_CHARS).collect();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);

    // Strip any raw HTML tags (and `<script>`/`<style>` payloads) while preserving surrounding plain text
    // even when CommonMark parses a line starting with `<script>` as an HTML block.
    let mut strip_only = HtmlSanitizer::new();
    strip_only.tags(HashSet::new());
    let mut rendered = String::new();
    let mut safe_events: Vec<Event<'_>> = Vec::new();
    for ev in Parser::new_ext(&trimmed, opts) {
        match ev {
            Event::Html(raw_html) | Event::InlineHtml(raw_html) => {
                let text_only = strip_only.clean(&raw_html).to_string();
                if !text_only.is_empty() {
                    let parts: Vec<&str> = text_only.split('\n').collect();
                    for (idx, part) in parts.iter().enumerate() {
                        if !part.is_empty() {
                            safe_events.push(Event::Text((*part).to_string().into()));
                        }
                        if idx + 1 < parts.len() {
                            safe_events.push(Event::HardBreak);
                        }
                    }
                }
            }
            Event::SoftBreak => safe_events.push(Event::HardBreak),
            other => safe_events.push(other),
        }
    }
    html::push_html(&mut rendered, safe_events.into_iter());

    let mut allowed_tags = HashSet::new();
    for tag in [
        "p", "br", "strong", "b", "em", "i", "code", "del", "s", "ul", "ol", "li", "mark",
    ] {
        allowed_tags.insert(tag);
    }

    let cleaned = HtmlSanitizer::new()
        .tags(allowed_tags)
        .generic_attributes(HashSet::new())
        .clean(&rendered)
        .to_string();

    // Unwrap single-paragraph `<p>...</p>` for clean inline rendering inside compact sticker cards
    let c = cleaned.trim();
    if c.starts_with("<p>") && c.ends_with("</p>") && c.matches("<p>").count() == 1 {
        c[3..c.len() - 4].trim().to_string()
    } else {
        c.to_string()
    }
}

/// Export notes as RFC 7763 `text/markdown; charset=utf-8` document.
pub fn export_notes_as_markdown(notes: &[UserMarginNoteDto], site_name: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {} — Reading Notes\n\n", site_name.trim()));
    out.push_str(&format!(
        "_Exported at {} (UTC) · {} note(s)_\n\n",
        Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        notes.len()
    ));

    let mut current_group = String::new();
    for note in notes {
        let heading = note
            .step_title
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(reading_time::strip_html_tags)
            .unwrap_or_else(|| note.step_id.to_string());
        let group_key = format!("{}::{}", note.step_id, note.locale_code);
        if group_key != current_group {
            current_group = group_key;
            out.push_str(&format!("## {heading} (`{}`)\n\n", note.locale_code));
        }

        let quote_exact = note.target.as_ref().and_then(|t| {
            t.selector.iter().find_map(|s| match s {
                AnnotationSelector::TextQuoteSelector { exact, .. } if !exact.trim().is_empty() => {
                    Some(exact.trim())
                }
                _ => None,
            })
        });
        if let Some(q) = quote_exact {
            out.push_str(&format!("> {q}\n>\n"));
        }

        out.push_str(&format!(
            "- **[{}]** ({}, v{}, `{}`)\n\n",
            note.tag,
            note.updated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            note.version,
            note.block_anchor_id
        ));
        for line in note.raw_content.lines() {
            out.push_str("  ");
            out.push_str(line);
            out.push('\n');
        }
        out.push('\n');
    }
    out
}

/// Export notes as a W3C Web Annotation Data Model (`REC-annotation-model-20170223`) JSON-LD
/// `AnnotationCollection` (`application/ld+json; profile="http://www.w3.org/ns/anno.jsonld"`).
pub fn export_notes_as_w3c_jsonld(
    notes: &[UserMarginNoteDto],
    origin: &str,
) -> serde_json::Value {
    let base = origin.trim_end_matches('/');
    let items: Vec<serde_json::Value> = notes
        .iter()
        .map(|n| {
            let source_url = match (&n.track_slug, &n.step_slug) {
                (Some(track), Some(step)) => {
                    format!("{base}/{}/series/{track}/{step}", n.locale_code)
                }
                _ => format!("urn:icehandnote:step:{}:locale:{}", n.step_id, n.locale_code),
            };
            let selectors = n
                .target
                .as_ref()
                .filter(|t| !t.selector.is_empty())
                .map(|t| serde_json::to_value(&t.selector).unwrap_or_else(|_| serde_json::json!([])))
                .unwrap_or_else(|| {
                    serde_json::json!([{
                        "type": "FragmentSelector",
                        "conformsTo": "https://icehandnote.dev/spec/block-id",
                        "value": n.block_anchor_id,
                    }])
                });
            serde_json::json!({
                "id": format!("{base}/api/v1/me/notes/{}", n.id),
                "type": "Annotation",
                "motivation": n.motivation,
                "created": n.created_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                "modified": n.updated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                "body": {
                    "type": "TextualBody",
                    "value": n.raw_content,
                    "format": n.body_format,
                    "language": n.locale_code,
                    "purpose": n.motivation,
                },
                "target": {
                    "type": "SpecificResource",
                    "source": source_url,
                    "selector": selectors,
                },
                "icehandnote:meta": {
                    "step_id": n.step_id,
                    "step_title": n.step_title,
                    "tone": n.tone,
                    "style": n.style,
                    "tag": n.tag,
                    "version": n.version,
                }
            })
        })
        .collect();

    serde_json::json!({
        "@context": "http://www.w3.org/ns/anno.jsonld",
        "id": format!("{base}/api/v1/me/notes"),
        "type": "AnnotationCollection",
        "total": items.len(),
        "items": items,
    })
}

pub fn is_safe_image_src(src: &str) -> bool {
    let trimmed = src.trim();
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control()) {
        return false;
    }
    trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || (trimmed.starts_with('/') && !trimmed.starts_with("//"))
}

/// Sanitize an optional article cover banner image path or URL.
pub fn sanitize_cover_image_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 512 || !is_safe_image_src(trimmed) {
        return String::new();
    }
    trimmed.to_string()
}

fn allowed_ink_classes() -> HashMap<&'static str, HashSet<&'static str>> {
    let mut map = HashMap::new();
    map.insert(
        "span",
        HashSet::from([
            "ink-fg-violet",
            "ink-fg-ice",
            "ink-fg-emerald",
            "ink-fg-amber",
            "ink-fg-rose",
            "ink-fg-muted",
            "ink-bg-violet",
            "ink-bg-ice",
            "ink-bg-emerald",
            "ink-bg-amber",
            "ink-bg-rose",
            "ink-bg-kraft",
            "ink-size-sm",
            "ink-size-base",
            "ink-size-lg",
            "ink-size-xl",
            "ink-size-2xl",
            "ink-kbd-combo",
            "ink-kbd-sep",
        ]),
    );
    map.insert(
        "mark",
        HashSet::from([
            "ink-hl-amber",
            "ink-hl-violet",
            "ink-hl-ice",
            "ink-hl-emerald",
            "ink-hl-rose",
        ]),
    );
    map.insert("code", HashSet::from(["ink-inline-code"]));
    map.insert("kbd", HashSet::from(["ink-kbd"]));
    map.insert("a", HashSet::from(["ink-inline-link", "ink-chrome-link"]));
    map.insert(
        "p",
        HashSet::from([
            "ink-align-left",
            "ink-align-center",
            "ink-align-right",
            "ink-size-sm",
            "ink-size-base",
            "ink-size-lg",
            "ink-size-xl",
            "ink-size-2xl",
        ]),
    );
    map
}

fn safe_url_schemes() -> HashSet<&'static str> {
    HashSet::from(["https", "http", "mailto"])
}

/// Sanitize customizable inline text fields (site name, hero title/tagline, footer, badges,
/// track/chapter/article titles & summaries) so safe inline HTML tags render cleanly while
/// stripping scripts, event handlers, arbitrary styling classes, and unsafe URLs.
pub fn sanitize_custom_html(raw: &str, max_chars: usize) -> String {
    let clipped: String = raw.trim().chars().take(max_chars).collect();
    if clipped.is_empty() {
        return String::new();
    }
    if !clipped.contains('<') && !clipped.contains('&') {
        return clipped;
    }
    let mut tags = HashSet::new();
    for t in [
        "b", "strong", "i", "em", "u", "s", "del", "ins", "mark", "code", "kbd", "sub", "sup",
        "small", "span", "br", "a", "ruby", "rt", "rp", "abbr",
    ] {
        tags.insert(t);
    }
    let mut generic_attrs = HashSet::new();
    generic_attrs.insert("title");

    let mut builder = HtmlSanitizer::new();
    builder
        .tags(tags)
        .generic_attributes(generic_attrs)
        .allowed_classes(allowed_ink_classes())
        .add_tag_attributes("a", &["href", "target"])
        .url_schemes(safe_url_schemes())
        .link_rel(Some("noopener noreferrer"))
        .url_relative(ammonia::UrlRelative::PassThrough);
    builder.clean(&clipped).to_string()
}

/// Sanitize customizable HTML email footer content (allowing safe inline markup & links while
/// strictly stripping scripts, event handlers, and non-HTTP/mailto URL schemes).
/// Preserves `{{site_name}}` placeholders for subsequent interpolation.
pub fn sanitize_email_footer_html(raw: &str, max_chars: usize) -> String {
    let clipped: String = raw.trim().chars().take(max_chars).collect();
    if clipped.is_empty() {
        return String::new();
    }
    if !clipped.contains('<') && !clipped.contains('&') {
        return clipped;
    }
    let mut tags = HashSet::new();
    for t in [
        "a", "b", "strong", "i", "em", "u", "s", "del", "small", "span", "code", "br", "p",
        "sub", "sup",
    ] {
        tags.insert(t);
    }
    let mut generic_attrs = HashSet::new();
    generic_attrs.insert("title");

    let mut schemes = HashSet::new();
    schemes.insert("https");
    schemes.insert("http");
    schemes.insert("mailto");

    let mut builder = HtmlSanitizer::new();
    builder
        .tags(tags)
        .generic_attributes(generic_attrs)
        .add_tag_attributes("a", &["href", "target"])
        .url_schemes(schemes)
        .link_rel(Some("noopener noreferrer"))
        .url_relative(ammonia::UrlRelative::Deny);
    builder.clean(&clipped).to_string()
}

/// Sanitize compiled Markdown inline HTML fragments.
pub fn sanitize_rich_fragment(fragment: &str) -> String {
    let mut tags = HashSet::new();
    for t in [
        "p", "b", "strong", "i", "em", "u", "s", "del", "ins", "code", "a", "br", "span", "ul",
        "ol", "li", "kbd", "mark", "sub", "sup", "small", "ruby", "rt", "rp", "abbr", "img",
    ] {
        tags.insert(t);
    }
    let mut generic_attrs = HashSet::new();
    generic_attrs.insert("title");
    generic_attrs.insert("data-term");

    let mut builder = HtmlSanitizer::new();
    builder
        .tags(tags)
        .generic_attributes(generic_attrs)
        .allowed_classes(allowed_ink_classes())
        .add_tag_attributes("a", &["href", "target"])
        .add_tag_attributes("img", &["src", "alt", "title", "loading"])
        .url_schemes(safe_url_schemes())
        .link_rel(Some("noopener noreferrer"))
        .url_relative(ammonia::UrlRelative::PassThrough);
    builder.clean(fragment).to_string()
}

pub fn stable_block_id(prefix: &str, ordinal: usize, seed: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    hasher.update(b":");
    hasher.update(ordinal.to_string().as_bytes());
    hasher.update(b":");
    let snippet: String = seed.chars().take(48).collect();
    hasher.update(snippet.as_bytes());
    let digest = hex::encode(hasher.finalize());
    format!("{}-{}", prefix, &digest[..8])
}

/// Content-addressed stable block identifier decoupled from global document ordinal.
/// Inserting or deleting blocks elsewhere in the document never shifts untouched block IDs;
/// identical duplicate blocks within the same document are disambiguated by occurrence index (`-2`, `-3`, ...).
pub fn content_stable_block_id(
    prefix: &str,
    seed: &str,
    seen: &mut HashMap<String, usize>,
) -> String {
    let normalized: String = seed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(64)
        .collect();
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    hasher.update(b":");
    hasher.update(normalized.as_bytes());
    let digest = hex::encode(hasher.finalize());
    let base = format!("{prefix}-{}", &digest[..8]);
    let entry = seen.entry(base.clone()).or_insert(0);
    *entry += 1;
    if *entry == 1 {
        base
    } else {
        format!("{base}-{}", *entry)
    }
}

fn is_valid_explicit_anchor_id(raw: &str) -> bool {
    !raw.is_empty()
        && raw.len() <= 64
        && raw.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Strip an optional trailing `{#custom-id}` attribute from non-code text events in a heading or paragraph.
/// Preserves inline code spans (`Event::Code`) verbatim so `` `{#id}` `` is never treated as an anchor.
fn strip_trailing_explicit_anchor(events: &mut Vec<Event<'_>>) -> Option<String> {
    let mut check_idx = events.len();
    while check_idx > 0 {
        check_idx -= 1;
        match &events[check_idx] {
            Event::Text(t) if t.trim().is_empty() => continue,
            Event::Text(t) => {
                let s = t.as_ref();
                let trimmed_end = s.trim_end();
                if let Some(without_close) = trimmed_end.strip_suffix('}') {
                    if let Some(open_idx) = without_close.rfind("{#") {
                        let candidate = &without_close[open_idx + 2..];
                        let valid_boundary = open_idx == 0
                            || without_close[..open_idx]
                                .chars()
                                .last()
                                .is_some_and(|c| c.is_whitespace());
                        if valid_boundary && is_valid_explicit_anchor_id(candidate) {
                            let anchor = candidate.to_string();
                            let prefix = without_close[..open_idx].trim_end().to_string();
                            if prefix.is_empty() {
                                events.remove(check_idx);
                            } else {
                                events[check_idx] = Event::Text(prefix.into());
                            }
                            return Some(anchor);
                        }
                    }
                }
                return None;
            }
            _ => return None,
        }
    }
    None
}

fn register_block_id(
    explicit_id: Option<&str>,
    prefix: &str,
    seed: &str,
    seen: &mut HashMap<String, usize>,
) -> String {
    if let Some(raw) = explicit_id.filter(|s| is_valid_explicit_anchor_id(s)) {
        let entry = seen.entry(raw.to_string()).or_insert(0);
        *entry += 1;
        return if *entry == 1 {
            raw.to_string()
        } else {
            format!("{raw}-{}", *entry)
        };
    }
    content_stable_block_id(prefix, seed, seen)
}

fn render_inline_markdown(src: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    let parser = Parser::new_ext(src.trim(), opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    let trimmed = out.trim();
    let unwrapped = if trimmed.starts_with("<p>") && trimmed.ends_with("</p>") && trimmed.matches("<p>").count() == 1 {
        &trimmed[3..trimmed.len() - 4]
    } else {
        trimmed
    };
    sanitize_rich_fragment(unwrapped)
}

fn corrupt_frontmatter_default() -> StepFrontmatter {
    StepFrontmatter {
        step_number: default_step_num(),
        estimated_minutes: 1,
        synced_revision: default_rev(),
        status: "draft".to_string(),
        ..StepFrontmatter::default()
    }
}

/// Validate an explicit `+++ ... +++` TOML frontmatter block if present.
pub fn validate_step_frontmatter(raw: &str) -> Result<(), String> {
    let normalized = raw.trim_start_matches('\u{feff}');
    if let Some(rest) = normalized.strip_prefix("+++") {
        let Some(end_idx) = rest.find("\n+++") else {
            return Err("Unterminated +++ frontmatter block.".to_string());
        };
        let toml_str = &rest[..end_idx];
        let parsed: StepFrontmatter = toml::from_str(toml_str)
            .map_err(|e| format!("Invalid step frontmatter TOML: {e}"))?;
        if !matches!(
            parsed.status.trim(),
            "" | "draft" | "published" | "taken_down"
        ) {
            return Err(format!("Unsupported step status '{}'.", parsed.status));
        }
    }
    Ok(())
}

fn strip_frontmatter(raw: &str) -> (StepFrontmatter, &str) {
    let normalized = raw.trim_start_matches('\u{feff}');
    if let Some(rest) = normalized.strip_prefix("+++") {
        if let Some(end_idx) = rest.find("\n+++") {
            let toml_str = &rest[..end_idx];
            let body = &rest[end_idx + 4..];
            let fm: StepFrontmatter = match toml::from_str(toml_str) {
                Ok(parsed) => parsed,
                Err(err) => {
                    eprintln!("warn: invalid step frontmatter TOML, falling back to draft defaults: {err}");
                    corrupt_frontmatter_default()
                }
            };
            return (fm, body.trim_start_matches(['\r', '\n']));
        }
        return (corrupt_frontmatter_default(), "");
    }
    (StepFrontmatter::default(), normalized)
}

fn parse_step_directive_line(raw: &str) -> Option<(String, Option<String>, bool)> {
    let mut s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let mut default_checked = false;

    if let Some(rest) = s.strip_prefix("- ").or_else(|| s.strip_prefix("* ")) {
        s = rest.trim_start();
    } else if let Some(dot_pos) = s.find(". ") {
        if dot_pos > 0 && s[..dot_pos].chars().all(|c| c.is_ascii_digit()) {
            s = s[dot_pos + 2..].trim_start();
        }
    }

    if let Some(rest) = s.strip_prefix("[ ]") {
        default_checked = false;
        s = rest.trim_start();
    } else if let Some(rest) = s.strip_prefix("[x]").or_else(|| s.strip_prefix("[X]")) {
        default_checked = true;
        s = rest.trim_start();
    }

    if s.is_empty() {
        return None;
    }

    if let Some((title_part, detail_part)) = s.split_once(" | ") {
        let title = title_part.trim().to_string();
        let detail = detail_part.trim().to_string();
        if title.is_empty() {
            return None;
        }
        Some((
            title,
            if detail.is_empty() { None } else { Some(detail) },
            default_checked,
        ))
    } else {
        Some((s.to_string(), None, default_checked))
    }
}

fn parse_steps_scope_and_title(raw_header: &str) -> (&'static str, String) {
    let trimmed = raw_header.trim();
    if trimmed.eq_ignore_ascii_case("section") {
        return ("section", String::new());
    }
    if trimmed.eq_ignore_ascii_case("paragraph") {
        return ("paragraph", String::new());
    }
    if let Some((left, right)) = trimmed.split_once(" | ") {
        let l = left.trim();
        if l.eq_ignore_ascii_case("section") {
            return ("section", right.trim().to_string());
        }
        if l.eq_ignore_ascii_case("paragraph") {
            return ("paragraph", right.trim().to_string());
        }
    }
    ("section", trimmed.to_string())
}

fn parse_directive_header(rest: &str) -> (&str, String, String) {
    let trimmed = rest.trim();
    let (without_attrs, attrs) = if trimmed.ends_with('}') {
        let search_after = trimmed.rfind(']').unwrap_or(0);
        if let Some(rel_brace) = trimmed[search_after..].find('{') {
            let brace_idx = search_after + rel_brace;
            (
                trimmed[..brace_idx].trim(),
                trimmed[brace_idx + 1..trimmed.len() - 1].trim().to_string(),
            )
        } else {
            (trimmed, String::new())
        }
    } else {
        (trimmed, String::new())
    };

    if let Some(bracket_idx) = without_attrs.find('[') {
        let kind = without_attrs[..bracket_idx].trim();
        let title = without_attrs[bracket_idx + 1..]
            .trim_end_matches(']')
            .trim()
            .to_string();
        (kind, title, attrs)
    } else {
        (without_attrs, String::new(), attrs)
    }
}

fn sanitize_pixel_sprite(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "cat" | "cat-bookmark" => "cat",
        "quill" | "ink-quill" => "quill",
        "coffee" | "coffee-mug" => "coffee",
        "crystal" | "ice-crystal" | "ice" => "crystal",
        "sprout" | "sprout-pot" => "sprout",
        "compass" => "compass",
        "floppy" | "floppy-disk" => "floppy",
        "hourglass" => "hourglass",
        "star" | "star-stamp" => "star",
        "plane" | "paper-plane" => "plane",
        "lightbulb" | "bulb" | "idea" => "lightbulb",
        "heart" | "heart-memo" | "love" => "heart",
        _ => "cat",
    }
}

fn normalize_pixel_align(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "left" => "left",
        "right" => "right",
        _ => "center",
    }
}

fn normalize_pixel_size(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "sm" | "small" => "sm",
        "lg" | "large" => "lg",
        _ => "md",
    }
}

fn normalize_text_align(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "left" | "start" => Some("left"),
        "center" => Some("center"),
        "right" | "end" => Some("right"),
        _ => None,
    }
}

fn normalize_text_size(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "sm" | "small" => Some("sm"),
        "lg" | "large" => Some("lg"),
        "xl" => Some("xl"),
        "2xl" | "xxl" => Some("2xl"),
        _ => None,
    }
}

fn parse_clamped_f32(raw: Option<String>, min: f32, max: f32) -> Option<f32> {
    raw.and_then(|s| s.trim().parse::<f32>().ok())
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(min, max))
}

fn parse_bool_flag(raw: Option<String>) -> Option<bool> {
    match raw.as_deref().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("true" | "1" | "yes") => Some(true),
        Some("false" | "0" | "no") => Some(false),
        _ => None,
    }
}

/// Pre-process custom notebook directives (`:::tip[...] ... :::`, `:::steps[...] ... :::`,
/// `:::pixel[...]{...}`, `:::format{...}`, and `:::margin[...]`) before Markdown parsing, converting them into
/// fenced markers that preserve block ordering cleanly.
fn preprocess_notebook_directives(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len() + 128);
    let mut lines = markdown.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();

        // Single-line :::margin[...] directive
        if let Some(after) = trimmed.strip_prefix(":::margin[") {
            if let Some(note) = after.strip_suffix(']') {
                out.push_str("\n```__icehandnote_margin\n");
                out.push_str(note.trim());
                out.push_str("\n```\n");
                continue;
            }
        }

        // Single-line :::format{align="..." size="..."} directive
        if let Some(rest_fmt) = trimmed.strip_prefix(":::format") {
            let after_kw = rest_fmt.trim_start();
            if after_kw.is_empty() || after_kw.starts_with('[') || after_kw.starts_with('{') {
                let (_, _, attrs_raw) =
                    parse_directive_header(trimmed.strip_prefix(":::").unwrap_or("format"));
                if lines.peek().is_some_and(|next| next.trim() == ":::") {
                    lines.next();
                }
                let align = extract_attr(&attrs_raw, "align").and_then(|v| normalize_text_align(&v));
                let size = extract_attr(&attrs_raw, "size").and_then(|v| normalize_text_size(&v));
                if align.is_some() || size.is_some() {
                    let payload = serde_json::json!({
                        "align": align,
                        "size": size,
                    });
                    out.push_str("\n```__icehandnote_format\n");
                    out.push_str(&payload.to_string());
                    out.push_str("\n```\n");
                }
                continue;
            }
        }

        // Single-line (or accidentally closed) :::pixel[sprite]{...} directive
        if let Some(rest_pixel) = trimmed.strip_prefix(":::pixel") {
            let after_kw = rest_pixel.trim_start();
            if after_kw.is_empty() || after_kw.starts_with('[') || after_kw.starts_with('{') {
                let (_, sprite_raw, attrs_raw) =
                    parse_directive_header(trimmed.strip_prefix(":::").unwrap_or("pixel"));
                if lines.peek().is_some_and(|next| next.trim() == ":::") {
                    lines.next();
                }
                let sprite = sanitize_pixel_sprite(&sprite_raw);
                let align = extract_attr(&attrs_raw, "align").map(|v| normalize_pixel_align(&v));
                let size = extract_attr(&attrs_raw, "size").map(|v| normalize_pixel_size(&v));
                let x = parse_clamped_f32(extract_attr(&attrs_raw, "x"), -25.0, 125.0);
                let y = parse_clamped_f32(extract_attr(&attrs_raw, "y"), -60.0, 160.0);
                let rotate = parse_clamped_f32(extract_attr(&attrs_raw, "rotate"), -180.0, 180.0);
                let scale = parse_clamped_f32(extract_attr(&attrs_raw, "scale"), 0.35, 3.5);
                let flip = parse_bool_flag(extract_attr(&attrs_raw, "flip"));
                let locked = parse_bool_flag(extract_attr(&attrs_raw, "locked"));
                let layer = extract_attr(&attrs_raw, "layer").and_then(|v| {
                    match v.trim().to_ascii_lowercase().as_str() {
                        "behind" | "back" => Some("behind"),
                        "front" => Some("front"),
                        _ => None,
                    }
                });
                let anchor = extract_attr(&attrs_raw, "anchor")
                    .and_then(|v| match v.trim().to_ascii_lowercase().as_str() {
                        "block" => Some("block"),
                        "inline" => Some("inline"),
                        _ => None,
                    })
                    .or_else(|| if x.is_some() || y.is_some() { Some("block") } else { None });
                let caption = extract_attr(&attrs_raw, "caption")
                    .map(|v| sanitize_custom_html(v.trim(), 240))
                    .filter(|v| !v.is_empty());
                let payload = serde_json::json!({
                    "sprite": sprite,
                    "align": align,
                    "size": size,
                    "anchor": anchor,
                    "x": x,
                    "y": y,
                    "rotate": rotate,
                    "scale": scale,
                    "flip": flip,
                    "locked": locked,
                    "layer": layer,
                    "caption": caption,
                });
                out.push_str("\n```__icehandnote_pixel\n");
                out.push_str(&payload.to_string());
                out.push_str("\n```\n");
                continue;
            }
        }

        // Container directives: :::steps[Title] ... ::: and :::tip[Title]{style="..." tone="..."} ... :::
        if let Some(rest) = trimmed.strip_prefix(":::") {
            if !rest.is_empty() {
                let (kind_raw, title, attrs_raw) = parse_directive_header(rest);

                if kind_raw.trim().eq_ignore_ascii_case("steps") {
                    let (scope_str, clean_title) = parse_steps_scope_and_title(&title);
                    let mut parsed_items = Vec::new();
                    for inner in lines.by_ref() {
                        if inner.trim() == ":::" {
                            break;
                        }
                        if let Some((item_title, item_detail, default_checked)) =
                            parse_step_directive_line(inner)
                        {
                            parsed_items.push(serde_json::json!({
                                "title": item_title,
                                "detail": item_detail,
                                "default_checked": default_checked,
                            }));
                        }
                    }

                    let payload = serde_json::json!({
                        "title": clean_title,
                        "scope": scope_str,
                        "items": parsed_items,
                    });
                    out.push_str("\n```__icehandnote_steps\n");
                    out.push_str(&payload.to_string());
                    out.push_str("\n```\n");
                    continue;
                }

                if AlertKind::from_directive(kind_raw).is_some() {
                    let mut main_lines = Vec::new();
                    let mut detail_summary: Option<String> = None;
                    let mut detail_lines = Vec::new();
                    let mut in_detail = false;

                    for inner in lines.by_ref() {
                        if inner.trim() == ":::" {
                            break;
                        }
                        if let Some(summary_raw) = inner.trim().strip_prefix("???") {
                            in_detail = true;
                            detail_summary = Some(summary_raw.trim().to_string());
                            continue;
                        }
                        if in_detail {
                            detail_lines.push(inner);
                        } else {
                            main_lines.push(inner);
                        }
                    }

                    let style_attr = extract_attr(&attrs_raw, "style");
                    let tone_attr = extract_attr(&attrs_raw, "tone");
                    let badge_attr = extract_attr(&attrs_raw, "badge");
                    let align_attr = extract_attr(&attrs_raw, "align").and_then(|v| normalize_text_align(&v));
                    let size_attr = extract_attr(&attrs_raw, "size").and_then(|v| normalize_text_size(&v));

                    let payload = serde_json::json!({
                        "kind": kind_raw.to_ascii_lowercase(),
                        "title": title,
                        "body": main_lines.join("\n"),
                        "detail_summary": detail_summary,
                        "detail_body": if detail_lines.is_empty() { None } else { Some(detail_lines.join("\n")) },
                        "style": style_attr,
                        "tone": tone_attr,
                        "badge": badge_attr,
                        "align": align_attr,
                        "size": size_attr,
                    });

                    out.push_str("\n```__icehandnote_alert\n");
                    out.push_str(&payload.to_string());
                    out.push_str("\n```\n");
                    continue;
                }
            }
        }

        out.push_str(line);
        out.push('\n');
    }

    out
}

/// Detect optional leading `[ ] ` / `[x] ` task marker on a Markdown heading (`## [ ] Title`)
/// indicating that the entire section beneath this heading is a checkable Section Task (`节任务`).
fn parse_heading_task_prefix(raw: &str) -> (bool, bool, String) {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("[ ]") {
        let clean = rest.trim_start();
        if !clean.is_empty() {
            return (true, false, clean.to_string());
        }
    } else if let Some(rest) = trimmed
        .strip_prefix("[x]")
        .or_else(|| trimmed.strip_prefix("[X]"))
    {
        let clean = rest.trim_start();
        if !clean.is_empty() {
            return (true, true, clean.to_string());
        }
    }
    (false, false, trimmed.to_string())
}

/// Compile a Markdown article file (with TOML frontmatter + custom stationery directives)
/// into structured `NotebookBlock`s, numbered `TocItem`s, plain text for FTS, and fallback HTML.
pub fn compile_notebook_markdown(raw_source: &str) -> CompiledDocument {
    let (mut frontmatter, body_md) = strip_frontmatter(raw_source);
    frontmatter.title = sanitize_custom_html(&frontmatter.title, 320);
    frontmatter.summary = sanitize_custom_html(&frontmatter.summary, 640);
    frontmatter.estimated_minutes = reading_time::estimate_reading_minutes(body_md);
    let preprocessed = preprocess_notebook_directives(body_md);

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(&preprocessed, opts);

    let mut blocks: Vec<NotebookBlock> = Vec::new();
    let mut toc: Vec<TocItem> = Vec::new();
    let mut plain_chunks: Vec<String> = Vec::new();
    if !frontmatter.title.is_empty() {
        plain_chunks.push(frontmatter.title.clone());
    }
    if !frontmatter.summary.is_empty() {
        plain_chunks.push(frontmatter.summary.clone());
    }

    let mut h_counts = [0usize; 4]; // H1..H4 hierarchical outline numbering ("1", "1.1", "2")
    let mut seen_block_ids: HashMap<String, usize> = HashMap::new();
    let mut pending_margin_note: Option<String> = None;

    let mut events_iter = parser.peekable();
    while let Some(event) = events_iter.next() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                let lvl: u8 = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    _ => 4,
                };
                let mut heading_events = Vec::new();
                for ev in events_iter.by_ref() {
                    match ev {
                        Event::End(TagEnd::Heading(_)) => break,
                        other => heading_events.push(other),
                    }
                }
                let explicit_id = strip_trailing_explicit_anchor(&mut heading_events);
                let mut raw_text = String::new();
                html::push_html(&mut raw_text, heading_events.into_iter());
                let (is_task, default_checked, parsed_head) = parse_heading_task_prefix(&raw_text);
                let text = sanitize_custom_html(&parsed_head, 640);
                let plain_heading = reading_time::strip_html_tags(&text);
                let idx = (lvl as usize).saturating_sub(1).min(3);
                h_counts[idx] += 1;
                h_counts[(idx + 1)..].fill(0);
                let number = if idx == 0 {
                    format!("{}", h_counts[0])
                } else if h_counts[0] == 0 {
                    // Most step bodies use ## as top-level section headings
                    if idx == 1 {
                        format!("{}", h_counts[1])
                    } else {
                        format!("{}.{}", h_counts[1].max(1), h_counts[idx])
                    }
                } else {
                    h_counts[..=idx]
                        .iter()
                        .map(|n| n.to_string())
                        .collect::<Vec<_>>()
                        .join(".")
                };

                let block_id = register_block_id(
                    explicit_id.as_deref(),
                    "sec",
                    &plain_heading,
                    &mut seen_block_ids,
                );
                plain_chunks.push(plain_heading.clone());
                toc.push(TocItem {
                    id: block_id.clone(),
                    level: lvl,
                    number: number.clone(),
                    text: plain_heading,
                    is_task,
                });
                blocks.push(NotebookBlock::Heading {
                    block_id,
                    level: lvl,
                    number,
                    text,
                    is_task,
                    default_checked,
                    align: None,
                });
            }

            Event::Start(Tag::Paragraph) => {
                let mut inner_events = Vec::new();
                for ev in events_iter.by_ref() {
                    match ev {
                        Event::End(TagEnd::Paragraph) => break,
                        other => inner_events.push(other),
                    }
                }

                // Detect standalone Markdown image paragraph: `![alt](src "caption")`
                let non_ws_events: Vec<&Event> = inner_events
                    .iter()
                    .filter(|ev| match ev {
                        Event::SoftBreak | Event::HardBreak => false,
                        Event::Text(t) => !t.trim().is_empty(),
                        _ => true,
                    })
                    .collect();
                if let (
                    Some(Event::Start(Tag::Image {
                        dest_url, title, ..
                    })),
                    Some(Event::End(TagEnd::Image)),
                ) = (non_ws_events.first().copied(), non_ws_events.last().copied())
                {
                    let nested_starts = non_ws_events[1..non_ws_events.len().saturating_sub(1)]
                        .iter()
                        .any(|ev| matches!(ev, Event::Start(Tag::Image { .. })));
                    if !nested_starts && is_safe_image_src(dest_url) {
                        let mut alt_buf = String::new();
                        for ev in &non_ws_events[1..non_ws_events.len().saturating_sub(1)] {
                            if let Event::Text(t) | Event::Code(t) = ev {
                                alt_buf.push_str(t);
                            }
                        }
                        let src_str = dest_url.trim().to_string();
                        let alt_str = alt_buf.trim().to_string();
                        let cap_opt = if title.trim().is_empty() {
                            None
                        } else {
                            Some(title.trim().to_string())
                        };
                        let block_id = content_stable_block_id(
                            "img",
                            &format!("{src_str}:{alt_str}"),
                            &mut seen_block_ids,
                        );
                        if !alt_str.is_empty() {
                            plain_chunks.push(alt_str.clone());
                        }
                        if let Some(ref c) = cap_opt {
                            plain_chunks.push(c.clone());
                        }
                        blocks.push(NotebookBlock::Image {
                            block_id,
                            src: src_str,
                            alt: alt_str,
                            caption: cap_opt,
                            margin_note: pending_margin_note.take(),
                        });
                        continue;
                    }
                }

                let explicit_id = strip_trailing_explicit_anchor(&mut inner_events);
                let mut plain = String::new();
                for ev in &inner_events {
                    if let Event::Text(ref t) | Event::Code(ref t) = ev {
                        plain.push_str(t);
                    }
                }
                let mut html_buf = String::new();
                html::push_html(&mut html_buf, inner_events.into_iter());
                let clean = sanitize_rich_fragment(&html_buf);
                if !clean.trim().is_empty() {
                    let block_id = register_block_id(
                        explicit_id.as_deref(),
                        "p",
                        &plain,
                        &mut seen_block_ids,
                    );
                    plain_chunks.push(plain);
                    blocks.push(NotebookBlock::Paragraph {
                        block_id,
                        html: clean,
                        margin_note: pending_margin_note.take(),
                        align: None,
                        size: None,
                    });
                }
            }

            Event::Start(Tag::CodeBlock(kind)) => {
                let info = match kind {
                    CodeBlockKind::Fenced(s) => s.to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                let mut raw_code = String::new();
                for ev in events_iter.by_ref() {
                    match ev {
                        Event::End(TagEnd::CodeBlock) => break,
                        Event::Text(t) => raw_code.push_str(&t),
                        _ => {}
                    }
                }

                let trimmed_info = info.trim();
                if trimmed_info == "__icehandnote_margin" {
                    let note = raw_code.trim().to_string();
                    if !note.is_empty() {
                        // Attach to previous non-overlay Paragraph/CodeCard/Image if present, else hold for next
                        let mut attached = false;
                        if let Some(target_block) = blocks.iter_mut().rev().find(|b| {
                            !matches!(
                                b,
                                NotebookBlock::PixelSticker {
                                    anchor: Some(a),
                                    ..
                                } if a == "block"
                            )
                        }) {
                            match target_block {
                                NotebookBlock::Paragraph { margin_note, .. }
                                | NotebookBlock::CodeCard { margin_note, .. }
                                | NotebookBlock::Image { margin_note, .. }
                                    if margin_note.is_none() =>
                                {
                                    *margin_note = Some(note.clone());
                                    attached = true;
                                }
                                _ => {}
                            }
                        }
                        if !attached {
                            pending_margin_note = Some(note);
                        }
                    }
                    continue;
                }

                if trimmed_info == "__icehandnote_format" {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_code) {
                        let align_v = val
                            .get("align")
                            .and_then(|v| v.as_str())
                            .and_then(normalize_text_align)
                            .map(|s| s.to_string());
                        let size_v = val
                            .get("size")
                            .and_then(|v| v.as_str())
                            .and_then(normalize_text_size)
                            .map(|s| s.to_string());
                        if let Some(target_block) = blocks.iter_mut().rev().find(|b| {
                            !matches!(
                                b,
                                NotebookBlock::PixelSticker {
                                    anchor: Some(a),
                                    ..
                                } if a == "block"
                            )
                        }) {
                            match target_block {
                                NotebookBlock::Paragraph { align, size, .. }
                                | NotebookBlock::Quote { align, size, .. }
                                | NotebookBlock::Alert { align, size, .. } => {
                                    if align_v.is_some() {
                                        *align = align_v;
                                    }
                                    if size_v.is_some() {
                                        *size = size_v;
                                    }
                                }
                                NotebookBlock::Heading { align, .. } if align_v.is_some() => {
                                    *align = align_v;
                                }
                                _ => {}
                            }
                        }
                    }
                    continue;
                }

                if trimmed_info == "__icehandnote_steps" {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_code) {
                        let title = val
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let scope = match val.get("scope").and_then(|v| v.as_str()) {
                            Some("paragraph") => TaskScope::Paragraph,
                            _ => TaskScope::Section,
                        };
                        let raw_items = val
                            .get("items")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();

                        if !raw_items.is_empty() {
                            let seed_title = raw_items
                                .first()
                                .and_then(|it| it.get("title").and_then(|v| v.as_str()))
                                .unwrap_or("");
                            let block_id = content_stable_block_id(
                                "steps",
                                &format!("{title}:{seed_title}"),
                                &mut seen_block_ids,
                            );

                            if !title.is_empty() {
                                plain_chunks.push(title.clone());
                            }

                            let mut items = Vec::with_capacity(raw_items.len());
                            for (idx, it) in raw_items.iter().enumerate() {
                                let raw_t = it
                                    .get("title")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .trim();
                                if raw_t.is_empty() {
                                    continue;
                                }
                                let raw_d = it
                                    .get("detail")
                                    .and_then(|v| v.as_str())
                                    .map(str::trim)
                                    .filter(|d| !d.is_empty());
                                let default_checked = it
                                    .get("default_checked")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);

                                let item_id = stable_block_id(
                                    "tsk",
                                    idx + 1,
                                    &format!("{block_id}:{raw_t}"),
                                );
                                plain_chunks.push(raw_t.to_string());
                                if let Some(d) = raw_d {
                                    plain_chunks.push(d.to_string());
                                }
                                items.push(StepTaskItem {
                                    item_id,
                                    title_html: render_inline_markdown(raw_t),
                                    detail_html: raw_d.map(render_inline_markdown),
                                    default_checked,
                                });
                            }

                            if !items.is_empty() {
                                blocks.push(NotebookBlock::Steps {
                                    block_id,
                                    title,
                                    scope,
                                    items,
                                });
                            }
                        }
                    }
                    continue;
                }

                if trimmed_info == "__icehandnote_alert" {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_code) {
                        let k_str = val.get("kind").and_then(|v| v.as_str()).unwrap_or("note");
                        let alert_kind = AlertKind::from_directive(k_str).unwrap_or(AlertKind::Note);
                        let title = val
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let body_raw = val.get("body").and_then(|v| v.as_str()).unwrap_or("");
                        let body_html = render_inline_markdown(body_raw);
                        let detail_summary = val
                            .get("detail_summary")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string());
                        let detail_html = val
                            .get("detail_body")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.trim().is_empty())
                            .map(render_inline_markdown);
                        let style = val
                            .get("style")
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_ascii_lowercase());
                        let tone = val
                            .get("tone")
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_ascii_lowercase());
                        let badge = val
                            .get("badge")
                            .and_then(|v| v.as_str())
                            .map(|s| s.trim().chars().take(24).collect::<String>())
                            .filter(|s| !s.is_empty());
                        let align = val
                            .get("align")
                            .and_then(|v| v.as_str())
                            .and_then(normalize_text_align)
                            .map(|s| s.to_string());
                        let size = val
                            .get("size")
                            .and_then(|v| v.as_str())
                            .and_then(normalize_text_size)
                            .map(|s| s.to_string());

                        let block_id = content_stable_block_id(
                            "alert",
                            &format!("{title}:{body_raw}"),
                            &mut seen_block_ids,
                        );
                        plain_chunks.push(format!("{title} {body_raw}"));
                        blocks.push(NotebookBlock::Alert {
                            block_id,
                            kind: alert_kind,
                            title,
                            body_html,
                            detail_summary,
                            detail_html,
                            style,
                            tone,
                            badge,
                            align,
                            size,
                        });
                    }
                    continue;
                }

                if trimmed_info == "__icehandnote_pixel" {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_code) {
                        let sprite = sanitize_pixel_sprite(
                            val.get("sprite").and_then(|v| v.as_str()).unwrap_or("cat"),
                        )
                        .to_string();
                        let align = val
                            .get("align")
                            .and_then(|v| v.as_str())
                            .map(|s| normalize_pixel_align(s).to_string());
                        let size = val
                            .get("size")
                            .and_then(|v| v.as_str())
                            .map(|s| normalize_pixel_size(s).to_string());
                        let x = val
                            .get("x")
                            .and_then(|v| v.as_f64())
                            .map(|v| (v as f32).clamp(-25.0, 125.0));
                        let y = val
                            .get("y")
                            .and_then(|v| v.as_f64())
                            .map(|v| (v as f32).clamp(-60.0, 160.0));
                        let rotate = val
                            .get("rotate")
                            .and_then(|v| v.as_f64())
                            .map(|v| (v as f32).clamp(-180.0, 180.0));
                        let scale = val
                            .get("scale")
                            .and_then(|v| v.as_f64())
                            .map(|v| (v as f32).clamp(0.35, 3.5));
                        let flip = val.get("flip").and_then(|v| v.as_bool()).filter(|&b| b);
                        let locked = val.get("locked").and_then(|v| v.as_bool()).filter(|&b| b);
                        let layer = val
                            .get("layer")
                            .and_then(|v| v.as_str())
                            .filter(|s| *s == "behind" || *s == "front")
                            .map(|s| s.to_string());
                        let anchor = val
                            .get("anchor")
                            .and_then(|v| v.as_str())
                            .filter(|s| *s == "block" || *s == "inline")
                            .map(|s| s.to_string())
                            .or_else(|| {
                                if x.is_some() || y.is_some() {
                                    Some("block".to_string())
                                } else {
                                    None
                                }
                            });
                        let caption = val
                            .get("caption")
                            .and_then(|v| v.as_str())
                            .map(|s| sanitize_custom_html(s.trim(), 240))
                            .filter(|s| !s.is_empty());

                        let sig = format!(
                            "{sprite}:{}:{}:{}",
                            caption.as_deref().unwrap_or(""),
                            x.map(|v| v.round() as i32).unwrap_or(0),
                            y.map(|v| v.round() as i32).unwrap_or(0),
                        );
                        let block_id =
                            content_stable_block_id("pixel", &sig, &mut seen_block_ids);
                        if let Some(ref c) = caption {
                            plain_chunks.push(c.clone());
                        }
                        blocks.push(NotebookBlock::PixelSticker {
                            block_id,
                            sprite,
                            align,
                            size,
                            anchor,
                            x,
                            y,
                            rotate,
                            scale,
                            flip,
                            locked,
                            layer,
                            caption,
                        });
                    }
                    continue;
                }

                if trimmed_info == "sketch" || trimmed_info.starts_with("sketch ") {
                    let caption = extract_attr(trimmed_info, "caption");
                    if let Ok(spec) = serde_json::from_str::<SketchSpec>(raw_code.trim()) {
                        let block_id = content_stable_block_id(
                            "sketch",
                            raw_code.trim(),
                            &mut seen_block_ids,
                        );
                        if let Some(ref c) = caption {
                            plain_chunks.push(c.clone());
                        }
                        blocks.push(NotebookBlock::RoughDiagram {
                            block_id,
                            caption,
                            spec,
                        });
                        continue;
                    }
                }

                let language = trimmed_info
                    .split_whitespace()
                    .next()
                    .unwrap_or("text")
                    .to_string();
                let filename = extract_attr(trimmed_info, "title");
                let style = extract_attr(trimmed_info, "style")
                    .map(|s| s.trim().to_ascii_lowercase())
                    .filter(|s| !s.is_empty());
                let clean_code = raw_code.trim_end_matches('\n').to_string();
                let block_id = content_stable_block_id("code", &clean_code, &mut seen_block_ids);
                plain_chunks.push(clean_code.clone());
                blocks.push(NotebookBlock::CodeCard {
                    block_id,
                    language,
                    filename,
                    code: clean_code,
                    margin_note: pending_margin_note.take(),
                    style,
                });
            }

            Event::Start(Tag::List(first_num)) => {
                let ordered = first_num.is_some();
                let mut items_html = Vec::new();
                let mut items_detail_html: Vec<Option<String>> = Vec::new();
                let mut item_task_markers: Vec<Option<bool>> = Vec::new();
                let mut depth = 1usize;
                let mut current_item_events = Vec::new();
                let mut current_task_marker: Option<bool> = None;
                let mut in_item = false;

                for ev in events_iter.by_ref() {
                    match ev {
                        Event::Start(Tag::List(_)) => {
                            depth += 1;
                            if in_item {
                                current_item_events.push(ev);
                            }
                        }
                        Event::End(TagEnd::List(_)) => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            } else if in_item {
                                current_item_events.push(ev);
                            }
                        }
                        Event::Start(Tag::Item) if depth == 1 => {
                            in_item = true;
                            current_item_events.clear();
                            current_task_marker = None;
                        }
                        Event::TaskListMarker(checked) if depth == 1 && in_item => {
                            current_task_marker = Some(checked);
                        }
                        Event::End(TagEnd::Item) if depth == 1 => {
                            in_item = false;
                            let marker = current_task_marker.take();
                            let drained: Vec<_> = std::mem::take(&mut current_item_events);

                            if marker.is_some() {
                                // Split inline task item on ` | ` into (title_events, detail_events)
                                let mut title_events = Vec::new();
                                let mut detail_events = Vec::new();
                                let mut in_detail = false;
                                for item_ev in drained {
                                    if !in_detail {
                                        if let Event::Text(ref txt) = item_ev {
                                            if let Some((before, after)) = txt.split_once(" | ") {
                                                let before_trim = before.trim_end();
                                                if !before_trim.is_empty() {
                                                    title_events.push(Event::Text(before_trim.to_string().into()));
                                                }
                                                let after_trim = after.trim_start();
                                                if !after_trim.is_empty() {
                                                    detail_events.push(Event::Text(after_trim.to_string().into()));
                                                }
                                                in_detail = true;
                                                continue;
                                            }
                                        }
                                        title_events.push(item_ev);
                                    } else {
                                        detail_events.push(item_ev);
                                    }
                                }

                                let mut title_buf = String::new();
                                html::push_html(&mut title_buf, title_events.into_iter());
                                let cleaned_title = sanitize_rich_fragment(&title_buf).trim().to_string();
                                plain_chunks.push(strip_tags(&cleaned_title));

                                let cleaned_detail = if !detail_events.is_empty() {
                                    let mut detail_buf = String::new();
                                    html::push_html(&mut detail_buf, detail_events.into_iter());
                                    let clean_d = sanitize_rich_fragment(&detail_buf).trim().to_string();
                                    if clean_d.is_empty() {
                                        None
                                    } else {
                                        plain_chunks.push(strip_tags(&clean_d));
                                        Some(clean_d)
                                    }
                                } else {
                                    None
                                };

                                items_html.push(cleaned_title);
                                items_detail_html.push(cleaned_detail);
                            } else {
                                let mut item_buf = String::new();
                                html::push_html(&mut item_buf, drained.into_iter());
                                let cleaned = sanitize_rich_fragment(&item_buf);
                                plain_chunks.push(strip_tags(&cleaned));
                                items_html.push(cleaned);
                                items_detail_html.push(None);
                            }
                            item_task_markers.push(marker);
                        }
                        other if in_item => {
                            current_item_events.push(other);
                        }
                        _ => {}
                    }
                }

                if !items_html.is_empty() {
                    let is_task_list = item_task_markers.iter().any(|m| m.is_some());
                    if is_task_list {
                        let block_id = content_stable_block_id(
                            "steps",
                            &items_html[0],
                            &mut seen_block_ids,
                        );
                        let items = items_html
                            .into_iter()
                            .zip(items_detail_html)
                            .zip(item_task_markers)
                            .enumerate()
                            .map(|(idx, ((html_str, detail_html), marker))| {
                                let plain_seed = strip_tags(&html_str);
                                let item_id = stable_block_id(
                                    "tsk",
                                    idx + 1,
                                    &format!("{block_id}:{plain_seed}"),
                                );
                                StepTaskItem {
                                    item_id,
                                    title_html: html_str,
                                    detail_html,
                                    default_checked: marker.unwrap_or(false),
                                }
                            })
                            .collect();
                        blocks.push(NotebookBlock::Steps {
                            block_id,
                            title: String::new(),
                            scope: TaskScope::Paragraph,
                            items,
                        });
                    } else {
                        let block_id = content_stable_block_id(
                            "list",
                            &items_html[0],
                            &mut seen_block_ids,
                        );
                        blocks.push(NotebookBlock::List {
                            block_id,
                            ordered,
                            items_html,
                        });
                    }
                }
            }

            Event::Start(Tag::BlockQuote(_)) => {
                let mut quote_events = Vec::new();
                let mut plain = String::new();
                let mut depth = 1usize;
                for ev in events_iter.by_ref() {
                    match ev {
                        Event::Start(Tag::BlockQuote(_)) => {
                            depth += 1;
                            quote_events.push(ev);
                        }
                        Event::End(TagEnd::BlockQuote(_)) => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                            quote_events.push(ev);
                        }
                        Event::Text(ref t) | Event::Code(ref t) => {
                            plain.push_str(t);
                            quote_events.push(ev);
                        }
                        other => quote_events.push(other),
                    }
                }
                let mut q_buf = String::new();
                html::push_html(&mut q_buf, quote_events.into_iter());
                let cleaned = sanitize_rich_fragment(&q_buf);
                if !cleaned.trim().is_empty() {
                    let block_id = content_stable_block_id("quote", &plain, &mut seen_block_ids);
                    plain_chunks.push(plain);
                    blocks.push(NotebookBlock::Quote {
                        block_id,
                        html: cleaned,
                        align: None,
                        size: None,
                    });
                }
            }

            _ => {}
        }
    }

    let plain_text = plain_chunks.join(" ");
    let mut compiled_html = String::new();
    html::push_html(&mut compiled_html, Parser::new(body_md));

    CompiledDocument {
        frontmatter,
        blocks,
        toc,
        plain_text,
        compiled_html: sanitize_rich_fragment(&compiled_html),
    }
}

fn extract_attr(info: &str, key: &str) -> Option<String> {
    let bytes = info.as_bytes();
    let mut cursor = 0usize;
    let needle = format!("{key}=");
    while let Some(rel) = info[cursor..].find(&needle) {
        let idx = cursor + rel;
        let valid_boundary = idx == 0 || {
            let prev = bytes[idx - 1] as char;
            prev.is_ascii_whitespace() || prev == '{' || prev == ','
        };
        let val_start = idx + needle.len();
        if !valid_boundary {
            cursor = val_start;
            continue;
        }
        let rest = &info[val_start..];
        if let Some(after_quote) = rest.strip_prefix('"') {
            let end = after_quote.find('"')?;
            return Some(after_quote[..end].to_string());
        }
        if let Some(after_quote) = rest.strip_prefix('\'') {
            let end = after_quote.find('\'')?;
            return Some(after_quote[..end].to_string());
        }
        let end = rest
            .find(|c: char| c.is_ascii_whitespace() || c == '}' || c == ',')
            .unwrap_or(rest.len());
        let token = rest[..end].trim();
        return if token.is_empty() {
            None
        } else {
            Some(token.to_string())
        };
    }
    None
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

/// Build a highlighted search snippet (`<mark>` tags styled as yellow highlighter strokes in UI).
pub fn build_highlighted_snippet(plain_text: &str, query: &str) -> String {
    let q = query.trim();
    if q.is_empty() {
        return plain_text.chars().take(120).collect();
    }
    let lower_text = plain_text.to_lowercase();
    let lower_q = q.to_lowercase();

    let chars: Vec<char> = plain_text.chars().collect();
    let match_char_idx = lower_text
        .find(&lower_q)
        .map(|byte_idx| lower_text[..byte_idx].chars().count())
        .unwrap_or(0);

    let start = match_char_idx.saturating_sub(28);
    let end = (start + 110).min(chars.len());
    let slice: String = chars[start..end].iter().collect();

    let escaped = slice
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let escaped_q = q
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    let highlighted = case_insensitive_mark(&escaped, &escaped_q);
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < chars.len() { "…" } else { "" };
    format!("{prefix}{highlighted}{suffix}")
}

fn case_insensitive_mark(haystack: &str, needle: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }
    let lower_h = haystack.to_lowercase();
    let lower_n = needle.to_lowercase();
    if let Some(pos) = lower_h.find(&lower_n) {
        let end = pos + lower_n.len();
        if haystack.is_char_boundary(pos) && haystack.is_char_boundary(end) {
            return format!(
                "{}<mark>{}</mark>{}",
                &haystack[..pos],
                &haystack[pos..end],
                &haystack[end..]
            );
        }
    }
    haystack.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_alerts_sketch_and_marginalia() {
        let md = r#"+++
title = "多語言路由實戰"
summary = "測試筆記編譯器"
step_number = 2
estimated_minutes = 10
synced_revision = 3
tags = ["Rust", "Axum"]
+++

## 建立語系路由

這是一段包含 `SQLx` 的說明文字。
:::margin[手寫批註：記得加上複合索引！]

:::tip[複合索引加速秘訣]
使用 `(slug, locale_code)` 可觸發 Index-Only Scan。
??? 展開 EXPLAIN 數據
耗時從 18ms 降至 0.4ms。
:::

```sketch caption="請求管線"
{
  "nodes": [
    { "id": "a", "label": "Client", "x": 20, "y": 30, "tone": "ice" },
    { "id": "b", "label": "Axum API", "x": 220, "y": 30, "tone": "violet" }
  ],
  "edges": [
    { "from": "a", "to": "b", "label": "GET /zh-TW" }
  ]
}
```
"#;

        let doc = compile_notebook_markdown(md);
        assert_eq!(doc.frontmatter.title, "多語言路由實戰");
        assert_eq!(doc.toc.len(), 1);
        assert_eq!(doc.toc[0].number, "1");

        let has_margin = doc.blocks.iter().any(|b| {
            matches!(
                b,
                NotebookBlock::Paragraph {
                    margin_note: Some(n),
                    ..
                } if n.contains("複合索引")
            )
        });
        assert!(has_margin, "expected paragraph to carry margin note");

        let has_alert_detail = doc.blocks.iter().any(|b| {
            matches!(
                b,
                NotebookBlock::Alert {
                    kind: AlertKind::Tip,
                    detail_summary: Some(_),
                    ..
                }
            )
        });
        assert!(has_alert_detail, "expected Tip alert with collapsible detail");

        let has_sketch = doc
            .blocks
            .iter()
            .any(|b| matches!(b, NotebookBlock::RoughDiagram { .. }));
        assert!(has_sketch, "expected RoughDiagram block");
    }

    #[test]
    fn sanitizes_untrusted_note_xss() {
        let dirty = "<script>alert(1)</script>重點筆記\n第二行";
        let clean = sanitize_user_note(dirty);
        assert!(!clean.contains("<script>"));
        assert!(clean.contains("<br>"));
    }

    #[test]
    fn compiles_interactive_steps_directive_and_tasklist() {
        let md = r#"
:::steps[實戰步驟清單]
- [ ] 初始化 Cargo 工作區 | 建立 `Cargo.toml` 並宣告 `members`
- [x] 執行單元測試
:::

- [ ] 驗證獨立任務清單項目
"#;
        let doc = compile_notebook_markdown(md);
        let step_blocks: Vec<_> = doc
            .blocks
            .iter()
            .filter_map(|b| match b {
                NotebookBlock::Steps { title, items, .. } => Some((title, items)),
                _ => None,
            })
            .collect();

        assert_eq!(step_blocks.len(), 2);
        assert_eq!(step_blocks[0].0, "實戰步驟清單");
        assert_eq!(step_blocks[0].1.len(), 2);
        assert!(!step_blocks[0].1[0].default_checked);
        assert!(step_blocks[0].1[0]
            .detail_html
            .as_deref()
            .unwrap_or("")
            .contains("<code>Cargo.toml</code>"));
        assert!(step_blocks[0].1[1].default_checked);
        assert!(step_blocks[0].1[0].item_id.starts_with("tsk-"));

        assert_eq!(step_blocks[1].0, "");
        assert_eq!(step_blocks[1].1.len(), 1);
    }

    #[test]
    fn compiles_scattered_inline_task_checkpoints() {
        let md = r#"
## 第一节

先创建工作区配置文件。

:::steps[section]
- [ ] 创建 `Cargo.toml` | 在 `[workspace]` 中声明四个 crate
:::

## 第二节

再运行测试。

- [ ] 运行 `cargo test` | 确认全部通过
"#;
        let doc = compile_notebook_markdown(md);
        let step_blocks: Vec<_> = doc
            .blocks
            .iter()
            .filter_map(|b| match b {
                NotebookBlock::Steps { title, scope, items, .. } => Some((title, *scope, items)),
                _ => None,
            })
            .collect();

        assert_eq!(step_blocks.len(), 2);
        assert_eq!(step_blocks[0].1, TaskScope::Section);
        assert_eq!(step_blocks[0].2.len(), 1);
        assert!(step_blocks[0].2[0].title_html.contains("<code>Cargo.toml</code>"));
        assert!(step_blocks[0].2[0]
            .detail_html
            .as_deref()
            .unwrap_or("")
            .contains("<code>[workspace]</code>"));
        assert_eq!(step_blocks[1].1, TaskScope::Paragraph);
        assert_eq!(step_blocks[1].2.len(), 1);
        assert!(step_blocks[1].2[0].title_html.contains("<code>cargo test</code>"));
        assert_eq!(
            step_blocks[1].2[0].detail_html.as_deref(),
            Some("确认全部通过")
        );
    }

    #[test]
    fn compiles_whole_section_tasks_and_paragraph_tasks() {
        let md = r#"
## [ ] 第一节：规划工作区

这一整节都是可勾选的节任务。

## 第二节：编写模型

普通节中可穿插段任务：

- [ ] 定义 `NotebookBlock` | 携带稳定 `block_id`

## [x] 第三节：运行测试

默认已勾选的节任务。
"#;
        let doc = compile_notebook_markdown(md);
        assert_eq!(doc.toc.len(), 3);
        assert_eq!(doc.toc[0].text, "第一节：规划工作区");
        assert!(doc.toc[0].is_task);
        assert_eq!(doc.toc[1].text, "第二节：编写模型");
        assert!(!doc.toc[1].is_task);
        assert_eq!(doc.toc[2].text, "第三节：运行测试");
        assert!(doc.toc[2].is_task);

        let headings: Vec<_> = doc
            .blocks
            .iter()
            .filter_map(|b| match b {
                NotebookBlock::Heading {
                    text,
                    is_task,
                    default_checked,
                    ..
                } => Some((text.as_str(), *is_task, *default_checked)),
                _ => None,
            })
            .collect();
        assert_eq!(
            headings,
            vec![
                ("第一节：规划工作区", true, false),
                ("第二节：编写模型", false, false),
                ("第三节：运行测试", true, true),
            ]
        );
    }

    #[test]
    fn compiles_custom_sticker_attributes_and_code_card_styles() {
        let md = r#"
:::idea[缓存失效备忘]{style="pin" tone="mint" badge="灵感"}
使用版本号前缀避免脏读。
:::

```rust title="src/cache.rs" style="spiral"
pub fn cache_key(id: u64) -> String {
    format!("v2:{id}")
}
```
:::margin[mint:torn | 注意 key 长度上限]
"#;
        let doc = compile_notebook_markdown(md);
        assert_eq!(doc.blocks.len(), 2);

        match &doc.blocks[0] {
            NotebookBlock::Alert {
                kind,
                title,
                style,
                tone,
                badge,
                ..
            } => {
                assert_eq!(*kind, AlertKind::Idea);
                assert_eq!(title, "缓存失效备忘");
                assert_eq!(style.as_deref(), Some("pin"));
                assert_eq!(tone.as_deref(), Some("mint"));
                assert_eq!(badge.as_deref(), Some("灵感"));
            }
            other => panic!("expected Alert block, got {other:?}"),
        }

        match &doc.blocks[1] {
            NotebookBlock::CodeCard {
                language,
                filename,
                style,
                margin_note,
                ..
            } => {
                assert_eq!(language, "rust");
                assert_eq!(filename.as_deref(), Some("src/cache.rs"));
                assert_eq!(style.as_deref(), Some("spiral"));
                assert_eq!(
                    margin_note.as_deref(),
                    Some("mint:torn | 注意 key 长度上限")
                );
            }
            other => panic!("expected CodeCard block, got {other:?}"),
        }
    }

    #[test]
    fn compiles_notebook_image_blocks_and_blocks_unsafe_schemes() {
        let md = r#"
![架构总览](/uploads/202611/arch.png "双存储热切换示意")
:::margin[mint:washi | 点击查看大图]

![危险链接](javascript:alert(1))
"#;
        let doc = compile_notebook_markdown(md);
        assert_eq!(doc.blocks.len(), 2);

        match &doc.blocks[0] {
            NotebookBlock::Image {
                src,
                alt,
                caption,
                margin_note,
                ..
            } => {
                assert_eq!(src, "/uploads/202611/arch.png");
                assert_eq!(alt, "架构总览");
                assert_eq!(caption.as_deref(), Some("双存储热切换示意"));
                assert_eq!(margin_note.as_deref(), Some("mint:washi | 点击查看大图"));
            }
            other => panic!("expected Image block, got {other:?}"),
        }

        // Unsafe javascript: scheme is not turned into an Image block and is sanitized in HTML
        match &doc.blocks[1] {
            NotebookBlock::Paragraph { html, .. } => {
                assert!(!html.contains("javascript:"));
            }
            other => panic!("expected sanitized Paragraph fallback, got {other:?}"),
        }
    }

    #[test]
    fn parses_flexible_utc_and_roundtrips_frontmatter_timestamps() {
        assert_eq!(parse_flexible_utc("  "), None);
        assert!(parse_flexible_utc("2024-05-15").is_some());
        assert!(parse_flexible_utc("2026-11-22T00:00:00Z").is_some());

        let md = auth::format_step_markdown_file_with_meta(
            "Timestamp Title",
            "Summary",
            2,
            5,
            3,
            3,
            "published",
            "cc-by-4.0",
            "Alice",
            Some("2025-01-10T08:00:00Z"),
            Some("2026-11-22T12:00:00Z"),
            &["rust".to_string()],
            "Body paragraph.",
        );
        let compiled = compile_notebook_markdown(&md);
        assert_eq!(compiled.frontmatter.author, "Alice");
        assert_eq!(
            compiled.frontmatter.published_at.as_deref(),
            Some("2025-01-10T08:00:00Z")
        );
        assert_eq!(
            compiled.frontmatter.updated_at.as_deref(),
            Some("2026-11-22T12:00:00Z")
        );
    }

    #[test]
    fn compiles_pixel_sticker_directive_blocks() {
        let md = r#"
正文第一段。

:::pixel[cat]{anchor="block" x="86.5" y="14" rotate="-15" scale="1.35" flip="true" locked="true" layer="behind" caption="锁定贴纸"}

:::margin[ice:pin | 贴纸后批注]

:::pixel[lightbulb]{align="right" size="lg" caption="灵感闪现 · 手账装饰"}

:::pixel[unknown-sprite]{align="bad" size="huge"}
:::
"#;
        let doc = compile_notebook_markdown(md);
        assert_eq!(doc.blocks.len(), 4);

        match &doc.blocks[0] {
            NotebookBlock::Paragraph { margin_note, .. } => {
                assert_eq!(margin_note.as_deref(), Some("ice:pin | 贴纸后批注"));
            }
            other => panic!("expected Paragraph block with margin_note, got {other:?}"),
        }

        match &doc.blocks[1] {
            NotebookBlock::PixelSticker {
                sprite,
                anchor,
                x,
                y,
                rotate,
                scale,
                flip,
                locked,
                layer,
                caption,
                ..
            } => {
                assert_eq!(sprite, "cat");
                assert_eq!(anchor.as_deref(), Some("block"));
                assert_eq!(*x, Some(86.5));
                assert_eq!(*y, Some(14.0));
                assert_eq!(*rotate, Some(-15.0));
                assert_eq!(*scale, Some(1.35));
                assert_eq!(*flip, Some(true));
                assert_eq!(*locked, Some(true));
                assert_eq!(layer.as_deref(), Some("behind"));
                assert_eq!(caption.as_deref(), Some("锁定贴纸"));
            }
            other => panic!("expected posable PixelSticker block, got {other:?}"),
        }

        match &doc.blocks[2] {
            NotebookBlock::PixelSticker {
                sprite,
                align,
                size,
                anchor,
                caption,
                ..
            } => {
                assert_eq!(sprite, "lightbulb");
                assert_eq!(align.as_deref(), Some("right"));
                assert_eq!(size.as_deref(), Some("lg"));
                assert!(anchor.is_none());
                assert_eq!(caption.as_deref(), Some("灵感闪现 · 手账装饰"));
            }
            other => panic!("expected PixelSticker block, got {other:?}"),
        }

        match &doc.blocks[3] {
            NotebookBlock::PixelSticker {
                sprite,
                align,
                size,
                caption,
                ..
            } => {
                assert_eq!(sprite, "cat");
                assert_eq!(align.as_deref(), Some("center"));
                assert_eq!(size.as_deref(), Some("md"));
                assert!(caption.is_none());
            }
            other => panic!("expected fallback PixelSticker block, got {other:?}"),
        }
    }

    #[test]
    fn compiles_rich_inline_spans_kbd_and_block_format_directives() {
        let md = r#"
## **快速开始** <kbd class="ink-kbd">Ctrl</kbd>
:::format{align="center"}

按下 <span class="ink-kbd-combo"><kbd class="ink-kbd">Ctrl</kbd><span class="ink-kbd-sep">+</span><kbd class="ink-kbd">K</kbd></span> 打开搜索，查看 <code class="ink-inline-code">cargo test</code> 并重点标出 <span class="ink-fg-ice ink-bg-amber ink-size-xl">高亮文本</span> 与 <mark class="ink-hl-violet">荧光划痕</mark>。
:::format{align="center" size="lg"}
:::pixel[lightbulb]{anchor="block" x="85" y="15" rotate="0" scale="1"}
:::margin[violet:tape | 带样式旁注]

:::tip[提示]{align="right" size="sm"}
支持 **对齐** 与 <kbd class="ink-kbd">Esc</kbd> 返回。
:::
"#;
        let doc = compile_notebook_markdown(md);
        assert_eq!(doc.toc.len(), 1);
        assert_eq!(doc.toc[0].text, "快速开始 Ctrl");

        match &doc.blocks[0] {
            NotebookBlock::Heading { text, align, .. } => {
                assert!(text.contains("<strong>快速开始</strong>"));
                assert!(text.contains("<kbd class=\"ink-kbd\">Ctrl</kbd>"));
                assert_eq!(align.as_deref(), Some("center"));
            }
            other => panic!("expected Heading block, got {other:?}"),
        }

        match &doc.blocks[1] {
            NotebookBlock::Paragraph {
                html,
                align,
                size,
                margin_note,
                ..
            } => {
                assert!(html.contains("ink-kbd-combo"));
                assert!(html.contains("ink-inline-code"));
                assert!(html.contains("ink-fg-ice"));
                assert!(html.contains("ink-bg-amber"));
                assert!(html.contains("ink-size-xl"));
                assert!(html.contains("ink-hl-violet"));
                assert_eq!(align.as_deref(), Some("center"));
                assert_eq!(size.as_deref(), Some("lg"));
                assert_eq!(margin_note.as_deref(), Some("violet:tape | 带样式旁注"));
            }
            other => panic!("expected formatted Paragraph block, got {other:?}"),
        }

        match &doc.blocks[3] {
            NotebookBlock::Alert { align, size, .. } => {
                assert_eq!(align.as_deref(), Some("right"));
                assert_eq!(size.as_deref(), Some("sm"));
            }
            other => panic!("expected formatted Alert block, got {other:?}"),
        }
    }

    #[test]
    fn toc_plain_text_decodes_ampersands_without_double_escaping() {
        let md = "## Section 1: Inline Typography & Alerts\n\nBody with `a & b`.\n";
        let doc = compile_notebook_markdown(md);
        assert_eq!(doc.toc.len(), 1);
        assert_eq!(doc.toc[0].text, "Section 1: Inline Typography & Alerts");
    }

    #[test]
    fn block_ids_remain_stable_when_inserting_paragraphs_above() {
        let before = "## Intro\n\nTarget paragraph that carries a reader margin note.\n\nSecond identical line.\n\nSecond identical line.\n";
        let after = "## Intro\n\nNewly inserted preface paragraph.\n\nAnother new paragraph.\n\nTarget paragraph that carries a reader margin note.\n\nSecond identical line.\n\nSecond identical line.\n";
        let doc_before = compile_notebook_markdown(before);
        let doc_after = compile_notebook_markdown(after);

        let id_of = |doc: &CompiledDocument, needle: &str| -> Vec<String> {
            doc.blocks
                .iter()
                .filter_map(|b| match b {
                    NotebookBlock::Paragraph { block_id, html, .. } if html.contains(needle) => {
                        Some(block_id.clone())
                    }
                    _ => None,
                })
                .collect()
        };

        assert_eq!(
            id_of(&doc_before, "Target paragraph"),
            id_of(&doc_after, "Target paragraph")
        );
        let dup_before = id_of(&doc_before, "Second identical");
        let dup_after = id_of(&doc_after, "Second identical");
        assert_eq!(dup_before.len(), 2);
        assert_ne!(dup_before[0], dup_before[1]);
        assert_eq!(dup_before, dup_after);
    }

    #[test]
    fn sanitize_user_note_supports_safe_markdown_and_strips_xss() {
        let md = "**关键点** 和 `cargo test` 以及 ~~旧方案~~\n第二行<script>alert(1)</script><img src=x onerror=alert(2)>";
        let html = sanitize_user_note(md);
        assert!(html.contains("<strong>关键点</strong>"), "html={html}");
        assert!(html.contains("<code>cargo test</code>"), "html={html}");
        assert!(html.contains("<del>旧方案</del>"), "html={html}");
        assert!(html.contains("<br>"), "html={html}");
        assert!(!html.contains("<script>"));
        assert!(!html.contains("onerror"));
        assert!(!html.contains("<img"));
    }

    #[test]
    fn guest_cookie_signing_roundtrip_and_tamper_rejection() {
        let secret = "super-secret-guest-signing-key-for-tests";
        let signed = crypto::sign_guest_learner_cookie("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", secret)
            .expect("sign");
        assert_eq!(
            crypto::verify_guest_learner_cookie(&signed, secret).as_deref(),
            Some("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")
        );
        // Tampered ID or signature must fail verification
        let tampered = signed.replace("9b1deb4d", "00000000");
        assert!(crypto::verify_guest_learner_cookie(&tampered, secret).is_none());
        assert!(crypto::verify_guest_learner_cookie(&signed, "wrong-secret").is_none());
    }

    #[test]
    fn exports_notes_to_rfc7763_markdown_and_w3c_jsonld() {
        let now = Utc::now();
        let note = UserMarginNoteDto {
            id: Uuid::new_v4(),
            learner_id: "user:test".to_string(),
            step_id: Uuid::new_v4(),
            locale_code: "zh-CN".to_string(),
            block_anchor_id: "p-12345678".to_string(),
            note_color: "amber:tape:idea".to_string(),
            tone: "amber".to_string(),
            style: "tape".to_string(),
            tag: "idea".to_string(),
            motivation: "commenting".to_string(),
            target: Some(AnnotationTarget {
                source: "urn:icehandnote:step:1".to_string(),
                source_revision: 2,
                selector: vec![
                    AnnotationSelector::FragmentSelector {
                        conforms_to: "https://icehandnote.dev/spec/block-id".to_string(),
                        value: "p-12345678".to_string(),
                    },
                    AnnotationSelector::TextQuoteSelector {
                        exact: "核心引用".to_string(),
                        prefix: "前文".to_string(),
                        suffix: "后文".to_string(),
                    },
                ],
            }),
            body_format: "text/markdown".to_string(),
            content_html: "<strong>灵感</strong>".to_string(),
            raw_content: "**灵感**".to_string(),
            version: 2,
            created_at: now,
            updated_at: now,
            deleted_at: None,
            track_slug: Some("getting-started".to_string()),
            chapter_slug: Some("01-welcome".to_string()),
            step_slug: Some("01-welcome-to-icehandnote".to_string()),
            step_title: Some("欢迎来到 IceHandnote".to_string()),
        };

        let md = export_notes_as_markdown(std::slice::from_ref(&note), "IceHandnote");
        assert!(md.contains("欢迎来到 IceHandnote"));
        assert!(md.contains("> 核心引用"));
        assert!(md.contains("**灵感**"));

        let jsonld = export_notes_as_w3c_jsonld(&[note], "https://notes.example.com");
        assert_eq!(jsonld["@context"], "http://www.w3.org/ns/anno.jsonld");
        assert_eq!(jsonld["type"], "AnnotationCollection");
        assert_eq!(jsonld["total"], 1);
        assert_eq!(jsonld["items"][0]["type"], "Annotation");
        assert_eq!(jsonld["items"][0]["body"]["format"], "text/markdown");
    }

    #[test]
    fn generates_rfc9562_uuid_v7_with_version_and_variant() {
        let id = generate_uuid_v7();
        assert_eq!(id.get_version_num(), 7);
        assert_eq!(id.get_variant(), uuid::Variant::RFC4122);
    }

    #[test]
    fn compiles_explicit_custom_block_anchors_and_preserves_inline_code() {
        let md = "## Architecture Overview {#arch-overview}\n\nParagraph content stays anchored here. {#p-custom-intro}\n\nKeep inline code literal `{#not-an-anchor}` please.";
        let doc = compile_notebook_markdown(md);

        match &doc.blocks[0] {
            NotebookBlock::Heading { block_id, text, .. } => {
                assert_eq!(block_id, "arch-overview");
                assert!(!text.contains("{#arch-overview}"));
                assert!(text.contains("Architecture Overview"));
            }
            other => panic!("expected Heading, got {other:?}"),
        }
        match &doc.blocks[1] {
            NotebookBlock::Paragraph { block_id, html, .. } => {
                assert_eq!(block_id, "p-custom-intro");
                assert!(!html.contains("{#p-custom-intro}"));
                assert!(html.contains("Paragraph content stays anchored here."));
            }
            other => panic!("expected Paragraph, got {other:?}"),
        }
        match &doc.blocks[2] {
            NotebookBlock::Paragraph { block_id, html, .. } => {
                assert!(block_id.starts_with("p-"));
                assert!(html.contains("{#not-an-anchor}"));
            }
            other => panic!("expected Paragraph, got {other:?}"),
        }
        assert_eq!(doc.toc[0].id, "arch-overview");
    }

    #[test]
    fn validates_and_escapes_frontmatter_control_chars() {
        let md = crate::auth::format_step_markdown_file_with_full_meta(
            "Title with \"quotes\"\nand control\x07",
            "Summary\\path\twith tab",
            1,
            5,
            1,
            1,
            "published",
            "cc-by-4.0",
            "Author\nLine",
            None,
            None,
            &["tag\"a".to_string()],
            None,
            "Body text",
        );
        assert!(
            validate_step_frontmatter(&md).is_ok(),
            "escaped frontmatter must parse cleanly:\n{md}"
        );

        let unterminated = "+++\ntitle = \"Broken\"\n\nBody";
        assert!(validate_step_frontmatter(unterminated).is_err());

        let bad_status = "+++\ntitle = \"Bad\"\nstatus = \"archived\"\n+++\n\nBody";
        assert!(validate_step_frontmatter(bad_status).is_err());
    }

    #[test]
    fn enforces_ammonia_class_allowlist_and_link_rel() {
        let dirty = r#"<mark class="ink-hl-amber evil-injected">Highlight</mark> <span class="ink-fg-violet bad-span">Fg</span> <a href="https://example.com" class="ink-inline-link attacker-cls" target="_blank">SafeLink</a> <a href="javascript:alert(1)">BadLink</a>"#;
        let clean = sanitize_rich_fragment(dirty);
        assert!(clean.contains("ink-hl-amber"), "clean={clean}");
        assert!(clean.contains("ink-fg-violet"), "clean={clean}");
        assert!(clean.contains("ink-inline-link"), "clean={clean}");
        assert!(!clean.contains("evil-injected"), "clean={clean}");
        assert!(!clean.contains("bad-span"), "clean={clean}");
        assert!(!clean.contains("attacker-cls"), "clean={clean}");
        assert!(clean.contains(r#"rel="noopener noreferrer""#), "clean={clean}");
        assert!(!clean.contains("javascript:"), "clean={clean}");
    }
}
