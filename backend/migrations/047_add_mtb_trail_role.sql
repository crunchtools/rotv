-- Migration: 047_add_mtb_trail_role
-- Description: Add 'mtb_trail' to poi_roles for all POIs that have is_mtb_trail = TRUE

UPDATE pois
SET poi_roles = array_append(poi_roles, 'mtb_trail')
WHERE is_mtb_trail = TRUE
  AND NOT ('mtb_trail' = ANY(poi_roles));
