import { createId } from "@/lib/id";
import { shouldStartRecovery } from "@/product/missed-call/call-handling";
import { isOptOut } from "@/product/missed-call/messaging";
import {
  missedCallRecoveryMaxAgeMs,
  missedCallRecoverySmsDisabled,
} from "@/product/missed-call/recovery-switch";
import { SmsDeliveryError, SmsRateLimitError } from "@/product/missed-call/twilio";
import type { CallDisposition, ClientAccount } from "@/product/missed-call/types";
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
  ConsentBasis,
  ConsentRecord,
  ExecutionRecord,
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
/** Minutes to wait before attempt 2, 3, ... after a failure that is safe to retry. */
const RETRY_BACKOFF_MINUTES = [1, 5, 15];
/** A quote reminder this far past its due time is not sent: the moment has gone. */
const LATE_REMINDER_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;
/** Tries to write down that a text was sent, before giving up and flagging it. */
const RECORD_SEND_TRIES = 3;

export class AutomationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    /** Which settings were refused, for the screen to name them. */
    readonly fields: string[] = [],
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
  /**
   * True when this number has opted out through another channel (the missed-call
   * workflow's own list). Checked next to the automation's own list.
   */
  isSuppressedElsewhere?: (organizationId: string, phoneE164: string) => Promise<boolean>;
  onPermanentFailure?: (organizationId: string, detail: string) => Promise<void>;
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

/**
 * What a failed send means for the next step. The telephone port says it itself
 * (`SmsDeliveryError.disposition`): "retry" means the provider did not take the message,
 * "dead" that it never will, "uncertain" that it may have. Anything the port did not
 * classify is treated as uncertain, because a timeout or a dropped connection can come
 * after the provider already accepted the text, and sending again would text the
 * customer twice.
 */
function providerFailure(err: unknown, now: number): {
  kind: "retry" | "permanent" | "uncertain";
  /** Earliest time to try again (retry only). */
  notBefore?: number;
} {
  if (err instanceof SmsRateLimitError) {
    return { kind: "retry", notBefore: Math.max(err.resetAt, now + 5_000) };
  }
  if (err instanceof SmsDeliveryError) {
    if (err.disposition === "retry") return { kind: "retry" };
    if (err.disposition === "dead") return { kind: "permanent" };
    return { kind: "uncertain" };
  }
  return { kind: "uncertain" };
}

function retryDelayMs(attempt: number): number {
  const minutes = RETRY_BACKOFF_MINUTES[attempt - 1] ?? RETRY_BACKOFF_MINUTES.at(-1)!;
  // Up to 20% later, so a burst of jobs that failed together does not come back together.
  return minutes * 60_000 * (1 + Math.random() * 0.2);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

  /**
   * Makes sure the business has its default automations and templates, then lists the
   * automations in a fixed order (the stores order differently). One insert-only call:
   * it never changes a row that exists, so it is safe to run on every request, and two
   * of them at once cannot reset a setting.
   */
  async function seed(organizationId: string): Promise<AutomationRecord[]> {
    const now = deps.now().toISOString();
    await deps.store.ensureDefaults({
      automations: AUTOMATION_TYPES.map((type) => ({
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
      })),
      templates: TEMPLATE_KEYS.flatMap((templateKey) =>
        (["en", "fr"] as const).map((locale) => ({
          id: createId("tpl"),
          organizationId,
          templateKey,
          locale,
          body: DEFAULT_TEMPLATES[templateKey][locale],
          customized: false,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    });
    const rows = await deps.store.listAutomations(organizationId);
    return rows.sort(
      (a, b) => AUTOMATION_TYPES.indexOf(a.type) - AUTOMATION_TYPES.indexOf(b.type),
    );
  }

  /** Bookkeeping that must never undo or hide what already happened (a text that went out). */
  async function safely(label: string, task: () => Promise<unknown>) {
    try {
      await task();
    } catch (err) {
      console.error(
        `[sms-automation] ${label} failed`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** The suppression lists that apply: this automation's own, and the call workflow's. */
  async function isOptedOut(organizationId: string, phone: string): Promise<boolean> {
    if (await deps.store.isSuppressed(organizationId, phone)) return true;
    return Boolean(await deps.isSuppressedElsewhere?.(organizationId, phone));
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

  /**
   * Runs one claimed job. It never throws and never leaves a claimed job behind without a
   * decision: whatever goes wrong inside `run` is turned into a recorded outcome here.
   *  - Before the provider was called, the job goes back in the queue (with a growing wait,
   *    and a limit), or fails for good.
   *  - Once the send may have started, the job is `uncertain` and is never sent again.
   */
  async function processJob(claimed: JobRecord, clock = deps.now()): Promise<JobRecord> {
    try {
      return await run(claimed, clock);
    } catch (err) {
      return settleAfterError(claimed, err);
    }
  }

  async function settleAfterError(job: JobRecord, err: unknown): Promise<JobRecord> {
    const message = `unexpected_error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
    // No phone number or message text in logs.
    console.error("[sms-automation] job failed unexpectedly", {
      jobId: job.id,
      organizationId: job.organizationId,
      error: message,
    });
    try {
      job.updatedAt = deps.now().toISOString();
      job.lastError = message;
      job.claimToken = undefined;
      if (job.payload.sendStartedAt || job.providerMessageSid) {
        // The provider may have the text already. Do not send it again.
        job.status = job.providerMessageSid ? "submitted" : "uncertain";
        await deps.store.saveJob(job);
        if (job.status === "uncertain") await record(deps, job, "failure", "uncertain", { error: message });
        return job;
      }
      job.attempts += 1;
      if (job.attempts >= MAX_PROVIDER_ATTEMPTS) {
        job.status = "failed";
        await deps.store.saveJob(job);
        await record(deps, job, "failure", "failed", { error: message });
        await safely("failure notice", async () =>
          deps.onPermanentFailure?.(job.organizationId, "automation_failed"),
        );
        return job;
      }
      job.status = "pending";
      job.claimedAt = undefined;
      job.scheduledAt = new Date(deps.now().getTime() + retryDelayMs(job.attempts)).toISOString();
      await deps.store.saveJob(job);
      await record(deps, job, "retry", "retry", { error: message });
    } catch (inner) {
      // The database is not answering. The job stays claimed; after ten minutes it is
      // released (or, if a send had started, flagged), never sent twice.
      console.error(
        "[sms-automation] could not settle a failed job",
        inner instanceof Error ? inner.message : String(inner),
      );
    }
    return job;
  }

  /** Writes down that the provider took the text. Retried, because losing this is how a duplicate is born. */
  async function recordSubmitted(job: JobRecord) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RECORD_SEND_TRIES; attempt++) {
      try {
        await deps.store.saveJob(job);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < RECORD_SEND_TRIES) await sleep(50 * attempt * attempt);
      }
    }
    throw lastError;
  }

  async function run(job: JobRecord, clock: Date): Promise<JobRecord> {
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
    if (await isOptedOut(job.organizationId, job.customerPhoneE164)) {
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

    if (job.payload.quoteThreadId) {
      const stop = await quoteStopReason(job, config);
      if (stop) {
        await finish(job, "canceled", stop);
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

    // "Sorry we missed your call" answers the caller's own call, so it goes out right away
    // and is not held for the sending window (that held evening calls until 8 a.m.). The
    // operator can still switch it off, and a text that has waited too long is useless, so
    // it is dropped rather than sent hours late. An owner who wants no texts during quiet
    // hours can ask for that: the text is then skipped, never delayed.
    const immediate = job.automationType === "missed_call_recovery";
    const timezone = org.timezone || "America/Toronto";
    if (immediate && !job.simulated) {
      if (missedCallRecoverySmsDisabled()) {
        await finish(job, "canceled", "recovery_sms_disabled");
        return job;
      }
      const age = now.getTime() - Date.parse(job.createdAt);
      if (Number.isFinite(age) && age > missedCallRecoveryMaxAgeMs()) {
        await finish(job, "skipped", "stale");
        return job;
      }
    }
    if (immediate && config.respectQuietHours && !isInsideSendingWindow(now, timezone, config)) {
      await finish(job, "skipped", "quiet_hours");
      return job;
    }

    if (!immediate && !isInsideSendingWindow(now, timezone, config)) {
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

    // Last gate before the provider. This records that a send has started, and only if
    // this worker still holds the job: a job turned off, canceled or taken over since it
    // was claimed is not sent. Past this line a crash can no longer put the job back in
    // the queue; it is flagged for a person instead.
    const startedAt = deps.now().toISOString();
    if (!(await deps.store.beginSend(job, startedAt))) {
      await deps.store.addEvent({
        organizationId: job.organizationId,
        automationId: job.automationId,
        jobId: job.id,
        kind: "claim_lost",
        at: startedAt,
      });
      return job;
    }
    job.payload.sendStartedAt = startedAt;

    let sent: { sid: string };
    try {
      sent = await deps.sms.send({
        toE164: job.customerPhoneE164,
        fromE164: from,
        body: rendered.body,
      });
    } catch (err) {
      return settleSendFailure(job, err);
    }

    const at = deps.now().toISOString();
    job.status = "submitted";
    job.providerMessageSid = sent.sid;
    job.submittedAt = at;
    job.responseStatus = "awaiting";
    job.claimToken = undefined;
    job.updatedAt = at;
    await recordSubmitted(job);
    // The text is out and the job says so. What follows is bookkeeping: a failure there is
    // logged, and must not turn a delivered text into a failed or repeated one.
    await safely("execution log", () =>
      record(deps, job, "success", "submitted", { body: rendered.body, sid: sent.sid }),
    );
    await safely("customer record", async () =>
      deps.onCustomerMessage?.({
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
      }),
    );
    return job;
  }

  async function settleSendFailure(job: JobRecord, err: unknown): Promise<JobRecord> {
    const nowMs = deps.now().getTime();
    const failure = providerFailure(err, nowMs);
    // Only the error's class is kept: provider text can carry phone numbers.
    const detail =
      err instanceof SmsDeliveryError
        ? err.message
        : err instanceof SmsRateLimitError
          ? "rate_limited"
          : "send_outcome_unknown";
    job.attempts += 1;
    job.lastError = detail.slice(0, 500);
    job.updatedAt = new Date(nowMs).toISOString();

    if (failure.kind === "uncertain") {
      job.status = "uncertain";
      job.claimToken = undefined;
      await deps.store.saveJob(job);
      await record(deps, job, "failure", "uncertain", { error: job.lastError });
      return job;
    }
    if (failure.kind === "permanent" || job.attempts >= MAX_PROVIDER_ATTEMPTS) {
      delete job.payload.sendStartedAt;
      job.status = "failed";
      job.claimToken = undefined;
      await deps.store.saveJob(job);
      await record(deps, job, "failure", "failed", { error: job.lastError });
      await safely("failure notice", async () =>
        deps.onPermanentFailure?.(job.organizationId, "automation_failed"),
      );
      return job;
    }
    // The provider did not take the text, so asking again cannot duplicate it.
    delete job.payload.sendStartedAt;
    job.status = "pending";
    job.claimToken = undefined;
    job.claimedAt = undefined;
    job.scheduledAt = new Date(
      Math.max(nowMs + retryDelayMs(job.attempts), failure.notBefore ?? 0),
    ).toISOString();
    await deps.store.saveJob(job);
    await record(deps, job, "retry", "retry", { error: job.lastError });
    return job;
  }

  /**
   * Why a quote reminder must not go out, from the quote itself, or null when it may.
   * An accepted, rejected, stopped or vanished quote always stops it: the owner's
   * settings only decide what to do when the customer replies or a person takes over.
   */
  async function quoteStopReason(
    job: JobRecord,
    config: AutomationConfig,
  ): Promise<string | null> {
    if (job.simulated) {
      const quote = job.payload.quoteStatus;
      if (quote === "accepted") return "quote_accepted";
      if (quote === "rejected") return "quote_rejected";
      if (quote === "replied" && config.stopOnCustomerReply) return "customer_reply";
      return null;
    }
    if (!deps.quoteStatus) return null;
    const live = await deps.quoteStatus(job.organizationId, job.payload.quoteThreadId!);
    if (live === null || live === undefined) return "quote_not_found";
    if (live === "won") return "quote_accepted";
    if (live === "lost") return "quote_rejected";
    if (live === "stopped") return "quote_stopped";
    if (live !== "active" && (config.stopOnCustomerReply || config.stopOnHumanContact)) {
      return "customer_reply";
    }
    return null;
  }

  return {
    ensureDefaults: seed,

    async list(organizationId: string) {
      return seed(organizationId);
    },

    async update(
      organizationId: string,
      automationId: string,
      patch: Partial<AutomationConfig>,
    ) {
      await seed(organizationId);
      // Replaces the settings only, under a row lock: a toggle that lands at the same
      // moment keeps its value, and two saves cannot interleave halfway.
      const saved = await deps.store.updateAutomationConfig(
        organizationId,
        automationId,
        (current) => {
          const merged = mergeConfig(current.type, { ...current.config, ...patch });
          if (merged.errors.length > 0) {
            throw new AutomationError(
              `Invalid settings: ${merged.errors.join(", ")}`,
              400,
              merged.errors,
            );
          }
          return merged.config;
        },
        deps.now().toISOString(),
      );
      if (!saved) throw new AutomationError("Automation not found.", 404);
      return saved;
    },

    /**
     * Turns the automation on. Safe to repeat: a second call finds it already on and does
     * nothing but make sure the open quotes are scheduled.
     */
    async activate(organizationId: string, automationId: string) {
      await seed(organizationId);
      const current = await deps.store.getAutomation(organizationId, automationId);
      if (!current) throw new AutomationError("Automation not found.", 404);
      if (!OPERATIONAL_AUTOMATION_TYPES.includes(current.type)) {
        throw new AutomationError("This workflow is not operational yet.", 409);
      }
      const result = await deps.store.setAutomationEnabled(
        organizationId,
        automationId,
        true,
        deps.now().toISOString(),
      );
      if (!result) throw new AutomationError("Automation not found.", 404);
      if (result.changed) {
        await deps.store.addEvent({
          organizationId,
          automationId,
          kind: "activated",
          at: deps.now().toISOString(),
        });
      }
      if (result.automation.type === "quote_followup" && deps.listOpenQuotes) {
        try {
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
        } catch (err) {
          // Do not leave it half on: the owner is told it failed, so it must be off.
          if (result.changed) {
            await safely("activation rollback", () =>
              deps.store.setAutomationEnabled(
                organizationId,
                automationId,
                false,
                deps.now().toISOString(),
              ),
            );
          }
          throw err;
        }
      }
      return result.automation;
    },

    /** Turns the automation off and cancels what it had not sent. Safe to repeat. */
    async deactivate(organizationId: string, automationId: string) {
      const result = await deps.store.setAutomationEnabled(
        organizationId,
        automationId,
        false,
        deps.now().toISOString(),
      );
      if (!result) throw new AutomationError("Automation not found.", 404);
      // Always, not only when the switch changed: if a previous call died half way, a
      // second one finishes the job.
      const canceled = await deps.store.cancelPending({
        organizationId,
        automationId,
        reason: "automation_disabled",
      });
      if (result.changed || canceled > 0) {
        await deps.store.addEvent({
          organizationId,
          automationId,
          kind: "deactivated",
          detail: String(canceled),
          at: deps.now().toISOString(),
        });
      }
      return { automation: result.automation, canceled };
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

    /** The execution log: one row for every attempt, skip, retry and failure, newest first. */
    async executions(organizationId: string, limit = 100): Promise<ExecutionRecord[]> {
      return deps.store.listExecutions(organizationId, Math.min(Math.max(limit, 1), 500));
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
      // Only a call nobody answered qualifies. An answered or abandoned call is handled
      // (the automation still owns the opening text, so nothing else is sent either);
      // any other kind of event is not a missed call at all.
      if (input.disposition === "answered" || input.disposition === "abandoned") {
        return { deferred: true, scheduled: false, reason: "call_handled" as const, job: null };
      }
      if (!input.callId.trim() || !shouldStartRecovery(input.disposition as CallDisposition)) {
        return { deferred: true, scheduled: false, reason: "ineligible" as const, job: null };
      }
      const org = await requireOrg(input.organizationId);
      const phone = normalizeE164(input.callerE164);
      if (!isE164(phone) || (await isOptedOut(input.organizationId, phone))) {
        return { deferred: true, scheduled: false, reason: "ineligible" as const, job: null };
      }
      const idempotencyKey = `mcr:${input.callId}`;
      // The same call reported twice (a provider retry, a restarted worker) is one text.
      const existing = await deps.store.getJobByIdempotency(input.organizationId, idempotencyKey);
      if (existing) {
        return { deferred: true, scheduled: false, reason: "duplicate" as const, job: existing };
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
      const locale = resolveLocale(automation.config, org, input.language);
      const templateKey: TemplateKey =
        input.disposition === "after_hours_missed" ? "after_hours" : "missed_call_recovery";
      const recorded = await consent({
        organizationId: input.organizationId,
        phone,
        category: "inquiry_response",
        evidence: `Inbound call ${input.callId} was not answered. Recovery is a direct response to that inquiry, not a promotion.`,
      });
      // Not snapped to the sending window: see `run`.
      const when = new Date(
        deps.now().getTime() + automation.config.initialDelayMinutes * 60 * 1000,
      ).toISOString();
      const job = await placeJob({
        organizationId: input.organizationId,
        automation,
        phone,
        idempotencyKey,
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
      if (!job) {
        // Another worker scheduled the same call between the check and the insert. That
        // job will send the text; this lookup is only to say which one. If it fails, the
        // answer is still "duplicate": throwing here would make the caller fall back to
        // its own opening text, and the customer would get two.
        const winner = await deps.store
          .getJobByIdempotency(input.organizationId, idempotencyKey)
          .catch(() => null);
        return { deferred: true, scheduled: false, reason: "duplicate" as const, job: winner };
      }
      return { deferred: true, scheduled: true, reason: "scheduled" as const, job };
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
      if (!isE164(phone) || (await isOptedOut(input.organizationId, phone))) {
        if (!input.threadId.startsWith("sim_")) {
          await deps.clearQuoteSchedule?.(input.organizationId, input.threadId);
        }
        return { scheduled: true as const, jobs: [] as JobRecord[] };
      }
      const locale = resolveLocale(automation.config, org, input.locale);
      const nowMs = deps.now().getTime();
      const parsedSentAt = Date.parse(input.quoteSentAt);
      const sentAt = Number.isFinite(parsedSentAt) ? parsedSentAt : nowMs;
      const delays = [automation.config.initialDelayMinutes];
      if (automation.config.maxAttempts >= 2) {
        delays.push(
          automation.config.secondDelayMinutes ??
            automation.config.initialDelayMinutes + 2 * 24 * 60,
        );
      }
      const keys: TemplateKey[] = ["quote_followup_1", "quote_followup_2"];
      const steps = delays
        .slice(0, automation.config.maxAttempts)
        .map((delay, index) => ({ index, dueAt: sentAt + delay * 60 * 1000 }));
      // Turning the automation on for a quote sent long ago must not send every step it
      // missed in one go. Of the steps already past due, only the latest is kept, and
      // not at all when its moment is long gone. Steps still ahead keep their time.
      const overdue = steps.filter((step) => step.dueAt < nowMs);
      const lastOverdue = overdue.at(-1);
      const wanted = steps.filter((step) =>
        step.dueAt >= nowMs
          ? true
          : step === lastOverdue && nowMs - step.dueAt <= LATE_REMINDER_LIMIT_MS,
      );

      let consentRow: ConsentRecord | undefined;
      const jobs: JobRecord[] = [];
      for (const step of wanted) {
        const idempotencyKey = `qf:${input.threadId}:${step.index + 1}`;
        const at = new Date(Math.max(step.dueAt, nowMs));
        const scheduledAt = snap(at, org, automation.config);
        // A job from an earlier scheduling stays as it is, except one canceled only
        // because the automation was off: turning it back on brings it back.
        const existing = await deps.store.getJobByIdempotency(input.organizationId, idempotencyKey);
        if (existing) {
          const revived = await deps.store.requeueDisabledJob(
            input.organizationId,
            idempotencyKey,
            scheduledAt,
            deps.now().toISOString(),
          );
          if (revived) jobs.push(revived);
          continue;
        }
        consentRow ??= await consent({
          organizationId: input.organizationId,
          phone,
          category: "requested_estimate",
          evidence: `Quote ${input.quoteRef ?? input.threadId} was sent to the customer. Reminders are limited service follow-ups for that estimate.`,
        });
        const created = await placeJob({
          organizationId: input.organizationId,
          automation,
          phone,
          idempotencyKey,
          scheduledAt,
          simulated: Boolean(input.simulated),
          payload: {
            customerName: input.customerName,
            templateKey: keys[step.index] ?? "quote_followup_2",
            locale,
            vars: {
              customer_name: input.customerName ?? "",
              business_name: org.name,
              service_name: input.serviceName ?? "",
              quote_ref: input.quoteRef ?? "",
            },
            leadId: input.leadId,
            quoteThreadId: input.threadId,
            attemptIndex: step.index + 1,
            messageCategory: "requested_estimate",
            consentId: consentRow.id,
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

    /**
     * Sends what is due. Several workers may call this at the same time: each job is
     * claimed by exactly one of them, and one job failing never stops the others.
     */
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
      // Find the job before claiming the event. A callback that arrives before the job
      // records its sid is not ours yet: claiming it first would mark it processed, and
      // the provider's retry of the same event would then be thrown away.
      const found = await deps.store.getJobByProviderSid(input.providerSid);
      if (!found) return { duplicate: false as const, job: null };
      const fresh = await deps.store.claimWebhook("twilio_status", input.eventId);
      if (!fresh) return { duplicate: true as const, job: null };
      // Re-read after the claim: another worker may have moved the job on meanwhile.
      const job = (await deps.store.getJobByProviderSid(input.providerSid)) ?? found;
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
        // The opt-out is already recorded above; telling the carrier is best effort.
        await safely("opt-out sync", async () => {
          const from = await deps.smsFrom(input.organizationId);
          if (from) await deps.sms.syncOptOut?.({ phoneE164: phone, fromE164: from });
        });
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

    async scheduleAppointmentNotices(input: {
      organizationId: string;
      appointmentId: string;
      phoneE164: string;
      customerName?: string;
      serviceName: string;
      appointmentDate: string;
      appointmentTime: string;
      startAt: string;
      locale?: "en" | "fr";
      simulated?: boolean;
      leadId?: string;
    }) {
      const automation = await deps.store.getAutomationByType(
        input.organizationId,
        "appointment_reminder",
      );
      if (!automation?.enabled) return { scheduled: false as const, jobs: [] as JobRecord[] };
      const org = await requireOrg(input.organizationId);
      const phone = normalizeE164(input.phoneE164);
      if (!isE164(phone) || (await isOptedOut(input.organizationId, phone))) {
        return { scheduled: false as const, jobs: [] as JobRecord[] };
      }
      const locale = resolveLocale(automation.config, org, input.locale);
      const recorded = await consent({
        organizationId: input.organizationId,
        phone,
        category: "appointment_service",
        evidence: `Appointment ${input.appointmentId} was confirmed for ${input.appointmentDate} ${input.appointmentTime}.`,
      });
      const vars = {
        customer_name: input.customerName ?? "",
        business_name: org.name,
        service_name: input.serviceName,
        appointment_date: input.appointmentDate,
        appointment_time: input.appointmentTime,
      };
      const payloadBase = {
        customerName: input.customerName,
        locale,
        vars,
        leadId: input.leadId,
        attemptIndex: 1,
        messageCategory: "appointment_service" as const,
        consentId: recorded.id,
        serviceName: input.serviceName,
        appointmentId: input.appointmentId,
      };
      const jobs: JobRecord[] = [];
      const stamp = input.startAt.slice(0, 16);
      const confirm = await placeJob({
        organizationId: input.organizationId,
        automation,
        phone,
        idempotencyKey: `appt-confirm:${input.appointmentId}:${stamp}`,
        scheduledAt: snap(deps.now(), org, automation.config),
        simulated: Boolean(input.simulated),
        payload: { ...payloadBase, templateKey: "appointment_confirmation" },
      });
      if (confirm) jobs.push(confirm);
      const remindAt = new Date(Date.parse(input.startAt) - 24 * 60 * 60 * 1000);
      if (remindAt.getTime() > deps.now().getTime()) {
        const reminder = await placeJob({
          organizationId: input.organizationId,
          automation,
          phone,
          idempotencyKey: `appt-remind:${input.appointmentId}:${stamp}`,
          scheduledAt: snap(remindAt, org, automation.config),
          simulated: Boolean(input.simulated),
          payload: { ...payloadBase, templateKey: "appointment_reminder" },
        });
        if (reminder) jobs.push(reminder);
      }
      return { scheduled: true as const, jobs };
    },

    async cancelAppointmentNotices(
      organizationId: string,
      appointmentId: string,
      reason: string,
    ) {
      const jobs = await deps.store.listJobs(organizationId, 200);
      let canceled = 0;
      for (const job of jobs) {
        if (job.payload.appointmentId !== appointmentId) continue;
        if (job.providerMessageSid) continue;
        if (!["pending", "processing"].includes(job.status)) continue;
        job.status = "canceled";
        job.cancelReason = reason;
        job.updatedAt = deps.now().toISOString();
        await deps.store.saveJob(job);
        canceled += 1;
      }
      return canceled;
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
      // Only a job this call created is brought forward. A duplicate answer carries the
      // job that already exists, and that one is left exactly as it is.
      if (!result.scheduled || !result.job) return result;
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
