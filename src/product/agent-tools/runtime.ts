import { isDurableMissedCallStoreConfigured } from "@/lib/config";
import { isRealProductionRuntime } from "@/lib/environment";
import { createPostgresAgentRunStore } from "./postgres-store";
import { createMemoryAgentRunStore, type AgentRunStore } from "./store";

/** Process-local singleton. Uses Postgres when a durable store is already
 * configured for the rest of the app (MISSED_CALL_DURABLE_STORE=1 /
 * SAAS_DURABLE_STORE=1) and DATABASE_URL is set; memory otherwise. Agent
 * audit logging is best-effort — unlike the missed-call store it never
 * blocks production traffic by throwing when memory is used. */
const globalForAgentTools = globalThis as unknown as {
  __tradecatchAgentRunStore?: AgentRunStore;
};

function createStore(): AgentRunStore {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1" ||
    process.env.AGENT_TOOLS_DURABLE_STORE === "1";

  if (wantDurable && url) {
    return createPostgresAgentRunStore(url);
  }
  if (isRealProductionRuntime() && wantDurable && !url) {
    console.warn(
      "[agent-tools] Durable store requested but DATABASE_URL is missing — falling back to memory (runs will not persist across requests).",
    );
  }
  return createMemoryAgentRunStore();
}

export function getAgentRunStore(): AgentRunStore {
  return (globalForAgentTools.__tradecatchAgentRunStore ??= createStore());
}

export function resetAgentToolsRuntimeForTests() {
  delete globalForAgentTools.__tradecatchAgentRunStore;
}
