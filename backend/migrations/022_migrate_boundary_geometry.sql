-- Migration 022: boundary polygons as PostGIS MultiPolygon
-- Makes pois.boundary_geom geometry(MultiPolygon, 4326) (021 created it as Polygon;
-- multi-parcel parks need MultiPolygon) and fills it from the GeoJSON column.
--
-- Migrations re-run on every boot, so this converts in place and never drops the
-- column. The original version dropped and re-added boundary_geom and filtered on
-- poi_type, which 026 removed: on any database created after 026 the DO block
-- errored and rolled back, leaving the column as Polygon (fresh installs and CI).
-- Gracefully skips if PostGIS is not available.

DO $$
DECLARE
  current_type text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE NOTICE 'PostGIS not installed, skipping boundary geometry migration';
    RETURN;
  END IF;

  SELECT format_type(atttypid, atttypmod) INTO current_type
  FROM pg_attribute
  WHERE attrelid = 'pois'::regclass AND attname = 'boundary_geom' AND NOT attisdropped;

  IF current_type IS NULL THEN
    ALTER TABLE pois ADD COLUMN boundary_geom geometry(MultiPolygon, 4326);
  ELSIF current_type <> 'geometry(MultiPolygon,4326)' THEN
    ALTER TABLE pois
      ALTER COLUMN boundary_geom TYPE geometry(MultiPolygon, 4326)
      USING ST_Multi(ST_SetSRID(boundary_geom, 4326));
  END IF;

  UPDATE pois
  SET boundary_geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326))
  WHERE 'boundary' = ANY(poi_roles)
    AND geometry IS NOT NULL
    AND geometry->>'type' IN ('Polygon', 'MultiPolygon')
    AND boundary_geom IS NULL;

  -- The index itself is created by 071 (unfiltered GiST on boundary_geom).
END $$;
