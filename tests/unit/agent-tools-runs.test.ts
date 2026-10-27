import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryAgentRunStore } from "../../src/product/agent-tools/store";

describe("agent-tools: agent run store", () => {
  it("saves a run and assigns id/createdAt", async () => {
    const store = createMemoryAgentRunStore();
    const run = await store.saveRun({
      agentName: "caller-classifier",
      trigger: "missed_call",
      organizationId: "org_1",
      input: { phone: "+15145550100" },
      toolCalls: [],
      output: { classification: "real_lead" },
      costUsd: 0.0001,
      durationMs: 42,
      status: "ok",
    });
    assert.ok(run.id);
    assert.ok(run.createdAt);
    assert.equal(run.agentName, "caller-classifier");
  });

  it("lists runs filtered by agent name and organization, newest first", async () => {
    const store = createMemoryAgentRunStore();
    for (const agentName of ["owner-briefing", "caller-classifier"]) {
      for (const organizationId of ["org_1", "org_2"]) {
        await store.saveRun({
          agentName,
          trigger: "test",
          organizationId,
          input: null,
          toolCalls: [],
          output: null,
          costUsd: 0,
          durationMs: 1,
          status: "ok",
        });
      }
    }
    const filtered = await store.listRuns({
      agentName: "caller-classifier",
      organizationId: "org_1",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.agentName, "caller-classifier");
    assert.equal(filtered[0]!.organizationId, "org_1");
  });

  it("respects the limit and defaults to newest-first order", async () => {
    const store = createMemoryAgentRunStore();
    for (let i = 0; i < 3; i++) {
      await store.saveRun({
        agentName: "owner-briefing",
        trigger: "cron",
        organizationId: null,
        input: { i },
        toolCalls: [],
        output: null,
        costUsd: 0,
        durationMs: 1,
        status: "ok",
      });
    }
    const limited = await store.listRuns({ limit: 2 });
    assert.equal(limited.length, 2);
    assert.deepEqual((limited[0]!.input as { i: number }).i, 2);
  });

  it("getRun returns null for an unknown id", async () => {
    const store = createMemoryAgentRunStore();
    assert.equal(await store.getRun("missing"), null);
  });
});
