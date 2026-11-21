use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadingStats {
    pub estimated_minutes: i32,
    pub cjk_chars: usize,
    pub latin_words: usize,
    pub code_lines: usize,
    pub media_count: usize,
}

fn is_cjk_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3040..=0x30FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xAC00..=0xD7AF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2EBFF
    )
}

/// Strip HTML tags so inline markup does not inflate word count.
pub fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' && in_tag {
            in_tag = false;
            out.push(' ');
        } else if !in_tag {
            out.push(ch);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Deterministically predict reading time for multilingual technical articles:
/// - CJK prose: ~350 characters / min
/// - Non-CJK prose words: ~220 words / min
/// - Code blocks: ~18 lines / min
/// - Diagrams & images: +12 seconds each
/// - Interactive task items: +6 seconds each
pub fn estimate_reading_stats(raw_markdown: &str) -> ReadingStats {
    let body = crate::auth::extract_body_without_frontmatter(raw_markdown);

    let mut in_code_fence = false;
    let mut is_sketch_fence = false;
    let mut code_lines = 0usize;
    let mut media_count = 0usize;
    let mut task_items = 0usize;
    let mut prose_buf = String::with_capacity(body.len());

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            if !in_code_fence {
                in_code_fence = true;
                let info = trimmed.trim_start_matches('`').trim();
                is_sketch_fence = info == "sketch" || info.starts_with("sketch ");
                if is_sketch_fence {
                    media_count += 1;
                }
            } else {
                in_code_fence = false;
                is_sketch_fence = false;
            }
            continue;
        }

        if in_code_fence {
            if !is_sketch_fence && !trimmed.is_empty() {
                code_lines += 1;
            }
            continue;
        }

        if trimmed.starts_with(":::") {
            continue;
        }

        if trimmed.starts_with("![") && trimmed.contains("](") {
            media_count += 1;
        }

        if trimmed.starts_with("- [ ]")
            || trimmed.starts_with("- [x]")
            || trimmed.starts_with("- [X]")
            || trimmed.starts_with("* [ ]")
            || trimmed.starts_with("* [x]")
            || trimmed.contains("## [ ]")
            || trimmed.contains("## [x]")
        {
            task_items += 1;
        }

        prose_buf.push_str(trimmed);
        prose_buf.push(' ');
    }

    let clean_prose = strip_html_tags(&prose_buf);
    let mut cjk_chars = 0usize;
    let mut latin_words = 0usize;
    let mut in_latin_word = false;

    for ch in clean_prose.chars() {
        if is_cjk_char(ch) {
            cjk_chars += 1;
            if in_latin_word {
                latin_words += 1;
                in_latin_word = false;
            }
        } else if ch.is_alphanumeric() {
            in_latin_word = true;
        } else if in_latin_word {
            latin_words += 1;
            in_latin_word = false;
        }
    }
    if in_latin_word {
        latin_words += 1;
    }

    let total_minutes_f64 = (cjk_chars as f64 / 350.0)
        + (latin_words as f64 / 220.0)
        + (code_lines as f64 / 18.0)
        + (media_count as f64 * 0.20)
        + (task_items as f64 * 0.10);

    let estimated_minutes = (total_minutes_f64.ceil() as i32).clamp(1, 180);

    ReadingStats {
        estimated_minutes,
        cjk_chars,
        latin_words,
        code_lines,
        media_count,
    }
}

pub fn estimate_reading_minutes(raw_markdown: &str) -> i32 {
    estimate_reading_stats(raw_markdown).estimated_minutes
}
