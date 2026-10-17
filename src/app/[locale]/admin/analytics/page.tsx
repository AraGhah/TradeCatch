import { getTranslations, setRequestLocale } from "next-intl/server";
import { MonthChart, StatGrid } from "@/components/admin/PlatformWidgets";
import { formatPlanMoney } from "@/lib/plans";
import { buildPlatformStats, filterPlatformRows } from "@/product/admin/platform-stats";
import { loadPlatformSnapshot } from "@/product/admin/platform-snapshot";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ business?: string; from?: string; to?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("admin.platform");
  const snapshot = await loadPlatformSnapshot();
  const rows = filterPlatformRows(snapshot.rows, {
    businessId: query.business,
    from: query.from,
    to: query.to,
  });
  const usage = {
    leadsByClient: Object.fromEntries(rows.flatMap((row) => row.missedCallClientId ? [[row.missedCallClientId, row.leads]] : [])),
    callsByClient: Object.fromEntries(rows.flatMap((row) => row.missedCallClientId ? [[row.missedCallClientId, row.calls]] : [])),
    completedCallsByClient: Object.fromEntries(rows.flatMap((row) => row.missedCallClientId ? [[row.missedCallClientId, row.completedCalls]] : [])),
    appointmentsByOrg: Object.fromEntries(rows.map((row) => [row.id, row.appointments])),
  };
  const stats = buildPlatformStats(rows, usage);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("analyticsHeadline")}</h1>
      </header>
      <form className="flex flex-wrap gap-2" method="get">
        <select name="business" defaultValue={query.business ?? ""} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm">
          <option value="">{t("all")}</option>
          {snapshot.rows.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={query.from ?? ""} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm" />
        <input type="date" name="to" defaultValue={query.to ?? ""} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm" />
        <button type="submit" className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">{t("filter")}</button>
      </form>
      <StatGrid
        items={[
          { label: t("mrr"), value: formatPlanMoney(stats.mrr, locale) },
          { label: t("churn"), value: `${Math.round(stats.churnRate * 1000) / 10}%` },
          { label: t("growthShare"), value: `${Math.round(stats.growthShare * 1000) / 10}%` },
          { label: t("ai"), value: String(stats.aiCompleted) },
          { label: t("leads"), value: String(stats.leads) },
          { label: t("appointments"), value: String(stats.appointments) },
        ]}
      />
      <section className="rounded-md border border-navy/10 bg-white p-4">
        <MonthChart rows={stats.series} signupsLabel={t("seriesSignups")} cancellationsLabel={t("seriesCancellations")} />
      </section>
    </div>
  );
}
