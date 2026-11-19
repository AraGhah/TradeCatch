import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Pool } from "pg";

/**
 * Real PostgreSQL (PGlite) for tests that must exercise the actual SQL and the
 * actual migration files. Skips itself when @electric-sql/pglite is not
 * installed:  npm i --no-save @electric-sql/pglite
 */
export type Db = {
  exec(sql: string): Promise<unknown>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;
  close(): Promise<void>;
};

const requireFromRepo = createRequire(path.join(process.cwd(), "package.json"));

export const pgliteAvailable = (() => {
  try {
    requireFromRepo.resolve("@electric-sql/pglite");
    return true;
  } catch {
    return false;
  }
})();

export function readSchema(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), "src", "product", ...segments), "utf8");
}

export async function openDb(): Promise<Db> {
  const specifier = "@electric-sql/pglite";
  const { PGlite } = (await import(specifier)) as { PGlite: new () => Db };
  return new PGlite();
}

/** What `pg.Pool` offers the stores under test. */
export function poolOf(db: Db): Pool {
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
