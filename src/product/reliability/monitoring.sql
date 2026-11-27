-- KAN-28: monitoring, error detection and automatic administrator alerts.
-- Additive on top of 014_reliability: nothing is dropped or rewritten, every
-- statement is idempotent, and rows created before this migration stay valid
-- (the new incident columns are nullable or defaulted). Applied by
-- npm run db:schema as migration 063_monitoring_alerts.

-- Group repeated failures: every recorded error carries its incident
-- fingerprint, so "how many of these" is one indexed count, not a table scan.
ALTER TABLE tc_system_errors ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE INDEX IF NOT EXISTS tc_system_errors_fingerprint
  ON tc_system_errors (fingerprint, created_at DESC)
  WHERE fingerprint IS NOT NULL;

ALTER TABLE tc_system_incidents
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS affected_businesses INT,
  ADD COLUMN IF NOT EXISTS quiet_ms BIGINT,
  ADD COLUMN IF NOT EXISTS reopen_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alerted_priority TEXT,
  ADD COLUMN IF NOT EXISTS simulated BOOLEAN NOT NULL DEFAULT false;

-- At most one live (not resolved) incident per fingerprint, enforced by the
-- database so two overlapping monitor runs cannot open two.
CREATE UNIQUE INDEX IF NOT EXISTS tc_system_incidents_live_fingerprint
  ON tc_system_incidents (fingerprint)
  WHERE fingerprint IS NOT NULL AND status <> 'resolved';
CREATE INDEX IF NOT EXISTS tc_system_incidents_status
  ON tc_system_incidents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_incident_events_incident
  ON tc_incident_events (incident_id, at);

-- Administrator alert outbox: one row per alert email, with bounded retries.
-- last_error holds a short code (send_failed, timeout, not_configured), never
-- a provider message. The idempotency key makes enqueueing safe to repeat.
CREATE TABLE IF NOT EXISTS tc_alert_deliveries (
  id TEXT PRIMARY KEY,
  incident_id TEXT,
  kind TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS tc_alert_deliveries_idem
  ON tc_alert_deliveries (idempotency_key);
CREATE INDEX IF NOT EXISTS tc_alert_deliveries_due
  ON tc_alert_deliveries (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS tc_alert_deliveries_incident
  ON tc_alert_deliveries (incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_alert_deliveries_created
  ON tc_alert_deliveries (created_at DESC);

-- One availability probe result (website page, public API, database write).
CREATE TABLE IF NOT EXISTS tc_monitor_probes (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  status_code INT,
  duration_ms INT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tc_monitor_probes_at ON tc_monitor_probes (at DESC);

-- Real request outcomes, aggregated per minute and scope by the Worker. Counts
-- only: no path, no user, no body. lat0..lat6 is the latency histogram
-- (<=100, 250, 500, 1000, 2500, 5000 ms, and over). Pruned after 72 hours.
CREATE TABLE IF NOT EXISTS tc_monitor_buckets (
  bucket_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL,
  total INT NOT NULL DEFAULT 0,
  s2xx INT NOT NULL DEFAULT 0,
  s3xx INT NOT NULL DEFAULT 0,
  s401 INT NOT NULL DEFAULT 0,
  s403 INT NOT NULL DEFAULT 0,
  s429 INT NOT NULL DEFAULT 0,
  s4xx_other INT NOT NULL DEFAULT 0,
  s5xx INT NOT NULL DEFAULT 0,
  lat0 INT NOT NULL DEFAULT 0,
  lat1 INT NOT NULL DEFAULT 0,
  lat2 INT NOT NULL DEFAULT 0,
  lat3 INT NOT NULL DEFAULT 0,
  lat4 INT NOT NULL DEFAULT 0,
  lat5 INT NOT NULL DEFAULT 0,
  lat6 INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_at, scope)
);

-- Keeps the once-a-minute signal queries cheap on the busiest tables. The
-- monitor only ever asks "what changed in the last few minutes"; without these
-- each of those reads would scan the whole table. Guarded so the migration
-- still applies on a database that lacks one of the optional product schemas.
CREATE INDEX IF NOT EXISTS tc_system_errors_service_time
  ON tc_system_errors (service, created_at DESC);
DO $$
BEGIN
  IF to_regclass('tc_sms_jobs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS tc_sms_jobs_updated ON tc_sms_jobs (updated_at DESC);
  END IF;
  IF to_regclass('mc_outbound_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS mc_outbound_messages_updated ON mc_outbound_messages (updated_at DESC);
  END IF;
  IF to_regclass('tc_notification_deliveries') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS tc_notification_deliveries_updated ON tc_notification_deliveries (updated_at DESC);
  END IF;
  IF to_regclass('rc_call_sessions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS rc_call_sessions_started ON rc_call_sessions (started_at DESC);
  END IF;
END $$;

-- Server-only data: not reachable through the Supabase data API.
ALTER TABLE tc_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_monitor_probes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_monitor_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tc_alert_deliveries, tc_monitor_probes, tc_monitor_buckets FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON tc_alert_deliveries, tc_monitor_probes, tc_monitor_buckets FROM %I', api_role);
  END LOOP;
END $$;
