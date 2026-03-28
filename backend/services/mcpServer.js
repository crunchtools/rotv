/**
 * ROTV Admin MCP Server
 * Provides 30 admin tools for managing ROTV content, moderation queue,
 * jobs, newsletters, and settings via the Model Context Protocol.
 *
 * Transport: Streamable HTTP on a separate port (default 3001)
 * Auth: Bearer token from MCP_ADMIN_TOKEN env var
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import http from 'http';
import crypto from 'crypto';

import {
  getQueue,
  getPendingCount,
  getItemDetail,
  approveItem,
  rejectItem,
  requeueItem,
  bulkApprove,
  createItem,
  editAndPublish,
  purgeRejected
} from './moderationService.js';

import {
  getJobStatus as getNewsJobStatus,
  getDisplaySlots as getNewsDisplaySlots,
  cleanupOldNews,
  cleanupPastEvents,
  getLatestJobStatus as getLatestNewsJobStatus
} from './newsService.js';

import {
  getLatestTrailStatus,
  getJobStatus as getTrailJobStatus,
  getDisplaySlots as getTrailDisplaySlots,
  runTrailStatusCollection
} from './trailStatusService.js';

import {
  submitBatchNewsJob,
  queueNewsletterJob
} from './jobScheduler.js';

// Dummy admin user ID for MCP operations (no real user session)
const MCP_ADMIN_USER_ID = null;

/**
 * Register all 30 admin tools on an McpServer instance.
 * Pure metadata registration — no I/O, safe to call per-request.
 */
function registerTools(server, pool, boss) {

  // ============================================================
  // POI Tools (6)
  // ============================================================

  server.tool(
    'poi_list',
    'List POIs with optional type filter',
    { type: z.enum(['point', 'trail', 'river', 'boundary', 'virtual']).optional().describe('Filter by POI type') },
    async ({ type }) => {
      let query = `
        SELECT p.id, p.name, p.poi_type, p.latitude, p.longitude,
               p.brief_description, p.news_url, p.events_url, p.status_url,
               e.name as era_name
        FROM pois p
        LEFT JOIN eras e ON p.era_id = e.id
        WHERE (p.deleted IS NULL OR p.deleted = FALSE)
      `;
      const params = [];
      if (type) {
        params.push(type);
        query += ` AND p.poi_type = $1`;
      }
      query += ` ORDER BY p.poi_type, p.name`;
      const result = await pool.query(query, params);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  server.tool(
    'poi_detail',
    'Full POI detail: name, type, location, description, era, activities, URLs',
    { id: z.number().describe('POI ID') },
    async ({ id }) => {
      const result = await pool.query(`
        SELECT p.*, e.name as era_name, o.name as owner_name
        FROM pois p
        LEFT JOIN eras e ON p.era_id = e.id
        LEFT JOIN pois o ON p.owner_id = o.id AND o.poi_type = 'virtual'
        WHERE p.id = $1
      `, [id]);
      if (result.rows.length === 0) {
        return { content: [{ type: 'text', text: 'POI not found' }], isError: true };
      }
      const row = result.rows[0];
      // Strip binary image data from response
      delete row.image_data;
      delete row.geometry;
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    }
  );

  server.tool(
    'poi_news',
    'News for a POI — admin view includes ALL moderation statuses',
    {
      poi_id: z.number().describe('POI ID'),
      limit: z.number().optional().default(20).describe('Max items to return')
    },
    async ({ poi_id, limit }) => {
      const result = await pool.query(`
        SELECT id, title, summary, source_url, source_name, news_type,
               published_at, moderation_status, confidence_score, content_source, created_at
        FROM poi_news
        WHERE poi_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `, [poi_id, limit]);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  server.tool(
    'poi_events',
    'Events for a POI — admin view includes all statuses, past and future',
    {
      poi_id: z.number().describe('POI ID'),
      limit: z.number().optional().default(20).describe('Max items to return')
    },
    async ({ poi_id, limit }) => {
      const result = await pool.query(`
        SELECT id, title, description, start_date, end_date, event_type,
               location_details, source_url, moderation_status, confidence_score, content_source, created_at
        FROM poi_events
        WHERE poi_id = $1
        ORDER BY start_date DESC
        LIMIT $2
      `, [poi_id, limit]);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  server.tool(
    'poi_status',
    'Trail status (conditions, weather impact, closure) for a POI',
    { poi_id: z.number().describe('POI ID') },
    async ({ poi_id }) => {
      const status = await getLatestTrailStatus(pool, poi_id);
      if (!status) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'unknown', conditions: null }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  server.tool(
    'poi_search',
    'Search POIs by name substring',
    { query: z.string().describe('Name substring to search for') },
    async ({ query }) => {
      const result = await pool.query(`
        SELECT id, name, poi_type, brief_description
        FROM pois
        WHERE (deleted IS NULL OR deleted = FALSE)
          AND LOWER(name) LIKE $1
        ORDER BY name
        LIMIT 50
      `, [`%${query.toLowerCase()}%`]);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  // ============================================================
  // Queue & Moderation Tools (6)
  // ============================================================

  server.tool(
    'queue_list',
    'List moderation queue with filters (status, type, source, page)',
    {
      status: z.enum(['pending', 'published', 'auto_approved', 'rejected', 'approved', 'all']).optional().default('pending').describe('Filter by moderation status'),
      content_type: z.enum(['news', 'event', 'photo']).optional().describe('Filter by content type'),
      content_source: z.string().optional().describe('Filter by content source (ai, human, newsletter)'),
      page: z.number().optional().default(1).describe('Page number'),
      limit: z.number().optional().default(20).describe('Items per page')
    },
    async ({ status, content_type, content_source, page, limit }) => {
      const result = await getQueue(pool, {
        status,
        contentType: content_type || null,
        contentSource: content_source || null,
        page,
        limit
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'queue_counts',
    'Counts of items by moderation status and content type',
    {},
    async () => {
      const pendingCount = await getPendingCount(pool);
      const detailed = await pool.query(`
        SELECT content_type, moderation_status, COUNT(*) as count
        FROM (
          SELECT 'news' AS content_type, moderation_status FROM poi_news
          UNION ALL
          SELECT 'event' AS content_type, moderation_status FROM poi_events
          UNION ALL
          SELECT 'photo' AS content_type, moderation_status FROM photo_submissions
        ) AS q
        GROUP BY content_type, moderation_status
        ORDER BY content_type, moderation_status
      `);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ pending_total: pendingCount, by_type_and_status: detailed.rows }, null, 2)
        }]
      };
    }
  );

  server.tool(
    'queue_item_detail',
    'Full detail for a specific moderation queue item',
    {
      content_type: z.enum(['news', 'event', 'photo']).describe('Content type'),
      id: z.number().describe('Content item ID')
    },
    async ({ content_type, id }) => {
      const item = await getItemDetail(pool, content_type, id);
      if (!item) {
        return { content: [{ type: 'text', text: 'Item not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
    }
  );

  server.tool(
    'queue_approve',
    'Approve a pending moderation item',
    {
      content_type: z.enum(['news', 'event', 'photo']).describe('Content type'),
      id: z.number().describe('Content item ID')
    },
    async ({ content_type, id }) => {
      await approveItem(pool, content_type, id, MCP_ADMIN_USER_ID);
      return { content: [{ type: 'text', text: `Approved ${content_type} #${id}` }] };
    }
  );

  server.tool(
    'queue_reject',
    'Reject a moderation item with reason',
    {
      content_type: z.enum(['news', 'event', 'photo']).describe('Content type'),
      id: z.number().describe('Content item ID'),
      reason: z.string().optional().default('Rejected via MCP admin').describe('Rejection reason')
    },
    async ({ content_type, id, reason }) => {
      await rejectItem(pool, content_type, id, MCP_ADMIN_USER_ID, reason);
      return { content: [{ type: 'text', text: `Rejected ${content_type} #${id}: ${reason}` }] };
    }
  );

  server.tool(
    'queue_requeue',
    'Reset item for re-moderation (clears score and reasoning)',
    {
      content_type: z.enum(['news', 'event', 'photo']).describe('Content type'),
      id: z.number().describe('Content item ID')
    },
    async ({ content_type, id }) => {
      await requeueItem(pool, content_type, id);
      return { content: [{ type: 'text', text: `Requeued ${content_type} #${id} for re-moderation` }] };
    }
  );

  // ============================================================
  // Content Management Tools (4)
  // ============================================================

  server.tool(
    'content_create',
    'Create news/event/photo manually (published immediately)',
    {
      content_type: z.enum(['news', 'event', 'photo']).describe('Content type to create'),
      poi_id: z.number().describe('POI ID to associate with'),
      title: z.string().describe('Title (or filename for photos)'),
      summary: z.string().optional().describe('Summary (news) or description (event) or caption (photo)'),
      source_url: z.string().optional().describe('Source URL'),
      source_name: z.string().optional().describe('Source name (news only)'),
      news_type: z.string().optional().describe('News type: general, alert, wildlife, infrastructure, community'),
      start_date: z.string().optional().describe('Event start date (YYYY-MM-DD)'),
      end_date: z.string().optional().describe('Event end date (YYYY-MM-DD)'),
      event_type: z.string().optional().describe('Event type'),
      location_details: z.string().optional().describe('Event location details')
    },
    async (args) => {
      const fields = {
        poi_id: args.poi_id,
        title: args.title,
        summary: args.summary,
        description: args.summary,
        caption: args.summary,
        source_url: args.source_url,
        source_name: args.source_name,
        news_type: args.news_type,
        start_date: args.start_date,
        end_date: args.end_date,
        event_type: args.event_type,
        location_details: args.location_details
      };
      const newId = await createItem(pool, args.content_type, fields, MCP_ADMIN_USER_ID);
      return { content: [{ type: 'text', text: `Created ${args.content_type} #${newId}` }] };
    }
  );

  server.tool(
    'content_edit',
    'Edit fields on a queue item and publish',
    {
      content_type: z.enum(['news', 'event', 'photo']).describe('Content type'),
      id: z.number().describe('Content item ID'),
      edits: z.record(z.string(), z.any()).describe('Fields to edit (e.g. {title: "new title", summary: "new summary"})')
    },
    async ({ content_type, id, edits }) => {
      await editAndPublish(pool, content_type, id, edits, MCP_ADMIN_USER_ID);
      return { content: [{ type: 'text', text: `Edited and published ${content_type} #${id}` }] };
    }
  );

  server.tool(
    'content_bulk_approve',
    'Approve multiple items at once',
    {
      items: z.array(z.object({
        type: z.enum(['news', 'event', 'photo']),
        id: z.number()
      })).describe('Array of {type, id} objects to approve')
    },
    async ({ items }) => {
      const result = await bulkApprove(pool, items, MCP_ADMIN_USER_ID);
      return { content: [{ type: 'text', text: `Approved ${result.approved} items` }] };
    }
  );

  server.tool(
    'content_cleanup',
    'Remove old news (>N days) or past events (>N days)',
    {
      type: z.enum(['news', 'events']).describe('What to clean up'),
      days_old: z.number().optional().describe('Delete items older than this many days (default: 90 for news, 30 for events)')
    },
    async ({ type, days_old }) => {
      let deleted;
      if (type === 'news') {
        deleted = await cleanupOldNews(pool, days_old || 90);
      } else {
        deleted = await cleanupPastEvents(pool, days_old || 30);
      }
      return { content: [{ type: 'text', text: `Cleaned up ${deleted} old ${type}` }] };
    }
  );

  server.tool(
    'content_purge_rejected',
    'Delete all rejected content items (news, events, photos)',
    {
      content_type: z.enum(['news', 'event', 'photo']).optional().describe('Purge only this type (omit for all)')
    },
    async ({ content_type }) => {
      const result = await purgeRejected(pool, content_type || null);
      return { content: [{ type: 'text', text: `Purged ${result.deleted} rejected items${content_type ? ` (${content_type})` : ''}` }] };
    }
  );

  // ============================================================
  // Jobs & Logs Tools (4)
  // ============================================================

  server.tool(
    'job_list',
    'Recent jobs with status, counts, and timing',
    {
      type: z.enum(['news', 'trail_status']).optional().describe('Filter by job type'),
      limit: z.number().optional().default(10).describe('Max jobs to return')
    },
    async ({ type, limit }) => {
      const results = {};
      if (!type || type === 'news') {
        const newsJobs = await pool.query(`
          SELECT id, job_type, status, started_at, completed_at,
                 total_pois, pois_processed, news_found, events_found, error_message,
                 created_at
          FROM news_job_status
          ORDER BY created_at DESC
          LIMIT $1
        `, [limit]);
        results.news_jobs = newsJobs.rows;
      }
      if (!type || type === 'trail_status') {
        const trailJobs = await pool.query(`
          SELECT id, job_type, status, started_at, completed_at,
                 total_trails, trails_processed, status_found, error_message,
                 created_at
          FROM trail_status_job_status
          ORDER BY created_at DESC
          LIMIT $1
        `, [limit]);
        results.trail_status_jobs = trailJobs.rows;
      }
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    'job_detail',
    'Full job detail including AI usage',
    {
      type: z.enum(['news', 'trail_status']).describe('Job type'),
      job_id: z.number().describe('Job ID')
    },
    async ({ type, job_id }) => {
      let job;
      if (type === 'news') {
        job = await getNewsJobStatus(pool, job_id);
      } else {
        job = await getTrailJobStatus(pool, job_id);
      }
      if (!job) {
        return { content: [{ type: 'text', text: 'Job not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(job, null, 2) }] };
    }
  );

  server.tool(
    'job_slots',
    'Live slot display for running jobs',
    {
      type: z.enum(['news', 'trail_status']).describe('Job type'),
      job_id: z.number().describe('Job ID (news_job_status or trail_status_job_status table ID)')
    },
    async ({ type, job_id }) => {
      let slots;
      if (type === 'news') {
        slots = getNewsDisplaySlots(job_id);
      } else {
        slots = getTrailDisplaySlots(job_id);
      }
      return { content: [{ type: 'text', text: JSON.stringify(slots, null, 2) }] };
    }
  );

  server.tool(
    'job_logs',
    'Recent error messages from job status tables',
    { limit: z.number().optional().default(20).describe('Max log entries') },
    async ({ limit }) => {
      const errors = await pool.query(`
        SELECT 'news' AS job_type, id, status, error_message, created_at
        FROM news_job_status
        WHERE error_message IS NOT NULL AND error_message != ''
        UNION ALL
        SELECT 'trail_status' AS job_type, id, status, error_message, created_at
        FROM trail_status_job_status
        WHERE error_message IS NOT NULL AND error_message != ''
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
      return { content: [{ type: 'text', text: JSON.stringify(errors.rows, null, 2) }] };
    }
  );

  // ============================================================
  // Newsletter Tools (3)
  // ============================================================

  server.tool(
    'newsletter_list',
    'Recent newsletter emails with processing status',
    { limit: z.number().optional().default(20).describe('Max emails to return') },
    async ({ limit }) => {
      const result = await pool.query(`
        SELECT id, from_address, subject, received_at, processed, processed_at,
               error_message, news_extracted, events_extracted
        FROM newsletter_emails
        ORDER BY received_at DESC
        LIMIT $1
      `, [limit]);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  server.tool(
    'newsletter_detail',
    'Full newsletter email content and extraction results',
    { id: z.number().describe('Newsletter email ID') },
    async ({ id }) => {
      const result = await pool.query(`
        SELECT *
        FROM newsletter_emails
        WHERE id = $1
      `, [id]);
      if (result.rows.length === 0) {
        return { content: [{ type: 'text', text: 'Newsletter email not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.rows[0], null, 2) }] };
    }
  );

  server.tool(
    'newsletter_reprocess',
    'Re-queue a newsletter email for reprocessing',
    { id: z.number().describe('Newsletter email ID') },
    async ({ id }) => {
      // Reset processed flag so it will be picked up again
      await pool.query(
        `UPDATE newsletter_emails SET processed = FALSE, error_message = NULL WHERE id = $1`,
        [id]
      );
      await queueNewsletterJob(id);
      return { content: [{ type: 'text', text: `Newsletter email #${id} queued for reprocessing` }] };
    }
  );

  // ============================================================
  // Admin Settings Tools (2)
  // ============================================================

  server.tool(
    'settings_list',
    'View all admin settings (moderation thresholds, toggles)',
    {},
    async () => {
      const result = await pool.query(`
        SELECT key, value, updated_at
        FROM admin_settings
        ORDER BY key
      `);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  server.tool(
    'settings_update',
    'Update an admin setting value',
    {
      key: z.string().describe('Setting key'),
      value: z.string().describe('New value')
    },
    async ({ key, value }) => {
      const result = await pool.query(
        `UPDATE admin_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2 RETURNING key`,
        [value, key]
      );
      if (result.rowCount === 0) {
        return { content: [{ type: 'text', text: `Setting '${key}' not found` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Updated setting '${key}' = '${value}'` }] };
    }
  );

  // ============================================================
  // POI Configuration Tools (2)
  // ============================================================

  server.tool(
    'poi_update_urls',
    'Update news_url, events_url, or status_url for a POI',
    {
      id: z.number().describe('POI ID'),
      news_url: z.string().optional().describe('New news URL'),
      events_url: z.string().optional().describe('New events URL'),
      status_url: z.string().optional().describe('New trail status URL')
    },
    async ({ id, news_url, events_url, status_url }) => {
      const setClauses = [];
      const values = [id];
      let idx = 2;

      if (news_url !== undefined) { setClauses.push(`news_url = $${idx}`); values.push(news_url); idx++; }
      if (events_url !== undefined) { setClauses.push(`events_url = $${idx}`); values.push(events_url); idx++; }
      if (status_url !== undefined) { setClauses.push(`status_url = $${idx}`); values.push(status_url); idx++; }

      if (setClauses.length === 0) {
        return { content: [{ type: 'text', text: 'No URLs provided to update' }], isError: true };
      }

      setClauses.push('updated_at = CURRENT_TIMESTAMP');
      await pool.query(`UPDATE pois SET ${setClauses.join(', ')} WHERE id = $1`, values);
      return { content: [{ type: 'text', text: `Updated URLs for POI #${id}` }] };
    }
  );

  server.tool(
    'poi_associations',
    'View virtual-to-physical POI associations',
    { id: z.number().describe('POI ID (virtual or physical)') },
    async ({ id }) => {
      const result = await pool.query(`
        SELECT a.id, a.virtual_poi_id, a.physical_poi_id, a.association_type,
               vp.name as virtual_poi_name, pp.name as physical_poi_name,
               pp.poi_type as physical_poi_type
        FROM poi_associations a
        LEFT JOIN pois vp ON a.virtual_poi_id = vp.id
        LEFT JOIN pois pp ON a.physical_poi_id = pp.id
        WHERE (a.virtual_poi_id = $1 OR a.physical_poi_id = $1)
          AND (vp.deleted IS NULL OR vp.deleted = FALSE)
          AND (pp.deleted IS NULL OR pp.deleted = FALSE)
        ORDER BY a.created_at DESC
      `, [id]);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  // ============================================================
  // Content Stats Tools (2)
  // ============================================================

  server.tool(
    'stats_content',
    'Counts of news/events/photos by status, source, type',
    {},
    async () => {
      const [byStatus, bySource, newsTypes, eventTypes] = await Promise.all([
        pool.query(`
          SELECT content_type, moderation_status, COUNT(*) as count
          FROM (
            SELECT 'news' AS content_type, moderation_status FROM poi_news
            UNION ALL
            SELECT 'event', moderation_status FROM poi_events
            UNION ALL
            SELECT 'photo', moderation_status FROM photo_submissions
          ) q
          GROUP BY content_type, moderation_status
          ORDER BY content_type, moderation_status
        `),
        pool.query(`
          SELECT content_type, content_source, COUNT(*) as count
          FROM (
            SELECT 'news' AS content_type, content_source FROM poi_news
            UNION ALL
            SELECT 'event', content_source FROM poi_events
          ) q
          GROUP BY content_type, content_source
          ORDER BY content_type, content_source
        `),
        pool.query(`
          SELECT news_type, COUNT(*) as count FROM poi_news
          GROUP BY news_type ORDER BY count DESC
        `),
        pool.query(`
          SELECT event_type, COUNT(*) as count FROM poi_events
          GROUP BY event_type ORDER BY count DESC
        `)
      ]);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            by_status: byStatus.rows,
            by_source: bySource.rows,
            news_types: newsTypes.rows,
            event_types: eventTypes.rows
          }, null, 2)
        }]
      };
    }
  );

  server.tool(
    'stats_newsletter',
    'Newsletter ingestion summary stats',
    {},
    async () => {
      const result = await pool.query(`
        SELECT
          COUNT(*) as total_emails,
          COUNT(*) FILTER (WHERE processed = TRUE) as processed,
          COUNT(*) FILTER (WHERE processed = FALSE) as unprocessed,
          COUNT(*) FILTER (WHERE error_message IS NOT NULL) as errors,
          SUM(COALESCE(news_extracted, 0)) as total_news_extracted,
          SUM(COALESCE(events_extracted, 0)) as total_events_extracted,
          MIN(received_at) as earliest_email,
          MAX(received_at) as latest_email
        FROM newsletter_emails
      `);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows[0], null, 2) }] };
    }
  );

  // ============================================================
  // Admin Actions Tool (1)
  // ============================================================

  server.tool(
    'trigger_collection',
    'Trigger news or trail status collection',
    {
      type: z.enum(['news', 'trail_status']).describe('Collection type to trigger'),
      poi_ids: z.array(z.number()).optional().describe('Specific POI IDs (omit for all)')
    },
    async ({ type, poi_ids }) => {
      if (type === 'news') {
        // Create job record first
        const jobResult = await pool.query(
          `INSERT INTO news_job_status (job_type, status, started_at, created_at)
           VALUES ('batch_collection', 'queued', NOW(), NOW()) RETURNING id`
        );
        const jobId = jobResult.rows[0].id;

        // If no POI IDs given, get all POIs with news/events URLs
        let targetPoiIds = poi_ids;
        if (!targetPoiIds || targetPoiIds.length === 0) {
          const poisResult = await pool.query(`
            SELECT id FROM pois
            WHERE (news_url IS NOT NULL OR events_url IS NOT NULL)
              AND (deleted IS NULL OR deleted = FALSE)
          `);
          targetPoiIds = poisResult.rows.map(r => r.id);
        }

        await pool.query(
          `UPDATE news_job_status SET total_pois = $1 WHERE id = $2`,
          [targetPoiIds.length, jobId]
        );

        await submitBatchNewsJob({ jobId, poiIds: targetPoiIds });
        return { content: [{ type: 'text', text: `News collection job #${jobId} started for ${targetPoiIds.length} POIs` }] };
      } else {
        const result = await runTrailStatusCollection(pool, boss, {
          poiIds: poi_ids || null,
          jobType: 'mcp_triggered'
        });
        return { content: [{ type: 'text', text: `Trail status collection started for ${result.totalTrails} trails (job #${result.jobId})` }] };
      }
    }
  );

}

/**
 * Start the MCP admin server.
 * Creates a fresh McpServer + transport per HTTP request (stateless mode).
 * Tool registration is pure metadata — no I/O overhead.
 *
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {object} boss - pg-boss instance
 * @param {number} port - Port to listen on (default 3001)
 */
export function startMcpServer(pool, boss, port = 3001) {
  const httpServer = http.createServer(async (req, res) => {
    // CORS headers for MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Bearer token auth
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.MCP_ADMIN_TOKEN;
    if (!expectedToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const expected = Buffer.from(expectedToken);
    const provided = Buffer.from(token || '');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Only handle /mcp path
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Create fresh server + transport per request (stateless mode).
    // The MCP SDK's Server.connect() takes exclusive ownership of a transport,
    // so each request needs its own pair.
    const server = new McpServer({ name: 'rotv-admin', version: '1.0.0' });
    registerTools(server, pool, boss);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined  // stateless — no session management
    });

    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`ROTV Admin MCP server running on port ${port}`);
  });

  return httpServer;
}
