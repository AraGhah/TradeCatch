-- TC-011/012: bounded SMS recovery and durable dispatch quota reservations.
ALTER TABLE tc_notification_deliveries ADD COLUMN IF NOT EXISTS recovery_handled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS tc_notification_deliveries_due ON tc_notification_deliveries (next_attempt_at, created_at) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS tc_notification_deliveries_sid ON tc_notification_deliveries (provider_sid) WHERE provider_sid IS NOT NULL;
CREATE TABLE IF NOT EXISTS tc_notification_dispatches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS tc_notification_dispatches_quota ON tc_notification_dispatches (organization_id, reserved_at);
ALTER TABLE tc_notification_dispatches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON tc_notification_dispatches FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON tc_notification_dispatches FROM authenticated;
  END IF;
END $$;
REVOKE ALL ON tc_notification_dispatches FROM PUBLIC;
UPDATE tc_notification_preferences SET settings_json=jsonb_set(settings_json,'{dailySummary}','false'::jsonb)
WHERE settings_json->>'dailySummary'='true';
INSERT INTO mc_schema_migrations (id) VALUES ('023_notification_delivery_reliability') ON CONFLICT DO NOTHING;
