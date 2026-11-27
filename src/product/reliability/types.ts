const SECRET =
  /(?:sk_(?:live|test)_[A-Za-z0-9]+|Bearer\s+\S+|ya29\.[A-Za-z0-9._-]+|AKIA[0-9A-Z]{16}|whsec_[A-Za-z0-9]+)/gi;

/**
 * Everything that must never be stored or sent from the monitoring system: a
 * credential, a payment card, a person's contact detail. Applied to the whole
 * string before it is shortened, so a long value cannot hide a secret past the
 * cut.
 */
export const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]*@[^\s]+/gi, "[redacted-url]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "[redacted-token]"],
  [/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_]+/g, "[redacted-key]"],
  [/\bBearer\s+\S+/gi, "[redacted]"],
  [/\b(?:AC|SK)[a-f0-9]{32}\b/gi, "[redacted-sid]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]"],
  [/(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w])/g, "[redacted-number]"],
  [/\b[a-f0-9]{32,}\b/gi, "[redacted-token]"],
];

/**
 * Identifiers the system generates itself: a UUID (bare or behind a short
 * prefix such as `inc_` or `mon_`) and a Cloudflare request ID (cf-ray, 16 hex
 * digits and a data-centre code). They carry no personal data, but a UUID whose
 * last group happens to be all decimal digits (`...-272773860567`) looks like a
 * phone number to the pattern below. On 2026-11-25 that turned both emails of
 * incident inc_9fc51ebf-83e6-4992-b530-272773860567 into the bare
 * "Incident requires attention" fallback. They are set aside while the
 * patterns run and put back afterwards, unchanged.
 */
const GENERATED_ID =
  /\b(?:[a-z]{2,12}_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{16}-[A-Z]{3}\b/gi;

export function redactDiagnostic(value: string): string {
  const kept: string[] = [];
  let out = value.replace(GENERATED_ID, (id) => {
    kept.push(id);
    return `\u0000${kept.length - 1}\u0000`;
  });
  out = out
    .replace(SECRET, "[redacted]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted]");
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) out = out.replace(pattern, replacement);
  out = out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)] ?? "");
  return out.slice(0, 300);
}

export type ServiceName =
  | "api"
  | "database"
  | "ai_receptionist"
  | "twilio_voice"
  | "twilio_sms"
  | "google_calendar"
  | "stripe"
  | "jobs"
  | "notifications";

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";
export type Severity = "low" | "medium" | "high" | "critical";

/** Alert priority (KAN-28). Warning is stored as severity "medium". */
export type Priority = "critical" | "high" | "warning";
export const PRIORITY_RANK: Record<Priority, number> = {
  warning: 0,
  high: 1,
  critical: 2,
};
export const priorityToSeverity = (priority: Priority): Severity =>
  priority === "warning" ? "medium" : priority;
export const severityToPriority = (severity: Severity): Priority =>
  severity === "critical" ? "critical" : severity === "high" ? "high" : "warning";

/**
 * What the System Health console sorts and counts by: the alert priority, plus
 * "low" for older incidents that were recorded with severity "low" and no
 * priority. No rule produces a Low priority today, so nothing is stored as one.
 */
export type DisplayPriority = Priority | "low";
export const DISPLAY_PRIORITIES: readonly DisplayPriority[] = ["critical", "high", "warning", "low"];
export const DISPLAY_PRIORITY_RANK: Record<DisplayPriority, number> = {
  low: 0,
  warning: 1,
  high: 2,
  critical: 3,
};
export function displayPriority(incident: {
  priority?: Priority;
  severity: Severity;
}): DisplayPriority {
  if (incident.priority) return incident.priority;
  return incident.severity === "low" ? "low" : severityToPriority(incident.severity);
}

/**
 * Incident lifecycle as administrators see it. The stored status keeps its
 * original values (open / investigating / resolved) so existing rows and
 * clients keep working; this is the one place that names them.
 */
export type IncidentState = "active" | "acknowledged" | "resolved";
export const incidentState = (status: Incident["status"]): IncidentState =>
  status === "open" ? "active" : status === "investigating" ? "acknowledged" : "resolved";

export type SystemError = {
  id: string;
  requestId: string;
  organizationId?: string;
  service: string;
  operation: string;
  errorCode: string;
  severity: Severity;
  retryable: boolean;
  attemptCount: number;
  status: "open" | "investigating" | "resolved";
  detail?: string;
  environment: string;
  simulated: boolean;
  createdAt: string;
  /** Groups identical failures; see fingerprint.ts. Absent on older rows. */
  fingerprint?: string;
};

export type Incident = {
  id: string;
  organizationId?: string;
  service: string;
  severity: Severity;
  title: string;
  status: "open" | "investigating" | "resolved";
  correlationId: string;
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  /* KAN-28. All optional: incidents created before it have none of these. */
  fingerprint?: string;
  category?: string;
  priority?: Priority;
  /** Counts and thresholds only; never an error message. */
  summary?: string;
  occurrenceCount?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  acknowledgedBy?: string;
  /** "auto" when the condition cleared on its own, otherwise the administrator. */
  resolvedBy?: string;
  affectedBusinesses?: number;
  /** Condition must stay clear this long before the incident resolves itself. */
  quietMs?: number;
  reopenCount?: number;
  lastAlertedAt?: string;
  /** Highest priority an alert has been sent (or queued) for. */
  alertedPriority?: Priority;
  simulated?: boolean;
};

export type AlertKind = "opened" | "escalated" | "reminder" | "recovered" | "digest";
export type AlertDeliveryStatus = "pending" | "sent" | "exhausted";

/** One administrator alert email and its bounded delivery attempts. */
export type AlertDelivery = {
  id: string;
  incidentId: string | null;
  kind: AlertKind;
  priority: Priority;
  status: AlertDeliveryStatus;
  attempts: number;
  nextAttemptAt: string;
  /** A short code (send_failed, timeout, not_configured...); never raw provider text. */
  lastError?: string;
  idempotencyKey: string;
  createdAt: string;
  sentAt?: string;
};

export type ProbeRecord = {
  at: string;
  target: string;
  ok: boolean;
  statusCode?: number;
  durationMs: number;
  /**
   * Why the check failed, when the answer says so: `cf_1102` style codes from a
   * Cloudflare error page (1102 = the Worker exceeded its CPU or memory limit),
   * or `timeout` / `network` when no answer came. Current run only: not stored.
   */
  errorCode?: string;
  /** Cloudflare's request ID (cf-ray) of the probed request. Current run only. */
  requestId?: string;
};

/** Counts to add to one (minute, scope) request bucket. */
export type BucketDelta = {
  at: string;
  scope: "api" | "page";
  total: number;
  s2xx: number;
  s3xx: number;
  s401: number;
  s403: number;
  s429: number;
  s4xxOther: number;
  s5xx: number;
  lat: number[];
};

export type FailedOperation = {
  id: string;
  organizationId?: string;
  service: string;
  operation: string;
  idempotencyKey: string;
  status: "failed" | "retrying" | "resolved" | "dead";
  retryable: boolean;
  attempts: number;
  lastError?: string;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FallbackSettings = {
  organizationId: string;
  aiUnavailable: "transfer" | "voicemail";
  calendarUnavailable: "collect_request";
  databaseUnavailable: "do_not_claim_saved";
  transferFailed: "voicemail" | "backup";
  updatedAt: string;
};

export type ServiceHealth = {
  service: ServiceName;
  status: HealthStatus;
  checkedAt: string;
  detail?: string;
  required: boolean;
  state?:
    | "unconfigured"
    | "configured"
    | "connected"
    | "operational"
    | "delivery_verified";
  evidenceAt?: string;
};
