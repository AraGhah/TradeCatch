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
  saveCall(call: CallRecord): Promise<void>;
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
  listWorkflowsAwaitingTechnician(): Promise<MissedCallWorkflow[]>;
  listWorkflowsAwaitingCustomer(): Promise<MissedCallWorkflow[]>;
  saveWorkflow(workflow: MissedCallWorkflow): Promise<void>;
  getWorkflow(id: string): Promise<MissedCallWorkflow | null>;
  saveLead(lead: LeadRecord): Promise<void>;
  getLead(id: string): Promise<LeadRecord | null>;
  getLeadByWorkflowId(workflowId: string): Promise<LeadRecord | null>;
  listLeads(clientAccountId?: string): Promise<LeadRecord[]>;
  isSmsSuppressed(clientAccountId: string, phoneE164: string): Promise<boolean>;
  addSmsSuppression(record: SmsSuppressionRecord): Promise<void>;
  /** Returns true if newly claimed; false if this MessageSid was already processed. */
  claimInboundMessageSid(messageSid: string): Promise<boolean>;
  enqueueOutbound(message: OutboundMessageRecord): Promise<void>;
  /** Atomically claim queued/retry rows for sending (SKIP LOCKED on Postgres). */
  claimOutboundForSend(limit: number): Promise<OutboundMessageRecord[]>;
  markOutboundSent(id: string, providerSid: string): Promise<void>;
  markOutboundFailed(
    id: string,
    error: string,
    nextStatus: "retry" | "dead",
  ): Promise<void>;
};

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
      calls.set(call.id, call);
      if (call.twilioCallSid) {
        callsByTwilioSid.set(call.twilioCallSid, call.id);
      }
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
      workflows.set(workflow.id, workflow);
    },
    async getWorkflow(id) {
      return workflows.get(id) ?? null;
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
    async isSmsSuppressed(clientAccountId, phoneE164) {
      return suppressions.has(suppressionKey(clientAccountId, phoneE164));
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
    async enqueueOutbound(message) {
      outbound.set(message.id, { ...message });
    },
    async claimOutboundForSend(limit) {
      const claimed: OutboundMessageRecord[] = [];
      for (const msg of outbound.values()) {
        if (claimed.length >= limit) break;
        if (msg.status !== "queued" && msg.status !== "retry") continue;
        if (outboundClaimed.has(msg.id)) continue;
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
  };
}
