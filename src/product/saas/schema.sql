-- TradeCatch SaaS foundation (multi-tenant).
-- Apply after missed-call schema.sql (mc_clients must exist for the FK).
-- Usage: npm run db:schema

CREATE TABLE IF NOT EXISTS tc_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'growth')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'churned')),
  missed_call_client_id TEXT UNIQUE REFERENCES mc_clients (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_organizations_plan
  ON tc_organizations (plan);

CREATE TABLE IF NOT EXISTS tc_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en'
    CHECK (locale IN ('en', 'fr')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES tc_users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS tc_memberships_user
  ON tc_memberships (user_id);

CREATE TABLE IF NOT EXISTS tc_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES tc_users (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS tc_sessions_user_active
  ON tc_sessions (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS tc_magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  organization_id TEXT REFERENCES tc_organizations (id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_magic_links_email
  ON tc_magic_links (email);

-- Link Module A clients to SaaS orgs (additive; safe on existing DBs).
ALTER TABLE mc_clients
  ADD COLUMN IF NOT EXISTS organization_id TEXT;

CREATE INDEX IF NOT EXISTS mc_clients_organization_id
  ON mc_clients (organization_id)
  WHERE organization_id IS NOT NULL;

INSERT INTO mc_schema_migrations (id)
VALUES ('002_saas_foundation')
ON CONFLICT (id) DO NOTHING;
