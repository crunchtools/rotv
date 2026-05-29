CREATE TABLE IF NOT EXISTS user_notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key VARCHAR(128) NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_reads_user
  ON user_notification_reads(user_id);
