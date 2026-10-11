/**
 * Migration 102 against a real database: it adds the new personal data to the
 * privacy policy, the data deletion page and the terms once, and leaves a page
 * an admin has reworded alone.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';

const adminPool = new pg.Pool();
const probe = new pg.Pool({ options: '-c search_path=contact_privacy_probe' });
const migration = await readFile(new URL('../migrations/102_contact_details_privacy.sql', import.meta.url), 'utf8');

const PRIVACY = `# Privacy Policy

*Last updated: September 2026*

That's the full list. We don't request access to your contacts, calendar, files, or anything else.

## How We Use It`;
const DELETION = `## What Gets Deleted

- Your favorites, visited places, and saved trips
- Your timezone and other preferences
- Every active login session`;
const TERMS = 'we store your name, your saved favorites, visited places, saved trips, and your site preferences. Please keep';

const page = async (key) =>
  (await probe.query('SELECT value FROM admin_settings WHERE key = $1', [key])).rows[0].value;
const count = (text, part) => text.split(part).length - 1;

const seed = (privacy, deletion, terms) => probe.query(
  'INSERT INTO admin_settings (key, value) VALUES ($1, $2), ($3, $4), ($5, $6)',
  ['about_privacy_md', privacy, 'about_data_deletion_md', deletion, 'about_terms_md', terms]
);

beforeEach(async () => {
  await adminPool.query('DROP SCHEMA IF EXISTS contact_privacy_probe CASCADE');
  await adminPool.query('CREATE SCHEMA contact_privacy_probe');
  await probe.query('CREATE TABLE admin_settings (key text PRIMARY KEY, value text)');
});

afterAll(async () => {
  await probe.end();
  await adminPool.query('DROP SCHEMA IF EXISTS contact_privacy_probe CASCADE');
  await adminPool.end();
});

describe('migration 102 (contact details in the privacy pages)', () => {
  it('says what is stored, why, and that deleting the account removes it', async () => {
    await seed(PRIVACY, DELETION, TERMS);

    await probe.query(migration);

    const privacy = await page('about_privacy_md');
    expect(privacy).toContain('mailing address, and cell number');
    expect(privacy).toContain('writing them onto a form you download');
    expect(privacy).toContain('*Last updated: October 2026*');
    expect(privacy.indexOf('mailing address')).toBeLessThan(privacy.indexOf('## How We Use It'));
    const deletion = await page('about_data_deletion_md');
    expect(deletion).toContain('- The hikes you checked off for seasonal challenges');
    expect(deletion).toContain('- Any details you saved for filling in forms: name, mailing address, and cell number');
    expect(deletion).toContain('- Every active login session');
    expect(await page('about_terms_md')).toContain('contact details you choose to add for filling in forms');
  });

  it('adds each line once however often it runs', async () => {
    await seed(PRIVACY, DELETION, TERMS);

    await probe.query(migration);
    await probe.query(migration);
    await probe.query(migration);

    expect(count(await page('about_privacy_md'), 'mailing address')).toBe(1);
    expect(count(await page('about_data_deletion_md'), 'mailing address')).toBe(1);
    expect(count(await page('about_data_deletion_md'), 'seasonal challenges')).toBe(1);
    expect(count(await page('about_terms_md'), 'mailing address')).toBe(1);
  });

  it('leaves pages an admin has reworded as they are', async () => {
    const reworded = ['# Privacy\n\n*Last updated: September 2026*\n\nWe keep very little.', 'Everything goes.', 'Our terms, rewritten.'];
    await seed(...reworded);

    await probe.query(migration);

    expect([await page('about_privacy_md'), await page('about_data_deletion_md'), await page('about_terms_md')]).toEqual(reworded);
  });

  it('removes the copies of the sentence an earlier migration kept adding', async () => {
    const account = 'When you create an account with email, we store your name, the username you choose (if any), your email address, and either a password (only as a salted scrypt hash, never the password itself) or a passkey (only its public key). ';
    const email = 'We only email you to confirm your address or, if you ask, to reset your password. ';
    const repeated = `## What We Collect\n\n${(account + email).repeat(6)}${email.repeat(33)}When you sign in with Google or Facebook, we receive:\n\n- Your name`;
    await seed(repeated, DELETION, TERMS);

    await probe.query(migration);
    await probe.query(migration);

    expect(await page('about_privacy_md'))
      .toBe(`## What We Collect\n\n${account}${email}When you sign in with Google or Facebook, we receive:\n\n- Your name`);
  });
});
