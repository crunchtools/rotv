-- Migration 025: Rename virtual POI type/role to organization
-- 'virtual' was a placeholder name for organizations, agencies, and stewardship groups.
-- Renaming to 'organization' for clarity.

UPDATE pois
SET
  poi_type = 'organization',
  poi_roles = array_replace(poi_roles, 'virtual', 'organization')
WHERE 'virtual' = ANY(poi_roles);
