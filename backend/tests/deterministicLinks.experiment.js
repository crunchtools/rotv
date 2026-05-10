/**
 * Experiment v2: Deterministic link extraction with noise filters
 *
 * Tests whether deterministic extraction + exclusion patterns can replace
 * Gemini's link selection for event/news crawling.
 *
 * Usage: node backend/tests/deterministicLinks.experiment.js
 */

import pg from 'pg';
const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/rotv';
const pool = new Pool({ connectionString: DB_URL });

// --- Trusted event paths (same defaults as migration 046) ---
const TRUSTED_EVENT_PATHS = ['/event', '/events', '/program', '/programs', 'iteminfo.html', '/store/p'];

// --- NOISE FILTERS: patterns that look like content links but aren't detail pages ---

// Calendar view selectors (The Events Calendar plugin, generic calendar UIs)
const CALENDAR_VIEW_SUFFIXES = ['/list/', '/list', '/month/', '/month', '/today/', '/today',
  '/week/', '/week', '/day/', '/day', '/map/', '/map', '/photo/', '/photo',
  '/summary/', '/summary', '/calendar/', '/calendar'];

function isNoiseLink(url, sourceUrl) {
  let parsed;
  try { parsed = new URL(url); } catch { return true; }

  const path = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();

  // 1. Non-page resources (images, docs, stylesheets)
  if (/\.(png|jpe?g|gif|svg|webp|pdf|css|js|ico|woff2?|mp[34]|zip|ics)$/i.test(path)) return true;

  // 2. Hash-only link (same page anchor)
  try {
    const source = new URL(sourceUrl);
    if (parsed.origin === source.origin && parsed.pathname === source.pathname && parsed.hash) return true;
  } catch { /* ignore */ }

  // 3. Homepage / site root
  if (path === '/' || path === '') return true;

  // 4. Calendar view selectors
  for (const suffix of CALENDAR_VIEW_SUFFIXES) {
    if (path.endsWith(suffix)) return true;
  }

  // 5. Past events / archive views
  if (search.includes('eventdisplay=past') || search.includes('display=past')) return true;

  // 6. iCal / feed exports
  if (search.includes('ical=1') || search.includes('outlook-ical') || path.endsWith('.ics')) return true;

  // 7. Pagination links
  if (/\/page\/\d+\/?$/.test(path)) return true;
  if (/[?&]page=\d+/.test(search)) return true;

  // 8. Common non-content pages (nav chrome)
  const navPatterns = [
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
  // Only match if the path IS one of these (not a subpath like /about/news)
  const pathSegments = path.replace(/\/$/, '').split('/').filter(Boolean);
  if (pathSegments.length <= 1) {
    const simplePath = '/' + (pathSegments[0] || '');
    if (navPatterns.includes(simplePath)) return true;
  }

  // 9. WebTrac-specific nav pages (sibling files that aren't events)
  const filename = path.split('/').pop();
  const webTracNav = ['splash.html', 'contactus.html', 'cart.html', 'login.html',
    'household.html', 'register.html', 'forgotpassword.html', 'wishlist.html'];
  if (webTracNav.includes(filename)) return true;

  // 10. Request/submission forms (not content pages)
  const lastSegment = path.replace(/\/$/, '').split('/').pop() || '';
  if (/\brequest|submit|apply|form\b/i.test(lastSegment)) return true;

  return false;
}

// --- Content link ranking (mirrors classifyPage logic) ---
function rankLinks(links, sourceUrl) {
  let sourcePathname;
  try { sourcePathname = new URL(sourceUrl).pathname; } catch { sourcePathname = ''; }

  const contentLinks = (links || []).filter(l => {
    const text = (l.text || '').toLowerCase();
    if (/read\s*more|continue|full\s*(article|story)|learn\s*more|details/i.test(text)) return true;
    if (/\b(article|post|news|event|card|entry|blog)\b/i.test(l.parentClassName || '')) return true;
    if (/\b(article|post|news|event|card|entry|blog)\b/i.test(l.className || '')) return true;
    try {
      const linkPath = new URL(l.url).pathname;
      if (sourcePathname.length > 1 && linkPath.startsWith(sourcePathname) && linkPath !== sourcePathname && linkPath !== sourcePathname + '/') return true;
    } catch { /* ignore */ }
    // Sibling-file rule
    try {
      const linkPath = new URL(l.url).pathname;
      const sourceDir = sourcePathname.replace(/\/[^/]+\.[^/]+$/, '');
      if (sourceDir && sourceDir !== sourcePathname && linkPath.startsWith(sourceDir + '/') && linkPath !== sourcePathname) return true;
    } catch { /* ignore */ }
    // Trusted event path boost
    try {
      const linkPath = new URL(l.url).pathname;
      if (TRUSTED_EVENT_PATHS.some(p => linkPath.includes(p))) return true;
    } catch { /* ignore */ }
    return false;
  });

  // Self-referencing filter (same pathname = same page with different query params)
  const notSelfRef = l => {
    if (!sourcePathname) return true;
    try { return new URL(l.url).pathname !== sourcePathname; } catch { return true; }
  };

  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter(l => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    });
  };

  const filteredContent = dedup(contentLinks.filter(notSelfRef));
  const seen = new Set(filteredContent.map(l => l.url));
  const otherLinks = dedup(links.filter(l => !seen.has(l.url)).filter(notSelfRef));
  return { contentLinks: filteredContent, otherLinks, all: [...filteredContent, ...otherLinks] };
}

// --- basePath computation ---
function computeBasePath(startUrl) {
  try {
    const parsed = new URL(startUrl);
    let rawPath = parsed.pathname.replace(/\/$/, '') || '/';
    // Only strip filename if result isn't root — /events.html → keep /events.html
    if (/\/[^/]+\.(html?|aspx?|php|jsp|shtml)$/i.test(rawPath)) {
      const dir = rawPath.replace(/\/[^/]+$/, '');
      if (dir && dir !== '/') {
        rawPath = dir;
      }
      // If dir would be "/" or empty, keep the original path as basePath
      // This prevents basePath collapse on root-level files like /events.html
    }
    return rawPath;
  } catch { return null; }
}

// --- filterDetailLinks with noise filter ---
function filterDetailLinks(detailLinks, sourceUrl, basePath, trustedPaths = [], cap = 15) {
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
      // Noise filter — reject known non-detail patterns
      if (isNoiseLink(link, sourceUrl)) return false;
      // basePath + trusted pattern bypass
      if (basePath && !parsed.pathname.startsWith(basePath)) {
        const matchesTrusted = trustedPaths.some(p => parsed.pathname.includes(p));
        if (!matchesTrusted) return false;
      }
      if (seen.has(link)) return false;
      seen.add(link);
      return true;
    } catch { return false; }
  }).slice(0, cap);
}

// --- Shortest-URL dedup ---
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

// --- Main experiment ---
async function run() {
  const poisResult = await pool.query(`
    SELECT id, name, events_url, news_url
    FROM pois
    WHERE (events_url IS NOT NULL AND events_url != 'No dedicated events page')
       OR (news_url IS NOT NULL AND news_url != 'No dedicated news page')
    ORDER BY name
  `);

  const detailCache = await pool.query(`SELECT url FROM rendered_page_cache WHERE page_type = 'detail'`);
  const detailUrlSet = new Set(detailCache.rows.map(r => r.url.toLowerCase().replace(/\/+$/, '')));

  const savedEvents = await pool.query(`SELECT source_url FROM poi_events WHERE source_url IS NOT NULL`);
  const savedUrlSet = new Set(savedEvents.rows.map(r => r.source_url.toLowerCase().replace(/\/+$/, '')));

  const savedNews = await pool.query(`SELECT source_url FROM poi_news WHERE source_url IS NOT NULL`);
  const savedNewsSet = new Set(savedNews.rows.map(r => r.source_url.toLowerCase().replace(/\/+$/, '')));

  const normUrl = u => u.toLowerCase().replace(/\/+$/, '');

  // Aggregate stats
  let totalSelected = 0, totalHits = 0, totalNoise = 0;
  let totalNewsSelected = 0, totalNewsHits = 0;

  console.log(`\n${'='.repeat(100)}`);
  console.log(`EXPERIMENT v2: Deterministic Extraction + Noise Filters`);
  console.log(`${'='.repeat(100)}`);
  console.log(`Detail pages in cache: ${detailUrlSet.size} | Saved events: ${savedUrlSet.size} | Saved news: ${savedNewsSet.size}\n`);

  // ======================== EVENTS ========================
  console.log(`${'─'.repeat(100)}`);
  console.log(`EVENTS`);
  console.log(`${'─'.repeat(100)}`);

  for (const poi of poisResult.rows) {
    const eventsUrl = poi.events_url;
    if (!eventsUrl || eventsUrl === 'No dedicated events page') continue;

    const basePath = computeBasePath(eventsUrl);

    let cacheResult = await pool.query(
      `SELECT url, links, page_type FROM rendered_page_cache
       WHERE url = $1 AND links IS NOT NULL`, [eventsUrl]
    );
    if (cacheResult.rows.length === 0) {
      try {
        const parsed = new URL(eventsUrl);
        const pathPrefix = parsed.origin + parsed.pathname;
        cacheResult = await pool.query(
          `SELECT url, links, page_type FROM rendered_page_cache
           WHERE url LIKE $1 AND page_type = 'listing' AND links IS NOT NULL
           ORDER BY rendered_at DESC LIMIT 1`, [pathPrefix + '%']
        );
      } catch { /* skip */ }
    }
    if (cacheResult.rows.length === 0 || (cacheResult.rows[0].links || []).length === 0) continue;

    const cached = cacheResult.rows[0];
    const links = cached.links;

    const ranked = rankLinks(links, cached.url);
    const allUrls = ranked.all.map(l => l.url);

    // Apply noise filter + basePath + trusted patterns — NO cap yet (dedup first)
    const filtered = filterDetailLinks(allUrls, cached.url, basePath, TRUSTED_EVENT_PATHS, 999);

    // Shortest-URL dedup BEFORE cap — so sub-tab variants don't consume slots
    const dedupedFiltered = shortestUrlDedup(filtered);

    // Now cap at 20
    const final = dedupedFiltered.slice(0, 20);

    const hits = final.filter(u => detailUrlSet.has(normUrl(u)) || savedUrlSet.has(normUrl(u)));

    // Count what the noise filter removed
    const allBeforeNoise = ranked.all.map(l => l.url).filter(u => {
      try { const p = new URL(u); return p.origin === new URL(cached.url).origin; } catch { return false; }
    });
    const noiseRemoved = allBeforeNoise.filter(u => isNoiseLink(u, cached.url));

    totalSelected += final.length;
    totalHits += hits.length;
    totalNoise += noiseRemoved.length;

    const hitRate = final.length > 0 ? Math.round(hits.length / final.length * 100) : 0;

    console.log(`\n  ${poi.name}`);
    console.log(`    URL: ${eventsUrl.substring(0, 80)}${eventsUrl.length > 80 ? '...' : ''}`);
    console.log(`    basePath: ${basePath} | total links: ${links.length} | T1: ${ranked.contentLinks.length} | noise removed: ${noiseRemoved.length}`);
    console.log(`    Selected: ${final.length} | Hits: ${hits.length} | Rate: ${hitRate}%`);

    for (const u of final) {
      const hit = detailUrlSet.has(normUrl(u)) ? '✓cache' : savedUrlSet.has(normUrl(u)) ? '✓saved' : '○ new ';
      const shortUrl = u.length > 85 ? u.substring(0, 82) + '...' : u;
      console.log(`      [${hit}] ${shortUrl}`);
    }
  }

  // ======================== NEWS ========================
  console.log(`\n${'─'.repeat(100)}`);
  console.log(`NEWS`);
  console.log(`${'─'.repeat(100)}`);

  for (const poi of poisResult.rows) {
    const newsUrl = poi.news_url;
    if (!newsUrl || newsUrl === 'No dedicated news page') continue;

    const basePath = computeBasePath(newsUrl);

    let cacheResult = await pool.query(
      `SELECT url, links, page_type FROM rendered_page_cache
       WHERE url = $1 AND links IS NOT NULL`, [newsUrl]
    );
    if (cacheResult.rows.length === 0) {
      try {
        const parsed = new URL(newsUrl);
        const pathPrefix = parsed.origin + parsed.pathname;
        cacheResult = await pool.query(
          `SELECT url, links, page_type FROM rendered_page_cache
           WHERE url LIKE $1 AND page_type = 'listing' AND links IS NOT NULL
           ORDER BY rendered_at DESC LIMIT 1`, [pathPrefix + '%']
        );
      } catch { /* skip */ }
    }
    if (cacheResult.rows.length === 0 || (cacheResult.rows[0].links || []).length === 0) continue;

    const cached = cacheResult.rows[0];
    const links = cached.links;

    const ranked = rankLinks(links, cached.url);
    const allUrls = ranked.all.map(l => l.url);
    // No trusted patterns for news — pure basePath
    const filtered = filterDetailLinks(allUrls, cached.url, basePath, [], 20);
    const hits = filtered.filter(u => detailUrlSet.has(normUrl(u)) || savedNewsSet.has(normUrl(u)));

    const noiseRemoved = ranked.all.map(l => l.url).filter(u => {
      try { const p = new URL(u); return p.origin === new URL(cached.url).origin; } catch { return false; }
    }).filter(u => isNoiseLink(u, cached.url));

    totalNewsSelected += filtered.length;
    totalNewsHits += hits.length;

    const hitRate = filtered.length > 0 ? Math.round(hits.length / filtered.length * 100) : 0;

    console.log(`\n  ${poi.name}`);
    console.log(`    URL: ${newsUrl}`);
    console.log(`    basePath: ${basePath} | total links: ${links.length} | T1: ${ranked.contentLinks.length} | noise removed: ${noiseRemoved.length}`);
    console.log(`    Selected: ${filtered.length} | Hits: ${hits.length} | Rate: ${hitRate}%`);

    for (const u of filtered.slice(0, 8)) {
      const hit = detailUrlSet.has(normUrl(u)) ? '✓cache' : savedNewsSet.has(normUrl(u)) ? '✓saved' : '○ new ';
      const shortUrl = u.length > 85 ? u.substring(0, 82) + '...' : u;
      console.log(`      [${hit}] ${shortUrl}`);
    }
    if (filtered.length > 8) console.log(`      ... and ${filtered.length - 8} more`);
  }

  // ======================== SUMMARY ========================
  console.log(`\n${'='.repeat(100)}`);
  console.log(`SUMMARY`);
  console.log(`${'='.repeat(100)}`);
  console.log(`Events: ${totalSelected} selected, ${totalHits} hits (${totalSelected > 0 ? Math.round(totalHits/totalSelected*100) : 0}%), ${totalNoise} noise links removed`);
  console.log(`News:   ${totalNewsSelected} selected, ${totalNewsHits} hits (${totalNewsSelected > 0 ? Math.round(totalNewsHits/totalNewsSelected*100) : 0}%)`);
  console.log(`${'='.repeat(100)}\n`);

  await pool.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
