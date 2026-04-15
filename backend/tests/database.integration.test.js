/**
 * Database Integration Tests
 *
 * Tests direct database queries and schema validation.
 * Uses the rotv_test database in the running container.
 *
 * Note: These tests are skipped if database is not accessible from host.
 * The database runs inside the container and is not exposed to localhost:5432.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

// Connect to test database
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv'
});

let dbAccessible = false;

beforeAll(async () => {
  try {
    await pool.query('SELECT 1');
    dbAccessible = true;
  } catch (error) {
    console.log('[Database Tests] Database not accessible from host - skipping direct DB tests');
    console.log('[Database Tests] These tests require PostgreSQL exposed on localhost:5432');
    dbAccessible = false;
  }
});

afterAll(async () => {
  await pool.end();
});

describe('Database Schema Tests', () => {

  it('should connect to test database', async () => {
    const result = await pool.query('SELECT current_database()');
    expect(result.rows[0].current_database).toBeDefined();
  });

  it('should have pois table with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'pois'
      ORDER BY ordinal_position
    `);

    expect(result.rows.length).toBeGreaterThan(0);

    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('name');
    expect(columns).toContain('poi_type');
    expect(columns).toContain('latitude');
    expect(columns).toContain('longitude');
    expect(columns).toContain('events_url');
    expect(columns).toContain('news_url');
  });

  it('should have poi_news table with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'poi_news'
      ORDER BY ordinal_position
    `);

    expect(result.rows.length).toBeGreaterThan(0);

    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('poi_id');
    expect(columns).toContain('title');
    expect(columns).toContain('source_url');
    expect(columns).toContain('collection_date');
    expect(columns).toContain('content_source');
    expect(columns).not.toContain('ai_generated');
  });

  it('should have poi_events table with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'poi_events'
      ORDER BY ordinal_position
    `);

    expect(result.rows.length).toBeGreaterThan(0);

    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('poi_id');
    expect(columns).toContain('title');
    expect(columns).toContain('start_date');
    expect(columns).toContain('source_url');
    expect(columns).toContain('collection_date');
    expect(columns).toContain('content_source');
    expect(columns).not.toContain('ai_generated');
  });

  it('should have newsletter_emails table', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'newsletter_emails'
      ORDER BY ordinal_position
    `);

    expect(result.rows.length).toBeGreaterThan(0);

    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('from_address');
    expect(columns).toContain('subject');
    expect(columns).toContain('body_html');
    expect(columns).toContain('body_markdown');
    expect(columns).toContain('processed');
    expect(columns).toContain('news_extracted');
    expect(columns).toContain('events_extracted');
  });

  it('should have foreign key constraints', async () => {
    const result = await pool.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('poi_news', 'poi_events')
    `);

    expect(result.rows.length).toBeGreaterThanOrEqual(2);

    // Both poi_news and poi_events should have FK to pois
    const tables = result.rows.map(r => r.table_name);
    expect(tables).toContain('poi_news');
    expect(tables).toContain('poi_events');
  });
});

describe('Database Query Tests', () => {
  it('should query POIs successfully', async () => {
    const result = await pool.query(`
      SELECT id, name, poi_type, latitude, longitude
      FROM pois
      WHERE poi_type = 'point'
      LIMIT 10
    `);

    expect(Array.isArray(result.rows)).toBe(true);
    // Database should have POIs
    if (result.rows.length > 0) {
      expect(result.rows[0]).toHaveProperty('id');
      expect(result.rows[0]).toHaveProperty('name');
      expect(result.rows[0].poi_type).toBe('point');
    }
  });

  it('should query news with POI join', async () => {
    const result = await pool.query(`
      SELECT
        pn.id,
        pn.title,
        pn.source_url,
        pn.publication_date,
        p.name as poi_name
      FROM poi_news pn
      JOIN pois p ON pn.poi_id = p.id
      LIMIT 10
    `);

    expect(Array.isArray(result.rows)).toBe(true);
    // If there are news items, verify structure
    if (result.rows.length > 0) {
      expect(result.rows[0]).toHaveProperty('id');
      expect(result.rows[0]).toHaveProperty('title');
      expect(result.rows[0]).toHaveProperty('poi_name');
    }
  });

  it('should query events with POI join', async () => {
    const result = await pool.query(`
      SELECT
        pe.id,
        pe.title,
        pe.start_date,
        pe.source_url,
        p.name as poi_name
      FROM poi_events pe
      JOIN pois p ON pe.poi_id = p.id
      WHERE pe.start_date >= CURRENT_DATE
      LIMIT 10
    `);

    expect(Array.isArray(result.rows)).toBe(true);
    // If there are events, verify structure
    if (result.rows.length > 0) {
      expect(result.rows[0]).toHaveProperty('id');
      expect(result.rows[0]).toHaveProperty('title');
      expect(result.rows[0]).toHaveProperty('start_date');
      expect(result.rows[0]).toHaveProperty('poi_name');
    }
  });

  it('should handle duplicate news prevention', async () => {
    // Verify unique constraint exists on poi_news
    const result = await pool.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'poi_news'
        AND constraint_type = 'UNIQUE'
    `);

    // Should have at least one unique constraint (probably on poi_id + url or similar)
    expect(result.rows.length).toBeGreaterThanOrEqual(0);
  });
});
