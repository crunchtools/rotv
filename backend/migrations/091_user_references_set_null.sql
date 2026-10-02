-- Migration 091: Let deleting a user detach their contributions (#700)
-- Contribution and moderation columns (submitted_by, moderated_by, updated_by)
-- reference users(id) with the default NO ACTION, which blocks DELETE FROM
-- users. Recreate every such single-column, nullable reference as
-- ON DELETE SET NULL: published content stays, the link to the person goes.
-- Per-user tables already use ON DELETE CASCADE and are untouched.
-- Idempotent: once converted, no constraint matches on the next boot.

DO $$
DECLARE
  ref RECORD;
BEGIN
  FOR ref IN
    SELECT con.conname, cl.relname AS table_name, att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'users'::regclass
      AND con.confdeltype IN ('a', 'r')
      AND array_length(con.conkey, 1) = 1
      AND NOT att.attnotnull
      AND ns.nspname = current_schema()
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', ref.table_name, ref.conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL',
      ref.table_name, ref.conname, ref.column_name
    );
    RAISE NOTICE 'users FK %.% now ON DELETE SET NULL', ref.table_name, ref.column_name;
  END LOOP;
END $$;
