-- Safety Guardian: AI Safety Logs
-- Stores all Guardian critique outputs for quality analysis

CREATE TABLE IF NOT EXISTS ai_safety_logs (
    id SERIAL PRIMARY KEY,
    user_strava_id TEXT NOT NULL,
    coach_draft TEXT NOT NULL,
    guardian_response JSONB NOT NULL,  -- { isSafe, critique, recommendedChanges }
    iteration_number INTEGER DEFAULT 1,
    final_plan_approved BOOLEAN DEFAULT false,
    strava_context JSONB,  -- Snapshot of relevant Strava data for debugging
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user-specific queries
CREATE INDEX IF NOT EXISTS idx_safety_logs_user ON ai_safety_logs(user_strava_id);

-- Index for time-based analysis
CREATE INDEX IF NOT EXISTS idx_safety_logs_created ON ai_safety_logs(created_at DESC);

-- Comment for documentation
COMMENT ON TABLE ai_safety_logs IS 'Stores Safety Guardian AI critique responses for training plan validation. Used for quality analysis and debugging.';
