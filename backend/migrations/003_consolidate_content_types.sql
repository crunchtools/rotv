-- Migration 003: Consolidate content types
-- Events: 83 types → 9 canonical types (hike, race, concert, festival, program, volunteer, arts, community, alert)
-- News: 6+ types → 5 canonical types (general, alert, wildlife, infrastructure, community)

-- === EVENT TYPE CONSOLIDATION ===

-- hike: guided tours, hiking, outdoor adventures, trails, recreation
UPDATE poi_events SET event_type = 'hike' WHERE event_type IN (
  'guided-tour', 'hiking', 'hike', 'hikes & outdoor adventures', 'trail',
  'recreation', 'scenic-drive', 'wildlife viewing', 'tour'
);

-- race: running, sports, athletic competitions
UPDATE poi_events SET event_type = 'race' WHERE event_type IN (
  'sports', 'sporting', 'sport', 'sporting event', 'trail-race',
  'trail run', 'trail-run', 'trail running', 'marathon', 'running',
  'run/walk', 'fun-run', 'athletics', 'fitness', 'tournament'
);

-- concert: music performances
UPDATE poi_events SET event_type = 'concert' WHERE event_type IN (
  'music', 'tribute', 'comedy', 'performance', 'dance'
);

-- festival: fairs, expos, celebrations
UPDATE poi_events SET event_type = 'festival' WHERE event_type IN (
  'fair', 'expo', 'celebration', 'special events', 'special',
  'special-events', 'family-Friendly'
);

-- volunteer: volunteer work, trail maintenance
UPDATE poi_events SET event_type = 'volunteer' WHERE event_type IN (
  'Trail Work & Volunteer Opportunities', 'charity'
);

-- arts: theater, visual arts, exhibitions
UPDATE poi_events SET event_type = 'arts' WHERE event_type IN (
  'theater', 'arts & theatre', 'arts', 'film', 'exhibition',
  'exhibits', 'on exhibit', 'visual arts'
);

-- community: meetings, social, networking, religious, dining
UPDATE poi_events SET event_type = 'community' WHERE event_type IN (
  'community', 'meeting', 'Meeting', 'networking', 'Networking',
  'Meetup', 'Meetups', 'meetup', 'social', 'dining', 'conference',
  'convention', 'rally', 'government', 'management/planning',
  'Management/Planning', 'hobbies', 'trivia', 'religious', 'worship',
  'pilgrimage', 'ceremony', 'wellness', 'seminar', 'workshop',
  'retreat', 'Day Camps'
);

-- alert: closures, maintenance, seasonal
UPDATE poi_events SET event_type = 'alert' WHERE event_type IN (
  'closure', 'maintenance', 'seasonal'
);

-- program: educational + general + anything remaining
UPDATE poi_events SET event_type = 'program' WHERE event_type IN (
  'educational', 'nature education'
);
UPDATE poi_events SET event_type = 'program' WHERE event_type NOT IN (
  'hike', 'race', 'concert', 'festival', 'program', 'volunteer', 'arts', 'community', 'alert'
);

-- === NEWS TYPE CONSOLIDATION ===

-- alert: closures, maintenance, seasonal
UPDATE poi_news SET news_type = 'alert' WHERE news_type IN (
  'closure', 'maintenance', 'seasonal'
);

-- infrastructure: (new type, currently empty — will be assigned by future scraper runs)

-- community: (new type, currently empty)

-- award → general (small count, not worth its own type)
UPDATE poi_news SET news_type = 'general' WHERE news_type = 'award';

-- Catch any remaining unknown types
UPDATE poi_news SET news_type = 'general' WHERE news_type NOT IN (
  'general', 'alert', 'wildlife', 'infrastructure', 'community'
);
