/**
 * Newsletter Ingestion Service
 * Receives inbound emails via built-in SMTP server (port 25).
 * Extracts news/events using Gemini, matches to POIs, inserts into moderation queue.
 */

import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { queueModerationJob, queueNewsletterJob } from './jobScheduler.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

// Strip non-content elements from newsletter HTML
turndown.remove(['img', 'iframe', 'video', 'audio', 'svg', 'canvas', 'figure', 'style', 'script']);

/**
 * Extract readable markdown from newsletter HTML/text
 * @param {string} html - Raw HTML body
 * @param {string} text - Plain text fallback
 * @returns {string} Cleaned markdown content
 */
export function extractContentFromEmail(html, text) {
  if (!html && !text) return '';

  if (html) {
    try {
      const dom = new JSDOM(html);
      const doc = dom.window.document;

      // Remove noise elements common in newsletters
      const removeSelectors = [
        'nav', 'footer', 'header',
        '[class*="unsubscribe"]', '[class*="footer"]',
        '[class*="social"]', '[class*="share"]',
        '[class*="tracking"]', '[class*="pixel"]',
        'a[href*="unsubscribe"]'
      ];

      for (const selector of removeSelectors) {
        try {
          doc.querySelectorAll(selector).forEach(el => el.remove());
        } catch {
          // Ignore invalid selectors
        }
      }

      const markdown = turndown.turndown(doc.body.innerHTML);
      // Collapse excessive whitespace
      return markdown.replace(/\n{3,}/g, '\n\n').trim();
    } catch (error) {
      console.error('[Newsletter] HTML parsing failed, falling back to text:', error.message);
    }
  }

  return text || '';
}

/**
 * Load all POI names for matching
 * @param {Pool} pool - Database pool
 * @returns {Array<{id: number, name: string}>}
 */
async function loadPois(pool) {
  const result = await pool.query(`
    SELECT id, name FROM pois
    WHERE (deleted IS NULL OR deleted = FALSE)
    ORDER BY name
  `);
  return result.rows;
}

/**
 * Match extracted items to POIs by name/keyword overlap
 * @param {Pool} pool - Database pool
 * @param {Array} items - Items with title and description
 * @returns {Array} Items with poi_id added where matched
 */
export async function matchItemsToPois(pool, items) {
  if (!items || items.length === 0) return [];

  const pois = await loadPois(pool);
  const poiMap = new Map();

  // Build lookup: lowercase name → id
  for (const poi of pois) {
    poiMap.set(poi.name.toLowerCase(), poi.id);
  }

  return items.map(item => {
    const searchText = `${item.title || ''} ${item.description || ''} ${item.summary || ''} ${item.location_details || ''}`.toLowerCase();

    // Try exact name match first (longest names first to avoid partial matches)
    const sortedPois = [...pois].sort((a, b) => b.name.length - a.name.length);

    for (const poi of sortedPois) {
      if (searchText.includes(poi.name.toLowerCase())) {
        return { ...item, poi_id: poi.id };
      }
    }

    // No match — leave poi_id null for admin assignment
    return { ...item, poi_id: null };
  });
}

/**
 * Check if a URL is a tracking/redirect URL that should be dropped.
 * Newsletter HTML is full of these — they're opaque, multi-layered,
 * and resolve to garbage destinations. Better to have no URL than a broken one.
 * @param {string} url - URL to check
 * @returns {boolean} True if the URL is a tracking URL or dead end
 */
function isTrackingOrDeadEndUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // Known tracking/redirect domains
    if (host.includes('hive.co') || host.includes('mail-tracking.')
      || host.includes('mailchimp.com') || host.includes('list-manage.com')
      || host.includes('constantcontact.com') || host.includes('sendgrid.net')
      || host.includes('mailgun.') || host.includes('campaign-archive.com')) {
      return true;
    }
    // google.com/?!=! and similar garbage from broken tracking redirects
    if (host === 'www.google.com' || host === 'google.com') {
      return parsed.pathname === '/' || parsed.pathname === '';
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Extract the final destination from a JS-redirect intermediary URL.
 * Some tracking services (hive.co) resolve to a JS redirect page with
 * the real URL in a query parameter like ?next_url=<encoded_url>.
 * @param {string} url - URL that may be a JS redirect intermediary
 * @returns {string|null} Extracted destination URL, or null
 */
function extractJsRedirectTarget(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // hive.co pattern: /shortlink/js-redirect?next_url=<encoded>
    if (parsed.pathname.includes('js-redirect') || parsed.pathname.includes('js_redirect')) {
      const nextUrl = parsed.searchParams.get('next_url')
        || parsed.searchParams.get('next')
        || parsed.searchParams.get('url')
        || parsed.searchParams.get('redirect_url');
      if (nextUrl) {
        // Validate it's actually a URL
        new URL(nextUrl);
        return nextUrl;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a newsletter tracking URL to its final destination.
 * Newsletter HTML is full of tracking redirects (hive.co, mailchimp, etc).
 * Uses HEAD with redirect: follow, then handles JS redirect intermediaries
 * and filters out dead-end URLs.
 * @param {string} url - URL to resolve
 * @returns {string|null} Final destination URL, or null if unresolvable
 */
async function resolveNewsletterUrl(url) {
  if (!url) return null;

  // Drop known tracking URLs before even making a request
  if (isTrackingOrDeadEndUrl(url)) {
    console.log(`[Newsletter] Tracking URL dropped: ${url.substring(0, 80)}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });

    let finalUrl = response.url || url;

    // Check for JS redirect intermediary (e.g. hive.co/shortlink/js-redirect?next_url=...)
    const jsTarget = extractJsRedirectTarget(finalUrl);
    if (jsTarget) {
      console.log(`[Newsletter] JS redirect extracted: ${finalUrl.substring(0, 60)}... -> ${jsTarget.substring(0, 80)}`);
      finalUrl = jsTarget;
    }

    // Drop tracking/dead-end URLs after resolution
    if (isTrackingOrDeadEndUrl(finalUrl)) {
      console.log(`[Newsletter] Resolved URL is tracking/dead-end, dropped: ${finalUrl.substring(0, 80)}`);
      return null;
    }

    if (finalUrl !== url) {
      console.log(`[Newsletter] URL resolved: ${url.substring(0, 50)}... -> ${finalUrl.substring(0, 80)}`);
    }

    return finalUrl;
  } catch (error) {
    console.log(`[Newsletter] URL resolution failed: ${url.substring(0, 50)}... (${error.message})`);
    return null;
  }
}

/**
 * Resolve all source URLs in extracted items.
 * @param {Array} items - Items with source_url fields
 * @returns {Array} Items with resolved source URLs
 */
async function resolveItemUrls(items) {
  if (!items || items.length === 0) return [];

  const resolved = [];
  for (const item of items) {
    if (item.source_url) {
      const finalUrl = await resolveNewsletterUrl(item.source_url);
      resolved.push({ ...item, source_url: finalUrl });
    } else {
      resolved.push(item);
    }
  }
  return resolved;
}

/**
 * Create Gemini client from API key in admin_settings or env
 */
async function createGeminiClient(pool) {
  // Try admin_settings first
  const result = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'gemini_api_key'"
  );

  const apiKey = result.rows[0]?.value || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('No Gemini API key configured');
  }

  return new GoogleGenerativeAI(apiKey);
}

/**
 * Use Gemini to extract news and events from newsletter content
 * @param {Pool} pool - Database pool
 * @param {string} markdown - Newsletter content as markdown
 * @param {string} subject - Newsletter subject line
 * @returns {Object} { news: [], events: [] }
 */
async function extractWithGemini(pool, markdown, subject) {
  const genAI = await createGeminiClient(pool);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0 }
  });

  const prompt = `You are a content curator for Roots of The Valley, a guide to Cuyahoga Valley National Park and surrounding communities in Northeast Ohio.

Extract news items and events from this newsletter that are relevant to the Cuyahoga Valley region.

Newsletter subject: "${subject}"

Newsletter content:
${markdown.substring(0, 30000)}

RELEVANCE CRITERIA:
- Nature, trails, outdoor recreation, conservation
- Local history, ecology, wildlife
- Community stewardship, scenic railroads, canal towpath heritage
- Arts/culture organizations that serve the valley
- Events at or near Cuyahoga Valley National Park
- Skip generic urban news, restaurant openings, unrelated entertainment

Return a JSON object with this exact structure:
{
  "news": [
    {
      "title": "News headline",
      "summary": "2-3 sentence summary",
      "source_name": "Newsletter name or organization",
      "source_url": "URL if mentioned in newsletter, or null",
      "published_date": "YYYY-MM-DD if known, or null",
      "news_type": "general|alert|wildlife|infrastructure|community"
    }
  ],
  "events": [
    {
      "title": "Event name",
      "description": "Brief description",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null",
      "event_type": "hike|race|concert|festival|program|volunteer|arts|community|alert",
      "location_details": "Venue or location name",
      "source_url": "URL if available, or null"
    }
  ]
}

IMPORTANT:
- Only include items relevant to the Cuyahoga Valley region
- All dates in ISO 8601 format (YYYY-MM-DD)
- Skip past events — only include upcoming/current events
- Return {"news": [], "events": []} if nothing relevant found
- Return ONLY the JSON, no additional text`;

  const generation = await model.generateContent(prompt);
  const response = generation.response.text();

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('[Newsletter] No JSON in Gemini response');
    return { news: [], events: [] };
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Main newsletter processing function
 * Called by the webhook endpoint
 * @param {Pool} pool - Database pool
 * @param {Object} emailData - { from, subject, html, text, raw, receivedAt }
 * @returns {Object} Processing result summary
 */
export async function processNewsletter(pool, emailData) {
  const { from, subject, html, text, receivedAt } = emailData;

  console.log(`[Newsletter] Processing: "${subject}" from ${from}`);

  // Step 1: Convert HTML to markdown
  const markdown = extractContentFromEmail(html, text);

  if (!markdown || markdown.length < 50) {
    console.log('[Newsletter] Insufficient content, skipping');

    // Store the raw email even if we can't process it
    await pool.query(`
      INSERT INTO newsletter_emails (from_address, subject, body_html, body_text, body_markdown, processed, error_message, received_at)
      VALUES ($1, $2, $3, $4, $5, TRUE, 'Insufficient content', $6)
    `, [from, subject, html || null, text || null, markdown, receivedAt || new Date()]);

    return { success: false, error: 'Insufficient content', newsExtracted: 0, eventsExtracted: 0 };
  }

  // Step 2: Store raw email
  const emailResult = await pool.query(`
    INSERT INTO newsletter_emails (from_address, subject, body_html, body_text, body_markdown, received_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [from, subject, html || null, text || null, markdown, receivedAt || new Date()]);

  const emailId = emailResult.rows[0].id;

  try {
    // Step 3: Extract news/events with Gemini
    const extracted = await extractWithGemini(pool, markdown, subject);
    console.log(`[Newsletter] Gemini extracted: ${extracted.news?.length || 0} news, ${extracted.events?.length || 0} events`);

    // Step 4: Resolve tracking URLs to final destinations
    const resolvedNews = await resolveItemUrls(extracted.news || []);
    const resolvedEvents = await resolveItemUrls(extracted.events || []);

    // Step 5: Match items to POIs
    const matchedNews = await matchItemsToPois(pool, resolvedNews);
    const matchedEvents = await matchItemsToPois(pool, resolvedEvents);

    let newsInserted = 0;
    let eventsInserted = 0;

    // Step 6: Insert news items
    for (const item of matchedNews) {
      try {
        const result = await pool.query(`
          INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, published_at,
                                moderation_status, content_source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'newsletter')
          RETURNING id
        `, [
          item.poi_id, item.title, item.summary,
          item.source_url || null, item.source_name || null,
          item.news_type || 'general', item.published_date || null
        ]);

        // Queue moderation
        try {
          await queueModerationJob('news', result.rows[0].id);
        } catch (modErr) {
          console.error(`[Newsletter] Failed to queue moderation for news #${result.rows[0].id}:`, modErr.message);
        }

        newsInserted++;
      } catch (err) {
        console.error(`[Newsletter] Failed to insert news "${item.title}":`, err.message);
      }
    }

    // Step 7: Insert event items
    for (const item of matchedEvents) {
      if (!item.start_date) continue; // Events require a start date

      try {
        const result = await pool.query(`
          INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type,
                                  location_details, source_url, moderation_status, content_source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'newsletter')
          RETURNING id
        `, [
          item.poi_id, item.title, item.description,
          item.start_date, item.end_date || null,
          item.event_type || null, item.location_details || null,
          item.source_url || null
        ]);

        // Queue moderation
        try {
          await queueModerationJob('event', result.rows[0].id);
        } catch (modErr) {
          console.error(`[Newsletter] Failed to queue moderation for event #${result.rows[0].id}:`, modErr.message);
        }

        eventsInserted++;
      } catch (err) {
        console.error(`[Newsletter] Failed to insert event "${item.title}":`, err.message);
      }
    }

    // Step 8: Update newsletter_emails record
    await pool.query(`
      UPDATE newsletter_emails
      SET processed = TRUE, news_extracted = $1, events_extracted = $2, processed_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [newsInserted, eventsInserted, emailId]);

    console.log(`[Newsletter] Complete: ${newsInserted} news, ${eventsInserted} events inserted from "${subject}"`);

    return {
      success: true,
      emailId,
      newsExtracted: newsInserted,
      eventsExtracted: eventsInserted,
      unmatchedNews: matchedNews.filter(n => !n.poi_id).length,
      unmatchedEvents: matchedEvents.filter(e => !e.poi_id).length
    };
  } catch (error) {
    console.error(`[Newsletter] Processing failed for email #${emailId}:`, error);

    await pool.query(`
      UPDATE newsletter_emails
      SET processed = TRUE, error_message = $1, processed_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [error.message, emailId]);

    return { success: false, emailId, error: error.message, newsExtracted: 0, eventsExtracted: 0 };
  }
}

/**
 * Process a newsletter email by its database ID (called by pg-boss worker).
 * Reads raw email from newsletter_emails, runs processNewsletter().
 * @param {Pool} pool - Database pool
 * @param {number} emailId - ID of the newsletter_emails row
 */
export async function processNewsletterById(pool, emailId) {
  const row = await pool.query(
    'SELECT from_address, subject, body_html, body_text, received_at FROM newsletter_emails WHERE id = $1',
    [emailId]
  );

  if (row.rows.length === 0) {
    console.error(`[Newsletter] Email #${emailId} not found`);
    return;
  }

  const email = row.rows[0];
  await processNewsletter(pool, {
    from: email.from_address,
    subject: email.subject,
    html: email.body_html,
    text: email.body_text,
    receivedAt: email.received_at
  });
}

/**
 * Start an SMTP server to receive inbound newsletter emails.
 * Stores raw email in newsletter_emails, queues a pg-boss job for
 * async processing, and returns immediately to the sending MTA.
 * @param {Pool} pool - Database pool
 * @returns {SMTPServer} The running SMTP server instance (for graceful shutdown)
 */
export function startSmtpServer(pool) {
  const server = new SMTPServer({
    banner: 'Roots of The Valley Mail Receiver',
    authOptional: true,
    disabledCommands: ['AUTH'],
    size: 10 * 1024 * 1024, // 10MB max message size

    onRcptTo(address, session, callback) {
      const recipient = address.address.toLowerCase();
      if (recipient !== 'news@rootsofthevalley.org') {
        return callback(new Error(`Recipient <${address.address}> not accepted`));
      }
      callback();
    },

    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', async () => {
        try {
          const raw = Buffer.concat(chunks);
          const parsed = await simpleParser(raw);

          const from = parsed.from?.text || 'unknown';
          const subject = parsed.subject || '(no subject)';
          const html = parsed.html || null;
          const text = parsed.text || null;

          // Store raw email immediately (fast DB insert)
          const result = await pool.query(
            `INSERT INTO newsletter_emails (from_address, subject, body_html, body_text, received_at, processed)
             VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
            [from, subject, html, text, new Date()]
          );
          const emailId = result.rows[0].id;

          // Queue for async processing via pg-boss
          await queueNewsletterJob(emailId);
          console.log(`[SMTP] Queued email #${emailId}: "${subject}" from ${from}`);
          callback();
        } catch (err) {
          console.error('[SMTP] Failed to accept email:', err);
          const error = new Error('Failed to accept message');
          error.responseCode = 451;
          callback(error);
        }
      });
    }
  });

  server.on('error', err => {
    console.error('[SMTP] Server error:', err);
  });

  server.listen(25, '::', () => {
    console.log('[SMTP] Mail receiver listening on port 25');
  });

  return server;
}
