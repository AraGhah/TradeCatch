/**
 * AI Call Handling: what the contractor asked for, what callers actually get,
 * and what is still missing in between.
 *
 * Three separate facts, never merged:
 * - requested mode: the contractor's saved choice (or, on profiles saved
 *   before this feature, the mode their existing strategy already produces);
 * - effective mode: what the current routing would really do with a call;
 * - setup status: whether that routing is configured and has been proven by
 *   a test call. Only `verified` lets the dashboard say a mode is active.
 *
 * TradeCatch only sees calls that reach Twilio. With carrier forwarding the
 * carrier decides which calls arrive (no answer, busy, unreachable, or all),
 * and changing the mode here does not change the carrier: the effective mode
 * stays unknown until a test call is observed.
 */

import type { PlanId } from "@/product/saas/entitlements";
import { voiceCapabilitiesForPlan } from "@/product/receptionist/plan-limits";
import type {
  AiCallMode,
  AiCallSetupIssue,
  AiCallSetupStatus,
  CallRoutingMethod,
  PhoneSettings,
  RoutingVerification,
} from "./types";

/** Where Twilio sends the TradeCatch number's calls (read-only check). */
export type NumberRouting =
  /** The number's voice URL is TradeCatch's webhook. */
  | "webhook"
  /** The number belongs to the Elastic SIP trunk (straight to LiveKit). */
  | "sip_trunk"
  /** Some other URL or app: TradeCatch never sees these calls. */
  | "elsewhere"
  /** Not checked (no Twilio credentials, lookup failed, or not run). */
  | "unknown";

export const RECOMMENDED_AI_CALL_MODE: AiCallMode = "missed_calls_only";

/** The mode a stored profile produces today, before any explicit choice. */
export function legacyAiCallMode(phone: Pick<PhoneSettings, "inboundStrategy">): AiCallMode {
  return phone.inboundStrategy === "human_first" ? "missed_calls_only" : "ai_answers_all";
}

export function routingMethodOf(phone: Pick<PhoneSettings, "routingMethod">): CallRoutingMethod {
  return phone.routingMethod ?? "tradecatch_number";
}

/**
 * The live routing a profile's settings produce. Profiles that never saved
 * an AI Call Handling mode keep their exact previous behaviour.
 */
export function callRoutingForProfile(
  phone: PhoneSettings,
  tradecatchNumberE164: string | undefined,
): {
  inboundStrategy: "ai_first" | "human_first";
  ringFirstE164?: string;
  callScreening: boolean;
  /** Destinations that would forward straight back to TradeCatch. */
  blockedTargets: string[];
} {
  const method = routingMethodOf(phone);
  const blockedTargets =
    method === "carrier_forwarding" && phone.businessPhoneE164
      ? [phone.businessPhoneE164]
      : [];
  if (!phone.aiCallMode) {
    return {
      inboundStrategy: phone.inboundStrategy ?? "ai_first",
      callScreening: false,
      blockedTargets,
    };
  }
  if (method === "carrier_forwarding" || phone.aiCallMode === "ai_answers_all") {
    return { inboundStrategy: "ai_first", callScreening: false, blockedTargets };
  }
  const contractor = phone.contractorPhoneE164;
  if (!contractor || contractor === tradecatchNumberE164) {
    // Nothing safe to ring: the AI answers, and the status says so.
    return { inboundStrategy: "ai_first", callScreening: false, blockedTargets };
  }
  return {
    inboundStrategy: "human_first",
    ringFirstE164: contractor,
    callScreening: true,
    blockedTargets,
  };
}

/** Transfer-type numbers that would ring the forwarding phone (loop). */
export function loopingTargets(input: {
  phone: PhoneSettings;
  targets: (string | undefined)[];
}): string[] {
  if (routingMethodOf(input.phone) !== "carrier_forwarding") return [];
  const own = input.phone.businessPhoneE164;
  if (!own) return [];
  return input.targets.filter((t): t is string => Boolean(t) && t === own);
}

export type AiCallHandlingState = {
  requestedMode: AiCallMode;
  /** saved = the owner chose; legacy = derived from older settings; recommended = nothing chosen yet. */
  modeSource: "saved" | "legacy" | "recommended";
  /** "off" = no AI answers; "unknown" = depends on carrier forwarding not yet observed. */
  effectiveMode: AiCallMode | "off" | "unknown";
  status: AiCallSetupStatus;
  /** Blocking problems first, then warnings. */
  issues: AiCallSetupIssue[];
  warnings: AiCallSetupIssue[];
  routingMethod: CallRoutingMethod;
  numberRouting: NumberRouting;
  verification?: RoutingVerification;
  /** The ring-first phone actually in use (masked by the caller of this). */
  ringsContractorFirst: boolean;
};

export type EvaluateInput = {
  plan: PlanId | undefined;
  activated: boolean;
  tradecatchNumberE164?: string;
  phone: PhoneSettings;
  numberRouting?: NumberRouting;
  livekitHandoffReady: boolean;
  /** Transfer-type numbers currently saved (for the loop warning). */
  transferTargets?: (string | undefined)[];
};

/** Whether a stored verification still describes the current settings. */
export function currentVerification(
  phone: PhoneSettings,
  mode: AiCallMode,
  method: CallRoutingMethod,
): RoutingVerification | undefined {
  const v = phone.routingVerification;
  if (!v || v.mode !== mode || v.method !== method) return undefined;
  if (phone.modeUpdatedAt && v.verifiedAt < phone.modeUpdatedAt) return undefined;
  if (method === "tradecatch_number") {
    const expected =
      mode === "missed_calls_only"
        ? ["rang_contractor_first"]
        : ["ai_answered_webhook", "ai_answered_livekit_direct"];
    if (!expected.includes(v.path)) return undefined;
  }
  return v;
}

export function evaluateAiCallHandling(input: EvaluateInput): AiCallHandlingState {
  const { phone } = input;
  const method = routingMethodOf(phone);
  const requestedMode: AiCallMode =
    phone.aiCallMode ??
    (input.activated ? legacyAiCallMode(phone) : RECOMMENDED_AI_CALL_MODE);
  const modeSource: AiCallHandlingState["modeSource"] = phone.aiCallMode
    ? "saved"
    : input.activated
      ? "legacy"
      : "recommended";
  const numberRouting = input.numberRouting ?? "unknown";
  const base = {
    requestedMode,
    modeSource,
    routingMethod: method,
    numberRouting,
  };
  const issues: AiCallSetupIssue[] = [];
  const warnings: AiCallSetupIssue[] = [];
  const off = (status: AiCallSetupStatus): AiCallHandlingState => ({
    ...base,
    effectiveMode: "off",
    status,
    issues,
    warnings,
    ringsContractorFirst: false,
  });

  const voice = input.plan ? voiceCapabilitiesForPlan(input.plan).voice : false;
  if (!voice) {
    issues.push("plan_has_no_voice");
    return off("unsupported_plan");
  }
  if (!input.tradecatchNumberE164) {
    issues.push("no_tradecatch_number");
    return off("not_configured");
  }
  if (!input.activated) {
    issues.push("not_activated");
    return off("not_configured");
  }
  if (phone.aiEnabled === false) {
    issues.push("receptionist_paused");
    return off("disabled");
  }

  const routing = callRoutingForProfile(phone, input.tradecatchNumberE164);
  if (
    loopingTargets({ phone, targets: input.transferTargets ?? [] }).length > 0
  ) {
    warnings.push("transfer_target_is_forwarding_phone");
  }

  let effectiveMode: AiCallHandlingState["effectiveMode"] = requestedMode;

  if (numberRouting === "elsewhere") {
    issues.push("number_not_routed_to_tradecatch");
    effectiveMode = "off";
  }

  if (method === "carrier_forwarding") {
    if (!phone.businessPhoneE164) issues.push("missing_forwarding_phone");
    // The carrier, not TradeCatch, decides which calls arrive.
    warnings.push("carrier_forwarding_unverifiable");
  } else if (requestedMode === "missed_calls_only") {
    if (!phone.contractorPhoneE164) {
      issues.push("missing_contractor_phone");
      if (effectiveMode !== "off") effectiveMode = "ai_answers_all";
    } else if (phone.contractorPhoneE164 === input.tradecatchNumberE164) {
      issues.push("contractor_phone_is_tradecatch_number");
      if (effectiveMode !== "off") effectiveMode = "ai_answers_all";
    }
    if (numberRouting === "sip_trunk") {
      // The trunk goes straight to the AI: the contractor never rings first.
      issues.push("number_routed_to_sip_trunk");
      if (effectiveMode !== "off") effectiveMode = "ai_answers_all";
    }
  }
  if (
    phone.voiceEngine === "livekit" &&
    !input.livekitHandoffReady &&
    numberRouting !== "sip_trunk"
  ) {
    // Still answered, by the built-in receptionist instead of the agent.
    warnings.push("livekit_handoff_not_configured");
  }

  const verification =
    issues.length === 0
      ? currentVerification(phone, requestedMode, method)
      : undefined;
  if (issues.length === 0 && !verification) warnings.unshift("no_test_call_yet");
  if (method === "carrier_forwarding" && !verification && effectiveMode !== "off") {
    effectiveMode = "unknown";
  }

  return {
    ...base,
    effectiveMode,
    status:
      issues.length > 0
        ? "setup_required"
        : verification
          ? "verified"
          : "awaiting_test_call",
    issues,
    warnings,
    verification,
    ringsContractorFirst: Boolean(routing.ringFirstE164),
  };
}
