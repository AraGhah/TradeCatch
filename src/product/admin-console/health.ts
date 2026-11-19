import type { ReliabilityService } from "@/product/reliability/service";
import type {
  FailedOperation,
  Incident,
  ServiceHealth,
  SystemError,
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

export type HealthFilter = {
  organizationId?: string;
  /** Applies to errors, incidents and failed operations. */
  status?: "open" | "investigating" | "resolved";
  /** Inclusive YYYY-MM-DD. */
  from?: string;
  to?: string;
  service?: string;
};

export type SystemHealth = {
  generatedAt: string;
  overall: "healthy" | "degraded" | "unavailable";
  database: { state: string; status: string; detail: string | null };
  services: ServiceHealth[];
  integrations: IntegrationConfig[];
  api: {
    requests: number;
    serverErrors: number;
    clientErrors: number;
    errorRate: number;
    averageMs: number;
    p95Ms: number;
  };
  errors: SystemError[];
  /** Errors whose operation is a webhook delivery. */
  webhookFailures: SystemError[];
  failedOperations: FailedOperation[];
  incidents: Incident[];
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

  const errors = allErrors
    .filter((e) => (!filter.status || e.status === filter.status))
    .filter((e) => (!filter.service || e.service === filter.service))
    .filter((e) => inRange(e.createdAt, filter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const incidents = allIncidents
    .filter((i) => (!filter.status || i.status === filter.status))
    .filter((i) => (!filter.service || i.service === filter.service))
    .filter((i) => inRange(i.createdAt, filter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
    api: {
      requests: overview.requests,
      serverErrors: overview.serverErrors,
      clientErrors: overview.clientErrors,
      errorRate: overview.errorRate,
      averageMs: overview.averageMs,
      p95Ms: overview.p95Ms,
    },
    errors: errors.slice(0, 100),
    webhookFailures: webhookFailures.slice(0, 50),
    failedOperations: failedOperations.slice(0, 100),
    incidents: incidents.slice(0, 50),
    jobs,
    totals: {
      openErrors: errors.filter((e) => e.status !== "resolved").length,
      webhookFailures: webhookFailures.filter((e) => e.status !== "resolved").length,
      failedOperations: failedOperations.filter((o) => o.status !== "resolved").length,
      openIncidents: incidents.filter((i) => i.status !== "resolved").length,
    },
  };
}
