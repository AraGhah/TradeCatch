import { createId } from "@/lib/id";
import type { AgentRun, AgentRunFilter, NewAgentRun } from "./types";

export type AgentRunStore = {
  saveRun(run: NewAgentRun): Promise<AgentRun>;
  listRuns(filter?: AgentRunFilter): Promise<AgentRun[]>;
  getRun(id: string): Promise<AgentRun | null>;
};

const DEFAULT_LIMIT = 50;

export function createMemoryAgentRunStore(): AgentRunStore {
  const runs: AgentRun[] = [];

  return {
    async saveRun(run) {
      const saved: AgentRun = {
        ...run,
        id: run.id ?? createId("run"),
        createdAt: new Date().toISOString(),
      };
      runs.unshift(saved);
      return saved;
    },
    async listRuns(filter = {}) {
      return runs
        .filter((r) => !filter.agentName || r.agentName === filter.agentName)
        .filter(
          (r) =>
            !filter.organizationId ||
            r.organizationId === filter.organizationId,
        )
        .slice(0, filter.limit ?? DEFAULT_LIMIT);
    },
    async getRun(id) {
      return runs.find((r) => r.id === id) ?? null;
    },
  };
}
