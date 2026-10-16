import { newId } from "@/product/saas/ids";
import type { PlanId } from "@/product/saas/entitlements";
import { getSaasStore } from "@/product/saas/runtime";
import { billingGracePeriodMs, getPlanDefinition, priceCentsFor } from "./plans";
import { createEmptySubscription, type BillingStore } from "./store";
import { resolveEffectiveEntitlements } from "./entitlementService";
import type {
  BillingInterval,
  BusinessSubscription,
  CurrencyCode,
  SubscriptionStatus,
} from "./types";
import { isSubscriptionStatus } from "./entitlementService";

function isoFromUnix(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

export function createSubscriptionService(deps: {
  store: BillingStore;
  now?: () => Date;
  updateOrganizationPlan?: (
    businessId: string,
    plan: PlanId,
  ) => Promise<void>;
}) {
  const now = deps.now ?? (() => new Date());

  async function syncOrgPlan(businessId: string, plan: PlanId) {
    if (deps.updateOrganizationPlan) {
      await deps.updateOrganizationPlan(businessId, plan);
      return;
    }
    await getSaasStore().updateOrganizationPlan(businessId, plan);
  }

  return {
    async getOrCreate(businessId: string, organizationPlan: PlanId) {
      const existing = await deps.store.getSubscription(businessId);
      if (existing) return existing;
      const row = createEmptySubscription(
        businessId,
        organizationPlan,
        now().toISOString(),
      );
      return deps.store.saveSubscription(row);
    },

    async getEffective(businessId: string, organizationPlan: PlanId) {
      const subscription = await deps.store.getSubscription(businessId);
      return resolveEffectiveEntitlements({
        businessId,
        organizationPlan,
        subscription,
        now: now(),
      });
    },

    async startTrial(input: {
      businessId: string;
      plan: PlanId;
      interval?: BillingInterval;
      actorUserId?: string | null;
    }) {
      const def = getPlanDefinition(input.plan);
      const at = now();
      const trialEnds = new Date(
        at.getTime() + def.trialDays * 24 * 60 * 60 * 1000,
      );
      const existing =
        (await deps.store.getSubscription(input.businessId)) ??
        createEmptySubscription(
          input.businessId,
          input.plan,
          at.toISOString(),
        );
      const next: BusinessSubscription = {
        ...existing,
        plan: input.plan,
        status: "trialing",
        billingInterval: input.interval ?? "month",
        unitAmountCents: priceCentsFor(
          input.plan,
          input.interval ?? "month",
        ),
        trialEndsAt: trialEnds.toISOString(),
        currentPeriodStart: at.toISOString(),
        currentPeriodEnd: trialEnds.toISOString(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        updatedAt: at.toISOString(),
      };
      await deps.store.saveSubscription(next);
      await syncOrgPlan(input.businessId, input.plan);
      await deps.store.addAuditLog({
        id: newId("baudit"),
        businessId: input.businessId,
        actorUserId: input.actorUserId ?? null,
        action: "trial_started",
        detail: { plan: input.plan, trialEndsAt: next.trialEndsAt },
        createdAt: at.toISOString(),
      });
      return next;
    },

    async applyStripeSubscription(input: {
      businessId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      stripePriceId: string | null;
      plan: PlanId;
      status: string;
      interval: BillingInterval;
      currency?: CurrencyCode;
      unitAmountCents?: number | null;
      currentPeriodStart?: number | null;
      currentPeriodEnd?: number | null;
      trialEnd?: number | null;
      cancelAtPeriodEnd?: boolean;
      canceledAt?: number | null;
      latestInvoiceId?: string | null;
      paymentMethodBrand?: string | null;
      paymentMethodLast4?: string | null;
      stripeEventId?: string | null;
      eventType?: string;
    }) {
      const at = now();
      const status: SubscriptionStatus = isSubscriptionStatus(input.status)
        ? input.status
        : "incomplete";

      const existing =
        (await deps.store.getSubscription(input.businessId)) ??
        createEmptySubscription(
          input.businessId,
          input.plan,
          at.toISOString(),
        );

      let gracePeriodEndsAt = existing.gracePeriodEndsAt;
      if (status === "past_due") {
        gracePeriodEndsAt =
          existing.gracePeriodEndsAt ??
          new Date(at.getTime() + billingGracePeriodMs()).toISOString();
      } else if (status === "active" || status === "trialing") {
        gracePeriodEndsAt = null;
      }

      const next: BusinessSubscription = {
        ...existing,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        stripePriceId: input.stripePriceId,
        plan: input.plan,
        status,
        currency: input.currency ?? existing.currency,
        billingInterval: input.interval,
        unitAmountCents:
          input.unitAmountCents ??
          priceCentsFor(input.plan, input.interval),
        currentPeriodStart:
          isoFromUnix(input.currentPeriodStart) ??
          existing.currentPeriodStart,
        currentPeriodEnd:
          isoFromUnix(input.currentPeriodEnd) ?? existing.currentPeriodEnd,
        trialEndsAt: isoFromUnix(input.trialEnd) ?? existing.trialEndsAt,
        cancelAtPeriodEnd: Boolean(input.cancelAtPeriodEnd),
        canceledAt: isoFromUnix(input.canceledAt),
        gracePeriodEndsAt,
        latestInvoiceId:
          input.latestInvoiceId ?? existing.latestInvoiceId,
        paymentMethodBrand:
          input.paymentMethodBrand ?? existing.paymentMethodBrand,
        paymentMethodLast4:
          input.paymentMethodLast4 ?? existing.paymentMethodLast4,
        updatedAt: at.toISOString(),
      };

      await deps.store.saveSubscription(next);
      await deps.store.saveStripeCustomer({
        businessId: input.businessId,
        stripeCustomerId: input.stripeCustomerId,
        email: null,
        createdAt: existing.createdAt,
        updatedAt: at.toISOString(),
      });

      // Only unlock paid plan features after a verified paid/trialing state.
      if (
        status === "active" ||
        status === "trialing" ||
        (status === "canceled" &&
          next.currentPeriodEnd &&
          Date.parse(next.currentPeriodEnd) > at.getTime())
      ) {
        await syncOrgPlan(input.businessId, input.plan);
      } else if (
        status === "unpaid" ||
        status === "incomplete_expired" ||
        (status === "canceled" &&
          (!next.currentPeriodEnd ||
            Date.parse(next.currentPeriodEnd) <= at.getTime()))
      ) {
        // Keep starter recovery as safe phone fallback; do not wipe data.
        await syncOrgPlan(input.businessId, "starter");
      }

      await deps.store.addSubscriptionEvent({
        id: newId("bsev"),
        businessId: input.businessId,
        stripeEventId: input.stripeEventId ?? null,
        type: input.eventType ?? `subscription.${status}`,
        payload: {
          stripeSubscriptionId: input.stripeSubscriptionId,
          plan: input.plan,
          status,
        },
        createdAt: at.toISOString(),
      });

      return next;
    },

    async markPaymentFailed(input: {
      businessId: string;
      stripeEventId?: string | null;
      invoiceId?: string | null;
    }) {
      const existing = await deps.store.getSubscription(input.businessId);
      if (!existing) return null;
      const at = now();
      const next: BusinessSubscription = {
        ...existing,
        status:
          existing.status === "trialing" ? "past_due" : "past_due",
        gracePeriodEndsAt:
          existing.gracePeriodEndsAt ??
          new Date(at.getTime() + billingGracePeriodMs()).toISOString(),
        latestInvoiceId: input.invoiceId ?? existing.latestInvoiceId,
        updatedAt: at.toISOString(),
      };
      await deps.store.saveSubscription(next);
      await deps.store.addSubscriptionEvent({
        id: newId("bsev"),
        businessId: input.businessId,
        stripeEventId: input.stripeEventId ?? null,
        type: "invoice.payment_failed",
        payload: { invoiceId: input.invoiceId ?? null },
        createdAt: at.toISOString(),
      });
      await deps.store.addAuditLog({
        id: newId("baudit"),
        businessId: input.businessId,
        actorUserId: null,
        action: "payment_failed",
        detail: {
          invoiceId: input.invoiceId ?? null,
          gracePeriodEndsAt: next.gracePeriodEndsAt,
        },
        createdAt: at.toISOString(),
      });
      return next;
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
