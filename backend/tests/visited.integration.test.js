import { describe, it, expect } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

/**
 * Integration tests for the Visited list (spec 031-visited-list, issue #429).
 *
 * Visited is user-scoped (auth required), mirroring favorites. The test
 * container enforces auth, so these verify endpoint registration and the auth
 * gate; the authenticated mark/unmark and the localStorage→account sync were
 * verified manually in dev mode (BYPASS_AUTH=true), per the poiSubscriptions
 * convention.
 */
describe('Visited list — endpoint registration', () => {
  it('GET /api/visited requires auth', async () => {
    const res = await request(BASE_URL).get('/api/visited').expect(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/visited/stats requires auth', async () => {
    const res = await request(BASE_URL).get('/api/visited/stats').expect(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/visited/:poiId requires auth', async () => {
    const res = await request(BASE_URL).post('/api/visited/1').expect(401);
    expect(res.body).toHaveProperty('error');
  });

  it('DELETE /api/visited/:poiId requires auth', async () => {
    const res = await request(BASE_URL).delete('/api/visited/1').expect(401);
    expect(res.body).toHaveProperty('error');
  });
});
