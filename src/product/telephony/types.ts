/**
 * Phone call management types (Task 4).
 * Complements the AI receptionist engine with provider routing, events, and
 * phone-number settings exposed in the contractor dashboard.
 */

export type PhoneConnectionStatus = "connected" | "disconnected" | "error";

export type InboundStrategy = "ai_first" | "human_first";

/**
 * Who speaks for the AI leg of a webhook call: the built-in TwiML engine,
 * Twilio ConversationRelay, or a SIP hand-off to the LiveKit voice agent
 * (agents/receptionist) — the same agent the direct SIP trunk reaches.
 */
export type VoiceEngineMode = "gather" | "conversation_relay" | "livekit";

/**
 * The contractor's choice of when the AI receptionist picks up.
 * - missed_calls_only: the contractor's phone rings first; the AI answers
 *   only when nobody takes the call (default for new Receptionist plans).
 * - ai_answers_all: the AI answers every business call immediately.
 */
export type AiCallMode = "missed_calls_only" | "ai_answers_all";

/**
 * How callers reach TradeCatch.
 * - tradecatch_number: callers dial the TradeCatch number; TradeCatch rings
 *   the contractor's phone first (missed-calls-only) or answers at once.
 * - carrier_forwarding: callers dial the contractor's own cell or line, and
 *   the carrier forwards to TradeCatch. The carrier decides which calls
 *   arrive; TradeCatch never rings that phone back (it would loop).
 */
export type CallRoutingMethod = "tradecatch_number" | "carrier_forwarding";

/** What happens when a number on the personal-contacts list calls. */
export type PersonalCallPolicy =
  /** A short owner-written message, then the call ends. The AI never starts. */
  | "message"
  /** Ring an owner-approved destination (never the forwarding phone). */
  | "transfer"
  /** End the call quietly. */
  | "end";

/** What happens when the caller ID is withheld, blocked or unparseable. */
export type UnknownCallerPolicy = "ai" | "message";

export type PersonalContact = { e164: string; label?: string };

/**
 * Setup status of the AI call-handling mode. Only `verified` means the mode
 * the contractor asked for is the one callers actually get.
 */
export type AiCallSetupStatus =
  | "unsupported_plan"
  | "disabled"
  | "not_configured"
  | "setup_required"
  | "awaiting_test_call"
  | "verified";

/** Why a mode is not (yet) active, as stable codes the dashboard translates. */
export type AiCallSetupIssue =
  | "plan_has_no_voice"
  | "receptionist_paused"
  | "no_tradecatch_number"
  | "not_activated"
  | "missing_contractor_phone"
  | "contractor_phone_is_tradecatch_number"
  | "number_routed_to_sip_trunk"
  | "number_not_routed_to_tradecatch"
  | "livekit_handoff_not_configured"
  | "missing_forwarding_phone"
  | "carrier_forwarding_unverifiable"
  | "transfer_target_is_forwarding_phone"
  | "no_test_call_yet"
  | "test_call_took_other_path";

/** Where the last observed test call went. */
export type RoutingTestPath =
  | "rang_contractor_first"
  | "ai_answered_webhook"
  | "ai_answered_livekit_direct"
  | "forwarded_by_carrier";

export type RoutingVerification = {
  mode: AiCallMode;
  method: CallRoutingMethod;
  path: RoutingTestPath;
  verifiedAt: string;
};

/** Provider / internal outcomes shown in call history. */
export type PhoneCallOutcome =
  | "ai_answered"
  | "human_answered"
  | "transferred"
  | "no_answer"
  | "busy"
  | "failed"
  | "caller_abandoned"
  | "voicemail"
  | "in_progress";

export type CallEventKind =
  | "incoming"
  | "routing_decision"
  | "ai_started"
  | "ai_turn"
  | "human_ring"
  | "transfer_attempt"
  | "transfer_result"
  | "missed"
  | "status"
  | "relay_ended"
  | "finalized"
  | "error"
  | "test_simulated";

export type CallEvent = {
  id: string;
  organizationId: string;
  clientAccountId: string;
  callSid: string;
  sessionId?: string;
  kind: CallEventKind;
  detail?: string;
  payload?: Record<string, unknown>;
  at: string;
};

export type PhoneSettings = {
  /** Contractor's existing public business line (forwarding source). */
  businessPhoneE164?: string;
  /** TradeCatch / Twilio number that receives the webhook. */
  tradecatchNumberE164?: string;
  connectionStatus: PhoneConnectionStatus;
  connectionDetail?: string;
  aiEnabled: boolean;
  inboundStrategy: InboundStrategy;
  voiceEngine: VoiceEngineMode;
  humanTransferE164?: string;
  backupTransferE164?: string;
  humanRingTimeoutSeconds: number;
  callRecordingEnabled: boolean;
  forwardingInstructionsAck: boolean;
  /** When true, overflow rings the human before the AI answers. */
  ringHumanOnOverflow: boolean;
  /**
   * The mode the contractor chose. Unset on profiles saved before AI Call
   * Handling existed: their mode is derived from `inboundStrategy`, so their
   * live behaviour does not change until they save a mode themselves.
   */
  aiCallMode?: AiCallMode;
  routingMethod?: CallRoutingMethod;
  /** The contractor's own phone that rings first in missed-calls-only. */
  contractorPhoneE164?: string;
  personalContacts?: PersonalContact[];
  personalCallPolicy?: PersonalCallPolicy;
  personalCallMessage?: { fr?: string; en?: string };
  personalCallTransferE164?: string;
  unknownCallerPolicy?: UnknownCallerPolicy;
  /** When the mode or routing last changed; a test call must be newer. */
  modeUpdatedAt?: string;
  routingTestStartedAt?: string;
  routingVerification?: RoutingVerification;
  numberRoutingCheck?: {
    result: "webhook" | "sip_trunk" | "elsewhere" | "unknown";
    checkedAt: string;
  };
};

export type PhoneSettingsView = PhoneSettings & {
  organizationId: string;
  activated: boolean;
  profilePhoneE164?: string;
  callHandlingMode: string;
  defaultLanguage: "fr" | "en";
  businessHours?: { start: string; end: string; days: number[] };
  receptionistName?: string;
  webhookVoiceUrl: string | null;
  webhookStatusUrl: string | null;
  conversationRelayUrl: string | null;
};
