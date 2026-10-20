import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
} from "node:test";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { POST } from "../../src/app/api/webhooks/stripe/route";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import { createPostgresSaasStore } from "../../src/product/saas/postgres-store";
import { orgHasFeature } from "../../src/product/saas/entitlements";
import { createPostgresPool } from "../../src/lib/postgres-pool";

const names = [
  "DATABASE_URL",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_DURABLE_STORE",
  "STRIPE_SECRET_KEY",
  "STRIPE_TEST_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_TEST_WEBHOOK_SECRET",
  "STRIPE_TEST_PRICE_STARTER",
  "STRIPE_TEST_PRICE_GROWTH",
];
const original = new Map(names.map((name) => [name, process.env[name]]));
const signingSecret = "billing-test-signing-secret";
let sequence = 0;
function event(type = "customer.subscription.updated", overrides = {}) {
  return {
    id: `evt_test_${++sequence}`,
    type,
    livemode: false,
    data: { object: { id: "sub_test", customer: "cus_test" } },
    ...overrides,
  };
}
async function deliver(body: unknown, secret = signingSecret) {
  const payload = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret)
    .update(`${t}.${payload}`)
    .digest("hex");
  return POST(
    new NextRequest("https://test.invalid/api/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": `t=${t},v1=${sig}` },
    }),
  );
}
beforeEach(() => {
  names.forEach((name) => delete process.env[name]);
  Object.assign(process.env, {
    STRIPE_TEST_WEBHOOK_SECRET: signingSecret,
    STRIPE_TEST_SECRET_KEY: "sk_test_fixture",
    STRIPE_TEST_PRICE_STARTER: "price_starter",
    STRIPE_TEST_PRICE_GROWTH: "price_growth",
  });
  mock.method(console, "error", () => {});
});
afterEach(() => {
  mock.restoreAll();
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
after(closePgPool);

describe("Stripe webhook boundaries", () => {
  it("rejects forged signatures", async () =>
    assert.equal((await deliver(event(), "wrong")).status, 401));
  it("rejects malformed signed events", async () =>
    assert.equal((await deliver({ id: "evt_bad" })).status, 400));
  it("rejects live events signed with the test secret", async () =>
    assert.equal(
      (await deliver(event(undefined, { livemode: true }))).status,
      401,
    ));
  it("acknowledges unsupported events without requiring storage", async () =>
    assert.equal((await deliver(event("customer.created"))).status, 200));
  it("returns a retryable failure when durable storage is disabled", async () =>
    assert.equal((await deliver(event())).status, 503));
});

const url = process.env.STRIPE_BILLING_TEST_DATABASE_URL;
describe("Stripe billing in isolated PostgreSQL", { skip: !url }, () => {
  let pool: Pool;
  let subscriptions: ReturnType<typeof subscription>[];
  const organizationId = "org_billing_test";
  let networkFailure = false;
  let customerOrg: string | undefined = organizationId;
  let customerDeleted = false;
  function subscription(
    status = "active",
    price = "price_growth",
    id = "sub_test",
  ) {
    return {
      id,
      customer: "cus_test",
      livemode: false,
      status,
      cancel_at_period_end: false,
      latest_invoice: "in_test",
      items: {
        data: [{ price: { id: price }, current_period_end: 2000000000 }],
      },
    };
  }
  before(async () => {
    const target = new URL(url!);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(target.hostname) &&
        target.pathname === "/tc003_staging",
      "Refusing to touch a non-isolated database",
    );
    pool = new Pool({ connectionString: url });
    for (const file of [
      "src/product/missed-call/schema.sql",
      "src/product/saas/schema.sql",
      "src/product/saas/schema-demo-businesses.sql",
      "src/product/saas/stripe-billing.sql",
    ]) {
      await pool.query(readFileSync(file, "utf8"));
    }
  });
  beforeEach(async () => {
    Object.assign(process.env, { DATABASE_URL: url, SAAS_DURABLE_STORE: "1" });
    await pool.query("TRUNCATE tc_organizations,tc_stripe_events CASCADE");
    await pool.query(
      "INSERT INTO tc_organizations (id,name,slug,plan,status,account_type) VALUES ($1,'Billing test','billing-test','starter','suspended','demo')",
      [organizationId],
    );
    subscriptions = [subscription()];
    networkFailure = false;
    customerOrg = organizationId;
    customerDeleted = false;
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      if (networkFailure) return Response.json({}, { status: 503 });
      const parsed = new URL(String(input));
      if (parsed.pathname.endsWith("/customers/cus_test") && customerDeleted)
        return Response.json({ id: "cus_test", deleted: true });
      if (parsed.pathname.endsWith("/customers/cus_test"))
        return Response.json({
          id: "cus_test",
          livemode: false,
          metadata: customerOrg ? { organization_id: customerOrg } : {},
        });
      assert.equal(parsed.pathname, "/v1/subscriptions");
      assert.equal(parsed.searchParams.get("customer"), "cus_test");
      assert.equal(parsed.searchParams.get("status"), "all");
      return Response.json({ data: subscriptions, has_more: false });
    });
  });
  after(async () => {
    await pool?.end();
  });
  async function state() {
    const org = await createPostgresSaasStore(url!).getOrganization(
      organizationId,
    );
    return {
      plan: org!.plan,
      status: org!.status,
      growthAccess:
        org!.status === "active" &&
        orgHasFeature(org!.plan, "ADVANCED_PIPELINE"),
    };
  }
  it("activates Growth and backend permissions after payment, before subscription.created arrives", async () => {
    assert.equal((await deliver(event("invoice.paid"))).status, 200);
    assert.deepEqual(await state(), {
      plan: "growth",
      status: "active",
      growthAccess: true,
    });
  });
  it("deduplicates concurrent deliveries only after committed synchronization", async () => {
    const e = event();
    const results = await Promise.all([deliver(e), deliver(e), deliver(e)]);
    assert.ok(results.every((r) => r.status === 200));
    const bodies = await Promise.all(
      results.map(async (r) => (await r.json()) as { duplicate: boolean }),
    );
    assert.equal(bodies.filter((b) => b.duplicate).length, 2);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM tc_stripe_events"))
        .rows[0].n,
      1,
    );
  });
  it("upgrades/downgrades the plan using the trusted Stripe price", async () => {
    await deliver(event());
    subscriptions = [subscription("active", "price_starter")];
    await deliver(event());
    assert.deepEqual(await state(), {
      plan: "starter",
      status: "active",
      growthAccess: false,
    });
  });
  for (const status of ["past_due", "unpaid", "incomplete", "paused"]) {
    it(`suspends access for ${status}`, async () => {
      await deliver(event());
      subscriptions = [subscription(status)];
      await deliver(event("invoice.payment_failed"));
      assert.deepEqual(await state(), {
        plan: "starter",
        status: "suspended",
        growthAccess: false,
      });
    });
  }
  it("restores access after payment recovery", async () => {
    subscriptions = [subscription("past_due")];
    await deliver(event("invoice.payment_failed"));
    subscriptions = [subscription()];
    await deliver(event("invoice.paid"));
    assert.equal((await state()).growthAccess, true);
  });
  it("keeps access until a scheduled cancellation actually ends", async () => {
    subscriptions[0].cancel_at_period_end = true;
    await deliver(event());
    assert.equal((await state()).growthAccess, true);
    subscriptions[0].status = "canceled";
    await deliver(event("customer.subscription.deleted"));
    assert.deepEqual(await state(), {
      plan: "starter",
      status: "churned",
      growthAccess: false,
    });
  });
  it("uses current state when an old active event arrives after cancellation", async () => {
    subscriptions[0].status = "canceled";
    await deliver(event("customer.subscription.created"));
    assert.equal((await state()).status, "churned");
  });
  it("does not let cancellation of an old subscription revoke its active replacement", async () => {
    subscriptions = [
      subscription("canceled"),
      subscription("active", "price_growth", "sub_replacement"),
    ];
    await deliver(event("customer.subscription.deleted"));
    assert.equal((await state()).growthAccess, true);
  });
  it("grants configured trial access", async () => {
    subscriptions[0].status = "trialing";
    await deliver(event());
    assert.equal((await state()).growthAccess, true);
  });
  it("rolls back the receipt and account changes after an API failure, allowing the same event to retry", async () => {
    const e = event();
    networkFailure = true;
    assert.equal((await deliver(e)).status, 503);
    assert.equal(
      (await pool.query("SELECT * FROM tc_stripe_events")).rowCount,
      0,
    );
    assert.equal((await state()).status, "suspended");
    networkFailure = false;
    assert.equal((await deliver(e)).status, 200);
    assert.equal((await state()).growthAccess, true);
  });
  it("rolls back on a database failure after inserting the event receipt", async () => {
    await pool.query(
      "ALTER TABLE tc_organizations ADD CONSTRAINT test_reject_growth CHECK (plan <> 'growth')",
    );
    const e = event();
    try {
      assert.equal((await deliver(e)).status, 503);
      assert.equal(
        (await pool.query("SELECT * FROM tc_stripe_events")).rowCount,
        0,
      );
    } finally {
      await pool.query(
        "ALTER TABLE tc_organizations DROP CONSTRAINT test_reject_growth",
      );
    }
    assert.equal((await deliver(e)).status, 200);
  });
  it("rejects unknown prices without acknowledging the event", async () => {
    subscriptions[0] = subscription("active", "price_unknown");
    assert.equal((await deliver(event())).status, 503);
    assert.equal(
      (await pool.query("SELECT * FROM tc_stripe_events")).rowCount,
      0,
    );
  });
  it("never applies Stripe test billing to production accounts", async () => {
    await pool.query("UPDATE tc_organizations SET account_type='production'");
    assert.equal((await deliver(event())).status, 503);
    assert.equal((await state()).status, "suspended");
  });
  it("ignores customers without an organization mapping", async () => {
    customerOrg = undefined;
    const response = await deliver(event());
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { synchronized: boolean }).synchronized,
      false,
    );
  });
  it("rejects reassignment of an existing customer", async () => {
    await deliver(event());
    customerOrg = "org_someone_else";
    assert.equal((await deliver(event())).status, 503);
    assert.equal((await state()).growthAccess, true);
  });
  it("rejects connected-account events", async () =>
    assert.equal(
      (await deliver(event(undefined, { account: "acct_other" }))).status,
      503,
    ));
  it("revokes the bound organization's access after its Stripe customer is deleted", async () => {
    await deliver(event());
    customerDeleted = true;
    assert.equal(
      (await deliver(event("customer.subscription.deleted"))).status,
      200,
    );
    assert.deepEqual(await state(), {
      plan: "starter",
      status: "churned",
      growthAccess: false,
    });
  });
  it("closes Worker connections after queries and transactions without sharing sockets", async () => {
    Object.defineProperty(globalThis, "WebSocketPair", {
      value: class {},
      configurable: true,
    });
    const scoped = createPostgresPool({ connectionString: url });
    try {
      const first = await scoped.query("SELECT pg_backend_pid() AS pid");
      const second = await scoped.query("SELECT pg_backend_pid() AS pid");
      assert.notEqual(first.rows[0].pid, second.rows[0].pid);
      const client = await scoped.connect();
      await client.query("BEGIN");
      await client.query(
        "UPDATE tc_organizations SET plan='growth' WHERE id=$1",
        [organizationId],
      );
      await client.query("ROLLBACK");
      client.release();
      assert.equal((await state()).plan, "starter");
      const sockets = await pool.query(
        "SELECT pid FROM pg_stat_activity WHERE pid=ANY($1::int[])",
        [[first.rows[0].pid, second.rows[0].pid]],
      );
      assert.equal(sockets.rowCount, 0);
    } finally {
      await scoped.end();
      Reflect.deleteProperty(globalThis, "WebSocketPair");
    }
  });
});
