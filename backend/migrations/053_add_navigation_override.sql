-- 053_add_navigation_override.sql
-- Add optional navigation override coordinates to POIs. When set, the
-- frontend Navigate button uses these instead of the primary
-- latitude/longitude (or first geometry coord for trails). Lets admins
-- pin navigation to a parking entrance or visitor center when the POI's
-- primary coords are off-road or geographically arbitrary (rivers,
-- boundaries).

ALTER TABLE pois ADD COLUMN IF NOT EXISTS navigation_latitude  DECIMAL(10, 8);
ALTER TABLE pois ADD COLUMN IF NOT EXISTS navigation_longitude DECIMAL(11, 8);
