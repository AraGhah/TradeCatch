-- Email automation (templates, follow-up sequences, enrollments, suppressions).
-- Apply with: npm run db:schema  (migration id 007_email_automation)

CREATE TABLE IF NOT EXISTS em_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS em_templates_org ON em_templates (organization_id);

CREATE TABLE IF NOT EXISTS em_sequences (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  stop_on_reply BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS em_sequences_org ON em_sequences (organization_id);

CREATE TABLE IF NOT EXISTS em_enrollments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  sequence_id TEXT NOT NULL REFERENCES em_sequences (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  vars_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'stopped', 'failed')),
  stop_reason TEXT,
  current_step INTEGER NOT NULL DEFAULT 0,
  next_send_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT,
  source_ref_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active enrollment per contact per sequence.
CREATE UNIQUE INDEX IF NOT EXISTS em_enrollments_active_unique
  ON em_enrollments (organization_id, sequence_id, email)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS em_enrollments_due
  ON em_enrollments (next_send_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS em_enrollments_org_created
  ON em_enrollments (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS em_suppressions (
  organization_id TEXT NOT NULL REFERENCES tc_organizations (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'manual')),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, email)
);

-- Per-organization automation settings (auto-enroll website leads that gave
-- an email and express consent). Idempotent.
CREATE TABLE IF NOT EXISTS em_org_settings (
  organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
  auto_enroll_sequence_id TEXT REFERENCES em_sequences (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
