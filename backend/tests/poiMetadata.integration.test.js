import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';

const { Pool } = pg;

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8080';

describe('POI Metadata Fields Integration Tests', () => {
  let pool;
  let testPoiId;
  let authCookie;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'rotv',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'rotv'
    });

    await pool.query('DELETE FROM pois WHERE name = $1', ['Test POI for Metadata']);

    const testUser = await pool.query(
      'INSERT INTO users (email, name, role, oauth_provider, oauth_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO UPDATE SET role = $3 RETURNING *',
      ['test-admin@example.com', 'Test Admin', 'admin', 'dev', 'dev-test-admin']
    );

    const agent = request.agent(API_BASE);
    const loginResponse = await agent.post('/api/auth/dev-login').send({
      email: 'test-admin@example.com'
    });

    authCookie = loginResponse.headers['set-cookie'];
  });

  afterAll(async () => {
    if (testPoiId) {
      await pool.query('DELETE FROM pois WHERE id = $1', [testPoiId]);
    }
    await pool.end();
  });

  describe('GET /api/pois', () => {
    it('should return cost, hours, and mobility fields in POI list', async () => {
      const response = await request(API_BASE)
        .get('/api/pois')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      const poi = response.body[0];
      expect(poi).toHaveProperty('cost');
      expect(poi).toHaveProperty('hours');
      expect(poi).toHaveProperty('mobility');
    });
  });

  describe('GET /api/pois/:id', () => {
    it('should return cost, hours, and mobility fields in POI detail', async () => {
      const response = await request(API_BASE)
        .get('/api/pois/1')
        .expect(200);

      expect(response.body).toHaveProperty('cost');
      expect(response.body).toHaveProperty('hours');
      expect(response.body).toHaveProperty('mobility');
    });
  });

  describe('POST /api/admin/pois', () => {
    it('should create POI with cost, hours, and mobility fields', async () => {
      const response = await request(API_BASE)
        .post('/api/admin/pois')
        .set('Cookie', authCookie)
        .send({
          name: 'Test POI for Metadata',
          poi_type: 'point',
          latitude: 41.2611,
          longitude: -81.5592,
          cost: 'free',
          hours: 'Dawn to dusk',
          mobility: 'accessible'
        })
        .expect(201);

      testPoiId = response.body.id;
      expect(response.body.cost).toBe('free');
      expect(response.body.hours).toBe('Dawn to dusk');
      expect(response.body.mobility).toBe('accessible');
    });

    it('should reject invalid cost value', async () => {
      await request(API_BASE)
        .post('/api/admin/pois')
        .set('Cookie', authCookie)
        .send({
          name: 'Invalid Cost POI',
          poi_type: 'point',
          latitude: 41.2611,
          longitude: -81.5592,
          cost: 'invalid-value'
        })
        .expect(500);
    });

    it('should reject invalid mobility value', async () => {
      await request(API_BASE)
        .post('/api/admin/pois')
        .set('Cookie', authCookie)
        .send({
          name: 'Invalid Mobility POI',
          poi_type: 'point',
          latitude: 41.2611,
          longitude: -81.5592,
          mobility: 'invalid-value'
        })
        .expect(500);
    });

    it('should accept NULL values for optional fields', async () => {
      const response = await request(API_BASE)
        .post('/api/admin/pois')
        .set('Cookie', authCookie)
        .send({
          name: 'NULL Metadata POI',
          poi_type: 'point',
          latitude: 41.2611,
          longitude: -81.5592
        })
        .expect(201);

      expect(response.body.cost).toBeNull();
      expect(response.body.hours).toBeNull();
      expect(response.body.mobility).toBeNull();

      await pool.query('DELETE FROM pois WHERE id = $1', [response.body.id]);
    });

    it('should accept all valid cost values', async () => {
      const costs = ['free', 'low', 'medium', 'high'];

      for (const cost of costs) {
        const response = await request(API_BASE)
          .post('/api/admin/pois')
          .set('Cookie', authCookie)
          .send({
            name: `Test POI Cost ${cost}`,
            poi_type: 'point',
            latitude: 41.2611,
            longitude: -81.5592,
            cost
          })
          .expect(201);

        expect(response.body.cost).toBe(cost);
        await pool.query('DELETE FROM pois WHERE id = $1', [response.body.id]);
      }
    });

    it('should accept all valid mobility values', async () => {
      const mobilities = ['full', 'limited', 'accessible'];

      for (const mobility of mobilities) {
        const response = await request(API_BASE)
          .post('/api/admin/pois')
          .set('Cookie', authCookie)
          .send({
            name: `Test POI Mobility ${mobility}`,
            poi_type: 'point',
            latitude: 41.2611,
            longitude: -81.5592,
            mobility
          })
          .expect(201);

        expect(response.body.mobility).toBe(mobility);
        await pool.query('DELETE FROM pois WHERE id = $1', [response.body.id]);
      }
    });
  });

  describe('PUT /api/admin/pois/:id', () => {
    it('should update cost, hours, and mobility fields', async () => {
      const createResponse = await request(API_BASE)
        .post('/api/admin/pois')
        .set('Cookie', authCookie)
        .send({
          name: 'POI to Update',
          poi_type: 'point',
          latitude: 41.2611,
          longitude: -81.5592,
          cost: 'free',
          hours: '9am-5pm',
          mobility: 'accessible'
        })
        .expect(201);

      const poiId = createResponse.body.id;

      const updateResponse = await request(API_BASE)
        .put(`/api/admin/pois/${poiId}`)
        .set('Cookie', authCookie)
        .send({
          cost: 'medium',
          hours: '24/7',
          mobility: 'limited'
        })
        .expect(200);

      expect(updateResponse.body.cost).toBe('medium');
      expect(updateResponse.body.hours).toBe('24/7');
      expect(updateResponse.body.mobility).toBe('limited');

      await pool.query('DELETE FROM pois WHERE id = $1', [poiId]);
    });

    it('should allow clearing fields by setting to null', async () => {
      const createResponse = await request(API_BASE)
        .post('/api/admin/pois')
        .set('Cookie', authCookie)
        .send({
          name: 'POI to Clear',
          poi_type: 'point',
          latitude: 41.2611,
          longitude: -81.5592,
          cost: 'high',
          hours: 'Seasonal',
          mobility: 'full'
        })
        .expect(201);

      const poiId = createResponse.body.id;

      const updateResponse = await request(API_BASE)
        .put(`/api/admin/pois/${poiId}`)
        .set('Cookie', authCookie)
        .send({
          cost: null,
          hours: null,
          mobility: null
        })
        .expect(200);

      expect(updateResponse.body.cost).toBeNull();
      expect(updateResponse.body.hours).toBeNull();
      expect(updateResponse.body.mobility).toBeNull();

      await pool.query('DELETE FROM pois WHERE id = $1', [poiId]);
    });
  });
});
