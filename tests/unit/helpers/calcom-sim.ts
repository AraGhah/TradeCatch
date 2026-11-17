/**
 * A small Cal.com API v2 simulator and a scheduling harness around it, so the
 * Cal.com tests run the real client, adapter, scheduling service and
 * reconciliation against something that behaves like Cal.com, including the
 * ways it fails (a request that lands but whose answer is lost, a booking
 * that waits for the host, a time taken a moment ago).
 *
 * Nothing here talks to the network.
 */
import {
  createCalcomCalendar,
  type CalcomLedger,
} from "../../../src/product/scheduling/calcom/adapter";
import type { CalcomFetch } from "../../../src/product/scheduling/calcom/client";
import type { CalcomRoute } from "../../../src/product/scheduling/calcom/types";
import { createSchedulingService } from "../../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../../src/product/scheduling/store";

export const CALCOM_KEY = "cal_live_testkey_0123456789";
export const ORG = "org-cal";
/** Friday 08:00 in Toronto. */
export const NOW = new Date("2026-10-16T12:00:00.000Z");
/** Monday 10:00 in Toronto (EDT). */
export const MONDAY_10 = "2026-10-19T14:00:00.000Z";
export const MONDAY_11 = "2026-10-19T15:00:00.000Z";
export const TZ = "America/Toronto";

export type CreateBehaviour =
  | "accept"
  /** The booking waits for the host to confirm. */
  | "pending"
  /** Accepted, but at another time than asked. */
  | "start_shifted"
  /** Cal.com says the time is no longer available. */
  | "slot_taken"
  /** The request never arrives and no answer comes back. */
  | "lost"
  /** The booking is made, then the answer is lost. */
  | "applied_then_lost"
  /** A server error, nothing was made. */
  | "server_error"
  /** The booking is made, then Cal.com answers 500. */
  | "applied_then_500"
  | "unauthorized";

export type SimBooking = {
  uid: string;
  status: "accepted" | "pending" | "cancelled" | "rejected";
  start: string;
  end: string;
  eventTypeId: number;
  metadata: Record<string, unknown>;
  attendee?: Record<string, unknown>;
  rescheduledToUid?: string;
};

export type SimEventType = {
  id: number;
  title: string;
  lengthInMinutes: number;
  confirmationPolicy?: { type: string; disabled?: boolean };
  seatsPerTimeSlot?: number;
  recurrence?: Record<string, unknown>;
  isInstantEvent?: boolean;
};

export type SimRequest = {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
};

export type SimOptions = {
  offered?: string[];
  validKey?: string;
  eventTypes?: SimEventType[];
  /** A booking removes its time from the slots (default). Off: only TradeCatch's own rules do. */
  blocksOnBooking?: boolean;
};

function defaultOffered(): string[] {
  const out: string[] = [];
  for (const day of [19, 20, 21, 22, 23, 26]) {
    for (let hour = 12; hour <= 21; hour += 1) {
      for (const minute of ["00", "30"]) {
        out.push(
          `2026-10-${day}T${String(hour).padStart(2, "0")}:${minute}:00.000Z`,
        );
      }
    }
  }
  // Times Cal.com would offer that the business's own hours do not allow.
  out.push("2026-10-18T14:00:00.000Z", "2026-10-19T22:00:00.000Z");
  return out;
}

const DEFAULT_EVENT_TYPES: SimEventType[] = [
  { id: 11, title: "Estimation", lengthInMinutes: 60 },
  { id: 12, title: "Drain inspection", lengthInMinutes: 30 },
  { id: 13, title: "Moves to host", lengthInMinutes: 60, confirmationPolicy: { type: "always" } },
  { id: 14, title: "Seated", lengthInMinutes: 60, seatsPerTimeSlot: 4 },
  { id: 15, title: "Recurring", lengthInMinutes: 60, recurrence: { interval: 1, frequency: "weekly", occurrences: 4 } },
  { id: 16, title: "Instant", lengthInMinutes: 60, isInstantEvent: true },
  { id: 17, title: "Auto confirm", lengthInMinutes: 90, confirmationPolicy: { type: "always", disabled: true } },
];

/** "2026-10-19T14:00:00.000Z" in a zone: "2026-10-19T10:00:00.000-04:00". */
export function localIso(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const clock = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const offsetName =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = offsetName === "GMT" ? "+00:00" : offsetName.replace("GMT", "");
  return `${clock.replace(" ", "T")}.000${offset}`;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export function createCalcomSim(options: SimOptions = {}) {
  const validKey = options.validKey ?? CALCOM_KEY;
  const offered = new Set(
    (options.offered ?? defaultOffered()).map((v) => new Date(v).toISOString()),
  );
  const eventTypes = options.eventTypes ?? DEFAULT_EVENT_TYPES;
  const blocksOnBooking = options.blocksOnBooking ?? true;
  const bookings = new Map<string, SimBooking>();
  const requests: SimRequest[] = [];
  let seq = 0;

  const sim = {
    bookings,
    requests,
    offered,
    /** Consumed one per create request; empty means "accept". */
    createBehaviours: [] as CreateBehaviour[],
    /** What a reschedule does next: "accept" or leave it for the host. */
    rescheduleBehaviour: "accept" as "accept" | "pending",
    slotsDown: false,
    /** Cancel, get and list never answer. */
    unreachable: false,
    listDown: false,
    /** Length of every booking, in minutes. */
    bookingMinutes: 60,

    list(): SimBooking[] {
      return [...bookings.values()];
    },
    active(): SimBooking[] {
      return [...bookings.values()].filter(
        (b) => b.status === "accepted" || b.status === "pending",
      );
    },
    count(method: string, path: RegExp): number {
      return requests.filter((r) => r.method === method && path.test(r.path))
        .length;
    },
    /** The contractor cancels in Cal.com. */
    externalCancel(uid: string) {
      const found = bookings.get(uid);
      if (found) found.status = "cancelled";
    },
    /** The contractor moves it in Cal.com: the old uid is cancelled and points to the new one. */
    externalMove(uid: string, startAt: string): SimBooking {
      const old = bookings.get(uid)!;
      old.status = "cancelled";
      const moved = sim.insert(old.eventTypeId, startAt, old.metadata, "accepted");
      old.rescheduledToUid = moved.uid;
      return moved;
    },
    insert(
      eventTypeId: number,
      start: string,
      metadata: Record<string, unknown>,
      status: SimBooking["status"],
      attendee?: Record<string, unknown>,
    ): SimBooking {
      seq += 1;
      const startIso = new Date(start).toISOString();
      const booking: SimBooking = {
        uid: `simbk${seq}x${eventTypeId}`,
        status,
        start: startIso,
        end: new Date(Date.parse(startIso) + sim.bookingMinutes * 60_000).toISOString(),
        eventTypeId,
        metadata,
        attendee,
      };
      bookings.set(booking.uid, booking);
      return booking;
    },
    isFree(eventTypeId: number, start: string, ignoreUid?: string): boolean {
      const iso = new Date(start).toISOString();
      if (!offered.has(iso)) return false;
      if (!blocksOnBooking) return true;
      return !sim.active().some(
        (b) => b.eventTypeId === eventTypeId && b.start === iso && b.uid !== ignoreUid,
      );
    },

    fetch: (async (input, init) => {
      const url = new URL(input);
      const method = (init.method ?? "GET").toUpperCase();
      const headers = { ...(init.headers as Record<string, string>) };
      const body = init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      const query = Object.fromEntries(url.searchParams);
      requests.push({ method, url: input, path: url.pathname, query, headers, body });

      if (headers.Authorization !== `Bearer ${validKey}`) {
        return json(401, { status: "error", error: { message: "Invalid API key" } });
      }
      const api = (b: SimBooking) => ({
        uid: b.uid,
        status: b.status,
        start: localIso(b.start, TZ),
        end: b.end,
        eventTypeId: b.eventTypeId,
        metadata: b.metadata,
        rescheduledToUid: b.rescheduledToUid ?? null,
      });

      if (method === "GET" && url.pathname === "/v2/me") {
        return json(200, {
          status: "success",
          data: { email: "owner@nord.test", username: "nord", timeZone: TZ },
        });
      }
      if (method === "GET" && url.pathname === "/v2/event-types") {
        return json(200, { status: "success", data: eventTypes });
      }
      if (method === "GET" && url.pathname === "/v2/slots") {
        if (sim.slotsDown) return json(500, { status: "error" });
        const eventTypeId = Number(query.eventTypeId);
        const from = Date.parse(query.start!);
        const until = Date.parse(query.end!);
        const zone = query.timeZone || "UTC";
        const days: Record<string, { start: string }[]> = {};
        for (const start of [...offered].sort()) {
          const at = Date.parse(start);
          if (at < from || at >= until) continue;
          if (!sim.isFree(eventTypeId, start, query.bookingUidToReschedule)) continue;
          const local = localIso(start, zone);
          (days[local.slice(0, 10)] ??= []).push({ start: local });
        }
        return json(200, { status: "success", data: days });
      }
      if (method === "GET" && url.pathname === "/v2/bookings") {
        if (sim.unreachable || sim.listDown) return json(500, { status: "error" });
        const wanted = query.status === "unconfirmed" ? "pending" : "accepted";
        const rows = sim
          .list()
          .filter(
            (b) =>
              b.status === wanted &&
              b.eventTypeId === Number(query.eventTypeId) &&
              Date.parse(b.start) >= Date.parse(query.afterStart ?? "1970-01-01"),
          );
        return json(200, {
          status: "success",
          data: rows.map(api),
          pagination: { hasMore: false },
        });
      }
      if (method === "POST" && url.pathname === "/v2/bookings") {
        const behaviour = sim.createBehaviours.shift() ?? "accept";
        const eventTypeId = Number(body?.eventTypeId);
        const start = String(body?.start);
        const taken = json(400, {
          status: "error",
          error: { message: "User either already has booking at this time or is not available" },
        });
        if (behaviour === "unauthorized") return json(401, { status: "error" });
        if (behaviour === "server_error") return json(500, { status: "error" });
        if (behaviour === "lost") throw new Error("socket hang up");
        if (behaviour === "slot_taken" || !sim.isFree(eventTypeId, start)) return taken;
        const shifted = new Date(Date.parse(start) + 30 * 60_000).toISOString();
        const booking = sim.insert(
          eventTypeId,
          behaviour === "start_shifted" ? shifted : start,
          (body?.metadata as Record<string, unknown>) ?? {},
          behaviour === "pending" ? "pending" : "accepted",
          body?.attendee as Record<string, unknown> | undefined,
        );
        if (behaviour === "applied_then_lost") throw new Error("socket hang up");
        if (behaviour === "applied_then_500") return json(500, { status: "error" });
        return json(201, { status: "success", data: api(booking) });
      }

      const match = /^\/v2\/bookings\/([^/]+)(\/cancel|\/reschedule)?$/.exec(url.pathname);
      if (match) {
        if (sim.unreachable) throw new Error("socket hang up");
        const found = bookings.get(decodeURIComponent(match[1]!));
        if (!found) return json(404, { status: "error", error: { message: "Booking not found" } });
        if (method === "GET" && !match[2]) return json(200, { status: "success", data: api(found) });
        if (method === "POST" && match[2] === "/cancel") {
          if (found.status === "cancelled") {
            return json(400, { status: "error", error: { message: "Cannot cancel a booking that is already cancelled" } });
          }
          found.status = "cancelled";
          return json(200, { status: "success", data: api(found) });
        }
        if (method === "POST" && match[2] === "/reschedule") {
          const start = String(body?.start);
          if (found.status !== "accepted") return json(400, { status: "error", error: { message: "Booking is not active" } });
          if (!sim.isFree(found.eventTypeId, start, found.uid)) {
            return json(400, {
              status: "error",
              error: { message: "User either already has booking at this time or is not available" },
            });
          }
          found.status = "cancelled";
          const next = sim.insert(
            found.eventTypeId,
            start,
            found.metadata,
            sim.rescheduleBehaviour === "pending" ? "pending" : "accepted",
            found.attendee,
          );
          found.rescheduledToUid = next.uid;
          return json(200, { status: "success", data: api(next) });
        }
      }
      return json(404, { status: "error", error: { message: "Unknown route" } });
    }) as CalcomFetch,
  };
  return sim;
}

export type CalcomSim = ReturnType<typeof createCalcomSim>;

export type HarnessOptions = {
  sim?: SimOptions;
  multiCrew?: boolean;
  routes?: CalcomRoute[];
  defaultEventTypeId?: number;
  /** Leave the business on its default (not Cal.com) calendar. */
  mode?: "calcom" | "simulated";
};

/** The real scheduling service over an in-memory store, with Cal.com as its calendar. */
export async function createHarness(options: HarnessOptions = {}) {
  const sim = createCalcomSim(options.sim);
  const store = createMemorySchedulingStore();
  const clock = { now: new Date(NOW) };
  const hints: (string | undefined)[] = [];
  const notified: { kind: string; refId: string }[] = [];
  const scheduled: string[] = [];
  const canceledNotices: string[] = [];

  const ledger: CalcomLedger = {
    get: (org, appointmentId) => store.getCalcomBooking(org, appointmentId),
    findByUid: (org, uid) => store.findCalcomBookingByUid(org, uid),
    save: (row) => store.saveCalcomBooking(row),
  };
  const port = () =>
    createCalcomCalendar({
      organizationId: ORG,
      apiKey: CALCOM_KEY,
      defaultEventTypeId: options.defaultEventTypeId ?? 11,
      routes: options.routes ?? [],
      multiCrew: options.multiCrew ?? false,
      ledger,
      now: () => clock.now,
      fetchImpl: sim.fetch,
    });
  const service = createSchedulingService({
    store,
    now: () => clock.now,
    calendar: async (_organizationId, hint) => {
      hints.push(hint?.eventId);
      return port();
    },
    scheduleNotices: async (input) => {
      scheduled.push(input.appointmentId);
    },
    cancelNotices: async (_org, appointmentId) => {
      canceledNotices.push(appointmentId);
    },
    notify: async (input) => {
      notified.push({ kind: input.kind, refId: input.refId });
    },
  });
  if ((options.mode ?? "calcom") === "calcom") {
    await service.setCalendarMode(ORG, "calcom");
  }
  return {
    sim,
    store,
    service,
    clock,
    ledger,
    port,
    hints,
    notified,
    scheduled,
    canceledNotices,
    advance(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export const bookInput = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  startAt: MONDAY_10,
  customerName: "Marie Tremblay",
  customerPhoneE164: "+15145559876",
  serviceAddress: "12 rue des Pins, Laval, QC H7N 1A1",
  source: "ai_receptionist" as const,
  idempotencyKey: "rcb:call-1:2026-10-19T14:00:00.000Z",
  ...over,
});
