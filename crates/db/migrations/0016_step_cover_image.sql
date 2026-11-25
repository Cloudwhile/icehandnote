-- 0016_step_cover_image.sql
-- Adds optional cover_image URL/path on step_translations for article banner thumbnails.

ALTER TABLE step_translations
    ADD COLUMN IF NOT EXISTS cover_image TEXT NOT NULL DEFAULT '';
