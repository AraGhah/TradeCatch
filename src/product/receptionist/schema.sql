-- AI Receptionist call sessions (inbound call answering).
-- Apply with the other schemas: npm run db:schema  (migration id 006_ai_receptionist)
--
-- The full session (turns, slots, transfers, summary, notification log) lives in
-- `data`; hot columns are denormalized for listing, stale-call recovery and
-- retention purges.

CREATE TABLE IF NOT EXISTS rc_call_sessions (
  id TEXT PRIMARY KEY,
  call_sid TEXT NOT NULL UNIQUE,
  config_id TEXT NOT NULL,
  client_account_id TEXT NOT NULL,
  from_e164 TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('in_progress', 'transferring', 'completed', 'failed')),
  outcome TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  transcript_purged_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rc_call_sessions_client_started
  ON rc_call_sessions (client_account_id, started_at DESC);

CREATE INDEX IF NOT EXISTS rc_call_sessions_unfinalized
  ON rc_call_sessions (updated_at)
  WHERE finalized_at IS NULL;

CREATE INDEX IF NOT EXISTS rc_call_sessions_retention
  ON rc_call_sessions (config_id, ended_at)
  WHERE finalized_at IS NOT NULL AND transcript_purged_at IS NULL;

-- Per-organization receptionist profile (owner-editable settings; number +
-- activation are ops-controlled). Idempotent: safe to re-run with npm run db:schema.
CREATE TABLE IF NOT EXISTS rc_profiles (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  phone_number_e164 TEXT,
  activated BOOLEAN NOT NULL DEFAULT false,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One organization per answered number.
CREATE UNIQUE INDEX IF NOT EXISTS rc_profiles_number_unique
  ON rc_profiles (phone_number_e164)
  WHERE activated AND phone_number_e164 IS NOT NULL;
