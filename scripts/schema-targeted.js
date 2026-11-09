#!/usr/bin/env node
/**
 * Targeted schema tooling: compare, then apply only what is missing.
 *
 *   node scripts/schema-targeted.js --check
 *       Read-only. Reports which schema migrations / tables are missing from
 *       DATABASE_URL. Exit code 2 when the database is behind the repository.
 *
 *   node scripts/schema-targeted.js --apply <id[,id...]> --yes
 *       Applies ONLY the named migrations, each in its own transaction with a
 *       lock + statement timeout, and records the id only on success. Safe to
 *       rerun: a migration that is already recorded is skipped.
 *
 * `npm run db:schema` replays every historical file, including statements that
 * change existing rows (see --check output), so it is not the minimum safe
 * change for a live database. Take a backup first (`npm run db:backup`).
 * Credentials are read from DATABASE_URL and are never printed.
 */
const { Client } = require("pg");
const {
  parseSchemaSteps,
  readStepSql,
  tablesCreatedBy,
  managesOwnTransaction,
  replayHazards,
} = require("./lib/schema-steps");

function targetLabel(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function connect() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(new URL(url).hostname);
  return {
    url,
    client: new Client({
      connectionString: url,
      ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
    }),
  };
}

async function check() {
  const { url, client } = connect();
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const applied = new Set(
      (await client.query("SELECT id FROM mc_schema_migrations")).rows.map(
        (r) => r.id,
      ),
    );
    const tables = new Set(
      (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
        )
      ).rows.map((r) => r.table_name),
    );
    await client.query("ROLLBACK");

    console.info(`Target: ${targetLabel(url)} (read-only)`);
    let behind = 0;
    const seen = new Set();
    for (const step of parseSchemaSteps()) {
      const key = `${step.id}|${step.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sql = readStepSql(step);
      const missingTables = tablesCreatedBy(sql).filter((t) => !tables.has(t));
      const recorded = applied.has(step.id);
      const hazards = replayHazards(sql);
      const state = recorded && missingTables.length === 0 ? "ok     " : "MISSING";
      if (state === "MISSING") behind += 1;
      console.info(
        `${state} ${step.id.padEnd(40)} ${step.file}` +
          (missingTables.length ? `  missing tables: ${missingTables.join(",")}` : "") +
          (hazards.length ? `  [replay hazard: ${hazards.join(", ")}]` : ""),
      );
    }
    console.info(
      behind
        ? `\n${behind} migration(s) behind. Apply the minimum with: node scripts/schema-targeted.js --apply <id,...> --yes`
        : "\nSchema is up to date.",
    );
    process.exitCode = behind ? 2 : 0;
  } finally {
    await client.end();
  }
}

async function applyOnly(ids) {
  const steps = parseSchemaSteps();
  for (const id of ids)
    if (!steps.some((s) => s.id === id))
      throw new Error(`Unknown migration id: ${id}`);
  const { url, client } = connect();
  console.info(`Target: ${targetLabel(url)}`);
  await client.connect();
  try {
    for (const id of ids) {
      // Run in the repository's order, once per id.
      const step = steps.find((s) => s.id === id);
      const sql = readStepSql(step);
      const own = managesOwnTransaction(sql);
      if (!own) {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '60s'");
      }
      try {
        await client.query(
          "SELECT pg_advisory_lock(hashtext($1))",
          [`schema:${id}`],
        );
        const done = await client.query(
          "SELECT 1 FROM mc_schema_migrations WHERE id=$1",
          [id],
        );
        if (done.rowCount) {
          console.info(`skip  ${id} (already recorded)`);
        } else {
          await client.query(sql);
          await client.query(
            "INSERT INTO mc_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
            [id],
          );
          console.info(`apply ${id}`);
        }
        if (!own) await client.query("COMMIT");
      } catch (error) {
        if (!own) await client.query("ROLLBACK");
        throw error;
      } finally {
        await client
          .query("SELECT pg_advisory_unlock(hashtext($1))", [`schema:${id}`])
          .catch(() => undefined);
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) return check();
  const at = args.indexOf("--apply");
  if (at >= 0) {
    const ids = (args[at + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new Error("--apply needs a comma-separated id list");
    if (!args.includes("--yes"))
      throw new Error("Refusing to write without --yes (run --check first)");
    return applyOnly(ids);
  }
  console.info(
    "Usage: node scripts/schema-targeted.js --check | --apply <id,...> --yes",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  // Never echo driver messages: they can contain connection details.
  console.error("schema-targeted failed", {
    code: error.code || "error",
    message: /^Unknown migration|^DATABASE_URL|^--apply|^Refusing/.test(error.message)
      ? error.message
      : undefined,
  });
  process.exitCode = 1;
});
