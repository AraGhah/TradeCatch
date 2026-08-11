-- Starter product tables (website leads, quote follow-up, inbox).
-- Apply after saas schema. npm run db:schema

CREATE TABLE IF NOT EXISTS tc_website_leads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'website',
  name TEXT,
  email TEXT,
  phone_e164 TEXT,
  message TEXT,
  service_requested TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'needs_attention', 'closed', 'spam')),
  conversation_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (conversation_mode IN ('auto', 'needs_attention', 'human', 'resolved')),
  idempotency_key TEXT,
  consent_at TIMESTAMPTZ,
  consent_wording TEXT,
  opening_sms_sent BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_website_leads_idempotency
  ON tc_website_leads (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_website_leads_org_created
  ON tc_website_leads (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_quote_threads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  client_account_id TEXT,
  customer_phone_e164 TEXT NOT NULL,
  customer_name TEXT,
  quote_ref TEXT,
  quote_amount NUMERIC,
  quote_sent_at TIMESTAMPTZ NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fr')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'stopped', 'won', 'lost')),
  stop_reason TEXT,
  conversation_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (conversation_mode IN ('auto', 'needs_attention', 'human', 'resolved')),
  next_step_index INT NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_customer_reply_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_quote_threads_due
  ON tc_quote_threads (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_quote_threads_org
  ON tc_quote_threads (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tc_quote_threads_phone_active
  ON tc_quote_threads (organization_id, customer_phone_e164)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS tc_quote_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES tc_quote_threads (id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  body TEXT NOT NULL,
  step_index INT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_inbox_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('missed_call', 'website_lead', 'quote')),
  ref_id TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'claimed', 'resolved')),
  claimed_by_user_id TEXT REFERENCES tc_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS tc_inbox_items_org_open
  ON tc_inbox_items (organization_id, created_at DESC)
  WHERE status IN ('open', 'claimed');

CREATE TABLE IF NOT EXISTS tc_org_api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

INSERT INTO mc_schema_migrations (id)
VALUES ('003_starter_features')
ON CONFLICT (id) DO NOTHING;
