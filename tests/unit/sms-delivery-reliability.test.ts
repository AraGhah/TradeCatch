import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemoryCrmStore } from "../../src/product/crm/memory-store";
import {
  createTwilioSmsPort,
  SmsDeliveryError,
  smsFailureDisposition,
} from "../../src/product/missed-call/twilio";

test("a callback arriving before the send result reconciles by signed outbox id; stale statuses cannot undo delivery", async () => {
  const store = createMemoryStore();
  const now = new Date().toISOString();
  await store.enqueueOutbound({
    id: "smsrep_inbound",
    clientAccountId: "c1",
    toE164: "+15145550000",
    fromE164: "+14385550000",
    body: "Hello",
    detail: "sms_receptionist",
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await store.claimOutboundById("smsrep_inbound");
  const delivered = await store.applyOutboundProviderStatus(
    "SMprovider",
    "delivered",
    "smsrep_inbound",
  );
  assert.equal(delivered?.status, "delivered");
  await store.markOutboundSent("smsrep_inbound", "SMprovider");
  assert.equal(
    (await store.applyOutboundProviderStatus("SMprovider", "sent"))?.status,
    "delivered",
  );
  assert.equal(
    (await store.applyOutboundProviderStatus("SMprovider", "failed"))?.status,
    "delivered",
  );
  assert.equal((await store.claimOutboundForSend(20)).length, 0);
});

test("SMS carrier rejection is terminal, preserves its SID and does not repeatedly text an invalid recipient", async () => {
  const store = createMemoryStore();
  const now = new Date().toISOString();
  await store.enqueueOutbound({
    id: "smsrep_rejected",
    clientAccountId: "c1",
    toE164: "+15145550000",
    fromE164: "+14385550000",
    body: "Hello",
    detail: "sms_receptionist",
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await store.claimOutboundById("smsrep_rejected");
  await store.markOutboundSent("smsrep_rejected", "SMprovider");
  const failed = await store.applyOutboundProviderStatus(
    "SMprovider",
    "undelivered",
  );
  assert.equal(failed?.status, "undelivered");
  assert.equal(failed?.providerSid, "SMprovider");
  assert.equal(
    (await store.applyOutboundProviderStatus("SMprovider", "sent"))?.status,
    "undelivered",
  );
  assert.equal((await store.claimOutboundForSend(20)).length, 0);
});

test("unknown sends are never blindly reclaimed, but a late callback recovers their status", async () => {
  const store = createMemoryStore();
  const old = new Date(Date.now() - 600_000).toISOString();
  await store.enqueueOutbound({
    id: "smsrep_unknown",
    clientAccountId: "c1",
    toE164: "+15145550000",
    fromE164: "+14385550000",
    body: "Hello",
    detail: "sms_receptionist",
    status: "sending",
    attempts: 0,
    createdAt: old,
    updatedAt: old,
  });
  assert.equal((await store.claimOutboundForSend(20)).length, 0);
  assert.equal(
    (
      await store.applyOutboundProviderStatus(
        "SMlate",
        "delivered",
        "smsrep_unknown",
      )
    )?.status,
    "delivered",
  );
  assert.equal(
    smsFailureDisposition(new Error("network timeout")),
    "uncertain",
  );
  assert.equal(
    smsFailureDisposition(new SmsDeliveryError("retry", "429")),
    "retry",
  );
  assert.equal(
    smsFailureDisposition(new SmsDeliveryError("dead", "21610")),
    "dead",
  );
});

test("CRM returns the newest history for long conversations and isolates delivery updates by tenant", async () => {
  const crm = createMemoryCrmStore();
  for (let i = 0; i < 230; i++)
    await crm.appendMessage({
      id: `m${i}`,
      organizationId: "a",
      conversationId: "thread",
      direction: "inbound",
      body: `message ${i}`,
      automated: false,
      deliveryStatus: "sent",
      simulated: false,
      at: new Date(i * 1000).toISOString(),
    });
  assert.deepEqual(
    (await crm.listMessages("a", "thread", 3)).map((m) => m.body),
    ["message 227", "message 228", "message 229"],
  );
  await crm.updateMessageDelivery("b", "m229", "SMwrong", "delivered");
  assert.equal(
    (await crm.latestMessage("a", "thread"))?.providerMessageSid,
    undefined,
  );
  await crm.updateMessageDelivery("a", "m229", "SMright", "delivered");
  await crm.updateMessageDelivery("a", "m229", "SMright", "sent");
  assert.equal(
    (await crm.latestMessage("a", "thread"))?.deliveryStatus,
    "delivered",
  );
});

test("Twilio sends carry a correlation callback using the public webhook origin", async () => {
  const original = globalThis.fetch;
  let params = new URLSearchParams();
  globalThis.fetch = async (_url, init) => {
    params = new URLSearchParams(String(init?.body));
    return Response.json({ sid: "SMaccepted" });
  };
  try {
    await createTwilioSmsPort({
      NODE_ENV: "test",
      MISSED_CALL_SMS_MODE: "live",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "test",
      MISSED_CALL_PUBLIC_WEBHOOK_BASE: "https://webhook.example",
      NEXT_PUBLIC_SITE_URL: "https://wrong.example",
    }).send({
      toE164: "+15145550000",
      fromE164: "+14385550000",
      body: "Hello",
      outboxId: "smsrep_input",
      internal: true,
    });
    assert.equal(
      params.get("StatusCallback"),
      "https://webhook.example/api/twilio/sms/status?outboxId=smsrep_input",
    );
  } finally {
    globalThis.fetch = original;
  }
});
