-- Operational monitoring records. Detailed logs stay in Cloudflare.
-- Apply via npm run db:schema (migration 014_reliability).

CREATE TABLE IF NOT EXISTS tc_system_errors (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  organization_id TEXT,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  error_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  retryable BOOLEAN NOT NULL DEFAULT false,
  attempt_count INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  detail TEXT,
  environment TEXT NOT NULL,
  simulated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_system_errors_created
  ON tc_system_errors (created_at DESC);

CREATE TABLE IF NOT EXISTS tc_system_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  service TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tc_incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  actor TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_health_checks (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_failed_operations (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  retryable BOOLEAN NOT NULL DEFAULT false,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  simulated BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_failed_operations_idem
  ON tc_failed_operations (idempotency_key);

CREATE TABLE IF NOT EXISTS tc_recovery_attempts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  actor TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_deployments (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deployed_by TEXT
);

CREATE TABLE IF NOT EXISTS tc_usage_costs (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  service TEXT NOT NULL,
  units NUMERIC NOT NULL,
  estimated_cents INT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  simulated BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_fallback_settings (
  organization_id TEXT PRIMARY KEY,
  ai_unavailable TEXT NOT NULL DEFAULT 'transfer',
  calendar_unavailable TEXT NOT NULL DEFAULT 'collect_request',
  database_unavailable TEXT NOT NULL DEFAULT 'do_not_claim_saved',
  transfer_failed TEXT NOT NULL DEFAULT 'voicemail',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_api_observations (
  id TEXT PRIMARY KEY,
  status_class TEXT NOT NULL,
  duration_ms INT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO mc_schema_migrations (id)
VALUES ('014_reliability')
ON CONFLICT (id) DO NOTHING;
