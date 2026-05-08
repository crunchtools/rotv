-- Migration 044: Add Cuyahoga County, Summit County, and Ohio state boundaries
-- Source: US Census Bureau TIGER/Line via TIGERweb GeoServices REST API
-- Purpose: Geographic grounding for Serper searches — POIs outside city-level
-- boundaries (e.g., Liberty Park Nature Center) now get county/state context
-- so queries become "Liberty Park Nature Center in Summit County, Ohio"
-- instead of just "Liberty Park Nature Center"
--
-- This migration creates the POI rows. The companion script
-- load-county-state-boundaries.js loads the GeoJSON geometry data
-- from backend/data/boundaries/ into the geometry and boundary_geom columns.

DO $$
BEGIN
  -- Cuyahoga County (FIPS 39035)
  IF NOT EXISTS (SELECT 1 FROM pois WHERE name = 'Cuyahoga County' AND 'boundary' = ANY(poi_roles)) THEN
    INSERT INTO pois (name, latitude, longitude, poi_roles, boundary_type, boundary_color)
    VALUES ('Cuyahoga County', 41.47400000, -81.67840000, '{boundary}', 'county', '#4A90D9');
    RAISE NOTICE 'Inserted Cuyahoga County boundary POI';
  ELSE
    RAISE NOTICE 'Cuyahoga County boundary already exists, skipping';
  END IF;

  -- Summit County (FIPS 39153)
  IF NOT EXISTS (SELECT 1 FROM pois WHERE name = 'Summit County' AND 'boundary' = ANY(poi_roles)) THEN
    INSERT INTO pois (name, latitude, longitude, poi_roles, boundary_type, boundary_color)
    VALUES ('Summit County', 41.12600000, -81.53600000, '{boundary}', 'county', '#D94A90');
    RAISE NOTICE 'Inserted Summit County boundary POI';
  ELSE
    RAISE NOTICE 'Summit County boundary already exists, skipping';
  END IF;

  -- Ohio (FIPS 39, state boundary)
  IF NOT EXISTS (SELECT 1 FROM pois WHERE name = 'Ohio' AND 'boundary' = ANY(poi_roles)) THEN
    INSERT INTO pois (name, latitude, longitude, poi_roles, boundary_type, boundary_color)
    VALUES ('Ohio', 40.41730000, -82.90710000, '{boundary}', 'state', '#90D94A');
    RAISE NOTICE 'Inserted Ohio state boundary POI';
  ELSE
    RAISE NOTICE 'Ohio boundary already exists, skipping';
  END IF;
END $$;
