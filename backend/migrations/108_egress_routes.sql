-- Migration 108: per-domain scraper egress (egress_routes)
--
-- Superseded by 109: the egress_routes JSON setting moved to the
-- egress_domain_routes table. Migrations re-run on every start, so this file no
-- longer seeds the setting (109 would copy it back after an admin deleted a
-- domain). Kept as a no-op so the numbering stays intact.

SELECT 1;
