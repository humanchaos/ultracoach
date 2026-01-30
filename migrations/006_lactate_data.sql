-- Lactate Test Data
-- Stores lab test results for precise training zone calculation

CREATE TABLE IF NOT EXISTS lactate_tests (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(255) NOT NULL REFERENCES strava_users(strava_id) ON DELETE CASCADE,
    test_date DATE NOT NULL,
    -- Aerobic threshold (LT1 / VT1)
    aerobic_threshold_hr INT,
    aerobic_threshold_pace VARCHAR(10),     -- e.g., "5:30" min/km
    aerobic_threshold_power INT,            -- watts (if available)
    -- Anaerobic threshold (LT2 / LTHR / VT2)
    anaerobic_threshold_hr INT,
    anaerobic_threshold_pace VARCHAR(10),
    anaerobic_threshold_power INT,
    -- Max values
    max_hr INT,
    vo2max DECIMAL(5,2),
    -- Metadata
    source VARCHAR(50) DEFAULT 'manual',    -- 'manual', 'pdf_upload'
    raw_pdf_data JSONB,                     -- extracted PDF content
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lactate_tests_user ON lactate_tests(user_strava_id);
CREATE INDEX IF NOT EXISTS idx_lactate_tests_date ON lactate_tests(test_date DESC);
