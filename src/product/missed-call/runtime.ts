import { loadClientAccountFromEnv } from "./client-config";
import { createMissedCallEngine, type MissedCallEngine } from "./engine";
import { createMemoryStore, type MissedCallStore } from "./store";
import { createTwilioSmsPort } from "./twilio";

/**
 * Process-local singleton for Module A.
 * Replace createMemoryStore with a durable DB adapter before multi-instance production.
 */
const globalForMissedCall = globalThis as unknown as {
  __tradecatchMissedCall?: {
    store: MissedCallStore;
    engine: MissedCallEngine;
    ready: Promise<void>;
  };
};

function bootstrap() {
  const store = createMemoryStore();
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[missed-call] Using in-memory store — NOT production-safe for multi-instance. Set DATABASE_URL and wire a durable MissedCallStore before go-live. See docs/CAPABILITY_MATRIX.md.",
    );
  }

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

  return { store, engine, ready };
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
