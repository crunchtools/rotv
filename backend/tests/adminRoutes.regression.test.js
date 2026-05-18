import { describe, it, expect } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

/**
 * Regression tests for PR #369 bug fixes.
 *
 * These verify the endpoints are still registered and gated by admin auth.
 * The actual fix logic (404 on missing icon, validation on bulk insert) was
 * verified manually in dev mode (BYPASS_AUTH=true) via fetch from the browser
 * — see PR #369 description. The test container deliberately enforces auth,
 * so the fix path is not exercised here.
 */
describe('Admin Routes — endpoint registration', () => {
  describe('DELETE /api/admin/icons/:id', () => {
    it('requires admin auth', async () => {
      const response = await request(BASE_URL)
        .delete('/api/admin/icons/999999999')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/poi-associations/batch', () => {
    it('requires admin auth', async () => {
      const response = await request(BASE_URL)
        .post('/api/admin/poi-associations/batch')
        .send({ virtual_poi_id: 1, physical_poi_ids: [1, 2] })
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });
});
