import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/receptionist/agent-config/route";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { inactiveLineNotice } from "../../src/product/receptionist/inactive-line";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import {
  buildProfileConfig,
  defaultProfileSettings,
  profileSettingsSchema,
} from "../../src/product/receptionist/profile";
import { createMemoryProfileStore } from "../../src/product/receptionist/profile-store";
import {
  ownerToggleActivation,
  type ActivateDeps,
} from "../../src/product/receptionist/profile-service";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";

const NUMBER = "+14385597100";
const ORG = "org_toggle";
const client = demoClientAccount({
  id: "client_toggle",
  contractorDisplayName: "Nord Plomberie",
});

function harness(opts: { answeringAfterRefresh?: boolean } = {}) {
  const profiles = createMemoryProfileStore();
  const calls: string[] = [];
  const deps: ActivateDeps & {
    getOrgPhone?(id: string): Promise<string | null | undefined>;
  } = {
    profiles,
    // Deactivation must never need these; they fail loudly if it does.
    getOrganization: async () => {
      calls.push("getOrganization");
      return { id: ORG, missedCallClientId: client.id };
    },
    getClient: async () => {
      calls.push("getClient");
      return client;
    },
    refresh: async () => void calls.push("refresh"),
    isAnswering: () => opts.answeringAfterRefresh ?? false,
  };
  const toggle = (
    activated: boolean,
    over: Partial<Parameters<typeof ownerToggleActivation>[1]> = {},
  ) =>
    ownerToggleActivation(deps, {
      organization: { id: ORG, missedCallClientId: client.id },
      role: "owner",
      userEmail: "owner@example.com",
      activated,
      ...over,
    });
  return { profiles, calls, toggle };
}

describe("owner switches the receptionist off", () => {
  it("persists activated=false, keeps the number and settings, and confirms what is true", async () => {
    const h = harness();
    const settings = profileSettingsSchema.parse({
      knowledge: { companyName: "Nord Plomberie" },
      receptionistName: "Lucie",
    });
    await h.profiles.saveSettings(ORG, settings, "owner@example.com");
    await h.profiles.setActivation(
      ORG,
      { phoneNumberE164: NUMBER, activated: true },
      "founder",
    );

    const off = await h.toggle(false);

    assert.equal(off.status, 200);
    assert.equal(off.body.ok, true);
    assert.equal(off.body.activated, false);
    assert.equal(off.body.changed, true);
    assert.equal(off.body.answering, false);
    assert.equal(off.body.phoneNumberE164, NUMBER);
    const stored = await h.profiles.getProfile(ORG);
    assert.equal(stored?.activated, false);
    assert.equal(stored?.phoneNumberE164, NUMBER, "the number is not touched");
    assert.equal(stored?.settings.receptionistName, "Lucie", "settings are kept");
    assert.deepEqual(await h.profiles.listActivatedProfiles(), []);
    assert.ok(h.calls.includes("refresh"), "this server stops answering at once");
  });

  it("does not need a linked client or an activation check, and invents no phone number", async () => {
    const h = harness();
    // An organization that never had a profile: nothing to switch off.
    const result = await h.toggle(false, {
      organization: { id: ORG, missedCallClientId: null },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.changed, false);
    assert.equal(result.body.phoneNumberE164, null);
    assert.equal(await h.profiles.getProfile(ORG), null, "no row, no made-up number");
    assert.deepEqual(h.calls, [], "no client, organization or plan lookup was needed");
  });

  it("is safe to repeat: the second request changes nothing", async () => {
    const h = harness();
    await h.profiles.setActivation(
      ORG,
      { phoneNumberE164: NUMBER, activated: true },
      "founder",
    );
    const first = await h.toggle(false);
    const stamp = (await h.profiles.getProfile(ORG))?.updatedAt;
    const second = await h.toggle(false);
    assert.equal(first.body.changed, true);
    assert.equal(second.status, 200);
    assert.equal(second.body.changed, false);
    assert.equal((await h.profiles.getProfile(ORG))?.updatedAt, stamp);
  });

  it("refuses a member and reports an error, never success, when the line is still answering", async () => {
    const member = harness();
    await member.profiles.setActivation(
      ORG,
      { phoneNumberE164: NUMBER, activated: true },
      "founder",
    );
    const denied = await member.toggle(false, { role: "member" });
    assert.equal(denied.status, 403);
    assert.equal((await member.profiles.getProfile(ORG))?.activated, true);

    const stuck = harness({ answeringAfterRefresh: true });
    await stuck.profiles.setActivation(
      ORG,
      { phoneNumberE164: NUMBER, activated: true },
      "founder",
    );
    const failed = await stuck.toggle(false);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.ok, undefined, "no success before the backend can confirm it");
  });

  it("reactivating restores the same number and reports success", async () => {
    const h = harness();
    await h.profiles.setActivation(
      ORG,
      { phoneNumberE164: NUMBER, activated: true },
      "founder",
    );
    await h.toggle(false);
    // activation re-checks the profile, so give the deps a live line afterwards
    const again = await ownerToggleActivation(
      {
        profiles: h.profiles,
        getOrganization: async () => ({ id: ORG, missedCallClientId: client.id }),
        getClient: async () => client,
        refresh: async () => undefined,
        isAnswering: () => true,
      },
      {
        organization: { id: ORG, missedCallClientId: client.id },
        role: "owner",
        userEmail: "owner@example.com",
        activated: true,
      },
    );
    assert.equal(again.status, 200);
    assert.equal(again.body.activated, true);
    assert.equal(again.body.changed, true);
    assert.equal(again.body.phoneNumberE164, NUMBER);
  });
});

describe("a switched-off line is not answered by a stale copy", () => {
  function activeConfig() {
    return buildProfileConfig(
      {
        organizationId: ORG,
        phoneNumberE164: NUMBER,
        activated: true,
        settings: defaultProfileSettings(),
        updatedAt: new Date().toISOString(),
      },
      { client },
    );
  }
  const engineWith = (confirmActive?: (c: unknown) => Promise<boolean>) =>
    createReceptionistEngine({
      store: createMemoryReceptionistStore(),
      // The cached profile set still lists the line as active.
      configs: () => [{ ...activeConfig(), source: "profile" as const }],
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
      clock: { now: () => new Date("2026-03-04T15:00:00Z") },
      confirmActive: confirmActive as never,
    });

  it("answers normally while the database says it is on", async () => {
    const plan = await engineWith(async () => true).startCall({
      callSid: "CA_on",
      fromE164: "+15145559876",
      toE164: NUMBER,
    });
    assert.ok(plan.sessionId, "a conversation was started");
  });

  it("starts no conversation, greeting or data collection once the database says it is off", async () => {
    const plan = await engineWith(async () => false).startCall({
      callSid: "CA_off",
      fromE164: "+15145559876",
      toE164: NUMBER,
    });
    assert.equal(plan.sessionId, null, "no session, so nothing is collected");
    const spoken = plan.verbs
      .filter((v) => v.verb === "say")
      .map((v) => ("text" in v ? v.text : ""))
      .join(" ");
    assert.doesNotMatch(spoken, /technical issue|problème technique/i, "not a fake malfunction");
    assert.ok(
      !plan.verbs.some((v) => v.verb === "gather" || v.verb === "sip_handoff"),
      "no listening and no hand-off to the voice agent",
    );
    assert.ok(
      !plan.verbs.some((v) => v.verb === "dial"),
      "no number is invented or dialed",
    );
    assert.ok(
      plan.verbs.some((v) => v.verb === "record"),
      "the existing voicemail handling takes over",
    );
  });
});

describe("agent-config for a switched-off line (LiveKit path)", () => {
  const SECRET = "s3cret-s3cret";
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.MISSED_CALL_OPS_SECRET = SECRET;
    delete process.env.RECEPTIONIST_CONFIG_JSON;
    resetReceptionistRuntimeForTests();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetReceptionistRuntimeForTests();
  });
  const get = (number: string) =>
    GET(
      new NextRequest(
        `http://localhost/api/receptionist/agent-config?number=${encodeURIComponent(number)}`,
        { headers: { authorization: `Bearer ${SECRET}` } },
      ),
    );

  it("says not to answer, with a fixed notice, and sends no config", async () => {
    const runtime = getReceptionistRuntime();
    await runtime.profileStore.saveSettings(
      ORG,
      profileSettingsSchema.parse({
        knowledge: { companyName: "Nord Plomberie" },
        languages: ["fr", "en"],
        defaultLanguage: "fr",
      }),
      "owner@example.com",
    );
    await runtime.profileStore.setActivation(
      ORG,
      { phoneNumberE164: NUMBER, activated: true },
      "founder",
    );
    await runtime.profileStore.deactivate(ORG, "owner@example.com");

    const res = await get(NUMBER);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      answering?: boolean;
      reason?: string;
      config?: unknown;
      callerPolicy: {
        kind: string;
        messages: { lang: string; text: string }[];
      };
    };
    assert.equal(body.answering, false);
    assert.equal(body.reason, "deactivated");
    assert.equal(body.config, undefined, "no prompt, no transfer line, nothing to converse with");
    assert.equal(body.callerPolicy.kind, "receptionist_off");
    assert.deepEqual(
      body.callerPolicy.messages.map((m: { lang: string }) => m.lang),
      ["fr", "en"],
    );
    assert.match(body.callerPolicy.messages[0].text, /Nord Plomberie/);
    assert.ok(!JSON.stringify(body).includes("+1"), "no phone number appears in the answer");
  });

  it("still answers 404 for a number no business owns", async () => {
    const res = await get("+14385550999");
    assert.equal(res.status, 404);
  });
});

describe("notice wording", () => {
  it("puts the default language first and strips markup from the business name", () => {
    const lines = inactiveLineNotice({
      businessName: "  Nord <b>Plomberie</b> {x} ",
      languages: ["fr", "en"],
      defaultLanguage: "en",
    });
    assert.deepEqual(lines.map((l) => l.lang), ["en", "fr"]);
    assert.doesNotMatch(lines[0]!.text, /[<>{}]/);
    assert.match(lines[0]!.text, /Nord bPlomberie\/b x/);
  });

  it("works without a business name and for a one-language line", () => {
    const [only] = inactiveLineNotice({ businessName: "", languages: ["en"] });
    assert.equal(only!.lang, "en");
    assert.doesNotMatch(only!.text, /reached\s*\./);
  });
});
