import Stripe from "stripe";
import {
  assertTestCredentialsSeparation,
  readStripeConfig,
} from "./config";

let cached: Stripe | null | undefined;

export function getStripeClient(
  env: NodeJS.ProcessEnv = process.env,
): Stripe | null {
  if (cached !== undefined) return cached;
  const separation = assertTestCredentialsSeparation(env);
  if (!separation.ok) {
    console.error(`[billing] ${separation.error}`);
    cached = null;
    return null;
  }
  const config = readStripeConfig(env);
  if (!config.secretKey) {
    cached = null;
    return null;
  }
  cached = new Stripe(config.secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
    appInfo: { name: "TradeCatch", version: "0.1.0" },
  });
  return cached;
}

export function resetStripeClientForTests() {
  cached = undefined;
}

export type StripePort = {
  createCustomer(input: {
    email: string;
    name: string;
    metadata: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ id: string }>;
  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    mode: "subscription";
    successUrl: string;
    cancelUrl: string;
    trialPeriodDays?: number;
    metadata: Record<string, string>;
    subscriptionMetadata: Record<string, string>;
    automaticTax: boolean;
    clientReferenceId: string;
    idempotencyKey?: string;
  }): Promise<{ id: string; url: string | null }>;
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
    configuration?: string | null;
  }): Promise<{ url: string }>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  constructEvent(
    payload: string | Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event;
};

export function createLiveStripePort(stripe: Stripe): StripePort {
  return {
    async createCustomer(input) {
      const customer = await stripe.customers.create(
        {
          email: input.email,
          name: input.name,
          metadata: input.metadata,
        },
        input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : undefined,
      );
      return { id: customer.id };
    },
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: input.mode,
          customer: input.customerId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          client_reference_id: input.clientReferenceId,
          metadata: input.metadata,
          subscription_data: {
            metadata: input.subscriptionMetadata,
            ...(input.trialPeriodDays && input.trialPeriodDays > 0
              ? { trial_period_days: input.trialPeriodDays }
              : {}),
          },
          automatic_tax: input.automaticTax
            ? { enabled: true }
            : undefined,
          allow_promotion_codes: true,
          billing_address_collection: "required",
          customer_update: input.automaticTax
            ? { address: "auto", name: "auto" }
            : undefined,
          tax_id_collection: { enabled: true },
        },
        input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : undefined,
      );
      return { id: session.id, url: session.url };
    },
    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
        ...(input.configuration
          ? { configuration: input.configuration }
          : {}),
      });
      return { url: session.url };
    },
    async retrieveSubscription(id) {
      return stripe.subscriptions.retrieve(id, {
        expand: ["default_payment_method", "latest_invoice"],
      });
    },
    constructEvent(payload, signature, secret) {
      return stripe.webhooks.constructEvent(payload, signature, secret);
    },
  };
}

/** In-memory Stripe stub for unit tests (no network, no real charges). */
export function createMemoryStripePort(options?: {
  failCheckout?: boolean;
  declinePayment?: boolean;
}): StripePort & {
  events: Stripe.Event[];
  customers: Map<string, { email: string; name: string }>;
  subscriptions: Map<string, Stripe.Subscription>;
  checkoutSessions: Map<string, { businessId: string; priceId: string }>;
} {
  const customers = new Map<string, { email: string; name: string }>();
  const subscriptions = new Map<string, Stripe.Subscription>();
  const checkoutSessions = new Map<
    string,
    { businessId: string; priceId: string }
  >();
  const events: Stripe.Event[] = [];
  let seq = 1;

  return {
    events,
    customers,
    subscriptions,
    checkoutSessions,
    async createCustomer(input) {
      const id = `cus_test_${seq++}`;
      customers.set(id, { email: input.email, name: input.name });
      return { id };
    },
    async createCheckoutSession(input) {
      if (options?.failCheckout) {
        throw new Error("checkout_failed");
      }
      const id = `cs_test_${seq++}`;
      checkoutSessions.set(id, {
        businessId: input.metadata.businessId,
        priceId: input.priceId,
      });
      return {
        id,
        url: `https://checkout.stripe.test/pay/${id}`,
      };
    },
    async createPortalSession(input) {
      return {
        url: `https://billing.stripe.test/session/${input.customerId}`,
      };
    },
    async retrieveSubscription(id) {
      const sub = subscriptions.get(id);
      if (!sub) throw new Error("subscription_not_found");
      return sub;
    },
    constructEvent(payload, signature, secret) {
      if (signature !== `t=1,v1=${secret}`) {
        throw new Error("Invalid signature");
      }
      const parsed = JSON.parse(String(payload)) as Stripe.Event;
      events.push(parsed);
      return parsed;
    },
  };
}
