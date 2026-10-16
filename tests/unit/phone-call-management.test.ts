import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import {
  buildProfileConfig,
  profileSettingsSchema,
  type ReceptionistProfile,
} from "../../src/product/receptionist/profile";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createMemoryCallEventStore } from "../../src/product/telephony/call-events";
import { decideInboundRouting } from "../../src/product/telephony/call-routing";
import { runSimulatedPhoneScenario } from "../../src/product/telephony/live-test";
import { defaultPhoneSettings } from "../../src/product/telephony/phone-settings";
import { renderConversationRelayTwiml } from "../../src/product/telephony/conversation-relay";

const client = demoClientAccount({
  id: "client_a",
  contractorDisplayName: "Montreal Plumbing Pro",
});

function profile(over: Record<string, unknown> = {}): ReceptionistProfile {
  return {
    organizationId: "org_a",
    phoneNumberE164: "+14385597100",
    activated: true,
    settings: profileSettingsSchema.parse({
      receptionistName: "Sophie",
      notifyEmail: "owner@example.com",
      emergencyTransferE164: "+14385597003",
      fallbackTransferE164: "+14385597004",
      phoneSettings: {
        ...defaultPhoneSettings(),
        tradecatchNumberE164: "+14385597100",
        humanTransferE164: "+14385597004",
        inboundStrategy: "ai_first",
        aiEnabled: true,
      },
      faqs: [
        {
          keywords: ["laval", "serve", "desservez"],
          answerFr: "Oui, nous desservons Laval.",
          answerEn: "Yes, we serve Laval.",
        },
      ],
      knowledge: {
        companyName: "Montreal Plumbing Pro",
        services: ["plumbing"],
        serviceAreas: ["Montréal", "Laval"],
      },
      ...over,
    }),
    updatedAt: new Date().toISOString(),
  };
}

describe("inbound routing", () => {
  it("rings human first then falls through to AI on overflow", () => {
    const config = buildProfileConfig(profile({ callHandlingMode: "overflow" }), {
      client,
    });
    const decision = decideInboundRouting({
      config,
      phone: {
        ...defaultPhoneSettings(),
        aiEnabled: true,
        inboundStrategy: "ai_first",
        humanTransferE164: "+14385597004",
        ringHumanOnOverflow: true,
      },
      now: new Date("2026-03-04T15:00:00Z"),
    });
    assert.equal(decision.action, "ring_human");
    if (decision.action === "ring_human") {
      assert.equal(decision.then, "ai");
      assert.equal(decision.phoneE164, "+14385597004");
    }
  });

  it("uses AI first when configured", () => {
    const config = buildProfileConfig(profile(), { client });
    const decision = decideInboundRouting({
      config,
      phone: {
        ...defaultPhoneSettings(),
        aiEnabled: true,
        inboundStrategy: "ai_first",
      },
      now: new Date("2026-03-04T15:00:00Z"),
    });
    assert.equal(decision.action, "ai");
  });
});

describe("engine human-first then AI", () => {
  it("dials then greets after no-answer", async () => {
    const config = {
      ...buildProfileConfig(
        profile({
          phoneSettings: {
            ...defaultPhoneSettings(),
            inboundStrategy: "human_first",
            humanTransferE164: "+14385597004",
            humanRingTimeoutSeconds: 20,
            aiEnabled: true,
          },
        }),
        { client },
      ),
      inboundStrategy: "human_first" as const,
    };
    const store = createMemoryReceptionistStore();
    const engine = createReceptionistEngine({
      store,
      configs: () => [config],
      brain: createRuleBrain(),
      notifier: {
        async deliverSummary() {
          return [];
        },
        async alertEmergency() {
          return [];
        },
      },
      clock: { now: () => new Date("2026-03-04T15:00:00Z") },
    });

    const first = await engine.startCall({
      callSid: "CA_hf",
      fromE164: "+15145559876",
      toE164: "+14385597100",
    });
    assert.ok(first.verbs.some((v) => v.verb === "dial"));
    assert.ok(first.sessionId);

    const after = await engine.handleDialResult({
      sessionId: first.sessionId!,
      dialStatus: "no-answer",
    });
    const spoken = after.verbs
      .flatMap((v) =>
        v.verb === "gather" ? v.prompts.map((p) => p.text) : [],
      )
      .join(" ");
    assert.match(spoken, /Montreal Plumbing Pro|Sophie|virtual/i);
    const session = await store.getSession(first.sessionId!);
    assert.equal(session?.status, "in_progress");
    assert.equal(session?.transfers[0]?.status, "no_answer");
  });
});

describe("simulated live phone scenarios", () => {
  it("records events and keeps tenant isolation", async () => {
    const events = createMemoryCallEventStore();
    const result = await runSimulatedPhoneScenario({
      organizationId: "org_a",
      profile: profile(),
      client,
      scenario: "ai_answers",
      language: "en",
      events,
    });
    assert.equal(result.simulated, true);
    assert.ok(result.callSid.startsWith("sim_live_"));
    assert.ok(result.events.some((e) => e.kind === "ai_started"));
    const listed = await events.listForOrganization({
      organizationId: "org_a",
    });
    assert.ok(listed.length >= 2);
    assert.ok(listed.every((e) => e.organizationId === "org_a"));
  });

  it("simulates missed human then AI", async () => {
    const result = await runSimulatedPhoneScenario({
      organizationId: "org_a",
      profile: profile({
        phoneSettings: {
          ...defaultPhoneSettings(),
          inboundStrategy: "human_first",
          humanTransferE164: "+14385597004",
          aiEnabled: true,
        },
      }),
      client,
      scenario: "human_first_missed_then_ai",
    });
    assert.ok(result.events.some((e) => e.kind === "missed"));
    assert.ok(result.events.some((e) => e.kind === "ai_started"));
  });
});

describe("ConversationRelay TwiML", () => {
  it("renders Connect + ConversationRelay", () => {
    const xml = renderConversationRelayTwiml({
      websocketUrl: "wss://staging.example/api/voice/socket",
      language: "en",
      welcomeGreeting: "Hello from Sophie",
      actionUrl: "https://staging.example/api/webhooks/twilio/relay-ended",
      sessionId: "rcs_1",
    });
    assert.match(xml, /ConversationRelay/);
    assert.match(xml, /Hello from Sophie/);
    assert.match(xml, /sessionId/);
  });
});

describe("call event dedupe", () => {
  it("detects recent duplicate webhook fingerprints", async () => {
    const store = createMemoryCallEventStore();
    await store.append({
      organizationId: "org_a",
      clientAccountId: "client_a",
      callSid: "CA_1",
      kind: "incoming",
      detail: "first",
    });
    assert.equal(
      await store.seenRecently({ callSid: "CA_1", kind: "incoming" }),
      true,
    );
    assert.equal(
      await store.seenRecently({ callSid: "CA_2", kind: "incoming" }),
      false,
    );
  });
});
