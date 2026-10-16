-- Unified CRM (customers, leads, conversations, messages).
-- Apply via npm run db:schema (migration 010_crm_leads).

CREATE TABLE IF NOT EXISTS tc_customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  email TEXT,
  service_address TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'fr'
    CHECK (preferred_language IN ('en', 'fr')),
  allow_sms BOOLEAN NOT NULL DEFAULT true,
  allow_email BOOLEAN NOT NULL DEFAULT true,
  first_contact_at TIMESTAMPTZ NOT NULL,
  last_contact_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone_key)
);

CREATE INDEX IF NOT EXISTS tc_customers_org_last
  ON tc_customers (organization_id, last_contact_at DESC);

CREATE TABLE IF NOT EXISTS tc_leads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES tc_customers (id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  service TEXT,
  description TEXT,
  location TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to_user_id TEXT,
  assigned_to_name TEXT,
  call_session_id TEXT,
  call_sid TEXT,
  missed_call_lead_id TEXT,
  website_lead_id TEXT,
  conversation_id TEXT,
  urgency_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_leads_org_created
  ON tc_leads (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_leads_org_status
  ON tc_leads (organization_id, status);
CREATE INDEX IF NOT EXISTS tc_leads_customer
  ON tc_leads (organization_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_lead_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES tc_leads (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT,
  actor TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_lead_events_lead
  ON tc_lead_events (lead_id, at ASC);

CREATE TABLE IF NOT EXISTS tc_conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES tc_customers (id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES tc_leads (id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'sms',
  control TEXT NOT NULL DEFAULT 'ai_managed',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_conversations_org
  ON tc_conversations (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tc_crm_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES tc_conversations (id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  from_e164 TEXT,
  to_e164 TEXT,
  automated BOOLEAN NOT NULL DEFAULT false,
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  provider_message_sid TEXT,
  simulated BOOLEAN NOT NULL DEFAULT false,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_crm_messages_provider_sid
  ON tc_crm_messages (provider_message_sid)
  WHERE provider_message_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_crm_messages_conversation
  ON tc_crm_messages (conversation_id, at ASC);
