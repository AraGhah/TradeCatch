/**
 * Shared foundation for internal/product AI agents (bug-triage, owner
 * briefing, caller classifier, SMS qualifier, live demo, ...).
 *
 * Every agent run is logged here for debugging, customer audit trail, and
 * cost-per-client reporting. Agents never touch Postgres/Twilio directly —
 * they call the typed tools in `tools.ts`, which wrap the existing
 * missed-call / scheduling / notifications services.
 */

export type AgentRunStatus = "ok" | "error" | "skipped";

export type AgentToolCallLog = {
  tool: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs: number;
};

export type AgentRun = {
  id: string;
  agentName: string;
  trigger: string;
  organizationId: string | null;
  input: unknown;
  toolCalls: AgentToolCallLog[];
  output: unknown;
  costUsd: number;
  durationMs: number;
  status: AgentRunStatus;
  error?: string;
  createdAt: string;
};

export type NewAgentRun = Omit<AgentRun, "id" | "createdAt"> & {
  id?: string;
};

export type AgentRunFilter = {
  agentName?: string;
  organizationId?: string;
  limit?: number;
};
