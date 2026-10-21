/**
 * webcam_url (#791): the admin destination update allowlist and the POI
 * list queries must carry it, and the migration must seed the Cuyahoga cams.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf-8');

describe('webcam_url', () => {
  it('is in the PUT /destinations/:id allowlist', () => {
    const source = read('routes', 'admin.js');
    const start = source.indexOf("router.put('/destinations/:id'");
    const list = source.slice(start, source.indexOf('];', start));
    expect(list).toContain("'webcam_url'");
  });

  it('is selected by both POI list queries', () => {
    const source = read('server.js');
    const selects = source.match(/[^\n]*p\.live_tracker_url[^\n]*/g);
    expect(selects.length).toBe(2);
    for (const line of selects) {
      expect(line).toContain('p.webcam_url');
    }
  });

  it('is added and seeded idempotently by the migration', () => {
    const sql = read('migrations', '110_add_webcam_url.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS webcam_url');
    expect(sql).toContain("name IN ('Cuyahoga River', 'The Foundry')");
    expect(sql).toContain('webcam_url IS NULL');
  });
});
