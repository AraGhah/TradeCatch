/**
 * AI Receptionist — inbound call answering domain types.
 *
 * Design notes:
 * - One `ReceptionistConfig` per answered phone number (business profile,
 *   greeting, hours, routing targets, FAQ, notification channels) — the same
 *   "one YAML per business" idea as kirklandsig/AIReceptionist, validated with Zod.
 * - Call control is expressed as provider-neutral voice verbs (say / gather /
 *   dial / record / hangup), the model used by Fonoster voice apps, and rendered
 *   to TwiML for Twilio (see `voice.ts`).
 */

import type {
  UrgencyClassification,
  UrgencyRubricEntry,
} from "@/product/missed-call/types";

export type ReceptionistLanguage = "fr" | "en";

export type RoutingTarget = {
  id: string;
  /** Spoken name, e.g. "Facturation" / "Billing" / "Marc". */
  name: string;
  phoneE164: string;
  /** Caller phrases that route here (FR + EN). */
  keywords: string[];
  description?: string;
};

export type FaqEntry = {
  id: string;
  /** Phrases that trigger this answer in the rule brain (FR + EN). */
  keywords: string[];
  question?: string;
  answerFr: string;
  answerEn: string;
};

export type NotificationChannel =
  | { type: "email"; to: string }
  | { type: "sms"; toE164: string }
  | { type: "webhook"; url: string; secret?: string };

export type AfterHoursMode =
  /** Answer, collect the request, promise a callback during business hours. */
  | "take_message"
  /** Same as take_message but still bridges critical emergencies live. */
  | "take_message_emergency_transfer";

export type ReceptionistConfig = {
  id: string;
  /**
   * "profile" = built from an organization's editable profile (multi-tenant);
   * unset / "env" = founder-managed env config.
   */
  source?: "env" | "profile";
  enabled: boolean;
  /** Links calls to Module A (missed-call) client + SaaS org. */
  clientAccountId: string;
  /** Twilio number callers dial — used to resolve the config on inbound calls. */
  phoneNumberE164: string;
  businessName: string;
  timezone: string;
  businessHours: { start: string; end: string; days: number[] };
  languages: ReceptionistLanguage[];
  defaultLanguage: ReceptionistLanguage;
  /** Twilio <Say> voices, e.g. Polly.Gabrielle-Neural (fr-CA) / Polly.Joanna-Neural. */
  voices: { fr: string; en: string };
  greetingFr: string;
  greetingEn: string;
  afterHoursMessageFr: string;
  afterHoursMessageEn: string;
  afterHoursMode: AfterHoursMode;
  /** Free-form tone/personality instructions for the LLM brain. */
  personality?: string;
  /** Short business facts the LLM may use (services, service area…). */
  businessFacts?: string;
  routing: RoutingTarget[];
  /** Live bridge for critical emergencies (gas, fire, flood…). */
  emergencyTransferE164?: string;
  /** Human fallback when the agent fails or the caller asks for a person. */
  fallbackTransferE164?: string;
  faqs: FaqEntry[];
  urgencyRubric: UrgencyRubricEntry[];
  /** Ask the caller for a preferred appointment window. */
  collectPreferredTime: boolean;
  /** Hard cap on caller turns before the agent wraps up with a message. */
  maxTurns: number;
  notifications: NotificationChannel[];
  /** SMS "from" number for owner notifications (defaults to phoneNumberE164). */
  smsFromE164?: string;
  /**
   * When the caller hangs up before leaving usable details, hand the call to
   * Module A so the missed-call SMS recovery flow can follow up by text.
   */
  smsRecoveryOnIncomplete: boolean;
  /** Days before transcripts/slot PII are purged by the retention tick. */
  transcriptRetentionDays: number;
};

export type CallStep =
  | "language"
  | "reason"
  | "name"
  | "address"
  | "callback"
  | "callback_number"
  | "preferred_time"
  | "anything_else"
  | "voicemail"
  | "done";

export type CallIntent =
  | "service_request"
  | "appointment"
  | "faq"
  | "transfer"
  | "message"
  | "emergency"
  | "other";

export type CallStatus =
  "in_progress" | "transferring" | "completed" | "failed";

export type CallOutcome =
  | "message_taken"
  | "appointment_requested"
  | "transferred"
  | "emergency_transferred"
  | "faq_answered"
  | "voicemail"
  | "caller_hung_up"
  | "failed";

export type CallSlots = {
  callerName?: string;
  serviceAddress?: string;
  issue?: string;
  callbackE164?: string;
  preferredTime?: string;
  /** Free-form message when the caller only wants to leave a note. */
  message?: string;
};

export type CallTurn = {
  at: string;
  speaker: "caller" | "agent" | "system";
  text: string;
  /** ASR confidence (0–1) when the provider reports it. */
  confidence?: number;
  /** Agent action taken on this turn (ask / transfer / end_call …). */
  action?: string;
  /** Which brain produced the agent turn. */
  brain?: "rules" | "llm" | "guardrail";
};

export type TransferAttempt = {
  at: string;
  targetId: string;
  targetName: string;
  phoneE164: string;
  reason: "caller_request" | "emergency" | "fallback";
  status: "dialing" | "completed" | "no_answer" | "busy" | "failed";
};

export type NotificationDelivery = {
  at: string;
  channel: NotificationChannel["type"];
  ok: boolean;
  detail?: string;
};

/**
 * What TradeCatch already knows about this caller (owner-facing only — never
 * spoken to the caller, since caller ID can be spoofed).
 */
export type CallContext = {
  websiteLeadId?: string;
  websiteLeadName?: string;
  websiteLeadService?: string;
  websiteLeadAt?: string;
  /** Earlier AI-answered calls from this number for the same business. */
  priorCalls: number;
};

export type CallSummary = {
  headline: string;
  language: ReceptionistLanguage;
  intent: CallIntent;
  outcome: CallOutcome;
  urgency: UrgencyClassification["level"] | "unknown";
  callerE164: string;
  callerName?: string;
  callbackE164?: string;
  serviceAddress?: string;
  issue?: string;
  preferredTime?: string;
  message?: string;
  transferredTo?: string;
  afterHours: boolean;
  durationSeconds?: number;
  nextStep: string;
  /** Human-readable "known contact" line, when the caller is already in the CRM. */
  knownContact?: string;
  /** Optional LLM prose summary — never replaces the structured fields. */
  aiSummary?: string;
};

export type CallSession = {
  id: string;
  callSid: string;
  configId: string;
  clientAccountId: string;
  fromE164: string;
  toE164: string;
  language: ReceptionistLanguage;
  status: CallStatus;
  step: CallStep;
  intent?: CallIntent;
  outcome?: CallOutcome;
  afterHours: boolean;
  slots: CallSlots;
  urgency?: UrgencyClassification;
  turns: CallTurn[];
  silenceCount: number;
  callerTurnCount: number;
  transfers: TransferAttempt[];
  recordingUrl?: string;
  summary?: CallSummary;
  context?: CallContext;
  notifications: NotificationDelivery[];
  finalizedAt?: string;
  /** Set once Module A SMS recovery was handed this call. */
  smsRecoveryTriggeredAt?: string;
  transcriptPurgedAt?: string;
  durationSeconds?: number;
  startedAt: string;
  endedAt?: string;
  updatedAt: string;
  /** Optimistic concurrency token — stores increment on each save. */
  version: number;
};

/* ------------------------------------------------------------------------- */
/* Provider-neutral voice verbs (Fonoster-style)                              */
/* ------------------------------------------------------------------------- */

/** Logical callback targets; renderers map them to URLs or in-process hooks. */
export type VoiceCallbackStep = "gather" | "dial" | "voicemail";

export type VoiceVerb =
  | {
      verb: "say";
      text: string;
      language: ReceptionistLanguage;
      voice: string;
    }
  | {
      verb: "gather";
      next: "gather";
      language: ReceptionistLanguage;
      /** Prompts spoken while listening (barge-in allowed), in order. */
      prompts: {
        text: string;
        voice: string;
        language: ReceptionistLanguage;
      }[];
      input: ("speech" | "dtmf")[];
      timeoutSeconds: number;
      numDigits?: number;
      hints?: string[];
    }
  | {
      verb: "dial";
      next: "dial";
      phoneE164: string;
      callerIdE164?: string;
      timeoutSeconds: number;
    }
  | {
      verb: "record";
      next: "voicemail";
      maxLengthSeconds: number;
    }
  | { verb: "pause"; seconds: number }
  | { verb: "hangup" };

export type VoicePlan = {
  sessionId: string | null;
  verbs: VoiceVerb[];
};

/* ------------------------------------------------------------------------- */
/* Brain (decision policy)                                                    */
/* ------------------------------------------------------------------------- */

export type AgentAction =
  | { type: "ask" }
  | { type: "transfer"; targetId: string }
  | { type: "end_call" };

export type AgentDecision = {
  reply: string;
  action: AgentAction;
  nextStep: CallStep;
  slots?: Partial<CallSlots>;
  intent?: CallIntent;
  outcome?: CallOutcome;
  brain: "rules" | "llm" | "guardrail";
};

export type BrainInput = {
  config: ReceptionistConfig;
  session: CallSession;
  utterance: string;
  digits?: string;
};

export type ReceptionistBrain = {
  decide(input: BrainInput): Promise<AgentDecision>;
};
