-- IceHandnote Migration 0014: Collaboration RFC Upgrade
-- Adds ETag/OCC edit_seq & content_sha256 on step_translations,
-- granular collaborator roles & locale scopes, invite lifecycle timestamps
-- (for exact 410 Gone vs 404 Not Found status codes), immutable step_revisions,
-- and collaboration_audit_logs.

ALTER TABLE step_translations
    ADD COLUMN IF NOT EXISTS edit_seq BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS content_sha256 VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_editor_name TEXT NOT NULL DEFAULT '';

ALTER TABLE step_collaborators
    ADD COLUMN IF NOT EXISTS role VARCHAR(24) NOT NULL DEFAULT 'editor',
    ADD COLUMN IF NOT EXISTS locale_scope TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE collaboration_invites
    ADD COLUMN IF NOT EXISTS role VARCHAR(24) NOT NULL DEFAULT 'editor',
    ADD COLUMN IF NOT EXISTS locale_scope TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_invites_active_step_email
    ON collaboration_invites (step_id, LOWER(email))
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS step_revisions (
    id              UUID PRIMARY KEY,
    step_id         UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    locale_code     VARCHAR(16) NOT NULL REFERENCES locales(code),
    edit_seq        BIGINT NOT NULL,
    synced_revision INT NOT NULL DEFAULT 1,
    status          VARCHAR(16) NOT NULL DEFAULT 'draft',
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    body_markdown   TEXT NOT NULL,
    content_sha256  VARCHAR(64) NOT NULL,
    author_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name     TEXT NOT NULL DEFAULT '',
    change_note     TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_step_revisions_step_locale_seq
    ON step_revisions (step_id, locale_code, edit_seq DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS collaboration_audit_logs (
    id              UUID PRIMARY KEY,
    step_id         UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name      TEXT NOT NULL DEFAULT '',
    action          VARCHAR(48) NOT NULL,
    detail          TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_audit_logs_step_created
    ON collaboration_audit_logs (step_id, created_at DESC);
