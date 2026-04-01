/**
 * CollectionTracker — shared progress + display slot state management
 *
 * Each collection type (news, trail status, etc.) gets its own instance
 * so they can run concurrently without interference. Extracted from
 * duplicated code in newsService.js and trailStatusService.js.
 */

export class CollectionTracker {
  /**
   * @param {string} label - Log prefix label (e.g. 'News', 'Trail')
   */
  constructor(label) {
    this.label = label;
    this.collectionProgress = new Map();
    this.jobDisplaySlots = new Map();
  }

  /**
   * Update collection progress for a POI/trail
   */
  updateProgress(poiId, updates) {
    const current = this.collectionProgress.get(poiId) || {
      phase: 'starting',
      message: 'Initializing...',
      startTime: Date.now(),
      steps: [],
      phaseHistory: [],
      slotId: null,
      jobId: null
    };

    // Track phase transitions — add previous phase to history when phase changes
    if (updates.phase && updates.phase !== current.phase && current.phase !== 'starting') {
      const phaseHistory = [...(current.phaseHistory || [])];
      if (!phaseHistory.includes(current.phase)) {
        phaseHistory.push(current.phase);
      }
      updates.phaseHistory = phaseHistory;
    }

    const updated = { ...current, ...updates, poiId, lastUpdate: Date.now() };
    this.collectionProgress.set(poiId, updated);

    // Update display slot if slotId and jobId are present
    if (updated.slotId !== null && updated.slotId !== undefined && updated.jobId) {
      this._updateSlotFromProgress(updated.jobId, updated.slotId, updated);
    }

    return updated;
  }

  /**
   * Get collection progress for a POI
   */
  getCollectionProgress(poiId) {
    return this.collectionProgress.get(poiId) || null;
  }

  /**
   * Clear collection progress for a POI
   */
  clearProgress(poiId) {
    this.collectionProgress.delete(poiId);
  }

  /**
   * Get all active (non-completed) progress entries
   */
  getAllActiveProgress() {
    const active = [];
    for (const [poiId, progress] of this.collectionProgress.entries()) {
      if (!progress.completed) {
        active.push({
          poiId,
          phase: progress.phase,
          message: progress.message,
          poiName: progress.poiName,
          provider: progress.provider || null
        });
      }
    }
    return active;
  }

  /**
   * Initialize 10 display slots for a job
   */
  initializeSlots(jobId) {
    const slots = Array(10).fill(null).map((_, i) => ({
      slotId: i,
      poiId: null,
      poiName: null,
      phase: null,
      provider: null,
      status: null
    }));
    this.jobDisplaySlots.set(jobId, slots);
    console.log(`[${this.label} Job ${jobId}] Initialized 10 display slots`);
  }

  /**
   * Find the first available slot (null or completed)
   * Returns slot index 0-9
   */
  findFirstAvailableSlot(jobId) {
    const slots = this.jobDisplaySlots.get(jobId);
    if (!slots) return 0;

    const availableIndex = slots.findIndex(slot =>
      !slot.poiId || slot.status === 'completed'
    );

    return availableIndex >= 0 ? availableIndex : 0;
  }

  /**
   * Assign a POI to a display slot
   * Immediately replaces any old data to prevent stale "completed" status flicker
   */
  assignPoiToSlot(jobId, slotId, poiId, poiName, provider) {
    const slots = this.jobDisplaySlots.get(jobId);
    if (!slots) return;

    slots[slotId] = {
      slotId,
      poiId,
      poiName,
      phase: 'initializing',
      provider,
      status: 'active'
    };

    console.log(`[${this.label} Job ${jobId}] Assigned POI ${poiId} (${poiName}) to Slot ${slotId}`);
  }

  /**
   * Update slot with current progress data (internal)
   */
  _updateSlotFromProgress(jobId, slotId, progress) {
    const slots = this.jobDisplaySlots.get(jobId);
    if (!slots || slotId === undefined || slotId === null) return;

    slots[slotId] = {
      slotId,
      poiId: progress.poiId || slots[slotId].poiId,
      poiName: progress.poiName || slots[slotId].poiName,
      phase: progress.phase,
      provider: progress.provider,
      status: progress.completed ? 'completed' : 'active'
    };
  }

  /**
   * Get current display slots for a job
   * Returns exactly 10 slots enriched with latest progress data
   */
  getDisplaySlots(jobId) {
    const slots = this.jobDisplaySlots.get(jobId);
    if (!slots) {
      return Array(10).fill(null).map((_, i) => ({
        slotId: i,
        poiId: null,
        poiName: null,
        phase: null,
        provider: null,
        status: null
      }));
    }

    return slots.map(slot => {
      if (!slot.poiId) return slot;

      const progress = this.collectionProgress.get(slot.poiId);
      if (!progress) return slot;

      return {
        slotId: slot.slotId,
        poiId: slot.poiId,
        poiName: progress.poiName || slot.poiName,
        phase: progress.phase,
        provider: progress.provider,
        status: progress.completed ? 'completed' : 'active'
      };
    });
  }

  /**
   * Clear display slots when job completes
   */
  clearDisplaySlots(jobId) {
    this.jobDisplaySlots.delete(jobId);
    console.log(`[${this.label} Job ${jobId}] Cleared display slots`);
  }

  /**
   * Request cancellation of an ongoing collection job
   * @returns {boolean} true if cancellation was requested
   */
  requestCancellation(poiId) {
    const progress = this.collectionProgress.get(poiId);
    if (progress && !progress.completed) {
      this.updateProgress(poiId, {
        cancellationRequested: true,
        message: 'Cancellation requested...'
      });
      console.log(`[${this.label}] Cancellation requested for POI ${poiId}`);
      return true;
    }
    return false;
  }

  /**
   * Check if cancellation has been requested for a POI
   */
  isCancellationRequested(poiId) {
    const progress = this.collectionProgress.get(poiId);
    return progress?.cancellationRequested === true;
  }
}
