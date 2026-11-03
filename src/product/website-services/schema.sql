-- Done-for-You Website Service requests.
-- Apply with the other schemas: npm run db:schema  (migration id 034_website_service)
--
-- A request is NOT a subscription item: it never touches billing tables. The
-- team confirms scope and price with the customer before anything is charged.
-- organization_id is NULL for a visitor who was not signed in; the row then
-- belongs to no tenant and is only visible to platform administrators.

CREATE TABLE IF NOT EXISTS tc_website_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES tc_organizations (id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('new', 'improve')),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'quoted', 'in_progress', 'delivered', 'cancelled')),
  source TEXT NOT NULL CHECK (source IN ('pricing', 'onboarding', 'dashboard')),
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  current_website_url TEXT,
  focus_areas TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr')),
  quoted_price_cad NUMERIC(10, 2) CHECK (quoted_price_cad IS NULL OR quoted_price_cad >= 349),
  scope_summary TEXT,
  idempotency_key TEXT,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A replayed submission (double click, retry) must not create a second request.
CREATE UNIQUE INDEX IF NOT EXISTS tc_website_requests_idempotency
  ON tc_website_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_website_requests_org_created
  ON tc_website_requests (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_website_requests_status_created
  ON tc_website_requests (status, created_at DESC);

-- Defense in depth: the Supabase Data API must never serve these rows. The app
-- connects as the table owner (exempt from RLS); anon/authenticated get nothing.
ALTER TABLE tc_website_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE tc_website_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE tc_website_requests FROM authenticated;
  END IF;
END $$;
