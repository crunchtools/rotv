/**
 * News Collection Service
 * Two-phase pipeline: Phase I crawls POI's own pages, Phase II searches via Serper.
 * Both phases use Gemini for summarization, chrono-node for dates.
 *
 * Job execution is managed by pg-boss for crash recovery and resumability.
 * Progress is checkpointed after each batch so jobs can resume after container restarts.
 */

import { generateTextWithCustomPrompt as geminiGenerateText } from './geminiService.js';
import { parseDate, parseDateTime, extractDatesFromText } from './dateExtractor.js';

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

// Prompt template for news collection (exported for registry.js default prompt access)
export const NEWS_COLLECTION_PROMPT = `You are a precise news researcher for Cuyahoga Valley National Park and surrounding areas in Northeast Ohio.

Search for recent news and upcoming events SPECIFICALLY about: "{{name}}"
Location type: {{poi_type}}

MISSION SCOPE — Roots of The Valley:
This is a guide to Cuyahoga Valley National Park and surrounding communities. Content must connect
to the park's themes: nature, trails, outdoor recreation, conservation, local history, ecology,
wildlife, community stewardship, scenic railroads, canal towpath heritage, or the arts/culture
organizations that serve the valley.

For broad POIs like cities, townships, or metro park districts:
- ONLY collect events/news that relate to the mission above
- A generic concert at a Cleveland bar is NOT relevant
- A nature photography exhibit in Cleveland IS relevant
- A trail race through Akron IS relevant
- A random restaurant opening in Akron is NOT relevant
- Outdoor festivals celebrating nature, history, or community near the valley ARE relevant
- Generic urban nightlife, sports, dining, or entertainment are NOT relevant

Ask yourself: "Would a visitor to Cuyahoga Valley National Park care about this?" If not, skip it.

PRIORITY SOURCES TO SEARCH (check these first):
- National Park Service (NPS) - nps.gov/cuva
- Ohio Department of Transportation (ODOT) - transportation.ohio.gov
- Summit Metro Parks - summitmetroparks.org
- Cleveland Metroparks - clevelandmetroparks.com
- Cuyahoga Valley Scenic Railroad - cvsr.org
- Conservancy for Cuyahoga Valley National Park - conservancyforcvnp.org
- Local news: Cleveland.com, Akron Beacon Journal, WKYC, News 5 Cleveland

CRITICAL REQUIREMENTS - BE EXTREMELY STRICT:
- Only include items that EXPLICITLY mention "{{name}}" by name
- The news/event must be DIRECTLY about this specific location, not just the general park area
- You must be 95%+ confident the item is specifically about "{{name}}"
- Do NOT include general park news that doesn't specifically mention this location
- Do NOT include news about similarly-named places in other locations
- Do NOT include news about the general Cuyahoga Valley area unless it specifically names "{{name}}"

OFFICIAL WEBSITE:
{{website}}

DEDICATED EVENT PAGE:
{{eventsUrl}}

DEDICATED NEWS PAGE:
{{newsUrl}}

Search for:
1. Recent news articles (last 30 days) that specifically mention "{{name}}"
2. Upcoming events happening AT "{{name}}" specifically
3. Closures, road work, or maintenance specifically affecting "{{name}}"
4. Trail conditions, seasonal updates, or access changes for "{{name}}"

IMPORTANT - MULTI-STRATEGY EVENT & NEWS SEARCH:
HIGHEST PRIORITY - Use Dedicated URLs if provided:
- If a dedicated event page URL is provided above, START THERE FIRST
- If a dedicated news page URL is provided above, START THERE FIRST
- These are the most direct sources - prioritize them over general searches
- Look for event listings, dates, descriptions on these specific pages
- CRITICAL: Many sites use JavaScript frameworks (Wix, Squarespace, React) that don't show content in basic HTML
- For JavaScript-heavy pages, you MUST use alternative search strategies below

WARNING - JavaScript-Heavy Websites (Wix, Squarespace, React sites):
- If the dedicated URL or official website appears to be JavaScript-rendered (minimal HTML content, lots of <script> tags)
- DO NOT rely solely on that URL - it won't show events/news in search results
- IMMEDIATELY pivot to alternative sources listed below
- Signs of JavaScript-heavy sites: Wix.com, Squarespace, modern single-page apps
- These sites require EXTERNAL sources to find their content

MANDATORY ALTERNATIVE SEARCH STRATEGIES (use ALL of these, especially for JS-heavy sites):

PRIMARY ALTERNATIVE - Social Media & Event Platforms (MOST RELIABLE for JS sites):
- **Facebook Events** (BEST SOURCE): Search "{{name}} Facebook events" or "{{name}} Facebook page"
  - Most organizations post all events on Facebook even if their website fails
  - Search: "site:facebook.com {{name}} events 2026"
  - Look for their official page and Events tab
- **Eventbrite**: Search "{{name}} Eventbrite" or "site:eventbrite.com {{name}}"
- **Meetup**: Search "{{name}} Meetup" or "site:meetup.com {{name}}"
- **Instagram**: Many orgs announce events on Instagram - search "{{name}} Instagram"
- **Google Business Profile**: Events often listed on Google Maps/Business listings

SECONDARY ALTERNATIVE - Local Event Aggregators:
- Cuyahoga Valley National Park calendar (might list partner events)
- Regional tourism sites: visitakron.com, destinationcleveland.com
- Local news event calendars: Cleveland.com events, Akron Beacon Journal events
- Chamber of Commerce event listings
- Trail and outdoor recreation event calendars

TERTIARY ALTERNATIVE - Web Search Queries (cast a wide net):
- "{{name}} events 2026" (general web search)
- "{{name}} upcoming programs 2026"
- "{{name}} adventures 2026" OR "{{name}} activities 2026"
- "things to do at {{name}}" OR "visit {{name}}"
- "{{name}} calendar" OR "{{name}} schedule"
- Look for mentions in blog posts, news articles, press releases

SEARCH THOROUGHNESS - BE AGGRESSIVE:
- For JavaScript-heavy sites, assume the official website WON'T work
- You MUST try ALL alternative sources above, not just one or two
- Organizations often post events ONLY on Facebook/social media, not their website
- Cast a wide net - search multiple platforms and sources
- Cross-reference: if you find an event on Facebook, check if it's also on Eventbrite
- Be especially thorough for small organizations - they may have rich calendars on social platforms
- Don't give up if the official site fails - that's where alternative sources become critical

ACTIVITY-BASED EVENT TYPE GUIDANCE:
The primary activities at this location are: {{activities}}
Use these activities to prioritize event types:
- If activities include "Music" or "Concert": prioritize looking for concert events
- If activities include "Hiking" or "Walking": prioritize guided-tour and educational events
- If activities include "History" or "Historical": prioritize educational and program events
- If activities include "Volunteer": prioritize volunteer events
- If activities include "Festival" or "Events": prioritize festival events
When categorizing events, match the event type to the most relevant activity.

Return a JSON object with this exact structure:
{
  "news": [
    {
      "title": "News headline",
      "summary": "2-3 sentence summary - must explain how this relates to {{name}} specifically",
      "source_name": "Source name (e.g., NPS.gov, Cleveland.com)",
      "source_url": "URL if available, or null",
      "published_date": "date if visible on page, or null",
      "news_type": "general|alert|wildlife|infrastructure|community"
    }
  ],
  "events": [
    {
      "title": "Event name",
      "description": "Brief description - must specify this event is at {{name}}",
      "start_date": "event date if visible on page",
      "end_date": "end date or null if single day",
      "event_type": "hike|race|concert|festival|program|volunteer|arts|community|alert",
      "location_details": "Must be at or near {{name}} specifically",
      "source_url": "Registration or info URL if available"
    }
  ]
}

IMPORTANT:
- If you are not 95%+ certain an item is specifically about "{{name}}", DO NOT include it
- It is better to return empty arrays than to include false positives
- If no news or events found specifically for "{{name}}", return: {"news": [], "events": []}
- Include the exact JSON structure above, no additional text
- NEWS should be from the last 365 days only - do NOT include older news
- EVENTS must be upcoming (future dates) or currently happening - do NOT include past events`;

/**
 * Classify a web page as LISTING, DETAIL, or HYBRID using Gemini.
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
  const prompt = `Classify this web page. Based on the content, is it:
A) LISTING — lists multiple ${contentType}s with links to individual pages
B) DETAIL — describes a single ${contentType} with dates/descriptions/details
C) HYBRID — contains inline ${contentType} details AND links to more pages

PAGE URL: ${url}
CONTENT (first 3000 chars):
${markdown.substring(0, 3000)}

LINKS (first 20):
${links.slice(0, 20).map(l => `- "${(l.text || '').substring(0, 60)}" → ${l.url}`).join('\n')}

Return ONLY valid JSON:
{"page_type": "listing|detail|hybrid", "reasoning": "one sentence", "detail_links": ["url1", "url2"]}
For LISTING/HYBRID: populate detail_links with URLs to individual ${contentType} pages (max 15).
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
    return { pageType: parsed.page_type, detailLinks: parsed.detail_links || [], reasoning: parsed.reasoning };
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
  const { maxDepth = 2, maxPages = 50, maxDetailPages = 30, renderDelayMs = 1500, extractor = extractPageContent, phase = 'Phase I', jobId = 0 } = options;
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

      logInfo(jobId, 'news', poi.id, poi.name, `${phase}: [Render] ${url} (depth=${depth}, page=${totalPagesRendered})`);
      const extracted = await extractor(url, { timeout: 30000, hardTimeout: 60000, extractLinks: true });
      if (!extracted.reachable || !extracted.markdown) {
        logInfo(jobId, 'news', poi.id, poi.name, `${phase}: [Render] Skip — ${extracted.reason || 'no content'}`);
        continue;
      }

      const classification = await classifyPage(pool, extracted.markdown, extracted.links || [], url, contentType, sheets);
      logInfo(jobId, 'news', poi.id, poi.name, `${phase}: [Classify] ${url} → ${classification.pageType} (${classification.reasoning})`);

      if (classification.pageType === 'detail') {
        collectedPages.push({ url, markdown: extracted.markdown, title: extracted.title });
      } else if (classification.pageType === 'listing') {
        const validLinks = filterDetailLinks(classification.detailLinks, url);
        logInfo(jobId, 'news', poi.id, poi.name, `${phase}: [Crawl] Following ${validLinks.length} detail links from ${url}`);
        await processLevel(validLinks, depth + 1);
      } else if (classification.pageType === 'hybrid') {
        collectedPages.push({ url, markdown: extracted.markdown, title: extracted.title });
        const validLinks = filterDetailLinks(classification.detailLinks, url);
        if (validLinks.length > 0) {
          logInfo(jobId, 'news', poi.id, poi.name, `${phase}: [Crawl] Following ${validLinks.length} detail links from hybrid page ${url}`);
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

  // Preserve slotId and jobId if they exist (set by job processing loop)
  const existingProgress = tracker.getCollectionProgress(poi.id);
  const slotId = existingProgress?.slotId;
  const jobId = existingProgress?.jobId;

  logInfo(jobId, 'news', poi.id, poi.name, `Collection type: ${collectionType}`);

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

  logInfo(jobId, 'news', poi.id, poi.name, 'Starting search', { website, eventsUrl, newsUrl, activities });

  // Helper to check for cancellation and throw if requested
  const checkCancellation = () => {
    if (isCancellationRequested(poi.id)) {
      logInfo(jobId, 'news', poi.id, poi.name, 'Cancellation detected');
      updateProgress(poi.id, {
        phase: 'error',
        message: 'Collection cancelled by user',
        completed: true
      });
      throw new Error('Collection cancelled by user');
    }
  };

  // Classified content from Phase I (Render → Classify → Crawl pipeline)
  let classifiedEventsContent = null;
  let classifiedNewsContent = null;
  let usedClassifier = false;
  let usedNewsClassifier = false;

  // PHASE I EVENTS: Render → Classify → Crawl for dedicated events URL
  if (collectionType !== 'news' && eventsUrl !== 'No dedicated events page') {
    try {
      checkCancellation();
      reportProgress(`Phase I: [Render] Rendering events page: ${eventsUrl}`);
      logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Render] Starting events pipeline`, { url: eventsUrl });
      updateProgress(poi.id, {
        phase: 'classifying_events',
        message: 'Analyzing events pages...',
        steps: ['Initialized', 'Classifying events pages']
      });
      const crawlResult = await crawlWithClassification(pool, eventsUrl, 'event', poi, sheets, checkCancellation, { phase: 'Phase I', jobId });

      if (crawlResult.pages.length > 0) {
        classifiedEventsContent = crawlResult.pages.map(p => `### Event Page: ${p.url}\n\n${p.markdown}`).join('\n\n---\n\n');
        usedClassifier = true;
        reportProgress(`Phase I: [Classify] Found ${crawlResult.pages.length} event pages (crawled ${crawlResult.totalPagesRendered} pages)`);
        logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Classify] Found ${crawlResult.pages.length} event pages (${crawlResult.totalPagesRendered} rendered)`);
      } else {
        // Classifier found nothing — use the listing page itself as content
        logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Classify] No detail pages found, using listing page content`);
        const extracted = await extractPageContent(eventsUrl, { timeout: 30000, hardTimeout: 60000 });
        if (extracted.reachable && extracted.markdown?.length >= 200) {
          classifiedEventsContent = `### Event Page: ${eventsUrl}\n\n${extracted.markdown}`;
          usedClassifier = true;
          reportProgress('Phase I: [Classify] No detail pages, using listing page directly');
          logInfo(jobId, 'news', poi.id, poi.name, `Phase I: Using listing page content (${extracted.markdown.length} chars)`);
        } else {
          reportProgress('Phase I: [Render] Events page had insufficient content');
          logWarn(jobId, 'news', poi.id, poi.name, `Phase I: Events page insufficient content (${extracted.markdown?.length || 0} chars)`);
        }
      }
    } catch (err) {
      reportProgress(`Phase I: Events crawl failed: ${err.message}`);
      logWarn(jobId, 'news', poi.id, poi.name, `Phase I: Events classification failed: ${err.message}`);
    }
  }

  // PHASE I NEWS: Render → Classify → Crawl for dedicated news URL
  if (collectionType !== 'events' && newsUrl !== 'No dedicated news page') {
    try {
      checkCancellation();
      reportProgress(`Phase I: [Render] Rendering news page: ${newsUrl}`);
      logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Render] Starting news pipeline`, { url: newsUrl });
      updateProgress(poi.id, {
        phase: 'classifying_news',
        message: 'Analyzing news pages...',
        steps: ['Initialized', 'Classifying news pages']
      });
      const crawlResult = await crawlWithClassification(pool, newsUrl, 'news', poi, sheets, checkCancellation, { phase: 'Phase I', jobId });

      if (crawlResult.pages.length > 0) {
        classifiedNewsContent = crawlResult.pages.map(p => `### News Page: ${p.url}\n\n${p.markdown}`).join('\n\n---\n\n');
        usedNewsClassifier = true;
        reportProgress(`Phase I: [Classify] Found ${crawlResult.pages.length} news pages (crawled ${crawlResult.totalPagesRendered} pages)`);
        logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Classify] Found ${crawlResult.pages.length} news pages (${crawlResult.totalPagesRendered} rendered)`);
      } else {
        // Classifier found nothing — use the listing page itself as content
        logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Classify] No detail pages found, using listing page content`);
        const extracted = await extractPageContent(newsUrl, { timeout: 30000, hardTimeout: 60000 });
        if (extracted.reachable && extracted.markdown?.length >= 200) {
          classifiedNewsContent = `### News Page: ${newsUrl}\n\n${extracted.markdown}`;
          usedNewsClassifier = true;
          reportProgress('Phase I: [Classify] No detail pages, using listing page directly');
          logInfo(jobId, 'news', poi.id, poi.name, `Phase I: Using listing page content (${extracted.markdown.length} chars)`);
        } else {
          reportProgress('Phase I: [Render] News page had insufficient content');
          logWarn(jobId, 'news', poi.id, poi.name, `Phase I: News page insufficient content (${extracted.markdown?.length || 0} chars)`);
        }
      }
    } catch (err) {
      reportProgress(`Phase I: News crawl failed: ${err.message}`);
      logWarn(jobId, 'news', poi.id, poi.name, `Phase I: News classification failed: ${err.message}`);
    }
  }

  // Phase I: [Dates] Pre-extract dates from classified content using chrono-node
  const pageDateHints = [];
  if (classifiedEventsContent) {
    pageDateHints.push(...extractDatesFromText(classifiedEventsContent, timezone));
  }
  if (classifiedNewsContent) {
    pageDateHints.push(...extractDatesFromText(classifiedNewsContent, timezone));
  }
  if (pageDateHints.length > 0) {
    logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Dates] ${pageDateHints.length} dates extracted from classified content`);
  }

  // Build prompt with extracted content if available
  // Use custom prompt from admin_settings if configured, otherwise fall back to hardcoded default
  const { getPromptTemplate } = await import('./geminiService.js');
  const promptTemplate = await getPromptTemplate(pool, 'news_collection_prompt');
  const basePrompt = promptTemplate || NEWS_COLLECTION_PROMPT;
  let prompt = basePrompt
    .replace(/\{\{timezone\}\}/g, timezone)
    .replace('{{name}}', poi.name)
    .replace('{{poi_type}}', poi.poi_type)
    .replace('{{activities}}', activities)
    .replace('{{website}}', website)
    .replace('{{eventsUrl}}', eventsUrl)
    .replace('{{newsUrl}}', newsUrl);

  // Append pre-extracted date hints to prompt
  if (pageDateHints.length > 0) {
    const uniqueHints = [...new Map(pageDateHints.map(h => [h.text, h])).values()].slice(0, 30);
    const hintLines = uniqueHints.map(h =>
      `- "${h.text}" → ${h.start}${h.end ? ` to ${h.end}` : ''}`
    );
    prompt += `\n\nDATES FOUND IN PAGE TEXT (use these exact dates, do not re-interpret):\n${hintLines.join('\n')}`;
  }

  // Add classified content to prompt
  if (classifiedEventsContent) {
    prompt += `\n\nCLASSIFIED EVENT PAGES:
We visited the organization's events pages and identified individual event detail pages.
Each section below is from a REAL page we visited — the URL is verified.

${classifiedEventsContent}

**CRITICAL: URL INSTRUCTIONS**
- For each event, set source_url to the EXACT page URL shown in the "### Event Page:" header
- Do NOT invent, modify, or guess URLs — use ONLY the URLs provided above
- Use RELAXED filtering (75% confidence) since these are from the organization's own site
- Still exclude past events - only include upcoming/current events

**MULTIPLE DATES ON ONE PAGE**
- If a single page lists multiple dates for the same event (e.g., "March 21" and "May 31"), create a SEPARATE event entry for each date
- Each entry gets the same title, description, and source_url but a different start_date
- This is common for recurring excursions — treat each date as its own event

Extract ALL events from this content using these relaxed criteria.`;
  }

  if (classifiedNewsContent) {
    prompt += `\n\nCLASSIFIED NEWS PAGES:
We visited the organization's news pages and identified individual news detail pages.
Each section below is from a REAL page we visited — the URL is verified.

${classifiedNewsContent}

**CRITICAL: URL INSTRUCTIONS**
- For each news item, set source_url to the EXACT page URL shown in the "### News Page:" header
- Do NOT invent, modify, or guess URLs — use ONLY the URLs provided above
- Use RELAXED filtering (75% confidence) since these are from the organization's own site
- Include ALL news items regardless of age

Extract ALL news from this content using these relaxed criteria.`;
  }

  checkCancellation(); // Check before AI search

  try {
    const hasCrawledContent = usedClassifier || usedNewsClassifier;

    // Phase I: [Summarize] — only runs when we have classified content
    // URL-less POIs skip straight to Phase II (Serper)
    let result = { news: [], events: [] };
    let response = '';
    const usedProvider = 'gemini';

    if (hasCrawledContent) {
      reportProgress('Phase I: [Summarize] Sending classified content to Gemini');
      logInfo(jobId, 'news', poi.id, poi.name, 'Phase I: [Summarize] Sending classified content to Gemini', { has_events: !!usedClassifier, has_news: !!usedNewsClassifier });

      updateProgress(poi.id, {
        phase: 'ai_search',
        message: 'Summarizing rendered content via Gemini...',
        steps: ['Initialized', 'Rendered pages', 'AI summarization']
      });

      const aiResult = await generateTextWithCustomPrompt(pool, prompt);
      response = aiResult.response;
      reportProgress(`Phase I: [Summarize] Gemini responded (${response.length} chars)`);
      logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Summarize] Received response (${response.length} chars)`);

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logWarn(jobId, 'news', poi.id, poi.name, `No JSON found in response, preview: ${response.substring(0, 500)}...`);
      } else {
        result = JSON.parse(jsonMatch[0]);
        reportProgress(`Phase I: [Summarize] ${result.news?.length || 0} news, ${result.events?.length || 0} events`);
        logInfo(jobId, 'news', poi.id, poi.name, `Phase I: [Summarize] ${result.news?.length || 0} news, ${result.events?.length || 0} events`);
      }
    } else {
      // No classified content — skip Phase I, go straight to Phase II (Serper)
      logInfo(jobId, 'news', poi.id, poi.name, 'Phase I: Skipped (no dedicated URLs)');
    }

    // Update progress with counts based on collection type
    let processingMessage;
    let processingUpdate = {
      phase: 'processing_results',
      steps: ['Initialized', 'Rendered pages', 'AI search complete']
    };

    if (collectionType === 'news') {
      processingMessage = `Found ${result.news?.length || 0} news`;
      processingUpdate.newsFound = result.news?.length || 0;
      processingUpdate.eventsFound = 0;
    } else if (collectionType === 'events') {
      processingMessage = `Found ${result.events?.length || 0} events`;
      processingUpdate.eventsFound = result.events?.length || 0;
      processingUpdate.newsFound = 0;
    } else {
      processingMessage = `Found ${result.news?.length || 0} news, ${result.events?.length || 0} events`;
      processingUpdate.newsFound = result.news?.length || 0;
      processingUpdate.eventsFound = result.events?.length || 0;
    }

    processingUpdate.message = processingMessage;
    updateProgress(poi.id, processingUpdate);

    if (result.events && result.events.length > 0) {
      const eventsList = result.events.map((event, idx) =>
        `${idx + 1}. ${event.title} (${event.start_date}) - ${event.source_url || 'N/A'}`
      ).join('\n  ');
      logInfo(jobId, 'news', poi.id, poi.name, `Events found:\n  ${eventsList}`);
    }

    if (result.news && result.news.length > 0) {
      const newsList = result.news.map((item, idx) =>
        `${idx + 1}. ${item.title} (${item.published_date})`
      ).join('\n  ');
      logInfo(jobId, 'news', poi.id, poi.name, `News found:\n  ${newsList}`);
    }

    let allNews = result.news || [];

    checkCancellation(); // Check before Serper search

    // PHASE II: External news via Serper — Search → Render → Classify → Crawl → Dates → Summarize
    if (collectionType !== 'events') {
      try {
        updateProgress(poi.id, {
          phase: 'serper_search',
          message: 'Searching for external news coverage...',
          steps: ['Initialized', 'Phase I complete', 'Searching external news']
        });

        reportProgress('Phase II: [Search] Querying Serper for external coverage');
        logInfo(jobId, 'news', poi.id, poi.name, 'Phase II: [Search] Querying Serper for external coverage');

        // Phase II: [Search] — Serper API returns URLs
        const serperResult = await searchNewsUrls(pool, poi);
        logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Search] ${serperResult.urls.length} URLs (grounded: ${serperResult.grounded})`, { query: serperResult.query, urls_found: serperResult.urls.length });
        reportProgress(`Phase II: [Search] ${serperResult.urls.length} URLs (query: "${serperResult.query}")`);

        if (serperResult.urls.length > 0) {
          // Phase II: Render → Classify → Crawl each Serper URL
          // Fast path: Serper returns news articles which are nearly always detail pages.
          // Only classify pages that look like listings (high link density, low content).
          const renderedSerperContent = [];
          let renderedCount = 0;
          const LISTING_HEURISTIC_LINK_THRESHOLD = 15;
          const LISTING_HEURISTIC_RATIO = 100; // chars per link — low ratio = listing page

          for (const urlData of serperResult.urls) {
            try {
              checkCancellation();

              // 1.5 second delay between renders
              if (renderedCount > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
              }

              // Phase II: [Render]
              logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Render] ${urlData.url}`);
              reportProgress(`Phase II: [Render] ${urlData.url}`);

              const extracted = await extractPageContent(urlData.url, {
                timeout: 30000,
                hardTimeout: 60000,
                extractLinks: true
              });

              if (!extracted.reachable || !extracted.markdown || extracted.markdown.length < 200) {
                logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Render] Skip — ${extracted.reason || 'too short'} (${extracted.markdown?.length || 0} chars)`);
                continue;
              }

              // Fast-path: most Serper results are detail pages (news articles).
              // Only call Gemini Classify if the page looks like a listing:
              // high link count + low chars-per-link ratio.
              const linkCount = (extracted.links || []).length;
              const charsPerLink = linkCount > 0 ? extracted.markdown.length / linkCount : Infinity;
              const looksLikeListing = linkCount >= LISTING_HEURISTIC_LINK_THRESHOLD && charsPerLink < LISTING_HEURISTIC_RATIO;

              if (looksLikeListing) {
                // Phase II: [Classify] — only for suspected listing pages
                const classification = await classifyPage(pool, extracted.markdown, extracted.links || [], urlData.url, 'news', sheets);
                logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Classify] ${urlData.url} → ${classification.pageType}`);
                reportProgress(`Phase II: [Classify] ${urlData.url} → ${classification.pageType}`);

                if (classification.pageType === 'detail') {
                  renderedSerperContent.push({
                    url: urlData.url, title: urlData.title, snippet: urlData.snippet,
                    date: urlData.date, markdown: extracted.markdown
                  });
                  renderedCount++;
                } else {
                  // Listing or hybrid — crawl detail pages
                  logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Crawl] Following links from ${urlData.url}`);
                  const crawlResult = await crawlWithClassification(pool, urlData.url, 'news', poi, sheets, checkCancellation, {
                    maxPages: 5, maxDetailPages: 3, phase: 'Phase II', jobId
                  });
                  for (const page of crawlResult.pages) {
                    renderedSerperContent.push({
                      url: page.url, title: page.title || urlData.title, snippet: urlData.snippet,
                      date: urlData.date, markdown: page.markdown
                    });
                    renderedCount++;
                  }
                  // If crawl found nothing, use the page itself
                  if (crawlResult.pages.length === 0) {
                    renderedSerperContent.push({
                      url: urlData.url, title: urlData.title, snippet: urlData.snippet,
                      date: urlData.date, markdown: extracted.markdown
                    });
                    renderedCount++;
                  }
                }
              } else {
                // Fast path — treat as detail page, no Gemini classify call
                logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Classify] ${urlData.url} → detail (fast path: ${linkCount} links, ${Math.round(charsPerLink)} chars/link)`);
                renderedSerperContent.push({
                  url: urlData.url, title: urlData.title, snippet: urlData.snippet,
                  date: urlData.date, markdown: extracted.markdown
                });
                renderedCount++;
              }
            } catch (renderError) {
              logError(jobId, 'news', poi.id, poi.name, `Phase II: [Render] Error: ${urlData.url} — ${renderError.message}`);
            }
          }

          reportProgress(`Phase II: [Render] ${renderedCount} pages from ${serperResult.urls.length} URLs`);
          logInfo(jobId, 'news', poi.id, poi.name, `Phase II: Rendered ${renderedCount} pages from ${serperResult.urls.length} URLs`);

          // Phase II: [Summarize] — send all rendered content to Gemini
          if (renderedSerperContent.length > 0) {
            logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Summarize] Sending ${renderedSerperContent.length} pages to Gemini`);
            updateProgress(poi.id, {
              phase: 'summarizing_external_news',
              message: `Summarizing ${renderedSerperContent.length} external pages via Gemini...`,
              steps: ['Initialized', 'Phase I complete', 'Rendering external news', 'Summarizing']
            });

            // Build markdown content for Gemini — normalize Serper dates via chrono-node
            const serperMarkdown = renderedSerperContent.map(page => {
              const normalizedDate = parseDate(page.date) || page.date;
              return `### External News Page: ${page.url}
Title: ${page.title}
Snippet: ${page.snippet}
${normalizedDate ? `Date: ${normalizedDate}` : ''}

${page.markdown}`;
            }).join('\n\n---\n\n');

            let serperPrompt = `Summarize news items from these external news sources about "${poi.name}".

MISSION SCOPE — Roots of The Valley:
Only include news that connects to Cuyahoga Valley National Park themes: nature, trails,
outdoor recreation, conservation, local history, ecology, wildlife, community stewardship,
scenic railroads, canal towpath heritage, or arts/culture organizations that serve the valley.
Skip generic urban news, restaurant openings, nightlife, sports, or entertainment unrelated
to the park's mission. Ask: "Would a CVNP visitor care about this?"

EXTERNAL NEWS SOURCES:
We visited these external news pages and extracted their content.
Each section below is from a REAL page we visited — the URL is verified.

${serperMarkdown}

**CRITICAL: URL INSTRUCTIONS**
- For each news item, set source_url to the EXACT page URL shown in the "### External News Page:" header
- Do NOT invent, modify, or guess URLs — use ONLY the URLs provided above
- Use 95% confidence filtering since these are external sources
- Only include news from the last 365 days

Return your results in this exact JSON structure:
{
  "news": [
    {
      "title": "News headline",
      "summary": "2-3 sentence summary",
      "source_name": "Source name (extracted from URL or content)",
      "source_url": "EXACT URL from header above",
      "published_date": "date if visible on page, or null",
      "news_type": "general|alert|wildlife|infrastructure|community"
    }
  ]
}

Return {"news": []} if no relevant news found.`;

            // Phase II: [Dates] — chrono-node date hints for Serper content
            const serperDateHints = [];
            for (const page of renderedSerperContent) {
              serperDateHints.push(...extractDatesFromText(page.markdown, timezone));
            }
            if (serperDateHints.length > 0) {
              const hintBlock = serperDateHints.slice(0, 30).map(h =>
                `- "${h.text}" → ${h.start}${h.end ? ' to ' + h.end : ''}`
              ).join('\n');
              serperPrompt += `\n\nDATES FOUND IN PAGE TEXT (use these, do not re-interpret):\n${hintBlock}`;
            }
            logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Dates] ${serperDateHints.length} dates extracted from ${renderedSerperContent.length} pages`);

            reportProgress(`Phase II: [Summarize] Sending ${renderedSerperContent.length} pages to Gemini`);
            const serperAiResult = await generateTextWithCustomPrompt(pool, serperPrompt);

            const serperAiResponse = serperAiResult.response;
            logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Summarize] Received response (${serperAiResponse.length} chars)`);

            const serperJsonMatch = serperAiResponse.match(/\{[\s\S]*\}/);
            if (serperJsonMatch) {
              const serperExtracted = JSON.parse(serperJsonMatch[0]);
              const serperNews = serperExtracted.news || [];

              if (serperNews.length > 0) {
                const serperList = serperNews.map((item, idx) =>
                  `${idx + 1}. ${item.title} (${item.published_date || 'no date'}) - ${item.source_name || 'unknown source'}`
                ).join('\n  ');
                logInfo(jobId, 'news', poi.id, poi.name, `Phase II: [Summarize] ${serperNews.length} news items:\n  ${serperList}`);

                // Merge with existing news, avoiding duplicates by title
                const existingTitles = new Set(allNews.map(n => n.title.toLowerCase().trim()));
                const newItems = serperNews.filter(item => {
                  const titleLower = item.title.toLowerCase().trim();
                  return !existingTitles.has(titleLower);
                });

                if (newItems.length > 0) {
                  reportProgress(`Phase II: [Summarize] ${newItems.length} new articles from external sources`);
                  logInfo(jobId, 'news', poi.id, poi.name, `Phase II: Adding ${newItems.length} unique items`);
                  allNews = [...allNews, ...newItems];
                } else {
                  reportProgress('Phase II: [Summarize] All duplicates, skipped');
                  logInfo(jobId, 'news', poi.id, poi.name, 'Phase II: All external news items were duplicates, skipped');
                }
              } else {
                reportProgress('Phase II: [Summarize] No relevant news found');
                logInfo(jobId, 'news', poi.id, poi.name, 'Phase II: No relevant news extracted from external sources');
              }
            }
          }
        } else {
          logInfo(jobId, 'news', poi.id, poi.name, 'Phase II: [Search] No external news URLs found');
        }
      } catch (serperError) {
        logWarn(jobId, 'news', poi.id, poi.name, `Phase II: Search failed: ${serperError.message}`);
        // Continue with Phase I results even if Phase II fails
      }
    }

    // Build completion message and stats based on collection type
    let completionMessage;
    let progressUpdate = {
      phase: 'complete',
      steps: ['Initialized', 'Phase I: Classify & Crawl', 'Phase I: Summarize', 'Phase II: Search & Classify', 'Phase II: Summarize', 'Complete'],
      completed: true
    };

    if (collectionType === 'news') {
      completionMessage = `Complete! Found ${allNews.length} news`;
      progressUpdate.newsFound = allNews.length;
      progressUpdate.eventsFound = 0; // Don't show events when collecting news
    } else if (collectionType === 'events') {
      completionMessage = `Complete! Found ${result.events?.length || 0} events`;
      progressUpdate.eventsFound = result.events?.length || 0;
      progressUpdate.newsFound = 0; // Don't show news when collecting events
    } else {
      completionMessage = `Complete! Found ${allNews.length} news, ${result.events?.length || 0} events`;
      progressUpdate.newsFound = allNews.length;
      progressUpdate.eventsFound = result.events?.length || 0;
    }

    progressUpdate.message = completionMessage;
    updateProgress(poi.id, progressUpdate);

    // Keep progress available - frontend will clear it when appropriate
    // Don't auto-clear - let the UI control when it goes away

    return {
      news: allNews,
      events: result.events || [],
      metadata: {
        usedDedicatedNewsUrl: usedNewsClassifier,
        provider: 'gemini',
        ai_response: response
      }
    };
  } catch (error) {
    logError(jobId, 'news', poi.id, poi.name, `Error collecting news: ${error.message}`);

    updateProgress(poi.id, {
      phase: 'error',
      message: `Error: ${error.message}`,
      steps: ['Error occurred'],
      completed: true,
      error: error.message
    });

    // Keep error visible - frontend will clear it when appropriate

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
  const { skipDateFilter = false } = options;

  // Calculate 365 days ago as a date string (YYYY-MM-DD) to avoid timezone issues
  const today = new Date();
  const oneYearAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 365);
  const oneYearAgoStr = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}-${String(oneYearAgo.getDate()).padStart(2, '0')}`;

  for (const item of newsItems) {
    try {
      // Normalize dates via chrono-node — handles natural language, European format, partial dates
      item.published_date = parseDate(item.published_date) || null;

      // Skip news older than 365 days (unless skipDateFilter is true)
      // Use string comparison to avoid timezone conversion issues
      if (!skipDateFilter && item.published_date && /^\d{4}-\d{2}-\d{2}$/.test(item.published_date)) {
        if (item.published_date < oneYearAgoStr) {
          console.log(`[Save] Skipping old news: ${item.title} (${item.published_date})`);
          continue;
        }
      }

      // Resolve redirect URLs to final destination URLs
      const resolvedUrl = item.source_url ? await resolveRedirectUrl(item.source_url) : null;

      // Skip items where redirect resolution failed
      // We keep items with no URL (null), but skip items where we tried to resolve a redirect and failed
      const isRedirectUrl = item.source_url && (
        item.source_url.includes('grounding-api-redirect') ||
        item.source_url.includes('vertexaisearch.cloud.google.com')
      );

      if (isRedirectUrl && !resolvedUrl) {
        console.log(`[Save] Skipping news (failed URL resolution): "${item.title}"`);
        continue;
      }

      // Normalize the title for duplicate checking
      const normalizedTitle = normalizeNewsTitle(item.title);

      // Check if duplicate exists using URL (cross-POI) and title (same POI)
      // This catches:
      // 1. Same normalized URL across ANY POI (alerts pages, blog indexes)
      // 2. Same title within the same POI
      // 3. Title variants like "Article | January 30" vs "Article | 2026-01-30" (same POI)
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
        const matchedUrl = normalizeUrl(existing.rows[0].source_url);
        if (matchedUrl === normalizedUrl) {
          // Exact same URL — truly skip
          duplicateCount++;
          console.log(`[Save] Skipping duplicate (same URL): "${item.title}"`);
          continue;
        }
        // Different URL, similar title — merge URL into existing item
        const existingId = existing.rows[0].id;
        await pool.query(
          `INSERT INTO poi_news_urls (news_id, url, source_name)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM poi_news_urls WHERE news_id = $1 AND url = $2
           )`,
          [existingId, resolvedUrl, item.source_name || null]
        );
        duplicateCount++;
        console.log(`[Save] Merged URL into news #${existingId}: "${item.title}"`);
        continue;
      }

      // Save the news item with the RESOLVED URL (not the redirect)
      // New items enter as 'pending' for moderation review
      await pool.query(`
        INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, published_at, moderation_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      `, [
        poiId,
        item.title,
        item.summary,
        resolvedUrl, // Use resolved URL, not the original redirect
        item.source_name,
        item.news_type || 'general',
        item.published_date || null
      ]);
      savedCount++;
    } catch (error) {
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
export async function saveEventItems(pool, poiId, eventItems) {
  let savedCount = 0;
  let duplicateCount = 0;

  // Get today's date as a string (YYYY-MM-DD) to avoid timezone issues
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (const item of eventItems) {
    try {
      // Normalize event dates via chrono-node — handles natural language, European format, etc.
      item.start_date = parseDate(item.start_date) || item.start_date;
      item.end_date = parseDate(item.end_date) || null;

      // Skip past events using string comparison to avoid timezone issues
      if (item.start_date && /^\d{4}-\d{2}-\d{2}$/.test(item.start_date)) {
        const endDateStr = item.end_date || item.start_date;
        if (endDateStr < todayStr) {
          console.log(`[Save] Skipping past event: ${item.title} (${item.start_date})`);
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
        console.log(`[Save] Skipping event (failed URL resolution): "${item.title}"`);
        continue;
      }

      // Check if duplicate exists using URL (cross-POI) and title+date (same POI)
      // This catches:
      // 1. Same normalized URL across ANY POI
      // 2. Same title + start_date within same POI
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
        const matchedEventUrl = normalizeUrl(existing.rows[0].source_url);
        if (matchedEventUrl === normalizedEventUrl) {
          // Exact same URL — truly skip
          duplicateCount++;
          console.log(`[Save] Skipping duplicate event (same URL): "${item.title}"`);
          continue;
        }
        // Different URL, similar title+date — merge URL into existing item
        const existingId = existing.rows[0].id;
        await pool.query(
          `INSERT INTO poi_event_urls (event_id, url, source_name)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM poi_event_urls WHERE event_id = $1 AND url = $2
           )`,
          [existingId, resolvedUrl, item.source_name || null]
        );
        duplicateCount++;
        console.log(`[Save] Merged URL into event #${existingId}: "${item.title}"`);
        continue;
      }

      // Save the event with the RESOLVED URL (not the redirect)
      // New items enter as 'pending' for moderation review
      await pool.query(`
        INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url, moderation_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      `, [
        poiId,
        item.title,
        item.description,
        item.start_date,
        item.end_date || null,
        item.event_type,
        item.location_details,
        resolvedUrl // Use resolved URL, not the original redirect
      ]);
      savedCount++;
    } catch (error) {
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

  try {
    const { results: batchResults, cancelled: jobCancelled } = await runBatch({
      pool,
      jobId,
      items: pois,
      tracker,
      label: 'News',
      maxConcurrency: MAX_CONCURRENCY,
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
        logInfo(jobId, 'news', poi.id, poi.name, `Starting collection`, { slot: slotId });
      },

      collectFn: async (poi, { index, total }) => {
        const { news, events, metadata } = await collectNewsForPoi(pool, poi, sheets, 'America/New_York');
        const savedNews = await saveNewsItems(pool, poi.id, news, { skipDateFilter: metadata.usedDedicatedNewsUrl });
        const savedEvents = await saveEventItems(pool, poi.id, events);
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
          logError(jobId, 'news', poi.id, poi.name, error.message, { error_stack: error.stack?.split('\n').slice(0, 3).join('\n') });
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
  const result = await pool.query(`
    SELECT id FROM pois
    WHERE (deleted IS NULL OR deleted = FALSE)
    ORDER BY
      CASE poi_type
        WHEN 'point' THEN 1
        WHEN 'boundary' THEN 2
        ELSE 3
      END,
      name
  `);
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
    SELECT id, title, summary, source_url, source_name, news_type, published_at, created_at
    FROM poi_news
    WHERE poi_id = $1
      AND moderation_status IN ('published', 'auto_approved')
    ORDER BY COALESCE(published_at, created_at) DESC
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
    SELECT id, title, description, start_date, end_date, event_type, location_details, source_url, created_at
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
           n.published_at, n.created_at, p.id as poi_id, p.name as poi_name, p.poi_type
    FROM poi_news n
    JOIN pois p ON n.poi_id = p.id
    WHERE n.moderation_status IN ('published', 'auto_approved')
    ORDER BY COALESCE(n.published_at, n.created_at) DESC
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
    WHERE created_at < CURRENT_DATE - INTERVAL '1 day' * $1
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
