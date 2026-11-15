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
//     SEQUENCE / TRIGGER, ALTER TABLE ... DROP [COLUMN],
//   DROP INDEX and DROP CONSTRAINT, unless the same file re-creates the name,
//   ALTER TABLE|VIEW|TYPE|INDEX|FUNCTION|SEQUENCE ... RENAME (not RENAME
//     CONSTRAINT),
//   ALTER [COLUMN] ... TYPE, ALTER [COLUMN] ... SET NOT NULL,
//   ADD [COLUMN] ... NOT NULL with no DEFAULT (the old code's INSERTs omit it),
//   ADD [CONSTRAINT x] UNIQUE / CHECK / FOREIGN KEY (old writes may violate it),
//     unless it replaces a constraint of the same name dropped in the file.
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
// to one is judged only on the statements the edit touches.
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
  [/\bDROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|SCHEMA|FUNCTION|TYPE|SEQUENCE|TRIGGER)\b/, 'drops $1'],
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
 *   `end` are the 1-based lines its first comment or code and its end are on.
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
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '\n') trailing = false;
    const isComment = sql.startsWith('--', i) || sql.startsWith('/*', i);
    if (!started && !/\s/.test(ch) && !(trailing && isComment)) {
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
  return name.startsWith('"') ? name.slice(1, -1) : name.toLowerCase();
}

/** The actions of an ALTER TABLE, split at top-level commas, or []. */
function alterTableActions(code) {
  const m = code.match(new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${IDENT}\\s*\\*?\\s+`, 'i'));
  if (!m) return [];
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
  return actions;
}

const CONSTRAINT_WORDS = /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)$/i;

/**
 * @typedef {{indexes: Set<string>, constraints: Set<string>}} Made
 *   names a file creates, as ident() normalises them
 * @typedef {[number, number]} Range first and last changed line, 1-based
 */

/**
 * Names this file creates: indexes, and constraints it adds. A drop of one of
 * these names is a replacement, not a removal.
 *
 * @param {{code: string}[]} stmts the file's statements, from statements()
 * @returns {Made} the index and constraint names it creates
 */
export function recreated(stmts) {
  const indexes = new Set();
  const constraints = new Set();
  for (const { code } of stmts) {
    const index = code.match(
      new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'i')
    );
    if (index && !/^ON$/i.test(index[1])) indexes.add(ident(index[1]));
    for (const action of alterTableActions(code)) {
      const added = action.match(new RegExp(`^ADD\\s+CONSTRAINT\\s+${IDENT}`, 'i'));
      if (added) constraints.add(ident(added[1]));
    }
  }
  return { indexes, constraints };
}

/** What is wrong with one ALTER TABLE action, or null. */
function actionViolation(action, made, dropped) {
  let m;
  if ((m = action.match(new RegExp(`^DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i')))) {
    return made.constraints.has(ident(m[1])) ? null : 'drops a constraint';
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
  if ((m = action.match(new RegExp(`^ADD\\s+(?:CONSTRAINT\\s+${IDENT}\\s+)?(UNIQUE|CHECK|FOREIGN\\s+KEY)\\b`, 'i')))) {
    if (m[1] && dropped.has(ident(m[1]))) return null;
    return `adds a ${m[2].replace(/\s+/g, ' ').toUpperCase()} constraint`;
  }
  m = action.match(new RegExp(`^ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'i'));
  if (m && !CONSTRAINT_WORDS.test(m[1])) {
    const rest = action.slice(m[0].length).replace(/\bDEFAULT\s+NULL\b(\s*::\s*[\w.]+)?/gi, ' ');
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
 * @param {Made} [made] what the file re-creates, from recreated()
 * @param {Set<string>} [dropped] the constraint names the file drops
 * @returns {string[]} one description per violation, e.g. 'drops a column'
 */
export function violations(code, made = { indexes: new Set(), constraints: new Set() }, dropped = new Set()) {
  const upper = code.toUpperCase();
  const found = [];
  for (const [re, why] of RULES) {
    const m = upper.match(re);
    if (m) found.push(why.replace('$1', article((m[1] || '').replace(/\s+/g, ' ').toLowerCase())));
  }
  const drop = code.match(/\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(.*)$/i);
  if (drop) {
    const names = drop[1].replace(/\b(CASCADE|RESTRICT)\b/gi, '').split(',');
    if (names.some((n) => !made.indexes.has(ident(n.trim())))) found.push('drops an index');
  }
  for (const action of alterTableActions(code)) {
    const why = actionViolation(action, made, dropped);
    if (why) found.push(why);
  }
  return found;
}

/**
 * Every problem in one file's SQL.
 *
 * @param {string} sql the text of one migration file
 * @param {Range[] | null} [ranges] judge only statements overlapping one of
 *   these changed-line ranges; null judges every statement
 * @returns {{line: number, why: string, code: string}[]} one entry per
 *   refused statement: where it starts, what is wrong, and its first 100 chars
 */
export function checkSql(sql, ranges = null) {
  const stmts = statements(sql);
  const made = recreated(stmts);
  const dropped = new Set();
  for (const { code } of stmts) {
    for (const action of alterTableActions(code)) {
      const m = action.match(new RegExp(`^DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i'));
      if (m) dropped.add(ident(m[1]));
    }
  }
  const problems = [];
  for (const stmt of stmts) {
    if (ranges && !ranges.some(([a, b]) => stmt.line <= b && a <= stmt.end)) continue;
    const found = violations(stmt.code, made, dropped);
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
 * The migrations a diff touches, and the lines it changes in each. A pure
 * deletion marks the lines either side of it.
 *
 * @param {string} diff output of `git diff -U0`
 * @returns {Map<string, Range[] | null>} path to its changed-line ranges in
 *   the new version, or to null for a file the diff adds
 */
export function parseDiff(diff) {
  const changed = new Map();
  let file = null;
  let isNew = false;
  for (const row of diff.split('\n')) {
    if (row.startsWith('--- ')) isNew = row === '--- /dev/null';
    else if (row.startsWith('+++ b/')) {
      file = row.slice(6);
      changed.set(file, isNew ? null : []);
    } else if (row.startsWith('@@') && file && changed.get(file)) {
      const m = row.match(/\+(\d+)(?:,(\d+))?/);
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      changed.get(file).push(count ? [start, start + count - 1] : [start, start + 1]);
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
 * @param {Map<string, Range[] | null>} changed paths differing from the base,
 *   from parseDiff()
 * @returns {[string, Range[] | null][]} sorted [path, ranges] pairs: ranges is
 *   null to judge the whole file (numbered above BASELINE, or new), else the
 *   changed lines of an edited file at or below BASELINE
 */
export function selectFiles(all, changed) {
  const picked = new Map();
  for (const f of all) if ((number(f) ?? 0) > BASELINE) picked.set(f, null);
  for (const [f, ranges] of changed) if (!picked.has(f)) picked.set(f, ranges);
  return [...picked].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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
  let files = named.map((f) => [f, null]);
  if (!files.length) {
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => join(MIGRATIONS_DIR, f));
    files = selectFiles(all, base ? changedSince(base) : new Map());
  }

  let bad = 0;
  for (const [file, ranges] of files) {
    if (!existsSync(file)) continue;
    for (const p of checkSql(readFileSync(file, 'utf8'), ranges)) {
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
