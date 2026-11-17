-- 040_privacy_settings: one row of privacy choices per business.
--
-- Each choice is its own column so a save that changes one never rewrites the
-- others. `version` rises by one on every confirmed save; the API refuses a
-- save made against an older version, so two tabs cannot silently overwrite
-- each other.
--
-- A business with no row uses the new-business defaults in
-- src/product/privacy/settings.ts (recording off, analytics off, 90 days).
-- Safe to re-run: the table is created only if missing, and the backfill below
-- runs only before migration 040 is recorded.

CREATE TABLE IF NOT EXISTS tc_privacy_settings (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  call_recording_enabled BOOLEAN NOT NULL,
  save_call_transcripts BOOLEAN NOT NULL,
  save_sms_history BOOLEAN NOT NULL,
  -- NULL = the standard platform retention that applied before this setting.
  customer_data_retention_days INT
    CHECK (customer_data_retention_days IS NULL OR customer_data_retention_days IN (30, 90, 180)),
  analytics_enabled BOOLEAN NOT NULL,
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Backfill every business that existed before this migration so nothing it
-- does today changes on deploy:
--  * recording: kept ON only where the owner had switched it on, in either of
--    the two earlier switches (Privacy page or Phone settings). Neither was
--    enforced before; from now on the stored choice is.
--  * transcripts, SMS history, analytics: kept ON (what happens today).
--  * retention: NULL = the standard retention that applies today. Nothing is
--    removed earlier until the owner picks 30, 90 or 180 days.
INSERT INTO tc_privacy_settings (
  organization_id, call_recording_enabled, save_call_transcripts,
  save_sms_history, customer_data_retention_days, analytics_enabled,
  version, updated_at, updated_by
)
SELECT
  o.id,
  COALESCE(rp.recording_enabled, false)
    OR COALESCE((p.settings -> 'phoneSettings' ->> 'callRecordingEnabled')::boolean, false),
  true,
  true,
  NULL,
  true,
  1,
  now(),
  'migration_040'
FROM tc_organizations o
LEFT JOIN tc_recording_permissions rp ON rp.organization_id = o.id
LEFT JOIN rc_profiles p ON p.organization_id = o.id
WHERE NOT EXISTS (SELECT 1 FROM mc_schema_migrations WHERE id = '040_privacy_settings')
ON CONFLICT (organization_id) DO NOTHING;
