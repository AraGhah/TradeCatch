#!/usr/bin/env node
/**
 * Proves a backup can be restored, in isolation.
 *
 *   RESTORE_TEST_DATABASE_URL=… [BACKUP_DATABASE_URL=…] \
 *     npm run db:restore-drill -- --dump backups/tradecatch-….dump
 *
 * Restores the dump into an EMPTY scratch database, then checks that the
 * application's tables, schema and data came back. When BACKUP_DATABASE_URL (the
 * database the dump was taken from) is also given, every table's row count and
 * content hash is compared against it. Nothing is ever written to that source,
 * and the script refuses to restore into it, into DATABASE_URL, into a database
 * that already has tables, or into one whose name does not say it is disposable.
 */
const { createHash } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Writable } = require("stream");
const { runPg, identity, databaseName } = require("./lib/pg-cli");

const DISPOSABLE_NAME = /restore|drill|scratch|test|tmp|sandbox/i;
const { fingerprint } = require("./lib/backup-fingerprint");
// The same tables /api/health requires before it calls a database ready.
const REQUIRED_TABLES = [
  "mc_workflows",
  "mc_outbound_messages",
  "tc_organizations",
  "tc_quote_threads",
  "tc_appointments",
  "tc_crm_dlq",
];

/** Returns why this target must not be restored into, or null when it is acceptable. */
function targetProblem(target, protectedUrls, { allowAnyName = false } = {}) {
  let id;
  try {
    id = identity(target);
  } catch {
    return "RESTORE_TEST_DATABASE_URL is not a valid database URL.";
  }
  for (const url of protectedUrls) {
    if (!url) continue;
    try {
      if (identity(url) === id)
        return "the restore target is the same database as a live or source URL.";
    } catch {
      /* an unparsable protected URL cannot match */
    }
  }
  if (!allowAnyName && !DISPOSABLE_NAME.test(databaseName(target))) {
    return `the target database name must contain one of: restore, drill, scratch, test, tmp, sandbox (got "${databaseName(target)}").`;
  }
  return null;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function connect(url) {
  const { Client } = require("pg");
  const client = new Client({
    connectionString: url,
    ssl: /sslmode=(require|verify)/.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

async function main() {
  const dump = argValue("--dump");
  const target = process.env.RESTORE_TEST_DATABASE_URL?.trim();
  const source = process.env.BACKUP_DATABASE_URL?.trim();
  if (!dump || !fs.existsSync(dump)) {
    console.error("--dump <file> is required and must exist.");
    process.exit(1);
  }
  if (!target) {
    console.error(
      "RESTORE_TEST_DATABASE_URL is required: an empty scratch database, never production.",
    );
    process.exit(1);
  }
  const problem = targetProblem(target, [process.env.DATABASE_URL, source], {
    allowAnyName: process.argv.includes("--allow-any-database-name"),
  });
  if (problem) {
    console.error(`Refusing to restore: ${problem}`);
    process.exit(2);
  }

  // 1. The file is the one that was written.
  const sidecar = `${dump}.sha256`;
  if (fs.existsSync(sidecar)) {
    const expected = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
    const actual = createHash("sha256")
      .update(fs.readFileSync(dump))
      .digest("hex");
    if (expected !== actual) {
      console.error(
        "The dump does not match its recorded checksum; it was altered or truncated.",
      );
      process.exit(1);
    }
    console.log("checksum   OK");
  } else {
    console.warn("checksum   SKIPPED (no .sha256 next to the dump)");
  }

  // Bind the snapshot evidence to this exact dump before touching the target.
  const manifestPath = `${dump}.manifest.json`;
  let snapshotPrint;
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const digest = createHash("sha256")
      .update(fs.readFileSync(dump))
      .digest("hex");
    if (
      manifest.version !== 1 ||
      manifest.dumpSha256 !== digest ||
      !manifest.fingerprint
    ) {
      throw new Error("Backup manifest does not match this dump.");
    }
    snapshotPrint = manifest.fingerprint;
  }

  // 2. The target is empty.
  const scratch = await connect(target);
  const existing = Number(
    (
      await scratch.query(
        `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`,
      )
    ).rows[0].n,
  );
  await scratch.end();
  if (existing > 0) {
    console.error(
      `Refusing to restore: the target already has ${existing} tables. Create a new empty database.`,
    );
    process.exit(2);
  }

  // 3. Restore, all or nothing.
  console.log(`restoring  ${path.basename(dump)} -> ${identity(target)}`);
  const started = Date.now();
  // A dump of the public schema also carries `CREATE SCHEMA public`, which fails
  // wherever that schema already exists (every new database, every Supabase
  // project). Everything else in the dump is restored as written.
  const chunks = [];
  const listing = await runPg("pg_restore", (file) => ["--list", file(dump)], {
    url: target,
    stdout: new Writable({
      write: (chunk, _enc, done) => (chunks.push(chunk), done()),
    }),
  });
  if (listing.code !== 0) {
    console.error(
      `pg_restore could not read the dump (exit ${listing.code}). ${listing.stderr.split("\n").slice(-3).join(" | ")}`,
    );
    process.exit(1);
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-restore-"));
  const listFile = path.join(workDir, "restore.list");
  const keep = Buffer.concat(chunks)
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\b/.test(line));
  fs.writeFileSync(listFile, `${keep.join("\n")}\n`);

  // Host, user and password reach pg_restore through the environment; it only
  // needs the database name spelled out (it ignores PGDATABASE when restoring).
  const restored = await runPg(
    "pg_restore",
    (file) => [
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "--single-transaction",
      `--dbname=${databaseName(target)}`,
      `--use-list=${file(listFile)}`,
      file(dump),
    ],
    { url: target },
  );
  fs.rmSync(workDir, { recursive: true, force: true });
  if (restored.code !== 0) {
    console.error(
      `pg_restore failed (exit ${restored.code}). ${restored.stderr.split("\n").slice(-3).join(" | ")}`,
    );
    process.exit(1);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`restore    OK in ${seconds}s`);

  // 4. What came back is usable.
  const problems = [];
  const after = await connect(target);
  const restoredPrint = await fingerprint(after);
  for (const table of REQUIRED_TABLES) {
    if (!restoredPrint.tables.includes(table))
      problems.push(`required table missing: ${table}`);
  }
  if (restoredPrint.tables.length === 0)
    problems.push("no tables were restored");
  const migrations = await after
    .query(`SELECT count(*) AS n FROM mc_schema_migrations`)
    .then(
      (r) => Number(r.rows[0].n),
      () => 0,
    );
  await after.end();
  console.log(
    `tables     ${restoredPrint.tables.length} restored, ${migrations} schema migrations recorded`,
  );

  // 5. It matches the database it was taken from.
  let compared = "not compared (BACKUP_DATABASE_URL not given)";
  let originPrint;
  if (snapshotPrint) {
    originPrint = snapshotPrint;
    compared = "backup snapshot manifest";
  } else if (source) {
    const origin = await connect(source);
    try {
      await origin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      originPrint = await fingerprint(origin);
    } finally {
      await origin.end();
    }
    compared = "live source (may have changed since backup)";
  }
  if (originPrint) {
    for (const key of Object.keys(originPrint.schema)) {
      if (originPrint.schema[key] !== restoredPrint.schema[key])
        problems.push(`schema differs: ${key}`);
    }
    for (const table of originPrint.tables) {
      const a = originPrint.rows[table];
      const b = restoredPrint.rows[table];
      if (!b) problems.push(`table not restored: ${table}`);
      else if (a.count !== b.count)
        problems.push(
          `row count differs in ${table}: ${a.count} vs ${b.count}`,
        );
      else if (a.hash !== b.hash) problems.push(`content differs in ${table}`);
    }
    for (const table of restoredPrint.tables) {
      if (!originPrint.rows[table])
        problems.push(`unexpected table after restore: ${table}`);
    }
    const total = originPrint.tables.reduce(
      (sum, table) => sum + originPrint.rows[table].count,
      0,
    );
    compared += `: ${originPrint.tables.length} tables, ${total} rows, schema + content hashes (tables over 200,000 rows: counts only)`;
  }

  if (problems.length > 0) {
    console.error("compare    FAILED");
    for (const line of problems) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`compare    OK (${compared})`);
  console.log(
    "Restore drill passed. Drop the scratch database when you are done.",
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "restore drill failed",
    );
    process.exit(1);
  });
}

module.exports = { targetProblem };
