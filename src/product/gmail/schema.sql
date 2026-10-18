-- Gmail receiving: one connected mailbox per user, plus a local copy of
-- received mail. Apply via npm run db:schema (migration 019_gmail).
-- Safe to re-run: every statement is idempotent.

CREATE TABLE IF NOT EXISTS tc_gmail_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  user_id text NOT NULL,
  email text,
  status text NOT NULL,
  -- AES-256-GCM sealed OAuth tokens (see oauth.ts). Never selected for the browser.
  token_ciphertext text,
  history_id text,
  watch_expiration timestamptz,
  last_sync_at timestamptz,
  last_attempt_at timestamptz,
  next_sync_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  sync_lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, user_id)
);

ALTER TABLE tc_gmail_accounts ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE tc_gmail_accounts ADD COLUMN IF NOT EXISTS next_sync_at timestamptz;
ALTER TABLE tc_gmail_accounts ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE tc_gmail_accounts ADD COLUMN IF NOT EXISTS sync_lease_until timestamptz;

CREATE TABLE IF NOT EXISTS tc_gmail_messages (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  user_id text NOT NULL,
  account_id text NOT NULL REFERENCES tc_gmail_accounts (id) ON DELETE CASCADE,
  gmail_id text NOT NULL,
  thread_id text NOT NULL,
  from_name text,
  from_email text NOT NULL,
  subject text NOT NULL,
  snippet text NOT NULL,
  body_text text,
  received_at timestamptz NOT NULL,
  unread boolean NOT NULL,
  has_attachments boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  important boolean NOT NULL DEFAULT false,
  direction text NOT NULL DEFAULT 'inbound',
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, gmail_id)
);

ALTER TABLE tc_gmail_messages ADD COLUMN IF NOT EXISTS important boolean NOT NULL DEFAULT false;
ALTER TABLE tc_gmail_messages ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound';

CREATE INDEX IF NOT EXISTS tc_gmail_messages_owner_received
  ON tc_gmail_messages (organization_id, user_id, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS tc_gmail_messages_thread
  ON tc_gmail_messages (account_id, thread_id);

CREATE INDEX IF NOT EXISTS tc_gmail_messages_unread
  ON tc_gmail_messages (organization_id, user_id)
  WHERE unread AND direction = 'inbound';

CREATE INDEX IF NOT EXISTS tc_gmail_accounts_email
  ON tc_gmail_accounts (lower(email));

-- Mail bodies and encrypted tokens must never be reachable through Supabase's
-- public REST API. The server connects as the table owner, which bypasses RLS;
-- with no policies defined, anon and authenticated roles get nothing.
ALTER TABLE tc_gmail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_gmail_messages ENABLE ROW LEVEL SECURITY;
