import { createId } from "@/lib/id";
import { phoneKey } from "./phone";
import type { CrmStore, UpsertCustomerInput } from "./store";
import {
  OPEN_LEAD_STATUSES,
  type Conversation,
  type CrmMessage,
  type Customer,
  type Lead,
  type LeadEvent,
  type LeadListFilters,
  type LeadWithCustomer,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function withCustomer(lead: Lead, customer: Customer): LeadWithCustomer {
  return { ...clone(lead), customer: clone(customer) };
}

function matchesFilters(row: LeadWithCustomer, filters: LeadListFilters): boolean {
  if (filters.status && row.status !== filters.status) return false;
  if (filters.source && row.source !== filters.source) return false;
  if (filters.priority && row.priority !== filters.priority) return false;
  if (
    filters.assignedToUserId &&
    row.assignedToUserId !== filters.assignedToUserId
  ) {
    return false;
  }
  if (filters.from && row.createdAt < filters.from) return false;
  if (filters.to && row.createdAt > filters.to) return false;
  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    const hay = [
      row.customer.displayName,
      row.customer.firstName,
      row.customer.lastName,
      row.customer.phoneE164,
      row.customer.email,
      row.service,
      row.description,
      row.location,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function createMemoryCrmStore(): CrmStore {
  const customers = new Map<string, Customer>();
  const leads = new Map<string, Lead>();
  const events: LeadEvent[] = [];
  const conversations = new Map<string, Conversation>();
  const messages: CrmMessage[] = [];

  function customerFor(organizationId: string, id: string): Customer | null {
    const row = customers.get(id);
    if (!row || row.organizationId !== organizationId) return null;
    return row;
  }

  return {
    async listCustomers(organizationId, limit = 1001) {
      return [...customers.values()].filter(c=>c.organizationId===organizationId).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit).map(clone);
    },
    async upsertCustomer(input: UpsertCustomerInput) {
      const key = phoneKey(input.phoneE164);
      const existing = [...customers.values()].find(
        (c) => c.organizationId === input.organizationId && phoneKey(c.phoneE164) === key,
      );
      const now = input.lastContactAt;
      if (existing) {
        const next: Customer = {
          ...existing,
          firstName: input.firstName ?? existing.firstName,
          lastName: input.lastName ?? existing.lastName,
          displayName: input.displayName ?? existing.displayName,
          email: input.email ?? existing.email,
          serviceAddress: input.serviceAddress ?? existing.serviceAddress,
          preferredLanguage: input.preferredLanguage || existing.preferredLanguage,
          notes: input.notes ?? existing.notes,
          phoneE164: input.phoneE164 || existing.phoneE164,
          lastContactAt: now,
          updatedAt: now,
        };
        customers.set(existing.id, next);
        return clone(next);
      }
      const row: Customer = {
        id: input.id ?? createId("cus"),
        organizationId: input.organizationId,
        phoneE164: input.phoneE164,
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName,
        email: input.email,
        serviceAddress: input.serviceAddress,
        preferredLanguage: input.preferredLanguage,
        allowSms: input.allowSms ?? true,
        allowEmail: input.allowEmail ?? true,
        notes: input.notes,
        firstContactAt: input.firstContactAt,
        lastContactAt: input.lastContactAt,
        createdAt: input.firstContactAt,
        updatedAt: now,
      };
      customers.set(row.id, row);
      return clone(row);
    },

    async getCustomer(organizationId, id) {
      const row = customerFor(organizationId, id);
      return row ? clone(row) : null;
    },

    async findCustomerByPhone(organizationId, phoneE164) {
      const key = phoneKey(phoneE164);
      const row = [...customers.values()].find(
        (c) => c.organizationId === organizationId && phoneKey(c.phoneE164) === key,
      );
      return row ? clone(row) : null;
    },

    async updateCustomer(organizationId, id, patch) {
      const row = customerFor(organizationId, id);
      if (!row) return null;
      const next: Customer = {
        ...row,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      customers.set(id, next);
      return clone(next);
    },

    async insertLead(lead) {
      leads.set(lead.id, clone(lead));
      return clone(lead);
    },

    async getLead(organizationId, id) {
      const lead = leads.get(id);
      if (!lead || lead.organizationId !== organizationId) return null;
      const customer = customerFor(organizationId, lead.customerId);
      if (!customer) return null;
      return withCustomer(lead, customer);
    },

    async findOpenLead(organizationId, customerId) {
      const open = [...leads.values()]
        .filter(
          (l) =>
            l.organizationId === organizationId &&
            l.customerId === customerId &&
            OPEN_LEAD_STATUSES.includes(l.status),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return open[0] ? clone(open[0]) : null;
    },

    async listLeads(organizationId, filters = {}) {
      const rows: LeadWithCustomer[] = [];
      for (const lead of leads.values()) {
        if (lead.organizationId !== organizationId) continue;
        const customer = customerFor(organizationId, lead.customerId);
        if (!customer) continue;
        const joined = withCustomer(lead, customer);
        if (!matchesFilters(joined, filters)) continue;
        rows.push(joined);
      }
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? 100;
      return rows.slice(offset, offset + limit);
    },

    async updateLead(organizationId, id, patch) {
      const lead = leads.get(id);
      if (!lead || lead.organizationId !== organizationId) return null;
      const next: Lead = {
        ...lead,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      if (patch.assignedToUserId === undefined && "assignedToUserId" in patch) {
        next.assignedToUserId = undefined;
        next.assignedToName = undefined;
      }
      leads.set(id, next);
      return clone(next);
    },

    async appendEvent(event) {
      const row: LeadEvent = {
        id: event.id ?? createId("lev"),
        organizationId: event.organizationId,
        leadId: event.leadId,
        kind: event.kind,
        detail: event.detail,
        actor: event.actor,
        payload: event.payload,
        at: event.at ?? new Date().toISOString(),
      };
      events.push(row);
      return clone(row);
    },

    async listEvents(organizationId, leadId) {
      return events
        .filter(
          (e) => e.organizationId === organizationId && e.leadId === leadId,
        )
        .sort((a, b) => a.at.localeCompare(b.at))
        .map(clone);
    },

    async insertConversation(conversation) {
      conversations.set(conversation.id, clone(conversation));
      return clone(conversation);
    },

    async getConversation(organizationId, id) {
      const row = conversations.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      return clone(row);
    },

    async findConversationForLead(organizationId, leadId) {
      const row = [...conversations.values()].find(
        (c) => c.organizationId === organizationId && c.leadId === leadId,
      );
      return row ? clone(row) : null;
    },

    async findLatestConversation(organizationId, customerId) {
      const rows = [...conversations.values()]
        .filter(
          (c) =>
            c.organizationId === organizationId && c.customerId === customerId,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return rows[0] ? clone(rows[0]) : null;
    },

    async listConversations(organizationId, limit) {
      return [...conversations.values()]
        .filter((c) => c.organizationId === organizationId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0,limit)
        .map(clone);
    },

    async updateConversation(organizationId, id, patch) {
      const row = conversations.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      const next: Conversation = {
        ...row,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      conversations.set(id, next);
      return clone(next);
    },

    async appendMessage(message) {
      if (message.providerMessageSid) {
        const dup = messages.find(
          (m) => m.providerMessageSid === message.providerMessageSid,
        );
        if (dup) return null;
      }
      const row: CrmMessage = {
        id: message.id ?? createId("msg"),
        organizationId: message.organizationId,
        conversationId: message.conversationId,
        direction: message.direction,
        body: message.body,
        fromE164: message.fromE164,
        toE164: message.toE164,
        automated: message.automated,
        deliveryStatus: message.deliveryStatus,
        providerMessageSid: message.providerMessageSid,
        simulated: message.simulated,
        at: message.at ?? new Date().toISOString(),
      };
      messages.push(row);
      return clone(row);
    },

    async listMessages(organizationId, conversationId, limit) {
      return messages
        .filter(
          (m) =>
            m.organizationId === organizationId &&
            m.conversationId === conversationId,
        )
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(0,limit)
        .map(clone);
    },

    async latestMessage(organizationId, conversationId) {
      const rows = messages
        .filter(
          (m) =>
            m.organizationId === organizationId &&
            m.conversationId === conversationId,
        )
        .sort((a, b) => b.at.localeCompare(a.at));
      return rows[0] ? clone(rows[0]) : null;
    },

    async clearOrganization(organizationId) {
      for (const [id, row] of customers) {
        if (row.organizationId === organizationId) customers.delete(id);
      }
      for (const [id, row] of leads) {
        if (row.organizationId === organizationId) leads.delete(id);
      }
      for (const [id, row] of conversations) {
        if (row.organizationId === organizationId) conversations.delete(id);
      }
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]?.organizationId === organizationId) events.splice(i, 1);
      }
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.organizationId === organizationId) messages.splice(i, 1);
      }
    },
  };
}
