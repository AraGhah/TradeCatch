-- 028_installation_approval. Additive only; NO automatic grants or enforcement.
BEGIN;
CREATE TABLE IF NOT EXISTS tc_installations (
  id UUID PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  credential_hash TEXT NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tc_installation_domains (
  id UUID PRIMARY KEY,
  installation_id UUID NOT NULL REFERENCES tc_installations(id),
  origin TEXT NOT NULL UNIQUE CHECK (length(origin) BETWEEN 1 AND 300 AND position('*' in origin)=0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tc_installation_audit (
  id UUID PRIMARY KEY,
  domain_id UUID NOT NULL REFERENCES tc_installation_domains(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('register','add_domain','approved','rejected','revoked')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('pending','approved','rejected','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tc_installation_audit_domain_created ON tc_installation_audit(domain_id,created_at DESC);
CREATE OR REPLACE FUNCTION tc_installation_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Installation audit records are append-only'; END $$;
DROP TRIGGER IF EXISTS tc_installation_audit_immutable ON tc_installation_audit;
CREATE TRIGGER tc_installation_audit_immutable BEFORE UPDATE OR DELETE ON tc_installation_audit
FOR EACH ROW EXECUTE FUNCTION tc_installation_audit_immutable();
ALTER TABLE tc_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_installation_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_installation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tc_installations, tc_installation_domains, tc_installation_audit FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON tc_installations, tc_installation_domains, tc_installation_audit FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON tc_installations, tc_installation_domains, tc_installation_audit FROM authenticated;
  END IF;
END $$;
COMMIT;
