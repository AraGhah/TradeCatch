"use client";

import { useEffect, useState } from "react";

type AccountRow = {
  businessId: string;
  businessName: string | null;
  accountType: string | null;
  organizationPlan: string | null;
  subscription: {
    plan: string;
    status: string;
    billingInterval: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    gracePeriodEndsAt: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    outstandingBalanceCents: number;
  };
};

type FailurePayload = {
  failedWebhooks: Array<{
    stripeEventId: string;
    type: string;
    error: string | null;
    receivedAt: string;
  }>;
  paymentFailures: Array<{
    businessId: string;
    status: string;
    plan: string;
    gracePeriodEndsAt: string | null;
    latestInvoiceId: string | null;
    updatedAt: string;
  }>;
};

export function AdminBillingPanel() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [failures, setFailures] = useState<FailurePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [a, f] = await Promise.all([
          fetch("/api/admin/billing/accounts", { cache: "no-store" }),
          fetch("/api/admin/billing/failures", { cache: "no-store" }),
        ]);
        const aj = (await a.json()) as {
          ok?: boolean;
          accounts?: AccountRow[];
          error?: string;
        };
        const fj = (await f.json()) as FailurePayload & {
          ok?: boolean;
          error?: string;
        };
        if (!a.ok) {
          setError(aj.error || "Failed to load billing accounts");
          return;
        }
        if (!f.ok) {
          setError(fj.error || "Failed to load billing failures");
          return;
        }
        setAccounts(aj.accounts ?? []);
        setFailures(fj);
        setError(null);
      } catch {
        setError("Failed to load admin billing");
      }
    })();
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-[family-name:var(--font-archivo)] text-xl font-extrabold text-navy">
          Billing overview
        </h2>
        <p className="mt-1 text-sm text-navy/65">
          Stripe-backed subscriptions, past-due accounts, and failed webhooks.
        </p>
      </header>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          Accounts ({accounts.length})
        </h3>
        {accounts.length === 0 ? (
          <p className="mt-2 text-sm text-navy/60">No Stripe subscriptions yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-navy/10">
            {accounts.map((row) => (
              <li key={row.businessId} className="py-3 text-sm">
                <p className="font-medium text-navy">
                  {row.businessName || row.businessId} · {row.subscription.plan} ·{" "}
                  {row.subscription.status}
                </p>
                <p className="text-navy/60">
                  org plan {row.organizationPlan} · {row.accountType} ·{" "}
                  {row.subscription.stripeSubscriptionId || "no sub id"}
                  {row.subscription.gracePeriodEndsAt
                    ? ` · grace until ${row.subscription.gracePeriodEndsAt}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          Payment failures ({failures?.paymentFailures.length ?? 0})
        </h3>
        <ul className="mt-3 divide-y divide-navy/10">
          {(failures?.paymentFailures ?? []).map((row) => (
            <li key={`${row.businessId}-${row.updatedAt}`} className="py-2 text-sm text-navy">
              {row.businessId} · {row.status} · {row.plan}
              {row.gracePeriodEndsAt ? ` · grace ${row.gracePeriodEndsAt}` : ""}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          Failed webhooks ({failures?.failedWebhooks.length ?? 0})
        </h3>
        <ul className="mt-3 divide-y divide-navy/10">
          {(failures?.failedWebhooks ?? []).map((row) => (
            <li key={row.stripeEventId} className="py-2 text-sm text-navy">
              {row.type} · {row.stripeEventId}
              {row.error ? ` · ${row.error}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
