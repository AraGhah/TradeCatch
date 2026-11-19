import { createId } from "@/lib/id";
import type { AuditChange } from "./audit-changes";
import { redactAuditDetail } from "./permissions";

export type AuditOutcome = "success" | "denied" | "failed";

export type AuditEvent = {
  id: string;
  organizationId?: string;
  actorUserId?: string;
  /** Who did it, as an administrator would recognise them. Not a secret. */
  actorEmail?: string;
  actorRole?: string;
  action: string;
  target?: string;
  detail?: string;
  /** `success` unless the attempt was refused (`denied`) or errored (`failed`). */
  outcome?: AuditOutcome;
  /** What changed, field by field, already masked and redacted. */
  changes?: AuditChange[];
  createdAt: string;
};

export type AuditFilter = {
  /** Free text over action, target, detail, actor email and organization id. */
  q?: string;
  action?: string;
  actorUserId?: string;
  organizationId?: string;
  outcome?: AuditOutcome;
  /** Inclusive ISO date (YYYY-MM-DD) bounds on createdAt. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type AuditPage = { rows: AuditEvent[]; total: number };

export const AUDIT_PAGE_MAX = 100;

export function clampAuditPage(filter: AuditFilter): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(
    AUDIT_PAGE_MAX,
    Math.max(1, Math.floor(filter.limit ?? 25)),
  );
  const offset = Math.max(0, Math.floor(filter.offset ?? 0));
  return { limit, offset };
}

/** The shared matching rule, used by the in-memory store and by tests. */
export function auditMatches(row: AuditEvent, filter: AuditFilter): boolean {
  if (filter.action && row.action !== filter.action) return false;
  if (filter.actorUserId && row.actorUserId !== filter.actorUserId) return false;
  if (filter.organizationId && row.organizationId !== filter.organizationId) {
    return false;
  }
  if (filter.outcome && (row.outcome ?? "success") !== filter.outcome) {
    return false;
  }
  if (filter.from && row.createdAt.slice(0, 10) < filter.from) return false;
  if (filter.to && row.createdAt.slice(0, 10) > filter.to) return false;
  const q = filter.q?.trim().toLowerCase();
  if (q) {
    const haystack = [
      row.action,
      row.target,
      row.detail,
      row.actorEmail,
      row.organizationId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export type PrivacyRequest = {
  id: string;
  organizationId: string;
  kind: "access" | "correction" | "deletion";
  status: "open" | "completed";
  subjectRef: string;
  createdAt: string;
  completedAt?: string;
};

export type RecordingSettings = {
  organizationId: string;
  disclosureEnabled: boolean;
  recordingEnabled: boolean;
  retentionDays: number;
  onDenied: "continue_without_recording" | "end_call";
  updatedAt: string;
};

export type SecurityIncident = {
  id: string;
  organizationId?: string;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  status: "open" | "investigating" | "resolved";
  createdAt: string;
  resolvedAt?: string;
};

export type SecurityStore = {
  saveAudit(row: AuditEvent): Promise<void>;
  listAudit(organizationId?: string): Promise<AuditEvent[]>;
  /** Newest first. Read-only: the store offers no way to edit or remove a row. */
  searchAudit(filter: AuditFilter): Promise<AuditPage>;
  saveAttempt(email: string, at: string): Promise<void>;
  countAttempts(email: string, sinceMs: number, nowMs: number): Promise<number>;
  saveMfa(input: { userId: string; ciphertext: string; enabled: boolean; updatedAt: string }): Promise<void>;
  getMfa(userId: string): Promise<{ ciphertext: string; enabled: boolean } | null>;
  saveMfaVerification(input: { sessionId: string; userId: string; verifiedAt: string }): Promise<void>;
  hasMfaVerification(sessionId: string): Promise<boolean>;
  saveRecording(row: RecordingSettings): Promise<void>;
  getRecording(organizationId: string): Promise<RecordingSettings | null>;
  saveConsent(input: { id: string; organizationId: string; subjectRef: string; purpose: string; status: string; createdAt: string }): Promise<void>;
  saveRequest(row: PrivacyRequest): Promise<void>;
  listRequests(organizationId: string): Promise<PrivacyRequest[]>;
  getRequest(id: string): Promise<PrivacyRequest | null>;
  saveIncident(row: SecurityIncident): Promise<void>;
  listIncidents(): Promise<SecurityIncident[]>;
  claimWebhook(provider: string, eventId: string): Promise<boolean>;
};

export function createMemorySecurityStore(): SecurityStore {
  const audits: AuditEvent[] = [];
  const attempts: { email: string; at: string }[] = [];
  const mfa = new Map<string, { ciphertext: string; enabled: boolean }>();
  const verified = new Set<string>();
  const recordings = new Map<string, RecordingSettings>();
  const requests = new Map<string, PrivacyRequest>();
  const incidents: SecurityIncident[] = [];
  const webhooks = new Set<string>();

  return {
    async saveAudit(row) { audits.push(structuredClone(row)); },
    async listAudit(organizationId) {
      return audits.filter((row) => !organizationId || row.organizationId === organizationId).map((row) => structuredClone(row));
    },
    async searchAudit(filter) {
      const matched = audits
        .filter((row) => auditMatches(row, filter))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const { limit, offset } = clampAuditPage(filter);
      return {
        rows: matched.slice(offset, offset + limit).map((row) => structuredClone(row)),
        total: matched.length,
      };
    },
    async saveAttempt(email, at) { attempts.push({ email, at }); },
    async countAttempts(email, sinceMs, nowMs) {
      return attempts.filter((row) => row.email === email && Date.parse(row.at) >= nowMs - sinceMs).length;
    },
    async saveMfa(input) { mfa.set(input.userId, { ciphertext: input.ciphertext, enabled: input.enabled }); },
    async getMfa(userId) { return mfa.get(userId) ?? null; },
    async saveMfaVerification(input) { verified.add(input.sessionId); },
    async hasMfaVerification(sessionId) { return verified.has(sessionId); },
    async saveRecording(row) { recordings.set(row.organizationId, structuredClone(row)); },
    async getRecording(organizationId) {
      const row = recordings.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveConsent() { return; },
    async saveRequest(row) { requests.set(row.id, structuredClone(row)); },
    async listRequests(organizationId) {
      return [...requests.values()].filter((row) => row.organizationId === organizationId).map((row) => structuredClone(row));
    },
    async getRequest(id) {
      const row = requests.get(id);
      return row ? structuredClone(row) : null;
    },
    async saveIncident(row) { incidents.push(structuredClone(row)); },
    async listIncidents() { return incidents.map((row) => structuredClone(row)); },
    async claimWebhook(provider, eventId) {
      const key = `${provider}:${eventId}`;
      if (webhooks.has(key)) return false;
      webhooks.add(key);
      return true;
    },
  };
}

export function securityId(prefix: string) {
  return createId(prefix);
}

export function safeDetail(value?: string) {
  return value ? redactAuditDetail(value) : undefined;
}
