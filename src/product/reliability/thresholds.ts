/**
 * Alert thresholds and monitoring windows (KAN-28).
 *
 * Every number that decides "is this worth waking an administrator?" lives in
 * this one table so it can be reviewed, documented (docs/KAN-28-MONITORING.md)
 * and tuned without touching code: set MONITOR_THRESHOLDS_JSON to a partial
 * object with the same shape. An unreadable or out-of-range override never
 * disables monitoring: bad keys are ignored and values are clamped.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type MonitorThresholds = {
  website: {
    /** Probes in a row that must fail before the site counts as down. */
    consecutiveFailures: number;
    probeTimeoutMs: number;
    /** Quiet time with no failing probe before the incident resolves itself. */
    quietMs: number;
  };
  api: {
    /** Widespread failure: most requests are server errors. Critical. */
    critical: { windowMs: number; minRequests: number; errorRate: number; quietMs: number };
    /** Elevated server-error rate. Warning. */
    elevated: { windowMs: number; minRequests: number; errorRate: number; quietMs: number };
    /** Spike of 401/403 answers. Warning. */
    auth: { windowMs: number; minCount: number; minShare: number; quietMs: number };
    /** Spike of 429 answers. Warning. */
    rateLimited: { windowMs: number; minCount: number; minShare: number; quietMs: number };
    latency: { windowMs: number; minRequests: number; p95Ms: number; quietMs: number };
  };
  database: {
    /** Attempts inside one check; all of them must fail to call it unavailable. */
    probeAttempts: number;
    probeTimeoutMs: number;
    slowMs: number;
    /** Slow checks in a row before a "persistent database issue" is raised. */
    slowConsecutive: number;
    quietMs: number;
  };
  /**
   * Provider and integration health checks, evaluated by /api/monitoring/tick
   * (every 15 minutes). The quiet period must outlast one missed tick.
   */
  healthChecks: { quietMs: number };
  /** Recorded errors (recordFailure) become an incident only past these counts. */
  errors: {
    high: { windowMs: number; count: number };
    medium: { windowMs: number; count: number };
    quietMs: Record<"critical" | "high" | "medium", number>;
  };
  calls: {
    windowMs: number;
    failedSessions: number;
    failedShare: number;
    /** A call with no final status after this long is a failure to finalize. */
    staleAfterMs: number;
    staleCount: number;
    quietMs: number;
  };
  sms: {
    windowMs: number;
    warningFailures: number;
    warningShare: number;
    highFailures: number;
    highShare: number;
    quietMs: number;
  };
  automations: {
    stuckAfterMs: number;
    stuckCount: number;
    retryExhaustedCount: number;
    windowMs: number;
    quietMs: number;
  };
  calendar: { windowMs: number; failedSyncs: number; quietMs: number };
  stripe: {
    windowMs: number;
    webhookFailures: number;
    signatureFailures: number;
    quietMs: number;
  };
  alerts: {
    /** Ignore a repeat of an incident resolved this recently: reopen it instead. */
    reopenWithinMs: number;
    /** Minimum gap between two "opened" style alerts for the same incident. */
    cooldownMs: Record<"critical" | "high" | "warning", number>;
    /** Still-unacknowledged critical incidents are mentioned again this often. 0 = never. */
    reminderMs: Record<"critical" | "high" | "warning", number>;
    /** At most this many alert emails per window; the rest collapse into one digest. */
    storm: { windowMs: number; maxAlerts: number };
    retry: { maxAttempts: number; backoffMs: number[]; perRun: number; sendTimeoutMs: number };
  };
  /** The once-a-minute monitor run itself. */
  monitor: {
    /**
     * No successful run for this long means monitoring (or the database it
     * stores into) was down. Recorded as an incident once it is back.
     */
    gapMs: number;
    /** How often old probes, buckets, errors and alerts are removed. */
    pruneEveryMs: number;
    /** One emergency (database-down) email per this window; the provider drops repeats. */
    emergencyWindowMs: number;
  };
  retention: {
    errorsDays: number;
    resolvedIncidentsDays: number;
    probeHours: number;
    bucketHours: number;
    alertDeliveryDays: number;
  };
};

export const DEFAULT_THRESHOLDS: MonitorThresholds = {
  website: { consecutiveFailures: 3, probeTimeoutMs: 8_000, quietMs: 3 * MINUTE },
  api: {
    critical: { windowMs: 5 * MINUTE, minRequests: 20, errorRate: 0.5, quietMs: 5 * MINUTE },
    elevated: { windowMs: 10 * MINUTE, minRequests: 20, errorRate: 0.1, quietMs: 10 * MINUTE },
    auth: { windowMs: 10 * MINUTE, minCount: 40, minShare: 0.4, quietMs: 10 * MINUTE },
    rateLimited: { windowMs: 10 * MINUTE, minCount: 100, minShare: 0.1, quietMs: 10 * MINUTE },
    latency: { windowMs: 10 * MINUTE, minRequests: 30, p95Ms: 4_000, quietMs: 10 * MINUTE },
  },
  database: {
    probeAttempts: 3,
    probeTimeoutMs: 2_500,
    slowMs: 1_500,
    slowConsecutive: 5,
    quietMs: 5 * MINUTE,
  },
  healthChecks: { quietMs: 35 * MINUTE },
  errors: {
    high: { windowMs: 10 * MINUTE, count: 3 },
    medium: { windowMs: 15 * MINUTE, count: 5 },
    quietMs: { critical: 15 * MINUTE, high: 15 * MINUTE, medium: 30 * MINUTE },
  },
  calls: {
    windowMs: 15 * MINUTE,
    failedSessions: 3,
    failedShare: 0.3,
    staleAfterMs: 20 * MINUTE,
    staleCount: 3,
    quietMs: 15 * MINUTE,
  },
  sms: {
    windowMs: 15 * MINUTE,
    warningFailures: 5,
    warningShare: 0.25,
    highFailures: 15,
    highShare: 0.5,
    quietMs: 15 * MINUTE,
  },
  automations: {
    stuckAfterMs: 20 * MINUTE,
    stuckCount: 5,
    retryExhaustedCount: 3,
    windowMs: 60 * MINUTE,
    quietMs: 30 * MINUTE,
  },
  calendar: { windowMs: 30 * MINUTE, failedSyncs: 5, quietMs: 30 * MINUTE },
  stripe: {
    windowMs: 30 * MINUTE,
    webhookFailures: 2,
    signatureFailures: 20,
    quietMs: 30 * MINUTE,
  },
  alerts: {
    reopenWithinMs: 15 * MINUTE,
    cooldownMs: { critical: 15 * MINUTE, high: 30 * MINUTE, warning: HOUR },
    reminderMs: { critical: 6 * HOUR, high: 0, warning: 0 },
    storm: { windowMs: 10 * MINUTE, maxAlerts: 6 },
    retry: {
      maxAttempts: 5,
      backoffMs: [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR],
      perRun: 5,
      sendTimeoutMs: 8_000,
    },
  },
  monitor: { gapMs: 4 * MINUTE, pruneEveryMs: HOUR, emergencyWindowMs: 15 * MINUTE },
  retention: {
    errorsDays: 30,
    resolvedIncidentsDays: 180,
    probeHours: 72,
    bucketHours: 72,
    alertDeliveryDays: 90,
  },
};

function clampFor(key: string, value: number): number {
  if (/rate|share/i.test(key)) return Math.min(1, Math.max(0.01, value));
  if (/Ms$/.test(key)) return Math.min(14 * 24 * HOUR, Math.max(1_000, value));
  return Math.min(100_000, Math.max(1, Math.round(value)));
}

function merge<T>(base: T, override: unknown, key = ""): T {
  if (Array.isArray(base)) {
    if (
      Array.isArray(override) &&
      override.length > 0 &&
      override.length <= 10 &&
      override.every((v) => typeof v === "number" && Number.isFinite(v))
    )
      return override.map((v) => clampFor("Ms", v)) as T;
    return base;
  }
  if (typeof base === "number") {
    return (
      typeof override === "number" && Number.isFinite(override)
        ? clampFor(key, override)
        : base
    ) as T;
  }
  if (base && typeof base === "object") {
    const source =
      override && typeof override === "object" && !Array.isArray(override)
        ? (override as Record<string, unknown>)
        : {};
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(base)) {
      // A group of durations (cooldownMs: { critical, high, warning }) is bounded
      // as durations, not as the small counts its inner names would suggest.
      out[name] = merge(value, source[name], /Ms$/.test(key) ? key : name);
    }
    return out as T;
  }
  return base;
}

export function resolveThresholds(
  env: Record<string, string | undefined> = process.env,
): MonitorThresholds {
  const raw = env.MONITOR_THRESHOLDS_JSON?.trim();
  if (!raw) return DEFAULT_THRESHOLDS;
  try {
    return merge(DEFAULT_THRESHOLDS, JSON.parse(raw));
  } catch {
    console.warn("[monitoring] MONITOR_THRESHOLDS_JSON is not valid JSON; using defaults");
    return DEFAULT_THRESHOLDS;
  }
}
