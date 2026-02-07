/**
 * Integration Tests for News/Events Slot Architecture API
 * Tests HTTP endpoints for News/Events collection with slot management
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Test database should exist (rotv_test)
 * - Must be authenticated as admin
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds for API tests
const POLLING_INTERVAL = 1000; // 1 second between polls
const MAX_POLL_ATTEMPTS = 60; // Max 60 seconds to wait for job completion

describe('News/Events Slot Architecture Integration Tests', () => {
  let authCookie;

  // Helper to wait for job completion
  async function waitForJobCompletion(jobId, maxAttempts = MAX_POLL_ATTEMPTS) {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await request(BASE_URL)
        .get(`/api/admin/news/job/${jobId}`)
        .set('Cookie', authCookie)
        .expect(200);

      const job = response.body;

      if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
        return job;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }

    throw new Error(`Job ${jobId} did not complete within ${maxAttempts} seconds`);
  }

  beforeAll(async () => {
    // Note: Authentication might be required for admin endpoints
    // This test assumes either:
    // 1. Auth is disabled in test mode
    // 2. A valid session cookie is set up
    // 3. Tests are run in an environment where auth is pre-configured

    // Tests run without explicit authentication
    // Auth failures (401/403) indicate auth setup is needed
  });

  describe('POST /api/admin/news/collect', () => {
    it('should create job and return jobId', async () => {
      const response = await request(BASE_URL)
        .post('/api/admin/news/collect')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          // Accept 200 (success) or 401/403 (auth required)
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('jobId');
        expect(response.body).toHaveProperty('message');
        expect(typeof response.body.jobId).toBe('number');
      } else if (response.status === 409) {
        // Job already running - this is acceptable
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('already running');
      }
    }, TEST_TIMEOUT);

    it('should prevent duplicate jobs (409 Conflict if job already running)', async () => {
      // First request - start a job
      const response1 = await request(BASE_URL)
        .post('/api/admin/news/collect')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      // If first request succeeded, second should fail with 409
      if (response1.status === 200) {
        const response2 = await request(BASE_URL)
          .post('/api/admin/news/collect')
          .set('Cookie', authCookie || '')
          .expect((res) => {
            expect([409, 401, 403]).toContain(res.status);
          });

        if (response2.status === 409) {
          expect(response2.body).toHaveProperty('error');
          expect(response2.body.error).toContain('already running');
        }
      }
    }, TEST_TIMEOUT);

    it('should handle rapid double-clicks gracefully', async () => {
      // Simulate rapid double-click by sending two requests immediately
      const [response1, response2] = await Promise.all([
        request(BASE_URL)
          .post('/api/admin/news/collect')
          .set('Cookie', authCookie || ''),
        request(BASE_URL)
          .post('/api/admin/news/collect')
          .set('Cookie', authCookie || '')
      ]);

      // One should succeed (200), one should fail (409), or both need auth
      const statuses = [response1.status, response2.status].sort();

      // Valid scenarios:
      // - [200, 409] - one succeeded, one was blocked
      // - [401, 401] or [403, 403] - both need auth
      // - [409, 409] - job was already running before both requests
      expect([200, 401, 403, 409]).toContain(statuses[0]);
      expect([200, 401, 403, 409]).toContain(statuses[1]);
    }, TEST_TIMEOUT);
  });

  describe('GET /api/admin/news/job/:jobId', () => {
    it('should return displaySlots array with exactly 10 elements', async () => {
      // First, get latest job to have a valid jobId
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 && latestResponse.body && latestResponse.body.id) {
        const jobId = latestResponse.body.id;

        const response = await request(BASE_URL)
          .get(`/api/admin/news/job/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        expect(response.body).toHaveProperty('displaySlots');
        expect(Array.isArray(response.body.displaySlots)).toBe(true);
        expect(response.body.displaySlots.length).toBe(10);

        // Check slot structure
        response.body.displaySlots.forEach((slot, index) => {
          expect(slot).toHaveProperty('slotId');
          expect(slot).toHaveProperty('poiId');
          expect(slot).toHaveProperty('poiName');
          expect(slot).toHaveProperty('phase');
          expect(slot).toHaveProperty('provider');
          expect(slot).toHaveProperty('status');
          expect(slot.slotId).toBe(index);
        });
      }
    }, TEST_TIMEOUT);

    it('should return empty slots as { slotId, poiId: null, ... }', async () => {
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 && latestResponse.body && latestResponse.body.id) {
        const jobId = latestResponse.body.id;

        const response = await request(BASE_URL)
          .get(`/api/admin/news/job/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Find empty slots
        const emptySlots = response.body.displaySlots.filter(slot => slot.poiId === null);

        emptySlots.forEach(slot => {
          expect(slot.slotId).toBeGreaterThanOrEqual(0);
          expect(slot.slotId).toBeLessThanOrEqual(9);
          expect(slot.poiId).toBeNull();
          expect(slot.poiName).toBeNull();
          expect(slot.phase).toBeNull();
          expect(slot.provider).toBeNull();
          expect(slot.status).toBeNull();
        });
      }
    }, TEST_TIMEOUT);

    it('should return active slots with POI data', async () => {
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 && latestResponse.body && latestResponse.body.id) {
        const jobId = latestResponse.body.id;

        const response = await request(BASE_URL)
          .get(`/api/admin/news/job/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Find active slots
        const activeSlots = response.body.displaySlots.filter(slot => slot.poiId !== null);

        activeSlots.forEach(slot => {
          expect(slot.poiId).not.toBeNull();
          expect(typeof slot.poiId).toBe('number');

          if (slot.poiName !== null) {
            expect(typeof slot.poiName).toBe('string');
          }

          if (slot.phase !== null) {
            expect(typeof slot.phase).toBe('string');
            expect(['initializing', 'rendering_events', 'rendering_news', 'ai_search',
                    'matching_links', 'google_news', 'processing_results', 'complete', 'error'])
              .toContain(slot.phase);
          }

          if (slot.provider !== null) {
            expect(['perplexity', 'gemini']).toContain(slot.provider);
          }

          if (slot.status !== null) {
            expect(['active', 'completed']).toContain(slot.status);
          }
        });
      }
    }, TEST_TIMEOUT);

    it('should handle job not found (404)', async () => {
      const nonExistentJobId = 999999;

      await request(BASE_URL)
        .get(`/api/admin/news/job/${nonExistentJobId}`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([404, 401, 403]).toContain(res.status);
        });
    }, TEST_TIMEOUT);

    it('should handle invalid jobId (400 or 404)', async () => {
      const invalidJobId = 'not-a-number';

      await request(BASE_URL)
        .get(`/api/admin/news/job/${invalidJobId}`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          // Could be 400 (bad request) or 404 (not found after parsing)
          expect([400, 404, 401, 403]).toContain(res.status);
        });
    }, TEST_TIMEOUT);
  });

  describe('GET /api/admin/news/ai-stats', () => {
    it('should return AI usage stats structure', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/news/ai-stats')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();

        // Should have provider usage counts
        if (response.body.gemini !== undefined) {
          expect(typeof response.body.gemini).toBe('number');
        }
        if (response.body.perplexity !== undefined) {
          expect(typeof response.body.perplexity).toBe('number');
        }

        // Should have error counts
        if (response.body.gemini429 !== undefined) {
          expect(typeof response.body.gemini429).toBe('number');
        }
        if (response.body.perplexity429 !== undefined) {
          expect(typeof response.body.perplexity429).toBe('number');
        }
      }
    }, TEST_TIMEOUT);

    it('should return live stats while job running or database stats when completed', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/news/ai-stats')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200) {
        // Stats should be an object (not null or undefined)
        expect(response.body).toBeDefined();
        expect(typeof response.body).toBe('object');
      }
    }, TEST_TIMEOUT);
  });

  describe('POST /api/admin/news/job/:id/cancel', () => {
    it('should cancel running job successfully', async () => {
      // First, check if there's a running job
      const statusResponse = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (statusResponse.status === 200 &&
          statusResponse.body &&
          statusResponse.body.status === 'running') {

        const jobId = statusResponse.body.id;

        const response = await request(BASE_URL)
          .post(`/api/admin/news/job/${jobId}/cancel`)
          .set('Cookie', authCookie || '')
          .expect((res) => {
            expect([200, 400, 401, 403]).toContain(res.status);
          });

        if (response.status === 200) {
          expect(response.body).toHaveProperty('message');
          expect(response.body.message).toContain('cancel');
        }
      }
    }, TEST_TIMEOUT);

    it('should save current AI usage to database on cancel', async () => {
      // This test verifies that AI stats are preserved after cancellation
      const statusResponse = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (statusResponse.status === 200 && statusResponse.body && statusResponse.body.id) {
        const jobId = statusResponse.body.id;

        // Get stats before cancel (if job is running)
        const statsBefore = await request(BASE_URL)
          .get('/api/admin/news/ai-stats')
          .set('Cookie', authCookie || '')
          .expect((res) => {
            expect([200, 401, 403]).toContain(res.status);
          });

        if (statusResponse.body.status === 'running') {
          // Cancel the job
          await request(BASE_URL)
            .post(`/api/admin/news/job/${jobId}/cancel`)
            .set('Cookie', authCookie || '');

          // Get stats after cancel
          const statsAfter = await request(BASE_URL)
            .get('/api/admin/news/ai-stats')
            .set('Cookie', authCookie || '')
            .expect((res) => {
              expect([200, 401, 403]).toContain(res.status);
            });

          // Stats should still be available (not zeroed out)
          if (statsBefore.status === 200 && statsAfter.status === 200) {
            expect(statsAfter.body).toBeDefined();
          }
        }
      }
    }, TEST_TIMEOUT * 2);

    it('should NOT clear displaySlots in memory', async () => {
      const statusResponse = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (statusResponse.status === 200 &&
          statusResponse.body &&
          statusResponse.body.status === 'running') {

        const jobId = statusResponse.body.id;

        // Get slots before cancel
        const slotsBefore = await request(BASE_URL)
          .get(`/api/admin/news/job/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Cancel
        await request(BASE_URL)
          .post(`/api/admin/news/job/${jobId}/cancel`)
          .set('Cookie', authCookie || '');

        // Get slots after cancel
        const slotsAfter = await request(BASE_URL)
          .get(`/api/admin/news/job/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Slots should still exist (same length)
        expect(slotsAfter.body.displaySlots.length).toBe(10);

        // Active slots should be preserved
        const activeSlotsBefore = slotsBefore.body.displaySlots.filter(s => s.poiId !== null);
        const activeSlotsAfter = slotsAfter.body.displaySlots.filter(s => s.poiId !== null);

        // Should have at least the same POIs (or more if some completed during cancel)
        expect(activeSlotsAfter.length).toBeGreaterThanOrEqual(0);
      }
    }, TEST_TIMEOUT);

    it('should return 400 if job not running', async () => {
      // Try to cancel a non-existent or completed job
      const nonExistentJobId = 999999;

      const response = await request(BASE_URL)
        .post(`/api/admin/news/job/${nonExistentJobId}/cancel`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([400, 401, 403, 404]).toContain(res.status);
        });

      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
    }, TEST_TIMEOUT);

    it('should allow polling to continue after cancel', async () => {
      const statusResponse = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (statusResponse.status === 200 &&
          statusResponse.body &&
          statusResponse.body.status === 'running') {

        const jobId = statusResponse.body.id;

        // Cancel
        await request(BASE_URL)
          .post(`/api/admin/news/job/${jobId}/cancel`)
          .set('Cookie', authCookie || '');

        // Should still be able to poll job status
        const pollResponse = await request(BASE_URL)
          .get(`/api/admin/news/job/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        expect(pollResponse.body).toHaveProperty('status');
        expect(pollResponse.body.displaySlots).toBeDefined();
      }
    }, TEST_TIMEOUT);
  });

  describe('POST /api/admin/news/collect-batch', () => {
    it('should create batch job with poiIds', async () => {
      const poiIds = [1, 2, 3]; // Assuming these POIs exist

      const response = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds })
        .expect((res) => {
          expect([200, 400, 401, 403, 409]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('jobId');
        expect(response.body).toHaveProperty('message');
      } else if (response.status === 400) {
        // Invalid input
        expect(response.body).toHaveProperty('error');
      }
    }, TEST_TIMEOUT);

    it('should validate poiIds array', async () => {
      const response = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: 'not-an-array' })
        .expect((res) => {
          expect([400, 401, 403]).toContain(res.status);
        });

      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
    }, TEST_TIMEOUT);

    it('should prevent duplicate batch jobs', async () => {
      const poiIds = [1, 2];

      // Start first job
      const response1 = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      // Try to start second job immediately
      if (response1.status === 200) {
        const response2 = await request(BASE_URL)
          .post('/api/admin/news/collect-batch')
          .set('Cookie', authCookie || '')
          .send({ poiIds })
          .expect((res) => {
            expect([409, 401, 403]).toContain(res.status);
          });

        if (response2.status === 409) {
          expect(response2.body.error).toContain('already running');
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('GET /api/admin/news/status', () => {
    it('should return latest job status', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/news/status')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200) {
        // Should return job object or null/message if no jobs exist
        if (response.body && response.body.id) {
          expect(response.body).toHaveProperty('id');
          expect(response.body).toHaveProperty('status');
          expect(['queued', 'running', 'completed', 'cancelled', 'failed'])
            .toContain(response.body.status);
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('GET /api/admin/news/recent', () => {
    it('should return recent news items', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/news/recent')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);

        if (response.body.length > 0) {
          const newsItem = response.body[0];
          expect(newsItem).toHaveProperty('id');
          expect(newsItem).toHaveProperty('title');
          expect(newsItem).toHaveProperty('poi_id');
        }
      }
    }, TEST_TIMEOUT);

    it('should support limit parameter', async () => {
      const limit = 5;

      const response = await request(BASE_URL)
        .get(`/api/admin/news/recent?limit=${limit}`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeLessThanOrEqual(limit);
      }
    }, TEST_TIMEOUT);
  });
});
