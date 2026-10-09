-- Migration 095: one POI per park (spec 048)
-- merged_into_id: a POI folded into another by poiMergeService keeps its row,
-- soft-deleted, so ids and permalinks people hold still resolve.
-- poi_name_key(): a place's name as people mean it (case, apostrophe style and
-- a trailing county dropped); SQL twin of normalizePoiName().
-- server.js initDatabase creates both as well, for a fresh database where this
-- file runs before the pois table exists. Idempotent: runs on every boot.

DO $$
BEGIN
  IF to_regclass('pois') IS NOT NULL THEN
    ALTER TABLE pois ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES pois(id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION poi_name_key(n text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  -- Fix: replace(), not translate() (PR #733 review): production is SQL_ASCII, where translate() works a
  -- byte at a time and turns one curly apostrophe into two straight ones.
  SELECT lower(btrim(regexp_replace(
    regexp_replace(
      replace(replace(n, '‘', ''''), '’', ''''),
      '\s+(summit|cuyahoga|portage|medina|stark|geauga|lake)\s+county\s*$', '', 'i'),
    '\s+', ' ', 'g')))
$fn$;
