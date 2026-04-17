/**
 * News Collection Service
 * Two-phase pipeline: Phase I crawls POI's own pages, Phase II searches via Serper.
 * Both phases use Gemini for summarization, chrono-node for dates.
 *
 * Job execution is managed by pg-boss for crash recovery and resumability.
 * Progress is checkpointed after each batch so jobs can resume after container restarts.
 */

import { generateTextWithCustomPrompt as geminiGenerateText } from './geminiService.js';
import { parseDate, extractDatesFromText } from './dateExtractor.js';

// Gemini call counter for job usage stats
let geminiCallCount = 0;

export function resetJobUsage() {
  geminiCallCount = 0;
}

export function getJobUsage() {
  return { gemini: geminiCallCount };
}

export function getJobStats() {
  return {
    usage: { gemini: geminiCallCount },
    errors: {},
    activeProvider: 'gemini'
  };
}

/**
 * Wrapper around geminiService that tracks usage and returns { response, provider }
 */
async function generateTextWithCustomPrompt(pool, prompt) {
  geminiCallCount++;
  const text = await geminiGenerateText(pool, prompt);
  return { response: text, provider: 'gemini' };
}
import { extractPageContent } from './contentExtractor.js';
import { logInfo, logWarn, logError, flush as flushJobLogs } from './jobLogger.js';
import { CollectionTracker, runBatch } from './collection/index.js';
import { searchNewsUrls } from './serperService.js';
import fs from 'fs';

function debugLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}\n`;
  try {
    fs.appendFileSync('/tmp/logs/debug.log', logMessage);
  } catch (err) {
    // Ignore
  }
  console.error(message);
}

// Dispatch interval: start one new POI job every N milliseconds
const DISPATCH_INTERVAL_MS = 1500;
// Maximum number of concurrent jobs in flight
const MAX_CONCURRENCY = 10;

// Shared progress + slot tracker for news collection
const tracker = new CollectionTracker('News');

// Re-export tracker methods under original names for backward compatibility
// (used by mcpServer.js, admin.js, server.js)
export const updateProgress = (poiId, updates) => tracker.updateProgress(poiId, updates);
export const getCollectionProgress = (poiId) => tracker.getCollectionProgress(poiId);
export const clearProgress = (poiId) => tracker.clearProgress(poiId);
export const getAllActiveProgress = () => tracker.getAllActiveProgress();
export const initializeSlots = (jobId) => tracker.initializeSlots(jobId);
export const getDisplaySlots = (jobId) => tracker.getDisplaySlots(jobId);
export const requestCancellation = (poiId) => tracker.requestCancellation(poiId);
export const isCancellationRequested = (poiId) => tracker.isCancellationRequested(poiId);

/**
 * Ensure the news_job_status table has checkpoint columns for resumability
 * Call this during server startup
 */
export async function ensureNewsJobCheckpointColumns(pool) {
  const runId = Math.floor(Date.now() / 1000);
  try {
    // Add poi_ids column if it doesn't exist
    await pool.query(`
      ALTER TABLE news_job_status
      ADD COLUMN IF NOT EXISTS poi_ids TEXT
    `);

    // Add processed_poi_ids column if it doesn't exist
    await pool.query(`
      ALTER TABLE news_job_status
      ADD COLUMN IF NOT EXISTS processed_poi_ids TEXT
    `);

    // Add pg_boss_job_id column if it doesn't exist
    await pool.query(`
      ALTER TABLE news_job_status
      ADD COLUMN IF NOT EXISTS pg_boss_job_id VARCHAR(100)
    `);

    logInfo(runId, 'news', null, null, 'News job checkpoint columns verified');
  } catch (error) {
    logError(runId, 'news', null, null, `Error ensuring checkpoint columns: ${error.message}`);
  }
}

/**
 * Find incomplete jobs that need to be resumed after a restart
 * @param {Pool} pool - Database connection pool
 * @returns {Array} - Array of job records that need resuming
 */
export async function findIncompleteJobs(pool) {
  // Only resume jobs from the last 1 hour — older ones are stale
  // (e.g. imported via seed data from a previous run)
  const result = await pool.query(`
    SELECT * FROM news_job_status
    WHERE status IN ('queued', 'running')
    AND created_at > NOW() - INTERVAL '1 hour'
    ORDER BY created_at ASC
  `);
  return result.rows;
}

/**
 * Classify a web page as LISTING or DETAIL using Gemini.
 * Sends first 3000 chars of markdown + first 20 links, returns classification.
 *
 * @param {Pool} pool - Database connection pool
 * @param {string} markdown - Page markdown content
 * @param {Array} links - Extracted links from the page
 * @param {string} url - The page URL
 * @param {string} contentType - 'event' or 'news'
 * @param {Object} sheets - Optional sheets client for API key restore
 * @returns {Object} - { pageType, detailLinks, reasoning }
 */
async function classifyPage(pool, markdown, links, url, contentType, sheets) {
  // Prioritize content links over navigation — "Read More", article-pattern URLs, etc.
  // Navigation links (menus, footers) dominate the first positions in DOM order,
  // burying the actual article links the classifier needs to see.
  let sourceOrigin;
  try { sourceOrigin = new URL(url).pathname; } catch { sourceOrigin = ''; }
  const contentLinks = (links || []).filter(l => {
    const text = (l.text || '').toLowerCase();
    // Links with action text
    if (/read\s*more|continue|full\s*(article|story)|learn\s*more|details/i.test(text)) return true;
    // Links in article-like containers
    if (/\b(article|post|news|event|card|entry|blog)\b/i.test(l.parentClassName || '')) return true;
    if (/\b(article|post|news|event|card|entry|blog)\b/i.test(l.className || '')) return true;
    // Links whose URL extends the current page path (e.g., /news-updates/ → /news-updates/article-slug/)
    try {
      const linkPath = new URL(l.url).pathname;
      if (sourceOrigin.length > 1 && linkPath.startsWith(sourceOrigin) && linkPath !== sourceOrigin && linkPath !== sourceOrigin + '/') return true;
    } catch { /* ignore */ }
    return false;
  });
  // Use content links first, then fill with remaining links up to 30
  const seen = new Set(contentLinks.map(l => l.url));
  const otherLinks = links.filter(l => !seen.has(l.url));
  const rankedLinks = [...contentLinks, ...otherLinks].slice(0, 30);

  const prompt = `Classify this web page. Based on the content, is it:
A) LISTING — lists multiple ${contentType}s with links to individual pages
B) DETAIL — describes a single ${contentType} with dates/descriptions/details

PAGE URL: ${url}
CONTENT (first 3000 chars):
${markdown.substring(0, 3000)}

LINKS (${rankedLinks.length} most relevant, content links first):
${rankedLinks.map(l => `- "${(l.text || '').substring(0, 60)}" → ${l.url}`).join('\n')}

Return ONLY valid JSON:
{"page_type": "listing|detail", "reasoning": "one sentence", "detail_links": ["url1", "url2"]}
For LISTING: populate detail_links with URLs to individual ${contentType} pages (max 15).
For DETAIL: detail_links should be empty.`;

  const result = await generateTextWithCustomPrompt(pool, prompt);

  // Parse JSON from response (handle markdown code blocks)
  const text = result.response || result;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { pageType: 'listing', detailLinks: links.map(l => l.url).slice(0, 15), reasoning: 'parse failure fallback' };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { pageType: (parsed.page_type || '').toLowerCase(), detailLinks: parsed.detail_links || [], reasoning: parsed.reasoning };
  } catch {
    return { pageType: 'listing', detailLinks: links.map(l => l.url).slice(0, 15), reasoning: 'parse failure fallback' };
  }
}

/**
 * Filter detail links to same-origin, deduplicate, and cap at 15.
 *
 * @param {Array} detailLinks - URLs returned by the classifier
 * @param {string} sourceUrl - The page URL that produced these links
 * @returns {Array} - Filtered, deduplicated URLs
 */
function filterDetailLinks(detailLinks, sourceUrl) {
  if (!detailLinks?.length) return [];
  let sourceOrigin;
  try { sourceOrigin = new URL(sourceUrl).origin; } catch { return []; }
  const seen = new Set();
  return detailLinks.filter(link => {
    try {
      const parsed = new URL(link);
      if (parsed.origin !== sourceOrigin) return false;
      if (seen.has(link)) return false;
      seen.add(link);
      return true;
    } catch { return false; }
  }).slice(0, 15);
}

/**
 * Extract {news: [], events: []} from Gemini response text.
 * Handles markdown code blocks and raw JSON.
 *
 * @param {string} responseText - Raw Gemini response
 * @returns {Object} - { news: [], events: [] }
 */
function parseGeminiResponse(responseText) {
  const text = responseText || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { news: [], events: [] };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { news: parsed.news || [], events: parsed.events || [] };
  } catch {
    return { news: [], events: [] };
  }
}

/**
 * Build a Gemini prompt for a single rendered page.
 * No multi-page headers, no concatenation — one page per call.
 *
 * @param {Object} poi - POI object (name, poi_type, primary_activities)
 * @param {string} url - The URL that was rendered
 * @param {string} markdown - Rendered page markdown
 * @param {Array} dateHints - chrono-node date hints from this page
 * @param {string} contentType - 'event' or 'news'
 * @param {string} confidence - '75%' for Phase I, '95%' for Phase II
 * @returns {string} - Complete prompt
 */
function buildSinglePagePrompt(poi, url, markdown, contentType, confidence) {
  const activities = poi.primary_activities || 'None specified';

  // Gemini identifies items and writes summaries. It does NOT extract dates.
  // chrono-node handles all date extraction — dates are applied after Gemini returns.

  let prompt = `Extract ${contentType === 'event' ? 'events' : 'news'} from this single web page about "${poi.name}".

POI: "${poi.name}" (${poi.poi_type})
Activities: ${activities}
Source URL: ${url}

MISSION SCOPE — Roots of The Valley:
Only include items that connect to Cuyahoga Valley National Park themes: nature, trails,
outdoor recreation, conservation, local history, ecology, wildlife, community stewardship,
scenic railroads, canal towpath heritage, or arts/culture organizations that serve the valley.
Skip generic urban news, restaurant openings, nightlife, sports, or entertainment unrelated
to the park's mission. Ask: "Would a CVNP visitor care about this?"

CONFIDENCE THRESHOLD: ${confidence}
You must be at least ${confidence} confident that each item is specifically about "${poi.name}".

PAGE CONTENT:
${markdown}`;

  if (contentType === 'event') {
    prompt += `

**MULTIPLE EVENTS ON ONE PAGE**
- If the page lists multiple events, create a SEPARATE entry for each one
- This is common for recurring excursions — treat each as its own event

Return a JSON object with this exact structure:
{
  "events": [
    {
      "title": "Event name",
      "description": "Brief description - must specify this event is at ${poi.name}",
      "event_type": "hike|race|concert|festival|program|volunteer|arts|community|alert",
      "location_details": "Must be at or near ${poi.name} specifically",
      "source_url": "${url}"
    }
  ]
}

IMPORTANT:
- Do NOT include date fields — dates are extracted separately
- Set source_url to "${url}" on every event
- Return {"events": []} if no relevant events found`;
  } else {
    prompt += `

Return a JSON object with this exact structure:
{
  "news": [
    {
      "title": "News headline",
      "summary": "2-3 sentence summary - must explain how this relates to ${poi.name} specifically",
      "source_name": "Source name (e.g., NPS.gov, Cleveland.com)",
      "source_url": "${url}",
      "news_type": "general|alert|wildlife|infrastructure|community"
    }
  ]
}

IMPORTANT:
- Do NOT include date fields — dates are extracted separately
- Set source_url to "${url}" on every news item
- Return {"news": []} if no relevant news found`;
  }

  return prompt;
}

/**
 * Process a single URL through the complete pipeline:
 * Render → Dates → Summarize → force source_url
 *
 * Every item returned has source_url = the URL that was rendered.
 * No batching, no concatenation, no cross-page anything.
 *
 * @param {Pool} pool - Database connection pool
 * @param {string} url - URL to process
 * @param {Object} poi - POI object
 * @param {string} contentType - 'event' or 'news'
 * @param {Object} options - { phase, jobId, timezone, confidence }
 * @returns {Object} - { news: [], events: [] }
 */
async function processOneUrl(pool, url, poi, contentType, options = {}) {
  const { phase = 'Phase I', jobId = 0, timezone = 'America/New_York', confidence = '75%', jobType = 'news' } = options;

  // [Render]
  logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Render] ${url}`);
  const extracted = await extractPageContent(url, { timeout: 30000, hardTimeout: 60000 });
  if (!extracted.reachable || !extracted.markdown || extracted.markdown.length < 200) {
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Render] Skip — ${extracted.reason || 'too short'} (${extracted.markdown?.length || 0} chars)`);
    return { news: [], events: [] };
  }

  // [Dates] — OG metadata first (structured, reliable), chrono-node as fallback
  // These are applied directly to items AFTER Gemini returns — Gemini never touches dates
  const today = new Date().toISOString().substring(0, 10);
  const ogRaw = extracted.ogDates?.publishedTime
    ? parseDate(extracted.ogDates.publishedTime, timezone)
    : null;
  // Discard OG date if it's in the future — likely an event date or bad metadata, not the publish date
  const ogPublished = (ogRaw && ogRaw <= today) ? ogRaw : null;
  if (ogRaw && ogRaw > today) {
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Dates] Discarding future OG date ${ogRaw}, falling back to chrono-node`);
  }
  const dateHints = extractDatesFromText(extracted.markdown, timezone);
  const chronoPrimary = dateHints.length > 0 ? dateHints[0].start?.substring(0, 10) : null;
  // Discard chrono-node date when it equals today and there's no OG metadata — live pages
  // often show today's date in navigation/footers, which is page noise not a publication date.
  const chronoUsable = (chronoPrimary && chronoPrimary !== today) ? chronoPrimary : null;
  if (chronoPrimary && chronoPrimary === today && !ogPublished) {
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Dates] Discarding today-date from chrono-node (likely page noise), no OG fallback`);
  }
  const rawPrimaryDate = ogPublished || chronoUsable;
  // For news, cap publication date at today — future dates are issue/cover dates, not publish dates
  const primaryDate = (contentType === 'news' && rawPrimaryDate && rawPrimaryDate > today) ? today : rawPrimaryDate;
  if (contentType === 'news' && rawPrimaryDate && rawPrimaryDate > today) {
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Dates] Capping future news date ${rawPrimaryDate} to today ${today}`);
  }
  const secondDate = dateHints.length > 1 ? dateHints[1].start?.substring(0, 10) : null;
  const dateSource = ogPublished ? 'og' : (chronoUsable ? 'chrono' : 'none');
  logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Dates] ${primaryDate || 'none'} (${dateSource}), ${dateHints.length} chrono hints from ${url}`);

  // [Summarize] — Gemini identifies items and writes summaries (no date fields)
  const prompt = buildSinglePagePrompt(poi, url, extracted.markdown, contentType, confidence);
  logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Summarize] ${url}`);
  const aiResult = await generateTextWithCustomPrompt(pool, prompt);

  // Parse Gemini response, then apply dates and force source_url.
  // Every URL that reaches processOneUrl is a DETAIL page (one article or one event).
  // The crawler already resolved listings → detail pages before we get here.
  const result = parseGeminiResponse(aiResult.response);

  for (const item of (result.news || [])) {
    item.source_url = url;
    item.published_date = primaryDate;
  }

  for (const event of (result.events || [])) {
    event.source_url = url;
    event.start_date = primaryDate;
    event.end_date = secondDate || null;
  }

  logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Summarize] ${result.news?.length || 0} news, ${result.events?.length || 0} events from ${url}`);
  return result;
}

/**
 * Recursive AI-classified tree walker for dedicated URL crawling.
 * Visits each page, asks Gemini to classify it, follows links on listing pages,
 * collects content from detail pages. URLs come from actual page visits — no fabrication.
 *
 * @param {Pool} pool - Database connection pool
 * @param {string} startUrl - The starting URL to crawl
 * @param {string} contentType - 'event' or 'news'
 * @param {Object} poi - POI object for context
 * @param {Object} sheets - Optional sheets client
 * @param {Function} checkCancellation - Cancellation checker
 * @param {Object} options - Optional overrides
 * @returns {Object} - { pages: [{url, markdown, title}], totalPagesRendered, totalDetailPages }
 */
async function crawlWithClassification(pool, startUrl, contentType, poi, sheets, checkCancellation, options = {}) {
  const { maxDepth = 2, maxPages = 50, maxDetailPages = 30, renderDelayMs = 1500, extractor = extractPageContent, phase = 'Phase I', jobId = 0, jobType = 'news' } = options;
  const visited = new Set();
  let totalPagesRendered = 0;
  const collectedPages = []; // { url, markdown, title }

  async function processLevel(urls, depth) {
    if (depth > maxDepth || totalPagesRendered >= maxPages || collectedPages.length >= maxDetailPages) return;
    for (const url of urls) {
      checkCancellation();
      if (totalPagesRendered >= maxPages || collectedPages.length >= maxDetailPages) break;
      if (visited.has(url)) continue;
      visited.add(url);
      totalPagesRendered++;

      // Delay between renders to avoid rate limiting (Wix, etc.)
      if (totalPagesRendered > 1) {
        await new Promise(resolve => setTimeout(resolve, renderDelayMs));
      }

      logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Render] ${url} (depth=${depth}, page=${totalPagesRendered})`);
      const extracted = await extractor(url, { timeout: 30000, hardTimeout: 60000, extractLinks: true });
      if (!extracted.reachable || !extracted.markdown) {
        logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Render] Skip — ${extracted.reason || 'no content'}`);
        continue;
      }

      const classification = await classifyPage(pool, extracted.markdown, extracted.links || [], url, contentType, sheets);
      logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Classify] ${url} → ${classification.pageType} (${classification.reasoning})`);

      if (classification.pageType === 'detail') {
        collectedPages.push({ url, markdown: extracted.markdown, title: extracted.title });
      } else if (classification.pageType === 'listing') {
        const validLinks = filterDetailLinks(classification.detailLinks, url);
        logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Crawl] Following ${validLinks.length} detail links from ${url}`);
        await processLevel(validLinks, depth + 1);
      } else if (classification.pageType === 'hybrid') {
        collectedPages.push({ url, markdown: extracted.markdown, title: extracted.title });
        const validLinks = filterDetailLinks(classification.detailLinks, url);
        if (validLinks.length > 0) {
          logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Crawl] Following ${validLinks.length} detail links from hybrid page ${url}`);
          await processLevel(validLinks, depth + 1);
        }
      }
    }
  }

  await processLevel([startUrl], 0);
  return { pages: collectedPages, totalPagesRendered, totalDetailPages: collectedPages.length };
}

/**
 * Collect news and events for a specific POI
 * @param {Pool} pool - Database connection pool
 * @param {Object} poi - POI object with id, name, poi_type, primary_activities, more_info_link, events_url, news_url
 * @param {Object} sheets - Optional sheets client for API key restore
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @param {string} collectionType - 'news', 'events', or 'both' to indicate what's being collected
 * @returns {Object} - { news: [], events: [] }
 */
export async function collectNewsForPoi(pool, poi, sheets = null, timezone = 'America/New_York', collectionType = 'both', onProgress = null) {
  const activities = poi.primary_activities || 'None specified';
  const website = poi.more_info_link || 'No website available';
  const eventsUrl = poi.events_url || 'No dedicated events page';
  const newsUrl = poi.news_url || 'No dedicated news page';

  // Preserve slotId, jobId, and jobType if they exist (set by job processing loop or single-POI trigger)
  const existingProgress = tracker.getCollectionProgress(poi.id);
  const slotId = existingProgress?.slotId;
  const jobId = existingProgress?.jobId;
  const jobType = existingProgress?.jobType || 'news';

  logInfo(jobId, jobType, poi.id, poi.name, `Collection type: ${collectionType}`);

  // Clear any old progress data for this POI before starting
  tracker.clearProgress(poi.id);

  // Initialize progress tracking with fresh data (preserving slotId/jobId)
  const typeLabel = collectionType === 'news' ? 'news' : collectionType === 'events' ? 'events' : 'news & events';
  updateProgress(poi.id, {
    phase: 'initializing',
    message: `Starting ${typeLabel} search for ${poi.name}...`,
    poiName: poi.name,
    provider: 'gemini',
    newsFound: 0,
    eventsFound: 0,
    newsSaved: undefined,
    eventsSaved: undefined,
    newsDuplicate: undefined,
    eventsDuplicate: undefined,
    steps: ['Initialized'],
    collectionType,
    startTime: Date.now(),
    phaseHistory: [],
    completed: false,
    slotId,  // Preserve slot assignment
    jobId    // Preserve job association
  });

  // Progress reporting helper — calls callback if provided
  const reportProgress = (message) => {
    if (onProgress) onProgress(message);
  };

  logInfo(jobId, jobType, poi.id, poi.name, 'Starting search', { website, eventsUrl, newsUrl, activities });

  // Helper to check for cancellation and throw if requested
  const checkCancellation = () => {
    if (isCancellationRequested(poi.id)) {
      logInfo(jobId, jobType, poi.id, poi.name, 'Cancellation detected');
      updateProgress(poi.id, {
        phase: 'error',
        message: 'Collection cancelled by user',
        completed: true
      });
      throw new Error('Collection cancelled by user');
    }
  };

  const allEvents = [];
  const allNews = [];
  let usedDedicatedNewsUrl = false;

  // Per-URL caps — each page gets its own Gemini call
  const MAX_PHASE1_PAGES = 10;
  const MAX_PHASE2_PAGES = 5;

  // PHASE I EVENTS: Classify → Crawl → per-URL pipeline
  if (collectionType !== 'news' && eventsUrl !== 'No dedicated events page') {
    try {
      checkCancellation();
      reportProgress(`Phase I: [Render] Rendering events page: ${eventsUrl}`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Render] Starting events pipeline`, { url: eventsUrl });
      updateProgress(poi.id, {
        phase: 'classifying_events',
        message: 'Analyzing events pages...',
        steps: ['Initialized', 'Classifying events pages']
      });
      const crawlResult = await crawlWithClassification(pool, eventsUrl, 'event', poi, sheets, checkCancellation, { phase: 'Phase I', jobId, jobType });

      const pages = crawlResult.pages.slice(0, MAX_PHASE1_PAGES);

      reportProgress(`Phase I: [Classify] ${crawlResult.pages.length} event pages found (${crawlResult.totalPagesRendered} rendered)`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Classify] ${crawlResult.pages.length} event pages (${crawlResult.totalPagesRendered} rendered), processing ${pages.length} URLs`);

      for (const page of pages) {
        checkCancellation();
        const items = await processOneUrl(pool, page.url, poi, 'event', { phase: 'Phase I', jobId, jobType, timezone, confidence: '75%' });
        allEvents.push(...(items.events || []));
      }
    } catch (err) {
      if (err.message === 'Collection cancelled by user') throw err;
      reportProgress(`Phase I: Events crawl failed: ${err.message}`);
      logWarn(jobId, jobType, poi.id, poi.name, `Phase I: Events classification failed: ${err.message}`);
    }
  }

  // PHASE I NEWS: Classify → Crawl → per-URL pipeline
  if (collectionType !== 'events' && newsUrl !== 'No dedicated news page') {
    try {
      checkCancellation();
      reportProgress(`Phase I: [Render] Rendering news page: ${newsUrl}`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Render] Starting news pipeline`, { url: newsUrl });
      updateProgress(poi.id, {
        phase: 'classifying_news',
        message: 'Analyzing news pages...',
        steps: ['Initialized', 'Classifying news pages']
      });
      const crawlResult = await crawlWithClassification(pool, newsUrl, 'news', poi, sheets, checkCancellation, { phase: 'Phase I', jobId, jobType });

      const pages = crawlResult.pages.slice(0, MAX_PHASE1_PAGES);

      if (pages.length > 0) usedDedicatedNewsUrl = true;

      reportProgress(`Phase I: [Classify] ${crawlResult.pages.length} news pages found (${crawlResult.totalPagesRendered} rendered)`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Classify] ${crawlResult.pages.length} news pages (${crawlResult.totalPagesRendered} rendered), processing ${pages.length} URLs`);

      for (const page of pages) {
        checkCancellation();
        const items = await processOneUrl(pool, page.url, poi, 'news', { phase: 'Phase I', jobId, jobType, timezone, confidence: '75%' });
        allNews.push(...(items.news || []));
      }
    } catch (err) {
      if (err.message === 'Collection cancelled by user') throw err;
      reportProgress(`Phase I: News crawl failed: ${err.message}`);
      logWarn(jobId, jobType, poi.id, poi.name, `Phase I: News classification failed: ${err.message}`);
    }
  }

  if (allEvents.length === 0 && allNews.length === 0 &&
      eventsUrl === 'No dedicated events page' && newsUrl === 'No dedicated news page') {
    logInfo(jobId, jobType, poi.id, poi.name, 'Phase I: Skipped (no dedicated URLs)');
  }

  checkCancellation(); // Check before Phase II

  try {
    // Update progress after Phase I
    updateProgress(poi.id, {
      phase: 'processing_results',
      message: `Phase I: ${allNews.length} news, ${allEvents.length} events`,
      newsFound: allNews.length,
      eventsFound: allEvents.length,
      steps: ['Initialized', 'Phase I complete']
    });

    if (allEvents.length > 0) {
      const eventsList = allEvents.map((event, idx) =>
        `${idx + 1}. ${event.title} (${event.start_date}) - ${event.source_url || 'N/A'}`
      ).join('\n  ');
      logInfo(jobId, jobType, poi.id, poi.name, `Events found:\n  ${eventsList}`);
    }

    if (allNews.length > 0) {
      const newsList = allNews.map((item, idx) =>
        `${idx + 1}. ${item.title} (${item.published_date})`
      ).join('\n  ');
      logInfo(jobId, jobType, poi.id, poi.name, `News found:\n  ${newsList}`);
    }

    // PHASE II: External news via Serper — per-URL pipeline
    if (collectionType !== 'events') {
      try {
        updateProgress(poi.id, {
          phase: 'serper_search',
          message: 'Searching for external news coverage...',
          steps: ['Initialized', 'Phase I complete', 'Searching external news']
        });

        reportProgress('Phase II: [Search] Querying Serper for external coverage');
        logInfo(jobId, jobType, poi.id, poi.name, 'Phase II: [Search] Querying Serper for external coverage');

        const serperResult = await searchNewsUrls(pool, poi);
        logInfo(jobId, jobType, poi.id, poi.name, `Phase II: [Search] ${serperResult.urls.length} URLs (grounded: ${serperResult.grounded})`, { query: serperResult.query, urls_found: serperResult.urls.length });
        reportProgress(`Phase II: [Search] ${serperResult.urls.length} URLs (query: "${serperResult.query}")`);

        if (serperResult.urls.length > 0) {
          // Skip Serper URLs from the POI's own domains — Phase I already covered them
          const poiOrigins = new Set();
          for (const u of [website, eventsUrl, newsUrl]) {
            try { poiOrigins.add(new URL(u).origin); } catch { /* skip invalid */ }
          }
          const externalUrls = serperResult.urls.filter(urlData => {
            try {
              const origin = new URL(urlData.url).origin;
              if (poiOrigins.has(origin)) {
                logInfo(jobId, jobType, poi.id, poi.name, `Phase II: Skip same-origin URL: ${urlData.url}`);
                return false;
              }
              return true;
            } catch { return false; }
          });

          // Cap Phase II URLs — each gets its own Gemini call, so 5 is plenty
          const MAX_PHASE2_URLS = 5;
          const urlsToProcess = externalUrls.slice(0, MAX_PHASE2_URLS);
          if (externalUrls.length > MAX_PHASE2_URLS) {
            logInfo(jobId, jobType, poi.id, poi.name, `Phase II: Capped at ${MAX_PHASE2_URLS} URLs (${externalUrls.length} external of ${serperResult.urls.length} total)`);
          }

          let renderedCount = 0;
          let phase2PagesCollected = 0;


          for (const urlData of urlsToProcess) {
            try {
              checkCancellation();
              if (phase2PagesCollected >= MAX_PHASE2_PAGES) break;

              // Classify each Serper URL — articles pass through as DETAIL (1 render),
              // listing pages get 1-level-deep link-following with tight caps
              reportProgress(`Phase II: [Classify] ${urlData.url}`);
              const crawlResult = await crawlWithClassification(pool, urlData.url, 'news', poi, sheets, checkCancellation, {
                maxDepth: 1,
                maxPages: 6,
                maxDetailPages: Math.min(5, MAX_PHASE2_PAGES - phase2PagesCollected),
                phase: 'Phase II',
                jobId,
                jobType
              });

              const pagesToProcess = crawlResult.pages;

              for (const page of pagesToProcess) {
                checkCancellation();
                if (phase2PagesCollected >= MAX_PHASE2_PAGES) break;

                const items = await processOneUrl(pool, page.url, poi, 'news', { phase: 'Phase II', jobId, jobType, timezone, confidence: '95%' });

                // Merge with existing news, avoiding duplicates by title
                const newNews = (items.news || []).filter(item => {
                  const titleLower = item.title.toLowerCase().trim();
                  return !allNews.some(n => n.title.toLowerCase().trim() === titleLower);
                });

                if (newNews.length > 0) {
                  logInfo(jobId, jobType, poi.id, poi.name, `Phase II: Adding ${newNews.length} unique items from ${page.url}`);
                  allNews.push(...newNews);
                }

                phase2PagesCollected++;
              }

              renderedCount++;
            } catch (renderError) {
              if (renderError.message === 'Collection cancelled by user') throw renderError;
              logError(jobId, jobType, poi.id, poi.name, `Phase II: Error: ${urlData.url} — ${renderError.message}`);
            }
          }

          reportProgress(`Phase II: Processed ${renderedCount} Serper URLs, ${phase2PagesCollected} pages collected`);
          logInfo(jobId, jobType, poi.id, poi.name, `Phase II: Processed ${renderedCount} of ${serperResult.urls.length} Serper URLs, ${phase2PagesCollected} pages collected`);
        } else {
          logInfo(jobId, jobType, poi.id, poi.name, 'Phase II: [Search] No external news URLs found');
        }
      } catch (serperError) {
        if (serperError.message === 'Collection cancelled by user') throw serperError;
        logWarn(jobId, jobType, poi.id, poi.name, `Phase II: Search failed: ${serperError.message}`);
      }
    }

    // Build completion message and stats based on collection type
    let completionMessage;
    let progressUpdate = {
      phase: 'complete',
      steps: ['Initialized', 'Phase I: Classify & Crawl', 'Phase I: per-URL Summarize', 'Phase II: per-URL Summarize', 'Complete'],
      completed: true
    };

    if (collectionType === 'news') {
      completionMessage = `Complete! Found ${allNews.length} news`;
      progressUpdate.newsFound = allNews.length;
      progressUpdate.eventsFound = 0;
    } else if (collectionType === 'events') {
      completionMessage = `Complete! Found ${allEvents.length} events`;
      progressUpdate.eventsFound = allEvents.length;
      progressUpdate.newsFound = 0;
    } else {
      completionMessage = `Complete! Found ${allNews.length} news, ${allEvents.length} events`;
      progressUpdate.newsFound = allNews.length;
      progressUpdate.eventsFound = allEvents.length;
    }

    progressUpdate.message = completionMessage;
    updateProgress(poi.id, progressUpdate);

    return {
      news: allNews,
      events: allEvents,
      metadata: {
        usedDedicatedNewsUrl,
        provider: 'gemini'
      }
    };
  } catch (error) {
    logError(jobId, jobType, poi.id, poi.name, `Error collecting news: ${error.message}`);

    updateProgress(poi.id, {
      phase: 'error',
      message: `Error: ${error.message}`,
      steps: ['Error occurred'],
      completed: true,
      error: error.message
    });

    return { news: [], events: [], metadata: { usedDedicatedNewsUrl: false, provider: 'gemini' } };
  }
}

/**
 * Resolve redirect URLs to their final destination
 * Handles Google/Vertex AI Search grounding redirect URLs
 * @param {string} url - URL that might be a redirect
 * @returns {Promise<string>} - Final destination URL or original if resolution fails
 */
async function resolveRedirectUrl(url) {
  if (!url || url === 'N/A') return null;

  // Check if this is a known redirect URL pattern
  const isRedirect = url.includes('grounding-api-redirect') ||
                     url.includes('redirect') ||
                     url.includes('vertexaisearch.cloud.google.com');

  if (!isRedirect) {
    return url; // Not a redirect, return direct URL as-is
  }

  try {
    // Follow redirects to get the final URL
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    const finalUrl = response.url;

    if (finalUrl && finalUrl !== url) {
      console.log(`[Search] ✓ Resolved: ${url.substring(0, 50)}... → ${finalUrl}`);
      return finalUrl;
    }

    // If we got back the same URL, it's not redirecting properly
    console.log(`[Search] ✗ No redirect found for: ${url.substring(0, 60)}...`);
    return null; // Don't save broken redirects
  } catch (error) {
    console.log(`[Search] ✗ Failed to resolve: ${url.substring(0, 50)}... (${error.message})`);
    return null; // Don't save broken redirects
  }
}

/**
 * Normalize a news title for duplicate detection
 * Strips date suffixes like "| January 30" or "| 2026-01-30"
 * @param {string} title - Original title
 * @returns {string} - Normalized title
 */
function normalizeNewsTitle(title) {
  if (!title) return '';

  // Remove date suffixes in format "| Month Day" or "| YYYY-MM-DD" or "| Month DD, YYYY"
  // Examples:
  // "Article Title | January 30" -> "Article Title"
  // "Article Title | 2026-01-30" -> "Article Title"
  // "Article Title | May 9" -> "Article Title"
  return title
    .replace(/\s*\|\s*\d{4}-\d{2}-\d{2}\s*$/i, '')  // Remove "| 2026-01-30"
    .replace(/\s*\|\s*[A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?\s*$/i, '')  // Remove "| January 30" or "| May 9, 2025"
    .trim();
}

/**
 * Normalize a URL for duplicate detection.
 * Strips trailing slashes, removes fragment, lowercases, and normalizes
 * common path variations (e.g., /plan-your-visit/alerts/ → /alerts).
 * @param {string} url - Original URL
 * @returns {string|null} - Normalized URL or null
 */
function normalizeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Lowercase host, strip trailing slash, remove fragment
    let normalized = parsed.origin + parsed.pathname.replace(/\/+$/, '') + parsed.search;
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Save news items to database
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @param {Array} newsItems - Array of news items from AI summarization
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipDateFilter - If true, allow news items older than 365 days
 */
export async function saveNewsItems(pool, poiId, newsItems, options = {}) {
  let savedCount = 0;
  let duplicateCount = 0;
  const { skipDateFilter = false, log = null } = options;

  // Calculate date strings (YYYY-MM-DD) to avoid timezone issues
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const oneYearAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 365);
  const oneYearAgoStr = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}-${String(oneYearAgo.getDate()).padStart(2, '0')}`;

  for (const item of newsItems) {
    try {
      // Normalize dates via chrono-node — handles natural language, European format, partial dates
      item.published_date = parseDate(item.published_date) || null;

      // Defense-in-depth: cap future news dates at today (primary cap is in processOneUrl,
      // but this catches any case where a future date slips through to saveNewsItems)
      if (item.published_date && item.published_date > todayStr) {
        if (log) log(`[Save] Capping future date ${item.published_date} → ${todayStr} for "${item.title}"`);
        item.published_date = todayStr;
      }

      // Skip news older than 365 days (unless skipDateFilter is true)
      if (!skipDateFilter && item.published_date && /^\d{4}-\d{2}-\d{2}$/.test(item.published_date)) {
        if (item.published_date < oneYearAgoStr) {
          if (log) log(`[Save] Skip old: "${item.title}" (${item.published_date} < ${oneYearAgoStr})`);
          continue;
        }
      }

      // Resolve redirect URLs to final destination URLs
      const resolvedUrl = item.source_url ? await resolveRedirectUrl(item.source_url) : null;

      // Skip items where redirect resolution failed
      const isRedirectUrl = item.source_url && (
        item.source_url.includes('grounding-api-redirect') ||
        item.source_url.includes('vertexaisearch.cloud.google.com')
      );

      if (isRedirectUrl && !resolvedUrl) {
        if (log) log(`[Save] Skip bad redirect: "${item.title}" (${item.source_url})`);
        continue;
      }

      // Normalize the title for duplicate checking
      const normalizedTitle = normalizeNewsTitle(item.title);

      const normalizedUrl = normalizeUrl(resolvedUrl);
      const existing = await pool.query(
        `SELECT id, title, source_url, poi_id FROM poi_news
         WHERE (
           ($1::text IS NOT NULL AND LOWER(REGEXP_REPLACE(source_url, '/+$', '')) = $1::text)
           OR (poi_id = $2 AND title = $3)
           OR (poi_id = $2 AND REGEXP_REPLACE(title, '\\s*\\|\\s*(\\d{4}-\\d{2}-\\d{2}|[A-Z][a-z]+\\s+\\d{1,2}(,\\s*\\d{4})?)\\s*$', '', 'i') = $4)
         )`,
        [normalizedUrl, poiId, item.title, normalizedTitle]
      );

      if (existing.rows.length > 0) {
        const match = existing.rows[0];
        const matchedUrl = normalizeUrl(match.source_url);
        if (matchedUrl === normalizedUrl) {
          duplicateCount++;
          if (log) log(`[Save] Skip duplicate (same URL): "${item.title}" — matches existing #${match.id}`);
          continue;
        }
        // Different URL, similar title — merge URL into existing item
        await pool.query(
          `INSERT INTO poi_news_urls (news_id, url, source_name)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM poi_news_urls WHERE news_id = $1 AND url = $2
           )`,
          [match.id, resolvedUrl, item.source_name || null]
        );
        duplicateCount++;
        if (log) log(`[Save] Merged URL into existing #${match.id}: "${item.title}" (title match, different URL: ${resolvedUrl})`);
        continue;
      }

      // New item — save as pending for moderation
      const dateConfidence = item.published_date ? 'exact' : 'unknown';
      await pool.query(`
        INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, publication_date, date_confidence, moderation_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      `, [
        poiId,
        item.title,
        item.summary,
        resolvedUrl,
        item.source_name,
        item.news_type || 'general',
        item.published_date || null,
        dateConfidence
      ]);
      savedCount++;
      if (log) log(`[Save] Saved (pending): "${item.title}" (${item.published_date || 'no date'}, ${dateConfidence}) → ${resolvedUrl}`);
    } catch (error) {
      if (log) log(`[Save] Error: "${item.title}" — ${error.message}`);
      console.error(`Error saving news item for POI ${poiId}:`, error.message);
    }
  }

  return savedCount;
}

/**
 * Save events to database
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @param {Array} eventItems - Array of events from AI summarization
 */
export async function saveEventItems(pool, poiId, eventItems, options = {}) {
  let savedCount = 0;
  let duplicateCount = 0;
  const { log = null } = options;

  // Get today's date as a string (YYYY-MM-DD) to avoid timezone issues
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (const item of eventItems) {
    try {
      // Normalize event dates via chrono-node
      item.start_date = parseDate(item.start_date) || item.start_date;
      item.end_date = parseDate(item.end_date) || null;

      // Skip past events
      if (item.start_date && /^\d{4}-\d{2}-\d{2}$/.test(item.start_date)) {
        const endDateStr = item.end_date || item.start_date;
        if (endDateStr < todayStr) {
          if (log) log(`[Save] Skip past event: "${item.title}" (${item.start_date})`);
          continue;
        }
      }

      // Resolve redirect URLs to final destination URLs
      const resolvedUrl = item.source_url ? await resolveRedirectUrl(item.source_url) : null;

      // Skip items where redirect resolution failed
      const isRedirectUrl = item.source_url && (
        item.source_url.includes('grounding-api-redirect') ||
        item.source_url.includes('vertexaisearch.cloud.google.com')
      );

      if (isRedirectUrl && !resolvedUrl) {
        if (log) log(`[Save] Skip bad redirect: "${item.title}" (${item.source_url})`);
        continue;
      }

      const normalizedEventUrl = normalizeUrl(resolvedUrl);
      const existing = await pool.query(
        `SELECT id, title, source_url, poi_id FROM poi_events
         WHERE (
           ($1::text IS NOT NULL AND LOWER(REGEXP_REPLACE(source_url, '/+$', '')) = $1::text)
           OR (poi_id = $2 AND title = $3 AND start_date = $4)
         )`,
        [normalizedEventUrl, poiId, item.title, item.start_date]
      );

      if (existing.rows.length > 0) {
        const match = existing.rows[0];
        const matchedEventUrl = normalizeUrl(match.source_url);
        if (matchedEventUrl === normalizedEventUrl) {
          duplicateCount++;
          if (log) log(`[Save] Skip duplicate event (same URL): "${item.title}" — matches existing #${match.id}`);
          continue;
        }
        await pool.query(
          `INSERT INTO poi_event_urls (event_id, url, source_name)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM poi_event_urls WHERE event_id = $1 AND url = $2
           )`,
          [match.id, resolvedUrl, item.source_name || null]
        );
        duplicateCount++;
        if (log) log(`[Save] Merged URL into existing event #${match.id}: "${item.title}" (different URL: ${resolvedUrl})`);
        continue;
      }

      // New event — save as pending for moderation
      const dateConfidence = item.start_date ? 'exact' : 'unknown';
      await pool.query(`
        INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url, publication_date, date_confidence, moderation_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      `, [
        poiId,
        item.title,
        item.description,
        item.start_date,
        item.end_date || null,
        item.event_type,
        item.location_details,
        resolvedUrl,
        item.start_date || null,
        dateConfidence
      ]);
      savedCount++;
      if (log) log(`[Save] Saved event (pending): "${item.title}" (${item.start_date}, ${dateConfidence}) → ${resolvedUrl}`);
    } catch (error) {
      if (log) log(`[Save] Error: "${item.title}" — ${error.message}`);
      console.error(`Error saving event for POI ${poiId}:`, error.message);
    }
  }

  return savedCount;
}

/**
 * Process a batch of POIs with staggered dispatch and limited concurrency
 * @param {Pool} pool - Database connection pool
 * @param {Array} pois - Array of POI objects
 * @param {Object} sheets - Optional sheets client
 * @param {number} dispatchInterval - Milliseconds between starting each POI
 * @param {string} timezone - IANA timezone string
 * @returns {Object} - { newsFound, eventsFound, processed }
 */
async function processPoiBatch(pool, pois, sheets, dispatchInterval = DISPATCH_INTERVAL_MS, timezone = 'America/New_York') {
  let newsFound = 0;
  let eventsFound = 0;
  let processed = 0;
  const results = [];

  // Semaphore for limiting concurrency
  let inFlight = 0;
  let nextIndex = 0;
  let resolveAll;
  const allDone = new Promise(resolve => { resolveAll = resolve; });

  const processNext = async () => {
    if (nextIndex >= pois.length) {
      if (inFlight === 0) resolveAll();
      return;
    }

    const index = nextIndex++;
    const poi = pois[index];
    inFlight++;

    try {
      console.log(`[${index + 1}/${pois.length}] Starting: ${poi.name} (${inFlight} in flight)`);
      const { news, events, metadata } = await collectNewsForPoi(pool, poi, sheets, timezone);
      const savedNews = await saveNewsItems(pool, poi.id, news, { skipDateFilter: metadata.usedDedicatedNewsUrl });
      const savedEvents = await saveEventItems(pool, poi.id, events);
      console.log(`[${index + 1}/${pois.length}] ✓ ${poi.name}: ${savedNews} news, ${savedEvents} events`);
      results.push({ newsFound: savedNews, eventsFound: savedEvents, success: true, poiName: poi.name });
    } catch (error) {
      console.error(`[${index + 1}/${pois.length}] ✗ ${poi.name}: ${error.message}`);
      results.push({ newsFound: 0, eventsFound: 0, success: false, poiName: poi.name });
    }

    inFlight--;
    // Start next job with delay when a slot opens (prevents API rate limiting)
    if (nextIndex < pois.length && inFlight < MAX_CONCURRENCY) {
      setTimeout(() => processNext(), dispatchInterval);
    } else if (nextIndex >= pois.length && inFlight === 0) {
      resolveAll();
    }
  };

  // Start initial batch with staggered dispatch
  const initialBatch = Math.min(MAX_CONCURRENCY, pois.length);
  for (let i = 0; i < initialBatch; i++) {
    setTimeout(() => processNext(), i * dispatchInterval);
  }

  // Wait for all to complete
  await allDone;

  // Aggregate results
  for (const result of results) {
    newsFound += result.newsFound;
    eventsFound += result.eventsFound;
    processed++;
  }

  return { newsFound, eventsFound, processed };
}

/**
 * Create a news collection job record (called before submitting to pg-boss)
 * @param {Pool} pool - Database connection pool
 * @param {Array} poiIds - Array of POI IDs to process
 * @param {string} source - Source of the job ('manual', 'batch', 'scheduled')
 * @returns {Object} - Job info with jobId and totalPois
 */
export async function createNewsCollectionJob(pool, poiIds, source = 'batch') {
  const startTime = new Date();

  // Get POI details to validate they exist
  const poisResult = await pool.query(
    'SELECT id FROM pois WHERE id = ANY($1) AND (deleted IS NULL OR deleted = FALSE)',
    [poiIds]
  );
  const validPoiIds = poisResult.rows.map(r => r.id);
  const totalPois = validPoiIds.length;

  if (totalPois === 0) {
    throw new Error('No valid POIs to process');
  }

  // Record job with status 'queued' and store POI IDs for resumability
  const jobResult = await pool.query(`
    INSERT INTO news_job_status (
      job_type, status, started_at, total_pois, pois_processed,
      news_found, events_found, poi_ids, processed_poi_ids
    )
    VALUES ($1, 'queued', $2, $3, 0, 0, 0, $4, $5)
    RETURNING id
  `, [
    source === 'scheduled' ? 'scheduled_collection' : 'batch_collection',
    startTime,
    totalPois,
    JSON.stringify(validPoiIds),
    JSON.stringify([])
  ]);
  const jobId = jobResult.rows[0].id;

  logInfo(jobId, 'news', null, null, `Created news collection job for ${totalPois} POIs`);

  return { jobId, totalPois, poiIds: validPoiIds };
}

/**
 * Process a news collection job (pg-boss handler)
 * This is the main work function called by pg-boss. It supports resumability
 * by checking which POIs have already been processed.
 *
 * @param {Pool} pool - Database connection pool
 * @param {Object} sheets - Optional sheets client for syncing
 * @param {string} pgBossJobId - The pg-boss job ID
 * @param {Object} jobData - Data passed from pg-boss { jobId, poiIds }
 */
export async function processNewsCollectionJob(pool, sheets, pgBossJobId, jobData) {
  const { jobId } = jobData;

  // Get the job record
  const jobResult = await pool.query('SELECT * FROM news_job_status WHERE id = $1', [jobId]);
  if (jobResult.rows.length === 0) {
    throw new Error(`Job ${jobId} not found`);
  }

  const job = jobResult.rows[0];

  // Parse POI IDs - handle both JSON strings and arrays
  let allPoiIds = job.poi_ids;
  let processedPoiIds = job.processed_poi_ids || [];

  if (typeof allPoiIds === 'string') {
    allPoiIds = JSON.parse(allPoiIds);
  }
  if (typeof processedPoiIds === 'string') {
    processedPoiIds = JSON.parse(processedPoiIds);
  }

  // Filter out already processed POIs (for resumability)
  const processedSet = new Set(processedPoiIds);
  const remainingPoiIds = allPoiIds.filter(id => !processedSet.has(id));

  if (remainingPoiIds.length === 0) {
    logInfo(jobId, 'news', null, null, 'All POIs already processed, marking complete');
    await pool.query(`
      UPDATE news_job_status
      SET status = 'completed', completed_at = $1, pg_boss_job_id = $2
      WHERE id = $3
    `, [new Date(), pgBossJobId, jobId]);
    return;
  }

  // Update job status to running
  await pool.query(`
    UPDATE news_job_status
    SET status = 'running', pg_boss_job_id = $1
    WHERE id = $2
  `, [pgBossJobId, jobId]);

  // Reset AI provider usage tracking for this job
  resetJobUsage();

  // Initialize display slots for this job
  initializeSlots(jobId);

  logInfo(jobId, 'news', null, null, `Job started: ${remainingPoiIds.length} POIs remaining`, { total: allPoiIds.length, already_done: processedPoiIds.length });

  // Get POI details for remaining POIs
  const poisResult = await pool.query(
    'SELECT id, name, poi_type, primary_activities, more_info_link, events_url, news_url FROM pois WHERE id = ANY($1)',
    [remainingPoiIds]
  );
  const pois = poisResult.rows;

  // Initialize counters from existing progress
  let newsFound = job.news_found || 0;
  let eventsFound = job.events_found || 0;
  let processed = processedPoiIds.length;
  const newlyProcessedIds = [...processedPoiIds];

  // Read max concurrency from admin_settings at job start (falls back to module constant)
  const concurrencyResult = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'news_max_concurrency'"
  );
  const maxConcurrency = concurrencyResult.rows.length > 0
    ? Math.max(1, parseInt(concurrencyResult.rows[0].value, 10) || MAX_CONCURRENCY)
    : MAX_CONCURRENCY;

  try {
    const { results: batchResults, cancelled: jobCancelled } = await runBatch({
      pool,
      jobId,
      items: pois,
      tracker,
      label: 'News',
      maxConcurrency,
      dispatchInterval: DISPATCH_INTERVAL_MS,

      checkCancelled: async () => {
        const result = await pool.query(
          'SELECT status FROM news_job_status WHERE id = $1',
          [jobId]
        );
        return result.rows[0]?.status === 'cancelled';
      },

      onItemStart: async (poi, { slotId, jobId: jid }) => {
        tracker.assignPoiToSlot(jid, slotId, poi.id, poi.name, 'gemini');
        tracker.updateProgress(poi.id, {
          phase: 'initializing',
          message: `Starting news & events search for ${poi.name}...`,
          poiName: poi.name,
          provider: 'gemini',
          slotId,
          jobId: jid,
          completed: false
        });
        logInfo(jobId, jobType, poi.id, poi.name, `Starting collection`, { slot: slotId });
      },

      collectFn: async (poi, { index, total }) => {
        const { news, events, metadata } = await collectNewsForPoi(pool, poi, sheets, 'America/New_York');
        const saveLog = (msg) => { logInfo(jobId, 'news', poi.id, poi.name, msg); };
        const savedNews = await saveNewsItems(pool, poi.id, news, { skipDateFilter: metadata.usedDedicatedNewsUrl, log: saveLog });
        const savedEvents = await saveEventItems(pool, poi.id, events, { log: saveLog });
        logInfo(jobId, 'news', poi.id, poi.name, `[${index + 1}/${total}] ${savedNews} news, ${savedEvents} events saved`, { news_found: news.length, events_found: events.length, news_saved: savedNews, events_saved: savedEvents });

        // Update last_news_collection timestamp
        await pool.query(`
          UPDATE pois SET last_news_collection = CURRENT_TIMESTAMP WHERE id = $1
        `, [poi.id]);

        return { savedNews, savedEvents, news, events };
      },

      checkpointFn: async (poi, result, error) => {
        processed++;
        newlyProcessedIds.push(poi.id);

        if (result) {
          newsFound += result.savedNews;
          eventsFound += result.savedEvents;
        }
        if (error) {
          logError(jobId, jobType, poi.id, poi.name, error.message, { error_stack: error.stack?.split('\n').slice(0, 3).join('\n') });
        }

        const currentAiUsage = getJobUsage();
        await pool.query(`
          UPDATE news_job_status
          SET pois_processed = $1, news_found = $2, events_found = $3, processed_poi_ids = $4, ai_usage = $6
          WHERE id = $5
        `, [processed, newsFound, eventsFound, JSON.stringify(newlyProcessedIds), jobId, JSON.stringify(currentAiUsage)]);
      }
    });

    // Log AI provider usage for this job
    const usage = getJobUsage();
    logInfo(jobId, 'news', null, null, `AI provider usage: Gemini=${usage.gemini}`, { gemini_calls: usage.gemini });

    // Only mark complete if not cancelled (cancel endpoint already set status)
    if (!jobCancelled) {
      await pool.query(`
        UPDATE news_job_status
        SET status = 'completed', completed_at = $1, ai_usage = $3
        WHERE id = $2
      `, [new Date(), jobId, JSON.stringify(usage)]);
    } else {
      logInfo(jobId, 'news', null, null, 'Job was cancelled, not marking as completed');
    }

    if (jobCancelled) {
      logInfo(jobId, 'news', null, null, `Job cancelled: ${processed} POIs, ${newsFound} news, ${eventsFound} events`, { pois_processed: processed, news_found: newsFound, events_found: eventsFound });
    } else {
      logInfo(jobId, 'news', null, null, `Job completed: ${processed} POIs, ${newsFound} news, ${eventsFound} events`, { pois_processed: processed, news_found: newsFound, events_found: eventsFound, ai_usage: usage });
    }
    await flushJobLogs();

    // Don't clear display slots — keep frozen for frontend

    // Log summary of results
    const poisWithResults = batchResults.filter(r => r.success && r.result && (r.result.savedNews > 0 || r.result.savedEvents > 0));
    const poisWithoutResults = batchResults.filter(r => !r.success || !r.result || (r.result.savedNews === 0 && r.result.savedEvents === 0));

    if (poisWithResults.length > 0) {
      const resultsList = poisWithResults.map(r =>
        `- ${r.item.name}: ${r.result.savedNews} news, ${r.result.savedEvents} events`
      ).join('\n');
      logInfo(jobId, 'news', null, null, `POIs with results (${poisWithResults.length}):\n${resultsList}`);
    }

    if (poisWithoutResults.length > 0) {
      const noResultsList = poisWithoutResults.map(r => `- ${r.item.name}`).join('\n');
      logInfo(jobId, 'news', null, null, `POIs with no results (${poisWithoutResults.length}):\n${noResultsList}`);
    }

  } catch (error) {
    logError(jobId, 'news', null, null, `Job failed: ${error.message}`, { error_stack: error.stack?.split('\n').slice(0, 5).join('\n') });
    await flushJobLogs();
    await pool.query(`
      UPDATE news_job_status
      SET status = 'failed', completed_at = $1, error_message = $2
      WHERE id = $3
    `, [new Date(), error.message, jobId]);
    throw error; // Re-throw so pg-boss knows the job failed
  }
}

/**
 * Legacy function for backward compatibility and scheduled jobs
 * Creates and immediately processes a news collection job (non-pg-boss path)
 * @deprecated Use createNewsCollectionJob + pg-boss for new code
 */
export async function runBatchNewsCollection(pool, poiIds, sheets = null, source = 'batch') {
  const { jobId, totalPois, poiIds: validPoiIds } = await createNewsCollectionJob(pool, poiIds, source);

  // Process in background using setImmediate for backward compatibility
  setImmediate(async () => {
    try {
      await processNewsCollectionJob(pool, sheets, `legacy-${jobId}`, { jobId });
    } catch (error) {
      logError(jobId, 'news', null, null, `Background processing failed: ${error.message}`);
    }
  });

  return { jobId, totalPois };
}

/**
 * Get all active POIs for collection
 * @param {Pool} pool - Database connection pool
 * @returns {Array<number>} - Array of POI IDs
 */
export async function getAllPoisForCollection(pool) {
  // Load excluded POI IDs from admin settings
  const settingResult = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'news_collection_excluded_pois'"
  );
  const excludedIds = settingResult.rows.length > 0
    ? JSON.parse(settingResult.rows[0].value || '[]')
    : [];

  const result = await pool.query(
    `SELECT id FROM pois
     WHERE (deleted IS NULL OR deleted = FALSE)
       ${excludedIds.length > 0 ? 'AND id != ALL($1)' : ''}
     ORDER BY
       CASE poi_type
         WHEN 'point' THEN 1
         WHEN 'boundary' THEN 2
         ELSE 3
       END,
       name`,
    excludedIds.length > 0 ? [excludedIds] : []
  );
  return result.rows.map(r => r.id);
}

/**
 * Run news collection for all POIs
 * @param {Pool} pool - Database connection pool
 * @param {Object} sheets - Optional sheets client
 * @returns {Object} - Job status summary
 */
export async function runNewsCollection(pool, sheets = null) {
  const poiIds = await getAllPoisForCollection(pool);

  if (poiIds.length === 0) {
    const runId = Math.floor(Date.now() / 1000);
    logInfo(runId, 'news', null, null, 'No POIs to collect');
    return {
      jobId: null,
      totalPois: 0,
      message: 'No POIs to collect'
    };
  }

  const runId = Math.floor(Date.now() / 1000);
  logInfo(runId, 'news', null, null, `Starting news collection for ${poiIds.length} POIs`);
  return runBatchNewsCollection(pool, poiIds, sheets, 'scheduled');
}

/**
 * Get job status by ID
 * @param {Pool} pool - Database connection pool
 * @param {number} jobId - Job ID
 */
export async function getJobStatus(pool, jobId) {
  const result = await pool.query(
    'SELECT * FROM news_job_status WHERE id = $1',
    [jobId]
  );
  return result.rows[0] || null;
}

/**
 * Get news for a specific POI
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @param {number} limit - Max items to return
 */
export async function getNewsForPoi(pool, poiId, limit = 10) {
  const result = await pool.query(`
    SELECT id, title, summary, source_url, source_name, news_type, publication_date, collection_date
    FROM poi_news
    WHERE poi_id = $1
      AND moderation_status IN ('published', 'auto_approved')
    ORDER BY COALESCE(publication_date, collection_date::date) DESC
    LIMIT $2
  `, [poiId, limit]);

  return result.rows;
}

/**
 * Get events for a specific POI
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @param {boolean} upcomingOnly - Only return future events
 */
export async function getEventsForPoi(pool, poiId, upcomingOnly = true) {
  let query = `
    SELECT id, title, description, start_date, end_date, event_type, location_details, source_url, collection_date
    FROM poi_events
    WHERE poi_id = $1
      AND moderation_status IN ('published', 'auto_approved')
  `;

  if (upcomingOnly) {
    query += ` AND start_date >= CURRENT_DATE`;
  }

  query += ` ORDER BY start_date ASC`;

  const result = await pool.query(query, [poiId]);
  return result.rows;
}

/**
 * Get all recent news across all POIs
 * @param {Pool} pool - Database connection pool
 * @param {number} limit - Max items to return
 */
export async function getRecentNews(pool, limit = 20) {
  const result = await pool.query(`
    SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
           n.publication_date, n.collection_date, p.id as poi_id, p.name as poi_name, p.poi_type
    FROM poi_news n
    JOIN pois p ON n.poi_id = p.id
    WHERE n.moderation_status IN ('published', 'auto_approved')
    ORDER BY COALESCE(n.publication_date, n.collection_date::date) DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Get all upcoming events across all POIs
 * @param {Pool} pool - Database connection pool
 * @param {number} daysAhead - How many days ahead to look
 */
export async function getUpcomingEvents(pool, daysAhead = 30) {
  const result = await pool.query(`
    SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
           e.location_details, e.source_url, p.id as poi_id, p.name as poi_name, p.poi_type
    FROM poi_events e
    JOIN pois p ON e.poi_id = p.id
    WHERE e.start_date >= CURRENT_DATE
      AND e.start_date <= CURRENT_DATE + INTERVAL '1 day' * $1
      AND e.moderation_status IN ('published', 'auto_approved')
    ORDER BY e.start_date ASC
  `, [daysAhead]);

  return result.rows;
}

/**
 * Get latest job status
 * @param {Pool} pool - Database connection pool
 */
export async function getLatestJobStatus(pool) {
  const result = await pool.query(`
    SELECT * FROM news_job_status
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return result.rows[0] || null;
}

/**
 * Clean up old news (older than specified days)
 * @param {Pool} pool - Database connection pool
 * @param {number} daysOld - Delete news older than this many days
 */
export async function cleanupOldNews(pool, daysOld = 90) {
  const runId = Math.floor(Date.now() / 1000);
  const result = await pool.query(`
    DELETE FROM poi_news
    WHERE collection_date < CURRENT_DATE - INTERVAL '1 day' * $1
  `, [daysOld]);

  logInfo(runId, 'cleanup', null, null, `Cleanup: deleted ${result.rowCount} news older than ${daysOld} days`, { completed: true, deleted: result.rowCount, type: 'news', days_old: daysOld });
  await flushJobLogs();
  return result.rowCount;
}

/**
 * Clean up past events
 * @param {Pool} pool - Database connection pool
 * @param {number} daysOld - Delete events older than this many days
 */
export async function cleanupPastEvents(pool, daysOld = 30) {
  const runId = Math.floor(Date.now() / 1000);
  const result = await pool.query(`
    DELETE FROM poi_events
    WHERE end_date < CURRENT_DATE - INTERVAL '1 day' * $1
       OR (end_date IS NULL AND start_date < CURRENT_DATE - INTERVAL '1 day' * $1)
  `, [daysOld]);

  logInfo(runId, 'cleanup', null, null, `Cleanup: deleted ${result.rowCount} events older than ${daysOld} days`, { completed: true, deleted: result.rowCount, type: 'events', days_old: daysOld });
  await flushJobLogs();
  return result.rowCount;
}
