-- Migration: Add MTB Trail Status Support
-- Created: 2026-01-24
-- Description: Add comprehensive trail status tracking for MTB trails

-- 1. Create trail_status table for storing trail condition updates
CREATE TABLE IF NOT EXISTS trail_status (
  id SERIAL PRIMARY KEY,
  poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,

  -- Status information
  status VARCHAR(50) NOT NULL,  -- 'open'|'closed'|'limited'|'maintenance'|'unknown'
  conditions TEXT,               -- Trail condition description
  last_updated TIMESTAMP,        -- When this status was reported

  -- Source tracking
  source_name VARCHAR(200),      -- e.g., "IMBA Trail Forks", "Summit Metro Parks"
  source_url VARCHAR(1000),      -- Deep link to status page

  -- Weather/seasonal
  weather_impact TEXT,           -- e.g., "Muddy after rain", "Snow covered"
  seasonal_closure BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for trail_status
CREATE INDEX IF NOT EXISTS idx_trail_status_poi_id ON trail_status(poi_id);
CREATE INDEX IF NOT EXISTS idx_trail_status_updated ON trail_status(last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_trail_status_status ON trail_status(status);

-- 2. Extend pois table with trail status fields
ALTER TABLE pois ADD COLUMN IF NOT EXISTS status_url VARCHAR(500);  -- Dedicated status page URL
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_mtb_trail BOOLEAN DEFAULT FALSE;  -- Flag MTB trails

-- Create index for MTB trail filtering
CREATE INDEX IF NOT EXISTS idx_pois_is_mtb_trail ON pois(is_mtb_trail) WHERE is_mtb_trail = TRUE;

-- 3. Create trail_status_job_status table for job tracking
CREATE TABLE IF NOT EXISTS trail_status_job_status (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(50),          -- 'scheduled_collection'|'batch_collection'
  status VARCHAR(20),            -- 'queued'|'running'|'completed'|'failed'|'cancelled'
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  total_trails INTEGER,
  trails_processed INTEGER,
  status_found INTEGER,
  error_message TEXT,

  -- Resumability
  poi_ids TEXT,                  -- JSON array of all trail POI IDs
  processed_poi_ids TEXT,        -- JSON array of completed trail POI IDs
  pg_boss_job_id VARCHAR(100),

  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for job status queries
CREATE INDEX IF NOT EXISTS idx_trail_status_job_status_created ON trail_status_job_status(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trail_status_job_status_status ON trail_status_job_status(status);

-- 4. Add admin settings for trail status collection
-- First check if admin_settings table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_settings') THEN
    -- Insert settings if they don't exist
    INSERT INTO admin_settings (key, value)
    VALUES
      ('trail_status_collection_enabled', 'true'),
      ('trail_status_collection_interval_hours', '2'),
      ('trail_status_ai_provider', 'gemini')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END$$;

-- Add comments for documentation
COMMENT ON TABLE trail_status IS 'Stores MTB trail status and condition updates';
COMMENT ON TABLE trail_status_job_status IS 'Tracks trail status collection job progress';
COMMENT ON COLUMN pois.status_url IS 'URL to trail status page (for MTB trails)';
COMMENT ON COLUMN pois.is_mtb_trail IS 'Flag indicating this is a mountain bike trail';

-- 5. Configure known MTB trails with their status URLs
-- East Rim Trail - status from CVNP MTB Twitter account
UPDATE pois
SET status_url = 'https://x.com/CVNPmtb',
    is_mtb_trail = TRUE
WHERE name LIKE '%East Rim%'
  AND status_url IS DISTINCT FROM 'https://x.com/CVNPmtb';
