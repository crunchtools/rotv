import { sendEmail, sendDraftToRecipients } from './buttondownClient.js';

// Return the upcoming Friday in the target TZ as an ISO timestamp.
// If today is Friday, returns today. Otherwise the next Friday after today.
// Used so admin preview sends always reflect the same query bounds the
// production cron will hit on Friday morning.
export function upcomingFridayISO(tz = 'America/New_York') {
  const now = new Date();
  const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const today = dayMap[weekdayShort];
  const daysAhead = today === 5 ? 0 : (5 - today + 7) % 7;
  return new Date(now.getTime() + daysAhead * 86400000).toISOString();
}

export async function generateDigest(pool, tz = 'America/New_York', asOfDate = null) {
  // asOfDate overrides CURRENT_TIMESTAMP in the date filters. NULL → use real now.
  const eventsQuery = `
    SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
           e.location_details, e.source_url, p.id as poi_id, p.name as poi_name, p.poi_roles
    FROM poi_events e
    JOIN pois p ON e.poi_id = p.id
    WHERE (e.start_date AT TIME ZONE $1)::date >= (COALESCE($2::timestamptz, CURRENT_TIMESTAMP) AT TIME ZONE $1)::date
      AND (e.start_date AT TIME ZONE $1)::date <= (COALESCE($2::timestamptz, CURRENT_TIMESTAMP) AT TIME ZONE $1)::date + 2
      AND e.moderation_status IN ('published', 'auto_approved')
    ORDER BY e.start_date ASC
    LIMIT 10
  `;

  const newsQuery = `
    SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
           n.publication_date, n.collection_date, p.id as poi_id, p.name as poi_name, p.poi_roles
    FROM poi_news n
    JOIN pois p ON n.poi_id = p.id
    WHERE n.moderation_status IN ('published', 'auto_approved')
      AND COALESCE(n.publication_date, n.collection_date) > COALESCE($1::timestamptz, NOW()) - INTERVAL '7 days'
    ORDER BY COALESCE(n.publication_date, n.collection_date) DESC
    LIMIT 5
  `;

  const [eventsResult, newsResult] = await Promise.all([
    pool.query(eventsQuery, [tz, asOfDate]),
    pool.query(newsQuery, [asOfDate])
  ]);

  const events = eventsResult.rows;
  const news = newsResult.rows;

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
`;

  const linkStyle = 'color: #2d5016 !important; text-decoration: underline; font-weight: 500;';

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
      <p class="poi-name">📍 ${escapeHtml(event.poi_name)}</p>
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
    console.log(`Digest already sent today (${today}), skipping duplicate send`);

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
      console.log('No content for digest this week, skipping send');

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
      console.log(`Found existing draft from earlier attempt: ${existingEmailId}`);
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

    console.log('Weekly digest sent successfully');

    if (jobId > 0) {
      await pool.query(
        `INSERT INTO job_logs (job_id, job_type, level, message, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, jobType, 'info', 'Weekly digest sent successfully', JSON.stringify({ completed: true, skipped: false })]
      );
    }

    return { success: true, skipped: false };
  } catch (error) {
    console.error('Failed to send weekly digest:', error);

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
      console.log('Buttondown not configured, skipping digest send');
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

// Generate the digest as it will appear for the upcoming Friday and send it
// via Buttondown's send-draft endpoint to a single recipient (admin preview),
// instead of scheduling to all subscribers like sendWeeklyDigest.
export async function sendDigestPreviewTo(pool, email, tz = 'America/New_York') {
  const asOf = upcomingFridayISO(tz);
  const html = await generateDigest(pool, tz, asOf);

  if (!html) {
    return { success: true, skipped: true, reason: 'No content for upcoming Friday', asOf };
  }

  const previewDate = new Date(asOf).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: tz
  });
  const subject = `What's Happening in the Valley This Weekend - ${previewDate}`;

  const { emailId } = await sendDraftToRecipients(subject, html, [email], pool);
  return { success: true, emailId, asOf, recipient: email };
}
