-- Migration 021: Add PostGIS support for geographic grounding
-- Required for Serper integration spatial queries
-- Gracefully skips if PostGIS package is not installed

DO $$
BEGIN
  -- Try to enable PostGIS extension
  BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS not available (%), skipping spatial setup', SQLERRM;
    RETURN;
  END;

  -- Add PostGIS geometry column to pois table
  ALTER TABLE pois ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

  -- Populate geometry column from existing latitude/longitude
  UPDATE pois
  SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
  WHERE latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND geom IS NULL;

  -- Add geometry column for boundary polygons
  ALTER TABLE pois ADD COLUMN IF NOT EXISTS boundary_geom geometry(Polygon, 4326);

  RAISE NOTICE 'PostGIS support enabled successfully';
END $$;

-- Create spatial indexes (only if PostGIS columns exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'pois' AND column_name = 'geom') THEN
    CREATE INDEX IF NOT EXISTS idx_pois_geom ON pois USING GIST (geom);
  END IF;
END $$;
