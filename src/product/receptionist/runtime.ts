import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import { runAfterResponse } from "@/lib/after-response";
import { databaseFailureCode } from "@/lib/postgres-pool";
import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isRealProductionRuntime,
} from "@/lib/config";
import { loadClientAccountFromEnv } from "@/product/missed-call/client-config";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import type { ClientAccount, SmsPort } from "@/product/missed-call/types";
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
import { inactiveLineNotice, type InactiveNoticeLine, type InactiveReason } from "./inactive-line";
import { handleReceptionistFailure } from "./outage";
import { createAgentCallService, type AgentCallService } from "./agent-calls";
import {
  createAgentAppointmentService,
  type AgentAppointmentService,
  type CallerTextPort,
} from "./agent-appointments";
import { createPhoneScheduler } from "./phone-booking";
import { createPostgresReceptionistStore } from "./postgres-store";
import { getPrivacyStore } from "@/product/privacy/runtime";
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
  agentCalls: AgentCallService;
  /** The same call service for the Bland agent: `bl_` sessions, its own idempotency keys. */
  blandCalls: AgentCallService;
  agentAppointments: AgentAppointmentService;
  envConfigs: ReceptionistConfig[];
  profileConfigs: ReceptionistConfig[];
  profilesLoadedAt: number;
  /** organizationId -> updatedAt of each profile in the last load (staleness check). */
  profileVersions?: Map<string, string>;
  profileLoadError?: string;
  /** Founder env configs were refused by production validation (see loadEnvConfigs). */
  envConfigError?: string;
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

/** Error code recorded when the founder env configs fail production validation. */
export const ENV_CONFIG_INVALID_CODE = "RECEPTIONIST_ENV_CONFIG_INVALID";

type EnvConfigLoad = {
  configs: ReceptionistConfig[];
  /** Set when the founder env configs were refused; the validation messages, no values. */
  rejected?: string;
};

/**
 * What production validation said, for ops: the messages name fields and
 * technician ids, never values; any phone-like digit run is masked anyway.
 */
function rejectionDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : "unknown error";
  return message
    .replace(/^\[[a-z-]+\]\s*/i, "")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .slice(0, 500);
}

/**
 * Founder-managed configs from env. Zero profiles is valid (tenant profiles only).
 *
 * A founder config that fails production validation (demo client id, reserved
 * 555 numbers, no human fallback...) is refused, never used: it does not
 * answer a single call. It also must not take the whole runtime down with it,
 * because tenant profiles and the Bland/LiveKit agent tools share this runtime;
 * on 2026-10-25 a demo `.env.local` bundled into the Worker did exactly that.
 * The refusal is reported as a critical incident instead (see bootstrap).
 */
function loadEnvConfigs(): EnvConfigLoad {
  const explicit =
    Boolean(process.env.RECEPTIONIST_CONFIG_JSON?.trim()) ||
    process.env.RECEPTIONIST_ENABLED === "1";
  let client: ClientAccount | null = null;
  try {
    client = loadClientAccountFromEnv().client;
  } catch (err) {
    // The env client is only needed for the derived (RECEPTIONIST_ENABLED=1)
    // profile; a multi-tenant deployment legitimately has none.
    if (process.env.RECEPTIONIST_ENABLED === "1")
      return { configs: [], rejected: rejectionDetail(err) };
  }
  if (!explicit) return { configs: [] };
  try {
    return { configs: loadReceptionistConfigsFromEnv(client) };
  } catch (err) {
    return { configs: [], rejected: rejectionDetail(err) };
  }
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
    const versions = new Map<string, string>();
    const store = state.profileStore;
    state.profileConfigs = await loadProfileConfigs({
      // Same store; the load also notes which version of each profile it used.
      profiles: {
        ...store,
        async listActivatedProfiles() {
          const list = await store.listActivatedProfiles();
          for (const p of list) versions.set(p.organizationId, p.updatedAt);
          return list;
        },
      },
      getOrganization: (id) => saas.getOrganization(id),
      getClient: (id) => missedCall.getClient(id),
      getPrivacy: (ids) => getPrivacyStore().getMany(ids),
      onPrivacyError: (error) =>
        console.error(
          "[receptionist] privacy settings unavailable; recording and transcripts off for this reload",
          // pg names every server error "error", so the name said nothing. The
          // code does (42P01 = tc_privacy_settings missing: migration 040 not
          // applied); never the driver message, which can quote values.
          databaseFailureCode(error),
        ),
      onSkip: (organizationId, reason) =>
        logReceptionistDiagnostic({
          event: "profile_skipped",
          organizationId,
          code: reason.startsWith("invalid:") ? "INVALID_PROFILE" : reason,
        }),
    });
    state.profilesLoadedAt = Date.now();
    state.profileVersions = versions;
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

/**
 * Texts the agent sends a caller on request: through the same durable outbox as
 * every other SMS (the minute cron retries failures), from the business's own
 * SMS number, and never to a number that opted out (STOP) of either system.
 */
function callerTextPort(
  sms: SmsPort,
  findOrganizationId: (config: ReceptionistConfig) => Promise<string | null>,
): CallerTextPort {
  const missedCall = async () =>
    (await (await import("@/product/missed-call/runtime")).ensureMissedCallReady())
      .store;
  return {
    async sender(config) {
      return config.smsFromE164 ? { fromE164: config.smsFromE164 } : null;
    },
    async isSuppressed(config, phoneE164) {
      const store = await missedCall();
      if (
        await store.isSmsSuppressed(config.clientAccountId, phoneE164, {
          asCustomer: true,
        })
      )
        return true;
      const organizationId = await findOrganizationId(config);
      if (!organizationId) return false;
      const { getAutomationStore } = await import("@/product/sms-automation/runtime");
      return getAutomationStore().isSuppressed(organizationId, phoneE164);
    },
    enqueue: async (message) => (await missedCall()).enqueueOutbound(message),
    claim: async (id) => (await missedCall()).claimOutboundById(id),
    send: (message) => sms.send(message),
    markSent: async (id, sid) => (await missedCall()).markOutboundSent(id, sid),
    async markFailed(id, error, cause) {
      const { smsFailureDisposition } = await import("@/product/missed-call/twilio");
      await (await missedCall()).markOutboundFailed(id, error, smsFailureDisposition(cause));
    },
  };
}

/**
 * Authoritative "is this tenant line still switched on?", read from the
 * database every time (never the ~30 s profile cache). Founder env configs are
 * not switched from the dashboard and stay as loaded. A database error keeps
 * the last good answer: one slow query must not drop a customer's call.
 */
async function lineState(
  profileStore: ProfileStore,
  versions: Map<string, string> | undefined,
  config: ReceptionistConfig,
): Promise<{ active: boolean; stale: boolean }> {
  if (config.source !== "profile") return { active: true, stale: false };
  const organizationId = config.id.replace(/^rc_org_/, "");
  try {
    const profile = await profileStore.getProfile(organizationId);
    return {
      active: Boolean(
        profile?.activated && profile.settings.callHandlingMode !== "disabled",
      ),
      // Saved since this instance loaded it: the owner's change must be live
      // on this very call, not up to PROFILE_CACHE_TTL_MS later.
      stale: Boolean(
        profile && versions?.get(organizationId) !== profile.updatedAt,
      ),
    };
  } catch (err) {
    logReceptionistDiagnostic({ event: "activation_check_failed", error: err });
    return { active: true, stale: false };
  }
}

/** A line whose owner switched the receptionist off: what to tell the caller. */
async function describeInactiveLine(
  profileStore: ProfileStore,
  numberE164: string,
): Promise<{ reason: InactiveReason; notice: InactiveNoticeLine[] } | null> {
  const profile = await profileStore.findProfileByNumber(numberE164);
  if (!profile) return null;
  const mode = profile.settings.callHandlingMode;
  if (profile.activated && mode !== "disabled") return null;
  return {
    reason: profile.activated ? "disabled" : "deactivated",
    notice: inactiveLineNotice({
      businessName: profile.settings.knowledge?.companyName ?? "",
      languages: profile.settings.languages,
      defaultLanguage: profile.settings.defaultLanguage,
    }),
  };
}

function bootstrap(): RuntimeState {
  const { store, profileStore, durable } = createStores();
  const { configs: envConfigs, rejected } = loadEnvConfigs();
  if (rejected) {
    logReceptionistDiagnostic({
      event: "env_config_rejected",
      code: ENV_CONFIG_INVALID_CODE,
    });
    // Once per instance; the incident engine folds repeats into one incident.
    void runAfterResponse(async () => {
      const { recordFailure } = await import("@/product/reliability/hooks");
      await recordFailure({
        service: "ai_receptionist",
        operation: "env_config",
        errorCode: ENV_CONFIG_INVALID_CODE,
        severity: "critical",
        retryable: false,
        detail: rejected,
      });
    });
  }
  const llm = createLlmClientFromEnv();
  const sms = createTwilioSmsPort();
  // Scheduling for businesses that turned on phone booking in their profile.
  const scheduling = {
    async scheduling() {
      const { getSchedulingService } =
        await import("@/product/scheduling/runtime");
      return getSchedulingService();
    },
    async findOrganizationId(config: ReceptionistConfig) {
      if (isRealProductionRuntime() && !isE2eHarness() && !durable)
        return null;
      const { getSaasStore } = await import("@/product/saas/runtime");
      const org = await getSaasStore().findOrganizationByMissedCallClientId(
        config.clientAccountId,
      );
      return org && org.status === "active" ? org.id : null;
    },
  };

  const state = {
    store,
    profileStore,
    envConfigs,
    envConfigError: rejected,
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
    confirmActive: async (config) =>
      (await lineState(profileStore, state.profileVersions, config)).active,
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
    scheduler: createPhoneScheduler(scheduling),

    async onFinalized(session, config) {
      // Meter the call's minutes against the business's monthly allowance.
      // Finalization is claimed once per call, so this never double-counts.
      void import("@/product/saas/usage-metering")
        .then((m) =>
          m.recordVoiceUsageForClient(
            config.clientAccountId,
            session.durationSeconds,
          ),
        )
        .catch(() => undefined);
      await syncFinalizedCall(await leadSyncDeps(store), config, session);
      try {
        const { syncAiCallToCrm } = await import("@/product/crm/bridge");
        await syncAiCallToCrm(session, config.clientAccountId);
      } catch (err) {
        console.warn("[crm] ai call sync skipped", err);
      }
    },
  });

  state.agentAppointments = createAgentAppointmentService({
    ...scheduling,
    texts: callerTextPort(sms, scheduling.findOrganizationId),
  });

  state.agentCalls = createAgentCallService({
    store,
    scheduler: state.engine.scheduler,
    finalize: state.engine.finalizeSession,
  });
  state.blandCalls = createAgentCallService({
    store,
    scheduler: state.engine.scheduler,
    finalize: state.engine.finalizeSession,
    channel: "bland",
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
    /** Server side of the LiveKit agent's tools: availability, booking and the call report. */
    agentCalls: s.agentCalls,
    /** Server side of the Bland agent's tools (see src/product/bland). */
    blandCalls: s.blandCalls,
    /** Existing appointments (find, move, cancel) and texts to the caller. */
    agentAppointments: s.agentAppointments,
    llm: s.llm,
    durable: s.durable,
    /** Uncached check that a tenant line is still switched on (see confirmLineActive). */
    confirmLineActive: async (config: ReceptionistConfig) =>
      (await lineState(s.profileStore, s.profileVersions, config)).active,
    /** Uncached: is the line on, and was its profile saved after this instance loaded it? */
    lineState: (config: ReceptionistConfig) =>
      lineState(s.profileStore, s.profileVersions, config),
    /** Set when the number belongs to a business that switched its receptionist off. */
    describeInactiveLine: (numberE164: string) =>
      describeInactiveLine(s.profileStore, numberE164),
    get profileLoadError(): string | undefined {
      return s.profileLoadError;
    },
    /** Why the founder env configs were refused at boot (validation messages, no values). */
    get envConfigError(): string | undefined {
      return s.envConfigError;
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
      ...(rt.envConfigError
        ? { error: ENV_CONFIG_INVALID_CODE }
        : rt.profileLoadError
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
