/** Unified lead / customer / conversation CRM. */

export type LeadSource =
  | "ai_receptionist"
  | "missed_call"
  | "sms"
  | "website"
  | "manual";

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "appointment_booked"
  | "quote_sent"
  | "won"
  | "lost"
  | "closed";

export type LeadPriority = "urgent" | "high" | "medium" | "low";

export type ConversationControl =
  | "ai_managed"
  | "human_managed"
  | "automation_paused"
  | "closed";

export type MessageDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered";

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "appointment_booked",
  "quote_sent",
  "won",
  "lost",
  "closed",
];

export const OPEN_LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "appointment_booked",
  "quote_sent",
];

export const LEAD_PRIORITIES: LeadPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export const LEAD_SOURCES: LeadSource[] = [
  "ai_receptionist",
  "missed_call",
  "sms",
  "website",
  "manual",
];

export const CONVERSATION_CONTROLS: ConversationControl[] = [
  "ai_managed",
  "human_managed",
  "automation_paused",
  "closed",
];

export type Customer = {
  id: string;
  organizationId: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phoneE164: string;
  email?: string;
  serviceAddress?: string;
  preferredLanguage: "en" | "fr";
  allowSms: boolean;
  allowEmail: boolean;
  firstContactAt: string;
  lastContactAt: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Lead = {
  id: string;
  organizationId: string;
  customerId: string;
  source: LeadSource;
  service?: string;
  description?: string;
  location?: string;
  priority: LeadPriority;
  status: LeadStatus;
  assignedToUserId?: string;
  assignedToName?: string;
  callSessionId?: string;
  callSid?: string;
  missedCallLeadId?: string;
  websiteLeadId?: string;
  conversationId?: string;
  urgencyNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadEvent = {
  id: string;
  organizationId: string;
  leadId: string;
  kind: string;
  detail?: string;
  actor?: string;
  payload?: Record<string, unknown>;
  at: string;
};

export type Conversation = {
  id: string;
  organizationId: string;
  customerId: string;
  leadId?: string;
  channel: "sms" | "call" | "mixed";
  control: ConversationControl;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmMessage = {
  id: string;
  organizationId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body: string;
  fromE164?: string;
  toE164?: string;
  automated: boolean;
  deliveryStatus: MessageDeliveryStatus;
  providerMessageSid?: string;
  simulated: boolean;
  at: string;
};

export type LeadListFilters = {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  priority?: LeadPriority;
  assignedToUserId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type LeadWithCustomer = Lead & {
  customer: Customer;
};

export type ConversationView = Conversation & {
  customer: Customer;
  lead?: Lead;
  lastMessage?: CrmMessage;
};

export type CaptureMessage = {
  direction: "inbound" | "outbound";
  body: string;
  fromE164?: string;
  toE164?: string;
  automated?: boolean;
  deliveryStatus?: MessageDeliveryStatus;
  providerMessageSid?: string;
  simulated?: boolean;
};

export type CaptureInput = {
  organizationId: string;
  source: LeadSource;
  phoneE164: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  serviceAddress?: string;
  preferredLanguage?: "en" | "fr";
  service?: string;
  description?: string;
  location?: string;
  priority?: LeadPriority;
  status?: LeadStatus;
  urgencyNote?: string;
  callSessionId?: string;
  callSid?: string;
  missedCallLeadId?: string;
  websiteLeadId?: string;
  actor?: string;
  message?: CaptureMessage;
  now?: Date;
};
