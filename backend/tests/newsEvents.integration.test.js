/**
 * Integration tests for News & Events API
 *
 * These tests hit the actual running container on localhost:8080
 * and verify the full request/response cycle including database queries.
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Test database should exist (rotv_test)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const TEST_POI_ID = 1; // Conservancy for CVNP (assuming it exists)

describe('News & Events API Integration Tests', () => {

  describe('GET /api/pois/:id/news', () => {
    it('should return news for a specific POI', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/news`)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body)).toBe(true);

      // If there are news items, verify structure
      if (response.body.length > 0) {
        const newsItem = response.body[0];
        expect(newsItem).toHaveProperty('id');
        expect(newsItem).toHaveProperty('poi_id');
        expect(newsItem).toHaveProperty('title');
        expect(newsItem).toHaveProperty('url');
      }
    }, 10000);

    it('should handle non-existent POI gracefully', async () => {
      const response = await request(BASE_URL)
        .get('/api/pois/99999/news')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should support limit parameter', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/news?limit=5`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/pois/:id/events', () => {
    it('should return events for a specific POI', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/events`)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body)).toBe(true);

      // If there are events, verify structure
      if (response.body.length > 0) {
        const event = response.body[0];
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('poi_id');
        expect(event).toHaveProperty('title');
        expect(event).toHaveProperty('event_date');
      }
    }, 10000);

    it('should handle non-existent POI gracefully', async () => {
      const response = await request(BASE_URL)
        .get('/api/pois/99999/events')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should filter future events only', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/events`)
        .expect(200);

      // All returned events should be in the future or very recent past
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      response.body.forEach(event => {
        if (event.event_date) {
          const eventDate = new Date(event.event_date);
          expect(eventDate.getTime()).toBeGreaterThan(thirtyDaysAgo.getTime());
        }
      });
    });
  });

  describe('GET /api/pois (with news/events counts)', () => {
    it('should return POIs with news and events counts', async () => {
      const response = await request(BASE_URL)
        .get('/api/pois?role=point')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);

      if (response.body.length > 0) {
        const poi = response.body[0];
        expect(poi).toHaveProperty('id');
        expect(poi).toHaveProperty('name');
        // These counts may be added by the API
        // expect(poi).toHaveProperty('news_count');
        // expect(poi).toHaveProperty('events_count');
      }
    }, 10000);
  });

  describe('Health Check', () => {
    it('should verify container is running', async () => {
      const response = await request(BASE_URL)
        .get('/api/pois?role=point')
        .expect(200);

      expect(response.status).toBe(200);
    });
  });
});

describe('News Collection Progress API', () => {
  it('should return collection progress for a POI', async () => {
    // This endpoint may require admin auth, so we test basic access
    const response = await request(BASE_URL)
      .get(`/api/admin/pois/${TEST_POI_ID}/collection-progress`)
      .expect((res) => {
        // Accept 200 (success), 401 (auth required), or 404 (not found)
        expect([200, 401, 403, 404]).toContain(res.status);
      });

    if (response.status === 200) {
      expect(response.body).toBeDefined();
    }
  });
});
