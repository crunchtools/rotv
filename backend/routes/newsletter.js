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

  router.get('/inbound', isAdmin, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const rows = await pool.query(
        `SELECT e.id, e.from_address, e.subject, e.received_at, e.processed, e.processed_at,
                e.error_message, e.news_extracted, e.events_extracted,
                s.poi_id, p.name AS poi_name
         FROM newsletter_emails e
         LEFT JOIN LATERAL (
           SELECT src.poi_id FROM poi_newsletter_sources src
           WHERE POSITION(LOWER(src.from_pattern) IN LOWER(e.from_address)) > 0
           ORDER BY LENGTH(src.from_pattern) DESC LIMIT 1
         ) s ON TRUE
         LEFT JOIN pois p ON p.id = s.poi_id
         ORDER BY e.received_at DESC
         LIMIT $1`,
        [limit]
      );
      res.json(rows.rows);
    } catch (error) {
      console.error('Inbound newsletter list error:', error);
      res.status(500).json({ error: 'Failed to list inbound newsletters' });
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

  router.post('/inbound/:id/assign-poi', isAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { poi_id, from_pattern } = req.body;
    if (!poi_id) return res.status(400).json({ error: 'poi_id required' });
    try {
      const emailRow = await pool.query('SELECT from_address FROM newsletter_emails WHERE id = $1', [id]);
      if (emailRow.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const pattern = (from_pattern && from_pattern.trim()) || emailRow.rows[0].from_address;
      if (!pattern) return res.status(400).json({ error: 'No sender pattern available' });
      await pool.query(
        `INSERT INTO poi_newsletter_sources (poi_id, from_pattern)
         VALUES ($1, $2) ON CONFLICT (poi_id, from_pattern) DO NOTHING`,
        [poi_id, pattern]
      );
      await pool.query('UPDATE newsletter_emails SET processed = FALSE, error_message = NULL WHERE id = $1', [id]);
      await queueNewsletterJob(id);
      res.json({ success: true, message: `Mapped "${pattern}" → POI ${poi_id}` });
    } catch (error) {
      console.error('Inbound newsletter assign-poi error:', error);
      res.status(500).json({ error: 'Failed to assign POI' });
    }
  });

  return router;
}
