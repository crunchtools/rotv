-- Fix any POIs with empty poi_roles — they are invisible to both
-- /api/destinations (requires 'point') and /api/linear-features (requires trail/river/boundary)
UPDATE pois SET poi_roles = ARRAY['point']
WHERE poi_roles = '{}' AND (deleted IS NULL OR deleted = FALSE);

-- Set a default so future inserts without explicit roles get 'point'
ALTER TABLE pois ALTER COLUMN poi_roles SET DEFAULT ARRAY['point']::text[];
