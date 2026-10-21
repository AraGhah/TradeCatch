-- Verified personal destinations, supplied only by a trusted verification flow.
-- Existing members remain email/in-app contacts; never infer verification from
-- the organization's phone number or a submitted escalation setting.
ALTER TABLE tc_users
  ADD COLUMN IF NOT EXISTS notification_phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS notification_phone_verified_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tc_users_notification_phone_verified'
    AND conrelid='tc_users'::regclass) THEN
    ALTER TABLE tc_users ADD CONSTRAINT tc_users_notification_phone_verified CHECK (
      (notification_phone_e164 IS NULL AND notification_phone_verified_at IS NULL)
      OR (notification_phone_e164 IS NOT NULL AND notification_phone_verified_at IS NOT NULL
        AND notification_phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
    );
  END IF;
END $$;
