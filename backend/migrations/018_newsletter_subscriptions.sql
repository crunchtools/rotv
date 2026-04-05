-- Migration 018: Newsletter Subscriptions
-- Create table for tracking newsletter subscription events
-- Note: Buttondown is the source of truth for active subscribers.
-- This table is for local analytics only.

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    subscribed_at TIMESTAMPTZ DEFAULT NOW(),
    source VARCHAR(50) DEFAULT 'web',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_newsletter_subscriptions_email ON newsletter_subscriptions(email);
CREATE INDEX idx_newsletter_subscriptions_subscribed_at ON newsletter_subscriptions(subscribed_at);

COMMENT ON TABLE newsletter_subscriptions IS 'Local tracking of newsletter subscription events. Buttondown is source of truth for active subscribers.';
COMMENT ON COLUMN newsletter_subscriptions.email IS 'Subscriber email address';
COMMENT ON COLUMN newsletter_subscriptions.subscribed_at IS 'Timestamp when subscription was initiated';
COMMENT ON COLUMN newsletter_subscriptions.source IS 'Source of subscription (web, api, etc.)';
