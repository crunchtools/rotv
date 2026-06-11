-- 082_cvfm_overlay_org.sql
-- Seed the Cuyahoga Valley Farmers Market (CVFM) as an overlay organization
-- (spec 034, issue #436). CVFM is the ORGANIZER (poi_id) that runs recurring markets
-- AT two venues it does not own. Each series carries a venue_poi_id pointing at the
-- venue POI, so a venue's page surfaces exactly the events held there — no org-level
-- bleed (summer shows only at Howe Meadow, winter only at Old Trail School).
--
-- Schedule (per cvfm.org, both markets Saturdays 9am–12pm, weekly):
--   Summer Market: May 2 – Oct 31, 2026 @ Howe Meadow, Peninsula
--   Winter Market: Nov 7, 2026 – Apr 24, 2027 @ Old Trail School, Akron
--                  closed Nov 28 & Dec 26, 2026 and Jan 2, 2027 (exdates)
-- Idempotent: re-runs cleanly on every container start and deploy.

-- 1. CVFM organization POI (virtual overlay; no coordinates)
INSERT INTO pois (name, poi_roles, brief_description, more_info_link)
SELECT 'Cuyahoga Valley Farmers Market', ARRAY['organization'],
  'A producer-only farmers market bringing local growers, bakers, and makers to the Cuyahoga Valley. Runs a Saturday summer market at Howe Meadow and a winter market at Old Trail School, plus seasonal special events.',
  'https://cvfm.org'
WHERE NOT EXISTS (
  SELECT 1 FROM pois WHERE name = 'Cuyahoga Valley Farmers Market' AND 'organization' = ANY(poi_roles)
);

-- 2. Old Trail School — winter market venue (2315 Ira Rd., Bath/Akron, OH 44333)
INSERT INTO pois (name, latitude, longitude, poi_roles, brief_description, has_parking)
SELECT 'Old Trail School', 41.16640000, -81.63880000, ARRAY['point'],
  'Independent school in Bath Township whose campus hosts the Cuyahoga Valley Farmers Market''s indoor winter market on Saturday mornings. Located at 2315 Ira Rd., Akron, OH 44333.',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM pois WHERE name = 'Old Trail School' AND 'point' = ANY(poi_roles)
);

-- 3. PostGIS point geometry for the new venue (mirrors migration 021/073)
UPDATE pois SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;

-- 4. Summer Market series — weekly Saturdays, organized by CVFM, held AT Howe Meadow.
--    venue_poi_id points at the venue so Howe Meadow's page surfaces exactly this market.
--    Howe Meadow is an existing prod POI; venue_poi_id is left NULL if absent locally.
INSERT INTO poi_event_series
  (poi_id, venue_poi_id, title, description, event_type, location_details, source_url,
   freq, interval, byday, season_start, season_end, exdates, time_start, time_end,
   content_source, moderation_status, active)
SELECT cvfm.id,
  (SELECT id FROM pois WHERE name = 'Howe Meadow' AND 'point' = ANY(poi_roles) LIMIT 1),
  'Cuyahoga Valley Farmers Market — Summer Market',
  'Producer-only outdoor farmers market with seasonal produce, baked goods, prepared foods, and local makers. Cooking demos, live music, and seasonal gatherings throughout the season.',
  'community', 'Howe Meadow, 4040 Riverview Rd., Peninsula, OH 44264',
  'https://cvfm.org/summer-market/',
  'WEEKLY', 1, ARRAY['SA'], DATE '2026-05-02', DATE '2026-10-31',
  ARRAY[]::date[], TIME '09:00', TIME '12:00',
  'human', 'published', TRUE
FROM (SELECT id FROM pois WHERE name = 'Cuyahoga Valley Farmers Market' AND 'organization' = ANY(poi_roles) LIMIT 1) cvfm
WHERE NOT EXISTS (
  SELECT 1 FROM poi_event_series WHERE title = 'Cuyahoga Valley Farmers Market — Summer Market'
);

-- 5. Winter Market series — weekly Saturdays at Old Trail School, with holiday closures.
INSERT INTO poi_event_series
  (poi_id, venue_poi_id, title, description, event_type, location_details, source_url,
   freq, interval, byday, season_start, season_end, exdates, time_start, time_end,
   content_source, moderation_status, active)
SELECT cvfm.id,
  (SELECT id FROM pois WHERE name = 'Old Trail School' AND 'point' = ANY(poi_roles) LIMIT 1),
  'Cuyahoga Valley Farmers Market — Winter Market',
  'Indoor winter farmers market with local produce, meats, baked goods, and prepared foods through the cold months. Closed on selected holiday weekends.',
  'community', 'Old Trail School, 2315 Ira Rd., Akron, OH 44333',
  'https://cvfm.org/winter-market/',
  'WEEKLY', 1, ARRAY['SA'], DATE '2026-11-07', DATE '2027-04-24',
  ARRAY[DATE '2026-11-28', DATE '2026-12-26', DATE '2027-01-02'], TIME '09:00', TIME '12:00',
  'human', 'published', TRUE
FROM (SELECT id FROM pois WHERE name = 'Cuyahoga Valley Farmers Market' AND 'organization' = ANY(poi_roles) LIMIT 1) cvfm
WHERE NOT EXISTS (
  SELECT 1 FROM poi_event_series WHERE title = 'Cuyahoga Valley Farmers Market — Winter Market'
);

-- Backfill venue_poi_id for series seeded before Howe Meadow/Old Trail School existed
-- (e.g. if this migration ran once before the venue POIs were created).
UPDATE poi_event_series SET venue_poi_id = (SELECT id FROM pois WHERE name = 'Howe Meadow' AND 'point' = ANY(poi_roles) LIMIT 1)
WHERE title = 'Cuyahoga Valley Farmers Market — Summer Market' AND venue_poi_id IS NULL;
UPDATE poi_event_series SET venue_poi_id = (SELECT id FROM pois WHERE name = 'Old Trail School' AND 'point' = ANY(poi_roles) LIMIT 1)
WHERE title = 'Cuyahoga Valley Farmers Market — Winter Market' AND venue_poi_id IS NULL;
