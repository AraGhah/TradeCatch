import { createId } from "@/lib/id";

export type QaStatus = "passed" | "failed" | "skipped";

export type QaResult = {
  id: string;
  runId: string;
  suite: string;
  name: string;
  status: QaStatus;
  expected: string;
  actual?: string;
  error?: string;
  records?: string[];
  durationMs: number;
  createdAt: string;
};

export type QaRun = {
  id: string;
  suite: string;
  environment: string;
  version: string;
  status: "passed" | "failed";
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  createdAt: string;
  results: QaResult[];
};

export type QaStore = {
  saveRun(run: QaRun): Promise<void>;
  listRuns(): Promise<QaRun[]>;
};

export function createMemoryQaStore(): QaStore {
  const runs: QaRun[] = [];
  return {
    async saveRun(run) {
      runs.unshift(structuredClone(run));
    },
    async listRuns() {
      return runs.slice(0, 20).map((run) => structuredClone(run));
    },
  };
}

export function qaId(prefix: string) {
  return createId(prefix);
}
