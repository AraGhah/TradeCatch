import { createId } from "@/lib/id";
import { redactAuditDetail } from "./permissions";

export type AuditEvent = {
  id: string;
  organizationId?: string;
  actorUserId?: string;
  action: string;
  target?: string;
  detail?: string;
  createdAt: string;
};

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
