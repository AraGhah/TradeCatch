/**
 * Custom Voice Cloning (Receptionist Plus only).
 *
 * The owner records their own voice once; ElevenLabs builds a voice from it and
 * the LiveKit receptionist speaks with that voice on calls to that business.
 *
 * What we keep: the provider's voice id (a handle, not audio), the consent
 * record, and an event trail. What we do NOT keep: the audio sample. It is
 * streamed to the provider for cloning and discarded, so there is no recording
 * of the owner sitting in our database or storage.
 *
 * Pure types and constants: nothing here touches the network or the database.
 */

export const VOICE_MODES = ["standard", "custom"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

/**
 * Bump this whenever the consent wording shown to the owner changes
 * (`app.voice.consent.*` in the message catalogs). A clone is only accepted
 * for the current version, and the version is stored with the consent so we
 * always know exactly what the owner agreed to.
 */
export const CONSENT_STATEMENT_VERSION = "2026-11-v1";

/** The single provider we clone with. Stored per row so a future one can coexist. */
export const VOICE_PROVIDER = "elevenlabs";

/** Provider voice ids are short alphanumeric handles. Anything else is refused. */
export const PROVIDER_VOICE_ID_PATTERN = /^[A-Za-z0-9]{10,40}$/;

/** TTS models the agent is allowed to ask the provider for. */
export const ALLOWED_TTS_MODELS = [
  "eleven_multilingual_v2",
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
] as const;
export type TtsModel = (typeof ALLOWED_TTS_MODELS)[number];
/**
 * Calls run on the low-latency multilingual model (French and English), and the
 * dashboard preview uses the same one so the owner hears exactly what callers do.
 */
export const DEFAULT_TTS_MODEL: TtsModel = "eleven_flash_v2_5";

/** The challenge a recording must contain stays valid this long. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** Audio sample limits. ElevenLabs accepts files up to 10 MB. */
export const MIN_SAMPLE_BYTES = 30_000;
export const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
/** The spoken challenge sentence alone is about this many words: fewer is too short to clone well. */
export const MIN_SAMPLE_WORDS = 20;

export type ConsentRecord = {
  statementVersion: string;
  /** The name the owner typed when accepting: who says this is their voice. */
  signerName: string;
  acceptedByUserId: string;
  acceptedAt: string;
};

export type OrgVoiceRecord = {
  organizationId: string;
  /** What calls use. "custom" only takes effect while every safeguard below holds. */
  mode: VoiceMode;
  /**
   * "deleting": the owner asked to remove the voice but the provider has not
   * confirmed yet. Calls already use the standard voice; the delete is retried.
   */
  status: "none" | "ready" | "deleting";
  /** Never sent to a browser; only the ops-authenticated agent config carries it. */
  providerVoiceId: string | null;
  consent: ConsentRecord | null;
  consentRevokedAt: string | null;
  consentRevokedBy: string | null;
  /** The spoken challenge was heard in the sample. */
  verifiedAt: string | null;
  /** The owner listened to the cloned voice. Required before it can go live. */
  previewedAt: string | null;
  activatedAt: string | null;
  /** The last challenge that produced a voice: a token cannot be reused. */
  lastChallengeNonce: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency counter; 0 means "not saved yet". */
  version: number;
};

export function emptyVoiceRecord(
  organizationId: string,
  now: string,
): OrgVoiceRecord {
  return {
    organizationId,
    mode: "standard",
    status: "none",
    providerVoiceId: null,
    consent: null,
    consentRevokedAt: null,
    consentRevokedBy: null,
    verifiedAt: null,
    previewedAt: null,
    activatedAt: null,
    lastChallengeNonce: null,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

export const VOICE_EVENT_ACTIONS = [
  "consent_given",
  "clone_created",
  "clone_failed",
  "previewed",
  "activated",
  "deactivated",
  "deleted",
  "consent_revoked",
  "provider_cleanup_failed",
] as const;
export type VoiceEventAction = (typeof VOICE_EVENT_ACTIONS)[number];

export type VoiceEvent = {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: VoiceEventAction;
  /** Small, non-sensitive facts only (never audio, transcripts or secrets). */
  detail: Record<string, string | number | boolean | null>;
  createdAt: string;
};

/**
 * What the dashboard sees. Deliberately has no voice id: the browser never
 * needs it, and a leaked page or log must not hand out a usable handle.
 */
export type VoiceStatusView = {
  /** The plan includes Custom Voice Cloning. */
  entitled: boolean;
  /** The provider is configured on this deployment. */
  available: boolean;
  mode: VoiceMode;
  /** A cloned voice exists for this business. */
  hasVoice: boolean;
  /** Calls would really use the cloned voice right now. */
  live: boolean;
  /** A delete was requested but the provider has not confirmed it yet. */
  cleanupPending: boolean;
  previewed: boolean;
  consent: {
    statementVersion: string;
    signerName: string;
    acceptedAt: string;
    /** The wording changed since this was accepted: record a new sample to renew it. */
    outdated: boolean;
  } | null;
  consentRevokedAt: string | null;
  updatedAt: string | null;
};

export type VoiceError =
  | "not_entitled"
  | "unavailable"
  | "consent_required"
  | "consent_outdated"
  | "challenge_invalid"
  | "challenge_expired"
  | "challenge_reused"
  | "challenge_failed"
  | "sample_invalid"
  | "sample_too_short"
  | "no_voice"
  | "not_previewed"
  | "consent_revoked"
  | "provider_error";

export type VoiceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: VoiceError };

/** What the realtime agent is told to speak with. */
export type AgentVoice =
  | { mode: "standard" }
  | {
      mode: "custom";
      provider: typeof VOICE_PROVIDER;
      voiceId: string;
      model: TtsModel;
    };

export const STANDARD_AGENT_VOICE: AgentVoice = { mode: "standard" };
