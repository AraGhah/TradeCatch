-- Demo contractor account extensions (Task 2).
-- Maps task "businesses / business_members / business_settings" onto the
-- existing multi-tenant model (tc_organizations / tc_memberships / tc_org_settings).
-- Apply after 007_email_automation via npm run db:schema.

ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'pilot';

ALTER TABLE tc_organizations
  DROP CONSTRAINT IF EXISTS tc_organizations_account_type_check;

ALTER TABLE tc_organizations
  ADD CONSTRAINT tc_organizations_account_type_check
  CHECK (account_type IN ('pilot', 'demo', 'production'));

ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS industry TEXT;

ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS service_area TEXT NOT NULL DEFAULT '';

ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto';

ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS locale_default TEXT NOT NULL DEFAULT 'en';

ALTER TABLE tc_organizations
  DROP CONSTRAINT IF EXISTS tc_organizations_locale_default_check;

ALTER TABLE tc_organizations
  ADD CONSTRAINT tc_organizations_locale_default_check
  CHECK (locale_default IN ('en', 'fr'));

-- Per-business feature toggles (overrides / complements plan entitlements for demos).
ALTER TABLE tc_organizations
  ADD COLUMN IF NOT EXISTS features_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS tc_organizations_account_type
  ON tc_organizations (account_type);

-- Platform admin flag for TradeCatch operators (in addition to TRADECATCH_ADMIN_EMAILS).
ALTER TABLE tc_users
  ADD COLUMN IF NOT EXISTS platform_role TEXT NOT NULL DEFAULT 'none';

ALTER TABLE tc_users
  DROP CONSTRAINT IF EXISTS tc_users_platform_role_check;

ALTER TABLE tc_users
  ADD CONSTRAINT tc_users_platform_role_check
  CHECK (platform_role IN ('none', 'admin'));

-- Idempotency for demo business creation (prevents duplicate POST retries).
CREATE TABLE IF NOT EXISTS tc_demo_create_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO mc_schema_migrations (id)
VALUES ('008_demo_businesses')
ON CONFLICT (id) DO NOTHING;
