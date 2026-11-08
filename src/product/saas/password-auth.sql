-- 037_password_auth: passwords for customer sign-in, and the single-use links
-- that let someone choose or reset one.
--
-- Additive only. Existing users, sessions and magic links are untouched, and
-- email sign-in links keep working exactly as before. A user with no row in
-- tc_user_passwords simply has not chosen a password yet.
-- Safe to run more than once.
BEGIN;

-- Only a salted slow hash is stored, never the password itself.
CREATE TABLE IF NOT EXISTS tc_user_passwords (
  user_id TEXT PRIMARY KEY REFERENCES tc_users (id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Account activation and password reset links. Only the SHA-256 of the token is
-- stored; the token itself exists only in the email.
CREATE TABLE IF NOT EXISTS tc_password_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES tc_users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('activation', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_password_tokens_user_open
  ON tc_password_tokens (user_id)
  WHERE consumed_at IS NULL;

COMMIT;
