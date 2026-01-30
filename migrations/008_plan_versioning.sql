-- Plan versioning for training blocks
-- Enables tracking of plan modifications over time

-- Add version column to training_blocks
ALTER TABLE training_blocks ADD COLUMN IF NOT EXISTS plan_version INT DEFAULT 1;

-- Create changelog table for tracking all plan modifications
CREATE TABLE IF NOT EXISTS plan_changelog (
    id SERIAL PRIMARY KEY,
    block_id INT REFERENCES training_blocks(id) ON DELETE CASCADE,
    version INT NOT NULL,
    change_type VARCHAR(50) NOT NULL,  -- 'created', 'volume_adjusted', 'phase_modified', 'compliance_adaptation'
    reason TEXT NOT NULL,
    volume_change_pct NUMERIC(5,2),     -- e.g., -10.00 for 10% reduction
    old_plan_snapshot JSONB,            -- Previous plan state (for rollback capability)
    week_number INT,                    -- Which week triggered the change
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient changelog queries
CREATE INDEX IF NOT EXISTS idx_plan_changelog_block ON plan_changelog(block_id);
CREATE INDEX IF NOT EXISTS idx_plan_changelog_created ON plan_changelog(created_at DESC);
