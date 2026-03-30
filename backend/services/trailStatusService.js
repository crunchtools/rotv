/**
 * Trail Status Collection Service
 * Renders configured status_url with Playwright, extracts content, feeds to Gemini for status extraction.
 *
 * Job execution is managed by pg-boss for crash recovery and resumability.
 * Progress is checkpointed after each trail so jobs can resume after container restarts.
 */

import { generateTextWithCustomPrompt } from './geminiService.js';
import { extractPageContent } from './contentExtractor.js';

// Dispatch interval: start one new trail job every N milliseconds
const DISPATCH_INTERVAL_MS = 1500;
// Maximum number of concurrent jobs in flight
const MAX_CONCURRENCY = 10;

// In-memory progress tracking for active collections
const collectionProgress = new Map();

// Job display slots: jobId -> [10 slots]
// Each slot represents a display position for trail progress
const jobDisplaySlots = new Map();

/**
 * Update collection progress for a trail
 */
export function updateProgress(poiId, updates) {
  const current = collectionProgress.get(poiId) || {
    phase: 'starting',
    message: 'Initializing...',
    statusFound: 0,
    startTime: Date.now(),
    steps: [],
    slotId: null,
    jobId: null
  };

  const updated = { ...current, ...updates, poiId, lastUpdate: Date.now() };
  collectionProgress.set(poiId, updated);

  // Update display slot if slotId and jobId are present
  if (updated.slotId !== null && updated.slotId !== undefined && updated.jobId) {
    updateSlotFromProgress(updated.jobId, updated.slotId, updated);
  }

  return updated;
}

/**
 * Get collection progress for a trail
 */
export function getCollectionProgress(poiId) {
  return collectionProgress.get(poiId) || null;
}

/**
 * Clear collection progress for a trail
 */
export function clearProgress(poiId) {
  collectionProgress.delete(poiId);
}

/**
 * Get all active progress entries (for job status display)
 * Returns the current phase(s) being processed
 */
export function getAllActiveProgress() {
  const active = [];
  for (const [poiId, progress] of collectionProgress.entries()) {
    if (!progress.completed) {
      const job = {
        poiId,
        phase: progress.phase,
        message: progress.message,
        poiName: progress.poiName,
        provider: progress.provider || null
      };
      console.log(`[Trail getAllActiveProgress] POI ${poiId}: provider=${progress.provider}, phase=${progress.phase}`);
      active.push(job);
    }
  }
  return active;
}

/**
 * Initialize display slots for a job
 * Creates 10 empty slots that will be filled as trails are dispatched
 * Exported for testing purposes
 */
export function initializeSlots(jobId) {
  const slots = Array(10).fill(null).map((_, i) => ({
    slotId: i,
    poiId: null,
    poiName: null,
    phase: null,
    provider: null,
    status: null
  }));
  jobDisplaySlots.set(jobId, slots);
  console.log(`[Trail Job ${jobId}] Initialized 10 display slots`);
}

/**
 * Find the first available slot (null or completed)
 * Returns slot index 0-9
 */
function findFirstAvailableSlot(jobId) {
  const slots = jobDisplaySlots.get(jobId);
  if (!slots) return 0;

  const availableIndex = slots.findIndex(slot =>
    !slot.poiId || slot.status === 'completed'
  );

  return availableIndex >= 0 ? availableIndex : 0;
}

/**
 * Assign a trail to a display slot
 * IMPORTANT: This immediately replaces any old job data with new job data
 * to prevent the frontend from briefly displaying old "completed" status
 */
function assignPoiToSlot(jobId, slotId, poiId, poiName, provider) {
  const slots = jobDisplaySlots.get(jobId);
  if (!slots) return;

  // Immediately replace slot data (don't let old completed status linger)
  slots[slotId] = {
    slotId,
    poiId,
    poiName,
    phase: 'initializing',
    provider,
    status: 'active'  // Force active status immediately
  };

  console.log(`[Trail Job ${jobId}] Assigned trail ${poiId} (${poiName}) to Slot ${slotId}`);
}

/**
 * Update slot with current progress data
 */
function updateSlotFromProgress(jobId, slotId, progress) {
  const slots = jobDisplaySlots.get(jobId);
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
 * Returns exactly 10 slots with latest progress data
 */
export function getDisplaySlots(jobId) {
  const slots = jobDisplaySlots.get(jobId);
  if (!slots) {
    // Return 10 empty slots if job not found
    return Array(10).fill(null).map((_, i) => ({
      slotId: i,
      poiId: null,
      poiName: null,
      phase: null,
      provider: null,
      status: null
    }));
  }

  // Enrich each slot with latest progress data
  return slots.map(slot => {
    if (!slot.poiId) return slot;

    const progress = collectionProgress.get(slot.poiId);
    if (!progress) {
      // Progress not found - use slot data as-is
      // This can happen briefly when a new trail is assigned but progress hasn't been created yet
      return slot;
    }

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
function clearDisplaySlots(jobId) {
  jobDisplaySlots.delete(jobId);
  console.log(`[Trail Job ${jobId}] Cleared display slots`);
}

/**
 * Request cancellation of an ongoing collection job
 */
export function requestCancellation(poiId) {
  const progress = collectionProgress.get(poiId);
  if (progress && !progress.completed) {
    updateProgress(poiId, {
      cancellationRequested: true,
      message: 'Cancellation requested...'
    });
    console.log(`[Trail Status] Cancellation requested for trail ${poiId}`);
    return true;
  }
  return false;
}

/**
 * Check if cancellation has been requested for a trail
 */
export function isCancellationRequested(poiId) {
  const progress = collectionProgress.get(poiId);
  return progress?.cancellationRequested === true;
}

// Prompt template for trail status extraction from rendered page content
const TRAIL_STATUS_PROMPT = `You are a trail status extractor. Extract the current mountain bike trail status from the following page content.

Trail: "{{name}}"
Trail System: {{trailSystem}}
Today's date: {{currentDate}}
Timezone: {{timezone}}

PAGE CONTENT FROM {{statusUrl}}:
{{renderedContent}}

INSTRUCTIONS:
- Find ALL posts or status indicators that mention trail status, conditions, or closures
- This is the official trail status source - ANY post about trail conditions IS about "{{name}}"
- Check the DATE of each post - look for timestamps, dates, or relative times (e.g., "2h ago", "Jan 14")
- IGNORE posts older than 180 days
- Select the MOST RECENT post within the allowed date range
- Common trail status phrases: "trail is open", "trail is closed", "open for riding", "closed due to", "muddy", "dry"
- Return ALL dates/times in ISO 8601 format: YYYY-MM-DD HH:MM:SS (in {{timezone}})

Return ONLY valid JSON with this exact structure:
{
  "status": {
    "status": "open|closed|limited|maintenance|unknown",
    "conditions": "Brief description of current trail conditions, or null",
    "last_updated": "YYYY-MM-DD HH:MM:SS in ISO 8601 format, or null if unknown",
    "source_name": "Source name (e.g., IMBA Trail Forks, Summit Metro Parks)",
    "source_url": "{{statusUrl}}",
    "weather_impact": "Weather-related impacts (e.g., 'Muddy after rain', 'Snow covered'), or null",
    "seasonal_closure": true|false
  }
}

If you cannot find current status, return: {"status": {"status": "unknown", "conditions": null, "last_updated": null, "source_name": null, "source_url": null, "weather_impact": null, "seasonal_closure": false}}`;

/**
 * Collect trail status for a specific trail by rendering its status_url and extracting with Gemini.
 * @param {Pool} pool - Database connection pool
 * @param {Object} poi - POI object with id, name, brief_description, status_url
 * @param {Object} sheets - Optional sheets client for API key restore
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {Object} - { statusFound: number, statusSaved: number }
 */
export async function collectTrailStatus(pool, poi, sheets = null, timezone = 'America/New_York') {
  console.log(`\n[Trail Status] ======== Collecting status for: ${poi.name} ========`);

  // Skip POIs without a configured status_url
  if (!poi.status_url || !poi.status_url.trim()) {
    console.log(`[Trail Status] No status_url configured, skipping`);
    updateProgress(poi.id, {
      phase: 'complete',
      message: 'No status URL configured',
      completed: true,
      statusFound: 0
    });
    return { statusFound: 0, statusSaved: 0 };
  }

  // Preserve slotId and jobId if they exist (set by job processing loop)
  const existingProgress = collectionProgress.get(poi.id);
  const slotId = existingProgress?.slotId;
  const jobId = existingProgress?.jobId;

  updateProgress(poi.id, {
    phase: 'starting',
    message: 'Initializing trail status collection...',
    steps: ['Initialized'],
    poiName: poi.name,
    provider: 'gemini',
    slotId,
    jobId
  });

  const trailSystem = poi.trail_system || 'Unknown system';
  const statusUrl = poi.status_url;

  try {
    // Check for cancellation before starting
    if (isCancellationRequested(poi.id)) {
      console.log(`[Trail Status] Cancellation requested, aborting`);
      updateProgress(poi.id, {
        phase: 'cancelled',
        message: 'Collection cancelled',
        completed: true,
        cancelled: true
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    // Load cookies for authenticated sites (Twitter/X)
    let cookies = null;
    if (statusUrl.includes('x.com') || statusUrl.includes('twitter.com')) {
      try {
        const cookieResult = await pool.query(
          `SELECT value FROM admin_settings WHERE key = 'twitter_cookies'`
        );
        if (cookieResult.rows.length > 0 && cookieResult.rows[0].value) {
          cookies = JSON.parse(cookieResult.rows[0].value);
          console.log(`[Trail Status] Loaded ${cookies.length} Twitter cookies`);
        }
      } catch (cookieErr) {
        console.log(`[Trail Status] No Twitter cookies available: ${cookieErr.message}`);
      }
    }

    // Render status page with Playwright + Readability
    console.log(`[Trail Status] Rendering status page: ${statusUrl}`);
    updateProgress(poi.id, {
      phase: 'rendering',
      message: 'Rendering status page...',
      steps: ['Initialized', 'Rendering page']
    });

    const rendered = await extractPageContent(statusUrl, {
      maxLength: 15000,
      dynamicContentWait: 3000,
      cookies
    });

    if (!rendered.reachable || !rendered.markdown) {
      console.log(`[Trail Status] Page not reachable or no content extracted (reason: ${rendered.reason || 'unknown'})`);
      updateProgress(poi.id, {
        phase: 'complete',
        message: `Page not reachable: ${rendered.reason || 'no content'}`,
        completed: true,
        statusFound: 0,
        steps: ['Initialized', 'Rendering failed', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    const MIN_CONTENT_LENGTH = 200;
    if (rendered.markdown.length < MIN_CONTENT_LENGTH) {
      console.log(`[Trail Status] Insufficient content (${rendered.markdown.length} chars, need ${MIN_CONTENT_LENGTH}+)`);
      updateProgress(poi.id, {
        phase: 'complete',
        message: 'Insufficient page content',
        completed: true,
        statusFound: 0,
        steps: ['Initialized', 'Rendering insufficient', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    console.log(`[Trail Status] Rendered page (${rendered.markdown.length} chars)`);

    // Check for cancellation after rendering
    if (isCancellationRequested(poi.id)) {
      console.log(`[Trail Status] Cancellation requested after rendering, aborting`);
      updateProgress(poi.id, {
        phase: 'cancelled',
        message: 'Collection cancelled',
        completed: true,
        cancelled: true
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    // Build Gemini prompt with rendered content
    updateProgress(poi.id, {
      phase: 'ai_extraction',
      message: 'Extracting status with Gemini...',
      steps: ['Initialized', 'Rendered', 'Extracting']
    });

    const currentDate = new Date().toISOString().split('T')[0];
    const prompt = TRAIL_STATUS_PROMPT
      .replace(/\{\{currentDate\}\}/g, currentDate)
      .replace(/\{\{name\}\}/g, poi.name)
      .replace(/\{\{trailSystem\}\}/g, trailSystem)
      .replace(/\{\{statusUrl\}\}/g, statusUrl)
      .replace(/\{\{timezone\}\}/g, timezone)
      .replace(/\{\{renderedContent\}\}/g, rendered.markdown);

    console.log(`[Trail Status] Extracting status with Gemini (${prompt.length} char prompt)...`);
    const response = await generateTextWithCustomPrompt(pool, prompt, null, { useSearchGrounding: false });

    console.log(`[Trail Status] Received response (${response.length} chars)`);

    // Check for cancellation after AI search
    if (isCancellationRequested(poi.id)) {
      console.log(`[Trail Status] Cancellation requested after extraction, aborting`);
      updateProgress(poi.id, {
        phase: 'cancelled',
        message: 'Collection cancelled',
        completed: true,
        cancelled: true
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Trail Status] No JSON found in response');
      updateProgress(poi.id, {
        phase: 'complete',
        message: 'No status found',
        completed: true,
        steps: ['Initialized', 'Rendered', 'Extracting', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    const parsedStatus = JSON.parse(jsonMatch[0]);
    const status = parsedStatus.status;

    if (!status || status.status === 'unknown') {
      console.log(`[Trail Status] No current status found for ${poi.name}`);
      updateProgress(poi.id, {
        phase: 'complete',
        message: 'No status found',
        completed: true,
        statusFound: 0,
        steps: ['Initialized', 'Rendered', 'Extracting', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    console.log(`[Trail Status] Found status: ${status.status}`);
    console.log(`[Trail Status]   Conditions: ${status.conditions || 'N/A'}`);
    console.log(`[Trail Status]   Source: ${status.source_name || 'N/A'}`);
    console.log(`[Trail Status]   Last Updated: ${status.last_updated || 'N/A'}`);

    // Override source_url with the POI's configured status_url
    status.source_url = poi.status_url;
    // Extract source name from the URL if not already set
    if (poi.status_url.includes('x.com') || poi.status_url.includes('twitter.com')) {
      status.source_name = 'Twitter/X';
    } else if (poi.status_url.includes('bsky.app')) {
      status.source_name = 'Bluesky';
    } else if (poi.status_url.includes('trailforks.com')) {
      status.source_name = 'IMBA Trail Forks';
    } else if (poi.status_url.includes('mtbproject.com')) {
      status.source_name = 'MTB Project';
    }

    // Save to database with deduplication
    updateProgress(poi.id, {
      phase: 'saving',
      message: 'Saving trail status...',
      statusFound: 1,
      steps: ['Initialized', 'Rendered', 'Extracting', 'Saving']
    });

    const saved = await saveTrailStatus(pool, poi.id, status);

    updateProgress(poi.id, {
      phase: 'complete',
      message: `Status collected: ${status.status}`,
      completed: true,
      statusFound: 1,
      statusSaved: saved ? 1 : 0,
      steps: ['Initialized', 'Rendered', 'Extracting', 'Saving', 'Complete']
    });

    return { statusFound: 1, statusSaved: saved ? 1 : 0 };

  } catch (error) {
    console.error(`[Trail Status] Error collecting status for ${poi.name}:`, error.message);
    updateProgress(poi.id, {
      phase: 'error',
      message: `Error: ${error.message}`,
      completed: true,
      error: error.message
    });
    throw error;
  }
}

/**
 * Save trail status to database with deduplication
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @param {Object} status - Status object
 * @returns {boolean} - true if new status was saved, false if duplicate
 */
async function saveTrailStatus(pool, poiId, status) {
  try {
    // Validate that last_updated is not too old (reject status older than 30 days)
    if (status.last_updated) {
      const lastUpdated = new Date(status.last_updated);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (lastUpdated < thirtyDaysAgo) {
        console.log(`[Trail Status] Skipping outdated status (last updated: ${status.last_updated})`);
        return false;
      }
    }

    // Check for recent status (last 24 hours)
    const recentResult = await pool.query(`
      SELECT * FROM trail_status
      WHERE poi_id = $1
      AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `, [poiId]);

    if (recentResult.rows.length > 0) {
      const recent = recentResult.rows[0];

      // Check if status has changed
      const statusChanged = recent.status !== status.status;
      const conditionsChanged = recent.conditions !== status.conditions;
      const sourceChanged = recent.source_url !== status.source_url;

      if (!statusChanged && !conditionsChanged && !sourceChanged) {
        console.log(`[Trail Status] Status unchanged, skipping duplicate`);
        return false;
      }
    }

    // Insert new status
    await pool.query(`
      INSERT INTO trail_status (
        poi_id,
        status,
        conditions,
        last_updated,
        source_name,
        source_url,
        weather_impact,
        seasonal_closure
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      poiId,
      status.status,
      status.conditions,
      status.last_updated,
      status.source_name,
      status.source_url,
      status.weather_impact,
      status.seasonal_closure || false
    ]);

    console.log(`[Trail Status] Status saved to database`);
    return true;

  } catch (error) {
    console.error(`[Trail Status] Error saving status:`, error.message);
    throw error;
  }
}

/**
 * Run batch trail status collection
 * @param {Pool} pool - Database connection pool
 * @param {Object} boss - pg-boss instance
 * @param {Object} options - Collection options
 * @returns {Object} - { jobId, message }
 */
export async function runTrailStatusCollection(pool, boss, options = {}) {
  const { poiIds = null, jobType = 'batch_collection', sheets = null } = options;

  console.log(`\n[Trail Status Collection] Starting ${jobType}...`);

  try {
    // Get trails with status_url configured
    let trails;
    if (poiIds && poiIds.length > 0) {
      const trailsQuery = await pool.query(`
        SELECT id, name, poi_type, status_url, brief_description
        FROM pois
        WHERE id = ANY($1)
        AND status_url IS NOT NULL
        AND status_url != ''
        ORDER BY name
      `, [poiIds]);
      trails = trailsQuery.rows;
    } else {
      const trailsQuery = await pool.query(`
        SELECT id, name, poi_type, status_url, brief_description
        FROM pois
        WHERE status_url IS NOT NULL
        AND status_url != ''
        ORDER BY name
      `);
      trails = trailsQuery.rows;
    }

    if (trails.length === 0) {
      console.log('[Trail Status Collection] No MTB trails found');
      return { jobId: null, message: 'No MTB trails found' };
    }

    console.log(`[Trail Status Collection] Found ${trails.length} MTB trails to process`);

    // Create job record
    const jobResult = await pool.query(`
      INSERT INTO trail_status_job_status (
        job_type,
        status,
        started_at,
        total_trails,
        trails_processed,
        status_found,
        poi_ids,
        processed_poi_ids
      ) VALUES ($1, $2, NOW(), $3, 0, 0, $4, $5)
      RETURNING id
    `, [
      jobType,
      'queued',
      trails.length,
      JSON.stringify(trails.map(t => t.id)),
      JSON.stringify([])
    ]);

    const jobId = jobResult.rows[0].id;
    console.log(`[Trail Status Collection] Created job ${jobId}`);

    // Submit to pg-boss for background processing
    const pgBossJobId = await boss.send('trail-status-batch-collect', {
      jobId,
      poiIds: trails.map(t => t.id),
      jobType
    });

    // Update job record with pg-boss job ID
    await pool.query(`
      UPDATE trail_status_job_status
      SET pg_boss_job_id = $1
      WHERE id = $2
    `, [pgBossJobId, jobId]);

    console.log(`[Trail Status Collection] Submitted to pg-boss: ${pgBossJobId}`);

    return {
      jobId,
      message: `Batch collection started for ${trails.length} trails`,
      totalTrails: trails.length
    };

  } catch (error) {
    console.error('[Trail Status Collection] Error starting batch collection:', error.message);
    throw error;
  }
}

/**
 * Process batch trail status collection job (pg-boss worker function)
 * @param {Pool} pool - Database connection pool
 * @param {number} jobId - Job ID from trail_status_job_status table
 * @param {Array} poiIds - Array of POI IDs to process
 * @param {Object} sheets - Optional sheets client
 */
export async function processTrailStatusCollectionJob(pool, jobId, poiIds, sheets = null) {
  console.log(`\n[Trail Status Job ${jobId}] Starting batch processing for ${poiIds.length} trails`);

  // Track Gemini calls for this job
  let geminiCalls = 0;

  try {
    // Load job record
    const jobResult = await pool.query(`
      SELECT * FROM trail_status_job_status WHERE id = $1
    `, [jobId]);

    if (jobResult.rows.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }

    const job = jobResult.rows[0];
    const processedPois = new Set(JSON.parse(job.processed_poi_ids || '[]'));

    // Update job status to running
    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'running', started_at = NOW()
      WHERE id = $1
    `, [jobId]);

    // Initialize display slots for this job
    initializeSlots(jobId);

    // Process trails with continuous flow (semaphore pattern)
    const trailsToProcess = poiIds.filter(id => !processedPois.has(id));
    let totalStatusFound = 0;
    let totalStatusSaved = 0;

    // Continuous flow pattern (like newsService.js)
    let inFlight = 0;
    let nextIndex = 0;
    let resolveAll;
    const allDone = new Promise(resolve => { resolveAll = resolve; });

    const processNextTrail = async () => {
      if (nextIndex >= trailsToProcess.length) {
        if (inFlight === 0) resolveAll();
        return;
      }

      const index = nextIndex++;
      const poiId = trailsToProcess[index];
      inFlight++;

      try {
        // Get trail data
        const poiResult = await pool.query(`
          SELECT id, name, poi_type, status_url, brief_description
          FROM pois
          WHERE id = $1
        `, [poiId]);

        if (poiResult.rows.length === 0) {
          console.error(`[Trail Status Job ${jobId}] Trail ${poiId} not found`);
          processedPois.add(poiId);
        } else {
          const poi = poiResult.rows[0];

          // Find available slot and assign trail to it
          const slotId = findFirstAvailableSlot(jobId);

          // Assign trail to slot
          assignPoiToSlot(jobId, slotId, poi.id, poi.name, 'gemini');

          // Initialize progress with slotId and jobId
          updateProgress(poi.id, {
            phase: 'initializing',
            message: `Starting trail status extraction for ${poi.name}...`,
            poiName: poi.name,
            provider: 'gemini',
            slotId,
            jobId,
            completed: false
          });

          console.log(`[Trail Status Job ${jobId}] [${index + 1}/${trailsToProcess.length}] Starting trail ${poiId} (Slot ${slotId}, ${inFlight} in flight)`);

          // Collect status
          const statusCollection = await collectTrailStatus(pool, poi, sheets, 'America/New_York');
          geminiCalls++;

          console.log(`[Trail Status Job ${jobId}] [${index + 1}/${trailsToProcess.length}] ${poi.name}: ${statusCollection.statusFound} status found`);

          totalStatusFound += statusCollection.statusFound;
          totalStatusSaved += statusCollection.statusSaved;

          // Mark as processed
          processedPois.add(poiId);
        }

        // Checkpoint progress
        const aiUsage = JSON.stringify({ gemini: geminiCalls });
        await pool.query(`
          UPDATE trail_status_job_status
          SET trails_processed = $1,
              status_found = $2,
              processed_poi_ids = $3,
              ai_usage = $5
          WHERE id = $4
        `, [
          processedPois.size,
          totalStatusFound,
          JSON.stringify([...processedPois]),
          jobId,
          aiUsage
        ]);

      } catch (error) {
        console.error(`[Trail Status Job ${jobId}] [${index + 1}/${trailsToProcess.length}] Trail ${poiId}: ${error.message}`);

        // Mark as processed even if failed
        processedPois.add(poiId);

        // Checkpoint on error
        const aiUsage = JSON.stringify({ gemini: geminiCalls });
        await pool.query(`
          UPDATE trail_status_job_status
          SET trails_processed = $1,
              processed_poi_ids = $2,
              ai_usage = $4
          WHERE id = $3
        `, [
          processedPois.size,
          JSON.stringify([...processedPois]),
          jobId,
          aiUsage
        ]);
      }

      inFlight--;

      // Start next trail with delay when a slot opens
      if (nextIndex < trailsToProcess.length && inFlight < MAX_CONCURRENCY) {
        setTimeout(() => processNextTrail(), DISPATCH_INTERVAL_MS);
      } else if (nextIndex >= trailsToProcess.length && inFlight === 0) {
        resolveAll();
      }
    };

    // Start initial batch with staggered dispatch
    const initialBatch = Math.min(MAX_CONCURRENCY, trailsToProcess.length);
    for (let i = 0; i < initialBatch; i++) {
      setTimeout(() => processNextTrail(), i * DISPATCH_INTERVAL_MS);
    }

    // Wait for all to complete
    await allDone;

    // Mark job completed
    const finalAiUsage = JSON.stringify({ gemini: geminiCalls });
    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'completed',
          completed_at = NOW(),
          trails_processed = $1,
          status_found = $2,
          ai_usage = $4
      WHERE id = $3
    `, [processedPois.size, totalStatusFound, jobId, finalAiUsage]);

    console.log(`\n[Trail Status Job ${jobId}] Completed`);
    console.log(`[Trail Status Job ${jobId}] Trails processed: ${processedPois.size}/${poiIds.length}`);
    console.log(`[Trail Status Job ${jobId}] Status found: ${totalStatusFound}`);
    console.log(`[Trail Status Job ${jobId}] Status saved: ${totalStatusSaved}`);
    console.log(`[Trail Status Job ${jobId}] Gemini calls: ${geminiCalls}`);

    // Don't clear display slots - keep them frozen for frontend to display
    // Frontend will clear them when user clicks X or starts a new job

  } catch (error) {
    console.error(`[Trail Status Job ${jobId}] Failed:`, error.message);

    // Mark job failed
    const failureAiUsage = JSON.stringify({ gemini: geminiCalls });
    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'failed',
          completed_at = NOW(),
          error_message = $1,
          ai_usage = $3
      WHERE id = $2
    `, [error.message, jobId, failureAiUsage]);

    throw error;
  }
}

/**
 * Get job status
 * @param {Pool} pool - Database connection pool
 * @param {string|number} jobId - Job ID (integer) or pg_boss_job_id (UUID)
 * @returns {Object} - Job status object
 */
export async function getJobStatus(pool, jobId) {
  // Check if jobId is a UUID (pg_boss_job_id) or integer (table id)
  const isUuid = typeof jobId === 'string' && jobId.includes('-');

  const jobQuery = await pool.query(
    isUuid
      ? `SELECT * FROM trail_status_job_status WHERE pg_boss_job_id = $1`
      : `SELECT * FROM trail_status_job_status WHERE id = $1`,
    [jobId]
  );

  if (jobQuery.rows.length === 0) {
    return null;
  }

  const job = jobQuery.rows[0];
  return {
    jobId: job.id,
    jobType: job.job_type,
    status: job.status,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    totalTrails: job.total_trails,
    trailsProcessed: job.trails_processed,
    statusFound: job.status_found,
    errorMessage: job.error_message,
    aiUsage: job.ai_usage ? JSON.parse(job.ai_usage) : { gemini: 0 }
  };
}

/**
 * Cancel a running job
 * @param {Pool} pool - Database connection pool
 * @param {number} jobId - Job ID
 * @returns {boolean} - true if cancelled, false if not running
 */
export async function cancelJob(pool, jobId) {
  const cancelUpdate = await pool.query(`
    UPDATE trail_status_job_status
    SET status = 'cancelled',
        completed_at = NOW()
    WHERE id = $1 AND status IN ('queued', 'running')
    RETURNING id
  `, [jobId]);

  return cancelUpdate.rowCount > 0;
}

/**
 * Get latest trail status for a POI
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @returns {Object|null} - Latest status or null
 */
export async function getLatestTrailStatus(pool, poiId) {
  const statusQuery = await pool.query(`
    SELECT * FROM trail_status
    WHERE poi_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [poiId]);

  return statusQuery.rows.length > 0 ? statusQuery.rows[0] : null;
}
