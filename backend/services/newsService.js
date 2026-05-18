
import { generateTextWithCustomPrompt as geminiGenerateText } from './geminiService.js';
import { parseDate, parseDateTime, extractDatesFromText, extractUrlDate, normalizeDateSources, scoreDateConsensus } from './dateExtractor.js';

let geminiCallCount = 0;


const LLM_DATE_VOTES = 3;

export function normalizeRenderUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('instagram.com')) {
      parsed.pathname = parsed.pathname.replace(/^\/(reels?)\//, '/p/');
      return parsed.toString();
    }
    return url;
  } catch { return url; }
}

export async function runLlmDateVotes(pool, snippet, numVotes = LLM_DATE_VOTES, mode = 'date') {
  const today = new Date().toISOString().substring(0, 10);

  if (mode === 'datetime') {
    const datePrompt = `Today's date is ${today}. Extract the event start and end date/time from this page. If no year is shown, assume the current year. Return ONLY a JSON object like {"start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM"} or {"start":"YYYY-MM-DDTHH:MM","end":null} if no end time. Return {"start":null,"end":null} if no dates found.\n\n${snippet}`;
    const results = await Promise.all(
      Array.from({ length: numVotes }, () =>
        generateTextWithCustomPrompt(pool, datePrompt, { maxOutputTokens: 128, thinkingBudget: 0 })
          .then(r => {
            const raw = (r.response || '').trim();
            try {
              const cleaned = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
              const parsed = JSON.parse(cleaned);
              return { start: parsed.start || null, end: parsed.end || null };
            } catch { return { start: null, end: null }; }
          })
          .catch(() => ({ start: null, end: null }))
      )
    );
    return { startVotes: results.map(v => v.start), endVotes: results.map(v => v.end) };
  }

  const datePrompt = `Today's date is ${today}. Extract the primary publication or start date from this article/page snippet. Return ONLY the date in ISO format YYYY-MM-DD, or the word null if no date is present.\n\n${snippet}`;
  const results = await Promise.all(
    Array.from({ length: numVotes }, () =>
      generateTextWithCustomPrompt(pool, datePrompt, { maxOutputTokens: 64, thinkingBudget: 0 })
        .then(r => {
          const raw = (r.response || '').trim().replace(/^["']|["']$/g, '');
          return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
        })
        .catch(() => null)
    )
  );
  return results;
}

export async function scoreDate(pool, { title, description, pageContent, sources, timezone, mode = 'date', llmVotes }) {
  const itemContext = `${title || ''}\n${description || ''}`.trim();
  const dateText = itemContext
    ? `${itemContext}\n\n${pageContent || ''}`.substring(0, 2000)
    : (pageContent || '').substring(0, 2000);

  const votes = llmVotes || (dateText.length >= 20
    ? await runLlmDateVotes(pool, dateText, LLM_DATE_VOTES, mode)
    : []);

  const normalizedSources = normalizeDateSources(sources, timezone, mode);
  const normalizedVotes = (mode === 'datetime')
    ? votes.map(v => v ? parseDateTime(v, timezone)?.substring(0, 16) : null).filter(Boolean)
    : votes;
  const consensus = scoreDateConsensus(normalizedSources, normalizedVotes);

  return {
    ...consensus,
    rawSignals: {
      jsonLd: normalizedSources.jsonLd || [],
      meta: normalizedSources.meta || [],
      timeTags: normalizedSources.timeTags || [],
      url: normalizedSources.url || null,
      llmVotes: normalizedVotes
    }
  };
}


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

async function generateTextWithCustomPrompt(pool, prompt, options = {}) {
  geminiCallCount++;
  const text = await geminiGenerateText(pool, prompt, options);
  return { response: text, provider: 'gemini' };
}
import { renderPage, setCachePageType, setCacheItemCount } from './renderPage.js';
import { healthCheck, forceKill } from './browserPool.js';
import { logInfo, logWarn, logError, flush as flushJobLogs } from './jobLogger.js';
import { CollectionTracker, runBatch } from './collection/index.js';

export class BrowserOverloadError extends Error {
  constructor(poiName) {
    super(`Browser circuit breaker tripped during crawl of ${poiName}`);
    this.name = 'BrowserOverloadError';
  }
}
import { searchNewsUrls } from './serperService.js';
import { getDomainReputation } from './moderationService.js';
import fs from 'fs';

function debugLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}\n`;
  try {
    fs.appendFileSync('/tmp/logs/debug.log', logMessage);
  } catch (err) {
  }
  console.error(message);
}

const DISPATCH_INTERVAL_MS = 1500;
const MAX_CONCURRENCY = 10;

const tracker = new CollectionTracker('News');

export const updateProgress = (poiId, updates) => tracker.updateProgress(poiId, updates);
export const getCollectionProgress = (poiId) => tracker.getCollectionProgress(poiId);
export const clearProgress = (poiId) => tracker.clearProgress(poiId);
export const getAllActiveProgress = () => tracker.getAllActiveProgress();
export const initializeSlots = (jobId, count) => tracker.initializeSlots(jobId, count);
export const getDisplaySlots = (jobId) => tracker.getDisplaySlots(jobId);
export const requestCancellation = (poiId) => tracker.requestCancellation(poiId);
export const isCancellationRequested = (poiId) => tracker.isCancellationRequested(poiId);

export async function ensureNewsJobCheckpointColumns(pool) {
  const runId = Math.floor(Date.now() / 1000);
  try {
    await pool.query(`
      ALTER TABLE news_job_status
      ADD COLUMN IF NOT EXISTS poi_ids TEXT
    `);

    await pool.query(`
      ALTER TABLE news_job_status
      ADD COLUMN IF NOT EXISTS processed_poi_ids TEXT
    `);

    await pool.query(`
      ALTER TABLE news_job_status
      ADD COLUMN IF NOT EXISTS pg_boss_job_id VARCHAR(100)
    `);

    await pool.query(`
      ALTER TABLE news_job_status
      ADD COLUMN IF NOT EXISTS circuit_breaker_retries TEXT
    `);

    logInfo(runId, 'news', null, null, 'News job checkpoint columns verified');
  } catch (error) {
    logError(runId, 'news', null, null, `Error ensuring checkpoint columns: ${error.message}`);
  }
}

export async function findIncompleteJobs(pool) {
  const incompleteJobs = await pool.query(`
    SELECT * FROM news_job_status
    WHERE status IN ('queued', 'running')
    AND created_at > NOW() - INTERVAL '1 hour'
    ORDER BY created_at ASC
  `);
  return incompleteJobs.rows;
}

const CALENDAR_VIEW_SUFFIXES = ['/list/', '/list', '/month/', '/month', '/today/', '/today',
  '/week/', '/week', '/day/', '/day', '/map/', '/map', '/photo/', '/photo',
  '/summary/', '/summary', '/calendar/', '/calendar'];

const NAV_PATHS = [
  '/login', '/signin', '/signup', '/register',
  '/cart', '/checkout', '/account', '/household',
  '/contact', '/contactus', '/contact-us',
  '/about', '/about-us', '/aboutus',
  '/privacy', '/terms', '/cookie', '/accessibility',
  '/search', '/subscribe', '/newsletter',
  '/donate', '/give', '/membership',
  '/splash', '/faq', '/help',
  '/become-a-member', '/get-involved', '/volunteer'
];

const WEBTRAC_NAV_FILES = ['splash.html', 'contactus.html', 'cart.html', 'login.html',
  'household.html', 'register.html', 'forgotpassword.html', 'wishlist.html', 'addtocart.html'];

function isNoiseLink(url, sourceUrl) {
  let parsed;
  try { parsed = new URL(url); } catch { return true; }

  const path = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();

  if (/\.(png|jpe?g|gif|svg|webp|pdf|css|js|ico|woff2?|mp[34]|zip|ics)$/i.test(path)) return true;

  try {
    const source = new URL(sourceUrl);
    if (parsed.origin === source.origin && parsed.pathname === source.pathname && parsed.hash) return true;
  } catch { /* ignore */ }

  if (path === '/' || path === '') return true;

  for (const suffix of CALENDAR_VIEW_SUFFIXES) {
    if (path.endsWith(suffix)) return true;
  }

  if (search.includes('eventdisplay=past') || search.includes('display=past')) return true;

  if (search.includes('ical=1') || search.includes('outlook-ical') || path.endsWith('.ics')) return true;

  if (/\/page\/\d+\/?$/.test(path)) return true;
  if (/[?&]page=\d+/.test(search)) return true;

  const pathSegments = path.replace(/\/$/, '').split('/').filter(Boolean);
  if (pathSegments.length <= 1) {
    const simplePath = '/' + (pathSegments[0] || '');
    if (NAV_PATHS.includes(simplePath)) return true;
  }

  const filename = path.split('/').pop();
  if (WEBTRAC_NAV_FILES.includes(filename)) return true;

  if (/[?&]module=(PM|FR)\b/i.test(search)) return true;

  const lastSegment = path.replace(/\/$/, '').split('/').pop() || '';
  if (/\brequest|submit|apply|form\b/i.test(lastSegment)) return true;

  return false;
}

function shortestUrlDedup(urls) {
  const byUrl = new Map();
  for (const url of urls) {
    let dominated = false;
    for (const [existing] of byUrl) {
      if (url.startsWith(existing + '&') || url.startsWith(existing + '%')) {
        dominated = true;
        break;
      }
      if (existing.startsWith(url + '&') || existing.startsWith(url + '%')) {
        byUrl.delete(existing);
      }
    }
    if (!dominated) byUrl.set(url, true);
  }
  return [...byUrl.keys()];
}

async function classifyPage(pool, markdown, links, url, contentType, sheets, trustedEventPaths = []) {
  let sourceOrigin;
  try { sourceOrigin = new URL(url).pathname; } catch { sourceOrigin = ''; }
  const contentLinks = (links || []).filter(l => {
    const text = (l.text || '').toLowerCase();
    if (/read\s*more|continue|full\s*(article|story)|learn\s*more|details/i.test(text)) return true;
    if (/\b(article|post|news|event|card|entry|blog)\b/i.test(l.parentClassName || '')) return true;
    if (/\b(article|post|news|event|card|entry|blog)\b/i.test(l.className || '')) return true;
    try {
      const linkPath = new URL(l.url).pathname;
      if (sourceOrigin.length > 1 && linkPath.startsWith(sourceOrigin) && linkPath !== sourceOrigin && linkPath !== sourceOrigin + '/') return true;
    } catch { /* ignore */ }
    try {
      const linkPath = new URL(l.url).pathname;
      const sourceDir = sourceOrigin.replace(/\/[^/]+\.[^/]+$/, '');
      if (sourceDir && sourceDir !== sourceOrigin && linkPath.startsWith(sourceDir + '/') && linkPath !== sourceOrigin) return true;
    } catch { /* ignore */ }
    if (trustedEventPaths.length > 0) {
      try {
        const linkPath = new URL(l.url).pathname;
        if (trustedEventPaths.some(pattern => linkPath.includes(pattern))) return true;
      } catch { /* ignore */ }
    }
    return false;
  });
  let sourcePathname;
  try { sourcePathname = new URL(url).pathname; } catch { sourcePathname = null; }
  const notSelfRef = l => {
    if (!sourcePathname) return true;
    try { return new URL(l.url).pathname !== sourcePathname; } catch { return true; }
  };
  const dedup = (arr) => {
    const urlSeen = new Set();
    return arr.filter(l => {
      if (urlSeen.has(l.url)) return false;
      urlSeen.add(l.url);
      return true;
    });
  };
  const filteredContentLinks = dedup(contentLinks.filter(notSelfRef));
  const seen = new Set(filteredContentLinks.map(l => l.url));
  const otherLinks = dedup(links.filter(l => !seen.has(l.url)).filter(notSelfRef));
  const rankedLinks = [...filteredContentLinks, ...otherLinks].slice(0, 30);

  const prompt = `Classify this web page. Based on the content, is it:
A) LISTING — lists multiple ${contentType}s with links to individual pages
B) DETAIL — describes a single ${contentType} with dates/descriptions/details
C) NEITHER — not a ${contentType} page at all (e.g., about page, contact form, login, navigation, store/shop, generic info)

PAGE URL: ${url}
CONTENT (first 3000 chars):
${markdown.substring(0, 5000)}

Return ONLY valid JSON:
{"page_type": "listing|detail|neither", "reasoning": "one sentence"}`;

  const classifierOutput = await generateTextWithCustomPrompt(pool, prompt, { maxOutputTokens: 256, thinkingBudget: 0 });

  const text = classifierOutput.response || classifierOutput;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { pageType: 'listing', detailLinks: rankedLinks.map(l => l.url), reasoning: 'parse failure fallback' };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const pageType = (parsed.page_type || '').toLowerCase();

    if (pageType === 'listing') {
      return { pageType, detailLinks: rankedLinks.map(l => l.url), reasoning: parsed.reasoning };
    }
    if (pageType === 'detail') {
      return { pageType, detailLinks: [], reasoning: parsed.reasoning };
    }
    if (pageType === 'neither') {
      return { pageType, detailLinks: [], reasoning: parsed.reasoning };
    }
    return { pageType: 'listing', detailLinks: rankedLinks.map(l => l.url), reasoning: parsed.reasoning || 'unrecognized classification fallback' };
  } catch {
    return { pageType: 'listing', detailLinks: rankedLinks.map(l => l.url), reasoning: 'parse failure fallback' };
  }
}

function filterDetailLinks(detailLinks, sourceUrl, basePath = null, trustedEventPaths = []) {
  if (!detailLinks?.length) return [];
  let sourceOrigin;
  try { sourceOrigin = new URL(sourceUrl).origin; } catch { return []; }
  const seen = new Set();
  return detailLinks.map(link => {
    try { const u = new URL(link); u.hash = ''; return u.toString(); } catch { return link; }
  }).filter(link => {
    try {
      const parsed = new URL(link);
      if (parsed.origin !== sourceOrigin) return false;
      if (isNoiseLink(link, sourceUrl)) return false;
      if (basePath && !parsed.pathname.startsWith(basePath)) {
        const matchesTrusted = trustedEventPaths.some(pattern =>
          parsed.pathname.includes(pattern)
        );
        if (!matchesTrusted) return false;
      }
      if (seen.has(link)) return false;
      seen.add(link);
      return true;
    } catch { return false; }
  }).slice(0, 20);
}

async function itemCount(pool, markdown, contentType, logContext = {}) {
  const { jobId = 0, jobType = 'news', poiId = null, poiName = '', phase = '' } = logContext;
  const typeLabel = contentType === 'event' ? 'events' : 'news articles';
  const prompt = `How many distinct ${typeLabel} are described on this page?
For events, count recurring instances on different dates as separate events.

PAGE CONTENT:
${markdown.substring(0, 5000)}

Respond with ONLY this JSON object, nothing else: {"count": N}`;

  const countOutput = await generateTextWithCustomPrompt(pool, prompt, { maxOutputTokens: 64, thinkingBudget: 0 });
  const text = (countOutput.response || countOutput || '').trim();
  logInfo(jobId, jobType, poiId, poiName, `${phase}: [ItemCount] Gemini response: ${text}`);
  const MAX_ITEM_COUNT = 20;
  const clamp = (n) => {
    if (n > MAX_ITEM_COUNT) {
      logWarn(jobId, jobType, poiId, poiName, `${phase}: [ItemCount] Clamped ${n} to ${MAX_ITEM_COUNT}`);
      return MAX_ITEM_COUNT;
    }
    return n;
  };

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const n = parseInt(parsed.count, 10);
      if (Number.isFinite(n) && n >= 0) return clamp(n);
    } catch { /* fall through to bare number check */ }
  }
  const bareNumber = text.match(/\b(\d+)\b/);
  if (bareNumber) {
    const n = parseInt(bareNumber[1], 10);
    if (Number.isFinite(n) && n > 0) {
      logWarn(jobId, jobType, poiId, poiName, `${phase}: [ItemCount] Parsed bare number ${n} from non-JSON response`);
      return clamp(n);
    }
  }
  logWarn(jobId, jobType, poiId, poiName, `${phase}: [ItemCount] Could not parse count, defaulting to 1`);
  return 1;
}

function buildEventPrompt(poi, markdown, eventIndex, totalEvents) {
  const which = totalEvents > 1
    ? `Extract event #${eventIndex} of ${totalEvents} from this page.`
    : `Summarize the event described in this text.`;

  return `${which}

POI: "${poi.name}"

PAGE CONTENT:
${markdown}

Return ONLY valid JSON:
{"title": "Event name", "description": "Brief description", "event_type": "hike|race|concert|festival|program|volunteer|arts|community|alert", "location_details": "Where the event takes place"}

Do NOT include date or source_url fields — those are set separately.
Return {} if no event found.`;
}

function buildNewsPrompt(poi, markdown) {
  return `Summarize the news described in this text.

POI: "${poi.name}"

PAGE CONTENT:
${markdown}

Return ONLY valid JSON:
{"title": "News headline", "summary": "2-3 sentence summary", "source_name": "Source name (e.g., NPS.gov, Cleveland.com)", "news_type": "general|alert|wildlife|infrastructure|community"}

Do NOT include date or source_url fields — those are set separately.
Return {} if no news found.`;
}

async function runConcurrent(tasks, limit = 10, delayMs = 0) {
  const results = new Array(tasks.length);

  if (delayMs <= 0) {
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const i = idx++;
        try { results[i] = await tasks[i](); } catch (e) { results[i] = e instanceof Error ? e : new Error(String(e)); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  } else {
    const inFlight = new Set();
    for (let i = 0; i < tasks.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, delayMs));
      while (inFlight.size >= limit) await Promise.race(inFlight);
      const p = (async () => {
        try { results[i] = await tasks[i](); } catch (e) { results[i] = e instanceof Error ? e : new Error(String(e)); }
      })();
      const tracked = p.then(() => inFlight.delete(tracked), () => inFlight.delete(tracked));
      inFlight.add(tracked);
    }
    await Promise.all(inFlight);
  }

  return results;
}

async function processPage(pool, page, poi, contentType, options = {}) {
  const { phase = 'Phase I', jobId = 0, timezone = 'America/New_York', jobType = 'news' } = options;
  const url = page.url;
  const isEvent = contentType === 'event';

  if (!page.markdown || page.markdown.length < 200) {
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [ProcessPage] Skip — too short (${page.markdown?.length || 0} chars) ${url}`);
    return { news: [], events: [] };
  }

  const cachedCount = isEvent ? page.itemCountEvents : page.itemCountNews;
  let count;
  if (cachedCount != null) {
    count = cachedCount;
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [ItemCount] ${count} ${contentType}(s) on ${url} (cached)`);
  } else {
    count = await itemCount(pool, page.markdown, contentType, { jobId, jobType, poiId: poi.id, poiName: poi.name, phase });
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [ItemCount] ${count} ${contentType}(s) on ${url}`);
    await setCacheItemCount(pool, url, contentType, count);
  }
  if (count === 0) return { news: [], events: [] };
  if (count > 500) {
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [ItemCount] Skip — absurd count (${count}) suggests pagination artifact: ${url}`);
    return { news: [], events: [] };
  }

  const od = page.ogDates || {};
  const pageText = page.rawText || page.markdown;
  const renderedContent = pageText || null;
  const items = [];

  const dateSources = isEvent
    ? {
        start: {
          jsonLd: od.eventStartDate ? [od.eventStartDate] : [],
          meta: [], timeTags: od.timeDates?.length > 0 ? [od.timeDates[0]] : [],
          url: extractUrlDate(url)
        },
        end: {
          jsonLd: od.eventEndDate ? [od.eventEndDate] : [],
          meta: [], timeTags: od.timeDates?.length > 1 ? [od.timeDates[1]] : [],
          url: null
        }
      }
    : {
        jsonLd: od.jsonLdDates || [],
        meta: [od.publishedTime, od.parselyPubDate, od.dcDate].filter(Boolean),
        timeTags: od.timeDates || [],
        url: extractUrlDate(url)
      };

  for (let i = 1; i <= count; i++) {
    updateProgress(poi.id, { phase: 'summarize', message: `${contentType} ${i}/${count} from ${url}` });
    const prompt = isEvent
      ? buildEventPrompt(poi, page.markdown, i, count)
      : buildNewsPrompt(poi, page.markdown);
    logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Summarize] ${contentType} ${i}/${count} from ${url}`);
    const aiResult = await generateTextWithCustomPrompt(pool, prompt, { maxOutputTokens: 512, thinkingBudget: 0 });
    const text = (aiResult.response || aiResult || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;

    let item;
    try { item = JSON.parse(jsonMatch[0]); } catch { continue; }
    if (!item.title) continue;

    updateProgress(poi.id, { phase: 'dates', message: `${contentType} ${i}/${count} from ${url}` });
    const dateSnippet = `${item.title}\n${item.description || item.summary || ''}\n\n${pageText}`.substring(0, 2000);

    if (isEvent) {
      const { startVotes, endVotes } = await runLlmDateVotes(pool, dateSnippet, LLM_DATE_VOTES, 'datetime');
      const startResult = await scoreDate(pool, {
        title: item.title, description: item.description, pageContent: pageText,
        sources: dateSources.start, timezone, mode: 'datetime', llmVotes: startVotes
      });
      const endResult = await scoreDate(pool, {
        title: item.title, description: item.description, pageContent: pageText,
        sources: dateSources.end, timezone, mode: 'datetime', llmVotes: endVotes
      });
      item.start_date = startResult.date;
      item.end_date = endResult.date;
      item.date_consensus_score = startResult.score;
      item.date_signals = { start: startResult.rawSignals, end: endResult.rawSignals };
      logInfo(jobId, jobType, poi.id, poi.name,
        `${phase}: [Dates] start=${item.start_date || 'none'} (score=${startResult.score}), end=${item.end_date || 'none'} (score=${endResult.score}) from ${url}`);
    } else {
      const llmVotes = await runLlmDateVotes(pool, dateSnippet);
      const consensus = await scoreDate(pool, {
        title: item.title, description: item.summary, pageContent: pageText,
        sources: dateSources, timezone, llmVotes
      });
      item.published_date = consensus.date;
      if (od.publishedTime && od.publishedTime.includes('T') && consensus.date) {
        try {
          const ogTs = new Date(od.publishedTime);
          if (!isNaN(ogTs) && ogTs.toISOString().startsWith(consensus.date)) {
            item.published_date = ogTs.toISOString();
          }
        } catch { /* keep consensus date */ }
      }
      item.date_consensus_score = consensus.score;
      item.date_signals = consensus.rawSignals;
      logInfo(jobId, jobType, poi.id, poi.name,
        `${phase}: [Dates] ${item.published_date || 'none'} (score=${consensus.score}) from ${url}`);
    }

    item.source_url = url;
    item.rendered_content = renderedContent;
    items.push(item);
  }

  logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Summarize] ${items.length} ${contentType}(s) from ${url}`);
  return isEvent ? { news: [], events: items } : { news: items, events: [] };
}


async function filterKnownPages(pool, pages, contentType, opts = {}) {
  if (pages.length === 0) return pages;
  const { jobId = 0, jobType = 'news', poiId, poiName, phase = '' } = opts;

  const normFull = url => url.toLowerCase().replace(/\/+$/, '');
  const normPath = url => {
    try { const p = new URL(url); return (p.origin + p.pathname).toLowerCase().replace(/\/+$/, ''); }
    catch { return normFull(url); }
  };

  const table = contentType === 'event' ? 'poi_events' : 'poi_news';
  const fullUrls = pages.map(p => normFull(p.url));
  const pathUrls = pages.map(p => normPath(p.url));

  const existingUrlRows = await pool.query(
    `SELECT LOWER(REGEXP_REPLACE(source_url, '/+$', '')) AS url FROM ${table}
     WHERE LOWER(REGEXP_REPLACE(source_url, '/+$', '')) = ANY($1)
        OR LOWER(REGEXP_REPLACE(REGEXP_REPLACE(source_url, '\\?.*$', ''), '/+$', '')) = ANY($2)`,
    [fullUrls, pathUrls]
  );
  const known = new Set(existingUrlRows.rows.map(r => r.url));

  return pages.filter(p => {
    if (known.has(normFull(p.url)) || known.has(normPath(p.url))) {
      logInfo(jobId, jobType, poiId, poiName, `${phase}: [Skip] Already in DB: ${p.url}`);
      return false;
    }
    return true;
  });
}

async function crawlPage(pool, startUrl, contentType, poi, sheets, checkCancellation, options = {}) {
  const { maxDepth = 2, maxPages = 50, maxDetailPages = 30, phase = 'Phase I', jobId = 0, jobType = 'news', scopeToPath = true } = options;
  const visited = new Set();
  let totalPagesRendered = 0;
  const collectedPages = []; // { url, markdown, rawText, ogDates, title }

  let basePath = null;
  if (scopeToPath) {
    try {
      const startParsed = new URL(startUrl);
      let rawPath = startParsed.pathname.replace(/\/$/, '') || '/';
      if (/\/[^/]+\.(html?|aspx?|php|jsp|shtml)$/i.test(rawPath)) {
        const dir = rawPath.replace(/\/[^/]+$/, '');
        if (dir && dir !== '/') rawPath = dir;
      }
      basePath = rawPath;
    } catch { /* leave basePath null if URL is unparseable */ }
  }

  let trustedEventPaths = [];
  if (contentType === 'event') {
    try {
      const tepResult = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'trusted_event_paths'"
      );
      if (tepResult.rows.length) {
        trustedEventPaths = JSON.parse(tepResult.rows[0].value);
      }
    } catch { /* use empty list */ }
  }

  async function processLevel(urls, depth) {
    if (depth > maxDepth || totalPagesRendered >= maxPages || collectedPages.length >= maxDetailPages) return;

    const cleanUrls = urls.map(url => {
      try { const u = new URL(url); u.hash = ''; return u.toString(); } catch { return url; }
    });

    const toProcess = cleanUrls.filter(url => !visited.has(url));
    toProcess.forEach(url => visited.add(url));

    if (toProcess.length > 0) {
      const healthy = await healthCheck(1000);
      if (!healthy) {
        logWarn(jobId, jobType, poi.id, poi.name, `${phase}: [CircuitBreaker] Browser unresponsive — killing and aborting crawl`);
        await forceKill(`Circuit breaker tripped during ${poi.name} crawl`);
        throw new BrowserOverloadError(poi.name);
      }
    }

    await runConcurrent(toProcess.map(url => async () => {
      checkCancellation();
      if (totalPagesRendered >= maxPages || collectedPages.length >= maxDetailPages) return;
      totalPagesRendered++;

      updateProgress(poi.id, { phase: 'render', message: url });
      logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Render] ${url} (depth=${depth}, page=${totalPagesRendered})`);
      const extracted = await renderPage(pool, url, { timeout: 30000, hardTimeout: 60000, extractLinks: true });
      if (!extracted.reachable || !extracted.markdown) {
        logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Render] Skip — ${extracted.reason || 'no content'}${extracted.cached ? ' (cached)' : ''}`);
        return;
      }
      if (extracted.cached) logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Cache] Hit for ${url}`);

      let classification;
      if (extracted.pageType) {
        classification = { pageType: extracted.pageType, detailLinks: [], reasoning: 'cached' };
        logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Cache] Classify skip — already ${extracted.pageType}: ${url}`);
        if (extracted.pageType === 'listing') {
          classification.detailLinks = shortestUrlDedup(filterDetailLinks(
            (extracted.links || []).map(l => l.url), url, basePath, trustedEventPaths
          ));
        }
      } else {
        updateProgress(poi.id, { phase: 'classify', message: url });
        classification = await classifyPage(pool, extracted.markdown, extracted.links || [], url, contentType, sheets, trustedEventPaths);
        logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Classify] ${url} → ${classification.pageType} (${classification.reasoning})`);
        await setCachePageType(pool, url, classification.pageType);
      }

      if (classification.pageType === 'detail') {
        collectedPages.push({ url, markdown: extracted.markdown, rawText: extracted.rawText, ogDates: extracted.ogDates, title: extracted.title, itemCountNews: extracted.itemCountNews, itemCountEvents: extracted.itemCountEvents });
      } else if (classification.pageType === 'listing') {
        const validLinks = shortestUrlDedup(filterDetailLinks(classification.detailLinks, url, basePath, trustedEventPaths));
        updateProgress(poi.id, { phase: 'crawl', message: `${validLinks.length} links from ${url}` });
        logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Crawl] Following ${validLinks.length} detail links from ${url}`);
        await processLevel(validLinks, depth + 1);
      } else if (classification.pageType === 'neither') {
        logInfo(jobId, jobType, poi.id, poi.name, `${phase}: [Skip] Not a ${contentType} page: ${url} (${classification.reasoning})`);
      }
    }), 3, 2000);
  }

  await processLevel([startUrl], 0);
  return { pages: collectedPages, totalPagesRendered, totalDetailPages: collectedPages.length };
}

export async function collectPoi(pool, poi, sheets = null, timezone = 'America/New_York', collectionType = 'both', onProgress = null) {
  const collectibleRoles = ['point', 'organization', 'river'];
  const poiRoles = poi.poi_roles || [];
  if (!poiRoles.some(r => collectibleRoles.includes(r))) {
    const jobId = tracker.getCollectionProgress(poi.id)?.jobId;
    const jobType = tracker.getCollectionProgress(poi.id)?.jobType || 'news';
    logInfo(jobId, jobType, poi.id, poi.name, `Skipping: no collectible role (roles: ${poiRoles.join(', ') || 'none'})`);
    return { news: [], events: [], metadata: { skipped: true, reason: 'no collectible role' } };
  }

  const activities = poi.primary_activities || 'None specified';
  const website = poi.more_info_link || 'No website available';
  const eventsUrl = poi.events_url || 'No dedicated events page';
  const newsUrl = poi.news_url || 'No dedicated news page';

  const existingProgress = tracker.getCollectionProgress(poi.id);
  const slotId = existingProgress?.slotId;
  const jobId = existingProgress?.jobId;
  const jobType = existingProgress?.jobType || 'news';

  logInfo(jobId, jobType, poi.id, poi.name, `Collection type: ${collectionType}`);

  tracker.clearProgress(poi.id);

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

  const reportProgress = (message) => {
    if (onProgress) onProgress(message);
  };

  logInfo(jobId, jobType, poi.id, poi.name, 'Starting search', { website, eventsUrl, newsUrl, activities });

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

  const MAX_PHASE2_PAGES = 5;

  const [concurrencyRow, delayRow, blocklistRow] = await Promise.all([
    pool.query("SELECT value FROM admin_settings WHERE key = 'page_concurrency'"),
    pool.query("SELECT value FROM admin_settings WHERE key = 'page_delay_ms'"),
    pool.query("SELECT value FROM admin_settings WHERE key = 'blocklist_urls'")
  ]);
  const blocklistSet = new Set(
    blocklistRow.rows.length
      ? (JSON.parse(blocklistRow.rows[0].value || '[]')).map(e => e.toLowerCase().replace(/^www\./, ''))
      : []
  );
  const pageConcurrency = (() => {
    if (!concurrencyRow.rows.length) return 3;
    const val = parseInt(concurrencyRow.rows[0].value, 10);
    return Number.isFinite(val) ? Math.min(20, Math.max(1, val)) : 3;
  })();
  const pageDelayMs = (() => {
    if (!delayRow.rows.length) return 2000;
    const val = parseInt(delayRow.rows[0].value, 10);
    return Number.isFinite(val) ? Math.min(10000, Math.max(0, val)) : 2000;
  })();

  if (collectionType !== 'news' && eventsUrl !== 'No dedicated events page') {
    try {
      checkCancellation();
      reportProgress(`Phase I: [Render] Rendering events page: ${eventsUrl}`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Render] Starting events pipeline`, { url: eventsUrl });
      updateProgress(poi.id, {
        phase: 'classify',
        message: 'Analyzing events pages...',
        steps: ['Initialized', 'Classifying events pages']
      });
      const crawlResult = await crawlPage(pool, eventsUrl, 'event', poi, sheets, checkCancellation, { phase: 'Phase I', jobId, jobType });

      const pages = crawlResult.pages;

      reportProgress(`Phase I: [Classify] ${pages.length} event pages found (${crawlResult.totalPagesRendered} rendered)`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Classify] ${pages.length} event pages (${crawlResult.totalPagesRendered} rendered)`);

      const freshEventPages = await filterKnownPages(pool, pages, 'event',
        { jobId, jobType, poiId: poi.id, poiName: poi.name, phase: 'Phase I' });
      const eventResults = await runConcurrent(freshEventPages.map(page => () => {
        checkCancellation();
        return processPage(pool, page, poi, 'event', { phase: 'Phase I', jobId, jobType, timezone });
      }), pageConcurrency, pageDelayMs);
      for (const items of eventResults) {
        if (items && !(items instanceof Error)) allEvents.push(...(items.events || []));
      }
    } catch (err) {
      if (err.message === 'Collection cancelled by user') throw err;
      reportProgress(`Phase I: Events crawl failed: ${err.message}`);
      logWarn(jobId, jobType, poi.id, poi.name, `Phase I: Events classification failed: ${err.message}`);
    }
  }

  if (collectionType !== 'events' && newsUrl !== 'No dedicated news page') {
    try {
      checkCancellation();
      reportProgress(`Phase I: [Render] Rendering news page: ${newsUrl}`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Render] Starting news pipeline`, { url: newsUrl });
      updateProgress(poi.id, {
        phase: 'classify',
        message: 'Analyzing news pages...',
        steps: ['Initialized', 'Classifying news pages']
      });
      const crawlResult = await crawlPage(pool, newsUrl, 'news', poi, sheets, checkCancellation, { phase: 'Phase I', jobId, jobType });

      const pages = crawlResult.pages;

      if (pages.length > 0) usedDedicatedNewsUrl = true;

      reportProgress(`Phase I: [Classify] ${pages.length} news pages found (${crawlResult.totalPagesRendered} rendered)`);
      logInfo(jobId, jobType, poi.id, poi.name, `Phase I: [Classify] ${pages.length} news pages (${crawlResult.totalPagesRendered} rendered)`);

      const freshNewsPages = await filterKnownPages(pool, pages, 'news',
        { jobId, jobType, poiId: poi.id, poiName: poi.name, phase: 'Phase I' });
      const newsResults = await runConcurrent(freshNewsPages.map(page => () => {
        checkCancellation();
        return processPage(pool, page, poi, 'news', { phase: 'Phase I', jobId, jobType, timezone });
      }), pageConcurrency, pageDelayMs);
      for (const items of newsResults) {
        if (items && !(items instanceof Error)) allNews.push(...(items.news || []));
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

    const searchUrlsResult = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'max_search_urls'"
    );
    const MAX_SEARCH_URLS = (() => {
      if (!searchUrlsResult.rows.length) return 10;
      const val = parseInt(searchUrlsResult.rows[0].value, 10);
      return Number.isFinite(val) ? Math.min(20, Math.max(1, val)) : 10;
    })();

    if (collectionType !== 'events') {
      try {
        updateProgress(poi.id, {
          phase: 'search',
          message: 'Searching for external news coverage...',
          steps: ['Initialized', 'Phase I complete', 'Searching external news']
        });

        reportProgress('Phase II: [Search] Querying Serper for external coverage');
        logInfo(jobId, jobType, poi.id, poi.name, 'Phase II: [Search] Querying Serper for external coverage');

        const serperResult = await searchNewsUrls(pool, poi, { contentType: 'news' });
        logInfo(jobId, jobType, poi.id, poi.name, `Phase II: [Search] "${serperResult.query}" → ${serperResult.urls.length} URLs (grounded: ${serperResult.grounded})`);
        reportProgress(`Phase II: [Search] ${serperResult.urls.length} URLs (query: "${serperResult.query}")`);

        if (serperResult.urls.length > 0) {
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
              if (getDomainReputation(urlData.url, new Set(), blocklistSet) === 'blocklisted') {
                logInfo(jobId, jobType, poi.id, poi.name, `Phase II: [Blocklist] Skip: ${urlData.url}`);
                return false;
              }
              return true;
            } catch { return false; }
          });

          const urlsToProcessRaw = externalUrls.slice(0, MAX_SEARCH_URLS);
          if (externalUrls.length > MAX_SEARCH_URLS) {
            logInfo(jobId, jobType, poi.id, poi.name, `Phase II: Capped at ${MAX_SEARCH_URLS} URLs (${externalUrls.length} external of ${serperResult.urls.length} total)`);
          }

          const urlsToProcess = await filterKnownPages(pool, urlsToProcessRaw, 'news',
            { jobId, jobType, poiId: poi.id, poiName: poi.name, phase: 'Phase II' });

          let renderedCount = 0;
          let phase2PagesCollected = 0;

          const phase2Results = await runConcurrent(urlsToProcess.map(urlData => async () => {
            checkCancellation();
            if (phase2PagesCollected >= MAX_PHASE2_PAGES) return [];

            reportProgress(`Phase II: [Classify] ${urlData.url}`);
            const crawlResult = await crawlPage(pool, urlData.url, 'news', poi, sheets, checkCancellation, {
              maxDepth: 1,
              maxPages: 6,
              maxDetailPages: Math.min(5, MAX_PHASE2_PAGES - phase2PagesCollected),
              phase: 'Phase II',
              jobId,
              jobType
            });

            renderedCount++;
            const freshPages = await filterKnownPages(pool, crawlResult.pages, 'news',
              { jobId, jobType, poiId: poi.id, poiName: poi.name, phase: 'Phase II' });
            const pageItems = [];
            for (const page of freshPages) {
              checkCancellation();
              if (phase2PagesCollected >= MAX_PHASE2_PAGES) break;
              const items = await processPage(pool, page, poi, 'news', { phase: 'Phase II', jobId, jobType: 'collectionPhaseTwo', timezone });
              pageItems.push(...(items.news || []));
              phase2PagesCollected++;
            }
            return pageItems;
          }), pageConcurrency, pageDelayMs);

          for (const itemsOrError of phase2Results) {
            if (!itemsOrError || itemsOrError instanceof Error) continue;
            const newNews = itemsOrError.filter(item => {
              const norm = normalizeTitle(item.title);
              return !allNews.some(n => normalizeTitle(n.title) === norm);
            });
            if (newNews.length > 0) {
              logInfo(jobId, jobType, poi.id, poi.name, `Phase II: Adding ${newNews.length} unique items`);
              allNews.push(...newNews);
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

    if (collectionType !== 'news') {
      try {
        updateProgress(poi.id, {
          phase: 'search',
          message: 'Searching for external events coverage...',
          steps: ['Initialized', 'Phase I complete', 'Searching external events']
        });

        reportProgress('Phase II: [Search] Querying Serper for external events');
        logInfo(jobId, jobType, poi.id, poi.name, 'Phase II: [Search] Querying Serper for external events');

        const serperEventsResult = await searchNewsUrls(pool, poi, { contentType: 'events' });
        logInfo(jobId, jobType, poi.id, poi.name, `Phase II: [Search] "${serperEventsResult.query}" → ${serperEventsResult.urls.length} URLs (grounded: ${serperEventsResult.grounded})`);
        reportProgress(`Phase II: [Search] ${serperEventsResult.urls.length} event URLs (query: "${serperEventsResult.query}")`);

        if (serperEventsResult.urls.length > 0) {
          const poiOrigins = new Set();
          for (const u of [website, eventsUrl, newsUrl]) {
            try { poiOrigins.add(new URL(u).origin); } catch { /* skip invalid */ }
          }
          const externalEventUrls = serperEventsResult.urls.filter(urlData => {
            try {
              const origin = new URL(urlData.url).origin;
              if (poiOrigins.has(origin)) {
                logInfo(jobId, jobType, poi.id, poi.name, `Phase II Events: Skip same-origin URL: ${urlData.url}`);
                return false;
              }
              if (getDomainReputation(urlData.url, new Set(), blocklistSet) === 'blocklisted') {
                logInfo(jobId, jobType, poi.id, poi.name, `Phase II Events: [Blocklist] Skip: ${urlData.url}`);
                return false;
              }
              return true;
            } catch { return false; }
          });

          const eventUrlsToProcessRaw = externalEventUrls.slice(0, MAX_SEARCH_URLS);

          const eventUrlsToProcess = await filterKnownPages(pool, eventUrlsToProcessRaw, 'event',
            { jobId, jobType, poiId: poi.id, poiName: poi.name, phase: 'Phase II Events' });

          let renderedEventCount = 0;
          let phase2EventPagesCollected = 0;

          const phase2EventResults = await runConcurrent(eventUrlsToProcess.map(urlData => async () => {
            checkCancellation();
            if (phase2EventPagesCollected >= MAX_PHASE2_PAGES) return [];

            reportProgress(`Phase II Events: [Classify] ${urlData.url}`);
            const crawlResult = await crawlPage(pool, urlData.url, 'event', poi, sheets, checkCancellation, {
              maxDepth: 1,
              maxPages: 6,
              maxDetailPages: Math.min(5, MAX_PHASE2_PAGES - phase2EventPagesCollected),
              phase: 'Phase II Events',
              jobId,
              jobType
            });

            renderedEventCount++;
            const freshEventPages = await filterKnownPages(pool, crawlResult.pages, 'event',
              { jobId, jobType, poiId: poi.id, poiName: poi.name, phase: 'Phase II Events' });
            const pageItems = [];
            for (const page of freshEventPages) {
              checkCancellation();
              if (phase2EventPagesCollected >= MAX_PHASE2_PAGES) break;
              const items = await processPage(pool, page, poi, 'event', { phase: 'Phase II Events', jobId, jobType: 'collectionPhaseTwo', timezone });
              pageItems.push(...(items.events || []));
              phase2EventPagesCollected++;
            }
            return pageItems;
          }), pageConcurrency, pageDelayMs);

          for (const itemsOrError of phase2EventResults) {
            if (!itemsOrError || itemsOrError instanceof Error) continue;
            const newEvents = itemsOrError.filter(item => {
              const titleLower = item.title.toLowerCase().trim();
              return !allEvents.some(e => e.title.toLowerCase().trim() === titleLower);
            });
            if (newEvents.length > 0) {
              logInfo(jobId, jobType, poi.id, poi.name, `Phase II Events: Adding ${newEvents.length} unique items`);
              allEvents.push(...newEvents);
            }
          }

          reportProgress(`Phase II Events: Processed ${renderedEventCount} Serper URLs, ${phase2EventPagesCollected} pages collected`);
          logInfo(jobId, jobType, poi.id, poi.name, `Phase II Events: Processed ${renderedEventCount} of ${serperEventsResult.urls.length} Serper URLs, ${phase2EventPagesCollected} pages collected`);
        } else {
          logInfo(jobId, jobType, poi.id, poi.name, 'Phase II Events: [Search] No external event URLs found');
        }
      } catch (serperError) {
        if (serperError.message === 'Collection cancelled by user') throw serperError;
        logWarn(jobId, jobType, poi.id, poi.name, `Phase II Events: Search failed: ${serperError.message}`);
      }
    }

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


async function resolveRedirectUrl(url) {
  if (!url || url === 'N/A') return null;

  const isRedirect = url.includes('grounding-api-redirect') ||
                     url.includes('redirect') ||
                     url.includes('vertexaisearch.cloud.google.com');

  if (!isRedirect) {
    return url; // Not a redirect, return direct URL as-is
  }

  try {
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

    console.log(`[Search] ✗ No redirect found for: ${url.substring(0, 60)}...`);
    return null; // Don't save broken redirects
  } catch (error) {
    console.log(`[Search] ✗ Failed to resolve: ${url.substring(0, 50)}... (${error.message})`);
    return null; // Don't save broken redirects
  }
}

export function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/^the\s+/i, '').trim();
}

const SQL_NORMALIZE_TITLE = `TRIM(LOWER(REGEXP_REPLACE(title, '^[Tt]he\\s+', '')))`;

function normalizeNewsTitle(title) {
  if (!title) return '';

  return title
    .replace(/\s*\|\s*\d{4}-\d{2}-\d{2}\s*$/i, '')  // Remove "| 2026-01-30"
    .replace(/\s*\|\s*[A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?\s*$/i, '')  // Remove "| January 30" or "| May 9, 2025"
    .trim();
}

function normalizeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    let normalized = parsed.origin + parsed.pathname.replace(/\/+$/, '') + parsed.search;
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

export async function saveNewsItems(pool, poiId, newsItems, options = {}) {
  let savedCount = 0;
  let duplicateCount = 0;
  const { log = null, domainOwnershipMap = null } = options;

  for (const item of newsItems) {
    try {
      if (item.published_date && item.published_date.includes('T')) {
        const normalized = parseDateTime(item.published_date, 'America/New_York');
        item.published_date = normalized ? normalized + 'Z' : null;
      } else {
        const d = parseDate(item.published_date);
        const noon = d ? parseDateTime(d + 'T12:00:00', 'America/New_York') : null;
        item.published_date = noon ? noon + 'Z' : null;
      }

      const resolvedUrl = item.source_url ? await resolveRedirectUrl(item.source_url) : null;

      const isRedirectUrl = item.source_url && (
        item.source_url.includes('grounding-api-redirect') ||
        item.source_url.includes('vertexaisearch.cloud.google.com')
      );

      if (isRedirectUrl && !resolvedUrl) {
        if (log) log(`[Save] Skip bad redirect: "${item.title}" (${item.source_url})`);
        continue;
      }

      let effectivePoiId = poiId;
      const domainOwner = checkDomainOwnership(resolvedUrl || item.source_url, poiId, domainOwnershipMap);
      if (domainOwner) {
        effectivePoiId = domainOwner.poiId;
        if (log) log(`[Save] Reassigning "${item.title}" → ${domainOwner.poiName} (domain ownership)`);
      }

      const normalizedTitle = normalizeNewsTitle(item.title);

      const normalizedUrl = normalizeUrl(resolvedUrl);
      const normalizedTitleNoArticle = normalizeTitle(item.title);
      const existing = await pool.query(
        `SELECT id, title, source_url, poi_id FROM poi_news
         WHERE (
           ($1::text IS NOT NULL AND LOWER(REGEXP_REPLACE(source_url, '/+$', '')) = $1::text)
           OR (poi_id = $2 AND ${SQL_NORMALIZE_TITLE} = $3)
           OR (poi_id = $2 AND TRIM(LOWER(REGEXP_REPLACE(REGEXP_REPLACE(title, '\\s*\\|\\s*(\\d{4}-\\d{2}-\\d{2}|[A-Z][a-z]+\\s+\\d{1,2}(,\\s*\\d{4})?)\\s*$', '', 'i'), '^[Tt]he\\s+', ''))) = $4)
         )`,
        [normalizedUrl, effectivePoiId, normalizedTitleNoArticle, normalizeTitle(normalizedTitle)]
      );

      if (existing.rows.length > 0) {
        const match = existing.rows[0];
        const matchedUrl = normalizeUrl(match.source_url);
        if (matchedUrl === normalizedUrl) {
          duplicateCount++;
          if (log) log(`[Save] Skip duplicate (same URL): "${item.title}" — matches existing #${match.id}`);
          continue;
        }
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

      const dateScore = item.date_consensus_score || 0;
      await pool.query(`
        INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, publication_date, date_consensus_score, moderation_status, rendered_content, date_signals)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        effectivePoiId,
        item.title,
        item.summary,
        resolvedUrl,
        item.source_name,
        item.news_type || 'general',
        item.published_date || null,
        dateScore,
        'pending',
        item.rendered_content || null,
        item.date_signals ? JSON.stringify(item.date_signals) : null
      ]);
      savedCount++;
      if (log) log(`[Save] Saved (pending): "${item.title}" (${item.published_date || 'no date'}, score=${dateScore}) → ${resolvedUrl}`);
    } catch (error) {
      if (log) log(`[Save] Error: "${item.title}" — ${error.message}`);
      console.error(`Error saving news item for POI ${poiId}:`, error.message);
    }
  }

  return savedCount;
}

export async function saveEventItems(pool, poiId, eventItems, options = {}) {
  let savedCount = 0;
  let duplicateCount = 0;
  const { log = null, domainOwnershipMap = null } = options;

  for (const item of eventItems) {
    try {
      const noonEastern = (raw) => {
        const d = parseDate(raw);
        if (!d) return null;
        const utc = parseDateTime(d + 'T12:00:00', 'America/New_York');
        return utc ? utc + 'Z' : null;
      };
      const formatForDb = (val) => {
        if (!val) return null;
        if (/[Zz]$/.test(val) || /[+-]\d{2}(:\d{2})?$/.test(val)) return val;
        if (val.includes('T')) return val + 'Z';  // bare UTC from scoring pipeline
        return noonEastern(val);                   // date-only fallback
      };
      item.start_date = formatForDb(item.start_date) || item.start_date;
      item.end_date = formatForDb(item.end_date) || null;

      if (item.start_date && !item.end_date && item.start_date.includes('T')) {
        const startMs = new Date(item.start_date).getTime();
        if (!isNaN(startMs)) {
          const endDate = new Date(startMs + 60 * 60 * 1000);
          const pad = (n) => String(n).padStart(2, '0');
          item.end_date = `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}T${pad(endDate.getUTCHours())}:${pad(endDate.getUTCMinutes())}:${pad(endDate.getUTCSeconds())}`;
        }
      }

      const resolvedUrl = item.source_url ? await resolveRedirectUrl(item.source_url) : null;

      const isRedirectUrl = item.source_url && (
        item.source_url.includes('grounding-api-redirect') ||
        item.source_url.includes('vertexaisearch.cloud.google.com')
      );

      if (isRedirectUrl && !resolvedUrl) {
        if (log) log(`[Save] Skip bad redirect: "${item.title}" (${item.source_url})`);
        continue;
      }

      let effectivePoiId = poiId;
      const domainOwner = checkDomainOwnership(resolvedUrl || item.source_url, poiId, domainOwnershipMap);
      if (domainOwner) {
        effectivePoiId = domainOwner.poiId;
        if (log) log(`[Save] Reassigning event "${item.title}" → ${domainOwner.poiName} (domain ownership)`);
      }

      const normalizedEventUrl = normalizeUrl(resolvedUrl);
      const normalizedEventTitle = normalizeTitle(item.title);
      const existing = await pool.query(
        `SELECT id, title, source_url, poi_id FROM poi_events
         WHERE (
           ($1::text IS NOT NULL AND LOWER(REGEXP_REPLACE(source_url, '/+$', '')) = $1::text)
           OR (poi_id = $2 AND ${SQL_NORMALIZE_TITLE} = $3 AND start_date = $4)
         )`,
        [normalizedEventUrl, effectivePoiId, normalizedEventTitle, item.start_date]
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

      if (!item.start_date) {
        if (log) log(`[Save] Skip event "${item.title}" — no start_date`);
        duplicateCount++;
        continue;
      }

      const dateScore = item.date_consensus_score || 0;
      await pool.query(`
        INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url, publication_date, date_consensus_score, moderation_status, rendered_content, date_signals)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        effectivePoiId,
        item.title,
        item.description,
        item.start_date,
        item.end_date || null,
        item.event_type,
        item.location_details,
        resolvedUrl,
        item.start_date || null,
        dateScore,
        'pending',
        item.rendered_content || null,
        item.date_signals ? JSON.stringify(item.date_signals) : null
      ]);
      savedCount++;
      if (log) log(`[Save] Saved event (pending): "${item.title}" (${item.start_date}, score=${dateScore}) → ${resolvedUrl}`);
    } catch (error) {
      if (log) log(`[Save] Error: "${item.title}" — ${error.message}`);
      console.error(`Error saving event for POI ${poiId}:`, error.message);
    }
  }

  return savedCount;
}

async function processPoiBatch(pool, pois, sheets, dispatchInterval = DISPATCH_INTERVAL_MS, timezone = 'America/New_York') {
  let newsFound = 0;
  let eventsFound = 0;
  let processed = 0;
  const results = [];

  const domainOwnershipMap = await buildDomainOwnershipMap(pool);

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
      const { news, events, metadata } = await collectPoi(pool, poi, sheets, timezone);
      const savedNews = await saveNewsItems(pool, poi.id, news, { domainOwnershipMap });
      const savedEvents = await saveEventItems(pool, poi.id, events, { domainOwnershipMap });
      console.log(`[${index + 1}/${pois.length}] ✓ ${poi.name}: ${savedNews} news, ${savedEvents} events`);
      results.push({ newsFound: savedNews, eventsFound: savedEvents, success: true, poiName: poi.name });
    } catch (error) {
      console.error(`[${index + 1}/${pois.length}] ✗ ${poi.name}: ${error.message}`);
      results.push({ newsFound: 0, eventsFound: 0, success: false, poiName: poi.name });
    }

    inFlight--;
    if (nextIndex < pois.length && inFlight < MAX_CONCURRENCY) {
      setTimeout(() => processNext(), dispatchInterval);
    } else if (nextIndex >= pois.length && inFlight === 0) {
      resolveAll();
    }
  };

  const initialBatch = Math.min(MAX_CONCURRENCY, pois.length);
  for (let i = 0; i < initialBatch; i++) {
    setTimeout(() => processNext(), i * dispatchInterval);
  }

  await allDone;

  for (const poiOutcome of results) {
    newsFound += poiOutcome.newsFound;
    eventsFound += poiOutcome.eventsFound;
    processed++;
  }

  return { newsFound, eventsFound, processed };
}

export async function createNewsCollectionJob(pool, poiIds, source = 'batch') {
  const startTime = new Date();

  const poisResult = await pool.query(
    'SELECT id FROM pois WHERE id = ANY($1) AND (deleted IS NULL OR deleted = FALSE)',
    [poiIds]
  );
  const validPoiIds = poisResult.rows.map(r => r.id);
  const totalPois = validPoiIds.length;

  if (totalPois === 0) {
    throw new Error('No valid POIs to process');
  }

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

export async function processNewsCollectionJob(pool, sheets, pgBossJobId, jobData) {
  const { jobId } = jobData;

  const jobResult = await pool.query('SELECT * FROM news_job_status WHERE id = $1', [jobId]);
  if (jobResult.rows.length === 0) {
    throw new Error(`Job ${jobId} not found`);
  }

  const job = jobResult.rows[0];

  let allPoiIds = job.poi_ids;
  let processedPoiIds = job.processed_poi_ids || [];
  let circuitBreakerRetries = job.circuit_breaker_retries || {};

  if (typeof allPoiIds === 'string') {
    allPoiIds = JSON.parse(allPoiIds);
  }
  if (typeof processedPoiIds === 'string') {
    processedPoiIds = JSON.parse(processedPoiIds);
  }
  if (typeof circuitBreakerRetries === 'string') {
    circuitBreakerRetries = JSON.parse(circuitBreakerRetries);
  }

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

  await pool.query(`
    UPDATE news_job_status
    SET status = 'running', pg_boss_job_id = $1
    WHERE id = $2
  `, [pgBossJobId, jobId]);

  resetJobUsage();

  logInfo(jobId, 'news', null, null, `Job started: ${remainingPoiIds.length} POIs remaining`, { total: allPoiIds.length, already_done: processedPoiIds.length });

  const poisResult = await pool.query(
    'SELECT id, name, poi_roles, primary_activities, more_info_link, events_url, news_url FROM pois WHERE id = ANY($1)',
    [remainingPoiIds]
  );
  const pois = poisResult.rows;

  const domainOwnershipMap = await buildDomainOwnershipMap(pool);

  let newsFound = job.news_found || 0;
  let eventsFound = job.events_found || 0;
  let processed = processedPoiIds.length;
  const newlyProcessedIds = [...processedPoiIds];

  const concurrencyResult = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'max_concurrency'"
  );
  const maxConcurrency = (() => {
    if (!concurrencyResult.rows.length) return MAX_CONCURRENCY;
    const val = parseInt(concurrencyResult.rows[0].value, 10);
    return Number.isFinite(val) ? Math.min(50, Math.max(1, val)) : MAX_CONCURRENCY;
  })();

  initializeSlots(jobId, maxConcurrency);

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
        const statusRows = await pool.query(
          'SELECT status FROM news_job_status WHERE id = $1',
          [jobId]
        );
        return statusRows.rows[0]?.status === 'cancelled';
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
        const { news, events, metadata } = await collectPoi(pool, poi, sheets, 'America/New_York');
        tracker.updateProgress(poi.id, { phase: 'save', message: `${news.length} news, ${events.length} events` });
        const saveLog = (msg) => { logInfo(jobId, 'news', poi.id, poi.name, msg); };
        const savedNews = await saveNewsItems(pool, poi.id, news, { log: saveLog, domainOwnershipMap });
        const savedEvents = await saveEventItems(pool, poi.id, events, { log: saveLog, domainOwnershipMap });
        logInfo(jobId, 'news', poi.id, poi.name, `[${index + 1}/${total}] ${savedNews} news, ${savedEvents} events saved`, { news_found: news.length, events_found: events.length, news_saved: savedNews, events_saved: savedEvents });

        await pool.query(`
          UPDATE pois SET last_news_collection = CURRENT_TIMESTAMP WHERE id = $1
        `, [poi.id]);

        return { savedNews, savedEvents, news, events };
      },

      checkpointFn: async (poi, poiOutcome, error) => {
        const MAX_CB_RETRIES = 3;
        if (error && error.name === 'BrowserOverloadError') {
          const retryCount = (circuitBreakerRetries[poi.id] || 0) + 1;
          circuitBreakerRetries[poi.id] = retryCount;
          if (retryCount >= MAX_CB_RETRIES) {
            logWarn(jobId, jobType, poi.id, poi.name, `Circuit breaker retry cap reached (${retryCount}/${MAX_CB_RETRIES}) — giving up`);
            newlyProcessedIds.push(poi.id);
            processed++;
          } else {
            logWarn(jobId, jobType, poi.id, poi.name, `Circuit breaker tripped (${retryCount}/${MAX_CB_RETRIES}) — will retry on resume`);
          }
          await pool.query(`
            UPDATE news_job_status
            SET pois_processed = $1, processed_poi_ids = $2, circuit_breaker_retries = $3
            WHERE id = $4
          `, [processed, JSON.stringify(newlyProcessedIds), JSON.stringify(circuitBreakerRetries), jobId]);
          return;
        }

        processed++;
        newlyProcessedIds.push(poi.id);

        if (poiOutcome) {
          newsFound += poiOutcome.savedNews;
          eventsFound += poiOutcome.savedEvents;
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

    const usage = getJobUsage();
    logInfo(jobId, 'news', null, null, `AI provider usage: Gemini=${usage.gemini}`, { gemini_calls: usage.gemini });

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

export async function runBatchNewsCollection(pool, poiIds, sheets = null, source = 'batch') {
  const { jobId, totalPois, poiIds: validPoiIds } = await createNewsCollectionJob(pool, poiIds, source);

  setImmediate(async () => {
    try {
      await processNewsCollectionJob(pool, sheets, `legacy-${jobId}`, { jobId });
    } catch (error) {
      logError(jobId, 'news', null, null, `Background processing failed: ${error.message}`);
    }
  });

  return { jobId, totalPois };
}

function extractDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export async function buildDomainOwnershipMap(pool) {
  const urlOwners = await pool.query(
    `SELECT id, name, news_url, events_url FROM pois
     WHERE (news_url IS NOT NULL OR events_url IS NOT NULL) AND deleted = false`
  );
  const map = new Map();
  for (const row of urlOwners.rows) {
    for (const url of [row.news_url, row.events_url]) {
      const domain = extractDomain(url);
      if (domain) {
        map.set(domain, { poiId: row.id, poiName: row.name });
      }
    }
  }
  return map;
}

function checkDomainOwnership(sourceUrl, currentPoiId, domainMap) {
  if (!sourceUrl || !domainMap) return null;
  const domain = extractDomain(sourceUrl);
  if (!domain) return null;
  const owner = domainMap.get(domain);
  if (owner && owner.poiId !== currentPoiId) return owner;
  return null;
}

export async function getAllPoisForCollection(pool) {
  const settingResult = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'news_collection_excluded_pois'"
  );
  let excludedIds = [];
  if (settingResult.rows.length > 0 && settingResult.rows[0].value) {
    try {
      const parsed = JSON.parse(settingResult.rows[0].value);
      excludedIds = Array.isArray(parsed) ? parsed.filter(id => Number.isInteger(id)) : [];
    } catch (e) {
      console.error('[newsService] Failed to parse news_collection_excluded_pois:', e.message);
    }
  }

  const collectionPoiRows = await pool.query(
    `SELECT id FROM pois
     WHERE (deleted IS NULL OR deleted = FALSE)
       AND poi_roles && ARRAY['point','organization','river']::text[]
       ${excludedIds.length > 0 ? 'AND id != ALL($1)' : ''}
     ORDER BY
       CASE
         WHEN 'point' = ANY(poi_roles) THEN 1
         WHEN 'organization' = ANY(poi_roles) THEN 2
         ELSE 3
       END,
       name`,
    excludedIds.length > 0 ? [excludedIds] : []
  );
  return collectionPoiRows.rows.map(r => r.id);
}

export async function getPoisForTierCollection(pool, tier) {
  const settingResult = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'news_collection_excluded_pois'"
  );
  let excludedIds = [];
  if (settingResult.rows.length > 0 && settingResult.rows[0].value) {
    try {
      const parsed = JSON.parse(settingResult.rows[0].value);
      excludedIds = Array.isArray(parsed) ? parsed.filter(id => Number.isInteger(id)) : [];
    } catch (e) {
      console.error('[newsService] Failed to parse news_collection_excluded_pois:', e.message);
    }
  }

  const validTiers = ['daily', 'weekly', 'monthly'];
  if (!validTiers.includes(tier)) {
    throw new Error(`Invalid collection tier: ${tier}`);
  }

  const params = [tier];
  let paramIdx = 2;
  let excludeClause = '';
  if (excludedIds.length > 0) {
    excludeClause = `AND id != ALL($${paramIdx})`;
    params.push(excludedIds);
  }

  const tierPoiRows = await pool.query(
    `SELECT id FROM pois
     WHERE (deleted IS NULL OR deleted = FALSE)
       AND poi_roles && ARRAY['point','organization','river']::text[]
       AND collection_tier = $1
       ${excludeClause}
     ORDER BY
       CASE
         WHEN 'point' = ANY(poi_roles) THEN 1
         WHEN 'organization' = ANY(poi_roles) THEN 2
         ELSE 3
       END,
       name`,
    params
  );
  return tierPoiRows.rows.map(r => r.id);
}

export async function runTierNewsCollection(pool, tier, sheets = null) {
  const poiIds = await getPoisForTierCollection(pool, tier);

  if (poiIds.length === 0) {
    const runId = Math.floor(Date.now() / 1000);
    logInfo(runId, 'news', null, null, `No POIs to collect for ${tier} tier`);
    return { jobId: null, totalPois: 0, message: `No POIs to collect for ${tier} tier` };
  }

  const runId = Math.floor(Date.now() / 1000);
  logInfo(runId, 'news', null, null, `Starting ${tier} news collection for ${poiIds.length} POIs`);
  return runBatchNewsCollection(pool, poiIds, sheets, `scheduled-${tier}`);
}

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

export async function getJobStatus(pool, jobId) {
  const jobStatusRows = await pool.query(
    'SELECT * FROM news_job_status WHERE id = $1',
    [jobId]
  );
  return jobStatusRows.rows[0] || null;
}

export async function getNewsForPoi(pool, poiId, limit = 10) {
  const newsRows = await pool.query(`
    SELECT id, title, summary, source_url, source_name, news_type, publication_date, collection_date
    FROM poi_news
    WHERE poi_id = $1
      AND moderation_status IN ('published', 'auto_approved')
    ORDER BY COALESCE(publication_date, collection_date) DESC
    LIMIT $2
  `, [poiId, limit]);

  return newsRows.rows;
}

export async function getEventsForPoi(pool, poiId, upcomingOnly = true, tz = 'America/New_York') {
  let query = `
    SELECT id, title, description, start_date, end_date, event_type, location_details, source_url, collection_date
    FROM poi_events
    WHERE poi_id = $1
      AND moderation_status IN ('published', 'auto_approved')
  `;

  if (upcomingOnly) {
    query += ` AND (start_date AT TIME ZONE $2)::date >= (CURRENT_TIMESTAMP AT TIME ZONE $2)::date`;
  }

  query += ` ORDER BY start_date ASC`;

  const eventRows = await pool.query(query, upcomingOnly ? [poiId, tz] : [poiId]);
  return eventRows.rows;
}

export async function getRecentNews(pool, limit = 20) {
  const recentNewsRows = await pool.query(`
    SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
           n.publication_date, n.collection_date, p.id as poi_id, p.name as poi_name, p.poi_roles
    FROM poi_news n
    JOIN pois p ON n.poi_id = p.id
    WHERE n.moderation_status IN ('published', 'auto_approved')
    ORDER BY COALESCE(n.publication_date, n.collection_date) DESC
    LIMIT $1
  `, [limit]);

  return recentNewsRows.rows;
}

export async function getUpcomingEvents(pool, daysAhead = 30, tz = 'America/New_York') {
  const upcomingEventRows = await pool.query(`
    SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
           e.location_details, e.source_url, p.id as poi_id, p.name as poi_name, p.poi_roles
    FROM poi_events e
    JOIN pois p ON e.poi_id = p.id
    WHERE (e.start_date AT TIME ZONE $2)::date >= (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
      AND (e.start_date AT TIME ZONE $2)::date <= (CURRENT_TIMESTAMP AT TIME ZONE $2)::date + $1
      AND e.moderation_status IN ('published', 'auto_approved')
    ORDER BY e.start_date ASC
  `, [daysAhead, tz]);

  return upcomingEventRows.rows;
}

export async function getLatestJobStatus(pool) {
  const latestJobRows = await pool.query(`
    SELECT * FROM news_job_status
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return latestJobRows.rows[0] || null;
}

export async function cleanupOldNews(pool, daysOld = 90) {
  const runId = Math.floor(Date.now() / 1000);
  const deleteOutcome = await pool.query(`
    DELETE FROM poi_news
    WHERE collection_date < CURRENT_DATE - INTERVAL '1 day' * $1
  `, [daysOld]);

  logInfo(runId, 'cleanup', null, null, `Cleanup: deleted ${deleteOutcome.rowCount} news older than ${daysOld} days`, { completed: true, deleted: deleteOutcome.rowCount, type: 'news', days_old: daysOld });
  await flushJobLogs();
  return deleteOutcome.rowCount;
}

export async function cleanupPastEvents(pool, daysOld = 30) {
  const runId = Math.floor(Date.now() / 1000);
  const deleteOutcome = await pool.query(`
    DELETE FROM poi_events
    WHERE end_date < CURRENT_DATE - INTERVAL '1 day' * $1
       OR (end_date IS NULL AND start_date < CURRENT_DATE - INTERVAL '1 day' * $1)
  `, [daysOld]);

  logInfo(runId, 'cleanup', null, null, `Cleanup: deleted ${deleteOutcome.rowCount} events older than ${daysOld} days`, { completed: true, deleted: deleteOutcome.rowCount, type: 'events', days_old: daysOld });
  await flushJobLogs();
  return deleteOutcome.rowCount;
}
