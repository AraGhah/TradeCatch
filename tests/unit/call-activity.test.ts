/**
 * KAN-15 · call activity: every real call is recorded once, kept, and shown
 * correctly (CALL-03 … CALL-14; CALL-01/02 are in phone-format.test.ts).
 *
 * The same scenarios run against the in-memory store and against the REAL SQL
 * store on PGlite (an in-process PostgreSQL), so duplicate protection,
 * ordering and concurrency are proven in the database, not only in a double.
 * PGlite is optional tooling: those runs skip when it is not installed
 * (npm i --no-save @electric-sql/pglite).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { createAgentCallService, CallTenantMismatchError } from "../../src/product/receptionist/agent-calls";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { ownerVisibleCalls } from "../../src/product/receptionist/call-history";
import { formatCallDuration, formatCallTime } from "../../src/product/receptionist/call-format";
import { callState, toCallRow } from "../../src/product/receptionist/call-history-view";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createPostgresReceptionistStore } from "../../src/product/receptionist/postgres-store";
import { recordCallStatus } from "../../src/product/receptionist/status-recorder";
import { createMemoryReceptionistStore, type ReceptionistStore } from "../../src/product/receptionist/store";
import type { CallSession, ReceptionistConfig } from "../../src/product/receptionist/types";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { formatPhone } from "../../src/lib/phone";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";

const LINE_A = "+14385597001";
const LINE_B = "+14385597002";
const CALLER = "+15145559876";
const T0 = new Date("2026-11-17T14:00:00.000Z");

function makeConfig(id: string, line: string, over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id,
    clientAccountId: `client_${id}`,
    phoneNumberE164: line,
    businessName: `Business ${id}`,
    languages: ["en"],
    defaultLanguage: "en",
    timezone: "America/Toronto",
    notifications: [{ type: "email", to: `owner-${id}@example.test` }],
    ...over,
  });
}
const A = makeConfig("a", LINE_A);
const B = makeConfig("b", LINE_B);

type Harness = ReturnType<typeof setup>;

function setup(
  opts: {
    store?: ReceptionistStore;
    configs?: ReceptionistConfig[];
    confirmActive?: (config: ReceptionistConfig) => Promise<boolean>;
  } = {},
) {
  const store = opts.store ?? createMemoryReceptionistStore();
  const clock = { now: () => state.now };
  const state = { now: new Date(T0) };
  const emails: string[] = [];
  const engine = createReceptionistEngine({
    store,
    configs: () => opts.configs ?? [A, B],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms: createMemorySmsPort(),
      sendEmail: async (message) => {
        emails.push(JSON.stringify(message).slice(0, 40));
        return { sent: true };
      },
    }),
    clock,
    confirmActive: opts.confirmActive,
  });
  const agent = (channel: "bland" | "livekit" = "bland") =>
    createAgentCallService({ store, finalize: engine.finalizeSession, clock, channel });
  return { store, engine, agent, emails, state };
}

const incoming = (h: Harness, callSid: string, from = CALLER, to = LINE_A) =>
  h.engine.startCall({ callSid, fromE164: from, toE164: to });
const status = (
  h: Harness,
  callSid: string,
  callStatus: string,
  extra: Partial<Parameters<Harness["engine"]["handleCallStatus"]>[0]> = {},
) => h.engine.handleCallStatus({ callSid, callStatus, ...extra });

/** The scenarios, run once per store implementation. */
function scenarios(label: string, makeStore: () => Promise<ReceptionistStore>) {
  describe(`${label}`, () => {
    let h: Harness;
    beforeEach(async () => {
      h = setup({ store: await makeStore() });
    });

    it("CALL-03 · a new incoming call is saved to the business that was dialed", async () => {
      await incoming(h, "CAa0000000000000000000000000000001", "(514) 555-9876");
      const mine = await h.store.listSessions({ clientAccountId: A.clientAccountId });
      const other = await h.store.listSessions({ clientAccountId: B.clientAccountId });
      assert.equal(mine.length, 1);
      assert.equal(other.length, 0);
      const call = mine[0]!;
      assert.equal(call.callSid, "CAa0000000000000000000000000000001");
      assert.equal(call.fromE164, CALLER, "stored as E.164");
      assert.equal(call.toE164, LINE_A);
      assert.equal(call.startedAt, T0.toISOString(), "stored in UTC");
      assert.deepEqual(call.activity, { provider: "twilio", direction: "inbound", origin: "incoming" });
      assert.equal(formatPhone(call.fromE164), "(514) 555-9876");
    });

    it("CALL-04 · a completed 5-minute call has the right duration and status", async () => {
      await incoming(h, "CAa0000000000000000000000000000004");
      const done = await status(h, "CAa0000000000000000000000000000004", "completed", { durationSeconds: 300 });
      assert.equal(done.finalized, true);
      const call = done.session!;
      assert.equal(call.durationSeconds, 300);
      assert.equal(call.status, "completed");
      assert.equal(call.activity?.providerStatus, "completed");
      assert.equal(callState(call), "completed");
      assert.equal(formatCallDuration(call.durationSeconds), "5m 00s");

      // The voice-agent path: a 5-minute Bland call that took a message.
      const agent = h.agent("bland");
      const base = { callId: "bl4", fromE164: CALLER, language: "en" as const };
      await agent.recordSlots(A, { ...base, slots: { callerName: "Marie", issue: "Leak under the sink" } });
      const report = await agent.report(A, {
        ...base,
        transcript: [{ speaker: "caller", text: "I have a leak" }],
        durationSeconds: 300,
        endReason: "completed",
      });
      assert.equal(report?.durationSeconds, 300);
      assert.equal(report?.outcome, "message_taken");
      assert.equal(callState(report!), "completed");
    });

    it("CALL-05 · a missed or unanswered call has the right status", async () => {
      const cases: [string, string, number | undefined, string][] = [
        ["CAa0000000000000000000000000000051", "no-answer", undefined, "unanswered"],
        ["CAa0000000000000000000000000000052", "busy", undefined, "unanswered"],
        ["CAa0000000000000000000000000000053", "canceled", undefined, "missed"],
        ["CAa0000000000000000000000000000054", "completed", 4, "missed"],
        ["CAa0000000000000000000000000000055", "failed", undefined, "failed"],
      ];
      for (const [sid, providerStatus, duration, expected] of cases) {
        await incoming(h, sid, `+1514555${sid.slice(-4)}`);
        const { session } = await status(h, sid, providerStatus, { durationSeconds: duration });
        assert.equal(callState(session!), expected, `${providerStatus} ${duration ?? ""}`);
        assert.equal(session!.activity?.providerStatus, providerStatus);
      }
    });

    it("CALL-05 · a call the receptionist declined (switched off) is still recorded", async () => {
      const off = setup({ store: await makeStore(), confirmActive: async () => false });
      const plan = await incoming(off, "CAa0000000000000000000000000000056");
      assert.ok(plan.verbs.length > 0, "the caller still gets an answer");
      const calls = await off.store.listSessions({ clientAccountId: A.clientAccountId });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.activity?.origin, "declined");
      assert.equal(calls[0]!.activity?.declinedCode, "RECEPTIONIST_DEACTIVATED");
      assert.equal(callState(calls[0]!), "unanswered");
      assert.ok(calls[0]!.finalizedAt);
      // The owner is told about a call nobody handled (tests/unit/call-activity-owner-alerts.test.ts
      // covers the wording and the caller never being texted) ...
      assert.equal(off.emails.length, 1, "the owner is told");
      // ... and Twilio retrying the same declined call changes and alerts nothing.
      await incoming(off, "CAa0000000000000000000000000000056");
      assert.equal((await off.store.listSessions({ clientAccountId: A.clientAccountId })).length, 1);
      assert.equal(off.emails.length, 1, "the owner is told once");
    });

    it("CALL-08 · a duplicate webhook creates no duplicate", async () => {
      const sid = "CAa0000000000000000000000000000081";
      await incoming(h, sid);
      await incoming(h, sid); // Twilio retried the voice webhook
      assert.equal((await h.store.listSessions({ clientAccountId: A.clientAccountId })).length, 1);

      await status(h, sid, "completed", { durationSeconds: 90 });
      const once = await h.store.getSessionByCallSid(sid);
      const emailsAfterFirst = h.emails.length;
      await status(h, sid, "completed", { durationSeconds: 90 });
      await Promise.all([1, 2, 3].map(() => status(h, sid, "completed", { durationSeconds: 90 })));
      const again = await h.store.getSessionByCallSid(sid);
      assert.equal(h.emails.length, emailsAfterFirst, "the owner is told once");
      assert.equal(again!.version, once!.version, "a repeat writes nothing");
      assert.deepEqual(again, once);

      // The voice agent's webhook, retried.
      const agent = h.agent("bland");
      const input = { callId: "bl8", fromE164: CALLER, language: "en" as const, durationSeconds: 60, endReason: "completed" as const };
      await agent.recordSlots(A, { ...input, slots: { issue: "No heat" } });
      await agent.report(A, input);
      const emails = h.emails.length;
      await agent.report(A, input);
      await agent.report(A, input);
      assert.equal(h.emails.length, emails);
      assert.equal(
        (await h.store.listSessions({ clientAccountId: A.clientAccountId })).filter((c) => c.callSid === "bl_bl8").length,
        1,
      );
    });

    it("CALL-09 · a status that arrives before the call was saved still ends in one correct record", async () => {
      const sid = "CAa0000000000000000000000000000091";
      const early = await status(h, sid, "completed", {
        durationSeconds: 300,
        fromE164: "514-555-9876",
        toE164: LINE_A,
        createIfMissing: true,
      });
      assert.equal(early.finalized, true);
      const created = early.session!;
      assert.equal(created.fromE164, CALLER);
      assert.equal(created.toE164, LINE_A);
      assert.equal(created.durationSeconds, 300);
      assert.equal(created.activity?.origin, "status_callback");
      assert.equal(created.activity?.startDerived, true);
      assert.equal(
        created.startedAt,
        new Date(T0.getTime() - 300_000).toISOString(),
        "the start is the end minus the reported duration",
      );
      assert.equal(h.emails.length, 0, "no summary or text is invented for a call that was never handled");

      await incoming(h, sid); // the call's own webhook finally arrives
      const calls = await h.store.listSessions({ clientAccountId: A.clientAccountId });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.durationSeconds, 300);
      assert.equal(calls[0]!.status, "completed");
    });

    it("CALL-09 · a status that arrives after the call was finalized only fills what was blank", async () => {
      const sid = "CAa0000000000000000000000000000092";
      await incoming(h, sid);
      h.state.now = new Date(T0.getTime() + 40 * 60_000);
      await h.engine.tick(); // the stale-call sweep got there first
      const swept = (await h.store.getSessionByCallSid(sid))!;
      assert.ok(swept.finalizedAt);
      assert.equal(swept.durationSeconds, undefined);
      const emails = h.emails.length;

      await status(h, sid, "completed", { durationSeconds: 120 });
      const filled = (await h.store.getSessionByCallSid(sid))!;
      assert.equal(filled.durationSeconds, 120);
      assert.equal(filled.activity?.providerStatus, "completed");
      assert.equal(filled.finalizedAt, swept.finalizedAt, "finalized once");
      assert.equal(filled.outcome, swept.outcome);
      assert.equal(h.emails.length, emails, "no second summary");

      await status(h, sid, "completed", { durationSeconds: 999 }); // a later, different value
      assert.equal((await h.store.getSessionByCallSid(sid))!.durationSeconds, 120, "the first real value is kept");
    });

    it("CALL-11 · a call is never recorded for, or shown to, another business", async () => {
      // A status for a number that is nobody's is not attributed to anyone.
      const stray = await status(h, "CAa0000000000000000000000000000111", "completed", {
        durationSeconds: 30,
        fromE164: CALLER,
        toE164: "+19995550000",
        createIfMissing: true,
      });
      assert.equal(stray.session, null);
      // A leg the platform dialed out is not a call to a business.
      const leg = await status(h, "CAa0000000000000000000000000000112", "completed", {
        durationSeconds: 30,
        fromE164: LINE_A,
        toE164: CALLER,
        createIfMissing: false,
      });
      assert.equal(leg.session, null);
      assert.equal((await h.store.listSessions({})).length, 0);

      await incoming(h, "CAa0000000000000000000000000000113", CALLER, LINE_A);
      await incoming(h, "CAa0000000000000000000000000000114", CALLER, LINE_B);
      const a = await h.store.listSessions({ clientAccountId: A.clientAccountId });
      const b = await h.store.listSessions({ clientAccountId: B.clientAccountId });
      assert.deepEqual(a.map((c) => c.toE164), [LINE_A]);
      assert.deepEqual(b.map((c) => c.toE164), [LINE_B]);

      // One call id cannot be claimed by a second business.
      const agent = h.agent("bland");
      await agent.recordSlots(A, { callId: "bl11", fromE164: CALLER, language: "en", slots: { issue: "x" } });
      await assert.rejects(
        () => agent.recordSlots(B, { callId: "bl11", fromE164: CALLER, language: "en", slots: { issue: "y" } }),
        CallTenantMismatchError,
      );
    });

    it("CALL-12 · a delayed provider webhook updates the existing call, once", async () => {
      const agent = h.agent("bland");
      const base = { callId: "bl12", fromE164: CALLER, language: "en" as const };
      await agent.recordSlots(A, { ...base, slots: { issue: "Burst pipe" } });
      h.state.now = new Date(T0.getTime() + 40 * 60_000);
      await h.engine.tick(); // the call was swept before Bland's webhook arrived
      const swept = (await h.store.getSessionByCallSid("bl_bl12"))!;
      assert.ok(swept.finalizedAt);
      assert.equal(swept.turns.length, 0);
      const emails = h.emails.length;

      const late = await agent.report(A, {
        ...base,
        transcript: [
          { speaker: "caller", text: "A pipe burst" },
          { speaker: "agent", text: "Help is on the way" },
        ],
        durationSeconds: 240,
        endReason: "completed",
      });
      assert.equal(late!.id, swept.id, "the same record");
      assert.equal(late!.durationSeconds, 240);
      assert.equal(late!.turns.length, 2);
      assert.equal(late!.callerTurnCount, 1);
      assert.equal(late!.finalizedAt, swept.finalizedAt);
      assert.equal(h.emails.length, emails, "nothing is sent twice");
      assert.equal((await h.store.listSessions({ clientAccountId: A.clientAccountId })).length, 1);
    });

    it("CALL-12 · a delayed report never brings back a purged transcript", async () => {
      const agent = h.agent("bland");
      const base = { callId: "bl12p", fromE164: CALLER, language: "en" as const };
      await agent.recordSlots(A, { ...base, slots: { issue: "x" } });
      const first = (await h.store.getSessionByCallSid("bl_bl12p"))!;
      await h.store.saveSession({ ...first, finalizedAt: T0.toISOString(), transcriptPurgedAt: T0.toISOString() });
      const late = await agent.report(A, { ...base, transcript: [{ speaker: "caller", text: "private" }], durationSeconds: 10 });
      assert.equal(late!.turns.length, 0);
      assert.equal(late!.durationSeconds, 10);
    });

    it("a call the report itself had to create is dated from its start, not its hang-up", async () => {
      const agent = h.agent("bland");
      await agent.report(A, { callId: "bl-first", fromE164: CALLER, language: "en", durationSeconds: 300, endReason: "completed" });
      const call = (await h.store.getSessionByCallSid("bl_bl-first"))!;
      assert.equal(call.startedAt, new Date(T0.getTime() - 300_000).toISOString());
      assert.equal(call.activity?.startDerived, true);
      assert.equal(call.activity?.provider, "bland");

      await agent.recordSlots(A, { callId: "bl-tool", fromE164: CALLER, language: "en", slots: { issue: "x" } });
      await agent.report(A, { callId: "bl-tool", fromE164: CALLER, language: "en", durationSeconds: 300 });
      const withTool = (await h.store.getSessionByCallSid("bl_bl-tool"))!;
      assert.equal(withTool.startedAt, T0.toISOString(), "a tool call already dated it");
      assert.equal(withTool.activity?.startDerived, undefined);
    });

    it("keeps the caller's number however the voice agent wrote it", async () => {
      const agent = h.agent("livekit");
      const sent: [string, string][] = [
        ["514-555-9876", CALLER],
        ["+1 (514) 555-9876", CALLER],
        ["+33 6 12 34 56 78", "+33612345678"],
        ["anonymous", "anonymous"],
        ["not a number", "anonymous"],
      ];
      for (const [i, [from, stored]] of sent.entries()) {
        await agent.recordSlots(A, { callId: `lk-from-${i}`, fromE164: from, language: "en", slots: { issue: "x" } });
        assert.equal((await h.store.getSessionByCallSid(`lk_lk-from-${i}`))!.fromE164, stored, from);
      }
    });

    it("CALL-14 · simultaneous calls are saved independently", async () => {
      const n = 25;
      const ids = Array.from({ length: n }, (_, i) => i);
      await Promise.all(
        ids.map((i) =>
          incoming(h, `CAc${String(i).padStart(31, "0")}`, `+1514555${String(1000 + i)}`, i % 2 ? LINE_A : LINE_B),
        ),
      );
      // …and the same call reported many times at once.
      await Promise.all([0, 1, 2, 3, 4].map(() => incoming(h, `CAc${String(0).padStart(31, "0")}`, "+15145551000", LINE_B)));
      await Promise.all(
        ids.map((i) => status(h, `CAc${String(i).padStart(31, "0")}`, "completed", { durationSeconds: 100 + i })),
      );

      const all = await h.store.listSessions({ limit: 200 });
      assert.equal(all.length, n);
      assert.equal(new Set(all.map((c) => c.id)).size, n);
      assert.equal(new Set(all.map((c) => c.callSid)).size, n);
      for (const call of all) {
        const i = Number(call.callSid.slice(3));
        assert.equal(call.fromE164, `+1514555${1000 + i}`, "each call keeps its own caller");
        assert.equal(call.toE164, i % 2 ? LINE_A : LINE_B);
        assert.equal(call.clientAccountId, i % 2 ? A.clientAccountId : B.clientAccountId);
        assert.equal(call.durationSeconds, 100 + i, "…and its own duration");
        assert.ok(call.finalizedAt);
      }
    });

    it("CALL-13 · historical records are read without loss or change", async () => {
      const legacy: CallSession[] = [
        legacySession("old1", { fromE164: "+15145551234", durationSeconds: 61 }),
        legacySession("old2", { fromE164: "5145551234" }),
        legacySession("old3", { fromE164: "anonymous", outcome: "message_taken", slots: { issue: "Leak" } }),
        legacySession("old4", { fromE164: "+33612345678", outcome: "failed", status: "failed" }),
        legacySession("old5", { fromE164: "+266696687" }),
      ];
      for (const s of legacy) await h.store.insertSessionIfAbsent(s);
      const before = JSON.stringify(
        (await h.store.listSessions({ clientAccountId: A.clientAccountId })).map(unversioned),
      );

      const visible = ownerVisibleCalls(await h.store.listSessions({ clientAccountId: A.clientAccountId, limit: 50 }));
      assert.equal(visible.length, legacy.length, "no record dropped");
      for (const c of visible) {
        const row = toCallRow(c);
        assert.ok(row.state, c.callSid);
        assert.equal(row.fromE164, legacy.find((l) => l.id === c.id)!.fromE164, "the stored number is untouched");
      }
      const shown = new Map(visible.map((c) => [c.callSid, formatPhone(c.fromE164)]));
      assert.equal(shown.get("old1"), "(514) 555-1234");
      assert.equal(shown.get("old2"), "(514) 555-1234");
      assert.equal(shown.get("old3"), "anonymous");
      assert.equal(shown.get("old4"), "+33 6 12 34 56 78");
      assert.equal(callState(visible.find((c) => c.callSid === "old3")!), "completed");
      assert.equal(callState(visible.find((c) => c.callSid === "old4")!), "failed");

      // A late status on an old record adds the duration and touches nothing else.
      await status(h, "old2", "completed", { durationSeconds: 45 });
      const after = (await h.store.getSessionByCallSid("old2"))!;
      assert.equal(after.durationSeconds, 45);
      const untouched = (await h.store.getSessionByCallSid("old3"))!;
      assert.deepEqual(untouched.slots, { issue: "Leak" });

      // Reading changed nothing.
      const again = JSON.stringify(
        (await h.store.listSessions({ clientAccountId: A.clientAccountId })).filter((c) => c.callSid !== "old2").map(unversioned),
      );
      assert.equal(
        again,
        JSON.stringify(JSON.parse(before).filter((c: CallSession) => c.callSid !== "old2")),
      );
    });
  });
}

/** A stored call without its write counter, to compare what was saved. */
function unversioned(call: CallSession): Omit<CallSession, "version"> {
  const copy: Partial<CallSession> = { ...call };
  delete copy.version;
  return copy as Omit<CallSession, "version">;
}

function legacySession(sid: string, over: Partial<CallSession> = {}): CallSession {
  const startedAt = new Date(T0.getTime() - 86_400_000).toISOString();
  return {
    id: `rcs_${sid}`,
    callSid: sid,
    configId: A.id,
    clientAccountId: A.clientAccountId,
    fromE164: CALLER,
    toE164: LINE_A,
    language: "en",
    status: "completed",
    step: "done",
    outcome: "caller_hung_up",
    afterHours: false,
    slots: {},
    turns: [],
    silenceCount: 0,
    callerTurnCount: 0,
    transfers: [],
    notifications: [],
    finalizedAt: startedAt,
    endedAt: startedAt,
    startedAt,
    updatedAt: startedAt,
    version: 1,
    ...over,
  };
}

scenarios("memory store", async () => createMemoryReceptionistStore());

describe("real SQL store (PGlite)", { skip: !pgliteAvailable() && "PGlite not installed" }, () => {
  let db: PgliteDb;
  before(async () => {
    db = await createPglite();
    const schema = readFileSync(path.join(process.cwd(), "src", "product", "receptionist", "schema.sql"), "utf8");
    await db.exec(schema.slice(0, schema.indexOf("-- Per-organization receptionist profile")));
  });
  after(async () => {
    await db.close();
  });

  scenarios("sql", async () => {
    await db.exec("DELETE FROM rc_call_sessions");
    return createPostgresReceptionistStore("pglite://calls", { pool: poolOf(db) });
  });

  it("CALL-06 / CALL-07 · history survives a refresh, a new instance, and logout then login", async () => {
    await db.exec("DELETE FROM rc_call_sessions");
    const pool = poolOf(db);
    const first = setup({ store: createPostgresReceptionistStore("pglite://a", { pool }) });
    for (let i = 0; i < 3; i += 1) {
      first.state.now = new Date(T0.getTime() + i * 60_000);
      const sid = `CAr${String(i).padStart(31, "0")}`;
      await incoming(first, sid, `+1514555${1000 + i}`);
      await status(first, sid, "completed", { durationSeconds: 60 * (i + 1) });
    }
    const snapshot = async (store: ReceptionistStore) =>
      JSON.stringify(
        ownerVisibleCalls(await store.listSessions({ clientAccountId: A.clientAccountId, limit: 50 })).map(
          (c) => [c.callSid, c.fromE164, c.durationSeconds, c.startedAt, c.status],
        ),
      );
    const before = await snapshot(createPostgresReceptionistStore("pglite://a", { pool }));

    // Refresh: another request on another instance reads the same rows.
    const refreshed = await snapshot(createPostgresReceptionistStore("pglite://b", { pool }));
    // Logout then login only changes the session cookie, never the stored calls.
    const afterLogin = await snapshot(createPostgresReceptionistStore("pglite://c", { pool }));
    assert.equal(refreshed, before);
    assert.equal(afterLogin, before);

    const rows = JSON.parse(before) as [string, string, number, string, string][];
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r[3]),
      [...rows.map((r) => r[3])].sort().reverse(),
      "newest first",
    );
    assert.deepEqual(rows.map((r) => r[2]), [180, 120, 60]);
  });

  it("CALL-10 · a failed save is retried, logged without the caller's number, and never duplicates", async () => {
    await db.exec("DELETE FROM rc_call_sessions");
    const pool = poolOf(db);
    const h = setup({ store: createPostgresReceptionistStore("pglite://f", { pool }) });
    const sid = "CAf0000000000000000000000000000001";
    await incoming(h, sid);

    const logged: string[] = [];
    mock.method(console, "error", (line: unknown) => logged.push(String(line)));
    (pool as unknown as { failNext: (m: RegExp) => void }).failNext(/UPDATE rc_call_sessions/);
    await recordCallStatus(h.engine, { callSid: sid, callStatus: "completed", durationSeconds: 77 });
    mock.restoreAll();

    const call = (await h.store.getSessionByCallSid(sid))!;
    assert.equal(call.durationSeconds, 77, "the retry saved it");
    assert.ok(call.finalizedAt);
    assert.equal((await h.store.listSessions({ clientAccountId: A.clientAccountId })).length, 1);
    assert.equal(h.emails.length, 1, "told once");
    assert.equal(logged.some((l) => l.includes(CALLER)), false);
  });
});

describe("CALL-10 · a status that cannot be saved is detectable and recoverable", () => {
  afterEach(() => mock.restoreAll());

  it("retries a bounded number of times, then logs without the caller's number and stops", async () => {
    let attempts = 0;
    const engine = {
      handleCallStatus: async () => {
        attempts += 1;
        throw new Error("connection to 'postgres://user:pw@db.internal/app' for +15145559876 failed");
      },
    };
    const logged: string[] = [];
    mock.method(console, "error", (line: unknown) => logged.push(String(line)));
    await recordCallStatus(engine as never, {
      callSid: "CAx0000000000000000000000000000001",
      callStatus: "completed",
      fromE164: CALLER,
      toE164: LINE_A,
    });
    assert.equal(attempts, 3, "one try and two retries");
    const line = logged.find((l) => l.includes("status_finalize_failed"));
    assert.ok(line, "the failure is logged");
    assert.equal(line!.includes(CALLER), false, "no caller number");
    assert.equal(line!.includes("postgres://"), false, "no connection string");
    assert.equal(line!.includes("db.internal"), false);
  });

  it("stops retrying as soon as a save works", async () => {
    let attempts = 0;
    const engine = {
      handleCallStatus: async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("transient");
        return { finalized: true, session: null };
      },
    };
    mock.method(console, "error", () => {});
    await recordCallStatus(engine as never, { callSid: "CAx0000000000000000000000000000002", callStatus: "completed" });
    assert.equal(attempts, 2);
  });

  it("a failed save of the end-of-call report is an error the provider retries, then one record", async () => {
    const real = createMemoryReceptionistStore();
    let failures = 1;
    const store: ReceptionistStore = {
      ...real,
      insertSessionIfAbsent: async (s) => {
        if (failures-- > 0) throw new Error("database unavailable");
        return real.insertSessionIfAbsent(s);
      },
    };
    const h = setup({ store });
    const input = { callId: "bl10", fromE164: CALLER, language: "en" as const, durationSeconds: 50 };
    await assert.rejects(() => h.agent("bland").report(A, input), /database unavailable/);
    assert.equal((await real.listSessions({})).length, 0);
    await h.agent("bland").report(A, input); // the provider's retry
    await h.agent("bland").report(A, input); // …and its duplicate
    assert.equal((await real.listSessions({})).length, 1);
  });
});

describe("what the owner sees (call list)", () => {
  const routing = (id: string, over: Partial<CallSession> = {}): CallSession =>
    legacySession(id, {
      status: "in_progress",
      finalizedAt: undefined,
      routing: { handoff: { target: "livekit", status: "connected", at: T0.toISOString() } },
      startedAt: T0.toISOString(),
      ...over,
    });
  const agentRecord = (id: string, offsetMs: number, over: Partial<CallSession> = {}): CallSession =>
    legacySession(id, { callSid: `lk_${id}`, startedAt: new Date(T0.getTime() + offsetMs).toISOString(), ...over });

  it("lists the newest call first", () => {
    const calls = [
      legacySession("c1", { startedAt: "2026-11-15T10:00:00.000Z" }),
      legacySession("c3", { startedAt: "2026-11-17T10:00:00.000Z" }),
      legacySession("c2", { startedAt: "2026-11-16T10:00:00.000Z" }),
    ];
    assert.deepEqual(ownerVisibleCalls(calls).map((c) => c.callSid), ["c3", "c2", "c1"]);
  });

  it("hides the routing record once the voice agent has reported the conversation", () => {
    const visible = ownerVisibleCalls([routing("r1"), agentRecord("a1", 4_000)]);
    assert.deepEqual(visible.map((c) => c.callSid), ["lk_a1"]);
  });

  it("keeps a handed-off call visible when the agent's report never arrives", () => {
    // While the call is going it is simply in progress.
    const live = ownerVisibleCalls([routing("r1")]);
    assert.equal(live.length, 1, "a real call is never silently missing");
    assert.equal(callState(live[0]!), "in_progress");

    // Once it has ended with no report, it says so instead of vanishing.
    const ended = ownerVisibleCalls([
      routing("r2", { status: "completed", finalizedAt: T0.toISOString(), outcome: "caller_hung_up" }),
    ]);
    assert.equal(ended.length, 1);
    assert.equal(callState(ended[0]!), "unreported");
  });

  it("pairs each call with its own report, closest first, so two calls never hide each other", () => {
    const r1 = routing("r1", { startedAt: T0.toISOString() });
    const r2 = routing("r2", { startedAt: new Date(T0.getTime() + 120_000).toISOString() });
    // Only the second call was reported.
    const visible = ownerVisibleCalls([r1, r2, agentRecord("a2", 124_000)]);
    assert.deepEqual(visible.map((c) => c.id).sort(), [r1.id, "rcs_a2"].sort());
  });

  it("never pairs a report with another business's call", () => {
    const other = agentRecord("a1", 4_000, { clientAccountId: B.clientAccountId });
    const visible = ownerVisibleCalls([routing("r1"), other]);
    assert.equal(visible.length, 2, "the other business's report does not hide this call");
  });

  it("does not pair a report from a different caller", () => {
    const visible = ownerVisibleCalls([routing("r1"), agentRecord("a1", 4_000, { fromE164: "+14165550100" })]);
    assert.equal(visible.length, 2);
  });

  it("never lists a practice call", () => {
    assert.equal(ownerVisibleCalls([legacySession("sim_1", { callSid: "sim_1" }), legacySession("demo_1", { callSid: "demo_1" })]).length, 0);
  });
});

describe("dates and durations", () => {
  it("shows the stored UTC time in the business's own zone", () => {
    const iso = "2026-11-17T14:05:00.000Z";
    assert.match(formatCallTime(iso, "America/Toronto", "en"), /9:05/);
    assert.match(formatCallTime(iso, "America/Vancouver", "en"), /6:05/);
    assert.match(formatCallTime(iso, "Europe/Paris", "fr"), /15 h 05|15:05/);
    // A summer instant uses daylight time.
    assert.match(formatCallTime("2026-07-17T14:05:00.000Z", "America/Toronto", "en"), /10:05/);
  });

  it("falls back to the product's default zone for an unknown zone, never UTC", () => {
    assert.match(formatCallTime("2026-11-17T14:05:00.000Z", "Not/AZone", "en"), /9:05/);
    assert.equal(formatCallTime("not a date", "America/Toronto", "en"), "");
  });

  it("formats durations people can read", () => {
    assert.equal(formatCallDuration(300), "5m 00s");
    assert.equal(formatCallDuration(42), "42s");
    assert.equal(formatCallDuration(0), "0s");
    assert.equal(formatCallDuration(3723), "1h 02m 03s");
    assert.equal(formatCallDuration(undefined), "");
    assert.equal(formatCallDuration(-5), "");
    assert.equal(formatCallDuration(Number.NaN), "");
  });
});
