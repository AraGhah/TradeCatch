/**
 * Phone call management types (Task 4).
 * Complements the AI receptionist engine with provider routing, events, and
 * phone-number settings exposed in the contractor dashboard.
 */

export type PhoneConnectionStatus = "connected" | "disconnected" | "error";

export type InboundStrategy = "ai_first" | "human_first";

export type VoiceEngineMode = "gather" | "conversation_relay";

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
