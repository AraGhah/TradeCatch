import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import { runAfterResponse } from "@/lib/after-response";
import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isRealProductionRuntime,
} from "@/lib/config";
import { loadClientAccountFromEnv } from "@/product/missed-call/client-config";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import type { ClientAccount } from "@/product/missed-call/types";
import { createLlmBrain } from "./brain-llm";
import {
  logReceptionistDiagnostic,
  receptionistErrorCode,
} from "./diagnostics";
import { createRuleBrain } from "./brain-rules";
import { loadReceptionistConfigsFromEnv } from "./config";
import { createReceptionistEngine, type ReceptionistEngine } from "./engine";
import { createLlmClientFromEnv, type LlmClient } from "./llm";
import { createReceptionistNotifier } from "./notifications";
import { handleReceptionistFailure } from "./outage";
import { createPhoneScheduler } from "./phone-booking";
import { createPostgresReceptionistStore } from "./postgres-store";
import { loadProfileConfigs } from "./profile-loader";
import {
  createMemoryProfileStore,
  createPostgresProfileStore,
  type ProfileStore,
} from "./profile-store";
import { createMemoryReceptionistStore, type ReceptionistStore } from "./store";
import {
  lookupCallerContext,
  syncFinalizedCall,
  type LeadSyncDeps,
} from "./lead-sync";
import type { ReceptionistConfig } from "./types";

/** Tenant profiles are re-read at most this often per server instance. */
export const PROFILE_CACHE_TTL_MS = 30_000;

type RuntimeState = {
  store: ReceptionistStore;
  profileStore: ProfileStore;
  engine: ReceptionistEngine;
  envConfigs: ReceptionistConfig[];
  profileConfigs: ReceptionistConfig[];
  profilesLoadedAt: number;
  profileLoadError?: string;
  refreshing?: Promise<void>;
  llm: LlmClient | null;
  durable: boolean;
};

/**
 * Process-local singleton. Each webhook of a call may land on a different
 * serverless instance, so production requires the Postgres store — same
 * fail-closed rule as Module A.
 */
const globalForReceptionist = globalThis as unknown as {
  __tradecatchReceptionist?: RuntimeState;
  __tradecatchReceptionistReadStore?: ReceptionistStore;
};

function wantsDurable(): { wantDurable: boolean; url?: string } {
  return {
    wantDurable:
      isDurableMissedCallStoreConfigured() ||
      process.env.SAAS_DURABLE_STORE === "1",
    url: process.env.DATABASE_URL?.trim(),
  };
}

function createStores(): {
  store: ReceptionistStore;
  profileStore: ProfileStore;
  durable: boolean;
} {
  const { wantDurable, url } = wantsDurable();
  if (wantDurable && url) {
    return {
      store: createPostgresReceptionistStore(url),
      profileStore: createPostgresProfileStore(url),
      durable: true,
    };
  }
  if (wantDurable && !url) {
    throw new Error("[receptionist] Durable store requires DATABASE_URL");
  }
  if (isRealProductionRuntime() && !isE2eHarness()) {
    throw new Error(
      "[receptionist] Refusing in-memory call sessions in production. Set DATABASE_URL + MISSED_CALL_DURABLE_STORE=1 and run npm run db:schema.",
    );
  }
  return {
    store: createMemoryReceptionistStore(),
    profileStore: createMemoryProfileStore(),
    durable: false,
  };
}

/** Founder-managed configs from env. Zero profiles is valid (tenant profiles only). */
function loadEnvConfigs(): ReceptionistConfig[] {
  const explicit =
    Boolean(process.env.RECEPTIONIST_CONFIG_JSON?.trim()) ||
    process.env.RECEPTIONIST_ENABLED === "1";
  let client: ClientAccount | null = null;
  try {
    client = loadClientAccountFromEnv().client;
  } catch (err) {
    // The env client is only needed for the derived (RECEPTIONIST_ENABLED=1)
    // profile; a multi-tenant deployment legitimately has none.
    if (process.env.RECEPTIONIST_ENABLED === "1") throw err;
  }
  if (!explicit) return [];
  return loadReceptionistConfigsFromEnv(client);
}

/** Real stores behind the lead-sync module (loaded lazily: SaaS/Growth are optional at boot). */
async function leadSyncDeps(store: ReceptionistStore): Promise<LeadSyncDeps> {
  const [{ getSaasStore }, { getGrowthStore }, { getStarterStore }] =
    await Promise.all([
      import("@/product/saas/runtime"),
      import("@/product/growth"),
      import("@/product/starter/runtime"),
    ]);
  const saas = getSaasStore();
  const starter = getStarterStore();
  return {
    findOrganization: (clientAccountId) =>
      saas.findOrganizationByMissedCallClientId(clientAccountId),
    listWebsiteLeads: (organizationId) =>
      starter.listWebsiteLeads(organizationId),
    updateWebsiteLead: (id, organizationId, patch) =>
      starter.updateWebsiteLead(id, organizationId, patch),
    growth: getGrowthStore(),
    listCalls: (clientAccountId) =>
      store.listSessions({ clientAccountId, limit: 500 }),
  };
}

async function reloadProfiles(state: RuntimeState): Promise<void> {
  const startedAt = Date.now();
  try {
    const [{ getSaasStore }, { getMissedCallReadStore }] = await Promise.all([
      import("@/product/saas/runtime"),
      import("@/product/missed-call/runtime"),
    ]);
    const saas = getSaasStore();
    // Read-only: tenant profiles are DB-backed and must not require an
    // env-provisioned missed-call client (production legitimately has none).
    const missedCall = getMissedCallReadStore();
    state.profileConfigs = await loadProfileConfigs({
      profiles: state.profileStore,
      getOrganization: (id) => saas.getOrganization(id),
      getClient: (id) => missedCall.getClient(id),
      onSkip: (organizationId, reason) =>
        logReceptionistDiagnostic({
          event: "profile_skipped",
          organizationId,
          code: reason.startsWith("invalid:") ? "INVALID_PROFILE" : reason,
        }),
    });
    state.profilesLoadedAt = Date.now();
    state.profileLoadError = undefined;
    logReceptionistDiagnostic({
      event: "profiles_loaded",
      profiles: state.envConfigs.length + state.profileConfigs.length,
      enabledProfiles: [...state.envConfigs, ...state.profileConfigs].filter(
        (c) => c.enabled,
      ).length,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    // Keep serving the last good set; retry on the next request.
    state.profileLoadError = receptionistErrorCode(err);
    logReceptionistDiagnostic({
      event: "profile_reload_failed",
      error: err,
      durationMs: Date.now() - startedAt,
    });
  }
}

function bootstrap(): RuntimeState {
  const { store, profileStore, durable } = createStores();
  const envConfigs = loadEnvConfigs();
  const llm = createLlmClientFromEnv();
  const sms = createTwilioSmsPort();

  const state = {
    store,
    profileStore,
    envConfigs,
    profileConfigs: [] as ReceptionistConfig[],
    profilesLoadedAt: 0,
    llm,
    durable,
  } as RuntimeState;

  state.engine = createReceptionistEngine({
    store,
    // Founder env configs first: they win a number both define.
    configs: () => [...state.envConfigs, ...state.profileConfigs],
    brain: llm ? createLlmBrain(llm) : createRuleBrain(),
    llm,
    notifier: createReceptionistNotifier({
      sms,
      sendEmail: sendBusinessNotifyEmail,
    }),

    async onIncompleteCall(input) {
      const { ensureMissedCallReady } =
        await import("@/product/missed-call/runtime");
      const { engine: missedCall } = await ensureMissedCallReady();
      await missedCall.handleCallEvent({
        clientAccountId: input.clientAccountId,
        callerE164: input.callerE164,
        calledAt: input.at,
        answered: false,
        abandoned: false,
        twilioCallSid: input.callSid,
      });
    },

    async lookupContext(input) {
      return lookupCallerContext(await leadSyncDeps(store), input);
    },

    onFailure(failure) {
      void runAfterResponse(() => handleReceptionistFailure(failure));
    },
    // Only used for businesses that turned on phone booking in their profile.
    scheduler: createPhoneScheduler({
      async scheduling() {
        const { getSchedulingService } =
          await import("@/product/scheduling/runtime");
        return getSchedulingService();
      },
      async findOrganizationId(config) {
        if (isRealProductionRuntime() && !isE2eHarness() && !durable)
          return null;
        const { getSaasStore } = await import("@/product/saas/runtime");
        const org = await getSaasStore().findOrganizationByMissedCallClientId(
          config.clientAccountId,
        );
        return org && org.status === "active" ? org.id : null;
      },
    }),

    async onFinalized(session, config) {
      await syncFinalizedCall(await leadSyncDeps(store), config, session);
      try {
        const { syncAiCallToCrm } = await import("@/product/crm/bridge");
        await syncAiCallToCrm(session, config.clientAccountId);
      } catch (err) {
        console.warn("[crm] ai call sync skipped", err);
      }
    },
  });

  if (envConfigs.length > 0) {
    console.info("[receptionist] ready", {
      profiles: envConfigs.map((c) => c.id),
      brain: llm ? `${llm.provider}:${llm.model}` : "rules",
      durable,
    });
  }
  return state;
}

function state(): RuntimeState {
  if (!globalForReceptionist.__tradecatchReceptionist) {
    globalForReceptionist.__tradecatchReceptionist = bootstrap();
  }
  return globalForReceptionist.__tradecatchReceptionist;
}

/** Archive reads do not initialize the voice engine, profiles, or providers. */
export function getReceptionistReadStore(): ReceptionistStore {
  if (globalForReceptionist.__tradecatchReceptionist)
    return globalForReceptionist.__tradecatchReceptionist.store;
  return (globalForReceptionist.__tradecatchReceptionistReadStore ??=
    createStores().store);
}

export function getReceptionistRuntime() {
  const s = state();
  return {
    store: s.store,
    profileStore: s.profileStore,
    engine: s.engine,
    llm: s.llm,
    durable: s.durable,
    get profileLoadError(): string | undefined {
      return s.profileLoadError;
    },
    /** Founder env configs + activated tenant profiles (as of the last refresh). */
    get configs(): ReceptionistConfig[] {
      return [...s.envConfigs, ...s.profileConfigs];
    },
    /**
     * Re-read tenant profiles (cached for PROFILE_CACHE_TTL_MS per instance).
     * Call before handling a webhook; `force` after a settings / activation change.
     *
     * Each Worker invocation gets its own isolated I/O context, but all
     * invocations in the same isolate share this module's `globalThis`
     * state — including `s`. A Promise created by one invocation's I/O
     * (the Postgres reads inside reloadProfiles) is tied to that
     * invocation's context; Cloudflare Workers forbids a *different*
     * invocation from awaiting it, and the failure mode is not a thrown
     * error but the awaiting invocation hanging forever once the
     * originating context is gone — exactly the reported symptom. A
     * passive, TTL-driven refresh must therefore never attach to another
     * invocation's in-flight reload. If one is already running, this
     * invocation serves the last good profile set (the design already
     * tolerates up to PROFILE_CACHE_TTL_MS of staleness) instead of
     * waiting on it; a `force` refresh always runs — and awaits — its
     * own independent reload, since only the invocation that creates a
     * Promise may safely await it.
     */
    async refresh(force = false): Promise<void> {
      if (!force && Date.now() - s.profilesLoadedAt < PROFILE_CACHE_TTL_MS)
        return;
      if (!force && s.refreshing) {
        logReceptionistDiagnostic({ event: "refresh_skipped_in_flight" });
        return;
      }
      const run = reloadProfiles(s);
      if (!force) s.refreshing = run;
      try {
        await run;
      } finally {
        if (s.refreshing === run) s.refreshing = undefined;
      }
    },
  };
}

export function resetReceptionistRuntimeForTests() {
  delete globalForReceptionist.__tradecatchReceptionist;
}

/** Readiness snapshot for /api/health (ops view) — no PII. */
export function receptionistReadiness(): {
  profiles: number;
  brain: string;
  durable: boolean;
  error?: string;
} {
  try {
    const rt = getReceptionistRuntime();
    return {
      profiles: rt.configs.length,
      brain: rt.llm ? `${rt.llm.provider}:${rt.llm.model}` : "rules",
      durable: rt.durable,
      ...(rt.profileLoadError
        ? { error: `PROFILE_RELOAD_FAILED:${rt.profileLoadError}` }
        : {}),
    };
  } catch (err) {
    return {
      profiles: 0,
      brain: "unavailable",
      durable: false,
      error: receptionistErrorCode(err),
    };
  }
}
