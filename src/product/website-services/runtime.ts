import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { createPostgresWebsiteRequestStore } from "./postgres-store";
import {
  createWebsiteRequestService,
  type WebsiteRequestService,
} from "./service";
import { createMemoryWebsiteRequestStore } from "./store";

const globalForWebsiteServices = globalThis as unknown as {
  __tradecatchWebsiteServices?: WebsiteRequestService;
};

/**
 * One service per process. Durable PostgreSQL wherever the other product
 * stores are durable; in-memory only in development and tests.
 */
function create(): WebsiteRequestService {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";

  if (wantDurable && url) {
    return createWebsiteRequestService(createPostgresWebsiteRequestStore(url));
  }
  if (wantDurable && !url) {
    throw new Error("[website-services] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[website-services] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
    );
  }
  return createWebsiteRequestService(createMemoryWebsiteRequestStore());
}

export function getWebsiteRequestService(): WebsiteRequestService {
  if (!globalForWebsiteServices.__tradecatchWebsiteServices) {
    globalForWebsiteServices.__tradecatchWebsiteServices = create();
  }
  return globalForWebsiteServices.__tradecatchWebsiteServices;
}

export function resetWebsiteRequestServiceForTests() {
  delete globalForWebsiteServices.__tradecatchWebsiteServices;
}
