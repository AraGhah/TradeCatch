import { createId } from "@/lib/id";
import type {
  AccountRequest,
  CustomerFeedback,
  SupportAttachment,
  SupportEvent,
  SupportMessage,
  SupportTicket,
} from "./types";

export type SupportStore = {
  saveTicket(row: SupportTicket): Promise<void>;
  listTickets(
    organizationId?: string,
    limit?: number,
  ): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  saveMessage(row: SupportMessage): Promise<void>;
  listMessages(ticketId: string, limit?: number): Promise<SupportMessage[]>;
  saveAttachment(row: SupportAttachment): Promise<void>;
  listAttachments(
    ticketId: string,
  ): Promise<{ id: string; fileName: string }[]>;
  saveEvent(row: SupportEvent): Promise<void>;
  saveAccountRequest(row: AccountRequest): Promise<void>;
  listAccountRequests(
    organizationId: string,
    limit?: number,
  ): Promise<AccountRequest[]>;
  saveFeedback(row: CustomerFeedback): Promise<void>;
};

export function createMemorySupportStore(): SupportStore {
  const tickets = new Map<string, SupportTicket>();
  const messages: SupportMessage[] = [];
  const attachments: SupportAttachment[] = [];
  const events: SupportEvent[] = [];
  const accounts: AccountRequest[] = [];
  const feedback: CustomerFeedback[] = [];
  return {
    async saveTicket(row) {
      tickets.set(row.id, structuredClone(row));
    },
    async listTickets(organizationId, limit) {
      return [...tickets.values()]
        .filter(
          (row) => !organizationId || row.organizationId === organizationId,
        )
        .slice(0, limit)
        .map((row) => structuredClone(row));
    },
    async getTicket(id) {
      const row = tickets.get(id);
      return row ? structuredClone(row) : null;
    },
    async saveMessage(row) {
      messages.push(structuredClone(row));
    },
    async listMessages(ticketId, limit) {
      return messages
        .filter((row) => row.ticketId === ticketId)
        .slice(0, limit)
        .map((row) => structuredClone(row));
    },
    async saveAttachment(row) {
      attachments.push(structuredClone(row));
    },
    async listAttachments(ticketId) {
      return attachments
        .filter((row) => row.ticketId === ticketId)
        .map((row) => ({ id: row.id, fileName: row.fileName }));
    },
    async saveEvent(row) {
      events.push(structuredClone(row));
    },
    async saveAccountRequest(row) {
      accounts.push(structuredClone(row));
    },
    async listAccountRequests(organizationId, limit) {
      return accounts
        .filter((row) => row.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((row) => structuredClone(row));
    },
    async saveFeedback(row) {
      feedback.push(structuredClone(row));
    },
  };
}

export function supportId(prefix: string) {
  return createId(prefix);
}
