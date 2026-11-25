#!/usr/bin/env node
/**
 * Targeted schema tooling: compare, then apply only what is missing.
 *
 *   node scripts/schema-targeted.js --check
 *       Read-only. For every schema step, compares what its SQL creates
 *       (tables, columns, named indexes and constraints, the migration ids it
 *       records) with the database catalog, and lists what is missing. Exit
 *       code 2 when the database is behind the repository.
 *
 *   node scripts/schema-targeted.js --apply <id[,id...]> --yes
 *       Applies ONLY the named migrations, each in its own transaction with a
 *       lock + statement timeout, and records the id only on success. A step
 *       that is recorded AND complete is skipped. A step that is recorded but
 *       incomplete stops the run with the list of what is missing: a recorded
 *       id is never taken as proof that its structures exist.
 *
 *   node scripts/schema-targeted.js --reapply <id[,id...]> --yes
 *       Reruns recorded-but-incomplete steps on purpose. Read their replay
 *       hazards in --check first.
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
  managesOwnTransaction,
  replayHazards,
  expectedStructures,
  introspect,
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

/** Structures of `step` that `present` (from introspect) does not have. */
function missingFor(step, expected, present) {
  return (expected.get(step.id) ?? []).filter((key) => !present.has(key));
}

/**
 * One line per step; returns the number of steps that are behind. `client` is
 * connected; nothing is written (the catalog is read in a READ ONLY
 * transaction).
 */
async function checkWith(client, { log = console.info, steps = parseSchemaSteps() } = {}) {
  await client.query("BEGIN READ ONLY");
  let present;
  try {
    present = await introspect(client);
  } finally {
    await client.query("ROLLBACK");
  }
  const expected = expectedStructures(steps);
  let behind = 0;
  const seen = new Set();
  for (const step of steps) {
    if (seen.has(step.id)) continue;
    seen.add(step.id);
    const missing = missingFor(step, expected, present);
    const hazards = replayHazards(readStepSql(step));
    if (missing.length) behind += 1;
    log(
      `${missing.length ? "MISSING" : "ok     "} ${step.id.padEnd(40)} ${step.file}` +
        (missing.length ? `  missing: ${missing.join(", ")}` : "") +
        (hazards.length ? `  [replay hazard: ${hazards.join(", ")}]` : ""),
    );
  }
  log(
    behind
      ? `\n${behind} migration(s) behind. Apply the minimum with: node scripts/schema-targeted.js --apply <id,...> --yes`
      : "\nSchema is up to date.",
  );
  return behind;
}

/** Applies the named steps in repository order with `client` (connected). */
async function applyWith(
  client,
  ids,
  { reapply = false, log = console.info, steps = parseSchemaSteps() } = {},
) {
  for (const id of ids)
    if (!steps.some((s) => s.id === id))
      throw new Error(`Unknown migration id: ${id}`);
  const expected = expectedStructures(steps);
  const ordered = steps.filter(
    (step, index) =>
      ids.includes(step.id) && steps.findIndex((s) => s.id === step.id) === index,
  );
  for (const step of ordered) {
    const { id } = step;
    const sql = readStepSql(step);
    const own = managesOwnTransaction(sql);
    if (!own) {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
    }
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [`schema:${id}`]);
      const done = await client.query(
        "SELECT 1 FROM mc_schema_migrations WHERE id=$1",
        [id],
      );
      // Its own record is what `done` already says; everything else must be there.
      const missing = done.rowCount
        ? missingFor(step, expected, await introspect(client)).filter(
            (key) => key !== `record ${id}`,
          )
        : [];
      if (done.rowCount && missing.length && !reapply)
        throw new Error(
          `Recorded migration ${id} is incomplete (missing: ${missing.join(", ")}); ` +
            `rerun with --reapply ${id} --yes after a backup`,
        );
      if (done.rowCount && !missing.length) {
        log(`skip  ${id} (already recorded and complete)`);
      } else {
        await client.query(sql);
        await client.query(
          "INSERT INTO mc_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
          [id],
        );
        log(`${done.rowCount ? "reapply" : "apply"} ${id}`);
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
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const { url, client } = connect();
    await client.connect();
    try {
      console.info(`Target: ${targetLabel(url)} (read-only)`);
      process.exitCode = (await checkWith(client)) ? 2 : 0;
    } finally {
      await client.end();
    }
    return;
  }
  const reapply = args.includes("--reapply");
  const at = args.indexOf(reapply ? "--reapply" : "--apply");
  if (at >= 0) {
    const ids = (args[at + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new Error("--apply needs a comma-separated id list");
    if (!args.includes("--yes"))
      throw new Error("Refusing to write without --yes (run --check first)");
    const { url, client } = connect();
    console.info(`Target: ${targetLabel(url)}`);
    await client.connect();
    try {
      await applyWith(client, ids, { reapply });
    } finally {
      await client.end();
    }
    return;
  }
  console.info(
    "Usage: node scripts/schema-targeted.js --check | --apply <id,...> --yes | --reapply <id,...> --yes",
  );
  process.exitCode = 1;
}

if (require.main === module)
  main().catch((error) => {
    // Never echo driver messages: they can contain connection details.
    console.error("schema-targeted failed", {
      code: error.code || "error",
      message: /^Unknown migration|^Recorded migration|^DATABASE_URL|^--apply|^Refusing/.test(error.message)
        ? error.message
        : undefined,
    });
    process.exitCode = 1;
  });

module.exports = { checkWith, applyWith };
