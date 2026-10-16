import type {
  BillingAuditLog,
  BillingInvoice,
  BillingWebhookEvent,
  BusinessSubscription,
  StripeCustomerMapping,
  SubscriptionEvent,
  UsageAllowance,
  UsageMetric,
  UsageRecord,
} from "./types";

export type BillingStore = {
  getSubscription(businessId: string): Promise<BusinessSubscription | null>;
  listSubscriptions(): Promise<BusinessSubscription[]>;
  saveSubscription(row: BusinessSubscription): Promise<BusinessSubscription>;
  getSubscriptionByStripeId(
    stripeSubscriptionId: string,
  ): Promise<BusinessSubscription | null>;

  getStripeCustomer(businessId: string): Promise<StripeCustomerMapping | null>;
  getBusinessByStripeCustomer(
    stripeCustomerId: string,
  ): Promise<string | null>;
  saveStripeCustomer(row: StripeCustomerMapping): Promise<void>;

  addSubscriptionEvent(row: SubscriptionEvent): Promise<void>;
  listSubscriptionEvents(businessId: string): Promise<SubscriptionEvent[]>;

  insertUsageRecord(row: UsageRecord): Promise<UsageRecord | null>;
  listUsageRecords(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<UsageRecord[]>;
  sumUsage(
    businessId: string,
    metric: UsageMetric,
    periodStart: string,
    periodEnd: string,
  ): Promise<number>;

  getAllowance(
    businessId: string,
    metric: UsageMetric,
    periodStart: string,
  ): Promise<UsageAllowance | null>;
  saveAllowance(row: UsageAllowance): Promise<void>;

  upsertInvoice(row: BillingInvoice): Promise<void>;
  listInvoices(businessId: string): Promise<BillingInvoice[]>;
  getInvoice(
    businessId: string,
    stripeInvoiceId: string,
  ): Promise<BillingInvoice | null>;

  getWebhookEvent(stripeEventId: string): Promise<BillingWebhookEvent | null>;
  saveWebhookEvent(row: BillingWebhookEvent): Promise<void>;

  addAuditLog(row: BillingAuditLog): Promise<void>;
  listAuditLogs(businessId?: string): Promise<BillingAuditLog[]>;

  listFailedWebhooks(): Promise<BillingWebhookEvent[]>;
};

export function createEmptySubscription(
  businessId: string,
  plan: BusinessSubscription["plan"],
  nowIso: string,
): BusinessSubscription {
  return {
    id: `bsub_${businessId}`,
    businessId,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    plan,
    status: "none",
    currency: "cad",
    billingInterval: "month",
    unitAmountCents: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    gracePeriodEndsAt: null,
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    outstandingBalanceCents: 0,
    latestInvoiceId: null,
    metadata: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
