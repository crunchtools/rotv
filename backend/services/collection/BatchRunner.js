import { logInfo, logError } from '../jobLogger.js';

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

    const slotId = tracker.findFirstAvailableSlot(jobId);
    if (slotId === null) {
      console.warn(`[${label} Job ${jobId}] No available display slot for item ${index} — all ${maxConcurrency} slots occupied`);
    }
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

      await checkpointFn(item, result, null);
    } catch (error) {
      console.error(`[${label} Job ${jobId}] [${index + 1}/${items.length}] Error: ${error.message}`);
      results.push({ item, result: null, success: false, error: error.message });

      await checkpointFn(item, null, error);
    }

    inFlight--;

    if (cancelled) {
      if (inFlight === 0) resolveAll();
    } else if (nextIndex < items.length && inFlight < maxConcurrency) {
      setTimeout(() => processNext(), dispatchInterval);
    } else if (nextIndex >= items.length && inFlight === 0) {
      resolveAll();
    }
  };

  const initialBatch = Math.min(maxConcurrency, items.length);
  for (let i = 0; i < initialBatch; i++) {
    setTimeout(() => processNext(), i * dispatchInterval);
  }

  await allDone;

  return { results, cancelled };
}
