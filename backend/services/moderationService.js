/**
 * Moderation Service
 * LLM-powered content moderation for news, events, and photo submissions.
 * Processes pending items via pg-boss queue, auto-approves high-confidence content.
 */

import { moderateContent, moderatePhoto } from './geminiService.js';

async function fetchSourceContent(url) {
  if (!url || !url.trim()) return { reachable: false, reason: 'no source URL', content: null };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'ROTV-Moderation/1.0' },
      redirect: 'follow'
    });
    clearTimeout(timeout);
    if (!response.ok) return { reachable: false, reason: `HTTP ${response.status}`, content: null };
    const html = await response.text();
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    return { reachable: true, content: textContent };
  } catch (error) {
    return { reachable: false, reason: error.name === 'AbortError' ? 'timeout' : error.message, content: null };
  }
}

const TABLE_MAP = {
  news: 'poi_news',
  event: 'poi_events',
  photo: 'photo_submissions'
};

/**
 * Process a single moderation item (called by pg-boss worker)
 * @param {Pool} pool - Database connection pool
 * @param {string} contentType - 'news', 'event', or 'photo'
 * @param {number} contentId - ID of the content to moderate
 */
export async function processItem(pool, contentType, contentId) {
  console.log(`[Moderation] Processing ${contentType} #${contentId}`);

  const settingsRows = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key IN ('moderation_auto_approve_enabled', 'moderation_auto_approve_threshold', 'moderation_auto_reject_floor')`
  );
  const settings = Object.fromEntries(settingsRows.rows.map(r => [r.key, r.value]));
  const autoApproveEnabled = settings.moderation_auto_approve_enabled !== 'false';
  const threshold = parseFloat(settings.moderation_auto_approve_threshold) || 0.9;
  const rejectFloor = parseFloat(settings.moderation_auto_reject_floor) || 0.5;

  let scoring;

  if (contentType === 'news') {
    const newsQuery = await pool.query(
      `SELECT n.id, n.title, n.summary, n.source_url, p.name as poi_name
       FROM poi_news n
       LEFT JOIN pois p ON n.poi_id = p.id
       WHERE n.id = $1`, [contentId]
    );
    if (!newsQuery.rows.length) return;
    const row = newsQuery.rows[0];

    const dupCheck = await pool.query(
      `SELECT id FROM poi_news WHERE LOWER(title) = LOWER($1) AND id != $2
       AND moderation_status IN ('published', 'auto_approved') LIMIT 1`,
      [row.title, contentId]
    );
    if (dupCheck.rows.length) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        [`Rejected: duplicate of approved news #${dupCheck.rows[0].id}`, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (duplicate of #${dupCheck.rows[0].id})`);
      return;
    }

    if (!row.source_url || !row.source_url.trim()) {
      scoring = { confidence_score: 0, reasoning: 'Rejected: no source URL (Read More link required)', issues: ['missing_source_url'] };
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'pending' WHERE id = $3`,
        [scoring.confidence_score, scoring.reasoning, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (no source URL)`);
      return;
    }

    const sourceCheck = await fetchSourceContent(row.source_url);
    if (!sourceCheck.reachable) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        [`Rejected: source URL unreachable (${sourceCheck.reason})`, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (source URL unreachable: ${sourceCheck.reason})`);
      return;
    }

    scoring = await moderateContent(pool, {
      type: 'news',
      title: row.title,
      summary: row.summary,
      source_url: row.source_url,
      source_page_content: sourceCheck.content,
      poi_name: row.poi_name
    });

    const issuesList = scoring.issues || [];
    const rejectionIssues = ['content_not_on_source_page', 'static_reference_page', 'wrong_poi', 'wrong_geography', 'misclassified_type', 'private_content'];
    const foundIssue = rejectionIssues.find(i => issuesList.includes(i));
    if (foundIssue) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected' WHERE id = $3`,
        [scoring.confidence_score, scoring.reasoning, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (${foundIssue})`);
      return;
    }

    if (scoring.confidence_score < rejectFloor) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected' WHERE id = $3`,
        [scoring.confidence_score, scoring.reasoning, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (score ${scoring.confidence_score} below floor ${rejectFloor})`);
      return;
    }

    const resolvedStatus = autoApproveEnabled && scoring.confidence_score >= threshold
      ? 'auto_approved' : 'pending';

    await pool.query(
      `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3 WHERE id = $4`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, contentId]
    );

  } else if (contentType === 'event') {
    const eventQuery = await pool.query(
      `SELECT e.id, e.title, e.description, e.source_url, e.start_date, e.ai_generated, p.name as poi_name
       FROM poi_events e
       LEFT JOIN pois p ON e.poi_id = p.id
       WHERE e.id = $1`, [contentId]
    );
    if (!eventQuery.rows.length) return;
    const row = eventQuery.rows[0];

    const dupCheck = await pool.query(
      `SELECT id FROM poi_events WHERE LOWER(title) = LOWER($1) AND start_date = $2 AND id != $3
       AND moderation_status IN ('published', 'auto_approved') LIMIT 1`,
      [row.title, row.start_date, contentId]
    );
    if (dupCheck.rows.length) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        [`Rejected: duplicate of approved event #${dupCheck.rows[0].id}`, contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (duplicate of #${dupCheck.rows[0].id})`);
      return;
    }

    if (row.ai_generated && (!row.source_url || !row.source_url.trim())) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        ['Rejected: AI-generated event without source URL', contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (AI-generated, no source URL)`);
      return;
    }

    let eventSourceContent = null;
    if (row.source_url && row.source_url.trim()) {
      const sourceCheck = await fetchSourceContent(row.source_url);
      if (!sourceCheck.reachable) {
        await pool.query(
          `UPDATE poi_events SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
          [`Rejected: source URL unreachable (${sourceCheck.reason})`, contentId]
        );
        console.log(`[Moderation] event #${contentId}: rejected (source URL unreachable: ${sourceCheck.reason})`);
        return;
      }
      eventSourceContent = sourceCheck.content;
    }

    scoring = await moderateContent(pool, {
      type: 'event',
      title: row.title,
      summary: row.description,
      source_url: row.source_url,
      source_page_content: eventSourceContent,
      poi_name: row.poi_name
    });

    const issuesList = scoring.issues || [];
    const rejectionIssues = ['content_not_on_source_page', 'static_reference_page', 'wrong_poi', 'wrong_geography', 'misclassified_type', 'private_content'];
    const foundIssue = rejectionIssues.find(i => issuesList.includes(i));
    if (foundIssue) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected' WHERE id = $3`,
        [scoring.confidence_score, scoring.reasoning, contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (${foundIssue})`);
      return;
    }

    if (scoring.confidence_score < rejectFloor) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected' WHERE id = $3`,
        [scoring.confidence_score, scoring.reasoning, contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (score ${scoring.confidence_score} below floor ${rejectFloor})`);
      return;
    }

    const resolvedStatus = autoApproveEnabled && scoring.confidence_score >= threshold
      ? 'auto_approved' : 'pending';

    await pool.query(
      `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3 WHERE id = $4`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, contentId]
    );

  } else if (contentType === 'photo') {
    const photoQuery = await pool.query(
      `SELECT ps.id, ps.image_server_asset_id, ps.poi_id, p.name as poi_name
       FROM photo_submissions ps
       LEFT JOIN pois p ON ps.poi_id = p.id
       WHERE ps.id = $1`, [contentId]
    );
    if (!photoQuery.rows.length) return;
    const row = photoQuery.rows[0];

    const imageUrl = row.image_server_asset_id
      ? `${process.env.IMAGE_SERVER_URL || 'http://10.89.2.100:8000'}/api/assets/${row.image_server_asset_id}/file`
      : null;

    scoring = await moderatePhoto(pool, {
      poi_name: row.poi_name,
      image_url: imageUrl
    });

    const resolvedStatus = autoApproveEnabled && scoring.confidence_score >= threshold
      ? 'auto_approved' : 'pending';

    await pool.query(
      `UPDATE photo_submissions SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3 WHERE id = $4`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, contentId]
    );
  }

  console.log(`[Moderation] ${contentType} #${contentId}: score=${scoring?.confidence_score}`);
}

/**
 * Process all unscored pending items (sweep job, runs every 15 minutes)
 */
export async function processPendingItems(pool) {
  const enabledQuery = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'moderation_enabled'"
  );
  if (enabledQuery.rows.length && enabledQuery.rows[0].value === 'false') {
    console.log('[Moderation] Moderation disabled, skipping sweep');
    return { processed: 0 };
  }

  let processed = 0;

  const pendingNews = await pool.query(
    `SELECT id FROM poi_news WHERE moderation_status = 'pending' AND confidence_score IS NULL LIMIT 20`
  );
  for (const row of pendingNews.rows) {
    try {
      await processItem(pool, 'news', row.id);
      processed++;
    } catch (error) {
      console.error(`[Moderation] Failed to process news #${row.id}:`, error.message);
    }
  }

  const pendingEvents = await pool.query(
    `SELECT id FROM poi_events WHERE moderation_status = 'pending' AND confidence_score IS NULL LIMIT 20`
  );
  for (const row of pendingEvents.rows) {
    try {
      await processItem(pool, 'event', row.id);
      processed++;
    } catch (error) {
      console.error(`[Moderation] Failed to process event #${row.id}:`, error.message);
    }
  }

  const pendingPhotos = await pool.query(
    `SELECT id FROM photo_submissions WHERE moderation_status = 'pending' AND confidence_score IS NULL LIMIT 20`
  );
  for (const row of pendingPhotos.rows) {
    try {
      await processItem(pool, 'photo', row.id);
      processed++;
    } catch (error) {
      console.error(`[Moderation] Failed to process photo #${row.id}:`, error.message);
    }
  }

  console.log(`[Moderation] Sweep complete: ${processed} items processed`);
  return { processed };
}

/**
 * Set moderation_status to 'published' for a content item
 */
export async function approveItem(pool, contentType, contentId, adminUserId) {
  const table = TABLE_MAP[contentType];
  await pool.query(
    `UPDATE ${table} SET moderation_status = 'published', moderated_by = $1, moderated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [adminUserId, contentId]
  );
}

export async function rejectItem(pool, contentType, contentId, adminUserId, reason) {
  const table = TABLE_MAP[contentType];
  await pool.query(
    `UPDATE ${table}
     SET moderation_status = 'rejected', moderated_by = $1, moderated_at = CURRENT_TIMESTAMP,
         ai_reasoning = COALESCE(ai_reasoning, '') || E'\n--- Admin rejection: ' || $3
     WHERE id = $2`,
    [adminUserId, contentId, reason || 'Rejected by admin']
  );
}

export async function bulkApprove(pool, items, adminUserId) {
  let approved = 0;
  for (const { type, id } of items) {
    const table = TABLE_MAP[type];
    await pool.query(
      `UPDATE ${table} SET moderation_status = 'published', moderated_by = $1, moderated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [adminUserId, id]
    );
    approved++;
  }
  return { approved };
}

export async function editAndPublish(pool, contentType, contentId, edits, adminUserId) {
  const EDITABLE_NEWS = ['title', 'summary', 'source_url', 'source_name', 'news_type', 'poi_id'];
  const EDITABLE_EVENT = ['title', 'description', 'start_date', 'end_date', 'event_type', 'location_details', 'source_url', 'poi_id'];
  const EDITABLE_PHOTO = ['caption', 'poi_id'];

  const allowedFields = contentType === 'news' ? EDITABLE_NEWS
    : contentType === 'event' ? EDITABLE_EVENT : EDITABLE_PHOTO;
  const table = TABLE_MAP[contentType];

  const setClauses = [];
  const values = [adminUserId, contentId];
  let idx = 3;

  for (const field of allowedFields) {
    if (edits[field] !== undefined) {
      setClauses.push(`${field} = $${idx}`);
      values.push(edits[field]);
      idx++;
    }
  }

  setClauses.push(`moderation_status = 'published'`, `moderated_by = $1`, `moderated_at = CURRENT_TIMESTAMP`);
  await pool.query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $2`, values);
}

export async function createItem(pool, contentType, fields, adminUserId) {
  if (contentType === 'news') {
    const inserted = await pool.query(
      `INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, moderation_status, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7) RETURNING id`,
      [fields.poi_id, fields.title, fields.summary || null, fields.source_url || null,
       fields.source_name || null, fields.news_type || 'general', adminUserId]
    );
    return inserted.rows[0].id;
  } else if (contentType === 'event') {
    const inserted = await pool.query(
      `INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url, moderation_status, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9) RETURNING id`,
      [fields.poi_id, fields.title, fields.description || null, fields.start_date,
       fields.end_date || null, fields.event_type || null, fields.location_details || null,
       fields.source_url || null, adminUserId]
    );
    return inserted.rows[0].id;
  } else if (contentType === 'photo') {
    const inserted = await pool.query(
      `INSERT INTO photo_submissions (poi_id, caption, moderation_status, submitted_by)
       VALUES ($1, $2, 'published', $3) RETURNING id`,
      [fields.poi_id, fields.caption || null, adminUserId]
    );
    return inserted.rows[0].id;
  }
}

export async function requeueItem(pool, contentType, contentId) {
  const table = TABLE_MAP[contentType];
  await pool.query(
    `UPDATE ${table}
     SET moderation_status = 'pending', confidence_score = NULL, ai_reasoning = NULL,
         moderated_by = NULL, moderated_at = NULL
     WHERE id = $1`,
    [contentId]
  );
}

export async function getQueue(pool, { page = 1, limit = 20, contentType = null, status = 'pending' } = {}) {
  const offset = (page - 1) * limit;
  const statusList = status === 'all'
    ? ['pending', 'published', 'auto_approved', 'rejected']
    : status === 'approved'
      ? ['published', 'auto_approved']
      : [status];

  const baseQuery = `
    SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
           moderation_status, confidence_score, ai_reasoning,
           submitted_by, moderated_by, moderated_at, created_at, source_url
    FROM poi_news WHERE moderation_status = ANY($1)
    UNION ALL
    SELECT id, 'event' AS content_type, poi_id, title, description,
           moderation_status, confidence_score, ai_reasoning,
           submitted_by, moderated_by, moderated_at, created_at, source_url
    FROM poi_events WHERE moderation_status = ANY($1)
    UNION ALL
    SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
           moderation_status, confidence_score, ai_reasoning,
           submitted_by, moderated_by, moderated_at, created_at, NULL AS source_url
    FROM photo_submissions WHERE moderation_status = ANY($1)`;

  if (contentType) {
    const wrappedQuery = `SELECT * FROM (${baseQuery}) AS q WHERE content_type = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
    const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS q WHERE content_type = $2`;
    const [queueItems, countRow] = await Promise.all([
      pool.query(wrappedQuery, [statusList, contentType, limit, offset]),
      pool.query(countQuery, [statusList, contentType])
    ]);
    return { items: queueItems.rows, total: parseInt(countRow.rows[0].count), page, limit };
  }

  const wrappedQuery = `SELECT * FROM (${baseQuery}) AS q ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
  const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS q`;
  const [queueItems, countRow] = await Promise.all([
    pool.query(wrappedQuery, [statusList, limit, offset]),
    pool.query(countQuery, [statusList])
  ]);
  return { items: queueItems.rows, total: parseInt(countRow.rows[0].count), page, limit };
}

export async function getPendingCount(pool) {
  const countRow = await pool.query(`SELECT COUNT(*) FROM moderation_queue`);
  return parseInt(countRow.rows[0].count);
}

export async function getItemDetail(pool, contentType, contentId) {
  const queryMap = {
    news: `SELECT n.*, p.name as poi_name FROM poi_news n LEFT JOIN pois p ON n.poi_id = p.id WHERE n.id = $1`,
    event: `SELECT e.*, p.name as poi_name FROM poi_events e LEFT JOIN pois p ON e.poi_id = p.id WHERE e.id = $1`,
    photo: `SELECT ps.*, p.name as poi_name FROM photo_submissions ps LEFT JOIN pois p ON ps.poi_id = p.id WHERE ps.id = $1`
  };

  const sql = queryMap[contentType];
  if (!sql) return null;

  const detailQuery = await pool.query(sql, [contentId]);
  return detailQuery.rows[0] || null;
}
