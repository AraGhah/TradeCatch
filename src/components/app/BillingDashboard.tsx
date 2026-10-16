"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { PlanId } from "@/product/saas/entitlements";

type PlanCard = {
  id: PlanId;
  name: { en: string; fr: string };
  description: { en: string; fr: string };
  currency: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  setupFeeCents: number;
  trialDays: number;
  features: string[];
  allowances: Record<string, number>;
  usagePolicy: string;
  taxesNote: { en: string; fr: string };
  cancellationNote: { en: string; fr: string };
};

type BillingPayload = {
  ok: boolean;
  canManage?: boolean;
  subscription: {
    plan: PlanId;
    status: string;
    billingInterval: string;
    unitAmountCents: number | null;
    currency: string;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    paymentMethodBrand: string | null;
    paymentMethodLast4: string | null;
    outstandingBalanceCents: number;
    gracePeriodEndsAt: string | null;
    stripeSubscriptionId: string | null;
  } | null;
  entitlements: {
    plan: PlanId;
    status: string;
    features: string[];
    accessMode: string;
    reason: string | null;
    trialEndsAt: string | null;
  };
  usage: {
    billingPeriodStart: string;
    billingPeriodEnd: string;
    metrics: Array<{
      metric: string;
      used: number;
      included: number;
      remaining: number;
      overage: number;
      estimatedOverageCents: number;
      policy: string;
    }>;
  };
  invoices: Array<{
    stripeInvoiceId: string;
    number: string | null;
    status: string;
    currency: string;
    subtotalCents: number;
    taxCents: number;
    overageCents: number;
    totalCents: number;
    periodStart: string | null;
    periodEnd: string | null;
    plan: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
  }>;
  plans: PlanCard[];
};

function money(cents: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(iso: string | null, locale: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
  }).format(new Date(iso));
}

export function BillingDashboard({
  organizationId,
  locale,
  checkoutState,
}: {
  organizationId: string;
  locale: "en" | "fr";
  checkoutState?: string | null;
}) {
  const t = useTranslations("app.billing");
  const [data, setData] = useState<BillingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [pending, startTransition] = useTransition();
  const [section, setSection] = useState<
    "subscription" | "plans" | "usage" | "invoices" | "trial"
  >("subscription");

  async function load() {
    const res = await fetch(`/api/businesses/${organizationId}/billing`, {
      cache: "no-store",
    });
    const json = (await res.json()) as BillingPayload & { error?: string };
    if (!res.ok) {
      setError(json.error || t("loadError"));
      return;
    }
    setData(json);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/businesses/${organizationId}/billing`, {
        cache: "no-store",
      });
      const json = (await res.json()) as BillingPayload & { error?: string };
      if (cancelled) return;
      if (!res.ok) {
        setError(json.error || t("loadError"));
        return;
      }
      setData(json);
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, t]);

  function checkout(plan: PlanId, withTrial?: boolean) {
    startTransition(async () => {
      setError(null);
      const res = await fetch(
        `/api/businesses/${organizationId}/billing/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            interval,
            withTrial: Boolean(withTrial),
            idempotencyKey: `web_${organizationId}_${plan}_${interval}_${Date.now()}`,
          }),
        },
      );
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error || t("checkoutError"));
        return;
      }
      window.location.href = json.url;
    });
  }

  function openPortal() {
    startTransition(async () => {
      setError(null);
      const res = await fetch(
        `/api/businesses/${organizationId}/billing/portal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ returnPath: "/app/billing" }),
        },
      );
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error || t("portalError"));
        return;
      }
      window.location.href = json.url;
    });
  }

  function startTrial(plan: PlanId) {
    startTransition(async () => {
      setError(null);
      const res = await fetch(
        `/api/businesses/${organizationId}/billing/trial`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, interval }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("trialError"));
        return;
      }
      await load();
      setSection("subscription");
    });
  }

  const tabs = [
    { id: "subscription" as const, label: t("tabs.subscription") },
    { id: "plans" as const, label: t("tabs.plans") },
    { id: "usage" as const, label: t("tabs.usage") },
    { id: "invoices" as const, label: t("tabs.invoices") },
    { id: "trial" as const, label: t("tabs.trial") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
        {checkoutState === "success" ? (
          <p className="mt-3 text-sm text-navy/80">{t("checkoutSuccess")}</p>
        ) : null}
        {checkoutState === "cancel" ? (
          <p className="mt-3 text-sm text-navy/60">{t("checkoutCancel")}</p>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2 border-b border-navy/10 pb-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              section === tab.id
                ? "bg-navy text-white"
                : "text-navy/70 hover:bg-navy/5"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}

      {!data ? (
        <p className="text-sm text-navy/60">{t("loading")}</p>
      ) : null}

      {data && section === "subscription" ? (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("subscriptionTitle")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-navy/45">
                {t("currentPlan")}
              </p>
              <p className="mt-1 text-lg font-semibold text-navy">
                {data.subscription?.plan ?? data.entitlements.plan}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-navy/45">
                {t("status")}
              </p>
              <p className="mt-1 text-lg font-semibold text-navy">
                {data.subscription?.status ?? data.entitlements.status}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-navy/45">
                {t("price")}
              </p>
              <p className="mt-1 text-navy">
                {data.subscription?.unitAmountCents != null
                  ? `${money(
                      data.subscription.unitAmountCents,
                      data.subscription.currency,
                      locale,
                    )} / ${data.subscription.billingInterval}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-navy/45">
                {t("nextRenewal")}
              </p>
              <p className="mt-1 text-navy">
                {formatDate(
                  data.subscription?.currentPeriodEnd ?? null,
                  locale,
                )}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-navy/45">
                {t("paymentMethod")}
              </p>
              <p className="mt-1 text-navy">
                {data.subscription?.paymentMethodLast4
                  ? `${data.subscription.paymentMethodBrand ?? "Card"} ···· ${data.subscription.paymentMethodLast4}`
                  : t("paymentManagedByStripe")}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-navy/45">
                {t("accessMode")}
              </p>
              <p className="mt-1 text-navy">{data.entitlements.accessMode}</p>
              {data.entitlements.reason ? (
                <p className="mt-1 text-sm text-navy/60">
                  {data.entitlements.reason}
                </p>
              ) : null}
            </div>
          </div>
          {data.canManage ? (
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => openPortal()}
                className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {t("manageInPortal")}
              </button>
              <button
                type="button"
                onClick={() => setSection("plans")}
                className="rounded-md border border-navy/20 px-4 py-2 text-sm font-medium text-navy"
              >
                {t("changePlan")}
              </button>
            </div>
          ) : null}
          <p className="text-sm text-navy/55">{t("portalHint")}</p>
        </section>
      ) : null}

      {data && section === "plans" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
              {t("plansTitle")}
            </h2>
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setInterval("month")}
                className={`rounded-md px-3 py-1.5 ${
                  interval === "month" ? "bg-navy text-white" : "bg-navy/5"
                }`}
              >
                {t("monthly")}
              </button>
              <button
                type="button"
                onClick={() => setInterval("year")}
                className={`rounded-md px-3 py-1.5 ${
                  interval === "year" ? "bg-navy text-white" : "bg-navy/5"
                }`}
              >
                {t("annual")}
              </button>
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {data.plans.map((plan) => {
              const price =
                interval === "year"
                  ? plan.annualPriceCents
                  : plan.monthlyPriceCents;
              const isCurrent =
                (data.subscription?.plan ?? data.entitlements.plan) ===
                plan.id;
              return (
                <article
                  key={plan.id}
                  className="flex flex-col gap-3 border-t border-navy/15 pt-4"
                >
                  <h3 className="text-xl font-semibold text-navy">
                    {plan.name[locale]}
                  </h3>
                  <p className="text-sm text-navy/65">
                    {plan.description[locale]}
                  </p>
                  <p className="text-2xl font-extrabold tracking-tight text-navy">
                    {money(price, plan.currency, locale)}
                    <span className="text-sm font-medium text-navy/55">
                      {" "}
                      / {interval === "year" ? t("year") : t("month")}
                    </span>
                  </p>
                  <p className="text-xs text-navy/50">
                    {t("setupFee")}:{" "}
                    {money(plan.setupFeeCents, plan.currency, locale)} ·{" "}
                    {plan.currency.toUpperCase()}
                  </p>
                  <p className="text-xs text-navy/50">
                    {t("allowances")}: SMS {plan.allowances.sms_segments}
                    {plan.allowances.ai_call_minutes > 0
                      ? ` · AI ${plan.allowances.ai_call_minutes} min`
                      : ""}
                  </p>
                  <p className="text-xs text-navy/45">
                    {plan.taxesNote[locale]}
                  </p>
                  {data.canManage ? (
                    <button
                      type="button"
                      disabled={pending || isCurrent}
                      onClick={() => checkout(plan.id)}
                      className="mt-auto rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {isCurrent ? t("currentBadge") : t("subscribe")}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          <p className="text-sm text-navy/55">{t("cancellationTerms")}</p>
        </section>
      ) : null}

      {data && section === "usage" ? (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("usageTitle")}
          </h2>
          <p className="text-sm text-navy/60">
            {t("usagePeriod")}:{" "}
            {formatDate(data.usage.billingPeriodStart, locale)} →{" "}
            {formatDate(data.usage.billingPeriodEnd, locale)}
          </p>
          <ul className="grid gap-4 sm:grid-cols-3">
            {data.usage.metrics.map((m) => (
              <li key={m.metric} className="border-t border-navy/12 pt-3">
                <p className="text-xs uppercase tracking-[0.08em] text-navy/45">
                  {m.metric.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-xl font-semibold text-navy">
                  {m.used} / {m.included}
                </p>
                <p className="text-sm text-navy/60">
                  {t("remaining")}: {m.remaining}
                </p>
                {m.overage > 0 ? (
                  <p className="text-sm text-navy/70">
                    {t("overage")}: {m.overage} (
                    {money(m.estimatedOverageCents, "cad", locale)})
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-sm text-navy/55">{t("usagePolicyNote")}</p>
        </section>
      ) : null}

      {data && section === "invoices" ? (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("invoicesTitle")}
          </h2>
          {data.invoices.length === 0 ? (
            <p className="text-sm text-navy/60">{t("noInvoices")}</p>
          ) : (
            <ul className="divide-y divide-navy/10">
              {data.invoices.map((inv) => (
                <li
                  key={inv.stripeInvoiceId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium text-navy">
                      {inv.number || inv.stripeInvoiceId}
                    </p>
                    <p className="text-sm text-navy/60">
                      {inv.plan ?? "—"} · {inv.status} ·{" "}
                      {formatDate(inv.periodStart, locale)} →{" "}
                      {formatDate(inv.periodEnd, locale)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-navy">
                      {money(inv.totalCents, inv.currency, locale)}
                    </p>
                    {inv.hostedInvoiceUrl ? (
                      <a
                        href={inv.hostedInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-orange underline-offset-2 hover:underline"
                      >
                        {t("download")}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {data && section === "trial" ? (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("trialTitle")}
          </h2>
          <p className="max-w-2xl text-sm text-navy/65">{t("trialIntro")}</p>
          {data.entitlements.trialEndsAt || data.subscription?.trialEndsAt ? (
            <p className="text-navy">
              {t("trialEnds")}:{" "}
              {formatDate(
                data.subscription?.trialEndsAt ??
                  data.entitlements.trialEndsAt,
                locale,
              )}
            </p>
          ) : null}
          {data.canManage ? (
            <div className="flex flex-wrap gap-3">
              {data.plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  disabled={pending || plan.trialDays <= 0}
                  onClick={() => startTrial(plan.id)}
                  className="rounded-md border border-navy/20 px-4 py-2 text-sm font-medium text-navy disabled:opacity-50"
                >
                  {t("startTrial")} {plan.name[locale]} ({plan.trialDays}d)
                </button>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  checkout(
                    data.subscription?.plan ?? data.entitlements.plan,
                    false,
                  )
                }
                className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {t("convertToPaid")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
