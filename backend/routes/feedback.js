import express from 'express';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

function sanitizeForMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

const TYPE_LABELS = {
  bug: 'bug',
  feature: 'enhancement',
  general: 'feedback'
};

const TYPE_DISPLAY = {
  bug: 'Bug Report',
  feature: 'Feature Request',
  general: 'General Feedback'
};

export function createFeedbackRouter(pool) {
  router.post('/', feedbackLimiter, async (req, res) => {
    const { type, message, name, email, hp } = req.body;

    if (hp) {
      return res.status(201).json({ success: true, issueNumber: 0 });
    }

    if (!type || !TYPE_LABELS[type]) {
      return res.status(400).json({ error: 'Invalid feedback type. Must be: bug, feature, or general.' });
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const trimmed = message.trim();
    if (trimmed.length < 10) {
      return res.status(400).json({ error: 'Message must be at least 10 characters.' });
    }
    if (trimmed.length > 1000) {
      return res.status(400).json({ error: 'Message must be 1000 characters or fewer.' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    let token;
    try {
      const result = await pool.query("SELECT value FROM admin_settings WHERE key = 'github_api_token'");
      token = result.rows[0]?.value;
    } catch (err) {
      console.error('Failed to read GitHub token from admin_settings:', err.message);
    }
    token = token || process.env.GITHUB_TOKEN;

    if (!token) {
      console.error('GitHub token not configured — cannot create feedback issue');
      return res.status(503).json({ error: 'Feedback service is temporarily unavailable. Please try again later.' });
    }

    const titlePreview = trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
    const title = `[Feedback] ${TYPE_DISPLAY[type]}: ${titlePreview}`;

    let body = `## User Feedback\n\n**Type:** ${TYPE_DISPLAY[type]}\n\n**Message:**\n${sanitizeForMarkdown(trimmed)}\n\n---\n*Submitted via ROTV feedback form*`;
    if (name) {
      body += `\n*Name: ${sanitizeForMarkdown(name.trim().substring(0, 100))}*`;
    }
    if (email) {
      body += `\n*Email: ${sanitizeForMarkdown(email.trim())}*`;
    }

    const labels = [TYPE_LABELS[type], 'user-submitted'];

    try {
      const response = await fetch('https://api.github.com/repos/crunchtools/rotv/issues', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title, body, labels })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GitHub API error (${response.status}): ${errorBody}`);
        return res.status(502).json({ error: 'Failed to submit feedback. Please try again later.' });
      }

      const issue = await response.json();
      res.status(201).json({ success: true, issueNumber: issue.number });
    } catch (err) {
      console.error('GitHub API request failed:', err.message);
      res.status(502).json({ error: 'Failed to submit feedback. Please try again later.' });
    }
  });

  return router;
}
