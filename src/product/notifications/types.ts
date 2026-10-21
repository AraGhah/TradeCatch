export const NOTIFICATION_TYPES = [
  "lead_created",
  "urgent_request",
  "human_requested",
  "transfer_failed",
  "appointment_confirmed",
  "appointment_canceled",
  "appointment_rescheduled",
  "customer_message",
  "gmail_reply",
  "quote_response",
  "quote_accepted",
  "missed_call_recovered",
  "receptionist_offline",
  "automation_failure",
  "calendar_disconnected",
  "daily_summary",
  "support_update",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type Priority = "normal" | "high" | "critical";
export type Channel = "in_app" | "email" | "sms";
export type DeliveryStatus =
  | "pending"
  | "processing"
  | "submitted"
  | "delivered"
  | "failed"
  | "dead"
  | "simulated"
  | "canceled";

export type PreferenceCategory =
  | "new_leads"
  | "urgent"
  | "appointments"
  | "replies"
  | "quote_accepted"
  | "transfer_failed"
  | "automation_failures"
  | "daily_summary"
  | "outages"
  | "system";

export type ChannelPrefs = { inApp: boolean; email: boolean; sms: boolean };

export type NotificationPreferences = {
  organizationId: string;
  userId: string;
  categories: Record<PreferenceCategory, ChannelPrefs>;
  quietStart: string;
  quietEnd: string;
  quietEnabled: boolean;
  language: "en" | "fr";
  dailySummary: boolean;
  scope: "all" | "assigned";
  updatedAt: string;
};

export type EscalationRule = {
  organizationId: string;
  enabled: boolean;
  primaryUserId?: string;
  secondaryUserId?: string;
  secondaryPhoneE164?: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  acknowledgementRequired: boolean;
  delayMinutes: number;
  maxAttempts: number;
  afterHours: boolean;
  updatedAt: string;
};

export type EscalationContact = {
  userId: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
  /** Only an ownership-verified personal phone is exposed to settings managers. */
  verifiedPhoneE164?: string;
};

export type ContractorNotification = {
  id: string;
  organizationId: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: Priority;
  leadId?: string;
  appointmentId?: string;
  callId?: string;
  href?: string;
  consolidateKey?: string;
  idempotencyKey: string;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NotificationRecipient = {
  id: string;
  notificationId: string;
  organizationId: string;
  userId: string;
  readAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
};

export type NotificationDelivery = {
  id: string;
  notificationId: string;
  organizationId: string;
  recipientUserId?: string;
  channel: Channel;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  providerSid?: string;
  recoveryHandledAt?: string;
  destination?: string;
  simulated: boolean;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type SystemAlert = {
  id: string;
  organizationId?: string;
  component: string;
  severity: "high" | "critical";
  message: string;
  correlationId: string;
  createdAt: string;
};

export type OutboxEvent = {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  type: NotificationType;
  payload: NotificationPayload;
  status: "pending" | "processing" | "done" | "dead";
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

export type NotificationPayload = {
  /** Server-only routing: personal mailbox alerts must not fan out to the org. */
  recipientUserId?: string;
  message?: string;
  customer?: string;
  service?: string;
  location?: string;
  whenLabel?: string;
  leadId?: string;
  appointmentId?: string;
  callId?: string;
  href?: string;
  consolidateKey?: string;
  assigneeUserId?: string;
  simulated?: boolean;
  live?: boolean;
};

export const TYPE_PRIORITY: Record<NotificationType, Priority> = {
  lead_created: "normal",
  urgent_request: "critical",
  human_requested: "high",
  transfer_failed: "high",
  appointment_confirmed: "normal",
  appointment_canceled: "normal",
  appointment_rescheduled: "normal",
  customer_message: "normal",
  gmail_reply: "normal",
  quote_response: "high",
  quote_accepted: "high",
  missed_call_recovered: "normal",
  receptionist_offline: "critical",
  automation_failure: "high",
  calendar_disconnected: "high",
  daily_summary: "normal",
  support_update: "normal",
};

export const TYPE_CATEGORY: Record<NotificationType, PreferenceCategory> = {
  lead_created: "new_leads",
  urgent_request: "urgent",
  human_requested: "urgent",
  transfer_failed: "transfer_failed",
  appointment_confirmed: "appointments",
  appointment_canceled: "appointments",
  appointment_rescheduled: "appointments",
  customer_message: "replies",
  gmail_reply: "replies",
  quote_response: "replies",
  quote_accepted: "quote_accepted",
  missed_call_recovered: "new_leads",
  receptionist_offline: "outages",
  automation_failure: "automation_failures",
  calendar_disconnected: "automation_failures",
  daily_summary: "daily_summary",
  support_update: "system",
};
