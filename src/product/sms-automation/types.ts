export const AUTOMATION_TYPES = [
  "missed_call_recovery",
  "quote_followup",
  "appointment_reminder",
  "customer_reengagement",
  "urgent_lead_notification",
] as const;

export type AutomationType = (typeof AUTOMATION_TYPES)[number];

/** Workflows that actually schedule and send. The others stay visible only. */
export const OPERATIONAL_AUTOMATION_TYPES: readonly AutomationType[] = [
  "missed_call_recovery",
  "quote_followup",
  "appointment_reminder",
];

export const TEMPLATE_KEYS = [
  "missed_call_recovery",
  "quote_followup_1",
  "quote_followup_2",
  "appointment_confirmation",
  "appointment_reminder",
  "general_followup",
  "human_assistance",
  "after_hours",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_VARIABLES = [
  "customer_name",
  "business_name",
  "service_name",
  "quote_ref",
  "appointment_time",
  "appointment_date",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * inquiry_response — direct reply to the customer's own call.
 * requested_estimate — follow-up on an estimate they were sent.
 * appointment_service — a visit they already booked.
 * marketing — ongoing promotion; requires recorded express consent.
 */
export type MessageCategory =
  | "inquiry_response"
  | "requested_estimate"
  | "appointment_service"
  | "marketing";

export type ConsentBasis =
  | "exemption_inquiry"
  | "requested_service"
  | "express_consent";

export type AutomationConfig = {
  trigger: string;
  initialDelayMinutes: number;
  secondDelayMinutes?: number;
  language: "en" | "fr" | "customer";
  maxAttempts: number;
  windowStartHour: number;
  windowEndHour: number;
  weekendSending: boolean;
  duplicateProtection: boolean;
  stopOnCustomerReply: boolean;
  stopOnHumanContact: boolean;
  stopOnQuoteAccepted: boolean;
  stopOnQuoteRejected: boolean;
  messageCategory: MessageCategory;
};

export type JobStatus =
  | "pending"
  | "processing"
  | "submitted"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "canceled"
  | "skipped"
  | "uncertain";

export type ResponseStatus = "none" | "awaiting" | "replied" | "opted_out";

export type AutomationRecord = {
  id: string;
  organizationId: string;
  type: AutomationType;
  enabled: boolean;
  config: AutomationConfig;
  successCount: number;
  failureCount: number;
  responseCount: number;
  lastExecutionStatus?: string;
  lastExecutionAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateRecord = {
  id: string;
  organizationId: string;
  templateKey: TemplateKey;
  locale: "en" | "fr";
  body: string;
  customized: boolean;
  createdAt: string;
  updatedAt: string;
};

export type JobPayload = {
  customerName?: string;
  templateKey: TemplateKey;
  locale: "en" | "fr";
  vars: Record<string, string>;
  leadId?: string;
  quoteThreadId?: string;
  callId?: string;
  attemptIndex: number;
  messageCategory: MessageCategory;
  consentId?: string;
  serviceName?: string;
  quoteStatus?: "open" | "accepted" | "rejected" | "replied";
  renderedBody?: string;
  disposition?: string;
  appointmentId?: string;
};

export type JobRecord = {
  id: string;
  organizationId: string;
  automationId: string;
  automationType: AutomationType;
  idempotencyKey: string;
  scheduledAt: string;
  status: JobStatus;
  attempts: number;
  claimToken?: string;
  claimedAt?: string;
  submittedAt?: string;
  providerMessageSid?: string;
  customerPhoneE164: string;
  simulated: boolean;
  cancelReason?: string;
  lastError?: string;
  responseStatus: ResponseStatus;
  price?: string;
  priceUnit?: string;
  payload: JobPayload;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionRecord = {
  id: string;
  organizationId: string;
  automationId: string;
  jobId: string;
  status: string;
  result?: string;
  error?: string;
  providerMessageSid?: string;
  messageBody?: string;
  simulated: boolean;
  at: string;
};

export type SuppressionRecord = {
  id: string;
  organizationId: string;
  phoneE164: string;
  phoneKey: string;
  reason: string;
  source: string;
  createdAt: string;
};

export type ConsentRecord = {
  id: string;
  organizationId: string;
  phoneE164: string;
  purpose: MessageCategory;
  basis: ConsentBasis;
  evidence: string;
  createdAt: string;
};

export type HistoryRow = {
  jobId: string;
  organizationId: string;
  customerName?: string;
  customerPhoneE164: string;
  leadId?: string;
  automationType: AutomationType;
  messageBody?: string;
  scheduledAt: string;
  submittedAt?: string;
  providerMessageSid?: string;
  status: JobStatus;
  responseStatus: ResponseStatus;
  error?: string;
  price?: string;
  priceUnit?: string;
  simulated: boolean;
  cancelReason?: string;
};
