import { getPgPool } from "@/product/missed-call/postgres-store";
import { runQaSuite } from "./runner";
import { createMemoryQaStore, type QaRun, type QaStore } from "./store";

const globalForQa = globalThis as unknown as { __tradecatchQa?: QaStore };

function store(): QaStore {
  if (!globalForQa.__tradecatchQa) {
    const url = process.env.DATABASE_URL?.trim();
    const durable = process.env.MISSED_CALL_DURABLE_STORE === "1" || process.env.SAAS_DURABLE_STORE === "1";
    globalForQa.__tradecatchQa = durable && url ? postgresStore(url) : createMemoryQaStore();
  }
  return globalForQa.__tradecatchQa;
}

export function getQaService() {
  return {
    catalog() {
      return ["all", "ai", "phone", "appointments", "sms", "e2e", "payments", "security", "failures", "performance"];
    },
    history: () => store().listRuns(),
    run: (suite?: string) => runQaSuite(store(), suite || "all", process.env.TRADECATCH_VERSION?.trim() || "0.1.0"),
  };
}

function postgresStore(connectionString: string): QaStore {
  const pool = getPgPool(connectionString);
  return {
    async saveRun(run) {
      await pool.query(
        `INSERT INTO tc_test_runs (id, suite, environment, version, status, passed, failed, skipped, duration_ms, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [run.id, run.suite, run.environment, run.version, run.status, run.passed, run.failed, run.skipped, run.durationMs, run.createdAt],
      );
      for (const result of run.results) {
        await pool.query(
          `INSERT INTO tc_test_results (id, run_id, suite, name, status, expected, actual, error, records, duration_ms, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [result.id, result.runId, result.suite, result.name, result.status, result.expected, result.actual ?? null, result.error ?? null, result.records?.join(",") ?? null, result.durationMs, result.createdAt],
        );
      }
    },
    async listRuns() {
      const runs = await pool.query(`SELECT * FROM tc_test_runs ORDER BY created_at DESC LIMIT 20`);
      const results = await pool.query(`SELECT * FROM tc_test_results WHERE run_id = ANY($1::text[])`, [runs.rows.map((row) => row.id)]);
      return runs.rows.map((row) => ({
        id: String(row.id),
        suite: String(row.suite),
        environment: String(row.environment),
        version: String(row.version),
        status: row.status,
        passed: Number(row.passed),
        failed: Number(row.failed),
        skipped: Number(row.skipped),
        durationMs: Number(row.duration_ms),
        createdAt: new Date(String(row.created_at)).toISOString(),
        results: results.rows.filter((item) => item.run_id === row.id).map((item) => ({
          id: String(item.id),
          runId: String(item.run_id),
          suite: String(item.suite),
          name: String(item.name),
          status: item.status,
          expected: String(item.expected),
          actual: item.actual ? String(item.actual) : undefined,
          error: item.error ? String(item.error) : undefined,
          records: item.records ? String(item.records).split(",") : undefined,
          durationMs: Number(item.duration_ms),
          createdAt: new Date(String(item.created_at)).toISOString(),
        })),
      })) as QaRun[];
    },
  };
}
