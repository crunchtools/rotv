/**
 * Moderation Service
 * LLM-powered content moderation for news, events, and photo submissions.
 * Processes pending items via pg-boss queue, auto-approves high-confidence content.
 */

import { moderateContent, moderatePhoto } from './geminiService.js';

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
    `SELECT key, value FROM admin_settings WHERE key IN ('moderation_auto_approve_enabled', 'moderation_auto_approve_threshold')`
  );
  const settings = Object.fromEntries(settingsRows.rows.map(r => [r.key, r.value]));
  const autoApproveEnabled = settings.moderation_auto_approve_enabled !== 'false';
  const threshold = parseFloat(settings.moderation_auto_approve_threshold) || 0.9;

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

    scoring = await moderateContent(pool, {
      type: 'news',
      title: row.title,
      summary: row.summary,
      source_url: row.source_url,
      poi_name: row.poi_name
    });

    const resolvedStatus = autoApproveEnabled && scoring.confidence_score >= threshold
      ? 'auto_approved' : 'pending';

    await pool.query(
      `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3 WHERE id = $4`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, contentId]
    );

  } else if (contentType === 'event') {
    const eventQuery = await pool.query(
      `SELECT e.id, e.title, e.description, e.source_url, p.name as poi_name
       FROM poi_events e
       LEFT JOIN pois p ON e.poi_id = p.id
       WHERE e.id = $1`, [contentId]
    );
    if (!eventQuery.rows.length) return;
    const row = eventQuery.rows[0];

    scoring = await moderateContent(pool, {
      type: 'event',
      title: row.title,
      summary: row.description,
      source_url: row.source_url,
      poi_name: row.poi_name
    });

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
  if (contentType === 'news') {
    const setClauses = [];
    const values = [adminUserId, contentId];
    let idx = 3;

    if (edits.title) { setClauses.push(`title = $${idx}`); values.push(edits.title); idx++; }
    if (edits.summary) { setClauses.push(`summary = $${idx}`); values.push(edits.summary); idx++; }

    setClauses.push(`moderation_status = 'published'`, `moderated_by = $1`, `moderated_at = CURRENT_TIMESTAMP`);
    await pool.query(`UPDATE poi_news SET ${setClauses.join(', ')} WHERE id = $2`, values);
  } else if (contentType === 'event') {
    const setClauses = [];
    const values = [adminUserId, contentId];
    let idx = 3;

    if (edits.title) { setClauses.push(`title = $${idx}`); values.push(edits.title); idx++; }
    if (edits.description) { setClauses.push(`description = $${idx}`); values.push(edits.description); idx++; }

    setClauses.push(`moderation_status = 'published'`, `moderated_by = $1`, `moderated_at = CURRENT_TIMESTAMP`);
    await pool.query(`UPDATE poi_events SET ${setClauses.join(', ')} WHERE id = $2`, values);
  } else if (contentType === 'photo') {
    const setClauses = [];
    const values = [adminUserId, contentId];
    let idx = 3;

    if (edits.caption) { setClauses.push(`caption = $${idx}`); values.push(edits.caption); idx++; }

    setClauses.push(`moderation_status = 'published'`, `moderated_by = $1`, `moderated_at = CURRENT_TIMESTAMP`);
    await pool.query(`UPDATE photo_submissions SET ${setClauses.join(', ')} WHERE id = $2`, values);
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

export async function getQueue(pool, { page = 1, limit = 20, contentType = null } = {}) {
  const offset = (page - 1) * limit;

  if (contentType) {
    const [queueItems, countRow] = await Promise.all([
      pool.query(`SELECT * FROM moderation_queue WHERE content_type = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [contentType, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM moderation_queue WHERE content_type = $1`, [contentType])
    ]);
    return { items: queueItems.rows, total: parseInt(countRow.rows[0].count), page, limit };
  }

  const [queueItems, countRow] = await Promise.all([
    pool.query(`SELECT * FROM moderation_queue ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
    pool.query(`SELECT COUNT(*) FROM moderation_queue`)
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
