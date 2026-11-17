/**
 * KAN-16 on real SQL: the call-event store and the saved simulations, run on
 * an in-process PostgreSQL (PGlite) with the shipped schema.
 *
 * What the in-memory tests cannot prove, and this does: the upsert-by-id and
 * its cross-business guard, the lifecycle tie-break in ORDER BY
 * (`array_position` with an array parameter), the `kind` filter, and a whole
 * simulation saved and reloaded through the SQL stores. Skips when PGlite is
 * not installed (`npm i --no-save @electric-sql/pglite`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { profileSettingsSchema, type ReceptionistProfile } from "../../src/product/receptionist/profile";
import { createPostgresReceptionistStore } from "../../src/product/receptionist/postgres-store";
import { callEventId, createPostgresCallEventStore, type CallEventStore } from "../../src/product/telephony/call-events";
import { LIVE_TEST_SCENARIOS, LiveTestError, runSimulatedPhoneScenario } from "../../src/product/telephony/live-test";
import { listSimulations, loadSimulation, saveSimulation } from "../../src/product/telephony/live-test-store";
import { defaultPhoneSettings } from "../../src/product/telephony/phone-settings";
import type { CallEventKind } from "../../src/product/telephony/types";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";

const NOW = new Date("2026-03-04T15:00:00Z");
const client = demoClientAccount({ id: "client_sql_a", contractorDisplayName: "testTradeCatch" });
const SCOPE_A = { organizationId: "org_sql_a", clientAccountId: client.id };
const SCOPE_B = { organizationId: "org_sql_b", clientAccountId: "client_sql_b" };

function profile(strategy: "ai_first" | "human_first"): ReceptionistProfile {
  return {
    organizationId: SCOPE_A.organizationId,
    phoneNumberE164: "+14382314700",
    activated: true,
    settings: profileSettingsSchema.parse({
      receptionistName: "Sophie",
      notifyEmail: "owner@example.com",
      emergencyTransferE164: "+14385597003",
      fallbackTransferE164: "+14385597004",
      businessHours: { start: "00:00", end: "00:00", days: [0, 1, 2, 3, 4, 5, 6] },
      phoneSettings: {
        ...defaultPhoneSettings(),
        tradecatchNumberE164: "+14382314700",
        humanTransferE164: "+14385597004",
        inboundStrategy: strategy,
        aiEnabled: true,
      },
      knowledge: { companyName: "testTradeCatch", services: ["plumbing"], serviceAreas: ["Montréal"] },
    }),
    updatedAt: NOW.toISOString(),
  };
}

describe("call events and saved simulations on real SQL (PGlite)", { skip: !pgliteAvailable() && "PGlite not installed" }, () => {
  let db: PgliteDb;
  let events: CallEventStore;

  before(async () => {
    db = await createPglite();
    const read = (file: string) => readFileSync(path.join(process.cwd(), "src", "product", file), "utf8");
    const receptionist = read("receptionist/schema.sql");
    await db.exec(receptionist.slice(0, receptionist.indexOf("-- Per-organization receptionist profile")));
    await db.exec(read("telephony/schema.sql"));
  });
  after(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec("DELETE FROM rc_call_events");
    await db.exec("DELETE FROM rc_call_sessions");
    events = createPostgresCallEventStore("pglite://events", { pool: poolOf(db) });
  });

  const row = (kind: CallEventKind, over: Record<string, unknown> = {}) => ({
    organizationId: SCOPE_A.organizationId,
    clientAccountId: SCOPE_A.clientAccountId,
    callSid: "CAsql1",
    kind,
    ...over,
  });

  it("an event id is stored once, however often and however concurrently it is appended", async () => {
    const id = callEventId("CAsql1", "incoming");
    await Promise.all([1, 2, 3, 4, 5].map(() => events.append(row("incoming", { id, detail: "from=+1514" }))));
    const stored = await events.listForCall({ organizationId: SCOPE_A.organizationId, callSid: "CAsql1" });
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.id, id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM rc_call_events")).rows[0]!.n, 1);
  });

  it("appending an existing id keeps its first timestamp and updates only the detail", async () => {
    const id = callEventId("CAsql1", "status", "completed");
    const first = await events.append(row("status", { id, at: "2026-03-04T15:00:00.000Z", detail: "ringing" }));
    const again = await events.append(row("status", { id, at: "2026-03-04T15:09:00.000Z", detail: "completed" }));
    assert.equal(again.at, first.at, "the first timestamp stands");
    assert.equal(again.detail, "completed");
    assert.equal((await events.listForCall({ organizationId: SCOPE_A.organizationId, callSid: "CAsql1" })).length, 1);
  });

  it("an id that belongs to another business is refused and left exactly as it was", async () => {
    const id = callEventId("CAsql1", "incoming");
    await events.append(row("incoming", { id, detail: "mine" }));
    await assert.rejects(
      () => events.append({ ...row("incoming", { id, detail: "theirs" }), organizationId: SCOPE_B.organizationId, clientAccountId: SCOPE_B.clientAccountId }),
      /belongs to another business/,
    );
    const mine = await events.listForCall({ organizationId: SCOPE_A.organizationId, callSid: "CAsql1" });
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.detail, "mine");
    assert.deepEqual(await events.listForOrganization({ organizationId: SCOPE_B.organizationId }), []);
  });

  it("events written in the same instant read in the order the call happened (ORDER BY with an array parameter)", async () => {
    const at = "2026-03-04T15:00:00.000Z";
    const shuffled: CallEventKind[] = ["finalized", "ai_started", "status", "human_ring", "routing_decision", "missed", "incoming"];
    for (const kind of shuffled) await events.append(row(kind, { at, id: callEventId("CAsql1", kind) }));
    const lifecycle = ["incoming", "routing_decision", "human_ring", "missed", "ai_started", "status", "finalized"];
    const forCall = (await events.listForCall({ organizationId: SCOPE_A.organizationId, callSid: "CAsql1" })).map((e) => e.kind);
    assert.deepEqual(forCall, lifecycle);
    const newest = (await events.listForOrganization({ organizationId: SCOPE_A.organizationId })).map((e) => e.kind);
    assert.deepEqual(newest, [...lifecycle].reverse(), "the newest-first list is the exact mirror");
  });

  it("time still wins over lifecycle order, and a kind the order does not know sorts last (first when newest-first)", async () => {
    await events.append(row("finalized", { at: "2026-03-04T15:00:00.000Z", id: "e1" }));
    await events.append(row("incoming", { at: "2026-03-04T15:00:01.000Z", id: "e2" }));
    await events.append(row("not_a_known_kind" as CallEventKind, { at: "2026-03-04T15:00:01.000Z", id: "e3" }));
    const asc = (await events.listForCall({ organizationId: SCOPE_A.organizationId, callSid: "CAsql1" })).map((e) => e.id);
    assert.deepEqual(asc, ["e1", "e2", "e3"]);
    const desc = (await events.listForOrganization({ organizationId: SCOPE_A.organizationId })).map((e) => e.id);
    assert.deepEqual(desc, ["e3", "e2", "e1"]);
  });

  it("the kind filter and the limit apply in SQL, and another business's events never appear", async () => {
    for (let i = 0; i < 4; i++) {
      await events.append(row("test_simulated", { callSid: `sim_live_${i}`, at: `2026-03-04T15:0${i}:00.000Z`, id: `m${i}` }));
    }
    await events.append(row("incoming", { callSid: "CAreal", id: "r1" }));
    await events.append({ ...row("test_simulated", { callSid: "sim_live_other", id: "mb" }), organizationId: SCOPE_B.organizationId, clientAccountId: SCOPE_B.clientAccountId });
    const markers = await events.listForOrganization({ organizationId: SCOPE_A.organizationId, kind: "test_simulated", limit: 3 });
    assert.deepEqual(markers.map((e) => e.id), ["m3", "m2", "m1"]);
    assert.ok(markers.every((e) => e.organizationId === SCOPE_A.organizationId));
  });

  it("payloads round-trip as objects", async () => {
    const payload = { simulated: true, header: { routing: { action: "ai" }, notes: ["a", "b"] }, n: 3 };
    await events.append(row("test_simulated", { id: "p1", payload }));
    const [stored] = await events.listForCall({ organizationId: SCOPE_A.organizationId, callSid: "CAsql1" });
    assert.deepEqual(stored!.payload, payload);
  });

  for (const strategy of ["ai_first", "human_first"] as const) {
    it(`a whole ${strategy} simulation is saved and reloaded through the SQL stores, scenario by scenario`, async () => {
      const stores = {
        events,
        sessions: createPostgresReceptionistStore("pglite://sessions", { pool: poolOf(db) }),
      };
      let saved = 0;
      for (const scenario of LIVE_TEST_SCENARIOS) {
        let output;
        try {
          output = await runSimulatedPhoneScenario({
            organizationId: SCOPE_A.organizationId,
            profile: profile(strategy),
            client,
            scenario,
            now: NOW,
            runId: `${strategy}-${scenario}`,
          });
        } catch (error) {
          if (error instanceof LiveTestError) continue;
          throw error;
        }
        const first = await saveSimulation(output, SCOPE_A, stores);
        const second = await saveSimulation(output, SCOPE_A, stores);
        assert.equal(first.created, true, scenario);
        assert.equal(second.created, false, `${scenario}: saving again adds nothing`);
        saved++;

        const loaded = await loadSimulation(SCOPE_A, stores, output.run.callSid);
        assert.ok(loaded && loaded.complete, scenario);
        if (!loaded.complete) continue;
        const { run } = output;
        const back = loaded.run;
        assert.deepEqual(
          back.events.map((e) => [e.seq, e.kind, e.detail, e.offsetSeconds]),
          run.events.map((e) => [e.seq, e.kind, e.detail, e.offsetSeconds]),
          `${scenario}: timeline`,
        );
        for (const field of ["scenario", "durationSeconds", "finalStatus", "termination", "routing", "receptionist", "notes"] as const) {
          assert.deepEqual(back[field], run[field], `${scenario}: ${field}`);
        }
        assert.equal(back.outcome, run.outcome);
        assert.equal(back.transcript.length, run.transcript.length, `${scenario}: transcript`);
        assert.ok(back.events.every((e) => e.simulated === true));

        // Another business sees none of it, by id or in its list.
        assert.equal(await loadSimulation(SCOPE_B, stores, run.callSid), null);
      }
      assert.ok(saved >= 5, `${saved} scenarios saved`);

      const listed = await listSimulations(SCOPE_A, stores, 20);
      assert.equal(listed.length, saved, "every saved run is listed once");
      assert.deepEqual(await listSimulations(SCOPE_B, stores, 20), []);
      const stored = Number((await db.query("SELECT count(*)::int AS n FROM rc_call_events")).rows[0]!.n);
      assert.equal(stored, listed.reduce((n, r) => n + r.events.length, 0), "no duplicate rows after saving twice");
    });
  }

  it("a save that fails half-way leaves a run that is not listed, and saving it again completes it", async () => {
    const stores = { events, sessions: createPostgresReceptionistStore("pglite://sessions", { pool: poolOf(db) }) };
    const output = await runSimulatedPhoneScenario({
      organizationId: SCOPE_A.organizationId,
      profile: profile("ai_first"),
      client,
      scenario: "receptionist_response",
      now: NOW,
      runId: "half-way",
    });
    const real = events.append.bind(events);
    let writes = 0;
    events.append = async (event) => {
      if (++writes === 5) throw new Error("connection reset");
      return real(event);
    };
    await assert.rejects(() => saveSimulation(output, SCOPE_A, stores), /could not save/);
    events.append = real;
    assert.deepEqual(await listSimulations(SCOPE_A, stores), [], "a half-saved run is not shown as a result");
    const partial = await loadSimulation(SCOPE_A, stores, output.run.callSid);
    assert.equal(partial?.complete, false);

    await saveSimulation(output, SCOPE_A, stores);
    const done = await loadSimulation(SCOPE_A, stores, output.run.callSid);
    assert.equal(done?.complete, true);
    assert.equal((await listSimulations(SCOPE_A, stores)).length, 1);
    assert.equal(
      Number((await db.query("SELECT count(*)::int AS n FROM rc_call_events WHERE call_sid = $1", [output.run.callSid])).rows[0]!.n),
      output.run.events.length,
    );
  });
});
