-- Migration: Add Cleveland Water Taxis (#28)
-- Created: 2026-05-23
-- Description: Adds seasonal/accessibility/live-tracker columns to pois and seeds
--   the two Flats water taxi services (eLCee2 Metroparks Shuttle, Harbor Hopper)
--   as water_taxi-role linear features, including their dashed route geometry.
--   Route coordinates are sampled from the Cuyahoga River centerline already in
--   the DB (the Collision Bend oxbow through the Flats), so every point sits on
--   the water as OSM renders it.
-- Idempotent: re-runs cleanly on every container start.

-- 1. Generic POI service attributes (reusable beyond water taxis).
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_seasonal       BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_ada_accessible BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_bike_friendly  BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS live_tracker_url  VARCHAR(500);

-- 2. Seed the two water taxi services. Each is one POI carrying the full route
--    as a dashed linear feature (route geometry is loaded in step 3 below).
--    Guarded by NOT EXISTS on (name, water_taxi role) so re-runs are no-ops.
INSERT INTO pois (name, poi_roles, brief_description, historical_description,
                  is_seasonal, is_ada_accessible, is_bike_friendly, live_tracker_url)
SELECT v.name, ARRAY['water_taxi']::text[], v.brief, v.hist,
       v.seasonal, v.ada, v.bike, v.tracker
FROM (VALUES
  (
    'eLCee2 (Metroparks Shuttle)',
    'Cleveland Metroparks'' seasonal water shuttle connecting the East and West banks of the Cuyahoga in the Flats, linking the Towpath Trail across the river without using the road bridges.',
    'Connects the Towpath Trail directly across the river without using the road bridges — reviving the Cuyahoga as a transit corridor for walkers and cyclists.',
    TRUE, TRUE, TRUE, NULL::varchar
  ),
  (
    'Harbor Hopper',
    'Seasonal commercial water taxi making stops around the Flats (Collision Bend, BrewDog, Main Avenue), shuttling visitors across and along the Cuyahoga.',
    'Mirrors the old "bumboat" and ferry traffic that shuttled sailors and workers across the Cuyahoga in the 1800s.',
    TRUE, FALSE, FALSE, 'https://trackmyshuttle.com/a/5799'::varchar
  )
) AS v(name, brief, hist, seasonal, ada, bike, tracker)
WHERE NOT EXISTS (
  SELECT 1 FROM pois p WHERE p.name = v.name AND 'water_taxi' = ANY(p.poi_roles)
);

-- 3. Load dashed route geometry (GeoJSON LineStrings) for each service. Only sets
--    geometry when still NULL, so hand-edits/re-runs are preserved.
--    eLCee2: Main Avenue Bridge crossing out to the Old River Bed near the mouth.
UPDATE pois
SET geometry = '{"type":"LineString","coordinates":[[-81.70568,41.49872],[-81.70707,41.49901],[-81.70813,41.49918],[-81.70877,41.49962],[-81.71067,41.50204],[-81.71080,41.50220],[-81.71186,41.50360]]}'::jsonb,
    updated_at = NOW()
WHERE name = 'eLCee2 (Metroparks Shuttle)' AND 'water_taxi' = ANY(poi_roles) AND geometry IS NULL;

--    Harbor Hopper: Collision Bend oxbow through the Flats (Collision Bend -> BrewDog -> Main Ave).
UPDATE pois
SET geometry = '{"type":"LineString","coordinates":[[-81.69876,41.49043],[-81.69897,41.48926],[-81.70010,41.48835],[-81.70078,41.48832],[-81.70238,41.48863],[-81.70404,41.48966],[-81.70463,41.49075],[-81.70416,41.49265],[-81.70277,41.49490],[-81.70202,41.49643],[-81.70326,41.49761],[-81.70568,41.49872]]}'::jsonb,
    updated_at = NOW()
WHERE name = 'Harbor Hopper' AND 'water_taxi' = ANY(poi_roles) AND geometry IS NULL;

-- 4. Backfill the Harbor Hopper live GPS tracker (TrackMyShuttle, linked from
--    clevelandwatertaxi.com) for any DB seeded before the URL was known.
UPDATE pois
SET live_tracker_url = 'https://trackmyshuttle.com/a/5799', updated_at = NOW()
WHERE name = 'Harbor Hopper' AND 'water_taxi' = ANY(poi_roles) AND live_tracker_url IS NULL;

COMMENT ON COLUMN pois.is_seasonal      IS 'Service does not operate year-round (e.g. water taxis, closed in winter) (#28)';
COMMENT ON COLUMN pois.is_ada_accessible IS 'POI/service is ADA-accessible (#28)';
COMMENT ON COLUMN pois.is_bike_friendly  IS 'POI/service accommodates bicycles (#28)';
COMMENT ON COLUMN pois.live_tracker_url  IS 'External live GPS tracker URL surfaced as a sidebar button (#28)';
