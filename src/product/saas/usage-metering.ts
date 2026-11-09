/**
 * Per-organization usage metering against the provisional plan allowances
 * in `src/lib/plans.ts` (USAGE_ALLOWANCES).
 *
 * Soft limits only: nothing here disconnects an active call or blocks a
 * message. When an organization first passes its written allowance in a
 * month, an overage confirmation is opened (status `pending`) and the owner is
 * told. Overage is only billable once the owner has confirmed it: any
 * invoicing step must read `confirmedOverageUnits`, which is 0 until then.
 *
 * Metering is wired into the live SMS port (missed-call/twilio.ts) and into
 * finalized receptionist calls (receptionist/runtime.ts).
 */
import { getPgPool } from "@/product/missed-call/postgres-store";
import { USAGE_ALLOWANCES, type PlanId, type UsageMetric } from "@/lib/plans";

export type { UsageMetric };

export const METERED_METRICS = [
  "smsSegmentsPerMonth",
  "voiceMinutesPerMonth",
] as const satisfies readonly UsageMetric[];

export type MeteredMetric = (typeof METERED_METRICS)[number];

const METRIC_COLUMN: Record<MeteredMetric, string> = {
  smsSegmentsPerMonth: "sms_segments",
  voiceMinutesPerMonth: "voice_minutes",
};

export type OverageStatus = "pending" | "confirmed" | "declined";

export type OverageConfirmation = {
  organizationId: string;
  metric: MeteredMetric;
  periodStart: string;
  status: OverageStatus;
  openedAt: string;
  /** Usage when the allowance was first passed. */
  usedAtOpen: number;
  resolvedAt?: string;
  resolvedByUserId?: string;
};

export type UsageSnapshot = {
  metric: MeteredMetric;
  periodStart: string;
  used: number;
  allowance: number;
  /** null when the plan has no allowance for this metric (e.g. Starter voice). */
  percentUsed: number | null;
  nearLimit: boolean;
  overLimit: boolean;
};

function currentPeriodStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Soft warning threshold: notify before the hard allowance is reached. */
const NEAR_LIMIT_RATIO = 0.8;

export function evaluateUsage(
  plan: PlanId,
  metric: MeteredMetric,
  used: number,
  now = new Date(),
): UsageSnapshot {
  const allowance = USAGE_ALLOWANCES[plan][metric];
  const percentUsed = allowance > 0 ? Math.round((used / allowance) * 100) : null;
  return {
    metric,
    periodStart: currentPeriodStart(now),
    used,
    allowance,
    percentUsed,
    nearLimit: allowance > 0 && used >= allowance * NEAR_LIMIT_RATIO && used < allowance,
    overLimit: allowance > 0 ? used >= allowance : used > 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€\f";

/** SMS segments a message body is billed as (GSM-7: 160/153, UCS-2: 70/67). */
export function smsSegments(body: string): number {
  if (body.length === 0) return 1;
  let gsm7 = true;
  let septets = 0;
  for (const ch of Array.from(body)) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXTENDED.includes(ch)) septets += 2;
    else {
      gsm7 = false;
      break;
    }
  }
  if (gsm7) return septets <= 160 ? 1 : Math.ceil(septets / 153);
  // UCS-2 counts UTF-16 code units.
  return body.length <= 70 ? 1 : Math.ceil(body.length / 67);
}

/** Voice minutes a call is metered as: whole minutes, rounded up. */
export function voiceMinutes(durationSeconds: number | undefined): number {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return 0;
  return Math.max(0, Math.ceil(durationSeconds / 60));
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

export type UsageStore = {
  /** Adds to the counter and returns the new total for the period. */
  increment(
    organizationId: string,
    metric: MeteredMetric,
    periodStart: string,
    amount: number,
  ): Promise<number>;
  counts(
    organizationId: string,
    periodStart: string,
  ): Promise<Map<MeteredMetric, number>>;
  /** `created` is true only for the caller that opened the confirmation. */
  openOverage(row: {
    organizationId: string;
    metric: MeteredMetric;
    periodStart: string;
    openedAt: string;
    usedAtOpen: number;
  }): Promise<{ row: OverageConfirmation; created: boolean }>;
  getOverage(
    organizationId: string,
    metric: MeteredMetric,
    periodStart: string,
  ): Promise<OverageConfirmation | null>;
  listOverages(
    organizationId: string,
    periodStart: string,
  ): Promise<OverageConfirmation[]>;
  /** Only a `pending` row can be resolved; returns null otherwise. */
  resolveOverage(input: {
    organizationId: string;
    metric: MeteredMetric;
    periodStart: string;
    status: "confirmed" | "declined";
    userId: string;
    at: string;
  }): Promise<OverageConfirmation | null>;
};

export function createMemoryUsageStore(): UsageStore {
  const counters = new Map<string, number>();
  const overages = new Map<string, OverageConfirmation>();
  const key = (o: string, m: string, p: string) => `${o}|${m}|${p}`;
  return {
    async increment(o, m, p, amount) {
      const next = (counters.get(key(o, m, p)) ?? 0) + amount;
      counters.set(key(o, m, p), next);
      return next;
    },
    async counts(o, p) {
      const out = new Map<MeteredMetric, number>();
      for (const m of METERED_METRICS) {
        const v = counters.get(key(o, m, p));
        if (v !== undefined) out.set(m, v);
      }
      return out;
    },
    async openOverage(row) {
      const k = key(row.organizationId, row.metric, row.periodStart);
      const existing = overages.get(k);
      if (existing) return { row: existing, created: false };
      const created: OverageConfirmation = { ...row, status: "pending" };
      overages.set(k, created);
      return { row: created, created: true };
    },
    async getOverage(o, m, p) {
      return overages.get(key(o, m, p)) ?? null;
    },
    async listOverages(o, p) {
      return [...overages.values()].filter(
        (r) => r.organizationId === o && r.periodStart === p,
      );
    },
    async resolveOverage(input) {
      const k = key(input.organizationId, input.metric, input.periodStart);
      const existing = overages.get(k);
      if (!existing || existing.status !== "pending") return null;
      const next: OverageConfirmation = {
        ...existing,
        status: input.status,
        resolvedAt: input.at,
        resolvedByUserId: input.userId,
      };
      overages.set(k, next);
      return next;
    },
  };
}

function durableDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    return null;
  }
  return url;
}

function mapOverage(row: Record<string, unknown>): OverageConfirmation {
  const iso = (v: unknown) => new Date(v as string | Date).toISOString();
  const period =
    row.period_start instanceof Date
      ? row.period_start.toISOString()
      : String(row.period_start);
  return {
    organizationId: String(row.organization_id),
    metric:
      row.metric === "voice_minutes" ? "voiceMinutesPerMonth" : "smsSegmentsPerMonth",
    periodStart: period.slice(0, 10),
    status: row.status as OverageStatus,
    openedAt: iso(row.opened_at),
    usedAtOpen: Number(row.used_at_open),
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : undefined,
    resolvedByUserId: (row.resolved_by_user_id as string) || undefined,
  };
}

function createPostgresUsageStore(url: string): UsageStore {
  const pool = () => getPgPool(url);
  const store: UsageStore = {
    async increment(o, m, p, amount) {
      const { rows } = await pool().query(
        `INSERT INTO tc_usage_counters (organization_id, metric, period_start, count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, metric, period_start)
         DO UPDATE SET count = tc_usage_counters.count + EXCLUDED.count, updated_at = now()
         RETURNING count`,
        [o, METRIC_COLUMN[m], p, amount],
      );
      return Number(rows[0]?.count ?? amount);
    },
    async counts(o, p) {
      const { rows } = await pool().query(
        "SELECT metric, count FROM tc_usage_counters WHERE organization_id=$1 AND period_start=$2",
        [o, p],
      );
      const out = new Map<MeteredMetric, number>();
      for (const row of rows as { metric: string; count: string | number }[]) {
        const m = METERED_METRICS.find((x) => METRIC_COLUMN[x] === row.metric);
        if (m) out.set(m, Number(row.count));
      }
      return out;
    },
    async openOverage(row) {
      const { rows } = await pool().query(
        `INSERT INTO tc_usage_overage_confirmations
           (organization_id, metric, period_start, status, opened_at, used_at_open)
         VALUES ($1,$2,$3,'pending',$4,$5)
         ON CONFLICT (organization_id, metric, period_start) DO NOTHING
         RETURNING *`,
        [
          row.organizationId,
          METRIC_COLUMN[row.metric],
          row.periodStart,
          row.openedAt,
          row.usedAtOpen,
        ],
      );
      if (rows[0]) return { row: mapOverage(rows[0]), created: true };
      const existing = await store.getOverage(
        row.organizationId,
        row.metric,
        row.periodStart,
      );
      return {
        row: existing ?? { ...row, status: "pending" },
        created: false,
      };
    },
    async getOverage(o, m, p) {
      const { rows } = await pool().query(
        `SELECT * FROM tc_usage_overage_confirmations
          WHERE organization_id=$1 AND metric=$2 AND period_start=$3`,
        [o, METRIC_COLUMN[m], p],
      );
      return rows[0] ? mapOverage(rows[0]) : null;
    },
    async listOverages(o, p) {
      const { rows } = await pool().query(
        `SELECT * FROM tc_usage_overage_confirmations
          WHERE organization_id=$1 AND period_start=$2`,
        [o, p],
      );
      return rows.map(mapOverage);
    },
    async resolveOverage(input) {
      const { rows } = await pool().query(
        `UPDATE tc_usage_overage_confirmations
            SET status=$4, resolved_at=$5, resolved_by_user_id=$6
          WHERE organization_id=$1 AND metric=$2 AND period_start=$3 AND status='pending'
          RETURNING *`,
        [
          input.organizationId,
          METRIC_COLUMN[input.metric],
          input.periodStart,
          input.status,
          input.at,
          input.userId,
        ],
      );
      return rows[0] ? mapOverage(rows[0]) : null;
    },
  };
  return store;
}

let memoryStore: UsageStore | null = null;
let storeOverride: UsageStore | null = null;

/** Tests only. */
export function setUsageStoreForTests(store: UsageStore | null) {
  storeOverride = store;
  memoryStore = null;
}

function usageStore(): UsageStore {
  if (storeOverride) return storeOverride;
  const url = durableDatabaseUrl();
  if (url) return createPostgresUsageStore(url);
  memoryStore ??= createMemoryUsageStore();
  return memoryStore;
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Adds `amount` to the organization's counter for the current calendar
 * month and returns the new total (null when there is nothing to add).
 */
export async function recordUsage(
  organizationId: string,
  metric: MeteredMetric,
  amount: number,
  now = new Date(),
): Promise<number | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return usageStore().increment(
    organizationId,
    metric,
    currentPeriodStart(now),
    amount,
  );
}

export type OverageNotifier = (input: {
  organizationId: string;
  metric: MeteredMetric;
  used: number;
  allowance: number;
}) => Promise<void>;

/**
 * Records usage and, the first time the organization passes its written
 * allowance in a month, opens an overage confirmation and tells the owner.
 * Never throws and never blocks the message or call being metered.
 */
export async function recordOrganizationUsage(input: {
  organizationId: string;
  plan: PlanId;
  metric: MeteredMetric;
  amount: number;
  now?: Date;
  notify?: OverageNotifier;
}): Promise<void> {
  const now = input.now ?? new Date();
  try {
    const total = await recordUsage(
      input.organizationId,
      input.metric,
      input.amount,
      now,
    );
    if (total === null) return;
    const allowance = USAGE_ALLOWANCES[input.plan][input.metric];
    if (total <= allowance) return;
    const { created } = await usageStore().openOverage({
      organizationId: input.organizationId,
      metric: input.metric,
      periodStart: currentPeriodStart(now),
      openedAt: now.toISOString(),
      usedAtOpen: total,
    });
    if (created && input.notify) {
      await input.notify({
        organizationId: input.organizationId,
        metric: input.metric,
        used: total,
        allowance,
      });
    }
  } catch (err) {
    console.warn("[usage] metering failed", err);
  }
}

async function meterForClient(
  clientAccountId: string,
  metric: MeteredMetric,
  amount: number,
) {
  if (amount <= 0) return;
  try {
    const { getSaasStore } = await import("./runtime");
    const org =
      await getSaasStore().findOrganizationByMissedCallClientId(clientAccountId);
    if (!org) return;
    await recordOrganizationUsage({
      organizationId: org.id,
      plan: org.plan,
      metric,
      amount,
      notify: notifyOwnerOfOverage,
    });
  } catch (err) {
    console.warn("[usage] could not resolve organization", err);
  }
}

/** Meters one outbound SMS for the business that owns the sending number. */
export function recordSmsUsageForClient(clientAccountId: string, body: string) {
  return meterForClient(clientAccountId, "smsSegmentsPerMonth", smsSegments(body));
}

/** Meters a finished receptionist call for its business. */
export function recordVoiceUsageForClient(
  clientAccountId: string,
  durationSeconds: number | undefined,
) {
  return meterForClient(
    clientAccountId,
    "voiceMinutesPerMonth",
    voiceMinutes(durationSeconds),
  );
}

const notifyOwnerOfOverage: OverageNotifier = async (input) => {
  const [{ getGrowthStore }, { sendBusinessNotifyEmail }] = await Promise.all([
    import("@/product/growth/runtime"),
    import("@/lib/business-notifications"),
  ]);
  const settings = await getGrowthStore().getOrgSettings(input.organizationId);
  if (!settings.notifyEmail) return;
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/$/, "");
  const sms = input.metric === "smsSegmentsPerMonth";
  await sendBusinessNotifyEmail({
    toEmail: settings.notifyEmail,
    subject: "You have passed this month's allowance. Nothing is billed until you confirm.",
    title: "Usage past your allowance",
    lines: [
      {
        label: sms ? "SMS segments used" : "Voice minutes used",
        value: String(input.used),
      },
      { label: "Written allowance", value: String(input.allowance) },
      {
        label: "Billing",
        value:
          "Usage past the allowance is not billed unless you confirm it on your billing page.",
      },
    ],
    ctaUrl: site ? `${site}/billing` : undefined,
    ctaLabel: site ? "Review usage" : undefined,
    idempotencyKey: `usage-overage:${input.organizationId}:${input.metric}:${currentPeriodStart(new Date())}`,
  });
};

/* -------------------------------------------------------------------------- */
/* Overage confirmation                                                       */
/* -------------------------------------------------------------------------- */

export async function listOverages(
  organizationId: string,
  now = new Date(),
): Promise<OverageConfirmation[]> {
  return usageStore().listOverages(organizationId, currentPeriodStart(now));
}

/** The owner confirms (or declines) billing for usage past the allowance. */
export async function resolveOverage(input: {
  organizationId: string;
  metric: MeteredMetric;
  decision: "confirmed" | "declined";
  userId: string;
  now?: Date;
}): Promise<OverageConfirmation | null> {
  const now = input.now ?? new Date();
  return usageStore().resolveOverage({
    organizationId: input.organizationId,
    metric: input.metric,
    periodStart: currentPeriodStart(now),
    status: input.decision,
    userId: input.userId,
    at: now.toISOString(),
  });
}

/**
 * Units past the allowance that may be billed this month: 0 unless the owner
 * confirmed. Any overage invoicing must use this, never raw usage.
 */
export async function confirmedOverageUnits(
  organizationId: string,
  plan: PlanId,
  metric: MeteredMetric,
  now = new Date(),
): Promise<number> {
  const period = currentPeriodStart(now);
  const store = usageStore();
  const row = await store.getOverage(organizationId, metric, period);
  if (row?.status !== "confirmed") return 0;
  const used = (await store.counts(organizationId, period)).get(metric) ?? 0;
  return Math.max(0, used - USAGE_ALLOWANCES[plan][metric]);
}

/** Current-month usage for every metered metric, for dashboard display. */
export async function usageSummary(
  organizationId: string,
  plan: PlanId,
  now = new Date(),
): Promise<UsageSnapshot[]> {
  const counts = await usageStore().counts(
    organizationId,
    currentPeriodStart(now),
  );
  return METERED_METRICS.map((metric) =>
    evaluateUsage(plan, metric, counts.get(metric) ?? 0, now),
  );
}

/**
 * Meters an outbound SMS by its sending number (the number belongs to one
 * business). Best effort: an unknown number or a lookup failure is ignored.
 */
export async function recordSmsUsageFromNumber(
  fromE164: string,
  body: string,
): Promise<void> {
  try {
    const { ensureMissedCallReady } = await import("@/product/missed-call/runtime");
    const { store } = await ensureMissedCallReady();
    const client = await store.findClientBySmsFromNumber(fromE164);
    if (!client) return;
    await recordSmsUsageForClient(client.id, body);
  } catch (err) {
    console.warn("[usage] could not meter SMS", err);
  }
}
