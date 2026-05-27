-- Migration 066: Playground & Restroom amenity POI types (#418)
-- Adds two map types, an osm_id provenance/idempotency column, and the default
-- set of POI types excluded from news/events collection.

BEGIN;

-- 1. New map types — auto-classified by name keyword / activity, auto-listed in
--    the legend (Map.jsx builds it from the icons table).
--
-- sort_order doubles as classification priority: getDestinationIconTypeFromConfig
-- (and the backend classifier) iterate icons by sort_order and the first NAME
-- keyword match wins. Amenity names are generated as "<Park> Restroom", and park
-- names often contain another type's keyword (e.g. "Mill Stream Run Reservation"
-- matches 'mill' -> historic). Give amenities the lowest sort_order so their
-- explicit 'restroom'/'playground' keyword is matched first. The legend sorts by
-- label, so this does not affect legend order.
--
-- NO activity_fallbacks: a POI "is" a playground/restroom only if it is a
-- dedicated amenity (named so), not because it lists Playground/Restroom among
-- the many activities a full park offers — otherwise e.g. "Valley View Woods
-- Park" (Hiking, …, Playground) would render as a playground.
INSERT INTO icons (name, label, svg_filename, title_keywords, activity_fallbacks, sort_order)
VALUES
  ('playground', 'Playground', 'playground.svg', 'playground,play area', NULL, 1),
  ('restroom',   'Restroom',   'restroom.svg',   'restroom,restrooms,bathroom,toilet,toilets', NULL, 2)
ON CONFLICT (name) DO NOTHING;

-- Ensure amenity classification priority + no activity fallbacks even if the
-- rows already existed from a prior run.
UPDATE icons SET sort_order = 1, activity_fallbacks = NULL WHERE name = 'playground';
UPDATE icons SET sort_order = 2, activity_fallbacks = NULL WHERE name = 'restroom';

-- 2. Provenance + idempotency key for OpenStreetMap-sourced POIs
ALTER TABLE pois ADD COLUMN IF NOT EXISTS osm_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_osm_id ON pois (osm_id) WHERE osm_id IS NOT NULL;

-- 2b. Types in the legend but toggled OFF on first load (avoid clutter). The
--     type still appears in the legend; users opt in. Amenities are dense, so
--     they default hidden.
ALTER TABLE icons ADD COLUMN IF NOT EXISTS default_hidden BOOLEAN DEFAULT FALSE;
UPDATE icons SET default_hidden = TRUE WHERE name IN ('playground', 'restroom');

-- 3. POI types excluded from news/events collection (amenities have no news)
INSERT INTO admin_settings (key, value)
VALUES ('news_collection_excluded_types', '["playground","restroom"]')
ON CONFLICT (key) DO NOTHING;

COMMIT;
