import { createId } from "@/lib/id";
import { isOptOut } from "@/product/missed-call/messaging";
import type { ClientAccount } from "@/product/missed-call/types";
import { normalizeE164, phoneKey } from "@/product/crm/phone";
import type { AutomationStore } from "./store";
import {
  DEFAULT_TEMPLATES,
  defaultConfig,
  mergeConfig,
  renderTemplate,
  validateTemplate,
} from "./templates";
import type {
  AutomationConfig,
  AutomationRecord,
  AutomationType,
  ConsentBasis,
  HistoryRow,
  JobPayload,
  JobRecord,
  JobStatus,
  MessageCategory,
  TemplateKey,
  TemplateRecord,
} from "./types";
import { AUTOMATION_TYPES, OPERATIONAL_AUTOMATION_TYPES, TEMPLATE_KEYS } from "./types";
import { isInsideSendingWindow, nextWindowStart } from "./window";

const MAX_PROVIDER_ATTEMPTS = 3;
const OPT_OUT_CLIENT = { optOutKeywords: [] } as unknown as ClientAccount;

export class AutomationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AutomationError";
  }
}

export type OrgSnapshot = {
  id: string;
  name: string;
  status: string;
  timezone: string;
  localeDefault: "en" | "fr";
  phoneE164: string | null;
  accountType?: string;
};

export type QuoteSnapshot = {
  id: string;
  customerPhoneE164: string;
  customerName?: string;
  quoteRef?: string;
  locale: "en" | "fr";
  status: string;
  quoteSentAt: string;
  serviceName?: string;
};

export type AutomationDeps = {
  store: AutomationStore;
  sms: {
    send(message: {
      toE164: string;
      fromE164: string;
      body: string;
    }): Promise<{ sid: string }>;
    syncOptOut?: (input: {
      phoneE164: string;
      fromE164: string;
    }) => Promise<{ ok: boolean; detail?: string }>;
  };
  now: () => Date;
  loadOrg: (organizationId: string) => Promise<OrgSnapshot | null>;
  smsFrom: (organizationId: string) => Promise<string | null>;
  smsMode: "live" | "dry-run";
  quoteStatus?: (organizationId: string, threadId: string) => Promise<string | null>;
  leadState?: (
    organizationId: string,
    leadId: string,
  ) => Promise<{ status: string; humanContact: boolean } | null>;
  listOpenQuotes?: (organizationId: string) => Promise<QuoteSnapshot[]>;
  clearQuoteSchedule?: (organizationId: string, threadId: string) => Promise<void>;
  stopQuoteThread?: (
    organizationId: string,
    threadId: string,
    reason: "won" | "lost" | "customer_reply" | "opt_out" | "manual_pause",
  ) => Promise<void>;
  onCustomerMessage?: (input: {
    organizationId: string;
    phoneE164: string;
    body: string;
    direction: "inbound" | "outbound";
    automated: boolean;
    simulated: boolean;
    customerName?: string;
    leadId?: string;
    locale?: "en" | "fr";
    providerMessageSid?: string;
    optOut: boolean;
    serviceName?: string;
    recordMessage?: boolean;
  }) => Promise<{ leadId?: string } | void>;
  notifyContractor?: (input: {
    organizationId: string;
    title: string;
    reason: string;
    kind: "missed_call" | "quote";
    refId: string;
  }) => Promise<void>;
  mirrorSuppression?: (organizationId: string, phoneE164: string) => Promise<void>;
};

function isE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

function resolveLocale(
  config: AutomationConfig,
  org: OrgSnapshot,
  customer?: "en" | "fr",
): "en" | "fr" {
  if (config.language === "en" || config.language === "fr") return config.language;
  return customer ?? org.localeDefault ?? "fr";
}

function basisFor(category: MessageCategory): ConsentBasis {
  if (category === "marketing") return "express_consent";
  if (category === "inquiry_response") return "exemption_inquiry";
  return "requested_service";
}

function uncertainError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|aborted|network|ECONNRESET|fetch failed|socket/i.test(msg);
}

function providerFailure(message: string): "retry" | "permanent" | "uncertain" {
  if (uncertainError(new Error(message))) return "uncertain";
  if (/Twilio SMS failed: 4/.test(message) && !/\b429\b/.test(message)) return "permanent";
  return "retry";
}

const RANK: Partial<Record<JobStatus, number>> = {
  processing: 1,
  submitted: 2,
  sent: 3,
  delivered: 4,
};

export function nextDeliveryStatus(
  current: JobStatus,
  incoming: string,
): JobStatus | null {
  const next: JobStatus | null =
    incoming === "delivered"
      ? "delivered"
      : incoming === "sent"
        ? "sent"
        : incoming === "undelivered"
          ? "undelivered"
          : incoming === "failed"
            ? "failed"
            : null;
  if (!next) return null;
  if (current === "canceled" || current === "skipped" || current === "delivered") {
    return null;
  }
  if (next === "failed" || next === "undelivered") {
    if (current === "failed" || current === "undelivered") return null;
    return next;
  }
  if ((RANK[next] ?? 0) <= (RANK[current] ?? 0)) return null;
  return next;
}

async function record(
  deps: AutomationDeps,
  job: JobRecord,
  status: string,
  result: string,
  extra?: { error?: string; body?: string; sid?: string },
) {
  const at = deps.now().toISOString();
  await deps.store.addExecution({
    id: createId("ex"),
    organizationId: job.organizationId,
    automationId: job.automationId,
    jobId: job.id,
    status,
    result,
    error: extra?.error,
    providerMessageSid: extra?.sid ?? job.providerMessageSid,
    messageBody: extra?.body ?? job.payload.renderedBody,
    simulated: job.simulated,
    at,
  });
  await deps.store.bumpStats(job.organizationId, job.automationId, {
    success: status === "success" ? 1 : 0,
    failure: status === "failure" ? 1 : 0,
    lastStatus: result,
    lastAt: at,
  });
  await deps.store.addEvent({
    organizationId: job.organizationId,
    automationId: job.automationId,
    jobId: job.id,
    kind: result,
    detail: extra?.error,
    at,
  });
}

export function createAutomationService(deps: AutomationDeps) {
  async function requireOrg(organizationId: string): Promise<OrgSnapshot> {
    const org = await deps.loadOrg(organizationId);
    if (!org) throw new AutomationError("Business not found.", 404);
    return org;
  }

  async function seed(organizationId: string): Promise<AutomationRecord[]> {
    const now = deps.now().toISOString();
    for (const type of AUTOMATION_TYPES) {
      const existing = await deps.store.getAutomationByType(organizationId, type);
      if (!existing) {
        await deps.store.upsertAutomation({
          id: createId("auto"),
          organizationId,
          type,
          enabled: false,
          config: defaultConfig(type),
          successCount: 0,
          failureCount: 0,
          responseCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    for (const templateKey of TEMPLATE_KEYS) {
      for (const locale of ["en", "fr"] as const) {
        const existing = await deps.store.getTemplate(
          organizationId,
          templateKey,
          locale,
        );
        if (!existing) {
          await deps.store.upsertTemplate({
            id: createId("tpl"),
            organizationId,
            templateKey,
            locale,
            body: DEFAULT_TEMPLATES[templateKey][locale],
            customized: false,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
    return deps.store.listAutomations(organizationId);
  }

  async function placeJob(input: {
    organizationId: string;
    automation: AutomationRecord;
    phone: string;
    idempotencyKey: string;
    scheduledAt: string;
    simulated: boolean;
    payload: JobPayload;
  }): Promise<JobRecord | null> {
    const now = deps.now().toISOString();
    return deps.store.insertJob({
      id: createId("job"),
      organizationId: input.organizationId,
      automationId: input.automation.id,
      automationType: input.automation.type,
      idempotencyKey: input.idempotencyKey,
      scheduledAt: input.scheduledAt,
      status: "pending",
      attempts: 0,
      customerPhoneE164: input.phone,
      simulated: input.simulated,
      responseStatus: "none",
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function consent(input: {
    organizationId: string;
    phone: string;
    category: MessageCategory;
    evidence: string;
  }) {
    const now = deps.now().toISOString();
    return deps.store.addConsent({
      id: createId("cns"),
      organizationId: input.organizationId,
      phoneE164: input.phone,
      purpose: input.category,
      basis: basisFor(input.category),
      evidence: input.evidence,
      createdAt: now,
    });
  }

  function snap(at: Date, org: OrgSnapshot, config: AutomationConfig): string {
    return nextWindowStart(at, org.timezone || "America/Toronto", config).toISOString();
  }

  async function finish(job: JobRecord, status: JobStatus, reason: string, failure = false) {
    job.status = status;
    job.cancelReason = status === "canceled" || status === "skipped" ? reason : job.cancelReason;
    job.lastError = failure || status === "failed" || status === "uncertain" ? reason : job.lastError;
    job.claimToken = undefined;
    job.updatedAt = deps.now().toISOString();
    await deps.store.saveJob(job);
    await record(deps, job, failure ? "failure" : "skipped", reason, { error: reason });
  }

  async function processJob(claimed: JobRecord, clock = deps.now()): Promise<JobRecord> {
    const job = claimed;
    const org = await deps.loadOrg(job.organizationId);
    const automation = await deps.store.getAutomation(job.organizationId, job.automationId);
    const now = clock;

    if (!org || org.status !== "active") {
      await finish(job, "canceled", "business_inactive");
      return job;
    }
    if (!automation?.enabled) {
      await finish(job, "canceled", "automation_disabled");
      return job;
    }
    if (!isE164(job.customerPhoneE164)) {
      await finish(job, "failed", "invalid_phone", true);
      return job;
    }
    if (await deps.store.isSuppressed(job.organizationId, job.customerPhoneE164)) {
      await finish(job, "canceled", "opted_out");
      return job;
    }
    if (job.providerMessageSid) {
      await finish(job, "uncertain", "already_submitted");
      return job;
    }

    const config = automation.config;
    if (job.payload.attemptIndex > config.maxAttempts) {
      await finish(job, "skipped", "max_attempts");
      return job;
    }

    if (config.messageCategory === "marketing") {
      const recorded = await deps.store.latestConsent(
        job.organizationId,
        job.customerPhoneE164,
        "marketing",
      );
      if (recorded?.basis !== "express_consent") {
        await finish(job, "skipped", "legal_basis");
        return job;
      }
    } else if (job.payload.consentId) {
      const recorded = await deps.store.latestConsent(
        job.organizationId,
        job.customerPhoneE164,
        config.messageCategory,
      );
      if (!recorded) {
        await finish(job, "skipped", "legal_basis");
        return job;
      }
    } else {
      await finish(job, "skipped", "legal_basis");
      return job;
    }

    if (config.stopOnCustomerReply && job.payload.quoteStatus === "replied") {
      await finish(job, "canceled", "customer_reply");
      return job;
    }

    if (job.payload.quoteThreadId && (config.stopOnQuoteAccepted || config.stopOnQuoteRejected)) {
      let quote = job.simulated ? job.payload.quoteStatus : undefined;
      if (!job.simulated && deps.quoteStatus) {
        const live = await deps.quoteStatus(job.organizationId, job.payload.quoteThreadId);
        if (live === "won") quote = "accepted";
        else if (live === "lost") quote = "rejected";
        else if (live && live !== "active") quote = "replied";
        else if (live === "active") quote = "open";
      }
      if (quote === "accepted" && config.stopOnQuoteAccepted) {
        await finish(job, "canceled", "quote_accepted");
        return job;
      }
      if (quote === "rejected" && config.stopOnQuoteRejected) {
        await finish(job, "canceled", "quote_rejected");
        return job;
      }
      if (quote === "replied" && config.stopOnCustomerReply) {
        await finish(job, "canceled", "customer_reply");
        return job;
      }
    }

    if (job.payload.leadId && deps.leadState) {
      const lead = await deps.leadState(job.organizationId, job.payload.leadId);
      if (lead && ["closed", "won", "lost"].includes(lead.status)) {
        await finish(job, "canceled", "lead_closed");
        return job;
      }
      if (lead?.humanContact && config.stopOnHumanContact) {
        await finish(job, "canceled", "human_contact");
        return job;
      }
    }

    if (!isInsideSendingWindow(now, org.timezone || "America/Toronto", config)) {
      job.status = "pending";
      job.claimToken = undefined;
      job.claimedAt = undefined;
      job.scheduledAt = snap(now, org, config);
      job.updatedAt = now.toISOString();
      await deps.store.saveJob(job);
      await deps.store.addEvent({
        organizationId: job.organizationId,
        automationId: job.automationId,
        jobId: job.id,
        kind: "deferred_window",
        detail: job.scheduledAt,
        at: now.toISOString(),
      });
      return job;
    }

    const template = await deps.store.getTemplate(
      job.organizationId,
      job.payload.templateKey,
      job.payload.locale,
    );
    const source =
      template?.body ??
      DEFAULT_TEMPLATES[job.payload.templateKey][job.payload.locale];
    const rendered = renderTemplate({
      body: source,
      locale: job.payload.locale,
      vars: job.payload.vars,
      businessName: org.name,
    });
    if (rendered.missing.length > 0 || !org.name.trim()) {
      await finish(job, "failed", "template_incomplete", true);
      return job;
    }
    job.payload.renderedBody = rendered.body;

    if (job.simulated) {
      const at = now.toISOString();
      job.status = "submitted";
      job.providerMessageSid = `SIM_${job.id}`;
      job.submittedAt = at;
      job.responseStatus = "awaiting";
      job.claimToken = undefined;
      job.updatedAt = at;
      await deps.store.saveJob(job);
      await record(deps, job, "success", "simulated", {
        body: rendered.body,
        sid: job.providerMessageSid,
      });
      await deps.onCustomerMessage?.({
        organizationId: job.organizationId,
        phoneE164: job.customerPhoneE164,
        body: rendered.body,
        direction: "outbound",
        automated: true,
        simulated: true,
        customerName: job.payload.customerName,
        leadId: job.payload.leadId,
        locale: job.payload.locale,
        providerMessageSid: job.providerMessageSid,
        optOut: false,
        serviceName: job.payload.serviceName,
      });
      return job;
    }

    const from = await deps.smsFrom(job.organizationId);
    if (!from || !isE164(from)) {
      await finish(job, "failed", "missing_sender", true);
      return job;
    }

    try {
      const sent = await deps.sms.send({
        toE164: job.customerPhoneE164,
        fromE164: from,
        body: rendered.body,
      });
      const at = deps.now().toISOString();
      job.status = "submitted";
      job.providerMessageSid = sent.sid;
      job.submittedAt = at;
      job.responseStatus = "awaiting";
      job.claimToken = undefined;
      job.updatedAt = at;
      await deps.store.saveJob(job);
      await record(deps, job, "success", "submitted", {
        body: rendered.body,
        sid: sent.sid,
      });
      await deps.onCustomerMessage?.({
        organizationId: job.organizationId,
        phoneE164: job.customerPhoneE164,
        body: rendered.body,
        direction: "outbound",
        automated: true,
        simulated: false,
        customerName: job.payload.customerName,
        leadId: job.payload.leadId,
        locale: job.payload.locale,
        providerMessageSid: sent.sid,
        optOut: false,
        serviceName: job.payload.serviceName,
      });
      return job;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = providerFailure(message);
      job.attempts += 1;
      job.lastError = message.slice(0, 500);
      job.updatedAt = deps.now().toISOString();
      if (kind === "uncertain" || (kind === "retry" && job.attempts >= MAX_PROVIDER_ATTEMPTS) || kind === "permanent") {
        job.status = kind === "uncertain" ? "uncertain" : "failed";
        job.claimToken = undefined;
        await deps.store.saveJob(job);
        await record(deps, job, "failure", job.status, { error: job.lastError });
        return job;
      }
      const backoff = [1, 5, 15][job.attempts - 1] ?? 15;
      job.status = "pending";
      job.claimToken = undefined;
      job.claimedAt = undefined;
      job.scheduledAt = new Date(deps.now().getTime() + backoff * 60 * 1000).toISOString();
      await deps.store.saveJob(job);
      await record(deps, job, "retry", "retry", { error: job.lastError });
      return job;
    }
  }

  return {
    ensureDefaults: seed,

    async list(organizationId: string) {
      await seed(organizationId);
      return deps.store.listAutomations(organizationId);
    },

    async update(
      organizationId: string,
      automationId: string,
      patch: Partial<AutomationConfig>,
    ) {
      await seed(organizationId);
      const current = await deps.store.getAutomation(organizationId, automationId);
      if (!current) throw new AutomationError("Automation not found.", 404);
      const merged = mergeConfig(current.type, { ...current.config, ...patch });
      if (merged.errors.length > 0) {
        throw new AutomationError(`Invalid settings: ${merged.errors.join(", ")}`);
      }
      const saved = await deps.store.upsertAutomation({
        ...current,
        config: merged.config,
        updatedAt: deps.now().toISOString(),
      });
      return saved;
    },

    async activate(organizationId: string, automationId: string) {
      await seed(organizationId);
      const current = await deps.store.getAutomation(organizationId, automationId);
      if (!current) throw new AutomationError("Automation not found.", 404);
      if (!OPERATIONAL_AUTOMATION_TYPES.includes(current.type)) {
        throw new AutomationError("This workflow is not operational yet.", 409);
      }
      const saved = await deps.store.upsertAutomation({
        ...current,
        enabled: true,
        updatedAt: deps.now().toISOString(),
      });
      await deps.store.addEvent({
        organizationId,
        automationId: saved.id,
        kind: "activated",
        at: deps.now().toISOString(),
      });
      if (saved.type === "quote_followup" && deps.listOpenQuotes) {
        const quotes = await deps.listOpenQuotes(organizationId);
        for (const quote of quotes) {
          if (quote.status !== "active") continue;
          await this.scheduleQuoteFollowUps({
            organizationId,
            threadId: quote.id,
            phoneE164: quote.customerPhoneE164,
            customerName: quote.customerName,
            quoteRef: quote.quoteRef,
            locale: quote.locale,
            quoteSentAt: quote.quoteSentAt,
            serviceName: quote.serviceName,
            simulated: false,
          });
        }
      }
      return saved;
    },

    async deactivate(organizationId: string, automationId: string) {
      const current = await deps.store.getAutomation(organizationId, automationId);
      if (!current) throw new AutomationError("Automation not found.", 404);
      const saved = await deps.store.upsertAutomation({
        ...current,
        enabled: false,
        updatedAt: deps.now().toISOString(),
      });
      const canceled = await deps.store.cancelPending({
        organizationId,
        automationId: saved.id,
        reason: "automation_disabled",
      });
      await deps.store.addEvent({
        organizationId,
        automationId: saved.id,
        kind: "deactivated",
        detail: String(canceled),
        at: deps.now().toISOString(),
      });
      return { automation: saved, canceled };
    },

    async listTemplates(organizationId: string) {
      await seed(organizationId);
      return deps.store.listTemplates(organizationId);
    },

    async updateTemplate(
      organizationId: string,
      templateId: string,
      input: { body?: string; reset?: boolean },
    ) {
      await seed(organizationId);
      const all = await deps.store.listTemplates(organizationId);
      const current = all.find((t) => t.id === templateId);
      if (!current) throw new AutomationError("Template not found.", 404);
      const body = input.reset
        ? DEFAULT_TEMPLATES[current.templateKey][current.locale]
        : (input.body ?? "").trim();
      const errors = validateTemplate(body, current.locale);
      if (errors.length > 0) {
        throw new AutomationError(`Template rejected: ${errors.join(", ")}`);
      }
      return deps.store.upsertTemplate({
        ...current,
        body,
        customized: !input.reset,
        updatedAt: deps.now().toISOString(),
      });
    },

    async preview(input: {
      organizationId: string;
      templateKey: TemplateKey;
      locale: "en" | "fr";
      body?: string;
      vars?: Record<string, string>;
    }) {
      const org = await requireOrg(input.organizationId);
      const stored = await deps.store.getTemplate(
        input.organizationId,
        input.templateKey,
        input.locale,
      );
      const body = input.body ?? stored?.body ?? DEFAULT_TEMPLATES[input.templateKey][input.locale];
      const errors = validateTemplate(body, input.locale);
      const rendered = renderTemplate({
        body,
        locale: input.locale,
        vars: {
          customer_name: "John",
          service_name: "water heater repair",
          quote_ref: "Q-1200",
          appointment_time: "tomorrow at 10:00",
          ...input.vars,
        },
        businessName: org.name,
      });
      return { errors, ...rendered, source: body };
    },

    async listJobs(organizationId: string) {
      return deps.store.listJobs(organizationId, 100);
    },

    async cancelJob(organizationId: string, jobId: string) {
      const job = await deps.store.getJob(organizationId, jobId);
      if (!job) throw new AutomationError("Job not found.", 404);
      if (job.providerMessageSid || ["submitted", "sent", "delivered"].includes(job.status)) {
        throw new AutomationError(
          "This message was already submitted to the provider and cannot be retracted.",
          409,
        );
      }
      if (job.status === "canceled") return job;
      job.status = "canceled";
      job.cancelReason = "manual";
      job.updatedAt = deps.now().toISOString();
      await deps.store.saveJob(job);
      await deps.store.addEvent({
        organizationId,
        automationId: job.automationId,
        jobId: job.id,
        kind: "manual_cancel",
        at: job.updatedAt,
      });
      return job;
    },

    async history(organizationId: string): Promise<HistoryRow[]> {
      return deps.store.listHistory(organizationId, 100);
    },

    async scheduleMissedCall(input: {
      organizationId: string;
      callId: string;
      callerE164: string;
      disposition: string;
      customerName?: string;
      language?: "en" | "fr";
      leadId?: string;
      serviceName?: string;
      simulated?: boolean;
    }) {
      const automation = await deps.store.getAutomationByType(
        input.organizationId,
        "missed_call_recovery",
      );
      if (!automation?.enabled) {
        return { deferred: false, scheduled: false, reason: "disabled" as const };
      }
      const handled =
        input.disposition === "answered" || input.disposition === "abandoned";
      if (handled) {
        return { deferred: true, scheduled: false, reason: "call_handled" as const, job: null };
      }
      const org = await requireOrg(input.organizationId);
      const phone = normalizeE164(input.callerE164);
      if (!isE164(phone) || (await deps.store.isSuppressed(input.organizationId, phone))) {
        return { deferred: true, scheduled: false, reason: "ineligible" as const, job: null };
      }
      if (automation.config.duplicateProtection) {
        const since = new Date(deps.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
        const recent = await deps.store.findRecentJob({
          organizationId: input.organizationId,
          automationType: "missed_call_recovery",
          phoneE164: phone,
          sinceIso: since,
        });
        if (recent) {
          return {
            deferred: true,
            scheduled: false,
            reason: "duplicate" as const,
            job: recent,
          };
        }
      }
      const existing = await deps.store.getJobByIdempotency(
        input.organizationId,
        `mcr:${input.callId}`,
      );
      if (existing) {
        return { deferred: true, scheduled: false, reason: "duplicate" as const, job: existing };
      }
      const locale = resolveLocale(automation.config, org, input.language);
      const templateKey: TemplateKey =
        input.disposition === "after_hours_missed" ? "after_hours" : "missed_call_recovery";
      const recorded = await consent({
        organizationId: input.organizationId,
        phone,
        category: "inquiry_response",
        evidence: `Inbound call ${input.callId} was not answered. Recovery is a direct response to that inquiry, not a promotion.`,
      });
      const when = snap(
        new Date(deps.now().getTime() + automation.config.initialDelayMinutes * 60 * 1000),
        org,
        automation.config,
      );
      const job = await placeJob({
        organizationId: input.organizationId,
        automation,
        phone,
        idempotencyKey: `mcr:${input.callId}`,
        scheduledAt: when,
        simulated: Boolean(input.simulated),
        payload: {
          customerName: input.customerName,
          templateKey,
          locale,
          vars: {
            customer_name: input.customerName ?? "",
            business_name: org.name,
            service_name: input.serviceName ?? "",
          },
          leadId: input.leadId,
          callId: input.callId,
          attemptIndex: 1,
          messageCategory: "inquiry_response",
          consentId: recorded.id,
          serviceName: input.serviceName,
          disposition: input.disposition,
        },
      });
      return { deferred: true, scheduled: Boolean(job), reason: "scheduled" as const, job };
    },

    async scheduleQuoteFollowUps(input: {
      organizationId: string;
      threadId: string;
      phoneE164: string;
      customerName?: string;
      quoteRef?: string;
      locale?: "en" | "fr";
      quoteSentAt: string;
      serviceName?: string;
      leadId?: string;
      simulated?: boolean;
    }) {
      const automation = await deps.store.getAutomationByType(
        input.organizationId,
        "quote_followup",
      );
      if (!automation?.enabled) return { scheduled: false as const, jobs: [] as JobRecord[] };
      const org = await requireOrg(input.organizationId);
      const phone = normalizeE164(input.phoneE164);
      if (!isE164(phone) || (await deps.store.isSuppressed(input.organizationId, phone))) {
        if (!input.threadId.startsWith("sim_")) {
          await deps.clearQuoteSchedule?.(input.organizationId, input.threadId);
        }
        return { scheduled: true as const, jobs: [] as JobRecord[] };
      }
      const locale = resolveLocale(automation.config, org, input.locale);
      const recorded = await consent({
        organizationId: input.organizationId,
        phone,
        category: "requested_estimate",
        evidence: `Quote ${input.quoteRef ?? input.threadId} was sent to the customer. Reminders are limited service follow-ups for that estimate.`,
      });
      const sentAt = Date.parse(input.quoteSentAt);
      const delays = [automation.config.initialDelayMinutes];
      if (automation.config.maxAttempts >= 2) {
        delays.push(
          automation.config.secondDelayMinutes ??
            automation.config.initialDelayMinutes + 2 * 24 * 60,
        );
      }
      const keys: TemplateKey[] = ["quote_followup_1", "quote_followup_2"];
      const jobs: JobRecord[] = [];
      for (let i = 0; i < Math.min(delays.length, automation.config.maxAttempts); i++) {
        let at = new Date(sentAt + delays[i]! * 60 * 1000);
        if (at.getTime() < deps.now().getTime()) at = deps.now();
        const scheduledAt = snap(at, org, automation.config);
        const created = await placeJob({
          organizationId: input.organizationId,
          automation,
          phone,
          idempotencyKey: `qf:${input.threadId}:${i + 1}`,
          scheduledAt,
          simulated: Boolean(input.simulated),
          payload: {
            customerName: input.customerName,
            templateKey: keys[i] ?? "quote_followup_2",
            locale,
            vars: {
              customer_name: input.customerName ?? "",
              business_name: org.name,
              service_name: input.serviceName ?? "",
              quote_ref: input.quoteRef ?? "",
            },
            leadId: input.leadId,
            quoteThreadId: input.threadId,
            attemptIndex: i + 1,
            messageCategory: "requested_estimate",
            consentId: recorded.id,
            serviceName: input.serviceName,
            quoteStatus: "open",
          },
        });
        if (created) jobs.push(created);
      }
      if (!input.threadId.startsWith("sim_")) {
        await deps.clearQuoteSchedule?.(input.organizationId, input.threadId);
      }
      return { scheduled: true as const, jobs };
    },

    async cancelQuote(organizationId: string, threadId: string, reason: string) {
      return deps.store.cancelPending({
        organizationId,
        quoteThreadId: threadId,
        reason,
      });
    },

    async processDue(input?: { organizationId?: string; limit?: number }) {
      const limit = input?.limit ?? 25;
      const processed: JobRecord[] = [];
      for (let i = 0; i < limit; i++) {
        const claimed = await deps.store.claimNext({
          nowIso: deps.now().toISOString(),
          organizationId: input?.organizationId,
        });
        if (!claimed) break;
        processed.push(await processJob(claimed));
      }
      return { processed: processed.length, jobs: processed };
    },

    async runNextSimulated(organizationId: string) {
      const jobs = await deps.store.listJobs(organizationId, 100);
      const next = jobs
        .filter((j) => j.simulated && j.status === "pending")
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
      if (!next) return { job: null as JobRecord | null };
      const claimed = await deps.store.claimNext({
        nowIso: next.scheduledAt,
        organizationId,
        simulatedOnly: true,
        forceJobId: next.id,
      });
      if (!claimed) return { job: null as JobRecord | null };
      return { job: await processJob(claimed, new Date(next.scheduledAt)) };
    },

    async applyDeliveryStatus(input: {
      providerSid: string;
      providerStatus: string;
      price?: string;
      priceUnit?: string;
      eventId: string;
    }) {
      const fresh = await deps.store.claimWebhook("twilio_status", input.eventId);
      if (!fresh) return { duplicate: true as const, job: null };
      const job = await deps.store.getJobByProviderSid(input.providerSid);
      if (!job) return { duplicate: false as const, job: null };
      const next = nextDeliveryStatus(job.status, input.providerStatus);
      if (!next) return { duplicate: false as const, job };
      job.status = next;
      if (input.price) job.price = input.price;
      if (input.priceUnit) job.priceUnit = input.priceUnit;
      job.updatedAt = deps.now().toISOString();
      if (next === "failed" || next === "undelivered") {
        job.lastError = input.providerStatus;
        await deps.store.bumpStats(job.organizationId, job.automationId, {
          failure: 1,
          lastStatus: next,
          lastAt: job.updatedAt,
        });
      } else {
        await deps.store.bumpStats(job.organizationId, job.automationId, {
          lastStatus: next,
          lastAt: job.updatedAt,
        });
      }
      await deps.store.saveJob(job);
      return { duplicate: false as const, job };
    },

    async applyInbound(input: {
      organizationId: string;
      fromE164: string;
      body: string;
      messageSid?: string;
      simulated?: boolean;
      customerName?: string;
      skipCrm?: boolean;
    }) {
      if (input.messageSid) {
        const fresh = await deps.store.claimWebhook(
          "twilio_sms",
          `${input.organizationId}:${input.messageSid}`,
        );
        if (!fresh) return { duplicate: true as const, optedOut: false, paused: 0 };
      }
      const phone = normalizeE164(input.fromE164);
      const optOut = isOptOut(input.body, OPT_OUT_CLIENT);
      if (optOut) {
        const now = deps.now().toISOString();
        await deps.store.addSuppression({
          id: createId("sup"),
          organizationId: input.organizationId,
          phoneE164: phone,
          phoneKey: phoneKey(phone),
          reason: "stop",
          source: "customer_keyword",
          createdAt: now,
        });
        await deps.mirrorSuppression?.(input.organizationId, phone);
        const from = await deps.smsFrom(input.organizationId);
        if (from) {
          await deps.sms.syncOptOut?.({ phoneE164: phone, fromE164: from });
        }
      }
      let paused = 0;
      const pending = await deps.store.listPendingByPhone(input.organizationId, phone);
      for (const job of pending) {
        const automation = await deps.store.getAutomation(
          input.organizationId,
          job.automationId,
        );
        const stop = optOut || automation?.config.stopOnCustomerReply !== false;
        if (!stop) continue;
        paused += await deps.store.cancelPending({
          organizationId: input.organizationId,
          automationId: job.automationId,
          phoneE164: phone,
          reason: optOut ? "opt_out" : "customer_reply",
        });
      }
      const after = await deps.store.listJobs(input.organizationId, 100);
      const matches = after.filter(
        (job) => phoneKey(job.customerPhoneE164) === phoneKey(phone),
      );
      const anchor =
        matches.find((job) =>
          ["submitted", "sent", "delivered"].includes(job.status),
        ) ?? matches[0];
      if (anchor) {
        anchor.responseStatus = optOut ? "opted_out" : "replied";
        anchor.updatedAt = deps.now().toISOString();
        if (anchor.payload.quoteThreadId) {
          anchor.payload.quoteStatus = "replied";
        }
        await deps.store.saveJob(anchor);
        await deps.store.bumpStats(input.organizationId, anchor.automationId, {
          response: 1,
          lastStatus: anchor.responseStatus,
          lastAt: anchor.updatedAt,
        });
        if (anchor.payload.quoteThreadId && !anchor.payload.quoteThreadId.startsWith("sim_")) {
          await deps.stopQuoteThread?.(
            input.organizationId,
            anchor.payload.quoteThreadId,
            optOut ? "opt_out" : "customer_reply",
          );
        }
      }
      const captured = await deps.onCustomerMessage?.({
        organizationId: input.organizationId,
        phoneE164: phone,
        body: input.body,
        direction: "inbound",
        automated: false,
        simulated: Boolean(input.simulated),
        customerName: input.customerName ?? anchor?.payload.customerName,
        leadId: anchor?.payload.leadId,
        locale: anchor?.payload.locale,
        providerMessageSid: input.messageSid,
        optOut,
        serviceName: anchor?.payload.serviceName,
        recordMessage: !input.skipCrm,
      });
      const leadId = captured && "leadId" in captured ? captured.leadId : anchor?.payload.leadId;
      if (leadId && anchor && !anchor.payload.leadId) {
        const current = await deps.store.getJob(input.organizationId, anchor.id);
        if (current) {
          current.payload.leadId = leadId;
          await deps.store.saveJob(current);
        }
      }
      await deps.notifyContractor?.({
        organizationId: input.organizationId,
        title: input.customerName || anchor?.payload.customerName || phone,
        reason: optOut ? "Customer opted out (STOP)" : "Customer replied to an automated text",
        kind: anchor?.automationType === "quote_followup" ? "quote" : "missed_call",
        refId: anchor?.payload.quoteThreadId || anchor?.payload.callId || anchor?.id || phone,
      });
      return { duplicate: false as const, optedOut: optOut, paused, leadId };
    },

    async setQuoteOutcome(
      organizationId: string,
      threadId: string,
      outcome: "accepted" | "rejected",
    ) {
      const jobs = await deps.store.listJobs(organizationId, 100);
      for (const job of jobs) {
        if (job.payload.quoteThreadId !== threadId) continue;
        job.payload.quoteStatus = outcome;
        if (job.status === "pending" || job.status === "processing") {
          job.status = "canceled";
          job.cancelReason = outcome === "accepted" ? "quote_accepted" : "quote_rejected";
        }
        job.updatedAt = deps.now().toISOString();
        await deps.store.saveJob(job);
      }
      if (!threadId.startsWith("sim_")) {
        await deps.stopQuoteThread?.(
          organizationId,
          threadId,
          outcome === "accepted" ? "won" : "lost",
        );
      }
      return deps.store.cancelPending({
        organizationId,
        quoteThreadId: threadId,
        reason: outcome === "accepted" ? "quote_accepted" : "quote_rejected",
      });
    },

    async simulateMissedCall(input: {
      organizationId: string;
      phoneE164: string;
      customerName?: string;
      language?: "en" | "fr";
      serviceName?: string;
    }) {
      const automation = await deps.store.getAutomationByType(
        input.organizationId,
        "missed_call_recovery",
      );
      if (!automation?.enabled) {
        throw new AutomationError("Enable missed-call recovery before simulating.", 409);
      }
      const callId = createId("simcall");
      const captured = await deps.onCustomerMessage?.({
        organizationId: input.organizationId,
        phoneE164: normalizeE164(input.phoneE164),
        body: "Simulated missed call",
        direction: "inbound",
        automated: false,
        simulated: true,
        customerName: input.customerName,
        locale: input.language,
        optOut: false,
        serviceName: input.serviceName,
      });
      return this.scheduleMissedCall({
        organizationId: input.organizationId,
        callId,
        callerE164: input.phoneE164,
        disposition: "missed",
        customerName: input.customerName,
        language: input.language,
        serviceName: input.serviceName,
        leadId: captured && "leadId" in captured ? captured.leadId : undefined,
        simulated: true,
      });
    },

    async simulateQuote(input: {
      organizationId: string;
      phoneE164: string;
      customerName?: string;
      quoteRef?: string;
      locale?: "en" | "fr";
      serviceName?: string;
    }) {
      const automation = await deps.store.getAutomationByType(
        input.organizationId,
        "quote_followup",
      );
      if (!automation?.enabled) {
        throw new AutomationError("Enable quote follow-up before simulating.", 409);
      }
      const threadId = createId("simquote");
      return this.scheduleQuoteFollowUps({
        organizationId: input.organizationId,
        threadId,
        phoneE164: input.phoneE164,
        customerName: input.customerName,
        quoteRef: input.quoteRef,
        locale: input.locale,
        quoteSentAt: deps.now().toISOString(),
        serviceName: input.serviceName ?? "plumbing",
        simulated: true,
      });
    },

    async sendLiveTest(input: { organizationId: string; templateKey?: TemplateKey }) {
      const org = await requireOrg(input.organizationId);
      if (org.accountType === "demo") {
        throw new AutomationError("Live SMS is blocked on demo businesses.", 403);
      }
      if (!org.phoneE164 || !isE164(org.phoneE164)) {
        throw new AutomationError("Set the business phone before a live test.", 409);
      }
      if (deps.smsMode !== "live") {
        throw new AutomationError("SMS is in dry-run mode. No handset will be contacted.", 409);
      }
      const automation = await deps.store.getAutomationByType(
        input.organizationId,
        "missed_call_recovery",
      );
      if (!automation?.enabled) {
        throw new AutomationError("Enable missed-call recovery first.", 409);
      }
      const result = await this.scheduleMissedCall({
        organizationId: input.organizationId,
        callId: createId("livetest"),
        callerE164: org.phoneE164,
        disposition: "missed",
        customerName: org.name,
        language: org.localeDefault,
        simulated: false,
      });
      if (!result.job) return result;
      result.job.scheduledAt = deps.now().toISOString();
      await deps.store.saveJob(result.job);
      const claimed = await deps.store.claimNext({
        nowIso: deps.now().toISOString(),
        organizationId: input.organizationId,
        forceJobId: result.job.id,
      });
      if (!claimed) return result;
      const job = await processJob(claimed);
      return { ...result, job };
    },
  };
}

export type AutomationService = ReturnType<typeof createAutomationService>;

export function templateById(templates: TemplateRecord[], id: string) {
  return templates.find((t) => t.id === id) ?? null;
}
