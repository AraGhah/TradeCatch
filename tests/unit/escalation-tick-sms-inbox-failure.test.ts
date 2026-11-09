import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import type { SmsInbox } from "../../src/product/sms-receptionist/inbox";

const managed = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "DATABASE_URL",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
];
const original = new Map(managed.map((key) => [key, process.env[key]]));
const g = globalThis as unknown as {
  __tradecatchSmsInbox?: SmsInbox;
  __tradecatchMissedCall?: unknown;
  __tradecatchMissedCallReadStore?: unknown;
};

function undefinedTable(): Error {
  // What pg raises when mc_sms_inbox was never migrated (SQLSTATE 42P01).
  return Object.assign(
    new Error('relation "mc_sms_inbox" does not exist (host=db.internal)'),
    { code: "42P01" },
  );
}

function inbox(over: Partial<SmsInbox>): SmsInbox {
  return {
    enqueue: async () => {},
    claim: async () => null,
    finish: async () => {},
    purge: async () => {},
    ...over,
  };
}

const logged: string[] = [];
beforeEach(() => {
  managed.forEach((key) => delete process.env[key]);
  Object.assign(process.env, {
    NODE_ENV: "development",
    MISSED_CALL_OPS_SECRET: "test-ops-secret",
  });
  delete g.__tradecatchMissedCall;
  delete g.__tradecatchMissedCallReadStore;
  logged.length = 0;
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
  mock.method(console, "error", (line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  mock.restoreAll();
  delete g.__tradecatchSmsInbox;
  delete g.__tradecatchMissedCall;
  delete g.__tradecatchMissedCallReadStore;
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const tick = () =>
  new NextRequest("http://localhost/api/missed-call/escalations/tick", {
    method: "POST",
    headers: {
      authorization: "Bearer test-ops-secret",
      "x-ops-actor": "ops-test",
    },
  });

describe("escalation tick when the SMS inbox table is missing", () => {
  it("reports the failure with its SQLSTATE but still runs escalations and the outbox", async () => {
    g.__tradecatchSmsInbox = inbox({
      claim: async () => {
        throw undefinedTable();
      },
    });
    const { POST } = await import(
      "../../src/app/api/missed-call/escalations/tick/route"
    );
    const response = await POST(tick());
    assert.equal(response.status, 200, "one failed job must not 5xx the others");
    const body = (await response.json()) as {
      ok: boolean;
      inbox: { processed: number; failed: number };
      outboxFailed: number;
    };
    assert.equal(body.ok, false, "the scheduler must see failed work");
    assert.deepEqual(
      { processed: body.inbox.processed, failed: body.inbox.failed },
      { processed: 0, failed: 1 },
    );
    assert.equal(
      typeof body.outboxFailed,
      "number",
      "escalation + outbox processing ran after the inbox failure",
    );

    const event = logged
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return {};
        }
      })
      .find((e) => e.event === "tradecatch.sms.inbox_tick_failed");
    assert.ok(event, "structured failure event is logged");
    assert.equal(event.sqlState, "42P01");
    assert.doesNotMatch(logged.join("\n"), /db\.internal|mc_sms_inbox/);
  });

  it("is healthy when the inbox drains", async () => {
    g.__tradecatchSmsInbox = inbox({});
    const { POST } = await import(
      "../../src/app/api/missed-call/escalations/tick/route"
    );
    const body = (await (await POST(tick())).json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });
});
