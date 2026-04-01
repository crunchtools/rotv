/**
 * Trail Status Collection Service
 * Renders configured status_url with Playwright, extracts content, feeds to Gemini for status extraction.
 *
 * Job execution is managed by pg-boss for crash recovery and resumability.
 * Progress is checkpointed after each trail so jobs can resume after container restarts.
 */

import { generateTextWithCustomPrompt } from './geminiService.js';
import { extractPageContent } from './contentExtractor.js';
import { fetchFacebookPosts, isFacebookUrl } from './apifyService.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';
import { CollectionTracker, runBatch } from './collection/index.js';

// Helper to detect Twitter/X URLs (used in multiple places)
function isTwitterUrl(url) {
  return url.includes('x.com') || url.includes('twitter.com');
}

// Dispatch interval: start one new trail job every N milliseconds
const DISPATCH_INTERVAL_MS = 1500;
// Maximum number of concurrent jobs in flight
const MAX_CONCURRENCY = 10;

// Shared progress + slot tracker for trail status collection
const tracker = new CollectionTracker('Trail');

// Re-export tracker methods under original names for backward compatibility
// (used by mcpServer.js, admin.js, server.js)
export const updateProgress = (poiId, updates) => tracker.updateProgress(poiId, updates);
export const getCollectionProgress = (poiId) => tracker.getCollectionProgress(poiId);
export const clearProgress = (poiId) => tracker.clearProgress(poiId);
export const getAllActiveProgress = () => tracker.getAllActiveProgress();
export const initializeSlots = (jobId) => tracker.initializeSlots(jobId);
export const getDisplaySlots = (jobId) => tracker.getDisplaySlots(jobId);
export const requestCancellation = (poiId) => tracker.requestCancellation(poiId);
export const isCancellationRequested = (poiId) => tracker.isCancellationRequested(poiId);

/**
 * Track consecutive Twitter collection failures to detect stale cookies.
 * Increments on failure, resets on success. Logs a warning at 3+ failures.
 */
async function trackTwitterResult(pool, statusUrl, success) {
  if (!isTwitterUrl(statusUrl)) return;

  try {
    if (success) {
      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at) VALUES ('twitter_consecutive_failures', '0', NOW())
         ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW()`
      );
    } else {
      const result = await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at) VALUES ('twitter_consecutive_failures', '1', NOW())
         ON CONFLICT (key) DO UPDATE SET value = (COALESCE(admin_settings.value, '0')::int + 1)::text, updated_at = NOW()
         RETURNING value`
      );
      const failures = parseInt(result.rows[0]?.value) || 0;
      if (failures >= 3) {
        console.warn(`[Trail Status] WARNING: ${failures} consecutive Twitter failures — cookies may be stale. Refresh at Settings > Data Collection.`);
      }
    }
  } catch (err) {
    // Non-critical — don't fail the collection over tracking
    console.error('[Trail Status] Error tracking Twitter result:', err.message);
  }
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
- IGNORE posts older than 90 days
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
  const existingProgress = tracker.getCollectionProgress(poi.id);
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

    // Route by URL type: Facebook uses Apify, everything else uses Playwright
    let rendered;

    if (isFacebookUrl(statusUrl)) {
      console.log(`[Trail Status] Fetching Facebook posts via Apify for: ${statusUrl}`);
      updateProgress(poi.id, {
        phase: 'rendering',
        message: 'Fetching Facebook posts via Apify...',
        steps: ['Initialized', 'Fetching Facebook posts']
      });
      rendered = await fetchFacebookPosts(pool, statusUrl);
    } else {
      // Playwright + Readability extraction (with cookies for Twitter/X)
      let cookies = null;
      if (isTwitterUrl(statusUrl)) {
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

      console.log(`[Trail Status] Rendering status page: ${statusUrl}`);
      updateProgress(poi.id, {
        phase: 'rendering',
        message: 'Rendering status page...',
        steps: ['Initialized', 'Rendering page']
      });
      rendered = await extractPageContent(statusUrl, {
        maxLength: 15000,
        dynamicContentWait: isTwitterUrl(statusUrl) ? 8000 : 3000,
        cookies
      });
    }

    if (!rendered.reachable || !rendered.markdown) {
      console.log(`[Trail Status] Page not reachable or no content extracted (reason: ${rendered.reason || 'unknown'})`);
      await trackTwitterResult(pool, statusUrl, false);
      updateProgress(poi.id, {
        phase: 'complete',
        message: `Page not reachable: ${rendered.reason || 'no content'}`,
        completed: true,
        statusFound: 0,
        steps: ['Initialized', 'Extraction failed', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    const MIN_CONTENT_LENGTH = 200;
    if (rendered.markdown.length < MIN_CONTENT_LENGTH) {
      console.log(`[Trail Status] Insufficient content (${rendered.markdown.length} chars, need ${MIN_CONTENT_LENGTH}+)`);
      await trackTwitterResult(pool, statusUrl, false);
      updateProgress(poi.id, {
        phase: 'complete',
        message: 'Insufficient page content',
        completed: true,
        statusFound: 0,
        steps: ['Initialized', 'Extraction insufficient', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    console.log(`[Trail Status] Extracted content (${rendered.markdown.length} chars)`);

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
    const response = await generateTextWithCustomPrompt(pool, prompt, { useSearchGrounding: false });

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
      await trackTwitterResult(pool, statusUrl, false);
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
      await trackTwitterResult(pool, statusUrl, false);
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
    await trackTwitterResult(pool, statusUrl, true);

    // Override source_url with the POI's configured status_url
    status.source_url = poi.status_url;
    // Extract source name from the URL if not already set
    if (isTwitterUrl(poi.status_url)) {
      status.source_name = 'Twitter/X';
    } else if (isFacebookUrl(poi.status_url)) {
      status.source_name = 'Facebook';
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
    // Validate that last_updated is not too old (reject status older than 90 days)
    if (status.last_updated) {
      const lastUpdated = new Date(status.last_updated);
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      if (lastUpdated < ninetyDaysAgo) {
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
  logInfo(jobId, 'trail_status', null, null, `Job started: ${poiIds.length} trails`, { total: poiIds.length });

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

    // Filter to remaining trails (for resumability)
    const trailsToProcess = poiIds.filter(id => !processedPois.has(id));
    let totalStatusFound = 0;
    let totalStatusSaved = 0;

    const { results: batchResults, cancelled } = await runBatch({
      pool,
      jobId,
      items: trailsToProcess,
      tracker,
      label: 'Trail',
      maxConcurrency: MAX_CONCURRENCY,
      dispatchInterval: DISPATCH_INTERVAL_MS,

      onItemStart: async (poiId, { slotId, jobId: jid }) => {
        // Get trail data for slot assignment
        const poiResult = await pool.query(`
          SELECT id, name, poi_type, status_url, brief_description
          FROM pois WHERE id = $1
        `, [poiId]);

        if (poiResult.rows.length === 0) {
          throw new Error(`Trail ${poiId} not found`);
        }

        const poi = poiResult.rows[0];
        tracker.assignPoiToSlot(jid, slotId, poi.id, poi.name, 'gemini');
        tracker.updateProgress(poi.id, {
          phase: 'initializing',
          message: `Starting trail status extraction for ${poi.name}...`,
          poiName: poi.name,
          provider: 'gemini',
          slotId,
          jobId: jid,
          completed: false
        });
      },

      collectFn: async (poiId, { index, total }) => {
        // Get trail data
        const poiResult = await pool.query(`
          SELECT id, name, poi_type, status_url, brief_description
          FROM pois WHERE id = $1
        `, [poiId]);

        if (poiResult.rows.length === 0) {
          console.error(`[Trail Status Job ${jobId}] Trail ${poiId} not found`);
          return { statusFound: 0, statusSaved: 0, notFound: true };
        }

        const poi = poiResult.rows[0];
        const statusCollection = await collectTrailStatus(pool, poi, sheets, 'America/New_York');
        geminiCalls++;

        console.log(`[Trail Status Job ${jobId}] [${index + 1}/${total}] ${poi.name}: ${statusCollection.statusFound} status found`);
        if (statusCollection.statusFound > 0) {
          logInfo(jobId, 'trail_status', poi.id, poi.name, `Status found: ${statusCollection.statusSaved ? 'saved' : 'unchanged'}`, { status_found: statusCollection.statusFound, status_saved: statusCollection.statusSaved });
        }

        return { statusFound: statusCollection.statusFound, statusSaved: statusCollection.statusSaved, poiName: poi.name };
      },

      checkpointFn: async (poiId, result, error) => {
        processedPois.add(poiId);

        if (result && !result.notFound) {
          totalStatusFound += result.statusFound;
          totalStatusSaved += result.statusSaved;
        }
        if (error) {
          logError(jobId, 'trail_status', poiId, null, error.message);
        }

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
      }
    });

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
    logInfo(jobId, 'trail_status', null, null, `Job completed: ${processedPois.size} trails, ${totalStatusFound} status found`, { trails_processed: processedPois.size, status_found: totalStatusFound, status_saved: totalStatusSaved, gemini_calls: geminiCalls });
    await flushJobLogs();

    // Don't clear display slots — keep frozen for frontend

  } catch (error) {
    console.error(`[Trail Status Job ${jobId}] Failed:`, error.message);
    logError(jobId, 'trail_status', null, null, `Job failed: ${error.message}`);
    await flushJobLogs();

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
