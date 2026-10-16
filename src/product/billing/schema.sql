-- TradeCatch billing / Stripe subscriptions (Task 10).
-- Apply after 013_notifications via npm run db:schema.

-- Allow the AI Receptionist plan on organizations.
ALTER TABLE tc_organizations
  DROP CONSTRAINT IF EXISTS tc_organizations_plan_check;

ALTER TABLE tc_organizations
  ADD CONSTRAINT tc_organizations_plan_check
  CHECK (plan IN ('starter', 'growth', 'ai_receptionist'));

CREATE TABLE IF NOT EXISTS tc_stripe_customers (
  business_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_business_subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES tc_organizations (id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  plan TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'growth', 'ai_receptionist')),
  status TEXT NOT NULL DEFAULT 'none'
    CHECK (status IN (
      'trialing', 'active', 'incomplete', 'incomplete_expired',
      'past_due', 'unpaid', 'canceled', 'paused', 'none'
    )),
  currency TEXT NOT NULL DEFAULT 'cad'
    CHECK (currency IN ('cad', 'usd')),
  billing_interval TEXT NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('month', 'year')),
  unit_amount_cents INTEGER,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  grace_period_ends_at TIMESTAMPTZ,
  payment_method_brand TEXT,
  payment_method_last4 TEXT,
  outstanding_balance_cents INTEGER NOT NULL DEFAULT 0,
  latest_invoice_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_business_subscriptions_status
  ON tc_business_subscriptions (status);

CREATE TABLE IF NOT EXISTS tc_subscription_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  stripe_event_id TEXT,
  type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_subscription_events_business
  ON tc_subscription_events (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_usage_records (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  metric TEXT NOT NULL
    CHECK (metric IN ('ai_call_minutes', 'telephone_minutes', 'sms_segments')),
  quantity NUMERIC NOT NULL CHECK (quantity >= 0),
  source TEXT NOT NULL,
  external_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  billing_period_start TIMESTAMPTZ NOT NULL,
  billing_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tc_usage_records_dedupe
  ON tc_usage_records (business_id, metric, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tc_usage_records_period
  ON tc_usage_records (business_id, occurred_at);

CREATE TABLE IF NOT EXISTS tc_usage_allowances (
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  plan TEXT NOT NULL
    CHECK (plan IN ('starter', 'growth', 'ai_receptionist')),
  metric TEXT NOT NULL
    CHECK (metric IN ('ai_call_minutes', 'telephone_minutes', 'sms_segments')),
  included_quantity NUMERIC NOT NULL DEFAULT 0,
  policy TEXT NOT NULL DEFAULT 'hard_limit'
    CHECK (policy IN ('hard_limit', 'soft_limit', 'paid_overage', 'auto_upgrade')),
  overage_rate_cents INTEGER,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, metric, period_start)
);

CREATE TABLE IF NOT EXISTS tc_billing_invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  stripe_invoice_id TEXT NOT NULL,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible', 'unknown')),
  currency TEXT NOT NULL DEFAULT 'cad'
    CHECK (currency IN ('cad', 'usd')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  overage_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  plan TEXT CHECK (plan IS NULL OR plan IN ('starter', 'growth', 'ai_receptionist')),
  hosted_invoice_url TEXT,
  invoice_pdf TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, stripe_invoice_id)
);

CREATE INDEX IF NOT EXISTS tc_billing_invoices_business
  ON tc_billing_invoices (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tc_billing_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processed', 'ignored', 'failed')),
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tc_billing_audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES tc_organizations (id) ON DELETE SET NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_billing_audit_logs_business
  ON tc_billing_audit_logs (business_id, created_at DESC);

-- Catalog tables for plan metadata (synced from code on deploy; optional joins).
CREATE TABLE IF NOT EXISTS tc_subscription_plans (
  id TEXT PRIMARY KEY
    CHECK (id IN ('starter', 'growth', 'ai_receptionist')),
  name_en TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'cad',
  monthly_price_cents INTEGER NOT NULL,
  annual_price_cents INTEGER NOT NULL,
  setup_fee_cents INTEGER NOT NULL DEFAULT 0,
  trial_days INTEGER NOT NULL DEFAULT 0,
  usage_policy TEXT NOT NULL DEFAULT 'hard_limit',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_plan_features (
  plan_id TEXT NOT NULL REFERENCES tc_subscription_plans (id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  PRIMARY KEY (plan_id, feature_id)
);

INSERT INTO mc_schema_migrations (id)
VALUES ('014_billing')
ON CONFLICT (id) DO NOTHING;
