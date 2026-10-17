export type TicketStatus = "open" | "investigating" | "waiting_for_customer" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "normal" | "high" | "critical";
export type TicketCategory = "ai" | "calls" | "sms" | "appointments" | "billing" | "other";
export type TicketKind = "issue" | "bug" | "feature";

export type SupportTicket = {
  id: string;
  organizationId: string;
  subject: string;
  category: TicketCategory;
  kind: TicketKind;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  contactEmail: string;
  relatedCallId?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportMessage = {
  id: string;
  ticketId: string;
  authorRole: "contractor" | "admin";
  body: string;
  internal: boolean;
  createdAt: string;
};

export type SupportAttachment = {
  id: string;
  ticketId: string;
  fileName: string;
  createdAt: string;
};

export type SupportEvent = {
  id: string;
  ticketId: string;
  action: string;
  createdAt: string;
};

export type AccountRequest = {
  id: string;
  organizationId: string;
  kind: "deletion" | "suspension" | "reactivation";
  status: "requested" | "in_review" | "completed";
  phoneRouting: "unchanged_until_transition";
  createdAt: string;
};

export type CustomerFeedback = {
  id: string;
  organizationId: string;
  kind: string;
  body: string;
  createdAt: string;
};

export type DiagnosticFinding = {
  code: string;
  articleId: string;
  detail: string;
};

export type DiagnosticCheck = "ai" | "phone" | "calendar" | "notifications" | "sms" | "automations" | "subscription" | "all";
