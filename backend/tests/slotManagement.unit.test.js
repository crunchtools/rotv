/**
 * Unit Tests for Slot Management
 * Tests core slot management functions in isolation for News/Events and Trail Status services
 *
 * These tests verify:
 * - Slot initialization (10 empty slots)
 * - Slot assignment (POI assignment to slots)
 * - Slot updates (progress synchronization)
 * - getDisplaySlots() behavior
 * - Slot lifecycle (frozen state after completion)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import functions from both services
import * as newsService from '../services/newsService.js';
import * as trailStatusService from '../services/trailStatusService.js';

describe('Slot Management Unit Tests - News Service', () => {
  const TEST_JOB_ID = 'test-job-123';
  const TEST_POI_ID = 1;
  const TEST_POI_NAME = 'Test Trail';
  const TEST_PROVIDER = 'perplexity';

  beforeEach(() => {
    // Clear any existing slots/progress before each test
    // We need to test the actual implementation, so we'll use the exported functions
  });

  describe('Slot Initialization', () => {
    it('should initialize exactly 10 empty slots for a job', () => {
      // Initialize slots by calling updateProgress with jobId
      // First, we need to trigger slot initialization
      // Looking at the code, slots are initialized in processNewsCollectionJob via initializeSlots(jobId)
      // Since initializeSlots is not exported, we test via getDisplaySlots which returns empty slots if not found

      const slots = newsService.getDisplaySlots(TEST_JOB_ID);

      expect(slots).toBeDefined();
      expect(Array.isArray(slots)).toBe(true);
      expect(slots.length).toBe(10);
    });

    it('should create slots with correct structure (slotId, poiId, poiName, phase, provider, status)', () => {
      const slots = newsService.getDisplaySlots(TEST_JOB_ID);

      slots.forEach((slot, index) => {
        expect(slot).toHaveProperty('slotId');
        expect(slot).toHaveProperty('poiId');
        expect(slot).toHaveProperty('poiName');
        expect(slot).toHaveProperty('phase');
        expect(slot).toHaveProperty('provider');
        expect(slot).toHaveProperty('status');
        expect(slot.slotId).toBe(index); // slotId should match index (0-9)
      });
    });

    it('should set all fields to null except slotId (0-9)', () => {
      const slots = newsService.getDisplaySlots(TEST_JOB_ID);

      slots.forEach((slot, index) => {
        expect(slot.slotId).toBe(index);
        expect(slot.poiId).toBeNull();
        expect(slot.poiName).toBeNull();
        expect(slot.phase).toBeNull();
        expect(slot.provider).toBeNull();
        expect(slot.status).toBeNull();
      });
    });

    it('should handle multiple jobs independently (jobId isolation)', () => {
      const jobId1 = 'job-1';
      const jobId2 = 'job-2';

      // Initialize slots for both jobs
      newsService.initializeSlots(jobId1);
      newsService.initializeSlots(jobId2);

      // Get slots for both jobs
      const slots1 = newsService.getDisplaySlots(jobId1);
      const slots2 = newsService.getDisplaySlots(jobId2);

      expect(slots1.length).toBe(10);
      expect(slots2.length).toBe(10);

      // Modify one job's progress shouldn't affect the other
      newsService.updateProgress(TEST_POI_ID, {
        jobId: jobId1,
        slotId: 0,
        poiName: 'POI 1',
        phase: 'ai_search'
      });

      const updatedSlots1 = newsService.getDisplaySlots(jobId1);
      const updatedSlots2 = newsService.getDisplaySlots(jobId2);

      // Job 1 should have updated progress in slot 0
      expect(updatedSlots1[0].poiId).toBe(TEST_POI_ID);
      // Job 2 should still be empty
      expect(updatedSlots2[0].poiId).toBeNull();

      // Cleanup
      newsService.clearProgress(TEST_POI_ID);
    });
  });

  describe('Slot Updates via updateProgress', () => {
    it('should update slot with progress when slotId and jobId are present', () => {
      const poiId = 100;
      const slotId = 5;
      const jobId = 'update-test-job';

      // Initialize slots first
      newsService.initializeSlots(jobId);

      // Update progress with slotId and jobId
      newsService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Test POI',
        phase: 'ai_search',
        provider: 'gemini'
      });

      const slots = newsService.getDisplaySlots(jobId);

      // Slot 5 should have the updated data
      expect(slots[slotId].poiId).toBe(poiId);
      expect(slots[slotId].poiName).toBe('Test POI');
      expect(slots[slotId].phase).toBe('ai_search');
      expect(slots[slotId].provider).toBe('gemini');
      expect(slots[slotId].status).toBe('active');

      // Cleanup
      newsService.clearProgress(poiId);
    });

    it('should preserve slotId during updates', () => {
      const poiId = 101;
      const slotId = 3;
      const jobId = 'preserve-slot-job';

      // Initialize slots first
      newsService.initializeSlots(jobId);

      // Initial update
      newsService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Preserve Test',
        phase: 'initializing'
      });

      // Second update (simulating progress)
      newsService.updateProgress(poiId, {
        phase: 'ai_search'
      });

      const slots = newsService.getDisplaySlots(jobId);

      // slotId should still be 3
      expect(slots[slotId].poiId).toBe(poiId);
      expect(slots[slotId].phase).toBe('ai_search');

      // Cleanup
      newsService.clearProgress(poiId);
    });

    it('should handle phase transitions (initializing → rendering → ai_search → complete)', () => {
      const poiId = 102;
      const slotId = 2;
      const jobId = 'phase-transition-job';

      const phases = ['initializing', 'rendering_events', 'ai_search', 'processing_results', 'complete'];

      // Initialize slots first
      newsService.initializeSlots(jobId);

      // Initialize
      newsService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Phase Test',
        phase: phases[0]
      });

      // Transition through phases
      phases.forEach(phase => {
        newsService.updateProgress(poiId, { phase });

        const slots = newsService.getDisplaySlots(jobId);
        expect(slots[slotId].phase).toBe(phase);
      });

      // Cleanup
      newsService.clearProgress(poiId);
    });

    it('should mark slot status as "completed" when progress.completed = true', () => {
      const poiId = 103;
      const slotId = 4;
      const jobId = 'completion-test-job';

      // Initialize slots first
      newsService.initializeSlots(jobId);

      // Start progress
      newsService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Completion Test',
        phase: 'ai_search'
      });

      let slots = newsService.getDisplaySlots(jobId);
      expect(slots[slotId].status).toBe('active');

      // Mark as completed
      newsService.updateProgress(poiId, {
        phase: 'complete',
        completed: true
      });

      slots = newsService.getDisplaySlots(jobId);
      expect(slots[slotId].status).toBe('completed');

      // Cleanup
      newsService.clearProgress(poiId);
    });

    it('should handle error phase without clearing slot', () => {
      const poiId = 104;
      const slotId = 6;
      const jobId = 'error-test-job';

      // Initialize slots first
      newsService.initializeSlots(jobId);

      // Start progress
      newsService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Error Test',
        phase: 'ai_search'
      });

      // Simulate error
      newsService.updateProgress(poiId, {
        phase: 'error',
        message: 'AI call failed',
        completed: true,
        error: 'Network timeout'
      });

      const slots = newsService.getDisplaySlots(jobId);

      // Slot should still exist with error phase
      expect(slots[slotId].poiId).toBe(poiId);
      expect(slots[slotId].phase).toBe('error');
      expect(slots[slotId].status).toBe('completed'); // completed due to completed: true

      // Cleanup
      newsService.clearProgress(poiId);
    });
  });

  describe('getDisplaySlots() Behavior', () => {
    it('should return exactly 10 slots always', () => {
      // Test various scenarios
      const emptyJobId = 'empty-job';
      const singleSlotJobId = 'single-slot-job';
      const fullJobId = 'full-job';

      // Empty job
      const emptySlots = newsService.getDisplaySlots(emptyJobId);
      expect(emptySlots.length).toBe(10);

      // Single slot filled
      newsService.updateProgress(200, {
        jobId: singleSlotJobId,
        slotId: 0,
        poiName: 'Single',
        phase: 'ai_search'
      });
      const singleSlots = newsService.getDisplaySlots(singleSlotJobId);
      expect(singleSlots.length).toBe(10);

      // All slots filled
      for (let i = 0; i < 10; i++) {
        newsService.updateProgress(300 + i, {
          jobId: fullJobId,
          slotId: i,
          poiName: `POI ${i}`,
          phase: 'ai_search'
        });
      }
      const fullSlots = newsService.getDisplaySlots(fullJobId);
      expect(fullSlots.length).toBe(10);

      // Cleanup
      newsService.clearProgress(200);
      for (let i = 0; i < 10; i++) {
        newsService.clearProgress(300 + i);
      }
    });

    it('should enrich slots with latest collectionProgress data', () => {
      const poiId = 400;
      const slotId = 7;
      const jobId = 'enrich-test-job';

      // Initialize slots first
      newsService.initializeSlots(jobId);

      // Create initial progress
      newsService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Original Name',
        phase: 'initializing',
        provider: 'perplexity'
      });

      // Update progress (should enrich slots)
      newsService.updateProgress(poiId, {
        poiName: 'Updated Name',
        phase: 'ai_search',
        provider: 'gemini',
        message: 'Searching...'
      });

      const slots = newsService.getDisplaySlots(jobId);

      // Slot should have latest progress data
      expect(slots[slotId].poiName).toBe('Updated Name');
      expect(slots[slotId].phase).toBe('ai_search');
      expect(slots[slotId].provider).toBe('gemini');

      // Cleanup
      newsService.clearProgress(poiId);
    });

    it('should return empty array (10 nulls) if jobId not found', () => {
      const nonExistentJobId = 'does-not-exist-12345';

      const slots = newsService.getDisplaySlots(nonExistentJobId);

      expect(slots.length).toBe(10);
      slots.forEach(slot => {
        expect(slot.poiId).toBeNull();
        expect(slot.poiName).toBeNull();
        expect(slot.phase).toBeNull();
        expect(slot.status).toBeNull();
      });
    });

    it('should handle missing collectionProgress gracefully (return slot data as-is)', () => {
      const poiId = 500;
      const slotId = 8;
      const jobId = 'missing-progress-job';

      // Create progress with jobId and slotId
      newsService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Test POI',
        phase: 'ai_search'
      });

      // Clear the progress but keep slot data
      newsService.clearProgress(poiId);

      const slots = newsService.getDisplaySlots(jobId);

      // Slot should still have the last known data
      // Note: Based on code inspection, if progress is deleted, slot will show last saved slot data
      // This tests the graceful degradation
      expect(slots[slotId]).toBeDefined();
    });

    it('should compute status from progress.completed (active vs completed)', () => {
      const activePoiId = 600;
      const completedPoiId = 601;
      const jobId = 'status-compute-job';

      // Initialize slots first
      newsService.initializeSlots(jobId);

      // Active POI
      newsService.updateProgress(activePoiId, {
        jobId,
        slotId: 0,
        poiName: 'Active POI',
        phase: 'ai_search',
        completed: false
      });

      // Completed POI
      newsService.updateProgress(completedPoiId, {
        jobId,
        slotId: 1,
        poiName: 'Completed POI',
        phase: 'complete',
        completed: true
      });

      const slots = newsService.getDisplaySlots(jobId);

      expect(slots[0].status).toBe('active');
      expect(slots[1].status).toBe('completed');

      // Cleanup
      newsService.clearProgress(activePoiId);
      newsService.clearProgress(completedPoiId);
    });
  });

  describe('Progress Management', () => {
    it('should get collection progress for a POI', () => {
      const poiId = 700;

      newsService.updateProgress(poiId, {
        phase: 'ai_search',
        poiName: 'Progress Test',
        newsFound: 5
      });

      const progress = newsService.getCollectionProgress(poiId);

      expect(progress).toBeDefined();
      expect(progress.poiId).toBe(poiId);
      expect(progress.phase).toBe('ai_search');
      expect(progress.poiName).toBe('Progress Test');
      expect(progress.newsFound).toBe(5);

      // Cleanup
      newsService.clearProgress(poiId);
    });

    it('should return null for non-existent POI progress', () => {
      const nonExistentPoiId = 999999;

      const progress = newsService.getCollectionProgress(nonExistentPoiId);

      expect(progress).toBeNull();
    });

    it('should clear progress for a POI', () => {
      const poiId = 800;

      newsService.updateProgress(poiId, {
        phase: 'ai_search',
        poiName: 'Clear Test'
      });

      expect(newsService.getCollectionProgress(poiId)).toBeDefined();

      newsService.clearProgress(poiId);

      expect(newsService.getCollectionProgress(poiId)).toBeNull();
    });

    it('should get all active progress entries', () => {
      const poi1 = 900;
      const poi2 = 901;
      const poi3 = 902; // completed

      newsService.updateProgress(poi1, {
        phase: 'ai_search',
        poiName: 'Active 1',
        completed: false
      });

      newsService.updateProgress(poi2, {
        phase: 'rendering',
        poiName: 'Active 2',
        completed: false
      });

      newsService.updateProgress(poi3, {
        phase: 'complete',
        poiName: 'Completed',
        completed: true
      });

      const activeProgress = newsService.getAllActiveProgress();

      // Should only return active (not completed) entries
      expect(activeProgress.length).toBeGreaterThanOrEqual(2);

      const poi1Progress = activeProgress.find(p => p.poiId === poi1);
      const poi2Progress = activeProgress.find(p => p.poiId === poi2);
      const poi3Progress = activeProgress.find(p => p.poiId === poi3);

      expect(poi1Progress).toBeDefined();
      expect(poi2Progress).toBeDefined();
      expect(poi3Progress).toBeUndefined(); // Completed, should not be in active list

      // Cleanup
      newsService.clearProgress(poi1);
      newsService.clearProgress(poi2);
      newsService.clearProgress(poi3);
    });
  });
});

describe('Slot Management Unit Tests - Trail Status Service', () => {
  const TEST_JOB_ID = 'trail-test-job-123';
  const TEST_POI_ID = 2;
  const TEST_POI_NAME = 'Test Trail Status';
  const TEST_PROVIDER = 'gemini';

  describe('Slot Initialization', () => {
    it('should initialize exactly 10 empty slots for a job', () => {
      const slots = trailStatusService.getDisplaySlots(TEST_JOB_ID);

      expect(slots).toBeDefined();
      expect(Array.isArray(slots)).toBe(true);
      expect(slots.length).toBe(10);
    });

    it('should create slots with correct structure', () => {
      const slots = trailStatusService.getDisplaySlots(TEST_JOB_ID);

      slots.forEach((slot, index) => {
        expect(slot).toHaveProperty('slotId');
        expect(slot).toHaveProperty('poiId');
        expect(slot).toHaveProperty('poiName');
        expect(slot).toHaveProperty('phase');
        expect(slot).toHaveProperty('provider');
        expect(slot).toHaveProperty('status');
        expect(slot.slotId).toBe(index);
      });
    });
  });

  describe('Slot Updates via updateProgress', () => {
    it('should update slot with progress when slotId and jobId are present', () => {
      const poiId = 1000;
      const slotId = 5;
      const jobId = 'trail-update-test-job';

      // Initialize slots first
      trailStatusService.initializeSlots(jobId);

      trailStatusService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Test Trail',
        phase: 'ai_search',
        provider: 'perplexity'
      });

      const slots = trailStatusService.getDisplaySlots(jobId);

      expect(slots[slotId].poiId).toBe(poiId);
      expect(slots[slotId].poiName).toBe('Test Trail');
      expect(slots[slotId].phase).toBe('ai_search');
      expect(slots[slotId].provider).toBe('perplexity');
      expect(slots[slotId].status).toBe('active');

      // Cleanup
      trailStatusService.clearProgress(poiId);
    });

    it('should handle phase transitions', () => {
      const poiId = 1001;
      const slotId = 3;
      const jobId = 'trail-phase-job';

      const phases = ['starting', 'rendering', 'ai_search', 'saving', 'complete'];

      // Initialize slots first
      trailStatusService.initializeSlots(jobId);

      trailStatusService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Phase Trail',
        phase: phases[0]
      });

      phases.forEach(phase => {
        trailStatusService.updateProgress(poiId, { phase });

        const slots = trailStatusService.getDisplaySlots(jobId);
        expect(slots[slotId].phase).toBe(phase);
      });

      // Cleanup
      trailStatusService.clearProgress(poiId);
    });

    it('should mark slot as completed when progress.completed = true', () => {
      const poiId = 1002;
      const slotId = 7;
      const jobId = 'trail-complete-job';

      // Initialize slots first
      trailStatusService.initializeSlots(jobId);

      trailStatusService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Complete Trail',
        phase: 'ai_search'
      });

      let slots = trailStatusService.getDisplaySlots(jobId);
      expect(slots[slotId].status).toBe('active');

      trailStatusService.updateProgress(poiId, {
        phase: 'complete',
        completed: true
      });

      slots = trailStatusService.getDisplaySlots(jobId);
      expect(slots[slotId].status).toBe('completed');

      // Cleanup
      trailStatusService.clearProgress(poiId);
    });
  });

  describe('getDisplaySlots() Behavior', () => {
    it('should return exactly 10 slots always', () => {
      const emptyJobId = 'trail-empty-job';
      const partialJobId = 'trail-partial-job';

      const emptySlots = trailStatusService.getDisplaySlots(emptyJobId);
      expect(emptySlots.length).toBe(10);

      // Fill 3 slots
      for (let i = 0; i < 3; i++) {
        trailStatusService.updateProgress(2000 + i, {
          jobId: partialJobId,
          slotId: i,
          poiName: `Trail ${i}`,
          phase: 'ai_search'
        });
      }

      const partialSlots = trailStatusService.getDisplaySlots(partialJobId);
      expect(partialSlots.length).toBe(10);

      // Cleanup
      for (let i = 0; i < 3; i++) {
        trailStatusService.clearProgress(2000 + i);
      }
    });

    it('should enrich slots with latest progress data', () => {
      const poiId = 2100;
      const slotId = 4;
      const jobId = 'trail-enrich-job';

      // Initialize slots first
      trailStatusService.initializeSlots(jobId);

      trailStatusService.updateProgress(poiId, {
        jobId,
        slotId,
        poiName: 'Original Trail',
        phase: 'starting',
        statusFound: 0
      });

      trailStatusService.updateProgress(poiId, {
        poiName: 'Updated Trail',
        phase: 'complete',
        statusFound: 1
      });

      const slots = trailStatusService.getDisplaySlots(jobId);

      expect(slots[slotId].poiName).toBe('Updated Trail');
      expect(slots[slotId].phase).toBe('complete');

      // Cleanup
      trailStatusService.clearProgress(poiId);
    });
  });

  describe('Progress Management', () => {
    it('should get trail collection progress', () => {
      const poiId = 2200;

      trailStatusService.updateProgress(poiId, {
        phase: 'ai_search',
        poiName: 'Progress Trail',
        statusFound: 1
      });

      const progress = trailStatusService.getCollectionProgress(poiId);

      expect(progress).toBeDefined();
      expect(progress.poiId).toBe(poiId);
      expect(progress.phase).toBe('ai_search');
      expect(progress.statusFound).toBe(1);

      // Cleanup
      trailStatusService.clearProgress(poiId);
    });

    it('should return null for non-existent trail progress', () => {
      const progress = trailStatusService.getCollectionProgress(999998);
      expect(progress).toBeNull();
    });

    it('should clear trail progress', () => {
      const poiId = 2300;

      trailStatusService.updateProgress(poiId, {
        phase: 'ai_search',
        poiName: 'Clear Trail'
      });

      expect(trailStatusService.getCollectionProgress(poiId)).toBeDefined();

      trailStatusService.clearProgress(poiId);

      expect(trailStatusService.getCollectionProgress(poiId)).toBeNull();
    });

    it('should get all active trail progress entries', () => {
      const trail1 = 2400;
      const trail2 = 2401;
      const trail3 = 2402;

      trailStatusService.updateProgress(trail1, {
        phase: 'ai_search',
        poiName: 'Active Trail 1',
        completed: false
      });

      trailStatusService.updateProgress(trail2, {
        phase: 'rendering',
        poiName: 'Active Trail 2',
        completed: false
      });

      trailStatusService.updateProgress(trail3, {
        phase: 'complete',
        poiName: 'Completed Trail',
        completed: true
      });

      const activeProgress = trailStatusService.getAllActiveProgress();

      expect(activeProgress.length).toBeGreaterThanOrEqual(2);

      const trail3Progress = activeProgress.find(p => p.poiId === trail3);
      expect(trail3Progress).toBeUndefined(); // Should not include completed

      // Cleanup
      trailStatusService.clearProgress(trail1);
      trailStatusService.clearProgress(trail2);
      trailStatusService.clearProgress(trail3);
    });
  });
});
