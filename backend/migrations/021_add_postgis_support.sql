-- Migration 018: Add PostGIS support for geographic grounding
-- Required for Serper integration spatial queries

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add PostGIS geometry column to pois table
-- This will store point locations for spatial queries
ALTER TABLE pois ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

-- Populate geometry column from existing latitude/longitude
-- SRID 4326 = WGS 84 (standard GPS coordinates)
UPDATE pois
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND geom IS NULL;

-- Create spatial index for fast geographic queries
-- Used by getGeographicContext() in serperService.js
CREATE INDEX IF NOT EXISTS idx_pois_geom ON pois USING GIST (geom);

-- Add geometry column for boundary polygons
-- This will store polygon data from the existing JSONB geometry field
ALTER TABLE pois ADD COLUMN IF NOT EXISTS boundary_geom geometry(Polygon, 4326);

-- Note: Boundary polygon migration from JSONB will be handled separately
-- The JSONB geometry field contains GeoJSON that needs custom parsing
-- For now, boundaries can be re-imported from GeoJSON files

-- Verify PostGIS is working
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'PostGIS extension not available';
  END IF;
  RAISE NOTICE 'PostGIS extension installed successfully';
END $$;
