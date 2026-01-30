-- Migration: Add races and user_preferences tables
-- Run this in your Vercel Postgres dashboard or via SQL client

-- Races table to store upcoming events
CREATE TABLE IF NOT EXISTS races (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL REFERENCES strava_users(strava_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    distance_km DECIMAL(6,2) NOT NULL,
    race_type VARCHAR(50) NOT NULL CHECK (race_type IN ('ultra', 'marathon', 'half', '10k', '5k', 'other')),
    goal_time VARCHAR(50),
    priority CHAR(1) NOT NULL DEFAULT 'B' CHECK (priority IN ('A', 'B', 'C')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups by user
CREATE INDEX IF NOT EXISTS idx_races_user ON races(user_strava_id);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(date);

-- User preferences table for remembering training preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL UNIQUE REFERENCES strava_users(strava_id) ON DELETE CASCADE,
    training_days JSONB DEFAULT '["mon", "tue", "wed", "thu", "fri", "sat", "sun"]'::jsonb,
    long_run_day VARCHAR(20) DEFAULT 'sunday',
    max_weekly_km INTEGER DEFAULT 80,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_strava_id);
