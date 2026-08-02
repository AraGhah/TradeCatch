#!/usr/bin/env node
/**
 * Apply src/product/missed-call/schema.sql to DATABASE_URL.
 * Usage: npm run db:schema
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const schemaPath = path.join(
    __dirname,
    "..",
    "src",
    "product",
    "missed-call",
    "schema.sql",
  );
  const sql = fs.readFileSync(schemaPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO mc_schema_migrations (id)
       VALUES ('schema.sql')
       ON CONFLICT (id) DO NOTHING`,
    );
    console.info("Applied missed-call schema.sql");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
