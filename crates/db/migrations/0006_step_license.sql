-- IceHandNote Migration 0006: Per-Article Creative Commons / License Column

ALTER TABLE step_translations
    ADD COLUMN IF NOT EXISTS license VARCHAR(40) NOT NULL DEFAULT '';
