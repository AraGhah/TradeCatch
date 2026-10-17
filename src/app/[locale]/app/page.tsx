import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { computeStarterDashboardMetrics } from "@/product/saas/analytics";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { orgHasFeature } from "@/product/saas/entitlements";
import { GrowthUpsell } from "@/components/app/GrowthUpsell";

export default async function AppDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const clientId = auth.ctx.organization.missedCallClientId;
  let metrics = computeStarterDashboardMetrics([]);
  let linked = false;
  let aiFinished = 0;
  let appointmentsRequested = 0;
  let recent: { id: string; title: string; detail: string; when: string }[] = [];
  let growthMetrics: {
    openPipelineValue: number;
    attributedRevenue: number;
    upcomingAppointments: number;
    reviewsSent: number;
  } | null = null;

  if (
    clientId &&
    orgHasFeature(auth.ctx.organization.plan, "BASIC_ANALYTICS")
  ) {
    try {
      const { store } = await ensureMissedCallReady();
      const leads = await store.listLeads(clientId);
      metrics = computeStarterDashboardMetrics(leads);
      linked = true;
      appointmentsRequested = leads.filter((lead) => lead.becameBooking).length;
      recent = [...leads]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5)
        .map((lead) => ({
          id: lead.id,
          title: lead.customerName || lead.callerE164,
          detail: lead.issueDescription ?? "",
          when: lead.updatedAt,
        }));
      try {
        const { getReceptionistRuntime } = await import(
          "@/product/receptionist/runtime"
        );
        const runtime = getReceptionistRuntime();
        await runtime.refresh();
        const calls = await runtime.store.listSessions({
          clientAccountId: clientId,
          limit: 100,
        });
        aiFinished = calls.filter((call) => call.status === "completed").length;
        appointmentsRequested += calls.filter(
          (call) => call.outcome === "appointment_requested",
        ).length;
      } catch {
        aiFinished = 0;
      }
    } catch {
      linked = false;
    }
  }

  if (orgHasFeature(auth.ctx.organization.plan, "ADVANCED_ANALYTICS")) {
    try {
      const { getGrowthStore, getGrowthServices } =
        await import("@/product/growth");
      const store = getGrowthStore();
      const services = getGrowthServices();
      growthMetrics = services.computeAdvancedAnalytics({
        pipeline: await store.listPipeline(auth.ctx.organization.id),
        revenue: await store.listRevenue(auth.ctx.organization.id),
        appointments: await store.listAppointments(auth.ctx.organization.id),
        reviews: await store.listReviewRequests(auth.ctx.organization.id),
      });
    } catch {
      growthMetrics = null;
    }
  }

  const cards = [
    { label: t("metrics.leadsCaptured"), value: metrics.leadsCaptured },
    {
      label: t("metrics.missedCallsRecovered"),
      value: metrics.missedCallsRecovered,
    },
    { label: t("metrics.leadsReplied"), value: metrics.leadsReplied },
    { label: t("metrics.needsAttention"), value: metrics.needsAttention },
    { label: t("metrics.jobsAccepted"), value: metrics.jobsAccepted },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy md:text-3xl">
          {t("dashboard.headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("dashboard.intro")}</p>
      </header>

      {!linked ? (
        <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm text-navy/80">
          {t("dashboard.notLinked")}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-md border border-navy/10 bg-white px-4 py-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
              {card.label}
            </p>
            <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
              {card.value}
            </p>
          </div>
        ))}
        {metrics.estimatedPipelineValue != null ? (
          <div className="rounded-md border border-navy/10 bg-white px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
              {t("metrics.pipelineValue")}
            </p>
            <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
              {metrics.estimatedPipelineValue.toLocaleString(
                locale === "fr" ? "fr-CA" : "en-CA",
                {
                  style: "currency",
                  currency: "CAD",
                  maximumFractionDigits: 0,
                },
              )}
            </p>
            <p className="mt-1 text-xs text-navy/50">
              {t("metrics.pipelineValueNote")}
            </p>
          </div>
        ) : null}
        <div className="rounded-md border border-navy/10 bg-white px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("metrics.homeAi")}
          </p>
          <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
            {aiFinished}
          </p>
        </div>
        <div className="rounded-md border border-navy/10 bg-white px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("metrics.homeAppointments")}
          </p>
          <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
            {appointmentsRequested}
          </p>
        </div>
      </div>

      <section className="rounded-md border border-navy/10 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-navy">{t("metrics.homeActivity")}</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-navy/70">{t("metrics.homeActivityEmpty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {recent.map((item) => (
              <li key={item.id} className="text-sm text-navy">
                <Link href={`/app/leads/${item.id}`} className="font-semibold underline">
                  {item.title}
                </Link>
                {item.detail ? <span className="text-navy/70"> · {item.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {growthMetrics ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-navy/10 bg-white px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
                {t("metrics.growthPipeline")}
              </p>
              <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
                {growthMetrics.openPipelineValue.toLocaleString(
                  locale === "fr" ? "fr-CA" : "en-CA",
                  {
                    style: "currency",
                    currency: "CAD",
                    maximumFractionDigits: 0,
                  },
                )}
              </p>
            </div>
            <div className="rounded-md border border-navy/10 bg-white px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
                {t("metrics.attributedRevenue")}
              </p>
              <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
                {growthMetrics.attributedRevenue.toLocaleString(
                  locale === "fr" ? "fr-CA" : "en-CA",
                  {
                    style: "currency",
                    currency: "CAD",
                    maximumFractionDigits: 0,
                  },
                )}
              </p>
            </div>
            <div className="rounded-md border border-navy/10 bg-white px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
                {t("metrics.upcomingAppointments")}
              </p>
              <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
                {growthMetrics.upcomingAppointments}
              </p>
            </div>
            <div className="rounded-md border border-navy/10 bg-white px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
                {t("metrics.reviewsSent")}
              </p>
              <p className="mt-2 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
                {growthMetrics.reviewsSent}
              </p>
            </div>
          </div>
          <Link
            href="/api/app/analytics?format=csv"
            prefetch={false}
            download
            className="self-start text-sm font-medium text-navy underline-offset-2 hover:underline"
          >
            {t("metrics.exportCsv")}
          </Link>
        </div>
      ) : null}

      {auth.ctx.organization.plan === "starter" ? <GrowthUpsell /> : null}
    </div>
  );
}
