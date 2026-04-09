-- Migration: 017_add_poi_metadata_fields
-- Description: Adds cost, hours, and mobility accessibility fields to pois table
-- Date: 2026-04-04

ALTER TABLE pois
  ADD COLUMN cost VARCHAR(50),
  ADD COLUMN hours TEXT,
  ADD COLUMN mobility VARCHAR(50);

ALTER TABLE pois
  ADD CONSTRAINT pois_cost_check
  CHECK (cost IS NULL OR cost IN ('free', 'low', 'medium', 'high'));

ALTER TABLE pois
  ADD CONSTRAINT pois_mobility_check
  CHECK (mobility IS NULL OR mobility IN ('full', 'limited', 'accessible'));

COMMENT ON COLUMN pois.cost IS 'Cost level: free (no charge), low ($1-10), medium ($11-25), high ($26+)';
COMMENT ON COLUMN pois.hours IS 'Operating hours (freeform text): "9am-5pm Mon-Fri", "Dawn to dusk", "24/7", "Seasonal: May-Oct"';
COMMENT ON COLUMN pois.mobility IS 'Accessibility level: full (no limitations), limited (some obstacles), accessible (wheelchair/mobility device friendly)';
