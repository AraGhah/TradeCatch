/**
 * Cal.com API v2 client (https://cal.com/docs/api-reference/v2).
 *
 * One small job: say exactly what Cal.com answered, and, for a call that may
 * change something, whether the answer is *definitive*. Cal.com documents no
 * idempotency key and no error body for a taken slot, so safety rests on the
 * difference between two kinds of failure:
 *
 *   definitive   the request was refused (4xx) or never left (auth, rate limit):
 *                nothing was created, the caller may try something else;
 *   unknown      a timeout, a dropped connection or a 5xx: the booking may or
 *                may not exist. Never retried blindly and never reported as
 *                booked; reconcile.ts finds out what really happened.
 *
 * Request and response bodies carry caller names and addresses, so nothing
 * here logs them; failures carry a status and a kind only.
 *
 * Each endpoint family is pinned to the `cal-api-version` its page documents
 * (overridable by env if Cal.com retires one).
 */

const DEFAULT_BASE = "https://api.cal.com/v2";

const VERSIONS = {
  slots: "2024-09-04",
  bookings: "2026-02-25",
  bookingsList: "2026-05-01",
  eventTypes: "2026-06-12",
} as const;

type VersionKey = keyof typeof VERSIONS;

function version(
  key: VersionKey,
  env: Record<string, string | undefined>,
): string {
  const override = env[`CALCOM_API_VERSION_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`]?.trim();
  return override && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : VERSIONS[key];
}

export const CALCOM_API_KEY_PATTERN = /^cal_[A-Za-z0-9_-]{10,200}$/;

export type CalcomFailureKind =
  /** The key was refused (401/403): nothing was created. */
  | "auth"
  /** Too many requests (429): nothing was created. */
  | "rate_limited"
  /** The time is no longer available: nothing was created. */
  | "slot_unavailable"
  /** Cal.com refused the request itself (other 4xx): nothing was created. */
  | "rejected"
  | "not_found"
  /** Timeout, network error or 5xx: a change may or may not have happened. */
  | "unknown";

export type CalcomFailure = {
  ok: false;
  kind: CalcomFailureKind;
  status?: number;
};
export type CalcomOk<T> = { ok: true; data: T };
export type CalcomResult<T> = CalcomOk<T> | CalcomFailure;

export type CalcomBookingStatus =
  | "accepted"
  | "pending"
  | "awaiting_host"
  | "cancelled"
  | "rejected";

export type CalcomBooking = {
  uid: string;
  status: CalcomBookingStatus;
  startAt: string;
  endAt: string;
  eventTypeId?: number;
  /** The TradeCatch appointment id this booking was made for, when we made it. */
  tradecatchId?: string;
  rescheduledToUid?: string;
  rescheduledFromUid?: string;
};

export type CalcomEventType = {
  id: number;
  slug: string;
  title: string;
  lengthInMinutes: number;
  hidden: boolean;
  /** The Cal.com user who owns it: one specialist's calendar. */
  ownerId?: number;
  ownerName?: string;
  ownerUsername?: string;
};

export type CalcomSlot = { startAt: string; endAt: string };

export type CalcomBookingRequest = {
  eventTypeId: number;
  startAt: string;
  lengthInMinutes?: number;
  attendee: {
    name: string;
    email?: string;
    phoneNumber?: string;
    timeZone: string;
    language: "fr" | "en";
  };
  /** Cal.com keeps these on the booking: at most 50 keys, 40-char keys, 500-char values. */
  metadata: Record<string, string>;
  /** Only when the event type has the "attendee address" location enabled. */
  addressAsLocation?: string;
};

export type CalcomClient = ReturnType<typeof createCalcomClient>;

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const asIso = (v: unknown): string | undefined => {
  const s = asString(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

const STATUSES = new Set<string>([
  "accepted",
  "pending",
  "awaiting_host",
  "cancelled",
  "rejected",
]);

/** A booking object from any v2 response, or undefined when it lacks what we rely on. */
export function parseBooking(value: unknown): CalcomBooking | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const uid = asString(raw.uid);
  const status = asString(raw.status)?.toLowerCase();
  const startAt = asIso(raw.start);
  const endAt = asIso(raw.end);
  if (!uid || !status || !STATUSES.has(status) || !startAt || !endAt) {
    return undefined;
  }
  const metadata = asRecord(raw.metadata);
  // `eventTypeId` is deprecated in favour of `eventType.id`.
  const eventTypeId =
    typeof asRecord(raw.eventType)?.id === "number"
      ? (asRecord(raw.eventType)?.id as number)
      : typeof raw.eventTypeId === "number"
        ? raw.eventTypeId
        : undefined;
  return {
    uid,
    status: status as CalcomBookingStatus,
    startAt,
    endAt,
    ...(eventTypeId !== undefined ? { eventTypeId } : {}),
    ...(asString(metadata?.tc_appointment_id)
      ? { tradecatchId: asString(metadata?.tc_appointment_id) }
      : {}),
    ...(asString(raw.rescheduledToUid)
      ? { rescheduledToUid: asString(raw.rescheduledToUid) }
      : {}),
    ...(asString(raw.rescheduledFromUid)
      ? { rescheduledFromUid: asString(raw.rescheduledFromUid) }
      : {}),
  };
}

/** Cal.com's own wording for "that time is gone", for the error bodies it does not document. */
const TAKEN =
  /no_available_users|already has (a )?booking|not available|unavailable|busy|no longer available|slot (is )?(not|no longer)/i;

export function createCalcomClient(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** Per-request ceiling; a live call cannot wait longer. */
  timeoutMs?: number;
}) {
  const env = input.env ?? process.env;
  const base = (env.CALCOM_API_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
  const doFetch = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;

  async function call(
    method: "GET" | "POST",
    path: string,
    options: {
      version: VersionKey;
      query?: Record<string, string | undefined>;
      body?: unknown;
      /** Whether a 4xx on this call can mean "that time is gone". */
      takenOn4xx?: boolean;
      /** Shorter than the client default: a live call has a deadline. */
      timeoutMs?: number;
    },
  ): Promise<CalcomResult<Record<string, unknown>>> {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "cal-api-version": version(options.version, env),
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      });
    } catch {
      return { ok: false, kind: "unknown" };
    }
    const status = response.status;
    let json: Record<string, unknown> | undefined;
    let text = "";
    try {
      text = await response.text();
      json = asRecord(text ? JSON.parse(text) : {});
    } catch {
      json = undefined;
    }
    if (status === 401 || status === 403) return { ok: false, kind: "auth", status };
    if (status === 429) return { ok: false, kind: "rate_limited", status };
    if (status === 404) return { ok: false, kind: "not_found", status };
    if (status >= 500) return { ok: false, kind: "unknown", status };
    if (status >= 400) {
      const taken =
        options.takenOn4xx === true &&
        (status === 409 || TAKEN.test(JSON.stringify(json?.error ?? json?.message ?? text)));
      return { ok: false, kind: taken ? "slot_unavailable" : "rejected", status };
    }
    // A 2xx whose body is not what we need cannot prove anything happened.
    if (!json || json.status === "error") {
      return { ok: false, kind: "unknown", status };
    }
    return { ok: true, data: json };
  }

  async function getBooking(uid: string): Promise<CalcomResult<CalcomBooking>> {
    const result = await call("GET", `/bookings/${encodeURIComponent(uid)}`, {
      version: "bookings",
    });
    if (!result.ok) return result;
    const booking = parseBooking(
      Array.isArray(result.data.data) ? result.data.data[0] : result.data.data,
    );
    return booking ? { ok: true, data: booking } : { ok: false, kind: "unknown" };
  }

  return {
    /** The key's own event types: what the contractor offers, one per specialist calendar. */
    async listEventTypes(): Promise<CalcomResult<CalcomEventType[]>> {
      const result = await call("GET", "/event-types", { version: "eventTypes" });
      if (!result.ok) return result;
      const rows = Array.isArray(result.data.data) ? result.data.data : [];
      const types: CalcomEventType[] = [];
      for (const row of rows) {
        const raw = asRecord(row);
        const id = typeof raw?.id === "number" ? raw.id : undefined;
        const length =
          typeof raw?.lengthInMinutes === "number" ? raw.lengthInMinutes : undefined;
        if (!raw || id === undefined || length === undefined) continue;
        const owner = Array.isArray(raw.users) ? asRecord(raw.users[0]) : undefined;
        types.push({
          id,
          slug: asString(raw.slug) ?? String(id),
          title: asString(raw.title) ?? String(id),
          lengthInMinutes: length,
          hidden: raw.hidden === true,
          ...(typeof raw.ownerId === "number" ? { ownerId: raw.ownerId } : {}),
          ...(asString(owner?.name) ? { ownerName: asString(owner?.name) } : {}),
          ...(asString(owner?.username)
            ? { ownerUsername: asString(owner?.username) }
            : {}),
        });
      }
      return { ok: true, data: types };
    },

    /** Free start times for one event type, in the business's timezone. */
    async slots(query: {
      eventTypeId: number;
      from: Date;
      until: Date;
      timeZone: string;
      lengthInMinutes?: number;
    }): Promise<CalcomResult<CalcomSlot[]>> {
      const result = await call("GET", "/slots", {
        version: "slots",
        query: {
          eventTypeId: String(query.eventTypeId),
          start: query.from.toISOString(),
          end: query.until.toISOString(),
          timeZone: query.timeZone,
          format: "range",
          duration: query.lengthInMinutes ? String(query.lengthInMinutes) : undefined,
        },
      });
      if (!result.ok) return result;
      const days = asRecord(result.data.data) ?? {};
      const slots: CalcomSlot[] = [];
      for (const day of Object.values(days)) {
        if (!Array.isArray(day)) continue;
        for (const entry of day) {
          // "range" gives { start, end }; tolerate a bare start string too.
          const raw = asRecord(entry);
          const startAt = asIso(raw?.start ?? entry);
          if (!startAt) continue;
          const endAt =
            asIso(raw?.end) ??
            new Date(
              Date.parse(startAt) + (query.lengthInMinutes ?? 60) * 60_000,
            ).toISOString();
          slots.push({ startAt, endAt });
        }
      }
      slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
      return { ok: true, data: slots };
    },

    async createBooking(
      request: CalcomBookingRequest,
      options?: { timeoutMs?: number },
    ): Promise<CalcomResult<CalcomBooking>> {
      const result = await call("POST", "/bookings", {
        version: "bookings",
        takenOn4xx: true,
        timeoutMs: options?.timeoutMs,
        body: {
          start: request.startAt,
          eventTypeId: request.eventTypeId,
          ...(request.lengthInMinutes
            ? { lengthInMinutes: request.lengthInMinutes }
            : {}),
          attendee: {
            name: request.attendee.name,
            timeZone: request.attendee.timeZone,
            language: request.attendee.language,
            ...(request.attendee.email ? { email: request.attendee.email } : {}),
            ...(request.attendee.phoneNumber
              ? { phoneNumber: request.attendee.phoneNumber }
              : {}),
          },
          metadata: request.metadata,
          ...(request.addressAsLocation
            ? {
                location: {
                  type: "attendeeAddress",
                  address: request.addressAsLocation,
                },
              }
            : {}),
        },
      });
      if (!result.ok) return result;
      const booking = parseBooking(result.data.data);
      // A 2xx that is not a usable, live booking is not proof of one.
      if (!booking || booking.status === "cancelled" || booking.status === "rejected") {
        return { ok: false, kind: "unknown", status: 201 };
      }
      return { ok: true, data: booking };
    },

    getBooking,

    /** Upcoming and recent bookings for these event types, newest page first, up to `maxPages`. */
    async listBookings(query: {
      eventTypeIds: number[];
      afterStart: Date;
      beforeEnd: Date;
      maxPages?: number;
    }): Promise<CalcomResult<CalcomBooking[]>> {
      const found: CalcomBooking[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < (query.maxPages ?? 5); page += 1) {
        const result = await call("GET", "/bookings", {
          version: "bookingsList",
          query: {
            eventTypeIds: query.eventTypeIds.join(","),
            afterStart: query.afterStart.toISOString(),
            beforeEnd: query.beforeEnd.toISOString(),
            limit: "100",
            cursor,
          },
        });
        if (!result.ok) return result;
        for (const row of Array.isArray(result.data.data) ? result.data.data : []) {
          const booking = parseBooking(row);
          if (booking) found.push(booking);
        }
        const pagination = asRecord(result.data.pagination);
        cursor =
          pagination?.hasMore === true ? asString(pagination.nextCursor) : undefined;
        if (!cursor) break;
      }
      // Pages left over means the list is incomplete, and a missing booking
      // could then be read as "never booked". Say so instead.
      if (cursor) return { ok: false, kind: "unknown" };
      return { ok: true, data: found };
    },

    /** Moves a booking. Cal.com issues a new booking uid for the new time. */
    async reschedule(
      uid: string,
      startAt: string,
      reason?: string,
      options?: { timeoutMs?: number },
    ): Promise<CalcomResult<CalcomBooking>> {
      const result = await call(
        "POST",
        `/bookings/${encodeURIComponent(uid)}/reschedule`,
        {
          version: "bookings",
          takenOn4xx: true,
          timeoutMs: options?.timeoutMs,
          body: {
            start: startAt,
            ...(reason ? { reschedulingReason: reason.slice(0, 200) } : {}),
          },
        },
      );
      if (!result.ok) return result;
      const booking = parseBooking(result.data.data);
      if (!booking || booking.status === "cancelled" || booking.status === "rejected") {
        return { ok: false, kind: "unknown", status: 201 };
      }
      return { ok: true, data: booking };
    },

    /** Cancels a booking. Canceling one that is already canceled counts as done. */
    async cancel(uid: string, reason?: string): Promise<CalcomResult<true>> {
      const result = await call(
        "POST",
        `/bookings/${encodeURIComponent(uid)}/cancel`,
        {
          version: "bookings",
          body: reason ? { cancellationReason: reason.slice(0, 200) } : {},
        },
      );
      if (result.ok) return { ok: true, data: true };
      if (result.kind === "rejected" || result.kind === "not_found") {
        // Already canceled (or gone) is the state we wanted: confirm which.
        const current = await getBooking(uid);
        if (current.ok && current.data.status === "cancelled") {
          return { ok: true, data: true };
        }
        if (!current.ok && current.kind === "not_found") {
          return { ok: true, data: true };
        }
      }
      return result;
    },
  };
}
