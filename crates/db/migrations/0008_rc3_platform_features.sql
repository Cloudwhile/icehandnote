-- IceHandnote Migration 0008: Avatar Sources, User Moderation, Co-Author Collaboration, Password Resets & Article Takedowns

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_source VARCHAR(24) NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS oauth_avatar_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS uploaded_avatar_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ban_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE steps
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS takedown_reason TEXT,
    ADD COLUMN IF NOT EXISTS takedown_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS takedown_by TEXT;

CREATE TABLE IF NOT EXISTS step_collaborators (
    step_id UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (step_id, user_id)
);

CREATE TABLE IF NOT EXISTS collaboration_invites (
    id UUID PRIMARY KEY,
    step_id UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    email VARCHAR(180) NOT NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_invites_step ON collaboration_invites(step_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
