/**
 * Decide how an inbound call should be handled given profile + phone settings.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import { shouldAnswerCall } from "@/product/receptionist/call-handling";
import type { ReceptionistConfig } from "@/product/receptionist/types";
import { callerPolicyFor, type CallerPolicyDecision } from "./caller-policy";
import { defaultPhoneSettings } from "./phone-settings";
import type { InboundStrategy, PhoneSettings } from "./types";

export type RoutingDecision =
  | { action: "reject"; reason: string }
  | { action: "ai"; reason: string; strategy: InboundStrategy }
  | {
      action: "ring_human";
      reason: string;
      phoneE164: string;
      timeoutSeconds: number;
      then: "ai" | "voicemail" | "hangup";
    };

export function decideInboundRouting(input: {
  config: ReceptionistConfig;
  phone: PhoneSettings;
  now?: Date;
}): RoutingDecision {
  const now = input.now ?? new Date();
  if (!input.phone.aiEnabled && input.phone.inboundStrategy === "ai_first") {
    // AI disabled: try human, else reject.
    const human =
      input.phone.humanTransferE164 || input.config.fallbackTransferE164;
    if (human) {
      return {
        action: "ring_human",
        reason: "ai_disabled",
        phoneE164: human,
        timeoutSeconds: input.phone.humanRingTimeoutSeconds,
        then: "voicemail",
      };
    }
    return { action: "reject", reason: "ai_disabled_no_human" };
  }

  if (!shouldAnswerCall(input.config, now)) {
    return { action: "reject", reason: `mode_${input.config.callHandlingMode}` };
  }

  const afterHours = isAfterHours(input.config, now);
  const strategy = input.phone.inboundStrategy;
  const human =
    input.phone.humanTransferE164 ||
    input.config.fallbackTransferE164 ||
    input.config.emergencyTransferE164;

  const overflow =
    input.config.callHandlingMode === "overflow" &&
    input.phone.ringHumanOnOverflow;

  if (
    (strategy === "human_first" || overflow) &&
    human &&
    !afterHours
  ) {
    return {
      action: "ring_human",
      reason: overflow ? "overflow_ring" : "human_first",
      phoneE164: human,
      timeoutSeconds: input.phone.humanRingTimeoutSeconds,
      then: input.phone.aiEnabled ? "ai" : "voicemail",
    };
  }

  if (!input.phone.aiEnabled) {
    return { action: "reject", reason: "ai_disabled" };
  }

  return {
    action: "ai",
    reason: afterHours ? "after_hours_ai" : "ai_first",
    strategy,
  };
}

/** The routing an inbound call really gets: a caller policy, or the saved rules. */
export type InboundRouting =
  | RoutingDecision
  | { action: "ai"; reason: "forced_ai"; strategy: "ai_first" };

/**
 * The one place that turns a receptionist config into "who takes this call".
 *
 * The live webhook (`engine.startCall`) and the dashboard simulation both call
 * it, so a simulated call can never be routed differently from a real one. It
 * reads the *effective* config (what AI Call Handling produced), never the raw
 * saved phone settings, and it takes the clock as an input so the business
 * hours that apply are the ones at the time the call is judged.
 */
export function resolveInboundRouting(input: {
  config: ReceptionistConfig;
  fromE164: string | null | undefined;
  now: Date;
  /** Go straight to the AI (callers that already rang the owner's phone). */
  skipHumanRing?: boolean;
}): { policy: CallerPolicyDecision; routing: InboundRouting } {
  const { config } = input;
  // A carrier-forwarded call already rang the contractor's phone, and
  // ringing it again would forward right back here: never ring first.
  const forwarded = config.routingMethod === "carrier_forwarding";
  const phone: PhoneSettings = {
    ...defaultPhoneSettings(),
    aiEnabled: config.enabled,
    inboundStrategy: forwarded ? "ai_first" : (config.inboundStrategy ?? "ai_first"),
    humanRingTimeoutSeconds: config.humanRingTimeoutSeconds ?? 25,
    humanTransferE164: forwarded
      ? undefined
      : (config.ringFirstE164 ?? config.fallbackTransferE164),
    ringHumanOnOverflow: !forwarded,
  };
  const policy = callerPolicyFor(config, input.fromE164);
  const routing: InboundRouting =
    policy.kind !== "ai" || input.skipHumanRing
      ? { action: "ai", reason: "forced_ai", strategy: "ai_first" }
      : decideInboundRouting({ config, phone, now: input.now });
  return { policy, routing };
}

export function mapDialStatusToOutcome(
  dialStatus: string,
): "human_answered" | "no_answer" | "busy" | "failed" {
  const s = dialStatus.toLowerCase();
  if (s === "completed" || s === "answered") return "human_answered";
  if (s === "busy") return "busy";
  if (s === "no-answer" || s === "no_answer") return "no_answer";
  return "failed";
}
