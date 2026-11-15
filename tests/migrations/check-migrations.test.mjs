// Run: node --test tests/migrations/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE, checkSql, emptyKnown, histories, parseDiff, selectFiles, statements } from '../../scripts/check-migrations.mjs';

const why = (sql) => checkSql(sql).map((p) => p.why);

test('additive migrations pass', () => {
  assert.deepEqual(
    why(`
      CREATE TABLE IF NOT EXISTS trips (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS webcam_url TEXT;
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS runs INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pois ALTER COLUMN code_hash DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS pois_name ON pois (name);
      DROP INDEX IF EXISTS pois_name_idx;
      CREATE INDEX IF NOT EXISTS pois_name_idx ON pois (lower(name));
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
  assert.deepEqual(selectFiles([old, next, edited], new Map()), [[next, null]]);
  const changes = { ranges: [[3, 4]], removed: '' };
  assert.deepEqual(selectFiles([old, next, edited], new Map([[edited, changes]])), [
    [edited, changes],
    [next, null],
  ]);
});

// Review items from PR #898, one block each.

test('1: DROP without COLUMN is a column drop, DROP CONSTRAINT is not', () => {
  assert.deepEqual(why('ALTER TABLE pois DROP legacy_flag;'), ['drops a column']);
  assert.deepEqual(why('ALTER TABLE pois DROP IF EXISTS legacy_flag;'), ['drops a column']);
  assert.deepEqual(why('ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_chk;'), ['drops a constraint']);
  assert.deepEqual(why('ALTER TABLE pois ALTER COLUMN c DROP NOT NULL, ALTER c DROP DEFAULT;'), []);
});

test('2: COLUMN is optional and quoted names count for TYPE and SET NOT NULL', () => {
  assert.deepEqual(why('ALTER TABLE t ALTER c TYPE TEXT;'), ["changes a column's type"]);
  assert.deepEqual(why('ALTER TABLE t ALTER "my col" TYPE TEXT;'), ["changes a column's type"]);
  assert.deepEqual(why('ALTER TABLE t ALTER COLUMN "my col" SET DATA TYPE TEXT;'), ["changes a column's type"]);
  assert.deepEqual(why('ALTER TABLE t ALTER c SET NOT NULL;'), ['tightens a column to NOT NULL']);
  assert.deepEqual(why('ALTER TABLE t ALTER "my col" SET NOT NULL;'), ['tightens a column to NOT NULL']);
});

test('3: ADD without COLUMN, and DEFAULT NULL is no default', () => {
  const noDefault = ['adds a NOT NULL column with no DEFAULT'];
  assert.deepEqual(why('ALTER TABLE t ADD c INTEGER NOT NULL;'), noDefault);
  assert.deepEqual(why('ALTER TABLE t ADD IF NOT EXISTS c INTEGER NOT NULL;'), noDefault);
  assert.deepEqual(why('ALTER TABLE t ADD COLUMN c TEXT NOT NULL DEFAULT NULL;'), noDefault);
  assert.deepEqual(why('ALTER TABLE t ADD c TEXT NOT NULL DEFAULT NULL::text;'), noDefault);
  assert.deepEqual(why("ALTER TABLE t ADD c TEXT NOT NULL DEFAULT 'x';"), []);
  assert.deepEqual(why('ALTER TABLE t ADD c INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL;'), []);
});

test('4: index and constraint drops pass only when the file re-creates the name', () => {
  assert.deepEqual(why('DROP INDEX IF EXISTS pois_old_name;'), ['drops an index']);
  assert.deepEqual(why('DROP INDEX a, b; CREATE INDEX a ON t (x);'), ['drops an index']);
  assert.deepEqual(why('DROP INDEX CONCURRENTLY IF EXISTS a_idx; CREATE INDEX CONCURRENTLY a_idx ON t (x);'), []);
  // 016's pattern: widen a CHECK by dropping it and adding it back by name.
  assert.deepEqual(
    why(`ALTER TABLE poi_media DROP CONSTRAINT IF EXISTS poi_media_moderation_check;
      ALTER TABLE poi_media ADD CONSTRAINT poi_media_moderation_check
        CHECK (moderation_status IN ('pending', 'published', 'rejected'));`),
    []
  );
});

test('4: other drops and renames are refused', () => {
  assert.deepEqual(why('DROP FUNCTION IF EXISTS f(int);'), ['drops a function']);
  assert.deepEqual(why('DROP TYPE mood;'), ['drops a type']);
  assert.deepEqual(why('DROP SEQUENCE s;'), ['drops a sequence']);
  assert.deepEqual(why('DROP TRIGGER IF EXISTS trg ON t;'), ['drops a trigger']);
  assert.deepEqual(why("ALTER TYPE mood RENAME VALUE 'sad' TO 'blue';"), ['renames a type or its values']);
  assert.deepEqual(why('ALTER INDEX i RENAME TO j;'), ['renames an index or its values']);
  assert.deepEqual(why('ALTER FUNCTION f(int) RENAME TO g;'), ['renames a function or its values']);
  assert.deepEqual(why('ALTER SEQUENCE s RENAME TO s2;'), ['renames a sequence or its values']);
  assert.deepEqual(why("ALTER TYPE mood ADD VALUE IF NOT EXISTS 'blue';"), []);
});

test('5: E-strings with backslash escapes do not derail the scan', () => {
  assert.deepEqual(why("UPDATE t SET s = E'it\\'s; DROP TABLE x'; DROP TABLE y;"), ['drops a table']);
  assert.equal(statements("SELECT E'a\\'b'; SELECT 2;").length, 2);
  // A plain string ending in a backslash is not an escape.
  assert.deepEqual(why("SELECT 'C:\\'; DROP TABLE y;"), ['drops a table']);
});

test('6: a marker covers the next statement only', () => {
  const sql = `
    -- contract: v1.71.0 stopped reading both
    DO $$ BEGIN
      ALTER TABLE pois DROP COLUMN IF EXISTS a;
      ALTER TABLE pois DROP COLUMN IF EXISTS b;
    END $$;
  `;
  const problems = checkSql(sql);
  assert.equal(problems.length, 1);
  assert.match(problems[0].code, /DROP COLUMN IF EXISTS b/);
  assert.equal(problems[0].line, 5);
});

test('6: each statement in a DO block can carry its own marker', () => {
  const sql = `DO $$ BEGIN
      -- contract: v1.71.0 stopped reading a
      ALTER TABLE pois DROP COLUMN IF EXISTS a;
      -- contract: v1.71.0 stopped reading b
      ALTER TABLE pois DROP COLUMN IF EXISTS b;
    END $$;`;
  assert.deepEqual(why(sql), []);
});

test('6: a marker after a semicolon belongs to that statement, not the next', () => {
  const sql = 'DROP TABLE a; -- contract: v1.71.0 stopped reading a\nDROP TABLE b;';
  const problems = checkSql(sql);
  assert.equal(problems.length, 1);
  assert.match(problems[0].code, /DROP TABLE b/);
  assert.equal(problems[0].line, 2);
});

test('7: -- inside a string in a body does not hide the rest of the line', () => {
  const sql = "DO $$ BEGIN RAISE NOTICE 'a -- b'; DROP TABLE x; END $$;";
  assert.deepEqual(why(sql), ['drops a table']);
  assert.deepEqual(why("DO $$ BEGIN PERFORM 'it''s -- fine'; DROP VIEW v; END $$;"), ['drops a view']);
});

test('8: adding a UNIQUE, CHECK or FOREIGN KEY constraint is refused', () => {
  assert.deepEqual(why('ALTER TABLE t ADD CONSTRAINT t_u UNIQUE (email);'), ['adds a UNIQUE constraint']);
  assert.deepEqual(why('ALTER TABLE t ADD CHECK (n > 0);'), ['adds a CHECK constraint']);
  assert.deepEqual(why('ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (u) REFERENCES u (id);'), [
    'adds a FOREIGN KEY constraint',
  ]);
  assert.deepEqual(why('ALTER TABLE t ADD COLUMN n INT, ADD CONSTRAINT c CHECK (n > 0) NOT VALID;'), [
    'adds a CHECK constraint',
  ]);
});

test('9: an edited old migration is judged on the statements it touches', () => {
  const sql = 'DROP TABLE a;\nDROP TABLE b;\nSELECT 1;\nSELECT\n  2;';
  const at = (...ranges) => ({ ranges, removed: '' });
  assert.equal(checkSql(sql).length, 2);
  assert.deepEqual(checkSql(sql, at([3, 3])), []);
  assert.deepEqual(checkSql(sql, at([2, 2])).map((p) => p.line), [2]);
  assert.deepEqual(checkSql(sql, at([5, 5])), []);
});

test('9: changed lines come from a zero-context diff', () => {
  const diff = [
    'diff --git a/backend/migrations/008_x.sql b/backend/migrations/008_x.sql',
    '--- a/backend/migrations/008_x.sql',
    '+++ b/backend/migrations/008_x.sql',
    '@@ -4 +4 @@',
    '@@ -10,2 +10,3 @@',
    '@@ -20,2 +21,0 @@',
    '-CREATE UNIQUE INDEX x ON t (a);',
    '-SELECT 1;',
    'diff --git a/backend/migrations/120_new.sql b/backend/migrations/120_new.sql',
    '--- /dev/null',
    '+++ b/backend/migrations/120_new.sql',
    '@@ -0,0 +1,5 @@',
  ].join('\n');
  assert.deepEqual(
    [...parseDiff(diff)],
    [
      [
        'backend/migrations/008_x.sql',
        { ranges: [[4, 4], [10, 12], [21, 22]], removed: 'CREATE UNIQUE INDEX x ON t (a);\nSELECT 1;\n' },
      ],
      ['backend/migrations/120_new.sql', null],
    ]
  );
});

// Re-review items from PR #898, one block each.

test('re-review 1: a re-create excuses a drop only as the same kind, table and uniqueness', () => {
  assert.deepEqual(why('DROP INDEX pois_slug_key; CREATE INDEX pois_slug_key ON pois(slug);'), ['drops an index']);
  assert.deepEqual(
    why('ALTER TABLE pois DROP CONSTRAINT pois_slug_key; ALTER TABLE pois ADD CONSTRAINT pois_slug_key CHECK (true);'),
    ['drops a constraint', 'adds a CHECK constraint']
  );
  assert.deepEqual(why('ALTER TABLE a DROP CONSTRAINT k; ALTER TABLE b ADD CONSTRAINT k CHECK (x > 0);'), [
    'drops a constraint',
    'adds a CHECK constraint',
  ]);
  // Same kind, same table: a unique index re-created unique, and 016's CHECK.
  assert.deepEqual(why('DROP INDEX pois_slug_key; CREATE UNIQUE INDEX pois_slug_key ON pois (lower(slug));'), []);
  assert.deepEqual(
    why(`ALTER TABLE poi_media DROP CONSTRAINT poi_media_moderation_check;
      ALTER TABLE poi_media ADD CONSTRAINT poi_media_moderation_check CHECK (moderation_status IS NOT NULL);`),
    []
  );
  // An earlier migration says what a name was, whatever its suffix.
  const known = emptyKnown();
  known.indexes.set('idx_slug', { table: 'pois', unique: true });
  assert.deepEqual(
    checkSql('DROP INDEX idx_slug; CREATE INDEX idx_slug ON pois (slug);', null, known).map((p) => p.why),
    ['drops an index']
  );
  // A name nothing describes is never a replacement.
  assert.deepEqual(why('DROP INDEX mystery; CREATE INDEX mystery ON pois (slug);'), ['drops an index']);
});

test('re-review 2: PRIMARY KEY, EXCLUDE and unique indexes are refused', () => {
  assert.deepEqual(why('ALTER TABLE t ADD PRIMARY KEY (id);'), ['adds a PRIMARY KEY constraint']);
  assert.deepEqual(why('ALTER TABLE t ADD CONSTRAINT t_pk PRIMARY KEY (id);'), ['adds a PRIMARY KEY constraint']);
  assert.deepEqual(why('ALTER TABLE t ADD EXCLUDE USING gist (r WITH &&);'), ['adds an EXCLUDE constraint']);
  assert.deepEqual(why('CREATE UNIQUE INDEX IF NOT EXISTS t_email ON t (email);'), ['adds a unique index']);
  assert.deepEqual(why('CREATE UNIQUE INDEX t_email ON public.t (email);'), ['adds a unique index']);
  // A unique index on a table this file creates has no old rows or writers.
  assert.deepEqual(why('CREATE TABLE IF NOT EXISTS t (email TEXT); CREATE UNIQUE INDEX t_email ON t (email);'), []);
});

test('re-review 4: removing the re-create that excused an old drop is judged', () => {
  const before = 'DROP INDEX x_key;\nSELECT 1;\nSELECT 2;\nSELECT 3;\nCREATE UNIQUE INDEX x_key ON t (a);\n';
  const after = 'DROP INDEX x_key;\nSELECT 1;\nSELECT 2;\nSELECT 3;\n';
  assert.deepEqual(why(before), []);
  const changes = { ranges: [[4, 5]], removed: 'CREATE UNIQUE INDEX x_key ON t (a);\n' };
  assert.deepEqual(checkSql(after, changes).map((p) => p.line), [1]);
  // Weakening the re-create in place is judged the same way.
  const weaker = before.replace('CREATE UNIQUE INDEX', 'CREATE INDEX');
  assert.deepEqual(checkSql(weaker, { ranges: [[5, 5]], removed: '' }).map((p) => p.line), [1]);
});

test('re-review 1: earlier migrations tell a later one what a dropped name was', () => {
  const files = {
    '001_tables.sql': `CREATE TABLE IF NOT EXISTS pois (
        id SERIAL, slug TEXT, CONSTRAINT pois_one_slug UNIQUE (slug));
      CREATE UNIQUE INDEX idx_pois_name ON pois (name);`,
    '002_more.sql': 'ALTER TABLE pois ADD CONSTRAINT chk_slug CHECK (slug <> \'\');',
    '003_later.sql': '',
  };
  const all = Object.keys(files).reverse();
  const seen = histories(all, ['001_tables.sql', '003_later.sql'], (f) => files[f]);
  assert.deepEqual([...seen.keys()].sort(), ['001_tables.sql', '003_later.sql']);
  assert.deepEqual([...seen.get('001_tables.sql').constraints], []);
  const known = seen.get('003_later.sql');
  assert.deepEqual(known.constraints.get('pois_one_slug'), { table: 'pois', kind: 'UNIQUE' });
  assert.deepEqual(known.constraints.get('chk_slug'), { table: 'pois', kind: 'CHECK' });
  assert.deepEqual(known.indexes.get('idx_pois_name'), { table: 'pois', unique: true });
  // The UNIQUE named in CREATE TABLE cannot come back as a CHECK.
  const swap = 'ALTER TABLE pois DROP CONSTRAINT pois_one_slug; ALTER TABLE pois ADD CONSTRAINT pois_one_slug CHECK (true);';
  assert.equal(checkSql(swap, null, known).length, 2);
  assert.deepEqual(checkSql('ALTER TABLE pois DROP CONSTRAINT chk_slug; ALTER TABLE pois ADD CONSTRAINT chk_slug CHECK (slug IS NOT NULL);', null, known), []);
  assert.deepEqual(checkSql('DROP INDEX idx_pois_name; CREATE INDEX idx_pois_name ON pois (name);', null, known).length, 1);
});

test('re-review 4: removing a constraint re-create judges its drop, and only its drop', () => {
  const after = [
    'ALTER TABLE t DROP CONSTRAINT t_n_check;',
    'ALTER TABLE u DROP CONSTRAINT u_n_check;',
    'ALTER TABLE u ADD CONSTRAINT u_n_check CHECK (n >= 0);',
    'SELECT 1;',
  ].join('\n');
  const changes = { ranges: [[4, 5]], removed: 'ALTER TABLE t ADD CONSTRAINT t_n_check CHECK (n >= 0);\n' };
  assert.deepEqual(checkSql(after, changes).map((p) => p.line), [1]);
  // Weakening a constraint re-create into another kind brings the drop in too.
  const weaker = after.replace('ADD CONSTRAINT u_n_check CHECK (n >= 0)', 'ADD CONSTRAINT u_n_check UNIQUE (n)');
  assert.deepEqual(checkSql(weaker, { ranges: [[3, 3]], removed: '' }).map((p) => p.line), [2, 3]);
});

test('re-review 1: a file named from outside the directory sees what sorts before it', () => {
  const files = {
    'm/001_a.sql': "ALTER TABLE t ADD CONSTRAINT t_a CHECK (a > 0);",
    'm/002_b.sql': 'CREATE UNIQUE INDEX t_b ON t (b);',
    'm/003_c.sql': 'CREATE INDEX t_c ON t (c);',
    'elsewhere/002_b.sql': '',
    'elsewhere/010_z.sql': '',
  };
  const all = ['m/001_a.sql', 'm/002_b.sql', 'm/003_c.sql'];
  const seen = histories(all, ['elsewhere/002_b.sql', 'm/002_b.sql', 'elsewhere/010_z.sql'], (f) => files[f]);
  // Each path keeps its own snapshot; a shared basename sees only what sorts before it, never itself.
  for (const f of ['elsewhere/002_b.sql', 'm/002_b.sql']) {
    assert.deepEqual([...seen.get(f).constraints.keys()], ['t_a']);
    assert.deepEqual([...seen.get(f).indexes.keys()], []);
  }
  assert.deepEqual([...seen.get('elsewhere/010_z.sql').indexes.keys()].sort(), ['t_b', 't_c']);
});
