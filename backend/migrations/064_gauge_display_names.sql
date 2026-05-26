-- Migration: Short display names for river gauges (#92)
-- Created: 2026-05-25
-- Description: The collection service overwrites river_gauges.name with the USGS
--   siteName on every run (riverLevelsService SET name = COALESCE($2, name)), so a
--   plain rename would be clobbered within the hour. Add a display_name column the
--   collector never touches and seed short, location-only labels. The API surfaces
--   COALESCE(display_name, name) as `name`, so the canonical USGS name is preserved
--   for debugging while the UI shows the short label. The river is already clear from
--   the focused POI, so the labels drop the river name, "OH", and city qualifiers.
-- Idempotent: re-runs cleanly; display_name is force-set to the canonical short label.

ALTER TABLE river_gauges ADD COLUMN IF NOT EXISTS display_name VARCHAR(200);

UPDATE river_gauges g
SET display_name = v.display_name,
    updated_at = NOW()
FROM (VALUES
  ('04202000', 'Hiram Rapids'),
  ('04206000', 'Old Portage'),
  ('04206425', 'Jaite'),
  ('04208000', 'Independence'),
  ('04208503', 'Harvard Bridge'),
  ('04208509', 'Rivergate Park'),
  ('04207200', 'Bedford'),
  ('04206416', 'Macedonia'),
  ('04206448', 'Brecksville'),
  ('04206413', 'Macedonia'),
  ('03115917', 'Barberton'),
  ('03116000', 'Clinton')
) AS v(usgs_site_id, display_name)
WHERE g.usgs_site_id = v.usgs_site_id
  AND g.display_name IS DISTINCT FROM v.display_name;

COMMENT ON COLUMN river_gauges.display_name IS 'Short location-only label for the UI; never overwritten by USGS collection (#92)';
