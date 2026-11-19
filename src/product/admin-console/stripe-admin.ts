import { z } from "zod";
import { PLAN_PRICES } from "@/lib/plans";
import {
  PLAN_DISPLAY_NAMES,
  PLAN_IDS,
  PUBLIC_PLAN_IDS,
  type PlanId,
  type PublicPlanId,
} from "@/product/saas/entitlements";

/**
 * Read access to Stripe for the administration console, and the two
 * subscription changes an administrator may make. Everything here is built so
 * it cannot create a duplicate subscription or an unexpected charge:
 *
 *  - Reads are plain GETs and keep only the fields shown (never card data).
 *  - A plan change updates the EXISTING subscription item with proration off, so
 *    nothing is billed at the moment of the change; the new price starts with the
 *    next invoice. It never creates a subscription, an invoice or a charge.
 *  - A change is only attempted on an active/trialing subscription that
 *    belongs to a TradeCatch customer, after a fresh read from Stripe.
 *  - Every write carries an idempotency key, so a retry or a double click is one
 *    Stripe update.
 *
 * The transport is injectable (tests never touch Stripe).
 */

export type StripeHttp = {
  get(path: string, query?: Record<string, string | string[]>): Promise<unknown>;
  post(
    path: string,
    form: Record<string, string>,
    idempotencyKey: string,
  ): Promise<unknown>;
};

export class StripeHttpError extends Error {
  constructor(
    readonly status: number,
    /** Stripe's own error code (e.g. "resource_missing"), never a secret. */
    readonly code: string | null,
  ) {
    super(`Stripe request failed (${status}${code ? `, ${code}` : ""}).`);
    this.name = "StripeHttpError";
  }
}

const API_VERSION = "2025-02-24.acacia";

export function createStripeHttp(
  key: string,
  fetchImpl: typeof fetch = fetch,
): StripeHttp {
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${key}`,
    "Stripe-Version": API_VERSION,
    ...extra,
  });
  async function parse(response: Response): Promise<unknown> {
    if (response.ok) return response.json();
    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      code = typeof body.error?.code === "string" ? body.error.code : null;
    } catch {
      // keep null
    }
    throw new StripeHttpError(response.status, code);
  }
  return {
    async get(path, query = {}) {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(query)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          params.append(name, item);
        }
      }
      const suffix = params.size ? `?${params}` : "";
      return parse(
        await fetchImpl(`https://api.stripe.com/v1/${path}${suffix}`, {
          headers: headers(),
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        }),
      );
    },
    async post(path, form, idempotencyKey) {
      return parse(
        await fetchImpl(`https://api.stripe.com/v1/${path}`, {
          method: "POST",
          headers: headers({
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
          }),
          body: new URLSearchParams(form),
          signal: AbortSignal.timeout(15_000),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Which Stripe account the console talks to
// ---------------------------------------------------------------------------

export type StripeContext =
  | { configured: false; reason: string }
  | { configured: true; livemode: boolean; http: StripeHttp };

type EnvLike = Record<string, string | undefined>;

/**
 * The same rule as stripeSecretKey() in saas/stripe-key.ts, so the console and
 * the billing synchronization always talk to the same account: an `sk_` key of
 * the right mode (a test key may sit in either variable), never anything else.
 */
function keyFor(livemode: boolean, env: EnvLike): string | null {
  const raw = (
    livemode
      ? env.STRIPE_SECRET_KEY
      : env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY
  )?.trim();
  const mode = livemode ? "live" : "test";
  return raw && new RegExp(`^sk_${mode}_`).test(raw) ? raw : null;
}

/**
 * Live when a live key is configured, otherwise test. The page says which, so
 * an administrator never mistakes test data for real customers.
 */
export function resolveStripe(
  env: EnvLike = process.env,
  fetchImpl?: typeof fetch,
): StripeContext {
  const live = keyFor(true, env);
  if (live) {
    return { configured: true, livemode: true, http: createStripeHttp(live, fetchImpl) };
  }
  const test = keyFor(false, env);
  if (test) {
    return { configured: true, livemode: false, http: createStripeHttp(test, fetchImpl) };
  }
  return { configured: false, reason: "No Stripe API key is configured on this server." };
}

/** price id → plan, from STRIPE_(TEST_)PRICE_<PLAN> (comma separated lists allowed). */
export function planPriceMap(livemode: boolean, env: EnvLike = process.env) {
  const prices = new Map<string, PlanId>();
  for (const plan of PLAN_IDS) {
    const name = `STRIPE_${livemode ? "" : "TEST_"}PRICE_${plan.toUpperCase()}`;
    for (const id of (env[name] || "").split(",").map((p) => p.trim()).filter(Boolean)) {
      prices.set(id, plan);
    }
  }
  return prices;
}

export function configuredPriceId(
  plan: PublicPlanId,
  livemode: boolean,
  env: EnvLike = process.env,
): string | null {
  const name = `STRIPE_${livemode ? "" : "TEST_"}PRICE_${plan.toUpperCase()}`;
  return (env[name] || "").split(",").map((p) => p.trim()).filter(Boolean)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Normalised shapes (only what the console shows)
// ---------------------------------------------------------------------------

export type PlanPrice = {
  plan: PublicPlanId;
  planLabel: string;
  priceId: string | null;
  /** What Stripe actually charges, from the Price object. null when it cannot be read. */
  unitAmountCents: number | null;
  currency: string | null;
  interval: string | null;
  active: boolean | null;
  productName: string | null;
  /** What the TradeCatch catalog (site, dashboard) says the plan costs per month, in CAD. */
  catalogMonthlyCad: number;
  /** True when Stripe's amount equals the catalog amount. */
  matchesCatalog: boolean | null;
  error: string | null;
};

export type StripeSubscription = {
  id: string;
  status: string;
  customerId: string;
  customerEmail: string | null;
  customerName: string | null;
  /** From the customer's metadata; the database mapping is authoritative. */
  metadataOrganizationId: string | null;
  priceId: string | null;
  plan: PlanId | null;
  unitAmountCents: number | null;
  currency: string | null;
  interval: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  latestInvoiceId: string | null;
  createdAt: string | null;
  livemode: boolean;
  itemId: string | null;
  itemCount: number;
};

export type StripeInvoice = {
  id: string;
  number: string | null;
  status: string;
  customerId: string | null;
  customerEmail: string | null;
  subscriptionId: string | null;
  currency: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  amountRemainingCents: number;
  attemptCount: number | null;
  nextPaymentAttempt: string | null;
  dueDate: string | null;
  createdAt: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  livemode: boolean;
};

const ts = (value: number | null | undefined) =>
  typeof value === "number" ? new Date(value * 1000).toISOString() : null;

const ref = z.union([z.string(), z.object({ id: z.string() }).passthrough()]);
const refId = (value: z.infer<typeof ref> | null | undefined) =>
  value == null ? null : typeof value === "string" ? value : value.id;

const priceSchema = z
  .object({
    id: z.string(),
    active: z.boolean().optional(),
    currency: z.string().nullish(),
    unit_amount: z.number().int().nullish(),
    type: z.string().optional(),
    recurring: z.object({ interval: z.string(), interval_count: z.number().optional() }).nullish(),
    product: z.union([z.string(), z.object({ name: z.string().nullish() }).passthrough()]).nullish(),
  })
  .passthrough();

const subscriptionSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    livemode: z.boolean().optional(),
    customer: z
      .union([
        z.string(),
        z
          .object({
            id: z.string(),
            email: z.string().nullish(),
            name: z.string().nullish(),
            metadata: z.record(z.string(), z.string()).nullish(),
          })
          .passthrough(),
      ]),
    cancel_at_period_end: z.boolean().optional(),
    current_period_end: z.number().optional(),
    latest_invoice: ref.nullish(),
    created: z.number().optional(),
    items: z.object({
      data: z.array(
        z
          .object({
            id: z.string(),
            current_period_end: z.number().optional(),
            price: priceSchema,
          })
          .passthrough(),
      ),
      has_more: z.boolean().optional(),
    }),
  })
  .passthrough();

const invoiceSchema = z
  .object({
    id: z.string(),
    number: z.string().nullish(),
    status: z.string().nullish(),
    customer: ref.nullish(),
    customer_email: z.string().nullish(),
    subscription: ref.nullish(),
    parent: z
      .object({ subscription_details: z.object({ subscription: ref.nullish() }).nullish() })
      .nullish(),
    currency: z.string().nullish(),
    amount_due: z.number().int().optional(),
    amount_paid: z.number().int().optional(),
    amount_remaining: z.number().int().optional(),
    attempt_count: z.number().int().nullish(),
    next_payment_attempt: z.number().int().nullish(),
    due_date: z.number().int().nullish(),
    created: z.number().optional(),
    status_transitions: z.object({ paid_at: z.number().int().nullish() }).nullish(),
    hosted_invoice_url: z.string().nullish(),
    livemode: z.boolean().optional(),
  })
  .passthrough();

const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), has_more: z.boolean().optional() });

function normalizeSubscription(
  raw: z.infer<typeof subscriptionSchema>,
  prices: Map<string, PlanId>,
): StripeSubscription {
  const customer = typeof raw.customer === "string" ? null : raw.customer;
  const item = raw.items.data[0];
  const periodEnd = raw.current_period_end ?? item?.current_period_end;
  return {
    id: raw.id,
    status: raw.status,
    customerId: typeof raw.customer === "string" ? raw.customer : raw.customer.id,
    customerEmail: customer?.email ?? null,
    customerName: customer?.name ?? null,
    metadataOrganizationId: customer?.metadata?.organization_id ?? null,
    priceId: item?.price.id ?? null,
    plan: item ? (prices.get(item.price.id) ?? null) : null,
    unitAmountCents: item?.price.unit_amount ?? null,
    currency: item?.price.currency ? item.price.currency.toUpperCase() : null,
    interval: item?.price.recurring?.interval ?? null,
    cancelAtPeriodEnd: raw.cancel_at_period_end ?? false,
    currentPeriodEnd: ts(periodEnd),
    latestInvoiceId: refId(raw.latest_invoice),
    createdAt: ts(raw.created),
    livemode: raw.livemode ?? false,
    itemId: item?.id ?? null,
    itemCount: raw.items.data.length + (raw.items.has_more ? 1 : 0),
  };
}

function normalizeInvoice(raw: z.infer<typeof invoiceSchema>): StripeInvoice {
  return {
    id: raw.id,
    number: raw.number ?? null,
    status: raw.status ?? "unknown",
    customerId: refId(raw.customer),
    customerEmail: raw.customer_email ?? null,
    subscriptionId:
      refId(raw.subscription) ?? refId(raw.parent?.subscription_details?.subscription),
    currency: raw.currency ? raw.currency.toUpperCase() : null,
    amountDueCents: raw.amount_due ?? 0,
    amountPaidCents: raw.amount_paid ?? 0,
    amountRemainingCents: raw.amount_remaining ?? 0,
    attemptCount: raw.attempt_count ?? null,
    nextPaymentAttempt: ts(raw.next_payment_attempt),
    dueDate: ts(raw.due_date),
    createdAt: ts(raw.created),
    paidAt: ts(raw.status_transitions?.paid_at),
    hostedInvoiceUrl: raw.hosted_invoice_url ?? null,
    livemode: raw.livemode ?? false,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The Essential and Professional prices as Stripe actually has them. */
export async function loadPlanPrices(
  http: StripeHttp,
  livemode: boolean,
  env: EnvLike = process.env,
): Promise<PlanPrice[]> {
  return Promise.all(
    PUBLIC_PLAN_IDS.map(async (plan): Promise<PlanPrice> => {
      const priceId = configuredPriceId(plan, livemode, env);
      const base: PlanPrice = {
        plan,
        planLabel: PLAN_DISPLAY_NAMES[plan],
        priceId,
        unitAmountCents: null,
        currency: null,
        interval: null,
        active: null,
        productName: null,
        catalogMonthlyCad: PLAN_PRICES[plan].monthly,
        matchesCatalog: null,
        error: null,
      };
      if (!priceId) return { ...base, error: "No Stripe price id is configured for this plan." };
      try {
        const price = priceSchema.parse(
          await http.get(`prices/${encodeURIComponent(priceId)}`, { "expand[]": "product" }),
        );
        const amount = price.unit_amount ?? null;
        return {
          ...base,
          unitAmountCents: amount,
          currency: price.currency ? price.currency.toUpperCase() : null,
          interval: price.recurring?.interval ?? null,
          active: price.active ?? null,
          productName:
            price.product && typeof price.product !== "string"
              ? (price.product.name ?? null)
              : null,
          matchesCatalog:
            amount === null ? null : amount === Math.round(PLAN_PRICES[plan].monthly * 100),
        };
      } catch (error) {
        return {
          ...base,
          error:
            error instanceof StripeHttpError && error.status === 404
              ? "Stripe has no price with the configured id."
              : "The price could not be read from Stripe.",
        };
      }
    }),
  );
}

export const SUBSCRIPTION_STATUS_FILTERS = [
  "all",
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type SubscriptionStatusFilter = (typeof SUBSCRIPTION_STATUS_FILTERS)[number];

export async function listStripeSubscriptions(
  http: StripeHttp,
  livemode: boolean,
  options: { status?: SubscriptionStatusFilter; limit?: number; startingAfter?: string } = {},
  env: EnvLike = process.env,
): Promise<{ rows: StripeSubscription[]; hasMore: boolean; nextCursor: string | null }> {
  const query: Record<string, string | string[]> = {
    status: options.status ?? "all",
    limit: String(Math.min(100, Math.max(1, options.limit ?? 25))),
    "expand[]": "data.customer",
  };
  if (options.startingAfter) query.starting_after = options.startingAfter;
  const list = listOf(subscriptionSchema).parse(await http.get("subscriptions", query));
  const prices = planPriceMap(livemode, env);
  const rows = list.data.map((s) => normalizeSubscription(s, prices));
  return {
    rows,
    hasMore: list.has_more ?? false,
    nextCursor: list.has_more && rows.length ? rows[rows.length - 1].id : null,
  };
}

export async function getStripeSubscription(
  http: StripeHttp,
  livemode: boolean,
  id: string,
  env: EnvLike = process.env,
): Promise<StripeSubscription> {
  const raw = subscriptionSchema.parse(
    await http.get(`subscriptions/${encodeURIComponent(id)}`, { "expand[]": "customer" }),
  );
  return normalizeSubscription(raw, planPriceMap(livemode, env));
}

export const INVOICE_STATUS_FILTERS = ["all", "paid", "open", "uncollectible", "void", "draft"] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export async function listStripeInvoices(
  http: StripeHttp,
  options: {
    status?: InvoiceStatusFilter;
    customerId?: string;
    limit?: number;
    startingAfter?: string;
  } = {},
): Promise<{ rows: StripeInvoice[]; hasMore: boolean; nextCursor: string | null }> {
  const query: Record<string, string | string[]> = {
    limit: String(Math.min(100, Math.max(1, options.limit ?? 25))),
  };
  if (options.status && options.status !== "all") query.status = options.status;
  if (options.customerId) query.customer = options.customerId;
  if (options.startingAfter) query.starting_after = options.startingAfter;
  const list = listOf(invoiceSchema).parse(await http.get("invoices", query));
  const rows = list.data.map(normalizeInvoice);
  return {
    rows,
    hasMore: list.has_more ?? false,
    nextCursor: list.has_more && rows.length ? rows[rows.length - 1].id : null,
  };
}

/**
 * Money still owed, by currency, across the OPEN invoices Stripe holds. An
 * invoice past its due date counts as overdue. Computed from invoice rows, not
 * stored, so it can never drift from Stripe.
 */
export function summarizeOutstanding(
  invoices: readonly StripeInvoice[],
  now: Date = new Date(),
): { currency: string; outstandingCents: number; overdueCents: number; openInvoices: number }[] {
  const byCurrency = new Map<
    string,
    { outstandingCents: number; overdueCents: number; openInvoices: number }
  >();
  for (const invoice of invoices) {
    if (invoice.status !== "open" || invoice.amountRemainingCents <= 0) continue;
    const key = invoice.currency ?? "CAD";
    const entry = byCurrency.get(key) ?? { outstandingCents: 0, overdueCents: 0, openInvoices: 0 };
    entry.outstandingCents += invoice.amountRemainingCents;
    entry.openInvoices += 1;
    if (invoice.dueDate && Date.parse(invoice.dueDate) < now.getTime()) {
      entry.overdueCents += invoice.amountRemainingCents;
    }
    byCurrency.set(key, entry);
  }
  return [...byCurrency].map(([currency, value]) => ({ currency, ...value }));
}

/** Recurring revenue implied by the subscriptions that are billing right now. */
export function monthlyRecurringCents(subscriptions: readonly StripeSubscription[]) {
  const byCurrency = new Map<string, number>();
  for (const sub of subscriptions) {
    if (sub.status !== "active" && sub.status !== "past_due") continue;
    if (sub.unitAmountCents === null || !sub.currency) continue;
    // Only monthly prices contribute here; a yearly price would need /12 and
    // is not something TradeCatch sells.
    if (sub.interval !== "month") continue;
    byCurrency.set(sub.currency, (byCurrency.get(sub.currency) ?? 0) + sub.unitAmountCents);
  }
  return [...byCurrency].map(([currency, cents]) => ({ currency, cents }));
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_ACTIONS = ["change_plan", "cancel_at_period_end", "resume"] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

/** What an administrator must type to confirm. */
export const SUBSCRIPTION_CONFIRM: Record<SubscriptionAction, string> = {
  change_plan: "change plan",
  cancel_at_period_end: "cancel",
  resume: "resume",
};

export type SubscriptionChangeError =
  | "invalid_id"
  | "confirm"
  | "stripe_unconfigured"
  | "not_found"
  | "not_managed"
  | "invalid_state"
  | "same_plan"
  | "price_not_configured"
  | "price_invalid"
  | "nothing_to_change"
  | "unavailable"
  | "rejected";

export type SubscriptionChangeInput = {
  subscriptionId: string;
  action: SubscriptionAction;
  /** change_plan only. */
  targetPlan?: PublicPlanId;
  confirm: string;
};

export type SubscriptionChangeDeps = {
  http: StripeHttp;
  livemode: boolean;
  env?: EnvLike;
  /** Which organization owns this Stripe customer (the database mapping). */
  organizationForCustomer(customerId: string): Promise<string | null>;
  /** Re-reads Stripe state into the database after a successful change. */
  synchronize(subscription: {
    subscriptionId: string;
    customerId: string;
    livemode: boolean;
  }): Promise<{ synchronized: boolean }>;
  /** The organization's recorded plan afterwards, for the entitlement check. */
  organizationPlan(organizationId: string): Promise<PlanId | null>;
  now?: () => Date;
};

export type SubscriptionChangeResult =
  | {
      ok: true;
      organizationId: string;
      before: { plan: PlanId | null; priceId: string | null; cancelAtPeriodEnd: boolean };
      after: { plan: PlanId | null; priceId: string | null; cancelAtPeriodEnd: boolean };
      /** Whether the database now agrees with Stripe (the webhook also converges it). */
      synchronized: boolean;
      /** Whether the organization's recorded plan (its entitlements) matches the new plan. */
      entitlementsUpdated: boolean | null;
    }
  | { ok: false; error: SubscriptionChangeError };

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{6,80}$/;
const CHANGEABLE = new Set(["active", "trialing"]);

export async function changeSubscription(
  input: SubscriptionChangeInput,
  deps: SubscriptionChangeDeps,
): Promise<SubscriptionChangeResult> {
  const env = deps.env ?? process.env;
  if (!SUBSCRIPTION_ID.test(input.subscriptionId)) return { ok: false, error: "invalid_id" };
  if (input.confirm.trim().toLowerCase() !== SUBSCRIPTION_CONFIRM[input.action]) {
    return { ok: false, error: "confirm" };
  }
  if (input.action === "change_plan" && !input.targetPlan) {
    return { ok: false, error: "nothing_to_change" };
  }

  let current: StripeSubscription;
  try {
    // Always the live state, never what the page last showed.
    current = await getStripeSubscription(deps.http, deps.livemode, input.subscriptionId, env);
  } catch (error) {
    if (error instanceof StripeHttpError && error.status === 404) return { ok: false, error: "not_found" };
    return { ok: false, error: "unavailable" };
  }

  // Only subscriptions that belong to a TradeCatch customer are ours to change.
  const organizationId = await deps.organizationForCustomer(current.customerId);
  if (!organizationId) return { ok: false, error: "not_managed" };
  if (current.itemCount !== 1 || !current.itemId) return { ok: false, error: "invalid_state" };
  if (current.livemode !== deps.livemode) return { ok: false, error: "invalid_state" };

  const before = {
    plan: current.plan,
    priceId: current.priceId,
    cancelAtPeriodEnd: current.cancelAtPeriodEnd,
  };
  const now = (deps.now ?? (() => new Date()))();
  // Duplicate clicks and retries inside the same minute are one Stripe update.
  const bucket = Math.floor(now.getTime() / 60_000);

  const form: Record<string, string> = {};
  let idempotencyKey: string;

  if (input.action === "change_plan") {
    if (!CHANGEABLE.has(current.status)) return { ok: false, error: "invalid_state" };
    const target = input.targetPlan!;
    if (!(PUBLIC_PLAN_IDS as readonly string[]).includes(target)) return { ok: false, error: "price_invalid" };
    const targetPriceId = configuredPriceId(target, deps.livemode, env);
    if (!targetPriceId) return { ok: false, error: "price_not_configured" };
    if (current.plan === target || current.priceId === targetPriceId) {
      return { ok: false, error: "same_plan" };
    }
    try {
      // The configured id may be stale; confirm it is a live monthly price in the same currency.
      const price = priceSchema.parse(await deps.http.get(`prices/${encodeURIComponent(targetPriceId)}`));
      const usable =
        price.active === true &&
        price.type === "recurring" &&
        price.recurring?.interval === "month" &&
        (price.currency ?? "").toUpperCase() === current.currency;
      if (!usable) return { ok: false, error: "price_invalid" };
    } catch (error) {
      if (error instanceof StripeHttpError && error.status === 404) return { ok: false, error: "price_invalid" };
      return { ok: false, error: "unavailable" };
    }
    form["items[0][id]"] = current.itemId;
    form["items[0][price]"] = targetPriceId;
    // No proration: nothing is charged or credited at the moment of the change.
    form.proration_behavior = "none";
    // If Stripe could not complete the change cleanly, fail instead of leaving
    // the subscription in a half-updated, payment-pending state.
    form.payment_behavior = "error_if_incomplete";
    idempotencyKey = `tc-admin-plan:${current.id}:${current.priceId}:${targetPriceId}:${bucket}`;
  } else if (input.action === "cancel_at_period_end") {
    if (!CHANGEABLE.has(current.status)) return { ok: false, error: "invalid_state" };
    if (current.cancelAtPeriodEnd) return { ok: false, error: "nothing_to_change" };
    form.cancel_at_period_end = "true";
    idempotencyKey = `tc-admin-cancel:${current.id}:${bucket}`;
  } else {
    if (!CHANGEABLE.has(current.status)) return { ok: false, error: "invalid_state" };
    if (!current.cancelAtPeriodEnd) return { ok: false, error: "nothing_to_change" };
    form.cancel_at_period_end = "false";
    idempotencyKey = `tc-admin-resume:${current.id}:${bucket}`;
  }

  let updated: StripeSubscription;
  try {
    updated = normalizeSubscription(
      subscriptionSchema.parse(
        await deps.http.post(`subscriptions/${encodeURIComponent(current.id)}`, form, idempotencyKey),
      ),
      planPriceMap(deps.livemode, env),
    );
  } catch (error) {
    if (error instanceof StripeHttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      return { ok: false, error: "rejected" };
    }
    return { ok: false, error: "unavailable" };
  }

  // The change is made. Bring the database (and so the customer's entitlements)
  // in step now; the subscription webhook will do the same, harmlessly.
  let synchronized = false;
  try {
    synchronized = (
      await deps.synchronize({
        subscriptionId: updated.id,
        customerId: updated.customerId,
        livemode: deps.livemode,
      })
    ).synchronized;
  } catch {
    synchronized = false;
  }
  let entitlementsUpdated: boolean | null = null;
  if (input.action === "change_plan") {
    const recorded = await deps.organizationPlan(organizationId).catch(() => null);
    entitlementsUpdated = recorded === input.targetPlan;
  }

  return {
    ok: true,
    organizationId,
    before,
    after: {
      plan: updated.plan,
      priceId: updated.priceId,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
    },
    synchronized,
    entitlementsUpdated,
  };
}
