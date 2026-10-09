-- Migration 096: Per-item newsletter exclusion (spec 049)
-- An editor can keep an item published on the site while holding it out of the
-- weekly digest (a closure that ends before Friday, an event that already ran).
-- Replaces the workaround of relabeling news as pipeline='historical'.
-- Idempotent: runs on every boot.

ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS digest_excluded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS digest_excluded BOOLEAN NOT NULL DEFAULT FALSE;
