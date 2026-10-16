import type {
  BillingAuditLog,
  BillingInvoice,
  BillingWebhookEvent,
  BusinessSubscription,
  StripeCustomerMapping,
  SubscriptionEvent,
  UsageAllowance,
  UsageRecord,
} from "./types";
import type { BillingStore } from "./store";

export function createMemoryBillingStore(): BillingStore {
  const subscriptions = new Map<string, BusinessSubscription>();
  const customers = new Map<string, StripeCustomerMapping>();
  const customerToBusiness = new Map<string, string>();
  const events: SubscriptionEvent[] = [];
  const usage = new Map<string, UsageRecord>();
  const allowances = new Map<string, UsageAllowance>();
  const invoices = new Map<string, BillingInvoice>();
  const webhooks = new Map<string, BillingWebhookEvent>();
  const audits: BillingAuditLog[] = [];

  return {
    async getSubscription(businessId) {
      const row = subscriptions.get(businessId);
      return row ? structuredClone(row) : null;
    },
    async listSubscriptions() {
      return [...subscriptions.values()].map((r) => structuredClone(r));
    },
    async saveSubscription(row) {
      subscriptions.set(row.businessId, structuredClone(row));
      if (row.stripeCustomerId) {
        const existing = customers.get(row.businessId);
        const at = row.updatedAt;
        customers.set(row.businessId, {
          businessId: row.businessId,
          stripeCustomerId: row.stripeCustomerId,
          email: existing?.email ?? null,
          createdAt: existing?.createdAt ?? row.createdAt,
          updatedAt: at,
        });
        customerToBusiness.set(row.stripeCustomerId, row.businessId);
      }
      return structuredClone(row);
    },
    async getSubscriptionByStripeId(stripeSubscriptionId) {
      const row = [...subscriptions.values()].find(
        (s) => s.stripeSubscriptionId === stripeSubscriptionId,
      );
      return row ? structuredClone(row) : null;
    },
    async getStripeCustomer(businessId) {
      const row = customers.get(businessId);
      return row ? structuredClone(row) : null;
    },
    async getBusinessByStripeCustomer(stripeCustomerId) {
      const mapped = customerToBusiness.get(stripeCustomerId);
      if (mapped) return mapped;
      const fromSub = [...subscriptions.values()].find(
        (s) => s.stripeCustomerId === stripeCustomerId,
      );
      return fromSub?.businessId ?? null;
    },
    async saveStripeCustomer(row) {
      customers.set(row.businessId, structuredClone(row));
      customerToBusiness.set(row.stripeCustomerId, row.businessId);
    },
    async addSubscriptionEvent(row) {
      events.push(structuredClone(row));
    },
    async listSubscriptionEvents(businessId) {
      return events
        .filter((e) => e.businessId === businessId)
        .map((e) => structuredClone(e));
    },
    async insertUsageRecord(row) {
      if (row.externalId) {
        const dup = [...usage.values()].find(
          (u) =>
            u.businessId === row.businessId &&
            u.metric === row.metric &&
            u.externalId === row.externalId,
        );
        if (dup) return null;
      }
      usage.set(row.id, structuredClone(row));
      return structuredClone(row);
    },
    async listUsageRecords(businessId, periodStart, periodEnd) {
      return [...usage.values()]
        .filter(
          (u) =>
            u.businessId === businessId &&
            u.billingPeriodStart === periodStart &&
            u.billingPeriodEnd === periodEnd,
        )
        .map((u) => structuredClone(u));
    },
    async sumUsage(businessId, metric, periodStart, periodEnd) {
      return [...usage.values()]
        .filter(
          (u) =>
            u.businessId === businessId &&
            u.metric === metric &&
            u.occurredAt >= periodStart &&
            u.occurredAt < periodEnd,
        )
        .reduce((sum, u) => sum + u.quantity, 0);
    },
    async getAllowance(businessId, metric, periodStart) {
      const key = `${businessId}:${metric}:${periodStart}`;
      const row = allowances.get(key);
      return row ? structuredClone(row) : null;
    },
    async saveAllowance(row) {
      const key = `${row.businessId}:${row.metric}:${row.periodStart}`;
      allowances.set(key, structuredClone(row));
    },
    async upsertInvoice(row) {
      invoices.set(`${row.businessId}:${row.stripeInvoiceId}`, structuredClone(row));
    },
    async listInvoices(businessId) {
      return [...invoices.values()]
        .filter((i) => i.businessId === businessId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((i) => structuredClone(i));
    },
    async getInvoice(businessId, stripeInvoiceId) {
      const row = invoices.get(`${businessId}:${stripeInvoiceId}`);
      return row ? structuredClone(row) : null;
    },
    async getWebhookEvent(stripeEventId) {
      const row = webhooks.get(stripeEventId);
      return row ? structuredClone(row) : null;
    },
    async saveWebhookEvent(row) {
      webhooks.set(row.stripeEventId, structuredClone(row));
    },
    async addAuditLog(row) {
      audits.push(structuredClone(row));
    },
    async listAuditLogs(businessId) {
      return audits
        .filter((a) => (businessId ? a.businessId === businessId : true))
        .map((a) => structuredClone(a));
    },
    async listFailedWebhooks() {
      return [...webhooks.values()]
        .filter((w) => w.status === "failed")
        .map((w) => structuredClone(w));
    },
  };
}
