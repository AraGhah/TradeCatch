-- Task 4 — phone call events (timeline + duplicate webhook protection).
-- Applied by npm run db:schema as migration 009_phone_call_events.

CREATE TABLE IF NOT EXISTS rc_call_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  client_account_id TEXT NOT NULL,
  call_sid TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rc_call_events_org_at
  ON rc_call_events (organization_id, at DESC);

CREATE INDEX IF NOT EXISTS rc_call_events_call
  ON rc_call_events (organization_id, call_sid, at ASC);

CREATE INDEX IF NOT EXISTS rc_call_events_dedupe
  ON rc_call_events (call_sid, kind, at DESC);
