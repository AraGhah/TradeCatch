import type { ReliabilityService } from "@/product/reliability/service";
import {
  countRecentFailedPayments,
  listBillingEvents,
  listSubscriptionRows,
  type SubscriptionRow,
} from "./billing-db";
import type { AdminDb } from "./db";
import {
  listStripeSubscriptions,
  monthlyRecurringCents,
  type StripeContext,
  type StripeSubscription,
} from "./stripe-admin";

/**
 * The numbers on the console's Overview page and the alerts beside them. Every
 * figure is read from a system of record at request time. Where a figure can
 * come from Stripe (revenue), it says whether it did; when Stripe cannot be
 * reached the figure falls back to the catalog price of the active accounts and
 * is labelled as such, never presented as Stripe's number.
 */

export type OverviewAlert = {
  id: string;
  kind:
    | "failed_payment"
    | "past_due_subscription"
    | "webhook_failure"
    | "service_error"
    | "incident"
    | "failed_job"
    | "website_request"
    | "suspicious_admin_activity";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string | null;
  at: string | null;
  /** Where in the console to act on it. */
  href: string;
};

export type Overview = {
  generatedAt: string;
  kpis: {
    customers: number;
    activeSubscriptions: number;
    suspended: number;
    mrr: {
      amountCad: number;
      source: "stripe" | "catalog";
      /** Why the figure is not from Stripe, when it is not. */
      note: string | null;
    };
    failedPayments30d: number;
    pastDueSubscriptions: number;
    calls: number;
    openAlerts: number;
    pendingWebsiteRequests: number;
  };
  alerts: OverviewAlert[];
};

export type OverviewInputs = {
  /** The platform snapshot's counts (businesses, active, calls...). */
  platform: {
    businesses: number;
    activeSubscriptions: number;
    suspended: number;
    mrr: number;
    calls: number;
  };
  stripe: StripeContext;
  reliability: ReliabilityService;
  db: AdminDb | null;
  pendingWebsiteRequests: number;
  /** Denied administrator attempts in the last day, from the audit log. */
  deniedAdminAttempts24h: number;
  subscriptionRows?: SubscriptionRow[];
  stripeSubscriptions?: () => Promise<StripeSubscription[]>;
  now?: Date;
};

const MRR_CACHE_MS = 60_000;
let mrrCache: { at: number; livemode: boolean; cents: number } | null = null;
export function resetOverviewCacheForTests() {
  mrrCache = null;
}

async function stripeMrrCad(stripe: StripeContext & { configured: true }): Promise<number> {
  if (mrrCache && mrrCache.livemode === stripe.livemode && Date.now() - mrrCache.at < MRR_CACHE_MS) {
    return mrrCache.cents / 100;
  }
  const rows: StripeSubscription[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const result = await listStripeSubscriptions(stripe.http, stripe.livemode, {
      status: "all",
      limit: 100,
      startingAfter: cursor,
    });
    rows.push(...result.rows);
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  const cad = monthlyRecurringCents(rows).find((m) => m.currency === "CAD")?.cents ?? 0;
  mrrCache = { at: Date.now(), livemode: stripe.livemode, cents: cad };
  return cad / 100;
}

export async function buildOverview(input: OverviewInputs): Promise<Overview> {
  const now = input.now ?? new Date();
  const alerts: OverviewAlert[] = [];

  // Money
  let mrr: Overview["kpis"]["mrr"] = {
    amountCad: input.platform.mrr,
    source: "catalog",
    note: input.stripe.configured
      ? null
      : "Stripe is not configured on this server; this is the catalog price of the active accounts.",
  };
  if (input.stripe.configured) {
    try {
      mrr = { amountCad: await stripeMrrCad(input.stripe), source: "stripe", note: null };
    } catch {
      mrr = {
        amountCad: input.platform.mrr,
        source: "catalog",
        note: "Stripe could not be reached; this is the catalog price of the active accounts.",
      };
    }
  }

  const subscriptionRows =
    input.subscriptionRows ?? (await listSubscriptionRows(input.db).catch(() => []));
  const pastDue = subscriptionRows.filter((s) => ["past_due", "unpaid"].includes(s.status));
  for (const sub of pastDue.slice(0, 10)) {
    alerts.push({
      id: `sub:${sub.subscriptionId}`,
      kind: "past_due_subscription",
      severity: "warning",
      title: "Subscription payment is overdue",
      detail: `${sub.plan} · ${sub.status}`,
      at: sub.syncedAt,
      href: "/admin/subscriptions",
    });
  }

  const failures = await listBillingEvents({ outcome: "failed", limit: 10 }, input.db).catch(
    () => ({ rows: [], total: 0 }),
  );
  const failedPayments30d = await countRecentFailedPayments(30, input.db, now).catch(() => 0);
  for (const event of failures.rows.slice(0, 5)) {
    alerts.push({
      id: `pay:${event.eventId}`,
      kind: "failed_payment",
      severity: "critical",
      title: "Payment failed",
      detail: [
        event.amountCents != null && event.currency
          ? `${(event.amountCents / 100).toFixed(2)} ${event.currency}`
          : null,
        event.attemptCount != null ? `attempt ${event.attemptCount}` : null,
        event.invoiceId,
      ]
        .filter(Boolean)
        .join(" · "),
      at: event.createdAt,
      href: "/admin/payments",
    });
  }

  // Platform health
  try {
    const overview = await input.reliability.overview();
    for (const incident of overview.incidents.slice(0, 5)) {
      alerts.push({
        id: `inc:${incident.id}`,
        kind: "incident",
        severity: incident.severity === "critical" || incident.severity === "high" ? "critical" : "warning",
        title: incident.title,
        detail: incident.service,
        at: incident.createdAt,
        href: "/admin/system-health",
      });
    }
    const errors = (await input.reliability.listErrors()).filter((e) => e.status !== "resolved");
    const webhook = errors.filter((e) => /webhook/i.test(e.operation));
    for (const error of webhook.slice(0, 5)) {
      alerts.push({
        id: `err:${error.id}`,
        kind: "webhook_failure",
        severity: error.severity === "low" ? "info" : "warning",
        title: `Webhook failure: ${error.service}`,
        detail: `${error.operation} · ${error.errorCode}`,
        at: error.createdAt,
        href: "/admin/system-health",
      });
    }
    for (const error of errors.filter((e) => !/webhook/i.test(e.operation)).slice(0, 5)) {
      alerts.push({
        id: `err:${error.id}`,
        kind: "service_error",
        severity: error.severity === "critical" || error.severity === "high" ? "critical" : "warning",
        title: `${error.service} error`,
        detail: `${error.operation} · ${error.errorCode}`,
        at: error.createdAt,
        href: "/admin/system-health",
      });
    }
    const jobs = await input.reliability.jobs();
    if (jobs.failed + jobs.dead > 0) {
      alerts.push({
        id: "jobs:failed",
        kind: "failed_job",
        severity: jobs.dead > 0 ? "critical" : "warning",
        title: "Background jobs have failed",
        detail: `${jobs.failed} failed, ${jobs.dead} gave up`,
        at: null,
        href: "/admin/system-health",
      });
    }
  } catch {
    // Health data being unavailable is itself shown on the System Health page.
  }

  if (input.pendingWebsiteRequests > 0) {
    alerts.push({
      id: "web:pending",
      kind: "website_request",
      severity: "info",
      title: `${input.pendingWebsiteRequests} website request${input.pendingWebsiteRequests === 1 ? "" : "s"} waiting for review`,
      detail: null,
      at: null,
      href: "/admin/website-requests",
    });
  }
  if (input.deniedAdminAttempts24h > 0) {
    alerts.push({
      id: "admin:denied",
      kind: "suspicious_admin_activity",
      severity: input.deniedAdminAttempts24h >= 5 ? "critical" : "warning",
      title: `${input.deniedAdminAttempts24h} administrator request${input.deniedAdminAttempts24h === 1 ? "" : "s"} refused in the last 24 hours`,
      detail: "An administrator reached past their role.",
      at: null,
      href: "/admin/audit-logs",
    });
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  alerts.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] || (b.at ?? "").localeCompare(a.at ?? ""),
  );

  return {
    generatedAt: now.toISOString(),
    kpis: {
      customers: input.platform.businesses,
      activeSubscriptions: input.platform.activeSubscriptions,
      suspended: input.platform.suspended,
      mrr,
      failedPayments30d,
      pastDueSubscriptions: pastDue.length,
      calls: input.platform.calls,
      openAlerts: alerts.filter((a) => a.severity !== "info").length,
      pendingWebsiteRequests: input.pendingWebsiteRequests,
    },
    alerts: alerts.slice(0, 20),
  };
}
