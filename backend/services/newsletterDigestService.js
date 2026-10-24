import { sendEmail, sendDraftToRecipients } from './buttondownClient.js';
import { createLogger } from '../utils/logger.js';
import { createMatchContext, dedupeNews, dedupeEvents, urlHost as sourceHost } from './dedup/index.js';
import { loadMatchContext } from './dedup/candidates.js';

export { stripDateline } from './dedup/index.js';

const logger = createLogger('NewsletterDigest');

const DIGEST_EVENT_LIMIT = 15;
const DIGEST_NEWS_LIMIT = 5;
// Fetch headroom so host filtering and dedup still leave DIGEST_NEWS_LIMIT rows.
const DIGEST_NEWS_FETCH_MULTIPLIER = 6;
// Runners-up shown to the editor in the draft: what backfills when an item is cut.
const DIGEST_NEWS_BENCH = 5;
// Local hour of the Friday send (jobScheduler.scheduleDigest, '0 8 * * 5').
const DIGEST_SEND_HOUR = 8;

// Hosts that produce useful POI-page content but not newsletter-worthy news:
// social posts, restaurant listings, and offshore aggregators that reprint
// local stories.
const DIGEST_EXCLUDED_NEWS_HOSTS = [
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'opentable.com',
  'economictimes.com',
  'komoot.com',
  'grokipedia.com'
];

// Host-boundary match so 'x.com' excludes x.com and m.x.com but not phoenix.com.
export function isDigestNewsSource(sourceUrl) {
  const host = sourceHost(sourceUrl);
  // Missing or unparseable URL: let moderation decide, don't silently drop
  if (!host) return true;
  return !DIGEST_EXCLUDED_NEWS_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

// Fallback match context for callers without a pool: the region words plus
// each item's own POI name. The digest itself loads every POI name.
const DEFAULT_MATCH_CONTEXT = createMatchContext();

/**
 * Collapse rows that are one event: the same event on the same day under one
 * organizer or venue, or two organizers' listings at one venue and start time.
 * Input is sorted by start_date ASC, so a real start time wins over a bare-date
 * noon fallback.
 * @param {object[]} events event rows, sorted by start
 * @param {string} [tz] IANA timezone for calendar days
 * @param {ReturnType<typeof createMatchContext>} [ctx] match context
 * @returns {object[]} one row per event, in input order
 */
export function dedupeDigestEvents(events, tz = 'America/New_York', ctx = DEFAULT_MATCH_CONTEXT) {
  return dedupeEvents(events, { ...ctx, tz }).kept;
}

/**
 * One item per story. Input is sorted most-recent-first, so the freshest copy
 * wins, except that a same-outlet copy with a fuller summary replaces it.
 * Matching rules live in services/dedup/.
 * @param {object[]} news news rows, most recent first
 * @param {ReturnType<typeof createMatchContext>} [ctx] match context
 * @returns {object[]} one row per story, in input order
 */
export function dedupeDigestNews(news, ctx = DEFAULT_MATCH_CONTEXT) {
  return withAlsoCoveredBy(dedupeNews(news, ctx), news);
}

// Another outlet's article is a reader's choice (a paywall, a preferred writer),
// so the copies folded into a story are listed under it instead of dropped.
// Same-outlet repeats are not a choice and stay hidden.
const MAX_ALSO_COVERED = 3;

/**
 * The kept stories of a dedup result, each with also_covered_by: up to three
 * other outlets' articles that were folded into it.
 * @param {{kept: object[], collapsed: {id: number, into: number}[]}} result dedupeNews output
 * @param {object[]} rows the rows dedupeNews was given
 * @returns {object[]} kept rows plus also_covered_by: {id, source_name, source_url, source_host}[]
 */
function withAlsoCoveredBy(result, rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  return result.kept.map(story => {
    const hosts = new Set([sourceHost(story.source_url)]);
    const alsoCoveredBy = [];
    for (const { id, into } of result.collapsed) {
      const row = into === story.id ? byId.get(id) : null;
      const host = row && sourceHost(row.source_url);
      if (!host || hosts.has(host) || alsoCoveredBy.length >= MAX_ALSO_COVERED) continue;
      hosts.add(host);
      alsoCoveredBy.push({ id: row.id, source_name: row.source_name || host, source_url: row.source_url, source_host: host });
    }
    return { ...story, also_covered_by: alsoCoveredBy };
  });
}

// Events are usually attached to the organizing POI ("Summit Metro Parks"),
// which says nothing about where to show up. Lead with the collected venue and
// keep the organizer for context, unless the venue already names it.
export function digestEventLocation(event) {
  const venue = (event.location_details || '').trim();
  const poiName = event.poi_name || '';
  if (!venue) return poiName;
  if (!poiName || venue.toLowerCase().includes(poiName.toLowerCase())) return venue;
  return `${venue} · ${poiName}`;
}

// Calendar fields of an instant as read on a wall clock in tz.
function wallClockParts(instant, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(instant).map(part => [part.type, part.value])
  );
  return {
    weekday: parts.weekday,
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute)
  };
}

/**
 * The instant the next digest sends: the coming Friday (today, on a Friday) at
 * the send hour in tz. Previews and the editor's draft are built as of this
 * instant, not "now plus N days", so their 7-day news window is the one the
 * real send will use whatever time of day they are generated. The live send
 * does not call this; it uses the moment it runs.
 *
 * @param {string} [tz] IANA timezone of the send. Default America/New_York.
 * @param {Date} [now] Reference instant. Default: the current time.
 * @returns {string} ISO 8601 UTC timestamp of Friday 08:00 in tz
 */
export function upcomingSendISO(tz = 'America/New_York', now = new Date()) {
  const today = wallClockParts(now, tz);
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const daysAhead = (5 - dayMap[today.weekday] + 7) % 7;
  // The send's wall-clock time, read as if tz were UTC. Correct it by tz's
  // offset at that moment, which is within hours of the real instant.
  const asIfUtc = Date.UTC(today.year, today.month - 1, today.day + daysAhead, DIGEST_SEND_HOUR);
  const there = wallClockParts(new Date(asIfUtc), tz);
  const offsetMs = Date.UTC(there.year, there.month - 1, there.day, there.hour, there.minute) - asIfUtc;
  return new Date(asIfUtc - offsetMs).toISOString();
}

async function generateDigest(pool, tz = 'America/New_York', asOfDate = null) {
  const [{ events, news }, greeting] = await Promise.all([
    fetchDigestContent(pool, tz, asOfDate),
    fetchDigestGreeting(pool)
  ]);
  return renderDigestHtml(events, news, tz, greeting);
}

async function fetchDigestGreeting(pool) {
  try {
    const greetingQuery = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'digest_greeting'"
    );
    const val = greetingQuery.rows[0]?.value?.trim();
    return val || null;
  } catch (err) {
    logger.error('Failed to fetch digest greeting:', err.message);
    return null;
  }
}

// The digest's window, for rows still eligible to send or (excluded = true) for
// the ones an editor held out, which the draft lists separately.
function digestEventsSql(excluded) {
  return `
    SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
           e.location_details, e.source_url, e.venue_poi_id,
           p.id as poi_id, p.name as poi_name, p.poi_roles
    FROM poi_events e
    JOIN pois p ON e.poi_id = p.id
    WHERE (e.start_date AT TIME ZONE $1)::date >= (COALESCE($2::timestamptz, CURRENT_TIMESTAMP) AT TIME ZONE $1)::date
      AND (e.start_date AT TIME ZONE $1)::date <= (COALESCE($2::timestamptz, CURRENT_TIMESTAMP) AT TIME ZONE $1)::date + 2
      AND e.moderation_status IN ('published', 'auto_approved')
      AND ${excluded ? '' : 'NOT '}e.digest_excluded
    ORDER BY e.start_date ASC, e.id ASC
    LIMIT ${DIGEST_EVENT_LIMIT * 2}
  `;
}

// Current News collected in the week before the send (spec 044); Historical News never
// reaches subscribers. The publication_date upper bound still matters: a date parsed off
// an event page can land in the future and would sort above genuine news.
// alt_urls are the other links a story was collected under, which dedup matches on.
function digestNewsSql(excluded) {
  return `
    SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
           n.publication_date, n.collection_date, p.id as poi_id, p.name as poi_name, p.poi_roles,
           (SELECT ARRAY_AGG(u.url) FROM poi_news_urls u WHERE u.news_id = n.id) AS alt_urls
    FROM poi_news n
    JOIN pois p ON n.poi_id = p.id
    WHERE n.moderation_status IN ('published', 'auto_approved')
      AND n.pipeline = 'current'
      AND ${excluded ? '' : 'NOT '}n.digest_excluded
      AND n.collection_date > COALESCE($1::timestamptz, NOW()) - INTERVAL '7 days'
      AND n.collection_date <= COALESCE($1::timestamptz, NOW())
      AND COALESCE(n.publication_date, n.collection_date) <= COALESCE($1::timestamptz, NOW())
      -- A news row whose URL is also a stored event is an event page ingested as news (#585).
      AND NOT EXISTS (
        SELECT 1 FROM poi_events ev
        WHERE LOWER(REGEXP_REPLACE(ev.source_url, '/+$', '')) = LOWER(REGEXP_REPLACE(n.source_url, '/+$', ''))
      )
    ORDER BY COALESCE(n.publication_date, n.collection_date) DESC, n.id DESC
    LIMIT ${DIGEST_NEWS_LIMIT * DIGEST_NEWS_FETCH_MULTIPLIER}
  `;
}

async function fetchDigestContent(pool, tz, asOfDate) {
  const [eventsResult, newsResult, ctx] = await Promise.all([
    pool.query(digestEventsSql(false), [tz, asOfDate]),
    pool.query(digestNewsSql(false), [asOfDate]),
    loadMatchContext(pool, { tz })
  ]);

  const events = dedupeEvents(eventsResult.rows, ctx);
  const newsRows = newsResult.rows.filter(n => isDigestNewsSource(n.source_url));
  const news = dedupeNews(newsRows, ctx);
  const stories = withAlsoCoveredBy(news, newsRows);
  return {
    events: events.kept.slice(0, DIGEST_EVENT_LIMIT),
    news: stories.slice(0, DIGEST_NEWS_LIMIT),
    eventsOverflow: events.kept.slice(DIGEST_EVENT_LIMIT),
    newsBench: stories.slice(DIGEST_NEWS_LIMIT, DIGEST_NEWS_LIMIT + DIGEST_NEWS_BENCH),
    eventsCollapsed: events.collapsed,
    newsCollapsed: news.collapsed,
    ctx
  };
}

const draftNewsItem = (n) => ({
  id: n.id,
  title: n.title,
  summary: n.summary,
  source_url: n.source_url,
  source_host: sourceHost(n.source_url),
  poi_id: n.poi_id,
  poi_name: n.poi_name,
  publication_date: n.publication_date,
  collection_date: n.collection_date,
  also_covered_by: n.also_covered_by || []
});

const draftEventItem = (e) => ({
  id: e.id,
  title: e.title,
  description: e.description,
  start_date: e.start_date,
  end_date: e.end_date,
  location: digestEventLocation(e),
  poi_id: e.poi_id,
  poi_name: e.poi_name,
  source_url: e.source_url
});

/**
 * What the next broadcast digest will contain, as data instead of HTML, for an
 * editor reviewing it before the send (spec 049). Built by fetchDigestContent,
 * the same call the email is rendered from, so the two cannot drift.
 *
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {string} [options.tz] IANA timezone of the send. Default America/New_York.
 * @param {string|null} [options.asOf] ISO 8601 instant to build the digest as of.
 *   Default: the upcoming send (upcomingSendISO).
 * @returns {Promise<{sends_at: string, timezone: string, greeting: string|null,
 *   news: object[], news_bench: object[], events: object[], events_overflow: object[],
 *   news_collapsed: object[], events_collapsed: object[],
 *   news_excluded: object[], events_excluded: object[]}>}
 *   news and events are what sends, in send order; news_bench and events_overflow
 *   are the items past the caps. *_collapsed are duplicates folded into a kept item
 *   ({id, title, into, matched, reason}); *_excluded are items an editor held out
 *   that would otherwise qualify. Item fields are listed in the spec.
 */
export async function getDigestDraft(pool, { tz = 'America/New_York', asOf = null } = {}) {
  const sendsAt = asOf || upcomingSendISO(tz);
  const [content, greeting, excludedNews, excludedEvents] = await Promise.all([
    fetchDigestContent(pool, tz, sendsAt),
    fetchDigestGreeting(pool),
    pool.query(digestNewsSql(true), [sendsAt]),
    pool.query(digestEventsSql(true), [tz, sendsAt])
  ]);
  return {
    sends_at: sendsAt,
    timezone: tz,
    greeting,
    news: content.news.map(draftNewsItem),
    news_bench: content.newsBench.map(draftNewsItem),
    events: content.events.map(draftEventItem),
    events_overflow: content.eventsOverflow.map(draftEventItem),
    news_collapsed: content.newsCollapsed,
    events_collapsed: content.eventsCollapsed,
    // Filtered and deduped like the sendable rows, so each one listed could really send
    news_excluded: dedupeNews(excludedNews.rows.filter(n => isDigestNewsSource(n.source_url)), content.ctx)
      .kept.map(draftNewsItem),
    events_excluded: dedupeEvents(excludedEvents.rows, content.ctx).kept.map(draftEventItem)
  };
}

const DIGEST_EXCLUDE_SQL = {
  news: 'UPDATE poi_news SET digest_excluded = $2 WHERE id = $1 RETURNING id, title',
  event: 'UPDATE poi_events SET digest_excluded = $2 WHERE id = $1 RETURNING id, title'
};

/**
 * Hold one item out of the digest, or put it back, without unpublishing it.
 *
 * @param {import('pg').Pool} pool
 * @param {'news'|'event'} contentType
 * @param {number} id
 * @param {boolean} excluded true to hold the item out, false to put it back
 * @returns {Promise<{id: number, title: string}|null>} the item, or null when the id does not exist
 * @throws {Error} when contentType is not 'news' or 'event'
 */
export async function setDigestExcluded(pool, contentType, id, excluded) {
  const sql = DIGEST_EXCLUDE_SQL[contentType];
  if (!sql) throw new Error(`Unsupported content type: ${contentType}`);
  const updated = await pool.query(sql, [id, excluded]);
  return updated.rows[0] || null;
}

function renderDigestHtml(events, news, tz = 'America/New_York', greeting = null) {
  if (events.length === 0 && news.length === 0) {
    return '';
  }

  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>What's Happening in the Valley This Weekend</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2d5016;
      border-bottom: 3px solid #2d5016;
      padding-bottom: 10px;
      margin-top: 0;
    }
    h2 {
      color: #2d5016;
      margin-top: 30px;
      font-size: 1.3em;
    }
    .event, .news-item {
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid #eee;
    }
    .event:last-child, .news-item:last-child {
      border-bottom: none;
    }
    h3.event-title, h3.news-title {
      font-size: 1.1em;
      font-weight: bold;
      margin: 0 0 5px;
      color: #1a1a1a;
    }
    p.event-date {
      color: #666;
      font-size: 0.9em;
      margin: 0 0 5px;
    }
    p.poi-name {
      color: #2d5016;
      font-weight: 500;
      font-size: 0.9em;
      margin: 0 0 5px;
    }
    p.description, p.summary {
      margin: 8px 0 0;
      color: #555;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 0.85em;
      color: #666;
      text-align: center;
    }
    .footer a {
      color: #2d5016;
      text-decoration: none;
    }
    .no-content {
      color: #666;
      font-style: italic;
    }
    .brand-banner {
      display: block;
      width: 100%;
      max-width: 540px;
      height: auto;
      margin: 0 auto 20px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="https://rootsofthevalley.org">
      <img src="https://rootsofthevalley.org/brand/rotv-header-1200x490.png" alt="Roots of The Valley" class="brand-banner" />
    </a>
    <h1>What's Happening in the Valley This Weekend</h1>
    <p>Your weekly digest from <a href="https://rootsofthevalley.org" style="color: #2d5016 !important; text-decoration: underline;">Roots of The Valley</a></p>
${greeting ? `
    <div style="background-color: #f0f7e8; border-left: 4px solid #2d5016; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #333; font-size: 1em;">${escapeHtml(greeting)}</p>
    </div>
` : ''}
`;

  const linkStyle = 'color: #2d5016 !important; text-decoration: underline; font-weight: 500;';

  if (news.length > 0) {
    html += `
    <h2>📰 Recent News</h2>
`;
    news.forEach(item => {
      html += `
    <div class="news-item">
      <h3 class="news-title">${escapeHtml(item.title)}</h3>
      <p class="poi-name">📍 ${escapeHtml(item.poi_name)}</p>
`;
      if (item.summary) {
        html += `      <p class="summary">${escapeHtml(item.summary)}</p>\n`;
      }
      if (item.source_url) {
        html += `      <p><a href="${escapeHtml(item.source_url)}" style="${linkStyle}">Read full article →</a></p>\n`;
      }
      if (item.also_covered_by?.length) {
        const links = item.also_covered_by
          .map(other => `<a href="${escapeHtml(other.source_url)}" style="${linkStyle}">${escapeHtml(other.source_name)}</a>`)
          .join(', ');
        html += `      <p class="also-covered" style="font-size: 0.9em; color: #555;">Also covered by: ${links}</p>\n`;
      }
      html += `    </div>\n`;
    });
  }

  if (events.length > 0) {
    html += `
    <h2>🎉 Events This Weekend</h2>
`;
    events.forEach(event => {
      const startDate = new Date(event.start_date);
      const dateOnly = startDate.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', timeZone: tz
      });
      const timeOnly = startDate.toLocaleString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: tz
      });
      const dateStr = (timeOnly === '12:00 AM') ? dateOnly : `${dateOnly} at ${timeOnly}`;

      html += `
    <div class="event">
      <h3 class="event-title">${escapeHtml(event.title)}</h3>
      <p class="event-date">📅 ${dateStr}</p>
      <p class="poi-name">📍 ${escapeHtml(digestEventLocation(event))}</p>
`;
      if (event.description) {
        html += `      <p class="description">${escapeHtml(event.description)}</p>\n`;
      }
      if (event.source_url) {
        html += `      <p><a href="${escapeHtml(event.source_url)}" style="${linkStyle}">Learn more →</a></p>\n`;
      }
      html += `    </div>\n`;
    });
  }

  if (events.length === 0 && news.length === 0) {
    html += `
    <p class="no-content">No events or news available this week. Check back next Friday!</p>
`;
  }

  html += `
    <div class="footer">
      <p>Roots of The Valley is an open-source community project for the Cuyahoga Valley.</p>
      <p><a href="https://rootsofthevalley.org" style="color: #2d5016 !important; text-decoration: underline;">Visit rootsofthevalley.org</a></p>
    </div>
  </div>
</body>
</html>
`;

  return html;
}

export async function sendWeeklyDigest(pool, pgBossJobId = null) {
  // job_logs.job_id is int32 — hash the pg-boss UUID into that range so we can write logs
  let jobId = 0;
  if (pgBossJobId) {
    let hash = 0;
    for (let i = 0; i < pgBossJobId.length; i++) {
      hash = ((hash << 5) - hash) + pgBossJobId.charCodeAt(i);
      hash = hash & 0x7FFFFFFF;
    }
    jobId = hash;
  }
  const jobType = 'newsletter-digest';

  // Idempotency: prevent multiple digest sends on the same day even if pg-boss retries
  const today = new Date().toISOString().split('T')[0];
  const alreadySentCheck = await pool.query(
    `SELECT id FROM job_logs
     WHERE job_type = $1
       AND level = 'info'
       AND message = 'Weekly digest sent successfully'
       AND created_at::date = $2::date
     LIMIT 1`,
    [jobType, today]
  );

  if (alreadySentCheck.rows.length > 0) {
    logger.info(`Digest already sent today (${today}), skipping duplicate send`);

    if (jobId > 0) {
      await pool.query(
        'INSERT INTO job_logs (job_id, job_type, level, message, details) VALUES ($1, $2, $3, $4, $5)',
        [jobId, jobType, 'info', 'Skipped - digest already sent today',
         JSON.stringify({ skipped: true, reason: 'already_sent_today', date: today })]
      );
    }

    return { success: true, skipped: true, reason: 'already_sent_today' };
  }

  if (jobId > 0) {
    await pool.query(
      'INSERT INTO job_logs (job_id, job_type, level, message) VALUES ($1, $2, $3, $4)',
      [jobId, jobType, 'info', 'Starting newsletter digest generation']
    );
  }

  try {
    const digestHtml = await generateDigest(pool);

    if (!digestHtml) {
      logger.info('No content for digest this week, skipping send');

      if (jobId > 0) {
        await pool.query(
          `INSERT INTO job_logs (job_id, job_type, level, message, details)
           VALUES ($1, $2, $3, $4, $5)`,
          [jobId, jobType, 'info', 'No content available for digest', JSON.stringify({ completed: true, skipped: true })]
        );
      }

      return { success: true, skipped: true, reason: 'No content available' };
    }

    const sendDate = new Date();
    const dateStr = sendDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    // Append time in development so the dev-mode subject is unique enough to bypass
    // Buttondown's slug uniqueness check during repeated testing
    const subject = process.env.NODE_ENV === 'development'
      ? `What's Happening in the Valley This Weekend - ${dateStr} @ ${sendDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
      : `What's Happening in the Valley This Weekend - ${dateStr}`;

    // Reuse drafts from a previous same-day failed attempt — pg-boss retries the whole job,
    // and creating a fresh draft each retry hits Buttondown's slug_uniqueness constraint.
    let existingEmailId = null;
    const draftCheck = await pool.query(
      `SELECT details->>'buttondownEmailId' as email_id FROM job_logs
       WHERE job_type = $1
         AND level = 'info'
         AND message = 'Draft created in Buttondown'
         AND created_at::date = $2::date
       ORDER BY created_at DESC
       LIMIT 1`,
      [jobType, today]
    );
    if (draftCheck.rows.length > 0 && draftCheck.rows[0].email_id) {
      existingEmailId = draftCheck.rows[0].email_id;
      logger.info(`Found existing draft from earlier attempt: ${existingEmailId}`);
    }

    await sendEmail(subject, digestHtml, pool, {
      existingEmailId,
      onDraftCreated: async (emailId) => {
        if (jobId > 0) {
          await pool.query(
            `INSERT INTO job_logs (job_id, job_type, level, message, details)
             VALUES ($1, $2, $3, $4, $5)`,
            [jobId, jobType, 'info', 'Draft created in Buttondown',
             JSON.stringify({ buttondownEmailId: emailId })]
          );
        }
      }
    });

    logger.info('Weekly digest sent successfully');

    if (jobId > 0) {
      await pool.query(
        `INSERT INTO job_logs (job_id, job_type, level, message, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, jobType, 'info', 'Weekly digest sent successfully', JSON.stringify({ completed: true, skipped: false })]
      );
    }

    return { success: true, skipped: false };
  } catch (error) {
    logger.error('Failed to send weekly digest:', error);

    if (jobId > 0) {
      const errorDetails = {
        completed: false,
        error: error.message,
        status: error.response?.status,
        buttondownResponse: error.response?.data,
        buttondownDetails: error.buttondownDetails,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      };

      await pool.query(
        `INSERT INTO job_logs (job_id, job_type, level, message, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, jobType, 'error', error.message || 'Failed to send digest', JSON.stringify(errorDetails)]
      );
    }

    if (error.message === 'BUTTONDOWN_NOT_CONFIGURED') {
      logger.info('Buttondown not configured, skipping digest send');
      return { success: true, skipped: true, reason: 'Buttondown not configured' };
    }

    throw error;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendDigestPreviewTo(pool, email, tz = 'America/New_York', pgBossJobId = null) {
  // job_logs.job_id is int32 — hash the pg-boss UUID into that range (mirrors sendWeeklyDigest)
  let jobId = 0;
  if (pgBossJobId) {
    let hash = 0;
    for (let i = 0; i < pgBossJobId.length; i++) {
      hash = ((hash << 5) - hash) + pgBossJobId.charCodeAt(i);
      hash = hash & 0x7FFFFFFF;
    }
    jobId = hash;
  }
  const jobType = 'newsletter-preview';

  // Idempotency for scheduled/triggered previews: don't send the same recipient
  // a preview twice in one day. Manual test sends (send-preview-test, no
  // pgBossJobId) are exempt so admins can re-send on demand. Fixes the duplicate
  // preview emails caused by the job firing more than once.
  if (pgBossJobId) {
    const today = new Date().toISOString().split('T')[0];
    const alreadySent = await pool.query(
      `SELECT id FROM job_logs
       WHERE job_type = $1 AND level = 'info' AND message = $2
         AND created_at::date = $3::date
       LIMIT 1`,
      [jobType, `Preview sent to ${email}`, today]
    );
    if (alreadySent.rows.length > 0) {
      logger.info(`Preview already sent to ${email} today, skipping duplicate`);
      return { success: true, skipped: true, reason: 'already_sent_today', recipient: email };
    }
  }

  if (jobId > 0) {
    await pool.query(
      'INSERT INTO job_logs (job_id, job_type, level, message) VALUES ($1, $2, $3, $4)',
      [jobId, jobType, 'info', `Starting newsletter preview for ${email}`]
    );
  }

  try {
    const asOf = upcomingSendISO(tz);
    const html = await generateDigest(pool, tz, asOf);

    if (!html) {
      if (jobId > 0) {
        await pool.query(
          `INSERT INTO job_logs (job_id, job_type, level, message, details)
           VALUES ($1, $2, $3, $4, $5)`,
          [jobId, jobType, 'info', 'No content available for preview',
           JSON.stringify({ completed: true, skipped: true, asOf })]
        );
      }
      return { success: true, skipped: true, reason: 'No content for upcoming Friday', asOf };
    }

    const previewDate = new Date(asOf).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: tz
    });
    const subject = `What's Happening in the Valley This Weekend - ${previewDate}`;

    const { emailId } = await sendDraftToRecipients(subject, html, [email], pool);

    if (jobId > 0) {
      await pool.query(
        `INSERT INTO job_logs (job_id, job_type, level, message, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, jobType, 'info', `Preview sent to ${email}`,
         JSON.stringify({ completed: true, skipped: false, asOf, buttondownEmailId: emailId, recipient: email })]
      );
    }

    return { success: true, emailId, asOf, recipient: email };
  } catch (error) {
    if (jobId > 0) {
      await pool.query(
        `INSERT INTO job_logs (job_id, job_type, level, message, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, jobType, 'error', error.message || 'Failed to send preview',
         JSON.stringify({ completed: false, error: error.message, recipient: email })]
      );
    }
    throw error;
  }
}

// Send each newsletter subscriber who has favorited POIs a digest scoped to
// those POIs (spec 019-poi-subscriptions). Runs after the general broadcast in
// the Friday digest job. Subscription (newsletter_subscriptions) is the email
// opt-in; favoriting alone does not trigger email. Content for every subscriber
// is fetched in two batched queries and grouped in memory to avoid an N+1.
export async function sendPersonalizedDigests(pool, pgBossJobId = null) {
  let jobId = 0;
  if (pgBossJobId) {
    let hash = 0;
    for (let i = 0; i < pgBossJobId.length; i++) {
      hash = ((hash << 5) - hash) + pgBossJobId.charCodeAt(i);
      hash = hash & 0x7FFFFFFF;
    }
    jobId = hash;
  }
  const jobType = 'newsletter-personalized';

  const targets = await pool.query(
    `SELECT u.id, u.email, u.timezone, ARRAY_AGG(f.poi_id) AS poi_ids
       FROM users u
       JOIN user_poi_favorites f ON f.user_id = u.id
      WHERE u.email IS NOT NULL
        AND EXISTS (SELECT 1 FROM newsletter_subscriptions s WHERE s.email = u.email)
      GROUP BY u.id, u.email, u.timezone`
  );

  if (targets.rows.length === 0) {
    return { success: true, sent: 0, skipped: 0, candidates: 0 };
  }

  const greeting = await fetchDigestGreeting(pool);
  const allPoiIds = [...new Set(targets.rows.flatMap(t => t.poi_ids))];

  const [newsResult, eventsResult, matchCtx] = await Promise.all([
    pool.query(
      `SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
              n.publication_date, n.collection_date, p.id AS poi_id, p.name AS poi_name, p.poi_roles,
              (SELECT ARRAY_AGG(u.url) FROM poi_news_urls u WHERE u.news_id = n.id) AS alt_urls
         FROM poi_news n
         JOIN pois p ON p.id = n.poi_id
        WHERE n.poi_id = ANY($1::int[])
          AND n.moderation_status IN ('published', 'auto_approved')
          AND n.pipeline = 'current'
          AND NOT n.digest_excluded
          AND n.collection_date > NOW() - INTERVAL '7 days'
          AND COALESCE(n.publication_date, n.collection_date) <= NOW()
          AND NOT EXISTS (
            SELECT 1 FROM poi_events ev
            WHERE LOWER(REGEXP_REPLACE(ev.source_url, '/+$', '')) = LOWER(REGEXP_REPLACE(n.source_url, '/+$', ''))
          )
        ORDER BY COALESCE(n.publication_date, n.collection_date) DESC`,
      [allPoiIds]
    ),
    pool.query(
      `SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
              e.location_details, e.source_url, e.venue_poi_id,
              p.id AS poi_id, p.name AS poi_name, p.poi_roles
         FROM poi_events e
         JOIN pois p ON p.id = e.poi_id
        WHERE e.poi_id = ANY($1::int[])
          AND e.moderation_status IN ('published', 'auto_approved')
          AND NOT e.digest_excluded
          AND e.start_date >= NOW() - INTERVAL '1 day'
          AND e.start_date <= NOW() + INTERVAL '4 days'
        ORDER BY e.start_date ASC`,
      [allPoiIds]
    ),
    loadMatchContext(pool)
  ]);

  let sent = 0;
  let skipped = 0;
  for (const user of targets.rows) {
    const tz = user.timezone || 'America/New_York';
    const poiSet = new Set(user.poi_ids);
    const dayInTz = (d) => new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(d));

    const asOf = upcomingSendISO(tz);
    const friday = dayInTz(asOf);
    const sunday = dayInTz(new Date(new Date(asOf).getTime() + 2 * 86400000));

    const userNews = dedupeDigestNews(
      newsResult.rows
        .filter(n => poiSet.has(n.poi_id))
        .filter(n => isDigestNewsSource(n.source_url)),
      matchCtx
    ).slice(0, 5);
    const userEvents = dedupeDigestEvents(
      eventsResult.rows
        .filter(e => poiSet.has(e.poi_id))
        .filter(e => {
          const day = dayInTz(e.start_date);
          return day >= friday && day <= sunday;
        }),
      tz,
      matchCtx
    ).slice(0, 10);

    const html = renderDigestHtml(userEvents, userNews, tz, greeting);
    if (!html) {
      skipped++;
      continue;
    }

    const dateStr = new Date(asOf).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: tz
    });
    const subject = `Your Favorite Places This Weekend - ${dateStr}`;
    try {
      await sendDraftToRecipients(subject, html, [user.email], pool);
      sent++;
    } catch (error) {
      logger.error(`Personalized digest failed for user ${user.id}:`, error.message);
      if (error.message === 'BUTTONDOWN_NOT_CONFIGURED') {
        break;
      }
    }
  }

  logger.info(`Personalized digests: ${sent} sent, ${skipped} skipped (no content)`);
  if (jobId > 0) {
    await pool.query(
      `INSERT INTO job_logs (job_id, job_type, level, message, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, jobType, 'info', 'Personalized digests processed',
       JSON.stringify({ completed: true, sent, skipped, candidates: targets.rows.length })]
    );
  }

  return { success: true, sent, skipped, candidates: targets.rows.length };
}
