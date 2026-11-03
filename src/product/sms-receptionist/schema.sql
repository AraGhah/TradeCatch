-- Persist before acknowledging Twilio; a crashed Worker can resume from cron.
CREATE TABLE IF NOT EXISTS mc_sms_inbox (
  sequence BIGSERIAL UNIQUE NOT NULL,
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  from_e164 TEXT NOT NULL,
  to_e164 TEXT NOT NULL,
  params JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mc_sms_inbox_pending ON mc_sms_inbox (available_at, sequence)
  WHERE state IN ('pending','processing');
CREATE INDEX IF NOT EXISTS mc_sms_inbox_conversation ON mc_sms_inbox
  (organization_id, from_e164, to_e164, sequence) WHERE state IN ('pending','processing');
ALTER TABLE mc_sms_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mc_sms_inbox FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON mc_sms_inbox FROM %I', r);
    END IF;
  END LOOP;
END $$;
