/**
 * Trail Status Collection Service
 * Uses AI with web search grounding to find current trail status for MTB trails
 *
 * Job execution is managed by pg-boss for crash recovery and resumability.
 * Progress is checkpointed after each trail so jobs can resume after container restarts.
 */

import { generateTextWithCustomPrompt, resetJobUsage, getJobUsage } from './aiSearchFactory.js';
import { renderJavaScriptPage, isJavaScriptHeavySite } from './jsRenderer.js';

// Dispatch interval: start one new trail job every N milliseconds
const DISPATCH_INTERVAL_MS = 1500;
// Maximum number of concurrent jobs in flight
const MAX_CONCURRENCY = 10;

// In-memory progress tracking for active collections
const collectionProgress = new Map();

/**
 * Update collection progress for a trail
 */
export function updateProgress(poiId, updates) {
  const current = collectionProgress.get(poiId) || {
    phase: 'starting',
    message: 'Initializing...',
    statusFound: 0,
    startTime: Date.now(),
    steps: []
  };

  const updated = { ...current, ...updates, lastUpdate: Date.now() };
  collectionProgress.set(poiId, updated);
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

// Prompt template for trail status collection
const TRAIL_STATUS_PROMPT = `You are a precise mountain bike trail status researcher for Northeast Ohio.

TIMEZONE CONTEXT:
- The current timezone is: {{timezone}}
- Return ALL dates/times in ISO 8601 format: YYYY-MM-DD HH:MM:SS
- If no time is specified, use 00:00:00

Search for CURRENT trail status for: "{{name}}"
Trail System: {{trailSystem}}
Location: {{location}}

STATUS URL (if provided):
{{statusUrl}}

PRIORITY SOURCES TO SEARCH:
- IMBA Trail Forks - trailforks.com
- MTB Project - mtbproject.com
- Summit Metro Parks - summitmetroparks.org
- Cleveland Metroparks - clevelandmetroparks.com
- Stark Parks - starkparks.com
- Local trail Facebook pages and groups
- Trail-specific Twitter/Bluesky accounts
- Park district status pages

CRITICAL REQUIREMENTS:
- Only include status that EXPLICITLY mentions "{{name}}" or the trail system it belongs to
- Focus on CURRENT status (not historical)
- Look for recent updates (last 7 days preferred, last 30 days maximum)
- Include weather-related impacts if mentioned

Search for:
1. Current trail status (open/closed/limited/maintenance)
2. Trail conditions (dry, muddy, wet, snow-covered, icy)
3. Recent maintenance or closure notifications
4. Weather impacts on trail conditions
5. Seasonal closures or restrictions
6. Last updated timestamp from the source

Return a JSON object with this exact structure:
{
  "status": {
    "status": "open|closed|limited|maintenance|unknown",
    "conditions": "Brief description of current trail conditions, or null",
    "last_updated": "YYYY-MM-DD HH:MM:SS in ISO 8601 format, or null if unknown",
    "source_name": "Source name (e.g., IMBA Trail Forks, Summit Metro Parks)",
    "source_url": "URL to status page, or null if not available",
    "weather_impact": "Weather-related impacts (e.g., 'Muddy after rain', 'Snow covered'), or null",
    "seasonal_closure": true|false
  }
}

IMPORTANT:
- If you cannot find current status for "{{name}}", return: {"status": {"status": "unknown", "conditions": null, "last_updated": null, "source_name": null, "source_url": null, "weather_impact": null, "seasonal_closure": false}}
- Be conservative - only report status you are confident about
- Include the exact JSON structure above, no additional text
- All dates must be in ISO 8601 format (YYYY-MM-DD HH:MM:SS), interpreted in {{timezone}}`;

/**
 * Collect trail status for a specific MTB trail
 * @param {Pool} pool - Database connection pool
 * @param {Object} poi - POI object with id, name, location, status_url
 * @param {Object} sheets - Optional sheets client for API key restore
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {Object} - { statusFound: number, statusSaved: number }
 */
export async function collectTrailStatus(pool, poi, sheets = null, timezone = 'America/New_York') {
  console.log(`\n[Trail Status] ======== Collecting status for: ${poi.name} ========`);

  updateProgress(poi.id, {
    phase: 'starting',
    message: 'Initializing trail status collection...',
    steps: ['Initialized']
  });

  const trailSystem = poi.trail_system || 'Unknown system';
  const location = poi.location || 'Northeast Ohio';
  const statusUrl = poi.status_url || 'No dedicated status page';

  try {
    // Check for cancellation before starting
    if (isCancellationRequested(poi.id)) {
      console.log(`[Trail Status] ⚠️ Cancellation requested, aborting`);
      updateProgress(poi.id, {
        phase: 'cancelled',
        message: 'Collection cancelled',
        completed: true,
        cancelled: true
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    // Check if status URL needs JavaScript rendering
    let renderedHtml = null;
    if (statusUrl && statusUrl !== 'No dedicated status page') {
      const isJsHeavy = await isJavaScriptHeavySite(statusUrl);
      if (isJsHeavy) {
        console.log(`[Trail Status] 🌐 Status URL is JavaScript-heavy, rendering...`);
        updateProgress(poi.id, {
          phase: 'rendering',
          message: 'Rendering JavaScript status page...',
          steps: ['Initialized', 'Rendering page']
        });

        try {
          renderedHtml = await renderJavaScriptPage(statusUrl);
          console.log(`[Trail Status] ✓ Rendered page (${renderedHtml.length} chars)`);
        } catch (renderError) {
          console.error(`[Trail Status] ⚠️ Rendering failed: ${renderError.message}, continuing with AI search`);
        }
      }
    }

    // Build AI search prompt
    updateProgress(poi.id, {
      phase: 'searching',
      message: 'Searching for trail status...',
      steps: ['Initialized', 'Searching']
    });

    const prompt = TRAIL_STATUS_PROMPT
      .replace(/\{\{name\}\}/g, poi.name)
      .replace(/\{\{trailSystem\}\}/g, trailSystem)
      .replace(/\{\{location\}\}/g, location)
      .replace(/\{\{statusUrl\}\}/g, statusUrl)
      .replace(/\{\{timezone\}\}/g, timezone);

    console.log(`[Trail Status] 🔍 Searching with AI for trail status...`);
    const response = await generateTextWithCustomPrompt(pool, prompt, sheets);
    console.log(`[Trail Status] Received response (${response.length} chars)`);

    // Check for cancellation after AI search
    if (isCancellationRequested(poi.id)) {
      console.log(`[Trail Status] ⚠️ Cancellation requested after AI search, aborting`);
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
      console.error('[Trail Status] ⚠️ No JSON found in response');
      updateProgress(poi.id, {
        phase: 'complete',
        message: 'No status found',
        completed: true,
        steps: ['Initialized', 'Searching', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    const result = JSON.parse(jsonMatch[0]);
    const status = result.status;

    if (!status || status.status === 'unknown') {
      console.log(`[Trail Status] No current status found for ${poi.name}`);
      updateProgress(poi.id, {
        phase: 'complete',
        message: 'No status found',
        completed: true,
        statusFound: 0,
        steps: ['Initialized', 'Searching', 'Complete']
      });
      return { statusFound: 0, statusSaved: 0 };
    }

    console.log(`[Trail Status] ✓ Found status: ${status.status}`);
    console.log(`[Trail Status]   Conditions: ${status.conditions || 'N/A'}`);
    console.log(`[Trail Status]   Source: ${status.source_name || 'N/A'}`);
    console.log(`[Trail Status]   Last Updated: ${status.last_updated || 'N/A'}`);

    // Save to database with deduplication
    updateProgress(poi.id, {
      phase: 'saving',
      message: 'Saving trail status...',
      statusFound: 1,
      steps: ['Initialized', 'Searching', 'Saving']
    });

    const saved = await saveTrailStatus(pool, poi.id, status);

    updateProgress(poi.id, {
      phase: 'complete',
      message: `Status collected: ${status.status}`,
      completed: true,
      statusFound: 1,
      statusSaved: saved ? 1 : 0,
      steps: ['Initialized', 'Searching', 'Saving', 'Complete']
    });

    return { statusFound: 1, statusSaved: saved ? 1 : 0 };

  } catch (error) {
    console.error(`[Trail Status] ❌ Error collecting status for ${poi.name}:`, error.message);
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
        console.log(`[Trail Status] ⏭️  Status unchanged, skipping duplicate`);
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

    console.log(`[Trail Status] ✓ Status saved to database`);
    return true;

  } catch (error) {
    console.error(`[Trail Status] ❌ Error saving status:`, error.message);
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
    // Get MTB trails to collect status for
    let trails;
    if (poiIds && poiIds.length > 0) {
      const result = await pool.query(`
        SELECT id, name, poi_type, status_url, location
        FROM pois
        WHERE id = ANY($1) AND is_mtb_trail = true
        ORDER BY name
      `, [poiIds]);
      trails = result.rows;
    } else {
      const result = await pool.query(`
        SELECT id, name, poi_type, status_url, location
        FROM pois
        WHERE is_mtb_trail = true
        ORDER BY name
      `);
      trails = result.rows;
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

    // Reset AI usage tracking for this job
    resetJobUsage();

    // Process trails with concurrency control
    const trailsToProcess = poiIds.filter(id => !processedPois.has(id));
    let totalStatusFound = 0;
    let totalStatusSaved = 0;

    for (let i = 0; i < trailsToProcess.length; i += MAX_CONCURRENCY) {
      const batch = trailsToProcess.slice(i, i + MAX_CONCURRENCY);

      console.log(`\n[Trail Status Job ${jobId}] Processing batch ${Math.floor(i / MAX_CONCURRENCY) + 1} (${batch.length} trails)`);

      const promises = batch.map(async (poiId, batchIndex) => {
        // Stagger requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, batchIndex * DISPATCH_INTERVAL_MS));

        try {
          // Get trail data
          const poiResult = await pool.query(`
            SELECT id, name, poi_type, status_url, location
            FROM pois
            WHERE id = $1
          `, [poiId]);

          if (poiResult.rows.length === 0) {
            console.error(`[Trail Status Job ${jobId}] Trail ${poiId} not found`);
            return { statusFound: 0, statusSaved: 0 };
          }

          const poi = poiResult.rows[0];

          // Collect status
          const result = await collectTrailStatus(pool, poi, sheets, 'America/New_York');

          // Checkpoint progress
          processedPois.add(poiId);
          await pool.query(`
            UPDATE trail_status_job_status
            SET trails_processed = $1,
                status_found = status_found + $2,
                processed_poi_ids = $3
            WHERE id = $4
          `, [
            processedPois.size,
            result.statusFound,
            JSON.stringify([...processedPois]),
            jobId
          ]);

          return result;

        } catch (error) {
          console.error(`[Trail Status Job ${jobId}] Error processing trail ${poiId}:`, error.message);
          // Mark as processed even if failed
          processedPois.add(poiId);
          await pool.query(`
            UPDATE trail_status_job_status
            SET trails_processed = $1,
                processed_poi_ids = $2
            WHERE id = $3
          `, [
            processedPois.size,
            JSON.stringify([...processedPois]),
            jobId
          ]);
          return { statusFound: 0, statusSaved: 0 };
        }
      });

      const results = await Promise.all(promises);
      totalStatusFound += results.reduce((sum, r) => sum + r.statusFound, 0);
      totalStatusSaved += results.reduce((sum, r) => sum + r.statusSaved, 0);
    }

    // Get AI usage stats
    const aiUsage = getJobUsage();

    // Mark job completed
    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'completed',
          completed_at = NOW(),
          trails_processed = $1,
          status_found = $2
      WHERE id = $3
    `, [processedPois.size, totalStatusFound, jobId]);

    console.log(`\n[Trail Status Job ${jobId}] ✅ Completed`);
    console.log(`[Trail Status Job ${jobId}] Trails processed: ${processedPois.size}/${poiIds.length}`);
    console.log(`[Trail Status Job ${jobId}] Status found: ${totalStatusFound}`);
    console.log(`[Trail Status Job ${jobId}] Status saved: ${totalStatusSaved}`);
    console.log(`[Trail Status Job ${jobId}] AI usage: ${JSON.stringify(aiUsage)}`);

  } catch (error) {
    console.error(`[Trail Status Job ${jobId}] ❌ Failed:`, error.message);

    // Mark job failed
    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'failed',
          completed_at = NOW(),
          error_message = $1
      WHERE id = $2
    `, [error.message, jobId]);

    throw error;
  }
}

/**
 * Get job status
 * @param {Pool} pool - Database connection pool
 * @param {number} jobId - Job ID
 * @returns {Object} - Job status object
 */
export async function getJobStatus(pool, jobId) {
  const result = await pool.query(`
    SELECT * FROM trail_status_job_status WHERE id = $1
  `, [jobId]);

  if (result.rows.length === 0) {
    return null;
  }

  const job = result.rows[0];
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
    aiUsage: getJobUsage()
  };
}

/**
 * Cancel a running job
 * @param {Pool} pool - Database connection pool
 * @param {number} jobId - Job ID
 * @returns {boolean} - true if cancelled, false if not running
 */
export async function cancelJob(pool, jobId) {
  const result = await pool.query(`
    UPDATE trail_status_job_status
    SET status = 'cancelled',
        completed_at = NOW()
    WHERE id = $1 AND status IN ('queued', 'running')
    RETURNING id
  `, [jobId]);

  return result.rowCount > 0;
}

/**
 * Get latest trail status for a POI
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @returns {Object|null} - Latest status or null
 */
export async function getLatestTrailStatus(pool, poiId) {
  const result = await pool.query(`
    SELECT * FROM trail_status
    WHERE poi_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [poiId]);

  return result.rows.length > 0 ? result.rows[0] : null;
}
