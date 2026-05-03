-- Cap any trail_status last_updated dates that are in the future back to created_at
-- These occur when Gemini misinterprets phrases like "opening the week of May 24th" as the status date
UPDATE trail_status
SET last_updated = created_at
WHERE last_updated > NOW();
