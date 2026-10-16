-- Security, privacy, consent, and incident records.
-- Apply via npm run db:schema (migration 015_security).

ALTER TABLE tc_memberships DROP CONSTRAINT IF EXISTS tc_memberships_role_check;
ALTER TABLE tc_memberships
  ADD CONSTRAINT tc_memberships_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

CREATE TABLE IF NOT EXISTS tc_audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_consent_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_privacy_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tc_data_retention_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  category TEXT NOT NULL,
  retain_days INT NOT NULL,
  UNIQUE (organization_id, category)
);

CREATE TABLE IF NOT EXISTS tc_security_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tc_recording_permissions (
  organization_id TEXT PRIMARY KEY,
  disclosure_enabled BOOLEAN NOT NULL DEFAULT true,
  recording_enabled BOOLEAN NOT NULL DEFAULT false,
  retention_days INT NOT NULL DEFAULT 30,
  on_denied TEXT NOT NULL DEFAULT 'continue_without_recording',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_mfa_secrets (
  user_id TEXT PRIMARY KEY,
  secret_ciphertext TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_mfa_verifications (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tc_login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_webhook_receipts (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

INSERT INTO mc_schema_migrations (id) VALUES ('015_security') ON CONFLICT (id) DO NOTHING;
