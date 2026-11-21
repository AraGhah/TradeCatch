import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireBillingContext } from "@/product/saas/tenant";
import { BillingPortalButton } from "@/components/app/BillingPortalButton";
import { CheckoutReturnWatcher } from "@/components/app/CheckoutReturnWatcher";
import { InstallationCheckoutButton } from "@/components/app/InstallationCheckoutButton";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";
import { Link } from "@/i18n/navigation";
import { orgHasFeature } from "@/product/saas/entitlements";
import { PLAN_PRICES, formatPlanPrice } from "@/lib/plans";
import { ADD_ONS, describePlan } from "@/product/saas/plan-catalog";
import { getSubscriptionSummary } from "@/product/saas/billing-summary";
import { billingPlanCard } from "@/product/saas/billing-view";
import { getInstallationStatus } from "@/product/saas/stripe-checkout";
import { listOverages, usageSummary } from "@/product/saas/usage-metering";
import { UsageOverageConfirm } from "@/components/app/UsageOverageConfirm";
import { SessionKeeper } from "@/components/app/SessionKeeper";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { locale } = await params;
  // Where Stripe sent the customer back from: only a hint. What the page says about payment comes from the server's own record.
  const { checkout: returned } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("app.account");
  const settingsT = await getTranslations("app.settings");
  const plansT = await getTranslations("plans");
  const access = await requireBillingContext();
  if (!access.ok && access.status === 401) {
    redirect(locale === "fr" ? "/fr/connexion" : "/login");
  }
  const org = access.ok ? access.ctx.organization : null;
  const [installation, subscription, usage, overages] = org
    ? await Promise.all([
        getInstallationStatus(org.id).catch(() => null),
        getSubscriptionSummary(org.id).catch(() => null),
        usageSummary(org.id, org.plan).catch(() => []),
        listOverages(org.id).catch(() => []),
      ])
    : [null, null, [], []];
  // Name, price and features come from the same catalog the website uses.
  const plan = org ? describePlan(org.plan) : null;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "fr" ? "fr-CA" : "en-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  // Every decision about what this card says lives in billingPlanCard (tested).
  const card =
    org && plan
      ? billingPlanCard({
          plan,
          subscription,
          installation,
          hasAppointments: orgHasFeature(org.plan, "APPOINTMENT_BOOKING"),
        })
      : null;
  // Back from Stripe's page, but our server has not recorded the payment yet (its webhook is still on its way).
  const confirming = returned === "success" && card !== null && card.checkout !== null;
  const confirmed = returned === "success" && card !== null && card.checkout === null;
  const canceledReturn = returned === "canceled" && card !== null && card.checkout !== null;
  // Setup and the monthly price are shown separately, in Canadian dollars, with the date of the first monthly charge.
  const websitePrice = formatPlanPrice(ADD_ONS.websiteService.priceCad, locale);
  const checkoutFigures = plan?.price
    ? {
        setup: formatPlanPrice(plan.price.setup, locale),
        monthly: formatPlanPrice(plan.price.monthly, locale),
      }
    : { setup: "", monthly: "" };
  return (
    <FullMessagesProvider>
      {access.ok ? (
        <SessionKeeper
          accessExpiresAt={access.ctx.accessExpiresAt}
          locale={locale === "fr" ? "fr" : "en"}
        />
      ) : null}
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-12">
        <h1 className="text-2xl font-bold text-navy">{t("billingHeadline")}</h1>
        {access.ok && org && plan && card ? (
          <>
            <p className="text-navy/80">
              {org.status === "active"
                ? t("billingActive")
                : t("billingRecovery")}
            </p>

            <div className="rounded-lg border border-navy/15 p-4">
              <p className="text-sm font-semibold text-navy">
                {card.planLine.kind === "priced"
                  ? t("billingPlanLine", {
                      plan: plan.name,
                      amount: formatPlanPrice(card.planLine.monthly, locale),
                    })
                  : t("billingPlanLineLegacy", { plan: plan.name })}
              </p>
              {card.status ? (
                <p className="mt-1 text-sm text-navy/70">
                  {card.status === "active"
                    ? t("billingStatusActive")
                    : card.status === "payment_needed"
                      ? t("billingStatusPaymentNeeded")
                      : t("billingStatusCanceled")}
                </p>
              ) : null}
              {card.date ? (
                <p className="mt-1 text-sm text-navy/70">
                  {card.date.kind === "nextCharge"
                    ? t("billingNextCharge", { date: formatDate(card.date.iso) })
                    : card.date.kind === "cancelsOn"
                      ? t("billingCancelsOn", { date: formatDate(card.date.iso) })
                      : t("billingFirstChargeOn", {
                          date: formatDate(card.date.iso),
                        })}
                </p>
              ) : null}
              {card.featureIds.length ? (
                <details className="mt-3 text-sm text-navy/80">
                  <summary className="cursor-pointer font-semibold text-navy">
                    {t("billingIncludedTitle")}
                  </summary>
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                    {card.featureIds.map((id) => (
                      <li key={id}>{plansT(`capabilities.${id}.label`)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {card.professionalNote ? (
                <p className="mt-3 text-sm text-navy/70">
                  {settingsT("planProfessionalNote", {
                    amount: formatPlanPrice(
                      PLAN_PRICES.professional.monthly,
                      locale,
                    ),
                  })}{" "}
                  <Link href="/pricing" className="text-navy underline">
                    {t("billingComparePlans")}
                  </Link>
                </p>
              ) : null}
              {confirmed ? (
                <p role="status" className="mt-3 text-sm font-semibold text-green-800">
                  {t("checkoutConfirmed")}
                </p>
              ) : null}
              {canceledReturn ? (
                <p role="status" className="mt-3 text-sm text-navy/80">
                  {t("checkoutCanceledNote")}
                </p>
              ) : null}
              {confirming ? (
                <div className="mt-3">
                  <CheckoutReturnWatcher />
                </div>
              ) : card.checkout === "start" ? (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-navy/70">
                    {t("checkoutIntro", checkoutFigures)}
                  </p>
                  <InstallationCheckoutButton websitePrice={websitePrice} />
                </div>
              ) : card.checkout === "pending" ? (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-navy/70">
                    {t("checkoutPendingNote")}
                  </p>
                  <InstallationCheckoutButton websitePrice={websitePrice} />
                </div>
              ) : null}
            </div>

            {usage.length ? (
              <div className="rounded-lg border border-navy/15 p-4">
                <p className="text-sm font-semibold text-navy">
                  {t("usageHeadline")}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-navy/70">
                  {usage
                    .filter((row) => row.allowance > 0)
                    .map((row) => (
                      <li key={row.metric}>
                        {t(
                          row.metric === "smsSegmentsPerMonth"
                            ? "usageSms"
                            : "usageVoice",
                          {
                            used: row.used,
                            allowance: row.allowance,
                          },
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}

            <UsageOverageConfirm
              rows={overages.map((o) => ({
                metric: o.metric,
                status: o.status,
              }))}
            />

            <BillingPortalButton />
            {org.status === "active" ? (
              <Link href="/app" className="text-navy underline">
                {t("billingBack")}
              </Link>
            ) : null}
          </>
        ) : (
          <p role="alert">{t("billingNoPermission")}</p>
        )}
        <Link href="/help" className="text-navy underline">
          {t("billingSupport")}
        </Link>
      </div>
    </FullMessagesProvider>
  );
}
