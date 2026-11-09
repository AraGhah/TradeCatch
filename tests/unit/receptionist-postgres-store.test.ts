import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Pool } from "pg";
import { createAgentCallService } from "../../src/product/receptionist/agent-calls";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import {
  createPostgresReceptionistStore,
  updateParams,
} from "../../src/product/receptionist/postgres-store";
import { isConflictError } from "../../src/product/receptionist/store";
import type { CallSession } from "../../src/product/receptionist/types";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

const NOW = new Date("2026-11-08T15:00:00Z");

function session(over: Partial<CallSession> = {}): CallSession {
  const at = NOW.toISOString();
  return {
    id: "rcs_unit_1",
    callSid: "lk_unit_call_1",
    configId: "rc_unit",
    clientAccountId: "client_unit",
    fromE164: "+15145550123",
    toE164: "+15145550000",
    language: "en",
    status: "in_progress",
    step: "reason",
    afterHours: false,
    slots: {},
    turns: [],
    silenceCount: 0,
    callerTurnCount: 0,
    transfers: [],
    notifications: [],
    startedAt: at,
    updatedAt: at,
    version: 1,
    ...over,
  };
}

/** Every `$n` Postgres sees must be referenced, or the statement is rejected with 42P18. */
function referencedParameters(sql: string): number[] {
  return [
    ...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
}
function assertEveryParameterIsUsed(sql: string, params: readonly unknown[]) {
  assert.deepEqual(
    referencedParameters(sql),
    params.map((_, i) => i + 1),
    `statement must reference exactly $1..$${params.length}:\n${sql}`,
  );
}

afterEach(() => mock.restoreAll());

describe("receptionist Postgres store — statement binding", () => {
  it("binds exactly the parameters each statement references (42P18 regression)", async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    const row = { ...session(), data: JSON.stringify(session()), version: 1 };
    mock.method(Pool.prototype, "query", async (sql: string, params: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
      return { rows: [row], rowCount: 1 };
    });
    const store = createPostgresReceptionistStore(
      "postgres://u:p@127.0.0.1:1/never-connected",
    );
    const s = session();
    await store.insertSessionIfAbsent(s);
    await store.getSession(s.id);
    await store.getSessionByCallSid(s.callSid);
    await store.saveSession(s);
    await store.listSessions({ clientAccountId: s.clientAccountId });
    await store.listSessions({});
    await store.listStaleUnfinalized(NOW.toISOString(), 10);
    await store.purgeTranscripts("rc_unit", NOW.toISOString());

    assert.ok(seen.length >= 8);
    for (const { sql, params } of seen) assertEveryParameterIsUsed(sql, params);
  });

  it("updateParams matches the UPDATE's nine placeholders in order", () => {
    const s = session({
      status: "completed",
      outcome: "message_taken",
      endedAt: NOW.toISOString(),
      finalizedAt: NOW.toISOString(),
      version: 4,
    });
    const p = updateParams(s);
    assert.equal(p.length, 9);
    assert.equal(p[0], s.id);
    assert.equal(p[1], "completed");
    assert.equal(p[2], "message_taken");
    assert.equal(p[8], 4, "the version guard is the last parameter");
    assert.equal(
      (JSON.parse(p[6] as string) as Record<string, unknown>).version,
      undefined,
      "version lives in its own column, not in the JSON document",
    );
  });
});

const dbUrl = process.env.RECEPTIONIST_TEST_DATABASE_URL;

describe("receptionist Postgres store — real database", { skip: !dbUrl }, () => {
  const config = parseReceptionistConfig({
    id: "rc_pg_unit",
    clientAccountId: "client_pg_unit",
    phoneNumberE164: "+15145550000",
    businessName: "Plomberie Test",
    languages: ["fr", "en"],
    defaultLanguage: "en",
    notifications: [{ type: "sms", toE164: "+15145550304" }],
  });
  const callId = `pg-unit-${Date.now()}`;

  function build() {
    assert.equal(new URL(dbUrl!).hostname, "127.0.0.1", "local test database only");
    const store = createPostgresReceptionistStore(dbUrl!);
    const sms = createMemorySmsPort();
    const emails: string[] = [];
    const clock = { now: () => NOW };
    const engine = createReceptionistEngine({
      store,
      configs: () => [config],
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({
        sms,
        sendEmail: async (input) => {
          emails.push(input.toEmail);
          return { sent: true };
        },
      }),
      clock,
    });
    const service = createAgentCallService({
      store,
      finalize: engine.finalizeSession,
      clock,
    });
    return { store, sms, emails, service };
  }

  it("saves with optimistic concurrency", async () => {
    const { store } = build();
    const created = (
      await store.insertSessionIfAbsent(
        session({ id: `rcs_${callId}_a`, callSid: `lk_${callId}_a`, configId: config.id, clientAccountId: config.clientAccountId }),
      )
    ).session;
    const saved = await store.saveSession({ ...created, status: "completed", outcome: "message_taken" });
    assert.equal(saved.version, created.version + 1);
    assert.equal(saved.status, "completed");
    await assert.rejects(
      store.saveSession({ ...created, status: "failed" }),
      isConflictError,
      "a stale writer is rejected, never silently applied",
    );
    const again = await store.insertSessionIfAbsent({ ...created, id: "rcs_other" });
    assert.equal(again.created, false);
    assert.equal(again.session.id, created.id, "a repeated insert returns the original");
  });

  it("records a finished voice-agent call once, even when the report is retried", async () => {
    const { service, store, sms } = build();
    const report = {
      callId,
      fromE164: "+15145550123",
      language: "en" as const,
      intent: "service_request" as const,
      slots: { callerName: "John Smith", issue: "Kitchen pipe leaking" },
      transcript: [
        { speaker: "caller" as const, text: "My kitchen pipe is leaking" },
        { speaker: "agent" as const, text: "I have noted that." },
      ],
      durationSeconds: 126,
      endReason: "caller_hung_up" as const,
    };
    const first = await service.report(config, report);
    const second = await service.report(config, report);
    assert.ok(first?.finalizedAt, "the first report finalizes the call");
    assert.equal(second?.id, first?.id);
    const stored = await store.getSessionByCallSid(`lk_${callId}`);
    assert.equal(stored?.status, "completed");
    assert.equal(stored?.slots.callerName, "John Smith");
    assert.ok(stored?.finalizedAt);
    assert.equal(sms.sent.length, 1, "the owner is texted exactly once");
  });
});
