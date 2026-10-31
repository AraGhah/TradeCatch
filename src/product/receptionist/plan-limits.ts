/**
 * What the voice receptionist may do for a subscription plan.
 *
 * Growth runs a limited receptionist: it answers, holds the conversation,
 * captures the caller's details, answers from approved business information
 * and sends the team a summary. Receptionist Plus adds booking on the call,
 * live transfer, emergency bridging and full transcripts.
 *
 * The split is enforced where a call is actually handled (the live config the
 * runtime answers with), not in the dashboard: a Growth owner who saved a
 * transfer number or switched phone booking on still gets the limited
 * receptionist on the line. The pricing page, the comparison table and the
 * dashboard all read the same entitlements (src/product/saas/entitlements.ts).
 */
import { orgHasFeature, type PlanId } from "@/product/saas/entitlements";
import type { ReceptionistConfig } from "./types";

export type VoiceCapabilities = {
  /** The receptionist may answer calls at all. */
  voice: boolean;
  /** It may reserve a calendar time during the call. */
  phoneBooking: boolean;
  /** It may hand the live call to a person (named departments, owner, office). */
  transfer: boolean;
  /** It may bridge an emergency call to the on-call line. */
  emergencyRouting: boolean;
  /** Full call transcripts are kept and shown to the owner. */
  transcripts: boolean;
};

export function voiceCapabilitiesForPlan(plan: PlanId): VoiceCapabilities {
  return {
    voice: orgHasFeature(plan, "AI_RECEPTIONIST_VOICE"),
    phoneBooking: orgHasFeature(plan, "AI_PHONE_BOOKING"),
    transfer: orgHasFeature(plan, "AI_CALL_TRANSFER"),
    emergencyRouting: orgHasFeature(plan, "AI_EMERGENCY_ROUTING"),
    transcripts: orgHasFeature(plan, "AI_CALL_TRANSCRIPTS"),
  };
}

/** Plus-only parts of an owner's saved settings that this plan cannot use. */
export function unavailableVoiceSettings(plan: PlanId): string[] {
  const caps = voiceCapabilitiesForPlan(plan);
  const out: string[] = [];
  if (!caps.phoneBooking) out.push("phoneBooking");
  if (!caps.transfer) out.push("transfer");
  if (!caps.emergencyRouting) out.push("emergencyRouting");
  return out;
}

/**
 * The config the runtime answers with, trimmed to what the plan includes.
 * Without a transfer target the receptionist takes a message, and the
 * emergency path tells the caller to dial 9-1-1 and flags the call as urgent
 * (see `emergencyNoTransfer` in prompts.ts) instead of promising a transfer.
 */
export function applyVoicePlanLimits(
  config: ReceptionistConfig,
  caps: VoiceCapabilities,
): ReceptionistConfig {
  let next = config;
  if (!caps.phoneBooking && next.phoneBooking) {
    next = { ...next, phoneBooking: false };
  }
  if (!caps.transfer) {
    next = {
      ...next,
      routing: [],
      fallbackTransferE164: undefined,
      inboundStrategy: "ai_first",
      allowVoicemailOnly: true,
    };
  }
  if (!caps.emergencyRouting) {
    next = { ...next, emergencyTransferE164: undefined };
  }
  if (!caps.transcripts) {
    next = { ...next, transcriptsEnabled: false };
  }
  return next;
}
