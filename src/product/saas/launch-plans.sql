-- 036_launch_plans: the Essential and Professional launch plans, and the
-- referral website bonus.
--
-- Widening only. Nothing is deleted or rewritten for existing customers:
--   * the legacy plan ids (starter, growth, receptionist) stay valid in every
--     table, so existing organizations, Stripe subscriptions and referral
--     records keep working and are NOT migrated to a new plan;
--   * new columns carry defaults, so existing rows stay valid as they are.
-- Safe to run more than once.
BEGIN;

-- 1. Plan ids -----------------------------------------------------------------
ALTER TABLE tc_organizations DROP CONSTRAINT IF EXISTS tc_organizations_plan_check;
ALTER TABLE tc_organizations
  ADD CONSTRAINT tc_organizations_plan_check
  CHECK (plan IN ('essential', 'professional', 'starter', 'growth', 'receptionist'));

ALTER TABLE tc_stripe_subscriptions DROP CONSTRAINT IF EXISTS tc_stripe_subscriptions_plan_check;
ALTER TABLE tc_stripe_subscriptions
  ADD CONSTRAINT tc_stripe_subscriptions_plan_check
  CHECK (plan IN ('essential', 'professional', 'starter', 'growth', 'receptionist'));

ALTER TABLE tc_installation_checkouts DROP CONSTRAINT IF EXISTS tc_installation_checkouts_plan_check;
ALTER TABLE tc_installation_checkouts
  ADD CONSTRAINT tc_installation_checkouts_plan_check
  CHECK (plan IN ('essential', 'professional', 'starter', 'growth', 'receptionist'));

-- 2. Referral settings: a reward per launch plan, and the website bonus ----------
ALTER TABLE tc_referral_settings DROP CONSTRAINT IF EXISTS tc_referral_settings_eligible_plans_check;
ALTER TABLE tc_referral_settings
  ADD CONSTRAINT tc_referral_settings_eligible_plans_check
  CHECK (eligible_plans <@ ARRAY['essential', 'professional', 'starter', 'growth', 'receptionist']::text[]);

ALTER TABLE tc_referral_settings
  ADD COLUMN IF NOT EXISTS reward_essential_cents INTEGER NOT NULL DEFAULT 6500
    CHECK (reward_essential_cents BETWEEN 0 AND 100000),
  ADD COLUMN IF NOT EXISTS reward_professional_cents INTEGER NOT NULL DEFAULT 6500
    CHECK (reward_professional_cents BETWEEN 0 AND 100000),
  ADD COLUMN IF NOT EXISTS reward_website_bonus_cents INTEGER NOT NULL DEFAULT 3500
    CHECK (reward_website_bonus_cents BETWEEN 0 AND 100000);

-- A settings row saved before launch only lists the three legacy plans, which
-- would leave every Essential and Professional purchase without a reward.
-- Add the two launch plans to it.
UPDATE tc_referral_settings
SET eligible_plans = (
  SELECT array_agg(DISTINCT plan_id)
  FROM unnest(eligible_plans || ARRAY['essential', 'professional']::text[]) AS plan_id
)
WHERE NOT (eligible_plans @> ARRAY['essential', 'professional']::text[]);

-- 3. Referral rewards: plan ids, and one extra reward of kind 'website' -----------
ALTER TABLE tc_referral_rewards DROP CONSTRAINT IF EXISTS tc_referral_rewards_plan_check;
ALTER TABLE tc_referral_rewards
  ADD CONSTRAINT tc_referral_rewards_plan_check
  CHECK (plan IN ('essential', 'professional', 'starter', 'growth', 'receptionist'));

-- kind 'plan': the reward for the plan the referred customer bought.
-- kind 'website': the bonus when the referred customer also buys the website
-- service. Each referral can have at most one of each, so the most a single
-- referral can ever earn is the plan reward plus one website bonus.
ALTER TABLE tc_referral_rewards
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan'
    CHECK (kind IN ('plan', 'website'));

ALTER TABLE tc_referral_rewards DROP CONSTRAINT IF EXISTS tc_referral_rewards_referral_id_key;
ALTER TABLE tc_referral_rewards DROP CONSTRAINT IF EXISTS tc_referral_rewards_referred_organization_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS tc_referral_rewards_referral_kind
  ON tc_referral_rewards (referral_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS tc_referral_rewards_referred_kind
  ON tc_referral_rewards (referred_organization_id, kind);

COMMIT;
