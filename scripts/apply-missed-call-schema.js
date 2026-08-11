#!/usr/bin/env node
/**
 * Apply Module A + SaaS schemas to DATABASE_URL.
 * Usage: npm run db:schema
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function applyFile(client, relativePath, migrationId) {
  const schemaPath = path.join(__dirname, "..", ...relativePath);
  const sql = fs.readFileSync(schemaPath, "utf8");
  await client.query(sql);
  await client.query(
    `INSERT INTO mc_schema_migrations (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [migrationId],
  );
  console.info(`Applied ${relativePath.join("/")}`);
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await applyFile(
      client,
      ["src", "product", "missed-call", "schema.sql"],
      "schema.sql",
    );
    await applyFile(
      client,
      ["src", "product", "saas", "schema.sql"],
      "002_saas_foundation",
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
