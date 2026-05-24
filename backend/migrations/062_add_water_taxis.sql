-- Migration: Add Cleveland Water Taxis (#28)
-- Created: 2026-05-23
-- Description: Adds seasonal/accessibility/live-tracker columns to pois and seeds
--   the two Flats water taxi services (eLCee2 Metroparks Shuttle, Harbor Hopper)
--   as water_taxi-role linear features, including their route geometry and stops.
--   Route geometry and stop locations come from OpenStreetMap route=ferry ways and
--   amenity=ferry_terminal nodes (eLCee2: way 978606820; Harbor Hopper: ways
--   1417965570/71/72 chained Main Hub -> Flats East Bank -> Collision Bend -> BrewDog).
-- Idempotent: re-runs cleanly on every container start.

-- 1. Generic POI service attributes (reusable beyond water taxis).
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_seasonal       BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_ada_accessible BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_bike_friendly  BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS live_tracker_url  VARCHAR(500);
ALTER TABLE pois ADD COLUMN IF NOT EXISTS stops             JSONB;

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

-- 3. Load route geometry (GeoJSON LineStrings from OSM route=ferry ways). Only sets
--    geometry when still NULL, so hand-edits/re-runs are preserved.
--    eLCee2: East Bank Dock -> West Bank Dock crossing (OSM way 978606820).
UPDATE pois
SET geometry = '{"type":"LineString","coordinates":[[-81.704992,41.499007],[-81.705279,41.49883],[-81.705566,41.498598],[-81.705941,41.498245]]}'::jsonb,
    updated_at = NOW()
WHERE name = 'eLCee2 (Metroparks Shuttle)' AND 'water_taxi' = ANY(poi_roles) AND geometry IS NULL;

--    Harbor Hopper: OSM ways 1417965570/71/72 chained (Main Hub -> Flats East Bank -> Collision Bend -> BrewDog).
UPDATE pois
SET geometry = '{"type":"LineString","coordinates":[[-81.707759,41.497377],[-81.707821,41.497338],[-81.707941,41.497307],[-81.70809,41.497307],[-81.708376,41.497354],[-81.708678,41.497425],[-81.708797,41.497495],[-81.708846,41.49759],[-81.708836,41.497727],[-81.708778,41.497827],[-81.707897,41.498698],[-81.707753,41.49877],[-81.707323,41.498839],[-81.706654,41.498896],[-81.7062,41.498947],[-81.705969,41.499026],[-81.705831,41.499108],[-81.705819,41.499035],[-81.705751,41.498916],[-81.70564,41.498829],[-81.705324,41.498698],[-81.705094,41.49861],[-81.704837,41.498533],[-81.7045,41.498458],[-81.704191,41.498415],[-81.703964,41.498449],[-81.703978,41.498356],[-81.703924,41.49823],[-81.703709,41.49803],[-81.702738,41.497537],[-81.702438,41.497366],[-81.702137,41.497105],[-81.701968,41.496859],[-81.701876,41.496638],[-81.701886,41.496304],[-81.701978,41.496025],[-81.702617,41.494919],[-81.70388,41.492931],[-81.704059,41.492605],[-81.704176,41.492239],[-81.704384,41.491484],[-81.704447,41.491017],[-81.704423,41.49056],[-81.704297,41.490121],[-81.704074,41.489841],[-81.70357,41.489461],[-81.702936,41.489054],[-81.702316,41.488757],[-81.701755,41.488547],[-81.701169,41.488456],[-81.700636,41.48842],[-81.700225,41.488434],[-81.699915,41.488529],[-81.699687,41.488645],[-81.699421,41.488891],[-81.699087,41.489268],[-81.698879,41.48962],[-81.698787,41.489867],[-81.698768,41.49015],[-81.69885,41.490436],[-81.699198,41.490984],[-81.699416,41.491379],[-81.699557,41.491934],[-81.699547,41.492405],[-81.699484,41.492696],[-81.699363,41.492942],[-81.699286,41.493019],[-81.699176,41.493056],[-81.699054,41.493053]]}'::jsonb,
    updated_at = NOW()
WHERE name = 'Harbor Hopper' AND 'water_taxi' = ANY(poi_roles) AND geometry IS NULL;

--    Stops (OSM amenity=ferry_terminal nodes), ordered along each route.
UPDATE pois
SET stops = '[{"name":"East Bank Dock","lat":41.499007,"lng":-81.704992},{"name":"West Bank Dock","lat":41.498245,"lng":-81.705941}]'::jsonb,
    updated_at = NOW()
WHERE name = 'eLCee2 (Metroparks Shuttle)' AND 'water_taxi' = ANY(poi_roles) AND stops IS NULL;

UPDATE pois
SET stops = '[{"name":"Cleveland Water Taxi Main Hub","lat":41.497377,"lng":-81.707759},{"name":"Flats East Bank","lat":41.499108,"lng":-81.705831},{"name":"Collision Bend Brewing Company","lat":41.498449,"lng":-81.703964},{"name":"BrewDog Cleveland Outpost","lat":41.493053,"lng":-81.699054}]'::jsonb,
    updated_at = NOW()
WHERE name = 'Harbor Hopper' AND 'water_taxi' = ANY(poi_roles) AND stops IS NULL;

-- 4. Backfill the Harbor Hopper live GPS tracker (TrackMyShuttle, linked from
--    clevelandwatertaxi.com) for any DB seeded before the URL was known.
UPDATE pois
SET live_tracker_url = 'https://trackmyshuttle.com/a/5799', updated_at = NOW()
WHERE name = 'Harbor Hopper' AND 'water_taxi' = ANY(poi_roles) AND live_tracker_url IS NULL;

COMMENT ON COLUMN pois.is_seasonal      IS 'Service does not operate year-round (e.g. water taxis, closed in winter) (#28)';
COMMENT ON COLUMN pois.is_ada_accessible IS 'POI/service is ADA-accessible (#28)';
COMMENT ON COLUMN pois.is_bike_friendly  IS 'POI/service accommodates bicycles (#28)';
COMMENT ON COLUMN pois.live_tracker_url  IS 'External live GPS tracker URL surfaced as a sidebar button (#28)';
COMMENT ON COLUMN pois.stops             IS 'Ordered JSON array of named stops [{name,lat,lng}] for transit routes, e.g. water taxi ferry terminals (#28)';
