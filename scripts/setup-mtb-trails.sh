#!/bin/bash
# Quick setup script for MTB trail testing
# Run this after starting the container to enable MTB trail features

podman exec rotv psql -U postgres -d rotv -c "
-- Add MTB trail columns to pois table
ALTER TABLE pois ADD COLUMN IF NOT EXISTS status_url VARCHAR(500);

-- Create trail_status table
CREATE TABLE IF NOT EXISTS trail_status (
  id SERIAL PRIMARY KEY,
  poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  conditions TEXT,
  last_updated TIMESTAMP,
  source_name VARCHAR(200),
  source_url VARCHAR(1000),
  weather_impact TEXT,
  seasonal_closure BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trail_status_poi_id ON trail_status(poi_id);

-- Create trail_status_job_status table
CREATE TABLE IF NOT EXISTS trail_status_job_status (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(50),
  status VARCHAR(20),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  total_trails INTEGER,
  trails_processed INTEGER,
  status_found INTEGER,
  error_message TEXT,
  poi_ids TEXT,
  processed_poi_ids TEXT,
  pg_boss_job_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trail_status_job_status_status ON trail_status_job_status(status);

-- Flag Hampton Hills as MTB trail
UPDATE pois SET
  status_url = 'https://www.summitmetroparks.org/activities/mountain-biking/',
  length_miles = 7.0,
  difficulty = 'Intermediate',
  surface = 'Natural',
  primary_activities = 'Mountain Biking'
WHERE id = 5544;

-- Flag Ohio & Erie Canal Towpath Trail as MTB trail
UPDATE pois SET
  status_url = 'https://www.summitmetroparks.org/activities/mountain-biking/'
WHERE id = 1062;

-- Show results (MTB trails are identified by having a status_url)
SELECT id, name, status_url, length_miles, difficulty
FROM pois
WHERE status_url IS NOT NULL AND status_url != ''
ORDER BY name;
"

echo ""
echo "✓ MTB trail setup complete!"
echo "  Visit http://localhost:8080 and click the 'Status' tab to see the trails"
