#!/usr/bin/env node
// Fail on a migration that would break the release before it (#897).
//
// The deployer rolls a failed deploy back by swapping the image, never the
// database, and rotv-init runs every migration on every boot. So after a
// rollback the OLD backend runs on the NEW schema, and that is only safe if the
// schema still has everything the old code reads and writes. Expand and
// contract: add first, remove in a later release once nothing uses it.
//
// Refused, per statement:
//   DROP TABLE / VIEW / MATERIALIZED VIEW / SCHEMA / FUNCTION / TYPE /
//     SEQUENCE / TRIGGER / DOMAIN / EXTENSION, ALTER TABLE ... DROP [COLUMN],
//   DROP INDEX and DROP CONSTRAINT, unless the same file re-creates the name
//     as the same kind of object, on the same table, at least as unique,
//   ALTER TABLE|VIEW|TYPE|INDEX|FUNCTION|SEQUENCE ... RENAME (not RENAME
//     CONSTRAINT),
//   ALTER [COLUMN] ... TYPE, ALTER [COLUMN] ... SET NOT NULL,
//   ADD [COLUMN] ... NOT NULL with no DEFAULT (the old code's INSERTs omit it),
//   ALTER [COLUMN] ... DROP DEFAULT, ALTER [COLUMN] ... ADD|SET GENERATED ALWAYS,
//   ADD [CONSTRAINT x] UNIQUE / CHECK / FOREIGN KEY / PRIMARY KEY / EXCLUDE and
//     CREATE UNIQUE INDEX (old writes may violate it), unless it is such a
//     replacement, or the index is on a table the file creates.
//
// The deliberate contract step opts out with a comment on the line above the
// statement, or inside it, saying why it is safe:
//   -- contract: v1.71.0 stopped reading pois.legacy_flag
//   ALTER TABLE pois DROP COLUMN IF EXISTS legacy_flag;
// A marker covers that one statement only. A comment after a statement's
// semicolon on the same line belongs to that statement, never the next. Inside
// a DO block or function body every statement is its own and needs its own
// marker. DDL built at run time (EXECUTE of a concatenated string) cannot be
// seen here and is not allowed.
//
// Checked: every migration numbered above BASELINE, plus any migration that
// differs from --base <git ref>. Files up to BASELINE predate the rule; an edit
// to one is judged only on the statements the edit touches, and on any drop
// whose re-create it touches.
//
//   node scripts/check-migrations.mjs [--base <ref>] [file.sql ...]

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE = 112;
export const MIGRATIONS_DIR = 'backend/migrations';

// A name, quoted or not, possibly schema-qualified: `pois`, `"my col"`, `public."x"`.
const IDENT = '((?:"[^"]+"|[^\\s,()"])+)';

const RULES = [
  [/\bDROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|SCHEMA|FUNCTION|TYPE|SEQUENCE|TRIGGER|DOMAIN|EXTENSION)\b/, 'drops $1'],
  [/\bALTER\s+(TABLE|VIEW|MATERIALIZED\s+VIEW)\b.*\bRENAME\b(?!\s+CONSTRAINT\b)/, 'renames a table, view or column'],
  [/\bALTER\s+(TYPE|INDEX|FUNCTION|SEQUENCE)\b.*\bRENAME\b/, 'renames $1 or its values'],
];

/** `index` -> `an index`. */
const article = (noun) => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;

const CONTRACT = /--\s*contract:\s*\S/i;

/**
 * Split SQL into statements. Dollar-quoted bodies are split too, so each
 * statement in a DO block or function is judged, and needs a marker, on its
 * own. Strings inside a body stay code (an EXECUTE of a literal is still
 * seen); strings outside one are blanked.
 *
 * @param {string} sql the text of one migration file
 * @returns {{code: string, comments: string, line: number, end: number}[]}
 *   one entry per statement: `code` is the statement with comments removed and
 *   whitespace collapsed; `comments` is every comment before or in it, plus a
 *   comment trailing its semicolon on the same line, one per line; `line` and
 *   `end` are the 1-based lines its first code and its end are on.
 */
export function statements(sql) {
  const out = [];
  let code = '';
  let comments = '';
  let line = 1;
  let startLine = 1;
  let dollar = null;
  let started = false;
  // Just after a semicolon, on the same line: a comment here trails it.
  let trailing = false;
  let i = 0;
  const flush = () => {
    if (code.trim()) {
      out.push({ code: code.replace(/\s+/g, ' ').trim(), comments, line: startLine, end: line });
      trailing = true;
    }
    code = '';
    comments = '';
    started = false;
  };
  const comment = (text) => {
    if (trailing) out[out.length - 1].comments += text + '\n';
    else comments += text + '\n';
  };
  const dollarTag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
  // A single-quoted body is scanned as a dollar-quoted one: the text to resume
  // afterwards is parked here, so the source is never copied.
  let resume = null;
  while (i < sql.length || resume) {
    if (i >= sql.length) {
      ({ sql, i } = resume);
      resume = null;
      continue;
    }
    const ch = sql[i];
    if (ch === '\n') trailing = false;
    const isComment = sql.startsWith('--', i) || sql.startsWith('/*', i);
    if (!started && !/\s/.test(ch) && !isComment) {
      started = true;
      trailing = false;
      startLine = line;
    }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      comment(sql.slice(i, stop));
      i = stop;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      const text = sql.slice(i, stop);
      comment(text);
      line += (text.match(/\n/g) || []).length;
      code += ' ';
      i = stop;
      continue;
    }
    dollarTag.lastIndex = i;
    const tag = dollarTag.exec(sql);
    if (tag) {
      dollar = dollar === tag[0] ? null : dollar ?? tag[0];
      code += ' ';
      i += tag[0].length;
      continue;
    }
    // A single-quoted body (DO '...', AS '...', AS E'...') is code, like a dollar-quoted one.
    const quotedBody = ch === "'" && !dollar && code.match(/\b(?:DO(?:\s+LANGUAGE\s+\w+)?|AS)(?:\s*|\s+(E))$/i);
    if (quotedBody) {
      const escapes = Boolean(quotedBody[1]);
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      let body = sql.slice(i + 1, j).replaceAll("''", "'");
      if (escapes) {
        body = body.replace(/\\(.)/gs, '$1');
        code = code.slice(0, -1);
      }
      // Fix: pick a delimiter the body cannot contain, so it never closes early (PR #901 review)
      let tagName = '__body';
      while (body.includes(`$${tagName}$`)) tagName += '_';
      resume = { sql, i: j + 1 };
      sql = `$${tagName}$${body}$${tagName}$`;
      i = 0;
      continue;
    }
    if (ch === "'" || ch === '"') {
      // E'...' takes backslash escapes; every other string only doubles quotes.
      const escapes = ch === "'" && /[Ee]/.test(sql[i - 1] ?? '') && !/[\w$]/.test(sql[i - 2] ?? '');
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j += 1;
      }
      const text = sql.slice(i, j + 1);
      line += (text.match(/\n/g) || []).length;
      if (escapes) code = code.slice(0, -1);
      // An identifier is kept (it names what is dropped). A string is not code,
      // except inside a body, where it may be EXECUTEd.
      if (ch === '"') code += text;
      else code += dollar ? ` ${text.slice(1, -1).replaceAll("''", "'")} ` : "''";
      i = j + 1;
      continue;
    }
    if (ch === '\n') line += 1;
    if (ch === ';') {
      flush();
      i += 1;
      continue;
    }
    code += ch;
    i += 1;
  }
  flush();
  return out;
}

/** A name as Postgres resolves it: quoted kept as written, unquoted folded. */
function ident(name) {
  const bare = name.startsWith('"') ? name.slice(1, -1) : name.toLowerCase();
  return bare.replace(/^public\./, '');
}

/** The table and actions of an ALTER TABLE, actions split at top-level commas. */
function alterTable(code) {
  const m = code.match(new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${IDENT}\\s*\\*?\\s+`, 'i'));
  if (!m) return null;
  const actions = [];
  let depth = 0;
  let from = m.index + m[0].length;
  for (let j = from; j <= code.length; j += 1) {
    if (code[j] === '(') depth += 1;
    else if (code[j] === ')') depth -= 1;
    else if (j === code.length || (code[j] === ',' && depth === 0)) {
      actions.push(code.slice(from, j).trim());
      from = j + 1;
    }
  }
  return { table: ident(m[1]), actions };
}

function alterTableActions(code) {
  return alterTable(code)?.actions ?? [];
}

const CONSTRAINT_WORDS = /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)$/i;
const KIND = '(UNIQUE|CHECK|FOREIGN\\s+KEY|PRIMARY\\s+KEY|EXCLUDE)';
const kind = (word) => word.replace(/\s+/g, ' ').toUpperCase();
const CREATE_INDEX = new RegExp(
  `\\bCREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s+ON\\s+(?:ONLY\\s+)?${IDENT}`,
  'i'
);
const DROP_INDEX = /\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(.*)$/i;
const DROP_CONSTRAINT = new RegExp(`^DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i');
const ADD_CONSTRAINT = new RegExp(`^ADD\\s+(?:CONSTRAINT\\s+${IDENT}\\s+)?${KIND}\\b`, 'i');

/**
 * @typedef {{table: string, unique: boolean}} IndexInfo
 * @typedef {{table: string, kind: string}} ConstraintInfo kind is UNIQUE,
 *   CHECK, FOREIGN KEY, PRIMARY KEY or EXCLUDE
 * @typedef {{indexes: Map<string, IndexInfo>, constraints: Map<string, ConstraintInfo>}} Known
 *   what earlier migrations created, by name as ident() normalises it
 * @typedef {[number, number]} Range first and last changed line, 1-based
 * @typedef {{ranges: Range[], removed: string}} Changes the lines a diff
 *   changes in a file, and the text of the lines it removes
 */

/** An empty catalog, for a file judged without its history. */
export function emptyKnown() {
  return { indexes: new Map(), constraints: new Map() };
}

/**
 * What a file creates and drops, by name: the indexes and constraints it
 * makes, the ones it drops, and the tables it creates.
 *
 * @param {{code: string}[]} stmts the file's statements, from statements()
 * @returns {Known & {tables: Set<string>, droppedIndexes: Set<string>,
 *   droppedConstraints: Map<string, string>}} droppedConstraints maps a name
 *   to the table it is dropped from
 */
export function catalog(stmts) {
  const out = { ...emptyKnown(), tables: new Set(), droppedIndexes: new Set(), droppedConstraints: new Map() };
  for (const { code } of stmts) {
    const table = code.match(new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'i'));
    if (table) {
      out.tables.add(ident(table[1]));
      for (const c of code.matchAll(new RegExp(`\\bCONSTRAINT\\s+${IDENT}\\s+${KIND}`, 'gi'))) {
        out.constraints.set(ident(c[1]), { table: ident(table[1]), kind: kind(c[2]) });
      }
    }
    const index = code.match(CREATE_INDEX);
    if (index) out.indexes.set(ident(index[2]), { table: ident(index[3]), unique: Boolean(index[1]) });
    const drop = code.match(DROP_INDEX);
    if (drop) for (const n of indexNames(drop[1])) out.droppedIndexes.add(n);
    const alter = alterTable(code);
    for (const action of alter?.actions ?? []) {
      const added = action.match(ADD_CONSTRAINT);
      if (added?.[1]) out.constraints.set(ident(added[1]), { table: alter.table, kind: kind(added[2]) });
      const dropped = action.match(DROP_CONSTRAINT);
      if (dropped) out.droppedConstraints.set(ident(dropped[1]), alter.table);
    }
  }
  return out;
}

function indexNames(list) {
  return list
    .replace(/\b(CASCADE|RESTRICT)\b/gi, '')
    .split(',')
    .map((n) => ident(n.trim()))
    .filter(Boolean);
}

// Postgres's default names, for an object no earlier migration names.
const SUFFIX_KIND = [
  [/_pkey$/, 'PRIMARY KEY'],
  [/_key$/, 'UNIQUE'],
  [/_fkey$/, 'FOREIGN KEY'],
  [/_check$/, 'CHECK'],
  [/_excl$/, 'EXCLUDE'],
];

/** What a dropped constraint was, or undefined if nothing says. */
function droppedConstraint(name, known) {
  const info = known.constraints.get(name);
  if (info) return info;
  const hit = SUFFIX_KIND.find(([re]) => re.test(name));
  return hit && { table: undefined, kind: hit[1] };
}

/** What a dropped index was, or undefined if nothing says. */
function droppedIndex(name, known) {
  const info = known.indexes.get(name) ?? known.constraints.get(name);
  if (info) return { table: info.table, unique: info.unique ?? ['UNIQUE', 'PRIMARY KEY'].includes(info.kind) };
  if (/_(p?key)$/.test(name)) return { table: undefined, unique: true };
  if (/_idx$/.test(name)) return { table: undefined, unique: false };
  return undefined;
}

/**
 * A drop paired with a create of the same name is a replacement only when
 * both are the same kind of object, on the same table, and the new one is as
 * unique as the old. Whether a re-added CHECK is wider is the reviewer's call.
 */
function replacesConstraint(name, table, file, known) {
  const made = file.constraints.get(name);
  const was = droppedConstraint(name, known);
  return Boolean(
    made && was && file.droppedConstraints.get(name) === table && made.table === table &&
      (was.table === undefined || was.table === table) && was.kind === made.kind
  );
}

function replacesIndex(name, file, known) {
  const made = file.indexes.get(name);
  const was = droppedIndex(name, known);
  return Boolean(
    made && was && file.droppedIndexes.has(name) &&
      (was.table === undefined || was.table === made.table) && made.unique === was.unique
  );
}

/** What is wrong with one ALTER TABLE action, or null. */
function actionViolation(action, table, file, known) {
  let m;
  if ((m = action.match(DROP_CONSTRAINT))) {
    return replacesConstraint(ident(m[1]), table, file, known) ? null : 'drops a constraint';
  }
  if (new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i').test(action)) {
    return 'drops a column';
  }
  if (new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(SET\\s+DATA\\s+)?TYPE\\b`, 'i').test(action)) {
    return "changes a column's type";
  }
  if (new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+SET\\s+NOT\\s+NULL\\b`, 'i').test(action)) {
    return 'tightens a column to NOT NULL';
  }
  if (new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+DROP\\s+DEFAULT\\b`, 'i').test(action)) {
    return 'drops a column DEFAULT';
  }
  if (new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(?:ADD|SET)\\s+GENERATED\\s+ALWAYS\\b`, 'i').test(action)) {
    return 'makes a column GENERATED ALWAYS';
  }
  if ((m = action.match(ADD_CONSTRAINT))) {
    if (m[1] && replacesConstraint(ident(m[1]), table, file, known)) return null;
    const what = kind(m[2]);
    return `adds ${what === 'EXCLUDE' ? 'an' : 'a'} ${what} constraint`;
  }
  m = action.match(new RegExp(`^ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'i'));
  if (m && !CONSTRAINT_WORDS.test(m[1])) {
    const rest = action.slice(m[0].length).replace(/\bDEFAULT\s*\(*\s*NULL\b(?:\s*::\s*[\w.]+)?\s*\)*(?:\s*::\s*[\w.]+)?/gi, ' ');
    if (/\bNOT\s+NULL\b/i.test(rest) && !/\b(DEFAULT|GENERATED)\b/i.test(rest)) {
      return 'adds a NOT NULL column with no DEFAULT';
    }
  }
  return null;
}

/**
 * What is wrong with one statement, or [] if nothing is.
 *
 * @param {string} code one statement's code, from statements()
 * @param {ReturnType<typeof catalog>} [file] what the whole file creates and
 *   drops, from catalog()
 * @param {Known} [known] what earlier migrations created
 * @returns {string[]} one description per violation, e.g. 'drops a column'
 */
export function violations(code, file = catalog([]), known = emptyKnown()) {
  const upper = code.toUpperCase();
  const found = [];
  for (const [re, why] of RULES) {
    const m = upper.match(re);
    if (m) found.push(why.replace('$1', article((m[1] || '').replace(/\s+/g, ' ').toLowerCase())));
  }
  const drop = code.match(DROP_INDEX);
  if (drop && indexNames(drop[1]).some((n) => !replacesIndex(n, file, known))) found.push('drops an index');
  const index = code.match(CREATE_INDEX);
  if (index?.[1] && !file.tables.has(ident(index[3])) && !replacesIndex(ident(index[2]), file, known)) {
    found.push('adds a unique index');
  }
  const alter = alterTable(code);
  for (const action of alter?.actions ?? []) {
    const why = actionViolation(action, alter.table, file, known);
    if (why) found.push(why);
  }
  return found;
}

/** The index and constraint names a piece of SQL creates or drops. */
function objectNames(sql) {
  const names = new Set();
  const index = new RegExp(`\\b(?:CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?|CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?)${IDENT}`, 'gi');
  for (const m of sql.matchAll(index)) names.add(ident(m[1]));
  const drop = new RegExp(`\\bDROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?([^;]*)`, 'gi');
  for (const m of sql.matchAll(drop)) for (const n of indexNames(m[1])) names.add(n);
  return names;
}

/**
 * Every problem in one file's SQL.
 *
 * @param {string} sql the text of one migration file
 * @param {Changes | null} [changes] judge only statements overlapping a
 *   changed range, plus any statement creating or dropping an index or
 *   constraint whose name the change touches (so deleting the re-create that
 *   excused a drop is judged); null judges every statement
 * @param {Known} [known] what earlier migrations created
 * @returns {{line: number, why: string, code: string}[]} one entry per
 *   refused statement: where it starts, what is wrong, and its first 100 chars
 */
export function checkSql(sql, changes = null, known = emptyKnown()) {
  const stmts = statements(sql);
  const file = catalog(stmts);
  let judged = () => true;
  if (changes) {
    const overlaps = (s) => changes.ranges.some(([a, b]) => s.line <= b && a <= s.end);
    const touched = objectNames(changes.removed);
    for (const s of stmts) if (overlaps(s)) for (const n of objectNames(s.code)) touched.add(n);
    judged = (s) => overlaps(s) || [...objectNames(s.code)].some((n) => touched.has(n));
  }
  const problems = [];
  for (const stmt of stmts) {
    if (!judged(stmt)) continue;
    const found = violations(stmt.code, file, known);
    if (found.length && !CONTRACT.test(stmt.comments)) {
      problems.push({ line: stmt.line, why: found.join('; '), code: stmt.code.slice(0, 100) });
    }
  }
  return problems;
}

function number(file) {
  const m = basename(file).match(/^(\d+)_/);
  return m ? Number(m[1]) : null;
}

/**
 * The migrations a diff touches, the lines it changes in each, and the text it
 * removes. A pure deletion marks the lines either side of it.
 *
 * @param {string} diff output of `git diff -U0`
 * @returns {Map<string, Changes | null>} path to its changes in the new
 *   version, or to null for a file the diff adds
 */
export function parseDiff(diff) {
  const changed = new Map();
  let file = null;
  let isNew = false;
  for (const row of diff.split('\n')) {
    if (row.startsWith('--- ')) isNew = row === '--- /dev/null';
    else if (row.startsWith('+++ b/')) {
      file = row.slice(6);
      changed.set(file, isNew ? null : { ranges: [], removed: '' });
    } else if (row.startsWith('@@') && file && changed.get(file)) {
      const m = row.match(/\+(\d+)(?:,(\d+))?/);
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      changed.get(file).ranges.push(count ? [start, start + count - 1] : [start, start + 1]);
    } else if (row.startsWith('-') && file && changed.get(file)) {
      changed.get(file).removed += row.slice(1) + '\n';
    }
  }
  return changed;
}

function changedSince(base) {
  const diff = execFileSync('git', ['diff', '-U0', '--diff-filter=AMR', base, '--', MIGRATIONS_DIR], {
    encoding: 'utf8',
  });
  const changed = parseDiff(diff);
  for (const f of changed.keys()) if (!f.endsWith('.sql')) changed.delete(f);
  return changed;
}

/**
 * The migration files this run judges.
 *
 * @param {string[]} all every migration path under MIGRATIONS_DIR
 * @param {Map<string, Changes | null>} changed paths differing from the base,
 *   from parseDiff()
 * @returns {[string, Changes | null][]} sorted [path, changes] pairs: changes
 *   is null to judge the whole file (numbered above BASELINE, or new), else
 *   the changes to an edited file at or below BASELINE
 */
export function selectFiles(all, changed) {
  const picked = new Map();
  for (const f of all) if ((number(f) ?? 0) > BASELINE) picked.set(f, null);
  for (const [f, changes] of changed) if (!picked.has(f)) picked.set(f, changes);
  return [...picked].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * What earlier migrations created, as each checked file sees it: one ordered
 * pass over the migrations, with a snapshot taken only for a checked file, of
 * every migration sorting strictly before its basename. Later names overwrite
 * earlier ones.
 *
 * @param {string[]} all every migration path
 * @param {string[]} checked the paths being judged, in `all` or not
 * @param {(file: string) => string} [read] returns a file's SQL
 * @returns {Map<string, Known>} each checked path to what came before it
 */
export function histories(all, checked, read = (f) => readFileSync(f, 'utf8')) {
  const byBase = (x, y) => (basename(x) < basename(y) ? -1 : basename(x) > basename(y) ? 1 : 0);
  const order = [...all].sort(byBase);
  const known = emptyKnown();
  const out = new Map();
  let i = 0;
  for (const file of [...checked].sort(byBase)) {
    for (; i < order.length && basename(order[i]) < basename(file); i += 1) {
      const made = catalog(statements(read(order[i])));
      for (const [n, info] of made.indexes) known.indexes.set(n, info);
      for (const [n, info] of made.constraints) known.constraints.set(n, info);
    }
    out.set(file, { indexes: new Map(known.indexes), constraints: new Map(known.constraints) });
  }
  return out;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  let base = null;
  const named = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') base = argv[++i];
    else named.push(argv[i]);
  }
  const all = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(MIGRATIONS_DIR, f))
    .sort();
  let files = named.map((f) => [f, null]);
  if (!files.length) files = selectFiles(all, base ? changedSince(base) : new Map());

  files = files.filter(([f]) => existsSync(f));
  const before = histories(all, files.map(([f]) => f));
  let bad = 0;
  for (const [file, changes] of files) {
    const known = before.get(file);
    for (const p of checkSql(readFileSync(file, 'utf8'), changes, known)) {
      console.log(`${file}:${p.line}: ${p.why}: ${p.code}`);
      bad += 1;
    }
  }
  if (bad) {
    console.log(
      `\n${bad} statement(s) would break the previous release, which a rollback runs on this schema.\n` +
        'Ship the expand step now and the contract step in a later release, once nothing reads it.\n' +
        'For that later step, put `-- contract: <why the previous release no longer uses it>` above the statement.\n' +
        'See "Database migrations" in CONTRIBUTING.md.'
    );
    return 1;
  }
  console.log(`${files.length} migration(s) checked: backward-compatible.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
