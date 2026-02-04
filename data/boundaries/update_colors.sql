-- Update Akron and Cuyahoga Falls boundary colors
-- These colors are distinct from existing municipality boundaries

-- Akron: Medium Purple (#9370DB)
UPDATE pois 
SET boundary_color = '#9370DB'
WHERE poi_type = 'boundary' AND name = 'Akron';

-- Cuyahoga Falls: Light Sea Green (#20B2AA)
UPDATE pois 
SET boundary_color = '#20B2AA'
WHERE poi_type = 'boundary' AND name = 'Cuyahoga Falls';

-- Verify updates
SELECT name, boundary_color 
FROM pois 
WHERE poi_type = 'boundary' AND name IN ('Akron', 'Cuyahoga Falls');
