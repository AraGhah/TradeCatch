import { createId } from "@/lib/id";
import { phoneKey } from "@/product/crm/phone";
import type {
  AutomationConfig,
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
  /**
   * Creates whatever default rows are missing and touches nothing that exists. Two requests
   * seeding the same business at once must never reset a setting or a customised template,
   * so this is insert-only (`ON CONFLICT DO NOTHING`), never an upsert.
   */
  ensureDefaults(input: {
    automations: AutomationRecord[];
    templates: TemplateRecord[];
  }): Promise<void>;
  /**
   * Sets only the on/off switch, in place. `changed` is false when it already had that
   * value, so repeating a request does nothing. Null when the automation is not this
   * business's. The settings are never written here, so a toggle cannot undo a save.
   */
  setAutomationEnabled(
    organizationId: string,
    id: string,
    enabled: boolean,
    at: string,
  ): Promise<{ automation: AutomationRecord; changed: boolean } | null>;
  /**
   * Replaces only the settings. `change` receives the stored row, locked against other
   * writers, and returns the new settings (or throws to refuse). The switch is never
   * written here, so a save cannot undo a toggle. Null when not this business's.
   */
  updateAutomationConfig(
    organizationId: string,
    id: string,
    change: (current: AutomationRecord) => AutomationConfig,
    at: string,
  ): Promise<AutomationRecord | null>;
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
  /**
   * The last step before the provider is called. Records that a send has started, only if
   * this worker still holds the job (still `processing`, same claim). False means the job
   * was canceled or taken over meanwhile: the caller must not send.
   */
  beginSend(job: JobRecord, at: string): Promise<boolean>;
  /**
   * Puts a job that was canceled only because its automation was turned off back in the
   * queue, when the automation is turned on again. Null for any other job.
   */
  requeueDisabledJob(
    organizationId: string,
    idempotencyKey: string,
    scheduledAt: string,
    at: string,
  ): Promise<JobRecord | null>;
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
  listExecutions(organizationId: string, limit: number): Promise<ExecutionRecord[]>;
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
    async ensureDefaults(input) {
      for (const row of input.automations) {
        const exists = [...automations.values()].some(
          (a) => a.organizationId === row.organizationId && a.type === row.type,
        );
        if (!exists) automations.set(row.id, clone(row));
      }
      for (const row of input.templates) {
        const exists = [...templates.values()].some(
          (t) =>
            t.organizationId === row.organizationId &&
            t.templateKey === row.templateKey &&
            t.locale === row.locale,
        );
        if (!exists) templates.set(row.id, clone(row));
      }
    },
    async setAutomationEnabled(organizationId, id, enabled, at) {
      const row = automations.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      const changed = row.enabled !== enabled;
      if (changed) {
        row.enabled = enabled;
        row.updatedAt = at;
      }
      return { automation: clone(row), changed };
    },
    async updateAutomationConfig(organizationId, id, change, at) {
      const row = automations.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      // No await between the read and the write: nothing else can run in between.
      row.config = clone(change(clone(row)));
      row.updatedAt = at;
      return clone(row);
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
        if (job.providerMessageSid || job.payload.sendStartedAt) {
          // A send may have reached the provider: it is never sent again.
          job.status = "uncertain";
          job.lastError = "provider_outcome_unreconciled";
          job.claimToken = undefined;
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
    async beginSend(job, at) {
      const stored = jobs.get(job.id);
      if (
        !stored ||
        stored.organizationId !== job.organizationId ||
        stored.status !== "processing" ||
        !stored.claimToken ||
        stored.claimToken !== job.claimToken ||
        stored.providerMessageSid
      ) {
        return false;
      }
      stored.payload.sendStartedAt = at;
      stored.updatedAt = at;
      return true;
    },
    async requeueDisabledJob(organizationId, idempotencyKey, scheduledAt, at) {
      const job = [...jobs.values()].find(
        (j) =>
          j.organizationId === organizationId &&
          j.idempotencyKey === idempotencyKey &&
          j.status === "canceled" &&
          j.cancelReason === "automation_disabled" &&
          !j.providerMessageSid,
      );
      if (!job) return null;
      job.status = "pending";
      job.cancelReason = undefined;
      job.lastError = undefined;
      job.claimToken = undefined;
      job.claimedAt = undefined;
      job.attempts = 0;
      job.scheduledAt = scheduledAt;
      job.updatedAt = at;
      delete job.payload.sendStartedAt;
      return clone(job);
    },
    async cancelPending(input) {
      let count = 0;
      for (const job of jobs.values()) {
        if (job.organizationId !== input.organizationId) continue;
        // `uncertain` stays as it is: the text may have gone out, and a person has to
        // look. Rewriting it as "canceled" would hide that.
        if (!OPEN.has(job.status)) continue;
        if (job.status === "processing" && job.providerMessageSid) continue;
        // A send is in flight. It cannot be taken back and the worker records how it
        // ended, so the job is left alone.
        if (job.status === "processing" && job.payload.sendStartedAt) continue;
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
    async listExecutions(organizationId, limit) {
      return executions
        .filter((row) => row.organizationId === organizationId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .map(clone);
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
