-- 056_add_trip_tutorial_content.sql
-- Seed markdown content for the new Trip Planning tutorial on the
-- About → Tutorials page. Admins can edit through the standard about-content
-- editor once seeded.

INSERT INTO admin_settings (key, value) VALUES
('about_trip_tutorial_md', '## Plan a Day Trip

Build a multi-stop itinerary across the valley, save it to your account, and hand the whole route off to Google Maps starting from your current location. Featured Routes curated by admins are available too, and you can share your own trips with friends after a quick review.')
ON CONFLICT (key) DO NOTHING;
