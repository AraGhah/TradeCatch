import { redactAuditDetail } from "@/product/security/permissions";
import { orgHasFeature, type PlanId } from "@/product/saas/entitlements";
import { supportId, type AccountRequest, type SupportMessage, type SupportStore, type SupportTicket, type TicketPriority, type TicketStatus } from "./store";

export class SupportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SupportError";
  }
}

const PRIORITIES = new Set<TicketPriority>(["normal", "high", "critical"]);

export function createSupportService(deps: {
  store: SupportStore;
  now: () => Date;
  notify?: (input: { organizationId: string; ticketId: string; simulated?: boolean }) => Promise<void>;
}) {
  function clean(value: string) {
    return redactAuditDetail(value);
  }

  function visible(message: SupportMessage, includeInternal: boolean) {
    return includeInternal || !message.internal;
  }

  return {
    async createTicket(input: Omit<SupportTicket, "id" | "status" | "createdAt" | "updatedAt" | "description" | "kind"> & { description: string; kind?: SupportTicket["kind"]; attachmentNames?: string[] }) {
      if (!PRIORITIES.has(input.priority)) throw new SupportError("Invalid priority.", 400);
      const now = deps.now().toISOString();
      const ticket: SupportTicket = {
        organizationId: input.organizationId,
        subject: input.subject.slice(0, 140),
        category: input.category,
        kind: input.kind ?? "issue",
        description: clean(input.description),
        priority: input.priority,
        contactEmail: input.contactEmail,
        relatedCallId: input.relatedCallId,
        id: supportId("tkt"),
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      await deps.store.saveTicket(ticket);
      for (const fileName of input.attachmentNames ?? []) {
        await deps.store.saveAttachment({ id: supportId("att"), ticketId: ticket.id, fileName: fileName.slice(0, 120), createdAt: now });
      }
      await deps.store.saveEvent({ id: supportId("evt"), ticketId: ticket.id, action: "opened", createdAt: now });
      if (ticket.kind === "feature") {
        await deps.store.saveFeedback({ id: supportId("fb"), organizationId: ticket.organizationId, kind: "feature", body: ticket.subject, createdAt: now });
      }
      await deps.notify?.({ organizationId: ticket.organizationId, ticketId: ticket.id, simulated: true });
      return ticket;
    },

    async reply(input: { organizationId: string; ticketId: string; body: string; authorRole: "contractor" | "admin"; internal?: boolean }) {
      const ticket = await deps.store.getTicket(input.ticketId);
      if (!ticket || ticket.organizationId !== input.organizationId) throw new SupportError("Ticket not found.", 404);
      if (input.internal && input.authorRole !== "admin") throw new SupportError("Insufficient permissions.", 403);
      const message: SupportMessage = {
        id: supportId("msg"),
        ticketId: ticket.id,
        authorRole: input.authorRole,
        body: clean(input.body),
        internal: Boolean(input.internal),
        createdAt: deps.now().toISOString(),
      };
      await deps.store.saveMessage(message);
      if (input.authorRole === "admin" && !message.internal) {
        ticket.status = ticket.status === "open" ? "investigating" : ticket.status;
        ticket.updatedAt = message.createdAt;
        await deps.store.saveTicket(ticket);
        await deps.notify?.({ organizationId: ticket.organizationId, ticketId: ticket.id });
      }
      return message;
    },

    async setStatus(ticketId: string, status: TicketStatus, patch?: { priority?: TicketPriority; assignedTo?: string }) {
      const ticket = await deps.store.getTicket(ticketId);
      if (!ticket) throw new SupportError("Ticket not found.", 404);
      if (patch?.priority && !PRIORITIES.has(patch.priority)) throw new SupportError("Invalid priority.", 400);
      ticket.status = status;
      if (patch?.priority) ticket.priority = patch.priority;
      if (patch?.assignedTo) ticket.assignedTo = patch.assignedTo.slice(0, 120);
      ticket.updatedAt = deps.now().toISOString();
      await deps.store.saveTicket(ticket);
      await deps.store.saveEvent({ id: supportId("evt"), ticketId: ticket.id, action: status, createdAt: ticket.updatedAt });
      if (status === "resolved" || status === "investigating" || status === "closed") {
        await deps.notify?.({ organizationId: ticket.organizationId, ticketId: ticket.id });
      }
      return ticket;
    },

    async forBusiness(organizationId: string, ticketId: string) {
      const ticket = await deps.store.getTicket(ticketId);
      if (!ticket || ticket.organizationId !== organizationId) throw new SupportError("Ticket not found.", 404);
      const messages = (await deps.store.listMessages(ticketId)).filter((message) => visible(message, false));
      return { ticket, messages };
    },

    async forAdmin(ticketId: string) {
      const ticket = await deps.store.getTicket(ticketId);
      if (!ticket) throw new SupportError("Ticket not found.", 404);
      return { ticket, messages: await deps.store.listMessages(ticketId) };
    },

    list(organizationId?: string) {
      return deps.store.listTickets(organizationId);
    },

    accountRequests(organizationId: string) {
      return deps.store.listAccountRequests(organizationId);
    },

    diagnose(input: { plan: PlanId; phone?: string | null; calendarConnected: boolean; automationEnabled: boolean; smsConfigured: boolean }) {
      const findings = [];
      if (!orgHasFeature(input.plan, "MISSED_CALL_RECOVERY")) findings.push({ code: "plan", articleId: "billing", detail: "This plan does not include the AI receptionist." });
      if (!input.phone) findings.push({ code: "phone_missing", articleId: "phone", detail: "No business number is assigned." });
      if (!input.calendarConnected) findings.push({ code: "calendar_disconnected", articleId: "calendar", detail: "Google Calendar is not connected. Appointments cannot be confirmed." });
      if (!input.automationEnabled) findings.push({ code: "automation_off", articleId: "automations", detail: "Missed-call recovery is not enabled." });
      if (!input.smsConfigured) findings.push({ code: "sms_unconfigured", articleId: "sms", detail: "Messaging is not configured." });
      return { scope: "configuration" as const, liveVerified: false as const, findings };
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
