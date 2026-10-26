-- N-006: the Receptionist tier is sold on the pricing page and priced in
-- src/lib/plans.ts, but tc_organizations.plan and tc_stripe_subscriptions.plan
-- only ever allowed 'starter'/'growth'. Widen both CHECK constraints so Stripe
-- webhook sync can record a Receptionist subscription instead of throwing on
-- every event for that price.
ALTER TABLE tc_organizations DROP CONSTRAINT IF EXISTS tc_organizations_plan_check;
ALTER TABLE tc_organizations
  ADD CONSTRAINT tc_organizations_plan_check
  CHECK (plan IN ('starter', 'growth', 'receptionist'));

ALTER TABLE tc_stripe_subscriptions DROP CONSTRAINT IF EXISTS tc_stripe_subscriptions_plan_check;
ALTER TABLE tc_stripe_subscriptions
  ADD CONSTRAINT tc_stripe_subscriptions_plan_check
  CHECK (plan IN ('starter', 'growth', 'receptionist'));
