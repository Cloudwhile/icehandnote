-- IceHandnote Migration 0009: Registration Email Verification Codes

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id UUID PRIMARY KEY,
    email VARCHAR(180) NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_verify_email_created
    ON email_verification_codes(LOWER(email), created_at DESC);
