/**
 * Moderation Service
 * LLM-powered content moderation for news, events, and photo submissions.
 * Processes pending items via pg-boss queue, auto-approves high-confidence content.
 */

import { moderateContent, moderatePhoto, generateTextWithCustomPrompt } from './geminiService.js';
import { renderPage } from './renderPage.js';
import { deepCrawlForArticle, isGenericUrl } from './deepCrawler.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';
import { parseDate, scoreDateConsensus, extractUrlDate } from './dateExtractor.js';
import { scoreDate, normalizeRenderUrl } from './newsService.js';

const TABLE_MAP = {
  news: 'poi_news',
  event: 'poi_events',
  photo: 'poi_media' // Updated for multi-image support (Issue #181)
};

const REJECTION_ISSUES = ['content_not_on_source_page', 'static_reference_page', 'wrong_poi', 'wrong_geography', 'misclassified_type', 'private_content'];

/**
 * Determine URL reputation for quality filtering.
 * blocklistSet entries are URL prefixes (domain or domain+path), matched as startsWith.
 * trustedSet entries are hostnames only.
 * @param {string} url - URL to check
 * @param {Set<string>} trustedSet - Set of trusted domains (lowercase, hostname only)
 * @param {Set<string>} blocklistSet - Set of blocklisted URL prefixes (lowercase)
 * @returns {'trusted'|'blocklisted'|'unknown'}
 */
export function getDomainReputation(url, trustedSet = new Set(), blocklistSet = new Set()) {
  if (!url) return 'unknown';
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const normalizedUrl = (hostname + parsed.pathname).toLowerCase().replace(/\/+$/, '');
    if (trustedSet.has(hostname)) return 'trusted';
    for (const entry of blocklistSet) {
      if (normalizedUrl.startsWith(entry.replace(/^www\./, ''))) return 'blocklisted';
    }
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
 * Returns { publicationDate } with safe defaults.
 */
function extractDateFields(scoring) {
  let publicationDate = null;

  if (scoring.publication_date) {
    const normalized = parseDate(String(scoring.publication_date));
    if (normalized) {
      publicationDate = normalized;
    }
  }

  return { publicationDate };
}

/**
 * Apply quality filters to AI scoring before auto-approval decision.
 * Multiplicative penalties for domain reputation, URL quality, and date confidence.
 * @param {Object} scoring - AI scoring object with confidence_score, reasoning, issues
 * @param {string} sourceUrl - Source URL to validate
 * @param {Object} dateInfo - { publicationDate, dateConfidence }
 * @param {Set<string>} trustedSet - Set of trusted domains (lowercase)
 * @param {Set<string>} blocklistSet - Set of blocklisted domains/URLs (lowercase)
 * @returns {Object} Modified scoring object
 */
export function applyQualityFilters(scoring, sourceUrl, dateInfo, trustedSet = new Set(), blocklistSet = new Set()) {
  const { publicationDate, dateConfidence } = dateInfo;

  // Filter 1: Domain reputation
  const reputation = getDomainReputation(sourceUrl, trustedSet, blocklistSet);
  if (reputation === 'blocklisted') {
    scoring.confidence_score *= 0.3;
    scoring.reasoning += ' Source is on the blocklist.';
    if (!scoring.issues) scoring.issues = [];
    scoring.issues.push('blocklisted_domain');
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
      pool,
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
 * Run LLM content relevance voting — 3 parallel yes/no votes.
 * Returns array of { relevant: boolean, reasoning: string }.
 */
async function runContentRelevanceVotes(pool, { title, description, poiName, contentType }, numVotes = 3) {
  const prompt = `You are evaluating content for "Roots of The Valley," a guide to Cuyahoga Valley National Park.

Title: "${title}"
Summary: "${description || '(none)'}"
Location: ${poiName || '(unknown)'}
Type: ${contentType}

Is this actual ${contentType} relevant to Cuyahoga Valley National Park visitors?
Consider: Is it about the park region? Does it connect to nature, trails, recreation,
conservation, history, ecology, wildlife, or community stewardship? Is it timely
(actual news/event, not a static reference page)?

Return ONLY valid JSON: {"relevant": true, "reasoning": "one sentence why"}`;

  const results = await Promise.all(
    Array.from({ length: numVotes }, () =>
      generateTextWithCustomPrompt(pool, prompt, { maxOutputTokens: 128, thinkingBudget: 0 })
        .then(r => {
          const raw = (r || '').trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
          try {
            const parsed = JSON.parse(raw);
            return { relevant: !!parsed.relevant, reasoning: parsed.reasoning || '' };
          } catch {
            return null;
          }
        })
        .catch(() => null)
    )
  );
  return results.filter(Boolean);
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
    `SELECT key, value FROM admin_settings WHERE key IN ('moderation_auto_approve_threshold', 'moderation_news_date_threshold')`
  );
  const settings = Object.fromEntries(settingsRows.rows.map(r => [r.key, r.value]));
  const parsedNewsThreshold = parseInt(settings.moderation_news_date_threshold);
  const newsDateThreshold = Number.isNaN(parsedNewsThreshold) ? 4 : parsedNewsThreshold;
  const parsedPhotoThreshold = parseFloat(settings.moderation_auto_approve_threshold);
  const photoThreshold = Number.isNaN(parsedPhotoThreshold) ? 0.9 : parsedPhotoThreshold;

  let scoring;

  if (contentType === 'news' || contentType === 'event') {
    const table = contentType === 'news' ? 'poi_news' : 'poi_events';
    const descField = contentType === 'news' ? 'summary' : 'description';
    const extraFields = contentType === 'event' ? ', t.start_date, t.content_source' : '';

    const itemQuery = await pool.query(
      `SELECT t.id, t.title, t.${descField} AS description, t.source_url, t.publication_date,
              t.date_consensus_score, t.rendered_content, t.date_signals, p.name as poi_name${extraFields}
       FROM ${table} t
       LEFT JOIN pois p ON t.poi_id = p.id
       WHERE t.id = $1`, [contentId]
    );
    if (!itemQuery.rows.length) return;
    const row = itemQuery.rows[0];

    // Duplicate check (cheap DB query)
    const dupWhere = contentType === 'news'
      ? `LOWER(title) = LOWER($1) AND id != $2`
      : `LOWER(title) = LOWER($1) AND start_date = $3 AND id != $2`;
    const dupParams = contentType === 'news'
      ? [row.title, contentId]
      : [row.title, contentId, row.start_date];
    const dupCheck = await pool.query(
      `SELECT id FROM ${table} WHERE ${dupWhere}
       AND moderation_status IN ('published', 'auto_approved') LIMIT 1`,
      dupParams
    );
    if (dupCheck.rows.length) {
      await pool.query(
        `UPDATE ${table} SET moderation_processed = true, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        [`Rejected: duplicate of approved ${contentType} #${dupCheck.rows[0].id}`, contentId]
      );
      console.log(`[Moderation] ${contentType} #${contentId}: rejected (duplicate of #${dupCheck.rows[0].id})`);
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected ${contentType} #${contentId}: duplicate of #${dupCheck.rows[0].id}`, { completed: true });
      return;
    }

    // No source URL check
    const requiresUrl = contentType === 'news' || row.content_source !== 'human';
    if (requiresUrl && (!row.source_url || !row.source_url.trim())) {
      await pool.query(
        `UPDATE ${table} SET moderation_processed = true, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        [`Rejected: no source URL`, contentId]
      );
      console.log(`[Moderation] ${contentType} #${contentId}: rejected (no source URL)`);
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected ${contentType} #${contentId}: no source URL`, { completed: true });
      return;
    }

    let dateScore = row.date_consensus_score || 0;
    let newScore = dateScore;
    let newDate = row.publication_date;

    // --- Step 1: Date scoring (rescore from cached signals or full extraction) ---
    if (dateScore < newsDateThreshold || forceStatus) {
      console.log(`[Moderation] ${contentType} #${contentId}: rescoring (current score=${dateScore}, threshold=${newsDateThreshold})`);
      logInfo(itemRunId, 'moderation', null, row.title, `Rescoring ${contentType} #${contentId} (score=${dateScore})`);

      try {
        let consensus;
        if (row.date_signals) {
          const signals = row.date_signals;
          consensus = scoreDateConsensus(
            { jsonLd: signals.jsonLd || [], meta: signals.meta || [], timeTags: signals.timeTags || [], url: signals.url || null },
            signals.llmVotes || []
          );
        } else {
          let pageContent = null;
          let ogDates = {};
          if (row.source_url && isSafePublicUrl(row.source_url)) {
            try {
              const renderUrl = normalizeRenderUrl(row.source_url);
              const extracted = await renderPage(pool, renderUrl, { timeout: 30000, hardTimeout: 60000 });
              if (extracted.reachable && extracted.markdown && extracted.markdown.length >= 200) {
                pageContent = extracted.rawText || extracted.markdown;
                ogDates = extracted.ogDates || {};
              }
            } catch (err) {
              console.error(`[Moderation] ${contentType} #${contentId}: page extraction failed: ${err.message}`);
              logError(itemRunId, 'moderation', null, row.title, `Page extraction failed: ${err.message}`);
            }
          }
          consensus = await scoreDate(pool, {
            title: row.title, description: row.description,
            pageContent,
            sources: {
              jsonLd: ogDates.jsonLdDates || [],
              meta: [ogDates.publishedTime, ogDates.parselyPubDate, ogDates.dcDate].filter(Boolean),
              timeTags: ogDates.timeDates || [],
              url: extractUrlDate(row.source_url)
            }
          });
        }

        if (consensus.date) {
          newDate = consensus.date;
          newScore = consensus.score;
        }

        logInfo(itemRunId, 'moderation', null, row.title,
          `Rescored ${contentType} #${contentId}: ${newDate || 'none'} (score=${newScore}, sources=${JSON.stringify(consensus.sourceMap)})`);
      } catch (err) {
        console.error(`[Moderation] ${contentType} #${contentId}: date scoring failed: ${err.message}`);
        logError(itemRunId, 'moderation', null, row.title, `Date scoring failed: ${err.message}`);
      }
    }

    // --- Step 2: Content relevance voting (3 LLM votes) ---
    let relevanceVotes = [];
    try {
      relevanceVotes = await runContentRelevanceVotes(pool, {
        title: row.title, description: row.description,
        poiName: row.poi_name, contentType
      });

      const yesCount = relevanceVotes.filter(v => v.relevant).length;
      const noCount = relevanceVotes.filter(v => !v.relevant).length;
      console.log(`[Moderation] ${contentType} #${contentId}: relevance votes ${yesCount}/${relevanceVotes.length} yes`);
      logInfo(itemRunId, 'moderation', null, row.title,
        `Relevance ${contentType} #${contentId}: ${yesCount}/${relevanceVotes.length} yes`);
    } catch (err) {
      console.error(`[Moderation] ${contentType} #${contentId}: relevance voting failed: ${err.message}`);
      logError(itemRunId, 'moderation', null, row.title, `Relevance voting failed: ${err.message}`);
    }

    // --- Step 3: Decision ---
    const yesCount = relevanceVotes.filter(v => v.relevant).length;
    const noCount = relevanceVotes.filter(v => !v.relevant).length;
    const unanimousYes = relevanceVotes.length >= 3 && yesCount === relevanceVotes.length;
    const unanimousNo = relevanceVotes.length >= 3 && noCount === relevanceVotes.length;

    // Reject news with future publication dates
    const isFutureDate = contentType === 'news' && newDate && new Date(newDate) > new Date();

    let resolvedStatus;
    let reasoning;
    if (forceStatus) {
      resolvedStatus = forceStatus;
      reasoning = `Forced to ${forceStatus}`;
    } else if (isFutureDate) {
      resolvedStatus = 'rejected';
      reasoning = `Rejected: future publication date ${newDate}`;
    } else if (unanimousNo) {
      resolvedStatus = 'rejected';
      reasoning = `Rejected: relevance vote unanimous NO (${relevanceVotes.map(v => v.reasoning).join('; ')})`;
    } else if (unanimousYes && newScore >= newsDateThreshold) {
      resolvedStatus = 'published';
      reasoning = `Published: relevance ${yesCount}/${relevanceVotes.length} yes, date score ${newScore}/${newsDateThreshold}`;
    } else {
      resolvedStatus = 'pending';
      reasoning = `Pending: relevance ${yesCount}/${relevanceVotes.length} yes, date score ${newScore}/${newsDateThreshold}`;
    }

    scoring = { confidence_score: newScore / 8.0, reasoning };
    await pool.query(
      `UPDATE ${table} SET moderation_processed = true, moderation_status = $1,
              publication_date = $2, date_consensus_score = $3,
              ai_reasoning = $4, relevance_signals = $5
       WHERE id = $6`,
      [resolvedStatus, newDate, newScore, reasoning,
       relevanceVotes.length > 0 ? JSON.stringify(relevanceVotes) : null,
       contentId]
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
      : autoApproveEnabled && scoring.confidence_score >= photoThreshold
      ? 'auto_approved' : 'pending';

    await pool.query(
      `UPDATE photo_submissions SET confidence_score = $1, ai_reasoning = $2, moderation_status = $3, moderation_processed = true WHERE id = $4`,
      [scoring.confidence_score, scoring.reasoning, resolvedStatus, contentId]
    );
  }

  const decision = contentType === 'photo'
    ? (scoring?.confidence_score >= photoThreshold ? 'auto_approved' : 'pending')
    : (scoring?.confidence_score >= (newsDateThreshold / 8.0) ? 'auto_approved' : 'pending');
  console.log(`[Moderation] ${contentType} #${contentId}: score=${scoring?.confidence_score}`);
  logInfo(itemRunId || 0, 'moderation', null, null,
    `Score ${contentType} #${contentId}: ${scoring?.confidence_score?.toFixed(2)} → ${decision}`,
    { content_type: contentType, content_id: contentId, score: scoring?.confidence_score, decision });
}

/**
 * Process all unprocessed pending items (sweep job, runs every 15 minutes)
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
    `SELECT id FROM poi_news WHERE moderation_status = 'pending' AND moderation_processed = false LIMIT 20`
  );
  const pendingEvents = await pool.query(
    `SELECT id FROM poi_events WHERE moderation_status = 'pending' AND moderation_processed = false LIMIT 20`
  );
  const pendingPhotos = await pool.query(
    `SELECT id FROM photo_submissions WHERE moderation_status = 'pending' AND moderation_processed = false LIMIT 20`
  );
  const totalPending = pendingNews.rows.length + pendingEvents.rows.length + pendingPhotos.rows.length;

  if (totalPending === 0) {
    console.log('[Moderation] Sweep complete: 0 items processed');
    return { processed: 0 };
  }

  logInfo(runId, 'moderation', null, null, `Sweep starting: ${totalPending} unprocessed items (${pendingNews.rows.length} news, ${pendingEvents.rows.length} events, ${pendingPhotos.rows.length} photos)`);

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

export async function bulkReject(pool, items, adminUserId) {
  let rejected = 0;
  for (const { type, id } of items) {
    const table = TABLE_MAP[type];
    await pool.query(
      `UPDATE ${table} SET moderation_status = 'rejected', moderated_by = $1, moderated_at = CURRENT_TIMESTAMP,
         ai_reasoning = COALESCE(ai_reasoning, '') || E'\n--- Bulk rejected by admin'
       WHERE id = $2`,
      [adminUserId, id]
    );
    rejected++;
  }
  return { rejected };
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

  // When admin sets publication_date, set high consensus score (only for news/events, not photos)
  if (edits.publication_date && contentType !== 'photo') {
    setClauses.push(`date_consensus_score = 6`);
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
     SET moderation_status = 'pending', moderation_processed = false,
         moderated_by = NULL, moderated_at = NULL
     WHERE id = $1`,
    [contentId]
  );
}


/**
 * Fix the publication date for a news/event item.
 * Resets the item's score and re-runs it through processItem, which uses the
 * full consensus pipeline (deterministic sources + LLM multi-vote).
 */
export async function fixDate(pool, contentType, contentId) {
  if (contentType !== 'news' && contentType !== 'event') {
    throw new Error('Fix Date is only available for news and event items');
  }

  const table = TABLE_MAP[contentType];
  const descField = contentType === 'news' ? 'summary' : 'description';

  const itemQuery = await pool.query(
    `SELECT t.id, t.title, t.${descField} AS description, t.source_url,
            t.rendered_content, t.date_signals
     FROM ${table} t WHERE t.id = $1`, [contentId]
  );
  if (!itemQuery.rows.length) throw new Error(`${contentType} #${contentId} not found`);
  const item = itemQuery.rows[0];

  let consensus;

  if (item.date_signals) {
    // Fast path: rescore from cached signals (no Playwright, no LLM calls)
    console.log(`[Moderation] fixDate ${contentType} #${contentId}: rescoring from cached date_signals`);
    const signals = item.date_signals;
    const deterministicSources = {
      jsonLd: signals.jsonLd || [],
      meta: signals.meta || [],
      timeTags: signals.timeTags || [],
      url: signals.url || null
    };
    consensus = scoreDateConsensus(deterministicSources, signals.llmVotes || []);
  } else {
    // Slow path: no cached signals (human-submitted or legacy) — render + LLM
    console.log(`[Moderation] fixDate ${contentType} #${contentId}: no cached signals, running full extraction`);
    let pageContent = null;
    let ogDates = {};
    if (item.source_url && isSafePublicUrl(item.source_url)) {
      try {
        const renderUrl = normalizeRenderUrl(item.source_url);
        const extracted = await renderPage(pool, renderUrl, { timeout: 30000, hardTimeout: 60000 });
        if (extracted.reachable && extracted.markdown && extracted.markdown.length >= 200) {
          pageContent = extracted.rawText || extracted.markdown;
          ogDates = extracted.ogDates || {};
        }
      } catch (err) {
        console.error(`[Moderation] fixDate ${contentType} #${contentId}: page extraction failed: ${err.message}`);
      }
    }

    consensus = await scoreDate(pool, {
      title: item.title, description: item.description,
      pageContent,
      sources: {
        jsonLd: ogDates.jsonLdDates || [],
        meta: [ogDates.publishedTime, ogDates.parselyPubDate, ogDates.dcDate].filter(Boolean),
        timeTags: ogDates.timeDates || [],
        url: extractUrlDate(item.source_url)
      }
    });
  }

  // Update the item
  const newDate = consensus.date || null;
  const newScore = consensus.score || 0;
  await pool.query(
    `UPDATE ${table} SET publication_date = $1, date_consensus_score = $2, moderation_processed = true WHERE id = $3`,
    [newDate, newScore, contentId]
  );

  return {
    date_updated: !!newDate,
    publication_date: newDate,
    date_consensus_score: newScore,
    reasoning: `Rescored via scoreDate (score=${newScore})`
  };
}

export async function getQueue(pool, { page = 1, limit = 20, contentType = null, status = 'pending', contentSource = null, search = null, id = null } = {}) {
  const offset = (page - 1) * limit;
  const statusList = status === 'all'
    ? ['pending', 'published', 'auto_approved', 'rejected']
    : status === 'approved'
      ? ['published', 'auto_approved']
      : [status];

  const baseQuery = `
    SELECT n.id, 'news' AS content_type, n.poi_id, n.title, n.summary AS description,
           n.moderation_status, n.confidence_score, n.ai_reasoning, n.ai_issues,
           n.submitted_by, n.moderated_by, n.moderated_at, n.collection_date AS created_at, n.source_url,
           n.content_source, n.publication_date, n.date_consensus_score,
           NULL::TIMESTAMPTZ AS start_date, NULL::TIMESTAMPTZ AS end_date,
           COUNT(u.id)::int AS additional_url_count,
           NULL::VARCHAR AS media_type, NULL::VARCHAR AS image_server_asset_id, NULL::VARCHAR AS role,
           p.name AS poi_name, n.news_type, NULL::VARCHAR AS event_type,
           n.source_name, NULL::VARCHAR AS location_details
    FROM poi_news n
    LEFT JOIN poi_news_urls u ON u.news_id = n.id
    LEFT JOIN pois p ON n.poi_id = p.id
    WHERE n.moderation_status = ANY($1)
    GROUP BY n.id, p.name
    UNION ALL
    SELECT e.id, 'event' AS content_type, e.poi_id, e.title, e.description,
           e.moderation_status, e.confidence_score, e.ai_reasoning, e.ai_issues,
           e.submitted_by, e.moderated_by, e.moderated_at, e.collection_date AS created_at, e.source_url,
           e.content_source, e.publication_date, e.date_consensus_score,
           e.start_date, e.end_date,
           COUNT(u.id)::int AS additional_url_count,
           NULL::VARCHAR AS media_type, NULL::VARCHAR AS image_server_asset_id, NULL::VARCHAR AS role,
           p.name AS poi_name, NULL::VARCHAR AS news_type, e.event_type,
           NULL::VARCHAR AS source_name, e.location_details
    FROM poi_events e
    LEFT JOIN poi_event_urls u ON u.event_id = e.id
    LEFT JOIN pois p ON e.poi_id = p.id
    WHERE e.moderation_status = ANY($1)
    GROUP BY e.id, p.name
    UNION ALL
    SELECT id, 'photo' AS content_type, poi_id,
           CASE
             WHEN media_type = 'youtube' THEN youtube_url
             ELSE CONCAT(media_type, ' #', id)
           END AS title,
           caption AS description,
           moderation_status, confidence_score, ai_reasoning, NULL AS ai_issues,
           submitted_by, moderated_by, moderated_at, created_at, youtube_url AS source_url,
           NULL AS content_source, NULL::DATE AS publication_date, 0 AS date_consensus_score,
           NULL::TIMESTAMPTZ AS start_date, NULL::TIMESTAMPTZ AS end_date,
           0 AS additional_url_count,
           media_type, image_server_asset_id, role,
           NULL::VARCHAR AS poi_name, NULL::VARCHAR AS news_type, NULL::VARCHAR AS event_type,
           NULL::VARCHAR AS source_name, NULL::VARCHAR AS location_details
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
  if (id) {
    filters.push(`id = $${paramIdx}`);
    params.push(parseInt(id));
    paramIdx++;
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const orderBy = status === 'approved'
    ? 'ORDER BY COALESCE(publication_date, created_at::date) DESC, created_at DESC'
    : 'ORDER BY created_at DESC';
  const wrappedQuery = `SELECT * FROM (${baseQuery}) AS q ${whereClause} ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
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
    SELECT t.id, t.title, t.source_url, t.moderation_status, t.collection_date,
           t.publication_date,
           COUNT(u.id)::int AS additional_url_count
    FROM ${table} t
    LEFT JOIN ${urlTable} u ON u.${fkColumn} = t.id
    WHERE t.poi_id = $1 AND t.id != $2
    GROUP BY t.id
    ORDER BY t.collection_date DESC
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
