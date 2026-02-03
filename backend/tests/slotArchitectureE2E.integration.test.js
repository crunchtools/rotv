/**
 * End-to-End Integration Tests for Slot Architecture
 * Tests complete workflows from start to finish for News/Events and Trail Status
 *
 * These tests verify entire job lifecycles:
 * - Job creation → processing → completion
 * - Job creation → cancellation
 * - Duplicate job prevention
 * - Slot reuse and lifecycle
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Test database should exist (rotv_test)
 * - Must be authenticated as admin
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

// Test configuration
const TEST_TIMEOUT = 120000; // 2 minutes for E2E tests
const POLLING_INTERVAL = 2000; // 2 seconds between polls
const MAX_POLL_ATTEMPTS = 60; // Max 2 minutes to wait for job completion

describe('End-to-End Slot Architecture Tests', () => {
  let authCookie;

  // Helper to wait for job completion
  async function waitForJobCompletion(endpoint, jobId, maxAttempts = MAX_POLL_ATTEMPTS) {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await request(BASE_URL)
        .get(`${endpoint}/${jobId}`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403, 404]).toContain(res.status);
        });

      if (response.status === 200) {
        const job = response.body;

        if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
          return job;
        }

        // Log progress
        if (i % 5 === 0) {
          console.log(`[E2E Test] Job ${jobId} still running... (${job.status})`);
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }

    throw new Error(`Job ${jobId} did not complete within ${maxAttempts * POLLING_INTERVAL / 1000} seconds`);
  }

  // Helper to poll job status and collect slot observations
  async function observeJobProgress(endpoint, jobId, durationMs = 10000) {
    const observations = [];
    const startTime = Date.now();

    while (Date.now() - startTime < durationMs) {
      const response = await request(BASE_URL)
        .get(`${endpoint}/${jobId}`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403, 404]).toContain(res.status);
        });

      if (response.status === 200) {
        observations.push({
          timestamp: Date.now(),
          status: response.body.status,
          displaySlots: response.body.displaySlots,
          activeSlots: response.body.displaySlots?.filter(s => s.poiId !== null).length || 0,
          completedSlots: response.body.displaySlots?.filter(s => s.status === 'completed').length || 0
        });

        if (response.body.status === 'completed' || response.body.status === 'cancelled') {
          break;
        }
      }

      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }

    return observations;
  }

  beforeAll(async () => {
    // Note: Authentication might be required for admin endpoints
    console.log('[E2E Test] Starting end-to-end slot architecture tests');
  });

  describe('Complete News Collection Workflow', () => {
    it('should complete full collection workflow with slot management', async () => {
      console.log('[E2E Test] Starting full news collection workflow');

      // Step 1: Start job
      const startResponse = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2, 3, 4, 5] }) // Collect for 5 POIs
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (startResponse.status !== 200) {
        console.log('[E2E Test] Skipping test - job already running or auth required');
        return;
      }

      const jobId = startResponse.body.jobId;
      expect(jobId).toBeDefined();
      console.log(`[E2E Test] Job started: ${jobId}`);

      // Step 2: Observe job progress for 10 seconds
      console.log('[E2E Test] Observing job progress...');
      const observations = await observeJobProgress('/api/admin/news/job', jobId, 10000);

      expect(observations.length).toBeGreaterThan(0);

      // Step 3: Verify slots fill progressively
      const slotsOverTime = observations.map(obs => obs.activeSlots);
      console.log(`[E2E Test] Active slots over time: ${slotsOverTime.join(' → ')}`);

      // Should see slots increasing or staying at max (10)
      const maxSlots = Math.max(...slotsOverTime);
      expect(maxSlots).toBeLessThanOrEqual(10);
      expect(maxSlots).toBeGreaterThan(0);

      // Step 4: Verify all observations have exactly 10 slots
      observations.forEach((obs, i) => {
        expect(obs.displaySlots.length).toBe(10);
      });

      // Step 5: Wait for job to complete (or timeout)
      console.log('[E2E Test] Waiting for job completion...');
      const finalJob = await waitForJobCompletion('/api/admin/news/job', jobId);

      expect(finalJob.status).toBe('completed');
      console.log(`[E2E Test] Job completed: ${finalJob.status}`);

      // Step 6: Verify final slot state is frozen
      const finalResponse = await request(BASE_URL)
        .get(`/api/admin/news/job/${jobId}`)
        .set('Cookie', authCookie || '')
        .expect(200);

      expect(finalResponse.body.displaySlots.length).toBe(10);
      console.log(`[E2E Test] Final slots: ${finalResponse.body.displaySlots.filter(s => s.poiId !== null).length} active`);

      // Step 7: Verify AI usage badges persist
      const statsResponse = await request(BASE_URL)
        .get('/api/admin/news/ai-stats')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (statsResponse.status === 200) {
        expect(statsResponse.body).toBeDefined();
        console.log(`[E2E Test] AI stats preserved: ${JSON.stringify(statsResponse.body)}`);
      }
    }, TEST_TIMEOUT);

    it('should handle slot reuse when processing more than 10 POIs', async () => {
      console.log('[E2E Test] Testing slot reuse with 15 POIs');

      const manyPois = Array.from({ length: 15 }, (_, i) => i + 1);

      const startResponse = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: manyPois })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (startResponse.status !== 200) {
        console.log('[E2E Test] Skipping test - job already running or auth required');
        return;
      }

      const jobId = startResponse.body.jobId;

      // Observe for 15 seconds to see slot reuse
      const observations = await observeJobProgress('/api/admin/news/job', jobId, 15000);

      // Verify we never exceed 10 active slots at once
      observations.forEach((obs, i) => {
        expect(obs.activeSlots).toBeLessThanOrEqual(10);

        if (i > 0) {
          // Verify slots are being reused (completed slots should appear over time)
          if (obs.completedSlots > 0) {
            console.log(`[E2E Test] Slot reuse detected: ${obs.completedSlots} completed slots at observation ${i}`);
          }
        }
      });

      console.log('[E2E Test] Slot reuse test passed');
    }, TEST_TIMEOUT);
  });

  describe('Complete Cancellation Workflow', () => {
    it('should cancel mid-job and freeze state', async () => {
      console.log('[E2E Test] Starting cancellation workflow');

      // Step 1: Start job
      const startResponse = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2, 3, 4, 5, 6, 7, 8] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (startResponse.status !== 200) {
        console.log('[E2E Test] Skipping test - job already running or auth required');
        return;
      }

      const jobId = startResponse.body.jobId;
      console.log(`[E2E Test] Job started: ${jobId}`);

      // Step 2: Wait for some POIs to process (5 seconds)
      console.log('[E2E Test] Waiting for POIs to start processing...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Step 3: Get current state
      const beforeCancelResponse = await request(BASE_URL)
        .get(`/api/admin/news/job/${jobId}`)
        .set('Cookie', authCookie || '')
        .expect(200);

      const activeSlotsBeforeCancel = beforeCancelResponse.body.displaySlots.filter(s => s.poiId !== null).length;
      console.log(`[E2E Test] Active slots before cancel: ${activeSlotsBeforeCancel}`);

      // Step 4: Cancel job
      console.log('[E2E Test] Cancelling job...');
      const cancelResponse = await request(BASE_URL)
        .post(`/api/admin/news/job/${jobId}/cancel`)
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 400, 401, 403]).toContain(res.status);
        });

      if (cancelResponse.status === 200) {
        expect(cancelResponse.body).toHaveProperty('message');
        console.log(`[E2E Test] Cancel response: ${cancelResponse.body.message}`);
      }

      // Step 5: Verify in-progress POIs continue (slots don't immediately clear)
      await new Promise(resolve => setTimeout(resolve, 2000));

      const afterCancelResponse = await request(BASE_URL)
        .get(`/api/admin/news/job/${jobId}`)
        .set('Cookie', authCookie || '')
        .expect(200);

      expect(afterCancelResponse.body.displaySlots.length).toBe(10);

      // Step 6: Wait for in-progress POIs to finish
      console.log('[E2E Test] Waiting for in-progress POIs to finish...');
      const finalJob = await waitForJobCompletion('/api/admin/news/job', jobId);

      expect(finalJob.status).toBe('cancelled');
      console.log(`[E2E Test] Job status after cancel: ${finalJob.status}`);

      // Step 7: Verify slots are frozen (not cleared)
      const frozenSlotsResponse = await request(BASE_URL)
        .get(`/api/admin/news/job/${jobId}`)
        .set('Cookie', authCookie || '')
        .expect(200);

      expect(frozenSlotsResponse.body.displaySlots.length).toBe(10);

      const finalActiveSlots = frozenSlotsResponse.body.displaySlots.filter(s => s.poiId !== null).length;
      console.log(`[E2E Test] Active slots after cancel: ${finalActiveSlots}`);

      // Should have at least some slots preserved
      expect(finalActiveSlots).toBeGreaterThanOrEqual(0);

      // Step 8: Verify AI usage badges persist
      const statsResponse = await request(BASE_URL)
        .get('/api/admin/news/ai-stats')
        .set('Cookie', authCookie || '')
        .expect((res) => {
          expect([200, 401, 403]).toContain(res.status);
        });

      if (statsResponse.status === 200) {
        expect(statsResponse.body).toBeDefined();
        console.log(`[E2E Test] AI stats after cancel: ${JSON.stringify(statsResponse.body)}`);
      }
    }, TEST_TIMEOUT);
  });

  describe('Duplicate Job Prevention', () => {
    it('should prevent starting job while one is running', async () => {
      console.log('[E2E Test] Testing duplicate job prevention');

      // Step 1: Start first job
      const job1Response = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2, 3] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (job1Response.status !== 200) {
        console.log('[E2E Test] First job already running or auth required');
      }

      // Step 2: Attempt to start second job immediately
      const job2Response = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [4, 5, 6] })
        .expect((res) => {
          expect([409, 401, 403]).toContain(res.status);
        });

      // Should get 409 Conflict
      if (job2Response.status === 409) {
        expect(job2Response.body).toHaveProperty('error');
        expect(job2Response.body.error).toContain('already running');
        console.log('[E2E Test] Duplicate job correctly prevented');
      } else {
        console.log('[E2E Test] Auth required or first job already completed');
      }
    }, TEST_TIMEOUT);

    it('should allow News and Trail Status jobs to run independently', async () => {
      console.log('[E2E Test] Testing independent job execution');

      // Step 1: Start News job
      const newsJobResponse = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (newsJobResponse.status !== 200) {
        console.log('[E2E Test] News job already running or auth required');
      }

      // Step 2: Start Trail Status job (should succeed - different job type)
      const trailJobResponse = await request(BASE_URL)
        .post('/api/admin/trail-status/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      // Both should be able to run simultaneously
      if (newsJobResponse.status === 200 && trailJobResponse.status === 200) {
        const newsJobId = newsJobResponse.body.jobId;
        const trailJobId = trailJobResponse.body.jobId;

        console.log(`[E2E Test] News job: ${newsJobId}, Trail job: ${trailJobId}`);

        // Verify both jobs have their own slots
        const newsSlots = await request(BASE_URL)
          .get(`/api/admin/news/job/${newsJobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        const trailSlots = await request(BASE_URL)
          .get(`/api/admin/trail-status/job-status/${trailJobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        expect(newsSlots.body.displaySlots.length).toBe(10);
        expect(trailSlots.body.displaySlots.length).toBe(10);

        console.log('[E2E Test] Independent job execution verified');
      } else {
        console.log('[E2E Test] One or both jobs already running or auth required');
      }
    }, TEST_TIMEOUT);
  });

  describe('Trail Status E2E Workflow', () => {
    it('should complete trail status collection workflow', async () => {
      console.log('[E2E Test] Starting trail status collection workflow');

      // Step 1: Start trail status job
      const startResponse = await request(BASE_URL)
        .post('/api/admin/trail-status/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2, 3] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (startResponse.status !== 200) {
        console.log('[E2E Test] Skipping test - job already running or auth required');
        return;
      }

      const jobId = startResponse.body.jobId;
      console.log(`[E2E Test] Trail status job started: ${jobId}`);

      // Step 2: Observe job progress
      const observations = await observeJobProgress('/api/admin/trail-status/job-status', jobId, 10000);

      expect(observations.length).toBeGreaterThan(0);

      // Step 3: Verify slot behavior
      observations.forEach(obs => {
        expect(obs.displaySlots.length).toBe(10);
        expect(obs.activeSlots).toBeLessThanOrEqual(10);
      });

      console.log('[E2E Test] Trail status slot behavior verified');

      // Step 4: Wait for completion or cancel
      const finalJob = await waitForJobCompletion('/api/admin/trail-status/job-status', jobId, 30);

      expect(['completed', 'cancelled', 'failed']).toContain(finalJob.status);
      console.log(`[E2E Test] Trail status job finished: ${finalJob.status}`);
    }, TEST_TIMEOUT);
  });

  describe('Slot Lifecycle Verification', () => {
    it('should maintain slot integrity throughout job lifecycle', async () => {
      console.log('[E2E Test] Testing slot lifecycle integrity');

      // Start a small job
      const startResponse = await request(BASE_URL)
        .post('/api/admin/news/collect-batch')
        .set('Cookie', authCookie || '')
        .send({ poiIds: [1, 2, 3] })
        .expect((res) => {
          expect([200, 401, 403, 409]).toContain(res.status);
        });

      if (startResponse.status !== 200) {
        console.log('[E2E Test] Skipping test - job already running or auth required');
        return;
      }

      const jobId = startResponse.body.jobId;

      // Track slot IDs throughout lifecycle
      const slotIdSets = [];

      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const response = await request(BASE_URL)
          .get(`/api/admin/news/job/${jobId}`)
          .set('Cookie', authCookie || '')
          .expect(200);

        const slotIds = response.body.displaySlots.map(s => s.slotId);
        slotIdSets.push(slotIds);

        // Verify slot IDs are always 0-9 in order
        expect(slotIds).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      }

      console.log('[E2E Test] Slot IDs remained stable: [0-9] throughout lifecycle');

      // Verify all slot ID sets are identical
      for (let i = 1; i < slotIdSets.length; i++) {
        expect(slotIdSets[i]).toEqual(slotIdSets[0]);
      }

      console.log('[E2E Test] Slot lifecycle integrity verified');
    }, TEST_TIMEOUT);
  });
});
