import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

/**
 * A private schema holding the notification tables, inside the loopback test
 * database. The outbox and dispatch queues are claimed across every business,
 * so suites that run in parallel against the same tables would process (or
 * dead-letter) each other's events. Each suite that enqueues events through
 * the real processor gets its own copy instead.
 */
export async function createNotificationTestSchema(databaseUrl: string) {
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(
    ["/tc003_staging", "/notifications_staging"].includes(url.pathname),
  );
  assert.equal(url.search, "");

  const schema = "iso_" + randomUUID().replace(/-/g, "").slice(0, 12);
  const connectionString = `${databaseUrl}?options=-c%20search_path%3D${schema}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = new Pool({ connectionString });
  try {
    // The notification migrations record themselves in this table.
    await scoped.query(
      "CREATE TABLE IF NOT EXISTS mc_schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())",
    );
    for (const file of [
      "schema.sql",
      "delivery-reliability.sql",
      "localized-content.sql",
    ]) {
      await scoped.query(
        readFileSync("src/product/notifications/" + file, "utf8"),
      );
    }
  } finally {
    await scoped.end();
  }
  return {
    connectionString,
    async drop() {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}
