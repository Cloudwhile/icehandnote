-- IceHandnote Migration 0010: Session IP/Device Tracking, Trusted Devices, Login Anomaly OTP & Reset OTP

ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_label TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_fingerprint TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE user_sessions
SET id = md5(token_hash)::uuid
WHERE id IS NULL;

ALTER TABLE user_sessions
    ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_id ON user_sessions(id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_last_seen ON user_sessions(user_id, last_seen_at DESC);

ALTER TABLE password_reset_tokens
    ADD COLUMN IF NOT EXISTS code_hash VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_trusted_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT NOT NULL,
    device_fingerprint TEXT NOT NULL,
    device_label TEXT NOT NULL DEFAULT '',
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, ip_address, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON user_trusted_devices(user_id);

CREATE TABLE IF NOT EXISTS login_otp_challenges (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(180) NOT NULL,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    device_label TEXT NOT NULL DEFAULT '',
    device_fingerprint TEXT NOT NULL DEFAULT '',
    anomaly_reason VARCHAR(40) NOT NULL DEFAULT 'new_ip',
    code_hash VARCHAR(128) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_otp_user ON login_otp_challenges(user_id);
