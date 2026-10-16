import type { PlanId } from "@/product/saas/entitlements";
import { listPlanDefinitions, getPlanDefinition } from "./plans";
import type { BillingStore } from "./store";
import type { SubscriptionService } from "./subscriptionService";
import type { UsageService } from "./usageService";
import { createSubscriptionCheckoutSession } from "./stripe/checkout";
import { createCustomerPortalSession } from "./stripe/customerPortal";
import type { StripePort } from "./stripe/stripeClient";
import type {
  BillingInterval,
  BillingSummary,
  EffectiveEntitlements,
} from "./types";
import { resolveEffectiveEntitlements } from "./entitlementService";
import { newId } from "@/product/saas/ids";

export function createBillingService(deps: {
  store: BillingStore;
  subscriptions: SubscriptionService;
  usage: UsageService;
  stripe: StripePort | null;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return {
    listPlans() {
      return listPlanDefinitions();
    },

    async getEntitlements(
      businessId: string,
      organizationPlan: PlanId,
    ): Promise<EffectiveEntitlements> {
      return deps.subscriptions.getEffective(businessId, organizationPlan);
    },

    async getSummary(input: {
      businessId: string;
      organizationPlan: PlanId;
    }): Promise<BillingSummary> {
      const subscription = await deps.store.getSubscription(input.businessId);
      const entitlements = resolveEffectiveEntitlements({
        businessId: input.businessId,
        organizationPlan: input.organizationPlan,
        subscription,
        now: now(),
      });
      const usage = await deps.usage.getUsageSummary({
        businessId: input.businessId,
        plan: entitlements.plan,
        subscription,
      });
      const invoices = await deps.store.listInvoices(input.businessId);
      return {
        businessId: input.businessId,
        subscription,
        entitlements,
        usage,
        invoices,
        plans: listPlanDefinitions(),
      };
    },

    async createCheckout(input: {
      businessId: string;
      organizationPlan: PlanId;
      plan: PlanId;
      interval: BillingInterval;
      customerEmail: string;
      customerName: string;
      successUrl: string;
      cancelUrl: string;
      withTrial?: boolean;
      idempotencyKey?: string;
      actorUserId?: string | null;
      allowDuplicateSubscription?: boolean;
    }) {
      if (!deps.stripe) {
        return {
          ok: false as const,
          error: "Stripe is not configured (STRIPE_SECRET_KEY).",
          status: 503,
        };
      }

      const existing = await deps.store.getSubscription(input.businessId);
      if (
        existing?.stripeSubscriptionId &&
        (existing.status === "active" || existing.status === "trialing") &&
        !input.allowDuplicateSubscription
      ) {
        // Plan changes go through the Customer Portal / subscription update,
        // not a second Checkout that would create a duplicate subscription.
        if (existing.plan === input.plan) {
          return {
            ok: false as const,
            error:
              "An active subscription already exists. Use the billing portal to manage it.",
            status: 409,
          };
        }
      }

      const mapping = await deps.store.getStripeCustomer(input.businessId);
      const result = await createSubscriptionCheckoutSession(deps.stripe, {
        businessId: input.businessId,
        plan: input.plan,
        interval: input.interval,
        customerEmail: input.customerEmail,
        customerName: input.customerName,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        withTrial: input.withTrial,
        idempotencyKey: input.idempotencyKey,
        existingStripeCustomerId:
          mapping?.stripeCustomerId ?? existing?.stripeCustomerId ?? null,
      });

      if (!result.ok) return result;

      const at = now().toISOString();
      await deps.store.saveStripeCustomer({
        businessId: input.businessId,
        stripeCustomerId: result.stripeCustomerId,
        email: input.customerEmail,
        createdAt: mapping?.createdAt ?? at,
        updatedAt: at,
      });
      await deps.store.addAuditLog({
        id: newId("baudit"),
        businessId: input.businessId,
        actorUserId: input.actorUserId ?? null,
        action: "checkout_session_created",
        detail: {
          plan: input.plan,
          interval: input.interval,
          sessionId: result.sessionId,
        },
        createdAt: at,
      });

      return {
        ok: true as const,
        sessionId: result.sessionId,
        url: result.url,
      };
    },

    async createPortal(input: {
      businessId: string;
      returnUrl: string;
      actorUserId?: string | null;
    }) {
      if (!deps.stripe) {
        return {
          ok: false as const,
          error: "Stripe is not configured (STRIPE_SECRET_KEY).",
          status: 503,
        };
      }
      const mapping = await deps.store.getStripeCustomer(input.businessId);
      const sub = await deps.store.getSubscription(input.businessId);
      const customerId =
        mapping?.stripeCustomerId ?? sub?.stripeCustomerId ?? null;
      if (!customerId) {
        return {
          ok: false as const,
          error: "No Stripe customer yet. Subscribe to a plan first.",
          status: 400,
        };
      }
      const result = await createCustomerPortalSession(deps.stripe, {
        stripeCustomerId: customerId,
        returnUrl: input.returnUrl,
      });
      if (!result.ok) {
        return { ok: false as const, error: result.error, status: 502 };
      }
      await deps.store.addAuditLog({
        id: newId("baudit"),
        businessId: input.businessId,
        actorUserId: input.actorUserId ?? null,
        action: "portal_session_created",
        detail: {},
        createdAt: now().toISOString(),
      });
      return { ok: true as const, url: result.url };
    },

    async startTrial(input: {
      businessId: string;
      plan: PlanId;
      interval?: BillingInterval;
      actorUserId?: string | null;
    }) {
      const def = getPlanDefinition(input.plan);
      if (def.trialDays <= 0) {
        return {
          ok: false as const,
          error: "This plan does not include a free trial.",
          status: 400,
        };
      }
      const existing = await deps.store.getSubscription(input.businessId);
      if (
        existing?.stripeSubscriptionId &&
        (existing.status === "active" || existing.status === "trialing")
      ) {
        return {
          ok: false as const,
          error: "A subscription or trial is already active.",
          status: 409,
        };
      }
      const trial = await deps.subscriptions.startTrial(input);
      return { ok: true as const, subscription: trial };
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
