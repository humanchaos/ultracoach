-- Migration 011: Flexible Journal Data
-- Adds custom_data JSONB column for storing arbitrary life context
-- Allows the AI coach to remember any user-provided information

ALTER TABLE user_journal ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN user_journal.custom_data IS 'Flexible JSONB storage for any life context (e.g., work stress, travel, mood, events)';
