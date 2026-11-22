-- IceHandnote Migration 0013: W3C Web Annotation Targets, Orthogonal Sticker Metadata,
-- RFC 7396 Partial Updates, Optimistic Concurrency Versioning, and Soft-Delete Undo for Reader Notes.

ALTER TABLE user_margin_notes
    ADD COLUMN IF NOT EXISTS tone VARCHAR(16) NOT NULL DEFAULT 'amber',
    ADD COLUMN IF NOT EXISTS style VARCHAR(16) NOT NULL DEFAULT 'tape',
    ADD COLUMN IF NOT EXISTS tag VARCHAR(16) NOT NULL DEFAULT 'note',
    ADD COLUMN IF NOT EXISTS motivation VARCHAR(24) NOT NULL DEFAULT 'commenting',
    ADD COLUMN IF NOT EXISTS target JSONB,
    ADD COLUMN IF NOT EXISTS body_format VARCHAR(32) NOT NULL DEFAULT 'text/markdown',
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill orthogonal tone/style/tag from legacy "<tone>:<style>:<tag>" note_color strings
UPDATE user_margin_notes
SET
    tone = CASE split_part(lower(note_color), ':', 1)
        WHEN 'amber' THEN 'amber'
        WHEN 'yellow' THEN 'amber'
        WHEN 'violet' THEN 'violet'
        WHEN 'purple' THEN 'violet'
        WHEN 'ice' THEN 'ice'
        WHEN 'blue' THEN 'ice'
        WHEN 'mint' THEN 'mint'
        WHEN 'green' THEN 'mint'
        WHEN 'coral' THEN 'coral'
        WHEN 'pink' THEN 'coral'
        WHEN 'rose' THEN 'coral'
        WHEN 'paper' THEN 'paper'
        ELSE tone
    END,
    style = CASE split_part(lower(note_color), ':', 2)
        WHEN 'tape' THEN 'tape'
        WHEN 'pin' THEN 'pin'
        WHEN 'torn' THEN 'torn'
        WHEN 'clip' THEN 'clip'
        WHEN 'stamp' THEN 'stamp'
        WHEN 'tag' THEN 'tag'
        WHEN 'looseleaf' THEN 'looseleaf'
        ELSE style
    END,
    tag = CASE split_part(lower(note_color), ':', 3)
        WHEN 'note' THEN 'note'
        WHEN 'idea' THEN 'idea'
        WHEN 'ask' THEN 'ask'
        WHEN 'star' THEN 'star'
        WHEN 'todo' THEN 'todo'
        ELSE tag
    END,
    updated_at = COALESCE(updated_at, created_at)
WHERE position(':' IN note_color) > 0;

CREATE INDEX IF NOT EXISTS idx_margin_notes_owner_step_locale
    ON user_margin_notes (learner_id, step_id, locale_code)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_margin_notes_owner_tag_created
    ON user_margin_notes (learner_id, tag, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_margin_notes_content_trgm
    ON user_margin_notes USING gin (raw_content gin_trgm_ops)
    WHERE deleted_at IS NULL;
