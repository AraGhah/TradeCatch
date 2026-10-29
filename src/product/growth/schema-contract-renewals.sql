-- Service contract renewal reminders (CONTRACT_RENEWAL_AUTOMATION, Receptionist tier).
-- Apply after growth schema. npm run db:schema

CREATE TABLE IF NOT EXISTS tc_service_contracts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  customer_phone_e164 TEXT NOT NULL,
  customer_name TEXT,
  title TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  next_renewal_at TIMESTAMPTZ NOT NULL,
  reminder_days_before INTEGER NOT NULL DEFAULT 14,
  reminder_sent_for_cycle BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'lapsed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_service_contracts_org_renewal
  ON tc_service_contracts (organization_id, next_renewal_at);

CREATE INDEX IF NOT EXISTS tc_service_contracts_due_reminders
  ON tc_service_contracts (next_renewal_at)
  WHERE status = 'active' AND reminder_sent_for_cycle = false;

INSERT INTO mc_schema_migrations (id)
VALUES ('031_contract_renewals')
ON CONFLICT (id) DO NOTHING;
