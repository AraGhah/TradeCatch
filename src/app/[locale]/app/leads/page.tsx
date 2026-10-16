import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { NewLeadForm } from "@/components/app/NewLeadForm";
import { getCrmService } from "@/product/crm/runtime";
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type LeadPriority,
  type LeadSource,
  type LeadStatus,
} from "@/product/crm/types";
import { orgHasFeature } from "@/product/saas/entitlements";
import { requireTenantContext } from "@/product/saas/tenant";

export default async function AppLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    source?: string;
    priority?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("app.crm");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("entitlement")}</p>;
  }

  const status = LEAD_STATUSES.includes(query.status as LeadStatus)
    ? (query.status as LeadStatus)
    : undefined;
  const source = LEAD_SOURCES.includes(query.source as LeadSource)
    ? (query.source as LeadSource)
    : undefined;
  const priority = LEAD_PRIORITIES.includes(query.priority as LeadPriority)
    ? (query.priority as LeadPriority)
    : undefined;

  let leads: Awaited<ReturnType<ReturnType<typeof getCrmService>["listLeads"]>> =
    [];
  try {
    leads = await getCrmService().listLeads(auth.ctx.organization.id, {
      q: query.q,
      status,
      source,
      priority,
    });
  } catch {
    leads = [];
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>

      <NewLeadForm organizationId={auth.ctx.organization.id} />

      <form className="grid gap-3 rounded-md border border-navy/10 bg-white p-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm text-navy sm:col-span-4">
          {t("search")}
          <input
            name="q"
            defaultValue={query.q ?? ""}
            className="rounded-md border border-navy/20 px-2 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("status")}
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-navy/20 px-2 py-2"
          >
            <option value="">{t("all")}</option>
            {LEAD_STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(`statuses.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("source")}
          <select
            name="source"
            defaultValue={source ?? ""}
            className="rounded-md border border-navy/20 px-2 py-2"
          >
            <option value="">{t("all")}</option>
            {LEAD_SOURCES.map((item) => (
              <option key={item} value={item}>
                {t(`sources.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("priority")}
          <select
            name="priority"
            defaultValue={priority ?? ""}
            className="rounded-md border border-navy/20 px-2 py-2"
          >
            <option value="">{t("all")}</option>
            {LEAD_PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {t(`priorities.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white"
          >
            {t("filter")}
          </button>
        </div>
      </form>

      {leads.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link
                href={{ pathname: "/app/leads/[id]", params: { id: lead.id } }}
                className="block px-4 py-4 hover:bg-navy/5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-navy">
                    {lead.customer.displayName || lead.customer.phoneE164}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-navy/50">
                    {t(`statuses.${lead.status}`)} · {t(`priorities.${lead.priority}`)}
                  </p>
                </div>
                <p className="mt-1 text-sm text-navy/70">
                  {lead.customer.phoneE164}
                  {lead.service ? ` · ${lead.service}` : ""}
                  {" · "}
                  {t(`sources.${lead.source}`)}
                </p>
                {lead.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-navy/80">
                    {lead.description}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
