"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AreaState, SystemHealth } from "@/product/admin-console/health";
import type { AlertDelivery, FailedOperation, Incident, ServiceHealth, SystemError } from "@/product/reliability/types";
import { Link } from "@/i18n/navigation";
import { SkeletonTiles } from "@/components/ui/Skeleton";
import { adminFetch, queryString, useAdminAction, useAdminData, useAdminPermissions } from "./api";
import {
  Badge,
  BusinessSelect,
  ConfirmPanel,
  DataState,
  DataTable,
  Field,
  FilterBar,
  Notice,
  PageHeader,
  Tile,
  card,
  formatDateTime,
  inputClass,
  primaryButton,
  secondaryButton,
  useCommon,
  useErrorText,
  useLoadErrorText,
  useLocaleTag,
  type Column,
  type Tone,
} from "./ui";

const en = {
  title: "System health",
  intro:
    "Live readings from the platform: the website, API, voice receptionist, SMS, Stripe, database, calendar and automations, plus the incidents, errors, webhook failures and failed jobs TradeCatch has recorded. Refreshed every minute while this page is open.",
  overall: "Overall",
  overallStates: { healthy: "Healthy", degraded: "Degraded", unavailable: "Unavailable" } as Record<string, string>,
  checked: "Checked",
  database: "Database",
  apiRequests: "API requests",
  noTraffic: "No traffic recorded yet",
  serverErrors: "Server errors (5xx)",
  errorRate: "Server error rate",
  authFailures: "Sign-in and permission failures",
  authFailuresNote: "401 and 403 responses",
  rateLimited: "Rate-limited requests",
  rateLimitedNote: "429 responses",
  latency: "Response time (p95)",
  latencyNote: "median within {avg} ms",
  openErrors: "Open errors",
  webhooks: "Webhook failures",
  failedJobs: "Failed jobs",
  jobsLine: "{pending} pending · {failed} failed · {dead} gave up · {resolved} resolved",

  monitorNever:
    "The monitor has not run yet. Nothing below has been measured by it, so no area is shown as healthy.",
  monitorStale:
    "The monitor last ran {ago} ago. Until it runs again, areas are shown as not measured rather than healthy.",
  monitorRunning: "Monitor last ran {ago} ago.",

  areasTitle: "Areas",
  areasIntro:
    "Each area is judged only from what the monitor measured and from recorded incidents. “Not measured” means nobody has checked it recently; it is never shown as healthy by default.",
  areaNames: {
    website: "Website",
    api: "API",
    receptionist: "Voice receptionist",
    sms: "SMS",
    stripe: "Stripe billing",
    database: "Database",
    calendar: "Calendar",
    automations: "Automations",
  } as Record<string, string>,
  areaStates: { healthy: "Healthy", degraded: "Degraded", incident: "Incident", unknown: "Not measured" } as Record<string, string>,
  areaHealthy: "No active incidents.",
  areaDegraded: "A recent check found a problem.",
  incidentsOne: "1 active incident",
  incidentsMany: "{n} active incidents",
  warningsOne: "1 active warning",
  warningsMany: "{n} active warnings",
  areaReasons: {
    monitor_never: "The monitor has not run yet.",
    monitor_stale: "The monitor has not run recently.",
    no_address: "No public address is configured to check.",
    no_database: "No database is configured to check.",
    no_traffic: "No traffic has been recorded yet.",
    data_unreadable: "The data for this check could not be read.",
  } as Record<string, string>,
  checkedAt: "Checked {time}",

  alertsTitle: "Alert emails",
  alertsIntro:
    "Emails sent to administrators when an incident opens, escalates or recovers. A failed send is retried a limited number of times and is listed here with a short reason. Message contents are never shown.",
  alertsWaiting: "Waiting to send",
  alertsGaveUp: "Gave up",
  alertsSent: "Sent in 24 hours",
  alertsLastFailure: "Last failure {time}",
  alertsFailedNotice:
    "Some alert emails could not be delivered after repeated attempts. Check that an administrator email address and the email provider are configured.",
  alertsEmpty: "No failed alert emails.",
  alertKinds: {
    opened: "Opening alert",
    escalated: "Escalation",
    reminder: "Reminder",
    recovered: "Recovery notice",
    digest: "Summary alert",
  } as Record<string, string>,
  alertStatuses: { pending: "Waiting to retry", sent: "Sent", exhausted: "Gave up" } as Record<string, string>,
  alertErrors: {
    send_failed: "The email provider failed to send it",
    timeout: "The email provider did not answer in time",
    not_configured: "No administrator email or email provider is configured",
  } as Record<string, string>,
  nextAttempt: "Next attempt",
  showIncident: "Show incident",
  kind: "Kind",
  priority: "Priority",

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
    notifications: "Notifications", website: "Website", calcom: "Calendar bookings", scheduling: "Scheduling",
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
  incidentsIntro:
    "Repeated identical failures are grouped into one incident with a count. Open one to see its history, the alert emails sent for it and the errors behind it.",
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
  titleCol: "Incident",
  occurrences: "Occurrences",
  lastSeen: "Last seen",
  simulated: "Simulated",
  platformWide: "Platform-wide",
  errorsEmpty: "No errors match these filters.",
  webhookEmpty: "No webhook failures match these filters.",
  jobsEmpty: "No failed jobs match these filters.",
  incidentsEmpty: "No incidents match these filters.",
  yes: "Yes",
  no: "No",
  priorities: { critical: "Critical", high: "High", warning: "Warning" } as Record<string, string>,
  severities: { low: "Low", medium: "Medium", high: "High", critical: "Critical" } as Record<string, string>,
  statuses: {
    open: "Active", investigating: "Acknowledged", resolved: "Resolved",
    failed: "Failed", retrying: "Retrying", dead: "Gave up",
  } as Record<string, string>,
  statusFilter: "Status",
  anyStatus: "Any status",
  serviceFilter: "Service",
  anyService: "Any service",
  jobsLink: "Open the full reliability desk",
  loadError: "System health could not be loaded.",
  note: "Worker and API errors here are the failures this app recorded itself. Cloudflare's own analytics are not connected.",

  detailLoading: "Loading the incident…",
  detailLoadError: "The incident details could not be loaded.",
  firstSeen: "First seen",
  reopenedTimes: "Reopened",
  affected: "Businesses affected",
  acknowledgedBy: "Acknowledged by",
  resolvedBy: "Resolved by",
  clearedOnItsOwn: "Cleared on its own",
  diagRef: "Diagnostic reference",
  requestRef: "Request reference",
  category: "Category",
  history: "History",
  noHistory: "No history recorded.",
  incidentAlerts: "Alert emails for this incident",
  incidentAlertsEmpty: "No alert emails have been queued for this incident.",
  incidentErrors: "Recent errors behind it",
  incidentErrorsEmpty: "No recorded errors.",
  acknowledge: "Acknowledge",
  resolve: "Mark resolved",
  resolveTitle: "Mark this incident resolved?",
  resolveBody: "Use this once the cause is fixed. If the problem is still happening, the incident will open again by itself.",
  cannotChange: "Your role can view incidents but not acknowledge or resolve them.",
  changeFailed: "The incident could not be changed. It may already be resolved; refresh and try again.",
  eventKinds: {
    opened: "Opened",
    reopened: "Opened again",
    escalated: "Escalated",
    acknowledged: "Acknowledged",
    resolved: "Resolved",
    alert_suppressed: "Alert held back to avoid flooding",
    admin_notified: "Administrators emailed",
    admin_notification_failed: "Alert email failed, will retry",
    admin_notification_exhausted: "Alert email gave up",
    reminder: "Reminder",
    digest: "Included in a summary alert",
  } as Record<string, string>,
};
type Copy = typeof en;
const fr: Copy = {
  title: "Santé du système",
  intro:
    "Relevés en direct de la plateforme : site Web, API, réceptionniste vocale, SMS, Stripe, base de données, agenda et automatisations, ainsi que les incidents, erreurs, échecs de webhook et tâches en échec consignés par TradeCatch. Actualisés chaque minute tant que cette page est ouverte.",
  overall: "Ensemble",
  overallStates: { healthy: "En bonne santé", degraded: "Dégradé", unavailable: "Indisponible" },
  checked: "Vérifié",
  database: "Base de données",
  apiRequests: "Requêtes API",
  noTraffic: "Aucun trafic consigné pour l’instant",
  serverErrors: "Erreurs serveur (5xx)",
  errorRate: "Taux d’erreurs serveur",
  authFailures: "Échecs de connexion et d’autorisation",
  authFailuresNote: "Réponses 401 et 403",
  rateLimited: "Requêtes limitées",
  rateLimitedNote: "Réponses 429",
  latency: "Temps de réponse (p95)",
  latencyNote: "médiane sous {avg} ms",
  openErrors: "Erreurs ouvertes",
  webhooks: "Échecs de webhook",
  failedJobs: "Tâches en échec",
  jobsLine: "{pending} en attente · {failed} échouées · {dead} abandonnées · {resolved} résolues",

  monitorNever:
    "La surveillance ne s’est pas encore exécutée. Rien ci-dessous n’a été mesuré par elle, donc aucun secteur n’est présenté comme sain.",
  monitorStale:
    "La surveillance s’est exécutée pour la dernière fois il y a {ago}. D’ici sa prochaine exécution, les secteurs sont présentés comme non mesurés plutôt que sains.",
  monitorRunning: "Dernière exécution de la surveillance il y a {ago}.",

  areasTitle: "Secteurs",
  areasIntro:
    "Chaque secteur est jugé uniquement d’après les mesures de la surveillance et les incidents consignés. « Non mesuré » signifie que personne ne l’a vérifié récemment; il n’est jamais présenté comme sain par défaut.",
  areaNames: {
    website: "Site Web",
    api: "API",
    receptionist: "Réceptionniste vocale",
    sms: "SMS",
    stripe: "Facturation Stripe",
    database: "Base de données",
    calendar: "Agenda",
    automations: "Automatisations",
  },
  areaStates: { healthy: "En bonne santé", degraded: "Dégradé", incident: "Incident", unknown: "Non mesuré" },
  areaHealthy: "Aucun incident actif.",
  areaDegraded: "Une vérification récente a relevé un problème.",
  incidentsOne: "1 incident actif",
  incidentsMany: "{n} incidents actifs",
  warningsOne: "1 avertissement actif",
  warningsMany: "{n} avertissements actifs",
  areaReasons: {
    monitor_never: "La surveillance ne s’est pas encore exécutée.",
    monitor_stale: "La surveillance ne s’est pas exécutée récemment.",
    no_address: "Aucune adresse publique n’est configurée pour la vérification.",
    no_database: "Aucune base de données n’est configurée pour la vérification.",
    no_traffic: "Aucun trafic n’a encore été consigné.",
    data_unreadable: "Les données de cette vérification n’ont pas pu être lues.",
  },
  checkedAt: "Vérifié {time}",

  alertsTitle: "Courriels d’alerte",
  alertsIntro:
    "Courriels envoyés aux administrateurs quand un incident s’ouvre, s’aggrave ou se rétablit. Un envoi échoué est retenté un nombre limité de fois et figure ici avec une courte raison. Le contenu des messages n’est jamais affiché.",
  alertsWaiting: "En attente d’envoi",
  alertsGaveUp: "Abandonnés",
  alertsSent: "Envoyés en 24 heures",
  alertsLastFailure: "Dernier échec {time}",
  alertsFailedNotice:
    "Certains courriels d’alerte n’ont pas pu être livrés après plusieurs tentatives. Vérifiez qu’une adresse courriel d’administrateur et le fournisseur de courriel sont configurés.",
  alertsEmpty: "Aucun courriel d’alerte en échec.",
  alertKinds: {
    opened: "Alerte d’ouverture",
    escalated: "Aggravation",
    reminder: "Rappel",
    recovered: "Avis de rétablissement",
    digest: "Alerte récapitulative",
  },
  alertStatuses: { pending: "En attente de nouvelle tentative", sent: "Envoyé", exhausted: "Abandonné" },
  alertErrors: {
    send_failed: "Le fournisseur de courriel n’a pas pu l’envoyer",
    timeout: "Le fournisseur de courriel n’a pas répondu à temps",
    not_configured: "Aucun courriel d’administrateur ni fournisseur de courriel n’est configuré",
  },
  nextAttempt: "Prochaine tentative",
  showIncident: "Afficher l’incident",
  kind: "Type",
  priority: "Priorité",

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
    notifications: "Notifications", website: "Site Web", calcom: "Réservations d’agenda", scheduling: "Planification",
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
  incidentsIntro:
    "Les échecs identiques et répétés sont regroupés en un seul incident avec un compteur. Ouvrez-en un pour voir son historique, les courriels d’alerte envoyés et les erreurs en cause.",
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
  titleCol: "Incident",
  occurrences: "Occurrences",
  lastSeen: "Dernière occurrence",
  simulated: "Simulé",
  platformWide: "Toute la plateforme",
  errorsEmpty: "Aucune erreur ne correspond à ces filtres.",
  webhookEmpty: "Aucun échec de webhook ne correspond à ces filtres.",
  jobsEmpty: "Aucune tâche en échec ne correspond à ces filtres.",
  incidentsEmpty: "Aucun incident ne correspond à ces filtres.",
  yes: "Oui",
  no: "Non",
  priorities: { critical: "Critique", high: "Élevée", warning: "Avertissement" },
  severities: { low: "Faible", medium: "Moyenne", high: "Élevée", critical: "Critique" },
  statuses: {
    open: "Actif", investigating: "Pris en compte", resolved: "Résolu",
    failed: "Échoué", retrying: "Nouvelle tentative", dead: "Abandonné",
  },
  statusFilter: "Statut",
  anyStatus: "Tout statut",
  serviceFilter: "Service",
  anyService: "Tout service",
  jobsLink: "Ouvrir le bureau de fiabilité complet",
  loadError: "La santé du système n’a pas pu être chargée.",
  note: "Les erreurs Worker et API affichées ici sont les échecs que l’application a elle-même consignés. Les analyses propres à Cloudflare ne sont pas connectées.",

  detailLoading: "Chargement de l’incident…",
  detailLoadError: "Les détails de l’incident n’ont pas pu être chargés.",
  firstSeen: "Première occurrence",
  reopenedTimes: "Rouvert",
  affected: "Entreprises touchées",
  acknowledgedBy: "Pris en compte par",
  resolvedBy: "Résolu par",
  clearedOnItsOwn: "Rétabli de lui-même",
  diagRef: "Référence de diagnostic",
  requestRef: "Référence de requête",
  category: "Catégorie",
  history: "Historique",
  noHistory: "Aucun historique consigné.",
  incidentAlerts: "Courriels d’alerte de cet incident",
  incidentAlertsEmpty: "Aucun courriel d’alerte n’a été mis en file pour cet incident.",
  incidentErrors: "Erreurs récentes en cause",
  incidentErrorsEmpty: "Aucune erreur consignée.",
  acknowledge: "Prendre en compte",
  resolve: "Marquer comme résolu",
  resolveTitle: "Marquer cet incident comme résolu?",
  resolveBody: "À utiliser une fois la cause corrigée. Si le problème persiste, l’incident se rouvrira de lui-même.",
  cannotChange: "Votre rôle permet de consulter les incidents, mais pas de les prendre en compte ni de les résoudre.",
  changeFailed: "L’incident n’a pas pu être modifié. Il est peut-être déjà résolu; actualisez et réessayez.",
  eventKinds: {
    opened: "Ouvert",
    reopened: "Rouvert",
    escalated: "Aggravé",
    acknowledged: "Pris en compte",
    resolved: "Résolu",
    alert_suppressed: "Alerte retenue pour éviter l’inondation",
    admin_notified: "Administrateurs avisés par courriel",
    admin_notification_failed: "Courriel d’alerte échoué, nouvelle tentative prévue",
    admin_notification_exhausted: "Courriel d’alerte abandonné",
    reminder: "Rappel",
    digest: "Inclus dans une alerte récapitulative",
  },
};

const PRIORITY_TONE: Record<string, Tone> = { critical: "bad", high: "warn", warning: "neutral" };
const SEVERITY_TONE: Record<string, Tone> = { low: "neutral", medium: "warn", high: "bad", critical: "bad" };
const STATUS_TONE: Record<string, Tone> = {
  open: "bad", investigating: "warn", resolved: "good", failed: "bad", retrying: "warn", dead: "bad",
};
const HEALTH_TONE: Record<string, Tone> = { healthy: "good", degraded: "warn", unavailable: "bad", unknown: "neutral" };
const AREA_TONE: Record<AreaState, Tone> = { healthy: "good", degraded: "warn", incident: "bad", unknown: "neutral" };
const DELIVERY_TONE: Record<string, Tone> = { pending: "warn", sent: "good", exhausted: "bad" };

const SERVICES = [
  "website", "api", "database", "ai_receptionist", "twilio_voice", "twilio_sms", "google_calendar", "stripe", "jobs", "notifications",
];

type Response = SystemHealth & { ok: true };
type IncidentEvent = { kind: string; detail?: string; actor?: string; at: string };
type DetailResponse = {
  ok: true;
  incident: Incident;
  events: IncidentEvent[];
  deliveries: AlertDelivery[];
  errors: SystemError[];
};

/** Critical, High or Warning, from the priority KAN-28 records, or the older severity. */
function priorityOf(incident: Incident): "critical" | "high" | "warning" {
  if (incident.priority) return incident.priority;
  return incident.severity === "critical" ? "critical" : incident.severity === "high" ? "high" : "warning";
}

/** The incident an alert email linked to, if the address names a well-formed one. */
function linkedIncident(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("incident");
  return value && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : null;
}

function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function BusinessCell({ organizationId, t }: { organizationId?: string; t: Copy }) {
  return organizationId ? (
    <Link href={{ pathname: "/admin/businesses/[id]", params: { id: organizationId } }} className="underline">
      {organizationId}
    </Link>
  ) : (
    <span className="text-navy/70">{t.platformWide}</span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-navy/70">{label}</dt>
      <dd className="break-words text-sm text-navy">{children}</dd>
    </div>
  );
}

function eventDetail(t: Copy, event: IncidentEvent): string | null {
  if (!event.detail) return null;
  if (event.kind === "escalated") {
    const [from, to] = event.detail.split(" to ");
    return from && to ? `${t.priorities[from] ?? from} → ${t.priorities[to] ?? to}` : null;
  }
  if (event.kind === "admin_notified") return t.alertKinds[event.detail] ?? null;
  if (event.kind === "admin_notification_failed" || event.kind === "admin_notification_exhausted")
    return t.alertErrors[event.detail] ?? event.detail;
  return null;
}

function IncidentDetail({
  id,
  t,
  locale,
  canManage,
  permissionKnown,
  errorColumns,
  deliveryColumns,
  onClose,
  onChanged,
}: {
  id: string;
  t: Copy;
  locale: "en" | "fr";
  canManage: boolean;
  permissionKnown: boolean;
  errorColumns: Column<SystemError>[];
  deliveryColumns: Column<AlertDelivery>[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const common = useCommon();
  const errorText = useErrorText();
  const loadError = useLoadErrorText();
  const action = useAdminAction();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);
  const detail = useAdminData<DetailResponse>(`/api/admin/incidents/${encodeURIComponent(id)}`);
  const loaded = Boolean(detail.data);

  // Move keyboard and screen-reader focus to the details once they have loaded.
  useEffect(() => {
    if (loaded) heading.current?.focus();
  }, [loaded]);

  const when = (iso: string) => formatDateTime(iso, locale);

  async function change(kind: "acknowledge" | "resolve") {
    const result = await action.run(() =>
      adminFetch(`/api/admin/incidents/${encodeURIComponent(id)}/${kind}`, { method: "POST", body: {} }),
    );
    if (result) {
      setConfirming(false);
      detail.refresh();
      onChanged();
    }
  }

  const incident = detail.data?.incident;
  const priority = incident ? priorityOf(incident) : "warning";

  return (
    <section className={`${card} flex flex-col gap-4 border-navy/30`} aria-labelledby={headingId}>
      {!incident ? (
        detail.error ? (
          <div className="flex flex-col gap-2">
            <Notice tone="bad">{loadError(detail.error, t.detailLoadError)}</Notice>
            <div className="flex gap-2">
              <button type="button" className={secondaryButton} onClick={detail.refresh}>{common.retry}</button>
              <button type="button" className={secondaryButton} onClick={onClose}>{common.close}</button>
            </div>
          </div>
        ) : (
          <p id={headingId} role="status" className="text-sm text-navy/70">{t.detailLoading}</p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={headingId} ref={heading} tabIndex={-1} className="break-words font-semibold text-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-navy/60">
                {incident.title}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={PRIORITY_TONE[priority]}>{t.priorities[priority]}</Badge>
                <Badge tone={STATUS_TONE[incident.status] ?? "neutral"}>{t.statuses[incident.status] ?? incident.status}</Badge>
                {incident.simulated ? <Badge tone="info">{t.simulated}</Badge> : null}
              </div>
              {incident.summary ? <p className="mt-2 break-words text-sm text-navy/80">{incident.summary}</p> : null}
            </div>
            <button type="button" className={secondaryButton} onClick={onClose}>{common.close}</button>
          </div>

          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t.service}>{t.serviceNames[incident.service] ?? incident.service}</Fact>
            {incident.category ? <Fact label={t.category}><code className="break-all text-xs">{incident.category}</code></Fact> : null}
            <Fact label={t.occurrences}>{incident.occurrenceCount ?? 1}</Fact>
            <Fact label={t.firstSeen}>{when(incident.firstSeenAt ?? incident.createdAt)}</Fact>
            <Fact label={t.lastSeen}>{when(incident.lastSeenAt ?? incident.createdAt)}</Fact>
            {incident.reopenCount ? <Fact label={t.reopenedTimes}>{incident.reopenCount}</Fact> : null}
            <Fact label={t.business}><BusinessCell organizationId={incident.organizationId} t={t} /></Fact>
            {incident.affectedBusinesses ? <Fact label={t.affected}>{incident.affectedBusinesses}</Fact> : null}
            {incident.acknowledgedAt ? (
              <Fact label={t.acknowledgedBy}>
                {incident.acknowledgedBy ?? "—"} · {when(incident.acknowledgedAt)}
              </Fact>
            ) : null}
            {incident.resolvedAt ? (
              <Fact label={t.resolvedBy}>
                {incident.resolvedBy === "auto" ? t.clearedOnItsOwn : (incident.resolvedBy ?? "—")} · {when(incident.resolvedAt)}
              </Fact>
            ) : null}
            <Fact label={t.diagRef}><code className="break-all text-xs">{incident.id}</code></Fact>
            {incident.correlationId && incident.correlationId !== incident.id ? (
              <Fact label={t.requestRef}><code className="break-all text-xs">{incident.correlationId}</code></Fact>
            ) : null}
          </dl>

          {incident.status !== "resolved" ? (
            <div className="flex flex-col gap-2">
              {permissionKnown && !canManage ? <Notice tone="neutral">{t.cannotChange}</Notice> : null}
              {action.error ? <Notice tone="bad">{errorText(action.error, { default: t.changeFailed })}</Notice> : null}
              {confirming ? (
                <ConfirmPanel
                  title={t.resolveTitle}
                  description={t.resolveBody}
                  confirmLabel={t.resolve}
                  busy={action.pending}
                  onConfirm={() => void change("resolve")}
                  onCancel={() => { setConfirming(false); action.reset(); }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {incident.status === "open" ? (
                    <button type="button" className={primaryButton} disabled={!canManage || action.pending} onClick={() => void change("acknowledge")}>
                      {action.pending ? common.working : t.acknowledge}
                    </button>
                  ) : null}
                  <button type="button" className={secondaryButton} disabled={!canManage || action.pending} onClick={() => setConfirming(true)}>
                    {t.resolve}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-navy">{t.history}</h3>
            {detail.data && detail.data.events.length > 0 ? (
              <ol className="flex flex-col divide-y divide-navy/10 text-sm">
                {detail.data.events.map((event, index) => {
                  const extra = eventDetail(t, event);
                  return (
                    <li key={`${event.at}-${event.kind}-${index}`} className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3">
                      <span className="text-xs text-navy/70 sm:w-44 sm:shrink-0">{when(event.at)}</span>
                      <span className="min-w-0 break-words text-navy">
                        {t.eventKinds[event.kind] ?? event.kind}
                        {extra ? <span className="text-navy/70"> · {extra}</span> : null}
                        {event.actor ? <span className="text-navy/70"> · {event.actor}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-navy/70">{t.noHistory}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-navy">{t.incidentAlerts}</h3>
            {detail.data && detail.data.deliveries.length > 0 ? (
              <DataTable columns={deliveryColumns} rows={detail.data.deliveries} rowKey={(row) => row.id} caption={t.incidentAlerts} />
            ) : (
              <p className="text-sm text-navy/70">{t.incidentAlertsEmpty}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-navy">{t.incidentErrors}</h3>
            {detail.data && detail.data.errors.length > 0 ? (
              <DataTable columns={errorColumns} rows={detail.data.errors} rowKey={(row) => row.id} caption={t.incidentErrors} />
            ) : (
              <p className="text-sm text-navy/70">{t.incidentErrorsEmpty}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function SystemHealthConsole() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const common = useCommon();
  const loadError = useLoadErrorText();
  const { can, known } = useAdminPermissions();

  const [businessId, setBusinessId] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // The link in an alert email is /admin/system-health?incident=<id>; open that incident.
  // It only affects what renders once the data has loaded, so the server and the first
  // client render agree.
  const [selected, setSelected] = useState<string | null>(linkedIncident);

  const url = `/api/admin/health${queryString({ businessId, status, service, from, to })}`;
  const { data, error, loading, refresh, updatedAt } = useAdminData<Response>(url, { autoRefreshMs: 60_000 });
  const filtered = Boolean(businessId || status || service || from || to);

  const when = (iso: string) => formatDateTime(iso, locale);
  const orgCell = (organizationId?: string) => <BusinessCell organizationId={organizationId} t={t} />;
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many.replace("{n}", String(count)));

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

  const deliveryColumnsFor = (withIncident: boolean): Column<AlertDelivery>[] => [
    { id: "when", header: t.when, primary: true, cell: (row) => when(row.createdAt) },
    { id: "kind", header: t.kind, cell: (row) => t.alertKinds[row.kind] ?? row.kind },
    { id: "priority", header: t.priority, cell: (row) => <Badge tone={PRIORITY_TONE[row.priority]}>{t.priorities[row.priority] ?? row.priority}</Badge> },
    { id: "status", header: t.status, cell: (row) => <Badge tone={DELIVERY_TONE[row.status] ?? "neutral"}>{t.alertStatuses[row.status] ?? row.status}</Badge> },
    { id: "attempts", header: t.attempts, cell: (row) => row.attempts },
    {
      id: "error",
      header: t.lastError,
      cell: (row) => (
        <>
          <span className="break-words">{row.lastError ? (t.alertErrors[row.lastError] ?? row.lastError) : "—"}</span>
          {row.status === "pending" ? <span className="mt-1 block text-xs text-navy/70">{t.nextAttempt}: {when(row.nextAttemptAt)}</span> : null}
        </>
      ),
    },
    ...(withIncident
      ? [{
          id: "incident",
          header: t.titleCol,
          cell: (row: AlertDelivery) =>
            row.incidentId ? (
              <button type="button" className="font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60" onClick={() => setSelected(row.incidentId)}>
                {t.showIncident}
              </button>
            ) : (
              <span className="text-navy/70">—</span>
            ),
        }]
      : []),
  ];

  const incidentColumns: Column<Incident>[] = [
    {
      id: "title",
      header: t.titleCol,
      primary: true,
      cell: (row) => (
        <button
          type="button"
          aria-expanded={selected === row.id}
          onClick={() => setSelected(selected === row.id ? null : row.id)}
          className="break-words text-left font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60"
        >
          {row.title}
        </button>
      ),
    },
    { id: "priority", header: t.priority, cell: (row) => { const p = priorityOf(row); return <Badge tone={PRIORITY_TONE[p]}>{t.priorities[p]}</Badge>; } },
    { id: "status", header: t.status, cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{t.statuses[row.status] ?? row.status}</Badge> },
    { id: "count", header: t.occurrences, cell: (row) => row.occurrenceCount ?? 1 },
    { id: "last", header: t.lastSeen, cell: (row) => when(row.lastSeenAt ?? row.createdAt) },
    { id: "service", header: t.service, cell: (row) => t.serviceNames[row.service] ?? row.service },
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
            {data.monitor.state === "never" ? <Notice tone="warn">{t.monitorNever}</Notice> : null}
            {data.monitor.state === "stale" ? (
              <Notice tone="bad">{t.monitorStale.replace("{ago}", ago(data.monitor.ageMs ?? 0))}</Notice>
            ) : null}
            {data.monitor.state === "running" ? (
              <p className="text-xs text-navy/70">{t.monitorRunning.replace("{ago}", ago(data.monitor.ageMs ?? 0))}</p>
            ) : null}

            {section("areas-title", t.areasTitle, (
              <>
                <p className="text-sm text-navy/70">{t.areasIntro}</p>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {data.areas.map((area) => (
                    <li key={area.key} data-area={area.key} data-state={area.state} className="flex flex-col gap-2 rounded-md border border-navy/10 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-navy">{t.areaNames[area.key] ?? area.key}</p>
                        <Badge tone={AREA_TONE[area.state]}>{t.areaStates[area.state]}</Badge>
                      </div>
                      <p className="break-words text-xs text-navy/70">
                        {area.state === "unknown"
                          ? (area.reason ? t.areaReasons[area.reason] : null)
                          : area.activeIncidents > 0
                            ? area.highest === "warning"
                              ? plural(area.activeIncidents, t.warningsOne, t.warningsMany)
                              : plural(area.activeIncidents, t.incidentsOne, t.incidentsMany)
                            : area.state === "degraded"
                              ? t.areaDegraded
                              : t.areaHealthy}
                      </p>
                      {area.checkedAt ? <p className="text-xs text-navy/70">{t.checkedAt.replace("{time}", when(area.checkedAt))}</p> : null}
                    </li>
                  ))}
                </ul>
              </>
            ))}

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
              <Tile label={t.apiRequests} value={data.api.trafficAvailable ? data.api.requests : "—"} note={data.api.trafficAvailable ? undefined : t.noTraffic} />
              <Tile
                label={t.serverErrors}
                value={data.api.trafficAvailable ? data.api.serverErrors : "—"}
                tone={data.api.serverErrors > 0 ? "warn" : "neutral"}
                note={data.api.trafficAvailable ? `${t.errorRate}: ${(data.api.errorRate * 100).toFixed(1)}%` : t.noTraffic}
              />
              <Tile
                label={t.latency}
                value={data.api.trafficAvailable ? `${data.api.p95Ms} ms` : "—"}
                note={data.api.trafficAvailable ? t.latencyNote.replace("{avg}", String(data.api.p50Ms)) : t.noTraffic}
              />
              <Tile label={t.authFailures} value={data.api.trafficAvailable ? data.api.authErrors : "—"} note={t.authFailuresNote} />
              <Tile label={t.rateLimited} value={data.api.trafficAvailable ? data.api.rateLimited : "—"} note={t.rateLimitedNote} />
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

            {section("alerts-title", t.alertsTitle, (
              <>
                <p className="text-sm text-navy/70">{t.alertsIntro}</p>
                {data.alerts.summary.exhausted > 0 ? <Notice tone="bad">{t.alertsFailedNotice}</Notice> : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Tile label={t.alertsWaiting} value={data.alerts.summary.pending} tone={data.alerts.summary.pending > 0 ? "warn" : "neutral"} />
                  <Tile label={t.alertsGaveUp} value={data.alerts.summary.exhausted} tone={data.alerts.summary.exhausted > 0 ? "bad" : "neutral"} />
                  <Tile
                    label={t.alertsSent}
                    value={data.alerts.summary.sentLast24h}
                    note={data.alerts.summary.lastFailureAt ? t.alertsLastFailure.replace("{time}", when(data.alerts.summary.lastFailureAt)) : undefined}
                  />
                </div>
                {data.alerts.failed.length === 0
                  ? <p className="text-sm text-navy/70">{t.alertsEmpty}</p>
                  : <DataTable columns={deliveryColumnsFor(true)} rows={data.alerts.failed} rowKey={(row) => row.id} caption={t.alertsTitle} />}
              </>
            ))}

            {section("incidents-title", t.incidentsTitle, (
              <>
                <p className="text-sm text-navy/70">{t.incidentsIntro}</p>
                {data.incidents.length === 0
                  ? <p className="text-sm text-navy/70">{t.incidentsEmpty}</p>
                  : <DataTable columns={incidentColumns} rows={data.incidents} rowKey={(row) => row.id} caption={t.incidentsTitle} />}
              </>
            ))}

            {selected ? (
              <IncidentDetail
                key={selected}
                id={selected}
                t={t}
                locale={locale}
                canManage={known && can("admin.manage")}
                permissionKnown={known}
                errorColumns={errorColumns}
                deliveryColumns={deliveryColumnsFor(false)}
                onClose={() => setSelected(null)}
                onChanged={refresh}
              />
            ) : null}

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
          </>
        ) : null}
      </DataState>
    </div>
  );
}
