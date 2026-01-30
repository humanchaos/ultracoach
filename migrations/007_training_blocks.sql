-- Training blocks: macrocycle plans for each race
-- Each block contains the full periodization from now until race day

CREATE TABLE IF NOT EXISTS training_blocks (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL REFERENCES strava_users(strava_id) ON DELETE CASCADE,
    race_id INT REFERENCES races(id) ON DELETE CASCADE,
    
    -- Block timing
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,  -- Race day
    
    -- AI-generated periodization
    block_plan JSONB NOT NULL,
    -- Structure: {
    --   "totalWeeks": 10,
    --   "phases": [
    --     {"name": "Base", "weeks": 4, "focus": "Aerobic volume", "weeklyKm": [40,45,50,45]},
    --     {"name": "Build", "weeks": 4, "focus": "Threshold work", "weeklyKm": [50,55,60,50]},
    --     {"name": "Peak", "weeks": 1, "focus": "Race-specific", "weeklyKm": [45]},
    --     {"name": "Taper", "weeks": 1, "focus": "Recovery", "weeklyKm": [25]}
    --   ],
    --   "keyWorkouts": ["Long run", "Tempo", "Intervals"],
    --   "notes": "Focus on building base before intense work"
    -- }
    
    -- STORED WEEKLY WORKOUTS (for stability - generated once, reused)
    weekly_workouts JSONB DEFAULT '{}',
    -- Structure: {
    --   "1": [{"day": "Monday", "type": "Easy", "distance_km": 8, ...}, ...],
    --   "2": [...],
    --   ...
    -- }
    
    -- Compliance tracking
    last_compliance_check TIMESTAMP WITH TIME ZONE,
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'active',  -- active, completed, abandoned
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only one active block per user-race combo
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_blocks_active 
ON training_blocks(user_strava_id, race_id) 
WHERE status = 'active';

-- Fast lookup of user's active blocks
CREATE INDEX IF NOT EXISTS idx_training_blocks_user ON training_blocks(user_strava_id);
CREATE INDEX IF NOT EXISTS idx_training_blocks_status ON training_blocks(status);

-- Weekly plans table (update existing 004 if needed)
-- Links weekly plans to their parent block
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS block_id INT REFERENCES training_blocks(id) ON DELETE SET NULL;
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS week_number INT;

-- Add columns to existing training_blocks table if it already exists
ALTER TABLE training_blocks ADD COLUMN IF NOT EXISTS weekly_workouts JSONB DEFAULT '{}';
ALTER TABLE training_blocks ADD COLUMN IF NOT EXISTS last_compliance_check TIMESTAMP WITH TIME ZONE;
ALTER TABLE training_blocks ADD COLUMN IF NOT EXISTS last_modified_reason TEXT;

-- Index for efficient compliance audit queries
CREATE INDEX IF NOT EXISTS idx_training_blocks_audit 
ON training_blocks(user_strava_id, last_compliance_check) 
WHERE status = 'active';
