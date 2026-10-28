import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createTwilioSmsPort } from "../../src/product/missed-call/twilio";

/**
 * Security regression: a single recipient must not be able to drive
 * unbounded Twilio SMS spend (billing/spam abuse) through the shared
 * outbound SMS adapter every product surface sends through.
 */

let fetchMock: ReturnType<typeof mock.method>;

beforeEach(() => {
  fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ sid: "SM_fake" }), { status: 201 }),
  );
});

afterEach(() => {
  mock.restoreAll();
});

test("caps outbound SMS to a single recipient and lets a different recipient through", async () => {
  const port = createTwilioSmsPort({
    NODE_ENV: "test",
    TWILIO_ACCOUNT_SID: "ACfixture",
    TWILIO_AUTH_TOKEN: "tokenfixture",
    MISSED_CALL_SMS_MODE: "live",
  });
  const from = "+15145550000";
  const to = "+15145559999tc-rate-limit-fixture";

  for (let i = 0; i < 20; i++) {
    await port.send({ toE164: to, fromE164: from, body: `msg ${i}` });
  }
  assert.equal(fetchMock.mock.callCount(), 20);

  await assert.rejects(
    () => port.send({ toE164: to, fromE164: from, body: "one too many" }),
    /rate limit/i,
  );
  // The 21st attempt must never reach Twilio.
  assert.equal(fetchMock.mock.callCount(), 20);

  // A different recipient is on its own bucket and is unaffected.
  await port.send({
    toE164: "+15145551111tc-rate-limit-fixture-2",
    fromE164: from,
    body: "hello",
  });
  assert.equal(fetchMock.mock.callCount(), 21);
});
