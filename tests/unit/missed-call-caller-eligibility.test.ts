import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEligibleRecoveryCaller } from "../../src/product/missed-call/call-handling";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";

describe("isEligibleRecoveryCaller", () => {
  it("accepts normal NANP mobiles", () => {
    assert.equal(
      isEligibleRecoveryCaller({ callerE164: "+15145551234" }).ok,
      true,
    );
  });

  it("rejects anonymous / short / toll-free / own line", () => {
    assert.equal(
      isEligibleRecoveryCaller({ callerE164: "Anonymous" }).ok,
      false,
    );
    assert.equal(isEligibleRecoveryCaller({ callerE164: "+155512" }).ok, false);
    assert.equal(
      isEligibleRecoveryCaller({ callerE164: "+18005551212" }).ok,
      false,
    );
    assert.equal(
      isEligibleRecoveryCaller({
        callerE164: "+15145550100",
        smsFromE164: "+15145550100",
      }).ok,
      false,
    );
  });
});

describe("engine caller eligibility", () => {
  it("does not SMS anonymous or toll-free missed callers", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const sms = createMemorySmsPort();
    const engine = createMissedCallEngine({ store, sms });

    const anonymous = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "Anonymous",
      answered: false,
      abandoned: false,
      twilioCallSid: "CA_anon_1",
    });
    assert.equal(anonymous.smsSent, false);
    assert.equal(anonymous.suppressedReason, "anonymous_caller");

    const tollFree = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+18885551212",
      answered: false,
      abandoned: false,
      twilioCallSid: "CA_tf_1",
    });
    assert.equal(tollFree.smsSent, false);
    assert.equal(tollFree.suppressedReason, "toll_free_caller");
    assert.equal(sms.sent.length, 0);
  });
});
