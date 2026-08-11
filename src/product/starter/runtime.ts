import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { createMemoryStarterStore, type StarterStore } from "./memory-store";
import { createPostgresStarterStore } from "./postgres-store";

const globalForStarter = globalThis as unknown as {
  __tradecatchStarter?: { store: StarterStore; durable: boolean };
};

function createStore(): { store: StarterStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";

  if (wantDurable && url) {
    return { store: createPostgresStarterStore(url), durable: true };
  }
  if (wantDurable && !url) {
    throw new Error("[starter] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error("[starter] Refusing memory store when SAAS_REQUIRE_DURABLE=1");
  }
  return { store: createMemoryStarterStore(), durable: false };
}

export function getStarterRuntime() {
  if (!globalForStarter.__tradecatchStarter) {
    globalForStarter.__tradecatchStarter = createStore();
  }
  return globalForStarter.__tradecatchStarter;
}

export function getStarterStore(): StarterStore {
  return getStarterRuntime().store;
}

export function resetStarterRuntimeForTests() {
  delete globalForStarter.__tradecatchStarter;
}
