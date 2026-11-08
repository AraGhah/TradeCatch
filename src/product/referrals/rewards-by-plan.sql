-- 038_referral_rewards_by_plan: referral rewards follow the plan the referred
-- customer buys: $50 CAD for Essential, $75 CAD for Professional (was $65 for both).
--
-- Prospective only. Every reward row already created keeps the amount it was
-- stamped with (tc_referral_rewards.amount_cents is never touched here), so
-- earned, approved, issued and still-pending rewards are unchanged. Only the
-- settings that decide the amount of FUTURE rewards move.
--
-- A settings row an administrator customised to any other amount is left alone:
-- it is only rewritten while it still holds the old $65 / $65 launch defaults.
-- With no settings row at all, the application defaults ($50 / $75) apply.
-- Safe to run more than once.
BEGIN;

ALTER TABLE tc_referral_settings
  ALTER COLUMN reward_essential_cents SET DEFAULT 5000,
  ALTER COLUMN reward_professional_cents SET DEFAULT 7500;

UPDATE tc_referral_settings
SET reward_essential_cents = 5000,
    reward_professional_cents = 7500,
    updated_by = COALESCE(updated_by, 'migration 038'),
    updated_at = now()
WHERE reward_essential_cents = 6500
  AND reward_professional_cents = 6500;

COMMIT;
