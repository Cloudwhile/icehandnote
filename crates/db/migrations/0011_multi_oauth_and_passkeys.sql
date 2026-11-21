-- IceHandnote Migration 0011: Multi-OAuth Account Bindings & WebAuthn Passkey Credentials

CREATE TABLE IF NOT EXISTS user_oauth_bindings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    oauth_avatar_url TEXT NOT NULL DEFAULT '',
    bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, subject),
    UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_oauth_bindings_user ON user_oauth_bindings(user_id);

-- Backfill existing single-provider OAuth bindings from legacy `users` columns
INSERT INTO user_oauth_bindings (id, user_id, provider, subject, oauth_avatar_url)
SELECT md5(id::text || ':' || LOWER(oauth_provider) || ':' || oauth_sub)::uuid,
       id,
       LOWER(oauth_provider),
       oauth_sub,
       COALESCE(oauth_avatar_url, '')
FROM users
WHERE oauth_provider IS NOT NULL
  AND oauth_provider <> ''
  AND oauth_sub IS NOT NULL
  AND oauth_sub <> ''
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS user_passkeys (
    credential_id VARCHAR(512) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key_b64 TEXT NOT NULL,
    alg INTEGER NOT NULL DEFAULT -7,
    counter BIGINT NOT NULL DEFAULT 0,
    aaguid VARCHAR(64) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    name VARCHAR(120) NOT NULL DEFAULT 'Passkey',
    transports TEXT[] NOT NULL DEFAULT '{}',
    device_type VARCHAR(32) NOT NULL DEFAULT 'multiDevice',
    backed_up BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys(user_id);
