-- Advanced CRM integrations (CRM_INTEGRATION_ADVANCED, Receptionist tier):
-- multiple named, event-filtered webhook endpoints per organization, plus
-- the endpoint reference on the existing dead-letter queue for per-endpoint
-- retries. Apply after schema-crm.sql. npm run db:schema

CREATE TABLE IF NOT EXISTS tc_crm_webhook_endpoints (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label TEXT NOT NULL,
  event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_crm_webhook_endpoints_org
  ON tc_crm_webhook_endpoints (organization_id);

ALTER TABLE tc_crm_dlq
  ADD COLUMN IF NOT EXISTS endpoint_id TEXT
    REFERENCES tc_crm_webhook_endpoints (id) ON DELETE SET NULL;

INSERT INTO mc_schema_migrations (id)
VALUES ('032_advanced_crm_integrations')
ON CONFLICT (id) DO NOTHING;
