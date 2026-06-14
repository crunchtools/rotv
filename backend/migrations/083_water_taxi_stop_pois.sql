-- Migration 083: Water taxi landing points as full POIs (#035)
-- Promotes the four Harbor Hopper stops into full point POIs, adds a reusable
-- Food & Drink POI/icon type, and links each stop back to its route via
-- pois.stops[].poi_id (so the map shows one marker, the route lists its stops,
-- and each stop can show its serving taxi).
-- Idempotent: re-runs cleanly on every container start.

BEGIN;

-- 1. Reusable Food & Drink POI/icon type. Auto-classified by NAME keyword and
--    auto-listed in the legend (Map.jsx builds the legend from the icons table).
--    Keywords are broad enough to catch breweries/pubs/restaurants by name
--    (Collision Bend Brewing, BrewDog, Noisy Oyster, Fishers Pub, Winking Lizard,
--    Green Valley Brewing Co., ...). No activity_fallbacks: a POI "is" Food & Drink
--    only when its name says so, not because a park lists dining among activities.
--    sort_order 3 keeps it ahead of the generic park types for classification; the
--    legend itself sorts by label, so this does not affect legend order.
INSERT INTO icons (name, label, svg_filename, title_keywords, activity_fallbacks, sort_order)
VALUES ('food_drink', 'Food & Drink', 'food_drink.svg',
        'brewing,brewery,brewpub,brewdog,taproom,pub,tavern,alehouse,grill,kitchen,eatery,restaurant,diner,bistro,cafe,oyster,lizard,distillery,winery',
        NULL, 3)
ON CONFLICT (name) DO NOTHING;

-- Keep keywords/priority correct even if the row already existed from a prior run.
UPDATE icons
SET label = 'Food & Drink',
    svg_filename = 'food_drink.svg',
    title_keywords = 'brewing,brewery,brewpub,brewdog,taproom,pub,tavern,alehouse,grill,kitchen,eatery,restaurant,diner,bistro,cafe,oyster,lizard,distillery,winery',
    activity_fallbacks = NULL,
    sort_order = 3
WHERE name = 'food_drink';

-- 2. Promote each Harbor Hopper stop to a full point POI at its landing-point
--    coordinates (sourced from the Harbor Hopper pois.stops seeded in migration 062).
--    Guarded by NOT EXISTS on (name, point role) so re-runs are no-ops.
INSERT INTO pois (name, poi_roles, latitude, longitude, brief_description)
SELECT v.name, ARRAY['point']::text[], v.lat, v.lng, v.brief
FROM (VALUES
  ('Cleveland Water Taxi Main Hub', 41.49701884, -81.70686722,
   'Primary Harbor Hopper water taxi dock in the Cleveland Flats.'),
  ('Flats East Bank', 41.499108, -81.705831,
   'Harbor Hopper water taxi landing at the Flats East Bank entertainment district.'),
  ('Collision Bend Brewing Company', 41.498449, -81.703964,
   'Riverside brewpub on the Cuyahoga''s Collision Bend in the Flats, a Harbor Hopper water taxi stop.'),
  ('BrewDog Cleveland Outpost', 41.493053, -81.699054,
   'Craft beer bar and kitchen on the Cuyahoga in the Flats, served by the Harbor Hopper water taxi.')
) AS v(name, lat, lng, brief)
WHERE NOT EXISTS (
  SELECT 1 FROM pois p WHERE p.name = v.name AND 'point' = ANY(p.poi_roles)
);

-- 3. Link the Harbor Hopper route's ordered stops to their new POIs: stamp poi_id
--    onto each stops entry (matched by stop name). The map suppresses the
--    decorative circle when a stop has a poi_id, and the route lists its stops.
--    Rebuilds the array preserving order; re-runs set the same poi_id (idempotent).
UPDATE pois ht
SET stops = (
      SELECT jsonb_agg(
               CASE WHEN sp.id IS NOT NULL
                    THEN e.elem || jsonb_build_object('poi_id', sp.id)
                    ELSE e.elem END
               ORDER BY e.ord)
      FROM jsonb_array_elements(ht.stops) WITH ORDINALITY AS e(elem, ord)
      LEFT JOIN pois sp ON sp.name = (e.elem->>'name') AND 'point' = ANY(sp.poi_roles)
    ),
    updated_at = NOW()
WHERE ht.name = 'Harbor Hopper' AND 'water_taxi' = ANY(ht.poi_roles)
  AND ht.stops IS NOT NULL;

-- 4. Fix the Harbor Hopper route terminal. The OSM ferry geometry seeded in
--    migration 062 already follows the water and connects the stops (Flats East
--    Bank, Collision Bend, BrewDog) correctly, but its west-bank tail curved along
--    the south shore to a wrong Main Hub ~85m off the real dock (confirmed by
--    riding the taxi). This keeps the entire OSM route and only drops that last
--    curve to the old hub, extending straight to the corrected Main Hub dock — the
--    new hub sits SE so the extension continues the same heading without a kink.
--    Guarded to the shipped-bad geometry (old start longitude) so it applies once
--    on existing deployments, stays idempotent, and never clobbers a hand edit.
UPDATE pois
SET geometry = '{"type":"LineString","coordinates":[[-81.706867,41.497019],[-81.70809,41.497307],[-81.708376,41.497354],[-81.708678,41.497425],[-81.708797,41.497495],[-81.708846,41.49759],[-81.708836,41.497727],[-81.708778,41.497827],[-81.707897,41.498698],[-81.707753,41.49877],[-81.707323,41.498839],[-81.706654,41.498896],[-81.7062,41.498947],[-81.705969,41.499026],[-81.705831,41.499108],[-81.705819,41.499035],[-81.705751,41.498916],[-81.70564,41.498829],[-81.705324,41.498698],[-81.705094,41.49861],[-81.704837,41.498533],[-81.7045,41.498458],[-81.704191,41.498415],[-81.703964,41.498449],[-81.703978,41.498356],[-81.703924,41.49823],[-81.703709,41.49803],[-81.702738,41.497537],[-81.702438,41.497366],[-81.702137,41.497105],[-81.701968,41.496859],[-81.701876,41.496638],[-81.701886,41.496304],[-81.701978,41.496025],[-81.702617,41.494919],[-81.70388,41.492931],[-81.704059,41.492605],[-81.704176,41.492239],[-81.704384,41.491484],[-81.704447,41.491017],[-81.704423,41.49056],[-81.704297,41.490121],[-81.704074,41.489841],[-81.70357,41.489461],[-81.702936,41.489054],[-81.702316,41.488757],[-81.701755,41.488547],[-81.701169,41.488456],[-81.700636,41.48842],[-81.700225,41.488434],[-81.699915,41.488529],[-81.699687,41.488645],[-81.699421,41.488891],[-81.699087,41.489268],[-81.698879,41.48962],[-81.698787,41.489867],[-81.698768,41.49015],[-81.69885,41.490436],[-81.699198,41.490984],[-81.699416,41.491379],[-81.699557,41.491934],[-81.699547,41.492405],[-81.699484,41.492696],[-81.699363,41.492942],[-81.699286,41.493019],[-81.699176,41.493056],[-81.699054,41.493053]]}'::jsonb,
    updated_at = NOW()
WHERE name = 'Harbor Hopper' AND 'water_taxi' = ANY(poi_roles)
  AND geometry IS NOT NULL
  AND (geometry->'coordinates'->0->>0)::numeric = -81.707759;

COMMIT;
