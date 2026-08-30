import { generateTextWithCustomPrompt } from './geminiService.js';
import { renderPage } from './renderPage.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';
import { parseDateTime, localToUTC, scoreDateConsensus, extractUrlDate } from './dateExtractor.js';
import { AUTO_PUBLISHER_USER_ID } from '../utils/systemUsers.js';
import { scoreDate, normalizeRenderUrl, normalizeTitle } from './newsService.js';
import { denyReason, sweepDenyLists, loadListSetting } from './filterLists.js';
import { getReassignmentCandidates } from './geoService.js';

const TABLE_MAP = {
  news: 'poi_news',
  event: 'poi_events',
  photo: 'poi_media'
};

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
- Spam, navigation chrome, an error page, or content with no discernible subject

Judge ONLY topical fit here — do NOT reject for geography. Whether the subject is
physically in Northeast Ohio is decided by a separate region check, not this vote.

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

// Region gate (spec 041): a dedicated geography check, independent of topical
// relevance. Relevance asks "is the SUBJECT on-topic"; Region asks "is the subject
// physically IN Northeast Ohio." Split out because a geographically-broad entity POI
// (e.g. "US Coast Guard") made out-of-region content pass the relevance gate via
// about_poi — the voters correctly saw it was out of region, but that judgment had
// nowhere to bind. Now it is its own gate. Mirrors the relevance voter: 3 votes,
// consensus decided by the caller.
async function runRegionVotes(pool, { title, description, poiName }, numVotes = 3) {
  const prompt = `You are checking the GEOGRAPHY of content for "Roots of The Valley," a guide to the Cuyahoga Valley region of Northeast Ohio — Cuyahoga and Summit counties and the immediately adjacent counties (Medina, Lorain, Lake, Geauga, Portage, Stark, Wayne). The core is Cuyahoga Valley National Park, Cleveland Metroparks, Summit Metro Parks, and the cities of Cleveland and Akron.

Title: "${title}"
Summary: "${description || '(none)'}"
Location/POI: ${poiName || '(unknown)'}

Is the SUBJECT of this content physically located IN that Northeast Ohio region?

Judge by WHERE the subject or events actually take place, NOT by the name of the
organization. A national or multi-state organization's activity in another place is
OUT of region even when that organization also has a local presence — e.g. a Coast
Guard change-of-command ceremony in Virginia, or a national park in another state,
is out of region even though the Coast Guard or the Park Service also operates here.

When the location is genuinely unclear and there is no signal placing the subject
outside the region, lean IN — regional collection already scoped the source.

Return ONLY valid JSON: {"in_region": true, "reasoning": "one sentence why"}`;

  const results = await Promise.all(
    Array.from({ length: numVotes }, () =>
      generateTextWithCustomPrompt(pool, prompt, { maxOutputTokens: 128, thinkingBudget: 0 })
        .then(r => {
          const raw = (r || '').trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
          try {
            const parsed = JSON.parse(raw);
            return { in_region: !!parsed.in_region, reasoning: parsed.reasoning || '' };
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
// above the floor — catches hallucinated 1800s values), AND has consensus at/above the
// threshold. Age is never penalized. Source reputation carries no weight here: an official
// domain with a weak machine-readable date goes to manual review like any other source.
export function evaluateDateGate(effectiveDate, dateScore, { threshold, floorYear, allowFuture = false }) {
  if (!effectiveDate) {
    return { verdict: 'review', reason: 'No publication date' };
  }
  const parsed = new Date(effectiveDate);
  if (Number.isNaN(parsed.getTime())) {
    return { verdict: 'review', reason: 'Unparseable publication date' };
  }
  if (!allowFuture && parsed > new Date()) {
    return { verdict: 'review', reason: `Future publication date ${effectiveDate}` };
  }
  const year = parsed.getUTCFullYear();
  if (year < floorYear) {
    return { verdict: 'review', reason: `Implausible year ${year} (below ${floorYear})` };
  }
  if (dateScore >= threshold) {
    return { verdict: 'pass', reason: `Date consensus ${dateScore}/${threshold}` };
  }
  return { verdict: 'review', reason: `Low date confidence ${dateScore}/${threshold}` };
}

// Region gate consensus (spec 041). Pure so it can be unit-tested. Requires 3 votes:
// unanimous in-region passes, unanimous out-of-region fails (→ reject), anything else
// (a split, or too few votes) goes to manual review. This is the gate that binds the
// geographic judgment the relevance voters were already making but had no place to use.
export function evaluateRegionGate(regionVotes) {
  const total = regionVotes.length;
  const inCount = regionVotes.filter(v => v.in_region).length;
  if (total < 3) {
    return { verdict: 'review', reason: `Region inconclusive (${inCount}/${total} in)` };
  }
  if (inCount === total) {
    return { verdict: 'pass', reason: `Region ${inCount}/${total} in` };
  }
  if (inCount === 0) {
    return { verdict: 'fail', reason: `Unanimous out of region (${regionVotes.map(v => v.reasoning).filter(Boolean).join('; ')})` };
  }
  return { verdict: 'review', reason: `Region split ${inCount}/${total} in` };
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
    `SELECT key, value FROM admin_settings WHERE key IN ('moderation_news_date_threshold', 'moderation_date_floor_year')`
  );
  const settings = Object.fromEntries(settingsRows.rows.map(r => [r.key, r.value]));
  const parsedNewsThreshold = parseInt(settings.moderation_news_date_threshold);
  const newsDateThreshold = Number.isNaN(parsedNewsThreshold) ? 4 : parsedNewsThreshold;
  const parsedFloorYear = parseInt(settings.moderation_date_floor_year);
  const dateFloorYear = Number.isNaN(parsedFloorYear) ? 2010 : parsedFloorYear;
  // Deny-listed POIs must never be a reassignment target (POI gate Tier 2).
  const deniedPoiIds = new Set((await loadListSetting(pool, 'news_collection_excluded_pois')).map(Number).filter(Number.isInteger));

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
    let fromConfiguredUrl = false;
    try { fromConfiguredUrl = row.source_url && poiConfigUrl && new URL(row.source_url).origin === new URL(poiConfigUrl).origin; }
    catch { /* malformed URL — treat as not from configured source */ }
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
            { jsonLd: signals.jsonLd || [], meta: signals.meta || [], timeTags: signals.timeTags || [], url: signals.url || null, searchDate: signals.searchDate || null, social: signals.social || [] },
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
            threshold: effectiveThreshold,
            sources: {
              jsonLd: ogDates.jsonLdDates || [],
              meta: [ogDates.publishedTime, ogDates.parselyPubDate, ogDates.dcDate].filter(Boolean),
              timeTags: ogDates.timeDates || [],
              url: extractUrlDate(row.source_url),
              social: ogDates.socialDates || []
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

    let relevanceVotes = [], regionVotes = [];
    // Fix: a vote counts as affirmative if the content is relevant to the guide's
    // mission OR specifically about this POI. Content genuinely about a mapped POI
    // belongs even when the topic isn't a classic outdoor/nature/history match —
    // otherwise a commercial POI's own news (e.g. a brewery) is wrongly rejected
    // while regional content passes. The POI gate still handles reassignment when
    // about_poi is false. (PR #483 follow-up)
    const isAffirmativeVote = v => v.relevant || v.about_poi;
    let yesCount = 0, noCount = 0, inRegionCount = 0;
    try {
      // Relevance and region are independent LLM votes — run concurrently so the
      // extra gate adds no wall-clock latency (spec 041).
      [relevanceVotes, regionVotes] = await Promise.all([
        runContentRelevanceVotes(pool, {
          title: row.title, description: row.description,
          poiName: row.poi_name, contentType
        }),
        runRegionVotes(pool, {
          title: row.title, description: row.description, poiName: row.poi_name
        })
      ]);

      yesCount = relevanceVotes.filter(isAffirmativeVote).length;
      noCount = relevanceVotes.filter(v => !isAffirmativeVote(v)).length;
      inRegionCount = regionVotes.filter(v => v.in_region).length;
      console.log(`[Moderation] ${contentType} #${contentId}: relevance ${yesCount}/${relevanceVotes.length} yes, region ${inRegionCount}/${regionVotes.length} in`);
      logInfo(itemRunId, 'moderation', null, row.title,
        `Relevance ${contentType} #${contentId}: ${yesCount}/${relevanceVotes.length} yes; region ${inRegionCount}/${regionVotes.length} in`);
    } catch (err) {
      console.error(`[Moderation] ${contentType} #${contentId}: relevance/region voting failed: ${err.message}`);
      logError(itemRunId, 'moderation', null, row.title, `Relevance/region voting failed: ${err.message}`);
    }

    const unanimousYes = relevanceVotes.length >= 3 && yesCount === relevanceVotes.length;
    const strongNo = relevanceVotes.length >= 3 && yesCount <= 1;

    const effectiveDate = newDate || row.publication_date;

    // Four independent gates — auto-publish only when all four pass (spec 030 + 041).
    // Events legitimately carry future dates, so the future-date check is news-only.
    const dateGate = evaluateDateGate(effectiveDate, newScore,
      { threshold: effectiveThreshold, floorYear: dateFloorYear, allowFuture: contentType === 'event' });

    // 3/3 → pass, 0-1/3 → fail (auto-reject), 2/3 → review (human)
    const relevanceGate = unanimousYes
      ? { verdict: 'pass', reason: `Relevance ${yesCount}/${relevanceVotes.length} yes` }
      : strongNo
        ? { verdict: 'fail', reason: `Relevance ${yesCount}/${relevanceVotes.length} yes (${relevanceVotes.filter(v => !isAffirmativeVote(v)).map(v => v.reasoning).join('; ')})` }
        : { verdict: 'review', reason: `Relevance split ${yesCount}/${relevanceVotes.length} yes` };

    // Region gate (spec 041): geography, independent of topical relevance. A unanimous
    // out-of-region verdict rejects — this is what stops a national-org POI (US Coast
    // Guard) from publishing an out-of-state story that relevance/about_poi let through.
    const regionGate = evaluateRegionGate(regionVotes);

    // Skip the POI gate's extra lookup/LLM call when relevance or region already failed (we reject regardless).
    const poiGate = (relevanceGate.verdict === 'fail' || regionGate.verdict === 'fail')
      ? { verdict: 'review', tier: 0, reason: 'Not evaluated (relevance/region failed)', reassigned_from: null, reassigned_to: null, newPoiId: null }
      : await evaluatePoiGate(pool, row, relevanceVotes, deniedPoiIds);

    let resolvedStatus;
    if (forceStatus) {
      resolvedStatus = forceStatus;
    } else if (relevanceGate.verdict === 'fail' || regionGate.verdict === 'fail') {
      resolvedStatus = 'rejected';
    } else if (dateGate.verdict === 'pass' && relevanceGate.verdict === 'pass' && regionGate.verdict === 'pass' && poiGate.verdict === 'pass') {
      resolvedStatus = 'published';
    } else {
      resolvedStatus = 'pending';
    }

    const gates = {
      date: { verdict: dateGate.verdict, reason: dateGate.reason },
      relevance: { verdict: relevanceGate.verdict, reason: relevanceGate.reason, yes: yesCount, total: relevanceVotes.length },
      region: { verdict: regionGate.verdict, reason: regionGate.reason, in_region: inRegionCount, total: regionVotes.length },
      poi: { verdict: poiGate.verdict, tier: poiGate.tier, reason: poiGate.reason, reassigned_from: poiGate.reassigned_from, reassigned_to: poiGate.reassigned_to }
    };
    const reasoning = forceStatus
      ? `Forced to ${forceStatus}`
      : `${resolvedStatus} — date: ${dateGate.verdict}; relevance: ${relevanceGate.verdict} (${yesCount}/${relevanceVotes.length}); region: ${regionGate.verdict} (${inRegionCount}/${regionVotes.length}); poi: ${poiGate.verdict}${poiGate.reassigned_to ? ` → #${poiGate.reassigned_to}` : ''}`;

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
    // Photos go straight to manual review — an AI scoring pass isn't worth its cost given
    // photo_submissions has effectively zero volume. forceStatus (an admin explicitly
    // approving or rejecting) is still honored.
    const resolvedStatus = forceStatus || 'pending';
    await pool.query(
      `UPDATE photo_submissions SET moderation_status = $1, moderation_processed = true WHERE id = $2`,
      [resolvedStatus, contentId]
    );
    console.log(`[Moderation] photo #${contentId}: → ${resolvedStatus} (manual review)`);
  }
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
      searchDate: signals.searchDate || null,
      social: signals.social || []
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
        url: extractUrlDate(item.source_url),
        social: ogDates.socialDates || []
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
