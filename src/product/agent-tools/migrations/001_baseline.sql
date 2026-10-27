-- Shared agent-run audit log. Enable with DATABASE_URL + AGENT_TOOLS_DURABLE_STORE=1.
-- Apply this file before first use of createPostgresAgentRunStore().

CREATE TABLE IF NOT EXISTS tc_agent_runs (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  organization_id TEXT,
  input_json JSONB NOT NULL,
  tool_calls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_json JSONB,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tc_agent_runs_agent_name_created_at
  ON tc_agent_runs (agent_name, created_at DESC);

CREATE INDEX IF NOT EXISTS tc_agent_runs_organization_id_created_at
  ON tc_agent_runs (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;
