-- Migration 109: Network Routes (Settings › Data Collection)
--
-- Which way each scraped site's requests leave lotor: expressvpn, direct (lotor's
-- IP, no proxy) or residential (IPRoyal, paid). See backend/services/egressRoutes.js.
--   egress_domain_routes: per-domain routes. source 'manual' is an admin's pinned
--     choice; 'auto' is learned by the crawler's failover.
--   egress_usage: render attempts per day and route, for the IPRoyal daily cap
--     and the usage line in the UI.
-- Re-runs on every container start, so all statements are idempotent.

CREATE TABLE IF NOT EXISTS egress_domain_routes (
  domain          VARCHAR(255) PRIMARY KEY,
  route           VARCHAR(20) NOT NULL CHECK (route IN ('expressvpn', 'direct', 'residential')),
  source          VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  last_ok_at      TIMESTAMPTZ,
  last_blocked_at TIMESTAMPTZ,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS egress_usage (
  day     DATE NOT NULL,
  route   VARCHAR(20) NOT NULL,
  renders INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route)
);

INSERT INTO admin_settings (key, value) VALUES
  ('egress_default_route', 'expressvpn'),
  ('egress_residential_daily_cap', '100')
ON CONFLICT (key) DO NOTHING;

-- Carry over the PR #803 JSON setting once, then drop it. newfranklin.org stays a
-- manual direct route; cvsr.org (blocks lotor and ExpressVPN) becomes auto, so
-- failover can reach IPRoyal for it. A fresh install has no legacy setting and starts
-- with no per-domain routes: failover learns newfranklin.org on its first crawl. It is
-- deliberately not seeded here, since this file re-runs on every start and would put
-- back a route an admin had reset.
-- Keys get the old parser's normalization (trim, lowercase, drop a leading *. or .).
INSERT INTO egress_domain_routes (domain, route, source)
SELECT DISTINCT ON (d.domain) d.domain, d.route, CASE WHEN d.route = 'residential' THEN 'auto' ELSE 'manual' END
FROM admin_settings s,
     jsonb_each_text(s.value::jsonb) AS r,
     LATERAL (SELECT regexp_replace(lower(trim(r.key)), '^\*?\.', '') AS domain, r.value AS route) AS d
WHERE s.key = 'egress_routes' AND d.route IN ('expressvpn', 'direct', 'residential') AND d.domain <> ''
ON CONFLICT (domain) DO NOTHING;

DELETE FROM admin_settings WHERE key = 'egress_routes';
