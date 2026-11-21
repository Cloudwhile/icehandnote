pub mod auth;
pub mod crypto;
pub mod error;
pub mod mail_templates;
pub mod reading_time;
pub mod settings;

use ammonia::Builder as HtmlSanitizer;
use chrono::{DateTime, Utc};
use pulldown_cmark::{html, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
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
    },
    Paragraph {
        block_id: String,
        html: String,
        margin_note: Option<String>,
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
    #[serde(default)]
    pub tags: Vec<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMarginNoteDto {
    pub id: Uuid,
    pub learner_id: String,
    pub step_id: Uuid,
    pub locale_code: String,
    pub block_anchor_id: String,
    pub note_color: String,
    pub content_html: String,
    pub raw_content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMarginNoteInput {
    pub learner_id: String,
    pub step_id: Uuid,
    pub locale_code: String,
    pub block_anchor_id: String,
    pub note_color: String,
    pub content: String,
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

/// Sanitize user-submitted note/comment text into safe inline HTML (`ammonia` defense-in-depth).
pub fn sanitize_user_note(raw: &str) -> String {
    let escaped = raw
        .trim()
        .chars()
        .take(800)
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\n', "<br>");

    let mut allowed_tags = HashSet::new();
    allowed_tags.insert("b");
    allowed_tags.insert("strong");
    allowed_tags.insert("em");
    allowed_tags.insert("code");
    allowed_tags.insert("br");
    allowed_tags.insert("mark");

    HtmlSanitizer::new()
        .tags(allowed_tags)
        .clean(&escaped)
        .to_string()
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

/// Sanitize customizable inline text fields (site name, hero title/tagline, footer, badges,
/// track/chapter/article titles & summaries) so safe inline HTML tags render cleanly while
/// stripping scripts, event handlers, and unsafe URLs.
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
    generic_attrs.insert("class");
    generic_attrs.insert("title");

    let mut builder = HtmlSanitizer::new();
    builder
        .tags(tags)
        .generic_attributes(generic_attrs)
        .add_tag_attributes("a", &["href", "target"])
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
    generic_attrs.insert("class");
    generic_attrs.insert("title");
    generic_attrs.insert("data-term");

    let mut builder = HtmlSanitizer::new();
    builder
        .tags(tags)
        .generic_attributes(generic_attrs)
        .add_tag_attributes("a", &["href", "target"])
        .add_tag_attributes("img", &["src", "alt", "title", "loading"])
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

fn strip_frontmatter(raw: &str) -> (StepFrontmatter, &str) {
    let normalized = raw.trim_start_matches('\u{feff}');
    if let Some(rest) = normalized.strip_prefix("+++") {
        if let Some(end_idx) = rest.find("\n+++") {
            let toml_str = &rest[..end_idx];
            let body = &rest[end_idx + 4..];
            let fm: StepFrontmatter = toml::from_str(toml_str).unwrap_or_default();
            return (fm, body.trim_start_matches(['\r', '\n']));
        }
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

/// Pre-process custom notebook directives (`:::tip[...] ... :::`, `:::steps[...] ... :::`,
/// and `:::margin[...]`) before Markdown parsing, converting them into fenced markers that
/// preserve block ordering cleanly.
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

                    let payload = serde_json::json!({
                        "kind": kind_raw.to_ascii_lowercase(),
                        "title": title,
                        "body": main_lines.join("\n"),
                        "detail_summary": detail_summary,
                        "detail_body": if detail_lines.is_empty() { None } else { Some(detail_lines.join("\n")) },
                        "style": style_attr,
                        "tone": tone_attr,
                        "badge": badge_attr,
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
    let mut ordinal = 0usize;
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
                let mut raw_text = String::new();
                for ev in events_iter.by_ref() {
                    match ev {
                        Event::End(TagEnd::Heading(_)) => break,
                        Event::Text(t) | Event::InlineHtml(t) | Event::Html(t) => {
                            raw_text.push_str(&t)
                        }
                        Event::Code(t) => {
                            raw_text.push_str("<code>");
                            raw_text.push_str(&t);
                            raw_text.push_str("</code>");
                        }
                        _ => {}
                    }
                }
                let (is_task, default_checked, parsed_head) = parse_heading_task_prefix(&raw_text);
                let text = sanitize_custom_html(&parsed_head, 320);
                let plain_heading = reading_time::strip_html_tags(&text);
                let idx = (lvl as usize).saturating_sub(1).min(3);
                h_counts[idx] += 1;
                for deeper in (idx + 1)..4 {
                    h_counts[deeper] = 0;
                }
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

                ordinal += 1;
                let block_id = stable_block_id("sec", ordinal, &plain_heading);
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
                });
            }

            Event::Start(Tag::Paragraph) => {
                let mut inner_events = Vec::new();
                let mut plain = String::new();
                for ev in events_iter.by_ref() {
                    match ev {
                        Event::End(TagEnd::Paragraph) => break,
                        Event::Text(ref t) | Event::Code(ref t) => {
                            plain.push_str(t);
                            inner_events.push(ev);
                        }
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
                        ordinal += 1;
                        let block_id = stable_block_id("img", ordinal, &format!("{src_str}:{alt_str}"));
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

                let mut html_buf = String::new();
                html::push_html(&mut html_buf, inner_events.into_iter());
                let clean = sanitize_rich_fragment(&html_buf);
                if !clean.trim().is_empty() {
                    ordinal += 1;
                    let block_id = stable_block_id("p", ordinal, &plain);
                    plain_chunks.push(plain);
                    blocks.push(NotebookBlock::Paragraph {
                        block_id,
                        html: clean,
                        margin_note: pending_margin_note.take(),
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
                        // Attach to previous Paragraph/CodeCard if present, else hold for next
                        let mut attached = false;
                        if let Some(last) = blocks.last_mut() {
                            match last {
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
                            ordinal += 1;
                            let seed_title = raw_items
                                .first()
                                .and_then(|it| it.get("title").and_then(|v| v.as_str()))
                                .unwrap_or("");
                            let block_id =
                                stable_block_id("steps", ordinal, &format!("{title}:{seed_title}"));

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

                        ordinal += 1;
                        let block_id = stable_block_id("alert", ordinal, &format!("{title}:{body_raw}"));
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
                        });
                    }
                    continue;
                }

                if trimmed_info == "sketch" || trimmed_info.starts_with("sketch ") {
                    let caption = extract_attr(trimmed_info, "caption");
                    if let Ok(spec) = serde_json::from_str::<SketchSpec>(raw_code.trim()) {
                        ordinal += 1;
                        let block_id = stable_block_id("sketch", ordinal, raw_code.trim());
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
                ordinal += 1;
                let block_id = stable_block_id("code", ordinal, &clean_code);
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
                            let drained: Vec<_> = current_item_events.drain(..).collect();

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
                    ordinal += 1;
                    if is_task_list {
                        let block_id = stable_block_id("steps", ordinal, &items_html[0]);
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
                        let block_id = stable_block_id("list", ordinal, &items_html[0]);
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
                    ordinal += 1;
                    let block_id = stable_block_id("quote", ordinal, &plain);
                    plain_chunks.push(plain);
                    blocks.push(NotebookBlock::Quote {
                        block_id,
                        html: cleaned,
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
}
