-- Migration 003: Consolidate content types
-- Events: 83 types → 9 canonical types (hike, race, concert, festival, program, volunteer, arts, community, alert)
-- News: 6+ types → 5 canonical types (general, alert, wildlife, infrastructure, community)
-- Uses LOWER() for case-insensitive matching

-- === EVENT TYPE CONSOLIDATION ===

-- hike: guided tours, hiking, outdoor adventures, trails, recreation
UPDATE poi_events SET event_type = 'hike' WHERE LOWER(event_type) IN (
  'guided-tour', 'hiking', 'hikes & outdoor adventures', 'trail',
  'recreation', 'scenic-drive', 'wildlife viewing', 'tour'
) AND event_type != 'hike';

-- race: running, sports, athletic competitions
UPDATE poi_events SET event_type = 'race' WHERE LOWER(event_type) IN (
  'sports', 'sporting', 'sport', 'sporting event', 'trail-race',
  'trail run', 'trail-run', 'trail running', 'marathon', 'running',
  'run/walk', 'fun-run', 'athletics', 'fitness', 'tournament'
) AND event_type != 'race';

-- concert: music performances
UPDATE poi_events SET event_type = 'concert' WHERE LOWER(event_type) IN (
  'music', 'tribute', 'comedy', 'performance', 'dance'
) AND event_type != 'concert';

-- festival: fairs, expos, celebrations
UPDATE poi_events SET event_type = 'festival' WHERE LOWER(event_type) IN (
  'fair', 'expo', 'celebration', 'special events', 'special',
  'special-events', 'family-friendly'
) AND event_type != 'festival';

-- volunteer: volunteer work, trail maintenance
UPDATE poi_events SET event_type = 'volunteer' WHERE LOWER(event_type) IN (
  'trail work & volunteer opportunities', 'charity'
) AND event_type != 'volunteer';

-- arts: theater, visual arts, exhibitions
UPDATE poi_events SET event_type = 'arts' WHERE LOWER(event_type) IN (
  'theater', 'arts & theatre', 'film', 'exhibition',
  'exhibits', 'on exhibit', 'visual arts'
) AND event_type != 'arts';

-- community: meetings, social, networking, religious, dining
UPDATE poi_events SET event_type = 'community' WHERE LOWER(event_type) IN (
  'meeting', 'networking', 'meetup', 'meetups', 'social', 'dining',
  'conference', 'convention', 'rally', 'government', 'management/planning',
  'hobbies', 'trivia', 'religious', 'worship', 'pilgrimage', 'ceremony',
  'wellness', 'seminar', 'workshop', 'retreat', 'day camps'
) AND event_type != 'community';

-- alert: closures, maintenance, seasonal
UPDATE poi_events SET event_type = 'alert' WHERE LOWER(event_type) IN (
  'closure', 'maintenance', 'seasonal'
) AND event_type != 'alert';

-- program: educational + anything remaining not in canonical set
UPDATE poi_events SET event_type = 'program' WHERE LOWER(event_type) IN (
  'educational', 'nature education'
) AND event_type != 'program';
UPDATE poi_events SET event_type = 'program' WHERE event_type NOT IN (
  'hike', 'race', 'concert', 'festival', 'program', 'volunteer', 'arts', 'community', 'alert'
);

-- === NEWS TYPE CONSOLIDATION ===

-- alert: closures, maintenance, seasonal
UPDATE poi_news SET news_type = 'alert' WHERE LOWER(news_type) IN (
  'closure', 'maintenance', 'seasonal'
) AND news_type != 'alert';

-- Catch any remaining unknown types (including 'award' etc.)
UPDATE poi_news SET news_type = 'general' WHERE news_type NOT IN (
  'general', 'alert', 'wildlife', 'infrastructure', 'community'
);
