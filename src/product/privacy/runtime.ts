import { getPgPool } from "@/lib/postgres-pool";
import { getSecurityService } from "@/product/security/runtime";
import { securityId } from "@/product/security/store";
import type { PrivacyPatch, PrivacySettings } from "./settings";
import {
  createMemoryPrivacyStore,
  createPostgresPrivacyStore,
  type PrivacySettingsStore,
  type PrivacyUpdateResult,
} from "./store";

const globalForPrivacy = globalThis as unknown as {
  __tradecatchPrivacy?: PrivacySettingsStore;
};

/**
 * Same durability rules as the SaaS store (`saas/runtime.ts`), so privacy
 * choices are durable exactly when accounts are:
 * - durable requested + DATABASE_URL → Postgres;
 * - durable requested, no DATABASE_URL → refuse, never fall back to memory
 *   (a memory store lives per Worker isolate, so a "saved" setting would
 *   vanish on the next request that lands elsewhere);
 * - `SAAS_REQUIRE_DURABLE=1` in production → refuse memory;
 * - otherwise (local development and tests) → memory.
 * A refusal throws, so the API answers 503 instead of claiming a save.
 */
export function selectPrivacyStoreKind(
  env: Record<string, string | undefined> = process.env,
): "postgres" | "memory" {
  const wantDurable =
    env.MISSED_CALL_DURABLE_STORE === "1" || env.SAAS_DURABLE_STORE === "1";
  const hasUrl = Boolean(env.DATABASE_URL?.trim());
  if (wantDurable && hasUrl) return "postgres";
  if (wantDurable) {
    throw new Error(
      "[privacy] Durable store requires DATABASE_URL (MISSED_CALL_DURABLE_STORE=1 or SAAS_DURABLE_STORE=1 is set)",
    );
  }
  if (env.NODE_ENV === "production" && env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[privacy] Refusing in-memory privacy store when SAAS_REQUIRE_DURABLE=1",
    );
  }
  return "memory";
}

export function getPrivacyStore(): PrivacySettingsStore {
  if (!globalForPrivacy.__tradecatchPrivacy) {
    globalForPrivacy.__tradecatchPrivacy =
      selectPrivacyStoreKind() === "postgres"
        ? createPostgresPrivacyStore(
            getPgPool(String(process.env.DATABASE_URL).trim()),
          )
        : createMemoryPrivacyStore(async (row) => {
            await getSecurityService().audit({
              organizationId: row.organizationId,
              actorUserId: row.actorUserId,
              action: row.action,
              target: "privacy_settings",
              detail: row.detail,
            });
          });
  }
  return globalForPrivacy.__tradecatchPrivacy;
}

export function setPrivacyStoreForTests(store: PrivacySettingsStore | undefined) {
  if (store) globalForPrivacy.__tradecatchPrivacy = store;
  else delete globalForPrivacy.__tradecatchPrivacy;
}

export async function loadPrivacySettings(organizationId: string): Promise<PrivacySettings> {
  return getPrivacyStore().get(organizationId);
}

export async function savePrivacySettings(input: {
  organizationId: string;
  actorUserId: string;
  expectedVersion: number;
  patch: PrivacyPatch;
}): Promise<PrivacyUpdateResult> {
  return getPrivacyStore().update({
    ...input,
    at: new Date().toISOString(),
    auditId: securityId("aud"),
  });
}
