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

