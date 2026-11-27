-- Migration 060_scheduling_confirmation_recovery: confirmation notices that still have to be sent.
-- Additive and repeatable. Applied by npm run db:schema right after 012_scheduling,
-- or alone: node scripts/schema-targeted.js --apply 060_scheduling_confirmation_recovery --yes
--
-- Until 2026-11-25 this lived at the end of scheduling/schema.sql, under the
-- already-recorded id 012_scheduling, so a database that had 012 never got it.

ALTER TABLE tc_schedule_appointments
  ADD COLUMN IF NOT EXISTS confirmation_notices_pending BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS tc_schedule_pending_confirmations
  ON tc_schedule_appointments (updated_at, id)
  WHERE status = 'confirmed' AND confirmation_notices_pending;

INSERT INTO mc_schema_migrations (id)
VALUES ('060_scheduling_confirmation_recovery')
ON CONFLICT (id) DO NOTHING;
