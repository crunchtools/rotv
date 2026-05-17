
import crypto from 'crypto';
import { generateTextWithCustomPrompt } from './geminiService.js';
import { renderPage } from './renderPage.js';
import { fetchFacebookPosts, isFacebookUrl } from './apifyService.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';
import { CollectionTracker, runBatch } from './collection/index.js';

const HASH_SKIP_MAX_AGE_HOURS = 48;

function isTwitterUrl(url) {
  return url.includes('x.com') || url.includes('twitter.com');
}

const DISPATCH_INTERVAL_MS = 1500;
const MAX_CONCURRENCY = 10;

const tracker = new CollectionTracker('Trail');

export const updateProgress = (poiId, updates) => tracker.updateProgress(poiId, updates);
export const getCollectionProgress = (poiId) => tracker.getCollectionProgress(poiId);
export const clearProgress = (poiId) => tracker.clearProgress(poiId);
export const getAllActiveProgress = () => tracker.getAllActiveProgress();
export const initializeSlots = (jobId) => tracker.initializeSlots(jobId);
export const getDisplaySlots = (jobId) => tracker.getDisplaySlots(jobId);
export const requestCancellation = (poiId) => tracker.requestCancellation(poiId);
export const isCancellationRequested = (poiId) => tracker.isCancellationRequested(poiId);

async function trackTwitterResult(pool, statusUrl, success) {
  if (!isTwitterUrl(statusUrl)) return;

  try {
    if (success) {
      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at) VALUES ('twitter_consecutive_failures', '0', NOW())
         ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW()`
      );
    } else {
      const failureCountRow = await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at) VALUES ('twitter_consecutive_failures', '1', NOW())
         ON CONFLICT (key) DO UPDATE SET value = (COALESCE(admin_settings.value, '0')::int + 1)::text, updated_at = NOW()
         RETURNING value`
      );
      const failures = parseInt(failureCountRow.rows[0]?.value) || 0;
      if (failures >= 3) {
        console.warn(`[Trail Status] WARNING: ${failures} consecutive Twitter failures — cookies may be stale. Refresh at Settings > Data Collection.`);
      }
    }
  } catch (err) {
    console.error('[Trail Status] Error tracking Twitter result:', err.message);
  }
}

export const TRAIL_STATUS_PROMPT = `You are a trail status extractor. Extract the current mountain bike trail status from the following page content.

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

export async function collectTrailStatus(pool, poi, sheets = null, timezone = 'America/New_York') {
  console.log(`\n[Trail Status] ======== Collecting status for: ${poi.name} ========`);

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
      rendered = await renderPage(pool, statusUrl, {
        pageType: 'trail_status',
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

    const contentHash = crypto.createHash('sha256').update(rendered.markdown).digest('hex');

    const lastHashResult = await pool.query(
      `SELECT content_hash, created_at FROM trail_status WHERE poi_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [poi.id]
    );
    const lastRow = lastHashResult.rows[0];
    if (lastRow && lastRow.content_hash === contentHash) {
      const ageHours = (Date.now() - new Date(lastRow.created_at).getTime()) / (1000 * 60 * 60);
      if (ageHours < HASH_SKIP_MAX_AGE_HOURS) {
        console.log(`[Trail Status] Content unchanged for ${poi.name} (hash ${contentHash.slice(0, 12)}, age ${ageHours.toFixed(1)}h), skipping Gemini extraction`);
        updateProgress(poi.id, {
          phase: 'skipped_unchanged',
          message: 'Content unchanged since last check',
          completed: true,
          skipped: true
        });
        return { statusFound: 1, statusSaved: 0, skipped: true };
      }
    }

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

    updateProgress(poi.id, {
      phase: 'ai_extraction',
      message: 'Extracting status with Gemini...',
      steps: ['Initialized', 'Rendered', 'Extracting']
    });

    const currentDate = new Date().toISOString().split('T')[0];
    const { getPromptTemplate } = await import('./geminiService.js');
    const promptTemplate = await getPromptTemplate(pool, 'trail_status_prompt');
    const basePrompt = promptTemplate || TRAIL_STATUS_PROMPT;
    const prompt = basePrompt
      .replace(/\{\{currentDate\}\}/g, currentDate)
      .replace(/\{\{name\}\}/g, poi.name)
      .replace(/\{\{trailSystem\}\}/g, trailSystem)
      .replace(/\{\{statusUrl\}\}/g, statusUrl)
      .replace(/\{\{timezone\}\}/g, timezone)
      .replace(/\{\{renderedContent\}\}/g, rendered.markdown);

    console.log(`[Trail Status] Extracting status with Gemini (${prompt.length} char prompt)...`);
    const response = await generateTextWithCustomPrompt(pool, prompt, { thinkingBudget: 0 });

    console.log(`[Trail Status] Received response (${response.length} chars)`);

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

    status.source_url = poi.status_url;
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

    updateProgress(poi.id, {
      phase: 'saving',
      message: 'Saving trail status...',
      statusFound: 1,
      steps: ['Initialized', 'Rendered', 'Extracting', 'Saving']
    });

    const saved = await saveTrailStatus(pool, poi.id, status, contentHash);

    updateProgress(poi.id, {
      phase: 'complete',
      message: `Status collected: ${status.status}`,
      completed: true,
      statusFound: 1,
      statusSaved: saved ? 1 : 0,
      steps: ['Initialized', 'Rendered', 'Extracting', 'Saving', 'Complete']
    });

    return { statusFound: 1, statusSaved: saved ? 1 : 0, rendered_content: rendered.markdown, ai_response: response };

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

async function saveTrailStatus(pool, poiId, status, contentHash = null) {
  try {
    if (status.last_updated) {
      const lastUpdated = new Date(status.last_updated);
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      if (lastUpdated < ninetyDaysAgo) {
        console.log(`[Trail Status] Skipping outdated status (last updated: ${status.last_updated})`);
        return false;
      }
    }

    const recentResult = await pool.query(`
      SELECT * FROM trail_status
      WHERE poi_id = $1
      AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `, [poiId]);

    if (recentResult.rows.length > 0) {
      const recent = recentResult.rows[0];

      const statusChanged = recent.status !== status.status;
      const conditionsChanged = recent.conditions !== status.conditions;
      const sourceChanged = recent.source_url !== status.source_url;

      if (!statusChanged && !conditionsChanged && !sourceChanged) {
        if (contentHash && recent.content_hash !== contentHash) {
          await pool.query(
            `UPDATE trail_status SET content_hash = $1 WHERE id = $2`,
            [contentHash, recent.id]
          );
        }
        console.log(`[Trail Status] Status unchanged, skipping duplicate`);
        return false;
      }
    }

    let lastUpdated = status.last_updated;
    if (lastUpdated) {
      const parsedDate = new Date(lastUpdated);
      if (!isNaN(parsedDate) && parsedDate > new Date()) {
        console.log(`[Trail Status] Capping future last_updated ${lastUpdated} to now`);
        lastUpdated = new Date().toISOString();
      }
    }

    await pool.query(`
      INSERT INTO trail_status (
        poi_id,
        status,
        conditions,
        last_updated,
        source_name,
        source_url,
        weather_impact,
        seasonal_closure,
        content_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      poiId,
      status.status,
      status.conditions,
      lastUpdated,
      status.source_name,
      status.source_url,
      status.weather_impact,
      status.seasonal_closure || false,
      contentHash
    ]);

    console.log(`[Trail Status] Status saved to database`);
    return true;

  } catch (error) {
    console.error(`[Trail Status] Error saving status:`, error.message);
    throw error;
  }
}

export async function runTrailStatusCollection(pool, boss, options = {}) {
  const { poiIds = null, jobType = 'batch_collection', sheets = null } = options;

  console.log(`\n[Trail Status Collection] Starting ${jobType}...`);

  try {
    let trails;
    if (poiIds && poiIds.length > 0) {
      const trailsQuery = await pool.query(`
        SELECT id, name, poi_roles, status_url, brief_description
        FROM pois
        WHERE id = ANY($1)
        AND status_url IS NOT NULL
        AND status_url != ''
        ORDER BY name
      `, [poiIds]);
      trails = trailsQuery.rows;
    } else {
      const trailsQuery = await pool.query(`
        SELECT id, name, poi_roles, status_url, brief_description
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

    const pgBossJobId = await boss.send('trail-status-batch-collect', {
      jobId,
      poiIds: trails.map(t => t.id),
      jobType
    });

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

export async function processTrailStatusCollectionJob(pool, jobId, poiIds, sheets = null) {
  console.log(`\n[Trail Status Job ${jobId}] Starting batch processing for ${poiIds.length} trails`);
  logInfo(jobId, 'trail_status', null, null, `Job started: ${poiIds.length} trails`, { total: poiIds.length });

  let geminiCalls = 0;

  try {
    const jobResult = await pool.query(`
      SELECT * FROM trail_status_job_status WHERE id = $1
    `, [jobId]);

    if (jobResult.rows.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }

    const job = jobResult.rows[0];
    const processedPois = new Set(JSON.parse(job.processed_poi_ids || '[]'));

    await pool.query(`
      UPDATE trail_status_job_status
      SET status = 'running', started_at = NOW()
      WHERE id = $1
    `, [jobId]);

    initializeSlots(jobId);

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
        const poiResult = await pool.query(`
          SELECT id, name, poi_roles, status_url, brief_description
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
        const poiResult = await pool.query(`
          SELECT id, name, poi_roles, status_url, brief_description
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
          logInfo(jobId, 'trail_status', poi.id, poi.name, `Status found: ${statusCollection.statusSaved ? 'saved' : 'unchanged'}`, { status_found: statusCollection.statusFound, status_saved: statusCollection.statusSaved, rendered_content: statusCollection.rendered_content, ai_response: statusCollection.ai_response });
        }

        return { statusFound: statusCollection.statusFound, statusSaved: statusCollection.statusSaved, poiName: poi.name };
      },

      checkpointFn: async (poiId, statusOutcome, error) => {
        processedPois.add(poiId);

        if (statusOutcome && !statusOutcome.notFound) {
          totalStatusFound += statusOutcome.statusFound;
          totalStatusSaved += statusOutcome.statusSaved;
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


  } catch (error) {
    console.error(`[Trail Status Job ${jobId}] Failed:`, error.message);
    logError(jobId, 'trail_status', null, null, `Job failed: ${error.message}`);
    await flushJobLogs();

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

export async function getJobStatus(pool, jobId) {
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

export async function getLatestTrailStatus(pool, poiId) {
  const statusQuery = await pool.query(`
    SELECT * FROM trail_status
    WHERE poi_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [poiId]);

  return statusQuery.rows.length > 0 ? statusQuery.rows[0] : null;
}
