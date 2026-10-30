import { getPgPool } from "@/product/missed-call/postgres-store";
import { getSaasRuntime } from "@/product/saas/runtime";
import { createSaasReferralDirectory } from "./directory";
import { logReferralFailure } from "./log";
import { createPostgresReferralStore } from "./postgres-store";
import { createReferralService, type ReferralService } from "./service";
import { createMemoryReferralStore, type ReferralStore } from "./store";

const globalForReferrals = globalThis as unknown as {
  __tradecatchReferrals?: ReferralService;
  __tradecatchReferralsReady?: Promise<ReferralService>;
};

/**
 * One referral service per process. It follows the SaaS store: durable
 * PostgreSQL when the SaaS store is durable, in-memory otherwise (development
 * and tests; the SaaS store itself refuses memory in production when
 * SAAS_REQUIRE_DURABLE=1).
 *
 * If the referral schema has not been applied yet, Postgres reads fail and we
 * keep the in-memory store so public pages still show the published defaults.
 */
async function buildReferralService(): Promise<ReferralService> {
  const { store, durable } = getSaasRuntime();
  const url = process.env.DATABASE_URL?.trim();
  const pool = durable && url ? getPgPool(url) : undefined;

  let referralStore: ReferralStore = createMemoryReferralStore();
  if (pool) {
    const postgres = createPostgresReferralStore(pool);
    try {
      await postgres.getSettings();
      referralStore = postgres;
    } catch (error) {
      logReferralFailure("postgres store probe", error);
      referralStore = createMemoryReferralStore();
    }
  }

  return createReferralService({
    store: referralStore,
    directory: createSaasReferralDirectory({ store, pool }),
  });
}

export function getReferralService(): ReferralService {
  if (!globalForReferrals.__tradecatchReferrals) {
    // Synchronous path for callers that cannot await: memory first, then the
    // async probe upgrades the singleton once Postgres is confirmed.
    const { store, durable } = getSaasRuntime();
    const url = process.env.DATABASE_URL?.trim();
    const pool = durable && url ? getPgPool(url) : undefined;
    globalForReferrals.__tradecatchReferrals = createReferralService({
      store: createMemoryReferralStore(),
      directory: createSaasReferralDirectory({ store, pool }),
    });
    if (pool && !globalForReferrals.__tradecatchReferralsReady) {
      globalForReferrals.__tradecatchReferralsReady = buildReferralService().then(
        (service) => {
          globalForReferrals.__tradecatchReferrals = service;
          return service;
        },
      );
    }
  }
  return globalForReferrals.__tradecatchReferrals;
}

/** Prefer this on pages that can await — waits for the Postgres probe. */
export async function getReferralServiceReady(): Promise<ReferralService> {
  const sync = getReferralService();
  if (globalForReferrals.__tradecatchReferralsReady) {
    return globalForReferrals.__tradecatchReferralsReady;
  }
  return sync;
}

/** Test helper — reset the process singleton. */
export function resetReferralServiceForTests() {
  delete globalForReferrals.__tradecatchReferrals;
  delete globalForReferrals.__tradecatchReferralsReady;
}
