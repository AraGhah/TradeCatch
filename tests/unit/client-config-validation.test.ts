import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadClientAccountFromEnvOrSkip,
  parseClientConfigJson,
  validateClientConfig,
} from "../../src/product/missed-call/client-config";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import type { ClientAccount } from "../../src/product/missed-call/types";

function validProductionClient(): ClientAccount {
  const client = structuredClone(demoClientAccount());
  client.id = "client_pilot";
  client.smsFromNumber = "+14162220001";
  client.humanReviewPhone = "+14162220009";
  client.technicianRoster = client.technicianRoster.map(
    (technician, index) => ({
      ...technician,
      phone: `+1416222000${index + 2}`,
    }),
  );
  client.onCallTechnicians = client.onCallTechnicians.map(
    (technician, index) => ({
      ...technician,
      phone: `+1416222001${index + 1}`,
    }),
  );
  return client;
}

describe("production client configuration", () => {
  it("accepts E.164 routing, an IANA timezone, and 24-hour business hours", () => {
    const result = validateClientConfig(validProductionClient());
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("rejects malformed destinations, timezone, and business hours", () => {
    const client = validProductionClient();
    client.smsFromNumber = "514-222-0001";
    client.technicianRoster[0]!.phone = "not-a-phone";
    client.humanReviewPhone = "5142220009";
    client.timezone = "Mars/Olympus_Mons";
    client.businessHours = { start: "8am", end: "25:00", days: [1, 1] };

    const result = validateClientConfig(client);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("smsFromNumber")));
    assert.ok(result.errors.some((error) => error.includes("technician")));
    assert.ok(
      result.errors.some((error) => error.includes("humanReviewPhone")),
    );
    assert.ok(result.errors.some((error) => error.includes("timezone")));
    assert.ok(result.errors.some((error) => error.includes("businessHours")));
  });

  it("rejects malformed JSON configuration at the schema boundary", () => {
    const client = validProductionClient();
    client.timezone = "not/a-zone";
    client.smsFromNumber = "555-0100";

    assert.throws(
      () => parseClientConfigJson(JSON.stringify(client)),
      /timezone: must be a valid IANA time zone|smsFromNumber: must be an E\.164 phone number/,
    );
  });

  it("accepts a valid technician reachable only through the on-call schedule", () => {
    const client = validProductionClient();
    client.onCallTechnicians.push({
      id: "tech_night_shift",
      name: "Night Shift",
      phone: "+14162220021",
      active: true,
    });
    client.onCallSchedule.push({
      day: 1,
      start: "17:00",
      end: "08:00",
      technicianId: "tech_night_shift",
    });

    assert.deepEqual(validateClientConfig(client), { ok: true, errors: [] });
  });

  it("rejects nonexistent and unsafe schedule-only recipients", () => {
    const cases = [
      {
        id: "tech_schedule_missing",
        technician: null,
        expected: "technician tech_schedule_missing missing from roster",
      },
      {
        id: "tech_schedule_inactive",
        technician: {
          id: "tech_schedule_inactive",
          name: "Inactive Shift",
          phone: "+14162220022",
          active: false,
        },
        expected: "technician tech_schedule_inactive is inactive",
      },
      {
        id: "tech_schedule_invalid",
        technician: {
          id: "tech_schedule_invalid",
          name: "Invalid Phone Shift",
          phone: "416-222-0023",
          active: true,
        },
        expected: "technician tech_schedule_invalid phone must be E.164",
      },
      {
        id: "tech_schedule_demo",
        technician: {
          id: "tech_schedule_demo",
          name: "Demo Phone Shift",
          phone: "+15145550199",
          active: true,
        },
        expected: "technician tech_schedule_demo has a reserved demo phone",
      },
    ] as const;

    for (const testCase of cases) {
      const client = validProductionClient();
      if (testCase.technician) {
        client.onCallTechnicians.push({ ...testCase.technician });
      }
      client.onCallSchedule = [
        {
          day: 6,
          start: "00:00",
          end: "23:59",
          technicianId: testCase.id,
        },
      ];

      const result = validateClientConfig(client);
      assert.equal(result.ok, false, testCase.id);
      assert.ok(result.errors.includes(testCase.expected), testCase.id);
    }
  });
});

describe("loadClientAccountFromEnvOrSkip", () => {
  const baseEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    TRADECATCH_ENV: "production",
  };

  it("returns null in real production when no legacy client is configured, instead of throwing", () => {
    const result = loadClientAccountFromEnvOrSkip({ ...baseEnv });
    assert.equal(result, null);
  });

  it("still seeds the legacy client when its env vars are fully configured", () => {
    const result = loadClientAccountFromEnvOrSkip({
      ...baseEnv,
      MISSED_CALL_CLIENT_ID: "client_pilot",
      MISSED_CALL_SMS_FROM: "+14162220001",
      MISSED_CALL_TECH_PHONE: "+14162220002",
      MISSED_CALL_HUMAN_REVIEW_PHONE: "+14162220009",
    });
    assert.ok(result);
    assert.equal(result!.source, "env");
    assert.equal(result!.client.id, "client_pilot");
  });

  it("still throws for an explicit but invalid legacy client config, rather than silently skipping it", () => {
    assert.throws(
      () =>
        loadClientAccountFromEnvOrSkip({
          ...baseEnv,
          MISSED_CALL_CLIENT_ID: "client_demo",
          MISSED_CALL_SMS_FROM: "+14162220001",
          MISSED_CALL_TECH_PHONE: "+14162220002",
        }),
      /Invalid production client config/,
    );
  });

  it("still falls back to the demo fixture outside production", () => {
    const result = loadClientAccountFromEnvOrSkip({ NODE_ENV: "development" });
    assert.ok(result);
    assert.equal(result!.source, "demo");
  });

  it("still allows a missing legacy client on staging without throwing or needing MISSED_CALL_ALLOW_DEMO", () => {
    const result = loadClientAccountFromEnvOrSkip({
      NODE_ENV: "production",
      TRADECATCH_ENV: "staging",
    });
    assert.ok(result);
    assert.equal(result!.source, "demo");
  });
});
