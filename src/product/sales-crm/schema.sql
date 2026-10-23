-- 027_native_sales_crm: additive platform sales projection, never a tenant CRM.
-- Contact/consent evidence stays in mc_book_audit_leads, including its retention policy.
CREATE TABLE IF NOT EXISTS tc_platform_sales_leads (
  lead_id TEXT PRIMARY KEY REFERENCES mc_book_audit_leads(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'book_audit' CHECK (source = 'book_audit'),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','qualified','won','lost')),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tc_platform_sales_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tc_platform_sales_leads FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON tc_platform_sales_leads FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON tc_platform_sales_leads FROM authenticated;
  END IF;
END $$;

ALTER TABLE mc_book_audit_notifications ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE mc_book_audit_notifications ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
CREATE INDEX IF NOT EXISTS mc_book_audit_leads_sales_created
  ON mc_book_audit_leads (created_at DESC, id DESC);

-- Idempotent backfill: do not resurrect contact data that was already purged.
INSERT INTO tc_platform_sales_leads (lead_id)
SELECT id FROM mc_book_audit_leads
WHERE COALESCE(payload->>'retention_state', '') NOT IN ('purged_pending','purged')
ON CONFLICT (lead_id) DO NOTHING;
