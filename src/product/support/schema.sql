-- Support tickets, help catalog, and account requests.
-- Apply via npm run db:schema (migration 018_support).

CREATE TABLE IF NOT EXISTS tc_help_categories (
  id TEXT PRIMARY KEY,
  sort_order INT NOT NULL
);

CREATE TABLE IF NOT EXISTS tc_help_articles (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_fr TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_fr TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tc_support_tickets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  related_call_id TEXT,
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_role TEXT NOT NULL,
  body TEXT NOT NULL,
  internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_support_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_support_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_account_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  phone_routing TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_customer_feedback (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO mc_schema_migrations (id) VALUES ('018_support') ON CONFLICT (id) DO NOTHING;
