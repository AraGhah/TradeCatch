-- Closes the Supabase Data API (PostgREST) to every TradeCatch table.
--
-- Why: tables in the `public` schema are reachable over HTTPS at
-- https://<project>.supabase.co/rest/v1/<table> by anyone holding the project's
-- anon key, which is public by design, unless row-level security (RLS) denies
-- them. TradeCatch never uses the Data API: the app talks to Postgres directly
-- through the pooler as the table owner, so nothing legitimate depends on it.
--
-- What:
--   1. Enable RLS, with no policies (= deny all), on every app table.
--      The owner / BYPASSRLS role the app connects as is exempt, so the app is
--      unaffected. Policies are deliberately NOT added: any permissive policy
--      for anon/authenticated would reopen the hole.
--   2. Revoke all privileges on those tables from anon and authenticated, so a
--      policy added by mistake later still cannot expose anything, and stop new
--      tables from being granted to them by default.
--
-- Idempotent. Run it through scripts/lockdown-data-api.js, which checks the
-- connecting role is exempt from RLS and rolls back if anything looks wrong.
--
-- Roll back (re-opens the API; only do this deliberately):
--   ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON TABLE public.<table> TO anon, authenticated;

DO $$
DECLARE
  t record;
  api_role text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname ~ '^(tc|mc|rc|em)_'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);

    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t.relname, api_role);
      END IF;
    END LOOP;
  END LOOP;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
