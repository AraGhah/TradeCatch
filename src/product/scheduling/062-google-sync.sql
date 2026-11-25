-- Migration 062_scheduling_google_sync: Google Calendar two-way synchronization (KAN-22).
-- Additive and repeatable. Applied by npm run db:schema right after 012_scheduling,
-- or alone: node scripts/schema-targeted.js --apply 062_scheduling_google_sync --yes
--
-- Until 2026-11-25 this lived at the end of scheduling/schema.sql, under the
-- already-recorded id 012_scheduling, so a database that had 012 never got it.

-- Tokens stay in tc_calendar_connections.token_ciphertext (AES-256-GCM);
-- nothing below holds a credential, a customer, or the title of an owner's event.
--
-- No statement changes existing rows. The old clear-text placeholder column
-- tc_calendar_sync_state.channel_token is never read or written by the
-- application (the push secret is stored only as channel_token_hash), so it is
-- left as it is instead of being cleared here.

ALTER TABLE tc_calendar_connections
  ADD COLUMN IF NOT EXISTS event_detail TEXT NOT NULL DEFAULT 'minimal',
  ADD COLUMN IF NOT EXISTS cancel_policy TEXT NOT NULL DEFAULT 'remove',
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

-- The state of the pull side, one row per business. The columns that existed
-- before (sync_token, channel_token, channel_expires_at) were never written.
ALTER TABLE tc_calendar_sync_state
  ADD COLUMN IF NOT EXISTS calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS channel_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS channel_id TEXT,
  ADD COLUMN IF NOT EXISTS resource_id TEXT,
  ADD COLUMN IF NOT EXISTS last_message_number BIGINT,
  ADD COLUMN IF NOT EXISTS last_full_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rerun_requested BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS tc_calendar_sync_state_channel
  ON tc_calendar_sync_state (channel_id)
  WHERE channel_id IS NOT NULL;

-- The mirror of the owner's calendar: times only, so the owner's private
-- details never enter TradeCatch.
CREATE TABLE IF NOT EXISTS tc_gcal_events (
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  transparent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'confirmed',
  declined BOOLEAN NOT NULL DEFAULT false,
  informational BOOLEAN NOT NULL DEFAULT false,
  etag TEXT,
  appointment_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, calendar_id, event_id)
);

CREATE INDEX IF NOT EXISTS tc_gcal_events_window
  ON tc_gcal_events (organization_id, start_at);

-- The stable mapping between an appointment and its Google event, and the
-- outbox of what still has to be sent. One row per appointment, so a repeated
-- request can never create a second event.
CREATE TABLE IF NOT EXISTS tc_gcal_event_links (
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT,
  generation INT NOT NULL DEFAULT 1,
  state TEXT NOT NULL
    CHECK (state IN ('synced', 'pending', 'failed', 'external_modified', 'external_deleted', 'detached')),
  pending_op TEXT CHECK (pending_op IN ('create', 'update', 'delete')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  remote_etag TEXT,
  synced_start_at TIMESTAMPTZ,
  synced_end_at TIMESTAMPTZ,
  external_start_at TIMESTAMPTZ,
  external_end_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, appointment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_gcal_event_links_event
  ON tc_gcal_event_links (organization_id, calendar_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_gcal_event_links_due
  ON tc_gcal_event_links (next_attempt_at)
  WHERE pending_op IS NOT NULL;

INSERT INTO mc_schema_migrations (id)
VALUES ('062_scheduling_google_sync')
ON CONFLICT (id) DO NOTHING;
