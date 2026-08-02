import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  ConcurrentWorkflowUpdateError,
  createMemoryStore,
} from "../../src/product/missed-call/store";
import type {
  MissedCallWorkflow,
  OutboundMessageRecord,
} from "../../src/product/missed-call/types";

function baseWorkflow(
  overrides: Partial<MissedCallWorkflow> = {},
): MissedCallWorkflow {
  const now = "2026-07-22T18:00:00.000Z";
  return {
    id: "wf_test",
    clientAccountId: "client_demo",
    callId: "call_1",
    callerE164: "+15145550001",
    status: "awaiting_customer",
    currentStep: "language",
    collected: { language: "fr", photoUrls: [] },
    escalationIndex: -1,
    escalationStage: "primary",
    technicianAlerts: [],
    outcome: "open",
    events: [],
    createdAt: now,
    updatedAt: now,
    dedupeKey: "dedupe_1",
    version: 0,
    ...overrides,
  };
}

describe("workflow concurrency and transactional outbox", () => {
  it("rejects stale last-write-wins updates", async () => {
    const store = createMemoryStore();
    const wf = baseWorkflow();
    await store.saveWorkflow(wf);
    assert.equal(wf.version, 1);

    const stale = {
      ...wf,
      version: 0,
      status: "awaiting_technician" as const,
    };
    await assert.rejects(
      () => store.saveWorkflow(stale),
      (err: unknown) => err instanceof ConcurrentWorkflowUpdateError,
    );

    const fresh = await store.getWorkflow(wf.id);
    assert.equal(fresh?.version, 1);
    assert.equal(fresh?.status, "awaiting_customer");
  });

  it("persists workflow and outbound together", async () => {
    const store = createMemoryStore();
    const wf = baseWorkflow({ id: "wf_tx" });
    const now = "2026-07-22T18:00:00.000Z";
    const outbox: OutboundMessageRecord = {
      id: "sms_tx",
      workflowId: wf.id,
      clientAccountId: wf.clientAccountId,
      toE164: "+15145550001",
      fromE164: "+15145550100",
      body: "hello",
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveWorkflowAndEnqueueOutbound(wf, outbox);
    assert.ok(await store.getWorkflow(wf.id));
    const claimed = await store.claimOutboundById(outbox.id);
    assert.ok(claimed);
    assert.equal(claimed.status, "sending");
  });
});

describe("Postgres store integration", () => {
  const url = process.env.DATABASE_URL?.trim();
  const run = url ? it : it.skip;

  run("createPostgresStore round-trips a workflow with revision", async () => {
    assert.ok(url);
    const schemaPath = join(
      process.cwd(),
      "src/product/missed-call/schema.sql",
    );
    const schema = readFileSync(schemaPath, "utf8");
    const { createPostgresStore, getPgPool, closePgPool } = await import(
      "../../src/product/missed-call/postgres-store"
    );
    const pool = getPgPool(url);
    await pool.query(schema);

    const store = createPostgresStore(url);
    const stamp = Date.now();
    const client = demoClientAccount({
      id: `client_pg_${stamp}`,
      smsFromNumber: `+1514555${String(stamp).slice(-4)}`,
    });
    await store.saveClient(client);

    const callId = `call_pg_${stamp}`;
    await store.saveCall({
      id: callId,
      clientAccountId: client.id,
      callerE164: "+15145559999",
      calledAt: "2026-07-22T18:00:00.000Z",
      disposition: "missed",
    });

    const wf = baseWorkflow({
      id: `wf_pg_${stamp}`,
      clientAccountId: client.id,
      callId,
      dedupeKey: `dedupe_pg_${stamp}`,
    });
    await store.saveWorkflow(wf);
    assert.equal(wf.version, 1);

    const loaded = await store.getWorkflow(wf.id);
    assert.ok(loaded);
    assert.equal(loaded.version, 1);

    const stale = { ...loaded, version: 0, status: "completed" as const };
    await assert.rejects(
      () => store.saveWorkflow(stale),
      (err: unknown) => err instanceof ConcurrentWorkflowUpdateError,
    );

    await closePgPool();
  });
});
