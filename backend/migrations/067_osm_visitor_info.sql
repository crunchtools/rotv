-- Migration 067: OSM-sourced visitor info fields (#7)
-- Adds operating hours, wheelchair accessibility, and fee to POIs. Column names
-- mirror the OpenStreetMap tag keys (opening_hours, wheelchair, fee) so the
-- provenance is obvious; the OSM amenity import populates them, and admins can
-- edit them on any POI. All optional — rows hide in the UI when unset.

BEGIN;

ALTER TABLE pois ADD COLUMN IF NOT EXISTS opening_hours TEXT;        -- raw OSM opening_hours string, shown verbatim
ALTER TABLE pois ADD COLUMN IF NOT EXISTS wheelchair    VARCHAR(12); -- yes | limited | no | designated
ALTER TABLE pois ADD COLUMN IF NOT EXISTS fee           VARCHAR(12); -- yes | no | conditional

-- Drop-before-add so the CHECK constraints re-apply cleanly on every deploy.
ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_wheelchair_check;
ALTER TABLE pois ADD CONSTRAINT pois_wheelchair_check
  CHECK (wheelchair IS NULL OR wheelchair IN ('yes','limited','no','designated'));

ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_fee_check;
ALTER TABLE pois ADD CONSTRAINT pois_fee_check
  CHECK (fee IS NULL OR fee IN ('yes','no','conditional'));

COMMIT;
