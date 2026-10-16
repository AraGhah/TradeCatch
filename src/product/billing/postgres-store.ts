import { Pool } from "pg";
import type {
  BillingAuditLog,
  BillingInvoice,
  BillingWebhookEvent,
  BusinessSubscription,
  CurrencyCode,
  InvoicePaymentStatus,
  StripeCustomerMapping,
  SubscriptionEvent,
  SubscriptionStatus,
  UsageAllowance,
  UsageMetric,
  UsageRecord,
} from "./types";
import type { BillingStore } from "./store";
import type { PlanId } from "@/product/saas/entitlements";
import type { BillingInterval } from "./types";

type Pg = { query: Pool["query"] };

function mapSubscription(row: Record<string, unknown>): BusinessSubscription {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    stripeCustomerId: row.stripe_customer_id
      ? String(row.stripe_customer_id)
      : null,
    stripeSubscriptionId: row.stripe_subscription_id
      ? String(row.stripe_subscription_id)
      : null,
    stripePriceId: row.stripe_price_id ? String(row.stripe_price_id) : null,
    plan: row.plan as PlanId,
    status: row.status as SubscriptionStatus,
    currency: row.currency as CurrencyCode,
    billingInterval: row.billing_interval as BillingInterval,
    unitAmountCents:
      row.unit_amount_cents == null ? null : Number(row.unit_amount_cents),
    currentPeriodStart: row.current_period_start
      ? new Date(String(row.current_period_start)).toISOString()
      : null,
    currentPeriodEnd: row.current_period_end
      ? new Date(String(row.current_period_end)).toISOString()
      : null,
    trialEndsAt: row.trial_ends_at
      ? new Date(String(row.trial_ends_at)).toISOString()
      : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    canceledAt: row.canceled_at
      ? new Date(String(row.canceled_at)).toISOString()
      : null,
    gracePeriodEndsAt: row.grace_period_ends_at
      ? new Date(String(row.grace_period_ends_at)).toISOString()
      : null,
    paymentMethodBrand: row.payment_method_brand
      ? String(row.payment_method_brand)
      : null,
    paymentMethodLast4: row.payment_method_last4
      ? String(row.payment_method_last4)
      : null,
    outstandingBalanceCents: Number(row.outstanding_balance_cents ?? 0),
    latestInvoiceId: row.latest_invoice_id
      ? String(row.latest_invoice_id)
      : null,
    metadata:
      row.metadata_json && typeof row.metadata_json === "object"
        ? (row.metadata_json as Record<string, string>)
        : {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapInvoice(row: Record<string, unknown>): BillingInvoice {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    stripeInvoiceId: String(row.stripe_invoice_id),
    number: row.number ? String(row.number) : null,
    status: row.status as InvoicePaymentStatus,
    currency: row.currency as CurrencyCode,
    subtotalCents: Number(row.subtotal_cents ?? 0),
    taxCents: Number(row.tax_cents ?? 0),
    overageCents: Number(row.overage_cents ?? 0),
    totalCents: Number(row.total_cents ?? 0),
    periodStart: row.period_start
      ? new Date(String(row.period_start)).toISOString()
      : null,
    periodEnd: row.period_end
      ? new Date(String(row.period_end)).toISOString()
      : null,
    plan: row.plan ? (row.plan as PlanId) : null,
    hostedInvoiceUrl: row.hosted_invoice_url
      ? String(row.hosted_invoice_url)
      : null,
    invoicePdf: row.invoice_pdf ? String(row.invoice_pdf) : null,
    paidAt: row.paid_at ? new Date(String(row.paid_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function createPostgresBillingStore(databaseUrl: string): BillingStore {
  const pool = new Pool({ connectionString: databaseUrl });
  const db: Pg = pool;

  return {
    async getSubscription(businessId) {
      const res = await db.query(
        `SELECT * FROM tc_business_subscriptions WHERE business_id = $1`,
        [businessId],
      );
      if (!res.rows[0]) return null;
      return mapSubscription(res.rows[0]);
    },
    async listSubscriptions() {
      const res = await db.query(`SELECT * FROM tc_business_subscriptions`);
      return res.rows.map((r) => mapSubscription(r));
    },
    async saveSubscription(row) {
      await db.query(
        `INSERT INTO tc_business_subscriptions (
           id, business_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
           plan, status, currency, billing_interval, unit_amount_cents,
           current_period_start, current_period_end, trial_ends_at,
           cancel_at_period_end, canceled_at, grace_period_ends_at,
           payment_method_brand, payment_method_last4, outstanding_balance_cents,
           latest_invoice_id, metadata_json, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23
         )
         ON CONFLICT (business_id) DO UPDATE SET
           id = EXCLUDED.id,
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           stripe_price_id = EXCLUDED.stripe_price_id,
           plan = EXCLUDED.plan,
           status = EXCLUDED.status,
           currency = EXCLUDED.currency,
           billing_interval = EXCLUDED.billing_interval,
           unit_amount_cents = EXCLUDED.unit_amount_cents,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           trial_ends_at = EXCLUDED.trial_ends_at,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           canceled_at = EXCLUDED.canceled_at,
           grace_period_ends_at = EXCLUDED.grace_period_ends_at,
           payment_method_brand = EXCLUDED.payment_method_brand,
           payment_method_last4 = EXCLUDED.payment_method_last4,
           outstanding_balance_cents = EXCLUDED.outstanding_balance_cents,
           latest_invoice_id = EXCLUDED.latest_invoice_id,
           metadata_json = EXCLUDED.metadata_json,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.businessId,
          row.stripeCustomerId,
          row.stripeSubscriptionId,
          row.stripePriceId,
          row.plan,
          row.status,
          row.currency,
          row.billingInterval,
          row.unitAmountCents,
          row.currentPeriodStart,
          row.currentPeriodEnd,
          row.trialEndsAt,
          row.cancelAtPeriodEnd,
          row.canceledAt,
          row.gracePeriodEndsAt,
          row.paymentMethodBrand,
          row.paymentMethodLast4,
          row.outstandingBalanceCents,
          row.latestInvoiceId,
          JSON.stringify(row.metadata),
          row.createdAt,
          row.updatedAt,
        ],
      );
      return row;
    },
    async getSubscriptionByStripeId(stripeSubscriptionId) {
      const res = await db.query(
        `SELECT * FROM tc_business_subscriptions WHERE stripe_subscription_id = $1`,
        [stripeSubscriptionId],
      );
      if (!res.rows[0]) return null;
      return mapSubscription(res.rows[0]);
    },
    async getStripeCustomer(businessId) {
      const res = await db.query(
        `SELECT * FROM tc_stripe_customers WHERE business_id = $1`,
        [businessId],
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0];
      return {
        businessId: String(row.business_id),
        stripeCustomerId: String(row.stripe_customer_id),
        email: row.email ? String(row.email) : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    },
    async getBusinessByStripeCustomer(stripeCustomerId) {
      const res = await db.query(
        `SELECT business_id FROM tc_stripe_customers WHERE stripe_customer_id = $1`,
        [stripeCustomerId],
      );
      return res.rows[0] ? String(res.rows[0].business_id) : null;
    },
    async saveStripeCustomer(row) {
      await db.query(
        `INSERT INTO tc_stripe_customers (business_id, stripe_customer_id, email, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (business_id) DO UPDATE SET
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           email = EXCLUDED.email,
           updated_at = EXCLUDED.updated_at`,
        [
          row.businessId,
          row.stripeCustomerId,
          row.email,
          row.createdAt,
          row.updatedAt,
        ],
      );
    },
    async addSubscriptionEvent(row) {
      await db.query(
        `INSERT INTO tc_subscription_events (id, business_id, stripe_event_id, type, payload_json, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          row.id,
          row.businessId,
          row.stripeEventId,
          row.type,
          JSON.stringify(row.payload),
          row.createdAt,
        ],
      );
    },
    async listSubscriptionEvents(businessId) {
      const res = await db.query(
        `SELECT * FROM tc_subscription_events WHERE business_id = $1 ORDER BY created_at DESC`,
        [businessId],
      );
      return res.rows.map(
        (row): SubscriptionEvent => ({
          id: String(row.id),
          businessId: String(row.business_id),
          stripeEventId: row.stripe_event_id
            ? String(row.stripe_event_id)
            : null,
          type: String(row.type),
          payload: (row.payload_json ?? {}) as Record<string, unknown>,
          createdAt: new Date(String(row.created_at)).toISOString(),
        }),
      );
    },
    async insertUsageRecord(row) {
      try {
        await db.query(
          `INSERT INTO tc_usage_records (
             id, business_id, metric, quantity, source, external_id,
             occurred_at, billing_period_start, billing_period_end, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            row.id,
            row.businessId,
            row.metric,
            row.quantity,
            row.source,
            row.externalId,
            row.occurredAt,
            row.billingPeriodStart,
            row.billingPeriodEnd,
            row.createdAt,
          ],
        );
        return row;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "23505") return null;
        throw err;
      }
    },
    async listUsageRecords(businessId, periodStart, periodEnd) {
      const res = await db.query(
        `SELECT * FROM tc_usage_records
         WHERE business_id = $1 AND billing_period_start = $2 AND billing_period_end = $3`,
        [businessId, periodStart, periodEnd],
      );
      return res.rows.map(
        (row): UsageRecord => ({
          id: String(row.id),
          businessId: String(row.business_id),
          metric: row.metric as UsageMetric,
          quantity: Number(row.quantity),
          source: String(row.source),
          externalId: row.external_id ? String(row.external_id) : null,
          occurredAt: new Date(String(row.occurred_at)).toISOString(),
          billingPeriodStart: new Date(
            String(row.billing_period_start),
          ).toISOString(),
          billingPeriodEnd: new Date(
            String(row.billing_period_end),
          ).toISOString(),
          createdAt: new Date(String(row.created_at)).toISOString(),
        }),
      );
    },
    async sumUsage(businessId, metric, periodStart, periodEnd) {
      const res = await db.query(
        `SELECT COALESCE(SUM(quantity), 0)::float AS total
         FROM tc_usage_records
         WHERE business_id = $1 AND metric = $2
           AND occurred_at >= $3 AND occurred_at < $4`,
        [businessId, metric, periodStart, periodEnd],
      );
      return Number(res.rows[0]?.total ?? 0);
    },
    async getAllowance(businessId, metric, periodStart) {
      const res = await db.query(
        `SELECT * FROM tc_usage_allowances
         WHERE business_id = $1 AND metric = $2 AND period_start = $3`,
        [businessId, metric, periodStart],
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0];
      return {
        businessId: String(row.business_id),
        plan: row.plan as PlanId,
        metric: row.metric as UsageMetric,
        includedQuantity: Number(row.included_quantity),
        policy: row.policy,
        overageRateCents:
          row.overage_rate_cents == null
            ? null
            : Number(row.overage_rate_cents),
        periodStart: new Date(String(row.period_start)).toISOString(),
        periodEnd: new Date(String(row.period_end)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      } as UsageAllowance;
    },
    async saveAllowance(row) {
      await db.query(
        `INSERT INTO tc_usage_allowances (
           business_id, plan, metric, included_quantity, policy,
           overage_rate_cents, period_start, period_end, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (business_id, metric, period_start) DO UPDATE SET
           plan = EXCLUDED.plan,
           included_quantity = EXCLUDED.included_quantity,
           policy = EXCLUDED.policy,
           overage_rate_cents = EXCLUDED.overage_rate_cents,
           period_end = EXCLUDED.period_end,
           updated_at = EXCLUDED.updated_at`,
        [
          row.businessId,
          row.plan,
          row.metric,
          row.includedQuantity,
          row.policy,
          row.overageRateCents,
          row.periodStart,
          row.periodEnd,
          row.updatedAt,
        ],
      );
    },
    async upsertInvoice(row) {
      await db.query(
        `INSERT INTO tc_billing_invoices (
           id, business_id, stripe_invoice_id, number, status, currency,
           subtotal_cents, tax_cents, overage_cents, total_cents,
           period_start, period_end, plan, hosted_invoice_url, invoice_pdf,
           paid_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
         )
         ON CONFLICT (business_id, stripe_invoice_id) DO UPDATE SET
           number = EXCLUDED.number,
           status = EXCLUDED.status,
           currency = EXCLUDED.currency,
           subtotal_cents = EXCLUDED.subtotal_cents,
           tax_cents = EXCLUDED.tax_cents,
           overage_cents = EXCLUDED.overage_cents,
           total_cents = EXCLUDED.total_cents,
           period_start = EXCLUDED.period_start,
           period_end = EXCLUDED.period_end,
           plan = EXCLUDED.plan,
           hosted_invoice_url = EXCLUDED.hosted_invoice_url,
           invoice_pdf = EXCLUDED.invoice_pdf,
           paid_at = EXCLUDED.paid_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.businessId,
          row.stripeInvoiceId,
          row.number,
          row.status,
          row.currency,
          row.subtotalCents,
          row.taxCents,
          row.overageCents,
          row.totalCents,
          row.periodStart,
          row.periodEnd,
          row.plan,
          row.hostedInvoiceUrl,
          row.invoicePdf,
          row.paidAt,
          row.createdAt,
          row.updatedAt,
        ],
      );
    },
    async listInvoices(businessId) {
      const res = await db.query(
        `SELECT * FROM tc_billing_invoices WHERE business_id = $1 ORDER BY created_at DESC`,
        [businessId],
      );
      return res.rows.map((r) => mapInvoice(r));
    },
    async getInvoice(businessId, stripeInvoiceId) {
      const res = await db.query(
        `SELECT * FROM tc_billing_invoices WHERE business_id = $1 AND stripe_invoice_id = $2`,
        [businessId, stripeInvoiceId],
      );
      if (!res.rows[0]) return null;
      return mapInvoice(res.rows[0]);
    },
    async getWebhookEvent(stripeEventId) {
      const res = await db.query(
        `SELECT * FROM tc_billing_webhook_events WHERE stripe_event_id = $1`,
        [stripeEventId],
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0];
      return {
        stripeEventId: String(row.stripe_event_id),
        type: String(row.type),
        status: row.status,
        error: row.error ? String(row.error) : null,
        receivedAt: new Date(String(row.received_at)).toISOString(),
        processedAt: row.processed_at
          ? new Date(String(row.processed_at)).toISOString()
          : null,
      } as BillingWebhookEvent;
    },
    async saveWebhookEvent(row) {
      await db.query(
        `INSERT INTO tc_billing_webhook_events (
           stripe_event_id, type, status, error, received_at, processed_at
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (stripe_event_id) DO UPDATE SET
           status = EXCLUDED.status,
           error = EXCLUDED.error,
           processed_at = EXCLUDED.processed_at`,
        [
          row.stripeEventId,
          row.type,
          row.status,
          row.error,
          row.receivedAt,
          row.processedAt,
        ],
      );
    },
    async addAuditLog(row) {
      await db.query(
        `INSERT INTO tc_billing_audit_logs (
           id, business_id, actor_user_id, action, detail_json, created_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          row.id,
          row.businessId,
          row.actorUserId,
          row.action,
          JSON.stringify(row.detail),
          row.createdAt,
        ],
      );
    },
    async listAuditLogs(businessId) {
      const res = businessId
        ? await db.query(
            `SELECT * FROM tc_billing_audit_logs WHERE business_id = $1 ORDER BY created_at DESC`,
            [businessId],
          )
        : await db.query(
            `SELECT * FROM tc_billing_audit_logs ORDER BY created_at DESC LIMIT 500`,
          );
      return res.rows.map(
        (row): BillingAuditLog => ({
          id: String(row.id),
          businessId: row.business_id ? String(row.business_id) : null,
          actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
          action: String(row.action),
          detail: (row.detail_json ?? {}) as Record<string, unknown>,
          createdAt: new Date(String(row.created_at)).toISOString(),
        }),
      );
    },
    async listFailedWebhooks() {
      const res = await db.query(
        `SELECT * FROM tc_billing_webhook_events WHERE status = 'failed' ORDER BY received_at DESC LIMIT 200`,
      );
      return res.rows.map(
        (row): BillingWebhookEvent => ({
          stripeEventId: String(row.stripe_event_id),
          type: String(row.type),
          status: "failed",
          error: row.error ? String(row.error) : null,
          receivedAt: new Date(String(row.received_at)).toISOString(),
          processedAt: row.processed_at
            ? new Date(String(row.processed_at)).toISOString()
            : null,
        }),
      );
    },
  };
}
