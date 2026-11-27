/**
 * Guards for the 2026-11-25 drift: 012_scheduling was recorded, then the
 * Cal.com and Google Calendar changes were appended to its file, so databases
 * that already had 012 never received them, and the targeted tool skipped the
 * step because its id was recorded. No database is needed here; the
 * real-PostgreSQL repair is in schema-drift-repair.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const steps = require("../../scripts/lib/schema-steps.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyWith } = require("../../scripts/schema-targeted.js");

type Step = { id: string; file: string };

describe("schema steps", () => {
  it("each schema file records only the migration ids of the steps that run it", () => {
    const all: Step[] = steps.parseSchemaSteps();
    const idsByFile = new Map<string, Set<string>>();
    for (const step of all)
      idsByFile.set(step.file, (idsByFile.get(step.file) ?? new Set()).add(step.id));
    for (const [file, ids] of idsByFile) {
      const recorded: string[] = steps.migrationIdsRecordedBy(
        steps.readStepSql({ id: "", file }),
      );
      for (const id of recorded)
        assert.ok(
          ids.has(id),
          `${file} records ${id}, which is not its own step: a new migration must be a new file and a new applyFile step, never appended to a recorded one`,
        );
    }
  });

  it("the Cal.com and Google Calendar tables belong to their own steps, not 012", () => {
    const expected: Map<string, string[]> = steps.expectedStructures();
    for (const table of ["tc_calcom_connections", "tc_calcom_bookings"])
      assert.ok(expected.get("061_scheduling_calcom")?.includes(`table ${table}`));
    for (const table of ["tc_gcal_events", "tc_gcal_event_links"])
      assert.ok(expected.get("062_scheduling_google_sync")?.includes(`table ${table}`));
    assert.ok(
      expected.get("062_scheduling_google_sync")?.includes("column tc_calendar_sync_state.last_error"),
    );
    const scheduling = expected.get("012_scheduling") ?? [];
    assert.ok(!scheduling.some((key) => /calcom|gcal/.test(key)));
    assert.ok(scheduling.includes("table tc_calendar_sync_state"));
  });

  it("the repair steps change no existing rows", () => {
    for (const id of [
      "060_scheduling_confirmation_recovery",
      "061_scheduling_calcom",
      "062_scheduling_google_sync",
    ]) {
      const step = steps.parseSchemaSteps().find((s: Step) => s.id === id);
      const sql = steps.readStepSql(step).replace(/--[^\n]*/g, "");
      assert.doesNotMatch(sql, /\b(UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|COLUMN|INDEX)|TRUNCATE)\b/i, id);
    }
  });

  it("reads columns, indexes, constraints and records in statement order", () => {
    const keys = steps
      .structureEvents(`
        -- CREATE TABLE IF NOT EXISTS commented_out (x INT);
        CREATE TABLE IF NOT EXISTS t (
          id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state IN ('a', 'b')),
          "quoted" NUMERIC(10, 2),
          PRIMARY KEY (id),
          CONSTRAINT inline_named CHECK (id <> '')
        );
        ALTER TABLE t ADD COLUMN IF NOT EXISTS a INT, ADD COLUMN b TEXT;
        ALTER TABLE t DROP CONSTRAINT IF EXISTS t_check;
        ALTER TABLE t ADD CONSTRAINT t_check CHECK (a > 0);
        CREATE UNIQUE INDEX IF NOT EXISTS t_a ON t (a) WHERE a IS NOT NULL;
        INSERT INTO mc_schema_migrations (id) VALUES ('900_test') ON CONFLICT (id) DO NOTHING;
      `)
      .map((e: { op: string; key: string }) => `${e.op} ${e.key}`);
    assert.deepEqual(keys, [
      "add table t",
      "add column t.id",
      "add column t.state",
      "add column t.quoted",
      "add column t.a",
      "add column t.b",
      "drop constraint t_check",
      "add constraint t_check",
      "add index t_a",
      "add record 900_test",
    ]);
  });

  it("a constraint a later step drops is not expected from the step that first added it", () => {
    const fake: Step[] = [
      { id: "001_a", file: "a" },
      { id: "002_b", file: "b" },
      { id: "003_c", file: "c" },
    ];
    const sql: Record<string, string> = {
      a: "CREATE TABLE IF NOT EXISTS t (id INT); ALTER TABLE t ADD CONSTRAINT t_old CHECK (id > 0); ALTER TABLE t ADD CONSTRAINT t_mode CHECK (id < 9);",
      b: "ALTER TABLE t DROP CONSTRAINT IF EXISTS t_old;",
      c: "ALTER TABLE t DROP CONSTRAINT IF EXISTS t_mode; ALTER TABLE t ADD CONSTRAINT t_mode CHECK (id < 10);",
    };
    const expected = steps.expectedStructures(fake, (s: Step) => sql[s.file]);
    assert.deepEqual(expected.get("001_a"), ["record 001_a", "table t", "column t.id"]);
    assert.deepEqual(expected.get("002_b"), ["record 002_b"]);
    assert.deepEqual(expected.get("003_c"), ["record 003_c", "constraint t_mode"]);
  });
});

/** Answers the catalog queries of introspect() from a list of keys. */
function fakeClient(present: string[]) {
  const ran: string[] = [];
  const has = (prefix: string) =>
    present.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  return {
    ran,
    async query(sql: string, params?: unknown[]) {
      // First: a step's own SQL can mention the catalog (061 reads pg_constraint).
      if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) {
        ran.push("step sql");
        return { rows: [], rowCount: 0 };
      }
      if (/relkind IN \('r','p','i'\)/.test(sql))
        return {
          rows: [
            ...has("table ").map((name) => ({ name, kind: "r" })),
            ...has("index ").map((name) => ({ name, kind: "i" })),
          ],
        };
      if (/pg_attribute/.test(sql))
        return { rows: has("column ").map((k) => ({ t: k.split(".")[0], c: k.split(".")[1] })) };
      if (/pg_constraint/.test(sql)) return { rows: has("constraint ").map((name) => ({ name })) };
      if (/^SELECT id FROM mc_schema_migrations$/.test(sql))
        return { rows: has("record ").map((id) => ({ id })) };
      if (/FROM mc_schema_migrations WHERE id/.test(sql)) {
        const recorded = present.includes(`record ${params?.[0]}`);
        return { rowCount: recorded ? 1 : 0, rows: recorded ? [{}] : [] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("schema-targeted --apply", () => {
  const step = steps.parseSchemaSteps().find((s: Step) => s.id === "061_scheduling_calcom");
  const complete: string[] = steps.expectedStructures().get("061_scheduling_calcom");
  const base = ["table mc_schema_migrations", "record 061_scheduling_calcom"];
  const quiet = { log: () => undefined };

  it("refuses a recorded migration whose tables are missing instead of skipping it", async () => {
    const client = fakeClient(base);
    await assert.rejects(
      applyWith(client, [step.id], quiet),
      /Recorded migration 061_scheduling_calcom is incomplete \(missing: .*table tc_calcom_connections.*\); rerun with --reapply/,
    );
    assert.deepEqual(client.ran, []);
  });

  it("reruns it with --reapply", async () => {
    const client = fakeClient(base);
    await applyWith(client, [step.id], { ...quiet, reapply: true });
    assert.deepEqual(client.ran, ["step sql"]);
  });

  it("skips a recorded migration only when everything it creates is present", async () => {
    const client = fakeClient([...base, ...complete]);
    const lines: string[] = [];
    await applyWith(client, [step.id], { log: (line: string) => lines.push(line) });
    assert.deepEqual(client.ran, []);
    assert.deepEqual(lines, ["skip  061_scheduling_calcom (already recorded and complete)"]);
  });
});
