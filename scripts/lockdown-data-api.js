#!/usr/bin/env node
/**
 * Report on, and optionally close, the Supabase Data API exposure of the
 * TradeCatch tables. See scripts/sql/lockdown-data-api.sql for the reasoning.
 *
 *   node scripts/lockdown-data-api.js            # read-only report
 *   node scripts/lockdown-data-api.js --apply    # apply, verify, commit (or roll back)
 *
 * Safety:
 *  - The report only reads catalog metadata. It never reads table contents.
 *  - --apply refuses to run unless the connecting role is exempt from RLS on
 *    every app table (owner / BYPASSRLS / superuser). Otherwise enabling RLS
 *    would lock the app out of its own data.
 *  - --apply runs in one transaction and re-checks the result before COMMIT:
 *    RLS on everywhere, nothing granted to anon/authenticated, and
 *    row_security_active() false for this role on every table.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const TABLE_FILTER = "c.relname ~ '^(tc|mc|rc|em)_'";

async function inspect(client) {
  const me = await client.query(
    `SELECT current_user AS name, r.rolsuper, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const tables = await client.query(
    `SELECT c.oid, c.relname, c.relrowsecurity AS rls,
            pg_get_userbyid(c.relowner) = current_user AS owned,
            row_security_active(c.oid) AS rls_applies_to_me
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND ${TABLE_FILTER}
      ORDER BY c.relname`,
  );
  const roles = await client.query(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`,
  );
  const exposed = [];
  for (const role of roles.rows) {
    const res = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND ${TABLE_FILTER}
          AND (has_table_privilege($1, c.oid, 'SELECT') OR has_table_privilege($1, c.oid, 'INSERT')
            OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE'))
        ORDER BY c.relname`,
      [role.rolname],
    );
    for (const row of res.rows) exposed.push({ role: role.rolname, table: row.relname });
  }
  return {
    me: me.rows[0],
    tables: tables.rows,
    apiRoles: roles.rows.map((r) => r.rolname),
    exposed,
  };
}

function summarize(state) {
  const withoutRls = state.tables.filter((t) => !t.rls);
  const exposedTables = new Set(state.exposed.map((e) => e.table));
  console.info(`Connected as: ${state.me.name} (superuser=${state.me.rolsuper}, bypassrls=${state.me.rolbypassrls})`);
  console.info(`App tables: ${state.tables.length}`);
  console.info(`  without row-level security: ${withoutRls.length}`);
  console.info(`  Data API roles present: ${state.apiRoles.length ? state.apiRoles.join(", ") : "none (not a Supabase database)"}`);
  console.info(`  tables a Data API role can read or write: ${exposedTables.size}`);
  return { withoutRls, exposedTables };
}

function exemptReason(state) {
  const unexempt = state.tables.filter((t) => t.rls_applies_to_me || (!t.rls && !t.owned && !state.me.rolbypassrls && !state.me.rolsuper));
  if (state.me.rolsuper || state.me.rolbypassrls) return { ok: true, why: "role bypasses RLS" };
  if (state.tables.every((t) => t.owned) && state.tables.every((t) => !t.rls_applies_to_me)) {
    return { ok: true, why: "role owns every app table" };
  }
  return { ok: false, why: `role is not exempt on: ${unexempt.map((t) => t.relname).slice(0, 5).join(", ")}` };
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const apply = process.argv.includes("--apply");
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const before = await inspect(client);
    const { withoutRls, exposedTables } = summarize(before);
    if (before.tables.length === 0) {
      console.error("No application tables found. Is this the right database?");
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.info(
        withoutRls.length === 0 && exposedTables.size === 0
          ? "Nothing to do: the Data API is already closed to every app table."
          : "Report only. Re-run with --apply to enable RLS and revoke Data API privileges.",
      );
      process.exitCode = withoutRls.length === 0 && exposedTables.size === 0 ? 0 : 2;
      return;
    }

    const exempt = exemptReason(before);
    if (!exempt.ok) {
      console.error(`Refusing to apply: ${exempt.why}. Enabling RLS would lock the app out of its tables.`);
      process.exitCode = 1;
      return;
    }
    console.info(`RLS exemption check passed (${exempt.why}).`);

    const sql = fs.readFileSync(path.join(__dirname, "sql", "lockdown-data-api.sql"), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      const after = await inspect(client);
      const problems = [];
      const stillOpen = after.tables.filter((t) => !t.rls);
      if (stillOpen.length) problems.push(`${stillOpen.length} table(s) still without RLS`);
      if (after.exposed.length) problems.push(`${after.exposed.length} Data API grant(s) remain`);
      const locked = after.tables.filter((t) => t.rls_applies_to_me);
      if (locked.length) problems.push(`RLS would apply to this role on ${locked.length} table(s), so the app would be locked out`);
      if (problems.length) throw new Error(problems.join("; "));
      await client.query("COMMIT");
      console.info("Applied and verified:");
      summarize(after);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`Rolled back, nothing changed: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
