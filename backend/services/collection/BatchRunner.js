/**
 * BatchRunner — semaphore-based batch execution engine
 *
 * Runs a collection of items through a processing function with:
 * - Staggered dispatch (prevents API rate limiting)
 * - Semaphore-based concurrency limiting (MAX_CONCURRENCY)
 * - Per-item checkpointing for crash recovery
 * - Cancellation support via CollectionTracker
 *
 * Extracted from identical patterns in newsService.js and trailStatusService.js.
 */

import { logInfo, logError } from '../jobLogger.js';

/**
 * Run a batch of items through a collection function with concurrency control.
 *
 * @param {Object} options
 * @param {Object}   options.pool           - Database connection pool
 * @param {string|number} options.jobId     - Job ID for logging and checkpointing
 * @param {Array}    options.items          - Items to process (POIs, trails, etc.)
 * @param {Object}   options.tracker        - CollectionTracker instance
 * @param {Function} options.collectFn      - async (item, { slotId, jobId, index, total }) => result
 *                                            Called for each item. Should return a result object.
 *                                            Throwing an error marks the item as failed but continues.
 * @param {Function} options.checkpointFn   - async (item, result, error) => void
 *                                            Called after each item (success or failure) to save progress.
 * @param {Function} [options.onItemStart]  - async (item, { slotId, jobId, index, total }) => void
 *                                            Called before collectFn. Use for slot assignment, progress init.
 * @param {Function} [options.checkCancelled] - async () => boolean
 *                                              Called before starting each new item. Return true to stop.
 * @param {string}   options.label          - Collection type label for logging ('news', 'trail_status')
 * @param {number}   [options.maxConcurrency=10]   - Max concurrent items
 * @param {number}   [options.dispatchInterval=1500] - ms between starting new items
 * @returns {Promise<{ results: Array, cancelled: boolean }>}
 */
export async function runBatch({
  pool,
  jobId,
  items,
  tracker,
  collectFn,
  checkpointFn,
  onItemStart,
  checkCancelled,
  label,
  maxConcurrency = 10,
  dispatchInterval = 1500
}) {
  const results = [];
  let cancelled = false;

  if (items.length === 0) {
    return { results, cancelled: false };
  }

  let inFlight = 0;
  let nextIndex = 0;
  let resolveAll;
  const allDone = new Promise(resolve => { resolveAll = resolve; });

  const processNext = async () => {
    // Check cancellation before starting a new item
    if (cancelled) {
      if (inFlight === 0) resolveAll();
      return;
    }

    if (checkCancelled) {
      const shouldCancel = await checkCancelled();
      if (shouldCancel) {
        cancelled = true;
        console.log(`[${label} Job ${jobId}] Cancellation detected, stopping new item processing`);
        if (inFlight === 0) resolveAll();
        return;
      }
    }

    if (nextIndex >= items.length) {
      if (inFlight === 0) resolveAll();
      return;
    }

    const index = nextIndex++;
    const item = items[index];
    inFlight++;

    // Find available slot and notify caller
    const slotId = tracker.findFirstAvailableSlot(jobId);
    const context = { slotId, jobId, index, total: items.length };

    if (onItemStart) {
      try {
        await onItemStart(item, context);
      } catch (err) {
        console.error(`[${label} Job ${jobId}] onItemStart error for item ${index}:`, err.message);
      }
    }

    try {
      console.log(`[${label} Job ${jobId}] [${index + 1}/${items.length}] Starting (Slot ${slotId}, ${inFlight} in flight)`);

      const result = await collectFn(item, context);
      results.push({ item, result, success: true });

      // Checkpoint success
      await checkpointFn(item, result, null);
    } catch (error) {
      console.error(`[${label} Job ${jobId}] [${index + 1}/${items.length}] Error: ${error.message}`);
      results.push({ item, result: null, success: false, error: error.message });

      // Checkpoint failure
      await checkpointFn(item, null, error);
    }

    inFlight--;

    // Start next item with delay when a slot opens
    if (cancelled) {
      if (inFlight === 0) resolveAll();
    } else if (nextIndex < items.length && inFlight < maxConcurrency) {
      setTimeout(() => processNext(), dispatchInterval);
    } else if (nextIndex >= items.length && inFlight === 0) {
      resolveAll();
    }
  };

  // Start initial batch with staggered dispatch
  const initialBatch = Math.min(maxConcurrency, items.length);
  for (let i = 0; i < initialBatch; i++) {
    setTimeout(() => processNext(), i * dispatchInterval);
  }

  // Wait for all to complete
  await allDone;

  return { results, cancelled };
}
