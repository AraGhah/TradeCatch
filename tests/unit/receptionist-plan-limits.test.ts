import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  applyVoicePlanLimits,
  unavailableVoiceSettings,
  voiceCapabilitiesForPlan,
} from "../../src/product/receptionist/plan-limits";
import {
  buildProfileConfig,
  profileSettingsSchema,
  type ReceptionistProfile,
} from "../../src/product/receptionist/profile";
import { loadProfileConfigs } from "../../src/product/receptionist/profile-loader";
import {
  activateProfile,
  saveOwnerSettings,
} from "../../src/product/receptionist/profile-service";
import { createMemoryProfileStore } from "../../src/product/receptionist/profile-store";
import type { PlanId } from "../../src/product/saas/entitlements";

const client = demoClientAccount({ id: "client_a", contractorDisplayName: "Nord Plomberie" });
const NUMBER = "+14385597100";
const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

/** A fully configured owner: every Receptionist Plus setting switched on. */
function fullSettings() {
  return profileSettingsSchema.parse({
    routing: [{ name: "Facturation", phoneE164: "+14385597002", keywords: ["facture"] }],
    emergencyTransferE164: "+14385597003",
    fallbackTransferE164: "+14385597004",
    notifyEmail: "owner@example.com",
    appointmentSettings: { phoneBooking: true },
  });
}

function profile(): ReceptionistProfile {
  return {
    organizationId: "org_a",
    phoneNumberE164: NUMBER,
    activated: true,
    settings: fullSettings(),
    updatedAt: new Date().toISOString(),
  };
}

describe("voice capabilities per plan", () => {
  it("Starter has no voice receptionist at all", () => {
    assert.deepEqual(voiceCapabilitiesForPlan("starter"), {
      voice: false,
      phoneBooking: false,
      transfer: false,
      emergencyRouting: false,
      transcripts: false,
    });
  });

  it("Growth answers calls but cannot book, transfer, bridge emergencies or keep transcripts", () => {
    assert.deepEqual(voiceCapabilitiesForPlan("growth"), {
      voice: true,
      phoneBooking: false,
      transfer: false,
      emergencyRouting: false,
      transcripts: false,
    });
    assert.deepEqual(unavailableVoiceSettings("growth"), [
      "phoneBooking",
      "transfer",
      "emergencyRouting",
    ]);
  });

  it("Receptionist Plus has the complete receptionist", () => {
    assert.deepEqual(voiceCapabilitiesForPlan("receptionist"), {
      voice: true,
      phoneBooking: true,
      transfer: true,
      emergencyRouting: true,
      transcripts: true,
    });
    assert.deepEqual(unavailableVoiceSettings("receptionist"), []);
  });
});

describe("the live receptionist config follows the plan", () => {
  it("Receptionist Plus keeps everything the owner configured", () => {
    const config = buildProfileConfig(profile(), {
      client,
      capabilities: voiceCapabilitiesForPlan("receptionist"),
    });
    assert.equal(config.phoneBooking, true);
    assert.equal(config.routing.length, 1);
    assert.equal(config.emergencyTransferE164, "+14385597003");
    assert.equal(config.fallbackTransferE164, "+14385597004");
    assert.notEqual(config.transcriptsEnabled, false);
  });

  it("Growth drops booking, transfers, departments and emergency bridging even if the owner saved them", () => {
    const config = buildProfileConfig(profile(), {
      client,
      capabilities: voiceCapabilitiesForPlan("growth"),
    });
    assert.equal(config.phoneBooking, false);
    assert.deepEqual(config.routing, []);
    assert.equal(config.fallbackTransferE164, undefined);
    assert.equal(config.emergencyTransferE164, undefined);
    assert.equal(config.allowVoicemailOnly, true);
    assert.equal(config.inboundStrategy, "ai_first");
    assert.equal(config.transcriptsEnabled, false);
    // The owner is still told about every call.
    assert.ok(config.notifications.length > 0);
  });

  it("the Growth prompt does not promise what the plan lacks", () => {
    const growth = buildProfileConfig(profile(), {
      client,
      capabilities: voiceCapabilitiesForPlan("growth"),
    });
    const plus = buildProfileConfig(profile(), {
      client,
      capabilities: voiceCapabilitiesForPlan("receptionist"),
    });
    assert.notEqual(growth.systemPrompt, plus.systemPrompt);
  });

  it("without capabilities (demo, ops tooling) nothing is limited", () => {
    const config = buildProfileConfig(profile(), { client });
    assert.equal(config.phoneBooking, true);
    assert.equal(config.routing.length, 1);
  });

  it("applyVoicePlanLimits is a backstop on an already-built config", () => {
    const built = buildProfileConfig(profile(), { client });
    const limited = applyVoicePlanLimits(built, voiceCapabilitiesForPlan("growth"));
    assert.equal(limited.phoneBooking, false);
    assert.deepEqual(limited.routing, []);
    assert.equal(limited.emergencyTransferE164, undefined);
    // Pure: the input is untouched.
    assert.equal(built.phoneBooking, true);
  });
});

describe("only plans with the voice receptionist answer the phone", () => {
  async function loaded(plan: PlanId) {
    const profiles = createMemoryProfileStore();
    await profiles.saveSettings("org_a", fullSettings(), "owner@example.com");
    await profiles.setActivation(
      "org_a",
      { phoneNumberE164: NUMBER, activated: true },
      "ops@example.com",
    );
    const skipped: string[] = [];
    const configs = await loadProfileConfigs({
      profiles,
      getOrganization: async () => ({
        id: "org_a",
        status: "active",
        plan,
        missedCallClientId: "client_a",
      }),
      getClient: async () => client,
      env,
      onSkip: (_org, reason) => skipped.push(reason),
    });
    return { configs, skipped };
  }

  it("Starter is skipped, with a reason ops can see", async () => {
    const { configs, skipped } = await loaded("starter");
    assert.equal(configs.length, 0);
    assert.deepEqual(skipped, ["plan_without_voice_receptionist"]);
  });

  it("Growth answers with the limited receptionist", async () => {
    const { configs } = await loaded("growth");
    assert.equal(configs.length, 1);
    assert.equal(configs[0]!.phoneBooking, false);
    assert.deepEqual(configs[0]!.routing, []);
  });

  it("Receptionist Plus answers with the complete receptionist", async () => {
    const { configs } = await loaded("receptionist");
    assert.equal(configs.length, 1);
    assert.equal(configs[0]!.phoneBooking, true);
    assert.equal(configs[0]!.routing.length, 1);
  });
});

describe("activation and settings are gated on the server", () => {
  function activationDeps(plan: PlanId) {
    const profiles = createMemoryProfileStore();
    return {
      profiles,
      getOrganization: async () => ({
        id: "org_a",
        missedCallClientId: "client_a" as string | null,
        plan,
      }),
      getClient: async () => client,
      refresh: async () => undefined,
      isAnswering: () => true,
      env,
    };
  }
  const activate = (plan: PlanId) =>
    activateProfile(activationDeps(plan), {
      organizationId: "org_a",
      phoneNumberE164: NUMBER,
      activated: true,
      actor: "ops@example.com",
    });

  it("refuses to switch the line on for Starter", async () => {
    const result = await activate("starter");
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "plan_upgrade_required");
    assert.equal(result.body.feature, "AI_RECEPTIONIST_VOICE");
  });

  it("switches the line on for Growth and Receptionist Plus", async () => {
    assert.equal((await activate("growth")).status, 200);
    assert.equal((await activate("receptionist")).status, 200);
  });

  it("always allows switching the line off", async () => {
    const result = await activateProfile(activationDeps("starter"), {
      organizationId: "org_a",
      phoneNumberE164: NUMBER,
      activated: false,
      actor: "ops@example.com",
    });
    assert.equal(result.status, 200);
  });

  function save(plan: PlanId, phoneBooking: boolean) {
    const deps = activationDeps(plan);
    return saveOwnerSettings(
      { ...deps, getClient: deps.getClient },
      {
        organization: { id: "org_a", missedCallClientId: "client_a", plan },
        role: "owner",
        userEmail: "owner@example.com",
        body: {
          notifyEmail: "owner@example.com",
          emergencyTransferE164: "+14385597003",
          fallbackTransferE164: "+14385597004",
          appointmentSettings: { phoneBooking },
        },
      },
    );
  }

  it("a Growth owner cannot switch on booking during the call", async () => {
    const result = await save("growth", true);
    assert.equal(result.status, 403);
    assert.equal(result.body.feature, "AI_PHONE_BOOKING");
  });

  it("a Growth owner can still save the rest of their settings", async () => {
    assert.equal((await save("growth", false)).status, 200);
  });

  it("a Receptionist Plus owner can switch on booking during the call", async () => {
    assert.equal((await save("receptionist", true)).status, 200);
  });
});
