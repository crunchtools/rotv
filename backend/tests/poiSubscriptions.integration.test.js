import { describe, it, expect } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

/**
 * Integration tests for POI subscriptions and the notification feed (spec
 * 019-poi-subscriptions, issue #213).
 *
 * Favorites are user-scoped (auth required). The notification feed is public:
 * logged-in callers get their server-side favorites, anonymous callers pass
 * ?pois=. The authenticated favorite flow was verified manually in dev mode
 * (BYPASS_AUTH=true); the test container enforces auth, mirroring the
 * adminRoutes regression convention.
 */
describe('POI subscriptions — endpoint registration', () => {
  describe('Favorites (auth required)', () => {
    it('GET /api/favorites requires auth', async () => {
      const res = await request(BASE_URL).get('/api/favorites').expect(401);
      expect(res.body).toHaveProperty('error');
    });

    it('POST /api/favorites/:poiId requires auth', async () => {
      const res = await request(BASE_URL).post('/api/favorites/1').expect(401);
      expect(res.body).toHaveProperty('error');
    });

    it('DELETE /api/favorites/:poiId requires auth', async () => {
      const res = await request(BASE_URL).delete('/api/favorites/1').expect(401);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Notification feed (public)', () => {
    it('returns empty arrays when an anonymous caller passes no POIs', async () => {
      const res = await request(BASE_URL).get('/api/notifications/feed').expect(200);
      expect(res.body).toEqual({ news: [], events: [] });
    });

    it('accepts an anonymous ?pois= list and returns feed arrays', async () => {
      const res = await request(BASE_URL).get('/api/notifications/feed?pois=1,2,3').expect(200);
      expect(res.body).toHaveProperty('news');
      expect(res.body).toHaveProperty('events');
      expect(Array.isArray(res.body.news)).toBe(true);
      expect(Array.isArray(res.body.events)).toBe(true);
    });
  });
});
