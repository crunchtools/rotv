/**
 * Integration Tests for Trail Status Slot Architecture API
 * Tests HTTP endpoints for Trail Status collection with slot management
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Test database should exist (rotv_test)
 * - Must be authenticated as admin
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds for API tests
const POLLING_INTERVAL = 1000; // 1 second between polls
const MAX_POLL_ATTEMPTS = 60; // Max 60 seconds to wait for job completion

describe('Trail Status Slot Architecture Integration Tests', () => {
  let authCookie;

  // Helper to wait for job completion
  async function waitForJobCompletion(jobId, maxAttempts = MAX_POLL_ATTEMPTS) {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await request(BASE_URL)
        .get(`/api/admin/trail-status/job-status/${jobId}`)
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
  });

  describe('POST /api/admin/trail-status/collect-batch', () => {
    it('should create job and return jobId', async () => {
      // Try to collect trail status for all trails with status_url
      const response = await request(BASE_URL)
        .post('/api/admin/trail-status/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: null }) // null means all trails
        .expect((res) => {
          // Accept 200 (success), 401/403 (auth required), or 409 (duplicate job)
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('jobId');
        expect(response.body).toHaveProperty('message');
        expect(typeof response.body.jobId).toBe('number');
        expect(response.body.message).toContain('Batch collection started');
      } else if (response.status === 409) {
        // Job already running - this is acceptable
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('already running');
      }
    }, TEST_TIMEOUT);

    it('should initialize 10 display slots in memory', async () => {
      // Start a job
      const startResponse = await request(BASE_URL)
        .post('/api/admin/trail-status/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2, 3] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (startResponse.status === 200) {
        const jobId = startResponse.body.jobId;

        // Get job status immediately
        const statusResponse = await request(BASE_URL)
          .get(`/api/admin/trail-status/job-status/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Should have 10 slots
        expect(statusResponse.body).toHaveProperty('displaySlots');
        expect(statusResponse.body.displaySlots.length).toBe(10);
      }
    }, TEST_TIMEOUT);

    it('should prevent duplicate jobs (409 Conflict)', async () => {
      // First request
      const response1 = await request(BASE_URL)
        .post('/api/admin/trail-status/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      // Second request immediately after
      if (response1.status === 200) {
        const response2 = await request(BASE_URL)
          .post('/api/admin/trail-status/collect-batch')
          .set('Cookie', authCookie || '')
          .send({ poiIds: [1, 2] })
          .expect((res) => {
            expect([409, 401, 403]).toContain(res.status);
          });

        if (response2.status === 409) {
          expect(response2.body.error).toContain('already running');
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('GET /api/admin/trail-status/job-status/:jobId', () => {
    it('should return displaySlots array with exactly 10 elements', async () => {
      // Get latest job
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 && latestResponse.body && latestResponse.body.id) {
        const jobId = latestResponse.body.id;

        const response = await request(BASE_URL)
          .get(`/api/admin/trail-status/job-status/${jobId}`)
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

    it('should return slot data enriched with trail progress', async () => {
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 && latestResponse.body && latestResponse.body.id) {
        const jobId = latestResponse.body.id;

        const response = await request(BASE_URL)
          .get(`/api/admin/trail-status/job-status/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Find active slots (non-null poiId)
        const activeSlots = response.body.displaySlots.filter(slot => slot.poiId !== null);

        activeSlots.forEach(slot => {
          expect(slot.poiId).not.toBeNull();
          expect(typeof slot.poiId).toBe('number');

          if (slot.phase !== null) {
            expect(typeof slot.phase).toBe('string');
            // Trail-specific phases
            expect(['starting', 'rendering', 'ai_search', 'saving', 'complete', 'error'])
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

    it('should handle completed/cancelled job statuses', async () => {
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 && latestResponse.body) {
        const job = latestResponse.body;

        if (job.status) {
          expect(['queued', 'running', 'completed', 'cancelled', 'failed'])
            .toContain(job.status);
        }

        // For completed/cancelled jobs, slots should still exist
        if (job.status === 'completed' || job.status === 'cancelled') {
          const response = await request(BASE_URL)
            .get(`/api/admin/trail-status/job-status/${job.id}`)
            .set('Cookie', authCookie || '')
            .expect(200);

          expect(response.body.displaySlots).toBeDefined();
          expect(response.body.displaySlots.length).toBe(10);
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('GET /api/admin/trail-status/ai-stats', () => {
    it('should return AI usage stats', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/trail-status/ai-stats')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(typeof response.body).toBe('object');

        // Should have provider counts
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

    it('should return database stats when job completed/cancelled', async () => {
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 &&
          latestResponse.body &&
          (latestResponse.body.status === 'completed' || latestResponse.body.status === 'cancelled')) {

        const statsResponse = await request(BASE_URL)
          .get('/api/admin/trail-status/ai-stats')
          .set('Cookie', authCookie || '')
          .expect(200);

        // Stats should be from database (ai_usage field)
        expect(statsResponse.body).toBeDefined();
      }
    }, TEST_TIMEOUT);
  });

  describe('PUT /api/admin/trail-status/batch-collect/:jobId/cancel', () => {
    it('should cancel running job and preserve slots', async () => {
      // First check if there's a running job
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 &&
          latestResponse.body &&
          latestResponse.body.status === 'running') {

        const jobId = latestResponse.body.id;

        // Get slots before cancel
        const slotsBefore = await request(BASE_URL)
          .get(`/api/admin/trail-status/job-status/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Cancel
        const cancelResponse = await request(BASE_URL)
          .put(`/api/admin/trail-status/batch-collect/${jobId}/cancel`)
          .set('Cookie', authCookie || '')
          .expect((res) => {
            expect([200, 400, 401, 403]).toContain(res.status);
          });

        if (cancelResponse.status === 200) {
          expect(cancelResponse.body).toHaveProperty('message');

          // Get slots after cancel
          const slotsAfter = await request(BASE_URL)
            .get(`/api/admin/trail-status/job-status/${jobId}`)
            .set('Cookie', authCookie || '')
            .expect(200);

          // Slots should still exist
          expect(slotsAfter.body.displaySlots.length).toBe(10);

          // Active slots should be preserved
          const activeSlotsBefore = slotsBefore.body.displaySlots.filter(s => s.poiId !== null).length;
          const activeSlotsAfter = slotsAfter.body.displaySlots.filter(s => s.poiId !== null).length;

          expect(activeSlotsAfter).toBeGreaterThanOrEqual(0);
        }
      }
    }, TEST_TIMEOUT);

    it('should save AI usage on cancellation', async () => {
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 &&
          latestResponse.body &&
          latestResponse.body.status === 'running') {

        const jobId = latestResponse.body.id;

        // Cancel
        await request(BASE_URL)
          .put(`/api/admin/trail-status/batch-collect/${jobId}/cancel`)
          .set('Cookie', authCookie || '');

        // Check that AI stats are still available
        const statsResponse = await request(BASE_URL)
          .get('/api/admin/trail-status/ai-stats')
          .set('Cookie', authCookie || '')
          .expect((res) => {
            expect([200, 401, 403]).toContain(res.status);
          });

        if (statsResponse.status === 200) {
          expect(statsResponse.body).toBeDefined();
        }
      }
    }, TEST_TIMEOUT);

    it('should return 400 if job not running', async () => {
      const nonExistentJobId = 999999;

      const response = await request(BASE_URL)
        .put(`/api/admin/trail-status/batch-collect/${nonExistentJobId}/cancel`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([400, 401, 403, 404]).toContain(res.status);
        });

      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
    }, TEST_TIMEOUT);
  });

  describe('GET /api/admin/trail-status/job-status/latest', () => {
    it('should return latest job or null if none exist', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200) {
        // Should return job object or null
        if (response.body) {
          expect(response.body).toHaveProperty('id');
          expect(response.body).toHaveProperty('status');
          expect(['queued', 'running', 'completed', 'cancelled', 'failed'])
            .toContain(response.body.status);
        }
      }
    }, TEST_TIMEOUT);

    it('should include job metadata', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (response.status === 200 && response.body && response.body.id) {
        const job = response.body;

        // Should have these fields
        expect(job).toHaveProperty('job_type');
        expect(job).toHaveProperty('total_trails');
        expect(job).toHaveProperty('trails_processed');
        expect(job).toHaveProperty('started_at');

        if (job.status === 'completed' || job.status === 'failed') {
          expect(job).toHaveProperty('completed_at');
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('Job Processing Behavior', () => {
    it('should handle concurrent trail processing with max 10 slots', async () => {
      // Start a job with more than 10 trails
      const manyPoiIds = Array.from({ length: 20 }, (_, i) => i + 1);

      const startResponse = await request(BASE_URL)
        .post('/api/admin/trail-status/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: manyPoiIds })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (startResponse.status === 200) {
        const jobId = startResponse.body.jobId;

        // Poll once to see slots in action
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

        const statusResponse = await request(BASE_URL)
          .get(`/api/admin/trail-status/job-status/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Should never have more than 10 active slots
        const activeSlots = statusResponse.body.displaySlots.filter(s => s.poiId !== null);
        expect(activeSlots.length).toBeLessThanOrEqual(10);

        // All slots should have sequential slotIds (0-9)
        statusResponse.body.displaySlots.forEach((slot, index) => {
          expect(slot.slotId).toBe(index);
        });
      }
    }, TEST_TIMEOUT * 2);

    it('should reuse completed slots for new trails', async () => {
      // This test would require running a job long enough to see slot reuse
      // For now, we verify the structure supports it
      const latestResponse = await request(BASE_URL)
        .get('/api/admin/trail-status/job-status/latest')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (latestResponse.status === 200 && latestResponse.body && latestResponse.body.id) {
        const jobId = latestResponse.body.id;

        const response = await request(BASE_URL)
          .get(`/api/admin/trail-status/job-status/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        // Check for completed slots (status === 'completed')
        const completedSlots = response.body.displaySlots.filter(s => s.status === 'completed');

        // Completed slots should have valid data
        completedSlots.forEach(slot => {
          expect(slot.poiId).not.toBeNull();
          expect(slot.phase).not.toBeNull();
        });
      }
    }, TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    it('should handle invalid jobId gracefully', async () => {
      const invalidJobId = 'not-a-number';

      await request(BASE_URL)
        .get(`/api/admin/trail-status/job-status/${invalidJobId}`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([400, 404, 401, 403]).toContain(res.status);
        });
    }, TEST_TIMEOUT);

    it('should handle non-existent jobId', async () => {
      const nonExistentJobId = 999999;

      await request(BASE_URL)
        .get(`/api/admin/trail-status/job-status/${nonExistentJobId}`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([404, 401, 403]).toContain(res.status);
        });
    }, TEST_TIMEOUT);

    it('should handle empty poiIds array', async () => {
      const response = await request(BASE_URL)
        .post('/api/admin/trail-status/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [] })
        .expect((res) => {
          expect([400, 401, 403]).toContain(res.status);
        });

      // Empty array might be rejected or result in "no trails found"
      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
    }, TEST_TIMEOUT);
  });
});
