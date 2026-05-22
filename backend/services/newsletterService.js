/**
 * Newsletter Ingestion Service
 * Receives inbound emails via the built-in SMTP server (port 25), maps the
 * sender to a POI, and runs the email through the standard collection pipeline
 * (collectPoi) twice — once for news, once for events — so URLs, dates, POI
 * matching and dedup are handled identically to Phase I/II collection (spec 020).
 */

import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import nodemailer from 'nodemailer';
import { collectPoi, saveNewsItems, saveEventItems } from './newsService.js';
import { queueNewsletterJob } from './jobScheduler.js';
import { logInfo, flush as flushJobLogs } from './jobLogger.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

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
        } catch { /* expected */ }
      }

      const markdown = turndown.turndown(doc.body.innerHTML);
      return markdown.replace(/\n{3,}/g, '\n\n').trim();
    } catch (error) {
      console.error('[Newsletter] HTML parsing failed, falling back to text:', error.message);
    }
  }

  return text || '';
}

const VIEW_IN_BROWSER_RE = /view\s+(this\s+)?(email\s+)?(as\s+a\s+)?(web\s?page|in\s+(your\s+)?browser|online)|having\s+trouble\s+viewing/i;

/**
 * Parse a newsletter email into the shape the collection pipeline consumes:
 * the cleaned markdown, every absolute anchor, and the "view in browser" link.
 * Links/VIB are read from the raw HTML (no noise removal) so the preheader
 * "view as webpage" link survives.
 * @param {string} html - Raw email HTML
 * @returns {{markdown: string, links: Array<{url: string, text: string}>, viewInBrowserUrl: string|null}}
 */
function extractEmailParts(html) {
  const markdown = extractContentFromEmail(html, '');
  if (!html) return { markdown, links: [], viewInBrowserUrl: null };

  let doc;
  try {
    doc = new JSDOM(html).window.document;
  } catch {
    return { markdown, links: [], viewInBrowserUrl: null };
  }

  const anchors = [...doc.querySelectorAll('a[href]')];
  let viewInBrowserUrl = null;
  for (const a of anchors) {
    if (/^https?:/i.test(a.href) && VIEW_IN_BROWSER_RE.test((a.textContent || '').trim())) {
      viewInBrowserUrl = a.href;
      break;
    }
  }

  const links = anchors
    .map(a => ({ url: a.href, text: (a.textContent || '').trim() }))
    .filter(l => /^https?:/i.test(l.url));

  return { markdown, links, viewInBrowserUrl };
}

/**
 * Process a newsletter email by its database ID (called by the pg-boss worker).
 * Maps the sender to a POI, picks an entry page (view-in-browser link, or the
 * stored email body pre-seeded into the render cache), then runs the standard
 * collection pipeline twice (news, then events). Unmapped senders are
 * quarantined for admin assignment.
 * @param {Pool} pool - Database pool
 * @param {number} emailId - ID of the newsletter_emails row
 */
export async function processNewsletterById(pool, emailId) {
  const emailRow = await pool.query(
    'SELECT from_address, subject, body_html FROM newsletter_emails WHERE id = $1',
    [emailId]
  );

  if (emailRow.rows.length === 0) {
    console.error(`[Newsletter] Email #${emailId} not found`);
    return;
  }

  const email = emailRow.rows[0];
  const from = email.from_address || '';
  const subject = email.subject || '(no subject)';

  const poiResult = await pool.query(
    `SELECT p.* FROM poi_newsletter_sources s
       JOIN pois p ON p.id = s.poi_id
      WHERE POSITION(LOWER(s.from_pattern) IN LOWER($1)) > 0
      ORDER BY LENGTH(s.from_pattern) DESC
      LIMIT 1`,
    [from]
  );

  if (poiResult.rows.length === 0) {
    await pool.query(
      `UPDATE newsletter_emails
         SET processed = FALSE, error_message = $1, processed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [`unassigned: no POI mapped for sender ${from}`, emailId]
    );
    console.log(`[Newsletter] Quarantined #${emailId} — no POI mapping for "${from}"`);
    return;
  }

  const poi = poiResult.rows[0];
  const { markdown, links, viewInBrowserUrl } = extractEmailParts(email.body_html || '');

  let entryUrl = viewInBrowserUrl;
  if (!entryUrl) {
    if (!markdown || markdown.length < 50) {
      await pool.query(
        `UPDATE newsletter_emails
           SET processed = TRUE, error_message = 'Insufficient content',
               news_extracted = 0, events_extracted = 0, processed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [emailId]
      );
      return;
    }
    entryUrl = `https://newsletter.local/email/${emailId}`;
    await pool.query(
      `INSERT INTO rendered_page_cache (url, markdown, raw_text, og_dates, og_image, title, links, page_type, rendered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NOW())
       ON CONFLICT (url) DO UPDATE SET
         markdown = EXCLUDED.markdown, raw_text = EXCLUDED.raw_text,
         links = EXCLUDED.links, page_type = NULL, rendered_at = NOW()`,
      [entryUrl, markdown, markdown, JSON.stringify({}), null, subject, JSON.stringify(links)]
    );
  }

  const transientPoi = { ...poi, news_url: entryUrl, events_url: entryUrl };
  const opts = { skipPhaseTwo: true };

  try {
    const newsRun = await collectPoi(pool, transientPoi, null, 'America/New_York', 'news', null, opts);
    const eventRun = await collectPoi(pool, transientPoi, null, 'America/New_York', 'events', null, opts);

    const newsSaved = await saveNewsItems(pool, poi.id, newsRun.news || [], { contentSource: 'newsletter' });
    const eventsSaved = await saveEventItems(pool, poi.id, eventRun.events || [], { contentSource: 'newsletter' });

    await pool.query(
      `UPDATE newsletter_emails
         SET processed = TRUE, news_extracted = $1, events_extracted = $2,
             error_message = NULL, processed_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [newsSaved, eventsSaved, emailId]
    );
    logInfo(emailId, 'newsletter', poi.id, poi.name,
      `${newsSaved} news, ${eventsSaved} events from "${subject}"`, { from, poiId: poi.id });
    await flushJobLogs();
  } catch (err) {
    await pool.query(
      `UPDATE newsletter_emails
         SET processed = TRUE, error_message = $1, processed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [err.message, emailId]
    );
    console.error(`[Newsletter] Processing failed for #${emailId}:`, err.message);
  }
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
    size: 10 * 1024 * 1024,

    onRcptTo(address, session, callback) {
      const recipient = address.address.toLowerCase();
      const ACCEPTED_RECIPIENTS = ['news@rootsofthevalley.org', 'admin@rootsofthevalley.org'];
      if (!ACCEPTED_RECIPIENTS.includes(recipient)) {
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
          const recipient = session.envelope.rcptTo[0]?.address?.toLowerCase();

          if (recipient === 'admin@rootsofthevalley.org') {
            const transporter = nodemailer.createTransport({
              host: 'gmail-smtp-in.l.google.com',
              port: 25,
              secure: false,
              tls: { rejectUnauthorized: false },
              name: 'rootsofthevalley.org'
            });
            const parsed = await simpleParser(raw);
            const originalFrom = parsed.from?.text || 'unknown sender';
            await transporter.sendMail({
              envelope: { from: 'admin@rootsofthevalley.org', to: 'scott.mccarty@gmail.com' },
              from: `"ROTV Admin Forward" <admin@rootsofthevalley.org>`,
              to: 'scott.mccarty@gmail.com',
              subject: `[ROTV] ${parsed.subject || '(no subject)'}`,
              replyTo: parsed.from?.value?.[0]?.address || undefined,
              text: `--- Forwarded from ${originalFrom} ---\n\n${parsed.text || ''}`,
              html: parsed.html ? `<p><em>Forwarded from ${originalFrom}</em></p><hr>${parsed.html}` : undefined
            });
            console.log(`[SMTP] Forwarded admin email to scott.mccarty@gmail.com: "${parsed.subject}" from ${originalFrom}`);
            callback();
            return;
          }

          const parsed = await simpleParser(raw);

          const from = parsed.from?.text || 'unknown';
          const subject = parsed.subject || '(no subject)';
          const html = parsed.html || null;
          const text = parsed.text || null;

          const emailInsert = await pool.query(
            `INSERT INTO newsletter_emails (from_address, subject, body_html, body_text, received_at, processed)
             VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
            [from, subject, html, text, new Date()]
          );
          const emailId = emailInsert.rows[0].id;

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
