-- Migration 010: Add HRV tracking to user_journal
ALTER TABLE user_journal ADD COLUMN IF NOT EXISTS hrv_status VARCHAR(20) CHECK (hrv_status IS NULL OR hrv_status IN ('low', 'normal', 'high', 'elevated'));
