-- IceHandNote Migration 0002: External SSO User Bridge, RBAC & Studio Authoring

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wp_user_id BIGINT UNIQUE,
    username VARCHAR(80) UNIQUE NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    role VARCHAR(24) NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'author', 'admin')),
    auth_source VARCHAR(32) NOT NULL DEFAULT 'external-sso',
    password_hash TEXT,
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);

-- Track authoring & draft workflow columns
ALTER TABLE step_translations
    ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
    ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS author_name VARCHAR(120) NOT NULL DEFAULT 'Author';
