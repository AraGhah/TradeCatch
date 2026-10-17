import { createId } from "@/lib/id";

export type PilotFeature =
  | "ai_receptionist"
  | "lead_capture"
  | "call_history"
  | "human_transfer"
  | "notifications"
  | "appointments"
  | "missed_call_recovery"
  | "quote_followups";

export type PilotAccount = {
  id: string;
  organizationId: string;
  businessName: string;
  industry?: string;
  contactName: string;
  contactEmail: string;
  phoneE164?: string;
  startsOn?: string;
  endsOn?: string;
  features: PilotFeature[];
  onboardingStatus: "in_progress" | "completed";
  phoneStatus: "connected" | "failed" | "not_connected";
  aiStatus: "active" | "inactive";
  pilotStatus: "active" | "paused" | "completed";
  accountType: "live" | "demo";
  createdAt: string;
};

export type PilotFeedback = {
  id: string;
  organizationId: string;
  category: "ai" | "calls" | "sms" | "dashboard" | "appointments";
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  reference?: string;
  status: "new" | "investigating" | "fixed" | "closed";
  resolution?: string;
  createdAt: string;
};

export type PilotTest = {
  id: string;
  pilotId: string;
  scenario: string;
  status: "pending" | "passed" | "failed";
  note?: string;
  verifiedAt?: string;
};

const LIVE_SCENARIOS = [
  "customer_calls",
  "ai_answers",
  "french_reply",
  "appointment_request",
  "appointment_saved",
  "human_transfer",
  "contractor_unavailable",
  "hangup_recorded",
  "ai_fallback",
] as const;

export function defaultLiveTests(pilotId: string): PilotTest[] {
  return LIVE_SCENARIOS.map((scenario) => ({ id: createId("ptest"), pilotId, scenario, status: "pending" }));
}

export type LaunchStore = {
  savePilot(row: PilotAccount): Promise<void>;
  listPilots(): Promise<PilotAccount[]>;
  getPilot(id: string): Promise<PilotAccount | null>;
  getPilotByOrg(organizationId: string): Promise<PilotAccount | null>;
  saveFeedback(row: PilotFeedback): Promise<void>;
  listFeedback(organizationId?: string): Promise<PilotFeedback[]>;
  saveTests(rows: PilotTest[]): Promise<void>;
  listTests(pilotId: string): Promise<PilotTest[]>;
  saveEvent(input: { id: string; organizationId: string; kind: string; createdAt: string }): Promise<void>;
  listEvents(organizationId: string): Promise<{ kind: string }[]>;
  saveActivation(input: { id: string; pilotId: string; features: PilotFeature[]; activatedAt: string }): Promise<void>;
  listActivations(pilotId: string): Promise<{ features: PilotFeature[]; activatedAt: string }[]>;
};

export function createMemoryLaunchStore(): LaunchStore {
  const pilots = new Map<string, PilotAccount>();
  const feedback: PilotFeedback[] = [];
  const tests: PilotTest[] = [];
  const events: { organizationId: string; kind: string }[] = [];
  const activations: { pilotId: string; features: PilotFeature[]; activatedAt: string }[] = [];
  return {
    async savePilot(row) { pilots.set(row.id, structuredClone(row)); },
    async listPilots() { return [...pilots.values()].map((row) => structuredClone(row)); },
    async getPilot(id) { const row = pilots.get(id); return row ? structuredClone(row) : null; },
    async getPilotByOrg(organizationId) {
      return [...pilots.values()].find((row) => row.organizationId === organizationId) ?? null;
    },
    async saveFeedback(row) {
      const index = feedback.findIndex((item) => item.id === row.id);
      if (index >= 0) feedback[index] = structuredClone(row);
      else feedback.push(structuredClone(row));
    },
    async listFeedback(organizationId) {
      return feedback.filter((row) => !organizationId || row.organizationId === organizationId).map((row) => structuredClone(row));
    },
    async saveTests(rows) {
      for (const row of rows) {
        const index = tests.findIndex((item) => item.id === row.id);
        if (index >= 0) tests[index] = structuredClone(row);
        else tests.push(structuredClone(row));
      }
    },
    async listTests(pilotId) { return tests.filter((row) => row.pilotId === pilotId).map((row) => structuredClone(row)); },
    async saveEvent(input) { events.push({ organizationId: input.organizationId, kind: input.kind }); },
    async listEvents(organizationId) { return events.filter((row) => row.organizationId === organizationId); },
    async saveActivation(input) { activations.push(input); },
    async listActivations(pilotId) { return activations.filter((row) => row.pilotId === pilotId); },
  };
}
