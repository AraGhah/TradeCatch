-- Growth product tables (booking, pipeline, revenue, reviews).
-- Apply after starter schema. npm run db:schema

CREATE TABLE IF NOT EXISTS tc_org_settings (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  notify_email TEXT,
  google_review_url TEXT,
  qualification_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_completed_at TIMESTAMPTZ,
  locale_default TEXT NOT NULL DEFAULT 'en' CHECK (locale_default IN ('en', 'fr')),
  owner_notify_phone_e164 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_phone_e164 TEXT,
  customer_email TEXT,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'website', 'missed_call', 'quote')),
  source_ref_id TEXT,
  reminder_24h_sent BOOLEAN NOT NULL DEFAULT false,
  reminder_2h_sent BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_appointments_org_starts
  ON tc_appointments (organization_id, starts_at);

CREATE INDEX IF NOT EXISTS tc_appointments_reminders
  ON tc_appointments (starts_at)
  WHERE status IN ('scheduled', 'confirmed')
    AND (reminder_24h_sent = false OR reminder_2h_sent = false);

CREATE TABLE IF NOT EXISTS tc_pipeline_cards (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'contacted', 'qualified', 'quoted', 'booked', 'won', 'lost')),
  title TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('missed_call', 'website', 'quote', 'manual')),
  source_ref_id TEXT,
  customer_phone_e164 TEXT,
  estimated_value NUMERIC,
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_pipeline_org_stage
  ON tc_pipeline_cards (organization_id, stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS tc_revenue_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  source TEXT NOT NULL
    CHECK (source IN ('missed_call', 'website', 'quote', 'booking', 'manual')),
  source_ref_id TEXT,
  pipeline_card_id TEXT REFERENCES tc_pipeline_cards (id) ON DELETE SET NULL,
  note TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_revenue_org_occurred
  ON tc_revenue_events (organization_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tc_review_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  customer_phone_e164 TEXT NOT NULL,
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'clicked', 'skipped', 'failed')),
  appointment_id TEXT REFERENCES tc_appointments (id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_review_due
  ON tc_review_requests (scheduled_for)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS tc_timeline_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_timeline_org_at
  ON tc_timeline_events (organization_id, at DESC);

INSERT INTO mc_schema_migrations (id)
VALUES ('004_growth_and_settings')
ON CONFLICT (id) DO NOTHING;
