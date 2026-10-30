/**
 * Runs the REAL referral schema (src/product/referrals/schema.sql) and the
 * Postgres store against PGlite, an in-process PostgreSQL. It proves the
 * constraints that stop a reward being paid twice actually hold in the
 * database, not just in the in-memory double the other tests use.
 *
 * PGlite is optional tooling and is not a dependency of the app; the suite
 * skips itself when it is not installed:  npm i --no-save @electric-sql/pglite
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Pool } from "pg";
import { createPostgresReferralStore } from "../../src/product/referrals/postgres-store";
import {
  createReferralService,
  type OrganizationFacts,
  type ReferralDirectory,
} from "../../src/product/referrals/service";
import { isReferralConflict } from "../../src/product/referrals/store";
import type { RewardRecord } from "../../src/product/referrals/model";

const requireFromRepo = createRequire(path.join(process.cwd(), "package.json"));
let available = true;
try {
  requireFromRepo.resolve("@electric-sql/pglite");
} catch {
  available = false;
}

type Db = {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
};

const SCHEMA = readFileSync(
  path.join(process.cwd(), "src", "product", "referrals", "schema.sql"),
  "utf8",
);
const NOW = "2026-03-01T12:00:00.000Z";

function reward(overrides: Partial<RewardRecord> = {}): RewardRecord {
  return {
    id: "rwd_1",
    referralId: "ref_1",
    referrerOrganizationId: "org_ref",
    referredOrganizationId: "org_new",
    plan: "growth",
    amountCents: 7500,
    currency: "CAD",
    status: "pending",
    livemode: true,
    qualifyingSessionId: "cs_1",
    qualifyingPaymentIntentId: "pi_1",
    eligibleAt: NOW,
    reviewFlags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: Error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

describe("referral schema and Postgres store (real PostgreSQL via PGlite)", { skip: !available }, () => {
  let db: Db;
  let counter = 0;

  async function freshDb(): Promise<Db> {
    const specifier = "@electric-sql/pglite";
    const { PGlite } = (await import(specifier)) as { PGlite: new () => Db };
    const instance = new PGlite();
    // The only table the referral schema depends on.
    await instance.exec("CREATE TABLE tc_organizations (id TEXT PRIMARY KEY);");
    await instance.exec(SCHEMA);
    return instance;
  }

  const poolOf = (instance: Db) => ({ query: (sql: string, params?: unknown[]) => instance.query(sql, params) }) as unknown as Pool;

  before(async () => {
    db = await freshDb();
    await db.exec("INSERT INTO tc_organizations (id) VALUES ('org_ref'), ('org_other');");
  });
  after(async () => {
    await db?.close();
  });

  async function insertReferral(store: ReturnType<typeof createPostgresReferralStore>, id: string, referred: string) {
    return store.insertReferral({
      id,
      referrerOrganizationId: "org_ref",
      referredOrganizationId: referred,
      referrerBusinessName: "Plomberie Tremblay",
      referredBusinessName: "Toitures Gagnon",
      code: "ABCDEFGHJK",
      status: "registered",
      reviewFlags: [],
      registeredAt: NOW,
      updatedAt: NOW,
    });
  }

  it("applies cleanly and can be applied again (idempotent migration)", async () => {
    await db.exec(SCHEMA);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'tc_referral%' OR table_name = 'tc_referrals'`,
    );
    assert.equal(rows[0]?.n, 5);
  });

  it("returns the published defaults until settings are saved, then round-trips them", async () => {
    const store = createPostgresReferralStore(poolOf(db));
    const defaults = await store.getSettings();
    assert.deepEqual(defaults.rewardsCents, { starter: 5000, growth: 7500, receptionist: 12500 });
    assert.equal(defaults.fulfillmentMethod, "none");

    const saved = await store.saveSettings({
      ...defaults,
      holdDays: 14,
      eligiblePlans: ["growth", "receptionist"],
      fulfillmentMethod: "manual",
      updatedBy: "admin@example.com",
      updatedAt: NOW,
    });
    assert.equal(saved.holdDays, 14);
    assert.deepEqual(saved.eligiblePlans, ["growth", "receptionist"]);
    assert.equal((await store.getSettings()).fulfillmentMethod, "manual");
  });

  it("rejects settings the application would never produce", async () => {
    await rejects(
      db.query("UPDATE tc_referral_settings SET reward_growth_cents = -1"),
      /check|constraint/i,
    );
    await rejects(
      db.query("UPDATE tc_referral_settings SET fulfillment_method = 'automatic'"),
      /check|constraint/i,
    );
    await rejects(
      db.query("UPDATE tc_referral_settings SET eligible_plans = ARRAY['platinum']"),
      /check|constraint/i,
    );
  });

  it("gives an organization one code, and never lets two share a code", async () => {
    const store = createPostgresReferralStore(poolOf(db));
    const first = await store.createCode("org_ref", "ABCDEFGHJK", NOW);
    assert.deepEqual(first, { code: "ABCDEFGHJK", created: true });
    assert.deepEqual(await store.createCode("org_ref", "ZZZZZZZZZZ", NOW), {
      code: "ABCDEFGHJK",
      created: false,
    });
    assert.equal(await store.findOrganizationByCode("ABCDEFGHJK"), "org_ref");
    await assert.rejects(store.createCode("org_other", "ABCDEFGHJK", NOW), (e) => isReferralConflict(e, "code"));
    await rejects(db.query("UPDATE tc_referral_codes SET code = 'lowercase1'"), /check|constraint/i);
  });

  it("records a referred business once", async () => {
    const store = createPostgresReferralStore(poolOf(db));
    const first = await insertReferral(store, "ref_1", "org_new");
    assert.equal(first.created, true);
    const second = await insertReferral(store, "ref_other_id", "org_new");
    assert.equal(second.created, false);
    assert.equal(second.record.id, "ref_1");
    assert.equal((await store.listReferralsForReferrer("org_ref")).length, 1);
  });

  it("only a rejected referral may name the same business on both sides", async () => {
    await rejects(
      db.query(
        `INSERT INTO tc_referrals (id, referrer_organization_id, referred_organization_id, referrer_business_name, referred_business_name, code, status, registered_at, updated_at)
         VALUES ('ref_self', 'org_x', 'org_x', 'A', 'A', 'ABCDEFGHJK', 'registered', now(), now())`,
      ),
      /check|constraint/i,
    );
  });

  it("creates one reward per referral, business and Checkout Session, and hands back the existing one", async () => {
    const store = createPostgresReferralStore(poolOf(db));
    const first = await store.insertReward(reward());
    assert.equal(first.created, true);
    // Same referral, different session.
    const sameReferral = await store.insertReward(reward({ id: "rwd_2", qualifyingSessionId: "cs_2" }));
    assert.equal(sameReferral.created, false);
    assert.equal(sameReferral.reward.id, "rwd_1");
    // Same session, different id.
    const sameSession = await store.insertReward(reward({ id: "rwd_3", referralId: "ref_9", referredOrganizationId: "org_9" }));
    assert.equal(sameSession.created, false);
    assert.equal(sameSession.reward.id, "rwd_1");
    assert.equal((await store.listRewards()).length, 1);
    assert.equal((await store.getRewardByPaymentIntent("pi_1"))?.id, "rwd_1");
  });

  it("transitions are compare-and-set: only one of two racing decisions wins", async () => {
    const store = createPostgresReferralStore(poolOf(db));
    const [a, b] = await Promise.all([
      store.transitionReward("rwd_1", { from: ["pending"], to: "approved", at: NOW, patch: { decidedBy: "a", decidedAt: NOW } }),
      store.transitionReward("rwd_1", { from: ["pending"], to: "rejected", at: NOW, patch: { rejectionReason: "administrator", decidedBy: "b", decidedAt: NOW } }),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1);
    const stored = await store.getReward("rwd_1");
    assert.ok(stored && ["approved", "rejected"].includes(stored.status));
  });

  it("a gift card reference can be used once, however it is capitalised", async () => {
    const store = createPostgresReferralStore(poolOf(db));
    await db.exec("DELETE FROM tc_referral_rewards WHERE status <> 'issued'");
    await store.insertReward(reward({ id: "rwd_a", referralId: "ref_1", qualifyingSessionId: "cs_a", qualifyingPaymentIntentId: "pi_a" }));
    const issued = await store.transitionReward("rwd_a", {
      from: ["pending"],
      to: "issued",
      at: NOW,
      patch: { fulfillmentMethod: "manual", giftCardReference: "ORDER-1001", issuedBy: "admin", issuedAt: NOW },
    });
    assert.equal(issued?.status, "issued");

    await db.exec(
      `INSERT INTO tc_referrals (id, referrer_organization_id, referred_organization_id, referrer_business_name, referred_business_name, code, status, registered_at, updated_at)
       VALUES ('ref_2', 'org_ref', 'org_two', 'A', 'B', 'ABCDEFGHJK', 'registered', now(), now())`,
    );
    await store.insertReward(reward({ id: "rwd_b", referralId: "ref_2", referredOrganizationId: "org_two", qualifyingSessionId: "cs_b", qualifyingPaymentIntentId: "pi_b" }));
    await assert.rejects(
      store.transitionReward("rwd_b", {
        from: ["pending"],
        to: "issued",
        at: NOW,
        patch: { fulfillmentMethod: "manual", giftCardReference: "order-1001", issuedBy: "admin", issuedAt: NOW },
      }),
      (e) => isReferralConflict(e, "gift_card_reference"),
    );
    assert.equal((await db.query("SELECT status FROM tc_referral_rewards WHERE id = 'rwd_b'")).rows[0]?.status, "pending");
  });

  it("the database refuses states the application must never reach", async () => {
    // Issued without a gift card record.
    await rejects(db.query("UPDATE tc_referral_rewards SET status='issued', issued_at=now(), issued_by='x', fulfillment_method='manual' WHERE id='rwd_b'"), /check|constraint/i);
    // Fulfillment 'none' cannot be recorded as issued.
    await rejects(db.query("UPDATE tc_referral_rewards SET status='issued', gift_card_reference='ORDER-77', issued_at=now(), issued_by='x', fulfillment_method='none' WHERE id='rwd_b'"), /check|constraint/i);
    // A full card number in the reference.
    await rejects(db.query("UPDATE tc_referral_rewards SET gift_card_reference='4111 1111 1111 1111' WHERE id='rwd_b'"), /check|constraint/i);
    // A test-mode payment can never be approved.
    await db.exec("UPDATE tc_referral_rewards SET livemode=false WHERE id='rwd_b'");
    await rejects(db.query("UPDATE tc_referral_rewards SET status='approved' WHERE id='rwd_b'"), /check|constraint/i);
    await db.exec("UPDATE tc_referral_rewards SET livemode=true WHERE id='rwd_b'");
    // Rejected needs a reason.
    await rejects(db.query("UPDATE tc_referral_rewards SET status='rejected' WHERE id='rwd_b'"), /check|constraint/i);
    // Non-CAD, zero or negative amounts.
    await rejects(db.query("UPDATE tc_referral_rewards SET amount_cents=0 WHERE id='rwd_b'"), /check|constraint/i);
    await rejects(db.query("UPDATE tc_referral_rewards SET currency='USD' WHERE id='rwd_b'"), /check|constraint/i);
  });

  it("an issued reward is a permanent record, and the event trail is append-only", async () => {
    await rejects(db.query("DELETE FROM tc_referral_rewards WHERE id='rwd_a'"), /cannot be deleted/i);

    const store = createPostgresReferralStore(poolOf(db));
    await store.addEvent({ id: "rev_1", rewardId: "rwd_a", actor: "admin", action: "reward_issued", at: NOW });
    await store.addEvent({ id: "rev_1", rewardId: "rwd_a", actor: "admin", action: "reward_issued", at: NOW });
    assert.equal((await store.listEvents({ rewardId: "rwd_a" })).length, 1, "replayed event id is ignored");
    await rejects(db.query("UPDATE tc_referral_events SET actor='someone else'"), /append-only/i);
    await rejects(db.query("DELETE FROM tc_referral_events"), /append-only/i);
  });

  it("adds review flags without duplicates", async () => {
    const store = createPostgresReferralStore(poolOf(db));
    await store.addRewardFlags("rwd_b", ["partial_refund"], NOW);
    const updated = await store.addRewardFlags("rwd_b", ["partial_refund", "billing_suspended"], NOW);
    assert.deepEqual([...(updated?.reviewFlags ?? [])].sort(), ["billing_suspended", "partial_refund"]);
  });

  it("keeps the private tables closed to the public API roles", async () => {
    const { rows } = await db.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('tc_referral_settings','tc_referral_codes','tc_referrals','tc_referral_rewards','tc_referral_events') ORDER BY relname`,
    );
    assert.equal(rows.length, 5);
    for (const row of rows) assert.equal(row.relrowsecurity, true, `${row.relname} must have row level security on`);
  });

  describe("the whole journey on PostgreSQL", () => {
    const orgs = new Map<string, OrganizationFacts>();
    const directory: ReferralDirectory = {
      getOrganization: async (id) => orgs.get(id) ?? null,
      getOwnerEmails: async (id) => [`owner@${id}.test`],
      getBillingCustomerId: async () => null,
      hasPaidAccess: async () => true,
      getPaidInstallation: async () => null,
    };
    let clock = Date.parse(NOW);
    const makeService = (instance: Db) =>
      createReferralService({
        store: createPostgresReferralStore(poolOf(instance)),
        directory,
        now: () => new Date(clock),
        newId: (prefix) => `${prefix}_j${++counter}`,
      });

    it("register -> pay -> hold -> approve -> issue, then a replayed payment adds nothing", async () => {
      const journeyDb = await freshDb();
      await journeyDb.exec("INSERT INTO tc_organizations (id) VALUES ('org_r'), ('org_n');");
      orgs.set("org_r", { id: "org_r", name: "Plomberie Tremblay", status: "active", accountType: "pilot", plan: "receptionist", phoneE164: null });
      orgs.set("org_n", { id: "org_n", name: "Toitures Gagnon", status: "active", accountType: "pilot", plan: "receptionist", phoneE164: null });
      try {
        const service = makeService(journeyDb);
        await service.updateSettings({ fulfillmentMethod: "manual" }, "admin");

        const code = await service.ensureCode("org_r");
        assert.ok(code);
        const registered = await service.registerReferral({ code, referredOrganizationId: "org_n", actor: "ops" });
        assert.equal(registered.ok, true);

        const paid = { organizationId: "org_n", plan: "receptionist" as const, checkoutSessionId: "cs_j", paymentIntentId: "pi_j", livemode: true };
        const first = await service.qualifyReferral(paid);
        const replay = await service.qualifyReferral(paid);
        assert.ok(first.qualified && replay.qualified);
        assert.equal(first.reward.amountCents, 12500);
        assert.equal(replay.duplicate, true);

        clock += 31 * 86_400_000;
        const approved = await service.approveReward(first.reward.id, "admin");
        assert.equal(approved.ok, true);
        const issued = await service.markIssued(first.reward.id, "admin", { giftCardReference: "ORDER-J1" });
        assert.equal(issued.ok, true);

        const overview = await service.overview("org_r");
        assert.deepEqual(overview.totals, { signedUp: 1, customers: 1, pendingCents: 0, earnedCents: 12500, issuedCents: 12500 });
        const refund = await service.onPaymentReversed({ paymentIntentId: "pi_j", kind: "refunded" });
        assert.equal(refund.changed, true, "an issued card is flagged for a person, not undone");
        assert.ok((await journeyDb.query("SELECT review_flags FROM tc_referral_rewards")).rows[0]?.review_flags);
      } finally {
        await journeyDb.close();
      }
    });
  });
});
