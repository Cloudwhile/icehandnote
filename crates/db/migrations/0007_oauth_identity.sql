-- IceHandnote Migration 0007: Federated OAuth Identity Columns

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(64),
    ADD COLUMN IF NOT EXISTS oauth_sub VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_identity
    ON users (oauth_provider, oauth_sub)
    WHERE oauth_provider IS NOT NULL AND oauth_sub IS NOT NULL;
