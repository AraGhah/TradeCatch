import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { NewLeadForm } from "@/components/app/NewLeadForm";
import { CustomerRecordCard } from "@/components/app/CustomerRecordCard";
import { phoneKey } from "@/product/crm/phone";
import {
  cleanProblemText,
  formatPhoneDisplay,
  isIntentCode,
} from "@/product/crm/record-quality";
import { getCrmService } from "@/product/crm/runtime";
import { getSchedulingStore } from "@/product/scheduling/runtime";
import type { ScheduleAppointment } from "@/product/scheduling/types";
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

/** The first two sentences of the problem: the list shows a summary, not a paragraph. */
function shortProblem(text: string | undefined): string | undefined {
  const clean = cleanProblemText(text);
  if (!clean) return undefined;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  const short = sentences.slice(0, 2).join(" ").trim();
  return short.length > 220 ? `${short.slice(0, 217)}…` : short;
}

/** Upcoming visits (booked or requested), soonest first. Professional plan only; never writes. */
async function upcomingAppointments(
  organizationId: string,
  plan: Parameters<typeof orgHasFeature>[0],
): Promise<ScheduleAppointment[]> {
  if (!orgHasFeature(plan, "APPOINTMENT_BOOKING")) return [];
  try {
    const now = Date.now();
    const rows = await getSchedulingStore().listAppointments(organizationId);
    return rows
      .filter(
        (row) =>
          (row.status === "confirmed" || row.status === "pending") &&
          Date.parse(row.endAt) > now,
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  } catch {
    return [];
  }
}

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

  const appointments = await upcomingAppointments(
    auth.ctx.organization.id,
    auth.ctx.organization.plan,
  );
  const tr = await getTranslations("app.record");
  const when = (row: ScheduleAppointment) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: row.timezone,
    }).format(new Date(row.startAt));
  const recordLabels = {
    service: tr("service"),
    problem: tr("problem"),
    address: tr("address"),
    appointment: tr("appointment"),
    notes: tr("notes"),
    notProvided: tr("notProvided"),
    moreDetails: tr("moreDetails"),
    lessDetails: tr("lessDetails"),
  };

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
          {leads.map((lead) => {
            const visit = appointments.find(
              (row) =>
                row.leadId === lead.id ||
                (phoneKey(row.customerPhoneE164).length >= 10 &&
                  phoneKey(row.customerPhoneE164) ===
                    phoneKey(lead.customer.phoneE164)),
            );
            const fullProblem = cleanProblemText(lead.description);
            const problem = shortProblem(lead.description);
            const service = isIntentCode(lead.service)
              ? lead.service === "service_request"
                ? tr("legacyService")
                : undefined
              : lead.service;
            return (
              <li key={lead.id}>
                <CustomerRecordCard
                  name={
                    <Link
                      href={{
                        pathname: "/app/leads/[id]",
                        params: { id: lead.id },
                      }}
                      className="hover:underline"
                    >
                      {lead.customer.displayName ||
                        formatPhoneDisplay(lead.customer.phoneE164)}
                    </Link>
                  }
                  phone={formatPhoneDisplay(lead.customer.phoneE164)}
                  service={service}
                  problem={problem}
                  address={lead.location ?? lead.customer.serviceAddress}
                  appointment={
                    visit
                      ? visit.status === "pending"
                        ? tr("requested", { time: when(visit) })
                        : when(visit)
                      : tr("notScheduled")
                  }
                  priority={lead.priority}
                  priorityLabel={tr(`priority.${lead.priority}`)}
                  meta={`${t(`statuses.${lead.status}`)} · ${t(`sources.${lead.source}`)}`}
                  labels={recordLabels}
                  details={
                    <>
                      {fullProblem && fullProblem !== problem ? (
                        <p className="m-0">{fullProblem}</p>
                      ) : null}
                      {lead.customer.notes ? (
                        <p className="m-0">
                          <span className="font-semibold">{tr("notes")}: </span>
                          {lead.customer.notes}
                        </p>
                      ) : null}
                      <Link
                        href={{
                          pathname: "/app/leads/[id]",
                          params: { id: lead.id },
                        }}
                        className="font-semibold underline"
                      >
                        {tr("conversation")}
                      </Link>
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
