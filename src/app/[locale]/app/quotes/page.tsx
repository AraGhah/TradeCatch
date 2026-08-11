import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getStarterStore } from "@/product/starter/runtime";
import { QuoteIngestForm } from "@/components/app/QuoteIngestForm";

export default async function AppQuotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "QUOTE_FOLLOW_UP")) {
    return <p className="text-navy/70">{t("quotes.entitlement")}</p>;
  }

  const quotes = await getStarterStore().listQuoteThreads(
    auth.ctx.organization.id,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("quotes.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("quotes.intro")}</p>
      </header>

      <QuoteIngestForm locale={locale === "fr" ? "fr" : "en"} />

      {quotes.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("quotes.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {quotes.map((q) => (
            <li key={q.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-navy">
                  {q.customerName || q.customerPhoneE164}
                </p>
                <p className="text-xs uppercase tracking-wide text-navy/50">
                  {q.status}
                  {q.stopReason ? ` · ${q.stopReason}` : ""}
                </p>
              </div>
              <p className="mt-1 text-sm text-navy/70">
                {q.quoteRef ? `${q.quoteRef} · ` : ""}
                {q.customerPhoneE164}
                {q.nextRunAt && q.status === "active"
                  ? ` · next ${new Date(q.nextRunAt).toLocaleString(
                      locale === "fr" ? "fr-CA" : "en-CA",
                    )}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
