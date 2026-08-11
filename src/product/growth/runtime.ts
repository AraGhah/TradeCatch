import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { createMemoryGrowthStore, type GrowthStore } from "./memory-store";

const globalForGrowth = globalThis as unknown as {
  __tradecatchGrowth?: { store: GrowthStore; durable: boolean };
};

function createStore(): { store: GrowthStore; durable: boolean } {
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  // Durable Postgres adapter ships with schema; memory used until wired
  // for full pg parity. Settings/timeline still work in-memory for pilots
  // without DATABASE_URL.
  if (wantDurable && !process.env.DATABASE_URL?.trim()) {
    throw new Error("[growth] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    // Prefer memory only when not forcing durable; schema is applied for when
    // postgres-store lands. For now memory is acceptable in non-forced prod
    // pilot VMs that share process.
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
