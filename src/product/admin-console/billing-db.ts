import { z } from "zod";
import { adminDb, type AdminDb } from "./db";

/**
 * What the database knows about billing. Stripe is the source of truth for
 * money; these rows are what TradeCatch itself recorded: which organization
 * owns which Stripe customer, the subscription state the webhook synchronized,
 * and each payment outcome Stripe told us about.
 */

export type SubscriptionRow = {
  subscriptionId: string;
  organizationId: string;
  customerId: string;
  livemode: boolean;
  status: string;
  plan: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  latestInvoiceId: string | null;
  syncedAt: string;
};

const iso = (value: unknown) =>
  value == null ? null : new Date(value as string | Date).toISOString();

export async function listSubscriptionRows(
  db: AdminDb | null = adminDb(),
): Promise<SubscriptionRow[]> {
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT s.subscription_id, s.organization_id, c.customer_id, c.livemode,
            s.status, s.plan, s.cancel_at_period_end, s.current_period_end,
            s.latest_invoice_id, s.synced_at
       FROM tc_stripe_subscriptions s
       JOIN tc_stripe_customers c ON c.organization_id = s.organization_id
      ORDER BY s.synced_at DESC`,
  );
  return rows.map((row) => ({
    subscriptionId: String(row.subscription_id),
    organizationId: String(row.organization_id),
    customerId: String(row.customer_id),
    livemode: Boolean(row.livemode),
    status: String(row.status),
    plan: String(row.plan),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    currentPeriodEnd: iso(row.current_period_end),
    latestInvoiceId: row.latest_invoice_id ? String(row.latest_invoice_id) : null,
    syncedAt: iso(row.synced_at) ?? new Date(0).toISOString(),
  }));
}

export async function findOrganizationByCustomer(
  customerId: string,
  db: AdminDb | null = adminDb(),
): Promise<string | null> {
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT organization_id FROM tc_stripe_customers WHERE customer_id = $1`,
    [customerId],
  );
  return rows[0] ? String(rows[0].organization_id) : null;
}

// ---------------------------------------------------------------------------
// Payment outcomes
// ---------------------------------------------------------------------------

export const BILLING_OUTCOMES = ["failed", "succeeded", "action_required"] as const;
export type BillingOutcome = (typeof BILLING_OUTCOMES)[number];

export type BillingEventRow = {
  eventId: string;
  eventType: string;
  livemode: boolean;
  organizationId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  amountCents: number | null;
  currency: string | null;
  attemptCount: number | null;
  nextAttemptAt: string | null;
  outcome: BillingOutcome;
  createdAt: string;
};

/** The invoice events Stripe sends that tell us how a payment went. */
export const PAYMENT_EVENT_OUTCOME: Record<string, BillingOutcome> = {
  "invoice.payment_failed": "failed",
  "invoice.payment_action_required": "action_required",
  "invoice.paid": "succeeded",
  "invoice.payment_succeeded": "succeeded",
};

const reference = z.union([z.string(), z.object({ id: z.string() })]);

/** Only the fields we keep. Card details are never in an invoice event, and are never read. */
const invoiceSchema = z
  .object({
    id: z.string().min(1).max(255),
    customer: reference.nullish(),
    subscription: reference.nullish(),
    parent: z
      .object({
        subscription_details: z
          .object({ subscription: reference.nullish() })
          .nullish(),
      })
      .nullish(),
    amount_due: z.number().int().nullish(),
    amount_paid: z.number().int().nullish(),
    currency: z.string().max(10).nullish(),
    attempt_count: z.number().int().nullish(),
    next_payment_attempt: z.number().int().nullish(),
  })
  .passthrough();

const idOf = (value: string | { id: string } | null | undefined) =>
  value == null ? null : typeof value === "string" ? value : value.id;

/**
 * Turns a verified Stripe webhook payload into a billing event row, or null
 * when it is not a payment outcome. Pure: nothing is stored here.
 */
export function billingEventFromWebhook(
  payload: unknown,
): Omit<BillingEventRow, "organizationId" | "createdAt"> | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as {
    id?: unknown;
    type?: unknown;
    livemode?: unknown;
    data?: { object?: unknown };
  };
  if (typeof event.id !== "string" || typeof event.type !== "string") return null;
  const outcome = PAYMENT_EVENT_OUTCOME[event.type];
  if (!outcome || typeof event.livemode !== "boolean") return null;
  const parsed = invoiceSchema.safeParse(event.data?.object);
  if (!parsed.success) return null;
  const invoice = parsed.data;
  return {
    eventId: event.id.slice(0, 255),
    eventType: event.type,
    livemode: event.livemode,
    customerId: idOf(invoice.customer),
    subscriptionId:
      idOf(invoice.subscription) ??
      idOf(invoice.parent?.subscription_details?.subscription),
    invoiceId: invoice.id,
    amountCents:
      outcome === "succeeded"
        ? (invoice.amount_paid ?? invoice.amount_due ?? null)
        : (invoice.amount_due ?? null),
    currency: invoice.currency ? invoice.currency.toUpperCase() : null,
    attemptCount: invoice.attempt_count ?? null,
    nextAttemptAt: invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000).toISOString()
      : null,
    outcome,
  };
}

type Memory = { events: BillingEventRow[] };
const globalForBilling = globalThis as unknown as {
  __tradecatchBillingEvents?: Memory;
};
function memory(): Memory {
  return (globalForBilling.__tradecatchBillingEvents ??= { events: [] });
}
export function resetBillingEventsForTests() {
  delete globalForBilling.__tradecatchBillingEvents;
}

/**
 * Records a payment outcome once per Stripe event (a redelivered webhook is a
 * no-op). With no durable database it keeps them in memory, like every other
 * store in development, so the console works end to end in local runs.
 */
export async function recordBillingEvent(
  event: Omit<BillingEventRow, "organizationId" | "createdAt">,
  db: AdminDb | null = adminDb(),
  now: Date = new Date(),
): Promise<{ recorded: boolean }> {
  const organizationId = event.customerId
    ? await findOrganizationByCustomer(event.customerId, db).catch(() => null)
    : null;
  const row: BillingEventRow = {
    ...event,
    organizationId,
    createdAt: now.toISOString(),
  };
  if (!db) {
    const store = memory();
    if (store.events.some((e) => e.eventId === row.eventId)) {
      return { recorded: false };
    }
    store.events.push(row);
    return { recorded: true };
  }
  const result = await db.query(
    `INSERT INTO tc_billing_events
       (event_id, event_type, livemode, organization_id, customer_id, subscription_id,
        invoice_id, amount_cents, currency, attempt_count, next_attempt_at, outcome, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [
      row.eventId,
      row.eventType,
      row.livemode,
      row.organizationId,
      row.customerId,
      row.subscriptionId,
      row.invoiceId,
      row.amountCents,
      row.currency,
      row.attemptCount,
      row.nextAttemptAt,
      row.outcome,
      row.createdAt,
    ],
  );
  return { recorded: (result.rows?.length ?? 0) > 0 };
}

export type BillingEventFilter = {
  outcome?: BillingOutcome;
  organizationId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export async function listBillingEvents(
  filter: BillingEventFilter = {},
  db: AdminDb | null = adminDb(),
): Promise<{ rows: BillingEventRow[]; total: number }> {
  const limit = Math.min(100, Math.max(1, Math.floor(filter.limit ?? 25)));
  const offset = Math.max(0, Math.floor(filter.offset ?? 0));
  if (!db) {
    const matched = memory()
      .events.filter(
        (e) =>
          (!filter.outcome || e.outcome === filter.outcome) &&
          (!filter.organizationId || e.organizationId === filter.organizationId) &&
          (!filter.from || e.createdAt.slice(0, 10) >= filter.from) &&
          (!filter.to || e.createdAt.slice(0, 10) <= filter.to),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { rows: matched.slice(offset, offset + limit), total: matched.length };
  }
  const where: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filter.outcome) where.push(`outcome = ${bind(filter.outcome)}`);
  if (filter.organizationId) where.push(`organization_id = ${bind(filter.organizationId)}`);
  if (filter.from) where.push(`created_at >= ${bind(filter.from)}::date`);
  if (filter.to) where.push(`created_at < (${bind(filter.to)}::date + 1)`);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await db.query(`SELECT count(*)::int AS n FROM tc_billing_events ${clause}`, params);
  const { rows } = await db.query(
    `SELECT * FROM tc_billing_events ${clause} ORDER BY created_at DESC, event_id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    rows: rows.map((row) => ({
      eventId: String(row.event_id),
      eventType: String(row.event_type),
      livemode: Boolean(row.livemode),
      organizationId: row.organization_id ? String(row.organization_id) : null,
      customerId: row.customer_id ? String(row.customer_id) : null,
      subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
      invoiceId: row.invoice_id ? String(row.invoice_id) : null,
      amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
      currency: row.currency ? String(row.currency) : null,
      attemptCount: row.attempt_count == null ? null : Number(row.attempt_count),
      nextAttemptAt: iso(row.next_attempt_at),
      outcome: row.outcome as BillingOutcome,
      createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    })),
    total: Number(total.rows[0]?.n ?? 0),
  };
}

/** Failed payments in the last `days` days (default 30). */
export async function countRecentFailedPayments(
  days = 30,
  db: AdminDb | null = adminDb(),
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  if (!db) {
    return memory().events.filter((e) => e.outcome === "failed" && e.createdAt >= since).length;
  }
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM tc_billing_events WHERE outcome = 'failed' AND created_at >= $1`,
    [since],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Which organization owns each of these Stripe customers (only those we know). */
export async function organizationsByCustomers(
  customerIds: readonly string[],
  db: AdminDb | null = adminDb(),
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(customerIds)].filter((id) => /^cus_[A-Za-z0-9_]+$/.test(id)).slice(0, 200);
  if (!db || ids.length === 0) return map;
  const { rows } = await db.query(
    `SELECT customer_id, organization_id FROM tc_stripe_customers WHERE customer_id = ANY($1::text[])`,
    [ids],
  );
  for (const row of rows) map.set(String(row.customer_id), String(row.organization_id));
  return map;
}
