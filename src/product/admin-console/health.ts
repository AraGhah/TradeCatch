import type { MonitorStatus, ReliabilityService } from "@/product/reliability/service";
import {
  DISPLAY_PRIORITY_RANK,
  displayPriority,
  type AlertDelivery,
  type DisplayPriority,
  type FailedOperation,
  type Incident,
  type Priority,
  type ServiceHealth,
  type SystemError,
} from "@/product/reliability/types";

/**
 * One consolidated view of platform health for the console. Everything comes
 * from systems that already record it: the reliability service (provider
 * probes, recorded errors, incidents, failed jobs, request outcomes) and the
 * environment (which integrations are configured). Nothing is invented: a
 * value we cannot know is reported as unknown, with the reason.
 */

export type IntegrationConfig = {
  key: "twilio" | "bland" | "stripe" | "resend" | "cloudflare";
  /** Whether the credentials this integration needs are present. Never the credentials. */
  configured: boolean;
  detail: string;
};

type EnvLike = Record<string, string | undefined>;

/** Presence checks only: a boolean per integration, never a value. */
export function integrationConfig(env: EnvLike = process.env): IntegrationConfig[] {
  const has = (name: string) => Boolean(env[name]?.trim());
  const bland =
    has("BLAND_ROUTES_JSON") || has("BLAND_API_KEY") || has("BLAND_WEBHOOK_SECRET");
  return [
    {
      key: "twilio",
      configured: has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN"),
      detail: "Voice and SMS provider credentials",
    },
    {
      key: "bland",
      configured: bland,
      detail: "Bland AI voice receptionist routing and webhook secret",
    },
    {
      key: "stripe",
      configured: has("STRIPE_SECRET_KEY") || has("STRIPE_TEST_SECRET_KEY"),
      detail: has("STRIPE_WEBHOOK_SECRET") || has("STRIPE_TEST_WEBHOOK_SECRET")
        ? "API key and webhook signing secret"
        : "API key set, but no webhook signing secret: payment events will be rejected",
    },
    {
      key: "resend",
      configured: has("RESEND_API_KEY") && has("RESEND_FROM_EMAIL"),
      detail: has("ADMIN_ALERT_EMAIL") || has("RESEND_NOTIFY_EMAIL")
        ? "Email provider and administrator notification address"
        : "Email provider set, but no administrator notification address",
    },
    {
      // The Worker cannot read its own Cloudflare analytics; say so rather than guess.
      key: "cloudflare",
      configured: false,
      detail:
        "Worker/API errors shown here are the 5xx responses and failures this app recorded itself. Cloudflare's own analytics are not connected.",
    },
  ];
}

/** The parts of the platform an administrator asks about first. */
export const AREA_KEYS = [
  "website",
  "api",
  "receptionist",
  "sms",
  "stripe",
  "database",
  "calendar",
  "automations",
] as const;
export type AreaKey = (typeof AREA_KEYS)[number];

/**
 * incident: a critical or high incident is active (acknowledged still counts).
 * degraded: only warnings, or the monitor's own check is failing.
 * healthy: measured recently and nothing active.
 * unknown: not measured (monitor never ran, stale, or that signal failed).
 */
export type AreaState = "healthy" | "degraded" | "incident" | "unknown";

/** Why an area is "unknown". The console words these itself, in either language. */
export type AreaReason =
  | "monitor_never"
  | "monitor_stale"
  | "no_address"
  | "no_database"
  | "no_traffic"
  | "data_unreadable";

export type AreaStatus = {
  key: AreaKey;
  state: AreaState;
  /** Set only when state is "unknown". */
  reason: AreaReason | null;
  activeIncidents: number;
  highest: Priority | null;
  /** English summary for API consumers; the console words it itself. */
  detail: string;
  checkedAt: string | null;
};

const AREA_BY_SERVICE: Record<string, AreaKey> = {
  website: "website",
  api: "api",
  ai_receptionist: "receptionist",
  receptionist: "receptionist",
  twilio_voice: "receptionist",
  twilio_sms: "sms",
  notifications: "sms",
  stripe: "stripe",
  database: "database",
  google_calendar: "calendar",
  calcom: "calendar",
  scheduling: "calendar",
  jobs: "automations",
  automations: "automations",
};

/** Which monitor collectors measure each area; if one failed, the area is not measured. */
const COLLECTORS: Partial<Record<AreaKey, string[]>> = {
  receptionist: ["calls"],
  sms: ["sms_automation", "sms_missed_call", "sms_notifications"],
  automations: ["automations"],
  calendar: ["calendar_credentials", "calendar_failures"],
  stripe: ["stripe_webhooks", "stripe_billing"],
};

export function areaOfService(service: string): AreaKey | null {
  return AREA_BY_SERVICE[service.startsWith("health:") ? service.slice(7) : service] ?? null;
}

const RANK: Record<Priority, number> = { warning: 0, high: 1, critical: 2 };

export function deriveAreas(input: {
  incidents: Incident[];
  monitor: MonitorStatus;
  trafficAvailable: boolean;
}): AreaStatus[] {
  const { monitor } = input;
  const live = input.incidents.filter((i) => !i.simulated && i.status !== "resolved");
  return AREA_KEYS.map((key): AreaStatus => {
    const active = live.filter((i) => areaOfService(i.service) === key);
    const highest = active.reduce<Priority | null>((top, i) => {
      const p = i.priority ?? "warning";
      return top === null || RANK[p] > RANK[top] ? p : top;
    }, null);
    const base = {
      key,
      activeIncidents: active.length,
      highest,
      checkedAt: monitor.lastRunAt,
      reason: null,
    };
    if (highest === "critical" || highest === "high")
      return { ...base, state: "incident", detail: `${active.length} active incident(s)` };
    if (highest === "warning")
      return { ...base, state: "degraded", detail: `${active.length} active warning(s)` };

    const unknown = (reason: AreaReason, text: string): AreaStatus => ({
      ...base,
      checkedAt: null,
      state: "unknown",
      reason,
      detail: `Not measured: ${text}`,
    });
    if (monitor.state === "never") return unknown("monitor_never", "the monitor has not run yet");
    if (monitor.state === "stale") return unknown("monitor_stale", "the monitor has not run recently");

    if (key === "website") {
      if (monitor.website === "not_measured") return unknown("no_address", "no public address to check");
      return monitor.website === "ok"
        ? { ...base, state: "healthy", detail: "Site responding" }
        : { ...base, state: "degraded", detail: "A recent availability check failed" };
    }
    if (key === "database") {
      if (monitor.database === "not_measured") return unknown("no_database", "no database configured");
      return monitor.database === "ok"
        ? { ...base, state: "healthy", detail: "Database answering normally" }
        : {
            ...base,
            state: "degraded",
            detail:
              monitor.database === "slow"
                ? "Database is answering slowly"
                : "A recent database check failed",
          };
    }
    if (key === "api") {
      if (!input.trafficAvailable && monitor.website === "not_measured")
        return unknown("no_traffic", "no traffic recorded yet");
      return { ...base, state: "healthy", detail: "No elevated errors or latency" };
    }
    const needed = COLLECTORS[key] ?? [];
    if (monitor.degraded.includes("signals") || needed.some((name) => monitor.degraded.includes(name)))
      return unknown("data_unreadable", "the data for this check could not be read");
    return { ...base, state: "healthy", detail: "No active incidents" };
  });
}

export type HealthFilter = {
  organizationId?: string;
  /** Applies to errors, incidents and failed operations. */
  status?: "open" | "investigating" | "resolved";
  /** Inclusive YYYY-MM-DD. */
  from?: string;
  to?: string;
  service?: string;
};

export type IncidentCounts = Record<DisplayPriority, number> & { resolved: number };

/** Most urgent first, then the most recently seen. */
function compareIncidents(a: Incident, b: Incident): number {
  const byPriority = DISPLAY_PRIORITY_RANK[displayPriority(b)] - DISPLAY_PRIORITY_RANK[displayPriority(a)];
  if (byPriority !== 0) return byPriority;
  return (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt);
}

export type SystemHealth = {
  generatedAt: string;
  overall: "healthy" | "degraded" | "unavailable";
  database: { state: string; status: string; detail: string | null };
  services: ServiceHealth[];
  integrations: IntegrationConfig[];
  /** Per-area status: website, API, receptionist, SMS, Stripe, database, calendar, automations. */
  areas: AreaStatus[];
  /** When the monitor last ran and what it could not measure. */
  monitor: MonitorStatus;
  /** Administrator alert delivery: waiting, sent, and the failures (short codes only). */
  alerts: {
    summary: {
      pending: number;
      exhausted: number;
      sentLast24h: number;
      lastFailureAt?: string;
      lastError?: string;
    };
    failed: AlertDelivery[];
  };
  api: {
    requests: number;
    serverErrors: number;
    clientErrors: number;
    authErrors: number;
    rateLimited: number;
    errorRate: number;
    /** Upper bound of the latency bin holding the median / 95th percentile ("finished within N ms"). */
    p50Ms: number;
    p95Ms: number;
    /** False until the Worker has recorded real traffic; zeros then mean "no data", not "fast". */
    trafficAvailable: boolean;
  };
  errors: SystemError[];
  /** Errors whose operation is a webhook delivery. */
  webhookFailures: SystemError[];
  failedOperations: FailedOperation[];
  /** Active (open or acknowledged) incidents, Critical first, then High, Warning, Low. */
  incidents: Incident[];
  /** Most recently resolved first. Kept, never deleted. */
  resolvedIncidents: Incident[];
  /** Remaining active incidents per priority, and how many are resolved. */
  incidentCounts: IncidentCounts;
  jobs: { pending: number; failed: number; dead: number; resolved: number };
  /** Counts over the filtered set, for the summary tiles. */
  totals: { openErrors: number; webhookFailures: number; failedOperations: number; openIncidents: number };
};

const dayStart = (date: string) => `${date}T00:00:00.000Z`;
const dayEnd = (date: string) => `${date}T23:59:59.999Z`;

function inRange(at: string, filter: HealthFilter) {
  if (filter.from && at < dayStart(filter.from)) return false;
  if (filter.to && at > dayEnd(filter.to)) return false;
  return true;
}

export const isWebhookOperation = (operation: string) => /webhook/i.test(operation);

export async function loadSystemHealth(
  reliability: ReliabilityService,
  filter: HealthFilter = {},
  env: EnvLike = process.env,
  now: Date = new Date(),
): Promise<SystemHealth> {
  const overview = await reliability.overview();
  const jobs = await reliability.jobs();
  const allErrors = await reliability.listErrors(
    filter.organizationId ? { organizationId: filter.organizationId } : undefined,
  );
  const allIncidents = await reliability.listIncidents(filter.organizationId);
  const operations = await reliability.listFailedOperations();
  const [monitor, alerts] = await Promise.all([reliability.monitor(), reliability.alertStatus()]);
  // Area status is platform-wide even when the table below is filtered to one business.
  const platformIncidents = filter.organizationId
    ? await reliability.listIncidents()
    : allIncidents;

  const errors = allErrors
    .filter((e) => (!filter.status || e.status === filter.status))
    .filter((e) => (!filter.service || e.service === filter.service))
    .filter((e) => inRange(e.createdAt, filter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const matchingIncidents = allIncidents
    .filter((i) => (!filter.status || i.status === filter.status))
    .filter((i) => (!filter.service || i.service === filter.service))
    .filter((i) => inRange(i.createdAt, filter));
  // Active work first, most urgent first; the most recently seen breaks ties.
  const incidents = matchingIncidents
    .filter((i) => i.status !== "resolved")
    .sort(compareIncidents);
  const resolvedIncidents = matchingIncidents
    .filter((i) => i.status === "resolved")
    .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt));
  const incidentCounts: IncidentCounts = { critical: 0, high: 0, warning: 0, low: 0, resolved: resolvedIncidents.length };
  for (const incident of incidents) incidentCounts[displayPriority(incident)] += 1;

  const failedOperations = operations
    .filter((o) => !filter.organizationId || o.organizationId === filter.organizationId)
    .filter((o) => !filter.service || o.service === filter.service)
    .filter((o) => inRange(o.createdAt, filter))
    .filter((o) => {
      if (!filter.status) return o.status !== "resolved";
      // The console's status filter speaks of errors; map it onto job states.
      return filter.status === "resolved"
        ? o.status === "resolved"
        : o.status !== "resolved";
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const database = overview.services.find((s) => s.service === "database");
  const webhookFailures = errors.filter((e) => isWebhookOperation(e.operation));

  return {
    generatedAt: now.toISOString(),
    overall: overview.overall,
    database: {
      state: database?.state ?? "unconfigured",
      status: database?.status ?? "unknown",
      detail: database?.detail ?? null,
    },
    services: overview.services,
    integrations: integrationConfig(env),
    areas: deriveAreas({
      incidents: platformIncidents,
      monitor,
      trafficAvailable: overview.trafficAvailable,
    }),
    monitor,
    alerts,
    api: {
      requests: overview.requests,
      serverErrors: overview.serverErrors,
      clientErrors: overview.clientErrors,
      authErrors: overview.authErrors,
      rateLimited: overview.rateLimited,
      errorRate: overview.errorRate,
      p50Ms: overview.p50Ms,
      p95Ms: overview.p95Ms,
      trafficAvailable: overview.trafficAvailable,
    },
    errors: errors.slice(0, 100),
    webhookFailures: webhookFailures.slice(0, 50),
    failedOperations: failedOperations.slice(0, 100),
    incidents: incidents.slice(0, 200),
    resolvedIncidents: resolvedIncidents.slice(0, 50),
    incidentCounts,
    jobs,
    totals: {
      openErrors: errors.filter((e) => e.status !== "resolved").length,
      webhookFailures: webhookFailures.filter((e) => e.status !== "resolved").length,
      failedOperations: failedOperations.filter((o) => o.status !== "resolved").length,
      openIncidents: incidents.filter((i) => i.status !== "resolved").length,
    },
  };
}
