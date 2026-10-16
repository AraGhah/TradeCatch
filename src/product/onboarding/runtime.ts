import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { createMemoryOnboardingStore } from "./memory-store";
import { createPostgresOnboardingStore } from "./postgres-store";
import { createOnboardingService } from "./onboardingService";
import type { OnboardingStore } from "./store";

const globalForOnboarding = globalThis as unknown as {
  __tradecatchOnboarding?: { store: OnboardingStore };
};

function createStore(): OnboardingStore {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  if (wantDurable && url) return createPostgresOnboardingStore(url);
  if (wantDurable && !url) {
    throw new Error("[onboarding] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[onboarding] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
    );
  }
  return createMemoryOnboardingStore();
}

export function getOnboardingStore(): OnboardingStore {
  if (!globalForOnboarding.__tradecatchOnboarding) {
    globalForOnboarding.__tradecatchOnboarding = { store: createStore() };
  }
  return globalForOnboarding.__tradecatchOnboarding.store;
}

export function resetOnboardingRuntimeForTests() {
  delete globalForOnboarding.__tradecatchOnboarding;
}

export function setOnboardingRuntimeForTests(store: OnboardingStore) {
  globalForOnboarding.__tradecatchOnboarding = { store };
}

export function getOnboardingService() {
  return createOnboardingService({ store: getOnboardingStore() });
}
