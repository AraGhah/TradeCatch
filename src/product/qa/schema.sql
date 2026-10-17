-- QA execution summaries for the admin test center.
-- Apply via npm run db:schema (migration 016_qa).

CREATE TABLE IF NOT EXISTS tc_test_runs (
  id TEXT PRIMARY KEY,
  suite TEXT NOT NULL,
  environment TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  passed INT NOT NULL,
  failed INT NOT NULL,
  skipped INT NOT NULL,
  duration_ms INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_test_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  suite TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  expected TEXT NOT NULL,
  actual TEXT,
  error TEXT,
  records TEXT,
  duration_ms INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO mc_schema_migrations (id) VALUES ('016_qa') ON CONFLICT (id) DO NOTHING;
