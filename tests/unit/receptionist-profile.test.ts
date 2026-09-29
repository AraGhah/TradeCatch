import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import {
  buildProfileConfig,
  defaultProfileSettings,
  isSafeTransferNumber,
  profileSettingsSchema,
  validateProfile,
  type ReceptionistProfile,
} from "../../src/product/receptionist/profile";
import { loadProfileConfigs } from "../../src/product/receptionist/profile-loader";
import {
  createMemoryProfileStore,
  ProfileConflictError,
} from "../../src/product/receptionist/profile-store";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

const client = demoClientAccount({ id: "client_a", contractorDisplayName: "Nord Plomberie" });
const MTL = "+14385597001"; // Canadian (438), non-555
const NUMBER = "+14385597100";

function settings(over: Record<string, unknown> = {}) {
  return profileSettingsSchema.parse({
    routing: [{ name: "Facturation", phoneE164: "+14385597002", keywords: ["facture"] }],
    faqs: [{ keywords: ["heures"], answerFr: "8 h à 17 h.", answerEn: "8 to 5." }],
    emergencyTransferE164: "+14385597003",
    fallbackTransferE164: "+14385597004",
    notifyEmail: "owner@example.com",
    ...over,
  });
}

function profile(over: Partial<ReceptionistProfile> = {}): ReceptionistProfile {
  return {
    organizationId: "org_a",
    phoneNumberE164: NUMBER,
    activated: true,
    settings: settings(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("toll-fraud guard on dial targets", () => {
  it("accepts Canadian geographic numbers only", () => {
    assert.equal(isSafeTransferNumber("+14385597001"), true);
    assert.equal(isSafeTransferNumber("+15145559876"), true);
    assert.equal(isSafeTransferNumber("+19005551234"), false, "premium 900");
    assert.equal(isSafeTransferNumber("+19765551234"), false, "premium 976");
    assert.equal(isSafeTransferNumber("+18765551234"), false, "Caribbean +1 area code");
    assert.equal(isSafeTransferNumber("+442071234567"), false, "international");
    assert.equal(isSafeTransferNumber("+15149110000"), false, "N11 exchange");
    assert.equal(isSafeTransferNumber("5145559876"), false, "not E.164");
    assert.equal(isSafeTransferNumber("+1514555987"), false, "too short");
  });

  it("rejects unsafe numbers in every dial field", () => {
    for (const field of ["emergencyTransferE164", "fallbackTransferE164", "notifySmsE164"]) {
      const r = profileSettingsSchema.safeParse({ [field]: "+19005551234" });
      assert.equal(r.success, false, field);
    }
    const routing = profileSettingsSchema.safeParse({
      routing: [{ name: "Premium", phoneE164: "+19765551234", keywords: [] }],
    });
    assert.equal(routing.success, false);
  });

  it("turns blank optional fields into undefined and enforces size limits", () => {
    const s = profileSettingsSchema.parse({ greetingFr: "", notifyEmail: "", emergencyTransferE164: "" });
    assert.equal(s.greetingFr, undefined);
    assert.equal(s.notifyEmail, undefined);
    assert.equal(s.emergencyTransferE164, undefined);
    assert.equal(profileSettingsSchema.safeParse({ greetingFr: "x".repeat(401) }).success, false);
    assert.equal(
      profileSettingsSchema.safeParse({
        routing: Array.from({ length: 9 }, (_, i) => ({ name: `d${i}`, phoneE164: MTL, keywords: [] })),
      }).success,
      false,
    );
  });
});

describe("profile → receptionist config", () => {
  it("fills business identity and safe fallbacks from the linked client", () => {
    const config = buildProfileConfig(profile(), { client });
    assert.equal(config.id, "rc_org_org_a");
    assert.equal(config.source, "profile");
    assert.equal(config.businessName, "Nord Plomberie");
    assert.equal(config.clientAccountId, "client_a");
    assert.equal(config.phoneNumberE164, NUMBER);
    assert.deepEqual(config.businessHours, client.businessHours);
    assert.equal(config.routing[0]!.id, "facturation-1");
    assert.match(config.greetingFr, /Nord Plomberie/);
    assert.ok(config.urgencyRubric.length > 0);
  });

  it("applies owner edits", () => {
    const config = buildProfileConfig(
      profile({
        settings: settings({
          greetingFr: "Allô, Nord Plomberie!",
          businessHours: { start: "07:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] },
          languages: ["fr"],
          defaultLanguage: "fr",
          collectPreferredTime: false,
        }),
      }),
      { client },
    );
    assert.equal(config.greetingFr, "Allô, Nord Plomberie!");
    assert.deepEqual(config.businessHours, { start: "07:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] });
    assert.deepEqual(config.languages, ["fr"]);
    assert.equal(config.collectPreferredTime, false);
    assert.deepEqual(config.notifications[0], { type: "email", to: "owner@example.com" });
  });

  it("blocks transfer loops and duplicate departments at save time", () => {
    const loop = validateProfile(
      profile({ settings: settings({ emergencyTransferE164: NUMBER }) }),
      { client },
    );
    assert.equal(loop.ok, false);
    if (!loop.ok) assert.match(loop.issues[0]!.message, /transfer loop/);

    const dup = validateProfile(
      profile({
        settings: settings({
          routing: [
            { name: "Ventes", phoneE164: "+14385597010", keywords: [] },
            { name: "ventes", phoneE164: "+14385597011", keywords: [] },
          ],
        }),
      }),
      { client },
    );
    assert.equal(dup.ok, false);
  });

  it("applies the production checks (reserved demo numbers) only in production", () => {
    const demo = profile({ settings: settings({ notifyEmail: "owner@example.com" }), phoneNumberE164: "+15145550100" });
    assert.equal(validateProfile(demo, { client, env: { NODE_ENV: "development" } }).ok, true);
    const prod = validateProfile(demo, { client, env: { NODE_ENV: "production" } });
    assert.equal(prod.ok, false);
  });
});

describe("profile store", () => {
  it("creates an inactive profile on owner save and keeps ops fields intact", async () => {
    const store = createMemoryProfileStore();
    const saved = await store.saveSettings("org_a", settings(), "owner@example.com");
    assert.equal(saved.activated, false);
    assert.equal(saved.phoneNumberE164, undefined);
    assert.deepEqual(await store.listActivatedProfiles(), []);

    await store.setActivation("org_a", { phoneNumberE164: NUMBER, activated: true }, "ops");
    const edited = await store.saveSettings("org_a", settings({ personality: "Chaleureuse" }), "owner@example.com");
    assert.equal(edited.activated, true, "an owner edit never changes activation");
    assert.equal(edited.phoneNumberE164, NUMBER);
    assert.equal((await store.listActivatedProfiles()).length, 1);
  });

  it("refuses the same number for two organizations", async () => {
    const store = createMemoryProfileStore();
    await store.setActivation("org_a", { phoneNumberE164: NUMBER, activated: true }, "ops");
    await assert.rejects(
      () => store.setActivation("org_b", { phoneNumberE164: NUMBER, activated: true }, "ops"),
      ProfileConflictError,
    );
    await store.setActivation("org_a", { phoneNumberE164: NUMBER, activated: false }, "ops");
    await store.setActivation("org_b", { phoneNumberE164: NUMBER, activated: true }, "ops");
  });
});

describe("profile loader + multi-tenant call routing", () => {
  const orgs: Record<string, { id: string; status: string; missedCallClientId: string | null }> = {
    org_a: { id: "org_a", status: "active", missedCallClientId: "client_a" },
    org_b: { id: "org_b", status: "active", missedCallClientId: "client_b" },
    org_off: { id: "org_off", status: "suspended", missedCallClientId: "client_a" },
    org_unlinked: { id: "org_unlinked", status: "active", missedCallClientId: null },
  };
  const clients: Record<string, typeof client> = {
    client_a: client,
    client_b: demoClientAccount({ id: "client_b", contractorDisplayName: "Boréal Toiture" }),
  };

  async function load(store = createMemoryProfileStore()) {
    const skipped: string[] = [];
    const configs = await loadProfileConfigs({
      profiles: store,
      getOrganization: async (id) => orgs[id] ?? null,
      getClient: async (id) => clients[id] ?? null,
      env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
      onSkip: (org, reason) => skipped.push(`${org}:${reason.split(":")[0]}`),
    });
    return { store, configs, skipped };
  }

  it("loads activated profiles and skips suspended, unlinked and unknown orgs", async () => {
    const store = createMemoryProfileStore();
    for (const [org, num] of [["org_a", "+14385597100"], ["org_b", "+14385597200"], ["org_off", "+14385597300"], ["org_unlinked", "+14385597400"], ["org_ghost", "+14385597500"]] as const) {
      await store.saveSettings(org, settings(), "t");
      await store.setActivation(org, { phoneNumberE164: num, activated: true }, "ops");
    }
    await store.saveSettings("org_inactive", settings(), "t");

    const { configs, skipped } = await load(store);
    assert.deepEqual(configs.map((c) => c.id).sort(), ["rc_org_org_a", "rc_org_org_b"]);
    assert.deepEqual(skipped.sort(), [
      "org_ghost:organization_inactive",
      "org_off:organization_inactive",
      "org_unlinked:organization_not_linked_to_client",
    ]);
  });

  it("routes each number to its own business and never answers an unknown number", async () => {
    const store = createMemoryProfileStore();
    await store.saveSettings("org_a", settings(), "t");
    await store.setActivation("org_a", { phoneNumberE164: "+14385597100", activated: true }, "ops");
    await store.saveSettings("org_b", settings(), "t");
    await store.setActivation("org_b", { phoneNumberE164: "+14385597200", activated: true }, "ops");
    const { configs } = await load(store);

    const sessions = createMemoryReceptionistStore();
    const engine = createReceptionistEngine({
      store: sessions,
      configs: () => configs,
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
      clock: { now: () => new Date("2026-03-04T15:00:00Z") },
    });

    const a = await engine.startCall({ callSid: "CA_a", fromE164: "+15145559876", toE164: "+14385597100" });
    const b = await engine.startCall({ callSid: "CA_b", fromE164: "+15145559876", toE164: "+14385597200" });
    const says = (p: typeof a) =>
      p.verbs.flatMap((v) => (v.verb === "gather" ? v.prompts.map((x) => x.text) : [])).join(" ");
    assert.match(says(a), /Nord Plomberie/);
    assert.match(says(b), /Boréal Toiture/);
    assert.equal((await sessions.getSessionByCallSid("CA_a"))!.clientAccountId, "client_a");
    assert.equal((await sessions.getSessionByCallSid("CA_b"))!.clientAccountId, "client_b");

    // Even with a single tenant profile, a different number is NOT answered as that business.
    const only = createReceptionistEngine({
      store: createMemoryReceptionistStore(),
      configs: () => [configs[0]!],
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
    });
    assert.equal(only.resolveConfig("+14385599999"), null);
    assert.equal(only.resolveConfig("+14385597100")?.id, "rc_org_org_a");
  });

  it("keeps the founder single-profile fallback for env configs", () => {
    const envConfig = { ...buildProfileConfig(profile(), { client }), source: "env" as const };
    const engine = createReceptionistEngine({
      store: createMemoryReceptionistStore(),
      configs: () => [envConfig],
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
    });
    assert.equal(engine.resolveConfig("+14385599999")?.id, envConfig.id);
  });

  it("defaults are valid on their own", () => {
    assert.doesNotThrow(() => defaultProfileSettings());
    assert.equal(validateProfile(profile({ settings: defaultProfileSettings() }), { client }).ok, true);
  });
});

import {
  activateProfile,
  saveOwnerSettings,
} from "../../src/product/receptionist/profile-service";

describe("owner + ops profile service (end to end)", () => {
  const org = { id: "org_a", missedCallClientId: "client_a" as string | null };
  const body = {
    greetingFr: "Allô, ici Nord Plomberie!",
    routing: [{ name: "Facturation", phoneE164: "+14385597002", keywords: ["facture"] }],
    emergencyTransferE164: "+14385597003",
    fallbackTransferE164: "+14385597004",
    notifyEmail: "owner@example.com",
  };
  const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

  function harness() {
    const profiles = createMemoryProfileStore();
    let configs: Awaited<ReturnType<typeof loadProfileConfigs>> = [];
    const refreshes: boolean[] = [];
    const timeline: string[] = [];
    const orgs: Record<string, { id: string; status: string; missedCallClientId: string | null }> = {
      org_a: { id: "org_a", status: "active", missedCallClientId: "client_a" },
      org_b: { id: "org_b", status: "active", missedCallClientId: "client_a" },
      org_unlinked: { id: "org_unlinked", status: "active", missedCallClientId: null },
    };
    const getClient = async (id: string) => (id === "client_a" ? client : null);
    const refresh = async (force: boolean) => {
      refreshes.push(force);
      configs = await loadProfileConfigs({
        profiles,
        getOrganization: async (id) => orgs[id] ?? null,
        getClient,
        env,
      });
    };
    return {
      profiles,
      refreshes,
      timeline,
      configs: () => configs,
      save: (over: Partial<Parameters<typeof saveOwnerSettings>[1]> = {}) =>
        saveOwnerSettings(
          {
            profiles,
            getClient,
            refresh,
            env,
            addTimeline: async ({ actor }) => void timeline.push(actor),
          },
          { organization: org, role: "owner", userEmail: "owner@example.com", body, ...over },
        ),
      activate: (over: Partial<Parameters<typeof activateProfile>[1]> = {}) =>
        activateProfile(
          {
            profiles,
            getOrganization: async (id) => orgs[id] ?? null,
            getClient,
            refresh,
            isAnswering: (id) => configs.some((c) => c.id === `rc_org_${id}`),
            env,
          },
          { organizationId: "org_a", phoneNumberE164: NUMBER, activated: true, actor: "founder", ...over },
        ),
    };
  }

  it("owner saves edits; nothing answers until the founder activates; then the edited greeting is used on real calls", async () => {
    const h = harness();

    const saved = await h.save();
    assert.equal(saved.status, 200);
    assert.equal(saved.body.activated, false);
    assert.deepEqual(h.timeline, ["owner@example.com"]);
    assert.deepEqual(h.refreshes, [true]);
    assert.equal(h.configs().length, 0, "saved but not active: no call is answered");

    const on = await h.activate();
    assert.equal(on.status, 200);
    assert.equal(on.body.answering, true);
    assert.equal(h.configs().length, 1);

    // A real inbound call to that number now uses the owner's greeting.
    const engine = createReceptionistEngine({
      store: createMemoryReceptionistStore(),
      configs: () => h.configs(),
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
      clock: { now: () => new Date("2026-03-04T15:00:00Z") },
    });
    const plan = await engine.startCall({ callSid: "CA_x", fromE164: "+15145559876", toE164: NUMBER });
    const spoken = plan.verbs.flatMap((v) => (v.verb === "gather" ? v.prompts.map((p) => p.text) : [])).join(" ");
    assert.match(spoken, /Allô, ici Nord Plomberie!/);

    // An owner edit later never changes the number or the activation.
    const edited = await h.save({ body: { ...body, greetingFr: "Bonjour!" } });
    assert.equal(edited.body.activated, true);
    assert.equal(h.configs()[0]!.phoneNumberE164, NUMBER);
    assert.equal(h.configs()[0]!.greetingFr, "Bonjour!");

    const off = await h.activate({ activated: false });
    assert.equal(off.body.answering, false);
    assert.equal(h.configs().length, 0);
  });

  it("enforces roles, validation, linked client and ignores ops fields in the owner payload", async () => {
    const h = harness();
    assert.equal((await h.save({ role: "member" })).status, 403);
    assert.equal((await h.profiles.getProfile("org_a")), null, "a rejected save writes nothing");

    const bad = await h.save({ body: { ...body, emergencyTransferE164: "+19005551234" } });
    assert.equal(bad.status, 400);
    assert.match(JSON.stringify(bad.body.issues), /Canadian/);
    assert.equal((await h.save({ body: { languages: [] } })).status, 400);
    assert.equal((await h.save({ organization: { id: "org_unlinked", missedCallClientId: null } })).status, 409);

    // Trying to smuggle activation / number through the owner API has no effect.
    const sneaky = await h.save({ body: { ...body, activated: true, phoneNumberE164: "+14385597999" } });
    assert.equal(sneaky.status, 200);
    const stored = (await h.profiles.getProfile("org_a"))!;
    assert.equal(stored.activated, false);
    assert.equal(stored.phoneNumberE164, undefined);
  });

  it("ops activation is guarded: unknown/unlinked orgs, transfer loops, and a number already in use", async () => {
    const h = harness();
    assert.equal((await h.activate({ organizationId: "org_ghost" })).status, 404);
    assert.equal((await h.activate({ organizationId: "org_unlinked" })).status, 409);

    await h.save({ body: { ...body, emergencyTransferE164: NUMBER } });
    const loop = await h.activate();
    assert.equal(loop.status, 400);
    assert.match(JSON.stringify(loop.body.issues), /transfer loop/);

    await h.save();
    assert.equal((await h.activate()).status, 200);
    const taken = await h.activate({ organizationId: "org_b" });
    assert.equal(taken.status, 409);
    assert.match(String(taken.body.error), /already answered/);
  });
});

describe("conflict detection survives duplicated module copies", () => {
  it("recognizes errors by name, not only by class identity", async () => {
    const { isProfileConflict } = await import("../../src/product/receptionist/profile-store");
    const { isConflictError } = await import("../../src/product/receptionist/store");
    const foreignProfile = Object.assign(new Error("x"), { name: "ProfileConflictError" });
    const foreignSession = Object.assign(new Error("x"), { name: "ReceptionistConflictError" });
    assert.equal(isProfileConflict(foreignProfile), true);
    assert.equal(isConflictError(foreignSession), true);
    assert.equal(isProfileConflict(new Error("boom")), false);
    assert.equal(isConflictError("not an error"), false);
    assert.equal(isConflictError(foreignProfile), false, "the two conflict kinds stay distinct");
  });
});
