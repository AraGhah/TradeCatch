-- Appointment scheduling: rules, services, bookings, holds, calendar connections.
-- Apply via npm run db:schema (migration 012_scheduling).

CREATE TABLE IF NOT EXISTS tc_availability_rules (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  days_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_duration_minutes INT NOT NULL DEFAULT 60,
  buffer_minutes INT NOT NULL DEFAULT 30,
  travel_buffer_minutes INT NOT NULL DEFAULT 30,
  minimum_notice_minutes INT NOT NULL DEFAULT 120,
  max_advance_days INT NOT NULL DEFAULT 30,
  max_daily_bookings INT,
  holidays_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  calendar_mode TEXT NOT NULL DEFAULT 'simulated'
    CHECK (calendar_mode IN ('simulated', 'google', 'internal')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_service_types (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL,
  buffer_minutes INT,
  booking_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (booking_mode IN ('automatic', 'consultation', 'manual_approval', 'escalate')),
  eligible_technician_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_area TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_service_types_org
  ON tc_service_types (organization_id, name);

CREATE TABLE IF NOT EXISTS tc_technicians (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  service_area TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_schedule_appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_phone_e164 TEXT,
  customer_email TEXT,
  service_address TEXT,
  service_id TEXT,
  service_name TEXT NOT NULL,
  technician_id TEXT,
  technician_name TEXT,
  lead_id TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  booking_source TEXT NOT NULL,
  appointment_kind TEXT NOT NULL DEFAULT 'job',
  calendar_event_id TEXT,
  idempotency_key TEXT,
  cancel_reason TEXT,
  simulated BOOLEAN NOT NULL DEFAULT false,
  hold_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_schedule_appt_idem
  ON tc_schedule_appointments (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_schedule_appt_org_start
  ON tc_schedule_appointments (organization_id, start_at);

CREATE TABLE IF NOT EXISTS tc_appointment_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_calendar_connections (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',
  status TEXT NOT NULL DEFAULT 'disconnected',
  calendar_id TEXT,
  calendar_summary TEXT,
  account_email TEXT,
  token_ciphertext TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_calendar_busy (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  external_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_calendar_busy_org
  ON tc_calendar_busy (organization_id, start_at);

CREATE TABLE IF NOT EXISTS tc_calendar_sync_state (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  sync_token TEXT,
  channel_token TEXT,
  channel_expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ
);

INSERT INTO mc_schema_migrations (id)
VALUES ('012_scheduling')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE tc_schedule_appointments
  ADD COLUMN IF NOT EXISTS confirmation_notices_pending BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS tc_schedule_pending_confirmations
  ON tc_schedule_appointments (updated_at, id)
  WHERE status = 'confirmed' AND confirmation_notices_pending;

INSERT INTO mc_schema_migrations (id)
VALUES ('060_scheduling_confirmation_recovery')
ON CONFLICT (id) DO NOTHING;
