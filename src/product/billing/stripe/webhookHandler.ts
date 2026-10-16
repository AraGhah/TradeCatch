import type Stripe from "stripe";
import { isPlanId, type PlanId } from "@/product/saas/entitlements";
import { newId } from "@/product/saas/ids";
import type { BillingStore } from "../store";
import type { SubscriptionService } from "../subscriptionService";
import type {
  BillingInterval,
  CurrencyCode,
  InvoicePaymentStatus,
} from "../types";
import { planFromStripePriceId } from "./config";
import type { StripePort } from "./stripeClient";

function mapInvoiceStatus(status: string | null): InvoicePaymentStatus {
  if (
    status === "draft" ||
    status === "open" ||
    status === "paid" ||
    status === "void" ||
    status === "uncollectible"
  ) {
    return status;
  }
  return "unknown";
}

function intervalFromStripe(
  value: string | undefined,
): BillingInterval {
  return value === "year" ? "year" : "month";
}

function extractPlan(
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv,
): { plan: PlanId; interval: BillingInterval; priceId: string | null } {
  const metaPlan = sub.metadata?.plan;
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const interval = intervalFromStripe(item?.price?.recurring?.interval);
  if (metaPlan && isPlanId(metaPlan)) {
    return { plan: metaPlan, interval, priceId };
  }
  if (priceId) {
    const mapped = planFromStripePriceId(priceId, env);
    if (mapped) return { ...mapped, priceId };
  }
  return { plan: "starter", interval, priceId };
}

async function resolveBusinessId(
  store: BillingStore,
  opts: {
    metadataBusinessId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    clientReferenceId?: string | null;
  },
): Promise<string | null> {
  if (opts.metadataBusinessId) return opts.metadataBusinessId;
  if (opts.clientReferenceId) return opts.clientReferenceId;
  if (opts.stripeSubscriptionId) {
    const bySub = await store.getSubscriptionByStripeId(
      opts.stripeSubscriptionId,
    );
    if (bySub) return bySub.businessId;
  }
  if (opts.stripeCustomerId) {
    return store.getBusinessByStripeCustomer(opts.stripeCustomerId);
  }
  return null;
}

export function createWebhookHandler(deps: {
  store: BillingStore;
  subscriptions: SubscriptionService;
  stripe: StripePort;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());

  async function upsertInvoiceFromStripe(
    businessId: string,
    invoice: Stripe.Invoice,
    plan: PlanId | null,
  ) {
    const at = now().toISOString();
    await deps.store.upsertInvoice({
      id: newId("binv"),
      businessId,
      stripeInvoiceId: invoice.id,
      number: invoice.number,
      status: mapInvoiceStatus(invoice.status),
      currency: (invoice.currency as CurrencyCode) || "cad",
      subtotalCents: invoice.subtotal ?? 0,
      taxCents: invoice.tax ?? 0,
      overageCents: 0,
      totalCents: invoice.total ?? 0,
      periodStart: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : null,
      periodEnd: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : null,
      plan,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
      paidAt:
        invoice.status === "paid" && invoice.status_transitions?.paid_at
          ? new Date(
              invoice.status_transitions.paid_at * 1000,
            ).toISOString()
          : invoice.status === "paid"
            ? at
            : null,
      createdAt: at,
      updatedAt: at,
    });
  }

  async function dispatch(event: Stripe.Event): Promise<string | null> {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode !== "subscription") return null;
          const businessId = await resolveBusinessId(deps.store, {
            metadataBusinessId: session.metadata?.businessId ?? null,
            clientReferenceId: session.client_reference_id,
            stripeCustomerId:
              typeof session.customer === "string"
                ? session.customer
                : session.customer?.id ?? null,
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id ?? null,
          });
          if (!businessId || !session.subscription) return businessId;
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await deps.stripe.retrieveSubscription(subId);
          const extracted = extractPlan(sub, env);
          const customerId =
            typeof sub.customer === "string"
              ? sub.customer
              : sub.customer.id;
          await deps.subscriptions.applyStripeSubscription({
            businessId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            stripePriceId: extracted.priceId,
            plan: extracted.plan,
            status: sub.status,
            interval: extracted.interval,
            currency: (sub.currency as CurrencyCode) || "cad",
            unitAmountCents: sub.items.data[0]?.price?.unit_amount ?? null,
            currentPeriodStart: sub.current_period_start,
            currentPeriodEnd: sub.current_period_end,
            trialEnd: sub.trial_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            canceledAt: sub.canceled_at,
            latestInvoiceId:
              typeof sub.latest_invoice === "string"
                ? sub.latest_invoice
                : sub.latest_invoice?.id ?? null,
            stripeEventId: event.id,
            eventType: event.type,
          });
          return businessId;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const extracted = extractPlan(sub, env);
          const customerId =
            typeof sub.customer === "string"
              ? sub.customer
              : sub.customer.id;
          const businessId = await resolveBusinessId(deps.store, {
            metadataBusinessId: sub.metadata?.businessId ?? null,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
          });
          if (!businessId) return null;
          const status =
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : sub.status;
          await deps.subscriptions.applyStripeSubscription({
            businessId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            stripePriceId: extracted.priceId,
            plan: extracted.plan,
            status,
            interval: extracted.interval,
            currency: (sub.currency as CurrencyCode) || "cad",
            unitAmountCents: sub.items.data[0]?.price?.unit_amount ?? null,
            currentPeriodStart: sub.current_period_start,
            currentPeriodEnd: sub.current_period_end,
            trialEnd: sub.trial_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            canceledAt: sub.canceled_at ?? (status === "canceled" ? Math.floor(now().getTime() / 1000) : null),
            latestInvoiceId:
              typeof sub.latest_invoice === "string"
                ? sub.latest_invoice
                : sub.latest_invoice?.id ?? null,
            stripeEventId: event.id,
            eventType: event.type,
          });
          return businessId;
        }

        case "invoice.paid":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId =
            typeof invoice.customer === "string"
              ? invoice.customer
              : invoice.customer?.id ?? null;
          const subId =
            typeof invoice.subscription === "string"
              ? invoice.subscription
              : invoice.subscription?.id ?? null;
          const businessId = await resolveBusinessId(deps.store, {
            metadataBusinessId: invoice.metadata?.businessId ?? null,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
          });
          if (!businessId) return null;
          const subRow = await deps.store.getSubscription(businessId);
          await upsertInvoiceFromStripe(
            businessId,
            invoice,
            subRow?.plan ?? null,
          );
          if (event.type === "invoice.payment_failed") {
            await deps.subscriptions.markPaymentFailed({
              businessId,
              stripeEventId: event.id,
              invoiceId: invoice.id,
            });
          } else if (subId) {
            const sub = await deps.stripe.retrieveSubscription(subId);
            const extracted = extractPlan(sub, env);
            await deps.subscriptions.applyStripeSubscription({
              businessId,
              stripeCustomerId:
                typeof sub.customer === "string"
                  ? sub.customer
                  : sub.customer.id,
              stripeSubscriptionId: sub.id,
              stripePriceId: extracted.priceId,
              plan: extracted.plan,
              status: sub.status,
              interval: extracted.interval,
              currency: (sub.currency as CurrencyCode) || "cad",
              unitAmountCents:
                sub.items.data[0]?.price?.unit_amount ?? null,
              currentPeriodStart: sub.current_period_start,
              currentPeriodEnd: sub.current_period_end,
              trialEnd: sub.trial_end,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              canceledAt: sub.canceled_at,
              latestInvoiceId: invoice.id,
              stripeEventId: event.id,
              eventType: event.type,
            });
          }
          return businessId;
        }

        case "customer.subscription.trial_will_end": {
          const sub = event.data.object as Stripe.Subscription;
          const businessId = await resolveBusinessId(deps.store, {
            metadataBusinessId: sub.metadata?.businessId ?? null,
            stripeCustomerId:
              typeof sub.customer === "string"
                ? sub.customer
                : sub.customer.id,
            stripeSubscriptionId: sub.id,
          });
          if (!businessId) return null;
          await deps.store.addSubscriptionEvent({
            id: newId("bsev"),
            businessId,
            stripeEventId: event.id,
            type: event.type,
            payload: {
              trialEnd: sub.trial_end,
              plan: sub.metadata?.plan ?? null,
            },
            createdAt: now().toISOString(),
          });
          await deps.store.addAuditLog({
            id: newId("baudit"),
            businessId,
            actorUserId: null,
            action: "trial_will_end",
            detail: { trialEnd: sub.trial_end },
            createdAt: now().toISOString(),
          });
          return businessId;
        }

        case "entitlements.active_entitlement_summary.updated": {
          // Stripe Entitlements sync hook — TradeCatch still enforces locally.
          return null;
        }

        default:
          return null;
      }
  }

  return {
    async verifyAndParse(
      rawBody: string | Buffer,
      signatureHeader: string | null,
    ): Promise<
      | { ok: true; event: Stripe.Event }
      | { ok: false; error: string; status: number }
    > {
      const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
      if (!secret) {
        return {
          ok: false,
          error: "STRIPE_WEBHOOK_SECRET is not configured.",
          status: 503,
        };
      }
      if (!signatureHeader) {
        return {
          ok: false,
          error: "Missing Stripe-Signature header.",
          status: 400,
        };
      }
      try {
        const event = deps.stripe.constructEvent(
          rawBody,
          signatureHeader,
          secret,
        );
        return { ok: true, event };
      } catch {
        return {
          ok: false,
          error: "Invalid Stripe signature.",
          status: 400,
        };
      }
    },

    async processEvent(event: Stripe.Event): Promise<{
      duplicate: boolean;
      handled: boolean;
      businessId: string | null;
    }> {
      const existing = await deps.store.getWebhookEvent(event.id);
      if (existing && existing.status === "processed") {
        return { duplicate: true, handled: true, businessId: null };
      }

      const receivedAt = now().toISOString();
      try {
        const businessId = await dispatch(event);
        const ignored =
          event.type === "entitlements.active_entitlement_summary.updated";
        await deps.store.saveWebhookEvent({
          stripeEventId: event.id,
          type: event.type,
          status: ignored ? "ignored" : "processed",
          error: null,
          receivedAt,
          processedAt: now().toISOString(),
        });
        return { duplicate: false, handled: true, businessId };
      } catch (err) {
        await deps.store.saveWebhookEvent({
          stripeEventId: event.id,
          type: event.type,
          status: "failed",
          error: err instanceof Error ? err.message : "webhook_failed",
          receivedAt,
          processedAt: now().toISOString(),
        });
        throw err;
      }
    },

    dispatch,
  };
}

export type WebhookHandler = ReturnType<typeof createWebhookHandler>;
