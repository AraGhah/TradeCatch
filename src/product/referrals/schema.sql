-- 033_referral_program. Additive only: no existing table is altered and nothing
-- is granted or enforced automatically. Private server data (RLS on, no API roles).
--
-- Money safety lives in the constraints, not just in the application:
--   * one referral per referred business            (tc_referrals.referred_organization_id)
--   * one reward per referral, per referred business and per Checkout Session
--   * one gift card reference per reward, compared case-insensitively
--   * a test-mode payment can never reach approved/issued
--   * an issued reward must carry its fulfillment record and cannot be deleted
--
-- Referral and reward rows keep organization ids as plain text with the
-- business names copied in: they are a financial record and must survive an
-- organization being deleted. Only the code (which belongs to the live
-- organization) is tied to it.
BEGIN;

CREATE TABLE IF NOT EXISTS tc_referral_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  program_enabled BOOLEAN NOT NULL,
  reward_starter_cents INTEGER NOT NULL CHECK (reward_starter_cents BETWEEN 0 AND 100000),
  reward_growth_cents INTEGER NOT NULL CHECK (reward_growth_cents BETWEEN 0 AND 100000),
  reward_receptionist_cents INTEGER NOT NULL CHECK (reward_receptionist_cents BETWEEN 0 AND 100000),
  eligible_plans TEXT[] NOT NULL
    CHECK (eligible_plans <@ ARRAY['starter', 'growth', 'receptionist']::text[]),
  hold_days INTEGER NOT NULL CHECK (hold_days BETWEEN 0 AND 120),
  require_referrer_active BOOLEAN NOT NULL,
  fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('none', 'manual')),
  updated_by TEXT,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tc_referral_codes (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[2-9A-HJKMNP-Z]{10}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_referrals (
  id TEXT PRIMARY KEY,
  referrer_organization_id TEXT NOT NULL,
  referred_organization_id TEXT NOT NULL UNIQUE,
  referrer_business_name TEXT NOT NULL,
  referred_business_name TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('registered', 'qualified', 'rejected')),
  rejection_reason TEXT CHECK (rejection_reason IN (
    'self_referral', 'same_owner', 'same_phone', 'same_billing_customer',
    'referrer_inactive', 'refunded', 'chargeback', 'subscription_cancelled',
    'administrator'
  )),
  review_flags TEXT[] NOT NULL DEFAULT '{}',
  registered_at TIMESTAMPTZ NOT NULL,
  qualified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  -- Only a rejected row may name the same business on both sides.
  CHECK (referrer_organization_id <> referred_organization_id OR status = 'rejected')
);

CREATE INDEX IF NOT EXISTS tc_referrals_referrer
  ON tc_referrals (referrer_organization_id, registered_at DESC);
CREATE INDEX IF NOT EXISTS tc_referrals_status
  ON tc_referrals (status, registered_at DESC);

CREATE TABLE IF NOT EXISTS tc_referral_rewards (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL UNIQUE REFERENCES tc_referrals (id),
  referrer_organization_id TEXT NOT NULL,
  referred_organization_id TEXT NOT NULL UNIQUE,
  -- The plan the REFERRED customer purchased.
  plan TEXT NOT NULL CHECK (plan IN ('starter', 'growth', 'receptionist')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000),
  currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'issued', 'rejected')),
  livemode BOOLEAN NOT NULL,
  qualifying_session_id TEXT NOT NULL UNIQUE,
  qualifying_payment_intent_id TEXT,
  eligible_at TIMESTAMPTZ NOT NULL,
  review_flags TEXT[] NOT NULL DEFAULT '{}',
  rejection_reason TEXT CHECK (rejection_reason IN (
    'self_referral', 'same_owner', 'same_phone', 'same_billing_customer',
    'referrer_inactive', 'refunded', 'chargeback', 'subscription_cancelled',
    'administrator'
  )),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  fulfillment_method TEXT CHECK (fulfillment_method IN ('none', 'manual')),
  -- An order number or the last characters of a card; never a full card code.
  gift_card_reference TEXT CHECK (
    gift_card_reference IS NULL
    OR (length(gift_card_reference) BETWEEN 3 AND 80
        AND gift_card_reference !~ '[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9][ -]*[0-9]')
  ),
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CHECK (
    status <> 'issued'
    OR (gift_card_reference IS NOT NULL
        AND fulfillment_method IS NOT NULL AND fulfillment_method <> 'none'
        AND issued_at IS NOT NULL AND issued_by IS NOT NULL)
  ),
  -- A Stripe test-mode payment is shown to administrators but never paid out.
  CHECK (status NOT IN ('approved', 'issued') OR livemode)
);

-- Two rewards can never carry the same gift card, however it is capitalised.
CREATE UNIQUE INDEX IF NOT EXISTS tc_referral_rewards_gift_card_reference
  ON tc_referral_rewards (lower(gift_card_reference))
  WHERE gift_card_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS tc_referral_rewards_referrer
  ON tc_referral_rewards (referrer_organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_referral_rewards_status
  ON tc_referral_rewards (status, created_at DESC);
CREATE INDEX IF NOT EXISTS tc_referral_rewards_payment_intent
  ON tc_referral_rewards (qualifying_payment_intent_id)
  WHERE qualifying_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tc_referral_events (
  id TEXT PRIMARY KEY,
  referral_id TEXT,
  reward_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'registered', 'rejected', 'qualified', 'reward_created', 'reward_approved',
    'reward_rejected', 'reward_issued', 'reward_flagged', 'settings_changed',
    'no_reward'
  )),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 500),
  at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS tc_referral_events_referral ON tc_referral_events (referral_id, at DESC);
CREATE INDEX IF NOT EXISTS tc_referral_events_reward ON tc_referral_events (reward_id, at DESC);

CREATE OR REPLACE FUNCTION tc_referral_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Referral events are append-only'; END $$;
DROP TRIGGER IF EXISTS tc_referral_events_immutable ON tc_referral_events;
CREATE TRIGGER tc_referral_events_immutable BEFORE UPDATE OR DELETE ON tc_referral_events
FOR EACH ROW EXECUTE FUNCTION tc_referral_events_immutable();

-- The record of an issued gift card is what prevents paying it twice: keep it.
CREATE OR REPLACE FUNCTION tc_referral_rewards_keep_issued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'An issued referral reward cannot be deleted';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS tc_referral_rewards_keep_issued ON tc_referral_rewards;
CREATE TRIGGER tc_referral_rewards_keep_issued BEFORE DELETE ON tc_referral_rewards
FOR EACH ROW EXECUTE FUNCTION tc_referral_rewards_keep_issued();

ALTER TABLE tc_referral_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_referral_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tc_referral_settings, tc_referral_codes, tc_referrals,
  tc_referral_rewards, tc_referral_events FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format(
      'REVOKE ALL ON tc_referral_settings, tc_referral_codes, tc_referrals, tc_referral_rewards, tc_referral_events FROM %I',
      api_role
    );
  END LOOP;
END $$;

COMMIT;
