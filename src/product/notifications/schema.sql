-- Contractor notifications, deliveries, preferences, and escalation.
-- Apply via npm run db:schema (migration 013_notifications).

CREATE TABLE IF NOT EXISTS tc_notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL,
  lead_id TEXT,
  appointment_id TEXT,
  call_id TEXT,
  href TEXT,
  consolidate_key TEXT,
  idempotency_key TEXT NOT NULL,
  simulated BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_notifications_idem
  ON tc_notifications (organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS tc_notifications_org_created
  ON tc_notifications (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_notification_recipients (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  UNIQUE (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS tc_notification_recipients_unread
  ON tc_notification_recipients (organization_id, user_id)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS tc_notification_preferences (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  settings_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS tc_notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  recipient_user_id TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  provider_sid TEXT,
  destination TEXT,
  simulated BOOLEAN NOT NULL DEFAULT true,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_notification_deliveries_idem
  ON tc_notification_deliveries (organization_id, idempotency_key);

CREATE TABLE IF NOT EXISTS tc_notification_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  notification_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_escalation_rules (
  organization_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  primary_user_id TEXT,
  secondary_user_id TEXT,
  secondary_phone_e164 TEXT,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  sms_enabled BOOLEAN NOT NULL DEFAULT true,
  acknowledgement_required BOOLEAN NOT NULL DEFAULT true,
  delay_minutes INT NOT NULL DEFAULT 15,
  max_attempts INT NOT NULL DEFAULT 2,
  after_hours BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_escalation_attempts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  recipient_user_id TEXT,
  outcome TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_system_alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  component TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_outbox_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_outbox_events_idem
  ON tc_outbox_events (organization_id, idempotency_key);

INSERT INTO mc_schema_migrations (id)
VALUES ('013_notifications')
ON CONFLICT (id) DO NOTHING;
