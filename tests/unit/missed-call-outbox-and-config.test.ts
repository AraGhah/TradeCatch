import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  parseClientConfigJson,
  clientAccountConfigSchema,
} from "../../src/product/missed-call/client-config";
import {
  resolveEscalationChain,
  shouldEscalateToIndex,
} from "../../src/product/missed-call/technicians";
import { assertTwilioWebhook } from "../../src/product/missed-call/twilio-webhook-auth";
import type { OutboundMessageRecord, SmsPort } from "../../src/product/missed-call/types";

function sign(authToken: string, url: string, params: Record<string, string>) {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf8"))
    .digest("base64");
}

describe("durable readiness helpers", () => {
  it("validates demo client JSON via Zod schema", () => {
    const client = demoClientAccount();
    const parsed = clientAccountConfigSchema.safeParse(client);
    assert.equal(parsed.success, true);
  });

  it("rejects invalid MISSED_CALL_CLIENT_CONFIG_JSON", () => {
    assert.throws(
      () => parseClientConfigJson('{"id":"x"}'),
      /schema validation/i,
    );
  });

  it("keeps escalation chain snapshot when schedule would change", () => {
    const client = demoClientAccount();
    const snap = ["tech_sophie", "tech_backup_2", "tech_owner"];
    const chain = resolveEscalationChain(
      client,
      new Date("2026-07-22T18:00:00.000Z"),
      snap,
    );
    assert.deepEqual(
      chain.map((t) => t.id),
      snap,
    );
  });

  it("uses snapshot length for escalation timing", () => {
    const client = demoClientAccount({
      escalationPolicy: {
        primaryResponseMs: 1,
        backupResponseMs: 1,
        ownerResponseMs: 1,
      },
    });
    const next = shouldEscalateToIndex(
      {
        status: "awaiting_technician",
        technicianAlertedAt: "2026-07-22T17:00:00.000Z",
        escalationIndex: 0,
        escalationChainIds: ["tech_marc", "tech_sophie"],
      },
      client,
      new Date("2026-07-22T18:00:00.000Z"),
    );
    assert.equal(next, 1);
  });

  it("retries failed SMS via outbox on processEscalations", async () => {
    let attempts = 0;
    const sms: SmsPort = {
      async send() {
        attempts += 1;
        if (attempts === 1) throw new Error("Twilio SMS failed: 500 boom");
        return { sid: "SM_retry_ok" };
      },
    };
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });

    await assert.rejects(
      () =>
        engine.handleCallEvent({
          clientAccountId: client.id,
          callerE164: "+15145557099",
          answered: false,
          abandoned: false,
          calledAt: now,
        }),
      /Twilio SMS failed/,
    );

    const result = await engine.processEscalations();
    assert.equal(result.outboxSent, 1);
    assert.equal(attempts, 2);
  });

  it("includes query string when validating Twilio public webhook URL", async () => {
    const base = "https://tradecatch.ca";
    const path = "/api/twilio/sms/inbound";
    const search = "?client=demo";
    const url = `${base}${path}${search}`;
    const params = { From: "+15145550100", Body: "oui" };
    const token = "test-auth-token";
    const signature = sign(token, url, params);
    const req = new NextRequest(`https://internal.proxy${path}${search}`, {
      method: "POST",
      headers: { "x-twilio-signature": signature },
    });
    const ok = await assertTwilioWebhook(req, params, {
      NODE_ENV: "production",
      TWILIO_AUTH_TOKEN: token,
      MISSED_CALL_PUBLIC_WEBHOOK_BASE: base,
    });
    assert.equal(ok, true);
  });

  it("memory outbox claim marks messages sending", async () => {
    const store = createMemoryStore();
    const msg: OutboundMessageRecord = {
      id: "sms_1",
      clientAccountId: "c1",
      toE164: "+15145550001",
      fromE164: "+15145550000",
      body: "hi",
      status: "queued",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.enqueueOutbound(msg);
    const claimed = await store.claimOutboundForSend(5);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.status, "sending");
    await store.markOutboundSent("sms_1", "SM1");
  });
});
