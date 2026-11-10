import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  profileSettingsSchema,
  type ReceptionistProfile,
} from "../../src/product/receptionist/profile";
import { loadProfileConfigs } from "../../src/product/receptionist/profile-loader";
import type { ProfileStore } from "../../src/product/receptionist/profile-store";

const client = demoClientAccount({ id: "client_a", contractorDisplayName: "Nord Plomberie" });
const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

function profile(organizationId: string, phoneNumberE164: string): ReceptionistProfile {
  return {
    organizationId,
    phoneNumberE164,
    activated: true,
    settings: profileSettingsSchema.parse({
      routing: [{ name: "Facturation", phoneE164: "+14385597002", keywords: ["facture"] }],
      emergencyTransferE164: "+14385597003",
      fallbackTransferE164: "+14385597004",
      notifyEmail: "owner@example.com",
    }),
    updatedAt: new Date().toISOString(),
  };
}

const storeOf = (profiles: ReceptionistProfile[]) =>
  ({ listActivatedProfiles: async () => profiles }) as unknown as ProfileStore;

const org = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "active",
  plan: "receptionist" as const,
  missedCallClientId: "client_a" as string | null,
  ...over,
});

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("profile loader", () => {
  it("looks organizations up side by side, not one after another", async () => {
    const profiles = [0, 1, 2, 3].map((i) => profile(`o${i}`, `+1438559710${i}`));
    let running = 0;
    let peak = 0;
    const configs = await loadProfileConfigs({
      profiles: storeOf(profiles),
      getOrganization: async (id) => {
        running += 1;
        peak = Math.max(peak, running);
        await later(15);
        running -= 1;
        return org(id);
      },
      getClient: async () => client,
      env,
    });
    assert.equal(configs.length, 4);
    assert.ok(peak > 1, `lookups overlapped (peak ${peak})`);
  });

  it("never runs more than a handful of lookups at once", async () => {
    const profiles = Array.from({ length: 40 }, (_, i) =>
      profile(`o${i}`, `+143855971${String(i).padStart(2, "0")}`),
    );
    let running = 0;
    let peak = 0;
    const configs = await loadProfileConfigs({
      profiles: storeOf(profiles),
      getOrganization: async (id) => {
        running += 1;
        peak = Math.max(peak, running);
        await later(2);
        running -= 1;
        return org(id);
      },
      getClient: async () => client,
      env,
    });
    assert.equal(configs.length, 40);
    assert.ok(peak <= 8, `at most 8 at a time (peak ${peak})`);
  });

  it("keeps the store's order even when the lookups finish out of order", async () => {
    const profiles = [profile("slow", "+14385597100"), profile("fast", "+14385597200")];
    const configs = await loadProfileConfigs({
      profiles: storeOf(profiles),
      getOrganization: async (id) => {
        await later(id === "slow" ? 30 : 1);
        return org(id);
      },
      getClient: async () => client,
      env,
    });
    assert.deepEqual(configs.map((c) => c.id), ["rc_org_slow", "rc_org_fast"]);
  });

  it("gives a number two profiles share to the first one in store order", async () => {
    const skipped: string[] = [];
    const profiles = [profile("slow", "+14385597100"), profile("fast", "+14385597100")];
    const configs = await loadProfileConfigs({
      profiles: storeOf(profiles),
      // The second profile's lookups finish first: it must still lose.
      getOrganization: async (id) => {
        await later(id === "slow" ? 30 : 1);
        return org(id);
      },
      getClient: async () => client,
      env,
      onSkip: (organizationId, reason) => skipped.push(`${organizationId}:${reason}`),
    });
    assert.deepEqual(configs.map((c) => c.id), ["rc_org_slow"]);
    assert.deepEqual(skipped, ["fast:duplicate_number"]);
  });

  it("reports every skip reason in store order and asks for a client only when the organization qualifies", async () => {
    const skipped: string[] = [];
    const clientAsks: string[] = [];
    const orgs: Record<string, ReturnType<typeof org> | null> = {
      ok: org("ok"),
      off: org("off", { status: "suspended" }),
      unlinked: org("unlinked", { missedCallClientId: null }),
      ghost: null,
      novoice: org("novoice", { plan: "starter" }),
      noclient: org("noclient", { missedCallClientId: "client_missing" }),
    };
    const profiles = Object.keys(orgs).map((id, i) =>
      profile(id, `+143855972${String(i).padStart(2, "0")}`),
    );
    const configs = await loadProfileConfigs({
      profiles: storeOf(profiles),
      getOrganization: async (id) => {
        await later(id === "ok" ? 20 : 1);
        return orgs[id] ?? null;
      },
      getClient: async (id) => {
        clientAsks.push(id);
        return id === "client_a" ? client : null;
      },
      env,
      onSkip: (organizationId, reason) => skipped.push(`${organizationId}:${reason.split(":")[0]}`),
    });
    assert.deepEqual(configs.map((c) => c.id), ["rc_org_ok"]);
    assert.deepEqual(skipped, [
      "off:organization_inactive",
      "unlinked:organization_not_linked_to_client",
      "ghost:organization_inactive",
      "novoice:plan_without_voice_receptionist",
      "noclient:client_missing",
    ]);
    // Only the two organizations that reached the client step asked for one.
    assert.deepEqual([...clientAsks].sort(), ["client_a", "client_missing"]);
  });

  it("returns nothing when no profile is activated", async () => {
    const configs = await loadProfileConfigs({
      profiles: storeOf([]),
      getOrganization: async () => null,
      getClient: async () => null,
      env,
    });
    assert.deepEqual(configs, []);
  });
});
