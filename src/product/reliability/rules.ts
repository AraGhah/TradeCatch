import { incidentFingerprint } from "./fingerprint";
import { LATENCY_EDGES_MS } from "./observations";
import type { MonitorThresholds } from "./thresholds";
import type { BucketDelta, Priority } from "./types";

/**
 * Pure alert rules (KAN-28). Each takes real measurements (probe samples,
 * request buckets, database counts) and returns the findings that cross a
 * threshold. No I/O, no clock reads: everything is passed in, so every rule is
 * unit-tested with plain data, and "not enough data" always means "no finding".
 */

export type { Priority };

export type Finding = {
  fingerprint: string;
  service: string;
  category: string;
  priority: Priority;
  title: string;
  /** Counts and thresholds only. Never an error message, a name or a number. */
  summary: string;
  organizationId?: string;
  affectedBusinesses?: number;
  /** How long the condition must stay clear before the incident resolves itself. */
  quietMs: number;
};

export type ProbeSample = {
  at: string;
  target: string;
  ok: boolean;
  statusCode?: number;
  durationMs: number;
};

// Defined beside the recorder (which the Worker entry imports and must stay
// tiny); re-exported so the rules and their tests keep one place to ask.
export { LATENCY_EDGES_MS };
const OPEN_BIN_REPORT_MS = 10_000;

/** One (minute, scope) of request counts; `lat` has one counter per latency bin. */
export type TrafficBucket = BucketDelta;

function within(at: string, now: Date, windowMs: number): boolean {
  const time = Date.parse(at);
  return Number.isFinite(time) && time > now.getTime() - windowMs && time <= now.getTime() + 60_000;
}

/**
 * A percentile read off the latency histogram. The histogram only knows which
 * bin a request fell in, so the answer is that bin's upper edge ("finished
 * within N ms"), never a made-up exact value.
 */
export function percentileFromBuckets(
  buckets: TrafficBucket[],
  ratio: number,
): { upperMs: number; samples: number } {
  const lat = [0, 0, 0, 0, 0, 0, 0];
  for (const bucket of buckets)
    bucket.lat.forEach((count, index) => {
      if (index < lat.length) lat[index] += count;
    });
  const samples = lat.reduce((sum, count) => sum + count, 0);
  if (samples === 0) return { upperMs: 0, samples: 0 };
  const target = samples * ratio;
  let running = 0;
  for (let index = 0; index < lat.length; index += 1) {
    running += lat[index];
    if (running >= target)
      return { upperMs: index < LATENCY_EDGES_MS.length ? LATENCY_EDGES_MS[index] : OPEN_BIN_REPORT_MS, samples };
  }
  return { upperMs: OPEN_BIN_REPORT_MS, samples };
}

export function p95FromBuckets(buckets: TrafficBucket[]): { upperMs: number; samples: number } {
  return percentileFromBuckets(buckets, 0.95);
}

export type TrafficSummary = {
  requests: number;
  success: number;
  clientErrors: number;
  serverErrors: number;
  authErrors: number;
  rateLimited: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
};

/** Totals over the buckets of one scope inside the window ending at `now`. */
export function summarizeTraffic(
  buckets: TrafficBucket[],
  now: Date,
  windowMs: number,
  scope: TrafficBucket["scope"] = "api",
): TrafficSummary {
  const rows = buckets.filter((b) => b.scope === scope && within(b.at, now, windowMs));
  const requests = rows.reduce((total, b) => total + b.total, 0);
  const serverErrors = rows.reduce((total, b) => total + b.s5xx, 0);
  return {
    requests,
    success: rows.reduce((total, b) => total + b.s2xx + b.s3xx, 0),
    clientErrors: rows.reduce((total, b) => total + b.s401 + b.s403 + b.s429 + b.s4xxOther, 0),
    serverErrors,
    authErrors: rows.reduce((total, b) => total + b.s401 + b.s403, 0),
    rateLimited: rows.reduce((total, b) => total + b.s429, 0),
    errorRate: requests === 0 ? 0 : serverErrors / requests,
    p50Ms: percentileFromBuckets(rows, 0.5).upperMs,
    p95Ms: percentileFromBuckets(rows, 0.95).upperMs,
  };
}

/**
 * The one incident for "the database is unavailable". The 15-minute provider
 * health check (service `health:database`) and the once-a-minute monitor both
 * report it, so they must share a fingerprint or one outage would open two
 * incidents and send two emails.
 */
export const DATABASE_SERVICE = "health:database";
export const DATABASE_UNAVAILABLE_FINGERPRINT = incidentFingerprint({ service: DATABASE_SERVICE });

/**
 * The one incident for "the site is not answering". The page and the API are
 * served by the same Worker, so they fail together: until 2026-11-25 each had
 * its own incident, and every outage sent two "unreachable" and two "resolved"
 * emails. Both addresses now report into this fingerprint, and the summary says
 * which of them failed. `website:unavailable:<target>` is the older per-address
 * form, still recognised so incidents opened before this change resolve.
 */
export const WEBSITE_FINGERPRINT = "website:unavailable";

export function isWebsiteFingerprint(fingerprint: string | undefined): boolean {
  return (
    fingerprint === WEBSITE_FINGERPRINT ||
    Boolean(fingerprint?.startsWith(`${WEBSITE_FINGERPRINT}:`))
  );
}

const TARGET_LABELS: Record<string, string> = { page: "website (/)", api: "API (/api/health)" };

/** What a probe's failure code means, in a few words. */
export function describeProbeFailure(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "cf_1102") return "Cloudflare error 1102: the Worker exceeded its CPU or memory limit";
  if (code.startsWith("cf_")) return `Cloudflare error ${code.slice(3)}`;
  if (code === "timeout") return "no answer before the check timed out";
  if (code === "network") return "the connection failed";
  return undefined;
}

function timeOfDay(at: string): string {
  return `${new Date(at).toISOString().slice(11, 19)} UTC`;
}

/**
 * Website / endpoint availability: N failed probes in a row on an address
 * raises one shared incident. `current` is this run's probes, which carry the
 * diagnostics that are not stored (Cloudflare error code, request ID).
 */
export function evaluateWebsite(
  samples: ProbeSample[],
  t: MonitorThresholds,
  current: { target: string; errorCode?: string; requestId?: string }[] = [],
): Finding[] {
  const need = t.website.consecutiveFailures;
  const byTarget = new Map<string, ProbeSample[]>();
  for (const sample of samples) {
    const list = byTarget.get(sample.target) ?? [];
    list.push(sample);
    byTarget.set(sample.target, list);
  }
  const failing: { target: string; streak: ProbeSample[] }[] = [];
  for (const [target, list] of [...byTarget].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const firstOk = ordered.findIndex((sample) => sample.ok);
    const streak = firstOk === -1 ? ordered : ordered.slice(0, firstOk);
    if (streak.length >= need) failing.push({ target, streak });
  }
  if (failing.length === 0) return [];

  const label = (target: string) => TARGET_LABELS[target] ?? target;
  const parts = failing.map(
    ({ target, streak }) =>
      `${label(target)} since ${timeOfDay(streak[streak.length - 1].at)} (${streak.length} in a row)`,
  );
  const codes = [...new Set(failing.map(({ streak }) => streak[0].statusCode ?? 0))];
  const now = current.filter((probe) => failing.some((f) => f.target === probe.target));
  const causes = [...new Set(now.map((probe) => describeProbeFailure(probe.errorCode)).filter(Boolean))];
  const requests = now.map((probe) => probe.requestId).filter(Boolean);
  const targets = failing.map((f) => f.target);
  const title =
    targets.includes("page") && targets.includes("api")
      ? "Website and API are unreachable"
      : targets.includes("api")
        ? "Public API is unreachable"
        : "Website is unreachable";
  return [
    {
      fingerprint: WEBSITE_FINGERPRINT,
      service: "website",
      category: "unavailable",
      priority: "critical",
      title,
      summary:
        `Availability checks failing: ${parts.join("; ")}. ` +
        `Last status ${codes.map((code) => code || "none").join("/")}` +
        (causes.length ? ` (${causes.join("; ")})` : "") +
        "." +
        (requests.length ? ` Request ID ${requests.join(", ")}.` : ""),
      quietMs: t.website.quietMs,
    },
  ];
}

/**
 * Whether the website has proven it recovered: the last `recoverySuccesses`
 * checks of every address checked recently all succeeded. Fewer checks than
 * that (the monitor itself stopped running) is not proof, so the answer is no.
 * `targets` limits the question to the addresses an older per-address incident
 * was about.
 */
export function websiteRecovered(
  samples: ProbeSample[],
  t: MonitorThresholds,
  targets?: string[],
): boolean {
  const need = Math.max(t.website.recoverySuccesses, 1);
  const byTarget = new Map<string, ProbeSample[]>();
  for (const sample of samples) {
    if (sample.target === "database") continue;
    if (targets && !targets.includes(sample.target)) continue;
    const list = byTarget.get(sample.target) ?? [];
    list.push(sample);
    byTarget.set(sample.target, list);
  }
  if (byTarget.size === 0) return false;
  for (const list of byTarget.values()) {
    const latest = [...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, need);
    if (latest.length < need || latest.some((sample) => !sample.ok)) return false;
  }
  return true;
}

/**
 * A database that answers, but slowly, several checks in a row. Unavailability
 * is not decided here: a database that is down cannot store the history this
 * reads, so the monitor judges availability from the current check instead.
 */
export function evaluateDatabaseSlow(samples: ProbeSample[], t: MonitorThresholds): Finding[] {
  const need = t.database.slowConsecutive;
  const latest = samples
    .filter((sample) => sample.target === "database")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, need);
  if (latest.length < need) return [];
  if (!latest.every((sample) => sample.ok && sample.durationMs >= t.database.slowMs)) return [];
  const slowest = Math.max(...latest.map((sample) => sample.durationMs));
  return [
    {
      fingerprint: "database:slow",
      service: "database",
      category: "slow",
      priority: "warning",
      title: "Database responses are slow",
      summary: `The last ${need} database checks each took at least ${t.database.slowMs} ms (slowest ${slowest} ms).`,
      quietMs: t.database.quietMs,
    },
  ];
}

function sum(buckets: TrafficBucket[], pick: (b: TrafficBucket) => number): number {
  return buckets.reduce((total, bucket) => total + pick(bucket), 0);
}

/** Request-level rules over the per-minute buckets the Worker records. */
export function evaluateApiTraffic(
  buckets: TrafficBucket[],
  now: Date,
  t: MonitorThresholds,
): Finding[] {
  const findings: Finding[] = [];
  const pct = (n: number, d: number) => `${Math.round((n / Math.max(1, d)) * 100)}%`;

  const critical = buckets.filter((b) => within(b.at, now, t.api.critical.windowMs));
  const criticalTotal = sum(critical, (b) => b.total);
  const criticalErrors = sum(critical, (b) => b.s5xx);
  const isCritical =
    criticalTotal >= t.api.critical.minRequests &&
    criticalErrors / criticalTotal >= t.api.critical.errorRate;
  if (isCritical) {
    findings.push({
      fingerprint: "api:error_rate:critical",
      service: "api",
      category: "error_rate",
      priority: "critical",
      title: "Widespread server errors",
      summary: `${criticalErrors} of ${criticalTotal} requests (${pct(criticalErrors, criticalTotal)}) failed with a server error in the last ${Math.round(t.api.critical.windowMs / 60_000)} minutes.`,
      quietMs: t.api.critical.quietMs,
    });
  }

  const elevated = buckets.filter((b) => within(b.at, now, t.api.elevated.windowMs));
  const elevatedTotal = sum(elevated, (b) => b.total);
  const elevatedErrors = sum(elevated, (b) => b.s5xx);
  if (
    !isCritical &&
    elevatedTotal >= t.api.elevated.minRequests &&
    elevatedErrors / elevatedTotal >= t.api.elevated.errorRate
  ) {
    findings.push({
      fingerprint: "api:error_rate:elevated",
      service: "api",
      category: "error_rate",
      priority: "warning",
      title: "Elevated server error rate",
      summary: `${elevatedErrors} of ${elevatedTotal} requests (${pct(elevatedErrors, elevatedTotal)}) failed with a server error in the last ${Math.round(t.api.elevated.windowMs / 60_000)} minutes.`,
      quietMs: t.api.elevated.quietMs,
    });
  }

  const apiOnly = (window: number) =>
    buckets.filter((b) => b.scope === "api" && within(b.at, now, window));
  const authWindow = apiOnly(t.api.auth.windowMs);
  const authTotal = sum(authWindow, (b) => b.total);
  const authFailures = sum(authWindow, (b) => b.s401 + b.s403);
  if (
    authFailures >= t.api.auth.minCount &&
    authFailures / Math.max(1, authTotal) >= t.api.auth.minShare
  ) {
    findings.push({
      fingerprint: "api:auth_failures",
      service: "api",
      category: "auth_failures",
      priority: "warning",
      title: "Unusual spike in authentication failures",
      summary: `${authFailures} of ${authTotal} API requests (${pct(authFailures, authTotal)}) were refused with 401/403 in the last ${Math.round(t.api.auth.windowMs / 60_000)} minutes.`,
      quietMs: t.api.auth.quietMs,
    });
  }

  const limitWindow = apiOnly(t.api.rateLimited.windowMs);
  const limitTotal = sum(limitWindow, (b) => b.total);
  const limited = sum(limitWindow, (b) => b.s429);
  if (
    limited >= t.api.rateLimited.minCount &&
    limited / Math.max(1, limitTotal) >= t.api.rateLimited.minShare
  ) {
    findings.push({
      fingerprint: "api:rate_limited",
      service: "api",
      category: "rate_limited",
      priority: "warning",
      title: "Unusual spike in rate-limited requests",
      summary: `${limited} of ${limitTotal} API requests (${pct(limited, limitTotal)}) were answered 429 in the last ${Math.round(t.api.rateLimited.windowMs / 60_000)} minutes.`,
      quietMs: t.api.rateLimited.quietMs,
    });
  }

  const latencyWindow = buckets.filter((b) => within(b.at, now, t.api.latency.windowMs));
  const latencyTotal = sum(latencyWindow, (b) => b.total);
  const p95 = p95FromBuckets(latencyWindow);
  if (latencyTotal >= t.api.latency.minRequests && p95.upperMs >= t.api.latency.p95Ms) {
    findings.push({
      fingerprint: "api:latency",
      service: "api",
      category: "latency",
      priority: "warning",
      title: "Abnormal response latency",
      summary: `95th percentile response time is at least ${p95.upperMs} ms over ${latencyTotal} requests (threshold ${t.api.latency.p95Ms} ms).`,
      quietMs: t.api.latency.quietMs,
    });
  }
  return findings;
}

/** Counts gathered from the database by the collectors. */
export type Signals = {
  calls: {
    staleUnfinalized: number;
    failedSessions: number;
    totalSessions: number;
    /** Normal caller hang-ups: reported for context, never counted as failures. */
    hungUpSessions: number;
  };
  sms: { failed: number; total: number };
  calendar: { credentialProblemBusinesses: string[]; failedSyncs: number };
  automations: { stuckJobs: number; duplicateExecutions: number; retryExhausted: number };
  stripe: { webhookFailures: number; signatureFailures: number; inconsistentBilling: number };
};

export function emptySignals(): Signals {
  return {
    calls: { staleUnfinalized: 0, failedSessions: 0, totalSessions: 0, hungUpSessions: 0 },
    sms: { failed: 0, total: 0 },
    calendar: { credentialProblemBusinesses: [], failedSyncs: 0 },
    automations: { stuckJobs: 0, duplicateExecutions: 0, retryExhausted: 0 },
    stripe: { webhookFailures: 0, signatureFailures: 0, inconsistentBilling: 0 },
  };
}

export function evaluateSignals(signals: Signals, t: MonitorThresholds): Finding[] {
  const findings: Finding[] = [];
  const minutes = (ms: number) => Math.round(ms / 60_000);

  const { calls } = signals;
  if (
    calls.failedSessions >= t.calls.failedSessions &&
    calls.failedSessions / Math.max(1, calls.totalSessions) >= t.calls.failedShare
  ) {
    findings.push({
      fingerprint: "receptionist:calls_failed",
      service: "ai_receptionist",
      category: "routing_failure",
      priority: "high",
      title: "Calls are failing to reach the receptionist",
      summary: `${calls.failedSessions} of ${calls.totalSessions} calls failed in the last ${minutes(t.calls.windowMs)} minutes (caller hang-ups are not counted).`,
      quietMs: t.calls.quietMs,
    });
  }
  if (calls.staleUnfinalized >= t.calls.staleCount) {
    findings.push({
      fingerprint: "receptionist:calls_without_final_status",
      service: "ai_receptionist",
      category: "missing_final_status",
      priority: "high",
      title: "Calls are missing a final status",
      summary: `${calls.staleUnfinalized} calls have had no final status for over ${minutes(t.calls.staleAfterMs)} minutes.`,
      quietMs: t.calls.quietMs,
    });
  }

  const { sms } = signals;
  const smsShare = sms.failed / Math.max(1, sms.total);
  if (sms.failed >= t.sms.highFailures && smsShare >= t.sms.highShare) {
    findings.push({
      fingerprint: "sms:delivery_failures",
      service: "twilio_sms",
      category: "delivery_failures",
      priority: "high",
      title: "SMS delivery is failing",
      summary: `${sms.failed} of ${sms.total} text messages failed in the last ${minutes(t.sms.windowMs)} minutes.`,
      quietMs: t.sms.quietMs,
    });
  } else if (sms.failed >= t.sms.warningFailures && smsShare >= t.sms.warningShare) {
    findings.push({
      fingerprint: "sms:delivery_failures",
      service: "twilio_sms",
      category: "delivery_failures",
      priority: "warning",
      title: "Elevated SMS delivery failures",
      summary: `${sms.failed} of ${sms.total} text messages failed in the last ${minutes(t.sms.windowMs)} minutes.`,
      quietMs: t.sms.quietMs,
    });
  }

  const businesses = signals.calendar.credentialProblemBusinesses;
  if (businesses.length > 0) {
    findings.push({
      fingerprint: "google_calendar:credentials_invalid",
      service: "google_calendar",
      category: "credentials_invalid",
      priority: "warning",
      title: "Calendar credentials expired or revoked",
      summary: `${businesses.length} business${businesses.length === 1 ? "" : "es"} can no longer sync their calendar until it is reconnected.`,
      organizationId: businesses.length === 1 ? businesses[0] : undefined,
      affectedBusinesses: businesses.length,
      quietMs: t.calendar.quietMs,
    });
  }
  if (signals.calendar.failedSyncs >= t.calendar.failedSyncs) {
    findings.push({
      fingerprint: "google_calendar:sync_failures",
      service: "google_calendar",
      category: "sync_failures",
      priority: "warning",
      title: "Calendar synchronization is failing",
      summary: `${signals.calendar.failedSyncs} calendar sync or booking attempts failed in the last ${minutes(t.calendar.windowMs)} minutes.`,
      quietMs: t.calendar.quietMs,
    });
  }

  const automation = signals.automations;
  if (automation.stuckJobs >= t.automations.stuckCount) {
    findings.push({
      fingerprint: "automations:stuck_jobs",
      service: "jobs",
      category: "stuck_jobs",
      priority: "warning",
      title: "Scheduled follow-ups are stuck",
      summary: `${automation.stuckJobs} scheduled jobs are more than ${minutes(t.automations.stuckAfterMs)} minutes overdue.`,
      quietMs: t.automations.quietMs,
    });
  }
  if (automation.duplicateExecutions >= 1) {
    findings.push({
      fingerprint: "automations:duplicate_execution",
      service: "jobs",
      category: "duplicate_execution",
      priority: "high",
      title: "A scheduled job ran more than once",
      summary: `${automation.duplicateExecutions} jobs were sent more than once in the last ${minutes(t.automations.windowMs)} minutes.`,
      quietMs: t.automations.quietMs,
    });
  }
  if (automation.retryExhausted >= t.automations.retryExhaustedCount) {
    findings.push({
      fingerprint: "automations:retry_exhausted",
      service: "jobs",
      category: "retry_exhausted",
      priority: "warning",
      title: "Scheduled jobs ran out of retries",
      summary: `${automation.retryExhausted} jobs gave up after their last retry in the last ${minutes(t.automations.windowMs)} minutes.`,
      quietMs: t.automations.quietMs,
    });
  }

  const { stripe } = signals;
  if (stripe.webhookFailures >= t.stripe.webhookFailures) {
    findings.push({
      fingerprint: "stripe:webhook_failures",
      service: "stripe",
      category: "webhook_failures",
      priority: "high",
      title: "Stripe webhooks are failing",
      summary: `${stripe.webhookFailures} Stripe webhook deliveries could not be processed in the last ${minutes(t.stripe.windowMs)} minutes.`,
      quietMs: t.stripe.quietMs,
    });
  }
  if (stripe.signatureFailures >= t.stripe.signatureFailures) {
    findings.push({
      fingerprint: "stripe:signature_failures",
      service: "stripe",
      category: "signature_failures",
      priority: "warning",
      title: "Many Stripe webhooks failed signature checks",
      summary: `${stripe.signatureFailures} webhook deliveries failed signature verification in the last ${minutes(t.stripe.windowMs)} minutes.`,
      quietMs: t.stripe.quietMs,
    });
  }
  if (stripe.inconsistentBilling >= 1) {
    findings.push({
      fingerprint: "stripe:billing_inconsistent",
      service: "stripe",
      category: "billing_inconsistent",
      priority: "high",
      title: "Billing state is inconsistent",
      summary: `${stripe.inconsistentBilling} businesses have a subscription state that disagrees with their account state.`,
      quietMs: t.stripe.quietMs,
    });
  }
  return findings;
}
