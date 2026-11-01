-- Custom Voice Cloning (Receptionist Plus).
-- Apply with the other schemas: npm run db:schema  (migration id 035_custom_receptionist_voice)
--
-- One row per business. We store the provider's voice id (a handle, not audio),
-- the consent record and an event trail. The recorded sample itself is never
-- stored: it is streamed to the provider for cloning and discarded.
--
-- The voice id is only ever read by the server: the dashboard API strips it and
-- only the ops-authenticated agent-config endpoint hands it to the call worker.

CREATE TABLE IF NOT EXISTS rc_custom_voices (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard', 'custom')),
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'ready', 'deleting')),
  provider TEXT NOT NULL DEFAULT 'elevenlabs' CHECK (provider IN ('elevenlabs')),
  provider_voice_id TEXT CHECK (provider_voice_id IS NULL OR provider_voice_id ~ '^[A-Za-z0-9]{10,40}$'),
  consent_statement_version TEXT,
  consent_signer_name TEXT,
  consent_accepted_by_user_id TEXT,
  consent_accepted_at TIMESTAMPTZ,
  consent_revoked_at TIMESTAMPTZ,
  consent_revoked_by TEXT,
  verified_at TIMESTAMPTZ,
  previewed_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  last_challenge_nonce TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Defense in depth, on top of the service: calls can only use a cloned voice
  -- when one exists, its consent is on record and that consent was not revoked.
  CONSTRAINT rc_custom_voices_custom_needs_voice CHECK (
    mode = 'standard'
    OR (
      provider_voice_id IS NOT NULL
      AND status = 'ready'
      AND consent_accepted_at IS NOT NULL
      AND consent_revoked_at IS NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS rc_voice_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rc_voice_events_org_created
  ON rc_voice_events (organization_id, created_at DESC);

-- Defense in depth: the Supabase Data API must never serve these rows. The app
-- connects as the table owner (exempt from RLS); anon/authenticated get nothing.
ALTER TABLE rc_custom_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rc_voice_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE rc_custom_voices FROM anon;
    REVOKE ALL ON TABLE rc_voice_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE rc_custom_voices FROM authenticated;
    REVOKE ALL ON TABLE rc_voice_events FROM authenticated;
  END IF;
END $$;
