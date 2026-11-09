/**
 * Usage metering and overage invoicing through the REAL Postgres stores. The
 * in-memory suites (usage-metering.test.ts, overage-invoicing.test.ts) prove the
 * rules; this proves the SQL keeps them under concurrency and retries: counters
 * add up exactly, one overage is opened and announced once, only an owner-
 * confirmed overage is billable, and a month is claimed (and sent to Stripe)
 * once. Stripe itself is always a fake: nothing here can create a real charge.
 *
 * Needs a disposable database named *_staging with the schema applied
 * (npm run db:schema), given as USAGE_BILLING_TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  createPostgresOverageInvoicingDeps,
  overageInvoicingSettings,
  RETRY_WINDOW_MS,
  runOverageInvoicing,
  type InvoiceItemRequest,
} from "../../src/product/saas/overage-invoicing";
import {
  confirmedOverageUnits,
  listOverages,
  recordOrganizationUsage,
  resolveOverage,
  setUsageStoreForTests,
  usageSummary,
  type MeteredMetric,
} from "../../src/product/saas/usage-metering";

const url = process.env.USAGE_BILLING_TEST_DATABASE_URL?.trim();
const disposable = url ? /_staging$/.test(new URL(url).pathname) : false;

const SMS: MeteredMetric = "smsSegmentsPerMonth";
const VOICE: MeteredMetric = "voiceMinutesPerMonth";
const OCTOBER = new Date("2026-10-15T12:00:00.000Z");
const NOVEMBER = new Date("2026-11-03T12:00:00.000Z");
const NOW = new Date("2026-11-08T09:00:00.000Z");
const SETTINGS = overageInvoicingSettings({
  OVERAGE_INVOICING: "1",
  OVERAGE_RATE_SMS_SEGMENT_CENTS: "7",
  OVERAGE_RATE_VOICE_MINUTE_CENTS: "25",
});

function fakeStripe() {
  const calls: InvoiceItemRequest[] = [];
  const byKey = new Map<string, string>();
  let failures = 0;
  return {
    calls,
    byKey,
    failNextCalls(n: number) {
      failures = n;
    },
    async createInvoiceItem(request: InvoiceItemRequest) {
      calls.push(request);
      if (failures > 0) {
        failures -= 1;
        throw new Error("Stripe is down");
      }
      let id = byKey.get(request.idempotencyKey);
      if (!id) {
        id = `ii_test_${byKey.size + 1}`;
        byKey.set(request.idempotencyKey, id);
      }
      return { id };
    },
  };
}

describe(
  "usage metering and overage invoicing (real PostgreSQL)",
  { skip: !url },
  () => {
    const suffix = randomBytes(4).toString("hex");
    const orgA = `org_ub_a_${suffix}`; // essential, has a Stripe customer
    const orgB = `org_ub_b_${suffix}`; // professional, has a Stripe customer
    const orgC = `org_ub_c_${suffix}`; // essential, no Stripe customer
    const orgs = [orgA, orgB, orgC];
    let pool: Pool;
    const saved: Record<string, string | undefined> = {};

    before(async () => {
      assert.ok(disposable, "Refusing to touch a database not named *_staging");
      for (const key of ["DATABASE_URL", "SAAS_DURABLE_STORE"])
        saved[key] = process.env[key];
      // usage-metering picks its store from the environment; point it at the test DB.
      process.env.DATABASE_URL = url;
      process.env.SAAS_DURABLE_STORE = "1";
      setUsageStoreForTests(null);

      pool = new Pool({ connectionString: url, max: 2 });
      for (const [id, plan] of [
        [orgA, "essential"],
        [orgB, "professional"],
        [orgC, "essential"],
      ] as const) {
        await pool.query(
          `INSERT INTO tc_organizations (id, name, slug, plan) VALUES ($1,$2,$3,$4)`,
          [id, `Business ${id}`, `slug-${id}`, plan],
        );
      }
      for (const id of [orgA, orgB]) {
        await pool.query(
          `INSERT INTO tc_stripe_customers (organization_id, customer_id, livemode)
         VALUES ($1,$2,false)`,
          [id, `cus_${id}`],
        );
      }
    });

    after(async () => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (pool) {
        // Cascades to counters, confirmations, invoices and Stripe customers.
        await pool.query(`DELETE FROM tc_organizations WHERE id = ANY($1)`, [
          orgs,
        ]);
        await pool.end();
      }
    });

    const countOf = async (org: string, metric: string, period: string) =>
      Number(
        (
          await pool.query(
            `SELECT count FROM tc_usage_counters WHERE organization_id=$1 AND metric=$2 AND period_start=$3`,
            [org, metric, period],
          )
        ).rows[0]?.count ?? 0,
      );
    const invoiceRows = async (org: string) =>
      (
        await pool.query(
          `SELECT * FROM tc_usage_overage_invoices WHERE organization_id=$1`,
          [org],
        )
      ).rows;

    it("adds concurrent usage exactly and opens and announces one overage", async () => {
      const notified: string[] = [];
      const notify = async (n: {
        organizationId: string;
        metric: MeteredMetric;
      }) => {
        notified.push(`${n.organizationId}:${n.metric}`);
      };
      // 30 simultaneous 50-segment sends = 1,500; the essential allowance is 1,000.
      await Promise.all(
        Array.from({ length: 30 }, () =>
          recordOrganizationUsage({
            organizationId: orgA,
            plan: "essential",
            metric: SMS,
            amount: 50,
            now: OCTOBER,
            notify,
          }),
        ),
      );

      assert.equal(await countOf(orgA, "sms_segments", "2026-10-01"), 1500);
      const rows = await pool.query(
        `SELECT status FROM tc_usage_overage_confirmations WHERE organization_id=$1`,
        [orgA],
      );
      assert.equal(rows.rowCount, 1, "exactly one overage row");
      assert.equal(rows.rows[0].status, "pending");
      assert.deepEqual(notified, [`${orgA}:${SMS}`], "the owner is told once");

      const summary = await usageSummary(orgA, "essential", OCTOBER);
      assert.equal(summary.find((s) => s.metric === SMS)?.used, 1500);
      assert.equal((await listOverages(orgA, OCTOBER)).length, 1);
    });

    it("bills nothing for a pending overage, and it is not even a candidate", async () => {
      assert.equal(
        await confirmedOverageUnits(orgA, "essential", SMS, OCTOBER),
        0,
      );
      const stripe = fakeStripe();
      const deps = {
        ...createPostgresOverageInvoicingDeps(url!, NOW, SETTINGS),
        createInvoiceItem: stripe.createInvoiceItem,
      };
      assert.deepEqual(
        (await deps.candidates("2026-10-01")).filter((c) =>
          orgs.includes(c.organizationId),
        ),
        [],
      );
      const result = await runOverageInvoicing(deps);
      assert.equal(result.invoiced, 0);
      assert.equal(stripe.calls.length, 0);
      assert.equal((await invoiceRows(orgA)).length, 0);
    });

    it("only the first answer counts: a confirmed overage cannot be declined, or the reverse", async () => {
      const first = await resolveOverage({
        organizationId: orgA,
        metric: SMS,
        decision: "confirmed",
        userId: "owner_1",
        now: OCTOBER,
      });
      assert.equal(first?.status, "confirmed");
      for (const decision of ["declined", "confirmed"] as const) {
        const again = await resolveOverage({
          organizationId: orgA,
          metric: SMS,
          decision,
          userId: "owner_2",
          now: OCTOBER,
        });
        assert.equal(again, null, `a second ${decision} is ignored`);
      }
      // 1,500 used - 1,000 allowed = 500 confirmed units.
      assert.equal(
        await confirmedOverageUnits(orgA, "essential", SMS, OCTOBER),
        500,
      );
    });

    it("invoices the confirmed month once, even when two runs overlap and again later", async () => {
      const stripe = fakeStripe();
      const deps = {
        ...createPostgresOverageInvoicingDeps(url!, NOW, SETTINGS),
        createInvoiceItem: stripe.createInvoiceItem,
      };
      const [a, b] = await Promise.all([
        runOverageInvoicing(deps),
        runOverageInvoicing(deps),
      ]);
      assert.equal(a.invoiced + b.invoiced, 1, "one run bills it");
      assert.equal(
        stripe.byKey.size,
        1,
        "Stripe holds one object for the shared key",
      );

      const call = stripe.calls[0]!;
      assert.equal(call.amountCents, 500 * 7);
      assert.equal(call.customerId, `cus_${orgA}`);
      assert.equal(call.livemode, false);
      assert.equal(
        call.idempotencyKey,
        `overage:${orgA}:sms_segments:2026-10-01`,
      );

      const rows = await invoiceRows(orgA);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "created");
      assert.equal(rows[0].stripe_invoice_item_id, "ii_test_1");
      assert.equal(Number(rows[0].units), 500);
      assert.equal(rows[0].rate_cents, 7);
      assert.equal(rows[0].amount_cents, 3500);

      const again = await runOverageInvoicing(deps);
      assert.equal(again.invoiced, 0);
      assert.equal(again.alreadyInvoiced, 1);

      // Segments that arrive after the month closed are not billed on top.
      await recordOrganizationUsage({
        organizationId: orgA,
        plan: "essential",
        metric: SMS,
        amount: 40,
        now: OCTOBER,
      });
      const late = await runOverageInvoicing(deps);
      assert.equal(late.invoiced, 0);
      assert.equal(stripe.byKey.size, 1);
      assert.equal((await invoiceRows(orgA))[0].amount_cents, 3500);
    });

    it("never bills the month that is still accruing", async () => {
      await recordOrganizationUsage({
        organizationId: orgB,
        plan: "professional",
        metric: VOICE,
        amount: 1200, // professional allows 1,000 minutes
        now: NOVEMBER,
      });
      await resolveOverage({
        organizationId: orgB,
        metric: VOICE,
        decision: "confirmed",
        userId: "owner_1",
        now: NOVEMBER,
      });
      const stripe = fakeStripe();
      const deps = {
        ...createPostgresOverageInvoicingDeps(url!, NOW, SETTINGS),
        createInvoiceItem: stripe.createInvoiceItem,
      };
      await runOverageInvoicing(deps);
      assert.equal(
        stripe.calls.filter((c) => c.metadata.organization_id === orgB).length,
        0,
      );
      assert.equal((await invoiceRows(orgB)).length, 0);
    });

    it("retries a Stripe failure with the frozen amount, then stops retrying past the window", async () => {
      // Organization B passes its allowance in October and the owner confirms.
      await recordOrganizationUsage({
        organizationId: orgB,
        plan: "professional",
        metric: SMS,
        amount: 2300, // professional allows 2,000 segments
        now: OCTOBER,
      });
      await resolveOverage({
        organizationId: orgB,
        metric: SMS,
        decision: "confirmed",
        userId: "owner_1",
        now: OCTOBER,
      });

      const stripe = fakeStripe();
      stripe.failNextCalls(1);
      const run = (now: Date) =>
        runOverageInvoicing({
          ...createPostgresOverageInvoicingDeps(url!, now, SETTINGS),
          createInvoiceItem: stripe.createInvoiceItem,
        });

      const first = await run(NOW);
      assert.equal(first.failed, 1);
      const pending = (await invoiceRows(orgB))[0];
      assert.equal(pending.status, "pending");
      assert.equal(pending.amount_cents, 300 * 7);

      // Late usage after the claim must not change what is retried.
      await recordOrganizationUsage({
        organizationId: orgB,
        plan: "professional",
        metric: SMS,
        amount: 500,
        now: OCTOBER,
      });
      const second = await run(new Date(NOW.getTime() + 60_000));
      assert.equal(second.retried, 1);
      const retry = stripe.calls.at(-1)!;
      assert.equal(retry.amountCents, 300 * 7);
      assert.equal(retry.idempotencyKey, stripe.calls[0]!.idempotencyKey);
      assert.equal((await invoiceRows(orgB))[0].status, "created");

      // A claim that is still pending after the window goes to a human, not to Stripe.
      await pool.query(
        `UPDATE tc_usage_overage_invoices
          SET status='pending', stripe_invoice_item_id=NULL, created_at=NULL, claimed_at=$2
        WHERE organization_id=$1`,
        [orgB, NOW.toISOString()],
      );
      const before = stripe.calls.length;
      const stale = await run(
        new Date(NOW.getTime() + RETRY_WINDOW_MS + 60_000),
      );
      assert.equal(stale.needsReview, 1);
      assert.equal(
        stripe.calls.length,
        before,
        "no Stripe call for a stale claim",
      );
      assert.equal((await invoiceRows(orgB))[0].status, "needs_review");
    });

    it("claims nothing for a business with no Stripe customer", async () => {
      await recordOrganizationUsage({
        organizationId: orgC,
        plan: "essential",
        metric: SMS,
        amount: 1100,
        now: OCTOBER,
      });
      await resolveOverage({
        organizationId: orgC,
        metric: SMS,
        decision: "confirmed",
        userId: "owner_1",
        now: OCTOBER,
      });
      const stripe = fakeStripe();
      const result = await runOverageInvoicing({
        ...createPostgresOverageInvoicingDeps(url!, NOW, SETTINGS),
        createInvoiceItem: stripe.createInvoiceItem,
      });
      assert.ok(result.noCustomer >= 1);
      assert.equal(
        stripe.calls.filter((c) => c.metadata.organization_id === orgC).length,
        0,
      );
      assert.equal((await invoiceRows(orgC)).length, 0);
    });

    it("is switched off by default and then touches no Stripe and no rows", async () => {
      const stripe = fakeStripe();
      const result = await runOverageInvoicing({
        ...createPostgresOverageInvoicingDeps(
          url!,
          NOW,
          overageInvoicingSettings({}),
        ),
        createInvoiceItem: stripe.createInvoiceItem,
      });
      assert.equal(result.enabled, false);
      assert.equal(stripe.calls.length, 0);
    });

    it("enforces the invoice table's rules in the database itself", async () => {
      const insert = (
        units: number,
        rate: number,
        amount: number,
        status = "pending",
      ) =>
        pool.query(
          `INSERT INTO tc_usage_overage_invoices
           (organization_id, metric, period_start, units, rate_cents, amount_cents, status)
         VALUES ($1,'voice_minutes','2026-09-01',$2,$3,$4,$5)`,
          [orgC, units, rate, amount, status],
        );
      await assert.rejects(
        insert(0, 25, 25),
        /check constraint/i,
        "no zero-unit invoice",
      );
      await assert.rejects(
        insert(10, 0, 250),
        /check constraint/i,
        "no zero rate",
      );
      await assert.rejects(
        insert(10, 25, 0),
        /check constraint/i,
        "no zero amount",
      );
      await assert.rejects(
        insert(10, 25, 250, "paid"),
        /check constraint/i,
        "known statuses only",
      );
      await insert(10, 25, 250);
      await assert.rejects(
        insert(10, 25, 250),
        /duplicate key/i,
        "one claim per org, metric, month",
      );
    });

    it("keeps the usage and invoice tables private to the API roles", async () => {
      const { rows } = await pool.query(
        `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('tc_usage_counters','tc_usage_overage_confirmations','tc_usage_overage_invoices')`,
      );
      assert.equal(rows.length, 3);
      for (const row of rows)
        assert.equal(row.relrowsecurity, true, `${row.relname} has RLS on`);
    });
  },
);
