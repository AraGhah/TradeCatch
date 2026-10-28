import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import {
  searchAvailableNumbers,
  purchaseNumber,
  releaseNumber,
  NumberProvisioningError,
} from "../../src/product/missed-call/number-provisioning";

const env = (overrides: Record<string, string | undefined> = {}) =>
  ({
    NODE_ENV: "test",
    TWILIO_ACCOUNT_SID: "AC_test",
    TWILIO_AUTH_TOKEN: "token_test",
    MISSED_CALL_PUBLIC_WEBHOOK_BASE: "https://tradecatch.ca",
    ...overrides,
  }) as unknown as NodeJS.ProcessEnv;

afterEach(() => mock.restoreAll());

describe("searchAvailableNumbers", () => {
  it("throws when Twilio credentials are not configured", async () => {
    await assert.rejects(
      () => searchAvailableNumbers({}, {} as NodeJS.ProcessEnv),
      NumberProvisioningError,
    );
  });

  it("parses the available numbers Twilio returns", async () => {
    let requestedUrl = "";
    mock.method(globalThis, "fetch", async (url: unknown) => {
      requestedUrl = String(url);
      return Response.json({
        available_phone_numbers: [
          { phone_number: "+15145551234", friendly_name: "(514) 555-1234", locality: "Montreal", region: "QC" },
        ],
      });
    });
    const result = await searchAvailableNumbers({ areaCode: "514" }, env());
    assert.deepEqual(result, [
      { phoneNumberE164: "+15145551234", friendlyName: "(514) 555-1234", locality: "Montreal", region: "QC" },
    ]);
    assert.match(requestedUrl, /AvailablePhoneNumbers\/CA\/Local\.json/);
    assert.match(requestedUrl, /AreaCode=514/);
  });

  it("throws a provisioning error when Twilio rejects the search", async () => {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response("boom", { status: 500 }),
    );
    await assert.rejects(
      () => searchAvailableNumbers({}, env()),
      NumberProvisioningError,
    );
  });
});

describe("purchaseNumber", () => {
  it("requires a public webhook base before spending money", async () => {
    await assert.rejects(
      () =>
        purchaseNumber(
          { phoneNumberE164: "+15145551234", friendlyName: "Test" },
          env({ MISSED_CALL_PUBLIC_WEBHOOK_BASE: undefined, NEXT_PUBLIC_SITE_URL: undefined }),
        ),
      NumberProvisioningError,
    );
  });

  it("purchases the number and points every webhook at this app", async () => {
    let sentBody: URLSearchParams | undefined;
    mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      sentBody = init?.body as URLSearchParams;
      return Response.json({ sid: "PN123", phone_number: "+15145551234" });
    });
    const result = await purchaseNumber(
      { phoneNumberE164: "+15145551234", friendlyName: "TradeCatch — Bea's Plumbing" },
      env(),
    );
    assert.deepEqual(result, { sid: "PN123", phoneNumberE164: "+15145551234" });
    assert.equal(
      sentBody?.get("SmsUrl"),
      "https://tradecatch.ca/api/twilio/sms/inbound",
    );
    assert.equal(
      sentBody?.get("VoiceUrl"),
      "https://tradecatch.ca/api/twilio/voice/inbound",
    );
    assert.equal(
      sentBody?.get("StatusCallback"),
      "https://tradecatch.ca/api/twilio/voice/status",
    );
  });

  it("throws when Twilio rejects the purchase", async () => {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response("number no longer available", { status: 400 }),
    );
    await assert.rejects(
      () =>
        purchaseNumber(
          { phoneNumberE164: "+15145551234", friendlyName: "Test" },
          env(),
        ),
      NumberProvisioningError,
    );
  });
});

describe("releaseNumber", () => {
  it("never throws, even when Twilio rejects the release", async () => {
    mock.method(console, "error", () => {});
    mock.method(
      globalThis,
      "fetch",
      async () => new Response("boom", { status: 500 }),
    );
    await assert.doesNotReject(() => releaseNumber("PN123", env()));
  });

  it("treats an already-released (404) number as success", async () => {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status: 404 }),
    );
    await assert.doesNotReject(() => releaseNumber("PN123", env()));
  });

  it("never throws even without Twilio credentials configured", async () => {
    await assert.doesNotReject(() =>
      releaseNumber("PN123", {} as NodeJS.ProcessEnv),
    );
  });
});
