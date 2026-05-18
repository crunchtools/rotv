-- Migration 052: Recategorize legacy boundary_type='cvnp' into park/municipal
-- Purpose: Legacy bucket grouped the CVNP park polygon together with all
-- the cities/townships that fall inside or border CVNP. The new grouped-legend
-- feature (spec 015) needs accurate categorization so the Parks and Municipal
-- sections populate from real data.
--
-- Reference: server.js:609 originally set boundary_type='cvnp' for every
-- NULL boundary at startup. That bucket conflated parks with jurisdictions.

UPDATE pois
SET boundary_type = 'park'
WHERE boundary_type = 'cvnp'
  AND name = 'Cuyahoga Valley National Park';

UPDATE pois
SET boundary_type = 'municipal'
WHERE boundary_type = 'cvnp';
