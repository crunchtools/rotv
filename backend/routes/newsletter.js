import express from 'express';
import { isAdmin } from '../middleware/auth.js';
import { addSubscriber, getSubscriberCount, testApiKey } from '../services/buttondownClient.js';
import { triggerDigestManually, triggerPreviewManually, queueNewsletterJob } from '../services/jobScheduler.js';
import { sendDigestPreviewTo } from '../services/newsletterDigestService.js';

const router = express.Router();

export function createNewsletterRouter(pool) {
  router.post('/subscribe', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
      const subscribeResult = await addSubscriber(email, pool);

      try {
        await pool.query(
          'INSERT INTO newsletter_subscriptions (email, source) VALUES ($1, $2)',
          [email, 'web']
        );
      } catch (dbError) {
        if (!dbError.message?.includes('duplicate key')) {
          throw dbError;
        }
      }

      if (subscribeResult.status === 'already_subscribed') {
        if (subscribeResult.needsConfirmation) {
          return res.json({
            success: true,
            message: 'You\'re already subscribed! Check your email for the confirmation link (check spam folder).'
          });
        } else {
          return res.json({
            success: true,
            message: 'You\'re already subscribed to the newsletter!'
          });
        }
      }

      res.json({ success: true, message: 'Check your email to confirm subscription' });
    } catch (error) {
      console.error('Newsletter subscription error:', error.message);
      console.error('Full error:', error);

      if (error.message === 'BUTTONDOWN_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'Newsletter service is not configured yet. Please check back later!'
        });
      }

      const errorMsg = error.response?.data?.detail || error.message || 'Failed to subscribe. Please try again.';
      console.error('Buttondown API response:', error.response?.data);

      res.status(500).json({ error: errorMsg });
    }
  });

  router.get('/stats', isAdmin, async (req, res) => {
    try {
      const totalSubscribers = await getSubscriberCount();

      const recentSubscriberQuery = await pool.query(
        `SELECT COUNT(*) as new_this_week
         FROM newsletter_subscriptions
         WHERE subscribed_at > NOW() - INTERVAL '7 days'`
      );

      res.json({
        total_subscribers: totalSubscribers,
        new_this_week: parseInt(recentSubscriberQuery.rows[0].new_this_week),
        source: 'buttondown'
      });
    } catch (error) {
      console.error('Newsletter stats error:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  router.post('/send-digest', isAdmin, async (req, res) => {
    try {
      const jobId = await triggerDigestManually();
      res.json({
        success: true,
        message: 'Newsletter digest queued',
        jobId
      });
    } catch (error) {
      console.error('Newsletter trigger error:', error);
      res.status(500).json({ error: 'Failed to queue digest' });
    }
  });

  router.post('/trigger-preview', isAdmin, async (_req, res) => {
    try {
      const jobId = await triggerPreviewManually();
      res.json({ success: true, message: 'Newsletter preview queued', jobId });
    } catch (error) {
      console.error('Newsletter preview trigger error:', error);
      res.status(500).json({ error: 'Failed to queue preview' });
    }
  });

  router.post('/send-preview-test', isAdmin, async (req, res) => {
    const { email } = req.body;
    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    try {
      const previewSend = await sendDigestPreviewTo(pool, email);
      res.json(previewSend);
    } catch (error) {
      console.error('Newsletter preview send error:', error);
      const detail = error.response?.data?.detail || error.message;
      res.status(500).json({ error: detail || 'Failed to send preview' });
    }
  });

  router.post('/test-api-key', isAdmin, async (req, res) => {
    try {
      const apiKeyTestResult = await testApiKey(pool);
      console.log(`Admin ${req.user.email} tested Buttondown API key - success`);
      res.json({
        success: true,
        message: apiKeyTestResult.message,
        subscriberCount: apiKeyTestResult.subscriberCount
      });
    } catch (error) {
      console.error('Buttondown API key test failed:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'API key validation failed'
      });
    }
  });

  router.get('/sources', isAdmin, async (req, res) => {
    try {
      const rows = await pool.query(
        `SELECT s.from_pattern, s.poi_id, s.display_name, s.status, s.created_at,
                p.name AS poi_name,
                COUNT(e.id)::int AS email_count,
                MAX(e.received_at) AS last_received,
                COALESCE(SUM(e.news_extracted), 0)::int AS total_news,
                COALESCE(SUM(e.events_extracted), 0)::int AS total_events
         FROM poi_newsletter_sources s
         LEFT JOIN pois p ON p.id = s.poi_id
         LEFT JOIN newsletter_emails e
           ON POSITION(LOWER(s.from_pattern) IN LOWER(e.from_address)) > 0
         GROUP BY s.from_pattern, s.poi_id, s.display_name, s.status, s.created_at, p.name
         ORDER BY
           CASE s.status WHEN 'new' THEN 0 WHEN 'accepted' THEN 1 WHEN 'blocked' THEN 2 END,
           s.created_at DESC`
      );
      res.json(rows.rows);
    } catch (error) {
      console.error('Newsletter sources list error:', error);
      res.status(500).json({ error: 'Failed to list newsletter sources' });
    }
  });

  router.put('/sources/:pattern', isAdmin, async (req, res) => {
    const pattern = decodeURIComponent(req.params.pattern);
    const { poi_id, status, display_name } = req.body;
    try {
      const existing = await pool.query(
        'SELECT from_pattern, status FROM poi_newsletter_sources WHERE from_pattern = $1', [pattern]
      );
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Source not found' });

      const sets = [];
      const vals = [];
      let idx = 1;

      if (poi_id !== undefined) { sets.push(`poi_id = $${idx++}`); vals.push(poi_id); }
      if (status !== undefined) { sets.push(`status = $${idx++}`); vals.push(status); }
      if (display_name !== undefined) { sets.push(`display_name = $${idx++}`); vals.push(display_name); }

      if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

      vals.push(pattern);
      await pool.query(
        `UPDATE poi_newsletter_sources SET ${sets.join(', ')} WHERE from_pattern = $${idx}`,
        vals
      );

      if (status === 'accepted' && poi_id) {
        const unprocessed = await pool.query(
          `SELECT id FROM newsletter_emails
           WHERE POSITION(LOWER($1) IN LOWER(from_address)) > 0 AND processed = FALSE`,
          [pattern]
        );
        for (const row of unprocessed.rows) {
          await pool.query('UPDATE newsletter_emails SET error_message = NULL WHERE id = $1', [row.id]);
          await queueNewsletterJob(row.id);
        }
        res.json({ success: true, message: `Source accepted → POI ${poi_id}; ${unprocessed.rows.length} email(s) queued` });
      } else {
        res.json({ success: true, message: 'Source updated' });
      }
    } catch (error) {
      console.error('Newsletter source update error:', error);
      res.status(500).json({ error: 'Failed to update source' });
    }
  });

  router.get('/sources/:pattern/emails', isAdmin, async (req, res) => {
    const pattern = decodeURIComponent(req.params.pattern);
    try {
      const rows = await pool.query(
        `SELECT id, from_address, subject, received_at, processed, processed_at,
                error_message, news_extracted, events_extracted
         FROM newsletter_emails
         WHERE POSITION(LOWER($1) IN LOWER(from_address)) > 0
         ORDER BY received_at DESC
         LIMIT 50`,
        [pattern]
      );
      res.json(rows.rows);
    } catch (error) {
      console.error('Newsletter source emails error:', error);
      res.status(500).json({ error: 'Failed to list emails for source' });
    }
  });

  router.get('/sources/discover', isAdmin, async (_req, res) => {
    try {
      const rows = await pool.query(
        `SELECT e.from_address,
                COUNT(e.id)::int AS email_count,
                MAX(e.received_at) AS last_received,
                MIN(e.received_at) AS first_received
         FROM newsletter_emails e
         WHERE NOT EXISTS (
           SELECT 1 FROM poi_newsletter_sources s
           WHERE POSITION(LOWER(s.from_pattern) IN LOWER(e.from_address)) > 0
         )
         GROUP BY e.from_address
         ORDER BY MAX(e.received_at) DESC`
      );
      res.json(rows.rows);
    } catch (error) {
      console.error('Newsletter source discover error:', error);
      res.status(500).json({ error: 'Failed to discover sources' });
    }
  });

  router.post('/sources', isAdmin, async (req, res) => {
    const { from_pattern, status } = req.body;
    if (!from_pattern) return res.status(400).json({ error: 'from_pattern required' });
    try {
      await pool.query(
        `INSERT INTO poi_newsletter_sources (from_pattern, poi_id, status)
         VALUES ($1, NULL::integer, $2)
         ON CONFLICT (from_pattern) DO NOTHING`,
        [from_pattern, status || 'new']
      );
      res.json({ success: true, message: `Source "${from_pattern}" added` });
    } catch (error) {
      console.error('Newsletter source create error:', error);
      res.status(500).json({ error: 'Failed to create source' });
    }
  });

  router.delete('/sources/:pattern', isAdmin, async (req, res) => {
    const pattern = decodeURIComponent(req.params.pattern);
    try {
      const deleted = await pool.query(
        'DELETE FROM poi_newsletter_sources WHERE from_pattern = $1 RETURNING from_pattern', [pattern]
      );
      if (deleted.rows.length === 0) return res.status(404).json({ error: 'Source not found' });

      const emails = await pool.query(
        'DELETE FROM newsletter_emails WHERE POSITION(LOWER($1) IN LOWER(from_address)) > 0 RETURNING id',
        [pattern]
      );

      res.json({ success: true, message: `Deleted source and ${emails.rows.length} email(s)` });
    } catch (error) {
      console.error('Newsletter source delete error:', error);
      res.status(500).json({ error: 'Failed to delete source' });
    }
  });

  router.get('/emails/:id/view', isAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const row = await pool.query(
        'SELECT subject, body_html, body_text FROM newsletter_emails WHERE id = $1', [id]
      );
      if (row.rows.length === 0) return res.status(404).send('Not found');
      const email = row.rows[0];
      if (email.body_html) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(email.body_html);
      } else {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(email.body_text || '(empty)');
      }
    } catch (error) {
      console.error('Newsletter email view error:', error);
      res.status(500).send('Failed to load email');
    }
  });

  router.post('/inbound/:id/reprocess', isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await pool.query('UPDATE newsletter_emails SET processed = FALSE, error_message = NULL WHERE id = $1', [id]);
      await queueNewsletterJob(id);
      res.json({ success: true, message: `Email #${id} queued for reprocessing` });
    } catch (error) {
      console.error('Inbound newsletter reprocess error:', error);
      res.status(500).json({ error: 'Failed to reprocess' });
    }
  });

  return router;
}
