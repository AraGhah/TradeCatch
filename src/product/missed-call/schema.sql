-- Module A durable store. Enable with DATABASE_URL + MISSED_CALL_DURABLE_STORE=1.
-- Apply this file before first use of createPostgresStore().

CREATE TABLE IF NOT EXISTS mc_clients (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mc_calls (
  id TEXT PRIMARY KEY,
  client_account_id TEXT NOT NULL REFERENCES mc_clients (id),
  caller_e164 TEXT NOT NULL,
  twilio_call_sid TEXT UNIQUE,
  called_at TIMESTAMPTZ NOT NULL,
  disposition TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mc_workflows (
  id TEXT PRIMARY KEY,
  client_account_id TEXT NOT NULL REFERENCES mc_clients (id),
  call_id TEXT NOT NULL REFERENCES mc_calls (id),
  caller_e164 TEXT NOT NULL,
  status TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  assigned_technician_id TEXT,
  escalation_stage TEXT NOT NULL,
  outcome TEXT NOT NULL,
  retention_state TEXT NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS mc_workflows_active_dedupe
  ON mc_workflows (dedupe_key)
  WHERE status IN ('started', 'awaiting_customer', 'awaiting_technician', 'awaiting_human')
    AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mc_technician_alerts (
  id BIGSERIAL PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES mc_workflows (id),
  technician_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  action_token TEXT NOT NULL,
  stage TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  response TEXT,
  UNIQUE (workflow_id, action_token)
);

CREATE TABLE IF NOT EXISTS mc_leads (
  id TEXT PRIMARY KEY,
  client_account_id TEXT NOT NULL REFERENCES mc_clients (id),
  workflow_id TEXT NOT NULL UNIQUE REFERENCES mc_workflows (id),
  caller_e164 TEXT NOT NULL,
  retention_state TEXT NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mc_audit_events (
  id BIGSERIAL PRIMARY KEY,
  workflow_id TEXT REFERENCES mc_workflows (id),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  detail TEXT,
  actor TEXT
);

CREATE TABLE IF NOT EXISTS mc_sms_suppressions (
  client_account_id TEXT NOT NULL REFERENCES mc_clients (id),
  phone_e164 TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'sms',
  source TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  provider_status TEXT NOT NULL DEFAULT 'local_only',
  provider_detail TEXT,
  reconsent_evidence JSONB,
  note TEXT,
  PRIMARY KEY (client_account_id, phone_e164, channel)
);

CREATE TABLE IF NOT EXISTS mc_outbound_messages (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES mc_workflows (id),
  client_account_id TEXT NOT NULL REFERENCES mc_clients (id),
  to_e164 TEXT NOT NULL,
  from_e164 TEXT NOT NULL,
  body TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_sid TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mc_inbound_message_sids (
  message_sid TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mc_book_audit_leads (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company TEXT NOT NULL,
  preferred_language TEXT NOT NULL,
  service_consent BOOLEAN NOT NULL,
  marketing_consent BOOLEAN NOT NULL,
  consent_wording TEXT NOT NULL,
  consent_source TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  email_sent BOOLEAN NOT NULL DEFAULT false,
  crm_forwarded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mc_outbound_messages_queued
  ON mc_outbound_messages (status, created_at)
  WHERE status IN ('queued', 'retry');

