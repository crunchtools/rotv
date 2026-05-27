-- Migration 065: Unify activities table and icon activity_fallbacks
-- Adds 4 new icon types (fishing, kayaking, scenic, art), updates nature fallbacks,
-- and syncs the activities table with all icon activity_fallbacks.

BEGIN;

-- 1. Add new icons with inline SVG content
-- Each icon follows the project style: 32x32 viewBox, colored circle, white art

INSERT INTO icons (name, label, svg_filename, title_keywords, activity_fallbacks, sort_order)
VALUES
  ('fishing', 'Fishing', 'fishing.svg', 'fish,fishing,angler', 'Fishing', 15),
  ('kayaking', 'Kayaking', 'kayaking.svg', 'kayak,canoe,paddle,paddling', 'Kayaking,Boat Rides', 16),
  ('scenic', 'Scenic', 'scenic.svg', 'scenic,overlook,vista,viewpoint', 'Scenic Drives', 17),
  ('art', 'Art & Culture', 'art.svg', 'art,gallery,studio', 'Art', 18)
ON CONFLICT (name) DO NOTHING;

-- 2. Update nature icon to include Bird Watching and Photography as fallbacks
UPDATE icons
SET activity_fallbacks = 'Nature Study,Wildlife Viewing,Bird Watching,Photography'
WHERE name = 'nature';

-- 3. Rename visitor-center to Discovery, add library keyword
UPDATE icons
SET label = 'Discovery',
    title_keywords = 'visitor center,info,information,museum,library'
WHERE name = 'visitor-center';

-- 4. Remove museum from historic keywords (visitor-center already claims it at higher priority)
UPDATE icons
SET title_keywords = 'historic,history,house,mill,lock,farm,farms'
WHERE name = 'historic';

-- 5. Fix specific POIs that fall to 'default' icon type
-- Gear Up Velo → biking (it's a bike shop)
UPDATE pois SET primary_activities = 'Biking' WHERE name = 'Gear Up Velo' AND primary_activities IS NULL;

-- John Brown Monument → historic (it's a historical monument)
UPDATE pois SET primary_activities = 'Historical Tours' WHERE name = 'John Brown Monument' AND primary_activities IS NULL;

-- Quaker Square → add Historical Tours (it's a historic building)
UPDATE pois SET primary_activities = 'Photography,Historical Tours' WHERE name = 'Quaker Square' AND primary_activities = 'Photography';

-- Brecksville Reservation point POI → soft-delete (boundary version exists)
UPDATE pois SET deleted = true WHERE id = 5745 AND name = 'Brecksville Reservation' AND 'point' = ANY(poi_roles);

-- 6. Disable the 'default/Other' icon type — all point POIs now map to real types
UPDATE icons SET enabled = false WHERE name = 'default';

-- 7. Sync activities table — add missing activities that exist as icon fallbacks
INSERT INTO activities (name, sort_order) VALUES
  ('Music', (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM activities)),
  ('Art', (SELECT COALESCE(MAX(sort_order), 0) + 2 FROM activities)),
  ('Boat Rides', (SELECT COALESCE(MAX(sort_order), 0) + 3 FROM activities))
ON CONFLICT (name) DO NOTHING;

COMMIT;
