-- Migration 009: User Journal (Life Context Engine)
-- Stores daily wellness metrics for holistic coaching

CREATE TABLE IF NOT EXISTS user_journal (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL REFERENCES strava_users(strava_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    -- Wellness Scores (1-10 scale)
    sleep_quality INT CHECK (sleep_quality IS NULL OR sleep_quality BETWEEN 1 AND 10),
    stress_level INT CHECK (stress_level IS NULL OR stress_level BETWEEN 1 AND 10),
    nutrition_score INT CHECK (nutrition_score IS NULL OR nutrition_score BETWEEN 1 AND 10),
    
    -- Context
    notes TEXT,
    tags TEXT[] DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One entry per user per day
    UNIQUE(user_strava_id, date)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_user_journal_user ON user_journal(user_strava_id);
CREATE INDEX IF NOT EXISTS idx_user_journal_date ON user_journal(date DESC);
CREATE INDEX IF NOT EXISTS idx_user_journal_user_date ON user_journal(user_strava_id, date DESC);
