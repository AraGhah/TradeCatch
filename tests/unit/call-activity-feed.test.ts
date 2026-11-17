/**
 * KAN-15 · the call screen lists every call the business had, from both paths.
 *
 * Numbers bought through provisioning are answered by the missed-call text-back
 * module (Module A), which never writes a receptionist session. Those calls
 * are read into the list at display time: shown once, newest first, for the
 * signed-in business only, and never invented to be more than Module A recorded.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhone } from "../../src/lib/phone";
import { createMemoryStore } from "../../src/product/missed-call/store";
import type { MissedCallStore } from "../../src/product/missed-call/store";
import type { CallRecord } from "../../src/product/missed-call/types";
import { callState, toCallRow } from "../../src/product/receptionist/call-history-view";
import { loadCallFeed, missedCallAsSession } from "../../src/product/receptionist/call-feed";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import type { ReceptionistStore } from "../../src/product/receptionist/store";
import type { CallSession } from "../../src/product/receptionist/types";

const A = "client_a";
const B = "client_b";

function mcCall(over: Partial<CallRecord> & { id: string }): CallRecord {
  return {
    clientAccountId: A,
    callerE164: "+15145551234",
    calledAt: "2026-11-17T14:00:00.000Z",
    disposition: "missed",
    ...over,
  };
}

function session(sid: string, at: string, over: Partial<CallSession> = {}): CallSession {
  return {
    id: `rcs_${sid}`,
    callSid: sid,
    configId: "rc_a",
    clientAccountId: A,
    fromE164: "+15145559876",
    toE164: "+14385597001",
    language: "en",
    status: "completed",
    step: "done",
    outcome: "message_taken",
    afterHours: false,
    slots: { callerName: "Marie", issue: "Leak" },
    turns: [],
    silenceCount: 0,
    callerTurnCount: 2,
    transfers: [],
    notifications: [],
    finalizedAt: at,
    endedAt: at,
    startedAt: at,
    updatedAt: at,
    version: 1,
    ...over,
  };
}

async function stores(opts: { calls?: CallRecord[]; sessions?: CallSession[] } = {}) {
  const missedCall = createMemoryStore();
  for (const call of opts.calls ?? []) await missedCall.saveCall(call);
  const receptionist = createMemoryReceptionistStore();
  for (const s of opts.sessions ?? []) await receptionist.insertSessionIfAbsent(s);
  return { missedCall, receptionist };
}

const feed = (s: { missedCall: MissedCallStore; receptionist: ReceptionistStore }, clientAccountId = A) =>
  loadCallFeed({ clientAccountId, receptionist: s.receptionist, missedCall: () => s.missedCall });

describe("missed-call text-back calls on the call screen", () => {
  it("lists a Module A call that the receptionist never saw, readable and honest", async () => {
    const s = await stores({
      calls: [mcCall({ id: "c1", twilioCallSid: "CAmc1", callerE164: "+15145551234", durationSeconds: 7 })],
    });
    const { calls, missedCallsUnavailable } = await feed(s);
    assert.equal(missedCallsUnavailable, false);
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.callSid, "CAmc1");
    assert.equal(call.fromE164, "+15145551234", "stored as E.164");
    assert.equal(formatPhone(call.fromE164), "(514) 555-1234");
    assert.equal(callState(call), "missed");
    assert.equal(call.startedAt, "2026-11-17T14:00:00.000Z", "the time Module A recorded, in UTC");
    assert.equal(call.durationSeconds, 7);

    // Nothing Module A did not capture is made up.
    assert.equal(call.toE164, "");
    assert.equal(call.outcome, undefined);
    assert.equal(call.summary, undefined);
    assert.deepEqual(call.slots, {});
    assert.equal(call.turns.length, 0);
    assert.equal(toCallRow(call).direction, "inbound");
  });

  it("reads each disposition as what happened", () => {
    const state = (disposition: CallRecord["disposition"]) =>
      callState(missedCallAsSession(mcCall({ id: disposition, disposition }), { id: "rc" }));
    assert.equal(state("missed"), "missed");
    assert.equal(state("after_hours_missed"), "missed");
    assert.equal(state("abandoned"), "missed");
    assert.equal(state("answered"), "completed");
    assert.equal(
      missedCallAsSession(mcCall({ id: "x", disposition: "after_hours_missed" }), { id: "rc" }).afterHours,
      true,
    );
  });

  it("shows both paths together, newest first", async () => {
    const s = await stores({
      calls: [
        mcCall({ id: "c1", twilioCallSid: "CAmc1", calledAt: "2026-11-17T13:00:00.000Z" }),
        mcCall({ id: "c2", twilioCallSid: "CAmc2", calledAt: "2026-11-17T15:00:00.000Z" }),
      ],
      sessions: [session("CArc1", "2026-11-17T14:00:00.000Z")],
    });
    const { calls } = await feed(s);
    assert.deepEqual(
      calls.map((c) => c.callSid),
      ["CAmc2", "CArc1", "CAmc1"],
    );
  });

  it("keeps the same list across refreshes and writes nothing", async () => {
    const s = await stores({
      calls: [mcCall({ id: "c1", twilioCallSid: "CAmc1" })],
      sessions: [session("CArc1", "2026-11-17T14:30:00.000Z")],
    });
    const first = (await feed(s)).calls.map((c) => c.id);
    const second = (await feed(s)).calls.map((c) => c.id);
    const third = (await feed(s)).calls.map((c) => c.id);
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    // Reading never created a receptionist record for the Module A call.
    assert.equal((await s.receptionist.listSessions({ clientAccountId: A, limit: 50 })).length, 1);
    assert.equal((await s.missedCall.listCalls(A, 50)).length, 1);
  });

  it("shows a call both paths know once, as the receptionist's record", async () => {
    // The receptionist handed this call to text-back recovery: same provider call id.
    const s = await stores({
      calls: [mcCall({ id: "c1", twilioCallSid: "CAboth" })],
      sessions: [session("CAboth", "2026-11-17T14:00:00.000Z")],
    });
    const { calls } = await feed(s);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.id, "rcs_CAboth");
    assert.equal(calls[0]!.slots.callerName, "Marie");
  });

  it("does not list the text-back copy of a call the voice agent already reported", async () => {
    const at = "2026-11-17T14:00:00.000Z";
    const s = await stores({
      calls: [mcCall({ id: "c1", twilioCallSid: "CAroute", callerE164: "+15145559876" })],
      sessions: [
        // The routing record (hidden once the agent's own record exists) ...
        session("CAroute", at, {
          routing: { handoff: { target: "livekit", status: "connected", at } },
          slots: {},
          outcome: undefined,
        }),
        // ... and the agent's conversation.
        session("lk_conv1", "2026-11-17T14:00:20.000Z"),
      ],
    });
    const { calls } = await feed(s);
    assert.deepEqual(
      calls.map((c) => c.callSid),
      ["lk_conv1"],
      "one call, listed once",
    );
  });

  it("lists a Module A call that has no provider id, once", async () => {
    const s = await stores({ calls: [mcCall({ id: "c9" })] });
    const { calls } = await feed(s);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.callSid, "mc_c9");
  });
});

describe("the call screen never shows another business", () => {
  it("lists only the signed-in business's calls from both paths", async () => {
    const s = await stores({
      calls: [
        mcCall({ id: "a1", twilioCallSid: "CAa1" }),
        mcCall({ id: "b1", twilioCallSid: "CAb1", clientAccountId: B }),
      ],
      sessions: [
        session("CAra", "2026-11-17T14:10:00.000Z"),
        session("CArb", "2026-11-17T14:20:00.000Z", { clientAccountId: B }),
      ],
    });
    const mine = await feed(s, A);
    assert.deepEqual(new Set(mine.calls.map((c) => c.callSid)), new Set(["CAa1", "CAra"]));
    const theirs = await feed(s, B);
    assert.deepEqual(new Set(theirs.calls.map((c) => c.callSid)), new Set(["CAb1", "CArb"]));
    assert.equal((await feed(s, "client_nobody")).calls.length, 0);
  });

  it("drops a record from another business even if a store returned it", async () => {
    const leaky: MissedCallStore = {
      ...createMemoryStore(),
      async listCalls() {
        return [
          mcCall({ id: "mine", twilioCallSid: "CAmine" }),
          mcCall({ id: "theirs", twilioCallSid: "CAtheirs", clientAccountId: B }),
        ];
      },
    };
    const { calls } = await loadCallFeed({
      clientAccountId: A,
      receptionist: createMemoryReceptionistStore(),
      missedCall: () => leaky,
    });
    assert.deepEqual(
      calls.map((c) => c.callSid),
      ["CAmine"],
    );
  });
});

describe("a failed read is said, never shown as an empty history", () => {
  const failingMissedCall = (): MissedCallStore => ({
    ...createMemoryStore(),
    async listCalls() {
      throw new Error("connection reset");
    },
  });

  it("keeps the receptionist's calls and flags the list as incomplete when text-back calls cannot be read", async () => {
    const receptionist = createMemoryReceptionistStore();
    await receptionist.insertSessionIfAbsent(session("CArc1", "2026-11-17T14:00:00.000Z"));
    const { calls, missedCallsUnavailable } = await loadCallFeed({
      clientAccountId: A,
      receptionist,
      missedCall: failingMissedCall,
    });
    assert.equal(missedCallsUnavailable, true);
    assert.equal(calls.length, 1);
  });

  it("flags it when the text-back store cannot even be opened", async () => {
    const { missedCallsUnavailable } = await loadCallFeed({
      clientAccountId: A,
      receptionist: createMemoryReceptionistStore(),
      missedCall: () => {
        throw new Error("Refusing in-memory store in production");
      },
    });
    assert.equal(missedCallsUnavailable, true);
  });

  it("throws, rather than answering with an empty list, when the receptionist's calls cannot be read", async () => {
    const broken: ReceptionistStore = {
      ...createMemoryReceptionistStore(),
      async listSessions() {
        throw new Error("connection reset");
      },
    };
    await assert.rejects(
      loadCallFeed({ clientAccountId: A, receptionist: broken, missedCall: () => createMemoryStore() }),
      /connection reset/,
    );
  });

  it("logs the failure without a caller number", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => void lines.push(String(line));
    try {
      await loadCallFeed({
        clientAccountId: A,
        receptionist: createMemoryReceptionistStore(),
        missedCall: failingMissedCall,
      });
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /missed_call_list_failed/);
    assert.doesNotMatch(lines[0]!, /\+1\d{10}|5145551234/);
  });
});
