import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  prepareLiveDemo,
  verifyLiveDemo,
} from "../../src/product/agent-tools/agents/live-demo";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { getMissedCallReadStore } from "../../src/product/missed-call/runtime";
import type { MissedCallWorkflow } from "../../src/product/missed-call/types";

function baseWorkflow(
  overrides: Partial<MissedCallWorkflow> = {},
): MissedCallWorkflow {
  const now = new Date().toISOString();
  return {
    id: "wf_demo_test",
    clientAccountId: "client_demo_test",
    callId: "call_demo_test",
    callerE164: "+15145559000",
    status: "awaiting_technician",
    currentStep: "done",
    collected: { language: "fr", photoUrls: [] },
    escalationIndex: 0,
    escalationStage: "primary",
    technicianAlerts: [],
    outcome: "open",
    events: [],
    createdAt: now,
    updatedAt: now,
    dedupeKey: "dedupe_demo_test",
    ...overrides,
  };
}

describe("live-demo agent — prepareLiveDemo", () => {
  it("refuses without consent on record", async () => {
    const result = await prepareLiveDemo({
      organizationId: null,
      demoClientId: "client_demo_prep_1",
      consent: null,
    });
    assert.deepEqual(result, { ok: false, reason: "consent_required" });
  });

  it("refuses with an incomplete consent record", async () => {
    const result = await prepareLiveDemo({
      organizationId: null,
      demoClientId: "client_demo_prep_2",
      consent: { prospectName: "", method: "verbal", at: "" },
    });
    assert.deepEqual(result, { ok: false, reason: "consent_required" });
  });

  it("refuses when the demo client does not exist, even with consent", async () => {
    const result = await prepareLiveDemo({
      organizationId: null,
      demoClientId: "client_demo_prep_missing",
      consent: {
        prospectName: "Alex Prospect",
        method: "verbal",
        at: new Date().toISOString(),
      },
    });
    assert.deepEqual(result, { ok: false, reason: "demo_client_not_found" });
  });

  it("returns the dial number and instructions once consent is captured", async () => {
    const client = demoClientAccount({ id: "client_demo_prep_ok" });
    await getMissedCallReadStore().saveClient(client);

    const result = await prepareLiveDemo({
      organizationId: null,
      demoClientId: client.id,
      consent: {
        prospectName: "Alex Prospect",
        method: "verbal",
        at: new Date().toISOString(),
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.dialNumber, client.smsFromNumber);
      assert.ok(result.instructions.length > 0);
      assert.match(result.instructions.join(" "), /Alex Prospect/);
    }
  });
});

describe("live-demo agent — verifyLiveDemo", () => {
  it("reports no_recent_call when no workflow exists for that caller", async () => {
    const result = await verifyLiveDemo({
      organizationId: null,
      demoClientId: "client_demo_verify_none",
      callerE164: "+15145559999",
    });
    assert.deepEqual(result, { ok: false, reason: "no_recent_call" });
  });

  it("reports sms_not_sent_yet when the workflow started but the opening SMS has not gone out", async () => {
    const store = getMissedCallReadStore();
    const clientAccountId = "client_demo_verify_pending";
    const callerE164 = "+15145558001";
    await store.saveWorkflow(
      baseWorkflow({
        id: "wf_pending",
        clientAccountId,
        callerE164,
        dedupeKey: "dedupe_pending",
        events: [{ at: new Date().toISOString(), type: "workflow_started" }],
      }),
    );

    const result = await verifyLiveDemo({
      organizationId: null,
      demoClientId: clientAccountId,
      callerE164,
    });
    assert.deepEqual(result, { ok: false, reason: "sms_not_sent_yet" });
  });

  it("confirms the recovery SMS went out and reports latency", async () => {
    const store = getMissedCallReadStore();
    const clientAccountId = "client_demo_verify_ok";
    const callerE164 = "+15145558002";
    const createdAt = new Date(Date.now() - 5_000);
    const smsSentAt = new Date(createdAt.getTime() + 2_500);

    await store.saveWorkflow(
      baseWorkflow({
        id: "wf_ok",
        clientAccountId,
        callerE164,
        dedupeKey: "dedupe_ok",
        createdAt: createdAt.toISOString(),
        updatedAt: smsSentAt.toISOString(),
        events: [
          { at: createdAt.toISOString(), type: "workflow_started" },
          {
            at: smsSentAt.toISOString(),
            type: "sms_sent",
            detail: "opening_fr",
          },
        ],
      }),
    );

    const result = await verifyLiveDemo({
      organizationId: null,
      demoClientId: clientAccountId,
      callerE164,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.workflowId, "wf_ok");
      assert.equal(result.smsSentAt, smsSentAt.toISOString());
      assert.equal(result.latencyMs, 2_500);
    }
  });
});
