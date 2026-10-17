-- Pilot and launch records. They point at existing businesses.
-- Apply via npm run db:schema (migration 017_launch).

CREATE TABLE IF NOT EXISTS tc_pilot_accounts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  industry TEXT,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  phone_e164 TEXT,
  starts_on DATE,
  ends_on DATE,
  features_json JSONB NOT NULL DEFAULT '{}',
  onboarding_status TEXT NOT NULL,
  phone_status TEXT NOT NULL,
  ai_status TEXT NOT NULL,
  pilot_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_pilot_feedback (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL,
  reference TEXT,
  status TEXT NOT NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_pilot_tests (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL,
  scenario TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tc_pilot_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_production_activations (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL,
  features_json JSONB NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tc_launch_checks (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  checked_at TIMESTAMPTZ NOT NULL
);

INSERT INTO mc_schema_migrations (id) VALUES ('017_launch') ON CONFLICT (id) DO NOTHING;
