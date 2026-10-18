-- Migration 108: per-domain scraper egress (egress_routes)
--
-- JSON object of domain to route: direct (lotor's IP), expressvpn (the default for
-- unlisted domains) or residential (RESIDENTIAL_PROXY; expressvpn while unset).
-- See backend/services/egressRoutes.js and docs/NEWS_EVENTS_ARCHITECTURE.md.
-- newfranklin.org resets every ExpressVPN exit but serves lotor (issue #800).
-- cvsr.org blocks both lotor and ExpressVPN; it waits for a residential proxy.

INSERT INTO admin_settings (key, value) VALUES
('egress_routes', '{"newfranklin.org": "direct", "cvsr.org": "residential"}')
ON CONFLICT (key) DO NOTHING;
