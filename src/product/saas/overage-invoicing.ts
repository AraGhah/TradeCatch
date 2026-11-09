/**
 * Bills usage past the plan allowance to Stripe, once, and only when the owner
 * has confirmed it. Nothing here runs unless an operator turns it on:
 *
 *   OVERAGE_INVOICING=1                    off by default
 *   OVERAGE_RATE_SMS_SEGMENT_CENTS=<n>     price of one SMS segment past the allowance
 *   OVERAGE_RATE_VOICE_MINUTE_CENTS=<n>    price of one call minute past the allowance
 *
 * The allowances in plans.ts are provisional and no overage rate has been
 * published, so the rates are deliberately not defaulted: with the flag off, or
 * either rate missing or not a whole number of cents, every function here does
 * nothing and says why. Set them only after the allowances, rates and terms are
 * approved and shown to customers.
 *
 * Safety rules, each covered by tests/unit/overage-invoicing.test.ts:
 *  - Units come from `confirmedOverageUnits`, which is 0 for a pending, declined
 *    or never-opened overage. Raw usage is never read here.
 *  - Only a closed month is billed (the previous one), never one still accruing.
 *  - One row per organization, metric and month claims the work before Stripe is
 *    called; units and price are frozen in that row. A month with a row is never
 *    billed again, and a crash between Stripe and the database cannot double bill:
 *    the retry reuses the frozen amounts and the same Stripe idempotency key.
 *  - A claim older than Stripe's idempotency window is not retried blindly: it is
 *    marked `needs_review` for a person.
 *  - The Stripe call creates a pending invoice item. It joins the customer's next
 *    subscription invoice; it does not charge a card by itself.
 */
import type { PlanId } from "@/lib/plans";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { stripeSecretKey } from "./stripe-key";
import {
  confirmedOverageUnits,
  METERED_METRICS,
  type MeteredMetric,
} from "./usage-metering";

export type OverageRates = Record<MeteredMetric, number>;

export type OverageInvoicingSettings =
  { enabled: false; reason: string } | { enabled: true; rates: OverageRates };

/** A rate above this is a typo ($100 per SMS segment), not a price. */
const MAX_RATE_CENTS = 10_000;
/** Stripe keeps an idempotency key for 24 hours; stay safely inside it. */
export const RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;

const RATE_ENV: Record<MeteredMetric, string> = {
  smsSegmentsPerMonth: "OVERAGE_RATE_SMS_SEGMENT_CENTS",
  voiceMinutesPerMonth: "OVERAGE_RATE_VOICE_MINUTE_CENTS",
};

export function overageInvoicingSettings(
  env: Record<string, string | undefined> = process.env,
): OverageInvoicingSettings {
  if (env.OVERAGE_INVOICING?.trim() !== "1") {
    return { enabled: false, reason: "OVERAGE_INVOICING is not set to 1" };
  }
  const rates = {} as OverageRates;
  for (const metric of METERED_METRICS) {
    const raw = env[RATE_ENV[metric]]?.trim() ?? "";
    const cents = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_RATE_CENTS) {
      return {
        enabled: false,
        reason: `${RATE_ENV[metric]} must be a whole number of cents from 1 to ${MAX_RATE_CENTS}`,
      };
    }
    rates[metric] = cents;
  }
  return { enabled: true, rates };
}

/** First day (UTC, YYYY-MM-DD) of the month before `now`: the month to bill. */
export function previousPeriodStart(now: Date): string {
  const first = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  return first.toISOString().slice(0, 10);
}

export type InvoiceStatus = "pending" | "created" | "needs_review";

export type InvoiceClaim = {
  organizationId: string;
  metric: MeteredMetric;
  periodStart: string;
  units: number;
  rateCents: number;
  amountCents: number;
  status: InvoiceStatus;
  stripeInvoiceItemId?: string;
  claimedAt: string;
};

export type OverageInvoiceStore = {
  /** Inserts the claim unless one exists; `created` is true only for the caller that inserted it. */
  claim(
    row: Omit<InvoiceClaim, "status" | "stripeInvoiceItemId" | "claimedAt">,
    at: string,
  ): Promise<{ claim: InvoiceClaim; created: boolean }>;
  markCreated(
    organizationId: string,
    metric: MeteredMetric,
    periodStart: string,
    stripeInvoiceItemId: string,
    at: string,
  ): Promise<void>;
  markNeedsReview(
    organizationId: string,
    metric: MeteredMetric,
    periodStart: string,
  ): Promise<void>;
};

export type StripeCustomer = { customerId: string; livemode: boolean };

export type InvoiceItemRequest = {
  customerId: string;
  livemode: boolean;
  amountCents: number;
  description: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
};

export type OverageInvoicingDeps = {
  now: Date;
  settings: OverageInvoicingSettings;
  /** Organizations that may have a confirmed overage for the month. Over-inclusion is safe. */
  candidates(
    periodStart: string,
  ): Promise<{ organizationId: string; plan: PlanId }[]>;
  customerFor(organizationId: string): Promise<StripeCustomer | null>;
  invoices: OverageInvoiceStore;
  createInvoiceItem(request: InvoiceItemRequest): Promise<{ id: string }>;
};

export type OverageInvoicingResult = {
  enabled: boolean;
  reason?: string;
  periodStart?: string;
  invoiced: number;
  alreadyInvoiced: number;
  retried: number;
  needsReview: number;
  noCustomer: number;
  failed: number;
};

const METRIC_LABEL: Record<MeteredMetric, string> = {
  smsSegmentsPerMonth: "SMS segments past your allowance",
  voiceMinutesPerMonth: "Call minutes past your allowance",
};

const METRIC_KEY: Record<MeteredMetric, string> = {
  smsSegmentsPerMonth: "sms_segments",
  voiceMinutesPerMonth: "voice_minutes",
};

function describe(
  metric: MeteredMetric,
  periodStart: string,
  units: number,
  rate: number,
) {
  const month = periodStart.slice(0, 7);
  return `${METRIC_LABEL[metric]} (${month}): ${units} × $${(rate / 100).toFixed(2)}`;
}

export async function runOverageInvoicing(
  deps: OverageInvoicingDeps,
): Promise<OverageInvoicingResult> {
  const result: OverageInvoicingResult = {
    enabled: deps.settings.enabled,
    invoiced: 0,
    alreadyInvoiced: 0,
    retried: 0,
    needsReview: 0,
    noCustomer: 0,
    failed: 0,
  };
  if (!deps.settings.enabled) {
    result.reason = deps.settings.reason;
    return result;
  }
  const rates = deps.settings.rates;
  const periodStart = previousPeriodStart(deps.now);
  result.periodStart = periodStart;
  // Any instant inside the billed month selects that month's counters.
  const inPeriod = new Date(`${periodStart}T12:00:00.000Z`);

  for (const { organizationId, plan } of await deps.candidates(periodStart)) {
    for (const metric of METERED_METRICS) {
      try {
        // 0 unless the owner confirmed: the only source of billable units.
        const units = await confirmedOverageUnits(
          organizationId,
          plan,
          metric,
          inPeriod,
        );
        if (units <= 0) continue;
        const outcome = await invoiceOne(deps, {
          organizationId,
          metric,
          periodStart,
          units,
          rateCents: rates[metric],
        });
        result[outcome] += 1;
      } catch (err) {
        result.failed += 1;
        console.warn(
          "[overage-invoicing] could not invoice",
          { organizationId, metric, periodStart },
          err instanceof Error ? err.message : "unknown error",
        );
      }
    }
  }
  return result;
}

type Outcome =
  "invoiced" | "alreadyInvoiced" | "retried" | "needsReview" | "noCustomer";

async function invoiceOne(
  deps: OverageInvoicingDeps,
  work: {
    organizationId: string;
    metric: MeteredMetric;
    periodStart: string;
    units: number;
    rateCents: number;
  },
): Promise<Outcome> {
  const { organizationId, metric, periodStart } = work;
  const customer = await deps.customerFor(organizationId);
  // No Stripe customer yet: claim nothing, so a later run bills it once there is one.
  if (!customer) return "noCustomer";

  const at = deps.now.toISOString();
  const { claim, created } = await deps.invoices.claim(
    { ...work, amountCents: work.units * work.rateCents },
    at,
  );
  if (!created) {
    if (claim.status === "created") return "alreadyInvoiced";
    if (claim.status === "needs_review") return "needsReview";
    // A claim whose Stripe call may or may not have happened. Inside the idempotency
    // window the same request is safe to repeat; after it, only a person can tell.
    const age = deps.now.getTime() - new Date(claim.claimedAt).getTime();
    if (!(age >= 0 && age < RETRY_WINDOW_MS)) {
      await deps.invoices.markNeedsReview(organizationId, metric, periodStart);
      return "needsReview";
    }
  }

  const item = await deps.createInvoiceItem({
    customerId: customer.customerId,
    livemode: customer.livemode,
    // The claim's frozen numbers, not a recomputation from today's usage.
    amountCents: claim.amountCents,
    description: describe(metric, periodStart, claim.units, claim.rateCents),
    idempotencyKey: `overage:${organizationId}:${METRIC_KEY[metric]}:${periodStart}`,
    metadata: {
      organization_id: organizationId,
      metric: METRIC_KEY[metric],
      period_start: periodStart,
      units: String(claim.units),
      rate_cents: String(claim.rateCents),
    },
  });
  await deps.invoices.markCreated(
    organizationId,
    metric,
    periodStart,
    item.id,
    at,
  );
  return created ? "invoiced" : "retried";
}

/* -------------------------------------------------------------------------- */
/* In-memory store (tests)                                                    */
/* -------------------------------------------------------------------------- */

export function createMemoryOverageInvoiceStore(): OverageInvoiceStore & {
  rows: Map<string, InvoiceClaim>;
} {
  const rows = new Map<string, InvoiceClaim>();
  const key = (o: string, m: MeteredMetric, p: string) => `${o}|${m}|${p}`;
  return {
    rows,
    async claim(row, at) {
      const k = key(row.organizationId, row.metric, row.periodStart);
      const existing = rows.get(k);
      if (existing) return { claim: { ...existing }, created: false };
      const claim: InvoiceClaim = { ...row, status: "pending", claimedAt: at };
      rows.set(k, claim);
      return { claim: { ...claim }, created: true };
    },
    async markCreated(o, m, p, id) {
      const row = rows.get(key(o, m, p));
      if (row)
        Object.assign(row, { status: "created", stripeInvoiceItemId: id });
    },
    async markNeedsReview(o, m, p) {
      const row = rows.get(key(o, m, p));
      if (row && row.status === "pending") row.status = "needs_review";
    },
  };
}

/* -------------------------------------------------------------------------- */
/* PostgreSQL                                                                 */
/* -------------------------------------------------------------------------- */

const METRIC_COLUMN: Record<MeteredMetric, string> = {
  smsSegmentsPerMonth: "sms_segments",
  voiceMinutesPerMonth: "voice_minutes",
};

function metricFromColumn(value: unknown): MeteredMetric {
  return value === "voice_minutes"
    ? "voiceMinutesPerMonth"
    : "smsSegmentsPerMonth";
}

function mapClaim(row: Record<string, unknown>): InvoiceClaim {
  const period =
    row.period_start instanceof Date
      ? row.period_start.toISOString()
      : String(row.period_start);
  return {
    organizationId: String(row.organization_id),
    metric: metricFromColumn(row.metric),
    periodStart: period.slice(0, 10),
    units: Number(row.units),
    rateCents: Number(row.rate_cents),
    amountCents: Number(row.amount_cents),
    status: row.status as InvoiceStatus,
    stripeInvoiceItemId: (row.stripe_invoice_item_id as string) || undefined,
    claimedAt: new Date(row.claimed_at as string | Date).toISOString(),
  };
}

export function createPostgresOverageInvoiceStore(
  url: string,
): OverageInvoiceStore {
  const pool = () => getPgPool(url);
  const store: OverageInvoiceStore = {
    async claim(row, at) {
      const inserted = await pool().query(
        `INSERT INTO tc_usage_overage_invoices
           (organization_id, metric, period_start, units, rate_cents, amount_cents, status, claimed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
         ON CONFLICT (organization_id, metric, period_start) DO NOTHING
         RETURNING *`,
        [
          row.organizationId,
          METRIC_COLUMN[row.metric],
          row.periodStart,
          row.units,
          row.rateCents,
          row.amountCents,
          at,
        ],
      );
      if (inserted.rows[0])
        return { claim: mapClaim(inserted.rows[0]), created: true };
      const existing = await pool().query(
        `SELECT * FROM tc_usage_overage_invoices
          WHERE organization_id=$1 AND metric=$2 AND period_start=$3`,
        [row.organizationId, METRIC_COLUMN[row.metric], row.periodStart],
      );
      if (!existing.rows[0]) throw new Error("overage claim vanished");
      return { claim: mapClaim(existing.rows[0]), created: false };
    },
    async markCreated(o, m, p, id, at) {
      await pool().query(
        `UPDATE tc_usage_overage_invoices
            SET status='created', stripe_invoice_item_id=$4, created_at=$5
          WHERE organization_id=$1 AND metric=$2 AND period_start=$3`,
        [o, METRIC_COLUMN[m], p, id, at],
      );
    },
    async markNeedsReview(o, m, p) {
      await pool().query(
        `UPDATE tc_usage_overage_invoices SET status='needs_review'
          WHERE organization_id=$1 AND metric=$2 AND period_start=$3 AND status='pending'`,
        [o, METRIC_COLUMN[m], p],
      );
    },
  };
  return store;
}

async function createStripeInvoiceItem(
  request: InvoiceItemRequest,
): Promise<{ id: string }> {
  const body = new URLSearchParams({
    customer: request.customerId,
    currency: "cad",
    amount: String(request.amountCents),
    description: request.description,
  });
  for (const [k, v] of Object.entries(request.metadata))
    body.set(`metadata[${k}]`, v);
  const response = await fetch("https://api.stripe.com/v1/invoiceitems", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey(request.livemode)}`,
      "Stripe-Version": "2025-02-24.acacia",
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": request.idempotencyKey,
    },
    body,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Stripe invoice item failed (${response.status})`);
  }
  const json = (await response.json()) as { id?: unknown };
  if (typeof json.id !== "string" || !json.id) {
    throw new Error("Stripe invoice item response had no id");
  }
  return { id: json.id };
}

export function createPostgresOverageInvoicingDeps(
  url: string,
  now = new Date(),
  settings = overageInvoicingSettings(),
): OverageInvoicingDeps {
  const pool = () => getPgPool(url);
  return {
    now,
    settings,
    async candidates(periodStart) {
      const { rows } = await pool().query(
        `SELECT DISTINCT c.organization_id, o.plan
           FROM tc_usage_overage_confirmations c
           JOIN tc_organizations o ON o.id = c.organization_id
          WHERE c.period_start = $1 AND c.status = 'confirmed'`,
        [periodStart],
      );
      return rows.map((row) => ({
        organizationId: String(row.organization_id),
        plan: row.plan as PlanId,
      }));
    },
    async customerFor(organizationId) {
      const { rows } = await pool().query(
        "SELECT customer_id, livemode FROM tc_stripe_customers WHERE organization_id=$1",
        [organizationId],
      );
      return rows[0]
        ? {
            customerId: String(rows[0].customer_id),
            livemode: Boolean(rows[0].livemode),
          }
        : null;
    },
    invoices: createPostgresOverageInvoiceStore(url),
    createInvoiceItem: createStripeInvoiceItem,
  };
}
