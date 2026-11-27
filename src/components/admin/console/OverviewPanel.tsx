"use client";

import { Link } from "@/i18n/navigation";
import { SkeletonTiles } from "@/components/ui/Skeleton";
import type { Overview, OverviewAlert } from "@/product/admin-console/overview";
import { useAdminData } from "./api";
import {
  Badge,
  DataState,
  PageHeader,
  Tile,
  formatDateTime,
  formatMoney,
  useCommon,
  useLoadErrorText,
  useLocaleTag,
  type Tone,
} from "./ui";

const en = {
  title: "Platform overview",
  intro:
    "Live figures from TradeCatch, Stripe and the platform's own health records. Refreshed every minute while this page is open.",
  customers: "Customers",
  activeSubs: "Active subscriptions",
  suspended: "suspended",
  mrr: "Monthly recurring revenue",
  mrrStripe: "From Stripe",
  mrrCatalog: "Estimate from catalog prices",
  failedPayments: "Failed payments (30 days)",
  pastDue: "past-due subscriptions",
  calls: "Calls handled",
  alerts: "Open alerts",
  websiteRequests: "Website requests to review",
  alertsTitle: "Alerts",
  alertsNone: "No open alerts. Payments, webhooks, jobs and services look healthy.",
  open: "Open",
  critical: "Critical",
  warning: "Warning",
  info: "Notice",
  loadError: "The overview could not be loaded.",
  kind: {
    failed_payment: "Payments",
    past_due_subscription: "Subscriptions",
    webhook_failure: "Webhooks",
    service_error: "Service error",
    incident: "Incident",
    failed_job: "Jobs",
    website_request: "Website requests",
    suspicious_admin_activity: "Admin activity",
  } as Record<OverviewAlert["kind"], string>,
};
type Copy = typeof en;
const fr: Copy = {
  title: "Aperçu de la plateforme",
  intro:
    "Chiffres en direct de TradeCatch, de Stripe et des relevés de santé de la plateforme. Actualisés chaque minute tant que cette page est ouverte.",
  customers: "Clients",
  activeSubs: "Abonnements actifs",
  suspended: "suspendus",
  mrr: "Revenu mensuel récurrent",
  mrrStripe: "Selon Stripe",
  mrrCatalog: "Estimation selon les prix du catalogue",
  failedPayments: "Paiements échoués (30 jours)",
  pastDue: "abonnements en retard",
  calls: "Appels traités",
  alerts: "Alertes ouvertes",
  websiteRequests: "Demandes de site à examiner",
  alertsTitle: "Alertes",
  alertsNone: "Aucune alerte ouverte. Paiements, webhooks, tâches et services semblent en bonne santé.",
  open: "Ouvrir",
  critical: "Critique",
  warning: "Avertissement",
  info: "Avis",
  loadError: "L’aperçu n’a pas pu être chargé.",
  kind: {
    failed_payment: "Paiements",
    past_due_subscription: "Abonnements",
    webhook_failure: "Webhooks",
    service_error: "Erreur de service",
    incident: "Incident",
    failed_job: "Tâches",
    website_request: "Demandes de site",
    suspicious_admin_activity: "Activité admin",
  },
};

const SEVERITY_TONE: Record<OverviewAlert["severity"], Tone> = {
  critical: "bad",
  warning: "warn",
  info: "info",
};

function AlertLink({ kind, label }: { kind: OverviewAlert["kind"]; label: string }) {
  const className =
    "font-semibold text-navy underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60";
  switch (kind) {
    case "failed_payment":
      return <Link href="/admin/payments" className={className}>{label}</Link>;
    case "past_due_subscription":
      return <Link href="/admin/subscriptions" className={className}>{label}</Link>;
    case "website_request":
      return <Link href="/admin/website-requests" className={className}>{label}</Link>;
    case "suspicious_admin_activity":
      return <Link href="/admin/audit-logs" className={className}>{label}</Link>;
    default:
      return <Link href="/admin/system-health" className={className}>{label}</Link>;
  }
}

export function AdminOverviewPanel() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const common = useCommon();
  const loadError = useLoadErrorText();
  const { data, error, loading, refresh, updatedAt } = useAdminData<Overview & { ok: true }>(
    "/api/admin/overview",
    { autoRefreshMs: 60_000 },
  );
  const kpis = data?.kpis;
  const severityLabel = { critical: t.critical, warning: t.warning, info: t.info };

  return (
    <section aria-labelledby="overview-title" className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        intro={t.intro}
        onRefresh={refresh}
        loading={loading}
        updatedAt={updatedAt}
      />
      <DataState
        loading={loading}
        error={error}
        hasData={Boolean(data)}
        onRetry={refresh}
        errorText={loadError(error, t.loadError)}
        skeleton={<SkeletonTiles count={6} />}
      >
        {kpis ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label={t.customers}
                value={kpis.customers}
                href={<Link href="/admin/businesses" className="underline">{common.view}</Link>}
              />
              <Tile
                label={t.activeSubs}
                value={kpis.activeSubscriptions}
                note={`${kpis.suspended} ${t.suspended}`}
                href={<Link href="/admin/subscriptions" className="underline">{common.view}</Link>}
              />
              <Tile
                label={t.mrr}
                value={formatMoney(Math.round(kpis.mrr.amountCad * 100), "CAD", locale)}
                note={kpis.mrr.source === "stripe" ? t.mrrStripe : (kpis.mrr.note ?? t.mrrCatalog)}
              />
              <Tile
                label={t.failedPayments}
                value={kpis.failedPayments30d}
                tone={kpis.failedPayments30d > 0 ? "bad" : "neutral"}
                note={`${kpis.pastDueSubscriptions} ${t.pastDue}`}
                href={<Link href="/admin/payments" className="underline">{common.view}</Link>}
              />
              <Tile label={t.calls} value={kpis.calls} />
              <Tile
                label={t.alerts}
                value={kpis.openAlerts}
                tone={kpis.openAlerts > 0 ? "warn" : "neutral"}
                href={<Link href="/admin/system-health" className="underline">{common.view}</Link>}
              />
              <Tile
                label={t.websiteRequests}
                value={kpis.pendingWebsiteRequests}
                href={<Link href="/admin/website-requests" className="underline">{common.view}</Link>}
              />
            </div>

            <div className="rounded-md border border-navy/10 bg-white p-4">
              <h2 className="font-semibold text-navy">{t.alertsTitle}</h2>
              {data?.alerts.length ? (
                <ul className="mt-3 divide-y divide-navy/10">
                  {data.alerts.map((alert) => (
                    <li key={alert.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={SEVERITY_TONE[alert.severity]}>{severityLabel[alert.severity]}</Badge>
                          <span className="text-xs text-navy/70">{t.kind[alert.kind]}</span>
                        </div>
                        <p className="mt-1 break-words text-sm font-medium text-navy">{alert.title}</p>
                        {alert.detail ? <p className="break-words text-xs text-navy/70">{alert.detail}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-navy/70">
                        {alert.at ? <span>{formatDateTime(alert.at, locale)}</span> : null}
                        <AlertLink kind={alert.kind} label={t.open} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-navy/70">{t.alertsNone}</p>
              )}
            </div>
          </>
        ) : null}
      </DataState>
    </section>
  );
}
