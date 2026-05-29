-- Migration 071: GiST index on pois.boundary_geom
-- Spec 030-moderation-gates (PR #447 review)
--
-- The POI gate's Tier-2 reassignment (getReassignmentCandidates) runs ST_Contains
-- against boundary polygons, as do getContainingBoundaries and getRollupPoiIds. Only
-- the point `geom` column was indexed (idx_pois_geom); index boundary_geom too so the
-- spatial containment lookups stay index-backed as boundary data grows.

CREATE INDEX IF NOT EXISTS idx_pois_boundary_geom ON pois USING GIST (boundary_geom);
