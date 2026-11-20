-- IceHandNote PostgreSQL 17 Schema Migration 0001
-- Supports multilingual tutorials, revision drift detection, full-text search (PGroonga / pg_trgm),
-- learner progress sync, and paragraph-anchored handwritten margin sticky notes.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Optional PGroonga extension when running on groonga/pgroonga:latest-alpine-17
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgroonga') THEN
    CREATE EXTENSION IF NOT EXISTS pgroonga;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS locales (
    code VARCHAR(16) PRIMARY KEY,
    display_name VARCHAR(64) NOT NULL,
    direction VARCHAR(8) NOT NULL DEFAULT 'ltr',
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO locales (code, display_name, direction, is_default) VALUES
    ('zh-TW', '繁體中文', 'ltr', TRUE),
    ('zh-CN', '简体中文', 'ltr', FALSE),
    ('en',    'English',  'ltr', FALSE),
    ('ja',    '日本語',   'ltr', FALSE)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS tracks (
    id UUID PRIMARY KEY,
    slug VARCHAR(120) UNIQUE NOT NULL,
    difficulty VARCHAR(32) NOT NULL DEFAULT 'intermediate',
    icon_kind VARCHAR(32) NOT NULL DEFAULT 'snowflake',
    tags TEXT[] NOT NULL DEFAULT '{}',
    sort_order INT NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS track_translations (
    track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    locale_code VARCHAR(16) NOT NULL REFERENCES locales(code),
    title VARCHAR(240) NOT NULL,
    subtitle VARCHAR(320) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (track_id, locale_code)
);

CREATE TABLE IF NOT EXISTS chapters (
    id UUID PRIMARY KEY,
    track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    slug VARCHAR(120) NOT NULL,
    chapter_number INT NOT NULL DEFAULT 1,
    UNIQUE (track_id, slug)
);

CREATE TABLE IF NOT EXISTS chapter_translations (
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    locale_code VARCHAR(16) NOT NULL REFERENCES locales(code),
    title VARCHAR(240) NOT NULL,
    PRIMARY KEY (chapter_id, locale_code)
);

CREATE TABLE IF NOT EXISTS steps (
    id UUID PRIMARY KEY,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    slug VARCHAR(120) NOT NULL,
    step_number INT NOT NULL DEFAULT 1,
    default_locale VARCHAR(16) NOT NULL DEFAULT 'zh-TW' REFERENCES locales(code),
    canonical_revision INT NOT NULL DEFAULT 1,
    estimated_minutes INT NOT NULL DEFAULT 10,
    likes_count BIGINT NOT NULL DEFAULT 0,
    UNIQUE (chapter_id, slug)
);

CREATE TABLE IF NOT EXISTS step_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    locale_code VARCHAR(16) NOT NULL REFERENCES locales(code),
    title VARCHAR(280) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    raw_markdown TEXT NOT NULL,
    compiled_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
    toc_tree JSONB NOT NULL DEFAULT '[]'::jsonb,
    plain_text TEXT NOT NULL DEFAULT '',
    synced_revision INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (step_id, locale_code)
);

-- Composite lookup & trigram search indexes (fast CJK + Latin substring & similarity search)
CREATE INDEX IF NOT EXISTS idx_step_translations_step_locale
    ON step_translations (step_id, locale_code);

CREATE INDEX IF NOT EXISTS idx_step_translations_title_trgm
    ON step_translations USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_step_translations_plain_trgm
    ON step_translations USING gin (plain_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS glossary_terms (
    slug VARCHAR(80) NOT NULL,
    locale_code VARCHAR(16) NOT NULL REFERENCES locales(code),
    term VARCHAR(120) NOT NULL,
    canonical_en VARCHAR(120) NOT NULL,
    definition TEXT NOT NULL,
    PRIMARY KEY (slug, locale_code)
);

CREATE TABLE IF NOT EXISTS learner_step_progress (
    learner_id VARCHAR(120) NOT NULL,
    step_id UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (learner_id, step_id)
);

CREATE TABLE IF NOT EXISTS user_margin_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id VARCHAR(120) NOT NULL,
    step_id UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    locale_code VARCHAR(16) NOT NULL REFERENCES locales(code),
    block_anchor_id VARCHAR(80) NOT NULL,
    note_color VARCHAR(24) NOT NULL DEFAULT 'yellow',
    raw_content TEXT NOT NULL,
    content_html TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_margin_notes_step_learner
    ON user_margin_notes (step_id, learner_id);
