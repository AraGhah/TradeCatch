/**
 * "Get your link": a customer's referral link is created once on request, is
 * the same afterwards, is only ever theirs, is never promised unless it was
 * saved for real, and credits the right customer when someone uses it.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createReferralService,
  ReferralStorageUnavailableError,
  type OrganizationFacts,
  type ReferralDirectory,
} from "../../src/product/referrals/service";
import { createMemoryReferralStore } from "../../src/product/referrals/store";
import { publicOrigin, referralUrl } from "../../src/product/referrals/links";
import type { PlanId } from "../../src/product/saas/plan-catalog";

const START = Date.parse("2026-11-08T12:00:00.000Z");

function makeWorld(
  durability?: { expected: boolean; ready: boolean },
  options: { holdDays?: number } = {},
) {
  let counter = 0;
  const orgs = new Map<string, OrganizationFacts>();
  const paid = new Set<string>();
  const directory: ReferralDirectory = {
    getOrganization: async (id) => orgs.get(id) ?? null,
    getOwnerEmails: async (id) => [`owner@${id.replace(/_/g, "-")}.test`],
    getBillingCustomerId: async () => null,
    hasPaidAccess: async (id) => paid.has(id),
    getPaidInstallation: async () => null,
  };
  const store = createMemoryReferralStore();
  const service = createReferralService({
    store,
    directory,
    now: () => new Date(START),
    newId: (prefix) => `${prefix}_${++counter}`,
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (counter++ * 7 + i * 13) % 251),
    durability,
  });
  return {
    store,
    service,
    addOrg(id: string, extra: Partial<OrganizationFacts> = {}, paidAccess = true) {
      orgs.set(id, {
        id,
        name: `Business ${id}`,
        status: "active",
        accountType: "client",
        plan: "essential",
        phoneE164: null,
        ...extra,
      });
      if (paidAccess) paid.add(id);
    },
    async settings(patch: Parameters<typeof service.updateSettings>[0]) {
      const result = await service.updateSettings(patch, "admin");
      assert.ok(result.ok);
    },
  };
}

describe("creating the link", () => {
  it("creates it on the first request and returns the same one every time after", async () => {
    const w = makeWorld();
    w.addOrg("org_a");
    const first = await w.service.ensureLink("org_a");
    const second = await w.service.ensureLink("org_a");
    assert.ok(first.ok && second.ok);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.code, first.code);
    assert.match(first.code, /^[2-9A-HJKMNP-Z]{10}$/);
  });

  it("keeps one code for a business that clicks twice at the same moment", async () => {
    const w = makeWorld();
    w.addOrg("org_a");
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => w.service.ensureLink("org_a")));
    const codes = new Set(results.map((r) => (r.ok ? r.code : "failed")));
    assert.equal(codes.size, 1);
    assert.ok(!codes.has("failed"));
    assert.equal(results.filter((r) => r.ok && r.created).length, 1);
  });

  it("gives each business its own link and never shows one business another's", async () => {
    const w = makeWorld();
    w.addOrg("org_a");
    w.addOrg("org_b");
    const a = await w.service.ensureLink("org_a");
    const b = await w.service.ensureLink("org_b");
    assert.ok(a.ok && b.ok);
    assert.notEqual(a.code, b.code);
    const overviewA = await w.service.overview("org_a");
    assert.equal(overviewA.code, a.code);
    assert.ok(!JSON.stringify(overviewA).includes(b.code));
  });

  it("only reads when asked to read: viewing the page never creates a link", async () => {
    const w = makeWorld();
    w.addOrg("org_a");
    assert.deepEqual(await w.service.getLink("org_a"), { ok: true, code: null });
    assert.equal((await w.service.overview("org_a")).code, undefined);
    assert.equal(await w.store.getCodeForOrganization("org_a"), null);
  });

  it("says why it cannot make one instead of making a placeholder", async () => {
    const w = makeWorld();
    w.addOrg("org_unpaid", {}, false);
    w.addOrg("org_gone", { status: "suspended" });
    assert.deepEqual(await w.service.ensureLink("org_unpaid"), { ok: false, reason: "no_paid_access" });
    assert.deepEqual(await w.service.ensureLink("org_gone"), { ok: false, reason: "organization_inactive" });
    assert.deepEqual(await w.service.ensureLink("org_missing"), { ok: false, reason: "organization_inactive" });
    await w.settings({ programEnabled: false });
    w.addOrg("org_a");
    assert.deepEqual(await w.service.ensureLink("org_a"), { ok: false, reason: "program_disabled" });
    assert.equal(await w.store.getCodeForOrganization("org_unpaid"), null);
  });
});

describe("a link is never promised without real storage", () => {
  it("refuses to create, read or list while the durable store is expected but unreachable", async () => {
    const w = makeWorld({ expected: true, ready: false });
    w.addOrg("org_a");
    assert.deepEqual(await w.service.ensureLink("org_a"), { ok: false, reason: "storage_unavailable" });
    assert.deepEqual(await w.service.getLink("org_a"), { ok: false, reason: "storage_unavailable" });
    await assert.rejects(() => w.service.overview("org_a"), ReferralStorageUnavailableError);
    // Nothing was written anywhere: a link made in memory would be shared and never credited.
    assert.equal(await w.store.getCodeForOrganization("org_a"), null);
  });

  it("refuses to record referrals, rewards or settings changes it could not keep", async () => {
    const w = makeWorld({ expected: true, ready: false });
    w.addOrg("org_a");
    w.addOrg("org_b");
    await assert.rejects(
      () => w.service.registerReferral({ code: "ABCDEFGHJK", referredOrganizationId: "org_b", actor: "ops" }),
      ReferralStorageUnavailableError,
    );
    await assert.rejects(
      () =>
        w.service.qualifyReferral({
          organizationId: "org_b",
          plan: "essential",
          checkoutSessionId: "cs_1",
          livemode: true,
        }),
      ReferralStorageUnavailableError,
    );
    await assert.rejects(() => w.service.updateSettings({ holdDays: 5 }, "admin"), ReferralStorageUnavailableError);
  });

  it("works once the durable store is ready, and in memory when no durable store is expected", async () => {
    for (const durability of [{ expected: true, ready: true }, { expected: false, ready: false }, undefined]) {
      const w = makeWorld(durability);
      w.addOrg("org_a");
      const result = await w.service.ensureLink("org_a");
      assert.ok(result.ok, JSON.stringify(durability));
    }
  });
});

describe("opening the link in a separate session credits the right customer", () => {
  it("attributes the new business to the link's owner and pays by the plan it buys", async () => {
    const w = makeWorld(undefined);
    w.addOrg("org_ref", { name: "Plomberie Tremblay" });
    w.addOrg("org_new", { name: "Toitures Gagnon" }, false);
    const link = await w.service.ensureLink("org_ref");
    assert.ok(link.ok);

    // The visitor's browser remembers the code from the link; the booking carries it.
    const url = new URL(referralUrl(link.code, "en"));
    const fromLink = url.searchParams.get("ref");
    assert.equal(fromLink, link.code);

    assert.equal(await w.service.isCodeValid(fromLink), true);
    const registered = await w.service.registerReferral({
      code: fromLink,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.ok(registered.ok);
    assert.equal(registered.referral.referrerOrganizationId, "org_ref");

    const qualified = await w.service.qualifyReferral({
      organizationId: "org_new",
      plan: "professional",
      checkoutSessionId: "cs_pro",
      livemode: true,
    });
    assert.ok(qualified.qualified);
    assert.equal(qualified.reward.referrerOrganizationId, "org_ref");
    assert.equal(qualified.reward.amountCents, 7_500);
    assert.equal((await w.service.overview("org_ref")).referrals[0]?.businessName, "Toitures Gagnon");
  });

  it("does not credit a link that does not exist, or the business's own link", async () => {
    const w = makeWorld(undefined);
    w.addOrg("org_ref");
    const link = await w.service.ensureLink("org_ref");
    assert.ok(link.ok);
    assert.equal(await w.service.isCodeValid("ZZZZZZZZZZ"), false);
    const self = await w.service.registerReferral({
      code: link.code,
      referredOrganizationId: "org_ref",
      actor: "ops",
    });
    assert.deepEqual([self.ok, !self.ok && self.reason], [false, "rejected"]);
  });
});

describe("new reward amounts apply to the future only", () => {
  async function referred(w: ReturnType<typeof makeWorld>, id: string, plan: PlanId) {
    w.addOrg(id, { name: `Referred ${id}` }, false);
    const link = await w.service.ensureLink("org_ref");
    assert.ok(link.ok);
    const registered = await w.service.registerReferral({
      code: link.code,
      referredOrganizationId: id,
      actor: "ops",
    });
    assert.ok(registered.ok);
    const result = await w.service.qualifyReferral({
      organizationId: id,
      plan,
      checkoutSessionId: `cs_${id}`,
      livemode: true,
    });
    assert.ok(result.qualified);
    return result.reward;
  }

  it("a reward earned under the old $65 keeps $65 after the amounts change", async () => {
    const w = makeWorld(undefined);
    w.addOrg("org_ref");
    // The old launch amounts: $65 for either plan.
    await w.settings({ rewardsCents: { essential: 6_500, professional: 6_500 } });
    const earlier = await referred(w, "org_old", "essential");
    assert.equal(earlier.amountCents, 6_500);

    // The agreed amounts: $50 Essential, $75 Professional.
    await w.settings({ rewardsCents: { essential: 5_000, professional: 7_500 } });
    const essential = await referred(w, "org_e", "essential");
    const professional = await referred(w, "org_p", "professional");
    assert.equal(essential.amountCents, 5_000);
    assert.equal(professional.amountCents, 7_500);

    // The reward that was already earned did not move.
    const rewards = await w.store.listRewardsForReferrer("org_ref");
    assert.equal(rewards.find((r) => r.id === earlier.id)?.amountCents, 6_500);
    const totals = (await w.service.overview("org_ref")).totals;
    assert.equal(totals.pendingCents, 6_500 + 5_000 + 7_500);
  });
});

describe("share links use the configured public domain", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  it("builds English and French links on the configured site, not a request host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://tradecatch.ca/";
    assert.equal(referralUrl("ABCDEFGHJK", "en"), "https://tradecatch.ca/referral?ref=ABCDEFGHJK");
    assert.equal(referralUrl("ABCDEFGHJK", "fr"), "https://tradecatch.ca/fr/parrainage?ref=ABCDEFGHJK");
  });

  it("falls back to the production domain when the setting is empty or malformed, never a relative link", () => {
    for (const value of ["", "   ", "not a url"]) {
      process.env.NEXT_PUBLIC_SITE_URL = value;
      assert.equal(publicOrigin(), "https://tradecatch.ca");
      assert.ok(referralUrl("ABCDEFGHJK", "en").startsWith("https://tradecatch.ca/"));
    }
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(publicOrigin(), "https://tradecatch.ca");
  });
});
