import { createId } from "@/lib/id";
import { defaultLiveTests, type LaunchStore, type PilotAccount, type PilotFeature, type PilotFeedback } from "./store";
import type { CheckStatus } from "./readiness";

export class LaunchError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "LaunchError";
  }
}

const FIRST_FEATURES: PilotFeature[] = ["ai_receptionist", "lead_capture", "call_history", "human_transfer", "notifications"];

export function createLaunchService(deps: { store: LaunchStore; now: () => Date }) {
  return {
    async createPilot(input: Omit<PilotAccount, "id" | "createdAt" | "features" | "onboardingStatus" | "phoneStatus" | "aiStatus" | "pilotStatus"> & { features?: PilotFeature[] }) {
      if (input.accountType === "demo") throw new LaunchError("A demo business cannot join the live pilot.", 409);
      const existing = await deps.store.getPilotByOrg(input.organizationId);
      if (existing) return existing;
      const pilot: PilotAccount = {
        ...input,
        id: createId("pilot"),
        features: input.features?.length ? input.features : FIRST_FEATURES,
        onboardingStatus: "in_progress",
        phoneStatus: "not_connected",
        aiStatus: "inactive",
        pilotStatus: "paused",
        createdAt: deps.now().toISOString(),
      };
      await deps.store.savePilot(pilot);
      await deps.store.saveTests(defaultLiveTests(pilot.id));
      return pilot;
    },

    async activate(pilotId: string, readiness: CheckStatus) {
      const pilot = await deps.store.getPilot(pilotId);
      if (!pilot) throw new LaunchError("Pilot not found.", 404);
      if (pilot.accountType === "demo") throw new LaunchError("A demo business cannot be activated.", 409);
      if (readiness !== "ready") throw new LaunchError("Critical launch checks are not ready.", 409);
      const tests = await deps.store.listTests(pilotId);
      if (tests.some((test) => test.scenario === "customer_calls" && test.status !== "passed") || tests.some((test) => test.scenario === "ai_fallback" && test.status !== "passed")) {
        throw new LaunchError("Authorized live call and fallback tests must pass first.", 409);
      }
      pilot.pilotStatus = "active";
      pilot.aiStatus = pilot.features.includes("ai_receptionist") ? "active" : "inactive";
      pilot.phoneStatus = "connected";
      pilot.onboardingStatus = "completed";
      pilot.startsOn = pilot.startsOn || deps.now().toISOString().slice(0, 10);
      await deps.store.savePilot(pilot);
      await deps.store.saveActivation({ id: createId("act"), pilotId, features: pilot.features, activatedAt: deps.now().toISOString() });
      return pilot;
    },

    async recordTest(pilotId: string, scenario: string, status: "passed" | "failed", note?: string) {
      const tests = await deps.store.listTests(pilotId);
      const test = tests.find((row) => row.scenario === scenario);
      if (!test) throw new LaunchError("Unknown live test.", 404);
      test.status = status;
      test.note = note?.slice(0, 240);
      test.verifiedAt = deps.now().toISOString();
      await deps.store.saveTests([test]);
      return test;
    },

    async recordEvent(organizationId: string, kind: string) {
      const pilot = await deps.store.getPilotByOrg(organizationId);
      if (!pilot || pilot.accountType === "demo" || pilot.pilotStatus !== "active") return { recorded: false as const };
      await deps.store.saveEvent({ id: createId("pevt"), organizationId, kind, createdAt: deps.now().toISOString() });
      return { recorded: true as const };
    },

    async activity(organizationId: string) {
      const events = await deps.store.listEvents(organizationId);
      const count = (kind: string) => events.filter((event) => event.kind === kind).length;
      return {
        source: "recorded_pilot_events" as const,
        includesDemoData: false as const,
        incomingCalls: count("call"),
        aiHandled: count("ai_handled"),
        failedCalls: count("call_failed"),
        leads: count("lead"),
        appointments: count("appointment"),
        transfers: count("transfer"),
        missedCalls: count("missed_call"),
        recoveryMessages: count("recovery_sms"),
        replies: count("reply"),
        errors: count("error"),
      };
    },

    async addFeedback(input: Omit<PilotFeedback, "id" | "status" | "createdAt">) {
      const row: PilotFeedback = { ...input, id: createId("pfb"), status: "new", createdAt: deps.now().toISOString() };
      await deps.store.saveFeedback(row);
      return row;
    },

    async updateFeedback(organizationId: string, id: string, patch: { status?: PilotFeedback["status"]; resolution?: string }) {
      const rows = await deps.store.listFeedback(organizationId);
      const row = rows.find((item) => item.id === id);
      if (!row) throw new LaunchError("Feedback not found.", 404);
      if (patch.status) row.status = patch.status;
      if (patch.resolution) row.resolution = patch.resolution.slice(0, 500);
      await deps.store.saveFeedback(row);
      return row;
    },

    async report(pilotId: string) {
      const pilot = await deps.store.getPilot(pilotId);
      if (!pilot) throw new LaunchError("Pilot not found.", 404);
      const activity = await this.activity(pilot.organizationId);
      const feedback = await deps.store.listFeedback(pilot.organizationId);
      const activations = await deps.store.listActivations(pilotId);
      return {
        businessName: pilot.businessName,
        pilotStatus: pilot.pilotStatus,
        features: pilot.features,
        activity,
        openFeedback: feedback.filter((row) => row.status === "new" || row.status === "investigating").length,
        activations: activations.length,
        attributedRevenue: null,
      };
    },

    async leave(pilotId: string) {
      const pilot = await deps.store.getPilot(pilotId);
      if (!pilot) throw new LaunchError("Pilot not found.", 404);
      pilot.pilotStatus = "completed";
      pilot.aiStatus = "inactive";
      pilot.endsOn = deps.now().toISOString().slice(0, 10);
      await deps.store.savePilot(pilot);
      return pilot;
    },

    list: () => deps.store.listPilots(),
    get: (id: string) => deps.store.getPilot(id),
    tests: (id: string) => deps.store.listTests(id),
    feedback: (organizationId?: string) => deps.store.listFeedback(organizationId),
  };
}
