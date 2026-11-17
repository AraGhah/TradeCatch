import { createRequire } from "node:module";
import path from "node:path";
import type { Pool } from "pg";

/**
 * PGlite (an in-process PostgreSQL) behind the small part of the `pg` Pool API
 * the stores use: query(), and connect() for transactions. PGlite has one
 * connection, so connect() hands it out one caller at a time, the way a real
 * pool hands each caller its own connection: two transactions never
 * interleave on it.
 *
 * PGlite is optional tooling, not an app dependency: suites using it skip when
 * it is not installed (npm i --no-save @electric-sql/pglite).
 */
export type PgliteDb = {
  exec(sql: string): Promise<unknown>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; affectedRows?: number }>;
  close(): Promise<void>;
};

const requireFromRepo = createRequire(path.join(process.cwd(), "package.json"));

export function pgliteAvailable(): boolean {
  try {
    requireFromRepo.resolve("@electric-sql/pglite");
    return true;
  } catch {
    return false;
  }
}

export async function createPglite(): Promise<PgliteDb> {
  const specifier = "@electric-sql/pglite";
  const { PGlite } = (await import(specifier)) as { PGlite: new () => PgliteDb };
  return new PGlite();
}

export function poolOf(db: PgliteDb): Pool & { failNext?: (match: RegExp) => void } {
  let queue: Promise<void> = Promise.resolve();
  let failing: RegExp | null = null;
  const run = async (sql: string, params?: unknown[]) => {
    if (failing && failing.test(sql)) {
      failing = null;
      throw new Error("simulated database failure");
    }
    const res = await db.query(sql, params);
    return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
  };
  return {
    query: run,
    async connect() {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>((resolve) => (release = resolve));
      await previous;
      return { query: run, release };
    },
    failNext(match: RegExp) {
      failing = match;
    },
  } as unknown as Pool & { failNext?: (match: RegExp) => void };
}
