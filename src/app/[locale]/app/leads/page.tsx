import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { orgHasFeature } from "@/product/saas/entitlements";

export default async function AppLeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("leads.entitlement")}</p>;
  }

  const clientId = auth.ctx.organization.missedCallClientId;
  let leads: Awaited<
    ReturnType<Awaited<ReturnType<typeof ensureMissedCallReady>>["store"]["listLeads"]>
  > = [];

  if (clientId) {
    try {
      const { store } = await ensureMissedCallReady();
      leads = await store.listLeads(clientId);
    } catch {
      leads = [];
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("leads.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("leads.intro")}</p>
      </header>

      {!clientId ? (
        <p className="text-sm text-navy/70">{t("dashboard.notLinked")}</p>
      ) : null}

      {leads.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("leads.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {leads.map((lead) => (
            <li key={lead.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-navy">
                  {lead.customerName || lead.callerE164}
                </p>
                <p className="text-xs uppercase tracking-wide text-navy/50">
                  {lead.humanReviewRequired
                    ? t("leads.needsAttention")
                    : lead.outcome}
                </p>
              </div>
              <p className="mt-1 text-sm text-navy/70">
                {lead.serviceAddress || t("leads.noAddress")}
              </p>
              {lead.issueDescription ? (
                <p className="mt-2 line-clamp-2 text-sm text-navy/80">
                  {lead.issueDescription}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
