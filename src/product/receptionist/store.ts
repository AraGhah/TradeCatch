import type { CallSession } from "./types";

export class ReceptionistConflictError extends Error {
  constructor(sessionId: string) {
    super(`[receptionist] concurrent update on session ${sessionId}`);
    this.name = "ReceptionistConflictError";
  }
}

/**
 * Identity-independent check. The store singleton lives on globalThis while a
 * bundler (or dev hot reload) can load this module twice, so `instanceof`
 * would silently miss an error thrown by the other copy.
 */
export function isConflictError(err: unknown): boolean {
  return (
    err instanceof ReceptionistConflictError ||
    (err instanceof Error && err.name === "ReceptionistConflictError")
  );
}

export type ReceptionistStore = {
  /** Insert unless a session already exists for this CallSid (Twilio retries). */
  insertSessionIfAbsent(
    session: CallSession,
  ): Promise<{ session: CallSession; created: boolean }>;
  getSession(id: string): Promise<CallSession | null>;
  getSessionByCallSid(callSid: string): Promise<CallSession | null>;
  /**
   * Optimistic save: `session.version` must equal the stored version.
   * Returns the saved row with version + 1; throws ReceptionistConflictError.
   */
  saveSession(session: CallSession): Promise<CallSession>;
  listSessions(input: {
    clientAccountId?: string;
    limit?: number;
  }): Promise<CallSession[]>;
  /** Sessions never finalized (status callback lost) and idle since `beforeIso`. */
  listStaleUnfinalized(
    beforeIso: string,
    limit: number,
  ): Promise<CallSession[]>;
  /** Clear transcript + slot PII for finalized calls of a config ended before `beforeIso`. */
  purgeTranscripts(configId: string, beforeIso: string): Promise<number>;
};

function clone<T>(v: T): T {
  return structuredClone(v);
}

export function redactSession(
  session: CallSession,
  atIso: string,
): CallSession {
  return {
    ...session,
    turns: [],
    slots: {},
    recordingUrl: undefined,
    summary: session.summary
      ? {
          ...session.summary,
          callerName: undefined,
          callbackE164: undefined,
          serviceAddress: undefined,
          issue: undefined,
          preferredTime: undefined,
          message: undefined,
          aiSummary: undefined,
        }
      : undefined,
    transcriptPurgedAt: atIso,
  };
}

export function createMemoryReceptionistStore(): ReceptionistStore {
  const byId = new Map<string, CallSession>();
  const idBySid = new Map<string, string>();

  return {
    async insertSessionIfAbsent(session) {
      const existingId = idBySid.get(session.callSid);
      if (existingId) {
        return { session: clone(byId.get(existingId)!), created: false };
      }
      const row = clone({ ...session, version: 1 });
      byId.set(row.id, row);
      idBySid.set(row.callSid, row.id);
      return { session: clone(row), created: true };
    },

    async getSession(id) {
      const row = byId.get(id);
      return row ? clone(row) : null;
    },

    async getSessionByCallSid(callSid) {
      const id = idBySid.get(callSid);
      return id ? clone(byId.get(id)!) : null;
    },

    async saveSession(session) {
      const current = byId.get(session.id);
      if (!current || current.version !== session.version) {
        throw new ReceptionistConflictError(session.id);
      }
      const row = clone({ ...session, version: session.version + 1 });
      byId.set(row.id, row);
      return clone(row);
    },

    async listSessions({ clientAccountId, limit = 100 }) {
      return Array.from(byId.values())
        .filter(
          (s) => !clientAccountId || s.clientAccountId === clientAccountId,
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit)
        .map(clone);
    },

    async listStaleUnfinalized(beforeIso, limit) {
      return Array.from(byId.values())
        .filter((s) => !s.finalizedAt && s.updatedAt < beforeIso)
        .slice(0, limit)
        .map(clone);
    },

    async purgeTranscripts(configId, beforeIso) {
      const now = new Date().toISOString();
      let count = 0;
      for (const [id, s] of byId) {
        if (
          s.configId === configId &&
          s.finalizedAt &&
          !s.transcriptPurgedAt &&
          (s.endedAt ?? s.updatedAt) < beforeIso
        ) {
          byId.set(id, { ...redactSession(s, now), version: s.version + 1 });
          count += 1;
        }
      }
      return count;
    },
  };
}
