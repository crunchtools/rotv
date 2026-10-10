/**
 * Migration 099 against a real database: host:runsignup.com joins trusted_content_paths
 * once, existing entries survive, and a re-run (every boot) changes nothing.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';

const adminPool = new pg.Pool();
const probe = new pg.Pool({ options: '-c search_path=trusted_hosts_probe' });
const migration = await readFile(new URL('../migrations/099_trusted_registration_hosts.sql', import.meta.url), 'utf8');

const storedList = async () => {
  const setting = await probe.query(`SELECT value FROM admin_settings WHERE key = 'trusted_content_paths'`);
  return setting.rows.length ? JSON.parse(setting.rows[0].value) : null;
};

afterAll(async () => {
  await probe.end();
  await adminPool.query('DROP SCHEMA IF EXISTS trusted_hosts_probe CASCADE');
  await adminPool.end();
});

describe('migration 099', () => {
  it('appends the registration host once and keeps what was there', async () => {
    await adminPool.query('DROP SCHEMA IF EXISTS trusted_hosts_probe CASCADE');
    await adminPool.query('CREATE SCHEMA trusted_hosts_probe');
    await probe.query(`
      CREATE TABLE admin_settings (key text PRIMARY KEY, value text, updated_at timestamp);
      INSERT INTO admin_settings (key, value) VALUES ('trusted_content_paths', '["/events","iteminfo.html"]');
    `);

    await probe.query(migration);
    expect(await storedList()).toEqual(['/events', 'iteminfo.html', 'host:runsignup.com']);

    await probe.query(migration);
    expect(await storedList()).toEqual(['/events', 'iteminfo.html', 'host:runsignup.com']);
  });

  it('leaves a database without the setting alone', async () => {
    await probe.query(`DELETE FROM admin_settings`);
    await probe.query(migration);
    expect(await storedList()).toBeNull();
  });
});
