import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getStarterStore } from "@/product/starter/runtime";

export default async function AppWebsiteLeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "WEBSITE_LEAD_CAPTURE")) {
    return <p className="text-navy/70">{t("websiteLeads.entitlement")}</p>;
  }

  const leads = await getStarterStore().listWebsiteLeads(
    auth.ctx.organization.id,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("websiteLeads.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("websiteLeads.intro")}</p>
      </header>

      {leads.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("websiteLeads.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {leads.map((lead) => (
            <li key={lead.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-navy">
                  {lead.name || lead.phoneE164 || lead.email || lead.id}
                </p>
                <p className="text-xs uppercase tracking-wide text-navy/50">
                  {lead.status}
                </p>
              </div>
              <p className="mt-1 text-sm text-navy/70">
                {[lead.phoneE164, lead.email, lead.serviceRequested]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {lead.message ? (
                <p className="mt-2 line-clamp-2 text-sm text-navy/80">
                  {lead.message}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
