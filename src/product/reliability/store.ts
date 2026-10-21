import { createId } from "@/lib/id";
import type {
  FailedOperation,
  FallbackSettings,
  Incident,
  SystemError,
} from "./types";

export type ReliabilityStore = {
  saveError(row: SystemError): Promise<void>;
  listErrors(filter?: {
    organizationId?: string;
    service?: string;
  }): Promise<SystemError[]>;
  saveIncident(row: Incident): Promise<void>;
  listIncidents(organizationId?: string): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | null>;
  addIncidentEvent(input: {
    incidentId: string;
    kind: string;
    detail?: string;
    actor?: string;
    at: string;
  }): Promise<void>;
  listIncidentEvents(
    incidentId: string,
  ): Promise<{ kind: string; detail?: string; at: string }[]>;
  saveHealth(input: {
    service: string;
    status: string;
    detail?: string;
    checkedAt: string;
  }): Promise<void>;
  listHealth(): Promise<
    { service: string; status: string; detail?: string; checkedAt: string }[]
  >;
  saveOperation(row: FailedOperation): Promise<FailedOperation | null>;
  listOperations(): Promise<FailedOperation[]>;
  getOperation(id: string): Promise<FailedOperation | null>;
  addRecovery(input: {
    operationId: string;
    outcome: string;
    actor?: string;
    at: string;
  }): Promise<void>;
  saveDeployment(input: {
    id: string;
    version: string;
    environment: string;
    status: string;
    deployedAt: string;
    deployedBy?: string;
  }): Promise<void>;
  listDeployments(): Promise<
    {
      id: string;
      version: string;
      environment: string;
      status: string;
      deployedAt: string;
    }[]
  >;
  saveCost(input: {
    id: string;
    organizationId?: string;
    service: string;
    units: number;
    estimatedCents: number;
    confirmed: boolean;
    simulated: boolean;
    createdAt: string;
  }): Promise<void>;
  listCosts(): Promise<
    {
      service: string;
      units: number;
      estimatedCents: number;
      confirmed: boolean;
      simulated: boolean;
      createdAt: string;
    }[]
  >;
  getFallback(organizationId: string): Promise<FallbackSettings | null>;
  saveFallback(row: FallbackSettings): Promise<void>;
  saveObservation(input: {
    statusClass: string;
    durationMs: number;
    at: string;
  }): Promise<void>;
  listObservations(): Promise<
    { statusClass: string; durationMs: number; at: string }[]
  >;
};

export function createMemoryReliabilityStore(): ReliabilityStore {
  const errors: SystemError[] = [];
  const incidents = new Map<string, Incident>();
  const events: {
    incidentId: string;
    kind: string;
    detail?: string;
    at: string;
  }[] = [];
  const health: {
    service: string;
    status: string;
    detail?: string;
    checkedAt: string;
  }[] = [];
  const operations = new Map<string, FailedOperation>();
  const deployments: {
    id: string;
    version: string;
    environment: string;
    status: string;
    deployedAt: string;
  }[] = [];
  const costs: {
    service: string;
    units: number;
    estimatedCents: number;
    confirmed: boolean;
    simulated: boolean;
    createdAt: string;
  }[] = [];
  const fallbacks = new Map<string, FallbackSettings>();
  const observations: {
    statusClass: string;
    durationMs: number;
    at: string;
  }[] = [];

  return {
    async saveError(row) {
      errors.push(structuredClone(row));
    },
    async listErrors(filter) {
      return errors
        .filter((row) => {
          if (
            filter?.organizationId &&
            row.organizationId !== filter.organizationId
          )
            return false;
          if (filter?.service && row.service !== filter.service) return false;
          return true;
        })
        .map((row) => structuredClone(row));
    },
    async saveIncident(row) {
      incidents.set(row.id, structuredClone(row));
    },
    async listIncidents(organizationId) {
      return [...incidents.values()]
        .filter(
          (row) => !organizationId || row.organizationId === organizationId,
        )
        .map((row) => structuredClone(row));
    },
    async getIncident(id) {
      const row = incidents.get(id);
      return row ? structuredClone(row) : null;
    },
    async addIncidentEvent(input) {
      events.push(input);
    },
    async listIncidentEvents(incidentId) {
      return events.filter((row) => row.incidentId === incidentId);
    },
    async saveHealth(input) {
      health.push(input);
    },
    async listHealth() {
      return [...new Map(health.map((row) => [row.service, row])).values()];
    },
    async saveOperation(row) {
      const existing = [...operations.values()].find(
        (item) =>
          item.idempotencyKey === row.idempotencyKey && item.id !== row.id,
      );
      if (existing) return null;
      operations.set(row.id, structuredClone(row));
      return structuredClone(row);
    },
    async listOperations() {
      return [...operations.values()].map((row) => structuredClone(row));
    },
    async getOperation(id) {
      const row = operations.get(id);
      return row ? structuredClone(row) : null;
    },
    async addRecovery() {
      return;
    },
    async saveDeployment(input) {
      deployments.push(input);
    },
    async listDeployments() {
      return deployments.map((row) => structuredClone(row));
    },
    async saveCost(input) {
      costs.push(input);
    },
    async listCosts() {
      return costs.map((row) => structuredClone(row));
    },
    async getFallback(organizationId) {
      const row = fallbacks.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveFallback(row) {
      fallbacks.set(row.organizationId, structuredClone(row));
    },
    async saveObservation(input) {
      observations.push(input);
    },
    async listObservations() {
      return observations.slice(-500);
    },
  };
}

export function reliabilityId(prefix: string) {
  return createId(prefix);
}
