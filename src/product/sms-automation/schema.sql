-- SMS automation: configs, templates, scheduled jobs, consent, suppressions.
-- Jobs live in Postgres with the rest of the tenant data so the Cloudflare
-- cron worker can claim them without a logged-in contractor.
-- Apply via npm run db:schema (migration 011_sms_automation).

CREATE TABLE IF NOT EXISTS tc_sms_automations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  response_count INT NOT NULL DEFAULT 0,
  last_execution_status TEXT,
  last_execution_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, type)
);

CREATE TABLE IF NOT EXISTS tc_sms_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'fr')),
  body TEXT NOT NULL,
  customized BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, template_key, locale)
);

CREATE TABLE IF NOT EXISTS tc_sms_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  automation_id TEXT NOT NULL REFERENCES tc_sms_automations (id) ON DELETE CASCADE,
  automation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  provider_message_sid TEXT,
  customer_phone_e164 TEXT NOT NULL,
  simulated BOOLEAN NOT NULL DEFAULT false,
  cancel_reason TEXT,
  last_error TEXT,
  response_status TEXT NOT NULL DEFAULT 'none',
  price TEXT,
  price_unit TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS tc_sms_jobs_due
  ON tc_sms_jobs (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS tc_sms_jobs_org
  ON tc_sms_jobs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tc_sms_jobs_phone
  ON tc_sms_jobs (organization_id, customer_phone_e164);

CREATE UNIQUE INDEX IF NOT EXISTS tc_sms_jobs_provider_sid
  ON tc_sms_jobs (provider_message_sid)
  WHERE provider_message_sid IS NOT NULL;

CREATE TABLE IF NOT EXISTS tc_sms_executions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES tc_sms_jobs (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  provider_message_sid TEXT,
  message_body TEXT,
  simulated BOOLEAN NOT NULL DEFAULT false,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_sms_executions_org
  ON tc_sms_executions (organization_id, at DESC);

CREATE TABLE IF NOT EXISTS tc_sms_suppressions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone_key)
);

CREATE TABLE IF NOT EXISTS tc_sms_consent (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  purpose TEXT NOT NULL,
  basis TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_sms_consent_phone
  ON tc_sms_consent (organization_id, phone_e164, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_sms_automation_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  automation_id TEXT,
  job_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_sms_automation_events_org
  ON tc_sms_automation_events (organization_id, at DESC);

CREATE TABLE IF NOT EXISTS tc_sms_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

INSERT INTO mc_schema_migrations (id)
VALUES ('011_sms_automation')
ON CONFLICT (id) DO NOTHING;
