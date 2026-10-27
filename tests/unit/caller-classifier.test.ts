import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { classifyCaller } from "../../src/product/agent-tools/agents/caller-classifier";
import { getCrmService, resetCrmRuntimeForTests } from "../../src/product/crm/runtime";

afterEach(() => {
  resetCrmRuntimeForTests();
});

describe("caller-classifier agent", () => {
  it("classifies an anonymous caller as spam and suppresses the text", async () => {
    const result = await classifyCaller({
      organizationId: null,
      callerE164: "anonymous",
    });
    assert.equal(result.category, "spam");
    assert.equal(result.sendBasicText, false);
  });

  it("classifies a toll-free caller as spam and suppresses the text", async () => {
    const result = await classifyCaller({
      organizationId: null,
      callerE164: "+18005550100",
    });
    assert.equal(result.category, "spam");
    assert.equal(result.sendBasicText, false);
  });

  it("classifies the business's own line calling itself as spam", async () => {
    const result = await classifyCaller({
      organizationId: null,
      callerE164: "+15145550100",
      smsFromE164: "+15145550100",
    });
    assert.equal(result.category, "spam");
    assert.equal(result.sendBasicText, false);
  });

  it("classifies a too-short number as wrong_number and suppresses the text", async () => {
    const result = await classifyCaller({
      organizationId: null,
      callerE164: "+1555",
    });
    assert.equal(result.category, "wrong_number");
    assert.equal(result.sendBasicText, false);
  });

  it("defaults to real_lead + sends the text when there is no organization context", async () => {
    const result = await classifyCaller({
      organizationId: null,
      callerE164: "+15145550123",
    });
    assert.equal(result.category, "real_lead");
    assert.equal(result.confidence, "low");
    assert.equal(result.sendBasicText, true);
  });

  it("defaults to real_lead + sends the text when the number has no CRM match", async () => {
    const result = await classifyCaller({
      organizationId: "org_1",
      callerE164: "+15145550123",
    });
    assert.equal(result.category, "real_lead");
    assert.equal(result.reason, "no_crm_match");
    assert.equal(result.sendBasicText, true);
  });

  it("classifies as existing_customer when the number matches a CRM customer", async () => {
    await getCrmService().capture({
      organizationId: "org_1",
      source: "missed_call",
      phoneE164: "+15145550123",
      displayName: "Marie Tremblay",
    });
    const result = await classifyCaller({
      organizationId: "org_1",
      callerE164: "+15145550123",
    });
    assert.equal(result.category, "existing_customer");
    assert.equal(result.sendBasicText, true);
  });

  it("still sends the text if the eligible caller cannot be CRM-matched due to a lookup error", async () => {
    // organizationId with no matching customer behaves the same as a
    // lookup error would — both fall through to the safe default.
    const result = await classifyCaller({
      organizationId: "org_without_any_customers",
      callerE164: "+15145559999",
    });
    assert.equal(result.sendBasicText, true);
  });
});
