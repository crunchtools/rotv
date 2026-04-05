/**
 * Moderation Service
 * LLM-powered content moderation for news, events, and photo submissions.
 * Processes pending items via pg-boss queue, auto-approves high-confidence content.
 */

import { moderateContent, moderatePhoto, createGeminiClient, GEMINI_MODEL } from './geminiService.js';
import { extractPageContent } from './contentExtractor.js';
import { deepCrawlForArticle, isGenericUrl } from './deepCrawler.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';

const TABLE_MAP = {
  news: 'poi_news',
  event: 'poi_events',
  photo: 'poi_media' // Updated for multi-image support (Issue #181)
};

const REJECTION_ISSUES = ['content_not_on_source_page', 'static_reference_page', 'wrong_poi', 'wrong_geography', 'misclassified_type', 'private_content'];

/**
 * Determine domain reputation for quality filtering.
 * @param {string} url - URL to check
 * @param {Array<string>} trustedDomains - List of trusted domains (default: empty)
 * @param {Array<string>} competitorDomains - List of competitor/scam domains (default: empty)
 * @returns {'trusted'|'competitor'|'unknown'}
 */
export function getDomainReputation(url, trustedDomains = [], competitorDomains = []) {
  if (!url) return 'unknown';
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const trustedSet = new Set(trustedDomains.map(d => d.toLowerCase()));
    const competitorSet = new Set(competitorDomains.map(d => d.toLowerCase()));

    if (trustedSet.has(hostname)) return 'trusted';
    if (competitorSet.has(hostname)) return 'competitor';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

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

/**
 * Apply quality filters to AI scoring before auto-approval decision.
 * Multiplicative penalties for domain reputation, URL quality, and date confidence.
 * @param {Object} scoring - AI scoring object with confidence_score, reasoning, issues
 * @param {string} sourceUrl - Source URL to validate
 * @param {Object} dateInfo - { publicationDate, dateConfidence }
 * @param {Array<string>} trustedDomains - List of trusted domains (default: empty)
 * @param {Array<string>} competitorDomains - List of competitor/scam domains (default: empty)
 * @returns {Object} Modified scoring object
 */
export function applyQualityFilters(scoring, sourceUrl, dateInfo, trustedDomains = [], competitorDomains = []) {
  const { publicationDate, dateConfidence } = dateInfo;

  // Filter 1: Domain reputation
  const reputation = getDomainReputation(sourceUrl, trustedDomains, competitorDomains);
  if (reputation === 'competitor') {
    scoring.confidence_score *= 0.3;
    scoring.reasoning += ' Source is a competitor aggregator site.';
    if (!scoring.issues) scoring.issues = [];
    scoring.issues.push('competitor_domain');
  } else if (reputation === 'unknown') {
    scoring.confidence_score *= 0.9;
  }

  // Filter 2: URL validation
  if (isGenericUrl(sourceUrl)) {
    scoring.confidence_score *= 0.6;
    scoring.reasoning += ' Source URL is a bare homepage or generic path.';
    if (!scoring.issues) scoring.issues = [];
    scoring.issues.push('generic_url');
  }

  // Filter 3: Date confidence penalty
  if (!publicationDate || dateConfidence === 'unknown') {
    scoring.confidence_score = Math.min(scoring.confidence_score, 0.7);
    scoring.reasoning += ' No publication date found - capping confidence at 0.70.';
  }

  return scoring;
}

/**
 * Serialize issues array to JSON string for storage.
 */
function serializeIssues(scoring) {
  const issues = scoring.issues || [];
  return issues.length > 0 ? JSON.stringify(issues) : null;
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
export async function processItem(pool, contentType, contentId, { forceStatus = null, runId = null } = {}) {
  const itemRunId = runId || Math.floor(Date.now() / 1000);
  console.log(`[Moderation] Processing ${contentType} #${contentId}${forceStatus ? ` (forced → ${forceStatus})` : ''}`);

  const settingsRows = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key IN ('moderation_auto_approve_enabled', 'moderation_auto_approve_threshold', 'moderation_auto_reject_floor', 'moderation_trusted_domains', 'moderation_competitor_domains')`
  );
  const settings = Object.fromEntries(settingsRows.rows.map(r => [r.key, r.value]));
  const autoApproveEnabled = settings.moderation_auto_approve_enabled !== 'false';
  const threshold = parseFloat(settings.moderation_auto_approve_threshold) || 0.9;
  const rejectFloor = parseFloat(settings.moderation_auto_reject_floor) || 0.5;

  // Parse domain lists from settings (stored as JSON arrays)
  let trustedDomains = [];
  let competitorDomains = [];
  try {
    trustedDomains = JSON.parse(settings.moderation_trusted_domains || '[]');
  } catch (e) {
    console.warn('[Moderation] Failed to parse moderation_trusted_domains:', e.message);
  }
  try {
    competitorDomains = JSON.parse(settings.moderation_competitor_domains || '[]');
  } catch (e) {
    console.warn('[Moderation] Failed to parse moderation_competitor_domains:', e.message);
  }

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
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected news #${contentId}: duplicate of #${dupCheck.rows[0].id}`, { completed: true });
      return;
    }

    if (!row.source_url || !row.source_url.trim()) {
      scoring = { confidence_score: 0, reasoning: 'Rejected: no source URL (Read More link required)', issues: ['missing_source_url'] };
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected' WHERE id = $3`,
        [scoring.confidence_score, scoring.reasoning, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (no source URL)`);
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected news #${contentId}: no source URL`, { completed: true });
      return;
    }

    const sourceCheck = await extractPageContent(row.source_url);
    if (!sourceCheck.reachable) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        [`Rejected: source URL unreachable (${sourceCheck.reason})`, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (source URL unreachable: ${sourceCheck.reason})`);
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected news #${contentId}: URL unreachable (${sourceCheck.reason})`, { completed: true });
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

    // Extract date fields before quality filters
    const { publicationDate: newsPubDate, dateConfidence: newsDateConf } = extractDateFields(scoring);

    // Apply quality filters to adjust confidence_score
    scoring = applyQualityFilters(scoring, row.source_url, { publicationDate: newsPubDate, dateConfidence: newsDateConf }, trustedDomains, competitorDomains);

    // Re-serialize issues after quality filters
    const newsIssuesJson = serializeIssues(scoring);

    // Re-check issues list after quality filters may have added new issues
    issuesList = scoring.issues || [];
    foundIssue = REJECTION_ISSUES.find(i => issuesList.includes(i));

    if (foundIssue) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4, ai_issues = $5 WHERE id = $6`,
        [scoring.confidence_score, scoring.reasoning, newsPubDate, newsDateConf, newsIssuesJson, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (${foundIssue})`);
      return;
    }

    if (scoring.confidence_score < rejectFloor) {
      await pool.query(
        `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4, ai_issues = $5 WHERE id = $6`,
        [scoring.confidence_score, scoring.reasoning, newsPubDate, newsDateConf, newsIssuesJson, contentId]
      );
      console.log(`[Moderation] news #${contentId}: rejected (score ${scoring.confidence_score} below floor ${rejectFloor})`);
      return;
    }

    // Hold items with unknown publication date for human review regardless of score
    const resolvedStatus = forceStatus ? forceStatus
      : newsDateConf === 'unknown' ? 'pending'
      : autoApproveEnabled && scoring.confidence_score >= threshold ? 'auto_approved'
      : 'pending';

    await pool.query(
      `UPDATE poi_news SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3,
       publication_date = $4, date_confidence = $5, ai_issues = $6 WHERE id = $7`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, newsPubDate, newsDateConf, newsIssuesJson, contentId]
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
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected event #${contentId}: duplicate of #${dupCheck.rows[0].id}`, { completed: true });
      return;
    }

    if (row.content_source !== 'human' && (!row.source_url || !row.source_url.trim())) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = 0, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        ['Rejected: non-human event without source URL', contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (non-human, no source URL)`);
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected event #${contentId}: no source URL`, { completed: true });
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
        logInfo(itemRunId, 'moderation', null, row.title, `Rejected event #${contentId}: URL unreachable (${sourceCheck.reason})`, { completed: true });
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

    // Extract date fields before quality filters
    const { publicationDate: eventPubDate, dateConfidence: eventDateConf } = extractDateFields(scoring);

    // Apply quality filters to adjust confidence_score
    scoring = applyQualityFilters(scoring, row.source_url, { publicationDate: eventPubDate, dateConfidence: eventDateConf }, trustedDomains, competitorDomains);

    // Re-serialize issues after quality filters
    const eventIssuesJson = serializeIssues(scoring);

    // Re-check issues list after quality filters may have added new issues
    eventIssuesList = scoring.issues || [];
    eventFoundIssue = REJECTION_ISSUES.find(i => eventIssuesList.includes(i));

    if (eventFoundIssue) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4, ai_issues = $5 WHERE id = $6`,
        [scoring.confidence_score, scoring.reasoning, eventPubDate, eventDateConf, eventIssuesJson, contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (${eventFoundIssue})`);
      return;
    }

    if (scoring.confidence_score < rejectFloor) {
      await pool.query(
        `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = 'rejected',
         publication_date = $3, date_confidence = $4, ai_issues = $5 WHERE id = $6`,
        [scoring.confidence_score, scoring.reasoning, eventPubDate, eventDateConf, eventIssuesJson, contentId]
      );
      console.log(`[Moderation] event #${contentId}: rejected (score ${scoring.confidence_score} below floor ${rejectFloor})`);
      return;
    }

    // Hold items with unknown publication date for human review regardless of score
    const resolvedStatus = forceStatus ? forceStatus
      : eventDateConf === 'unknown' ? 'pending'
      : autoApproveEnabled && scoring.confidence_score >= threshold ? 'auto_approved'
      : 'pending';

    await pool.query(
      `UPDATE poi_events SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3,
       publication_date = $4, date_confidence = $5, ai_issues = $6 WHERE id = $7`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, eventPubDate, eventDateConf, eventIssuesJson, contentId]
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

    const resolvedStatus = forceStatus ? forceStatus
      : autoApproveEnabled && scoring.confidence_score >= threshold
      ? 'auto_approved' : 'pending';

    await pool.query(
      `UPDATE photo_submissions SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3 WHERE id = $4`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, contentId]
    );
  }

  const decision = scoring?.confidence_score >= threshold ? 'auto_approved'
    : scoring?.confidence_score < rejectFloor ? 'rejected' : 'pending';
  console.log(`[Moderation] ${contentType} #${contentId}: score=${scoring?.confidence_score}`);
  logInfo(itemRunId || 0, 'moderation', null, null,
    `Score ${contentType} #${contentId}: ${scoring?.confidence_score?.toFixed(2)} → ${decision}`,
    { content_type: contentType, content_id: contentId, score: scoring?.confidence_score, decision });
}

/**
 * Process all unscored pending items (sweep job, runs every 15 minutes)
 */
export async function processPendingItems(pool) {
  const runId = Math.floor(Date.now() / 1000);
  const enabledQuery = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'moderation_enabled'"
  );
  if (enabledQuery.rows.length && enabledQuery.rows[0].value === 'false') {
    console.log('[Moderation] Moderation disabled, skipping sweep');
    return { processed: 0 };
  }

  const pendingNews = await pool.query(
    `SELECT id FROM poi_news WHERE moderation_status = 'pending' AND confidence_score IS NULL LIMIT 20`
  );
  const pendingEvents = await pool.query(
    `SELECT id FROM poi_events WHERE moderation_status = 'pending' AND confidence_score IS NULL LIMIT 20`
  );
  const pendingPhotos = await pool.query(
    `SELECT id FROM photo_submissions WHERE moderation_status = 'pending' AND confidence_score IS NULL LIMIT 20`
  );
  const totalPending = pendingNews.rows.length + pendingEvents.rows.length + pendingPhotos.rows.length;

  if (totalPending === 0) {
    console.log('[Moderation] Sweep complete: 0 items processed');
    return { processed: 0 };
  }

  logInfo(runId, 'moderation', null, null, `Sweep starting: ${totalPending} unscored items (${pendingNews.rows.length} news, ${pendingEvents.rows.length} events, ${pendingPhotos.rows.length} photos)`);

  let processed = 0;
  for (const row of pendingNews.rows) {
    try {
      await processItem(pool, 'news', row.id, { runId });
      processed++;
    } catch (error) {
      logError(runId, 'moderation', null, null, `Failed to process news #${row.id}: ${error.message}`);
      console.error(`[Moderation] Failed to process news #${row.id}:`, error.message);
    }
  }

  for (const row of pendingEvents.rows) {
    try {
      await processItem(pool, 'event', row.id, { runId });
      processed++;
    } catch (error) {
      logError(runId, 'moderation', null, null, `Failed to process event #${row.id}: ${error.message}`);
      console.error(`[Moderation] Failed to process event #${row.id}:`, error.message);
    }
  }

  for (const row of pendingPhotos.rows) {
    try {
      await processItem(pool, 'photo', row.id, { runId });
      processed++;
    } catch (error) {
      logError(runId, 'moderation', null, null, `Failed to process photo #${row.id}: ${error.message}`);
      console.error(`[Moderation] Failed to process photo #${row.id}:`, error.message);
    }
  }

  logInfo(runId, 'moderation', null, null, `Sweep complete: ${processed}/${totalPending} processed`, { completed: true, pending: totalPending, processed });
  await flushJobLogs();
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

export async function editAndPublish(pool, contentType, contentId, edits, adminUserId, { publish = true } = {}) {
  const EDITABLE_NEWS = ['title', 'summary', 'source_url', 'source_name', 'news_type', 'poi_id', 'publication_date'];
  const EDITABLE_EVENT = ['title', 'description', 'start_date', 'end_date', 'event_type', 'location_details', 'source_url', 'poi_id', 'publication_date'];
  const EDITABLE_PHOTO = ['caption', 'poi_id'];

  const allowedFields = contentType === 'news' ? EDITABLE_NEWS
    : contentType === 'event' ? EDITABLE_EVENT : EDITABLE_PHOTO;
  const table = TABLE_MAP[contentType];

  console.log('[editAndPublish]', { contentType, contentId, edits, table, allowedFields });

  const setClauses = [];
  const values = [contentId];
  let idx = 2;

  const DATE_FIELDS = ['publication_date', 'start_date', 'end_date'];
  for (const field of allowedFields) {
    if (edits[field] !== undefined) {
      setClauses.push(`${field} = $${idx}`);
      // Coerce empty strings to null for date/timestamp columns
      values.push(DATE_FIELDS.includes(field) && edits[field] === '' ? null : edits[field]);
      idx++;
    }
  }

  // When admin sets publication_date, mark confidence as 'exact' (only for news/events, not photos)
  if (edits.publication_date && contentType !== 'photo') {
    setClauses.push(`date_confidence = 'exact'`);
  }

  if (publish) {
    setClauses.push(`moderation_status = 'published'`, `moderated_by = $${idx}`, `moderated_at = CURRENT_TIMESTAMP`);
    values.push(adminUserId);
    idx++;
  }

  if (setClauses.length === 0) return;
  console.log('[editAndPublish] SQL:', `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1`, values);
  await pool.query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1`, values);
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
  const runId = Math.floor(Date.now() / 1000);
  if (contentType) {
    const table = TABLE_MAP[contentType];
    if (!table) throw new Error(`Unknown content type: ${contentType}`);
    const result = await pool.query(
      `DELETE FROM ${table} WHERE moderation_status = 'rejected'`
    );
    logInfo(runId, 'cleanup', null, null, `Purge rejected: deleted ${result.rowCount} ${contentType} items`, { completed: true, deleted: result.rowCount, type: contentType });
    await flushJobLogs();
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
  logInfo(runId, 'cleanup', null, null, `Purge rejected: deleted ${total} items (all types)`, { completed: true, deleted: total, type: 'all' });
  await flushJobLogs();
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
  const runId = Math.floor(Date.now() / 1000);

  const typeLabel = contentType === 'news' ? 'news article' : 'event';
  const prompt = `Search the web for this ${typeLabel} and tell me what you find:

Title: "${item.title}"
${item.description ? `Description: "${item.description}"` : ''}
${item.poi_name ? `Location/Organization: ${item.poi_name}` : ''}

Tell me: Did you find this specific ${typeLabel}? What website is it on? Is it still available?
Summarize what you found in 1-2 sentences.`;

  console.log(`[Moderation] Fixing URL for ${contentType} #${contentId}: "${item.title}"`);
  logInfo(runId, 'moderation', null, item.title, `Fix URL: searching for ${contentType} #${contentId}`);

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
    logInfo(runId, 'moderation', null, item.title, `Fix URL: updated ${contentType} #${contentId}`, { completed: true, old_url: oldUrl, new_url: newUrl });
  } else {
    console.log(`[Moderation] Fix URL for ${contentType} #${contentId}: no new URL found`);
    logInfo(runId, 'moderation', null, item.title, `Fix URL: no new URL found for ${contentType} #${contentId}`, { completed: true });
  }
  await flushJobLogs();

  return {
    researched: true,
    source_url_updated: sourceUrlUpdated,
    old_url: oldUrl,
    new_url: newUrl,
    ai_notes: aiNotes || null
  };
}

/**
 * Fix the publication date for a news/event item via Gemini with Google Search grounding.
 * Searches the web to find the publication date, updates the item.
 */
export async function fixDate(pool, contentType, contentId) {
  if (contentType !== 'news' && contentType !== 'event') {
    throw new Error('Fix Date is only available for news and event items');
  }

  const table = TABLE_MAP[contentType];
  const descField = contentType === 'news' ? 'summary' : 'description';

  const extraFields = contentType === 'event' ? ', t.start_date, t.end_date' : '';
  const itemQuery = await pool.query(
    `SELECT t.id, t.title, t.${descField} AS description, t.source_url, t.publication_date, t.date_confidence, p.name AS poi_name${extraFields}
     FROM ${table} t
     LEFT JOIN pois p ON t.poi_id = p.id
     WHERE t.id = $1`,
    [contentId]
  );
  if (!itemQuery.rows.length) {
    throw new Error(`${contentType} #${contentId} not found`);
  }
  const item = itemQuery.rows[0];
  const runId = Math.floor(Date.now() / 1000);

  console.log(`[Moderation] Fixing date for ${contentType} #${contentId}: "${item.title}"`);
  logInfo(runId, 'moderation', null, item.title, `Fix Date: ${contentType} #${contentId}`);

  // Fetch actual page content if source URL exists
  let pageContent = '';
  let htmlDateHints = '';
  if (item.source_url && isSafePublicUrl(item.source_url)) {
    try {
      // Simple fetch to get raw HTML for date metadata extraction
      const res = await fetch(item.source_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ROTV/1.0)' },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const html = await res.text();
        // Extract date hints from HTML metadata and structured elements
        const datePatterns = [];
        const metaMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|og:article:published_time|datePublished|date|DC\.date)["'][^>]+content=["']([^"']+)["']/i);
        if (metaMatch) datePatterns.push(metaMatch[1]);
        const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
        if (timeMatch) datePatterns.push(timeMatch[1]);
        const ldMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
        if (ldMatch) datePatterns.push(ldMatch[1]);

        // If we found a machine-readable date, use it directly — skip Gemini
        if (datePatterns.length > 0) {
          for (const raw of datePatterns) {
            const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (isoMatch) {
              const dateStr = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
              const [y, m, d] = [parseInt(isoMatch[1]), parseInt(isoMatch[2]), parseInt(isoMatch[3])];
              if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100) {
                await pool.query(
                  `UPDATE ${table} SET publication_date = $1, date_confidence = 'exact' WHERE id = $2`,
                  [dateStr, contentId]
                );
                console.log(`[Moderation] Fix date from HTML metadata: ${contentType} #${contentId} → ${dateStr}`);
                logInfo(runId, 'moderation', null, item.title, `Fix Date: ${dateStr} (from HTML metadata)`, { completed: true, publication_date: dateStr });
                await flushJobLogs();
                return { date_updated: true, publication_date: dateStr, date_confidence: 'exact', reasoning: 'Extracted from HTML metadata' };
              }
            }
          }
          // Have hints but couldn't parse — pass to Gemini
          htmlDateHints = '\nDate metadata found in HTML:\n' + datePatterns.join('\n');
        }
      }
    } catch (fetchErr) {
      console.warn(`[Moderation] Could not fetch raw HTML for fix-date: ${fetchErr.message}`);
    }

    // Also get readable content via Playwright + Readability
    try {
      const extracted = await extractPageContent(item.source_url, { maxLength: 4000, timeout: 15000 });
      if (extracted.markdown) {
        pageContent = extracted.markdown;
      }
    } catch (err) {
      console.warn(`[Moderation] Could not fetch page for fix-date: ${err.message}`);
    }
  }

  const typeLabel = contentType === 'news' ? 'news article' : 'event';
  const eventDateInstructions = contentType === 'event' ? `
- EVENT DATES: Find the event start date/time and end date/time. These are the dates the event actually occurs, NOT when the article was published.
  Include "start_date" (YYYY-MM-DD), "start_time" (HH:MM in 24h format or null),
  "end_date" (YYYY-MM-DD or null), "end_time" (HH:MM in 24h format or null) in your response.` : '';

  const eventJsonFields = contentType === 'event'
    ? ', "start_date": "YYYY-MM-DD", "start_time": "HH:MM", "end_date": "YYYY-MM-DD", "end_time": "HH:MM"'
    : '';

  const prompt = `Find the ${contentType === 'event' ? 'event dates and ' : ''}publication date for this ${typeLabel}:

Title: "${item.title}"
${item.description ? `Description: "${item.description}"` : ''}
${item.source_url ? `Source URL: ${item.source_url}` : ''}
${item.poi_name ? `Location/Organization: ${item.poi_name}` : ''}
${htmlDateHints}
${pageContent ? `\nPage Content:\n${pageContent}` : ''}

Look for:
- Publication date, byline date, or article timestamp in the page content
- Date in the URL pattern (e.g., /2025/03/article-name)
- References to specific dated events that pin down the timeframe${eventDateInstructions}

Return ONLY valid JSON (no markdown, no code blocks):
{"publication_date": "YYYY-MM-DD", "date_confidence": "exact", "reasoning": "Found date in..."${eventJsonFields}}

If exact date found, use date_confidence "exact".
If estimated from context, use "estimated".
If truly impossible to determine, use "unknown" and set publication_date to null.`;

  const genAI = await createGeminiClient(pool);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0 }
  });

  let text;
  try {
    const generation = await model.generateContent(prompt);
    text = generation.response.text().trim();
  } catch (genErr) {
    console.error('[Moderation] Fix-date generation failed:', genErr.message);
    logError(runId, 'moderation', null, item.title, `Fix Date: AI generation failed`, { completed: true });
    await flushJobLogs();
    return { date_updated: false, reasoning: 'AI generation failed' };
  }

  if (!text) {
    console.error('[Moderation] Fix-date: empty response from AI');
    logError(runId, 'moderation', null, item.title, `Fix Date: AI returned empty response`, { completed: true });
    await flushJobLogs();
    return { date_updated: false, reasoning: 'AI returned empty response' };
  }

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  let result;
  try {
    result = JSON.parse(jsonMatch[1].trim());
  } catch {
    console.error('[Moderation] Failed to parse fix-date response:', text.slice(0, 500));
    logError(runId, 'moderation', null, item.title, `Fix Date: failed to parse AI response`, { completed: true });
    await flushJobLogs();
    return { date_updated: false, reasoning: 'Failed to parse AI response' };
  }

  const { publicationDate, dateConfidence } = extractDateFields(result);

  // For events, also extract start_date/end_date with optional times
  let startDateStr = null;
  let endDateStr = null;
  if (contentType === 'event') {
    if (result.start_date && /^\d{4}-\d{2}-\d{2}$/.test(String(result.start_date))) {
      const timeStr = result.start_time && /^\d{2}:\d{2}$/.test(String(result.start_time))
        ? `${result.start_date}T${result.start_time}:00` : `${result.start_date}T00:00:00`;
      startDateStr = timeStr;
    }
    if (result.end_date && /^\d{4}-\d{2}-\d{2}$/.test(String(result.end_date))) {
      const timeStr = result.end_time && /^\d{2}:\d{2}$/.test(String(result.end_time))
        ? `${result.end_date}T${result.end_time}:00` : `${result.end_date}T23:59:00`;
      endDateStr = timeStr;
    }
  }

  const anyDateFound = publicationDate || startDateStr;

  if (anyDateFound) {
    if (contentType === 'event' && (startDateStr || endDateStr)) {
      // Update publication_date + event dates
      const setClauses = ['date_confidence = $2'];
      const values = [contentId, dateConfidence];
      let idx = 3;
      if (publicationDate) {
        setClauses.push(`publication_date = $${idx}`);
        values.push(publicationDate);
        idx++;
      }
      if (startDateStr) {
        setClauses.push(`start_date = $${idx}`);
        values.push(startDateStr);
        idx++;
      }
      if (endDateStr) {
        setClauses.push(`end_date = $${idx}`);
        values.push(endDateStr);
        idx++;
      }
      await pool.query(
        `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1`,
        values
      );
      console.log(`[Moderation] Fix date updated ${contentType} #${contentId}: pub=${publicationDate}, start=${startDateStr}, end=${endDateStr} (${dateConfidence})`);
    } else {
      await pool.query(
        `UPDATE ${table} SET publication_date = $1, date_confidence = $2 WHERE id = $3`,
        [publicationDate, dateConfidence, contentId]
      );
      console.log(`[Moderation] Fix date updated ${contentType} #${contentId}: ${publicationDate} (${dateConfidence})`);
    }
    logInfo(runId, 'moderation', null, item.title, `Fix Date: ${publicationDate || 'no pub date'} (${dateConfidence}, via AI)`, { completed: true, publication_date: publicationDate, date_confidence: dateConfidence, start_date: startDateStr, end_date: endDateStr });
    await flushJobLogs();
    return {
      date_updated: true,
      publication_date: publicationDate,
      date_confidence: dateConfidence,
      start_date: startDateStr || null,
      end_date: endDateStr || null,
      reasoning: result.reasoning || null
    };
  }

  console.log(`[Moderation] Fix date for ${contentType} #${contentId}: no date found`);
  logInfo(runId, 'moderation', null, item.title, `Fix Date: no date found for ${contentType} #${contentId}`, { completed: true });
  await flushJobLogs();
  return {
    date_updated: false,
    reasoning: result.reasoning || 'Could not determine publication date'
  };
}

export async function getQueue(pool, { page = 1, limit = 20, contentType = null, status = 'pending', contentSource = null, search = null } = {}) {
  const offset = (page - 1) * limit;
  const statusList = status === 'all'
    ? ['pending', 'published', 'auto_approved', 'rejected']
    : status === 'approved'
      ? ['published', 'auto_approved']
      : [status];

  const baseQuery = `
    SELECT n.id, 'news' AS content_type, n.poi_id, n.title, n.summary AS description,
           n.moderation_status, n.confidence_score, n.ai_reasoning, n.ai_issues,
           n.submitted_by, n.moderated_by, n.moderated_at, n.created_at, n.source_url,
           n.content_source, n.publication_date, n.date_confidence,
           NULL::TIMESTAMPTZ AS start_date, NULL::TIMESTAMPTZ AS end_date,
           COUNT(u.id)::int AS additional_url_count,
           NULL::VARCHAR AS media_type, NULL::VARCHAR AS image_server_asset_id, NULL::VARCHAR AS role
    FROM poi_news n
    LEFT JOIN poi_news_urls u ON u.news_id = n.id
    WHERE n.moderation_status = ANY($1)
    GROUP BY n.id
    UNION ALL
    SELECT e.id, 'event' AS content_type, e.poi_id, e.title, e.description,
           e.moderation_status, e.confidence_score, e.ai_reasoning, e.ai_issues,
           e.submitted_by, e.moderated_by, e.moderated_at, e.created_at, e.source_url,
           e.content_source, e.publication_date, e.date_confidence,
           e.start_date, e.end_date,
           COUNT(u.id)::int AS additional_url_count,
           NULL::VARCHAR AS media_type, NULL::VARCHAR AS image_server_asset_id, NULL::VARCHAR AS role
    FROM poi_events e
    LEFT JOIN poi_event_urls u ON u.event_id = e.id
    WHERE e.moderation_status = ANY($1)
    GROUP BY e.id
    UNION ALL
    SELECT id, 'photo' AS content_type, poi_id,
           CASE
             WHEN media_type = 'youtube' THEN youtube_url
             ELSE CONCAT(media_type, ' #', id)
           END AS title,
           caption AS description,
           moderation_status, confidence_score, ai_reasoning, NULL AS ai_issues,
           submitted_by, moderated_by, moderated_at, created_at, youtube_url AS source_url,
           NULL AS content_source, NULL::DATE AS publication_date, NULL::VARCHAR AS date_confidence,
           NULL::TIMESTAMPTZ AS start_date, NULL::TIMESTAMPTZ AS end_date,
           0 AS additional_url_count,
           media_type, image_server_asset_id, role
    FROM poi_media WHERE moderation_status = ANY($1)`;

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
  if (search) {
    filters.push(`(title ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
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
  const countRow = await pool.query(`
    SELECT COUNT(*) FROM (
      SELECT id FROM poi_news WHERE moderation_status = 'pending'
      UNION ALL
      SELECT id FROM poi_events WHERE moderation_status = 'pending'
      UNION ALL
      SELECT id FROM poi_media WHERE moderation_status = 'pending'
    ) AS pending_items
  `);
  return parseInt(countRow.rows[0].count);
}

export async function getItemDetail(pool, contentType, contentId) {
  const queryMap = {
    news: `SELECT n.*, p.name as poi_name,
             COALESCE(json_agg(json_build_object('id', u.id, 'url', u.url, 'source_name', u.source_name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS additional_urls
           FROM poi_news n LEFT JOIN pois p ON n.poi_id = p.id LEFT JOIN poi_news_urls u ON u.news_id = n.id WHERE n.id = $1 GROUP BY n.id, p.name`,
    event: `SELECT e.*, p.name as poi_name,
              COALESCE(json_agg(json_build_object('id', u.id, 'url', u.url, 'source_name', u.source_name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS additional_urls
            FROM poi_events e LEFT JOIN pois p ON e.poi_id = p.id LEFT JOIN poi_event_urls u ON u.event_id = e.id WHERE e.id = $1 GROUP BY e.id, p.name`,
    photo: `SELECT pm.*, p.name as poi_name FROM poi_media pm LEFT JOIN pois p ON pm.poi_id = p.id WHERE pm.id = $1`
  };

  const sql = queryMap[contentType];
  if (!sql) return null;

  const detailQuery = await pool.query(sql, [contentId]);
  return detailQuery.rows[0] || null;
}

export async function mergeItems(pool, contentType, sourceId, targetId) {
  if (!['news', 'event'].includes(contentType)) {
    throw new Error('Merge is only supported for news and event items');
  }
  if (sourceId === targetId) {
    throw new Error('Cannot merge an item into itself');
  }

  const table = contentType === 'news' ? 'poi_news' : 'poi_events';
  const urlTable = contentType === 'news' ? 'poi_news_urls' : 'poi_event_urls';
  const fkColumn = contentType === 'news' ? 'news_id' : 'event_id';

  // Verify both items exist
  const [sourceRow, targetRow] = await Promise.all([
    pool.query(`SELECT id, source_url, source_name FROM ${table} WHERE id = $1`, [sourceId]),
    pool.query(`SELECT id, source_url FROM ${table} WHERE id = $1`, [targetId])
  ]);

  if (sourceRow.rows.length === 0) throw new Error(`Source ${contentType} #${sourceId} not found`);
  if (targetRow.rows.length === 0) throw new Error(`Target ${contentType} #${targetId} not found`);

  const source = sourceRow.rows[0];
  const target = targetRow.rows[0];
  let movedUrls = 0;

  // Move source's primary source_url to target's junction table
  if (source.source_url && source.source_url !== target.source_url) {
    const inserted = await pool.query(
      `INSERT INTO ${urlTable} (${fkColumn}, url, source_name)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM ${urlTable} WHERE ${fkColumn} = $1 AND url = $2
       )
       RETURNING id`,
      [targetId, source.source_url, source.source_name || null]
    );
    movedUrls += inserted.rows.length;
  }

  // Move any of source's junction table URLs to target
  const sourceUrls = await pool.query(
    `SELECT url, source_name FROM ${urlTable} WHERE ${fkColumn} = $1`,
    [sourceId]
  );
  for (const row of sourceUrls.rows) {
    if (row.url === target.source_url) continue;
    const ins = await pool.query(
      `INSERT INTO ${urlTable} (${fkColumn}, url, source_name)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM ${urlTable} WHERE ${fkColumn} = $1 AND url = $2
       )
       RETURNING id`,
      [targetId, row.url, row.source_name]
    );
    movedUrls += ins.rows.length;
  }

  // Delete source item (CASCADE will clean up its junction table entries)
  await pool.query(`DELETE FROM ${table} WHERE id = $1`, [sourceId]);

  console.log(`[Moderation] Merged ${contentType} #${sourceId} into #${targetId} (${movedUrls} URLs moved)`);
  return { merged: true, sourceId, targetId, movedUrls };
}

export async function getMergeCandidates(pool, contentType, contentId) {
  if (!['news', 'event'].includes(contentType)) {
    throw new Error('Merge is only supported for news and event items');
  }

  const table = contentType === 'news' ? 'poi_news' : 'poi_events';
  const urlTable = contentType === 'news' ? 'poi_news_urls' : 'poi_event_urls';
  const fkColumn = contentType === 'news' ? 'news_id' : 'event_id';

  // Get the POI for this item
  const item = await pool.query(`SELECT poi_id FROM ${table} WHERE id = $1`, [contentId]);
  if (item.rows.length === 0) throw new Error(`${contentType} #${contentId} not found`);
  const poiId = item.rows[0].poi_id;

  // Get all other items from the same POI
  const result = await pool.query(`
    SELECT t.id, t.title, t.source_url, t.moderation_status, t.created_at,
           t.publication_date,
           COUNT(u.id)::int AS additional_url_count
    FROM ${table} t
    LEFT JOIN ${urlTable} u ON u.${fkColumn} = t.id
    WHERE t.poi_id = $1 AND t.id != $2
    GROUP BY t.id
    ORDER BY t.created_at DESC
    LIMIT 50
  `, [poiId, contentId]);

  return result.rows;
}

export async function addItemUrl(pool, contentType, contentId, url, sourceName) {
  if (!['news', 'event'].includes(contentType)) {
    throw new Error('Additional URLs are only supported for news and event items');
  }
  if (!url) throw new Error('URL is required');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('URL must use http or https protocol');
    }
  } catch (e) {
    if (e.message.includes('protocol')) throw e;
    throw new Error('Invalid URL format');
  }

  const table = contentType === 'news' ? 'poi_news' : 'poi_events';
  const urlTable = contentType === 'news' ? 'poi_news_urls' : 'poi_event_urls';
  const fkColumn = contentType === 'news' ? 'news_id' : 'event_id';

  // Verify item exists
  const item = await pool.query(`SELECT id, source_url FROM ${table} WHERE id = $1`, [contentId]);
  if (item.rows.length === 0) throw new Error(`${contentType} #${contentId} not found`);

  // Don't add if it matches the primary source_url
  if (item.rows[0].source_url === url) {
    return { added: false, reason: 'URL matches primary source_url' };
  }

  const result = await pool.query(
    `INSERT INTO ${urlTable} (${fkColumn}, url, source_name)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ${urlTable} WHERE ${fkColumn} = $1 AND url = $2
     )
     RETURNING id`,
    [contentId, url, sourceName || null]
  );

  if (result.rows.length === 0) {
    return { added: false, reason: 'URL already exists' };
  }

  console.log(`[Moderation] Added URL to ${contentType} #${contentId}: ${url}`);
  return { added: true, urlId: result.rows[0].id };
}

export async function removeItemUrl(pool, contentType, contentId, urlId) {
  if (!['news', 'event'].includes(contentType)) {
    throw new Error('Additional URLs are only supported for news and event items');
  }

  const urlTable = contentType === 'news' ? 'poi_news_urls' : 'poi_event_urls';
  const fkColumn = contentType === 'news' ? 'news_id' : 'event_id';
  const result = await pool.query(`DELETE FROM ${urlTable} WHERE id = $1 AND ${fkColumn} = $2 RETURNING id`, [urlId, contentId]);

  if (result.rows.length === 0) throw new Error('URL not found');

  console.log(`[Moderation] Removed URL #${urlId} from ${contentType} #${contentId}`);
  return { removed: true };
}
