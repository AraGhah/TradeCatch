import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isRealProductionRuntime,
} from "@/lib/config";
import {
  createMemoryCallEventStore,
  createPostgresCallEventStore,
  type CallEventStore,
} from "./call-events";

type State = { events: CallEventStore; durable: boolean };

const globalForTelephony = globalThis as unknown as {
  __tradecatchTelephony?: State;
};

function createState(): State {
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  const url = process.env.DATABASE_URL?.trim();
  if (wantDurable && url) {
    return { events: createPostgresCallEventStore(url), durable: true };
  }
  if (wantDurable && !url) {
    throw new Error("[telephony] Durable store requires DATABASE_URL");
  }
  if (isRealProductionRuntime() && !isE2eHarness()) {
    throw new Error(
      "[telephony] Refusing in-memory call events in production.",
    );
  }
  return { events: createMemoryCallEventStore(), durable: false };
}

export function getTelephonyRuntime(): State {
  if (!globalForTelephony.__tradecatchTelephony) {
    globalForTelephony.__tradecatchTelephony = createState();
  }
  return globalForTelephony.__tradecatchTelephony;
}
