-- Migration 022: Migrate boundary polygons from JSONB to PostGIS geometry
-- Converts existing GeoJSON data to proper PostGIS geometry
-- Gracefully skips if PostGIS is not available

DO $$
BEGIN
  -- Skip if PostGIS is not installed
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE NOTICE 'PostGIS not installed, skipping boundary geometry migration';
    RETURN;
  END IF;

  -- Change column type to accept both Polygon and MultiPolygon
  ALTER TABLE pois DROP COLUMN IF EXISTS boundary_geom;
  ALTER TABLE pois ADD COLUMN boundary_geom geometry(MultiPolygon, 4326);

  -- Convert JSONB GeoJSON to PostGIS geometry for boundaries
  UPDATE pois
  SET boundary_geom = ST_SetSRID(
    ST_Multi(ST_GeomFromGeoJSON(geometry::text))::geometry(MultiPolygon, 4326),
    4326
  )
  WHERE poi_type = 'boundary'
    AND geometry IS NOT NULL
    AND boundary_geom IS NULL;

  -- Create spatial index for boundary polygons
  CREATE INDEX IF NOT EXISTS idx_pois_boundary_geom ON pois USING GIST (boundary_geom)
  WHERE poi_type = 'boundary';

  RAISE NOTICE 'Boundary geometry migration complete';
END $$;
