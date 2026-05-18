export class CollectionTracker {
  constructor(label) {
    this.label = label;
    this.collectionProgress = new Map();
    this.jobDisplaySlots = new Map();
  }

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

    if (updates.phase && updates.phase !== current.phase && current.phase !== 'starting') {
      const phaseHistory = [...(current.phaseHistory || [])];
      if (!phaseHistory.includes(current.phase)) {
        phaseHistory.push(current.phase);
      }
      updates.phaseHistory = phaseHistory;
    }

    const updated = { ...current, ...updates, poiId, lastUpdate: Date.now() };
    this.collectionProgress.set(poiId, updated);

    if (updated.slotId !== null && updated.slotId !== undefined && updated.jobId) {
      this._updateSlotFromProgress(updated.jobId, updated.slotId, updated);
    }

    return updated;
  }

  getCollectionProgress(poiId) {
    return this.collectionProgress.get(poiId) || null;
  }

  clearProgress(poiId) {
    this.collectionProgress.delete(poiId);
  }

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

  initializeSlots(jobId, count = 10) {
    const slots = Array(count).fill(null).map((_, i) => ({
      slotId: i,
      poiId: null,
      poiName: null,
      phase: null,
      provider: null,
      status: null
    }));
    this.jobDisplaySlots.set(jobId, slots);
    console.log(`[${this.label} Job ${jobId}] Initialized ${count} display slots`);
  }

  findFirstAvailableSlot(jobId) {
    const slots = this.jobDisplaySlots.get(jobId);
    // Fix: return null (not 0) when uninitialized to avoid overwriting slot 0 (PR #168 review)
    if (!slots) return null;

    const availableIndex = slots.findIndex(slot =>
      !slot.poiId || slot.status === 'completed'
    );

    return availableIndex >= 0 ? availableIndex : null;
  }

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

  getDisplaySlots(jobId) {
    const slots = this.jobDisplaySlots.get(jobId);
    if (!slots) {
      return [];
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

  clearDisplaySlots(jobId) {
    this.jobDisplaySlots.delete(jobId);
    console.log(`[${this.label} Job ${jobId}] Cleared display slots`);
  }

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

  isCancellationRequested(poiId) {
    const progress = this.collectionProgress.get(poiId);
    return progress?.cancellationRequested === true;
  }
}
