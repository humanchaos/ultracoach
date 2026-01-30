-- Training Plan Persistence
-- Stores generated weekly plans for comparison and adaptation tracking

CREATE TABLE IF NOT EXISTS training_plans (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL REFERENCES strava_users(strava_id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    plan_json JSONB NOT NULL,
    model_used VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_strava_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_training_plans_user ON training_plans(user_strava_id);
CREATE INDEX IF NOT EXISTS idx_training_plans_week ON training_plans(week_start);
