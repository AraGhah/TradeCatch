import { createId } from "@/lib/id";
import { normalizeE164, phoneKey } from "./phone";
import type { CrmStore } from "./store";
import {
  CONVERSATION_CONTROLS,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  type CaptureInput,
  type Conversation,
  type ConversationControl,
  type ConversationView,
  type CrmMessage,
  type Customer,
  type Lead,
  type LeadEvent,
  type LeadListFilters,
  type LeadPriority,
  type LeadStatus,
  type LeadWithCustomer,
} from "./types";

const PRIORITY_RANK: Record<LeadPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export class CrmError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CrmError";
  }
}

export type CaptureResult = {
  customer: Customer;
  lead: Lead;
  conversation: Conversation;
  created: boolean;
  blocked: boolean;
  message?: CrmMessage;
};

function splitName(displayName?: string): {
  firstName?: string;
  lastName?: string;
} {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function assertStatus(status: string): LeadStatus {
  if (!LEAD_STATUSES.includes(status as LeadStatus)) {
    throw new CrmError("Unknown lead status.");
  }
  return status as LeadStatus;
}

function assertPriority(priority: string): LeadPriority {
  if (!LEAD_PRIORITIES.includes(priority as LeadPriority)) {
    throw new CrmError("Unknown lead priority.");
  }
  return priority as LeadPriority;
}

function assertControl(control: string): ConversationControl {
  if (!CONVERSATION_CONTROLS.includes(control as ConversationControl)) {
    throw new CrmError("Unknown conversation control.");
  }
  return control as ConversationControl;
}

export function createCrmService(store: CrmStore) {
  async function ensureConversation(
    organizationId: string,
    customerId: string,
    lead: Lead,
    channel: Conversation["channel"],
    now: string,
  ): Promise<Conversation> {
    const linked = await store.findConversationForLead(organizationId, lead.id);
    if (linked) return linked;
    const latest = await store.findLatestConversation(organizationId, customerId);
    if (latest && (!latest.leadId || latest.leadId === lead.id)) {
      return (
        (await store.updateConversation(organizationId, latest.id, {
          leadId: lead.id,
          channel: latest.channel === channel ? latest.channel : "mixed",
        })) ?? latest
      );
    }
    return store.insertConversation({
      id: createId("conv"),
      organizationId,
      customerId,
      leadId: lead.id,
      channel,
      control: "ai_managed",
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    async capture(input: CaptureInput): Promise<CaptureResult> {
      const phone = normalizeE164(input.phoneE164);
      if (phoneKey(phone).length < 10) {
        throw new CrmError("A valid phone number is required.");
      }
      const now = (input.now ?? new Date()).toISOString();
      const names = splitName(input.displayName);
      const automatedOutbound = Boolean(
        input.message &&
          input.message.direction === "outbound" &&
          input.message.automated,
      );

      const existingCustomer = await store.findCustomerByPhone(
        input.organizationId,
        phone,
      );
      if (automatedOutbound && existingCustomer) {
        const latest = await store.findLatestConversation(
          input.organizationId,
          existingCustomer.id,
        );
        if (latest && latest.control !== "ai_managed") {
          const open = await store.findOpenLead(
            input.organizationId,
            existingCustomer.id,
          );
          if (open) {
            await store.appendEvent({
              organizationId: input.organizationId,
              leadId: open.id,
              kind: "automation_blocked",
              detail: latest.control,
              actor: input.actor ?? input.source,
              at: now,
            });
          }
          if (!open) {
            throw new CrmError("Automation is paused for this customer.", 409);
          }
          return {
            customer: existingCustomer,
            lead: open,
            conversation: latest,
            created: false,
            blocked: true,
          };
        }
      }

      const customer = await store.upsertCustomer({
        organizationId: input.organizationId,
        phoneE164: phone,
        firstName: input.firstName ?? names.firstName,
        lastName: input.lastName ?? names.lastName,
        displayName:
          input.displayName ??
          ([input.firstName, input.lastName].filter(Boolean).join(" ") ||
            undefined),
        email: input.email,
        serviceAddress: input.serviceAddress,
        preferredLanguage: input.preferredLanguage ?? "fr",
        notes: undefined,
        firstContactAt: now,
        lastContactAt: now,
      });

      let lead = await store.findOpenLead(input.organizationId, customer.id);
      let created = false;
      if (!lead) {
        lead = await store.insertLead({
          id: createId("lead"),
          organizationId: input.organizationId,
          customerId: customer.id,
          source: input.source,
          service: input.service,
          description: input.description,
          location: input.location,
          priority: input.priority ?? "medium",
          status: input.status ?? "new",
          callSessionId: input.callSessionId,
          callSid: input.callSid,
          missedCallLeadId: input.missedCallLeadId,
          websiteLeadId: input.websiteLeadId,
          urgencyNote: input.urgencyNote,
          createdAt: now,
          updatedAt: now,
        });
        created = true;
        await store.appendEvent({
          organizationId: input.organizationId,
          leadId: lead.id,
          kind: "created",
          detail: input.source,
          actor: input.actor ?? input.source,
          at: now,
        });
      } else {
        const patch: Partial<Lead> = {};
        if (
          input.description &&
          input.description !== lead.description &&
          !(lead.description ?? "").includes(input.description)
        ) {
          patch.description = [lead.description, input.description]
            .filter(Boolean)
            .join("\n")
            .slice(0, 4000);
        }
        if (input.service && !lead.service) patch.service = input.service;
        if (input.location && !lead.location) patch.location = input.location;
        if (
          input.priority &&
          PRIORITY_RANK[input.priority] > PRIORITY_RANK[lead.priority]
        ) {
          patch.priority = input.priority;
        }
        if (input.urgencyNote) patch.urgencyNote = input.urgencyNote;
        if (input.callSessionId && !lead.callSessionId) {
          patch.callSessionId = input.callSessionId;
        }
        if (input.callSid && !lead.callSid) patch.callSid = input.callSid;
        if (input.missedCallLeadId && !lead.missedCallLeadId) {
          patch.missedCallLeadId = input.missedCallLeadId;
        }
        if (input.websiteLeadId && !lead.websiteLeadId) {
          patch.websiteLeadId = input.websiteLeadId;
        }
        if (Object.keys(patch).length > 0) {
          lead =
            (await store.updateLead(input.organizationId, lead.id, patch)) ??
            lead;
        }
        await store.appendEvent({
          organizationId: input.organizationId,
          leadId: lead.id,
          kind: "touched",
          detail: input.source,
          actor: input.actor ?? input.source,
          at: now,
        });
      }

      const channel: Conversation["channel"] = input.message
        ? input.source === "ai_receptionist" || input.source === "missed_call"
          ? "mixed"
          : "sms"
        : input.source === "ai_receptionist" || input.source === "missed_call"
          ? "call"
          : "sms";
      const conversation = await ensureConversation(
        input.organizationId,
        customer.id,
        lead,
        channel,
        now,
      );
      if (lead.conversationId !== conversation.id) {
        lead =
          (await store.updateLead(input.organizationId, lead.id, {
            conversationId: conversation.id,
          })) ?? lead;
      }

      let message: CrmMessage | undefined;
      if (input.message?.body.trim()) {
        const saved = await store.appendMessage({
          organizationId: input.organizationId,
          conversationId: conversation.id,
          direction: input.message.direction,
          body: input.message.body.trim(),
          fromE164: input.message.fromE164 ?? (input.message.direction === "inbound" ? phone : undefined),
          toE164: input.message.toE164,
          automated: Boolean(input.message.automated),
          deliveryStatus: input.message.deliveryStatus ?? "queued",
          providerMessageSid: input.message.providerMessageSid,
          simulated: Boolean(input.message.simulated),
          at: now,
        });
        if (saved) {
          message = saved;
          await store.updateConversation(input.organizationId, conversation.id, {
            lastMessageAt: saved.at,
          });
          if (
            input.message.direction === "outbound" &&
            !input.message.automated &&
            lead.status === "new"
          ) {
            lead =
              (await store.updateLead(input.organizationId, lead.id, {
                status: "contacted",
              })) ?? lead;
          }
          await store.appendEvent({
            organizationId: input.organizationId,
            leadId: lead.id,
            kind:
              input.message.direction === "inbound"
                ? "message_in"
                : "message_out",
            detail: input.message.automated ? "automated" : "human",
            actor: input.actor ?? input.source,
            at: now,
          });
        }
      }

      return {
        customer,
        lead,
        conversation,
        created,
        blocked: false,
        message,
      };
    },

    async isAutomationPaused(organizationId: string, phoneE164: string) {
      const customer = await store.findCustomerByPhone(organizationId, phoneE164);
      if (!customer) return false;
      const conversation = await store.findLatestConversation(
        organizationId,
        customer.id,
      );
      return Boolean(conversation && conversation.control !== "ai_managed");
    },

    listLeads(organizationId: string, filters?: LeadListFilters) {
      return store.listLeads(organizationId, filters);
    },

    getLead(organizationId: string, id: string) {
      return store.getLead(organizationId, id);
    },

    findCustomerByPhone(organizationId: string, phoneE164: string) {
      return store.findCustomerByPhone(organizationId, phoneE164);
    },

    async updateLead(
      organizationId: string,
      id: string,
      patch: {
        status?: string;
        priority?: string;
        service?: string;
        description?: string;
        location?: string;
        assignedToUserId?: string | null;
        assignedToName?: string | null;
        actor?: string;
      },
    ): Promise<LeadWithCustomer> {
      const current = await store.getLead(organizationId, id);
      if (!current) throw new CrmError("Lead not found.", 404);
      const nextPatch: Partial<Lead> = {};
      const changes: string[] = [];
      if (patch.status !== undefined) {
        nextPatch.status = assertStatus(patch.status);
        if (nextPatch.status !== current.status) {
          changes.push(`status:${current.status}->${nextPatch.status}`);
        }
      }
      if (patch.priority !== undefined) {
        nextPatch.priority = assertPriority(patch.priority);
        if (nextPatch.priority !== current.priority) {
          changes.push(`priority:${current.priority}->${nextPatch.priority}`);
        }
      }
      if (patch.service !== undefined) nextPatch.service = patch.service;
      if (patch.description !== undefined) nextPatch.description = patch.description;
      if (patch.location !== undefined) nextPatch.location = patch.location;
      if (patch.assignedToUserId !== undefined) {
        nextPatch.assignedToUserId = patch.assignedToUserId || undefined;
        nextPatch.assignedToName = patch.assignedToName || undefined;
        changes.push(
          nextPatch.assignedToUserId
            ? `assigned:${nextPatch.assignedToName ?? nextPatch.assignedToUserId}`
            : "assigned:cleared",
        );
      }
      const saved =
        (await store.updateLead(organizationId, id, nextPatch)) ?? current;
      if (changes.length > 0) {
        await store.appendEvent({
          organizationId,
          leadId: id,
          kind: "updated",
          detail: changes.join(", "),
          actor: patch.actor,
        });
      }
      const fresh = await store.getLead(organizationId, saved.id);
      if (!fresh) throw new CrmError("Lead not found.", 404);
      return fresh;
    },

    async updateCustomerNotes(
      organizationId: string,
      customerId: string,
      notes: string,
    ) {
      const saved = await store.updateCustomer(organizationId, customerId, {
        notes,
      });
      if (!saved) throw new CrmError("Customer not found.", 404);
      return saved;
    },

    listEvents(organizationId: string, leadId: string): Promise<LeadEvent[]> {
      return store.listEvents(organizationId, leadId);
    },

    async listConversations(organizationId: string): Promise<ConversationView[]> {
      const conversations = await store.listConversations(organizationId);
      const views: ConversationView[] = [];
      for (const conversation of conversations) {
        const customer = await store.getCustomer(
          organizationId,
          conversation.customerId,
        );
        if (!customer) continue;
        const lead = conversation.leadId
          ? await store.getLead(organizationId, conversation.leadId)
          : null;
        const lastMessage = await store.latestMessage(
          organizationId,
          conversation.id,
        );
        views.push({
          ...conversation,
          customer,
          lead: lead ?? undefined,
          lastMessage: lastMessage ?? undefined,
        });
      }
      return views;
    },

    async getConversationBundle(organizationId: string, conversationId: string) {
      const conversation = await store.getConversation(
        organizationId,
        conversationId,
      );
      if (!conversation) return null;
      const customer = await store.getCustomer(
        organizationId,
        conversation.customerId,
      );
      if (!customer) return null;
      const messages = await store.listMessages(organizationId, conversationId);
      const lead = conversation.leadId
        ? await store.getLead(organizationId, conversation.leadId)
        : null;
      return { conversation, customer, messages, lead };
    },

    async setControl(
      organizationId: string,
      conversationId: string,
      control: string,
      actor?: string,
    ) {
      const next = assertControl(control);
      const conversation = await store.getConversation(
        organizationId,
        conversationId,
      );
      if (!conversation) throw new CrmError("Conversation not found.", 404);
      const saved = await store.updateConversation(
        organizationId,
        conversationId,
        { control: next },
      );
      if (!saved) throw new CrmError("Conversation not found.", 404);
      if (conversation.leadId) {
        await store.appendEvent({
          organizationId,
          leadId: conversation.leadId,
          kind: "control",
          detail: next,
          actor,
        });
      }
      return saved;
    },

    async sendHumanMessage(input: {
      organizationId: string;
      conversationId: string;
      body: string;
      actor?: string;
      simulated?: boolean;
    }) {
      const body = input.body.trim();
      if (!body) throw new CrmError("Message is empty.");
      const bundle = await this.getConversationBundle(
        input.organizationId,
        input.conversationId,
      );
      if (!bundle) throw new CrmError("Conversation not found.", 404);
      if (bundle.conversation.control === "closed") {
        throw new CrmError("This conversation is closed.", 409);
      }
      const now = new Date().toISOString();
      const message = await store.appendMessage({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        direction: "outbound",
        body,
        toE164: bundle.customer.phoneE164,
        automated: false,
        deliveryStatus: input.simulated ? "sent" : "queued",
        simulated: Boolean(input.simulated),
        at: now,
      });
      await store.updateConversation(input.organizationId, input.conversationId, {
        lastMessageAt: now,
        channel:
          bundle.conversation.channel === "call" ? "mixed" : bundle.conversation.channel,
      });
      if (bundle.lead && bundle.lead.status === "new") {
        await store.updateLead(input.organizationId, bundle.lead.id, {
          status: "contacted",
        });
      }
      if (bundle.conversation.leadId) {
        await store.appendEvent({
          organizationId: input.organizationId,
          leadId: bundle.conversation.leadId,
          kind: "message_out",
          detail: "human",
          actor: input.actor,
          at: now,
        });
      }
      return message;
    },

    clearOrganization(organizationId: string) {
      return store.clearOrganization(organizationId);
    },
  };
}

export type CrmService = ReturnType<typeof createCrmService>;
