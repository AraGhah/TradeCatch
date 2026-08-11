-- CRM webhook URL on org settings + dead-letter queue for retries.
-- Apply after growth schema. npm run db:schema

ALTER TABLE tc_org_settings
  ADD COLUMN IF NOT EXISTS crm_webhook_url TEXT;

CREATE TABLE IF NOT EXISTS tc_crm_dlq (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  last_error TEXT,
  attempts INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_crm_dlq_retry
  ON tc_crm_dlq (updated_at ASC)
  WHERE attempts < 8;

INSERT INTO mc_schema_migrations (id)
VALUES ('005_crm_webhook_dlq')
ON CONFLICT (id) DO NOTHING;
