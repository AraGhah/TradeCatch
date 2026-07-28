import type {
  CallRecord,
  ClientAccount,
  LeadRecord,
  MissedCallWorkflow,
} from "./types";

export type MissedCallStore = {
  getClient(id: string): Promise<ClientAccount | null>;
  saveClient(client: ClientAccount): Promise<void>;
  findClientBySmsFromNumber(n: string): Promise<ClientAccount | null>;
  saveCall(call: CallRecord): Promise<void>;
  getCall(id: string): Promise<CallRecord | null>;
  findActiveWorkflowByDedupeKey(
    dedupeKey: string,
  ): Promise<MissedCallWorkflow | null>;
  findActiveWorkflowByCaller(
    clientAccountId: string,
    callerE164: string,
  ): Promise<MissedCallWorkflow | null>;
  findWorkflowByTechnicianPhone(
    techPhoneE164: string,
  ): Promise<MissedCallWorkflow | null>;
  listWorkflowsAwaitingTechnician(): Promise<MissedCallWorkflow[]>;
  saveWorkflow(workflow: MissedCallWorkflow): Promise<void>;
  getWorkflow(id: string): Promise<MissedCallWorkflow | null>;
  saveLead(lead: LeadRecord): Promise<void>;
  getLead(id: string): Promise<LeadRecord | null>;
  getLeadByWorkflowId(workflowId: string): Promise<LeadRecord | null>;
  listLeads(clientAccountId?: string): Promise<LeadRecord[]>;
};

function isActiveWorkflowStatus(w: MissedCallWorkflow): boolean {
  return (
    w.status === "started" ||
    w.status === "awaiting_customer" ||
    w.status === "awaiting_technician" ||
    w.status === "awaiting_human"
  );
}

export function createMemoryStore(): MissedCallStore {
  const clients = new Map<string, ClientAccount>();
  const bySms = new Map<string, string>();
  const calls = new Map<string, CallRecord>();
  const workflows = new Map<string, MissedCallWorkflow>();
  const leads = new Map<string, LeadRecord>();
  const leadByWorkflow = new Map<string, string>();

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
    },
    async getCall(id) {
      return calls.get(id) ?? null;
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
    async findWorkflowByTechnicianPhone(techPhoneE164) {
      for (const w of workflows.values()) {
        if (w.status !== "awaiting_technician" && w.status !== "awaiting_human") {
          continue;
        }
        const client = clients.get(w.clientAccountId);
        if (!client) continue;

        const roster = [
          ...client.technicianRoster,
          ...client.onCallTechnicians.map((t) => ({
            id: t.id,
            name: t.name,
            phone: t.phone,
            role: "backup" as const,
            active: t.active,
          })),
        ];

        const openAlert = w.technicianAlerts.find(
          (a) => a.phone === techPhoneE164 && !a.respondedAt,
        );
        if (openAlert) return w;

        const assigned = roster.find(
          (t) => t.id === w.assignedTechnicianId && t.phone === techPhoneE164,
        );
        if (assigned) return w;
      }
      return null;
    },
    async listWorkflowsAwaitingTechnician() {
      return [...workflows.values()].filter(
        (w) => w.status === "awaiting_technician" || w.status === "awaiting_human",
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
      if (!clientAccountId) return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return all
        .filter((l) => l.clientAccountId === clientAccountId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  };
}
