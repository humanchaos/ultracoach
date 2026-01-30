-- Add HR zone columns to lactate_tests table
-- Allows storing manually adjusted zone values

ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z1_hr VARCHAR(20);  -- e.g., "100-120"
ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z2_hr VARCHAR(20);  -- e.g., "120-144"
ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z3_hr VARCHAR(20);  -- e.g., "144-150"
ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z4_hr VARCHAR(20);  -- e.g., "150-157"
ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z5_hr VARCHAR(20);  -- e.g., "157-180"
