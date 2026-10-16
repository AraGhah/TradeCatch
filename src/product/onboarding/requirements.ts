import type { PlanId } from "@/product/saas/entitlements";
import {
  ONBOARDING_STEP_IDS,
  type ActivationCheckId,
  type OnboardingStepId,
} from "./types";

export type StepRequirement = {
  stepId: OnboardingStepId;
  required: boolean;
  reason: string;
};

/** Which wizard steps are mandatory for a purchased plan. */
export function requirementsForPlan(plan: PlanId): StepRequirement[] {
  const all = ONBOARDING_STEP_IDS.map((stepId) => {
    if (stepId === "account" || stepId === "business" || stepId === "activation") {
      return {
        stepId,
        required: true,
        reason: "Required for every TradeCatch account.",
      };
    }
    if (stepId === "phone") {
      return {
        stepId,
        required: true,
        reason: "Phone routing must be verified before call features go live.",
      };
    }
    if (stepId === "ai_receptionist") {
      return {
        stepId,
        required: plan === "ai_receptionist",
        reason:
          plan === "ai_receptionist"
            ? "AI Receptionist plan requires receptionist configuration."
            : "Optional — upgrade to AI Receptionist to enable call answering.",
      };
    }
    if (stepId === "calendar") {
      return {
        stepId,
        required: false,
        reason:
          plan === "starter"
            ? "Not on Starter. Growth/AI can connect later for booking."
            : "Optional — without a calendar, AI collects preferred times only.",
      };
    }
    // automations
    return {
      stepId,
      required: false,
      reason: "Optional — enable only workflows allowed by your plan.",
    };
  });
  return all;
}

export function activationChecksForPlan(plan: PlanId): Array<{
  checkId: ActivationCheckId;
  required: boolean;
  blocking: boolean;
  label: string;
}> {
  return [
    {
      checkId: "business_account",
      required: true,
      blocking: true,
      label: "Business Account",
    },
    {
      checkId: "subscription",
      required: true,
      blocking: true,
      label: "Subscription",
    },
    {
      checkId: "ai_receptionist",
      required: plan === "ai_receptionist",
      blocking: plan === "ai_receptionist",
      label: "AI Receptionist",
    },
    {
      checkId: "phone_number",
      required: true,
      blocking: true,
      label: "Phone Number",
    },
    {
      checkId: "first_live_call",
      required: plan === "ai_receptionist",
      blocking: plan === "ai_receptionist",
      label: "First Live Call",
    },
    {
      checkId: "human_transfer",
      required: false,
      blocking: false,
      label: "Human Call Transfer",
    },
    {
      checkId: "google_calendar",
      required: false,
      blocking: false,
      label: "Google Calendar",
    },
    {
      checkId: "sms_automation",
      required: false,
      blocking: false,
      label: "SMS Automation",
    },
  ];
}
