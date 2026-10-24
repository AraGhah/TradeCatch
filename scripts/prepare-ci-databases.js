"use strict";
const { Client } = require("pg");
const { readFileSync } = require("node:fs");

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true")
    throw new Error(
      "This setup is restricted to disposable GitHub Actions databases.",
    );
  const url = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL || "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/tc003_staging" ||
    url.search
  )
    throw new Error("Expected the isolated loopback CI database.");
  const client = new Client({ connectionString: url.href });
  await client.connect();
  try {
    for (const name of ["tc002_staging", "tc004_staging", "tc006_staging"]) {
      const found = await client.query(
        "SELECT 1 FROM pg_database WHERE datname=$1",
        [name],
      );
      if (!found.rowCount) await client.query(`CREATE DATABASE ${name}`);
    }
  } finally {
    await client.end();
  }
  url.pathname = "/tc004_staging";
  const gmail = new Client({ connectionString: url.href });
  await gmail.connect();
  try {
    for (const file of [
      "src/product/missed-call/schema.sql",
      "src/product/notifications/schema.sql",
      "src/product/notifications/delivery-reliability.sql",
      "src/product/notifications/localized-content.sql",
      "src/product/gmail/schema.sql",
    ])
      await gmail.query(readFileSync(file, "utf8"));
  } finally {
    await gmail.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
