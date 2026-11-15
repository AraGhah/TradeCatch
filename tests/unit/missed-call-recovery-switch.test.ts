import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import {
  DEFAULT_RECOVERY_MAX_AGE_MINUTES,
  missedCallRecoveryMaxAgeMs,
  missedCallRecoverySmsDisabled,
} from "../../src/product/missed-call/recovery-switch";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { deferMissedCallOpening } from "../../src/product/sms-automation/hooks";

const WEDNESDAY_AFTERNOON = new Date("2026-07-22T18:00:00.000Z");

async function withSwitch<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const saved = process.env.MISSED_CALL_RECOVERY_SMS;
  if (value === undefined) delete process.env.MISSED_CALL_RECOVERY_SMS;
  else process.env.MISSED_CALL_RECOVERY_SMS = value;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.MISSED_CALL_RECOVERY_SMS;
    else process.env.MISSED_CALL_RECOVERY_SMS = saved;
  }
}

describe("missed-call text operator controls", () => {
  it("is on unless the operator says off", () => {
    assert.equal(missedCallRecoverySmsDisabled({}), false);
    assert.equal(missedCallRecoverySmsDisabled({ MISSED_CALL_RECOVERY_SMS: "" }), false);
    assert.equal(missedCallRecoverySmsDisabled({ MISSED_CALL_RECOVERY_SMS: "on" }), false);
    assert.equal(missedCallRecoverySmsDisabled({ MISSED_CALL_RECOVERY_SMS: "1" }), false);
    for (const off of ["off", "OFF", " false ", "0", "no", "disabled"]) {
      assert.equal(missedCallRecoverySmsDisabled({ MISSED_CALL_RECOVERY_SMS: off }), true, off);
    }
  });

  it("limits how long a missed-call text may wait", () => {
    const minutes = (env: Record<string, string>) => missedCallRecoveryMaxAgeMs(env) / 60_000;
    assert.equal(minutes({}), DEFAULT_RECOVERY_MAX_AGE_MINUTES);
    assert.equal(minutes({ MISSED_CALL_RECOVERY_MAX_AGE_MINUTES: "15" }), 15);
    for (const bad of ["", "abc", "0", "-5", "100000"]) {
      assert.equal(minutes({ MISSED_CALL_RECOVERY_MAX_AGE_MINUTES: bad }), DEFAULT_RECOVERY_MAX_AGE_MINUTES, bad);
    }
  });

  it("with the switch off, a missed call sends the customer nothing but keeps the workflow", async () => {
    await withSwitch("off", async () => {
      const store = createMemoryStore();
      const sms = createMemorySmsPort();
      const client = demoClientAccount();
      await store.saveClient(client);
      const engine = createMissedCallEngine({
        store,
        sms,
        clock: { now: () => WEDNESDAY_AFTERNOON },
      });
      const start = await engine.handleCallEvent({
        clientAccountId: client.id,
        callerE164: "+15145551234",
        answered: false,
        abandoned: false,
        calledAt: WEDNESDAY_AFTERNOON,
      });
      assert.equal(start.smsSent, false);
      assert.equal(sms.sent.filter((m) => m.toE164 === "+15145551234").length, 0);
      assert.ok(start.workflow, "the call is still logged as a workflow for the team");
      assert.equal(start.call.disposition, "missed");
    });
  });

  it("with the switch unset, the Module A opening text is still sent", async () => {
    await withSwitch(undefined, async () => {
      const store = createMemoryStore();
      const sms = createMemorySmsPort();
      const client = demoClientAccount();
      await store.saveClient(client);
      const engine = createMissedCallEngine({
        store,
        sms,
        clock: { now: () => WEDNESDAY_AFTERNOON },
      });
      const start = await engine.handleCallEvent({
        clientAccountId: client.id,
        callerE164: "+15145551235",
        answered: false,
        abandoned: false,
        calledAt: WEDNESDAY_AFTERNOON,
      });
      assert.equal(start.smsSent, true);
    });
  });

  it("the automation hook reports 'handled' with the switch off, without reading any store", async () => {
    await withSwitch("off", async () => {
      const handled = await deferMissedCallOpening({
        clientAccountId: "client_demo",
        callId: "call_x",
        callerE164: "+15145551236",
        disposition: "missed",
      });
      assert.equal(handled, true);
    });
  });
});
