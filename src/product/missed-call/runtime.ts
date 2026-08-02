import { loadClientAccountFromEnv } from "./client-config";
import { createMissedCallEngine, type MissedCallEngine } from "./engine";
import { createMemoryStore, type MissedCallStore } from "./store";
import { createPostgresStore } from "./postgres-store";
import { createTwilioSmsPort } from "./twilio";
import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isProductionRuntime,
} from "@/lib/config";

/**
 * Process-local singleton for Module A.
 * Uses Postgres when MISSED_CALL_DURABLE_STORE=1 and DATABASE_URL are set.
 * Production (non-E2E) refuses memory fallback — webhooks must fail closed.
 */
const globalForMissedCall = globalThis as unknown as {
  __tradecatchMissedCall?: {
    store: MissedCallStore;
    engine: MissedCallEngine;
    ready: Promise<void>;
    durable: boolean;
  };
};

function createStore(): { store: MissedCallStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable = isDurableMissedCallStoreConfigured();

  if (wantDurable && url) {
    console.info("[missed-call] Using Postgres MissedCallStore");
    return { store: createPostgresStore(url), durable: true };
  }

  if (wantDurable && !url) {
    throw new Error(
      "[missed-call] MISSED_CALL_DURABLE_STORE=1 requires DATABASE_URL",
    );
  }

  if (isProductionRuntime() && !isE2eHarness()) {
    throw new Error(
      "[missed-call] Refusing in-memory store in production. Set DATABASE_URL + MISSED_CALL_DURABLE_STORE=1 and apply schema.sql before accepting traffic.",
    );
  }

  return { store: createMemoryStore(), durable: false };
}

function bootstrap() {
  const { store, durable } = createStore();
  const { client, source } = loadClientAccountFromEnv();
  if (source === "demo") {
    console.warn(
      "[missed-call] Loaded demo client fixture — set MISSED_CALL_* env vars for real routing.",
    );
  }

  const ready = store.saveClient(client);
  const engine = createMissedCallEngine({
    store,
    sms: createTwilioSmsPort(),
  });

  return { store, engine, ready, durable };
}

export function getMissedCallRuntime() {
  if (!globalForMissedCall.__tradecatchMissedCall) {
    globalForMissedCall.__tradecatchMissedCall = bootstrap();
  }
  return globalForMissedCall.__tradecatchMissedCall;
}

export async function ensureMissedCallReady() {
  const runtime = getMissedCallRuntime();
  await runtime.ready;
  return runtime;
}

export function isRuntimeUsingDurableStore(): boolean {
  return getMissedCallRuntime().durable;
}
