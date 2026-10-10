-- Migration: 100_add_mandel_community_trail.sql
-- Description: Add the Mandel Community Trail (#738), the paved, lighted 2.7-mile
--   lakefront trail between East 9th and East 55th streets in Cleveland that opened
--   in September 2026. Geometry is OpenStreetMap-derived (ODbL): the 21 ways
--   named "Mandel Community Trail" (way/1422115795 at East 9th through way/1557687515
--   at East 55th) chained end to end into one line.
-- Idempotent: the insert is guarded by name, so re-runs are no-ops and later admin
--   edits are not clobbered. The news move below rides on the insert, so it happens
--   only on the run that creates the trail.

WITH created AS (
INSERT INTO pois (
  name,
  brief_description,
  poi_roles,
  latitude,
  longitude,
  primary_activities,
  length_miles,
  surface,
  is_bike_friendly,
  property_owner,
  owner_id,
  geometry,
  more_info_link
)
SELECT
  'Mandel Community Trail',
  'A paved, lighted 2.7-mile off-road trail along Cleveland''s lakefront between East 9th Street downtown and East 55th Street, where it meets the Cleveland Lakefront Bikeway. Opened in September 2026 as a partnership of Cuyahoga County, the City of Cleveland and Cleveland Metroparks, with a $5 million gift from the Jack, Joseph and Morton Mandel Foundation.',
  ARRAY['trail'],
  41.51928,
  -81.67371,
  'Biking, Hiking',
  2.7,
  'Paved',
  TRUE,
  'Cleveland Metroparks',
  (SELECT id FROM pois
    WHERE name = 'Cleveland Metroparks' AND 'organization' = ANY(poi_roles)
      AND deleted IS NOT TRUE
    LIMIT 1),
  '{"type":"LineString","coordinates":[[-81.6939251,41.5084223],[-81.6938865,41.5084361],[-81.6938513,41.5084499],[-81.6938043,41.5084724],[-81.693793,41.5084803],[-81.6937853,41.5084888],[-81.693774,41.5084982],[-81.6937284,41.5085175],[-81.693687,41.508535],[-81.6936476,41.5085558],[-81.6934712,41.5086447],[-81.6933782,41.5086918],[-81.6932834,41.5087374],[-81.6931911,41.5087804],[-81.6931076,41.5088188],[-81.6930236,41.5088583],[-81.6929553,41.5088857],[-81.6928886,41.5089125],[-81.6927918,41.508953],[-81.692712,41.5089836],[-81.6917184,41.5093583],[-81.6916618,41.5093803],[-81.6916019,41.5094036],[-81.6913365,41.5095024],[-81.6913023,41.5095198],[-81.6912677,41.5095388],[-81.6912482,41.5095524],[-81.6912302,41.5095692],[-81.691215,41.5095865],[-81.6911218,41.5096166],[-81.6910536,41.5096386],[-81.6910434,41.5096319],[-81.6910223,41.5096276],[-81.6910037,41.5096275],[-81.6909852,41.5096315],[-81.6909676,41.5096384],[-81.6897744,41.5100927],[-81.6896287,41.51015],[-81.6895086,41.5102],[-81.6893744,41.5102585],[-81.6892406,41.5103186],[-81.6890905,41.5103929],[-81.6889596,41.5104588],[-81.6888171,41.5105319],[-81.6881062,41.5108977],[-81.6880967,41.5109052],[-81.6880892,41.5109174],[-81.6880843,41.5109314],[-81.6880837,41.5109467],[-81.6880871,41.5109604],[-81.6880953,41.5109757],[-81.6881118,41.5110024],[-81.6880547,41.5110299],[-81.6880017,41.5110556],[-81.6878955,41.5111056],[-81.6878309,41.5110402],[-81.6877139,41.511103],[-81.6875279,41.5112478],[-81.6874732,41.5112818],[-81.6874169,41.5113151],[-81.6873481,41.5113543],[-81.6871784,41.5114442],[-81.6871102,41.5114734],[-81.6870409,41.5114998],[-81.6869448,41.5115315],[-81.6868673,41.5115634],[-81.6867942,41.5115951],[-81.6867363,41.5116263],[-81.6866763,41.511662],[-81.6865223,41.511753],[-81.6861855,41.5119913],[-81.6861401,41.5120194],[-81.6861036,41.512042],[-81.685892,41.5121648],[-81.685807,41.5122019],[-81.6857428,41.5122383],[-81.6856785,41.5122874],[-81.6856291,41.512338],[-81.6855847,41.5123901],[-81.6855533,41.5124357],[-81.6855313,41.512461],[-81.6855047,41.5124855],[-81.6854328,41.5125416],[-81.6848143,41.513025],[-81.6847683,41.5130613],[-81.6847297,41.5130917],[-81.6846607,41.5131417],[-81.6845191,41.5132344],[-81.6844603,41.5132562],[-81.6844137,41.5132804],[-81.6843683,41.5133113],[-81.6842163,41.5134257],[-81.6841054,41.513518],[-81.6840022,41.5136083],[-81.6839692,41.5136517],[-81.6839377,41.5136909],[-81.6839028,41.5137272],[-81.6838625,41.5137581],[-81.683816,41.5137865],[-81.6837609,41.5138184],[-81.6836928,41.5138515],[-81.6836366,41.5138853],[-81.6835664,41.5139389],[-81.6834348,41.5140339],[-81.6833749,41.5140736],[-81.6833198,41.5141101],[-81.683138,41.5142591],[-81.683076,41.5143191],[-81.6830019,41.5143772],[-81.6829467,41.5144181],[-81.6828843,41.514459],[-81.6828087,41.5144954],[-81.6827231,41.5145367],[-81.6825979,41.5146011],[-81.6824868,41.5146647],[-81.6823676,41.5147372],[-81.6821373,41.5148781],[-81.6820676,41.5149185],[-81.682009,41.5149475],[-81.681951,41.5149678],[-81.6818983,41.5149804],[-81.6818682,41.5149893],[-81.6817524,41.5150488],[-81.6815888,41.5151572],[-81.6814305,41.5153179],[-81.6813313,41.5154665],[-81.6812696,41.5156533],[-81.6812535,41.515816],[-81.6812124,41.5160681],[-81.6810823,41.5163055],[-81.680879,41.5165186],[-81.6805701,41.5166952],[-81.6801757,41.5169113],[-81.6798667,41.5170179],[-81.6795537,41.5170513],[-81.6791553,41.5170087],[-81.6788788,41.51696],[-81.6786796,41.516957],[-81.6784764,41.5169691],[-81.6782528,41.5169996],[-81.6779682,41.5170879],[-81.6777202,41.5172005],[-81.6757705,41.518198],[-81.6750139,41.5186001],[-81.6722213,41.5200638],[-81.671143,41.520614],[-81.6693054,41.5215645],[-81.667481,41.5225165],[-81.6673581,41.5225806],[-81.6660226,41.5232702],[-81.6634959,41.5245996],[-81.6633472,41.5246731],[-81.6632116,41.5247402],[-81.6611172,41.5258385],[-81.6604924,41.5261662],[-81.6583198,41.5272987],[-81.6574877,41.5277191],[-81.6572308,41.5278489],[-81.6566599,41.5281343],[-81.6557704,41.528579],[-81.6555719,41.5286782],[-81.6545225,41.5292588],[-81.6544323,41.5293088],[-81.6542094,41.5294545],[-81.6539864,41.5296187],[-81.6537087,41.5297486],[-81.6533053,41.5300082],[-81.6528912,41.5302943],[-81.652808,41.5303584],[-81.6527153,41.5303996]]}'::jsonb,
  'https://www.clevelandmetroparks.com/about/planning-design/planning-and-design-projects/projects/mandel-community-trail'
WHERE NOT EXISTS (
  SELECT 1 FROM pois WHERE name = 'Mandel Community Trail'
)
RETURNING id
)
-- The trail's opening was covered before it had a POI, so the collector filed those
-- articles under the nearest places it knew. Move them to the trail so they show on
-- its News tab. Each row is matched by URL and by the POI it was filed under, and
-- only when this run created the trail: a re-run finds the trail already there and
-- moves nothing, so an admin who files an article back where it was keeps it there.
UPDATE poi_news n
SET poi_id = created.id
FROM created, (VALUES
  ('https://www.news5cleveland.com/news/local-news/oh-cuyahoga/cleveland-metroparks-opens-mandel-community-trail-connecting-lakefront-to-city-neighborhoods', 'Cleveland Lakefront Bikeway'),
  ('https://cuyahogacounty.gov/county-news/county-news-detail/2026/09/22/mandel-community-trail-opens--creating-new-connection-to-cleveland-s-lakefront', 'East 55th Street Marina'),
  ('https://spectrumnews1.com/oh/dayton/news/2026/09/24/new-trail-increases-access-to-cleveland-s-east-side-lakefront', 'Cleveland Metroparks'),
  ('https://www.clevelandmetroparks.com/news-press/transformative-mandel-community-trail-opens-creating-new-connection-to-cleveland-s-lakefront', 'Cleveland Metroparks')
) AS moved(source_url, filed_under)
JOIN pois filed ON filed.name = moved.filed_under
WHERE n.source_url = moved.source_url
  AND n.poi_id = filed.id;

-- Point geometry for spatial queries (mirrors migration 021, which runs before this file).
UPDATE pois SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE name = 'Mandel Community Trail' AND geom IS NULL;
