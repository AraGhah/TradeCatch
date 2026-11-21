"use client";

import { useState, type ReactNode } from "react";
import type { SystemHealth } from "@/product/admin-console/health";
import type { FailedOperation, Incident, ServiceHealth, SystemError } from "@/product/reliability/types";
import { Link } from "@/i18n/navigation";
import { SkeletonTiles } from "@/components/ui/Skeleton";
import { queryString, useAdminData } from "./api";
import {
  Badge,
  BusinessSelect,
  DataState,
  DataTable,
  Field,
  FilterBar,
  PageHeader,
  Tile,
  card,
  formatDateTime,
  inputClass,
  secondaryButton,
  useCommon,
  useLoadErrorText,
  useLocaleTag,
  type Column,
  type Tone,
} from "./ui";

const en = {
  title: "System health",
  intro:
    "Live readings from the platform: database, Twilio, Bland AI, Stripe and email, plus the errors, webhook failures and failed jobs TradeCatch has recorded. Refreshed every minute while this page is open.",
  overall: "Overall",
  overallStates: { healthy: "Healthy", degraded: "Degraded", unavailable: "Unavailable" } as Record<string, string>,
  checked: "Checked",
  database: "Database",
  apiRequests: "API requests",
  serverErrors: "Server errors (5xx)",
  errorRate: "Server error rate",
  latency: "Response time (p95)",
  latencyNote: "average {avg} ms",
  openErrors: "Open errors",
  webhooks: "Webhook failures",
  failedJobs: "Failed jobs",
  incidents: "Open incidents",
  jobsLine: "{pending} pending · {failed} failed · {dead} gave up · {resolved} resolved",
  servicesTitle: "Services",
  servicesIntro: "Provider checks. “Unknown” means nothing has verified that service yet; it is never shown as healthy by default.",
  integrationsTitle: "Integrations",
  integrationsIntro: "Whether each integration's credentials are present. Only presence is shown, never the credentials.",
  configured: "Configured",
  notConfigured: "Not configured",
  notConnected: "Not connected",
  serviceNames: {
    api: "API", database: "Database", ai_receptionist: "Voice receptionist (Bland AI)", twilio_voice: "Twilio voice",
    twilio_sms: "Twilio SMS", google_calendar: "Google Calendar", stripe: "Stripe", jobs: "Background jobs",
    notifications: "Notifications",
  } as Record<string, string>,
  integrationNames: { twilio: "Twilio", bland: "Bland AI", stripe: "Stripe", resend: "Email (Resend)", cloudflare: "Cloudflare" } as Record<string, string>,
  healthStatus: { healthy: "Healthy", degraded: "Degraded", unavailable: "Unavailable", unknown: "Unknown" } as Record<string, string>,
  serviceState: {
    unconfigured: "Not configured", configured: "Configured", connected: "Connected",
    operational: "Operational", delivery_verified: "Delivery verified",
  } as Record<string, string>,
  required: "required",
  errorsTitle: "Recent errors",
  webhookTitle: "Webhook failures",
  jobsTitle: "Failed jobs",
  incidentsTitle: "Incidents",
  when: "When",
  service: "Service",
  operation: "Operation",
  code: "Error",
  severity: "Severity",
  status: "Status",
  business: "Business",
  request: "Request",
  attempts: "Attempts",
  lastError: "Last error",
  retryable: "Retryable",
  titleCol: "Title",
  simulated: "Simulated",
  platformWide: "Platform-wide",
  errorsEmpty: "No errors match these filters.",
  webhookEmpty: "No webhook failures match these filters.",
  jobsEmpty: "No failed jobs match these filters.",
  incidentsEmpty: "No incidents match these filters.",
  yes: "Yes",
  no: "No",
  severities: { low: "Low", medium: "Medium", high: "High", critical: "Critical" } as Record<string, string>,
  statuses: { open: "Open", investigating: "Investigating", resolved: "Resolved", failed: "Failed", retrying: "Retrying", dead: "Gave up" } as Record<string, string>,
  statusFilter: "Status",
  anyStatus: "Any status",
  serviceFilter: "Service",
  anyService: "Any service",
  jobsLink: "Open the full reliability desk",
  loadError: "System health could not be loaded.",
  note: "Worker and API errors here are the failures this app recorded itself. Cloudflare's own analytics are not connected.",
};
type Copy = typeof en;
const fr: Copy = {
  title: "Santé du système",
  intro:
    "Relevés en direct de la plateforme : base de données, Twilio, Bland AI, Stripe et courriel, ainsi que les erreurs, échecs de webhook et tâches en échec consignés par TradeCatch. Actualisés chaque minute tant que cette page est ouverte.",
  overall: "Ensemble",
  overallStates: { healthy: "En bonne santé", degraded: "Dégradé", unavailable: "Indisponible" },
  checked: "Vérifié",
  database: "Base de données",
  apiRequests: "Requêtes API",
  serverErrors: "Erreurs serveur (5xx)",
  errorRate: "Taux d’erreurs serveur",
  latency: "Temps de réponse (p95)",
  latencyNote: "moyenne {avg} ms",
  openErrors: "Erreurs ouvertes",
  webhooks: "Échecs de webhook",
  failedJobs: "Tâches en échec",
  incidents: "Incidents ouverts",
  jobsLine: "{pending} en attente · {failed} échouées · {dead} abandonnées · {resolved} résolues",
  servicesTitle: "Services",
  servicesIntro: "Vérifications des fournisseurs. « Inconnu » signifie que rien n’a encore vérifié ce service; il n’est jamais présenté comme sain par défaut.",
  integrationsTitle: "Intégrations",
  integrationsIntro: "Indique si les identifiants de chaque intégration sont présents. Seule leur présence est affichée, jamais les identifiants.",
  configured: "Configurée",
  notConfigured: "Non configurée",
  notConnected: "Non connectée",
  serviceNames: {
    api: "API", database: "Base de données", ai_receptionist: "Réceptionniste vocale (Bland AI)", twilio_voice: "Voix Twilio",
    twilio_sms: "SMS Twilio", google_calendar: "Google Agenda", stripe: "Stripe", jobs: "Tâches en arrière-plan",
    notifications: "Notifications",
  },
  integrationNames: { twilio: "Twilio", bland: "Bland AI", stripe: "Stripe", resend: "Courriel (Resend)", cloudflare: "Cloudflare" },
  healthStatus: { healthy: "En bonne santé", degraded: "Dégradé", unavailable: "Indisponible", unknown: "Inconnu" },
  serviceState: {
    unconfigured: "Non configuré", configured: "Configuré", connected: "Connecté",
    operational: "Opérationnel", delivery_verified: "Livraison vérifiée",
  },
  required: "requis",
  errorsTitle: "Erreurs récentes",
  webhookTitle: "Échecs de webhook",
  jobsTitle: "Tâches en échec",
  incidentsTitle: "Incidents",
  when: "Date",
  service: "Service",
  operation: "Opération",
  code: "Erreur",
  severity: "Gravité",
  status: "Statut",
  business: "Entreprise",
  request: "Requête",
  attempts: "Tentatives",
  lastError: "Dernière erreur",
  retryable: "Reprise possible",
  titleCol: "Titre",
  simulated: "Simulé",
  platformWide: "Toute la plateforme",
  errorsEmpty: "Aucune erreur ne correspond à ces filtres.",
  webhookEmpty: "Aucun échec de webhook ne correspond à ces filtres.",
  jobsEmpty: "Aucune tâche en échec ne correspond à ces filtres.",
  incidentsEmpty: "Aucun incident ne correspond à ces filtres.",
  yes: "Oui",
  no: "Non",
  severities: { low: "Faible", medium: "Moyenne", high: "Élevée", critical: "Critique" },
  statuses: { open: "Ouvert", investigating: "En analyse", resolved: "Résolu", failed: "Échoué", retrying: "Nouvelle tentative", dead: "Abandonné" },
  statusFilter: "Statut",
  anyStatus: "Tout statut",
  serviceFilter: "Service",
  anyService: "Tout service",
  jobsLink: "Ouvrir le bureau de fiabilité complet",
  loadError: "La santé du système n’a pas pu être chargée.",
  note: "Les erreurs Worker et API affichées ici sont les échecs que l’application a elle-même consignés. Les analyses propres à Cloudflare ne sont pas connectées.",
};

const SEVERITY_TONE: Record<string, Tone> = { low: "neutral", medium: "warn", high: "bad", critical: "bad" };
const STATUS_TONE: Record<string, Tone> = {
  open: "bad", investigating: "warn", resolved: "good", failed: "bad", retrying: "warn", dead: "bad",
};
const HEALTH_TONE: Record<string, Tone> = { healthy: "good", degraded: "warn", unavailable: "bad", unknown: "neutral" };

const SERVICES = [
  "api", "database", "ai_receptionist", "twilio_voice", "twilio_sms", "google_calendar", "stripe", "jobs", "notifications",
];

type Response = SystemHealth & { ok: true };

export function SystemHealthConsole() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const common = useCommon();
  const loadError = useLoadErrorText();

  const [businessId, setBusinessId] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const url = `/api/admin/health${queryString({ businessId, status, service, from, to })}`;
  const { data, error, loading, refresh, updatedAt } = useAdminData<Response>(url, { autoRefreshMs: 60_000 });
  const filtered = Boolean(businessId || status || service || from || to);

  const when = (iso: string) => formatDateTime(iso, locale);
  const orgCell = (organizationId?: string) =>
    organizationId ? (
      <Link href={{ pathname: "/admin/businesses/[id]", params: { id: organizationId } }} className="underline">
        {organizationId}
      </Link>
    ) : (
      <span className="text-navy/70">{t.platformWide}</span>
    );

  const errorColumns: Column<SystemError>[] = [
    { id: "when", header: t.when, primary: true, cell: (row) => when(row.createdAt) },
    { id: "service", header: t.service, cell: (row) => t.serviceNames[row.service] ?? row.service },
    { id: "operation", header: t.operation, cell: (row) => <code className="break-all text-xs">{row.operation}</code> },
    { id: "code", header: t.code, cell: (row) => <code className="break-all text-xs">{row.errorCode}</code> },
    { id: "severity", header: t.severity, cell: (row) => <Badge tone={SEVERITY_TONE[row.severity] ?? "neutral"}>{t.severities[row.severity] ?? row.severity}</Badge> },
    { id: "status", header: t.status, cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{t.statuses[row.status] ?? row.status}</Badge> },
    { id: "business", header: t.business, cell: (row) => orgCell(row.organizationId) },
    {
      id: "detail",
      header: t.lastError,
      cell: (row) => (
        <>
          {row.detail ? <span className="block break-words">{row.detail}</span> : <span className="text-navy/70">—</span>}
          <span className="mt-1 block break-all text-xs text-navy/70">{t.request}: {row.requestId}</span>
          {row.simulated ? <Badge tone="info">{t.simulated}</Badge> : null}
        </>
      ),
    },
  ];

  const jobColumns: Column<FailedOperation>[] = [
    { id: "when", header: t.when, primary: true, cell: (row) => when(row.createdAt) },
    { id: "service", header: t.service, cell: (row) => t.serviceNames[row.service] ?? row.service },
    { id: "operation", header: t.operation, cell: (row) => <code className="break-all text-xs">{row.operation}</code> },
    { id: "status", header: t.status, cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{t.statuses[row.status] ?? row.status}</Badge> },
    { id: "attempts", header: t.attempts, cell: (row) => row.attempts },
    { id: "retryable", header: t.retryable, cell: (row) => (row.retryable ? t.yes : t.no) },
    { id: "business", header: t.business, cell: (row) => orgCell(row.organizationId) },
    { id: "last", header: t.lastError, cell: (row) => <span className="break-words">{row.lastError ?? "—"}</span> },
  ];

  const incidentColumns: Column<Incident>[] = [
    { id: "title", header: t.titleCol, primary: true, cell: (row) => row.title },
    { id: "when", header: t.when, cell: (row) => when(row.createdAt) },
    { id: "service", header: t.service, cell: (row) => t.serviceNames[row.service] ?? row.service },
    { id: "severity", header: t.severity, cell: (row) => <Badge tone={SEVERITY_TONE[row.severity] ?? "neutral"}>{t.severities[row.severity] ?? row.severity}</Badge> },
    { id: "status", header: t.status, cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{t.statuses[row.status] ?? row.status}</Badge> },
    { id: "business", header: t.business, cell: (row) => orgCell(row.organizationId) },
  ];

  const section = (id: string, title: string, children: ReactNode) => (
    <section className={`${card} flex flex-col gap-3`} aria-labelledby={id}>
      <h2 id={id} className="font-semibold text-navy">{title}</h2>
      {children}
    </section>
  );

  const serviceRow = (row: ServiceHealth) => (
    <li key={row.service} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-navy">
          {t.serviceNames[row.service] ?? row.service}
          {row.required ? <span className="ml-2 text-xs font-normal text-navy/70">({t.required})</span> : null}
        </p>
        {row.detail ? <p className="break-words text-xs text-navy/70">{row.detail}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.state ? <span className="text-xs text-navy/70">{t.serviceState[row.state] ?? row.state}</span> : null}
        <Badge tone={HEALTH_TONE[row.status] ?? "neutral"}>{t.healthStatus[row.status] ?? row.status}</Badge>
        <span className="text-xs text-navy/70">{when(row.checkedAt)}</span>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} intro={t.intro} onRefresh={refresh} loading={loading} updatedAt={updatedAt} />

      <FilterBar>
        <BusinessSelect id="hf-business" label={t.business} value={businessId} onChange={setBusinessId} />
        <Field label={t.statusFilter} htmlFor="hf-status">
          <select id="hf-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            <option value="">{t.anyStatus}</option>
            {["open", "investigating", "resolved"].map((value) => (
              <option key={value} value={value}>{t.statuses[value]}</option>
            ))}
          </select>
        </Field>
        <Field label={t.serviceFilter} htmlFor="hf-service">
          <select id="hf-service" value={service} onChange={(e) => setService(e.target.value)} className={inputClass}>
            <option value="">{t.anyService}</option>
            {SERVICES.map((value) => (
              <option key={value} value={value}>{t.serviceNames[value]}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={common.from} htmlFor="hf-from">
            <input id="hf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
          <Field label={common.to} htmlFor="hf-to">
            <input id="hf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </Field>
        </div>
        {filtered ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="button" className={secondaryButton} onClick={() => { setBusinessId(""); setStatus(""); setService(""); setFrom(""); setTo(""); }}>
              {common.clearFilters}
            </button>
          </div>
        ) : null}
      </FilterBar>

      <DataState
        loading={loading}
        error={error}
        hasData={Boolean(data)}
        onRetry={refresh}
        errorText={loadError(error, t.loadError)}
        skeleton={<SkeletonTiles count={4} />}
      >
        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label={t.overall}
                value={t.overallStates[data.overall] ?? data.overall}
                tone={data.overall === "healthy" ? "good" : data.overall === "degraded" ? "warn" : "bad"}
                note={`${t.checked} ${when(data.generatedAt)}`}
              />
              <Tile
                label={t.database}
                value={t.healthStatus[data.database.status] ?? data.database.status}
                tone={data.database.status === "healthy" ? "good" : data.database.status === "unknown" ? "neutral" : "bad"}
                note={data.database.detail ?? (t.serviceState[data.database.state] ?? data.database.state)}
              />
              <Tile label={t.apiRequests} value={data.api.requests} />
              <Tile
                label={t.serverErrors}
                value={data.api.serverErrors}
                tone={data.api.serverErrors > 0 ? "warn" : "neutral"}
                note={`${t.errorRate}: ${(data.api.errorRate * 100).toFixed(1)}%`}
              />
              <Tile label={t.latency} value={`${data.api.p95Ms} ms`} note={t.latencyNote.replace("{avg}", String(data.api.averageMs))} />
              <Tile label={t.openErrors} value={data.totals.openErrors} tone={data.totals.openErrors > 0 ? "warn" : "neutral"} />
              <Tile label={t.webhooks} value={data.totals.webhookFailures} tone={data.totals.webhookFailures > 0 ? "bad" : "neutral"} />
              <Tile
                label={t.failedJobs}
                value={data.totals.failedOperations}
                tone={data.totals.failedOperations > 0 ? "bad" : "neutral"}
                note={t.jobsLine
                  .replace("{pending}", String(data.jobs.pending))
                  .replace("{failed}", String(data.jobs.failed))
                  .replace("{dead}", String(data.jobs.dead))
                  .replace("{resolved}", String(data.jobs.resolved))}
              />
            </div>
            <p className="text-xs text-navy/70">
              {t.note}{" "}
              <Link href="/admin/monitoring" className="font-semibold underline">{t.jobsLink}</Link>
            </p>

            {section("services-title", t.servicesTitle, (
              <>
                <p className="text-sm text-navy/70">{t.servicesIntro}</p>
                <ul className="divide-y divide-navy/10">{data.services.map(serviceRow)}</ul>
              </>
            ))}

            {section("integrations-title", t.integrationsTitle, (
              <>
                <p className="text-sm text-navy/70">{t.integrationsIntro}</p>
                <ul className="divide-y divide-navy/10">
                  {data.integrations.map((integration) => (
                    <li key={integration.key} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-navy">{t.integrationNames[integration.key] ?? integration.key}</p>
                        <p className="break-words text-xs text-navy/70">{integration.detail}</p>
                      </div>
                      {integration.key === "cloudflare" ? (
                        <Badge tone="neutral">{t.notConnected}</Badge>
                      ) : (
                        <Badge tone={integration.configured ? "good" : "warn"}>{integration.configured ? t.configured : t.notConfigured}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ))}

            {section("errors-title", t.errorsTitle, data.errors.length === 0
              ? <p className="text-sm text-navy/70">{t.errorsEmpty}</p>
              : <DataTable columns={errorColumns} rows={data.errors} rowKey={(row) => row.id} caption={t.errorsTitle} />)}

            {section("webhooks-title", t.webhookTitle, data.webhookFailures.length === 0
              ? <p className="text-sm text-navy/70">{t.webhookEmpty}</p>
              : <DataTable columns={errorColumns} rows={data.webhookFailures} rowKey={(row) => row.id} caption={t.webhookTitle} />)}

            {section("jobs-title", t.jobsTitle, data.failedOperations.length === 0
              ? <p className="text-sm text-navy/70">{t.jobsEmpty}</p>
              : <DataTable columns={jobColumns} rows={data.failedOperations} rowKey={(row) => row.id} caption={t.jobsTitle} />)}

            {section("incidents-title", t.incidentsTitle, data.incidents.length === 0
              ? <p className="text-sm text-navy/70">{t.incidentsEmpty}</p>
              : <DataTable columns={incidentColumns} rows={data.incidents} rowKey={(row) => row.id} caption={t.incidentsTitle} />)}
          </>
        ) : null}
      </DataState>
    </div>
  );
}
