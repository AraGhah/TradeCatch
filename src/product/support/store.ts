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
  /** Adds a new ticket unless one with its id exists. True only for the call that added it. */
  insertTicket(row: SupportTicket): Promise<boolean>;
  listTickets(
    organizationId?: string,
    limit?: number,
  ): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  saveMessage(row: SupportMessage): Promise<void>;
  /** Adds a new message unless one with its id exists. True only for the call that added it. */
  insertMessage(row: SupportMessage): Promise<boolean>;
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
    async insertTicket(row) {
      if (tickets.has(row.id)) return false;
      tickets.set(row.id, structuredClone(row));
      return true;
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
    async insertMessage(row) {
      if (messages.some((existing) => existing.id === row.id)) return false;
      messages.push(structuredClone(row));
      return true;
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
      const copy = structuredClone(row);
      const index = accounts.findIndex((existing) => existing.id === row.id);
      if (index >= 0) accounts[index] = copy;
      else accounts.push(copy);
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
