-- TradeCatch contractor onboarding orchestration (Task 11).
-- Apply after 014_billing via npm run db:schema.
-- Reuses business / AI / phone / calendar / notification tables — no duplicates.

CREATE TABLE IF NOT EXISTS tc_onboarding_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES tc_organizations (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN (
      'not_started', 'in_progress', 'needs_action', 'verification_pending',
      'ready', 'active', 'suspended'
    )),
  current_step TEXT NOT NULL DEFAULT 'account'
    CHECK (current_step IN (
      'account', 'business', 'ai_receptionist', 'phone',
      'calendar', 'automations', 'activation'
    )),
  plan TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'growth', 'ai_receptionist')),
  draft_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_onboarding_steps (
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  step_id TEXT NOT NULL
    CHECK (step_id IN (
      'account', 'business', 'ai_receptionist', 'phone',
      'calendar', 'automations', 'activation'
    )),
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN (
      'not_started', 'in_progress', 'completed', 'skipped',
      'needs_verification', 'verified', 'blocked', 'failed', 'pending'
    )),
  required BOOLEAN NOT NULL DEFAULT true,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, step_id)
);

CREATE TABLE IF NOT EXISTS tc_integration_verifications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'phone', 'calendar', 'ai', 'messaging', 'test_call', 'transfer', 'subscription'
    )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'passed', 'failed', 'expired', 'skipped')),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_integration_verifications_latest
  ON tc_integration_verifications (business_id, kind);

CREATE TABLE IF NOT EXISTS tc_activation_checks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  check_id TEXT NOT NULL
    CHECK (check_id IN (
      'business_account', 'subscription', 'ai_receptionist', 'phone_number',
      'google_calendar', 'sms_automation', 'first_live_call', 'human_transfer'
    )),
  required BOOLEAN NOT NULL DEFAULT false,
  passed BOOLEAN NOT NULL DEFAULT false,
  blocking BOOLEAN NOT NULL DEFAULT false,
  label TEXT NOT NULL,
  detail TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, check_id)
);

CREATE TABLE IF NOT EXISTS tc_onboarding_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_onboarding_events_business
  ON tc_onboarding_events (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_onboarding_invitations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('owner', 'admin', 'member')),
  token_hash TEXT NOT NULL UNIQUE,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO mc_schema_migrations (id)
VALUES ('015_onboarding')
ON CONFLICT (id) DO NOTHING;
