-- Migration 061_scheduling_calcom: Cal.com v2 as an optional scheduling provider.
-- Additive and repeatable. Applied by npm run db:schema right after 012_scheduling,
-- or alone: node scripts/schema-targeted.js --apply 061_scheduling_calcom --yes
--
-- Until 2026-11-25 this lived at the end of scheduling/schema.sql, under the
-- already-recorded id 012_scheduling, so a database that had 012 never got it.

-- The credential is sealed (AES-256-GCM) by the application before it reaches
-- this table. The ledger row is written before every booking request, so a
-- request whose answer was lost can still be found and cancelled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tc_availability_rules_calendar_mode_check'
      AND pg_get_constraintdef(oid) LIKE '%calcom%'
  ) THEN
    ALTER TABLE tc_availability_rules
      DROP CONSTRAINT IF EXISTS tc_availability_rules_calendar_mode_check;
    ALTER TABLE tc_availability_rules
      ADD CONSTRAINT tc_availability_rules_calendar_mode_check
      CHECK (calendar_mode IN ('simulated', 'google', 'internal', 'calcom'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tc_calcom_connections (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'error', 'disconnected')),
  credential_kind TEXT NOT NULL DEFAULT 'api_key'
    CHECK (credential_kind IN ('api_key')),
  credential_ciphertext TEXT,
  account_email TEXT,
  account_username TEXT,
  account_timezone TEXT,
  default_event_type_id BIGINT NOT NULL,
  routes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  attendee_email TEXT,
  last_error TEXT,
  last_verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_calcom_bookings (
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL,
  event_type_id BIGINT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('creating', 'confirmed', 'failed', 'canceled', 'orphan_canceled', 'unresolved')),
  provider_uid TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  error_code TEXT,
  attempts INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, appointment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_calcom_bookings_uid
  ON tc_calcom_bookings (organization_id, provider_uid)
  WHERE provider_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_calcom_bookings_open
  ON tc_calcom_bookings (organization_id, created_at)
  WHERE state IN ('creating', 'unresolved');

INSERT INTO mc_schema_migrations (id)
VALUES ('061_scheduling_calcom')
ON CONFLICT (id) DO NOTHING;
