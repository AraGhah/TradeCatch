import { redactAuditDetail } from "@/product/security/permissions";
import type { PlanId } from "@/product/saas/entitlements";
import { diagnoseConfiguration } from "./diagnostics";
import { SupportError } from "./errors";

export { SupportError } from "./errors";
import { supportId, type SupportStore } from "./store";
import type { AccountRequest, SupportMessage, SupportTicket, TicketKind, TicketPriority, TicketStatus } from "./types";

type CreateTicketInput = {
  organizationId: string;
  subject: string;
  category: SupportTicket["category"];
  description: string;
  priority: TicketPriority;
  contactEmail: string;
  relatedCallId?: string;
  kind?: TicketKind;
  attachmentNames?: string[];
};

const PRIORITIES = new Set<TicketPriority>(["normal", "high", "critical"]);
const NOTIFY_STATUSES = new Set<TicketStatus>(["resolved", "investigating", "closed"]);

export function createSupportService(deps: {
  store: SupportStore;
  now: () => Date;
  notify?: (input: { organizationId: string; ticketId: string; simulated?: boolean }) => Promise<void>;
}) {
  async function requireTicket(ticketId: string, organizationId?: string) {
    const ticket = await deps.store.getTicket(ticketId);
    if (!ticket || (organizationId && ticket.organizationId !== organizationId)) {
      throw new SupportError("Ticket not found.", 404);
    }
    return ticket;
  }

  return {
    async createTicket(input: CreateTicketInput) {
      if (!PRIORITIES.has(input.priority)) throw new SupportError("Invalid priority.", 400);
      const now = deps.now().toISOString();
      const ticket: SupportTicket = {
        organizationId: input.organizationId,
        subject: input.subject.slice(0, 140),
        category: input.category,
        kind: input.kind ?? "issue",
        description: redactAuditDetail(input.description),
        priority: input.priority,
        contactEmail: input.contactEmail,
        relatedCallId: input.relatedCallId,
        id: supportId("tkt"),
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      await deps.store.saveTicket(ticket);
      await saveAttachments(deps.store, ticket.id, input.attachmentNames ?? [], now);
      await deps.store.saveEvent({ id: supportId("evt"), ticketId: ticket.id, action: "opened", createdAt: now });
      if (ticket.kind === "feature") {
        await deps.store.saveFeedback({ id: supportId("fb"), organizationId: ticket.organizationId, kind: "feature", body: ticket.subject, createdAt: now });
      }
      await deps.notify?.({ organizationId: ticket.organizationId, ticketId: ticket.id, simulated: true });
      return ticket;
    },

    async reply(input: { organizationId: string; ticketId: string; body: string; authorRole: "contractor" | "admin"; internal?: boolean }) {
      const ticket = await requireTicket(input.ticketId, input.organizationId);
      if (input.internal && input.authorRole !== "admin") throw new SupportError("Insufficient permissions.", 403);
      const message: SupportMessage = {
        id: supportId("msg"),
        ticketId: ticket.id,
        authorRole: input.authorRole,
        body: redactAuditDetail(input.body),
        internal: Boolean(input.internal),
        createdAt: deps.now().toISOString(),
      };
      await deps.store.saveMessage(message);
      if (input.authorRole === "admin" && !message.internal) {
        await markInvestigating(deps, ticket, message.createdAt);
      }
      return message;
    },

    async setStatus(ticketId: string, status: TicketStatus, patch?: { priority?: TicketPriority; assignedTo?: string }) {
      const ticket = await requireTicket(ticketId);
      if (patch?.priority && !PRIORITIES.has(patch.priority)) throw new SupportError("Invalid priority.", 400);
      ticket.status = status;
      if (patch?.priority) ticket.priority = patch.priority;
      if (patch?.assignedTo) ticket.assignedTo = patch.assignedTo.slice(0, 120);
      ticket.updatedAt = deps.now().toISOString();
      await deps.store.saveTicket(ticket);
      await deps.store.saveEvent({ id: supportId("evt"), ticketId: ticket.id, action: status, createdAt: ticket.updatedAt });
      if (NOTIFY_STATUSES.has(status)) {
        await deps.notify?.({ organizationId: ticket.organizationId, ticketId: ticket.id });
      }
      return ticket;
    },

    async forBusiness(organizationId: string, ticketId: string, limit?: number) {
      const ticket = await requireTicket(ticketId, organizationId);
      const all = await deps.store.listMessages(ticketId, limit);
      const messages = all.filter((message) => !message.internal);
      return { ticket, messages, capped: limit !== undefined && all.length >= limit };
    },

    async forAdmin(ticketId: string) {
      const ticket = await requireTicket(ticketId);
      return { ticket, messages: await deps.store.listMessages(ticketId) };
    },

    list(organizationId?: string, limit?: number) {
      return deps.store.listTickets(organizationId,limit);
    },

    accountRequests(organizationId: string, limit?: number) {
      return deps.store.listAccountRequests(organizationId,limit);
    },

    diagnose(input: { plan: PlanId; phone?: string | null; calendarConnected: boolean; automationEnabled: boolean; smsConfigured: boolean }) {
      return diagnoseConfiguration(input);
    },

    async requestAccountChange(organizationId: string, kind: AccountRequest["kind"]) {
      const row: AccountRequest = {
        id: supportId("acct"),
        organizationId,
        kind,
        status: "requested",
        phoneRouting: "unchanged_until_transition",
        createdAt: deps.now().toISOString(),
      };
      await deps.store.saveAccountRequest(row);
      return row;
    },
  };
}

async function saveAttachments(store: SupportStore, ticketId: string, names: string[], at: string) {
  for (const fileName of names) {
    await store.saveAttachment({ id: supportId("att"), ticketId, fileName: fileName.slice(0, 120), createdAt: at });
  }
}

async function markInvestigating(
  deps: { store: SupportStore; notify?: (input: { organizationId: string; ticketId: string }) => Promise<void> },
  ticket: SupportTicket,
  at: string,
) {
  if (ticket.status === "open") ticket.status = "investigating";
  ticket.updatedAt = at;
  await deps.store.saveTicket(ticket);
  await deps.notify?.({ organizationId: ticket.organizationId, ticketId: ticket.id });
}
