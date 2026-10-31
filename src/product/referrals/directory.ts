/**
 * Production wiring for the referral rules: who an organization is (SaaS
 * store), what it has paid (the installation checkout rows the billing code
 * already keeps) and whether a payment still stands (a read-only Stripe call).
 *
 * Nothing here writes to billing tables. If any of it fails, the referral rule
 * that asked fails closed; billing itself is never involved.
 */
import type { Pool } from "pg";
import { stripeSecretKey } from "@/product/saas/stripe-key";
import type { SaasStore } from "@/product/saas/store";
import type {
  OrganizationFacts,
  PaidInstallation,
  PaymentCheck,
  ReferralDirectory,
} from "./service";
import type { PlanId } from "@/product/saas/plan-catalog";

type Options = {
  store: SaasStore;
  /** Absent in development without a database: billing facts are then assumed. */
  pool?: Pool;
  fetchImpl?: typeof fetch;
};

const STRIPE_VERSION = "2025-02-24.acacia";

export function createSaasReferralDirectory({
  store,
  pool,
  fetchImpl = fetch,
}: Options): ReferralDirectory {
  async function stripeGet(path: string, livemode: boolean): Promise<unknown> {
    const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      headers: {
        Authorization: `Bearer ${stripeSecretKey(livemode)}`,
        "Stripe-Version": STRIPE_VERSION,
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Stripe request failed (${response.status})`);
    return response.json();
  }

  async function checkoutSession(sessionId: string, livemode: boolean) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("Invalid session id");
    const query = new URLSearchParams();
    query.append("expand[]", "payment_intent.latest_charge");
    return (await stripeGet(
      `checkout/sessions/${encodeURIComponent(sessionId)}?${query}`,
      livemode,
    )) as StripeSession;
  }

  return {
    async getOrganization(id): Promise<OrganizationFacts | null> {
      const org = await store.getOrganization(id);
      if (!org) return null;
      return {
        id: org.id,
        name: org.name,
        status: org.status,
        accountType: org.accountType,
        plan: org.plan,
        phoneE164: org.phoneE164,
      };
    },

    async getOwnerEmails(organizationId) {
      const memberships = await store.listMembershipsForOrganization(organizationId);
      const decisionMakers = memberships.filter(
        (m) => m.role === "owner" || m.role === "admin",
      );
      const users = await store.listUsers(decisionMakers.map((m) => m.userId));
      return users.map((u) => u.email);
    },

    async getBillingCustomerId(organizationId) {
      if (!pool) return null;
      const { rows } = await pool.query<{ customer_id: string }>(
        `SELECT customer_id FROM tc_stripe_customers WHERE organization_id = $1`,
        [organizationId],
      );
      return rows[0]?.customer_id ?? null;
    },

    async hasPaidAccess(organizationId) {
      // No database means no billing records (local development): don't block the flow.
      if (!pool) return true;
      const { rows } = await pool.query(
        `SELECT 1 FROM tc_installation_checkouts
           WHERE organization_id = $1 AND status IN ('paid', 'subscribed')
         UNION ALL
         SELECT 1 FROM tc_stripe_subscriptions
           WHERE organization_id = $1 AND status IN ('active', 'trialing', 'past_due')
         LIMIT 1`,
        [organizationId],
      );
      return rows.length > 0;
    },

    async getPaidInstallation(organizationId): Promise<PaidInstallation | null> {
      if (!pool) return null;
      const { rows } = await pool.query<{
        plan: PlanId;
        checkout_session_id: string | null;
        livemode: boolean;
        updated_at: Date;
      }>(
        `SELECT plan, checkout_session_id, livemode, updated_at
           FROM tc_installation_checkouts
          WHERE organization_id = $1 AND status IN ('paid', 'subscribed')
            AND checkout_session_id IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [organizationId],
      );
      const row = rows[0];
      if (!row?.checkout_session_id) return null;
      let paymentIntentId: string | undefined;
      try {
        const session = await checkoutSession(row.checkout_session_id, row.livemode);
        paymentIntentId = idOf(session.payment_intent) ?? undefined;
      } catch {
        // Qualify anyway; the payment is re-verified with Stripe before approval.
      }
      return {
        plan: row.plan,
        checkoutSessionId: row.checkout_session_id,
        paymentIntentId,
        livemode: row.livemode,
        paidAt: new Date(row.updated_at).toISOString(),
      };
    },

    async verifyPayment({ checkoutSessionId, livemode }): Promise<PaymentCheck> {
      try {
        const session = await checkoutSession(checkoutSessionId, livemode);
        if (session.livemode !== livemode) return { ok: false, reason: "unavailable" };
        if (session.payment_status !== "paid") return { ok: false, reason: "not_paid" };
        const intent =
          session.payment_intent && typeof session.payment_intent === "object"
            ? session.payment_intent
            : null;
        const charge =
          intent?.latest_charge && typeof intent.latest_charge === "object"
            ? intent.latest_charge
            : null;
        // A paid session whose charge cannot be read is not verified.
        if (!intent || !charge) return { ok: false, reason: "unavailable" };
        if (intent.status !== "succeeded") return { ok: false, reason: "not_paid" };
        if (charge.disputed) return { ok: false, reason: "disputed" };
        const refunded = Number(charge.amount_refunded ?? 0);
        if (charge.refunded || (refunded > 0 && refunded >= Number(charge.amount ?? 0))) {
          return { ok: false, reason: "refunded" };
        }
        return refunded > 0 ? { ok: true, partiallyRefunded: true } : { ok: true };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
  };
}

type StripeCharge = {
  amount?: number;
  amount_refunded?: number;
  refunded?: boolean;
  disputed?: boolean;
};
type StripeIntent = { id?: string; status?: string; latest_charge?: StripeCharge | string | null };
type StripeSession = {
  livemode: boolean;
  payment_status?: string;
  payment_intent?: StripeIntent | string | null;
};

function idOf(value: StripeIntent | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}
