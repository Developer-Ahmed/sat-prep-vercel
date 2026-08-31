CREATE TABLE clerk_webhook_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[A-Za-z0-9_-]{8,200}$'),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.]{2,100}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE INDEX idx_clerk_webhook_events_received
  ON clerk_webhook_events (received_at);
