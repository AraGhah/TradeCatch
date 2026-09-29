import { createId } from "@/lib/id";
import type {
  EmailEnrollment,
  EmailSequence,
  EmailSuppression,
  EmailTemplate,
} from "./types";

export type EmailAutomationStore = {
  upsertTemplate(
    input: Omit<EmailTemplate, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<EmailTemplate>;
  listTemplates(organizationId: string): Promise<EmailTemplate[]>;
  getTemplate(
    id: string,
    organizationId: string,
  ): Promise<EmailTemplate | null>;

  upsertSequence(
    input: Omit<EmailSequence, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<EmailSequence>;
  listSequences(organizationId: string): Promise<EmailSequence[]>;
  getSequence(
    id: string,
    organizationId: string,
  ): Promise<EmailSequence | null>;

  createEnrollment(
    input: Omit<EmailEnrollment, "id" | "createdAt" | "updatedAt">,
  ): Promise<EmailEnrollment>;
  getEnrollment(
    id: string,
    organizationId: string,
  ): Promise<EmailEnrollment | null>;
  listEnrollments(
    organizationId: string,
    limit?: number,
  ): Promise<EmailEnrollment[]>;
  findActiveEnrollment(
    organizationId: string,
    sequenceId: string,
    email: string,
  ): Promise<EmailEnrollment | null>;
  listActiveEnrollmentsByEmail(
    organizationId: string,
    email: string,
  ): Promise<EmailEnrollment[]>;
  /** Atomically lease up to `limit` due enrollments until `leaseUntilIso`. */
  claimDueEnrollments(
    nowIso: string,
    leaseUntilIso: string,
    limit: number,
  ): Promise<EmailEnrollment[]>;
  updateEnrollment(
    id: string,
    organizationId: string,
    patch: Partial<Omit<EmailEnrollment, "id" | "organizationId">>,
  ): Promise<EmailEnrollment | null>;

  getOrgSettings(organizationId: string): Promise<EmailOrgSettings>;
  setAutoEnrollSequence(
    organizationId: string,
    sequenceId: string | null,
  ): Promise<EmailOrgSettings>;

  addSuppression(input: EmailSuppression): Promise<void>;
  isSuppressed(organizationId: string, email: string): Promise<boolean>;
};

export type EmailOrgSettings = {
  /** Sequence new website leads (with email + consent) are enrolled into. */
  autoEnrollSequenceId?: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createMemoryEmailAutomationStore(): EmailAutomationStore {
  const templates = new Map<string, EmailTemplate>();
  const sequences = new Map<string, EmailSequence>();
  const enrollments = new Map<string, EmailEnrollment>();
  const suppressions = new Map<string, EmailSuppression>();
  const orgSettings = new Map<string, EmailOrgSettings>();
  const now = () => new Date().toISOString();
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    async upsertTemplate(input) {
      const existing = input.id ? templates.get(input.id) : undefined;
      if (existing && existing.organizationId !== input.organizationId) {
        throw new Error("Template belongs to another organization");
      }
      const row: EmailTemplate = {
        ...input,
        id: input.id ?? createId("emt"),
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      };
      templates.set(row.id, row);
      return clone(row);
    },
    async listTemplates(organizationId) {
      return Array.from(templates.values())
        .filter((t) => t.organizationId === organizationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(clone);
    },
    async getTemplate(id, organizationId) {
      const t = templates.get(id);
      return t && t.organizationId === organizationId ? clone(t) : null;
    },

    async upsertSequence(input) {
      const existing = input.id ? sequences.get(input.id) : undefined;
      if (existing && existing.organizationId !== input.organizationId) {
        throw new Error("Sequence belongs to another organization");
      }
      const row: EmailSequence = {
        ...input,
        id: input.id ?? createId("ems"),
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      };
      sequences.set(row.id, row);
      return clone(row);
    },
    async listSequences(organizationId) {
      return Array.from(sequences.values())
        .filter((s) => s.organizationId === organizationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(clone);
    },
    async getSequence(id, organizationId) {
      const s = sequences.get(id);
      return s && s.organizationId === organizationId ? clone(s) : null;
    },

    async createEnrollment(input) {
      const row: EmailEnrollment = {
        ...input,
        email: normalizeEmail(input.email),
        id: createId("eme"),
        createdAt: now(),
        updatedAt: now(),
      };
      enrollments.set(row.id, row);
      return clone(row);
    },
    async getEnrollment(id, organizationId) {
      const e = enrollments.get(id);
      return e && e.organizationId === organizationId ? clone(e) : null;
    },
    async listEnrollments(organizationId, limit = 200) {
      return Array.from(enrollments.values())
        .filter((e) => e.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(clone);
    },
    async findActiveEnrollment(organizationId, sequenceId, email) {
      const n = normalizeEmail(email);
      const e = Array.from(enrollments.values()).find(
        (x) =>
          x.organizationId === organizationId &&
          x.sequenceId === sequenceId &&
          x.email === n &&
          x.status === "active",
      );
      return e ? clone(e) : null;
    },
    async listActiveEnrollmentsByEmail(organizationId, email) {
      const n = normalizeEmail(email);
      return Array.from(enrollments.values())
        .filter(
          (x) =>
            x.organizationId === organizationId &&
            x.email === n &&
            x.status === "active",
        )
        .map(clone);
    },
    async claimDueEnrollments(nowIso, leaseUntilIso, limit) {
      const due = Array.from(enrollments.values())
        .filter(
          (e) =>
            e.status === "active" &&
            e.nextSendAt !== undefined &&
            e.nextSendAt <= nowIso &&
            (!e.lockedUntil || e.lockedUntil <= nowIso),
        )
        .sort((a, b) => (a.nextSendAt ?? "").localeCompare(b.nextSendAt ?? ""))
        .slice(0, limit);
      for (const e of due) e.lockedUntil = leaseUntilIso;
      return due.map(clone);
    },
    async updateEnrollment(id, organizationId, patch) {
      const e = enrollments.get(id);
      if (!e || e.organizationId !== organizationId) return null;
      const row = { ...e, ...patch, updatedAt: now() };
      enrollments.set(id, row);
      return clone(row);
    },

    async getOrgSettings(organizationId) {
      return clone(orgSettings.get(organizationId) ?? {});
    },
    async setAutoEnrollSequence(organizationId, sequenceId) {
      const next: EmailOrgSettings = sequenceId
        ? { autoEnrollSequenceId: sequenceId }
        : {};
      orgSettings.set(organizationId, next);
      return clone(next);
    },

    async addSuppression(input) {
      suppressions.set(
        `${input.organizationId}:${normalizeEmail(input.email)}`,
        {
          ...input,
          email: normalizeEmail(input.email),
        },
      );
    },
    async isSuppressed(organizationId, email) {
      return suppressions.has(`${organizationId}:${normalizeEmail(email)}`);
    },
  };
}
