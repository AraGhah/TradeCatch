import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Pool } from "pg";

/**
 * Real PostgreSQL for tests that must exercise the actual SQL and the actual
 * migration files. By default that is PGlite, which skips itself when
 * @electric-sql/pglite is not installed:  npm i --no-save @electric-sql/pglite
 *
 * Set TEST_DATABASE_URL to a LOCAL throwaway server to run the same suites on a
 * real PostgreSQL instead: every `openDb()` then creates (and `close()` drops) its
 * own database, and `poolOf()` returns a genuine `pg.Pool`, so code that needs
 * `pool.connect()` (advisory locks) and several connections is really exercised.
 * Tests create and drop databases, so a non-local host is refused.
 */
export type Db = {
  exec(sql: string): Promise<unknown>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;
  close(): Promise<void>;
  /** Only on a real server (TEST_DATABASE_URL). */
  pool?: Pool;
};

const requireFromRepo = createRequire(path.join(process.cwd(), "package.json"));

/** The local server these suites should use instead of PGlite, or "". */
export const realPgUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";

const pgliteInstalled = (() => {
  try {
    requireFromRepo.resolve("@electric-sql/pglite");
    return true;
  } catch {
    return false;
  }
})();

/** True when some real PostgreSQL (PGlite or TEST_DATABASE_URL) can back a test. */
export const pgliteAvailable = pgliteInstalled || realPgUrl !== "";

export function readSchema(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), "src", "product", ...segments), "utf8");
}

function assertLocalServer(url: string) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `TEST_DATABASE_URL must point at a local throwaway server, not "${host}": these tests create and drop databases.`,
    );
  }
}

async function openRealDb(): Promise<Db> {
  assertLocalServer(realPgUrl);
  // Hex only, so it is safe to put in an identifier.
  const name = `tc_t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = new Pool({ connectionString: realPgUrl, max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(realPgUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 8 });
  return {
    // No parameters: pg uses the simple protocol, which allows a whole schema file.
    exec: (sql) => pool.query(sql),
    query: async (sql, params) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? undefined };
    },
    close: async () => {
      await pool.end();
      const cleaner = new Pool({ connectionString: realPgUrl, max: 1 });
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
    pool,
  };
}

export async function openDb(): Promise<Db> {
  if (realPgUrl) return openRealDb();
  const specifier = "@electric-sql/pglite";
  const { PGlite } = (await import(specifier)) as { PGlite: new () => Db };
  return new PGlite();
}

/** What `pg.Pool` offers the stores under test. */
export function poolOf(db: Db): Pool {
  if (db.pool) return db.pool;
  return {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
  } as unknown as Pool;
}

/**
 * The tables the administration-console migration builds on, created from the
 * REAL schema files where they stand alone and as minimal stubs where they
 * would drag in unrelated products. Returns a database with migration 041
 * applied, ready for use.
 */
export async function openAdminConsoleDb(): Promise<Db> {
  const db = await openDb();
  await db.exec(`
    CREATE TABLE mc_schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE tc_organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'essential', status TEXT NOT NULL DEFAULT 'active',
      account_type TEXT NOT NULL DEFAULT 'live',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE tc_memberships (id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'owner');
  `);
  await db.exec(readSchema("security", "schema.sql"));
  await db.exec(readSchema("website-services", "schema.sql"));
  await db.exec(readSchema("admin-console", "schema.sql"));
  return db;
}
