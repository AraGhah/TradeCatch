import { z } from "zod";
import { stripeSecretKey } from "./stripe-key";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { PlanId } from "./entitlements";

const reference = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1) }),
]);
const objectSchema = z.object({
  id: z.string().min(1),
  customer: reference.optional(),
});
export const stripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  livemode: z.boolean(),
  // Connect events must never modify this platform's organizations.
  account: z.string().optional(),
  data: z.object({ object: objectSchema }),
});
export type BillingEvent = z.infer<typeof stripeEventSchema>;

export const BILLING_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.payment_action_required",
]);

const subscriptionSchema = z.object({
  id: z.string(),
  customer: reference,
  livemode: z.boolean(),
  status: z.enum([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "paused",
  ]),
  cancel_at_period_end: z.boolean(),
  latest_invoice: reference.nullable(),
  current_period_end: z.number().optional(),
  items: z.object({
    has_more: z.boolean().optional(),
    data: z
      .array(
        z.object({
          price: z.object({ id: z.string() }),
          current_period_end: z.number().optional(),
        }),
      )
      .min(1),
  }),
});
const customerSchema = z.union([
  z.object({
    id: z.string(),
    livemode: z.boolean(),
    metadata: z.object({ organization_id: z.string().optional() }),
  }),
  z.object({ id: z.string(), deleted: z.literal(true) }),
]);
function idOf(value: z.infer<typeof reference>) {
  return typeof value === "string" ? value : value.id;
}

function configuration(livemode: boolean) {
  const key = stripeSecretKey(livemode);
  const prices = new Map<string, PlanId>();
  for (const plan of ["starter", "growth", "receptionist"] as const) {
    const name = `STRIPE_${livemode ? "" : "TEST_"}PRICE_${plan.toUpperCase()}`;
    for (const price of (process.env[name] || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)) {
      if (prices.has(price))
        throw new Error("Stripe price mapped to multiple plans.");
      prices.set(price, plan);
    }
  }
  if (!prices.size) throw new Error("Stripe plan prices are not configured.");
  return { key, prices };
}

async function stripeGet(path: string, key: string): Promise<unknown> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": "2025-02-24.acacia",
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Stripe retrieval failed (${response.status}).`);
  return response.json();
}

/** Reconcile current Stripe state, never an old event snapshot or cookie plan. */
export async function synchronizeStripeBilling(event: BillingEvent) {
  if (event.account)
    throw new Error("Connected-account billing is unsupported.");
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    throw new Error("Stripe billing requires durable PostgreSQL storage.");
  }
  const { key, prices } = configuration(event.livemode);
  const customerId =
    event.data.object.customer && idOf(event.data.object.customer);
  if (!customerId || !/^cus_[a-zA-Z0-9_]+$/.test(customerId)) {
    throw new Error("Billing event is missing its customer.");
  }
  const client = await getPgPool(url).connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '25000'");
    // Fetch *after* obtaining the lock: concurrent deliveries cannot overwrite
    // a newer Stripe snapshot with a response fetched before another commit.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`stripe:${customerId}`],
    );
    const receipt = await client.query(
      "INSERT INTO tc_stripe_events (event_id,event_type,livemode) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id",
      [event.id, event.type, event.livemode],
    );
    if (!receipt.rowCount) {
      await client.query("COMMIT");
      return { duplicate: true, synchronized: false };
    }

    const customer = customerSchema.parse(
      await stripeGet(`customers/${encodeURIComponent(customerId)}`, key),
    );
    const deleted = "deleted" in customer;
    if (
      customer.id !== customerId ||
      (!deleted && customer.livemode !== event.livemode)
    )
      throw new Error("Stripe customer mismatch.");
    const existing = (
      await client.query(
        "SELECT organization_id,livemode FROM tc_stripe_customers WHERE customer_id=$1",
        [customerId],
      )
    ).rows[0];
    const metadataOrg = !deleted
      ? customer.metadata.organization_id
      : undefined;
    const organizationId = existing?.organization_id || metadataOrg;
    // Unrelated Stripe customers are acknowledged without changing any account.
    if (!organizationId) {
      await client.query("COMMIT");
      return { duplicate: false, synchronized: false };
    }
    if (existing && existing.livemode !== event.livemode)
      throw new Error("Stripe customer mode mismatch.");
    if (metadataOrg && metadataOrg !== organizationId)
      throw new Error("Stripe organization mapping changed.");
    const org = (
      await client.query(
        "SELECT account_type FROM tc_organizations WHERE id=$1 FOR UPDATE",
        [organizationId],
      )
    ).rows[0];
    if (!org || (!event.livemode && org.account_type !== "demo")) {
      throw new Error(
        "Stripe test billing is restricted to demo organizations.",
      );
    }
    // Stripe removes metadata when a customer is deleted and automatically
    // cancels its subscriptions. Use our durable binding to revoke access.
    if (deleted) {
      await client.query(
        "UPDATE tc_stripe_subscriptions SET status='canceled',synced_at=now() WHERE organization_id=$1",
        [organizationId],
      );
      await client.query(
        "UPDATE tc_organizations SET plan='starter',status='churned',updated_at=now() WHERE id=$1",
        [organizationId],
      );
      await client.query("COMMIT");
      return { duplicate: false, synchronized: true };
    }
    await client
      .query(
        `INSERT INTO tc_stripe_customers (organization_id,customer_id,livemode) VALUES ($1,$2,$3)
       ON CONFLICT (organization_id) DO UPDATE SET synced_at=now()
       WHERE tc_stripe_customers.customer_id=EXCLUDED.customer_id AND tc_stripe_customers.livemode=EXCLUDED.livemode
       RETURNING organization_id`,
        [organizationId, customerId, event.livemode],
      )
      .then((result) => {
        if (!result.rowCount)
          throw new Error("Organization already has another billing customer.");
      });

    const subscriptions: z.infer<typeof subscriptionSchema>[] = [];
    let cursor = "";
    for (let page = 0; ; page++) {
      if (page >= 10)
        throw new Error("Too many Stripe subscriptions to reconcile safely.");
      const query = new URLSearchParams({
        customer: customerId,
        status: "all",
        limit: "100",
      });
      if (cursor) query.set("starting_after", cursor);
      const list = z
        .object({ data: z.array(subscriptionSchema), has_more: z.boolean() })
        .parse(await stripeGet(`subscriptions?${query}`, key));
      subscriptions.push(...list.data);
      if (!list.has_more) break;
      cursor = list.data.at(-1)?.id || "";
      if (!cursor) throw new Error("Invalid Stripe pagination.");
    }
    // A subscription event must be represented in the authoritative response.
    if (
      event.type.startsWith("customer.subscription.") &&
      !subscriptions.some((s) => s.id === event.data.object.id)
    ) {
      throw new Error(
        "Stripe subscription not yet available; retry the event.",
      );
    }
    const mapped = subscriptions.map((subscription) => {
      if (
        idOf(subscription.customer) !== customerId ||
        subscription.livemode !== event.livemode ||
        subscription.items.has_more
      ) {
        throw new Error("Stripe subscription snapshot mismatch.");
      }
      const plans = subscription.items.data.map((item) =>
        prices.get(item.price.id),
      );
      if (plans.some((plan) => !plan) || new Set(plans).size !== 1) {
        throw new Error("Unmapped or ambiguous Stripe subscription price.");
      }
      return { ...subscription, plan: plans[0]! };
    });
    await client.query(
      "DELETE FROM tc_stripe_subscriptions WHERE organization_id=$1",
      [organizationId],
    );
    for (const sub of mapped) {
      const end =
        sub.current_period_end ?? sub.items.data[0].current_period_end;
      await client.query(
        `INSERT INTO tc_stripe_subscriptions (subscription_id,organization_id,status,plan,cancel_at_period_end,current_period_end,latest_invoice_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          sub.id,
          organizationId,
          sub.status,
          sub.plan,
          sub.cancel_at_period_end,
          end ? new Date(end * 1000) : null,
          sub.latest_invoice ? idOf(sub.latest_invoice) : null,
        ],
      );
    }
    const entitled = mapped.filter(
      (s) => s.status === "active" || s.status === "trialing",
    );
    const plan = entitled.some((s) => s.plan === "receptionist")
      ? "receptionist"
      : entitled.some((s) => s.plan === "growth")
        ? "growth"
        : "starter";
    const status = entitled.length
      ? "active"
      : mapped.some(
            (s) => !["canceled", "incomplete_expired"].includes(s.status),
          )
        ? "suspended"
        : "churned";
    await client.query(
      "UPDATE tc_organizations SET plan=$2,status=$3,updated_at=now() WHERE id=$1",
      [organizationId, plan, status],
    );
    await client.query("COMMIT");
    return { duplicate: false, synchronized: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
