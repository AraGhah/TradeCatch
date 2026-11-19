-- Administration console (KAN-20).
-- Apply with the other schemas: npm run db:schema  (migration id 041_admin_console)
--
-- Everything here is ADDITIVE and safe to re-run:
--   1. tc_audit_logs gains who/what columns and becomes append-only.
--   2. tc_billing_events records payment outcomes Stripe reports, so a failed
--      payment is visible to administrators even though the subscription state
--      table only keeps the latest status.
--   3. tc_website_requests gains the Approved / Rejected statuses, payment
--      tracking and a team-notification record; tc_website_request_events keeps
--      the request's history.

-- 1. Audit log ---------------------------------------------------------------

ALTER TABLE tc_audit_logs ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE tc_audit_logs ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE tc_audit_logs ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success';
ALTER TABLE tc_audit_logs ADD COLUMN IF NOT EXISTS changes JSONB;

ALTER TABLE tc_audit_logs DROP CONSTRAINT IF EXISTS tc_audit_logs_outcome_check;
ALTER TABLE tc_audit_logs
  ADD CONSTRAINT tc_audit_logs_outcome_check
  CHECK (outcome IN ('success', 'denied', 'failed'));

CREATE INDEX IF NOT EXISTS tc_audit_logs_created
  ON tc_audit_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS tc_audit_logs_actor
  ON tc_audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_audit_logs_org
  ON tc_audit_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_audit_logs_action
  ON tc_audit_logs (action, created_at DESC);

-- The audit trail can be added to, never edited or removed. The application has
-- no code path that does either, and this makes the database refuse it too, so a
-- bug, a stray script or a compromised route cannot rewrite history. (A database
-- owner can still disable the trigger on purpose; TRUNCATE is left available
-- because the staging demo reset uses it and is gated to staging.)
CREATE OR REPLACE FUNCTION tc_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS tc_audit_logs_append_only ON tc_audit_logs;
CREATE TRIGGER tc_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON tc_audit_logs
  FOR EACH ROW EXECUTE FUNCTION tc_append_only();

-- 2. Billing events ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tc_billing_events (
  -- The Stripe event id, so a redelivered webhook never records twice.
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  organization_id TEXT REFERENCES tc_organizations (id) ON DELETE SET NULL,
  customer_id TEXT,
  subscription_id TEXT,
  invoice_id TEXT,
  amount_cents BIGINT,
  currency TEXT,
  attempt_count INT,
  next_attempt_at TIMESTAMPTZ,
  outcome TEXT NOT NULL CHECK (outcome IN ('failed', 'succeeded', 'action_required')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_billing_events_created
  ON tc_billing_events (created_at DESC);
CREATE INDEX IF NOT EXISTS tc_billing_events_org
  ON tc_billing_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_billing_events_outcome
  ON tc_billing_events (outcome, created_at DESC);

-- 3. Website requests ------------------------------------------------------------

ALTER TABLE tc_website_requests DROP CONSTRAINT IF EXISTS tc_website_requests_status_check;
ALTER TABLE tc_website_requests
  ADD CONSTRAINT tc_website_requests_status_check
  CHECK (status IN ('submitted', 'in_review', 'approved', 'quoted', 'in_progress', 'delivered', 'rejected', 'cancelled'));

ALTER TABLE tc_website_requests
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE tc_website_requests DROP CONSTRAINT IF EXISTS tc_website_requests_payment_status_check;
ALTER TABLE tc_website_requests
  ADD CONSTRAINT tc_website_requests_payment_status_check
  CHECK (payment_status IN ('not_requested', 'requested', 'paid', 'waived'));

ALTER TABLE tc_website_requests ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE tc_website_requests ADD COLUMN IF NOT EXISTS notification_status TEXT;
ALTER TABLE tc_website_requests DROP CONSTRAINT IF EXISTS tc_website_requests_notification_status_check;
ALTER TABLE tc_website_requests
  ADD CONSTRAINT tc_website_requests_notification_status_check
  CHECK (notification_status IS NULL OR notification_status IN ('sent', 'not_configured', 'failed'));

CREATE INDEX IF NOT EXISTS tc_website_requests_payment
  ON tc_website_requests (payment_status, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_website_request_events (
  id TEXT PRIMARY KEY,
  -- Keeps insertion order for lines written by the same statement.
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  request_id TEXT NOT NULL REFERENCES tc_website_requests (id),
  kind TEXT NOT NULL CHECK (kind IN ('submitted', 'notified', 'status_changed', 'quote_updated', 'payment_updated', 'note')),
  actor TEXT,
  from_status TEXT,
  to_status TEXT,
  from_payment TEXT,
  to_payment TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_website_request_events_request
  ON tc_website_request_events (request_id, seq);

DROP TRIGGER IF EXISTS tc_website_request_events_append_only ON tc_website_request_events;
CREATE TRIGGER tc_website_request_events_append_only
  BEFORE UPDATE OR DELETE ON tc_website_request_events
  FOR EACH ROW EXECUTE FUNCTION tc_append_only();

-- Defense in depth: the Supabase Data API must never serve these tables. The
-- app connects as the table owner (exempt from RLS); anon/authenticated get nothing.
ALTER TABLE tc_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_website_request_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE tc_billing_events, tc_website_request_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE tc_billing_events, tc_website_request_events FROM authenticated;
  END IF;
END $$;

INSERT INTO mc_schema_migrations (id) VALUES ('041_admin_console') ON CONFLICT (id) DO NOTHING;
