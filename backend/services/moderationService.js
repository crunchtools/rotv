import { moderateContent, moderatePhoto, generateTextWithCustomPrompt } from './geminiService.js';
import { renderPage } from './renderPage.js';
import { deepCrawlForArticle, isGenericUrl } from './deepCrawler.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';
import { parseDate, parseDateTime, localToUTC, scoreDateConsensus, extractUrlDate } from './dateExtractor.js';
import { AUTO_PUBLISHER_USER_ID } from '../utils/systemUsers.js';
import { scoreDate, normalizeRenderUrl, normalizeTitle } from './newsService.js';
import { denyReason, sweepDenyLists, loadListSetting } from './filterLists.js';
import { getReassignmentCandidates } from './geoService.js';

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
  const prompt = `You are evaluating content for "Roots of The Valley," a guide to Cuyahoga Valley National Park and the surrounding region including Cleveland Metroparks, Summit Metro Parks, and other nearby parks, trails, and outdoor recreation areas.

Title: "${title}"
Summary: "${description || '(none)'}"
Location: ${poiName || '(unknown)'}
Type: ${contentType}

Is this content a good fit for this guide?

APPROVE if the SUBJECT relates to the Cuyahoga Valley / Northeast Ohio outdoors —
nature, trails, hiking, biking, paddling, outdoor recreation, conservation, ecology,
wildlife, park operations, land management, environmental education, local/regional
history, scenic destinations and waterfalls, or outdoor arts/music events at a park or
nature organization. This INCLUDES, equally:
- News, announcements, and press releases
- Events and scheduled excursions/tours/rides (even recurring ones)
- Evergreen and descriptive content — trail write-ups, destination and "things to do"
  guides, historical features and local legends, scenic-spot descriptions, hike recaps
- Old content — a 2021 trail-opening article or a decades-old history piece is valid

Good, on-topic regional outdoor/park/history content is valuable to this guide whether
or not it reports a specific "happening." Do NOT reject it merely for being a
description, a reference page, a list, or evergreen rather than breaking news.

REJECT only if the content is genuinely a poor fit:
- Off-topic for an outdoor/park/history guide — a religious service or worship gathering,
  a political rally or partisan event, a private party/wedding/corporate rental, a purely
  commercial product/service listing, or a general community event unrelated to nature,
  parks, or regional history (e.g. book clubs, support groups, fitness classes, galas)
- About a place OUTSIDE Northeast Ohio (e.g. a trail or park in another state)
- Spam, navigation chrome, an error page, or content with no discernible subject

IMPORTANT: judge by SUBJECT, not venue. An off-topic event (a wedding, a political
rally) held at a park is still a reject. But on-topic content about the parks, trails,
nature, or history of the region is relevant even when it is purely descriptive.

Also judge "about_poi": is this content specifically about "${poiName || '(unknown)'}"
— either named directly or located there? Set about_poi false when the content is
relevant to the region but is really about a different, broader, or neighboring place.

Return ONLY valid JSON: {"relevant": true, "about_poi": true, "reasoning": "one sentence why"}`;

  const results = await Promise.all(
    Array.from({ length: numVotes }, () =>
      generateTextWithCustomPrompt(pool, prompt, { maxOutputTokens: 128, thinkingBudget: 0 })
        .then(r => {
          const raw = (r || '').trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
          try {
            const parsed = JSON.parse(raw);
            return { relevant: !!parsed.relevant, about_poi: !!parsed.about_poi, reasoning: parsed.reasoning || '' };
          } catch {
            return null;
          }
        })
        .catch(() => null)
    )
  );
  return results.filter(Boolean);
}

// Tier-2 POI gate: when content is relevant but not about its assigned POI, ask which
// candidate it actually belongs to — the assigned POI, its owner org, or its containing
// boundary — or none. Single call, fired only on a Tier-1 miss.
async function assignBestPoi(pool, { title, description, poiName }, candidates) {
  const options = ['assigned'];
  let optionText = `- "assigned": the content is about "${poiName || '(unknown)'}"`;
  if (candidates.owner) {
    options.push('owner');
    optionText += `\n- "owner": the content is about "${candidates.owner.name}" (the organization that owns it)`;
  }
  if (candidates.boundary) {
    options.push('boundary');
    optionText += `\n- "boundary": the content is about "${candidates.boundary.name}" (the park/area it sits within)`;
  }
  optionText += `\n- "none": none of the above`;

  const prompt = `You are routing a news/event item to the correct place for "Roots of The Valley."

Title: "${title}"
Summary: "${description || '(none)'}"

Which one is this content most about? Choose exactly one:
${optionText}

Return ONLY valid JSON: {"choice": "assigned|owner|boundary|none"}`;

  try {
    const r = await generateTextWithCustomPrompt(pool, prompt, { maxOutputTokens: 64, thinkingBudget: 0 });
    const raw = (r || '').trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    const choice = JSON.parse(raw).choice;
    return options.includes(choice) ? choice : 'none';
  } catch {
    return 'none';
  }
}

// Date gate: a date passes when it is present, not in the future, plausible (year at or
// above the floor — catches hallucinated 1800s values), AND trustworthy (consensus score
// at/above threshold OR from a trusted-domain source). Age is never penalized.
export function evaluateDateGate(effectiveDate, dateScore, sourceUrl, { threshold, floorYear, trustedSet, allowFuture = false }) {
  if (!effectiveDate) {
    return { verdict: 'review', reason: 'No publication date', trusted_source: false };
  }
  const parsed = new Date(effectiveDate);
  if (Number.isNaN(parsed.getTime())) {
    return { verdict: 'review', reason: 'Unparseable publication date', trusted_source: false };
  }
  if (!allowFuture && parsed > new Date()) {
    return { verdict: 'review', reason: `Future publication date ${effectiveDate}`, trusted_source: false };
  }
  const year = parsed.getUTCFullYear();
  if (year < floorYear) {
    return { verdict: 'review', reason: `Implausible year ${year} (below ${floorYear})`, trusted_source: false };
  }
  const trusted = getDomainReputation(sourceUrl, trustedSet) === 'trusted';
  if (dateScore >= threshold) {
    return { verdict: 'pass', reason: `Date consensus ${dateScore}/${threshold}`, trusted_source: trusted };
  }
  if (trusted) {
    return { verdict: 'pass', reason: `Trusted source date (consensus ${dateScore}/${threshold})`, trusted_source: true };
  }
  return { verdict: 'review', reason: `Low date confidence ${dateScore}/${threshold} from untrusted source`, trusted_source: false };
}

// POI gate (three tiers). Returns the verdict plus newPoiId when a Tier-2 reassignment
// should be applied by the caller's write. Never rejects.
//
// deniedPoiIds (the POI deny list) is filtered out of the candidates so a reassignment
// can never route an item onto a deny-listed POI — that would silently defeat the
// hard-reject deny check, which runs once against the original poi_id earlier in the
// pipeline. A would-be denied target drops the item to Tier 3 (manual review) instead.
export async function evaluatePoiGate(pool, row, votes, deniedPoiIds = new Set()) {
  const total = votes.length;
  const aboutCount = votes.filter(v => v.about_poi).length;
  if (total > 0 && aboutCount * 2 >= total) {
    return { verdict: 'pass', tier: 1, reason: `About assigned POI (${aboutCount}/${total} votes)`, reassigned_from: null, reassigned_to: null, newPoiId: null };
  }

  const candidates = await getReassignmentCandidates(pool, row.poi_id);
  if (candidates.owner && deniedPoiIds.has(candidates.owner.id)) candidates.owner = null;
  if (candidates.boundary && deniedPoiIds.has(candidates.boundary.id)) candidates.boundary = null;
  if (!candidates.owner && !candidates.boundary) {
    return { verdict: 'review', tier: 3, reason: 'Not about assigned POI; no eligible owner/boundary candidate', reassigned_from: null, reassigned_to: null, newPoiId: null };
  }

  const choice = await assignBestPoi(pool, { title: row.title, description: row.description, poiName: row.poi_name }, candidates);
  if (choice === 'assigned') {
    return { verdict: 'pass', tier: 1, reason: 'Confirmed about assigned POI', reassigned_from: null, reassigned_to: null, newPoiId: null };
  }
  const target = choice === 'owner' ? candidates.owner : choice === 'boundary' ? candidates.boundary : null;
  if (target) {
    return {
      verdict: 'pass', tier: 2,
      reason: `Reassigned to ${target.name} (${choice})`,
      reassigned_from: row.poi_id, reassigned_to: target.id, newPoiId: target.id
    };
  }
  return { verdict: 'review', tier: 3, reason: 'Not confidently about assigned POI, owner, or boundary', reassigned_from: null, reassigned_to: null, newPoiId: null };
}

export async function processItem(pool, contentType, contentId, { forceStatus = null, runId = null } = {}) {
  const itemRunId = runId || Math.floor(Date.now() / 1000);
  console.log(`[Moderation] Processing ${contentType} #${contentId}${forceStatus ? ` (forced → ${forceStatus})` : ''}`);

  const settingsRows = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key IN ('moderation_auto_approve_threshold', 'moderation_news_date_threshold', 'moderation_date_floor_year', 'moderation_trusted_domains')`
  );
  const settings = Object.fromEntries(settingsRows.rows.map(r => [r.key, r.value]));
  const parsedNewsThreshold = parseInt(settings.moderation_news_date_threshold);
  const newsDateThreshold = Number.isNaN(parsedNewsThreshold) ? 4 : parsedNewsThreshold;
  const parsedFloorYear = parseInt(settings.moderation_date_floor_year);
  const dateFloorYear = Number.isNaN(parsedFloorYear) ? 2010 : parsedFloorYear;
  let trustedSet = new Set();
  try {
    const domains = JSON.parse(settings.moderation_trusted_domains || '[]');
    if (Array.isArray(domains)) trustedSet = new Set(domains.map(d => String(d).toLowerCase().replace(/^www\./, '')));
  } catch { /* leave empty on bad JSON */ }
  const parsedPhotoThreshold = parseFloat(settings.moderation_auto_approve_threshold);
  const photoThreshold = Number.isNaN(parsedPhotoThreshold) ? 0.9 : parsedPhotoThreshold;
  // Deny-listed POIs must never be a reassignment target (POI gate Tier 2).
  const deniedPoiIds = new Set((await loadListSetting(pool, 'news_collection_excluded_pois')).map(Number).filter(Number.isInteger));

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

    // Hard-reject deny lists (POI deny list, content deny list) — see filterLists.js.
    const reason = await denyReason(pool, contentType, row);
    if (reason) {
      await pool.query(
        `UPDATE ${table} SET moderation_processed = true, ai_reasoning = $1, moderation_status = 'rejected' WHERE id = $2`,
        [reason, contentId]
      );
      console.log(`[Moderation] ${contentType} #${contentId}: ${reason}`);
      logInfo(itemRunId, 'moderation', null, row.title, `Rejected ${contentType} #${contentId}: ${reason}`, { completed: true });
      return;
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
            { jsonLd: signals.jsonLd || [], meta: signals.meta || [], timeTags: signals.timeTags || [], url: signals.url || null, searchDate: signals.searchDate || null },
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
    // Fix: a vote counts as affirmative if the content is relevant to the guide's
    // mission OR specifically about this POI. Content genuinely about a mapped POI
    // belongs even when the topic isn't a classic outdoor/nature/history match —
    // otherwise a commercial POI's own news (e.g. a brewery) is wrongly rejected
    // while regional content passes. The POI gate still handles reassignment when
    // about_poi is false. (PR #483 follow-up)
    const isAffirmativeVote = v => v.relevant || v.about_poi;
    try {
      relevanceVotes = await runContentRelevanceVotes(pool, {
        title: row.title, description: row.description,
        poiName: row.poi_name, contentType
      });

      const yesCount = relevanceVotes.filter(isAffirmativeVote).length;
      const noCount = relevanceVotes.filter(v => !isAffirmativeVote(v)).length;
      console.log(`[Moderation] ${contentType} #${contentId}: relevance votes ${yesCount}/${relevanceVotes.length} yes`);
      logInfo(itemRunId, 'moderation', null, row.title,
        `Relevance ${contentType} #${contentId}: ${yesCount}/${relevanceVotes.length} yes`);
    } catch (err) {
      console.error(`[Moderation] ${contentType} #${contentId}: relevance voting failed: ${err.message}`);
      logError(itemRunId, 'moderation', null, row.title, `Relevance voting failed: ${err.message}`);
    }

    const yesCount = relevanceVotes.filter(isAffirmativeVote).length;
    const noCount = relevanceVotes.filter(v => !isAffirmativeVote(v)).length;
    const unanimousYes = relevanceVotes.length >= 3 && yesCount === relevanceVotes.length;
    const unanimousNo = relevanceVotes.length >= 3 && noCount === relevanceVotes.length;

    const effectiveDate = newDate || row.publication_date;

    // Three independent gates — auto-publish only when all three pass (spec 030).
    // Events legitimately carry future dates, so the future-date check is news-only.
    const dateGate = evaluateDateGate(effectiveDate, newScore, row.source_url,
      { threshold: effectiveThreshold, floorYear: dateFloorYear, trustedSet, allowFuture: contentType === 'event' });

    const relevanceGate = unanimousYes
      ? { verdict: 'pass', reason: `Relevance ${yesCount}/${relevanceVotes.length} yes` }
      : unanimousNo
        ? { verdict: 'fail', reason: `Unanimous NO (${relevanceVotes.map(v => v.reasoning).join('; ')})` }
        : { verdict: 'review', reason: `Relevance split ${yesCount}/${relevanceVotes.length} yes` };

    // Skip the POI gate's extra lookup/LLM call when relevance already failed (we reject regardless).
    const poiGate = relevanceGate.verdict === 'fail'
      ? { verdict: 'review', tier: 0, reason: 'Not evaluated (relevance failed)', reassigned_from: null, reassigned_to: null, newPoiId: null }
      : await evaluatePoiGate(pool, row, relevanceVotes, deniedPoiIds);

    let resolvedStatus;
    if (forceStatus) {
      resolvedStatus = forceStatus;
    } else if (relevanceGate.verdict === 'fail') {
      resolvedStatus = 'rejected';
    } else if (dateGate.verdict === 'pass' && relevanceGate.verdict === 'pass' && poiGate.verdict === 'pass') {
      resolvedStatus = 'published';
    } else {
      resolvedStatus = 'pending';
    }

    const gates = {
      date: { verdict: dateGate.verdict, reason: dateGate.reason, trusted_source: dateGate.trusted_source },
      relevance: { verdict: relevanceGate.verdict, reason: relevanceGate.reason, yes: yesCount, total: relevanceVotes.length },
      poi: { verdict: poiGate.verdict, tier: poiGate.tier, reason: poiGate.reason, reassigned_from: poiGate.reassigned_from, reassigned_to: poiGate.reassigned_to }
    };
    const reasoning = forceStatus
      ? `Forced to ${forceStatus}`
      : `${resolvedStatus} — date: ${dateGate.verdict}; relevance: ${relevanceGate.verdict} (${yesCount}/${relevanceVotes.length}); poi: ${poiGate.verdict}${poiGate.reassigned_to ? ` → #${poiGate.reassigned_to}` : ''}`;

    scoring = { confidence_score: newScore / 8.0, reasoning };
    const autoModeratedBy = resolvedStatus !== 'pending' ? AUTO_PUBLISHER_USER_ID : null;
    const newPoiId = poiGate.newPoiId; // Tier-2 reassignment target, or null to keep current poi_id
    const gatesJson = JSON.stringify(gates);
    // publication_date is only overwritten when a rescore produced a new value; otherwise
    // COALESCE keeps the existing value (writing the old value back can corrupt a good timestamp).
    const pubDateUpdate = rescoredDate ? newDate : null;
    await pool.query(
      `UPDATE ${table} SET moderation_processed = true, moderation_status = $1,
              publication_date = COALESCE($2, publication_date), date_consensus_score = $3,
              ai_reasoning = $4, relevance_signals = $5, moderation_gates = $6::jsonb,
              poi_id = COALESCE($7, poi_id), moderation_date = CURRENT_TIMESTAMP,
              moderated_by = COALESCE($8, moderated_by),
              moderated_at = CASE WHEN $8 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE moderated_at END
       WHERE id = $9`,
      [resolvedStatus, pubDateUpdate, newScore, reasoning,
       relevanceVotes.length > 0 ? JSON.stringify(relevanceVotes) : null,
       gatesJson, newPoiId, autoModeratedBy, contentId]
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

export async function processPendingItems(pool) {
  const runId = Math.floor(Date.now() / 1000);
  const enabledQuery = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'moderation_enabled'"
  );
  if (enabledQuery.rows.length && enabledQuery.rows[0].value === 'false') {
    console.log('[Moderation] Moderation disabled, skipping sweep');
    return { processed: 0 };
  }

  // Retroactively reject stored items matching any deny list (POI, content), so
  // adding to a list cleans up already-approved items, not just new ones.
  try {
    await sweepDenyLists(pool, { runId, logInfo });
  } catch (e) {
    console.error('[Moderation] Deny-list sweep failed:', e.message);
  }

  // Per-cycle batch size is configurable so a monthly collection dump clears in a few
  // sweep cycles instead of grinding through 20 at a time (spec 030).
  const batchRow = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'moderation_sweep_batch_size'"
  );
  const parsedBatch = parseInt(batchRow.rows[0]?.value);
  const batchSize = Number.isNaN(parsedBatch) || parsedBatch <= 0 ? 50 : parsedBatch;

  const pendingNews = await pool.query(
    `SELECT id FROM poi_news WHERE moderation_status = 'pending' AND moderation_processed = false LIMIT $1`,
    [batchSize]
  );
  const pendingEvents = await pool.query(
    `SELECT id FROM poi_events WHERE moderation_status = 'pending' AND moderation_processed = false LIMIT $1`,
    [batchSize]
  );
  const pendingPhotos = await pool.query(
    `SELECT id FROM photo_submissions WHERE moderation_status = 'pending' AND moderation_processed = false LIMIT $1`,
    [batchSize]
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
      `INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, moderation_status, submitted_by, moderated_by, moderated_at, content_source)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7, $7, CURRENT_TIMESTAMP, 'human') RETURNING id`,
      [fields.poi_id, fields.title, fields.summary || null, fields.source_url || null,
       fields.source_name || null, fields.news_type || 'general', adminUserId]
    );
    return inserted.rows[0].id;
  } else if (contentType === 'event') {
    const inserted = await pool.query(
      `INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url, moderation_status, submitted_by, moderated_by, moderated_at, content_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9, $9, CURRENT_TIMESTAMP, 'human') RETURNING id`,
      [fields.poi_id, fields.title, fields.description || null, fields.start_date,
       fields.end_date || null, fields.event_type || null, fields.location_details || null,
       fields.source_url || null, adminUserId]
    );
    return inserted.rows[0].id;
  } else if (contentType === 'photo') {
    const inserted = await pool.query(
      `INSERT INTO photo_submissions (poi_id, caption, moderation_status, submitted_by, moderated_by, moderated_at)
       VALUES ($1, $2, 'published', $3, $3, CURRENT_TIMESTAMP) RETURNING id`,
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
      url: signals.url || null,
      searchDate: signals.searchDate || null
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
           n.moderation_status, n.confidence_score, n.ai_reasoning, n.ai_issues, n.moderation_gates,
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
           e.moderation_status, e.confidence_score, e.ai_reasoning, e.ai_issues, e.moderation_gates,
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
           moderation_status, confidence_score, ai_reasoning, NULL AS ai_issues, NULL::jsonb AS moderation_gates,
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

  const typeCountQuery = `SELECT content_type, COUNT(*) AS cnt FROM (${baseQuery}) AS q ${whereClause} GROUP BY content_type`;

  const [queueItems, countRow, typeCountRows] = await Promise.all([
    pool.query(wrappedQuery, params),
    pool.query(countQuery, countParams),
    pool.query(typeCountQuery, countParams)
  ]);

  const typeCounts = { news: 0, event: 0, photo: 0 };
  for (const r of typeCountRows.rows) typeCounts[r.content_type] = parseInt(r.cnt);

  return { items: queueItems.rows, total: parseInt(countRow.rows[0].count), page, limit, typeCounts };
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
