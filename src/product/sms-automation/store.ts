import { createId } from "@/lib/id";
import { phoneKey } from "@/product/crm/phone";
import type {
  AutomationRecord,
  AutomationType,
  ConsentRecord,
  ExecutionRecord,
  HistoryRow,
  JobRecord,
  JobStatus,
  SuppressionRecord,
  TemplateKey,
  TemplateRecord,
} from "./types";

export type AutomationStore = {
  upsertAutomation(row: AutomationRecord): Promise<AutomationRecord>;
  getAutomation(organizationId: string, id: string): Promise<AutomationRecord | null>;
  getAutomationByType(
    organizationId: string,
    type: AutomationType,
  ): Promise<AutomationRecord | null>;
  listAutomations(organizationId: string): Promise<AutomationRecord[]>;
  upsertTemplate(row: TemplateRecord): Promise<TemplateRecord>;
  listTemplates(organizationId: string): Promise<TemplateRecord[]>;
  getTemplate(
    organizationId: string,
    templateKey: TemplateKey,
    locale: "en" | "fr",
  ): Promise<TemplateRecord | null>;
  insertJob(row: JobRecord): Promise<JobRecord | null>;
  getJob(organizationId: string, id: string): Promise<JobRecord | null>;
  getJobByIdempotency(
    organizationId: string,
    key: string,
  ): Promise<JobRecord | null>;
  getJobByProviderSid(sid: string): Promise<JobRecord | null>;
  listJobs(
    organizationId: string,
    limit: number,
  ): Promise<JobRecord[]>;
  hasJobForQuote(organizationId: string, quoteThreadId: string): Promise<boolean>;
  findRecentJob(input: {
    organizationId: string;
    automationType: AutomationType;
    phoneE164: string;
    sinceIso: string;
  }): Promise<JobRecord | null>;
  claimNext(input: {
    nowIso: string;
    organizationId?: string;
    simulatedOnly?: boolean;
    forceJobId?: string;
  }): Promise<JobRecord | null>;
  saveJob(job: JobRecord): Promise<void>;
  cancelPending(input: {
    organizationId: string;
    automationId?: string;
    phoneE164?: string;
    quoteThreadId?: string;
    leadId?: string;
    reason: string;
    exceptJobId?: string;
  }): Promise<number>;
  listPendingByPhone(
    organizationId: string,
    phoneE164: string,
  ): Promise<JobRecord[]>;
  addExecution(row: ExecutionRecord): Promise<void>;
  listHistory(organizationId: string, limit: number): Promise<HistoryRow[]>;
  bumpStats(
    organizationId: string,
    automationId: string,
    patch: {
      success?: number;
      failure?: number;
      response?: number;
      lastStatus?: string;
      lastAt?: string;
    },
  ): Promise<void>;
  addSuppression(row: SuppressionRecord): Promise<SuppressionRecord>;
  isSuppressed(organizationId: string, phoneE164: string): Promise<boolean>;
  addConsent(row: ConsentRecord): Promise<ConsentRecord>;
  latestConsent(
    organizationId: string,
    phoneE164: string,
    purpose: ConsentRecord["purpose"],
  ): Promise<ConsentRecord | null>;
  addEvent(input: {
    organizationId: string;
    automationId?: string;
    jobId?: string;
    kind: string;
    detail?: string;
    at: string;
  }): Promise<void>;
  claimWebhook(provider: string, eventId: string): Promise<boolean>;
};

const OPEN = new Set<JobStatus>(["pending", "processing"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMemoryAutomationStore(): AutomationStore {
  const automations = new Map<string, AutomationRecord>();
  const templates = new Map<string, TemplateRecord>();
  const jobs = new Map<string, JobRecord>();
  const executions: ExecutionRecord[] = [];
  const suppressions = new Map<string, SuppressionRecord>();
  const consent: ConsentRecord[] = [];
  const webhooks = new Set<string>();

  function jobMatchesPhone(job: JobRecord, phoneE164: string) {
    return phoneKey(job.customerPhoneE164) === phoneKey(phoneE164);
  }

  return {
    async upsertAutomation(row) {
      const existing = [...automations.values()].find(
        (a) => a.organizationId === row.organizationId && a.type === row.type,
      );
      const saved = existing
        ? { ...row, id: existing.id, createdAt: existing.createdAt }
        : row;
      automations.set(saved.id, clone(saved));
      return clone(saved);
    },
    async getAutomation(organizationId, id) {
      const row = automations.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      return clone(row);
    },
    async getAutomationByType(organizationId, type) {
      const row = [...automations.values()].find(
        (a) => a.organizationId === organizationId && a.type === type,
      );
      return row ? clone(row) : null;
    },
    async listAutomations(organizationId) {
      return [...automations.values()]
        .filter((a) => a.organizationId === organizationId)
        .map(clone);
    },
    async upsertTemplate(row) {
      const existing = [...templates.values()].find(
        (t) =>
          t.organizationId === row.organizationId &&
          t.templateKey === row.templateKey &&
          t.locale === row.locale,
      );
      const saved = existing
        ? { ...row, id: existing.id, createdAt: existing.createdAt }
        : row;
      templates.set(saved.id, clone(saved));
      return clone(saved);
    },
    async listTemplates(organizationId) {
      return [...templates.values()]
        .filter((t) => t.organizationId === organizationId)
        .map(clone);
    },
    async getTemplate(organizationId, templateKey, locale) {
      const row = [...templates.values()].find(
        (t) =>
          t.organizationId === organizationId &&
          t.templateKey === templateKey &&
          t.locale === locale,
      );
      return row ? clone(row) : null;
    },
    async insertJob(row) {
      const dupe = [...jobs.values()].find(
        (j) =>
          j.organizationId === row.organizationId &&
          j.idempotencyKey === row.idempotencyKey,
      );
      if (dupe) return null;
      jobs.set(row.id, clone(row));
      return clone(row);
    },
    async getJob(organizationId, id) {
      const row = jobs.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      return clone(row);
    },
    async getJobByIdempotency(organizationId, key) {
      const row = [...jobs.values()].find(
        (j) => j.organizationId === organizationId && j.idempotencyKey === key,
      );
      return row ? clone(row) : null;
    },
    async getJobByProviderSid(sid) {
      const row = [...jobs.values()].find((j) => j.providerMessageSid === sid);
      return row ? clone(row) : null;
    },
    async listJobs(organizationId, limit) {
      return [...jobs.values()]
        .filter((j) => j.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(clone);
    },
    async hasJobForQuote(organizationId, quoteThreadId) {
      return [...jobs.values()].some(
        (j) =>
          j.organizationId === organizationId &&
          j.payload.quoteThreadId === quoteThreadId &&
          j.status !== "canceled" &&
          j.status !== "skipped",
      );
    },
    async findRecentJob(input) {
      const row = [...jobs.values()].find(
        (j) =>
          j.organizationId === input.organizationId &&
          j.automationType === input.automationType &&
          jobMatchesPhone(j, input.phoneE164) &&
          j.createdAt >= input.sinceIso &&
          !["canceled", "skipped", "failed"].includes(j.status),
      );
      return row ? clone(row) : null;
    },
    async claimNext(input) {
      const staleBefore = new Date(Date.parse(input.nowIso) - 10 * 60 * 1000).toISOString();
      for (const job of jobs.values()) {
        if (job.status !== "processing" || !job.claimedAt || job.claimedAt >= staleBefore) {
          continue;
        }
        if (job.providerMessageSid) {
          job.status = "uncertain";
          job.lastError = "provider_outcome_unreconciled";
        } else {
          job.status = "pending";
          job.claimToken = undefined;
          job.claimedAt = undefined;
        }
        job.updatedAt = input.nowIso;
      }
      const candidates = [...jobs.values()].filter((job) => {
        if (job.status !== "pending") return false;
        if (input.organizationId && job.organizationId !== input.organizationId) {
          return false;
        }
        if (input.simulatedOnly && !job.simulated) return false;
        if (input.forceJobId) return job.id === input.forceJobId;
        return job.scheduledAt <= input.nowIso;
      });
      candidates.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      const job = candidates[0];
      if (!job) return null;
      job.status = "processing";
      job.claimToken = createId("claim");
      job.claimedAt = input.nowIso;
      job.updatedAt = input.nowIso;
      return clone(job);
    },
    async saveJob(job) {
      const current = jobs.get(job.id);
      if (!current || current.organizationId !== job.organizationId) return;
      jobs.set(job.id, clone(job));
    },
    async cancelPending(input) {
      let count = 0;
      for (const job of jobs.values()) {
        if (job.organizationId !== input.organizationId) continue;
        if (!OPEN.has(job.status) && job.status !== "uncertain") continue;
        if (job.status === "processing" && job.providerMessageSid) continue;
        if (input.automationId && job.automationId !== input.automationId) continue;
        if (input.phoneE164 && !jobMatchesPhone(job, input.phoneE164)) continue;
        if (
          input.quoteThreadId &&
          job.payload.quoteThreadId !== input.quoteThreadId
        ) {
          continue;
        }
        if (input.leadId && job.payload.leadId !== input.leadId) continue;
        if (input.exceptJobId && job.id === input.exceptJobId) continue;
        if (job.status === "submitted" || job.status === "sent" || job.status === "delivered") {
          continue;
        }
        job.status = "canceled";
        job.cancelReason = input.reason;
        job.updatedAt = new Date().toISOString();
        count += 1;
      }
      return count;
    },
    async listPendingByPhone(organizationId, phoneE164) {
      return [...jobs.values()]
        .filter(
          (j) =>
            j.organizationId === organizationId &&
            OPEN.has(j.status) &&
            jobMatchesPhone(j, phoneE164),
        )
        .map(clone);
    },
    async addExecution(row) {
      executions.push(clone(row));
    },
    async listHistory(organizationId, limit) {
      return [...jobs.values()]
        .filter((j) => j.organizationId === organizationId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
        .map((job) => ({
          jobId: job.id,
          organizationId: job.organizationId,
          customerName: job.payload.customerName,
          customerPhoneE164: job.customerPhoneE164,
          leadId: job.payload.leadId,
          automationType: job.automationType,
          messageBody: job.payload.renderedBody,
          scheduledAt: job.scheduledAt,
          submittedAt: job.submittedAt,
          providerMessageSid: job.providerMessageSid,
          status: job.status,
          responseStatus: job.responseStatus,
          error: job.lastError,
          price: job.price,
          priceUnit: job.priceUnit,
          simulated: job.simulated,
          cancelReason: job.cancelReason,
        }));
    },
    async bumpStats(organizationId, automationId, patch) {
      const row = automations.get(automationId);
      if (!row || row.organizationId !== organizationId) return;
      row.successCount += patch.success ?? 0;
      row.failureCount += patch.failure ?? 0;
      row.responseCount += patch.response ?? 0;
      if (patch.lastStatus) row.lastExecutionStatus = patch.lastStatus;
      if (patch.lastAt) row.lastExecutionAt = patch.lastAt;
      row.updatedAt = patch.lastAt ?? row.updatedAt;
    },
    async addSuppression(row) {
      const key = `${row.organizationId}:${row.phoneKey}`;
      const existing = suppressions.get(key);
      if (existing) return clone(existing);
      suppressions.set(key, clone(row));
      return clone(row);
    },
    async isSuppressed(organizationId, phoneE164) {
      return suppressions.has(`${organizationId}:${phoneKey(phoneE164)}`);
    },
    async addConsent(row) {
      consent.push(clone(row));
      return clone(row);
    },
    async latestConsent(organizationId, phoneE164, purpose) {
      const key = phoneKey(phoneE164);
      const row = [...consent]
        .reverse()
        .find(
          (c) =>
            c.organizationId === organizationId &&
            phoneKey(c.phoneE164) === key &&
            c.purpose === purpose,
        );
      return row ? clone(row) : null;
    },
    async addEvent() {
      return;
    },
    async claimWebhook(provider, eventId) {
      const key = `${provider}:${eventId}`;
      if (webhooks.has(key)) return false;
      webhooks.add(key);
      return true;
    },
  };
}
