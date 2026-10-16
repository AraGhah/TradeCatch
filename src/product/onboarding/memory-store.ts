import type {
  ActivationCheck,
  IntegrationVerification,
  OnboardingEvent,
  OnboardingSession,
  OnboardingStepRecord,
} from "./types";
import type { OnboardingStore } from "./store";

export function createMemoryOnboardingStore(): OnboardingStore {
  const sessions = new Map<string, OnboardingSession>();
  const steps = new Map<string, OnboardingStepRecord>();
  const verifications = new Map<string, IntegrationVerification>();
  const checks = new Map<string, ActivationCheck>();
  const events: OnboardingEvent[] = [];

  return {
    async getSession(businessId) {
      const row = sessions.get(businessId);
      return row ? structuredClone(row) : null;
    },
    async saveSession(row) {
      sessions.set(row.businessId, structuredClone(row));
      return structuredClone(row);
    },
    async getStep(businessId, stepId) {
      const row = steps.get(`${businessId}:${stepId}`);
      return row ? structuredClone(row) : null;
    },
    async listSteps(businessId) {
      return [...steps.values()]
        .filter((s) => s.businessId === businessId)
        .map((s) => structuredClone(s));
    },
    async saveStep(row) {
      steps.set(`${row.businessId}:${row.stepId}`, structuredClone(row));
    },
    async getVerification(businessId, kind) {
      const row = verifications.get(`${businessId}:${kind}`);
      return row ? structuredClone(row) : null;
    },
    async listVerifications(businessId) {
      return [...verifications.values()]
        .filter((v) => v.businessId === businessId)
        .map((v) => structuredClone(v));
    },
    async saveVerification(row) {
      verifications.set(`${row.businessId}:${row.kind}`, structuredClone(row));
    },
    async listActivationChecks(businessId) {
      return [...checks.values()]
        .filter((c) => c.businessId === businessId)
        .map((c) => structuredClone(c));
    },
    async saveActivationCheck(row) {
      checks.set(`${row.businessId}:${row.checkId}`, structuredClone(row));
    },
    async addEvent(row) {
      events.push(structuredClone(row));
    },
    async listEvents(businessId) {
      return events
        .filter((e) => e.businessId === businessId)
        .map((e) => structuredClone(e));
    },
  };
}
