import { createId } from "@/lib/id";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { AgentRunStore } from "./store";
import type { AgentRun } from "./types";

function rowToRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    agentName: String(row.agent_name),
    trigger: String(row.trigger),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    input: row.input_json,
    toolCalls: (row.tool_calls_json as AgentRun["toolCalls"]) ?? [],
    output: row.output_json,
    costUsd: Number(row.cost_usd ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    status: row.status as AgentRun["status"],
    error: row.error ? String(row.error) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export function createPostgresAgentRunStore(
  connectionString: string,
): AgentRunStore {
  const pool = getPgPool(connectionString);

  return {
    async saveRun(run) {
      const id = run.id ?? createId("run");
      const { rows } = await pool.query(
        `INSERT INTO tc_agent_runs
           (id, agent_name, trigger, organization_id, input_json, tool_calls_json,
            output_json, cost_usd, duration_ms, status, error, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         RETURNING *`,
        [
          id,
          run.agentName,
          run.trigger,
          run.organizationId,
          JSON.stringify(run.input ?? null),
          JSON.stringify(run.toolCalls ?? []),
          JSON.stringify(run.output ?? null),
          run.costUsd,
          run.durationMs,
          run.status,
          run.error ?? null,
        ],
      );
      return rowToRun(rows[0]);
    },
    async listRuns(filter = {}) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (filter.agentName) {
        values.push(filter.agentName);
        conditions.push(`agent_name = $${values.length}`);
      }
      if (filter.organizationId) {
        values.push(filter.organizationId);
        conditions.push(`organization_id = $${values.length}`);
      }
      values.push(filter.limit ?? 50);
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const { rows } = await pool.query(
        `SELECT * FROM tc_agent_runs ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length}`,
        values,
      );
      return rows.map(rowToRun);
    },
    async getRun(id) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_agent_runs WHERE id = $1`,
        [id],
      );
      return rows[0] ? rowToRun(rows[0]) : null;
    },
  };
}
