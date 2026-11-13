import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  SmsRateLimitError,
  createTwilioSmsPort,
  smsFailureDisposition,
} from "../../src/product/missed-call/twilio";

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

test("internal owner/staff alerts are never rate-limited even past the per-pair cap", async () => {
  const port = createTwilioSmsPort({
    NODE_ENV: "test",
    TWILIO_ACCOUNT_SID: "ACfixture",
    TWILIO_AUTH_TOKEN: "tokenfixture",
    MISSED_CALL_SMS_MODE: "live",
  });
  const from = "+15145550000";
  const to = "+15145559998tc-rate-limit-internal-fixture";

  for (let i = 0; i < 25; i++) {
    await port.send({
      toE164: to,
      fromE164: from,
      body: `alert ${i}`,
      internal: true,
    });
  }
  assert.equal(fetchMock.mock.callCount(), 25);

  // The same recipient's customer-facing (non-internal) bucket is unaffected
  // by — and does not share state with — the internal alert traffic above.
  for (let i = 0; i < 20; i++) {
    await port.send({ toE164: to, fromE164: from, body: `msg ${i}` });
  }
  assert.equal(fetchMock.mock.callCount(), 45);
  await assert.rejects(
    () => port.send({ toE164: to, fromE164: from, body: "one too many" }),
    /rate limit/i,
  );
});

test("caps one business number's total texts, asks the outbox to retry later, and leaves other numbers alone", async () => {
  const port = createTwilioSmsPort({
    NODE_ENV: "test",
    TWILIO_ACCOUNT_SID: "ACfixture",
    TWILIO_AUTH_TOKEN: "tokenfixture",
    MISSED_CALL_SMS_MODE: "live",
  });
  // A loop (or a bug) texting many different customers from one number. Each
  // pair is within its own cap; only the sender-wide bucket can stop this.
  const from = `+15145550100tc-sender-fixture-${Date.now()}`;
  for (let i = 0; i < 200; i++) {
    await port.send({ toE164: `+1514555${i}tc-sender-fixture`, fromE164: from, body: `msg ${i}` });
  }
  assert.equal(fetchMock.mock.callCount(), 200);

  let refusal: unknown;
  try {
    await port.send({ toE164: "+15145558888tc-sender-fixture", fromE164: from, body: "one too many" });
  } catch (error) {
    refusal = error;
  }
  assert.ok(refusal instanceof SmsRateLimitError, "refused by the limiter, not by Twilio");
  assert.equal(smsFailureDisposition(refusal), "retry", "the outbox retries it; it is never marked dead");
  assert.ok(refusal.resetAt > Date.now(), "and is told when the bucket has a token again");
  assert.equal(fetchMock.mock.callCount(), 200, "the 201st never reached Twilio");

  // Another business number is on its own bucket.
  await port.send({
    toE164: "+15145558888tc-sender-fixture",
    fromE164: `+15145550101tc-sender-fixture-${Date.now()}`,
    body: "hello",
  });
  assert.equal(fetchMock.mock.callCount(), 201);

  // Owner alerts bypass both buckets.
  await port.send({ toE164: "+15145557777tc-sender-fixture", fromE164: from, body: "alert", internal: true });
  assert.equal(fetchMock.mock.callCount(), 202);
});
