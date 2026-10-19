import { encryptSecret, decryptSecret } from "@/product/scheduling/crypto";
import { allows, maskPhone, type SecurityAction } from "./permissions";
import { securityId, safeDetail, type RecordingSettings, type SecurityStore } from "./store";
import { generateTotpSecret, matchTotpCounter } from "./totp";
import type { MemberRole } from "@/product/saas/types";

export class SecurityError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SecurityError";
  }
}

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LIMIT = 5;
const MFA_WINDOW_MS = 15 * 60_000;
const MFA_FAILURE_LIMIT = 5;

/**
 * Where an administrator stands for one session.
 * - unenrolled: no authenticator registered yet
 * - pending: a secret was issued but never confirmed with a valid code
 * - unverified: enrolled, but this session has not entered a code
 * - verified: enrolled and this session entered a valid code
 */
export type MfaState = "unenrolled" | "pending" | "unverified" | "verified";

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

  async function mfaStateOf(userId: string, sessionId: string): Promise<MfaState> {
    const row = await deps.store.getMfa(userId);
    if (!row) return "unenrolled";
    if (!row.enabled) return "pending";
    return (await deps.store.hasMfaVerification(sessionId)) ? "verified" : "unverified";
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

    async mfaState(userId: string, sessionId: string): Promise<MfaState> {
      return mfaStateOf(userId, sessionId);
    },

    /**
     * Issues a new authenticator secret. Refused once MFA is enabled: if an
     * enabled secret could be replaced by whoever holds the session, the second
     * factor would protect nothing. Resetting a lost authenticator is an
     * operator action performed out of band (see scripts/reset-admin-mfa.js).
     */
    async enrollMfa(userId: string) {
      const existing = await deps.store.getMfa(userId);
      if (existing?.enabled) {
        await audit({ actorUserId: userId, action: "mfa_enroll_refused", detail: "already enabled" });
        throw new SecurityError("Administrator verification is already set up.", 409);
      }
      const secret = generateTotpSecret();
      await deps.store.saveMfa({
        userId,
        ciphertext: encryptSecret(secret, deps.secret()),
        enabled: false,
        updatedAt: deps.now().toISOString(),
      });
      await audit({ actorUserId: userId, action: "mfa_enroll_started" });
      return {
        otpauth: `otpauth://totp/TradeCatch:${encodeURIComponent(userId)}?secret=${secret}&issuer=TradeCatch`,
        secret,
      };
    },

    /**
     * Confirms enrollment (first valid code) or verifies a new session (every
     * later sign-in). Failures are throttled per user and a code that was
     * already accepted cannot be used twice.
     */
    async confirmMfa(userId: string, sessionId: string, code: string) {
      const row = await deps.store.getMfa(userId);
      if (!row) throw new SecurityError("MFA is not enrolled.", 404);

      const throttleKey = `mfa:${userId}`;
      const nowMs = deps.now().getTime();
      if ((await deps.store.countAttempts(throttleKey, MFA_WINDOW_MS, nowMs)) >= MFA_FAILURE_LIMIT) {
        await audit({ actorUserId: userId, action: "mfa_rate_limited" });
        throw new SecurityError("Too many attempts. Try again later.", 429);
      }

      let secret: string;
      try {
        secret = decryptSecret(row.ciphertext, deps.secret());
      } catch {
        await audit({ actorUserId: userId, action: "mfa_secret_unreadable" });
        throw new SecurityError("Administrator verification could not be checked.", 409);
      }

      const counter = matchTotpCounter(secret, code, nowMs);
      const fresh = counter !== null && (await deps.store.claimWebhook("totp", `${userId}:${counter}`));
      if (!fresh) {
        await deps.store.saveAttempt(throttleKey, deps.now().toISOString());
        await audit({ actorUserId: userId, action: "mfa_failed" });
        throw new SecurityError("Invalid authentication code.", 401);
      }

      const firstEnable = !row.enabled;
      if (firstEnable) {
        await deps.store.saveMfa({ userId, ciphertext: row.ciphertext, enabled: true, updatedAt: deps.now().toISOString() });
      }
      await deps.store.saveMfaVerification({ sessionId, userId, verifiedAt: deps.now().toISOString() });
      await audit({ actorUserId: userId, action: firstEnable ? "mfa_enabled" : "mfa_verified", target: sessionId });
      return { enabled: true };
    },

    /** Privileged (platform administrator) access requires a verified second factor. No exceptions for unenrolled admins. */
    async sessionAllowsAdmin(userId: string, sessionId: string) {
      return (await mfaStateOf(userId, sessionId)) === "verified";
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
