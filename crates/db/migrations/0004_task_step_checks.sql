-- IceHandNote Migration 0004: In-Article Interactive Checkable Step Tasks
-- Tracks per-learner checked state for individual interactive step items (`:::steps[...]`) inside an article.

CREATE TABLE IF NOT EXISTS learner_task_checks (
    learner_id VARCHAR(120) NOT NULL,
    step_id UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    task_item_id VARCHAR(80) NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (learner_id, step_id, task_item_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_task_checks_lookup
    ON learner_task_checks (learner_id, step_id);
