/**
 * Regression for the 2026-10-25 platform-wide RECEPTIONIST_RUNTIME_UNAVAILABLE
 * incident: a local `.env.local` with the demo Module A client
 * (client_demo, 555 numbers, RECEPTIONIST_ENABLED=1) was compiled into the
 * production Worker by OpenNext. Production validation refused it at runtime
 * boot (correctly), but the refusal threw out of bootstrap, so every tenant's
 * calls and the Bland/LiveKit agent tools lost the runtime with it.
 *
 * Pinned here:
 * - production validation still refuses that exact config, with the same four
 *   reasons the incident reported (no bypass);
 * - the refused founder config never answers a call, is reported as a
 *   critical RECEPTIONIST_ENV_CONFIG_INVALID, and does not take down tenant lines;
 * - a real, business-specific founder config boots and answers.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST as twilioStep } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import { loadClientAccountFromEnv } from "../../src/product/missed-call/client-config";
import { getMissedCallReadStore } from "../../src/product/missed-call/runtime";
import { profileSettingsSchema } from "../../src/product/receptionist/profile";
import { receptionistErrorCode } from "../../src/product/receptionist/diagnostics";
import {
  ENV_CONFIG_INVALID_CODE,
  getReceptionistRuntime,
  receptionistReadiness,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { defaultPhoneSettings } from "../../src/product/telephony/phone-settings";

/** What the bundled `.env.local` held on 2026-10-25 (values from the incident). */
const OCT_25_DEMO_ENV = {
  MISSED_CALL_CLIENT_ID: "client_demo",
  MISSED_CALL_SMS_FROM: "+15145550100",
  MISSED_CALL_TECH_PHONE: "+15145550199",
  RECEPTIONIST_ENABLED: "1",
} as const;

const OCT_25_REASONS = [
  "client id must not be the demo id in production",
  "smsFromNumber is a reserved demo number",
  "technician tech_primary has a reserved demo phone",
  "humanReviewPhone or ownerTechnicianId required",
];

const KEYS = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "TRADECATCH_E2E",
  "VERCEL_ENV",
  "NEXT_PUBLIC_SITE_URL",
  "DATABASE_URL",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_DURABLE_STORE",
  "MISSED_CALL_ALLOW_DEMO",
  "MISSED_CALL_CLIENT_CONFIG_JSON",
  "MISSED_CALL_CLIENT_ID",
  "MISSED_CALL_SMS_FROM",
  "MISSED_CALL_TECH_PHONE",
  "MISSED_CALL_TECH_OWNER_PHONE",
  "MISSED_CALL_HUMAN_REVIEW_PHONE",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
  "MISSED_CALL_SMS_MODE",
  "RECEPTIONIST_ENABLED",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_PHONE_NUMBER",
  "RECEPTIONIST_EMERGENCY_PHONE",
  "RECEPTIONIST_FALLBACK_PHONE",
  "RECEPTIONIST_NOTIFY_EMAIL",
  "RECEPTIONIST_NOTIFY_SMS",
  "RECEPTIONIST_LLM_PROVIDER",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "RESEND_API_KEY",
  "ADMIN_ALERT_EMAIL",
] as const;

const TOKEN = "containment-test-token";
const TENANT_NUMBER = "+14382314700";
const FOUNDER_NUMBER = "+14382314799";
const env = process.env as Record<string, string | undefined>;
const saved = new Map(KEYS.map((key) => [key, env[key]]));
const globals = globalThis as Record<string, unknown>;
const RESET_GLOBALS = [
  "__tradecatchSaas",
  "__tradecatchMissedCall",
  "__tradecatchMissedCallReadStore",
  "__tradecatchPrivacy",
  "__tradecatchTelephony",
];
let errors: string[] = [];

/** Live production, except that the e2e harness lets sessions live in memory. */
function liveProductionEnv() {
  for (const key of KEYS) delete env[key];
  env.NODE_ENV = "production";
  env.TRADECATCH_ENV = "production";
  env.TRADECATCH_E2E = "1";
  env.NEXT_PUBLIC_SITE_URL = "http://localhost:3100";
  env.TWILIO_AUTH_TOKEN = TOKEN;
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  env.MISSED_CALL_SMS_MODE = "dry-run";
}

function webhook(step: string, params: Record<string, string>) {
  const url = `https://tradecatch.test/api/twilio/voice/receptionist/${step}`;
  const signature = createHmac("sha1", TOKEN)
    .update(
      url +
        Object.keys(params)
          .sort()
          .map((k) => k + params[k])
          .join(""),
    )
    .digest("base64");
  return twilioStep(
    new NextRequest(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      body: new URLSearchParams(params).toString(),
    }),
    { params: Promise.resolve({ step }) },
  );
}

async function incomingCall(to: string, callSid: string) {
  const response = await webhook("incoming", {
    CallSid: callSid,
    From: "+14385559876",
    To: to,
  });
  assert.equal(response.status, 200);
  return response.text();
}

/** A real business on the platform: active org, linked client, activated profile. */
async function seedTenantLine(saas: SaasStore) {
  const client = loadClientAccountFromEnv({
    NODE_ENV: "production",
    TRADECATCH_ENV: "production",
    MISSED_CALL_CLIENT_ID: "client_tenant_line",
    MISSED_CALL_SMS_FROM: TENANT_NUMBER,
    MISSED_CALL_TECH_PHONE: "+14385597002",
    MISSED_CALL_HUMAN_REVIEW_PHONE: "+14385597004",
    MISSED_CALL_CONTRACTOR_NAME: "Tenant Plomberie",
  }).client;
  await getMissedCallReadStore().saveClient(client);
  const { organization } = await saas.createOrganizationWithOwner({
    name: "Tenant Plomberie",
    ownerEmail: "owner@tenant.test",
    ownerName: "Owner",
    missedCallClientId: client.id,
    phoneE164: "+14385597004",
    accountType: "production",
  });
  const runtime = getReceptionistRuntime();
  await runtime.profileStore.saveSettings(
    organization.id,
    profileSettingsSchema.parse({
      notifyEmail: "owner@tenant.test",
      emergencyTransferE164: "+14385597003",
      fallbackTransferE164: "+14385597004",
      businessHours: { start: "00:00", end: "00:00", days: [0, 1, 2, 3, 4, 5, 6] },
      phoneSettings: {
        ...defaultPhoneSettings(),
        tradecatchNumberE164: TENANT_NUMBER,
        humanTransferE164: "+14385597004",
        inboundStrategy: "ai_first",
        aiEnabled: true,
      },
      knowledge: { companyName: "Tenant Plomberie" },
    }),
    "owner@tenant.test",
  );
  await runtime.profileStore.setActivation(
    organization.id,
    { phoneNumberE164: TENANT_NUMBER, activated: true },
    "founder",
  );
  await runtime.refresh(true);
  return organization.id;
}

beforeEach(() => {
  liveProductionEnv();
  for (const g of RESET_GLOBALS) delete globals[g];
  globals.__tradecatchSaas = { store: createMemorySaasStore(), durable: false };
  resetReceptionistRuntimeForTests();
  errors = [];
  mock.method(console, "error", (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
  // Nothing here may reach a carrier, an LLM or an email provider.
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network access is blocked in this test");
  });
});

afterEach(() => {
  mock.restoreAll();
  resetReceptionistRuntimeForTests();
  for (const g of RESET_GLOBALS) delete globals[g];
  for (const [key, value] of saved) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe("2026-10-25 demo client config in production", () => {
  it("is still refused by production validation, for the four reported reasons", () => {
    assert.throws(
      () =>
        loadClientAccountFromEnv({
          NODE_ENV: "production",
          TRADECATCH_ENV: "production",
          ...OCT_25_DEMO_ENV,
        }),
      (err: Error) => {
        assert.match(err.message, /Invalid production client config/);
        for (const reason of OCT_25_REASONS)
          assert.ok(err.message.includes(reason), `missing: ${reason}`);
        return true;
      },
    );
  });

  it("classifies that refusal as a configuration error, not UNKNOWN", () => {
    let caught: unknown;
    try {
      loadClientAccountFromEnv({ NODE_ENV: "production", ...OCT_25_DEMO_ENV });
    } catch (err) {
      caught = err;
    }
    assert.equal(receptionistErrorCode(caught), "INVALID_CONFIGURATION");
  });

  it("boots the runtime, refuses only the founder config, and reports it as critical", () => {
    Object.assign(env, OCT_25_DEMO_ENV);

    const runtime = getReceptionistRuntime();

    assert.deepEqual(
      runtime.configs.map((c) => c.id),
      [],
      "the demo founder profile never answers a call",
    );
    for (const reason of OCT_25_REASONS)
      assert.ok(runtime.envConfigError?.includes(reason), `missing: ${reason}`);
    assert.doesNotMatch(
      runtime.envConfigError ?? "",
      /\d{7}/,
      "no phone number in the ops detail",
    );
    assert.equal(receptionistReadiness().error, ENV_CONFIG_INVALID_CODE);
    const logged = errors
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { event: string; code?: string });
    assert.ok(
      logged.some(
        (entry) =>
          entry.event === "tradecatch.receptionist.env_config_rejected" &&
          entry.code === ENV_CONFIG_INVALID_CODE,
      ),
    );
  });

  it("keeps tenant lines answering calls while the founder config is refused", async () => {
    Object.assign(env, OCT_25_DEMO_ENV);
    const saas = (globals.__tradecatchSaas as { store: SaasStore }).store;
    await seedTenantLine(saas);

    const runtime = getReceptionistRuntime();
    assert.equal(runtime.envConfigError !== undefined, true);
    assert.deepEqual(
      runtime.configs.map((c) => c.phoneNumberE164),
      [TENANT_NUMBER],
    );

    const xml = await incomingCall(TENANT_NUMBER, "CAtenant0000000000000000000000001");
    assert.doesNotMatch(xml, /problème technique|technical issue/);
    assert.match(xml, /session=rcs_/, "a call session started for the tenant");
    assert.match(xml, /<Gather|<Connect/);
  });

  it("does not answer the demo number as the demo business", async () => {
    Object.assign(env, OCT_25_DEMO_ENV);
    const xml = await incomingCall(
      OCT_25_DEMO_ENV.MISSED_CALL_SMS_FROM,
      "CAdemo00000000000000000000000001",
    );
    assert.doesNotMatch(xml, /session=/);
    assert.doesNotMatch(xml, /Nord|client_demo/);
  });
});

describe("business-specific founder config in production", () => {
  it("validates, boots and answers an incoming call", async () => {
    Object.assign(env, {
      RECEPTIONIST_ENABLED: "1",
      MISSED_CALL_CLIENT_ID: "client_founder_line",
      MISSED_CALL_SMS_FROM: FOUNDER_NUMBER,
      MISSED_CALL_TECH_PHONE: "+14385597012",
      MISSED_CALL_HUMAN_REVIEW_PHONE: "+14385597014",
      MISSED_CALL_CONTRACTOR_NAME: "Founder Plomberie",
      RECEPTIONIST_NOTIFY_EMAIL: "owner@founder.test",
    });

    const runtime = getReceptionistRuntime();
    assert.equal(runtime.envConfigError, undefined);
    assert.equal(receptionistReadiness().error, undefined);
    assert.deepEqual(
      runtime.configs.map((c) => c.id),
      ["rc_client_founder_line"],
    );

    const xml = await incomingCall(FOUNDER_NUMBER, "CAfounder000000000000000000000001");
    assert.doesNotMatch(xml, /problème technique|technical issue/);
    assert.match(xml, /session=rcs_/);
  });
});
