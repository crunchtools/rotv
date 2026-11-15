// Run: node --test tests/migrations/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE, checkSql, selectFiles, statements } from '../../scripts/check-migrations.mjs';

const why = (sql) => checkSql(sql).map((p) => p.why);

test('additive migrations pass', () => {
  assert.deepEqual(
    why(`
      CREATE TABLE IF NOT EXISTS trips (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS webcam_url TEXT;
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS runs INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pois ALTER COLUMN code_hash DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS pois_name ON pois (name);
      DROP INDEX IF EXISTS pois_old_name;
      UPDATE pois SET name = 'Drop Table Rock' WHERE id = 1;
    `),
    []
  );
});

test('each contract statement is refused', () => {
  assert.deepEqual(why('DROP TABLE IF EXISTS sync_queue;'), ['drops a table']);
  assert.deepEqual(why('DROP VIEW moderation_queue CASCADE;'), ['drops a view']);
  assert.deepEqual(why('DROP MATERIALIZED VIEW m;'), ['drops a materialized view']);
  assert.deepEqual(why('ALTER TABLE pois DROP COLUMN IF EXISTS poi_type;'), ['drops a column']);
  assert.deepEqual(why('ALTER TABLE poi_news RENAME COLUMN a TO b;'), ['renames a table, view or column']);
  assert.deepEqual(why('ALTER TABLE poi_news RENAME TO news;'), ['renames a table, view or column']);
  assert.deepEqual(why('ALTER TABLE t ALTER COLUMN c TYPE TIMESTAMPTZ;'), ["changes a column's type"]);
  assert.deepEqual(why('ALTER TABLE t ALTER COLUMN c SET DATA TYPE TEXT;'), ["changes a column's type"]);
  assert.deepEqual(why('ALTER TABLE t ALTER COLUMN c SET NOT NULL;'), ['tightens a column to NOT NULL']);
  assert.deepEqual(why('ALTER TABLE t ADD COLUMN c NUMERIC(10,2) NOT NULL;'), [
    'adds a NOT NULL column with no DEFAULT',
  ]);
});

test('renaming a constraint is not a contract', () => {
  assert.deepEqual(why('ALTER TABLE t RENAME CONSTRAINT a TO b;'), []);
});

test('the contract marker opts one statement out, not the file', () => {
  const sql = `
    -- contract: v1.71.0 stopped reading pois.legacy_flag
    ALTER TABLE pois DROP COLUMN IF EXISTS legacy_flag;
    ALTER TABLE pois DROP COLUMN IF EXISTS other_flag;
  `;
  const problems = checkSql(sql);
  assert.equal(problems.length, 1);
  assert.match(problems[0].code, /other_flag/);
  assert.equal(problems[0].line, 4);
});

test('a marker with no reason does not count', () => {
  assert.equal(checkSql('-- contract:\nDROP TABLE x;').length, 1);
});

test('DDL inside a DO block is seen, apostrophes and all', () => {
  const sql = `
    DO $$
    BEGIN
      RAISE NOTICE 'it''s fine';
      IF EXISTS (SELECT 1) THEN
        ALTER TABLE poi_news DROP COLUMN source;
      END IF;
    END $$;
  `;
  assert.deepEqual(why(sql), ['drops a column']);
  assert.deepEqual(why("DO $body$ BEGIN EXECUTE 'DROP TABLE x'; END $body$;"), ['drops a table']);
});

test('an ADD COLUMN in a DO block ends at its semicolon', () => {
  const sql = `DO $$ BEGIN
    ALTER TABLE pois ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);
    UPDATE pois SET geom = NULL WHERE latitude IS NOT NULL;
  END $$;`;
  assert.deepEqual(why(sql), []);
});

test('comments and strings outside a block are not code', () => {
  assert.deepEqual(why("-- DROP TABLE x;\n/* DROP COLUMN y */ SELECT 'DROP TABLE z';"), []);
});

test('statements carry the line they start on', () => {
  assert.deepEqual(
    statements('SELECT 1;\n\n-- c\nSELECT 2;').map((s) => s.line),
    [1, 3]
  );
});

test('files above the baseline and changed files are selected', () => {
  const old = `backend/migrations/${String(BASELINE).padStart(3, '0')}_old.sql`;
  const next = `backend/migrations/${BASELINE + 1}_new.sql`;
  const edited = 'backend/migrations/050_edited.sql';
  assert.deepEqual(selectFiles([old, next, edited], []), [next]);
  assert.deepEqual(selectFiles([old, next, edited], [edited]), [edited, next]);
});
