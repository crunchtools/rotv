import { moderateContent, moderatePhoto, generateTextWithCustomPrompt } from './geminiService.js';
import { renderPage } from './renderPage.js';
import { deepCrawlForArticle, isGenericUrl } from './deepCrawler.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';
import { parseDate, parseDateTime, localToUTC, scoreDateConsensus, extractUrlDate } from './dateExtractor.js';
import { scoreDate, normalizeRenderUrl, normalizeTitle } from './newsService.js';

function sameOrigin(urlA, urlB) {
  try { return new URL(urlA).origin === new URL(urlB).origin; }
  catch { return false; }
}

const TABLE_MAP = {
  news: 'poi_news',
  event: 'poi_events',
  photo: 'poi_media'
};

const REJECTION_ISSUES = ['content_not_on_source_page', 'static_reference_page', 'wrong_poi', 'wrong_geography', 'misclassified_type', 'private_content'];

// blocklistSet entries are URL prefixes (domain or domain+path), matched as startsWith.
// trustedSet entries are hostnames only.
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

// SSRF protection: reject internal IPs, localhost, cloud metadata endpoints, and non-http schemes
function isSafePublicUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return false;
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

export function applyQualityFilters(scoring, sourceUrl, dateInfo, trustedSet = new Set(), blocklistSet = new Set()) {
  const { publicationDate, dateConfidence } = dateInfo;

  const reputation = getDomainReputation(sourceUrl, trustedSet, blocklistSet);
  if (reputation === 'blocklisted') {
    scoring.confidence_score *= 0.3;
    scoring.reasoning += ' Source is on the blocklist.';
    if (!scoring.issues) scoring.issues = [];
    scoring.issues.push('blocklisted_domain');
  } else if (reputation === 'unknown') {
    scoring.confidence_score *= 0.9;
  }

  if (isGenericUrl(sourceUrl)) {
    scoring.confidence_score *= 0.6;
    scoring.reasoning += ' Source URL is a bare homepage or generic path.';
    if (!scoring.issues) scoring.issues = [];
    scoring.issues.push('generic_url');
  }

  if (!publicationDate || dateConfidence === 'unknown') {
    scoring.confidence_score = Math.min(scoring.confidence_score, 0.7);
    scoring.reasoning += ' No publication date found - capping confidence at 0.70.';
  }

  return scoring;
}

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

async function runContentRelevanceVotes(pool, { title, description, poiName, contentType }, numVotes = 3) {
  const typeLabel = contentType === 'event' ? 'event' : 'news article or announcement';
  const prompt = `You are evaluating content for "Roots of The Valley," a guide to Cuyahoga Valley National Park and the surrounding region including Cleveland Metroparks, Summit Metro Parks, and other nearby parks, trails, and outdoor recreation areas.

Title: "${title}"
Summary: "${description || '(none)'}"
Location: ${poiName || '(unknown)'}
Type: ${contentType}

Is this a real ${typeLabel}, NOT a static reference page?

APPROVE if the content:
- Reports on something that happened or will happen (article, announcement, press release)
- Describes a specific event with dates
- Scheduled recreational excursions, tours, or rides with specific dates (e.g., scenic train rides, guided hikes, boat tours) — even if they run regularly
- The TOPIC is directly related to: nature, trails, hiking, biking, paddling, outdoor recreation,
  conservation, ecology, wildlife, park operations, land management, environmental education,
  local history of the Cuyahoga Valley, or outdoor arts/music events hosted by a park or nature organization
- Old news IS valid — a 2021 trail opening article is still news

REJECT if the content is:
- A permanent informational page (trail description, facility info, visitor guide)
- An education resource or reference tool (StoryMap, interactive map, FAQ)
- A general "about us" or organization overview page
- A product/service page or commercial listing
- A page that describes what something IS rather than what happened or will happen
- A religious service, worship gathering, spiritual discussion, or faith-based event
- A political rally, campaign event, or partisan meeting
- A private party, wedding, corporate retreat, or commercial rental event
- A general community event unrelated to nature, parks, or outdoor recreation
  (e.g., book clubs, support groups, fitness classes, fundraising galas)

IMPORTANT: Location alone does NOT make content relevant. An event held at a park
venue is NOT automatically on-topic — the event's SUBJECT must relate to nature,
trails, parks, conservation, history, or outdoor recreation.

The key test: does this page report on a HAPPENING (past, present, or future)
whose TOPIC relates to nature, parks, or outdoor recreation in the Cuyahoga Valley?

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
      `SELECT t.id, t.poi_id, t.title, t.${descField} AS description, t.source_url, t.publication_date,
              t.date_consensus_score, t.rendered_content, t.date_signals, p.name as poi_name,
              p.news_score_threshold, p.events_score_threshold, p.news_url, p.events_url${extraFields}
       FROM ${table} t
       LEFT JOIN pois p ON t.poi_id = p.id
       WHERE t.id = $1`, [contentId]
    );
    if (!itemQuery.rows.length) return;
    const row = itemQuery.rows[0];

    // Strip leading "The" so "The David Mayfield Parade" matches "David Mayfield Parade"
    const titleNorm = `TRIM(LOWER(REGEXP_REPLACE(title, '^[Tt]he\\s+', '')))`;
    const paramNorm = normalizeTitle(row.title);
    const dupWhere = contentType === 'news'
      ? `${titleNorm} = $1 AND id != $2`
      : `${titleNorm} = $1 AND start_date = $3 AND id != $2`;
    const dupParams = contentType === 'news'
      ? [paramNorm, contentId]
      : [paramNorm, contentId, row.start_date];
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

    const excludedSetting = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'news_collection_excluded_pois'"
    );
    if (excludedSetting.rows.length > 0 && excludedSetting.rows[0].value) {
      try {
        const excludedIds = JSON.parse(excludedSetting.rows[0].value);
        if (Array.isArray(excludedIds) && excludedIds.includes(row.poi_id)) {
          await pool.query(
            `UPDATE ${table} SET moderation_processed = true, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
            [`Rejected: POI is on the excluded list`, contentId]
          );
          console.log(`[Moderation] ${contentType} #${contentId}: rejected (excluded POI ${row.poi_id})`);
          logInfo(itemRunId, 'moderation', null, row.title, `Rejected ${contentType} #${contentId}: excluded POI ${row.poi_id}`, { completed: true });
          return;
        }
      } catch (e) {
        console.error('[Moderation] Failed to parse news_collection_excluded_pois:', e.message);
      }
    }

    // Per-POI threshold only applies when item came from the POI's configured URL
    const poiConfigUrl = contentType === 'news' ? row.news_url : row.events_url;
    const poiThreshold = contentType === 'news' ? row.news_score_threshold : row.events_score_threshold;
    const fromConfiguredUrl = row.source_url && poiConfigUrl && sameOrigin(row.source_url, poiConfigUrl);
    const effectiveThreshold = (fromConfiguredUrl && poiThreshold != null) ? poiThreshold : newsDateThreshold;

    let dateScore = row.date_consensus_score || 0;
    let newScore = dateScore;
    let newDate = null;
    let rescoredDate = false;

    if (dateScore < effectiveThreshold || forceStatus) {
      console.log(`[Moderation] ${contentType} #${contentId}: rescoring (current score=${dateScore}, threshold=${effectiveThreshold})`);
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
          // Promote date-only to noon Eastern so TIMESTAMPTZ display never shifts the calendar day
          // when viewed from any US timezone (worst case: AKST is UTC-9)
          if (/^\d{4}-\d{2}-\d{2}$/.test(consensus.date)) {
            const noon = parseDateTime(consensus.date + 'T12:00:00', 'America/New_York');
            newDate = noon ? noon + 'Z' : consensus.date;
          } else {
            newDate = consensus.date;
          }
          newScore = consensus.score;
          rescoredDate = true;
        }

        logInfo(itemRunId, 'moderation', null, row.title,
          `Rescored ${contentType} #${contentId}: ${newDate || 'none'} (score=${newScore}, sources=${JSON.stringify(consensus.sourceMap)})`);
      } catch (err) {
        console.error(`[Moderation] ${contentType} #${contentId}: date scoring failed: ${err.message}`);
        logError(itemRunId, 'moderation', null, row.title, `Date scoring failed: ${err.message}`);
      }
    }

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

    const yesCount = relevanceVotes.filter(v => v.relevant).length;
    const noCount = relevanceVotes.filter(v => !v.relevant).length;
    const unanimousYes = relevanceVotes.length >= 3 && yesCount === relevanceVotes.length;
    const unanimousNo = relevanceVotes.length >= 3 && noCount === relevanceVotes.length;

    const isFutureDate = contentType === 'news' && rescoredDate && newDate && new Date(newDate) > new Date();
    const effectiveDate = newDate || row.publication_date;

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
    } else if (unanimousYes && newScore >= effectiveThreshold && effectiveDate) {
      resolvedStatus = 'published';
      reasoning = `Published: relevance ${yesCount}/${relevanceVotes.length} yes, date score ${newScore}/${effectiveThreshold}`;
    } else {
      resolvedStatus = 'pending';
      reasoning = `Pending: relevance ${yesCount}/${relevanceVotes.length} yes, date score ${newScore}/${effectiveThreshold}`;
    }

    scoring = { confidence_score: newScore / 8.0, reasoning };
    // Only write publication_date when rescore produced a new value — writing the existing
    // value back through this path can silently corrupt a previously-good timestamp
    if (rescoredDate) {
      await pool.query(
        `UPDATE ${table} SET moderation_processed = true, moderation_status = $1,
                publication_date = $2, date_consensus_score = $3,
                ai_reasoning = $4, relevance_signals = $5, moderation_date = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [resolvedStatus, newDate, newScore, reasoning,
         relevanceVotes.length > 0 ? JSON.stringify(relevanceVotes) : null,
         contentId]
      );
    } else {
      await pool.query(
        `UPDATE ${table} SET moderation_processed = true, moderation_status = $1,
                date_consensus_score = $2,
                ai_reasoning = $3, relevance_signals = $4, moderation_date = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [resolvedStatus, newScore, reasoning,
         relevanceVotes.length > 0 ? JSON.stringify(relevanceVotes) : null,
         contentId]
      );
    }

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

// Frontend gates the tooltip image request on pois.has_primary_image, so a published
// photo must flip the flag true or the (now-available) gallery photo will never load.
async function bumpHasPrimaryImageOnPhotoPublish(pool, contentType, contentId) {
  if (contentType !== 'photo') return;
  await pool.query(`
    UPDATE pois
    SET has_primary_image = true,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT poi_id FROM poi_media
      WHERE id = $1
        AND media_type IN ('image', 'video')
        AND moderation_status IN ('published', 'auto_approved')
    )
      AND has_primary_image = false
  `, [contentId]);
}

export async function approveItem(pool, contentType, contentId, adminUserId) {
  const table = TABLE_MAP[contentType];
  await pool.query(
    `UPDATE ${table} SET moderation_status = 'published', moderated_by = $1, moderated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [adminUserId, contentId]
  );
  await bumpHasPrimaryImageOnPhotoPublish(pool, contentType, contentId);
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
    await bumpHasPrimaryImageOnPhotoPublish(pool, type, id);
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
      if (DATE_FIELDS.includes(field)) {
        if (!edits[field] || edits[field] === '') {
          values.push(null);
        } else if (edits[field].includes('T')) {
          const utc = localToUTC(edits[field], 'America/New_York');
          values.push(utc ? utc + 'Z' : edits[field]);
        } else {
          const utc = parseDateTime(edits[field] + 'T12:00:00', 'America/New_York');
          values.push(utc ? utc + 'Z' : edits[field]);
        }
      } else {
        values.push(edits[field]);
      }
      idx++;
    }
  }

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
  if (publish) {
    await bumpHasPrimaryImageOnPhotoPublish(pool, contentType, contentId);
  }
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
    const purgeResult = await pool.query(
      `DELETE FROM ${table} WHERE moderation_status = 'rejected'`
    );
    logInfo(runId, 'cleanup', null, null, `Purge rejected: deleted ${purgeResult.rowCount} ${contentType} items`, { completed: true, deleted: purgeResult.rowCount, type: contentType });
    await flushJobLogs();
    return { deleted: purgeResult.rowCount };
  }
  let total = 0;
  for (const table of Object.values(TABLE_MAP)) {
    const purgeResult = await pool.query(
      `DELETE FROM ${table} WHERE moderation_status = 'rejected'`
    );
    total += purgeResult.rowCount;
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

  let newDate = consensus.date || null;
  if (newDate && /^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    const noon = parseDateTime(newDate + 'T12:00:00', 'America/New_York');
    newDate = noon ? noon + 'Z' : newDate;
  }
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

export async function getQueue(pool, { page = 1, limit = 20, contentType = null, status = 'pending', contentSource = null, search = null, id = null, sort = 'collected_desc' } = {}) {
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

  const sortMap = {
    collected_desc: 'ORDER BY created_at DESC',
    collected_asc: 'ORDER BY created_at ASC',
    date_asc: 'ORDER BY COALESCE(start_date, publication_date, created_at) ASC',
    date_desc: 'ORDER BY COALESCE(start_date, publication_date, created_at) DESC',
    poi_asc: 'ORDER BY poi_name ASC NULLS LAST, created_at DESC',
    poi_desc: 'ORDER BY poi_name DESC NULLS LAST, created_at DESC',
  };
  const orderBy = sortMap[sort] || sortMap.collected_desc;
  const wrappedQuery = `SELECT * FROM (${baseQuery}) AS q ${whereClause} ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
  const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS q ${whereClause}`;

  params.push(limit, offset);
  const countParams = params.slice(0, -2);

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

  const [sourceRow, targetRow] = await Promise.all([
    pool.query(`SELECT id, source_url, source_name FROM ${table} WHERE id = $1`, [sourceId]),
    pool.query(`SELECT id, source_url FROM ${table} WHERE id = $1`, [targetId])
  ]);

  if (sourceRow.rows.length === 0) throw new Error(`Source ${contentType} #${sourceId} not found`);
  if (targetRow.rows.length === 0) throw new Error(`Target ${contentType} #${targetId} not found`);

  const source = sourceRow.rows[0];
  const target = targetRow.rows[0];
  let movedUrls = 0;

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

  const item = await pool.query(`SELECT poi_id FROM ${table} WHERE id = $1`, [contentId]);
  if (item.rows.length === 0) throw new Error(`${contentType} #${contentId} not found`);
  const poiId = item.rows[0].poi_id;

  const candidatesQuery = await pool.query(`
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

  return candidatesQuery.rows;
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

  const item = await pool.query(`SELECT id, source_url FROM ${table} WHERE id = $1`, [contentId]);
  if (item.rows.length === 0) throw new Error(`${contentType} #${contentId} not found`);

  if (item.rows[0].source_url === url) {
    return { added: false, reason: 'URL matches primary source_url' };
  }

  const urlInsert = await pool.query(
    `INSERT INTO ${urlTable} (${fkColumn}, url, source_name)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ${urlTable} WHERE ${fkColumn} = $1 AND url = $2
     )
     RETURNING id`,
    [contentId, url, sourceName || null]
  );

  if (urlInsert.rows.length === 0) {
    return { added: false, reason: 'URL already exists' };
  }

  console.log(`[Moderation] Added URL to ${contentType} #${contentId}: ${url}`);
  return { added: true, urlId: urlInsert.rows[0].id };
}

export async function removeItemUrl(pool, contentType, contentId, urlId) {
  if (!['news', 'event'].includes(contentType)) {
    throw new Error('Additional URLs are only supported for news and event items');
  }

  const urlTable = contentType === 'news' ? 'poi_news_urls' : 'poi_event_urls';
  const fkColumn = contentType === 'news' ? 'news_id' : 'event_id';
  const deleteResult = await pool.query(`DELETE FROM ${urlTable} WHERE id = $1 AND ${fkColumn} = $2 RETURNING id`, [urlId, contentId]);

  if (deleteResult.rows.length === 0) throw new Error('URL not found');

  console.log(`[Moderation] Removed URL #${urlId} from ${contentType} #${contentId}`);
  return { removed: true };
}
