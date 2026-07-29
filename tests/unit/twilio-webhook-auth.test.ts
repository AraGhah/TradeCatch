import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { assertTwilioWebhook } from "../../src/product/missed-call/twilio-webhook-auth";

type TestEnv = NodeJS.ProcessEnv;

function sign(authToken: string, url: string, params: Record<string, string>) {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

describe("assertTwilioWebhook", () => {
  it("fails closed in production when TWILIO_AUTH_TOKEN is missing", async () => {
    const req = new NextRequest("https://tradecatch.ca/api/twilio/sms/inbound", {
      method: "POST",
    });
    const ok = await assertTwilioWebhook(req, { From: "+1" }, {
      NODE_ENV: "production",
    } satisfies TestEnv);
    assert.equal(ok, false);
  });

  it("ignores skip flag in production and still requires a valid signature", async () => {
    const req = new NextRequest("https://tradecatch.ca/api/twilio/sms/inbound", {
      method: "POST",
      headers: { "x-twilio-signature": "invalid" },
    });
    const ok = await assertTwilioWebhook(req, { From: "+1" }, {
      NODE_ENV: "production",
      TWILIO_AUTH_TOKEN: "token",
      MISSED_CALL_SKIP_TWILIO_VALIDATE: "1",
      MISSED_CALL_PUBLIC_WEBHOOK_BASE: "https://tradecatch.ca",
    } satisfies TestEnv);
    assert.equal(ok, false);
  });

  it("accepts a valid Twilio signature in production", async () => {
    const url = "https://tradecatch.ca/api/twilio/sms/inbound";
    const params = { From: "+15145550100", Body: "oui" };
    const token = "test-auth-token";
    const signature = sign(token, url, params);
    const req = new NextRequest(url, {
      method: "POST",
      headers: { "x-twilio-signature": signature },
    });
    const ok = await assertTwilioWebhook(req, params, {
      NODE_ENV: "production",
      TWILIO_AUTH_TOKEN: token,
      MISSED_CALL_PUBLIC_WEBHOOK_BASE: "https://tradecatch.ca",
    } satisfies TestEnv);
    assert.equal(ok, true);
  });

  it("allows unsigned requests in development when token is unset", async () => {
    const req = new NextRequest("http://localhost/api/twilio/sms/inbound", {
      method: "POST",
    });
    const ok = await assertTwilioWebhook(req, {}, {
      NODE_ENV: "development",
    } satisfies TestEnv);
    assert.equal(ok, true);
  });
});
