import { z } from "zod";
import { stripeSecretKey } from "./stripe-key";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { newId } from "./ids";
import { referralInstallationPaid } from "@/product/referrals/billing-hooks";
import type { PlanId } from "./entitlements";
import { PLAN_IDS } from "./entitlements";
import type { Organization } from "./types";

export const CHECKOUT_COMPLETED_EVENT = "checkout.session.completed";

/** One calendar month after `now`, same day-of-month (clamped for shorter months). */
export function oneCalendarMonthLater(now: Date): Date {
  const next = new Date(now.getTime());
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export class CheckoutError extends Error {
  constructor(
    public readonly code:
      | "already_pending"
      | "already_subscribed"
      | "unavailable"
      | "misconfigured",
    public readonly status = 503,
  ) {
    super("Checkout could not be started.");
  }
}

function requireDurableStore() {
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    throw new CheckoutError("unavailable");
  }
  return url;
}

function installationPriceId(plan: PlanId, livemode: boolean): string {
  const name = `STRIPE_${livemode ? "" : "TEST_"}PRICE_INSTALL_${plan.toUpperCase()}`;
  const id = process.env[name]?.trim();
  if (!id) throw new CheckoutError("misconfigured");
  return id;
}

function recurringPriceId(plan: PlanId, livemode: boolean): string {
  const name = `STRIPE_${livemode ? "" : "TEST_"}PRICE_${plan.toUpperCase()}`;
  const first = (process.env[name] || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)[0];
  if (!first) throw new CheckoutError("misconfigured");
  return first;
}

function siteOrigin(): string {
  return new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://tradecatch.ca",
  ).origin;
}

async function stripeForm(
  path: string,
  key: string,
  body: URLSearchParams,
  idempotencyKey?: string,
): Promise<unknown> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": "2025-02-24.acacia",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Stripe request failed (${response.status}): ${path}`);
  }
  return response.json();
}

async function stripeGetJson(path: string, key: string): Promise<unknown> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": "2025-02-24.acacia",
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Stripe request failed (${response.status}): ${path}`);
  }
  return response.json();
}

const checkoutSessionResponseSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1).nullable(),
  livemode: z.boolean(),
});

/**
 * Starts a one-time installation-fee Checkout Session for the organization's
 * current plan, saving the card for the deferred subscription created once
 * the webhook confirms payment. Never charges the monthly price here.
 */
export async function createInstallationCheckoutSession(
  organization: Pick<Organization, "id" | "plan" | "accountType">,
): Promise<string> {
  const url = requireDurableStore();
  if (!PLAN_IDS.includes(organization.plan)) throw new CheckoutError("misconfigured");
  const livemode = organization.accountType !== "demo";
  const pool = getPgPool(url);

  const existingSub = (
    await pool.query(
      "SELECT status FROM tc_stripe_subscriptions WHERE organization_id=$1 AND status IN ('active','trialing')",
      [organization.id],
    )
  ).rowCount;
  if (existingSub) throw new CheckoutError("already_subscribed", 409);

  const id = newId("ic");
  let claim = await pool.query(
    `INSERT INTO tc_installation_checkouts (id, organization_id, plan, livemode, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (organization_id) WHERE status = 'pending' DO NOTHING
     RETURNING id`,
    [id, organization.id, organization.plan, livemode],
  );
  if (!claim.rowCount) {
    // Stripe Checkout Sessions expire 24h after creation. A pending row
    // older than that was abandoned before payment, not actively in
    // progress — release it so the organization can retry.
    const released = await pool.query(
      `UPDATE tc_installation_checkouts SET status='canceled', updated_at=now()
       WHERE organization_id=$1 AND status='pending' AND created_at < now() - interval '24 hours'`,
      [organization.id],
    );
    if (!released.rowCount) throw new CheckoutError("already_pending", 409);
    claim = await pool.query(
      `INSERT INTO tc_installation_checkouts (id, organization_id, plan, livemode, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (organization_id) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [id, organization.id, organization.plan, livemode],
    );
    if (!claim.rowCount) throw new CheckoutError("already_pending", 409);
  }

  try {
    const existingCustomer = (
      await pool.query(
        "SELECT customer_id FROM tc_stripe_customers WHERE organization_id=$1 AND livemode=$2",
        [organization.id, livemode],
      )
    ).rows[0] as { customer_id: string } | undefined;

    const key = stripeSecretKey(livemode);
    const origin = siteOrigin();
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][price]": installationPriceId(organization.plan, livemode),
      "line_items[0][quantity]": "1",
      "payment_intent_data[setup_future_usage]": "off_session",
      success_url: `${origin}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/billing?checkout=canceled`,
      "metadata[organization_id]": organization.id,
      "metadata[plan]": organization.plan,
      "metadata[flow]": "installation",
    });
    if (existingCustomer) body.set("customer", existingCustomer.customer_id);
    else body.set("customer_creation", "always");

    const response = checkoutSessionResponseSchema.parse(
      await stripeForm("checkout/sessions", key, body, id),
    );
    if (response.livemode !== livemode || !response.url) {
      throw new CheckoutError("unavailable");
    }
    await pool.query(
      "UPDATE tc_installation_checkouts SET checkout_session_id=$2, updated_at=now() WHERE id=$1",
      [id, response.id],
    );
    return response.url;
  } catch (error) {
    await pool.query(
      "UPDATE tc_installation_checkouts SET status='failed', updated_at=now() WHERE id=$1 AND status='pending'",
      [id],
    );
    if (error instanceof CheckoutError) throw error;
    throw new CheckoutError("unavailable");
  }
}

export const checkoutSessionEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.literal(CHECKOUT_COMPLETED_EVENT),
  livemode: z.boolean(),
  account: z.string().optional(),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      payment_status: z.string(),
      customer: z.union([z.string(), z.object({ id: z.string() })]).nullable(),
      payment_intent: z
        .union([z.string(), z.object({ id: z.string() })])
        .nullable()
        .optional(),
      metadata: z
        .object({
          organization_id: z.string().optional(),
          plan: z.string().optional(),
          flow: z.string().optional(),
        })
        .optional(),
    }),
  }),
});
export type CheckoutCompletedEvent = z.infer<typeof checkoutSessionEventSchema>;

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

const paymentIntentSchema = z.object({
  id: z.string(),
  payment_method: z.union([z.string(), z.object({ id: z.string() })]).nullable(),
});

const subscriptionListSchema = z.object({
  data: z.array(z.object({ id: z.string(), status: z.string() })),
});

/**
 * Handles `checkout.session.completed` for an installation-fee session:
 * saves the card as the customer's default, then creates the monthly
 * subscription with its first invoice deferred to the configured billing
 * start date (default: one calendar month out; see tc_billing_deferrals
 * for an administrator override). The resulting `customer.subscription.*`
 * event is reconciled by the existing stripe-billing.ts sync as normal.
 */
export async function synchronizeInstallationCheckout(
  event: CheckoutCompletedEvent,
): Promise<{ handled: boolean }> {
  if (event.account) throw new Error("Connected-account billing is unsupported.");
  const url = requireDurableStore();
  const pool = getPgPool(url);
  const client = await pool.connect();
  // Set only after COMMIT; read in `finally` once the connection is released.
  let paidInstallation: Parameters<typeof referralInstallationPaid>[0] | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '25000'");
    const receipt = await client.query(
      "INSERT INTO tc_stripe_events (event_id,event_type,livemode) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id",
      [event.id, event.type, event.livemode],
    );
    if (!receipt.rowCount) {
      await client.query("COMMIT");
      return { handled: false };
    }

    const session = event.data.object;
    const checkout = (
      await client.query(
        "SELECT id,organization_id,plan,livemode,status FROM tc_installation_checkouts WHERE checkout_session_id=$1 FOR UPDATE",
        [session.id],
      )
    ).rows[0] as
      | { id: string; organization_id: string; plan: PlanId; livemode: boolean; status: string }
      | undefined;
    // Not a session this app created (or already superseded) — acknowledge only.
    if (!checkout || checkout.livemode !== event.livemode) {
      await client.query("COMMIT");
      return { handled: false };
    }
    if (checkout.status === "subscribed") {
      await client.query("COMMIT");
      paidInstallation = referralPayment(checkout, session.id, session.payment_intent, event);
      return { handled: true };
    }
    if (session.payment_status !== "paid") {
      await client.query(
        "UPDATE tc_installation_checkouts SET status='canceled', updated_at=now() WHERE id=$1",
        [checkout.id],
      );
      await client.query("COMMIT");
      return { handled: true };
    }
    const metadataOrgId = session.metadata?.organization_id;
    if (metadataOrgId && metadataOrgId !== checkout.organization_id) {
      throw new Error("Checkout metadata does not match the claimed organization.");
    }
    const customerId = idOf(session.customer);
    if (!customerId || !/^cus_[a-zA-Z0-9_]+$/.test(customerId)) {
      throw new Error("Checkout session is missing its customer.");
    }

    const key = stripeSecretKey(event.livemode);

    await client
      .query(
        `INSERT INTO tc_stripe_customers (organization_id,customer_id,livemode) VALUES ($1,$2,$3)
         ON CONFLICT (organization_id) DO UPDATE SET synced_at=now()
         WHERE tc_stripe_customers.customer_id=EXCLUDED.customer_id AND tc_stripe_customers.livemode=EXCLUDED.livemode
         RETURNING organization_id`,
        [checkout.organization_id, customerId, event.livemode],
      )
      .then((result) => {
        if (!result.rowCount)
          throw new Error("Organization already has another billing customer.");
      });

    // Already subscribed by an earlier delivery of this same event — avoid
    // creating a second subscription on webhook retry.
    const existingSubs = subscriptionListSchema.parse(
      await stripeGetJson(
        `subscriptions?${new URLSearchParams({ customer: customerId, status: "all", limit: "10" })}`,
        key,
      ),
    );
    const alreadySubscribed = existingSubs.data.some((s) =>
      ["active", "trialing", "past_due", "unpaid"].includes(s.status),
    );

    if (!alreadySubscribed) {
      const paymentIntentId = idOf(session.payment_intent);
      let paymentMethodId: string | null = null;
      if (paymentIntentId) {
        const intent = paymentIntentSchema.parse(
          await stripeGetJson(`payment_intents/${encodeURIComponent(paymentIntentId)}`, key),
        );
        paymentMethodId = idOf(intent.payment_method);
      }
      if (paymentMethodId) {
        await stripeForm(
          `customers/${encodeURIComponent(customerId)}`,
          key,
          new URLSearchParams({
            "invoice_settings[default_payment_method]": paymentMethodId,
          }),
        );
      }

      const deferral = (
        await client.query(
          "SELECT billing_start_at FROM tc_billing_deferrals WHERE organization_id=$1",
          [checkout.organization_id],
        )
      ).rows[0] as { billing_start_at: string } | undefined;
      const billingStart = deferral
        ? new Date(deferral.billing_start_at)
        : oneCalendarMonthLater(new Date());

      const subBody = new URLSearchParams({
        customer: customerId,
        "items[0][price]": recurringPriceId(checkout.plan, event.livemode),
        trial_end: String(Math.floor(billingStart.getTime() / 1000)),
        "trial_settings[end_behavior][missing_payment_method]": "cancel",
        "metadata[organization_id]": checkout.organization_id,
      });
      if (paymentMethodId) subBody.set("default_payment_method", paymentMethodId);
      await stripeForm("subscriptions", key, subBody, `${checkout.id}:subscribe`);

      await client.query(
        "UPDATE tc_installation_checkouts SET status='subscribed', billing_start_at=$2, updated_at=now() WHERE id=$1",
        [checkout.id, billingStart.toISOString()],
      );
    } else {
      await client.query(
        "UPDATE tc_installation_checkouts SET status='subscribed', updated_at=now() WHERE id=$1",
        [checkout.id],
      );
    }

    await client.query("COMMIT");
    paidInstallation = referralPayment(checkout, session.id, session.payment_intent, event);
    return { handled: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    // Referral bookkeeping: best effort, never throws, never delays billing's answer
    // beyond one lookup. See src/product/referrals/billing-hooks.ts.
    if (paidInstallation) await referralInstallationPaid(paidInstallation);
  }
}

function referralPayment(
  checkout: { organization_id: string; plan: PlanId },
  sessionId: string,
  paymentIntent: string | { id: string } | null | undefined,
  event: { livemode: boolean },
): Parameters<typeof referralInstallationPaid>[0] {
  return {
    organizationId: checkout.organization_id,
    plan: checkout.plan,
    checkoutSessionId: sessionId,
    paymentIntentId: idOf(paymentIntent) ?? undefined,
    livemode: event.livemode,
  };
}

export type InstallationStatus = {
  status: "none" | "pending" | "paid" | "subscribed" | "failed" | "canceled";
  plan: PlanId | null;
  billingStartAt: string | null;
  checkoutUrl?: string;
};

/** For the billing dashboard: where the org's installation/first billing stands. */
export async function getInstallationStatus(
  organizationId: string,
): Promise<InstallationStatus> {
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    return { status: "none", plan: null, billingStartAt: null };
  }
  const row = (
    await getPgPool(url).query(
      `SELECT plan, status, billing_start_at FROM tc_installation_checkouts
       WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [organizationId],
    )
  ).rows[0] as
    | { plan: PlanId; status: InstallationStatus["status"]; billing_start_at: string | null }
    | undefined;
  if (!row) return { status: "none", plan: null, billingStartAt: null };
  return {
    status: row.status,
    plan: row.plan,
    billingStartAt: row.billing_start_at,
  };
}

/**
 * Administrator-only override of the first recurring billing date, for
 * onboarding delays. Only effective before the subscription is created —
 * once `tc_installation_checkouts.status = 'subscribed'`, Stripe's
 * `trial_end` is already fixed and must be changed through the Stripe
 * dashboard or a dedicated reschedule flow (not built here).
 */
export async function setBillingDeferral(
  organizationId: string,
  billingStartAt: Date,
  reason: string,
  setByUserId: string,
): Promise<void> {
  const url = requireDurableStore();
  await getPgPool(url).query(
    `INSERT INTO tc_billing_deferrals (organization_id, billing_start_at, reason, set_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id) DO UPDATE SET
       billing_start_at = EXCLUDED.billing_start_at,
       reason = EXCLUDED.reason,
       set_by = EXCLUDED.set_by,
       created_at = now()`,
    [organizationId, billingStartAt.toISOString(), reason, setByUserId],
  );
}
