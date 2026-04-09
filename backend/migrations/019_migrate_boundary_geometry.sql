-- Migration 019: Migrate boundary polygons from JSONB to PostGIS geometry
-- This converts the existing GeoJSON data to proper PostGIS geometry
-- Handles both Polygon and MultiPolygon geometries

-- First, change column type to accept both Polygon and MultiPolygon
ALTER TABLE pois DROP COLUMN IF EXISTS boundary_geom;
ALTER TABLE pois ADD COLUMN boundary_geom geometry(MultiPolygon, 4326);

-- Convert JSONB GeoJSON to PostGIS geometry for boundaries
-- Ensures all geometries are MultiPolygon (converts Polygon → MultiPolygon if needed)
UPDATE pois
SET boundary_geom = ST_SetSRID(
  ST_Multi(ST_GeomFromGeoJSON(geometry::text))::geometry(MultiPolygon, 4326),
  4326
)
WHERE poi_type = 'boundary'
  AND geometry IS NOT NULL
  AND boundary_geom IS NULL;

-- Verify all boundaries have PostGIS geometry
DO $$
DECLARE
  boundary_count INTEGER;
  migrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO boundary_count
  FROM pois
  WHERE poi_type = 'boundary';

  SELECT COUNT(*) INTO migrated_count
  FROM pois
  WHERE poi_type = 'boundary'
    AND boundary_geom IS NOT NULL;

  RAISE NOTICE 'Boundary migration: % of % boundaries have PostGIS geometry',
    migrated_count, boundary_count;

  IF migrated_count < boundary_count THEN
    RAISE WARNING 'Some boundaries missing PostGIS geometry - check GeoJSON format';
  END IF;
END $$;

-- Create spatial index for boundary polygons (if not exists)
CREATE INDEX IF NOT EXISTS idx_pois_boundary_geom ON pois USING GIST (boundary_geom)
WHERE poi_type = 'boundary';
