import { createId } from "@/lib/id";
import type {
  AvailabilityRules,
  BusyBlock,
  CalendarConnectionPublic,
  ScheduleAppointment,
  ServiceType,
  Technician,
} from "./types";
import type {
  CalcomBookingRecord,
  CalcomConnection,
  CalcomLedgerState,
} from "./calcom/types";
import { overlaps } from "./slots";
import type {
  CancelPolicy,
  EventDetail,
  EventLink,
  ExternalEvent,
  SyncState,
} from "./gcal/types";

export type StoredConnection = CalendarConnectionPublic & {
  organizationId: string;
  tokenCiphertext?: string;
  scope?: string;
  /** How much of the customer reaches the owner's Google event. Default: minimal. */
  eventDetail?: EventDetail;
  /** What happens to the Google event when its appointment is canceled. Default: remove. */
  cancelPolicy?: CancelPolicy;
  connectedAt?: string;
};

/** Which event links a caller wants claimed for sending. */
export type ClaimQuery = {
  organizationId?: string;
  appointmentId?: string;
  now: Date;
  limit: number;
  /** How long a claim holds: a worker that dies lets the link come due again. */
  leaseMs: number;
};

export type SchedulingStore = {
  getRules(organizationId: string): Promise<AvailabilityRules | null>;
  saveRules(rules: AvailabilityRules): Promise<AvailabilityRules>;
  listServices(organizationId: string): Promise<ServiceType[]>;
  saveService(service: ServiceType): Promise<ServiceType>;
  listTechnicians(organizationId: string): Promise<Technician[]>;
  saveTechnician(technician: Technician): Promise<Technician>;
  listAppointments(
    organizationId: string,
    limit?: number,
  ): Promise<ScheduleAppointment[]>;
  getAppointment(
    organizationId: string,
    id: string,
  ): Promise<ScheduleAppointment | null>;
  findByIdempotency(
    organizationId: string,
    key: string,
  ): Promise<ScheduleAppointment | null>;
  /**
   * `ignoreAppointmentId` is the appointment being moved: its own current time
   * must not count as a clash, or a move to an adjacent time is refused.
   */
  insertIfFree(
    row: ScheduleAppointment,
    bufferMinutes: number,
    ignoreAppointmentId?: string,
  ): Promise<ScheduleAppointment | null>;
  saveAppointment(row: ScheduleAppointment): Promise<void>;
  listPendingConfirmations(limit: number): Promise<ScheduleAppointment[]>;
  completeConfirmation(
    organizationId: string,
    id: string,
    startAt: string,
  ): Promise<void>;
  addEvent(input: {
    organizationId: string;
    appointmentId: string;
    kind: string;
    detail?: string;
    at: string;
  }): Promise<void>;
  listEvents(
    organizationId: string,
    appointmentId: string,
  ): Promise<{ kind: string; detail?: string; at: string }[]>;
  getConnection(organizationId: string): Promise<StoredConnection | null>;
  saveConnection(row: StoredConnection): Promise<void>;
  replaceBusy(organizationId: string, blocks: BusyBlock[]): Promise<void>;
  listBusy(organizationId: string): Promise<BusyBlock[]>;

  // Google Calendar two-way synchronization. Every method is scoped by
  // organization: a tenant can never read or overwrite another's rows.
  getEventLink(
    organizationId: string,
    appointmentId: string,
  ): Promise<EventLink | null>;
  findEventLinkByEventId(
    organizationId: string,
    calendarId: string,
    eventId: string,
  ): Promise<EventLink | null>;
  saveEventLink(link: EventLink): Promise<void>;
  listEventLinks(organizationId: string): Promise<EventLink[]>;
  /**
   * Atomically takes the links whose turn has come and pushes their next
   * attempt out by the lease, so two workers never send the same change at
   * once. Safe across Worker instances and poolers.
   */
  claimEventLinks(query: ClaimQuery): Promise<EventLink[]>;
  getSyncState(organizationId: string): Promise<SyncState | null>;
  /** Does not touch the lease or the rerun flag, which have their own methods. */
  saveSyncState(state: SyncState): Promise<void>;
  findSyncStateByChannel(channelId: string): Promise<SyncState | null>;
  /** Businesses that have a calendar selected and so have something to pull. */
  listSyncStates(): Promise<SyncState[]>;
  /** One pull at a time per business. False means someone else holds it. */
  tryLease(organizationId: string, now: Date, until: Date): Promise<boolean>;
  releaseLease(organizationId: string): Promise<void>;
  /** A notification arrived while a pull was running: the holder goes round again. */
  requestRerun(organizationId: string): Promise<void>;
  consumeRerun(organizationId: string): Promise<boolean>;
  listMirror(
    organizationId: string,
    calendarId: string,
  ): Promise<ExternalEvent[]>;
  /** A full sync replaces what was mirrored. */
  replaceMirror(
    organizationId: string,
    calendarId: string,
    events: ExternalEvent[],
  ): Promise<void>;
  /** An incremental sync changes only what Google said changed. */
  applyMirror(
    organizationId: string,
    calendarId: string,
    upserts: ExternalEvent[],
    deletedEventIds: string[],
  ): Promise<void>;
  /**
   * Disconnect: forget the pull state and the mirror, stop the push channel
   * record and detach every link. Appointments are never touched.
   */
  clearGoogleSync(organizationId: string, now: Date): Promise<void>;

  // Cal.com provider. The connection holds the sealed credential; the ledger
  // records every booking attempt so none can be lost or duplicated.
  getCalcomConnection(organizationId: string): Promise<CalcomConnection | null>;
  saveCalcomConnection(row: CalcomConnection): Promise<void>;
  /** Businesses that may have Cal.com bookings to keep in step. */
  listCalcomConnections(): Promise<CalcomConnection[]>;
  getCalcomBooking(
    organizationId: string,
    appointmentId: string,
  ): Promise<CalcomBookingRecord | null>;
  findCalcomBookingByUid(
    organizationId: string,
    uid: string,
  ): Promise<CalcomBookingRecord | null>;
  saveCalcomBooking(row: CalcomBookingRecord): Promise<void>;
  listCalcomBookings(
    organizationId: string,
    states: CalcomLedgerState[],
    limit: number,
  ): Promise<CalcomBookingRecord[]>;
};

const locks = new Map<string, Promise<void>>();

export async function withOrgLock<T>(
  organizationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(organizationId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(
    organizationId,
    previous.then(() => current),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function blocks(row: ScheduleAppointment, now: number): boolean {
  if (row.status === "canceled" || row.status === "completed") return false;
  if (row.status === "hold")
    return Boolean(row.holdExpiresAt && Date.parse(row.holdExpiresAt) > now);
  return row.status === "confirmed";
}

export function createMemorySchedulingStore(): SchedulingStore {
  const rules = new Map<string, AvailabilityRules>();
  const services = new Map<string, ServiceType>();
  const technicians = new Map<string, Technician>();
  const appointments = new Map<string, ScheduleAppointment>();
  const events: {
    organizationId: string;
    appointmentId: string;
    kind: string;
    detail?: string;
    at: string;
  }[] = [];
  const connections = new Map<string, StoredConnection>();
  const busy = new Map<string, BusyBlock[]>();
  const calcomConnections = new Map<string, CalcomConnection>();
  // Keyed by organization and appointment: a tenant can never read or
  // overwrite another tenant's ledger row.
  const calcomBookings = new Map<string, CalcomBookingRecord>();
  const ledgerKey = (organizationId: string, appointmentId: string) =>
    `${organizationId}\u0000${appointmentId}`;
  // Google synchronization.
  const eventLinks = new Map<string, EventLink>();
  const syncStates = new Map<string, SyncState>();
  const leases = new Map<string, string>();
  const reruns = new Set<string>();
  const mirror = new Map<string, Map<string, ExternalEvent>>();
  const mirrorKey = (organizationId: string, calendarId: string) =>
    `${organizationId}\u0000${calendarId}`;

  return {
    async getEventLink(organizationId, appointmentId) {
      const row = eventLinks.get(ledgerKey(organizationId, appointmentId));
      return row ? structuredClone(row) : null;
    },
    async findEventLinkByEventId(organizationId, calendarId, eventId) {
      const row = [...eventLinks.values()].find(
        (link) =>
          link.organizationId === organizationId &&
          link.calendarId === calendarId &&
          link.eventId === eventId,
      );
      return row ? structuredClone(row) : null;
    },
    async saveEventLink(link) {
      eventLinks.set(
        ledgerKey(link.organizationId, link.appointmentId),
        structuredClone(link),
      );
    },
    async listEventLinks(organizationId) {
      return [...eventLinks.values()]
        .filter((link) => link.organizationId === organizationId)
        .map((link) => structuredClone(link));
    },
    async claimEventLinks(query) {
      const now = query.now.getTime();
      const due = [...eventLinks.values()]
        .filter(
          (link) =>
            link.state === "pending" &&
            link.pendingOp !== null &&
            (!query.organizationId ||
              link.organizationId === query.organizationId) &&
            (!query.appointmentId ||
              link.appointmentId === query.appointmentId) &&
            (!link.nextAttemptAt || Date.parse(link.nextAttemptAt) <= now),
        )
        .sort((a, b) =>
          (a.nextAttemptAt ?? a.updatedAt).localeCompare(
            b.nextAttemptAt ?? b.updatedAt,
          ),
        )
        .slice(0, query.limit);
      for (const link of due) {
        link.nextAttemptAt = new Date(now + query.leaseMs).toISOString();
      }
      return due.map((link) => structuredClone(link));
    },
    async getSyncState(organizationId) {
      const row = syncStates.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveSyncState(state) {
      const current = syncStates.get(state.organizationId);
      syncStates.set(state.organizationId, {
        ...structuredClone(state),
        leaseUntil: current?.leaseUntil,
      });
    },
    async findSyncStateByChannel(channelId) {
      const row = [...syncStates.values()].find(
        (state) => state.channelId === channelId,
      );
      return row ? structuredClone(row) : null;
    },
    async listSyncStates() {
      return [...syncStates.values()]
        .filter((state) => state.calendarId)
        .map((state) => structuredClone(state));
    },
    async tryLease(organizationId, now, until) {
      const held = leases.get(organizationId);
      if (held && Date.parse(held) > now.getTime()) return false;
      leases.set(organizationId, until.toISOString());
      return true;
    },
    async releaseLease(organizationId) {
      leases.delete(organizationId);
    },
    async requestRerun(organizationId) {
      reruns.add(organizationId);
    },
    async consumeRerun(organizationId) {
      return reruns.delete(organizationId);
    },
    async listMirror(organizationId, calendarId) {
      return [...(mirror.get(mirrorKey(organizationId, calendarId))?.values() ?? [])].map(
        (event) => structuredClone(event),
      );
    },
    async replaceMirror(organizationId, calendarId, events) {
      mirror.set(
        mirrorKey(organizationId, calendarId),
        new Map(events.map((event) => [event.eventId, structuredClone(event)])),
      );
    },
    async applyMirror(organizationId, calendarId, upserts, deletedEventIds) {
      const key = mirrorKey(organizationId, calendarId);
      const rows = mirror.get(key) ?? new Map<string, ExternalEvent>();
      for (const id of deletedEventIds) rows.delete(id);
      for (const event of upserts)
        rows.set(event.eventId, structuredClone(event));
      mirror.set(key, rows);
    },
    async clearGoogleSync(organizationId, now) {
      syncStates.delete(organizationId);
      leases.delete(organizationId);
      reruns.delete(organizationId);
      busy.delete(organizationId);
      for (const key of [...mirror.keys()]) {
        if (key.startsWith(`${organizationId}\u0000`)) mirror.delete(key);
      }
      for (const link of eventLinks.values()) {
        if (link.organizationId !== organizationId) continue;
        link.state = "detached";
        link.pendingOp = null;
        link.attempts = 0;
        link.nextAttemptAt = undefined;
        link.lastError = undefined;
        link.externalStartAt = undefined;
        link.externalEndAt = undefined;
        link.updatedAt = now.toISOString();
      }
    },
    async getCalcomConnection(organizationId) {
      const row = calcomConnections.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveCalcomConnection(row) {
      calcomConnections.set(row.organizationId, structuredClone(row));
    },
    async listCalcomConnections() {
      return [...calcomConnections.values()]
        .filter((row) => row.status !== "disconnected")
        .map((row) => structuredClone(row));
    },
    async getCalcomBooking(organizationId, appointmentId) {
      const row = calcomBookings.get(ledgerKey(organizationId, appointmentId));
      return row ? structuredClone(row) : null;
    },
    async findCalcomBookingByUid(organizationId, uid) {
      const row = [...calcomBookings.values()].find(
        (entry) =>
          entry.organizationId === organizationId && entry.providerUid === uid,
      );
      return row ? structuredClone(row) : null;
    },
    async saveCalcomBooking(row) {
      calcomBookings.set(
        ledgerKey(row.organizationId, row.appointmentId),
        structuredClone(row),
      );
    },
    async listCalcomBookings(organizationId, states, limit) {
      return [...calcomBookings.values()]
        .filter(
          (row) =>
            row.organizationId === organizationId && states.includes(row.state),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit)
        .map((row) => structuredClone(row));
    },
    async listPendingConfirmations(limit) {
      return [...appointments.values()]
        .filter((a) => a.status === "confirmed" && a.confirmationNoticesPending)
        .slice(0, limit)
        .map((a) => structuredClone(a));
    },
    async completeConfirmation(organizationId, id, startAt) {
      const row = appointments.get(id);
      if (
        row?.organizationId === organizationId &&
        row.startAt === startAt &&
        row.status === "confirmed"
      )
        row.confirmationNoticesPending = false;
    },
    async getRules(organizationId) {
      const row = rules.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveRules(row) {
      rules.set(row.organizationId, structuredClone(row));
      return structuredClone(row);
    },
    async listServices(organizationId) {
      return [...services.values()]
        .filter((s) => s.organizationId === organizationId)
        .map((s) => structuredClone(s));
    },
    async saveService(service) {
      services.set(service.id, structuredClone(service));
      return structuredClone(service);
    },
    async listTechnicians(organizationId) {
      return [...technicians.values()]
        .filter((t) => t.organizationId === organizationId)
        .map((t) => structuredClone(t));
    },
    async saveTechnician(technician) {
      technicians.set(technician.id, structuredClone(technician));
      return structuredClone(technician);
    },
    async listAppointments(organizationId, limit) {
      return [...appointments.values()]
        .filter((a) => a.organizationId === organizationId)
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .slice(0, limit)
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
    async insertIfFree(row, bufferMinutes, ignoreAppointmentId) {
      const now = Date.now();
      const pad = bufferMinutes * 60_000;
      const clash = [...appointments.values()].some((existing) => {
        if (
          existing.organizationId !== row.organizationId ||
          existing.id === ignoreAppointmentId ||
          !blocks(existing, now)
        )
          return false;
        if (
          row.technicianId &&
          existing.technicianId &&
          existing.technicianId !== row.technicianId
        ) {
          return false;
        }
        // Only the existing booking carries the buffer, exactly like the SQL
        // in the Postgres store and like `listSlots`: padding both rows would
        // double the gap, so a time offered as free could not be booked.
        const otherStart = new Date(
          Date.parse(existing.startAt) - pad,
        ).toISOString();
        const otherEnd = new Date(
          Date.parse(existing.endAt) + pad,
        ).toISOString();
        return overlaps(row.startAt, row.endAt, otherStart, otherEnd);
      });
      if (clash) return null;
      if (row.idempotencyKey) {
        const dupe = [...appointments.values()].find(
          (a) =>
            a.organizationId === row.organizationId &&
            a.idempotencyKey === row.idempotencyKey,
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
        (event) =>
          event.organizationId === organizationId &&
          event.appointmentId === appointmentId,
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
