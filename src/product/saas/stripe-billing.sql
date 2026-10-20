-- Billing state is private server data. Apply after the SaaS foundation.
CREATE TABLE IF NOT EXISTS tc_stripe_customers (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL UNIQUE,
  livemode BOOLEAN NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_stripe_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_stripe_customers(organization_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('starter', 'growth')),
  cancel_at_period_end BOOLEAN NOT NULL,
  current_period_end TIMESTAMPTZ,
  latest_invoice_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Separate from historical receipts, which acknowledged events without syncing billing.
CREATE TABLE IF NOT EXISTS tc_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_stripe_subscriptions_organization
  ON tc_stripe_subscriptions(organization_id);

ALTER TABLE tc_stripe_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_stripe_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tc_stripe_customers, tc_stripe_subscriptions, tc_stripe_events FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON tc_stripe_customers, tc_stripe_subscriptions, tc_stripe_events FROM %I', api_role);
  END LOOP;
END $$;
