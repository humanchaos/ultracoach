-- Migration: Add goals table for user training goals
-- Run this in Neon SQL Editor

CREATE TABLE IF NOT EXISTS user_goals (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL UNIQUE,
    goal_type VARCHAR(50) NOT NULL DEFAULT 'maintain',
    -- Goal types: 'maintain', 'get_faster', 'lose_weight', 'run_longer', 'competition'
    
    -- For competition goals
    target_race_id INTEGER REFERENCES races(id) ON DELETE SET NULL,
    target_pace VARCHAR(20),
    
    -- User profile for personalization
    weekly_mileage_km INTEGER DEFAULT 30,
    running_experience VARCHAR(50) DEFAULT 'intermediate',
    -- 'beginner', 'intermediate', 'advanced', 'elite'
    injuries_notes TEXT,
    
    -- Post-race tracking
    last_race_date DATE,
    last_race_distance_km DECIMAL(6,2),
    recovery_end_date DATE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_goals_strava ON user_goals(user_strava_id);
