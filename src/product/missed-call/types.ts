/**
 * Module A — Missed-call recovery domain types.
 */

export type CallDisposition =
  "missed" | "answered" | "abandoned" | "after_hours_missed";

export type ConversationLanguage = "fr" | "en";

export type WorkflowStatus =
  | "started"
  | "awaiting_customer"
  | "awaiting_technician"
  | "awaiting_human"
  | "completed"
  | "stopped";

export type WorkflowStopReason =
  | "opt_out"
  | "duplicate_suppressed"
  | "call_answered"
  | "call_abandoned_no_sms"
  | "technician_declined"
  | "technician_timeout"
  | "customer_timeout"
  | "manual_stop"
  | "outside_service_area"
  | "completed";

export type CollectionStep =
  "language" | "name" | "address" | "description" | "photo" | "done";

export type OutcomeStatus =
  | "open"
  | "technician_accepted"
  | "technician_declined"
  | "customer_unreachable"
  | "resolved"
  | "cancelled"
  | "human_review";

export type ServiceAreaVerdict = "inside" | "outside" | "uncertain";

export type UrgencyLevel = "routine" | "priority" | "critical";

export type UrgencyClassification = {
  level: UrgencyLevel;
  source: string;
  requiresHuman: boolean;
  escalated: boolean;
  matchedKeyword?: string;
};

export type ServiceAreaRule = {
  id: string;
  label: string;
  matchTokens: string[];
};

export type UrgencyRubricEntry = {
  id: string;
  level: UrgencyLevel;
  keywordsFr: string[];
  keywordsEn: string[];
};

export type TechnicianRole = "primary" | "backup" | "owner";

export type TechnicianRosterEntry = {
  id: string;
  name: string;
  phone: string;
  role: TechnicianRole;
  active: boolean;
};

export type OnCallScheduleSlot = {
  day: number;
  start: string;
  end: string;
  technicianId: string;
};

export type EscalationPolicy = {
  primaryResponseMs: number;
  backupResponseMs: number;
  ownerResponseMs: number;
};

/** Max time waiting for customer SMS answers before abandoning collection. */
export type ClientTimeouts = {
  customerCollectionMs: number;
};

export type EscalationStage = "primary" | "backup" | "owner" | "exhausted";

export type TechnicianAlertRecord = {
  technicianId: string;
  phone: string;
  sentAt: string;
  stage: EscalationStage;
  /** Short opaque token included in the job-card SMS; replies must carry it. */
  actionToken: string;
  respondedAt?: string;
  response?: "accepted" | "declined" | "call_customer" | "timed_out";
};

export type ClientAccount = {
  id: string;
  name: string;
  contractorDisplayName: string;
  timezone: string;
  businessHours: { start: string; end: string; days: number[] };
  serviceAreaNotes?: string;
  approvedServiceAreas: ServiceAreaRule[];
  urgencyRubric: UrgencyRubricEntry[];
  technicianRoster: TechnicianRosterEntry[];
  mainTechnicianId: string;
  backupTechnicianIds: string[];
  ownerTechnicianId?: string;
  onCallSchedule: OnCallScheduleSlot[];
  escalationPolicy: EscalationPolicy;
  timeouts?: ClientTimeouts;
  onCallTechnicians: Technician[];
  approvedQuestions: ApprovedQuestion[];
  smsFromNumber: string;
  optOutKeywords: string[];
  duplicateWindowMs: number;
  humanReviewPhone?: string;
};

export type ApprovedQuestion = {
  id: CollectionStep;
  enabled: boolean;
  promptFr: string;
  promptEn: string;
  required: boolean;
};

export type Technician = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
};

export type CallRecord = {
  id: string;
  clientAccountId: string;
  callerE164: string;
  calledAt: string;
  disposition: CallDisposition;
  durationSeconds?: number;
  twilioCallSid?: string;
  recordingUrl?: string | null;
};

export type CollectedLead = {
  language: ConversationLanguage;
  customerName?: string;
  serviceAddress?: string;
  issueDescription?: string;
  photoUrls: string[];
};

export type WorkflowEvent = {
  at: string;
  type: string;
  detail?: string;
};

export type MissedCallWorkflow = {
  id: string;
  clientAccountId: string;
  callId: string;
  callerE164: string;
  status: WorkflowStatus;
  stopReason?: WorkflowStopReason;
  currentStep: CollectionStep;
  collected: CollectedLead;
  serviceArea?: ServiceAreaVerdict;
  serviceAreaFlagged?: boolean;
  urgency?: UrgencyClassification;
  humanReviewRequired?: boolean;
  assignedTechnicianId?: string;
  /** Index into escalationChainIds (or live getEscalationChain); -1 before first alert. */
  escalationIndex: number;
  escalationStage: EscalationStage;
  /** Snapshot of technician IDs at first alert — do not re-resolve from schedule mid-workflow. */
  escalationChainIds?: string[];
  technicianAlertedAt?: string;
  technicianAlerts: TechnicianAlertRecord[];
  leadId?: string;
  outcome: OutcomeStatus;
  events: WorkflowEvent[];
  createdAt: string;
  updatedAt: string;
  dedupeKey: string;
  /** ISO timestamp when customer collection started (for timeout). */
  collectionStartedAt?: string;
  /** ISO timestamp until which another worker holds the escalation lease. */
  escalationClaimUntil?: string;
  /** True while accept is recorded but customer notify SMS has not succeeded. */
  acceptNotifyPending?: boolean;
};

export type ConversationMessage = {
  at: string;
  direction: "inbound" | "outbound";
  fromE164: string;
  toE164: string;
  body: string;
  mediaUrls?: string[];
  actor?: "customer" | "technician" | "system";
};

export type SmsSuppressionRecord = {
  clientAccountId: string;
  phoneE164: string;
  channel: "sms";
  source: "customer_keyword" | "manual" | "provider";
  at: string;
  /** Local vs provider sync state for Twilio Advanced Opt-Out / Messaging. */
  providerStatus: "local_only" | "synced" | "pending" | "error";
  providerDetail?: string;
  /** Evidence if the customer later re-consents (kept for audit). */
  reConsentEvidence?: {
    at: string;
    method: string;
    note?: string;
  };
  note?: string;
};

export type LeadRecord = {
  id: string;
  clientAccountId: string;
  workflowId: string;
  callId: string;
  callerE164: string;
  customerName?: string;
  serviceAddress?: string;
  issueDescription?: string;
  photoUrls: string[];
  serviceArea?: ServiceAreaVerdict;
  serviceAreaFlagged: boolean;
  urgency?: UrgencyClassification;
  humanReviewRequired: boolean;
  conversation: ConversationMessage[];
  techniciansAlerted: TechnicianAlertRecord[];
  technicianResponseMs?: number;
  jobAccepted?: boolean;
  becameBooking?: boolean;
  estimatedValue?: number;
  finalValue?: number;
  manualCorrections: ManualCorrection[];
  outcome: OutcomeStatus;
  createdAt: string;
  updatedAt: string;
};

export type ManualCorrection = {
  at: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  note?: string;
};

export type InboundSms = {
  fromE164: string;
  toE164: string;
  body: string;
  mediaUrls?: string[];
  messageSid?: string;
};

export type OutboundSms = {
  toE164: string;
  fromE164: string;
  body: string;
  mediaUrl?: string;
};

export type OutboundMessageStatus =
  "queued" | "sending" | "retry" | "sent" | "dead";

/** Durable SMS outbox row (Postgres mc_outbound_messages / memory mirror). */
export type OutboundMessageRecord = {
  id: string;
  workflowId?: string;
  clientAccountId: string;
  toE164: string;
  fromE164: string;
  body: string;
  status: OutboundMessageStatus;
  providerSid?: string;
  attempts: number;
  lastError?: string;
  /** Correlates with workflow event detail (e.g. opening_fr). */
  detail?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type SmsPort = {
  send(message: OutboundSms): Promise<{ sid: string }>;
  /**
   * Best-effort sync of an opt-out to the provider (Twilio Advanced Opt-Out /
   * Messaging). Implementations may no-op when credentials are absent.
   */
  syncOptOut?(input: {
    phoneE164: string;
    fromE164: string;
  }): Promise<{ ok: boolean; detail?: string }>;
};

export type Clock = {
  now(): Date;
};
