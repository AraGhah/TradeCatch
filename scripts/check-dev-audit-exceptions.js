#!/usr/bin/env node
/**
 * Blocks CI when a tracked dev-audit exception has expired.
 * Production `npm audit --omit=dev` remains the hard gate.
 */
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "docs", "dev-audit-exceptions.json");
const rows = JSON.parse(fs.readFileSync(file, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const expired = rows.filter((r) => r.expiresOn < today);
if (expired.length) {
  console.error("Expired dev audit exceptions — renew or remove:");
  for (const row of expired) {
    console.error(` - ${row.id} (${row.package}) expired ${row.expiresOn}`);
  }
  process.exit(1);
}
console.log(`Dev audit exceptions OK (${rows.length} tracked, none expired)`);
