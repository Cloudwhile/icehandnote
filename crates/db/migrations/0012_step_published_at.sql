-- Migration 0012: Track explicit chapter publication timestamp (`published_at`) separately from `updated_at`.
ALTER TABLE step_translations
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

UPDATE step_translations
SET published_at = updated_at
WHERE published_at IS NULL;

ALTER TABLE step_translations
    ALTER COLUMN published_at SET DEFAULT NOW(),
    ALTER COLUMN published_at SET NOT NULL;
