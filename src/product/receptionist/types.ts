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

/** Owner-chosen pace of the synthesized voice (see speech-style.ts). */
export type SpeakingSpeed = "slow" | "normal" | "fast";

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

/**
 * When the AI answers inbound calls. Overflow is configured here; live forward
 * wiring lands in Task 4 (telephony). Until then overflow behaves like always.
 */
export type CallHandlingMode =
  "always" | "business_hours" | "after_hours" | "overflow" | "disabled";

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
  /** Spoken AI identity, e.g. "Sophie". */
  receptionistName?: string;
  /** Owner-configured when the AI should answer. */
  callHandlingMode: CallHandlingMode;
  /** Ring contractor first, then AI (Task 4). */
  inboundStrategy: "ai_first" | "human_first";
  /** Seconds to ring the human on overflow / human_first. */
  humanRingTimeoutSeconds: number;
  /** gather (TwiML) or conversation_relay (Twilio ConversationRelay). */
  voiceEngine: "gather" | "conversation_relay";
  timezone: string;
  businessHours: { start: string; end: string; days: number[] };
  languages: ReceptionistLanguage[];
  defaultLanguage: ReceptionistLanguage;
  /** Twilio <Say> voices, e.g. Polly.Gabrielle-Neural (fr-CA) / Polly.Joanna-Neural. */
  voices: { fr: string; en: string };
  /** Pace of the synthesized voice. Unset = "normal". */
  speakingSpeed?: SpeakingSpeed;
  greetingFr: string;
  greetingEn: string;
  afterHoursMessageFr: string;
  afterHoursMessageEn: string;
  afterHoursMode: AfterHoursMode;
  /** Free-form tone/personality instructions for the LLM brain. */
  personality?: string;
  /** Short business facts the LLM may use (services, service area…). */
  businessFacts?: string;
  /**
   * Services the business really offers, as the owner wrote them. Used to say
   * "we don't do that" instead of taking a request nobody can serve. Empty
   * means unknown, never "offers nothing".
   */
  services?: string[];
  /** Cities / regions served, as the owner wrote them. */
  serviceAreas?: string[];
  /**
   * Prices the owner approved to be read out ("Estimates are free; service
   * calls from $89"). Unset = no price may be stated.
   */
  pricingInfo?: string;
  /**
   * The business's rendered system prompt (template + its own details). Set
   * for tenant profiles; unset for founder env configs, which keep the
   * built-in prompt.
   */
  systemPrompt?: string;
  routing: RoutingTarget[];
  /** Live bridge for critical emergencies (gas, fire, flood…). */
  emergencyTransferE164?: string;
  /** Human fallback when the agent fails or the caller asks for a person. */
  fallbackTransferE164?: string;
  /** Explicit opt-in to voicemail + email while no live transfer line exists. */
  allowVoicemailOnly?: boolean;
  faqs: FaqEntry[];
  urgencyRubric: UrgencyRubricEntry[];
  /** Ask the caller for a preferred appointment window. */
  collectPreferredTime: boolean;
  /**
   * Owner opt-in: offer real open times and reserve one during the call.
   * Off (default) = the call only captures a requested window for the team.
   */
  phoneBooking?: boolean;
  /**
   * Plan flag: include the full transcript in the owner's call email. Unset =
   * included (founder/env configs); false on plans without full transcripts.
   */
  transcriptsEnabled?: boolean;
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
  /** One question about the size/kind of job, asked once for known trades. */
  | "scope"
  | "name"
  | "address"
  | "callback"
  | "callback_number"
  | "preferred_time"
  /** Open times were read out; waiting for the caller to choose one. */
  | "offer_slot"
  /** The request was read back; waiting for "yes" or a correction. */
  | "confirm"
  /** The caller said the recap was wrong; waiting for what to fix. */
  | "correction"
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
  /** A time was captured for the team to confirm — nothing was reserved. */
  | "appointment_requested"
  /** The scheduling backend reserved the slot while the caller was on the line. */
  | "appointment_booked"
  | "transferred"
  | "emergency_transferred"
  | "faq_answered"
  | "voicemail"
  | "caller_hung_up"
  | "failed";

export type CallSlots = {
  callerName?: string;
  serviceAddress?: string;
  /** City or area only, when the caller gave that but not a street address yet. */
  location?: string;
  /** The trade the caller needs, in the caller's own words ("painting", "plomberie"). */
  service?: string;
  /** What part of the property the job concerns ("kitchen", "la salle de bain"). */
  project?: string;
  email?: string;
  issue?: string;
  callbackE164?: string;
  preferredTime?: string;
  /** Free-form message when the caller only wants to leave a note. */
  message?: string;
};

/** An open time read to the caller. `label` is already in the call language. */
export type OfferedSlot = {
  startAt: string;
  endAt: string;
  label: string;
};

/**
 * Phone-booking state for one call. `booked` is set only after the scheduling
 * backend returned a confirmed reservation; everything else is a request.
 */
export type CallBooking = {
  status: "offering" | "booked" | "requested";
  serviceId?: string;
  serviceName?: string;
  /** Business-local zone the labels were rendered in. */
  timezone: string;
  offered: OfferedSlot[];
  /** How many lists of times were read out (capped). */
  rounds: number;
  /** Answers that matched no offered time. */
  misses: number;
  appointmentId?: string;
  startAt?: string;
  label?: string;
  /** Why the call fell back to a request, when it did. */
  fallbackReason?: string;
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
  reason:
    | "caller_request"
    | "emergency"
    | "fallback"
    | "overflow_ring"
    | "human_first";
  status: "dialing" | "completed" | "no_answer" | "busy" | "failed";
  /** After a failed overflow/human_first ring, continue into the AI. */
  continueWithAi?: boolean;
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
  /** Present when the call went through phone booking. */
  appointment?: {
    status: "booked" | "requested";
    startAt?: string;
    label?: string;
    appointmentId?: string;
    serviceName?: string;
  };
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

/** What the receptionist already did on this call, so it never does it twice. */
export type CallFlags = {
  /** The caller asked about price at least once (and got the approved answer). */
  pricingAsked?: boolean;
  /** The job-scope question was already asked. */
  scopeAsked?: boolean;
  /** The caller asked whether they are talking to an AI and was told. */
  identityAnswered?: boolean;
  /** The caller picked or asked for a language; keypad/speech no longer re-decide it. */
  languageLocked?: boolean;
  /** The service the caller wanted is not offered by this business. */
  serviceNotOffered?: boolean;
  /** The recap was read back once. */
  recapped?: boolean;
  /** "For English, press 1" was repeated after a French turn the recognizer could not follow. */
  englishHinted?: boolean;
  /** How many times the caller was politely steered back from an unrelated question. */
  offTopic?: number;
  /** How many times the name was asked again because the answer was not a name. */
  nameRetries?: number;
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
  booking?: CallBooking;
  urgency?: UrgencyClassification;
  turns: CallTurn[];
  silenceCount: number;
  callerTurnCount: number;
  /** Consecutive turns the recognizer was unsure about (reset by a clear one). */
  unclearCount?: number;
  /** Conversation bookkeeping that keeps the receptionist from repeating itself. */
  flags?: CallFlags;
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
      /** Owner-chosen pace; the TwiML renderer turns it into SSML. */
      speed?: SpeakingSpeed;
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
        speed?: SpeakingSpeed;
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
  /** Bookkeeping the brain changed on this turn (merged into session.flags). */
  flags?: Partial<CallFlags>;
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
