-- Migration 097: unique POI names (#740)
-- pois_name_key never built in production: duplicate names blocked it and
-- initDatabase swallowed the failure on every boot, so the ON CONFLICT (name)
-- import paths behaved differently there than in dev and CI. Names each
-- duplicate in the boot log (rotv-init.sh surfaces WARNING lines) and builds
-- the index only when nothing blocks it. Non-partial on (name): the import
-- routes and initDatabase rely on ON CONFLICT (name), and a retired POI keeps
-- its name free by being renamed "<name> [merged into #N]".
-- server.js initDatabase creates it as well, for a fresh database where this
-- file runs before the pois table exists. Idempotent: runs on every boot.

DO $$
DECLARE
  dup RECORD;
  blocked BOOLEAN := FALSE;
BEGIN
  IF to_regclass('pois') IS NULL OR to_regclass('pois_name_key') IS NOT NULL THEN
    RETURN;
  END IF;

  FOR dup IN
    SELECT name,
           string_agg('#' || id || CASE WHEN deleted IS TRUE THEN ' (deleted)' ELSE '' END, ', ' ORDER BY id) AS ids
      FROM pois
     GROUP BY name
    HAVING COUNT(*) > 1
     ORDER BY name
  LOOP
    blocked := TRUE;
    RAISE WARNING 'pois_name_key blocked by duplicate name "%": %', dup.name, dup.ids;
  END LOOP;

  IF NOT blocked THEN
    CREATE UNIQUE INDEX IF NOT EXISTS pois_name_key ON pois (name);
  END IF;
END $$;
