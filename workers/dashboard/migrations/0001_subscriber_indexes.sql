CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
CREATE INDEX IF NOT EXISTS idx_subscribers_source ON subscribers(source);
CREATE INDEX IF NOT EXISTS idx_subscribers_subscribed_at ON subscribers(subscribed_at);
