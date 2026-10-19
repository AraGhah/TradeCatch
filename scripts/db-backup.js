#!/usr/bin/env node
/**
 * Writes a restorable backup of the application database.
 *
 *   BACKUP_DATABASE_URL=… npm run db:backup [-- --out backups]
 *
 * The URL is read only from BACKUP_DATABASE_URL (never from DATABASE_URL by
 * accident). Against Supabase use the direct connection or the pooler in
 * *session* mode (port 5432): transaction-mode pooling cannot run pg_dump.
 *
 * The dump is read-only on the database. It contains customer data and sealed
 * credentials, so it is written with owner-only permissions and must be stored
 * encrypted and off the host. See docs/BACKUP_AND_RECOVERY.md.
 */
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");
const { runPg, identity } = require("./lib/pg-cli");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const url = process.env.BACKUP_DATABASE_URL?.trim();
  if (!url) {
    console.error("BACKUP_DATABASE_URL is required (a session-mode or direct Postgres URL).");
    process.exit(1);
  }
  const outDir = path.resolve(argValue("--out") || "backups");
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z");
  const file = path.join(outDir, `tradecatch-${stamp}.dump`);

  console.log(`Backing up ${identity(url)} -> ${file}`);
  const stream = fs.createWriteStream(file, { mode: 0o600 });
  const result = await runPg(
    "pg_dump",
    // Custom format is compressed and lets pg_restore verify and select parts.
    // Owners and grants are dropped so it restores into any project; the
    // Data API lockdown is re-applied afterwards (npm run db:lockdown).
    ["--format=custom", "--no-owner", "--no-acl", "--schema=public"],
    { url, stdout: stream },
  );
  await new Promise((resolve) => stream.end(resolve));
  if (result.code !== 0) {
    fs.rmSync(file, { force: true });
    console.error(`pg_dump failed (exit ${result.code}). ${result.stderr.split("\n").slice(-3).join(" | ")}`);
    process.exit(1);
  }

  const bytes = fs.statSync(file).size;
  if (bytes < 1024) {
    fs.rmSync(file, { force: true });
    console.error("The backup is implausibly small; refusing to keep it.");
    process.exit(1);
  }
  const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  fs.writeFileSync(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`, { mode: 0o600 });
  console.log(`OK ${bytes} bytes, sha256 ${digest}`);
  console.log("Next: restore it into a scratch database with `npm run db:restore-drill`. A backup that was never restored is not a backup.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "backup failed");
  process.exit(1);
});
