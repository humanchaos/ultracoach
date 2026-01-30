-- Migration 012: Add elevation gain/loss to races
-- This enables proper vertical scaling for mountain race training

ALTER TABLE races ADD COLUMN IF NOT EXISTS elevation_gain_m INTEGER;
ALTER TABLE races ADD COLUMN IF NOT EXISTS elevation_loss_m INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN races.elevation_gain_m IS 'Total elevation gain in meters (e.g., 2500 for a 50km mountain race)';
COMMENT ON COLUMN races.elevation_loss_m IS 'Total elevation loss in meters (usually equals gain for loop courses)';
