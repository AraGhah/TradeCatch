import type { ReliabilityStore } from "./store";
import type { MonitorThresholds } from "./thresholds";
import { assertAlertSafe, sanitizeAlertText, UnsafeAlertPayloadError } from "./sanitize";
import {
  incidentState,
  priorityToSeverity,
  severityToPriority,
  type AlertDelivery,
  type AlertKind,
  type Incident,
  type Priority,
  type Severity,
} from "./types";

/**
 * Administrator alert emails (KAN-28): what they say, and how they are
 * delivered with bounded retries.
 *
 * Content rule: only identifiers, enums, counts and timestamps. No error
 * message, request body, credential, payment detail, call transcript or
 * customer contact detail ever goes in, and the finished payload is checked
 * once more before it is handed to the email provider.
 */

export type AlertPayload = {
  kind: AlertKind;
  priority: Priority;
  severity: Severity;
  title: string;
  subject: string;
  lines: { label: string; value: string }[];
  ctaUrl?: string;
  incidentId: string | null;
  simulated: boolean;
  /** Stable per delivery attempt; the email provider de-duplicates on it. */
  idempotencyKey: string;
};

export type AlertNotifier = (payload: AlertPayload) => Promise<void>;

/** Thrown by a notifier that has nowhere to send (no recipient configured). */
export class AlertNotConfiguredError extends Error {
  constructor() {
    super("Administrator alert destination is not configured");
    this.name = "AlertNotConfiguredError";
  }
}

class AlertTimeoutError extends Error {}

const SERVICE_LABELS: Record<string, string> = {
  website: "Website",
  api: "API",
  database: "Database",
  ai_receptionist: "AI receptionist",
  twilio_voice: "Twilio voice",
  twilio_sms: "SMS (Twilio)",
  google_calendar: "Google Calendar",
  calcom: "Cal.com calendar",
  stripe: "Stripe payments",
  jobs: "Scheduled jobs and automations",
  notifications: "Notifications",
  scheduling: "Appointment scheduling",
  cloudflare: "Cloudflare Workers",
  monitoring: "Monitoring",
};

export function serviceLabel(service: string): string {
  if (SERVICE_LABELS[service]) return SERVICE_LABELS[service];
  if (service.startsWith("health:"))
    return SERVICE_LABELS[service.slice(7)] ?? sanitizeAlertText(service.slice(7), 40);
  return sanitizeAlertText(service, 40);
}

const KIND_PREFIX: Record<AlertKind, string> = {
  opened: "",
  escalated: "Escalated: ",
  reminder: "Still active: ",
  recovered: "Resolved: ",
  digest: "",
};

export function composeAlert(
  kind: AlertKind,
  incident: Incident,
  ctx: { now: Date; siteUrl?: string },
): AlertPayload {
  const priority = incident.priority ?? severityToPriority(incident.severity);
  const label = kind === "recovered" ? "RESOLVED" : priority.toUpperCase();
  const title = sanitizeAlertText(incident.title, 140);
  const business = incident.organizationId
    ? sanitizeAlertText(incident.organizationId, 80)
    : incident.affectedBusinesses && incident.affectedBusinesses > 1
      ? `${incident.affectedBusinesses} businesses`
      : "Platform-wide";
  const lines: { label: string; value: string }[] = [
    { label: "Service", value: serviceLabel(incident.service) },
    { label: "Severity", value: priority.toUpperCase() },
    { label: "Category", value: sanitizeAlertText(incident.category ?? "health_check", 60) },
    { label: "Status", value: incidentState(incident.status) },
    { label: "Business", value: business },
    { label: "First seen", value: incident.firstSeenAt ?? incident.createdAt },
    { label: "Last seen", value: incident.lastSeenAt ?? incident.createdAt },
    { label: "Occurrences", value: String(incident.occurrenceCount ?? 1) },
    { label: "Alert sent", value: ctx.now.toISOString() },
  ];
  if (incident.summary)
    lines.splice(4, 0, { label: "What happened", value: sanitizeAlertText(incident.summary, 280) });
  if (incident.resolvedAt && kind === "recovered")
    lines.push({ label: "Resolved", value: incident.resolvedAt });
  if ((incident.reopenCount ?? 0) > 0)
    lines.push({ label: "Reopened", value: `${incident.reopenCount} time(s)` });
  lines.push({ label: "Diagnostic reference", value: incident.id });
  if (incident.correlationId && incident.correlationId !== incident.id)
    lines.push({ label: "Request reference", value: sanitizeAlertText(incident.correlationId, 80) });
  const base = ctx.siteUrl?.replace(/\/+$/, "");
  return {
    kind,
    priority,
    severity: priorityToSeverity(priority),
    title: `${KIND_PREFIX[kind]}${title}`,
    subject: `[TradeCatch ${label}] ${KIND_PREFIX[kind]}${title}`,
    lines,
    ctaUrl: base ? `${base}/admin/system-health?incident=${encodeURIComponent(incident.id)}` : undefined,
    incidentId: incident.id,
    simulated: Boolean(incident.simulated),
    idempotencyKey: "",
  };
}

export function composeDigest(
  count: number,
  ctx: { now: Date; siteUrl?: string },
): AlertPayload {
  const base = ctx.siteUrl?.replace(/\/+$/, "");
  return {
    kind: "digest",
    priority: "high",
    severity: "high",
    title: "Many incidents opened; individual alerts are paused",
    subject: "[TradeCatch HIGH] Many incidents opened; individual alerts are paused",
    lines: [
      { label: "What happened", value: "The alert limit was reached during a widespread problem. Further incidents are recorded but not emailed one by one." },
      { label: "Active incidents without their own alert", value: String(count) },
      { label: "Alert sent", value: ctx.now.toISOString() },
    ],
    ctaUrl: base ? `${base}/admin/system-health` : undefined,
    incidentId: null,
    simulated: false,
    idempotencyKey: "",
  };
}

/**
 * What a database failure code means, for the administrator reading the
 * alert. The 2026-11-24 outage emails said only "did not answer", so the cause
 * could not be told from them: an authentication refusal, a timeout and a
 * missing setting need different fixes.
 */
export function describeDatabaseFailure(code: string | undefined): string {
  const c = code ?? "UNKNOWN";
  if (c === "28P01" || c === "28000")
    return "The database refused the login (wrong password or user). Check the Worker's DATABASE_URL secret against the database's current password.";
  if (c === "NOT_CONFIGURED")
    return "DATABASE_URL is not set on this Worker. Add it as an encrypted Worker secret.";
  if (c === "3D000") return "The database named in DATABASE_URL does not exist.";
  if (c === "53300" || c === "53400")
    return "The database or its connection pooler has no free connections.";
  if (c === "53100" || c === "25006")
    return "The database is not accepting writes (often a full disk or read-only mode).";
  if (c.startsWith("57P"))
    return "The database is shutting down, restarting or paused.";
  if (c.startsWith("08"))
    return "The database reported a connection failure.";
  if (c === "XX000")
    return "The database or its connection pooler returned an internal error (with Supabase, often an unknown project or user in DATABASE_URL).";
  if (c === "CONNECT_TIMEOUT" || c === "QUERY_TIMEOUT" || c === "ETIMEDOUT")
    return "The database did not answer in time (unreachable, paused or overloaded).";
  if (c === "ECONNREFUSED") return "The database host refused the connection.";
  if (c === "ENOTFOUND") return "The database host name could not be found.";
  if (c === "EHOSTUNREACH") return "The database host could not be reached.";
  if (c === "ECONNRESET" || c === "EPIPE" || c === "CONNECTION_CLOSED")
    return "The connection to the database was dropped.";
  return "No error code was available. Check the Worker logs for tradecatch.monitoring.stage_failed.";
}

/**
 * The alert for a database that cannot store anything, so there is no incident
 * row and no outbox to carry it. It is sent straight away, once per window (the
 * window number is in the idempotency key, so the email provider drops repeats),
 * and says what is known: which code the database failed with and what that
 * usually means. The incident itself is recorded when the database returns.
 */
export function composeDatabaseOutageNotice(ctx: {
  now: Date;
  siteUrl?: string;
  windowMs: number;
  /** See databaseFailureCode: a SQLSTATE, a network code or a fixed name. */
  failureCode?: string;
  /** The monitor's own database check, when it ran. */
  check?: { readOk: boolean; writeOk: boolean };
}): AlertPayload {
  const window = Math.floor(ctx.now.getTime() / ctx.windowMs);
  const base = ctx.siteUrl?.replace(/\/+$/, "");
  const code = /^[0-9A-Z_]{2,32}$/.test(ctx.failureCode ?? "") ? ctx.failureCode! : "UNKNOWN";
  const lines: { label: string; value: string }[] = [
    { label: "Service", value: serviceLabel("database") },
    { label: "Severity", value: "CRITICAL" },
    { label: "Category", value: "unavailable" },
    { label: "Status", value: "active" },
    {
      label: "What happened",
      value:
        "The monitor could not use the database, so this alert could not be stored as an incident. The incident is recorded automatically, with its start time, once the database is back, and a resolution email follows.",
    },
    { label: "Failure code", value: code },
    { label: "Likely cause", value: describeDatabaseFailure(code) },
  ];
  if (ctx.check)
    lines.push({
      label: "Database check",
      value: `read ${ctx.check.readOk ? "ok" : "failed"}, write ${ctx.check.writeOk ? "ok" : "failed"}`,
    });
  lines.push(
    { label: "Business", value: "Platform-wide" },
    { label: "Alert sent", value: ctx.now.toISOString() },
    { label: "Diagnostic reference", value: `dbdown-${window}` },
  );
  return {
    kind: "opened",
    priority: "critical",
    severity: "critical",
    title: "Database is unavailable",
    subject: "[TradeCatch CRITICAL] Database is unavailable",
    lines,
    ctaUrl: base ? `${base}/admin/system-health` : undefined,
    incidentId: null,
    simulated: false,
    idempotencyKey: `tc-emergency-db-${window}`,
  };
}

/** A payload that is only safe fields, used when a composed one fails the final check. */
function minimalPayload(payload: AlertPayload): AlertPayload {
  const keep = new Set(["Service", "Severity", "Category", "Status", "Failure code", "Diagnostic reference"]);
  return {
    ...payload,
    title: "Incident requires attention",
    subject: `[TradeCatch ${payload.priority.toUpperCase()}] Incident requires attention`,
    lines: payload.lines.filter((line) => keep.has(line.label) && !hasUnsafe(line.value)),
  };
}

function hasUnsafe(value: string): boolean {
  try {
    assertAlertSafe(value);
    return false;
  } catch {
    return true;
  }
}

/** The final gate: the payload is sent as composed, or as the minimal safe version. Never both. */
export function safePayload(payload: AlertPayload): AlertPayload {
  try {
    assertAlertSafe({
      title: payload.title,
      subject: payload.subject,
      lines: payload.lines,
      ctaUrl: payload.ctaUrl,
    });
    return payload;
  } catch (error) {
    if (!(error instanceof UnsafeAlertPayloadError)) throw error;
    return minimalPayload(payload);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AlertTimeoutError()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function failureCode(error: unknown): string {
  if (error instanceof AlertTimeoutError) return "timeout";
  if (error instanceof AlertNotConfiguredError) return "not_configured";
  return "send_failed";
}

export type DeliveryRun = { attempted: number; sent: number; failed: number; exhausted: number };

/**
 * Sends the alerts that are due. Bounded on every axis: a few per run, a
 * timeout per send, a maximum number of attempts per alert with growing
 * pauses between them. A failure is recorded with a short code (never the
 * provider's message) so the dashboard can show it; the run itself never
 * throws, so monitoring cannot interrupt the work that called it.
 */
export async function deliverDueAlerts(deps: {
  store: ReliabilityStore;
  notify: AlertNotifier;
  now: () => Date;
  thresholds: MonitorThresholds;
  siteUrl?: string;
}): Promise<DeliveryRun> {
  const retry = deps.thresholds.alerts.retry;
  const run: DeliveryRun = { attempted: 0, sent: 0, failed: 0, exhausted: 0 };
  let claimed: AlertDelivery[] = [];
  try {
    claimed = await deps.store.claimDueAlerts(
      deps.now().toISOString(),
      retry.perRun,
      retry.sendTimeoutMs * 2 + 30_000,
    );
  } catch {
    return run;
  }
  for (const row of claimed) {
    run.attempted += 1;
    const attempt = row.attempts + 1;
    const now = deps.now();
    try {
      let payload: AlertPayload;
      if (row.kind === "digest") {
        const waiting = (await deps.store.listIncidents()).filter(
          (i) => i.status !== "resolved" && !i.lastAlertedAt && !i.simulated,
        ).length;
        payload = composeDigest(waiting, { now, siteUrl: deps.siteUrl });
      } else {
        const incident = row.incidentId ? await deps.store.getIncident(row.incidentId) : null;
        if (!incident) {
          await deps.store.finishAlert(row.id, {
            status: "exhausted",
            attempts: attempt,
            nextAttemptAt: now.toISOString(),
            lastError: "incident_missing",
          });
          run.exhausted += 1;
          continue;
        }
        payload = composeAlert(row.kind, incident, { now, siteUrl: deps.siteUrl });
      }
      payload = safePayload({ ...payload, idempotencyKey: `tc-alert-${row.id}-${attempt}` });
      await withTimeout(deps.notify(payload), retry.sendTimeoutMs);
      await deps.store.finishAlert(row.id, {
        status: "sent",
        attempts: attempt,
        nextAttemptAt: now.toISOString(),
        sentAt: now.toISOString(),
      });
      if (row.incidentId)
        await deps.store.addIncidentEvent({
          incidentId: row.incidentId,
          kind: "admin_notified",
          detail: row.kind,
          at: now.toISOString(),
        });
      run.sent += 1;
    } catch (error) {
      const code = failureCode(error);
      const giveUp = attempt >= retry.maxAttempts;
      const pause = retry.backoffMs[Math.min(attempt - 1, retry.backoffMs.length - 1)];
      console.warn(
        JSON.stringify({
          event: "tradecatch.monitoring.alert_failed",
          alertId: row.id,
          incidentId: row.incidentId,
          kind: row.kind,
          attempt,
          code,
          giveUp,
        }),
      );
      try {
        await deps.store.finishAlert(row.id, {
          status: giveUp ? "exhausted" : "pending",
          attempts: attempt,
          nextAttemptAt: new Date(now.getTime() + pause).toISOString(),
          lastError: code,
        });
        if (row.incidentId)
          await deps.store.addIncidentEvent({
            incidentId: row.incidentId,
            kind: giveUp ? "admin_notification_exhausted" : "admin_notification_failed",
            detail: code,
            at: now.toISOString(),
          });
      } catch {
        // The failure record itself failed (database down): the lease expires and the row is retried.
      }
      run.failed += 1;
      if (giveUp) run.exhausted += 1;
    }
  }
  return run;
}
