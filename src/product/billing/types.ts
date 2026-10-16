import type { FeatureId, PlanId } from "@/product/saas/entitlements";

export type BillingInterval = "month" | "year";
export type CurrencyCode = "cad" | "usd";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "paused"
  | "none";

export type UsageMetric = "ai_call_minutes" | "telephone_minutes" | "sms_segments";

export type UsageLimitPolicy = "hard_limit" | "soft_limit" | "paid_overage" | "auto_upgrade";

export type InvoicePaymentStatus =
  | "draft"
  | "open"
  | "paid"
  | "void"
  | "uncollectible"
  | "unknown";

export type SubscriptionPlanDefinition = {
  id: PlanId;
  name: { en: string; fr: string };
  description: { en: string; fr: string };
  currency: CurrencyCode;
  monthlyPriceCents: number;
  annualPriceCents: number;
  setupFeeCents: number;
  trialDays: number;
  features: readonly FeatureId[];
  allowances: Record<UsageMetric, number>;
  overageRatesCents: Partial<Record<UsageMetric, number>>;
  usagePolicy: UsageLimitPolicy;
  employeeLimit: number | null;
  taxesNote: { en: string; fr: string };
  cancellationNote: { en: string; fr: string };
};

export type BusinessSubscription = {
  id: string;
  businessId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  plan: PlanId;
  status: SubscriptionStatus;
  currency: CurrencyCode;
  billingInterval: BillingInterval;
  unitAmountCents: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  gracePeriodEndsAt: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  outstandingBalanceCents: number;
  latestInvoiceId: string | null;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type StripeCustomerMapping = {
  businessId: string;
  stripeCustomerId: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionEvent = {
  id: string;
  businessId: string;
  stripeEventId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type UsageRecord = {
  id: string;
  businessId: string;
  metric: UsageMetric;
  quantity: number;
  source: string;
  externalId: string | null;
  occurredAt: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  createdAt: string;
};

export type UsageAllowance = {
  businessId: string;
  plan: PlanId;
  metric: UsageMetric;
  includedQuantity: number;
  policy: UsageLimitPolicy;
  overageRateCents: number | null;
  periodStart: string;
  periodEnd: string;
  updatedAt: string;
};

export type BillingInvoice = {
  id: string;
  businessId: string;
  stripeInvoiceId: string;
  number: string | null;
  status: InvoicePaymentStatus;
  currency: CurrencyCode;
  subtotalCents: number;
  taxCents: number;
  overageCents: number;
  totalCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  plan: PlanId | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingWebhookEvent = {
  stripeEventId: string;
  type: string;
  status: "processed" | "ignored" | "failed";
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
};

export type BillingAuditLog = {
  id: string;
  businessId: string | null;
  actorUserId: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type UsageSummary = {
  businessId: string;
  plan: PlanId;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  metrics: Array<{
    metric: UsageMetric;
    used: number;
    included: number;
    remaining: number;
    overage: number;
    estimatedOverageCents: number;
    policy: UsageLimitPolicy;
  }>;
};

export type EffectiveEntitlements = {
  businessId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  features: readonly FeatureId[];
  accessMode: "full" | "grace" | "restricted" | "manual";
  reason: string | null;
  gracePeriodEndsAt: string | null;
  trialEndsAt: string | null;
};

export type BillingSummary = {
  businessId: string;
  subscription: BusinessSubscription | null;
  entitlements: EffectiveEntitlements;
  usage: UsageSummary;
  invoices: BillingInvoice[];
  plans: SubscriptionPlanDefinition[];
};
