-- Migration 048: Add Hampton Hills Mountain Bike Area boundary
-- Source: OpenStreetMap (way 458952457), ODbL 1.0
-- Purpose: Geographic grounding for the MTB trail POIs at Hampton Hills —
-- the smallest boundary polygon so queries become
-- "X trail at Hampton Hills Mountain Bike Area" rather than "X trail in Akron"

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pois WHERE name = 'Hampton Hills Mountain Bike Area' AND 'boundary' = ANY(poi_roles)) THEN
    INSERT INTO pois (name, latitude, longitude, poi_roles, boundary_type, boundary_color)
    VALUES ('Hampton Hills Mountain Bike Area', 41.1536, -81.5540, '{boundary}', 'park', '#2D8B4E');
    RAISE NOTICE 'Inserted Hampton Hills Mountain Bike Area boundary POI';
  ELSE
    RAISE NOTICE 'Hampton Hills Mountain Bike Area boundary already exists, skipping';
  END IF;
END $$;
