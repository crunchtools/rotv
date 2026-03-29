/**
 * Moderation Service
 * LLM-powered content moderation for news, events, and photo submissions.
 * Processes pending items via pg-boss queue, auto-approves high-confidence content.
 */

import { moderateContent, moderatePhoto, createGeminiClient, GEMINI_MODEL } from './geminiService.js';
import { extractPageContent } from './contentExtractor.js';
import { deepCrawlForArticle } from './deepCrawler.js';

const TABLE_MAP = {
  news: 'poi_news',
  event: 'poi_events',
  photo: 'photo_submissions'
};

const REJECTION_ISSUES = ['content_not_on_source_page', 'static_reference_page', 'wrong_poi', 'wrong_geography', 'misclassified_type', 'private_content'];

/**
 * Validate that a URL is a safe, public http/https URL.
 * Blocks internal IPs, localhost, metadata endpoints, and non-http schemes.
 */
function isSafePublicUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    // Block localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
    // Block cloud metadata endpoints
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return false;
    // Block private IP ranges (10.x, 172.16-31.x, 192.168.x)
    const parts = hostname.split('.');
    if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
      const [a, b] = parts.map(Number);
      if (a === 10) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract and validate publication date fields from AI scoring response.
 * Returns { publicationDate, dateConfidence } with safe defaults.
 */
function extractDateFields(scoring) {
  let publicationDate = null;
  let dateConfidence = 'unknown';

  if (scoring.publication_date) {
    // Validate YYYY-MM-DD format strictly — don't trust Date constructor parsing
    const dateStr = String(scoring.publication_date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100) {
        publicationDate = dateStr;
        dateConfidence = scoring.date_confidence || 'estimated';
      }
    }
  } else if (scoring.date_confidence) {
    dateConfidence = scoring.date_confidence;
  }

  // Ensure confidence is a valid enum value
  if (!['exact', 'estimated', 'unknown'].includes(dateConfidence)) {
    dateConfidence = 'unknown';
  }

  return { publicationDate, dateConfidence };
}

async function attemptDeepCrawl(pool, contentType, contentId, row, scoring) {
  const table = TABLE_MAP[contentType];
  const summary = contentType === 'news' ? row.summary : row.description;

  console.log(`[Moderation] ${contentType} #${contentId}: content not on source page, attempting deep crawl...`);
  try {
    const crawlResult = await deepCrawlForArticle(
      row.source_url,
      { title: row.title, summary },
      { maxDepth: 2, maxPages: 5, timeoutMs: 60000 }
    );

    if (crawlResult.foundUrl) {
      console.log(`[Moderation] ${contentType} #${contentId}: deep crawl found article at ${crawlResult.foundUrl}`);
      await pool.query(`UPDATE ${table} SET source_url = $1 WHERE id = $2`, [crawlResult.foundUrl, contentId]);

      scoring = await moderateContent(pool, {
        type: contentType,
        title: row.title,
        summary,
        source_url: crawlResult.foundUrl,
        source_page_content: crawlResult.foundContent,
        poi_name: row.poi_name
      });
    } else {
      console.log(`[Moderation] ${contentType} #${contentId}: deep crawl checked ${crawlResult.pagesChecked} pages, no match`);
      scoring.reasoning += ` Deep crawl checked ${crawlResult.pagesChecked} pages but could not find article.`;
    }
  } catch (crawlError) {
    console.error(`[Moderation] ${contentType} #${contentId}: deep crawl failed: ${crawlError.message}`);
    scoring.reasoning += ` Deep crawl failed: ${crawlError.message}`;
  }

  const issuesList = scoring.issues || [];
  const foundIssue = REJECTION_ISSUES.find(i => issuesList.includes(i));
  return { scoring, foundIssue };
}

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
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected' WHERE id = $3`,
        [scoring.confidence_score, scoring.reasoning, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (no source URL)`);
      return;
    }

    const sourceCheck = await extractPageContent(row.source_url);
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
      source_page_content: sourceCheck.markdown,
      poi_name: row.poi_name
    });

    let issuesList = scoring.issues || [];
    let foundIssue = REJECTION_ISSUES.find(i => issuesList.includes(i));

    if (foundIssue === 'content_not_on_source_page') {
      ({ scoring, foundIssue } = await attemptDeepCrawl(pool, 'news', contentId, row, scoring));
    }

    const { publicationDate: newsPubDate, dateConfidence: newsDateConf } = extractDateFields(scoring);

    if (foundIssue) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4 WHERE id = $5`,
        [scoring.confidence_score, scoring.reasoning, newsPubDate, newsDateConf, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (${foundIssue})`);
      return;
    }

    if (scoring.confidence_score < rejectFloor) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4 WHERE id = $5`,
        [scoring.confidence_score, scoring.reasoning, newsPubDate, newsDateConf, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (score ${scoring.confidence_score} below floor ${rejectFloor})`);
      return;
    }

    // Hold items with unknown publication date for human review regardless of score
    const resolvedStatus = newsDateConf === 'unknown' ? 'pending'
      : autoApproveEnabled && scoring.confidence_score >= threshold ? 'auto_approved'
      : 'pending';

    await pool.query(
      `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3,
       publication_date = $4, date_confidence = $5 WHERE id = $6`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, newsPubDate, newsDateConf, contentId]
    );

  } else if (contentType === 'event') {
    const eventQuery = await pool.query(
      `SELECT e.id, e.title, e.description, e.source_url, e.start_date, e.content_source, p.name as poi_name
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

    if (row.content_source !== 'human' && (!row.source_url || !row.source_url.trim())) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        ['Rejected: non-human event without source URL', contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (non-human, no source URL)`);
      return;
    }

    let eventSourceContent = null;
    if (row.source_url && row.source_url.trim()) {
      const sourceCheck = await extractPageContent(row.source_url);
      if (!sourceCheck.reachable) {
        await pool.query(
          `UPDATE poi_events SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
          [`Rejected: source URL unreachable (${sourceCheck.reason})`, contentId]
        );
        console.log(`[Moderation] event #${contentId}: rejected (source URL unreachable: ${sourceCheck.reason})`);
        return;
      }
      eventSourceContent = sourceCheck.markdown;
    }

    scoring = await moderateContent(pool, {
      type: 'event',
      title: row.title,
      summary: row.description,
      source_url: row.source_url,
      source_page_content: eventSourceContent,
      poi_name: row.poi_name
    });

    let eventIssuesList = scoring.issues || [];
    let eventFoundIssue = REJECTION_ISSUES.find(i => eventIssuesList.includes(i));

    if (eventFoundIssue === 'content_not_on_source_page') {
      ({ scoring, foundIssue: eventFoundIssue } = await attemptDeepCrawl(pool, 'event', contentId, row, scoring));
    }

    const { publicationDate: eventPubDate, dateConfidence: eventDateConf } = extractDateFields(scoring);

    if (eventFoundIssue) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4 WHERE id = $5`,
        [scoring.confidence_score, scoring.reasoning, eventPubDate, eventDateConf, contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (${eventFoundIssue})`);
      return;
    }

    if (scoring.confidence_score < rejectFloor) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4 WHERE id = $5`,
        [scoring.confidence_score, scoring.reasoning, eventPubDate, eventDateConf, contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (score ${scoring.confidence_score} below floor ${rejectFloor})`);
      return;
    }

    // Hold items with unknown publication date for human review regardless of score
    const resolvedStatus = eventDateConf === 'unknown' ? 'pending'
      : autoApproveEnabled && scoring.confidence_score >= threshold ? 'auto_approved'
      : 'pending';

    await pool.query(
      `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3,
       publication_date = $4, date_confidence = $5 WHERE id = $6`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, eventPubDate, eventDateConf, contentId]
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
  const EDITABLE_NEWS = ['title', 'summary', 'source_url', 'source_name', 'news_type', 'poi_id', 'publication_date'];
  const EDITABLE_EVENT = ['title', 'description', 'start_date', 'end_date', 'event_type', 'location_details', 'source_url', 'poi_id', 'publication_date'];
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

  // When admin sets publication_date, mark confidence as 'exact'
  if (edits.publication_date) {
    setClauses.push(`date_confidence = 'exact'`);
  }

  setClauses.push(`moderation_status = 'published'`, `moderated_by = $1`, `moderated_at = CURRENT_TIMESTAMP`);
  await pool.query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $2`, values);
}

export async function createItem(pool, contentType, fields, adminUserId) {
  if (contentType === 'news') {
    const inserted = await pool.query(
      `INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, moderation_status, submitted_by, content_source)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7, 'human') RETURNING id`,
      [fields.poi_id, fields.title, fields.summary || null, fields.source_url || null,
       fields.source_name || null, fields.news_type || 'general', adminUserId]
    );
    return inserted.rows[0].id;
  } else if (contentType === 'event') {
    const inserted = await pool.query(
      `INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url, moderation_status, submitted_by, content_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9, 'human') RETURNING id`,
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

export async function purgeRejected(pool, contentType) {
  if (contentType) {
    const table = TABLE_MAP[contentType];
    if (!table) throw new Error(`Unknown content type: ${contentType}`);
    const result = await pool.query(
      `DELETE FROM ${table} WHERE moderation_status = 'rejected'`
    );
    return { deleted: result.rowCount };
  }
  // Purge all three tables
  let total = 0;
  for (const table of Object.values(TABLE_MAP)) {
    const result = await pool.query(
      `DELETE FROM ${table} WHERE moderation_status = 'rejected'`
    );
    total += result.rowCount;
  }
  return { deleted: total };
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

/**
 * Fix the source URL for a news/event item via Gemini with Google Search grounding.
 * Searches the web to find the correct URL, updates the item, then requeues for moderation.
 */
export async function researchItem(pool, contentType, contentId) {
  if (contentType !== 'news' && contentType !== 'event') {
    throw new Error('Fix URL is only available for news and event items (not photos)');
  }

  const table = TABLE_MAP[contentType];
  const descField = contentType === 'news' ? 'summary' : 'description';

  const itemQuery = await pool.query(
    `SELECT t.id, t.title, t.${descField} AS description, t.source_url, p.name AS poi_name
     FROM ${table} t
     LEFT JOIN pois p ON t.poi_id = p.id
     WHERE t.id = $1`,
    [contentId]
  );
  if (!itemQuery.rows.length) {
    throw new Error(`${contentType} #${contentId} not found`);
  }
  const item = itemQuery.rows[0];
  const oldUrl = item.source_url || null;

  const typeLabel = contentType === 'news' ? 'news article' : 'event';
  const prompt = `Search the web for this ${typeLabel} and tell me what you find:

Title: "${item.title}"
${item.description ? `Description: "${item.description}"` : ''}
${item.poi_name ? `Location/Organization: ${item.poi_name}` : ''}

Tell me: Did you find this specific ${typeLabel}? What website is it on? Is it still available?
Summarize what you found in 1-2 sentences.`;

  console.log(`[Moderation] Fixing URL for ${contentType} #${contentId}: "${item.title}"`);

  const genAI = await createGeminiClient(pool);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0 }
  });

  const generation = await model.generateContent(prompt);
  const response = generation.response;
  const aiNotes = response.text();

  const candidates = response.candidates || [];
  const groundingChunks = candidates[0]?.groundingMetadata?.groundingChunks || [];

  const candidateUrls = [];
  for (const chunk of groundingChunks) {
    let uri = chunk?.web?.uri;
    if (!uri) continue;
    // Vertex AI wraps results in redirect URLs — resolve to actual destination
    if (uri.includes('vertexaisearch.cloud.google.com/grounding-api-redirect')) {
      try {
        const res = await fetch(uri, { method: 'HEAD', redirect: 'manual' });
        uri = res.headers.get('location') || uri;
      } catch (e) {
        console.warn(`[Moderation] Failed to resolve grounding redirect for ${contentType} #${contentId}:`, e.message);
      }
    }
    // SSRF protection: only allow public http/https URLs
    if (!isSafePublicUrl(uri)) {
      console.warn(`[Moderation] Blocked non-public URL from grounding: ${uri}`);
      continue;
    }
    if (uri !== oldUrl) {
      candidateUrls.push(uri);
    }
  }

  console.log(`[Moderation] Fix URL for ${contentType} #${contentId}: found ${candidateUrls.length} candidate URLs from grounding`);
  if (candidateUrls.length > 0) {
    console.log(`[Moderation]   Candidates: ${candidateUrls.join(', ')}`);
  }

  let sourceUrlUpdated = false;
  let newUrl = candidateUrls.length > 0 ? candidateUrls[0] : null;

  if (newUrl && newUrl !== oldUrl) {
    await pool.query(
      `UPDATE ${table} SET source_url = $1 WHERE id = $2`,
      [newUrl, contentId]
    );
    sourceUrlUpdated = true;
    console.log(`[Moderation] Fix URL updated ${contentType} #${contentId}: ${oldUrl || '(none)'} -> ${newUrl}`);
  } else {
    console.log(`[Moderation] Fix URL for ${contentType} #${contentId}: no new URL found`);
  }

  await requeueItem(pool, contentType, contentId);

  return {
    researched: true,
    source_url_updated: sourceUrlUpdated,
    old_url: oldUrl,
    new_url: newUrl,
    ai_notes: aiNotes || null
  };
}

export async function getQueue(pool, { page = 1, limit = 20, contentType = null, status = 'pending', contentSource = null } = {}) {
  const offset = (page - 1) * limit;
  const statusList = status === 'all'
    ? ['pending', 'published', 'auto_approved', 'rejected']
    : status === 'approved'
      ? ['published', 'auto_approved']
      : [status];

  const baseQuery = `
    SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
           moderation_status, confidence_score, ai_reasoning,
           submitted_by, moderated_by, moderated_at, created_at, source_url,
           content_source, publication_date, date_confidence
    FROM poi_news WHERE moderation_status = ANY($1)
    UNION ALL
    SELECT id, 'event' AS content_type, poi_id, title, description,
           moderation_status, confidence_score, ai_reasoning,
           submitted_by, moderated_by, moderated_at, created_at, source_url,
           content_source, publication_date, date_confidence
    FROM poi_events WHERE moderation_status = ANY($1)
    UNION ALL
    SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
           moderation_status, confidence_score, ai_reasoning,
           submitted_by, moderated_by, moderated_at, created_at, NULL AS source_url,
           NULL AS content_source, NULL::DATE AS publication_date, NULL::VARCHAR AS date_confidence
    FROM photo_submissions WHERE moderation_status = ANY($1)`;

  const filters = [];
  const params = [statusList];
  let paramIdx = 2;

  if (contentType) {
    filters.push(`content_type = $${paramIdx}`);
    params.push(contentType);
    paramIdx++;
  }
  if (contentSource) {
    filters.push(`content_source = $${paramIdx}`);
    params.push(contentSource);
    paramIdx++;
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const wrappedQuery = `SELECT * FROM (${baseQuery}) AS q ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
  const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS q ${whereClause}`;

  params.push(limit, offset);
  const countParams = params.slice(0, -2); // count query doesn't need limit/offset

  const [queueItems, countRow] = await Promise.all([
    pool.query(wrappedQuery, params),
    pool.query(countQuery, countParams)
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
