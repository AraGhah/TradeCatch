import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { createBillingService } from "./billingService";
import { createMemoryBillingStore } from "./memory-store";
import { createPostgresBillingStore } from "./postgres-store";
import { createSubscriptionService } from "./subscriptionService";
import { createUsageService } from "./usageService";
import { createWebhookHandler } from "./stripe/webhookHandler";
import {
  createLiveStripePort,
  createMemoryStripePort,
  getStripeClient,
  resetStripeClientForTests,
  type StripePort,
} from "./stripe/stripeClient";
import type { BillingStore } from "./store";

const globalForBilling = globalThis as unknown as {
  __tradecatchBilling?: {
    store: BillingStore;
    stripe: StripePort | null;
  };
};

function createStore(): BillingStore {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  if (wantDurable && url) return createPostgresBillingStore(url);
  if (wantDurable && !url) {
    throw new Error("[billing] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[billing] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
    );
  }
  return createMemoryBillingStore();
}

function createStripe(): StripePort | null {
  if (process.env.BILLING_USE_MEMORY_STRIPE === "1") {
    return createMemoryStripePort();
  }
  const client = getStripeClient();
  if (!client) return null;
  return createLiveStripePort(client);
}

export function getBillingStore(): BillingStore {
  if (!globalForBilling.__tradecatchBilling) {
    globalForBilling.__tradecatchBilling = {
      store: createStore(),
      stripe: createStripe(),
    };
  }
  return globalForBilling.__tradecatchBilling.store;
}

export function getBillingStripe(): StripePort | null {
  if (!globalForBilling.__tradecatchBilling) {
    getBillingStore();
  }
  return globalForBilling.__tradecatchBilling!.stripe;
}

export function resetBillingRuntimeForTests() {
  delete globalForBilling.__tradecatchBilling;
  resetStripeClientForTests();
}

/** Test helper — inject memory Stripe + store. */
export function setBillingRuntimeForTests(input: {
  store?: BillingStore;
  stripe?: StripePort | null;
}) {
  globalForBilling.__tradecatchBilling = {
    store: input.store ?? createMemoryBillingStore(),
    stripe: input.stripe === undefined ? createMemoryStripePort() : input.stripe,
  };
}

export function getSubscriptionService() {
  return createSubscriptionService({ store: getBillingStore() });
}

export function getUsageService() {
  return createUsageService({ store: getBillingStore() });
}

export function getBillingService() {
  return createBillingService({
    store: getBillingStore(),
    subscriptions: getSubscriptionService(),
    usage: getUsageService(),
    stripe: getBillingStripe(),
  });
}

export function getWebhookHandler() {
  const stripe = getBillingStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  return createWebhookHandler({
    store: getBillingStore(),
    subscriptions: getSubscriptionService(),
    stripe,
  });
}
