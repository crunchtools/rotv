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
//   DROP TABLE / VIEW / MATERIALIZED VIEW / SCHEMA, DROP COLUMN,
//   ALTER TABLE|VIEW ... RENAME (not RENAME CONSTRAINT),
//   ALTER COLUMN ... TYPE, ALTER COLUMN ... SET NOT NULL,
//   ADD COLUMN ... NOT NULL with no DEFAULT (the old code's INSERTs omit it).
//
// The deliberate contract step opts out with a comment inside the statement,
// usually the line above it, saying why it is safe:
//   -- contract: v1.71.0 stopped reading pois.legacy_flag
//   ALTER TABLE pois DROP COLUMN IF EXISTS legacy_flag;
//
// Checked: every migration numbered above BASELINE, plus any migration that
// differs from --base <git ref>. Files up to BASELINE predate the rule and are
// not judged retroactively, but editing one is judged like a new file.
//
//   node scripts/check-migrations.mjs [--base <ref>] [file.sql ...]

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE = 112;
export const MIGRATIONS_DIR = 'backend/migrations';

const RULES = [
  [/\bDROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|SCHEMA)\b/, 'drops a $1'],
  [/\bDROP\s+COLUMN\b/, 'drops a column'],
  [/\bALTER\s+(TABLE|VIEW|MATERIALIZED\s+VIEW)\b.*\bRENAME\b(?!\s+CONSTRAINT\b)/, 'renames a table, view or column'],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/, "changes a column's type"],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/, 'tightens a column to NOT NULL'],
];

const CONTRACT = /--\s*contract:\s*\S/i;

/**
 * Split SQL into top-level statements. The body of a dollar-quoted block is
 * scanned as code, so DDL inside a DO block or EXECUTE string is still seen,
 * and an apostrophe inside it cannot derail the scan.
 *
 * @param {string} sql the text of one migration file
 * @returns {{code: string, comments: string, line: number}[]} one entry per
 *   statement: `code` is the statement with comments removed, string literals
 *   blanked to `''` and whitespace collapsed; `comments` is every comment in
 *   it, one per line, where a `-- contract:` marker is looked for; `line` is
 *   the 1-based line its first comment or code is on.
 */
export function statements(sql) {
  const out = [];
  let code = '';
  let comments = '';
  let line = 1;
  let startLine = 1;
  let dollar = null;
  let started = false;
  let i = 0;
  const flush = () => {
    if (code.trim()) out.push({ code: code.replace(/\s+/g, ' ').trim(), comments, line: startLine });
    code = '';
    comments = '';
    started = false;
  };
  const dollarTag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
  while (i < sql.length) {
    const ch = sql[i];
    if (!started && !/\s/.test(ch)) {
      started = true;
      startLine = line;
    }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      comments += sql.slice(i, stop) + '\n';
      i = stop;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      const text = sql.slice(i, stop);
      comments += text + '\n';
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
    if (!dollar && (ch === "'" || ch === '"')) {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j += 1;
      }
      const text = sql.slice(i, j + 1);
      line += (text.match(/\n/g) || []).length;
      // An identifier is kept (it names what is dropped); a string is not code.
      code += ch === '"' ? text : "''";
      i = j + 1;
      continue;
    }
    if (ch === '\n') line += 1;
    if (ch === ';' && !dollar) {
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

/**
 * The text of each ADD COLUMN clause, up to the next top-level comma, or the
 * semicolon ending it inside a DO block.
 */
function addColumnClauses(code) {
  const clauses = [];
  const re = /\bADD\s+COLUMN\b/gi;
  let m;
  while ((m = re.exec(code))) {
    let depth = 0;
    let j = m.index;
    for (; j < code.length; j += 1) {
      if (code[j] === '(') depth += 1;
      else if (code[j] === ')') depth -= 1;
      else if ((code[j] === ',' && depth === 0) || code[j] === ';') break;
    }
    clauses.push(code.slice(m.index, j));
  }
  return clauses;
}

/** What is wrong with one statement, or [] if nothing is. */
export function violations(code) {
  const upper = code.toUpperCase();
  const found = [];
  for (const [re, why] of RULES) {
    const m = upper.match(re);
    if (m) found.push(why.replace('$1', (m[1] || '').replace(/\s+/g, ' ').toLowerCase()));
  }
  for (const clause of addColumnClauses(upper)) {
    if (/\bNOT\s+NULL\b/.test(clause) && !/\b(DEFAULT|GENERATED)\b/.test(clause)) {
      found.push('adds a NOT NULL column with no DEFAULT');
    }
  }
  return found;
}

/** Every problem in one file's SQL, as { line, why, code }. */
export function checkSql(sql) {
  const problems = [];
  for (const stmt of statements(sql)) {
    const found = violations(stmt.code);
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

function changedSince(base) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', base, '--', MIGRATIONS_DIR], {
    encoding: 'utf8',
  });
  return out.split('\n').filter((f) => f.endsWith('.sql'));
}

/** The migration files this run judges. */
export function selectFiles(all, changed) {
  const picked = all.filter((f) => (number(f) ?? 0) > BASELINE);
  for (const f of changed) if (!picked.includes(f)) picked.push(f);
  return picked.sort();
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
  let files = named;
  if (!files.length) {
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => join(MIGRATIONS_DIR, f));
    files = selectFiles(all, base ? changedSince(base) : []);
  }

  let bad = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const p of checkSql(readFileSync(file, 'utf8'))) {
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
