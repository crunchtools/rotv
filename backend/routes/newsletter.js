import express from 'express';
import { isAdmin } from '../middleware/auth.js';
import { addSubscriber, getSubscriberCount, testApiKey } from '../services/buttondownClient.js';
import { triggerDigestManually } from '../services/jobScheduler.js';

const router = express.Router();

export function createNewsletterRouter(pool) {
  // Subscribe to newsletter (public endpoint)
  router.post('/subscribe', async (req, res) => {
    const { email } = req.body;

    // Validate email format
    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
      // Add to Buttondown (idempotent - handles duplicates gracefully)
      const result = await addSubscriber(email, pool);

      // Track locally for analytics (but ignore duplicates)
      try {
        await pool.query(
          'INSERT INTO newsletter_subscriptions (email, source) VALUES ($1, $2)',
          [email, 'web']
        );
      } catch (dbError) {
        // Ignore duplicate key errors in local tracking
        if (!dbError.message?.includes('duplicate key')) {
          throw dbError;
        }
      }

      // Check if already subscribed
      if (result.status === 'already_subscribed') {
        if (result.needsConfirmation) {
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

      // Show more specific error for debugging
      const errorMsg = error.response?.data?.detail || error.message || 'Failed to subscribe. Please try again.';
      console.error('Buttondown API response:', error.response?.data);

      res.status(500).json({ error: errorMsg });
    }
  });

  // Get newsletter stats (admin only)
  router.get('/stats', isAdmin, async (req, res) => {
    try {
      const totalSubscribers = await getSubscriberCount();

      // Count new subscriptions in last 7 days from local tracking
      const result = await pool.query(
        `SELECT COUNT(*) as new_this_week
         FROM newsletter_subscriptions
         WHERE subscribed_at > NOW() - INTERVAL '7 days'`
      );

      res.json({
        total_subscribers: totalSubscribers,
        new_this_week: parseInt(result.rows[0].new_this_week),
        source: 'buttondown'
      });
    } catch (error) {
      console.error('Newsletter stats error:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Manually trigger digest send (admin only, for testing)
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

  // Test Buttondown API key (admin only)
  router.post('/test-api-key', isAdmin, async (req, res) => {
    try {
      const result = await testApiKey(pool);
      console.log(`Admin ${req.user.email} tested Buttondown API key - success`);
      res.json({
        success: true,
        message: result.message,
        subscriberCount: result.subscriberCount
      });
    } catch (error) {
      console.error('Buttondown API key test failed:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'API key validation failed'
      });
    }
  });

  return router;
}
