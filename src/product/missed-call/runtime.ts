import { loadClientAccountFromEnvOrSkip } from "./client-config";
import { createMissedCallEngine, type MissedCallEngine } from "./engine";
import { createMemoryStore, type MissedCallStore } from "./store";
import { createPostgresStore } from "./postgres-store";
import { createTwilioSmsPort } from "./twilio";
import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isRealProductionRuntime,
} from "@/lib/config";

/**
 * Process-local singleton for Module A.
 * Uses Postgres when MISSED_CALL_DURABLE_STORE=1 and DATABASE_URL are set.
 * Production (non-E2E) refuses memory fallback — webhooks must fail closed.
 */
const globalForMissedCall = globalThis as unknown as {
  __tradecatchMissedCallReadStore?: MissedCallStore;
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

  if (isRealProductionRuntime() && !isE2eHarness()) {
    throw new Error(
      "[missed-call] Refusing in-memory store in production. Set DATABASE_URL + MISSED_CALL_DURABLE_STORE=1 and run npm run db:schema before accepting traffic.",
    );
  }

  return { store: createMemoryStore(), durable: false };
}

function bootstrap() {
  const { store, durable } = createStore();
  const seeded = loadClientAccountFromEnvOrSkip();

  let ready: Promise<void>;
  if (!seeded) {
    // Multi-tenant deployment: no single legacy MISSED_CALL_* client is
    // configured, and none is required — every organization's inbound SMS
    // is routed to its own client record via
    // MissedCallStore.findClientBySmsFromNumber, keyed by the Twilio number
    // it was provisioned with. Nothing to seed here.
    console.info(
      "[missed-call] No legacy MISSED_CALL_* client configured — routing relies entirely on per-organization client records.",
    );
    ready = Promise.resolve();
  } else {
    if (seeded.source === "demo") {
      console.warn(
        "[missed-call] Loaded demo client fixture — set MISSED_CALL_* env vars for real routing.",
      );
    }
    ready = store.saveClient(seeded.client);
  }

  const engine = createMissedCallEngine({
    store,
    sms: createTwilioSmsPort(),
  });

  return { store, engine, ready, durable };
}

/** Read access must not seed the env client or initialize an SMS engine. */
export function getMissedCallReadStore(): MissedCallStore {
  if (globalForMissedCall.__tradecatchMissedCall)
    return globalForMissedCall.__tradecatchMissedCall.store;
  return (globalForMissedCall.__tradecatchMissedCallReadStore ??=
    createStore().store);
}

/** Timer/retry work uses each workflow's persisted client. It must not create or
 * overwrite an environment client merely because a cron event ran. Missing
 * provider credentials still fail real sends through the production SMS port. */
export function getMissedCallMaintenanceRuntime() {
  const store = getMissedCallReadStore();
  return {
    store,
    engine: createMissedCallEngine({ store, sms: createTwilioSmsPort() }),
  };
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
