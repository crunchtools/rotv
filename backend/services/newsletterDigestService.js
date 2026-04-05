import { sendEmail } from './buttondownClient.js';

/**
 * Generate HTML digest content for weekly newsletter
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<string>} HTML digest content
 */
export async function generateDigest(pool) {
  // Get events happening Friday-Sunday (next 3 days from Friday)
  const eventsQuery = `
    SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
           e.location_details, e.source_url, p.id as poi_id, p.name as poi_name, p.poi_type
    FROM poi_events e
    JOIN pois p ON e.poi_id = p.id
    WHERE e.start_date >= CURRENT_DATE
      AND e.start_date <= CURRENT_DATE + INTERVAL '2 days'
      AND e.moderation_status IN ('published', 'auto_approved')
    ORDER BY e.start_date ASC
    LIMIT 10
  `;

  // Get news published in last 7 days
  const newsQuery = `
    SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
           n.published_at, n.created_at, p.id as poi_id, p.name as poi_name, p.poi_type
    FROM poi_news n
    JOIN pois p ON n.poi_id = p.id
    WHERE n.moderation_status IN ('published', 'auto_approved')
      AND COALESCE(n.published_at, n.created_at) > NOW() - INTERVAL '7 days'
    ORDER BY COALESCE(n.published_at, n.created_at) DESC
    LIMIT 5
  `;

  const [eventsResult, newsResult] = await Promise.all([
    pool.query(eventsQuery),
    pool.query(newsQuery)
  ]);

  const events = eventsResult.rows;
  const news = newsResult.rows;

  // If no content, return empty string
  if (events.length === 0 && news.length === 0) {
    return '';
  }

  // Build HTML digest
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
      color: #2c5f2d;
      border-bottom: 3px solid #2c5f2d;
      padding-bottom: 10px;
      margin-top: 0;
    }
    h2 {
      color: #2c5f2d;
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
    .event-title, .news-title {
      font-size: 1.1em;
      font-weight: bold;
      margin-bottom: 5px;
      color: #1a1a1a;
    }
    .event-date {
      color: #666;
      font-size: 0.9em;
      margin-bottom: 5px;
    }
    .poi-name {
      color: #2c5f2d;
      font-weight: 500;
      font-size: 0.9em;
    }
    .description, .summary {
      margin-top: 8px;
      color: #555;
    }
    .read-more {
      color: #2c5f2d;
      text-decoration: none;
      font-weight: 500;
    }
    .read-more:hover {
      text-decoration: underline;
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
      color: #2c5f2d;
      text-decoration: none;
    }
    .no-content {
      color: #666;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>What's Happening in the Valley This Weekend</h1>
    <p>Your weekly digest from <a href="https://rootsofthevalley.org" style="color: #2c5f2d;">Roots of The Valley</a></p>
`;

  // Events section
  if (events.length > 0) {
    html += `
    <h2>🎉 Events This Weekend</h2>
`;
    events.forEach(event => {
      const startDate = new Date(event.start_date);
      const dateStr = startDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });

      html += `
    <div class="event">
      <div class="event-title">${escapeHtml(event.title)}</div>
      <div class="event-date">📅 ${dateStr}</div>
      <div class="poi-name">📍 ${escapeHtml(event.poi_name)}</div>
`;
      if (event.description) {
        html += `      <div class="description">${escapeHtml(event.description)}</div>\n`;
      }
      if (event.source_url) {
        html += `      <div><a href="${escapeHtml(event.source_url)}" class="read-more">Learn more →</a></div>\n`;
      }
      html += `    </div>\n`;
    });
  }

  // News section
  if (news.length > 0) {
    html += `
    <h2>📰 Recent News</h2>
`;
    news.forEach(item => {
      html += `
    <div class="news-item">
      <div class="news-title">${escapeHtml(item.title)}</div>
      <div class="poi-name">${escapeHtml(item.poi_name)}</div>
`;
      if (item.summary) {
        html += `      <div class="summary">${escapeHtml(item.summary)}</div>\n`;
      }
      if (item.source_url) {
        html += `      <div><a href="${escapeHtml(item.source_url)}" class="read-more">Read full article →</a></div>\n`;
      }
      html += `    </div>\n`;
    });
  }

  // No content fallback
  if (events.length === 0 && news.length === 0) {
    html += `
    <p class="no-content">No events or news available this week. Check back next Friday!</p>
`;
  }

  // Footer
  html += `
    <div class="footer">
      <p>Roots of The Valley is an open-source community project for the Cuyahoga Valley.</p>
      <p><a href="https://rootsofthevalley.org">Visit rootsofthevalley.org</a></p>
    </div>
  </div>
</body>
</html>
`;

  return html;
}

/**
 * Send weekly digest to all subscribers
 * @param {Pool} pool - Database connection pool
 * @param {string} pgBossJobId - pg-boss job ID for tracking
 * @returns {Promise<Object>} Result object with success status
 */
export async function sendWeeklyDigest(pool, pgBossJobId = null) {
  // Hash UUID to a signed 32-bit integer (max: 2147483647)
  let jobId = 0;
  if (pgBossJobId) {
    // Simple hash: sum character codes and modulo by max signed int32
    let hash = 0;
    for (let i = 0; i < pgBossJobId.length; i++) {
      hash = ((hash << 5) - hash) + pgBossJobId.charCodeAt(i);
      hash = hash & 0x7FFFFFFF; // Keep within signed int32 range
    }
    jobId = hash;
  }
  const jobType = 'newsletter-digest';

  // Log job start
  if (jobId > 0) {
    await pool.query(
      'INSERT INTO job_logs (job_id, job_type, level, message) VALUES ($1, $2, $3, $4)',
      [jobId, jobType, 'info', 'Starting newsletter digest generation']
    );
  }

  try {
    // 1. Generate digest HTML
    const digestHtml = await generateDigest(pool);

    // 2. If no content, skip sending
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

    // 3. Send via Buttondown
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    // In development, add time to allow multiple sends per day for testing
    // In production, Buttondown's duplicate detection prevents accidental double-sends
    const subject = process.env.NODE_ENV === 'development'
      ? `What's Happening in the Valley This Weekend - ${dateStr} @ ${today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
      : `What's Happening in the Valley This Weekend - ${dateStr}`;

    await sendEmail(subject, digestHtml, pool);

    console.log('Weekly digest sent successfully');

    // Log successful completion
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

    // Log error with full details (including buttondownDetails if available)
    if (jobId > 0) {
      const errorDetails = {
        completed: false,
        error: error.message,
        status: error.response?.status,
        buttondownResponse: error.response?.data,
        buttondownDetails: error.buttondownDetails, // Added by buttondownClient.js
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

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
