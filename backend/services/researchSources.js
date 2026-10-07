// What POI research reads before it writes (#724): the POI's own reference page
// and the top web results for its name, rendered to text. The research prompts
// in llmService.js may state only what these pages say, so a draft is as good as
// what is gathered here and empty when nothing could be read.
import { searchNewsUrls } from './serperService.js';
import { renderPage } from './renderPage.js';
import { getDomainReputation, isSafePublicUrl } from './moderationService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Research sources');

export const RESEARCH_MAX_SEARCH_PAGES = 4;
export const RESEARCH_PAGE_CHARS = 8000;
// Below this, Readability kept only a fragment and the raw text is the better read
const MIN_MARKDOWN_CHARS = 300;
// Tighter than news collection: an admin is waiting on the editor
const RENDER_OPTIONS = { timeout: 15000, hardTimeout: 25000 };
// Login walls that render as nothing, and an AI-written encyclopedia that would
// put a model's memory back into the draft
const SKIPPED_HOSTS = ['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'grokipedia.com'];

const urlKey = url => {
  const parsed = new URL(url);
  return (parsed.hostname.replace(/^www\./, '') + parsed.pathname).toLowerCase().replace(/\/+$/, '');
};

function skipReason(url, blocklistSet) {
  if (!isSafePublicUrl(url)) return 'not a public web address';
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (SKIPPED_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return 'site cannot be read';
  if (parsed.pathname.toLowerCase().endsWith('.pdf')) return 'PDF';
  if (getDomainReputation(url, new Set(), blocklistSet) === 'blocklisted') return 'blocklisted';
  return null;
}

/**
 * Trim one page's text to the share of the prompt it is allowed.
 * @param {string|null} text rendered page text
 * @param {number} [limit=RESEARCH_PAGE_CHARS] most characters to keep
 * @returns {string} the trimmed text, ending in "[truncated]" when it was cut
 */
export function truncatePageText(text, limit = RESEARCH_PAGE_CHARS) {
  const trimmed = (text || '').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n[truncated]` : trimmed;
}

async function loadBlocklist(pool) {
  const blocklistRow = await pool.query("SELECT value FROM admin_settings WHERE key = 'blocklist_urls'");
  try {
    return new Set(
      JSON.parse(blocklistRow.rows[0]?.value || '[]').map(e => e.toLowerCase().replace(/^www\./, ''))
    );
  } catch (err) {
    logger.warn(`blocklist_urls is not valid JSON, reading pages without it: ${err.message}`);
    return new Set();
  }
}

/**
 * Search for a POI and render the pages research will read.
 * @param {import('pg').Pool} pool
 * @param {object} destination the POI as the editor holds it; name is required,
 *   id grounds the search geographically, more_info_link is read first
 * @returns {Promise<{query: string|null, grounded: boolean, sources: object[],
 *   unreachable: object[], timings: {searchMs: number, renderMs: number}}>}
 *   sources are numbered from 1 in the order the prompt lists them, each with
 *   url, title, text, origin ('reference' or 'search') and cached; unreachable
 *   lists the pages that were tried and why they gave no text
 * @throws when the Serper API key is not configured
 */
export async function gatherResearchSources(pool, destination) {
  const blocklistSet = await loadBlocklist(pool);
  const candidates = [];
  const unreachable = [];
  const seen = new Set();

  const referenceUrl = (destination.more_info_link || '').trim();
  if (referenceUrl) {
    const reason = skipReason(referenceUrl, blocklistSet);
    if (reason) {
      unreachable.push({ url: referenceUrl, reason });
    } else {
      seen.add(urlKey(referenceUrl));
      candidates.push({ url: referenceUrl, title: null, origin: 'reference' });
    }
  }

  let query = null;
  let grounded = false;
  const searchStart = Date.now();
  try {
    const search = await searchNewsUrls(pool, destination, { pipeline: 'research' });
    query = search.query;
    grounded = search.grounded;
    let searchPages = 0;
    for (const hit of search.urls) {
      if (searchPages >= RESEARCH_MAX_SEARCH_PAGES) break;
      if (!hit.url || skipReason(hit.url, blocklistSet)) continue;
      const key = urlKey(hit.url);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ url: hit.url, title: hit.title || null, origin: 'search' });
      searchPages++;
    }
  } catch (err) {
    // A missing key is a setup problem the admin has to see; an outage is not
    if (err.message?.includes('API key')) throw err;
    logger.warn(`Search failed for ${destination.name}, reading the reference page only: ${err.message}`);
  }
  const searchMs = Date.now() - searchStart;

  const renderStart = Date.now();
  const rendered = await Promise.allSettled(
    candidates.map(candidate => renderPage(pool, candidate.url, RENDER_OPTIONS))
  );
  const renderMs = Date.now() - renderStart;

  const sources = [];
  rendered.forEach((outcome, i) => {
    const candidate = candidates[i];
    if (outcome.status === 'rejected') {
      unreachable.push({ url: candidate.url, reason: outcome.reason?.message || 'render failed' });
      return;
    }
    const page = outcome.value || {};
    const markdown = (page.markdown || '').trim();
    const text = truncatePageText(markdown.length >= MIN_MARKDOWN_CHARS ? markdown : (page.rawText || markdown));
    if (page.reachable === false || !text) {
      unreachable.push({ url: candidate.url, reason: page.reason || 'no readable text' });
      return;
    }
    sources.push({
      n: sources.length + 1,
      url: candidate.url,
      title: page.title || candidate.title || candidate.url,
      text,
      origin: candidate.origin,
      cached: !!page.cached
    });
  });

  logger.info(`${destination.name}: read ${sources.length} of ${candidates.length} pages (search ${searchMs}ms, render ${renderMs}ms)`);
  return { query, grounded, sources, unreachable, timings: { searchMs, renderMs } };
}
