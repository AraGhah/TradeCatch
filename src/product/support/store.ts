import { createId } from "@/lib/id";

export type TicketStatus = "open" | "investigating" | "waiting_for_customer" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "normal" | "high" | "critical";

export type SupportTicket = {
  id: string;
  organizationId: string;
  subject: string;
  category: "ai" | "calls" | "sms" | "appointments" | "billing" | "other";
  kind: "issue" | "bug" | "feature";
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  contactEmail: string;
  relatedCallId?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportMessage = {
  id: string;
  ticketId: string;
  authorRole: "contractor" | "admin";
  body: string;
  internal: boolean;
  createdAt: string;
};

export type AccountRequest = {
  id: string;
  organizationId: string;
  kind: "deletion" | "suspension" | "reactivation";
  status: "requested" | "in_review" | "completed";
  phoneRouting: "unchanged_until_transition";
  createdAt: string;
};

export type SupportStore = {
  saveTicket(row: SupportTicket): Promise<void>;
  listTickets(organizationId?: string): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  saveMessage(row: SupportMessage): Promise<void>;
  listMessages(ticketId: string): Promise<SupportMessage[]>;
  saveAttachment(row: { id: string; ticketId: string; fileName: string; createdAt: string }): Promise<void>;
  listAttachments(ticketId: string): Promise<{ id: string; fileName: string }[]>;
  saveEvent(row: { id: string; ticketId: string; action: string; createdAt: string }): Promise<void>;
  saveAccountRequest(row: AccountRequest): Promise<void>;
  listAccountRequests(organizationId: string): Promise<AccountRequest[]>;
  saveFeedback(row: { id: string; organizationId: string; kind: string; body: string; createdAt: string }): Promise<void>;
};

export function createMemorySupportStore(): SupportStore {
  const tickets = new Map<string, SupportTicket>();
  const messages: SupportMessage[] = [];
  const attachments: { id: string; ticketId: string; fileName: string; createdAt: string }[] = [];
  const accounts: AccountRequest[] = [];
  return {
    async saveTicket(row) { tickets.set(row.id, structuredClone(row)); },
    async listTickets(organizationId) {
      return [...tickets.values()].filter((row) => !organizationId || row.organizationId === organizationId).map((row) => structuredClone(row));
    },
    async getTicket(id) { const row = tickets.get(id); return row ? structuredClone(row) : null; },
    async saveMessage(row) { messages.push(structuredClone(row)); },
    async listMessages(ticketId) { return messages.filter((row) => row.ticketId === ticketId).map((row) => structuredClone(row)); },
    async saveAttachment(row) { attachments.push(structuredClone(row)); },
    async listAttachments(ticketId) { return attachments.filter((row) => row.ticketId === ticketId).map((row) => ({ id: row.id, fileName: row.fileName })); },
    async saveEvent() {},
    async saveAccountRequest(row) { accounts.push(structuredClone(row)); },
    async listAccountRequests(organizationId) { return accounts.filter((row) => row.organizationId === organizationId).map((row) => structuredClone(row)); },
    async saveFeedback() {},
  };
}

export function supportId(prefix: string) {
  return createId(prefix);
}
