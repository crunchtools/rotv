-- Migration 051: Add Astronomy activity, icon, and Fairlawn Rotary Observatory POI
-- Purpose: Closes issue #6 — adds the first astronomy site (Fairlawn Rotary in Bath, OH,
-- operated by the Summit County Astronomy Club) as an example POI plus the supporting
-- activity + icon catalog rows so the new chip surfaces in the legend automatically.

DO $$
DECLARE
  next_activity_sort INTEGER;
  next_icon_sort INTEGER;
BEGIN
  -- 1. Activity
  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO next_activity_sort FROM activities;
  INSERT INTO activities (name, sort_order)
  VALUES ('Astronomy', next_activity_sort)
  ON CONFLICT (name) DO NOTHING;

  -- 2. Icon (inline telescope SVG on a night-sky background)
  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO next_icon_sort FROM icons;
  INSERT INTO icons (name, label, svg_content, title_keywords, activity_fallbacks, sort_order, enabled)
  VALUES (
    'astronomy',
    'Astronomy',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#1a1a3e" stroke="white" stroke-width="2"/><circle cx="22" cy="9" r="1" fill="white"/><circle cx="9" cy="11" r="0.8" fill="white"/><circle cx="24" cy="20" r="0.6" fill="white"/><line x1="9" y1="22" x2="20" y2="11" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="12" y1="24" x2="9" y2="22" stroke="white" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="22" x2="6" y2="24" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>',
    'observatory,telescope,planetarium,astronomy,stargazing,star party',
    'Astronomy',
    next_icon_sort,
    TRUE
  )
  ON CONFLICT (name) DO NOTHING;

  -- 3. POI: Fairlawn Rotary Observatory
  IF NOT EXISTS (SELECT 1 FROM pois WHERE name = 'Fairlawn Rotary Observatory') THEN
    INSERT INTO pois (
      name, latitude, longitude, poi_roles, primary_activities,
      property_owner, brief_description, more_info_link
    )
    VALUES (
      'Fairlawn Rotary Observatory',
      41.1693, -81.6308,
      '{point}',
      'Astronomy',
      'Summit County Astronomy Club',
      'Free public observatory operated by the Summit County Astronomy Club at 4160 Ira Road, Bath, OH. Programs are weather and volunteer dependent — check the meetup page for open nights. Ages 7 and up. Official James Webb Space Telescope site. The grounds include a 1.3-mile Walk of Planets (Sun to Pluto) built with Bath Township. Equipment includes a Celestron EdgeHD 14-inch on an Astro-Physics 1200 mount plus multiple 11-inch pier-mounted telescopes across two roll-off-roof buildings.',
      'https://www.meetup.com/summit-county-astronomy-meetup/'
    );
    RAISE NOTICE 'Inserted Fairlawn Rotary Observatory POI';
  ELSE
    RAISE NOTICE 'Fairlawn Rotary Observatory POI already exists, skipping';
  END IF;
END $$;
