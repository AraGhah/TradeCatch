#!/usr/bin/env node
// Targeted, transactional migration: do not replay unrelated historical migrations.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('027_native_sales_crm'))",
    );
    const existing = await client.query(
      "SELECT id FROM mc_schema_migrations WHERE id='027_native_sales_crm'",
    );
    if (!existing.rowCount) {
      await client.query(
        readFileSync(
          join(__dirname, "..", "src", "product", "sales-crm", "schema.sql"),
          "utf8",
        ),
      );
      await client.query(
        "INSERT INTO mc_schema_migrations (id) VALUES ('027_native_sales_crm')",
      );
    }
    await client.query("COMMIT");
    console.info(
      existing.rowCount
        ? "Native sales CRM migration already applied."
        : "Native sales CRM migration applied.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error("Native sales CRM migration failed", {
    code: error.code || "migration_error",
  });
  process.exitCode = 1;
});
