-- Migration 026: Drop poi_type column
-- All logic now uses poi_roles array. poi_type is fully replaced.

-- Drop unique constraint that depended on poi_type
ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_name_poi_type_active_key;

-- Drop poi_type column
ALTER TABLE pois DROP COLUMN IF EXISTS poi_type;
