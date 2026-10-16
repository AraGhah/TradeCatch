import { encryptSecret, decryptSecret } from "@/product/scheduling/crypto";
import { allows, maskPhone, type SecurityAction } from "./permissions";
import { securityId, safeDetail, type RecordingSettings, type SecurityStore } from "./store";
import { generateTotpSecret, verifyTotp } from "./totp";
import type { MemberRole } from "@/product/saas/types";

export class SecurityError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SecurityError";
  }
}

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LIMIT = 5;

export type SecurityDeps = {
  store: SecurityStore;
  now: () => Date;
  secret: () => string;
  listSessions: (userId: string) => Promise<{ id: string; createdAt: string; userAgent?: string; ip?: string; organizationId: string }[]>;
  revokeSession: (id: string, at: string) => Promise<void>;
};

export function createSecurityService(deps: SecurityDeps) {
  async function audit(input: { organizationId?: string; actorUserId?: string; action: string; target?: string; detail?: string }) {
    const row = {
      id: securityId("aud"),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      target: input.target,
      detail: safeDetail(input.detail),
      createdAt: deps.now().toISOString(),
    };
    await deps.store.saveAudit(row);
    return row;
  }

  return {
    allows,
    maskPhone,
    audit,

    async loginAllowed(email: string) {
      const count = await deps.store.countAttempts(email.toLowerCase(), LOGIN_WINDOW_MS, deps.now().getTime());
      return count < LOGIN_LIMIT;
    },

    async noteLogin(email: string) {
      await deps.store.saveAttempt(email.toLowerCase(), deps.now().toISOString());
    },

    async sessions(userId: string) {
      const rows = await deps.listSessions(userId);
      return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, userAgent: row.userAgent, organizationId: row.organizationId }));
    },

    async revokeOwnSession(userId: string, sessionId: string) {
      const rows = await deps.listSessions(userId);
      if (!rows.some((row) => row.id === sessionId)) throw new SecurityError("Session not found.", 404);
      await deps.revokeSession(sessionId, deps.now().toISOString());
      await audit({ actorUserId: userId, action: "session_revoked", target: sessionId });
    },

    assertPermission(role: MemberRole, action: SecurityAction, platformAdmin = false) {
      if (!allows(role, action, platformAdmin)) throw new SecurityError("Insufficient permissions.", 403);
    },

    async enrollMfa(userId: string) {
      const secret = generateTotpSecret();
      await deps.store.saveMfa({
        userId,
        ciphertext: encryptSecret(secret, deps.secret()),
        enabled: false,
        updatedAt: deps.now().toISOString(),
      });
      await audit({ actorUserId: userId, action: "mfa_enroll_started" });
      return { otpauth: `otpauth://totp/TradeCatch:${userId}?secret=${secret}&issuer=TradeCatch`, secret };
    },

    async confirmMfa(userId: string, sessionId: string, code: string) {
      const row = await deps.store.getMfa(userId);
      if (!row) throw new SecurityError("MFA is not enrolled.", 404);
      const secret = decryptSecret(row.ciphertext, deps.secret());
      if (!verifyTotp(secret, code, deps.now().getTime())) throw new SecurityError("Invalid authentication code.", 401);
      await deps.store.saveMfa({ userId, ciphertext: row.ciphertext, enabled: true, updatedAt: deps.now().toISOString() });
      await deps.store.saveMfaVerification({ sessionId, userId, verifiedAt: deps.now().toISOString() });
      await audit({ actorUserId: userId, action: "mfa_enabled" });
      return { enabled: true };
    },

    async sessionAllowsAdmin(userId: string, sessionId: string) {
      const row = await deps.store.getMfa(userId);
      if (!row?.enabled) return true;
      return deps.store.hasMfaVerification(sessionId);
    },

    async recording(organizationId: string): Promise<RecordingSettings> {
      return (await deps.store.getRecording(organizationId)) ?? {
        organizationId,
        disclosureEnabled: true,
        recordingEnabled: false,
        retentionDays: 30,
        onDenied: "continue_without_recording",
        updatedAt: deps.now().toISOString(),
      };
    },

    async saveRecording(row: RecordingSettings) {
      const next = { ...row, retentionDays: Math.min(365, Math.max(1, row.retentionDays)), updatedAt: deps.now().toISOString() };
      await deps.store.saveRecording(next);
      await audit({ organizationId: row.organizationId, action: "recording_settings_updated" });
      return next;
    },

    async recordConsent(input: { organizationId: string; subjectRef: string; purpose: string; status: "granted" | "denied" }) {
      await deps.store.saveConsent({
        id: securityId("cns"),
        organizationId: input.organizationId,
        subjectRef: input.subjectRef,
        purpose: input.purpose,
        status: input.status,
        createdAt: deps.now().toISOString(),
      });
    },

    async openPrivacyRequest(input: { organizationId: string; kind: "access" | "correction" | "deletion"; subjectRef: string }) {
      const row = {
        id: securityId("prv"),
        organizationId: input.organizationId,
        kind: input.kind,
        status: "open" as const,
        subjectRef: input.subjectRef,
        createdAt: deps.now().toISOString(),
      };
      await deps.store.saveRequest(row);
      await audit({ organizationId: input.organizationId, action: "privacy_request_opened", target: row.id });
      return row;
    },

    /** Removes direct identifiers. Billing evidence stays with Stripe and is not copied here. */
    async completePrivacyRequest(organizationId: string, requestId: string, snapshot: { name?: string; phone?: string; address?: string }) {
      const row = await deps.store.getRequest(requestId);
      if (!row || row.organizationId !== organizationId) throw new SecurityError("Request not found.", 404);
      row.status = "completed";
      row.completedAt = deps.now().toISOString();
      await deps.store.saveRequest(row);
      const redacted = {
        name: snapshot.name ? "[removed]" : undefined,
        phone: snapshot.phone ? "[removed]" : undefined,
        address: snapshot.address ? "[removed]" : undefined,
        retained: "legal_minimum_only",
      };
      await audit({ organizationId, action: "privacy_request_completed", target: requestId, detail: "identifiers removed" });
      return { request: row, redacted };
    },

    async openIncident(input: { organizationId?: string; severity: SecurityIncidentSeverity; summary: string }) {
      const row = {
        id: securityId("sec"),
        organizationId: input.organizationId,
        severity: input.severity,
        summary: safeDetail(input.summary) || "suspected exposure",
        status: "investigating" as const,
        createdAt: deps.now().toISOString(),
      };
      await deps.store.saveIncident(row);
      await audit({ organizationId: input.organizationId, action: "security_incident_opened", target: row.id });
      return {
        incident: row,
        procedure: ["contain access", "investigate affected records", "notify the privacy officer", "record the resolution"],
      };
    },

    async listIncidents() {
      return deps.store.listIncidents();
    },

    async listAudit(organizationId?: string) {
      return deps.store.listAudit(organizationId);
    },

    async acceptWebhook(provider: string, eventId: string) {
      return deps.store.claimWebhook(provider, eventId);
    },

    customerView<T extends { organizationId: string; phone?: string }>(
      actorOrganizationId: string,
      role: MemberRole,
      record: T,
      platformAdmin = false,
    ): T {
      if (record.organizationId !== actorOrganizationId && !platformAdmin) {
        throw new SecurityError("Not a member of this business.", 403);
      }
      return { ...record, phone: record.phone ? maskPhone(record.phone, role, platformAdmin) : undefined };
    },
  };
}

type SecurityIncidentSeverity = "low" | "medium" | "high" | "critical";

export type SecurityService = ReturnType<typeof createSecurityService>;
