-- IceHandnote Migration 0015: Field Sizing, Revision Sequence Uniqueness & Missing Query Indexes

ALTER TABLE email_verification_codes
    ALTER COLUMN email TYPE VARCHAR(255);

ALTER TABLE login_otp_challenges
    ALTER COLUMN email TYPE VARCHAR(255);

ALTER TABLE collaboration_invites
    ALTER COLUMN email TYPE VARCHAR(255);

DELETE FROM step_revisions a
USING step_revisions b
WHERE a.step_id = b.step_id
  AND a.locale_code = b.locale_code
  AND a.edit_seq = b.edit_seq
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.ctid < b.ctid));

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_revisions_unique_seq
    ON step_revisions (step_id, locale_code, edit_seq);

CREATE INDEX IF NOT EXISTS idx_step_collaborators_user_id
    ON step_collaborators (user_id);

CREATE INDEX IF NOT EXISTS idx_steps_owner_user_id
    ON steps (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
    ON password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
    ON user_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_margin_notes_deleted_at
    ON user_margin_notes (deleted_at)
    WHERE deleted_at IS NOT NULL;
