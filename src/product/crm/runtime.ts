import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isRealProductionRuntime,
} from "@/lib/config";
import { createMemoryCrmStore } from "./memory-store";
import { createPostgresCrmStore } from "./postgres-store";
import { createCrmService, type CrmService } from "./service";

export { CrmError } from "./service";
import type { CrmStore } from "./store";

type State = { store: CrmStore; service: CrmService; durable: boolean };

const globalForCrm = globalThis as unknown as {
  __tradecatchCrm?: State;
};

function createState(): State {
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  const url = process.env.DATABASE_URL?.trim();
  let store: CrmStore;
  let durable = false;
  if (wantDurable && url) {
    store = createPostgresCrmStore(url);
    durable = true;
  } else if (wantDurable && !url) {
    throw new Error("[crm] Durable store requires DATABASE_URL");
  } else if (isRealProductionRuntime() && !isE2eHarness()) {
    throw new Error("[crm] Refusing in-memory CRM in production.");
  } else {
    store = createMemoryCrmStore();
  }
  return { store, service: createCrmService(store), durable };
}

export function getCrmRuntime(): State {
  if (!globalForCrm.__tradecatchCrm) {
    globalForCrm.__tradecatchCrm = createState();
  }
  return globalForCrm.__tradecatchCrm;
}

export function getCrmService(): CrmService {
  return getCrmRuntime().service;
}
