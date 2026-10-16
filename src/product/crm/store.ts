import type {
  Conversation,
  CrmMessage,
  Customer,
  Lead,
  LeadEvent,
  LeadListFilters,
  LeadWithCustomer,
} from "./types";

export type UpsertCustomerInput = {
  id?: string;
  organizationId: string;
  phoneE164: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  serviceAddress?: string;
  preferredLanguage: "en" | "fr";
  allowSms?: boolean;
  allowEmail?: boolean;
  notes?: string;
  firstContactAt: string;
  lastContactAt: string;
};

export type CrmStore = {
  upsertCustomer(input: UpsertCustomerInput): Promise<Customer>;
  getCustomer(organizationId: string, id: string): Promise<Customer | null>;
  findCustomerByPhone(
    organizationId: string,
    phoneE164: string,
  ): Promise<Customer | null>;
  updateCustomer(
    organizationId: string,
    id: string,
    patch: Partial<
      Pick<
        Customer,
        | "firstName"
        | "lastName"
        | "displayName"
        | "email"
        | "serviceAddress"
        | "preferredLanguage"
        | "allowSms"
        | "allowEmail"
        | "notes"
        | "lastContactAt"
      >
    >,
  ): Promise<Customer | null>;

  insertLead(lead: Lead): Promise<Lead>;
  getLead(organizationId: string, id: string): Promise<LeadWithCustomer | null>;
  findOpenLead(
    organizationId: string,
    customerId: string,
  ): Promise<Lead | null>;
  listLeads(
    organizationId: string,
    filters?: LeadListFilters,
  ): Promise<LeadWithCustomer[]>;
  updateLead(
    organizationId: string,
    id: string,
    patch: Partial<
      Pick<
        Lead,
        | "service"
        | "description"
        | "location"
        | "priority"
        | "status"
        | "assignedToUserId"
        | "assignedToName"
        | "conversationId"
        | "urgencyNote"
        | "callSessionId"
        | "callSid"
        | "missedCallLeadId"
        | "websiteLeadId"
      >
    >,
  ): Promise<Lead | null>;

  appendEvent(
    event: Omit<LeadEvent, "id" | "at"> & { id?: string; at?: string },
  ): Promise<LeadEvent>;
  listEvents(organizationId: string, leadId: string): Promise<LeadEvent[]>;

  insertConversation(conversation: Conversation): Promise<Conversation>;
  getConversation(
    organizationId: string,
    id: string,
  ): Promise<Conversation | null>;
  findConversationForLead(
    organizationId: string,
    leadId: string,
  ): Promise<Conversation | null>;
  findLatestConversation(
    organizationId: string,
    customerId: string,
  ): Promise<Conversation | null>;
  listConversations(organizationId: string): Promise<Conversation[]>;
  updateConversation(
    organizationId: string,
    id: string,
    patch: Partial<
      Pick<Conversation, "control" | "leadId" | "lastMessageAt" | "channel">
    >,
  ): Promise<Conversation | null>;

  appendMessage(
    message: Omit<CrmMessage, "id" | "at"> & { id?: string; at?: string },
  ): Promise<CrmMessage | null>;
  listMessages(
    organizationId: string,
    conversationId: string,
  ): Promise<CrmMessage[]>;
  latestMessage(
    organizationId: string,
    conversationId: string,
  ): Promise<CrmMessage | null>;

  clearOrganization(organizationId: string): Promise<void>;
};
