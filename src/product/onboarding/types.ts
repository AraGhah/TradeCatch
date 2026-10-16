import type { PlanId } from "@/product/saas/entitlements";

export const ONBOARDING_STEP_IDS = [
  "account",
  "business",
  "ai_receptionist",
  "phone",
  "calendar",
  "automations",
  "activation",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export type StepStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "skipped"
  | "needs_verification"
  | "verified"
  | "blocked"
  | "failed"
  | "pending";

export type OnboardingStatus =
  | "not_started"
  | "in_progress"
  | "needs_action"
  | "verification_pending"
  | "ready"
  | "active"
  | "suspended";

export type VerificationKind =
  | "phone"
  | "calendar"
  | "ai"
  | "messaging"
  | "test_call"
  | "transfer"
  | "subscription";

export type VerificationStatus =
  | "pending"
  | "passed"
  | "failed"
  | "expired"
  | "skipped";

export type ActivationCheckId =
  | "business_account"
  | "subscription"
  | "ai_receptionist"
  | "phone_number"
  | "google_calendar"
  | "sms_automation"
  | "first_live_call"
  | "human_transfer";

export type OnboardingSession = {
  id: string;
  businessId: string;
  status: OnboardingStatus;
  currentStep: OnboardingStepId;
  plan: PlanId;
  draft: Record<string, unknown>;
  activatedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OnboardingStepRecord = {
  businessId: string;
  stepId: OnboardingStepId;
  status: StepStatus;
  required: boolean;
  payload: Record<string, unknown>;
  lastError: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  updatedAt: string;
};

export type IntegrationVerification = {
  id: string;
  businessId: string;
  kind: VerificationKind;
  status: VerificationStatus;
  detail: Record<string, unknown>;
  error: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivationCheck = {
  id: string;
  businessId: string;
  checkId: ActivationCheckId;
  required: boolean;
  passed: boolean;
  blocking: boolean;
  label: string;
  detail: string | null;
  updatedAt: string;
};

export type OnboardingEvent = {
  id: string;
  businessId: string;
  actorUserId: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type ReadinessReport = {
  businessId: string;
  status: OnboardingStatus;
  plan: PlanId;
  canActivate: boolean;
  blockingReasons: string[];
  checks: ActivationCheck[];
  steps: OnboardingStepRecord[];
  verifications: IntegrationVerification[];
  activatedAt: string | null;
};

export type OnboardingSnapshot = {
  session: OnboardingSession;
  steps: OnboardingStepRecord[];
  requirements: Array<{
    stepId: OnboardingStepId;
    required: boolean;
    reason: string;
  }>;
  readiness: ReadinessReport;
};
