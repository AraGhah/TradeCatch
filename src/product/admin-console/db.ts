import type { Pool } from "pg";
import { getPgPool } from "@/product/missed-call/postgres-store";

/**
 * The database the administration console reads and writes, or null when the
 * deployment has no durable PostgreSQL (local development and the e2e harness).
 * `connect` is only there on a real pool; tests pass a bare `{ query }`.
 */
export type AdminDb = Pick<Pool, "query"> & Partial<Pick<Pool, "connect">>;

let override: AdminDb | null | undefined;

/** Tests point the console at an embedded Postgres (or force "no database"). */
export function setAdminDbForTests(db: AdminDb | null | undefined) {
  override = db;
}

export function adminDb(): AdminDb | null {
  if (override !== undefined) return override;
  const url = process.env.DATABASE_URL?.trim();
  const durable =
    process.env.SAAS_DURABLE_STORE === "1" ||
    process.env.MISSED_CALL_DURABLE_STORE === "1";
  return url && durable ? getPgPool(url) : null;
}

/** True for "relation does not exist" / "column does not exist": the migration has not run. */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

/**
 * Runs `work` while holding a Postgres advisory lock named `key`, so two
 * server instances cannot do the same thing at once (the in-process queue only
 * covers one). Without a pooled connection (tests, no database) it just runs.
 * The lock is always released, and a lock that cannot be taken never blocks the
 * work forever: the caller's own duplicate check still runs inside it.
 */
export async function withAdvisoryLock<T>(
  db: AdminDb | null,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!db?.connect) return work();
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
    try {
      return await work();
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
