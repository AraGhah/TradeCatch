/**
 * Email automation — templates, follow-up sequences, enrollments.
 * Inspired by PaulleDemon/Email-automation (templated, scheduled emails with
 * follow-up rules), rebuilt for multi-tenant TradeCatch orgs + Resend.
 */

export type EmailTemplate = {
  id: string;
  organizationId: string;
  name: string;
  locale: "fr" | "en";
  /** Template syntax — see template.ts. */
  subject: string;
  /** Plain text with template syntax; rendered to HTML paragraphs. */
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type SequenceStep = {
  templateId: string;
  /** Delay after enrollment (first step) or after the previous send. */
  delayHours: number;
};

export type EmailSequence = {
  id: string;
  organizationId: string;
  name: string;
  steps: SequenceStep[];
  /** Stop remaining steps once the contact replies (marked via API/webhook). */
  stopOnReply: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EnrollmentStatus = "active" | "completed" | "stopped" | "failed";

export type EnrollmentStopReason =
  "replied" | "unsubscribed" | "manual" | "sequence_inactive" | "bounced";

export type EnrollmentSend = {
  step: number;
  at: string;
  ok: boolean;
  providerId?: string;
  error?: string;
};

export type EmailEnrollment = {
  id: string;
  organizationId: string;
  sequenceId: string;
  email: string;
  name?: string;
  /** Extra template variables (quote_ref, service, amount…). */
  vars: Record<string, string>;
  status: EnrollmentStatus;
  stopReason?: EnrollmentStopReason;
  currentStep: number;
  nextSendAt?: string;
  attempts: number;
  /** Lease so two ticks never send the same step. */
  lockedUntil?: string;
  history: EnrollmentSend[];
  /** Where the contact came from (quote, ai_call, manual…). */
  source?: string;
  sourceRefId?: string;
  createdAt: string;
  updatedAt: string;
};

export type EmailSuppression = {
  organizationId: string;
  email: string;
  reason: "unsubscribed" | "bounced" | "manual";
  at: string;
};

export type OutboundEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export type EmailPort = {
  send(message: OutboundEmail): Promise<{ id: string }>;
};
