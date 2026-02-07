/**
 * Trail Status Collection Service
 * Uses AI with web search grounding to find current trail status for MTB trails
 *
 * Job execution is managed by pg-boss for crash recovery and resumability.
 * Progress is checkpointed after each trail so jobs can resume after container restarts.
 */

import { generateTextWithCustomPrompt, resetJobUsage, getJobUsage, getJobStats } from './aiSearchFactory.js';
import { renderJavaScriptPage, isJavaScriptHeavySite } from './jsRenderer.js';

// Dispatch interval: start one new trail job every N milliseconds
const DISPATCH_INTERVAL_MS = 1500;
// Maximum number of concurrent jobs in flight
const MAX_CONCURRENCY = 10;

// In-memory progress tracking for active collections
const collectionProgress = new Map();

// Job display slots: jobId → [10 slots]
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

// Prompt template for trail status collection
const TRAIL_STATUS_PROMPT = `You are a precise mountain bike trail status researcher for Northeast Ohio.

CURRENT DATE AND TIME:
- Today's date: {{currentDate}}
- Current timezone: {{timezone}}

TIMEZONE CONTEXT:
- Return ALL dates/times in ISO 8601 format: YYYY-MM-DD HH:MM:SS
- If no time is specified, use 00:00:00
- Use the current date above to calculate date ranges (e.g., "last 30 days")

Search for CURRENT trail status for: "{{name}}"
Trail System: {{trailSystem}}
Description: {{description}}

STATUS URL (if provided):
{{statusUrl}}

PRIORITY SOURCES TO SEARCH:
- Status URL provided above (if available) - CHECK THIS FIRST
- Bluesky/Twitter accounts (bsky.app, twitter.com) - check recent posts
- IMBA Trail Forks - trailforks.com
- MTB Project - mtbproject.com
- Summit Metro Parks - summitmetroparks.org
- Cleveland Metroparks - clevelandmetroparks.com
- Stark Parks - starkparks.com
- Local trail Facebook pages and groups
- Park district status pages

IMPORTANT FOR SOCIAL MEDIA:
- For Bluesky URLs (bsky.app/profile/...), look for recent posts about trail conditions
- For Twitter/X URLs, examine the timeline and find the MOST RECENT post about trail status
- Trail closures often persist for weeks/months - include older closure posts if no newer info exists
- Common status indicators: "closed", "open", "muddy", "dry", "groomed", "clear", "snow covered"

CRITICAL REQUIREMENTS - READ CAREFULLY:
- ALWAYS check post dates FIRST - ignore posts older than the date ranges below
- Only include status that EXPLICITLY mentions "{{name}}" or the trail system it belongs to
- Focus on CURRENT status (not historical)
- For ALL statuses: ONLY use updates from last 180 days - REJECT older posts
- If multiple posts exist within date range, use the MOST RECENT one by date
- NEVER use posts from previous years unless they are within the 180-day window
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
 * @param {Object} poi - POI object with id, name, brief_description, status_url
 * @param {Object} sheets - Optional sheets client for API key restore
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {Object} - { statusFound: number, statusSaved: number }
 */
export async function collectTrailStatus(pool, poi, sheets = null, timezone = 'America/New_York') {
  console.log(`\n[Trail Status] ======== Collecting status for: ${poi.name} ========`);

  // Determine which AI provider will be used (at the start, so it's available in all phases)
  const configResult = await pool.query(`
    SELECT key, value FROM admin_settings
    WHERE key IN ('ai_search_primary', 'ai_search_fallback', 'ai_search_primary_limit')
  `);
  const aiConfig = {
    primary: 'perplexity',
    fallback: 'none',
    primaryLimit: 0
  };
  for (const row of configResult.rows) {
    if (row.key === 'ai_search_primary') aiConfig.primary = row.value;
    if (row.key === 'ai_search_fallback') aiConfig.fallback = row.value;
    if (row.key === 'ai_search_primary_limit') aiConfig.primaryLimit = parseInt(row.value) || 0;
  }

  // Check current usage and determine which provider will be used
  const currentUsage = getJobUsage();
  let providerToUse = aiConfig.primary;
  const primaryUsage = currentUsage[aiConfig.primary] || 0;

  // Check if we've exceeded the primary limit
  if (aiConfig.primaryLimit > 0 && primaryUsage >= aiConfig.primaryLimit) {
    if (aiConfig.fallback && aiConfig.fallback !== 'none') {
      console.log(`[Trail Status] Primary limit reached (${primaryUsage}/${aiConfig.primaryLimit}), will use fallback: ${aiConfig.fallback}`);
      providerToUse = aiConfig.fallback;
    }
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
    provider: providerToUse,  // Set provider from the start
    slotId,  // Preserve slot assignment
    jobId    // Preserve job association
  });

  const trailSystem = poi.trail_system || 'Unknown system';
  const description = poi.brief_description || 'Northeast Ohio';
  const statusUrl = poi.status_url || 'No dedicated status page';

  // Fetch Twitter credentials from database
  let twitterCredentials = null;
  try {
    const credResult = await pool.query(
      `SELECT key, value FROM admin_settings WHERE key IN ('twitter_username', 'twitter_password')`
    );
    const credentials = {};
    credResult.rows.forEach(row => {
      if (row.key === 'twitter_username') credentials.username = row.value;
      if (row.key === 'twitter_password') credentials.password = row.value;
    });
    if (credentials.username && credentials.password) {
      twitterCredentials = credentials;
      console.log('[Trail Status] ✓ Twitter credentials loaded from database');
    } else {
      console.log('[Trail Status] ⚠️ Twitter credentials not configured in database');
    }
  } catch (credErr) {
    console.error('[Trail Status] Error fetching Twitter credentials:', credErr.message);
  }

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
    let renderedContent = null;
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
          const rendered = await renderJavaScriptPage(statusUrl, {
            twitterCredentials
          });
          // Check if we got meaningful content (minimum 500 chars)
          const MIN_CONTENT_LENGTH = 500;
          if (rendered.success && rendered.text && rendered.text.length >= MIN_CONTENT_LENGTH) {
            renderedContent = rendered.text;
            console.log(`[Trail Status] ✓ Rendered page (${renderedContent.length} chars)`);
          } else if (rendered.success && rendered.text) {
            console.log(`[Trail Status] ⚠️ Rendered page has insufficient content (${rendered.text.length} chars, need ${MIN_CONTENT_LENGTH}+)`);
            console.log(`[Trail Status] This may indicate login wall, empty page, or rendering failure - skipping rendered content`);
          } else {
            console.error(`[Trail Status] ⚠️ Rendering failed or no content extracted`);
          }
        } catch (renderError) {
          console.error(`[Trail Status] ⚠️ Rendering failed: ${renderError.message}, continuing with AI search`);
        }
      }
    }

    // Get the current provider (already determined at start of function)
    const currentProgress = getCollectionProgress(poi.id);
    const initialProvider = currentProgress?.provider || 'perplexity';

    // Build AI search prompt
    updateProgress(poi.id, {
      phase: 'ai_search',
      message: 'Searching for trail status...',
      steps: ['Initialized', 'Searching']
    });

    // Build base prompt with current date
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    let prompt = TRAIL_STATUS_PROMPT
      .replace(/\{\{currentDate\}\}/g, currentDate)
      .replace(/\{\{name\}\}/g, poi.name)
      .replace(/\{\{trailSystem\}\}/g, trailSystem)
      .replace(/\{\{description\}\}/g, description)
      .replace(/\{\{statusUrl\}\}/g, statusUrl)
      .replace(/\{\{timezone\}\}/g, timezone);

    // If we have rendered content, include it in the prompt
    if (renderedContent) {
      console.log(`[Trail Status] DEBUG - Rendered content preview (first 1000 chars):`);
      console.log(renderedContent.substring(0, 1000));
      console.log(`[Trail Status] DEBUG - End of preview`);

      prompt += `\n\nRENDERED PAGE CONTENT FROM ${statusUrl}:\n${renderedContent.substring(0, 15000)}\n\n` +
                `CRITICAL INSTRUCTIONS FOR RENDERED CONTENT:\n` +
                `1. Find ALL posts in the rendered content above that mention trail status, conditions, or closures\n` +
                `2. This is the official trail status account - ANY post about trail conditions IS about "${poi.name}"\n` +
                `3. Check the DATE of each post - look for timestamps, dates, or relative times (e.g., "2h ago", "Jan 14")\n` +
                `4. IGNORE posts older than 180 days for all statuses\n` +
                `5. Select the MOST RECENT post within the allowed date range\n` +
                `6. NEVER use old posts from previous years if recent posts exist\n` +
                `7. Common trail status phrases: "trail is open", "trail is closed", "open for riding", "closed due to", "muddy", "dry"`;
    }

    console.log(`[Trail Status] 🔍 Searching with AI for trail status...`);
    const aiResult = await generateTextWithCustomPrompt(pool, prompt, sheets);
    const response = aiResult.response;
    const usedProvider = aiResult.provider;

    // Update provider if it changed (e.g., fallback was used)
    if (usedProvider !== initialProvider) {
      console.log(`[Trail Status] Provider changed from ${initialProvider} to ${usedProvider} (fallback used)`);
      updateProgress(poi.id, { provider: usedProvider });
    }

    console.log(`[Trail Status] Received response (${response.length} chars) from ${usedProvider}`);
    console.log(`[Trail Status] DEBUG - Full AI response:`, response);

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

    // Override source_url with the POI's configured status_url if available
    // This ensures we link to the user-configured source, not whatever the AI happened to find
    if (poi.status_url && poi.status_url !== 'No dedicated status page') {
      console.log(`[Trail Status]   Overriding source_url with configured status_url: ${poi.status_url}`);
      status.source_url = poi.status_url;
      // Extract source name from the URL if not already set or if it doesn't match
      if (poi.status_url.includes('x.com') || poi.status_url.includes('twitter.com')) {
        status.source_name = 'Twitter/X';
      } else if (poi.status_url.includes('bsky.app')) {
        status.source_name = 'Bluesky';
      } else if (poi.status_url.includes('trailforks.com')) {
        status.source_name = 'IMBA Trail Forks';
      } else if (poi.status_url.includes('mtbproject.com')) {
        status.source_name = 'MTB Project';
      }
      // Keep existing source_name if URL doesn't match known patterns
    }

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
    // Validate that last_updated is not too old (reject status older than 30 days)
    if (status.last_updated) {
      const lastUpdated = new Date(status.last_updated);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (lastUpdated < thirtyDaysAgo) {
        console.log(`[Trail Status] ⏭️  Skipping outdated status (last updated: ${status.last_updated})`);
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
        SELECT id, name, poi_type, status_url, brief_description
        FROM pois
        WHERE id = ANY($1)
        AND status_url IS NOT NULL
        AND status_url != ''
        ORDER BY name
      `, [poiIds]);
      trails = result.rows;
    } else {
      const result = await pool.query(`
        SELECT id, name, poi_type, status_url, brief_description
        FROM pois
        WHERE status_url IS NOT NULL
        AND status_url != ''
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

          // Determine provider before calling collectTrailStatus (same logic as in collectTrailStatus)
          const configResult = await pool.query(`
            SELECT key, value FROM admin_settings
            WHERE key IN ('ai_search_primary', 'ai_search_fallback', 'ai_search_primary_limit')
          `);
          const aiConfig = {
            primary: 'perplexity',
            fallback: 'none',
            primaryLimit: 0
          };
          for (const row of configResult.rows) {
            if (row.key === 'ai_search_primary') aiConfig.primary = row.value;
            if (row.key === 'ai_search_fallback') aiConfig.fallback = row.value;
            if (row.key === 'ai_search_primary_limit') aiConfig.primaryLimit = parseInt(row.value) || 0;
          }
          const currentUsage = getJobUsage();
          let providerToUse = aiConfig.primary;
          const primaryUsage = currentUsage[aiConfig.primary] || 0;
          if (aiConfig.primaryLimit > 0 && primaryUsage >= aiConfig.primaryLimit) {
            if (aiConfig.fallback && aiConfig.fallback !== 'none') {
              providerToUse = aiConfig.fallback;
            }
          }

          // Assign trail to slot with provider info
          assignPoiToSlot(jobId, slotId, poi.id, poi.name, providerToUse);

          // Initialize progress with slotId and jobId
          updateProgress(poi.id, {
            phase: 'initializing',
            message: `Starting trail status search for ${poi.name}...`,
            poiName: poi.name,
            provider: providerToUse,
            slotId,
            jobId,
            completed: false
          });

          console.log(`[Trail Status Job ${jobId}] [${index + 1}/${trailsToProcess.length}] Starting trail ${poiId} (Slot ${slotId}, ${inFlight} in flight)`);

          // Collect status
          const result = await collectTrailStatus(pool, poi, sheets, 'America/New_York');

          console.log(`[Trail Status Job ${jobId}] [${index + 1}/${trailsToProcess.length}] ✓ ${poi.name}: ${result.statusFound} status found`);

          totalStatusFound += result.statusFound;
          totalStatusSaved += result.statusSaved;

          // Mark as processed
          processedPois.add(poiId);
        }

        // Checkpoint progress (including AI usage)
        const currentAiUsage = getJobUsage();
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
          JSON.stringify(currentAiUsage)
        ]);

      } catch (error) {
        console.error(`[Trail Status Job ${jobId}] [${index + 1}/${trailsToProcess.length}] ✗ Trail ${poiId}: ${error.message}`);

        // Mark as processed even if failed
        processedPois.add(poiId);

        // Checkpoint on error (including AI usage)
        const currentAiUsage = getJobUsage();
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
          JSON.stringify(currentAiUsage)
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

    // Get AI usage stats
    const aiUsage = getJobUsage();

    // Mark job completed (including AI usage)
    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'completed',
          completed_at = NOW(),
          trails_processed = $1,
          status_found = $2,
          ai_usage = $4
      WHERE id = $3
    `, [processedPois.size, totalStatusFound, jobId, JSON.stringify(aiUsage)]);

    console.log(`\n[Trail Status Job ${jobId}] ✅ Completed`);
    console.log(`[Trail Status Job ${jobId}] Trails processed: ${processedPois.size}/${poiIds.length}`);
    console.log(`[Trail Status Job ${jobId}] Status found: ${totalStatusFound}`);
    console.log(`[Trail Status Job ${jobId}] Status saved: ${totalStatusSaved}`);
    console.log(`[Trail Status Job ${jobId}] AI usage: ${JSON.stringify(aiUsage)}`);

    // Don't clear display slots - keep them frozen for frontend to display
    // Frontend will clear them when user clicks X or starts a new job

  } catch (error) {
    console.error(`[Trail Status Job ${jobId}] ❌ Failed:`, error.message);

    // Mark job failed (including AI usage)
    const failureAiUsage = getJobUsage();
    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'failed',
          completed_at = NOW(),
          error_message = $1,
          ai_usage = $3
      WHERE id = $2
    `, [error.message, jobId, JSON.stringify(failureAiUsage)]);

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

  const result = await pool.query(
    isUuid
      ? `SELECT * FROM trail_status_job_status WHERE pg_boss_job_id = $1`
      : `SELECT * FROM trail_status_job_status WHERE id = $1`,
    [jobId]
  );

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
  // Get current AI usage before cancelling
  const currentUsage = getJobUsage();

  const result = await pool.query(`
    UPDATE trail_status_job_status
    SET status = 'cancelled',
        completed_at = NOW(),
        ai_usage = $2
    WHERE id = $1 AND status IN ('queued', 'running')
    RETURNING id
  `, [jobId, JSON.stringify(currentUsage)]);

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
