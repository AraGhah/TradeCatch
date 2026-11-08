import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireBillingContext } from "@/product/saas/tenant";
import { BillingPortalButton } from "@/components/app/BillingPortalButton";
import { InstallationCheckoutButton } from "@/components/app/InstallationCheckoutButton";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";
import { Link } from "@/i18n/navigation";
import { PLAN_DISPLAY_NAMES } from "@/product/saas/entitlements";
import { PLAN_PRICES, formatPlanMoney } from "@/lib/plans";
import { ADD_ONS } from "@/product/saas/plan-catalog";
import { getInstallationStatus } from "@/product/saas/stripe-checkout";
import { listOverages, usageSummary } from "@/product/saas/usage-metering";
import { UsageOverageConfirm } from "@/components/app/UsageOverageConfirm";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.account");
  const access = await requireBillingContext();
  if (!access.ok && access.status === 401) {
    redirect(locale === "fr" ? "/fr/connexion" : "/login");
  }
  const org = access.ok ? access.ctx.organization : null;
  const [installation, usage, overages] = org
    ? await Promise.all([
        getInstallationStatus(org.id).catch(() => null),
        usageSummary(org.id, org.plan).catch(() => []),
        listOverages(org.id).catch(() => []),
      ])
    : [null, [], []];
  // Setup and the monthly price are shown separately, in Canadian dollars, with the date of the first monthly charge.
  const websitePrice = formatPlanMoney(ADD_ONS.websiteService.priceCad, locale);
  const checkoutFigures = org
    ? {
        setup: formatPlanMoney(PLAN_PRICES[org.plan].setup, locale),
        monthly: formatPlanMoney(PLAN_PRICES[org.plan].monthly, locale),
      }
    : { setup: "", monthly: "" };
  return (
    <FullMessagesProvider>
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-12">
        <h1 className="text-2xl font-bold text-navy">{t("billingHeadline")}</h1>
        {access.ok && org ? (
          <>
            <p className="text-navy/80">
              {org.status === "active"
                ? t("billingActive")
                : t("billingRecovery")}
            </p>

            <div className="rounded-lg border border-navy/15 p-4">
              <p className="text-sm font-semibold text-navy">
                {t("billingPlanLine", {
                  plan: PLAN_DISPLAY_NAMES[org.plan],
                  amount: formatPlanMoney(
                    PLAN_PRICES[org.plan].monthly,
                    locale,
                  ),
                })}
              </p>
              {installation?.status === "subscribed" &&
              installation.billingStartAt ? (
                <p className="mt-1 text-sm text-navy/70">
                  {t("billingFirstChargeOn", {
                    date: new Date(
                      installation.billingStartAt,
                    ).toLocaleDateString(locale === "fr" ? "fr-CA" : "en-CA", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }),
                  })}
                </p>
              ) : null}
              {!installation ||
              installation.status === "none" ||
              installation.status === "failed" ||
              installation.status === "canceled" ? (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-navy/70">
                    {t("checkoutIntro", checkoutFigures)}
                  </p>
                  <InstallationCheckoutButton websitePrice={websitePrice} />
                </div>
              ) : installation.status === "pending" ? (
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
