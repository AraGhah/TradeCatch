import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  buildOverview,
  patchAiReceptionistSettings,
} from "../../src/product/receptionist/ai-receptionist-service";
import {
  bookSimulatedAppointment,
  checkSimulatedAvailability,
  resetSimulatedCalendar,
} from "../../src/product/receptionist/appointment-sim";
import {
  runBusinessTestTurn,
  verifyBusinessTestState,
} from "../../src/product/receptionist/business-test";
import { shouldAnswerCall } from "../../src/product/receptionist/call-handling";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import {
  buildProfileConfig,
  composeBusinessFacts,
  defaultProfileSettings,
  profileSettingsSchema,
  type ReceptionistProfile,
} from "../../src/product/receptionist/profile";
import { createMemoryProfileStore } from "../../src/product/receptionist/profile-store";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import type { Organization } from "../../src/product/saas/types";

const clientA = demoClientAccount({
  id: "client_a",
  contractorDisplayName: "Montreal Plumbing Pro",
});
const clientB = demoClientAccount({
  id: "client_b",
  contractorDisplayName: "Laval HVAC Experts",
});

function org(id: string, name: string): Organization {
  return {
    id,
    name,
    slug: id,
    plan: "growth",
    status: "active",
    timezone: "America/Toronto",
    localeDefault: "fr",
    missedCallClientId: id === "org_a" ? "client_a" : "client_b",
    accountType: "demo",
    industry: "plumbing",
    phoneE164: id === "org_a" ? "+14385597100" : "+14385597200",
    city: null,
    serviceArea: "",
    features: {
      aiReceptionist: true,
      appointmentBooking: true,
      callTransfer: true,
      missedCallRecovery: true,
      quoteFollowups: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function profileFor(
  organizationId: string,
  over: Record<string, unknown> = {},
): ReceptionistProfile {
  return {
    organizationId,
    phoneNumberE164:
      organizationId === "org_a" ? "+14385597100" : "+14385597200",
    activated: true,
    settings: profileSettingsSchema.parse({
      receptionistName: organizationId === "org_a" ? "Sophie" : "Alex",
      notifyEmail: "owner@example.com",
      emergencyTransferE164: "+14385597003",
      fallbackTransferE164: "+14385597004",
      knowledge: {
        companyName:
          organizationId === "org_a"
            ? "Montreal Plumbing Pro"
            : "Laval HVAC Experts",
        services:
          organizationId === "org_a"
            ? ["drain cleaning", "pipe repair"]
            : ["furnace repair", "AC install"],
        serviceAreas:
          organizationId === "org_a"
            ? ["Montréal", "Laval"]
            : ["Laval", "Terrebonne"],
        startingPrices:
          organizationId === "org_a" ? "Service call from $89" : undefined,
      },
      faqs: [
        {
          question:
            organizationId === "org_a"
              ? "Do you offer emergency plumbing?"
              : "Do you repair furnaces?",
          keywords:
            organizationId === "org_a"
              ? ["emergency", "urgence", "plumbing"]
              : ["furnace", "fournaise", "hvac"],
          answerFr:
            organizationId === "org_a"
              ? "Oui, urgences plomberie 24/7."
              : "Oui, réparation de fournaises.",
          answerEn:
            organizationId === "org_a"
              ? "Yes, emergency plumbing is available 24/7."
              : "Yes, we repair furnaces.",
        },
      ],
      ...over,
    }),
    updatedAt: new Date().toISOString(),
  };
}

describe("call handling modes", () => {
  const base = buildProfileConfig(profileFor("org_a"), { client: clientA });
  const open = new Date("2026-03-04T15:00:00Z");
  const closed = new Date("2026-03-04T03:00:00Z");

  it("respects always / disabled / business_hours / after_hours", () => {
    assert.equal(
      shouldAnswerCall({ ...base, callHandlingMode: "always" }, open),
      true,
    );
    assert.equal(
      shouldAnswerCall({ ...base, callHandlingMode: "disabled" }, open),
      false,
    );
    assert.equal(
      shouldAnswerCall({ ...base, callHandlingMode: "business_hours" }, open),
      true,
    );
    assert.equal(
      shouldAnswerCall({ ...base, callHandlingMode: "business_hours" }, closed),
      false,
    );
    assert.equal(
      shouldAnswerCall({ ...base, callHandlingMode: "after_hours" }, closed),
      true,
    );
    assert.equal(
      shouldAnswerCall({ ...base, callHandlingMode: "after_hours" }, open),
      false,
    );
  });
});

describe("knowledge composition", () => {
  it("never invents pricing when none was configured", () => {
    const facts = composeBusinessFacts(
      profileSettingsSchema.parse({}).knowledge,
    )!;
    assert.match(facts, /do not quote any price/i);
    assert.doesNotMatch(facts, /\$\d/);
  });

  it("includes only approved prices", () => {
    const facts = composeBusinessFacts(
      profileSettingsSchema.parse({
        knowledge: { startingPrices: "From $120" },
      }).knowledge,
    )!;
    assert.match(facts, /From \$120/);
  });
});

describe("tenant isolation in simulated tests", () => {
  const secret = "test-secret-ai-receptionist";

  it("each business answers only with its own knowledge", async () => {
    const a = await runBusinessTestTurn(
      { action: "start", language: "en", scenario: "open" },
      {
        organizationId: "org_a",
        profile: profileFor("org_a"),
        client: clientA,
        secret,
      },
    );
    assert.match(a.messages.map((m) => m.text).join(" "), /Montreal Plumbing Pro|Sophie/i);

    const aFaq = await runBusinessTestTurn(
      {
        action: "say",
        state: a.state!,
        speech: "Do you offer emergency plumbing services?",
      },
      {
        organizationId: "org_a",
        profile: profileFor("org_a"),
        client: clientA,
        secret,
      },
    );
    const aText = aFaq.messages.map((m) => m.text).join(" ");
    assert.match(aText, /24\/7|emergency plumbing/i);
    assert.doesNotMatch(aText, /furnace|HVAC Experts/i);

    const b = await runBusinessTestTurn(
      { action: "start", language: "en", scenario: "open" },
      {
        organizationId: "org_b",
        profile: profileFor("org_b"),
        client: clientB,
        secret,
      },
    );
    assert.match(b.messages.map((m) => m.text).join(" "), /Laval HVAC|Alex/i);

    // Org B cannot resume Org A's signed state.
    assert.throws(
      () => verifyBusinessTestState(a.state!, secret, "org_b"),
      /Not a business test session|Bad signature|invalid/i,
    );
  });
});

describe("appointment simulation", () => {
  it("prevents double bookings and honors notice window", () => {
    resetSimulatedCalendar("org_a");
    const start = new Date(Date.now() + 48 * 3600_000).toISOString();
    const first = bookSimulatedAppointment({
      organizationId: "org_a",
      startIso: start,
      durationMinutes: 60,
      bufferMinutes: 15,
      bookingNoticeHours: 2,
    });
    assert.equal(first.ok, true);
    const second = bookSimulatedAppointment({
      organizationId: "org_a",
      startIso: start,
      durationMinutes: 60,
      bufferMinutes: 15,
      bookingNoticeHours: 2,
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "conflict");

    const tooSoon = checkSimulatedAvailability({
      organizationId: "org_a",
      startIso: new Date(Date.now() + 30 * 60_000).toISOString(),
      durationMinutes: 60,
      bufferMinutes: 0,
      bookingNoticeHours: 2,
    });
    assert.equal(tooSoon.available, false);
    assert.equal(tooSoon.reason, "notice");
  });
});

describe("settings persistence + overview", () => {
  it("saves knowledge and surfaces overview stats per org", async () => {
    const store = createMemoryProfileStore();
    const result = await patchAiReceptionistSettings(store, {
      organizationId: "org_a",
      client: clientA,
      role: "owner",
      userEmail: "owner@example.com",
      env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
      body: {
        receptionistName: "Sophie",
        knowledge: {
          companyName: "Montreal Plumbing Pro",
          services: ["drain cleaning"],
          serviceAreas: ["Laval"],
        },
        faqs: [
          {
            question: "Do you serve Laval?",
            keywords: ["laval", "serve"],
            answerFr: "Oui, nous desservons Laval.",
            answerEn: "Yes, we serve Laval.",
          },
        ],
        callHandlingMode: "after_hours",
        notifyEmail: "owner@example.com",
        emergencyTransferE164: "+14385597003",
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const again = await store.getProfile("org_a");
    assert.equal(again?.settings.receptionistName, "Sophie");
    assert.deepEqual(again?.settings.knowledge.serviceAreas, ["Laval"]);
    assert.equal(again?.settings.callHandlingMode, "after_hours");

    const overview = buildOverview({
      organization: org("org_a", "Montreal Plumbing Pro"),
      profile: again,
      client: clientA,
      calls: [],
      answering: false,
    });
    assert.equal(overview.receptionistName, "Sophie");
    assert.equal(overview.callHandlingMode, "after_hours");
    assert.equal(overview.status, "inactive");
  });

  it("rejects member role updates", async () => {
    const store = createMemoryProfileStore();
    const result = await patchAiReceptionistSettings(store, {
      organizationId: "org_a",
      client: clientA,
      role: "member",
      userEmail: "member@example.com",
      body: { receptionistName: "Nope" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });
});

describe("engine declines calls outside handling mode", () => {
  it("does not start a session when mode is business_hours and it is closed", async () => {
    const config = {
      ...buildProfileConfig(profileFor("org_a"), { client: clientA }),
      callHandlingMode: "business_hours" as const,
    };
    const engine = createReceptionistEngine({
      store: createMemoryReceptionistStore(),
      configs: () => [config],
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
      clock: { now: () => new Date("2026-03-04T03:00:00Z") },
    });
    const plan = await engine.startCall({
      callSid: "CA_closed",
      fromE164: "+15145559876",
      toE164: "+14385597100",
    });
    // failSafePlan — no gather session for the business
    assert.ok(plan.verbs.some((v) => v.verb === "hangup" || v.verb === "say"));
    assert.equal(plan.sessionId, null);
  });
});

describe("defaults remain valid", () => {
  it("parses empty settings", () => {
    assert.doesNotThrow(() => defaultProfileSettings());
    const config = buildProfileConfig(
      {
        organizationId: "org_a",
        phoneNumberE164: "+14385597100",
        activated: false,
        settings: defaultProfileSettings(),
        updatedAt: new Date().toISOString(),
      },
      { client: clientA },
    );
    assert.equal(config.callHandlingMode, "always");
    assert.ok(config.businessFacts);
  });
});
