import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminDemoBusinesses } from "@/components/admin/AdminDemoBusinesses";
import { AdminOverviewPanel } from "@/components/admin/console/OverviewPanel";
import { AdminSystemAlerts } from "@/components/admin/AdminSystemAlerts";
import { MonthChart, StatGrid } from "@/components/admin/PlatformWidgets";
import { Link } from "@/i18n/navigation";
import { loadPlatformSnapshot } from "@/product/admin/platform-snapshot";

export const dynamic = "force-dynamic";

export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.platform");
  let snapshot: Awaited<ReturnType<typeof loadPlatformSnapshot>> | null = null;
  try {
    snapshot = await loadPlatformSnapshot();
  } catch {
    snapshot = null;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The headline figures (customers, subscriptions, MRR, failed payments, calls,
          alerts) come from the live admin API; the tiles below are the usage
          figures it does not cover. */}
      <AdminOverviewPanel />
      {snapshot ? (
        <>
          <StatGrid
            items={[
              { label: t("ai"), value: String(snapshot.aiCompleted) },
              { label: t("leads"), value: String(snapshot.leads) },
              {
                label: t("appointments"),
                value: String(snapshot.appointments),
              },
              { label: t("signups"), value: String(snapshot.signups30d) },
              {
                label: t("cancellations"),
                value: String(snapshot.cancellations30d),
              },
            ]}
          />
          <section className="rounded-md border border-navy/10 bg-white p-4">
            <MonthChart
              rows={snapshot.series}
              signupsLabel={t("seriesSignups")}
              cancellationsLabel={t("seriesCancellations")}
            />
          </section>
          <section className="rounded-md border border-navy/10 bg-white p-4">
            <h2 className="font-semibold text-navy">{t("recent")}</h2>
            {snapshot.recent.length === 0 ? (
              <p className="mt-2 text-sm text-navy/60">{t("recentEmpty")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-navy/10 text-sm">
                {snapshot.recent.map((item) => (
                  <li
                    key={`${item.kind}-${item.id}-${item.at}`}
                    className="flex justify-between gap-3 py-2"
                  >
                    <Link
                      href={{
                        pathname: "/admin/businesses/[id]",
                        params: { id: item.id },
                      }}
                      className="font-semibold text-navy underline"
                    >
                      {item.name}
                    </Link>
                    <span className="text-navy/60">
                      {item.kind === "registration"
                        ? t("registration")
                        : t("cancellation")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border border-navy/10 bg-white p-4 text-sm text-navy">
            <h2 className="font-semibold">{t("health")}</h2>
            {snapshot.health ? (
              <p className="mt-2">
                {snapshot.health.overall} · {snapshot.health.averageMs} ms · p95{" "}
                {snapshot.health.p95Ms} ms · {snapshot.health.serverErrors} ·{" "}
                {snapshot.health.openIncidents}
              </p>
            ) : (
              <p className="mt-2 text-navy/60">{t("healthEmpty")}</p>
            )}
            <p className="mt-2 text-navy/70">
              {snapshot.stripeConfigured ? t("stripeOn") : t("stripeOff")}
            </p>
          </section>
        </>
      ) : (
        <p className="text-sm text-navy">{t("error")}</p>
      )}
      <AdminSystemAlerts />
      <AdminDemoBusinesses />
    </div>
  );
}
