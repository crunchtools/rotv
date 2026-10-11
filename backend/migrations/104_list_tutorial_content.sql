-- Migration 104: About › Tutorial text for the curated-list tour (spec 050)
--
-- The words above the "Take the Fall Hiking Spree Tour" button. The section
-- shows only while a featured list is in season. Admins can edit the text
-- through the standard about-content editor once seeded.

INSERT INTO admin_settings (key, value) VALUES
('about_list_tutorial_md', '## Track a Hiking Challenge

Seasonal challenges such as the Summit Metro Parks Fall Hiking Spree live in Find. Check off each trail as you hike it, set the date, and watch the meter climb toward your badge. Add your mailing details once in Settings and the official form downloads already filled in, ready to turn in.')
ON CONFLICT (key) DO NOTHING;
