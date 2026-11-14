-- 039_auth_sessions: refresh tokens for short-lived access tokens, and
-- support-handled account recovery requests.
--
-- Additive only. Existing users, sessions, passwords and business data are
-- untouched. Safe to run more than once.
BEGIN;

-- One row per refresh token. Only the SHA-256 of the token is stored. A token
-- is rotated (used once); a rotated token presented again ends its session.
-- Deleting a session (or its user) deletes its refresh tokens.
CREATE TABLE IF NOT EXISTS tc_refresh_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tc_sessions (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES tc_users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tc_refresh_tokens_session
  ON tc_refresh_tokens (session_id);

-- Requests from customers who lost access to the email on their account.
-- An administrator records how identity was verified before any change.
CREATE TABLE IF NOT EXISTS tc_account_recovery_requests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'verified', 'completed', 'rejected')),
  account_email TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  phone TEXT,
  details TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fr')),
  user_id TEXT REFERENCES tc_users (id) ON DELETE SET NULL,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  verification_method TEXT,
  verification_notes TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_account_recovery_requests_status
  ON tc_account_recovery_requests (status, created_at DESC);

COMMIT;
