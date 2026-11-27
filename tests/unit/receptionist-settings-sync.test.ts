import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { buildAgentConfig } from "../../src/product/receptionist/agent-config";
import { patchAiReceptionistSettings } from "../../src/product/receptionist/ai-receptionist-service";
import {
  buildProfileConfig,
  profileSettingsSchema,
  type ProfileSettings,
} from "../../src/product/receptionist/profile";
import { createMemoryProfileStore } from "../../src/product/receptionist/profile-store";
import { saveOwnerSettings } from "../../src/product/receptionist/profile-service";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";

/**
 * Every setting an owner edits on the receptionist page must change what the
 * voice agent receives (or what the server does on the call). These cases were
 * saved and shown back in the dashboard but never reached the live agent.
 */

const client = demoClientAccount({
  id: "client_sync",
  contractorDisplayName: "Nord Plomberie",
});
const ORG = "org_sync";
// 2026-10-28 is a Wednesday, 11:00 in Toronto: open.
const OPEN = new Date("2026-10-28T15:00:00Z");

function agentFor(settings: Record<string, unknown>) {
  const config = buildProfileConfig(
    {
      organizationId: ORG,
      phoneNumberE164: "+14385597100",
      activated: true,
      settings: profileSettingsSchema.parse({
        knowledge: { companyName: "Nord Plomberie" },
        fallbackTransferE164: "+14389957350",
        ...settings,
      }),
      updatedAt: "2026-11-26T00:00:00Z",
    },
    { client },
  );
  return buildAgentConfig(config, OPEN);
}

const TRANSFER = {
  primaryTransferE164: "+14389957350",
  conditions: ["caller_request"],
  transferHours: "always",
  timeoutSeconds: 30,
  failedAction: "take_message",
};

describe("owner settings reach the voice agent", () => {
  it("the personality and communication style shape the instructions", () => {
    const out = agentFor({
      communicationStyle: "brief",
      personality: "Calm and reassuring with older callers.",
    });
    assert.match(out.instructions, /HOW THIS BUSINESS WANTS YOU TO SOUND/);
    assert.match(out.instructions, /Calm and reassuring with older callers\./);
  });

  it("the transfer timeout becomes the agent's ring time", () => {
    const out = agentFor({ transferSettings: { ...TRANSFER, timeoutSeconds: 45 } });
    assert.equal(out.transferRingSeconds, 45);
  });

  it("the failed-transfer choice changes what the agent does after no answer", () => {
    const message = agentFor({ transferSettings: TRANSFER }).instructions;
    const urgent = agentFor({
      transferSettings: { ...TRANSFER, failedAction: "urgent_lead" },
    }).instructions;
    const voicemail = agentFor({
      transferSettings: { ...TRANSFER, failedAction: "voicemail" },
    }).instructions;
    assert.match(message, /not answered: take a message/);
    assert.match(urgent, /not answered: .*urgent/);
    assert.match(voicemail, /not answered: offer to take a detailed message/);
  });

  it("turning off 'ask for a preferred time' stops the agent asking", () => {
    const asks = agentFor({}).instructions;
    const quiet = agentFor({ collectPreferredTime: false }).instructions;
    assert.match(asks, /4\. The appointment\. Always/);
    assert.match(quiet, /does not want callers asked for a day or time: do not ask/);
  });
});

describe("saving does not undo another page's settings", () => {
  const base = (over: Partial<ProfileSettings> = {}) =>
    profileSettingsSchema.parse({
      knowledge: { companyName: "Nord Plomberie" },
      ...over,
    });

  it("a transfer number saved on the receptionist page is the one dialed, even after the phone page set another", async () => {
    const profiles = createMemoryProfileStore();
    await profiles.saveSettings(
      ORG,
      base({
        phoneSettings: {
          ...base().phoneSettings,
          humanTransferE164: "+14389957399",
        },
        transferSettings: {
          ...base().transferSettings,
          primaryTransferE164: "+14389957399",
        },
      }),
      "owner@example.com",
    );

    const res = await patchAiReceptionistSettings(profiles, {
      organizationId: ORG,
      client,
      role: "owner",
      userEmail: "owner@example.com",
      body: {
        fallbackTransferE164: "+14389957350",
        transferSettings: {
          ...TRANSFER,
          primaryTransferE164: "+14389957350",
          secondaryTransferE164: "+14389957351",
        },
      },
    });
    assert.equal(res.ok, true);
    const saved = (await profiles.getProfile(ORG))!;
    assert.equal(saved.settings.phoneSettings.humanTransferE164, "+14389957350");
    assert.equal(saved.settings.phoneSettings.backupTransferE164, "+14389957351");

    const out = buildAgentConfig(
      buildProfileConfig({ ...saved, phoneNumberE164: "+14385597100" }, { client }),
      OPEN,
    );
    assert.equal(out.transferE164, "+14389957350");
    assert.equal(out.backupTransferE164, "+14389957351");
  });

  it("a business-hours transfer rule set elsewhere survives a receptionist save that sends it back", async () => {
    const profiles = createMemoryProfileStore();
    await profiles.saveSettings(
      ORG,
      base({
        transferSettings: { ...base().transferSettings, transferHours: "business_hours" },
      }),
      "owner@example.com",
    );
    const res = await patchAiReceptionistSettings(profiles, {
      organizationId: ORG,
      client,
      role: "owner",
      userEmail: "owner@example.com",
      body: {
        transferSettings: { ...TRANSFER, transferHours: "business_hours" },
      },
    });
    assert.equal(res.ok, true);
    const saved = (await profiles.getProfile(ORG))!;
    assert.equal(saved.settings.transferSettings.transferHours, "business_hours");
  });

  it("the full-settings save keeps the phone settings it does not send", async () => {
    const profiles = createMemoryProfileStore();
    await profiles.saveSettings(
      ORG,
      base({
        voiceFr: "fr-custom-voice",
        phoneSettings: {
          ...base().phoneSettings,
          humanTransferE164: "+14389957350",
          humanRingTimeoutSeconds: 40,
        },
      }),
      "owner@example.com",
    );
    const res = await saveOwnerSettings(
      {
        profiles,
        getClient: async () => client,
        refresh: async () => {},
      },
      {
        organization: { id: ORG, missedCallClientId: client.id },
        role: "owner",
        userEmail: "owner@example.com",
        body: { receptionistName: "Camille", knowledge: { companyName: "Nord Plomberie" } },
      },
    );
    assert.equal(res.status, 200);
    const saved = (await profiles.getProfile(ORG))!;
    assert.equal(saved.settings.receptionistName, "Camille");
    assert.equal(saved.settings.voiceFr, "fr-custom-voice");
    assert.equal(saved.settings.phoneSettings.humanTransferE164, "+14389957350");
    assert.equal(saved.settings.phoneSettings.humanRingTimeoutSeconds, 40);
  });
});

describe("a profile saved after this instance loaded it", () => {
  afterEach(() => resetReceptionistRuntimeForTests());

  it("is reported stale so the call is built from the saved version", async () => {
    resetReceptionistRuntimeForTests();
    const runtime = getReceptionistRuntime();
    await runtime.profileStore.saveSettings(ORG, base(), "owner@example.com");
    await runtime.profileStore.setActivation(
      ORG,
      { phoneNumberE164: "+14385597100", activated: true },
      "founder",
    );
    const config = { id: `rc_org_${ORG}`, source: "profile" } as ReceptionistConfig;
    const state = await runtime.lineState(config);
    assert.equal(state.active, true);
    assert.equal(state.stale, true, "never loaded on this instance");

    const env = { id: "rc_env", source: "env" } as unknown as ReceptionistConfig;
    assert.deepEqual(await runtime.lineState(env), { active: true, stale: false });
  });

  function base() {
    return profileSettingsSchema.parse({ knowledge: { companyName: "Nord Plomberie" } });
  }
});
