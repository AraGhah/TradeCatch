import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";
import { z } from "zod";
import { POST } from "../../src/app/api/missed-call/escalations/tick/route";
import {
  createMemoryStore,
  type MissedCallStore,
} from "../../src/product/missed-call/store";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { getMissedCallMaintenanceRuntime } from "../../src/product/missed-call/runtime";

const globals = globalThis as typeof globalThis & {
  __tradecatchMissedCallReadStore?: MissedCallStore;
  __tradecatchMissedCall?: unknown;
};
const originalEnv = { ...process.env };
const maintenanceResponse = z.object({
  ok: z.boolean(),
  escalated: z.array(z.string()),
  timedOut: z.array(z.string()),
  outboxSent: z.number(),
  outboxFailed: z.number(),
});
let store: MissedCallStore;
beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("MISSED_CALL_") ||
      key.startsWith("TWILIO_") ||
      [
        "DATABASE_URL",
        "CRON_SECRET",
        "TRADECATCH_ENV",
        "SAAS_DURABLE_STORE",
      ].includes(key)
    )
      delete process.env[key];
  }
  Object.assign(process.env, {
    NODE_ENV: "production",
    TRADECATCH_ENV: "production",
    MISSED_CALL_OPS_SECRET: "maintenance-test-not-for-production",
  });
  delete globals.__tradecatchMissedCall;
  store = createMemoryStore();
  // An explicitly injected test store; production store creation still refuses
  // memory fallback. No real database or provider is contacted by these tests.
  globals.__tradecatchMissedCallReadStore = store;
});
afterEach(() => {
  mock.restoreAll();
  delete globals.__tradecatchMissedCall;
  delete globals.__tradecatchMissedCallReadStore;
  for (const key of Object.keys(process.env))
    if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function request(authorized = true) {
  return new NextRequest(
    "https://tradecatch.ca/api/missed-call/escalations/tick",
    {
      method: "POST",
      headers: authorized
        ? {
            authorization: "Bearer maintenance-test-not-for-production",
            "x-ops-actor": "maintenance-test",
          }
        : {},
    },
  );
}

test("empty maintenance works without global phone routing or Twilio and never seeds a client", async () => {
  const save = mock.method(store, "saveClient", async () => {
    throw Error("Must not bootstrap a client");
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  const body = maintenanceResponse.parse(await response.json());
  assert.equal(body.ok, true);
  assert.deepEqual(body.escalated, []);
  assert.equal(body.outboxSent, 0);
  assert.equal(body.outboxFailed, 0);
  assert.equal(save.mock.callCount(), 0);
});
test("uses the persisted workflow client and preserves its settings without environment routing", async () => {
  const client = demoClientAccount({
    id: "persisted-maintenance-client",
    timeouts: { customerCollectionMs: 1000 },
  });
  await store.saveClient(client);
  const now = new Date(Date.now() - 60_000);
  const setup = createMissedCallEngine({
    store,
    sms: createMemorySmsPort(),
    clock: { now: () => now },
  });
  const started = await setup.handleCallEvent({
    clientAccountId: client.id,
    callerE164: "+15145557099",
    answered: false,
    abandoned: false,
    calledAt: now,
  });
  assert.ok(started.workflow);
  const save = mock.method(store, "saveClient", async () => {
    throw Error("Do not overwrite persisted clients");
  });
  const response = await POST(request());
  const body = maintenanceResponse.parse(await response.json());
  assert.equal(body.ok, true);
  assert.deepEqual(body.timedOut, [started.workflow.id]);
  assert.equal(
    (await store.getWorkflow(started.workflow.id))?.stopReason,
    "customer_timeout",
  );
  assert.deepEqual(await store.getClient(client.id), client);
  assert.equal(save.mock.callCount(), 0);
});
test("a real queued send without Twilio stays failed/retry and is not reported healthy", async () => {
  const at = new Date().toISOString();
  await store.enqueueOutbound({
    id: "pending-maintenance-test",
    clientAccountId: "persisted-client",
    toE164: "+15145557099",
    fromE164: "+15145550100",
    body: "Controlled test, never sent",
    status: "queued",
    attempts: 0,
    createdAt: at,
    updatedAt: at,
  });
  const response = await POST(request());
  const body = maintenanceResponse.parse(await response.json());
  assert.equal(body.ok, false);
  assert.equal(body.outboxSent, 0);
  assert.equal(body.outboxFailed, 1);
  const queued = await store.getOutboundQueueStats();
  assert.equal(queued.retry, 1);
});
test("database failures still propagate and an unauthorized request never reads maintenance data", async () => {
  const read = mock.method(store, "claimOutboundForSend", async () => {
    throw Error("database unavailable");
  });
  assert.equal((await POST(request(false))).status, 401);
  assert.equal(read.mock.callCount(), 0);
  await assert.rejects(() => POST(request()), /database unavailable/);
});
test("maintenance never permits a production memory fallback when no store was injected", () => {
  delete globals.__tradecatchMissedCallReadStore;
  assert.throws(
    () => getMissedCallMaintenanceRuntime(),
    /Refusing in-memory store in production/,
  );
});
