-- Installation-fee checkout + deferred first billing month + usage metering.
-- Apply after stripe-billing.sql. Additive only; existing customers and
-- subscriptions already reconciled by stripe-billing.ts are unaffected.

-- Tracks a self-serve installation-fee Checkout Session end to end, so the
-- dashboard can show "installation paid, service starts <date>" even in the
-- window before Stripe's subscription webhook arrives, and so a second
-- checkout cannot be started while one is already pending for the org.
CREATE TABLE IF NOT EXISTS tc_installation_checkouts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('starter', 'growth', 'receptionist')),
  checkout_session_id TEXT UNIQUE,
  livemode BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'subscribed', 'failed', 'canceled')),
  billing_start_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one in-flight checkout per organization.
CREATE UNIQUE INDEX IF NOT EXISTS tc_installation_checkouts_pending_org
  ON tc_installation_checkouts (organization_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS tc_installation_checkouts_organization
  ON tc_installation_checkouts (organization_id);

-- Administrator-controlled override of the first recurring billing date,
-- for when onboarding runs past the default one-calendar-month anchor.
-- Only takes effect before the subscription is created (see stripe-checkout.ts).
CREATE TABLE IF NOT EXISTS tc_billing_deferrals (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations(id) ON DELETE CASCADE,
  billing_start_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  set_by TEXT NOT NULL REFERENCES tc_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usage metering counters (see usage-metering.ts). One row per org per
-- metric per calendar month; `count` is a soft, non-blocking running total.
CREATE TABLE IF NOT EXISTS tc_usage_counters (
  organization_id TEXT NOT NULL REFERENCES tc_organizations(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('sms_segments', 'voice_minutes')),
  period_start DATE NOT NULL,
  count NUMERIC NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, metric, period_start)
);

ALTER TABLE tc_installation_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_billing_deferrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_usage_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tc_installation_checkouts, tc_billing_deferrals, tc_usage_counters FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON tc_installation_checkouts, tc_billing_deferrals, tc_usage_counters FROM %I', api_role);
  END LOOP;
END $$;
