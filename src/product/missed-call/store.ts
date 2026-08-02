import type {
  CallRecord,
  ClientAccount,
  LeadRecord,
  MissedCallWorkflow,
  OutboundMessageRecord,
  SmsSuppressionRecord,
} from "./types";

export type MissedCallStore = {
  getClient(id: string): Promise<ClientAccount | null>;
  saveClient(client: ClientAccount): Promise<void>;
  findClientBySmsFromNumber(n: string): Promise<ClientAccount | null>;
  saveCall(call: CallRecord): Promise<CallRecord>;
  getCall(id: string): Promise<CallRecord | null>;
  findCallByTwilioSid(sid: string): Promise<CallRecord | null>;
  findActiveWorkflowByDedupeKey(
    dedupeKey: string,
  ): Promise<MissedCallWorkflow | null>;
  findActiveWorkflowByCaller(
    clientAccountId: string,
    callerE164: string,
  ): Promise<MissedCallWorkflow | null>;
  /** Active or recently updated workflow within a rolling window (ms). */
  findRecentWorkflowByCaller(
    clientAccountId: string,
    callerE164: string,
    withinMs: number,
    now?: Date,
  ): Promise<MissedCallWorkflow | null>;
  findWorkflowByTechnicianPhone(
    techPhoneE164: string,
    actionToken?: string | null,
  ): Promise<MissedCallWorkflow | null>;
  findWorkflowByCallId(callId: string): Promise<MissedCallWorkflow | null>;
  listWorkflowsAwaitingTechnician(): Promise<MissedCallWorkflow[]>;
  listWorkflowsAwaitingCustomer(): Promise<MissedCallWorkflow[]>;
  saveWorkflow(workflow: MissedCallWorkflow): Promise<void>;
  /**
   * Persist workflow state and enqueue an outbound SMS in one atomic step
   * (single transaction on Postgres) so a crash cannot leave sms_queued
   * without an outbox row — or the inverse.
   */
  saveWorkflowAndEnqueueOutbound(
    workflow: MissedCallWorkflow,
    message: OutboundMessageRecord,
  ): Promise<void>;
  getWorkflow(id: string): Promise<MissedCallWorkflow | null>;
  /**
   * Cross-instance escalation lease. Returns the workflow when this caller
   * acquired the lease; null if another worker already holds a live lease.
   */
  claimWorkflowEscalation(
    workflowId: string,
    leaseMs: number,
    now?: Date,
  ): Promise<MissedCallWorkflow | null>;
  saveLead(lead: LeadRecord): Promise<void>;
  getLead(id: string): Promise<LeadRecord | null>;
  getLeadByWorkflowId(workflowId: string): Promise<LeadRecord | null>;
  listLeads(clientAccountId?: string): Promise<LeadRecord[]>;
  isSmsSuppressed(
    clientAccountId: string,
    phoneE164: string,
    opts?: { asCustomer?: boolean },
  ): Promise<boolean>;
  addSmsSuppression(record: SmsSuppressionRecord): Promise<void>;
  /** Returns true if newly claimed; false if this MessageSid was already processed. */
  claimInboundMessageSid(messageSid: string): Promise<boolean>;
  /** Release a claim so Twilio retries can reprocess after a failed handler. */
  releaseInboundMessageSid(messageSid: string): Promise<void>;
  enqueueOutbound(message: OutboundMessageRecord): Promise<void>;
  /** Atomically move one row queued/retry → sending (inline send path). */
  claimOutboundById(id: string): Promise<OutboundMessageRecord | null>;
  /**
   * Atomically claim queued/retry rows for sending (SKIP LOCKED on Postgres).
   * Also reclaims stale `sending` rows older than staleSendingMs.
   */
  claimOutboundForSend(
    limit: number,
    staleSendingMs?: number,
  ): Promise<OutboundMessageRecord[]>;
  markOutboundSent(id: string, providerSid: string): Promise<void>;
  /** Apply Twilio delivery-status callback (delivered / undelivered / failed). */
  applyOutboundProviderStatus(
    providerSid: string,
    providerStatus: string,
  ): Promise<OutboundMessageRecord | null>;
  markOutboundFailed(
    id: string,
    error: string,
    nextStatus: "retry" | "dead",
  ): Promise<void>;
  /** Ops observability: queued/retry/sending depth and stale sending count. */
  getOutboundQueueStats(): Promise<{
    queued: number;
    retry: number;
    sending: number;
    staleSending: number;
  }>;
};

/** Default age after which a stuck `sending` outbox row may be reclaimed. */
export const OUTBOUND_STALE_SENDING_MS = 5 * 60 * 1000;

export class ConcurrentWorkflowUpdateError extends Error {
  constructor(workflowId: string) {
    super(
      `Concurrent workflow update rejected for ${workflowId} (stale version)`,
    );
    this.name = "ConcurrentWorkflowUpdateError";
  }
}

/** Active-dedupe unique index collision under concurrent webhook inserts. */
export class DuplicateActiveWorkflowError extends Error {
  constructor(readonly dedupeKey: string) {
    super(`Active workflow already exists for dedupe key ${dedupeKey}`);
    this.name = "DuplicateActiveWorkflowError";
  }
}

/** Apply optimistic version bump; throws on stale writers. */
export function bumpWorkflowVersion(
  existing: MissedCallWorkflow | null | undefined,
  workflow: MissedCallWorkflow,
): MissedCallWorkflow {
  const expected = workflow.version ?? 0;
  const current = existing?.version ?? 0;
  if (existing && current !== expected) {
    throw new ConcurrentWorkflowUpdateError(workflow.id);
  }
  workflow.version = expected + 1;
  return workflow;
}

function isActiveWorkflowStatus(w: MissedCallWorkflow): boolean {
  return (
    w.status === "started" ||
    w.status === "awaiting_customer" ||
    w.status === "awaiting_technician" ||
    w.status === "awaiting_human"
  );
}

function normalizePhone(n: string): string {
  return n.replace(/[^\d+]/g, "");
}

export function createMemoryStore(): MissedCallStore {
  const clients = new Map<string, ClientAccount>();
  const bySms = new Map<string, string>();
  const calls = new Map<string, CallRecord>();
  const callsByTwilioSid = new Map<string, string>();
  const workflows = new Map<string, MissedCallWorkflow>();
  const leads = new Map<string, LeadRecord>();
  const leadByWorkflow = new Map<string, string>();
  const suppressions = new Map<string, SmsSuppressionRecord>();
  const inboundMessageSids = new Set<string>();
  const outbound = new Map<string, OutboundMessageRecord>();
  const outboundClaimed = new Set<string>();

  function suppressionKey(clientAccountId: string, phoneE164: string) {
    return `${clientAccountId}:${normalizePhone(phoneE164)}`;
  }

  return {
    async getClient(id) {
      return clients.get(id) ?? null;
    },
    async saveClient(client) {
      clients.set(client.id, client);
      bySms.set(client.smsFromNumber, client.id);
    },
    async findClientBySmsFromNumber(n) {
      const id = bySms.get(n);
      return id ? (clients.get(id) ?? null) : null;
    },
    async saveCall(call) {
      if (call.twilioCallSid) {
        const existingId = callsByTwilioSid.get(call.twilioCallSid);
        if (existingId) {
          const existing = calls.get(existingId);
          if (existing) return existing;
        }
        callsByTwilioSid.set(call.twilioCallSid, call.id);
      }
      calls.set(call.id, call);
      return call;
    },
    async getCall(id) {
      return calls.get(id) ?? null;
    },
    async findCallByTwilioSid(sid) {
      const id = callsByTwilioSid.get(sid);
      return id ? (calls.get(id) ?? null) : null;
    },
    async findActiveWorkflowByDedupeKey(dedupeKey) {
      for (const w of workflows.values()) {
        if (w.dedupeKey === dedupeKey && isActiveWorkflowStatus(w)) {
          return w;
        }
      }
      return null;
    },
    async findActiveWorkflowByCaller(clientAccountId, callerE164) {
      let latest: MissedCallWorkflow | null = null;
      for (const w of workflows.values()) {
        if (
          w.clientAccountId === clientAccountId &&
          w.callerE164 === callerE164 &&
          isActiveWorkflowStatus(w)
        ) {
          if (!latest || w.updatedAt > latest.updatedAt) latest = w;
        }
      }
      return latest;
    },
    async findRecentWorkflowByCaller(
      clientAccountId,
      callerE164,
      withinMs,
      now = new Date(),
    ) {
      let latest: MissedCallWorkflow | null = null;
      const cutoff = now.getTime() - withinMs;
      for (const w of workflows.values()) {
        if (
          w.clientAccountId !== clientAccountId ||
          w.callerE164 !== callerE164
        ) {
          continue;
        }
        const ts = new Date(w.updatedAt).getTime();
        if (ts < cutoff) continue;
        if (!latest || w.updatedAt > latest.updatedAt) latest = w;
      }
      return latest;
    },
    async findWorkflowByTechnicianPhone(techPhoneE164, actionToken) {
      let best: MissedCallWorkflow | null = null;
      for (const w of workflows.values()) {
        if (
          w.status !== "awaiting_technician" &&
          w.status !== "awaiting_human"
        ) {
          continue;
        }
        const open = w.technicianAlerts.find(
          (a) =>
            a.phone === techPhoneE164 &&
            !a.respondedAt &&
            (!actionToken ||
              a.actionToken.toUpperCase() === actionToken.toUpperCase()),
        );
        if (!open) continue;
        if (open.technicianId === w.assignedTechnicianId) return w;
        if (!best) best = w;
      }
      return best;
    },
    async findWorkflowByCallId(callId) {
      let latest: MissedCallWorkflow | null = null;
      for (const w of workflows.values()) {
        if (w.callId !== callId) continue;
        if (!latest || w.updatedAt > latest.updatedAt) latest = w;
      }
      return latest;
    },
    async listWorkflowsAwaitingTechnician() {
      return [...workflows.values()].filter(
        (w) =>
          w.status === "awaiting_technician" || w.status === "awaiting_human",
      );
    },
    async listWorkflowsAwaitingCustomer() {
      return [...workflows.values()].filter(
        (w) => w.status === "awaiting_customer",
      );
    },
    async saveWorkflow(workflow) {
      const existing = workflows.get(workflow.id);
      bumpWorkflowVersion(existing, workflow);
      workflows.set(workflow.id, { ...workflow });
    },
    async saveWorkflowAndEnqueueOutbound(workflow, message) {
      const existing = workflows.get(workflow.id);
      bumpWorkflowVersion(existing, workflow);
      workflows.set(workflow.id, { ...workflow });
      const prior = outbound.get(message.id);
      if (prior) {
        if (
          prior.status === "sent" ||
          prior.status === "delivered" ||
          prior.status === "sending" ||
          prior.status === "undelivered"
        ) {
          return;
        }
        // Keep reclaimable queued/retry row — do not reset attempts.
        return;
      }
      outbound.set(message.id, { ...message });
    },
    async getWorkflow(id) {
      return workflows.get(id) ?? null;
    },
    async claimWorkflowEscalation(workflowId, leaseMs, now = new Date()) {
      const w = workflows.get(workflowId);
      if (!w) return null;
      if (w.status !== "awaiting_technician" && w.status !== "awaiting_human") {
        return null;
      }
      const until = w.escalationClaimUntil
        ? new Date(w.escalationClaimUntil).getTime()
        : 0;
      if (until > now.getTime()) return null;
      w.escalationClaimUntil = new Date(now.getTime() + leaseMs).toISOString();
      w.updatedAt = now.toISOString();
      return w;
    },
    async saveLead(lead) {
      leads.set(lead.id, lead);
      leadByWorkflow.set(lead.workflowId, lead.id);
    },
    async getLead(id) {
      return leads.get(id) ?? null;
    },
    async getLeadByWorkflowId(workflowId) {
      const id = leadByWorkflow.get(workflowId);
      return id ? (leads.get(id) ?? null) : null;
    },
    async listLeads(clientAccountId) {
      const all = [...leads.values()];
      if (!clientAccountId)
        return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return all
        .filter((l) => l.clientAccountId === clientAccountId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async isSmsSuppressed(clientAccountId, phoneE164, opts) {
      const record = suppressions.get(suppressionKey(clientAccountId, phoneE164));
      if (!record) return false;
      const scope = record.scope ?? "all";
      // Default historical rows behave as full suppress. New technician STOP
      // rows use customer_outbound so job cards still reach the roster.
      if (opts?.asCustomer === false && scope === "customer_outbound") {
        return false;
      }
      return true;
    },
    async addSmsSuppression(record) {
      suppressions.set(
        suppressionKey(record.clientAccountId, record.phoneE164),
        record,
      );
    },
    async claimInboundMessageSid(messageSid) {
      if (inboundMessageSids.has(messageSid)) return false;
      inboundMessageSids.add(messageSid);
      return true;
    },
    async releaseInboundMessageSid(messageSid) {
      inboundMessageSids.delete(messageSid);
    },
    async enqueueOutbound(message) {
      const existing = outbound.get(message.id);
      if (existing) {
        // Deterministic purpose keys: never replace a row already accepted/sent.
        if (
          existing.status === "sent" ||
          existing.status === "delivered" ||
          existing.status === "sending" ||
          existing.status === "undelivered"
        ) {
          return;
        }
      }
      outbound.set(message.id, { ...message });
    },
    async claimOutboundById(id) {
      const msg = outbound.get(id);
      if (!msg) return null;
      if (msg.status !== "queued" && msg.status !== "retry") return null;
      if (outboundClaimed.has(id)) return null;
      outboundClaimed.add(id);
      const sending = {
        ...msg,
        status: "sending" as const,
        updatedAt: new Date().toISOString(),
      };
      outbound.set(id, sending);
      return { ...sending };
    },
    async claimOutboundForSend(
      limit,
      staleSendingMs = OUTBOUND_STALE_SENDING_MS,
    ) {
      const claimed: OutboundMessageRecord[] = [];
      const now = Date.now();
      for (const msg of outbound.values()) {
        if (claimed.length >= limit) break;
        const isQueued = msg.status === "queued" || msg.status === "retry";
        const isStaleSending =
          msg.status === "sending" &&
          now - new Date(msg.updatedAt).getTime() >= staleSendingMs;
        if (!isQueued && !isStaleSending) continue;
        // Provider already accepted — finalize instead of double-sending.
        if (isStaleSending && msg.providerSid) {
          outbound.set(msg.id, {
            ...msg,
            status: "sent",
            updatedAt: new Date().toISOString(),
            sentAt: msg.sentAt ?? new Date().toISOString(),
          });
          outboundClaimed.delete(msg.id);
          continue;
        }
        if (outboundClaimed.has(msg.id) && !isStaleSending) continue;
        outboundClaimed.add(msg.id);
        const sending = {
          ...msg,
          status: "sending" as const,
          updatedAt: new Date().toISOString(),
        };
        outbound.set(msg.id, sending);
        claimed.push({ ...sending });
      }
      return claimed;
    },
    async markOutboundSent(id, providerSid) {
      const msg = outbound.get(id);
      if (!msg) return;
      const now = new Date().toISOString();
      outbound.set(id, {
        ...msg,
        status: "sent",
        providerSid,
        attempts: msg.attempts + 1,
        updatedAt: now,
        sentAt: now,
      });
      outboundClaimed.delete(id);
    },
    async applyOutboundProviderStatus(providerSid, providerStatus) {
      const normalized = providerStatus.toLowerCase();
      for (const [id, msg] of outbound) {
        if (msg.providerSid !== providerSid) continue;
        let status = msg.status;
        let deliveredAt = msg.deliveredAt;
        if (normalized === "delivered") {
          status = "delivered";
          deliveredAt = new Date().toISOString();
        } else if (
          normalized === "undelivered" ||
          normalized === "failed" ||
          normalized === "canceled"
        ) {
          // Recoverable undelivered → retry outbox rather than silent success.
          status = msg.attempts < 3 ? "retry" : "undelivered";
        }
        const next = {
          ...msg,
          status,
          providerStatus: normalized,
          // Clear SID so a retry can claim and resend without unique conflicts.
          providerSid:
            status === "retry" ? undefined : msg.providerSid,
          deliveredAt,
          updatedAt: new Date().toISOString(),
        };
        outbound.set(id, next);
        outboundClaimed.delete(id);
        return { ...next };
      }
      return null;
    },
    async markOutboundFailed(id, error, nextStatus) {
      const msg = outbound.get(id);
      if (!msg) return;
      outbound.set(id, {
        ...msg,
        status: nextStatus,
        lastError: error,
        attempts: msg.attempts + 1,
        updatedAt: new Date().toISOString(),
      });
      outboundClaimed.delete(id);
    },
    async getOutboundQueueStats() {
      const now = Date.now();
      let queued = 0;
      let retry = 0;
      let sending = 0;
      let staleSending = 0;
      for (const msg of outbound.values()) {
        if (msg.status === "queued") queued += 1;
        else if (msg.status === "retry") retry += 1;
        else if (msg.status === "sending") {
          sending += 1;
          if (
            now - new Date(msg.updatedAt).getTime() >=
            OUTBOUND_STALE_SENDING_MS
          ) {
            staleSending += 1;
          }
        }
      }
      return { queued, retry, sending, staleSending };
    },
  };
}
