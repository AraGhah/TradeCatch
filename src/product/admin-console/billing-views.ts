import type { SaasStore } from "@/product/saas/store";
import type { PlanId } from "@/product/saas/entitlements";
import type { OrgStatus } from "@/product/saas/types";
import {
  organizationsByCustomers,
  type SubscriptionRow,
} from "./billing-db";
import {
  listStripeInvoices,
  listStripeSubscriptions,
  loadPlanPrices,
  summarizeOutstanding,
  type InvoiceStatusFilter,
  type PlanPrice,
  type StripeContext,
  type StripeInvoice,
  type StripeSubscription,
  type SubscriptionStatusFilter,
} from "./stripe-admin";

/**
 * Joins what Stripe says (money, status, dates) with what TradeCatch recorded
 * (which business owns the customer, which plan it currently grants). Where the
 * two disagree, the row says so: the administrator sees drift instead of a
 * quiet wrong number.
 */

type OrgRef = { id: string; name: string; plan: PlanId; status: OrgStatus };

async function orgRefs(store: SaasStore, ids: readonly string[]): Promise<Map<string, OrgRef>> {
  const map = new Map<string, OrgRef>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const org = await store.getOrganization(id).catch(() => null);
      if (org) map.set(id, { id: org.id, name: org.name, plan: org.plan, status: org.status });
    }),
  );
  return map;
}

export type SubscriptionView = StripeSubscription & {
  organization: OrgRef | null;
  /** What TradeCatch last synchronized, if it has. */
  recorded: { plan: string; status: string; cancelAtPeriodEnd: boolean; syncedAt: string } | null;
  /** Fields where Stripe and the database disagree. Empty means in sync. */
  drift: ("status" | "plan" | "cancellation" | "not_recorded")[];
};

export type SubscriptionsResult = {
  stripe: { configured: boolean; livemode: boolean | null; reason: string | null };
  source: "stripe" | "database";
  prices: PlanPrice[];
  subscriptions: SubscriptionView[];
  hasMore: boolean;
  nextCursor: string | null;
  note: string | null;
};

export function driftOf(
  sub: Pick<StripeSubscription, "status" | "plan" | "cancelAtPeriodEnd">,
  recorded: SubscriptionRow | undefined,
): SubscriptionView["drift"] {
  if (!recorded) return ["not_recorded"];
  const drift: SubscriptionView["drift"] = [];
  if (recorded.status !== sub.status) drift.push("status");
  if (sub.plan && recorded.plan !== sub.plan) drift.push("plan");
  if (recorded.cancelAtPeriodEnd !== sub.cancelAtPeriodEnd) drift.push("cancellation");
  return drift;
}

export async function loadSubscriptions(input: {
  stripe: StripeContext;
  rows: SubscriptionRow[];
  store: SaasStore;
  status?: SubscriptionStatusFilter;
  cursor?: string;
  limit?: number;
  env?: Record<string, string | undefined>;
}): Promise<SubscriptionsResult> {
  const { stripe, rows, store } = input;
  const recordedBySub = new Map(rows.map((r) => [r.subscriptionId, r]));

  if (!stripe.configured) {
    // No Stripe key on this server: show only what the database recorded, and say so.
    const orgs = await orgRefs(store, rows.map((r) => r.organizationId));
    const filtered = rows.filter((r) => !input.status || input.status === "all" || r.status === input.status);
    return {
      stripe: { configured: false, livemode: null, reason: stripe.reason },
      source: "database",
      prices: [],
      subscriptions: filtered.slice(0, input.limit ?? 25).map((r) => ({
        id: r.subscriptionId,
        status: r.status,
        customerId: r.customerId,
        customerEmail: null,
        customerName: null,
        metadataOrganizationId: r.organizationId,
        priceId: null,
        plan: r.plan as PlanId,
        unitAmountCents: null,
        currency: null,
        interval: null,
        cancelAtPeriodEnd: r.cancelAtPeriodEnd,
        currentPeriodEnd: r.currentPeriodEnd,
        latestInvoiceId: r.latestInvoiceId,
        createdAt: null,
        livemode: r.livemode,
        itemId: null,
        itemCount: 1,
        organization: orgs.get(r.organizationId) ?? null,
        recorded: {
          plan: r.plan,
          status: r.status,
          cancelAtPeriodEnd: r.cancelAtPeriodEnd,
          syncedAt: r.syncedAt,
        },
        drift: [],
      })),
      hasMore: false,
      nextCursor: null,
      note: "Stripe is not configured on this server, so prices and amounts are not available. These are the subscriptions TradeCatch recorded.",
    };
  }

  const [prices, page] = await Promise.all([
    loadPlanPrices(stripe.http, stripe.livemode, input.env),
    listStripeSubscriptions(
      stripe.http,
      stripe.livemode,
      { status: input.status, limit: input.limit, startingAfter: input.cursor },
      input.env,
    ),
  ]);
  const customerOrg = await organizationsByCustomers(page.rows.map((s) => s.customerId)).catch(
    () => new Map<string, string>(),
  );
  // Prefer the database mapping; fall back to the recorded subscription's org.
  const orgIdFor = (s: StripeSubscription) =>
    customerOrg.get(s.customerId) ?? recordedBySub.get(s.id)?.organizationId ?? null;
  const orgs = await orgRefs(
    store,
    page.rows.map(orgIdFor).filter((id): id is string => Boolean(id)),
  );
  return {
    stripe: { configured: true, livemode: stripe.livemode, reason: null },
    source: "stripe",
    prices,
    subscriptions: page.rows.map((s) => {
      const recorded = recordedBySub.get(s.id);
      const orgId = orgIdFor(s);
      return {
        ...s,
        organization: orgId ? (orgs.get(orgId) ?? null) : null,
        recorded: recorded
          ? {
              plan: recorded.plan,
              status: recorded.status,
              cancelAtPeriodEnd: recorded.cancelAtPeriodEnd,
              syncedAt: recorded.syncedAt,
            }
          : null,
        drift: driftOf(s, recorded),
      };
    }),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    note: stripe.livemode
      ? null
      : "Stripe is in TEST mode on this server: these are test subscriptions, not real customers.",
  };
}

export type PaymentsResult = {
  stripe: SubscriptionsResult["stripe"];
  invoices: (StripeInvoice & { organization: OrgRef | null })[];
  invoicesHasMore: boolean;
  invoicesNextCursor: string | null;
  outstanding: ReturnType<typeof summarizeOutstanding>;
  note: string | null;
};

export async function loadInvoices(input: {
  stripe: StripeContext;
  store: SaasStore;
  status?: InvoiceStatusFilter;
  customerId?: string;
  cursor?: string;
  limit?: number;
}): Promise<PaymentsResult> {
  const { stripe, store } = input;
  if (!stripe.configured) {
    return {
      stripe: { configured: false, livemode: null, reason: stripe.reason },
      invoices: [],
      invoicesHasMore: false,
      invoicesNextCursor: null,
      outstanding: [],
      note: "Stripe is not configured on this server, so invoices are not available.",
    };
  }
  const page = await listStripeInvoices(stripe.http, {
    status: input.status,
    customerId: input.customerId,
    limit: input.limit,
    startingAfter: input.cursor,
  });
  const customerOrg = await organizationsByCustomers(
    page.rows.map((i) => i.customerId).filter((id): id is string => Boolean(id)),
  ).catch(() => new Map<string, string>());
  const orgs = await orgRefs(store, [...customerOrg.values()]);
  // Outstanding is always over the OPEN invoices, whatever page or filter is shown.
  const open =
    input.status === "open" || !input.status || input.status === "all"
      ? page.rows
      : (await listStripeInvoices(stripe.http, { status: "open", limit: 100 })).rows;
  return {
    stripe: { configured: true, livemode: stripe.livemode, reason: null },
    invoices: page.rows.map((i) => ({
      ...i,
      organization: i.customerId ? (orgs.get(customerOrg.get(i.customerId) ?? "") ?? null) : null,
    })),
    invoicesHasMore: page.hasMore,
    invoicesNextCursor: page.nextCursor,
    outstanding: summarizeOutstanding(open),
    note: stripe.livemode ? null : "Stripe is in TEST mode on this server.",
  };
}
