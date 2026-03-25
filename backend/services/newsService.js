/**
 * News Collection Service
 * Uses Perplexity with web search grounding to find and summarize news/events for POIs
 *
 * Job execution is managed by pg-boss for crash recovery and resumability.
 * Progress is checkpointed after each batch so jobs can resume after container restarts.
 */

import { generateTextWithCustomPrompt, resetJobUsage, getJobUsage, getJobStats } from './aiSearchFactory.js';
import { pushNewsToSheets, pushEventsToSheets } from './sheetsSync.js';
import { extractPageContent } from './contentExtractor.js';
import { calculateSimilarity } from './textUtils.js';
import { deepCrawlForArticle, isGenericUrl } from './deepCrawler.js';
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

// In-memory progress tracking for active collections
const collectionProgress = new Map();

// Job display slots: jobId → [10 slots]
// Each slot represents a display position for POI progress
const jobDisplaySlots = new Map();

/**
 * Update collection progress for a POI
 */
export function updateProgress(poiId, updates) {
  const current = collectionProgress.get(poiId) || {
    phase: 'starting',
    message: 'Initializing...',
    newsFound: 0,
    eventsFound: 0,
    startTime: Date.now(),
    steps: [],
    phaseHistory: [],
    slotId: null,
    jobId: null
  };

  // Track phase transitions - add previous phase to history when phase changes
  if (updates.phase && updates.phase !== current.phase && current.phase !== 'starting') {
    const phaseHistory = [...(current.phaseHistory || [])];
    if (!phaseHistory.includes(current.phase)) {
      phaseHistory.push(current.phase);
    }
    updates.phaseHistory = phaseHistory;
  }

  const updated = { ...current, ...updates, poiId, lastUpdate: Date.now() };
  collectionProgress.set(poiId, updated);

  // Update display slot if slotId and jobId are present
  if (updated.slotId !== null && updated.slotId !== undefined && updated.jobId) {
    updateSlotFromProgress(updated.jobId, updated.slotId, updated);
  }

  return updated;
}

/**
 * Get collection progress for a POI
 */
export function getCollectionProgress(poiId) {
  return collectionProgress.get(poiId) || null;
}

/**
 * Clear collection progress for a POI
 */
export function clearProgress(poiId) {
  collectionProgress.delete(poiId);
}

/**
 * Get all active progress entries (for job status display)
 * Returns the current phase(s) being processed
 */
export function getAllActiveProgress() {
  const active = [];
  for (const [poiId, progress] of collectionProgress.entries()) {
    if (!progress.completed) {
      const job = {
        poiId,
        phase: progress.phase,
        message: progress.message,
        poiName: progress.poiName,
        provider: progress.provider || null
      };
      console.log(`[getAllActiveProgress] POI ${poiId}: provider=${progress.provider}, phase=${progress.phase}`);
      active.push(job);
    }
  }
  return active;
}

/**
 * Initialize display slots for a job
 * Creates 10 empty slots that will be filled as POIs are dispatched
 * Exported for testing purposes
 */
export function initializeSlots(jobId) {
  const slots = Array(10).fill(null).map((_, i) => ({
    slotId: i,
    poiId: null,
    poiName: null,
    phase: null,
    provider: null,
    status: null
  }));
  jobDisplaySlots.set(jobId, slots);
  console.log(`[Job ${jobId}] Initialized 10 display slots`);
}

/**
 * Find the first available slot (null or completed)
 * Returns slot index 0-9
 */
function findFirstAvailableSlot(jobId) {
  const slots = jobDisplaySlots.get(jobId);
  if (!slots) return 0;

  const availableIndex = slots.findIndex(slot =>
    !slot.poiId || slot.status === 'completed'
  );

  return availableIndex >= 0 ? availableIndex : 0;
}

/**
 * Assign a POI to a display slot
 * IMPORTANT: This immediately replaces any old job data with new job data
 * to prevent the frontend from briefly displaying old "completed" status
 */
function assignPoiToSlot(jobId, slotId, poiId, poiName, provider) {
  const slots = jobDisplaySlots.get(jobId);
  if (!slots) return;

  // Immediately replace slot data (don't let old completed status linger)
  slots[slotId] = {
    slotId,
    poiId,
    poiName,
    phase: 'initializing',
    provider,
    status: 'active'  // Force active status immediately
  };

  console.log(`[Job ${jobId}] Assigned POI ${poiId} (${poiName}) to Slot ${slotId}`);
}

/**
 * Update slot with current progress data
 */
function updateSlotFromProgress(jobId, slotId, progress) {
  const slots = jobDisplaySlots.get(jobId);
  if (!slots || slotId === undefined || slotId === null) return;

  slots[slotId] = {
    slotId,
    poiId: progress.poiId || slots[slotId].poiId,
    poiName: progress.poiName || slots[slotId].poiName,
    phase: progress.phase,
    provider: progress.provider,
    status: progress.completed ? 'completed' : 'active'
  };
}

/**
 * Get current display slots for a job
 * Returns exactly 10 slots with latest progress data
 */
export function getDisplaySlots(jobId) {
  const slots = jobDisplaySlots.get(jobId);
  if (!slots) {
    // Return 10 empty slots if job not found
    return Array(10).fill(null).map((_, i) => ({
      slotId: i,
      poiId: null,
      poiName: null,
      phase: null,
      provider: null,
      status: null
    }));
  }

  // Enrich each slot with latest progress data
  return slots.map(slot => {
    if (!slot.poiId) return slot;

    const progress = collectionProgress.get(slot.poiId);
    if (!progress) {
      // Progress not found - use slot data as-is
      // This can happen briefly when a new POI is assigned but progress hasn't been created yet
      return slot;
    }

    return {
      slotId: slot.slotId,
      poiId: slot.poiId,
      poiName: progress.poiName || slot.poiName,
      phase: progress.phase,
      provider: progress.provider,
      status: progress.completed ? 'completed' : 'active'
    };
  });
}

/**
 * Clear display slots when job completes
 */
function clearDisplaySlots(jobId) {
  jobDisplaySlots.delete(jobId);
  console.log(`[Job ${jobId}] Cleared display slots`);
}

/**
 * Request cancellation of an ongoing collection job
 * @param {number} poiId - The POI ID to cancel
 * @returns {boolean} - true if cancellation was requested, false if no job found
 */
export function requestCancellation(poiId) {
  const progress = collectionProgress.get(poiId);
  if (progress && !progress.completed) {
    updateProgress(poiId, {
      cancellationRequested: true,
      message: 'Cancellation requested...'
    });
    console.log(`[News Collection] Cancellation requested for POI ${poiId}`);
    return true;
  }
  return false;
}

/**
 * Check if cancellation has been requested for a POI
 * @param {number} poiId - The POI ID to check
 * @returns {boolean} - true if cancellation was requested
 */
export function isCancellationRequested(poiId) {
  const progress = collectionProgress.get(poiId);
  return progress?.cancellationRequested === true;
}

/**
 * Match an event or news item to extracted links from the page
 * @param {Object} item - Event or news item with title, description, start_date/published_date
 * @param {Array} links - Array of link objects from contentExtractor
 * @param {string} type - 'event' or 'news'
 * @returns {string|null} - Matched URL or null
 */
function matchItemToLink(item, links, type = 'event') {
  if (!links || links.length === 0) return null;
  if (!item.title) return null;

  let bestMatch = null;
  let bestScore = 0;
  const THRESHOLD = 2.0; // Minimum similarity to consider a match (increased to filter poor matches)

  // Debug: log first attempt for this item
  let isFirstLog = true;

  for (const link of links) {
    let score = 0;

    // 1. Check title similarity to link text
    const titleToLinkText = calculateSimilarity(item.title, link.text);
    score += titleToLinkText * 3; // Title match is most important

    // 2. Check if title appears in link context
    const titleInContext = calculateSimilarity(item.title, link.context);
    score += titleInContext * 2;

    // 3. Check description similarity to context (if available)
    if (item.description) {
      const descInContext = calculateSimilarity(item.description, link.context);
      score += descInContext;
    }

    if (item.summary) {
      const summaryInContext = calculateSimilarity(item.summary, link.context);
      score += summaryInContext;
    }

    // 4. Check for date in link text/context (for events)
    if (type === 'event' && item.start_date) {
      const dateStr = item.start_date;
      const dateFormats = [
        dateStr, // YYYY-MM-DD
        new Date(dateStr).toLocaleDateString('en-US'), // M/D/YYYY
        new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) // Month Day
      ];

      if (dateFormats.some(df => link.text.includes(df) || link.context.includes(df))) {
        score += 1;
      }
    }

    // 5. Bonus for event/news keywords in className
    if (type === 'event' && (link.className.includes('event') || link.parentClassName.includes('event'))) {
      score += 0.5;
    }
    if (type === 'news' && (link.className.includes('news') || link.className.includes('article') ||
                             link.parentClassName.includes('news') || link.parentClassName.includes('article'))) {
      score += 0.5;
    }

    // Debug: log the best scoring link for first item
    if (isFirstLog && score > 0.5) {
      console.log(`[Link Matcher DEBUG] Item: "${item.title.substring(0, 50)}..."`);
      console.log(`[Link Matcher DEBUG] Link text: "${link.text.substring(0, 50)}..." | Score: ${score.toFixed(2)} (threshold: ${THRESHOLD})`);
      isFirstLog = false;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = link.url;
    }
  }

  if (bestMatch && bestScore >= THRESHOLD) {
    console.log(`[Link Matcher] ✓ Matched "${item.title}" to ${bestMatch} (score: ${bestScore.toFixed(2)})`);
    return bestMatch;
  } else {
    console.log(`[Link Matcher] ✗ No match for "${item.title}" (best score: ${bestScore.toFixed(2)}, threshold: ${THRESHOLD})`);
    return null;
  }
}

/**
 * Ensure the news_job_status table has checkpoint columns for resumability
 * Call this during server startup
 */
export async function ensureNewsJobCheckpointColumns(pool) {
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

    console.log('News job checkpoint columns verified');
  } catch (error) {
    console.error('Error ensuring checkpoint columns:', error.message);
  }
}

/**
 * Find incomplete jobs that need to be resumed after a restart
 * @param {Pool} pool - Database connection pool
 * @returns {Array} - Array of job records that need resuming
 */
export async function findIncompleteJobs(pool) {
  const result = await pool.query(`
    SELECT * FROM news_job_status
    WHERE status IN ('queued', 'running')
    ORDER BY created_at ASC
  `);
  return result.rows;
}

// Prompt template for news collection
const NEWS_COLLECTION_PROMPT = `You are a precise news researcher for Cuyahoga Valley National Park and surrounding areas in Northeast Ohio.

TIMEZONE CONTEXT:
- The current timezone is: {{timezone}}
- When you see dates in articles, news, or events, interpret them as being in {{timezone}}
- Return ALL dates in ISO 8601 format: YYYY-MM-DD
- CRITICAL: Copy dates EXACTLY as they appear on the source. Do NOT add or subtract days.
- Example: If you see "October 9, 2024" in an article, return "2024-10-09" (not 2024-10-08 or 2024-10-10)
- Example: If you see "January 30" in 2026, return "2026-01-30" (not 2026-01-29 or 2026-01-31)

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
      "published_date": "YYYY-MM-DD in ISO 8601 format, or null if unknown",
      "news_type": "general|alert|wildlife|infrastructure|community"
    }
  ],
  "events": [
    {
      "title": "Event name",
      "description": "Brief description - must specify this event is at {{name}}",
      "start_date": "YYYY-MM-DD in ISO 8601 format",
      "end_date": "YYYY-MM-DD in ISO 8601 format, or null if single day",
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
- All dates must be in ISO 8601 format (YYYY-MM-DD), interpreted in {{timezone}}
- NEWS should be from the last 365 days only - do NOT include older news
- EVENTS must be upcoming (future dates) or currently happening - do NOT include past events`;

/**
 * Collect news and events for a specific POI
 * @param {Pool} pool - Database connection pool
 * @param {Object} poi - POI object with id, name, poi_type, primary_activities, more_info_link, events_url, news_url
 * @param {Object} sheets - Optional sheets client for API key restore
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @param {string} collectionType - 'news', 'events', or 'both' to indicate what's being collected
 * @returns {Object} - { news: [], events: [] }
 */
export async function collectNewsForPoi(pool, poi, sheets = null, timezone = 'America/New_York', collectionType = 'both') {
  console.log(`[AI Research] Collection type: ${collectionType}`);
  const activities = poi.primary_activities || 'None specified';
  const website = poi.more_info_link || 'No website available';
  const eventsUrl = poi.events_url || 'No dedicated events page';
  const newsUrl = poi.news_url || 'No dedicated news page';

  // Determine which AI provider will be used (at the start, so it's available in all phases)
  const configResult = await pool.query(`
    SELECT key, value FROM admin_settings
    WHERE key IN ('ai_search_primary', 'ai_search_fallback', 'ai_search_primary_limit')
  `);
  const aiConfig = {
    primary: 'perplexity',
    fallback: 'none',
    primaryLimit: 0
  };
  for (const row of configResult.rows) {
    if (row.key === 'ai_search_primary') aiConfig.primary = row.value;
    if (row.key === 'ai_search_fallback') aiConfig.fallback = row.value;
    if (row.key === 'ai_search_primary_limit') aiConfig.primaryLimit = parseInt(row.value) || 0;
  }

  // Check current usage and determine which provider will be used
  const currentUsage = getJobUsage();
  let providerToUse = aiConfig.primary;
  const primaryUsage = currentUsage[aiConfig.primary] || 0;

  // Check if we've exceeded the primary limit
  if (aiConfig.primaryLimit > 0 && primaryUsage >= aiConfig.primaryLimit) {
    if (aiConfig.fallback && aiConfig.fallback !== 'none') {
      console.log(`[News Service] Primary limit reached (${primaryUsage}/${aiConfig.primaryLimit}), will use fallback: ${aiConfig.fallback}`);
      providerToUse = aiConfig.fallback;
    }
  }

  // Preserve slotId and jobId if they exist (set by job processing loop)
  const existingProgress = collectionProgress.get(poi.id);
  const slotId = existingProgress?.slotId;
  const jobId = existingProgress?.jobId;

  // Clear any old progress data for this POI before starting
  collectionProgress.delete(poi.id);

  // Initialize progress tracking with fresh data (preserving slotId/jobId)
  const typeLabel = collectionType === 'news' ? 'news' : collectionType === 'events' ? 'events' : 'news & events';
  updateProgress(poi.id, {
    phase: 'initializing',
    message: `Starting ${typeLabel} search for ${poi.name}...`,
    poiName: poi.name,
    provider: providerToUse,  // Set provider from the start
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

  console.log(`[AI Research] Starting search for: ${poi.name}`);
  console.log(`[AI Research]   - Website: ${website}`);
  console.log(`[AI Research]   - Events URL: ${eventsUrl}`);
  console.log(`[AI Research]   - News URL: ${newsUrl}`);
  console.log(`[AI Research]   - Activities: ${activities}`);

  // Helper to check for cancellation and throw if requested
  const checkCancellation = () => {
    if (isCancellationRequested(poi.id)) {
      console.log(`[AI Research] Cancellation detected for ${poi.name}`);
      updateProgress(poi.id, {
        phase: 'error',
        message: 'Collection cancelled by user',
        completed: true
      });
      throw new Error('Collection cancelled by user');
    }
  };

  // Extract content from dedicated pages using Playwright + Readability + Turndown
  // This renders ALL pages (not just JS-heavy ones) for clean markdown extraction
  let renderedEventsContent = '';
  let renderedNewsContent = '';
  let usedDedicatedNewsUrl = false;
  let eventsLinks = [];
  let newsLinks = [];

  // Only extract events page if we're collecting events
  const eventsPageToRender = eventsUrl !== 'No dedicated events page' ? eventsUrl : website;
  checkCancellation(); // Check before rendering events
  if (collectionType !== 'news' && eventsPageToRender !== 'No website available') {
    console.log(`[AI Research] Extracting events page content (collectionType: ${collectionType})`);
    updateProgress(poi.id, {
      phase: 'rendering_events',
      message: 'Extracting events page content...',
      steps: ['Initialized', 'Extracting events page']
    });

    console.log(`[AI Research] Rendering events page with Readability pipeline: ${eventsPageToRender}`);
    const extracted = await extractPageContent(eventsPageToRender, {
      timeout: 20000,
      hardTimeout: 45000,
      extractLinks: true
    });

    if (extracted.reachable && extracted.markdown) {
      const MIN_CONTENT_LENGTH = 200;
      if (extracted.markdown.length >= MIN_CONTENT_LENGTH) {
        renderedEventsContent = extracted.markdown;
        eventsLinks = extracted.links || [];
        console.log(`[AI Research] ✓ Extracted events page: ${renderedEventsContent.length} chars markdown, ${eventsLinks.length} links`);

        updateProgress(poi.id, {
          message: `Extracted events page (${eventsLinks.length} links found)`,
          steps: ['Initialized', 'Extracted events page']
        });
      } else {
        console.log(`[AI Research] ⚠️ Events page has insufficient content (${extracted.markdown.length} chars, need ${MIN_CONTENT_LENGTH}+)`);
      }
    } else {
      console.log(`[AI Research] ❌ Failed to extract events page: ${extracted.reason || 'no content'}`);
    }
  }

  // Only extract news page if we're collecting news
  const newsPageToRender = newsUrl !== 'No dedicated news page' ? newsUrl : website;
  checkCancellation(); // Check before rendering news
  if (collectionType !== 'events' && newsPageToRender !== 'No website available') {
    console.log(`[AI Research] Extracting news page content (collectionType: ${collectionType})`);
    updateProgress(poi.id, {
      phase: 'rendering_news',
      message: 'Extracting news page content...',
      steps: ['Initialized', 'Extracting news page']
    });

    console.log(`[AI Research] Rendering news page with Readability pipeline: ${newsPageToRender}`);
    const extracted = await extractPageContent(newsPageToRender, {
      timeout: 20000,
      hardTimeout: 45000,
      extractLinks: true
    });

    if (extracted.reachable && extracted.markdown) {
      const MIN_CONTENT_LENGTH = 200;
      if (extracted.markdown.length >= MIN_CONTENT_LENGTH) {
        renderedNewsContent = extracted.markdown;
        newsLinks = extracted.links || [];
        usedDedicatedNewsUrl = true;
        console.log(`[AI Research] ✓ Extracted news page: ${renderedNewsContent.length} chars markdown, ${newsLinks.length} links`);

        updateProgress(poi.id, {
          message: `Extracted news page (${newsLinks.length} links found)`,
          steps: ['Initialized', 'Extracted news page']
        });
      } else {
        console.log(`[AI Research] ⚠️ News page has insufficient content (${extracted.markdown.length} chars, need ${MIN_CONTENT_LENGTH}+)`);
      }
    } else {
      console.log(`[AI Research] ❌ Failed to extract news page: ${extracted.reason || 'no content'}`);
    }
  }

  // Build prompt with extracted content if available
  let prompt = NEWS_COLLECTION_PROMPT
    .replace(/\{\{timezone\}\}/g, timezone)
    .replace('{{name}}', poi.name)
    .replace('{{poi_type}}', poi.poi_type)
    .replace('{{activities}}', activities)
    .replace('{{website}}', website)
    .replace('{{eventsUrl}}', eventsUrl)
    .replace('{{newsUrl}}', newsUrl);

  // Add extracted markdown content to prompt if we have it
  if (renderedEventsContent) {
    prompt += `\n\nEXTRACTED EVENTS PAGE CONTENT (markdown):\nWe rendered the events page and extracted this content:\n\n${renderedEventsContent}\n\n**SPECIAL INSTRUCTIONS FOR EXTRACTED EVENTS PAGE:**
Since this content comes directly from the organization's dedicated events page, use RELAXED requirements:
- You only need 75% confidence (not 95%) that an event is relevant
- Events listed on this official page can be assumed to be associated with "${poi.name}" even if the name isn't explicitly mentioned in every listing
- Include ALL events that appear to be listed on this page, as long as they're reasonably related to the organization
- Still exclude past events - only include upcoming/current events
- Still require proper date formatting (YYYY-MM-DD) - interpret all dates in ${timezone} timezone

Extract ALL events from this content using these relaxed criteria.`;
  }

  if (renderedNewsContent) {
    prompt += `\n\nEXTRACTED NEWS PAGE CONTENT (markdown):\nWe rendered the news page and extracted this content:\n\n${renderedNewsContent}\n\n**SPECIAL INSTRUCTIONS FOR EXTRACTED NEWS PAGE:**
Since this content comes directly from the organization's dedicated news page, use RELAXED requirements:
- You only need 75% confidence (not 95%) that a news item is relevant
- News items on this official page can be assumed to be associated with "${poi.name}" even if not explicitly mentioned
- Include ALL news items from this page, regardless of age (don't apply the 365-day filter)
- **IMPORTANT FOR DATES**: Try hard to extract dates from news titles and content:
  - Look for month names, dates, or year references in the title (e.g., "April 2025 Newsletter", "July Newsletter", "May 9", "October 9")
  - If the title has a month name, try to infer the year (use current year 2026 if recent, or 2025 if it seems past)
  - If you find a partial date like "May 9" or "October Newsletter", estimate the full date in ISO 8601 format (YYYY-MM-DD)
  - Remember: interpret all dates in ${timezone} timezone
  - Only use "published_date": null if absolutely no date information can be extracted
- Prefer to include items even if dates are uncertain

Extract ALL news from this content using these relaxed criteria.`;
  }

  checkCancellation(); // Check before AI search

  try {
    // Get the current provider (already determined at start of function)
    const currentProgress = getCollectionProgress(poi.id);
    const initialProvider = currentProgress?.provider || 'perplexity';

    updateProgress(poi.id, {
      phase: 'ai_search',
      message: 'Searching with AI (Perplexity web search)...',
      steps: ['Initialized', 'Rendered pages', 'Searching with AI']
    });

    debugLog(`[AI Research POI ${poi.id}] ====== BEFORE AI CALL (provider=${initialProvider}) ======`);
    const aiResult = await generateTextWithCustomPrompt(pool, prompt, sheets);
    debugLog(`[AI Research POI ${poi.id}] ====== AFTER AI CALL ======`);
    debugLog(`[AI Research POI ${poi.id}] aiResult: ${JSON.stringify({
      type: typeof aiResult,
      keys: Object.keys(aiResult || {}),
      provider: aiResult?.provider,
      responseLength: aiResult?.response?.length
    })}`);
    const response = aiResult.response;
    const usedProvider = aiResult.provider;
    debugLog(`[AI Research POI ${poi.id}] usedProvider = '${usedProvider}'`);
    // Update provider if it changed (e.g., fallback was used during the AI call)
    if (usedProvider !== initialProvider) {
      updateProgress(poi.id, { provider: usedProvider });
      debugLog(`[AI Research POI ${poi.id}] Provider changed to: '${usedProvider}'`);
    }
    console.log(`[AI Research] Received response (${response.length} chars) from ${usedProvider}`);

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(`[AI Research] ❌ No JSON found in response for ${poi.name}`);
      console.log(`[AI Research] Raw response preview: ${response.substring(0, 500)}...`);
      return { news: [], events: [] };
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`[AI Research] ✓ Found ${result.news?.length || 0} news, ${result.events?.length || 0} events for ${poi.name}`);

    // Date correction removed - now using timezone-aware AI prompt with explicit ISO 8601 format
    console.log(`[AI Research] Using timezone: ${timezone} for date interpretation`);

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
      console.log(`[AI Research] Events found:`);
      result.events.forEach((event, idx) => {
        console.log(`[AI Research]   ${idx + 1}. ${event.title} (${event.start_date})`);
        console.log(`[AI Research]      Source: ${event.source_url || 'N/A'}`);
      });
    }

    if (result.news && result.news.length > 0) {
      console.log(`[AI Research] News found:`);
      result.news.forEach((item, idx) => {
        console.log(`[AI Research]   ${idx + 1}. ${item.title} (${item.published_date})`);
      });
    }

    checkCancellation(); // Check before link matching

    // Match events/news to extracted links for deep linking
    // Only override source_url if it's missing/null (don't override URLs from Google Search)
    console.log(`[Link Matcher] Checking conditions - events: ${result.events?.length || 0}, eventsLinks: ${eventsLinks.length}`);
    if (result.events && result.events.length > 0 && eventsLinks.length > 0) {
      updateProgress(poi.id, {
        phase: 'matching_links',
        message: `Matching ${result.events.length} events to deep links...`,
        steps: ['Initialized', 'Rendered pages', 'AI search complete', 'Matching deep links']
      });

      console.log(`[Link Matcher] Attempting to match ${result.events.length} events to ${eventsLinks.length} links...`);
      let matchCount = 0;
      let overrideCount = 0;
      result.events.forEach(event => {
        // Override if no URL, or if URL is a generic/index page
        const hasIndexUrl = event.source_url && (
          isGenericUrl(event.source_url) ||
          event.source_url === eventsUrl  // Exactly matches the events page URL
        );

        if (!event.source_url || event.source_url === 'N/A' || hasIndexUrl) {
          if (hasIndexUrl) {
            console.log(`[Link Matcher] Overriding index URL for "${event.title.substring(0, 40)}..."`);
            overrideCount++;
          }
          const matchedUrl = matchItemToLink(event, eventsLinks, 'event');
          if (matchedUrl) {
            event.source_url = matchedUrl;
            matchCount++;
          }
        }
      });
      console.log(`[Link Matcher] Matched ${matchCount} events to deep links (${overrideCount} index URLs overridden)`);
    } else {
      console.log(`[Link Matcher] Skipping event link matching - conditions not met`);
    }

    console.log(`[Link Matcher] Checking conditions - news: ${result.news?.length || 0}, newsLinks: ${newsLinks.length}`);
    if (result.news && result.news.length > 0 && newsLinks.length > 0) {
      updateProgress(poi.id, {
        phase: 'matching_links',
        message: `Matching ${result.news.length} news items to deep links...`,
        steps: ['Initialized', 'Rendered pages', 'AI search complete', 'Matching deep links']
      });

      console.log(`[Link Matcher] Attempting to match ${result.news.length} news items to ${newsLinks.length} links...`);
      let matchCount = 0;
      let overrideCount = 0;
      result.news.forEach(newsItem => {
        // Override if no URL, or if URL is a generic/index page
        const hasIndexUrl = newsItem.source_url && (
          isGenericUrl(newsItem.source_url) ||
          newsItem.source_url === newsUrl  // Exactly matches the news page URL
        );

        if (!newsItem.source_url || newsItem.source_url === 'N/A' || hasIndexUrl) {
          if (hasIndexUrl) {
            console.log(`[Link Matcher] Overriding index URL for "${newsItem.title.substring(0, 40)}..."`);
            overrideCount++;
          }
          const matchedUrl = matchItemToLink(newsItem, newsLinks, 'news');
          if (matchedUrl) {
            newsItem.source_url = matchedUrl;
            matchCount++;
          }
        }
      });
      console.log(`[Link Matcher] Matched ${matchCount} news items to deep links (${overrideCount} index URLs overridden)`);
    } else {
      console.log(`[Link Matcher] Skipping news link matching - conditions not met`);
    }

    // BACKFILL: Items with no source_url get the POI's events/news listing page as a starting point
    const hasEventsUrl = poi.events_url && poi.events_url.trim();
    const hasNewsUrl = poi.news_url && poi.news_url.trim();
    if (result.events && hasEventsUrl) {
      let backfilled = 0;
      for (const event of result.events) {
        if (!event.source_url || event.source_url === 'N/A') {
          event.source_url = poi.events_url;
          backfilled++;
        }
      }
      if (backfilled > 0) console.log(`[Deep Crawl] Backfilled ${backfilled} events with events_url: ${poi.events_url}`);
    }
    if (result.news && hasNewsUrl) {
      let backfilled = 0;
      for (const newsItem of result.news) {
        if (!newsItem.source_url || newsItem.source_url === 'N/A') {
          newsItem.source_url = poi.news_url;
          backfilled++;
        }
      }
      if (backfilled > 0) console.log(`[Deep Crawl] Backfilled ${backfilled} news with news_url: ${poi.news_url}`);
    }

    // DEEP CRAWL PHASE: For items with generic/index/listing URLs, crawl to find actual article pages
    const allItems = [
      ...(result.events || []).map(e => ({ ...e, _type: 'event' })),
      ...(result.news || []).map(n => ({ ...n, _type: 'news' }))
    ];
    const deepCrawlCandidates = allItems.filter(item => {
      if (!item.source_url || item.source_url === 'N/A') return false;
      if (isGenericUrl(item.source_url)) return true;
      if (hasEventsUrl && item.source_url === poi.events_url) return true;
      if (hasNewsUrl && item.source_url === poi.news_url) return true;
      return false;
    });

    if (deepCrawlCandidates.length > 0) {
      updateProgress(poi.id, {
        phase: 'deep_crawling',
        message: `Deep crawling ${deepCrawlCandidates.length} generic URLs...`,
        steps: ['Initialized', 'Rendered pages', 'AI search complete', 'Matching deep links', 'Deep crawling']
      });

      console.log(`[Deep Crawl] ${deepCrawlCandidates.length} items have generic source URLs, attempting deep crawl...`);
      let deepCrawlFixed = 0;

      for (const item of deepCrawlCandidates) {
        checkCancellation();
        try {
          const crawlResult = await deepCrawlForArticle(item.source_url, item, {
            maxDepth: 2,
            maxPages: 5,
            timeoutMs: 45000
          });
          if (crawlResult.foundUrl) {
            console.log(`[Deep Crawl] ✓ "${item.title.substring(0, 50)}..." → ${crawlResult.foundUrl}`);
            const sourceArray = item._type === 'event' ? result.events : result.news;
            const original = sourceArray.find(i => i.title === item.title && i.source_url === item.source_url);
            if (original) {
              original.source_url = crawlResult.foundUrl;
              deepCrawlFixed++;
            }
          } else {
            console.log(`[Deep Crawl] ✗ No match for "${item.title.substring(0, 50)}..." (checked ${crawlResult.pagesChecked} pages)`);
          }
        } catch (error) {
          console.error(`[Deep Crawl] Error crawling for "${item.title.substring(0, 50)}...": ${error.message}`);
        }
      }

      console.log(`[Deep Crawl] Fixed ${deepCrawlFixed}/${deepCrawlCandidates.length} generic URLs`);
    }

    let allNews = result.news || [];

    checkCancellation(); // Check before Google News search

    // SECOND PASS: If we used a dedicated news URL, also search Google News for external coverage
    if (usedDedicatedNewsUrl) {
      try {
        updateProgress(poi.id, {
          phase: 'google_news',
          message: 'Searching Google News for external coverage...',
          steps: ['Initialized', 'Rendered pages', 'AI search complete', 'Matching deep links', 'Searching Google News']
        });

        console.log(`[AI Research] 🔍 Second pass: Searching Google News for external coverage...`);

        const googleNewsPrompt = `Search Google News, PR Newswire, and other news sources for press releases, news articles, and media coverage about "${poi.name}" from the last 365 days.

TIMEZONE CONTEXT:
- The current timezone is: ${timezone}
- When you see dates in articles, interpret them as being in ${timezone}
- Return ALL dates in ISO 8601 format: YYYY-MM-DD
- CRITICAL: Copy dates EXACTLY as they appear. Do NOT add or subtract days.
- Example: "August 26, 2024" → "2024-08-26" (not 2024-08-25 or 2024-08-27)

MISSION SCOPE — Roots of The Valley:
Only include news that connects to Cuyahoga Valley National Park themes: nature, trails,
outdoor recreation, conservation, local history, ecology, wildlife, community stewardship,
scenic railroads, canal towpath heritage, or arts/culture organizations that serve the valley.
Skip generic urban news, restaurant openings, nightlife, sports, or entertainment unrelated
to the park's mission. Ask: "Would a CVNP visitor care about this?"

Focus on:
- Press releases from the organization
- News articles from local/regional media about nature, parks, trails, conservation
- Award announcements related to the park mission
- Major initiatives or programs tied to outdoor recreation, heritage, or ecology

Return ONLY news from external sources (not from ${poi.name}'s own website).

Use this exact JSON structure:
{
  "news": [
    {
      "title": "News headline",
      "summary": "2-3 sentence summary",
      "source_name": "Source name (e.g., PR Newswire, Cleveland.com)",
      "source_url": "URL from Google Search results",
      "published_date": "YYYY-MM-DD in ISO 8601 format",
      "news_type": "general|alert|wildlife|infrastructure|community"
    }
  ]
}

IMPORTANT:
- Only include news from the last 365 days
- Only include items that are 95%+ certain to be about "${poi.name}"
- Include the source_url from the Google Search result
- Return {"news": []} if no relevant external news found
- All dates must be in ISO 8601 format (YYYY-MM-DD)`;

        const googleNewsResult = await generateTextWithCustomPrompt(pool, googleNewsPrompt, sheets);
        const googleNewsResponse = googleNewsResult.response;
        console.log(`[AI Research] Received Google News response (${googleNewsResponse.length} chars) from ${googleNewsResult.provider}`);

        const googleJsonMatch = googleNewsResponse.match(/\{[\s\S]*\}/);
        if (googleJsonMatch) {
          const googleResult = JSON.parse(googleJsonMatch[0]);
          const googleNews = googleResult.news || [];

          if (googleNews.length > 0) {
            console.log(`[AI Research] ✓ Found ${googleNews.length} news items from Google News`);
            googleNews.forEach((item, idx) => {
              console.log(`[AI Research]   ${idx + 1}. ${item.title} (${item.published_date}) - ${item.source_name}`);
            });

            // Merge with existing news, avoiding duplicates by title
            const existingTitles = new Set(allNews.map(n => n.title.toLowerCase().trim()));
            const newItems = googleNews.filter(item => {
              const titleLower = item.title.toLowerCase().trim();
              return !existingTitles.has(titleLower);
            });

            if (newItems.length > 0) {
              console.log(`[AI Research] Adding ${newItems.length} unique items from Google News`);
              allNews = [...allNews, ...newItems];
            } else {
              console.log(`[AI Research] All Google News items were duplicates, skipped`);
            }
          } else {
            console.log(`[AI Research] No external news found in Google News`);
          }
        }
      } catch (googleError) {
        console.error(`[AI Research] ⚠️ Google News search failed: ${googleError.message}`);
        // Continue with first pass results even if second pass fails
      }
    }

    // Build completion message and stats based on collection type
    let completionMessage;
    let progressUpdate = {
      phase: 'complete',
      steps: ['Initialized', 'Rendered pages', 'AI search complete', 'Deep links matched', 'Complete'],
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
        usedDedicatedNewsUrl
      }
    };
  } catch (error) {
    console.error(`[AI Research] ❌ Error collecting news for ${poi.name}:`, error.message);

    updateProgress(poi.id, {
      phase: 'error',
      message: `Error: ${error.message}`,
      steps: ['Error occurred'],
      completed: true,
      error: error.message
    });

    // Keep error visible - frontend will clear it when appropriate

    return { news: [], events: [], metadata: { usedDedicatedNewsUrl: false } };
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
      console.log(`[URL Resolver] ✓ Resolved: ${url.substring(0, 50)}... → ${finalUrl}`);
      return finalUrl;
    }

    // If we got back the same URL, it's not redirecting properly
    console.log(`[URL Resolver] ✗ No redirect found for: ${url.substring(0, 60)}...`);
    return null; // Don't save broken redirects
  } catch (error) {
    console.log(`[URL Resolver] ✗ Failed to resolve: ${url.substring(0, 50)}... (${error.message})`);
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
 * Save news items to database
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI ID
 * @param {Array} newsItems - Array of news items from Perplexity
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
      // Skip news older than 365 days (unless skipDateFilter is true)
      // Use string comparison to avoid timezone conversion issues
      if (!skipDateFilter && item.published_date && /^\d{4}-\d{2}-\d{2}$/.test(item.published_date)) {
        if (item.published_date < oneYearAgoStr) {
          console.log(`Skipping old news item: ${item.title} (${item.published_date})`);
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
        console.log(`Skipping news item with failed URL resolution: "${item.title}"`);
        continue;
      }

      // Normalize the title for duplicate checking
      const normalizedTitle = normalizeNewsTitle(item.title);

      // Check if duplicate exists using BOTH URL and normalized title
      // This catches:
      // 1. Exact URL matches (same article from rendered page)
      // 2. Resolved URL matches (same article from Google Search after redirect resolution)
      // 3. Title variants like "Article | January 30" vs "Article | 2026-01-30"
      const existing = await pool.query(
        `SELECT id, title, source_url FROM poi_news
         WHERE poi_id = $1
         AND (
           ($2::text IS NOT NULL AND source_url = $2::text)
           OR title = $3
           OR REGEXP_REPLACE(title, '\\s*\\|\\s*(\\d{4}-\\d{2}-\\d{2}|[A-Z][a-z]+\\s+\\d{1,2}(,\\s*\\d{4})?)\\s*$', '', 'i') = $4
         )`,
        [poiId, resolvedUrl, item.title, normalizedTitle]
      );

      if (existing.rows.length > 0) {
        duplicateCount++;
        const reason = existing.rows[0].source_url === resolvedUrl ? 'same URL' : 'similar title';
        console.log(`Skipping duplicate (${reason}): "${item.title}"`);
        continue; // Skip duplicate
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
 * @param {Array} eventItems - Array of events from Perplexity
 */
export async function saveEventItems(pool, poiId, eventItems) {
  let savedCount = 0;
  let duplicateCount = 0;

  // Get today's date as a string (YYYY-MM-DD) to avoid timezone issues
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (const item of eventItems) {
    try {
      // Skip past events using string comparison to avoid timezone issues
      if (item.start_date && /^\d{4}-\d{2}-\d{2}$/.test(item.start_date)) {
        const endDateStr = item.end_date || item.start_date;
        if (endDateStr < todayStr) {
          console.log(`Skipping past event: ${item.title} (${item.start_date})`);
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
        console.log(`Skipping event with failed URL resolution: "${item.title}"`);
        continue;
      }

      // Check if duplicate exists using BOTH URL and title+date
      // This catches:
      // 1. Exact URL matches (same event from rendered page)
      // 2. Resolved URL matches (same event from Google Search after redirect resolution)
      // 3. Same title + start_date (existing logic)
      const existing = await pool.query(
        `SELECT id, title, source_url FROM poi_events
         WHERE poi_id = $1
         AND (
           ($2::text IS NOT NULL AND source_url = $2::text)
           OR (title = $3 AND start_date = $4)
         )`,
        [poiId, resolvedUrl, item.title, item.start_date]
      );

      if (existing.rows.length > 0) {
        duplicateCount++;
        const reason = existing.rows[0].source_url === resolvedUrl ? 'same URL' : 'same title+date';
        console.log(`Skipping duplicate event (${reason}): "${item.title}"`);
        continue; // Skip duplicate
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

  console.log(`[Job ${jobId}] Created news collection job for ${totalPois} POIs`);

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
    console.log(`[Job ${jobId}] All POIs already processed, marking complete`);
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

  console.log(`[Job ${jobId}] Starting/resuming news collection: ${remainingPoiIds.length} POIs remaining (${processedPoiIds.length} already done)`);

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

  // Track all results for summary
  const allResults = [];
  let jobCancelled = false;

  // Helper to check if job was cancelled in database
  const checkJobCancelled = async () => {
    const result = await pool.query(
      'SELECT status FROM news_job_status WHERE id = $1',
      [jobId]
    );
    return result.rows[0]?.status === 'cancelled';
  };

  try {
    // Process with staggered dispatch and limited concurrency (semaphore pattern)
    let inFlight = 0;
    let nextIndex = 0;
    let resolveAll;
    const allDone = new Promise(resolve => { resolveAll = resolve; });

    const processNextPoi = async () => {
      // Check if job was cancelled before starting new POI
      if (jobCancelled || await checkJobCancelled()) {
        jobCancelled = true;
        console.log(`[Job ${jobId}] Cancellation detected, stopping new POI processing`);
        if (inFlight === 0) resolveAll();
        return;
      }

      if (nextIndex >= pois.length) {
        if (inFlight === 0) resolveAll();
        return;
      }

      const index = nextIndex++;
      const poi = pois[index];
      inFlight++;

      // Find available slot and assign POI to it
      const slotId = findFirstAvailableSlot(jobId);

      // Determine provider before calling collectNewsForPoi (same logic as in collectNewsForPoi)
      const configResult = await pool.query(`
        SELECT key, value FROM admin_settings
        WHERE key IN ('ai_search_primary', 'ai_search_fallback', 'ai_search_primary_limit')
      `);
      const aiConfig = {
        primary: 'perplexity',
        fallback: 'none',
        primaryLimit: 0
      };
      for (const row of configResult.rows) {
        if (row.key === 'ai_search_primary') aiConfig.primary = row.value;
        if (row.key === 'ai_search_fallback') aiConfig.fallback = row.value;
        if (row.key === 'ai_search_primary_limit') aiConfig.primaryLimit = parseInt(row.value) || 0;
      }
      const currentUsage = getJobUsage();
      let providerToUse = aiConfig.primary;
      const primaryUsage = currentUsage[aiConfig.primary] || 0;
      if (aiConfig.primaryLimit > 0 && primaryUsage >= aiConfig.primaryLimit) {
        if (aiConfig.fallback && aiConfig.fallback !== 'none') {
          providerToUse = aiConfig.fallback;
        }
      }

      // Assign POI to slot with provider info
      assignPoiToSlot(jobId, slotId, poi.id, poi.name, providerToUse);

      // Initialize progress with slotId and jobId
      updateProgress(poi.id, {
        phase: 'initializing',
        message: `Starting news & events search for ${poi.name}...`,
        poiName: poi.name,
        provider: providerToUse,
        slotId,
        jobId,
        completed: false
      });

      try {
        console.log(`[Job ${jobId}] [${index + 1}/${pois.length}] Starting: ${poi.name} (Slot ${slotId}, ${inFlight} in flight)`);
        const { news, events, metadata } = await collectNewsForPoi(pool, poi, sheets, 'America/New_York');
        const savedNews = await saveNewsItems(pool, poi.id, news, { skipDateFilter: metadata.usedDedicatedNewsUrl });
        const savedEvents = await saveEventItems(pool, poi.id, events);
        console.log(`[Job ${jobId}] [${index + 1}/${pois.length}] ✓ ${poi.name}: ${savedNews} news, ${savedEvents} events`);

        // Update progress incrementally
        processed++;
        newsFound += savedNews;
        eventsFound += savedEvents;
        newlyProcessedIds.push(poi.id);

        // Checkpoint progress to database (including AI usage)
        const currentAiUsage = getJobUsage();
        await pool.query(`
          UPDATE news_job_status
          SET pois_processed = $1, news_found = $2, events_found = $3, processed_poi_ids = $4, ai_usage = $6
          WHERE id = $5
        `, [processed, newsFound, eventsFound, JSON.stringify(newlyProcessedIds), jobId, JSON.stringify(currentAiUsage)]);

        // Update last_news_collection timestamp
        await pool.query(`
          UPDATE pois
          SET last_news_collection = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [poi.id]);

        allResults.push({ poiId: poi.id, poiName: poi.name, newsFound: savedNews, eventsFound: savedEvents, success: true });
      } catch (error) {
        console.error(`[Job ${jobId}] [${index + 1}/${pois.length}] ✗ ${poi.name}: ${error.message}`);
        processed++;
        newlyProcessedIds.push(poi.id);

        // Still checkpoint on error (including AI usage)
        const currentAiUsage = getJobUsage();
        await pool.query(`
          UPDATE news_job_status
          SET pois_processed = $1, news_found = $2, events_found = $3, processed_poi_ids = $4, ai_usage = $6
          WHERE id = $5
        `, [processed, newsFound, eventsFound, JSON.stringify(newlyProcessedIds), jobId, JSON.stringify(currentAiUsage)]);

        allResults.push({ poiId: poi.id, poiName: poi.name, newsFound: 0, eventsFound: 0, success: false });
      }

      inFlight--;
      // Start next job with delay when a slot opens (prevents API rate limiting)
      // But don't start new jobs if cancelled
      if (jobCancelled) {
        if (inFlight === 0) resolveAll();
      } else if (nextIndex < pois.length && inFlight < MAX_CONCURRENCY) {
        setTimeout(() => processNextPoi(), DISPATCH_INTERVAL_MS);
      } else if (nextIndex >= pois.length && inFlight === 0) {
        resolveAll();
      }
    };

    // Start initial batch with staggered dispatch
    const initialBatch = Math.min(MAX_CONCURRENCY, pois.length);
    for (let i = 0; i < initialBatch; i++) {
      setTimeout(() => processNextPoi(), i * DISPATCH_INTERVAL_MS);
    }

    // Wait for all to complete
    await allDone;

    // Log AI provider usage for this job
    const usage = getJobUsage();
    console.log(`[Job ${jobId}] AI provider usage: Gemini=${usage.gemini}, Perplexity=${usage.perplexity}`);

    // Only mark complete if not cancelled (cancel endpoint already set status)
    if (!jobCancelled) {
      await pool.query(`
        UPDATE news_job_status
        SET status = 'completed', completed_at = $1, ai_usage = $3
        WHERE id = $2
      `, [new Date(), jobId, JSON.stringify(usage)]);
    } else {
      console.log(`[Job ${jobId}] Job was cancelled, not marking as completed`);
    }

    if (jobCancelled) {
      console.log(`[Job ${jobId}] Cancelled after processing ${processed} POIs, ${newsFound} news, ${eventsFound} events`);
    } else {
      console.log(`[Job ${jobId}] Completed: ${processed} POIs, ${newsFound} news, ${eventsFound} events`);
    }

    // Don't clear display slots - keep them frozen for frontend to display
    // Frontend will clear them when user clicks X or starts a new job

    // Log summary of results
    const poisWithResults = allResults.filter(r => r.newsFound > 0 || r.eventsFound > 0);
    const poisWithoutResults = allResults.filter(r => r.newsFound === 0 && r.eventsFound === 0);

    if (poisWithResults.length > 0) {
      console.log(`[Job ${jobId}] POIs with results (${poisWithResults.length}):`);
      poisWithResults.forEach(r => {
        console.log(`[Job ${jobId}]   - ${r.poiName}: ${r.newsFound} news, ${r.eventsFound} events`);
      });
    }

    if (poisWithoutResults.length > 0) {
      console.log(`[Job ${jobId}] POIs with no results (${poisWithoutResults.length}):`);
      poisWithoutResults.forEach(r => {
        console.log(`[Job ${jobId}]   - ${r.poiName}`);
      });
    }

    // Sync to Google Sheets if available
    if (sheets && (newsFound > 0 || eventsFound > 0)) {
      try {
        console.log(`[Job ${jobId}] Syncing news and events to Google Sheets...`);
        await pushNewsToSheets(sheets, pool);
        await pushEventsToSheets(sheets, pool);
        console.log(`[Job ${jobId}] Google Sheets sync completed`);
      } catch (syncError) {
        console.error(`[Job ${jobId}] Google Sheets sync failed:`, syncError.message);
      }
    }
  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error);
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
      console.error(`[Job ${jobId}] Background processing failed:`, error);
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
    console.log('No POIs to collect');
    return {
      jobId: null,
      totalPois: 0,
      message: 'No POIs to collect'
    };
  }

  console.log(`Starting news collection for ${poiIds.length} POIs`);
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
  const result = await pool.query(`
    DELETE FROM poi_news
    WHERE created_at < CURRENT_DATE - INTERVAL '1 day' * $1
  `, [daysOld]);

  return result.rowCount;
}

/**
 * Clean up past events
 * @param {Pool} pool - Database connection pool
 * @param {number} daysOld - Delete events older than this many days
 */
export async function cleanupPastEvents(pool, daysOld = 30) {
  const result = await pool.query(`
    DELETE FROM poi_events
    WHERE end_date < CURRENT_DATE - INTERVAL '1 day' * $1
       OR (end_date IS NULL AND start_date < CURRENT_DATE - INTERVAL '1 day' * $1)
  `, [daysOld]);

  return result.rowCount;
}
