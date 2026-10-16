/**
 * Decide how an inbound call should be handled given profile + phone settings.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import { shouldAnswerCall } from "@/product/receptionist/call-handling";
import type { ReceptionistConfig } from "@/product/receptionist/types";
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

export function mapDialStatusToOutcome(
  dialStatus: string,
): "human_answered" | "no_answer" | "busy" | "failed" {
  const s = dialStatus.toLowerCase();
  if (s === "completed" || s === "answered") return "human_answered";
  if (s === "busy") return "busy";
  if (s === "no-answer" || s === "no_answer") return "no_answer";
  return "failed";
}
