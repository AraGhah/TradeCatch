import type {
  ActivationCheck,
  IntegrationVerification,
  OnboardingEvent,
  OnboardingSession,
  OnboardingStepRecord,
  VerificationKind,
} from "./types";

export type OnboardingStore = {
  getSession(businessId: string): Promise<OnboardingSession | null>;
  saveSession(row: OnboardingSession): Promise<OnboardingSession>;

  getStep(
    businessId: string,
    stepId: OnboardingStepRecord["stepId"],
  ): Promise<OnboardingStepRecord | null>;
  listSteps(businessId: string): Promise<OnboardingStepRecord[]>;
  saveStep(row: OnboardingStepRecord): Promise<void>;

  getVerification(
    businessId: string,
    kind: VerificationKind,
  ): Promise<IntegrationVerification | null>;
  listVerifications(businessId: string): Promise<IntegrationVerification[]>;
  saveVerification(row: IntegrationVerification): Promise<void>;

  listActivationChecks(businessId: string): Promise<ActivationCheck[]>;
  saveActivationCheck(row: ActivationCheck): Promise<void>;

  addEvent(row: OnboardingEvent): Promise<void>;
  listEvents(businessId: string): Promise<OnboardingEvent[]>;
};
