import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { createMemoryGrowthStore, type GrowthStore } from "./memory-store";
import { createPostgresGrowthStore } from "./postgres-store";

const globalForGrowth = globalThis as unknown as {
  __tradecatchGrowth?: { store: GrowthStore; durable: boolean };
};

function createStore(): { store: GrowthStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";

  if (wantDurable && url) {
    console.info("[growth] Using Postgres GrowthStore");
    return { store: createPostgresGrowthStore(url), durable: true };
  }
  if (wantDurable && !url) {
    throw new Error("[growth] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[growth] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
    );
  }
  return { store: createMemoryGrowthStore(), durable: false };
}

export function getGrowthRuntime() {
  if (!globalForGrowth.__tradecatchGrowth) {
    globalForGrowth.__tradecatchGrowth = createStore();
  }
  return globalForGrowth.__tradecatchGrowth;
}

export function getGrowthStore(): GrowthStore {
  return getGrowthRuntime().store;
}

export function resetGrowthRuntimeForTests() {
  delete globalForGrowth.__tradecatchGrowth;
}
