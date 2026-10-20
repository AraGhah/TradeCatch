import { createId } from "@/lib/id";
import type {
  AvailabilityRules,
  BusyBlock,
  CalendarConnectionPublic,
  ScheduleAppointment,
  ServiceType,
  Technician,
} from "./types";
import { overlaps } from "./slots";

export type StoredConnection = CalendarConnectionPublic & {
  organizationId: string;
  tokenCiphertext?: string;
  scope?: string;
};

export type SchedulingStore = {
  getRules(organizationId: string): Promise<AvailabilityRules | null>;
  saveRules(rules: AvailabilityRules): Promise<AvailabilityRules>;
  listServices(organizationId: string): Promise<ServiceType[]>;
  saveService(service: ServiceType): Promise<ServiceType>;
  listTechnicians(organizationId: string): Promise<Technician[]>;
  saveTechnician(technician: Technician): Promise<Technician>;
  listAppointments(organizationId: string, limit?: number): Promise<ScheduleAppointment[]>;
  getAppointment(organizationId: string, id: string): Promise<ScheduleAppointment | null>;
  findByIdempotency(organizationId: string, key: string): Promise<ScheduleAppointment | null>;
  insertIfFree(row: ScheduleAppointment, bufferMinutes: number): Promise<ScheduleAppointment | null>;
  saveAppointment(row: ScheduleAppointment): Promise<void>;
  addEvent(input: { organizationId: string; appointmentId: string; kind: string; detail?: string; at: string }): Promise<void>;
  listEvents(organizationId: string, appointmentId: string): Promise<{ kind: string; detail?: string; at: string }[]>;
  getConnection(organizationId: string): Promise<StoredConnection | null>;
  saveConnection(row: StoredConnection): Promise<void>;
  replaceBusy(organizationId: string, blocks: BusyBlock[]): Promise<void>;
  listBusy(organizationId: string): Promise<BusyBlock[]>;
};

const locks = new Map<string, Promise<void>>();

export async function withOrgLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(organizationId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(organizationId, previous.then(() => current));
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function blocks(row: ScheduleAppointment, now: number): boolean {
  if (row.status === "canceled" || row.status === "completed") return false;
  if (row.status === "hold") return Boolean(row.holdExpiresAt && Date.parse(row.holdExpiresAt) > now);
  return row.status === "confirmed";
}

export function createMemorySchedulingStore(): SchedulingStore {
  const rules = new Map<string, AvailabilityRules>();
  const services = new Map<string, ServiceType>();
  const technicians = new Map<string, Technician>();
  const appointments = new Map<string, ScheduleAppointment>();
  const events: { organizationId: string; appointmentId: string; kind: string; detail?: string; at: string }[] = [];
  const connections = new Map<string, StoredConnection>();
  const busy = new Map<string, BusyBlock[]>();

  return {
    async getRules(organizationId) {
      const row = rules.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveRules(row) {
      rules.set(row.organizationId, structuredClone(row));
      return structuredClone(row);
    },
    async listServices(organizationId) {
      return [...services.values()].filter((s) => s.organizationId === organizationId).map((s) => structuredClone(s));
    },
    async saveService(service) {
      services.set(service.id, structuredClone(service));
      return structuredClone(service);
    },
    async listTechnicians(organizationId) {
      return [...technicians.values()].filter((t) => t.organizationId === organizationId).map((t) => structuredClone(t));
    },
    async saveTechnician(technician) {
      technicians.set(technician.id, structuredClone(technician));
      return structuredClone(technician);
    },
    async listAppointments(organizationId, limit) {
      return [...appointments.values()]
        .filter((a) => a.organizationId === organizationId)
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .slice(0,limit)
        .map((a) => structuredClone(a));
    },
    async getAppointment(organizationId, id) {
      const row = appointments.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      return structuredClone(row);
    },
    async findByIdempotency(organizationId, key) {
      const row = [...appointments.values()].find(
        (a) => a.organizationId === organizationId && a.idempotencyKey === key,
      );
      return row ? structuredClone(row) : null;
    },
    async insertIfFree(row, bufferMinutes) {
      const now = Date.now();
      const pad = bufferMinutes * 60_000;
      const clash = [...appointments.values()].some((existing) => {
        if (existing.organizationId !== row.organizationId || !blocks(existing, now)) return false;
        if (row.technicianId && existing.technicianId && existing.technicianId !== row.technicianId) {
          return false;
        }
        const start = new Date(Date.parse(row.startAt) - pad).toISOString();
        const end = new Date(Date.parse(row.endAt) + pad).toISOString();
        const otherStart = new Date(Date.parse(existing.startAt) - pad).toISOString();
        const otherEnd = new Date(Date.parse(existing.endAt) + pad).toISOString();
        return overlaps(start, end, otherStart, otherEnd);
      });
      if (clash) return null;
      if (row.idempotencyKey) {
        const dupe = [...appointments.values()].find(
          (a) => a.organizationId === row.organizationId && a.idempotencyKey === row.idempotencyKey,
        );
        if (dupe) return structuredClone(dupe);
      }
      appointments.set(row.id, structuredClone(row));
      return structuredClone(row);
    },
    async saveAppointment(row) {
      const current = appointments.get(row.id);
      if (!current || current.organizationId !== row.organizationId) return;
      appointments.set(row.id, structuredClone(row));
    },
    async addEvent(input) {
      events.push(input);
    },
    async listEvents(organizationId, appointmentId) {
      return events.filter(
        (event) => event.organizationId === organizationId && event.appointmentId === appointmentId,
      );
    },
    async getConnection(organizationId) {
      const row = connections.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveConnection(row) {
      connections.set(row.organizationId, structuredClone(row));
    },
    async replaceBusy(organizationId, blocks) {
      busy.set(organizationId, structuredClone(blocks));
    },
    async listBusy(organizationId) {
      return structuredClone(busy.get(organizationId) ?? []);
    },
  };
}

export function newSchedulingId(prefix: string) {
  return createId(prefix);
}
