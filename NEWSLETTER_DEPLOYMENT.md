# Newsletter Digest Deployment Guide

## Overview
Weekly email digest feature using Buttondown for subscription management and delivery.

## Environment Variables Required

Add to `/etc/rotv/environment` on lotor (production):

```bash
# Buttondown Newsletter API
BUTTONDOWN_API_KEY=<api-key-from-buttondown-dashboard>
BUTTONDOWN_FROM_EMAIL=newsletter@rootsofthevalley.org
```

For development, add to `backend/.env`:
```bash
BUTTONDOWN_API_KEY=test_key
BUTTONDOWN_FROM_EMAIL=newsletter@rootsofthevalley.org
```

## Pre-Deployment Checklist

**Buttondown Setup:**
- [ ] Create Buttondown account at https://buttondown.com
- [ ] Verify sender email (newsletter@rootsofthevalley.org) in Buttondown dashboard
- [ ] Obtain API key from Buttondown dashboard (Settings → API)
- [ ] Add API key to environment variables

## Database Migration

Migration 018 must be applied on production:

```bash
# SSH to lotor
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Apply migration
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/backend/migrations/018_newsletter_subscriptions.sql
```

Verify migration:
```bash
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "\d newsletter_subscriptions"
```

## Post-Deployment Verification

### 1. Verify Job Scheduled
```bash
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT name, cron, timezone FROM pgboss.schedule WHERE name = 'newsletter-digest';"
```

Expected output:
```
      name         |    cron     |     timezone
-------------------+-------------+------------------
 newsletter-digest | 0 6 * * 5   | America/New_York
```

### 2. Check Application Logs
```bash
podman logs rootsofthevalley.org | grep -i digest
```

Look for:
- "Newsletter digest scheduled with cron: 0 6 * * 5"
- "Queue 'newsletter-digest' created"

### 3. Test Subscription (Via UI)
1. Visit https://rootsofthevalley.org
2. Log in with any account
3. Navigate to Settings tab
4. Go to Newsletter section
5. Enter email and click Subscribe
6. Check Buttondown dashboard for new subscriber
7. Check email inbox for Buttondown confirmation

### 4. Test Manual Digest Send (Admin Only)
```bash
# Get admin session cookie first (login via browser, copy session cookie)
curl -X POST https://rootsofthevalley.org/api/admin/newsletter/send-digest \
  -H "Cookie: connect.sid=<admin-session-cookie>"
```

Or use the Jobs Dashboard:
1. Log in as admin
2. Go to Settings → Jobs
3. Find "Newsletter Digest" card
4. Click "Run Now" button

### 5. Verify Stats Endpoint
```bash
curl https://rootsofthevalley.org/api/admin/newsletter/stats \
  -H "Cookie: connect.sid=<admin-session-cookie>"
```

Expected response:
```json
{
  "total_subscribers": 0,
  "new_this_week": 0,
  "source": "buttondown"
}
```

## How It Works

### Subscription Flow
1. User enters email in Settings → Newsletter
2. Backend calls `/api/newsletter/subscribe`
3. Email added to Buttondown via API
4. Subscription event tracked locally in `newsletter_subscriptions` table
5. Buttondown sends confirmation email to user
6. User clicks confirmation link to activate subscription

### Digest Generation & Send
1. Every Friday at 6 AM EST, pg-boss triggers `newsletter-digest` job
2. `sendWeeklyDigest()` function executes
3. Queries database for:
   - Events happening this weekend (Fri-Sun)
   - News published in last 7 days
4. Generates HTML email from template
5. Sends to all active subscribers via Buttondown API
6. Buttondown handles delivery and unsubscribe links

### Data Flow
```
User → ROTV Frontend → /api/newsletter/subscribe
         ↓
    Buttondown API (subscriber management)
         ↓
    Local DB (analytics tracking)
         ↓
    Buttondown Confirmation Email

Scheduled Job → pg-boss → sendWeeklyDigest()
                              ↓
                        Generate HTML
                              ↓
                        Buttondown API
                              ↓
                        All Subscribers
```

## Troubleshooting

### Job Not Scheduled
```bash
# Re-schedule manually via psql
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "DELETE FROM pgboss.schedule WHERE name = 'newsletter-digest';"

# Restart container to re-initialize
podman restart rootsofthevalley.org
```

### Subscription Fails
- Check Buttondown API key is correct in environment
- Verify Buttondown account is active
- Check application logs for Buttondown API errors

### Digest Not Sending
- Check pg-boss queue: `SELECT * FROM pgboss.job WHERE name = 'newsletter-digest' ORDER BY createdon DESC LIMIT 5;`
- Check job logs: `SELECT * FROM job_logs WHERE job_type = 'newsletter-digest' ORDER BY started_at DESC LIMIT 5;`
- Manually trigger via admin API to test

### No Content in Digest
Digest is only sent if there are events or news items. If database is empty, the job will complete but skip sending.

## Rollback Plan

If issues discovered:

1. **Disable scheduled job:**
   ```sql
   DELETE FROM pgboss.schedule WHERE name = 'newsletter-digest';
   ```

2. **Remove subscription form:**
   - Comment out UserSettings component in App.jsx
   - Redeploy frontend

3. **Database rollback:**
   ```sql
   DROP TABLE newsletter_subscriptions;
   ```

4. **Code rollback:**
   - Revert to previous Git tag
   - Redeploy container

## Monitoring

### Weekly Checks
- Subscriber growth: Check `/api/admin/newsletter/stats`
- Delivery rate: Check Buttondown dashboard
- Job execution: Check `pgboss.job` table for failed jobs

### Monthly Review
- Unsubscribe rate (via Buttondown)
- Email open rate (via Buttondown)
- Click-through rate (via Buttondown)
- Adjust digest content based on metrics

## Future Enhancements
- Personalization based on user watchlists
- "Most liked this week" section
- Archive of past digests on website
- A/B testing different digest formats
- Subscriber preferences (frequency, content types)
- Admin metrics dashboard
