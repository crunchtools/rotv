-- Migration: Add River Gauge Support (#92)
-- Created: 2026-05-23
-- Description: USGS river gauge metadata + time-series readings for kayakers.
-- Idempotent: re-runs cleanly on every container start.

-- 1. Gauge metadata (one row per USGS monitoring location)
CREATE TABLE IF NOT EXISTS river_gauges (
  id            SERIAL PRIMARY KEY,
  usgs_site_id  VARCHAR(20) NOT NULL UNIQUE,        -- e.g. '04206000'
  name          VARCHAR(200),                       -- backfilled from USGS siteName
  river_poi_id  INTEGER REFERENCES pois(id) ON DELETE SET NULL,
  latitude      DOUBLE PRECISION,                   -- backfilled from USGS geoLocation
  longitude     DOUBLE PRECISION,
  enabled       BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Time-series readings (gage height + discharge per timestamp)
CREATE TABLE IF NOT EXISTS river_gauge_readings (
  id             SERIAL PRIMARY KEY,
  gauge_id       INTEGER NOT NULL REFERENCES river_gauges(id) ON DELETE CASCADE,
  reading_time   TIMESTAMPTZ NOT NULL,
  gage_height_ft NUMERIC,
  discharge_cfs  NUMERIC,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (gauge_id, reading_time)
);

CREATE INDEX IF NOT EXISTS idx_river_gauge_readings_gauge_time
  ON river_gauge_readings(gauge_id, reading_time DESC);
CREATE INDEX IF NOT EXISTS idx_river_gauges_river_poi ON river_gauges(river_poi_id);

-- 3. Admin settings (collection toggle)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_settings') THEN
    INSERT INTO admin_settings (key, value)
    VALUES ('river_levels_collection_enabled', 'true')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END$$;

-- 4. Seed Cuyahoga River main-stem gauges (metadata backfilled on first collection run).
--    USGS site numbers increase downstream, so this list is ordered upstream → downstream.
INSERT INTO river_gauges (usgs_site_id, name)
VALUES
  ('04202000', 'Cuyahoga River at Hiram Rapids OH'),
  ('04206000', 'Cuyahoga River at Old Portage OH'),
  ('04206425', 'Cuyahoga River at Jaite OH'),
  ('04208000', 'Cuyahoga River at Independence OH'),
  ('04208503', 'Cuyahoga River at Lower Harvard Bridge in Cleveland OH'),
  ('04208509', 'Cuyahoga River at Rivergate Park at Cleveland OH')
ON CONFLICT (usgs_site_id) DO NOTHING;

-- 5. Associate seeded gauges with the Cuyahoga River POI (river-role linear feature).
--    No-op on databases that don't have the river POI yet; gauges still collect and
--    render on the map, just without a sidebar association until linked.
UPDATE river_gauges g
SET river_poi_id = p.id,
    updated_at = NOW()
FROM (
  SELECT id FROM pois
  WHERE name = 'Cuyahoga River'
    AND 'river' = ANY(poi_roles)
    AND (deleted IS NULL OR deleted = FALSE)
  ORDER BY id
  LIMIT 1
) p
WHERE g.usgs_site_id IN ('04202000', '04206000', '04206425', '04208000', '04208503', '04208509')
  AND g.river_poi_id IS NULL;

-- 6. Tributary + outflow river POIs (geometry is loaded separately by
--    load-river-geometry.js from backend/data/rivers/*.geojson). Idempotent.
INSERT INTO pois (name, poi_roles, brief_description)
SELECT v.name, ARRAY['river'], v.descr
FROM (VALUES
  ('Tinkers Creek', 'A major Cuyahoga River tributary that carved Tinkers Creek Gorge, a National Natural Landmark, before joining the Cuyahoga near the national park.'),
  ('Brandywine Creek', 'A Cuyahoga River tributary in Cuyahoga Valley National Park, feeding the 65-foot Brandywine Falls.'),
  ('Chippewa Creek', 'A Cuyahoga River tributary flowing through Brecksville Reservation and Chippewa Creek Gorge.'),
  ('Indian Creek', 'A small Cuyahoga River tributary in the Macedonia area of the valley.'),
  ('Tuscarawas River', 'A river rising at the Portage Lakes south of Akron and carrying the lakes'' outflow southward toward the Ohio River basin.')
) AS v(name, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM pois p WHERE p.name = v.name AND 'river' = ANY(p.poi_roles)
);

-- 7. Tributary + outflow gauges
INSERT INTO river_gauges (usgs_site_id, name)
VALUES
  ('04207200', 'Tinkers Creek at Bedford OH'),
  ('04206416', 'Brandywine Creek near Macedonia OH'),
  ('04206448', 'Chippewa Ck in Chippewa Met Pk near Brecksville OH'),
  ('04206413', 'Indian Creek near Macedonia OH'),
  ('03115917', 'Tuscarawas River above Barberton OH'),
  ('03116000', 'Tuscarawas River at Clinton OH')
ON CONFLICT (usgs_site_id) DO NOTHING;

-- 8. Associate tributary/outflow gauges with their river POIs by name
UPDATE river_gauges g
SET river_poi_id = p.id, updated_at = NOW()
FROM (
  SELECT DISTINCT ON (name) id, name FROM pois
  WHERE 'river' = ANY(poi_roles) AND (deleted IS NULL OR deleted = FALSE)
  ORDER BY name, id
) p
WHERE g.river_poi_id IS NULL AND (
  (g.usgs_site_id = '04207200' AND p.name = 'Tinkers Creek') OR
  (g.usgs_site_id = '04206416' AND p.name = 'Brandywine Creek') OR
  (g.usgs_site_id = '04206448' AND p.name = 'Chippewa Creek') OR
  (g.usgs_site_id = '04206413' AND p.name = 'Indian Creek') OR
  (g.usgs_site_id = '03115917' AND p.name = 'Tuscarawas River') OR
  (g.usgs_site_id = '03116000' AND p.name = 'Tuscarawas River')
);

COMMENT ON TABLE river_gauges IS 'USGS river gauge monitoring locations associated to river POIs (#92)';
COMMENT ON TABLE river_gauge_readings IS 'Time-series gage height (ft) and discharge (cfs) readings from USGS';
