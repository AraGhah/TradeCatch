import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { createMemorySaasStore } from "./memory-store";
import { createPostgresSaasStore } from "./postgres-store";
import type { SaasStore } from "./store";

const globalForSaas = globalThis as unknown as {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
};

function createStore(): { store: SaasStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";

  if (wantDurable && url) {
    return { store: createPostgresSaasStore(url), durable: true };
  }

  if (wantDurable && !url) {
    throw new Error(
      "[saas] Durable SaaS store requires DATABASE_URL (and MISSED_CALL_DURABLE_STORE=1 or SAAS_DURABLE_STORE=1)",
    );
  }

  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[saas] Refusing in-memory SaaS store when SAAS_REQUIRE_DURABLE=1",
    );
  }

  return { store: createMemorySaasStore(), durable: false };
}

export function getSaasRuntime() {
  if (!globalForSaas.__tradecatchSaas) {
    globalForSaas.__tradecatchSaas = createStore();
  }
  return globalForSaas.__tradecatchSaas;
}

export function getSaasStore(): SaasStore {
  return getSaasRuntime().store;
}

/** Test helper — reset process singleton. */
export function resetSaasRuntimeForTests() {
  delete globalForSaas.__tradecatchSaas;
}
