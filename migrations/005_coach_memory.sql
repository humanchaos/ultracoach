-- Coach Memory Persistence
-- Stores extracted insights from conversations (feelings, injuries, preferences)

CREATE TABLE IF NOT EXISTS coach_memories (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL REFERENCES strava_users(strava_id) ON DELETE CASCADE,
    memory_type VARCHAR(50) NOT NULL, -- 'feeling', 'injury', 'preference', 'health_note', 'goal'
    content TEXT NOT NULL,
    extracted_from TEXT,              -- original user message
    relevance_score DECIMAL(3,2) DEFAULT 1.0, -- for priority ranking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE -- optional: for temporary states like "tired today"
);

CREATE INDEX IF NOT EXISTS idx_coach_memories_user ON coach_memories(user_strava_id);
CREATE INDEX IF NOT EXISTS idx_coach_memories_type ON coach_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_coach_memories_created ON coach_memories(created_at DESC);
