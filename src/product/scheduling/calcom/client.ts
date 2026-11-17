import { z } from "zod";

/**
 * Thin, typed client for the parts of Cal.com API v2 TradeCatch uses.
 *
 * Every write reports one of three outcomes, because the difference decides
 * what the caller may claim:
 *
 * - `ok`: Cal.com answered with a well-formed success.
 * - `rejected`: Cal.com answered with a 4xx. It did not apply the request.
 * - `ambiguous`: no usable answer (timeout, network error, 5xx, a body that
 *   does not parse). The request may or may not have been applied.
 *
 * The API key is only ever placed in the Authorization header. It is never
 * part of an error code, a log line or a returned value.
 */

export const CALCOM_API_BASE_DEFAULT = "https://api.cal.com";

/** Each Cal.com endpoint is versioned on its own; these are the verified ones. */
export const CALCOM_VERSION = {
  bookings: "2026-02-25",
  bookingsList: "2026-05-01",
  slots: "2024-09-04",
  eventTypes: "2026-06-12",
} as const;

export type CalcomFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type CalcomAuth = {
  apiKey: string;
  fetchImpl?: CalcomFetch;
  baseUrl?: string;
};

export type CalcomRejection =
  | "unauthorized"
  | "not_found"
  | "slot_unavailable"
  | "rate_limited"
  | "invalid_request";

export type CalcomResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "rejected"; status: number; code: CalcomRejection }
  | { ok: false; kind: "ambiguous"; code: string };

/** The base URL, validated: HTTPS only (plain HTTP just for a local mock). */
export function calcomBaseUrl(override?: string): string {
  const raw = (override ?? process.env.CALCOM_API_BASE ?? "").trim();
  if (!raw) return CALCOM_API_BASE_DEFAULT;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (local && url.protocol === "http:")) {
      return url.origin;
    }
  } catch {
    // fall through to the default
  }
  return CALCOM_API_BASE_DEFAULT;
}

/** Cal.com API keys look like `cal_live_...` or `cal_...`. */
export const CALCOM_API_KEY_PATTERN = /^cal_[A-Za-z0-9_-]{10,200}$/;

const SLOT_TAKEN =
  /(not\s+available|no[_\s]available[_\s]users|already\s+has\s+a?\s*booking|unavailable|slot.*(taken|booked)|busy|conflict)/i;

function classify(status: number, body: unknown): CalcomRejection {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 409) return "slot_unavailable";
  const text = JSON.stringify(body ?? "").slice(0, 600);
  if ((status === 400 || status === 422) && SLOT_TAKEN.test(text)) {
    return "slot_unavailable";
  }
  return "invalid_request";
}

type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Omit for endpoints that take no version header. */
  version?: string;
  timeoutMs: number;
};

async function call(
  auth: CalcomAuth,
  options: RequestOptions,
): Promise<CalcomResult<unknown>> {
  const url = new URL(options.path, calcomBaseUrl(auth.baseUrl));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.apiKey}`,
    Accept: "application/json",
  };
  if (options.version) headers["cal-api-version"] = options.version;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await (auth.fetchImpl ?? ((i, init) => fetch(i, init)))(
      url.toString(),
      {
        method: options.method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: "error",
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, kind: "ambiguous", code: "network_error" };
  }
  let json: unknown;
  try {
    const text = await response.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    // A success whose body we cannot read still may have changed something.
    return response.ok
      ? { ok: false, kind: "ambiguous", code: "bad_response" }
      : response.status >= 500
        ? { ok: false, kind: "ambiguous", code: "server_error" }
        : {
            ok: false,
            kind: "rejected",
            status: response.status,
            code: classify(response.status, null),
          };
  }
  if (response.status >= 500) {
    return { ok: false, kind: "ambiguous", code: "server_error" };
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: "rejected",
      status: response.status,
      code: classify(response.status, json),
    };
  }
  return { ok: true, data: json };
}

function parse<T>(
  result: CalcomResult<unknown>,
  schema: z.ZodType<T>,
): CalcomResult<T> {
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    return { ok: false, kind: "ambiguous", code: "bad_response" };
  }
  return { ok: true, data: parsed.data };
}

// ---------------------------------------------------------------------------
// Response shapes (only the fields we rely on).

const success = <T extends z.ZodType>(data: T) =>
  z.object({ status: z.literal("success"), data });

const bookingSchema = z.object({
  uid: z.string().min(4).max(128),
  status: z.string(),
  start: z.string(),
  end: z.string().optional(),
  eventTypeId: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  rescheduledToUid: z.string().nullish(),
  rescheduledFromUid: z.string().nullish(),
});

export type CalcomBookingStatus =
  | "accepted"
  | "pending"
  | "awaiting_host"
  | "cancelled"
  | "rejected"
  | "other";

export type CalcomBooking = {
  uid: string;
  status: CalcomBookingStatus;
  startAt: string;
  endAt?: string;
  eventTypeId?: number;
  tcAppointmentId?: string;
  tcOrgId?: string;
  rescheduledToUid?: string;
};

function iso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function normalizeBooking(
  raw: z.infer<typeof bookingSchema>,
): CalcomBooking | null {
  const startAt = iso(raw.start);
  if (!startAt) return null;
  const known = [
    "accepted",
    "pending",
    "awaiting_host",
    "cancelled",
    "rejected",
  ] as const;
  const status = (known as readonly string[]).includes(raw.status)
    ? (raw.status as CalcomBookingStatus)
    : "other";
  const meta = raw.metadata ?? {};
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  return {
    uid: raw.uid,
    status,
    startAt,
    endAt: iso(raw.end),
    eventTypeId: raw.eventTypeId,
    tcAppointmentId: text(meta.tcAppointmentId),
    tcOrgId: text(meta.tcOrgId),
    rescheduledToUid: raw.rescheduledToUid ?? undefined,
  };
}

function booking(result: CalcomResult<unknown>): CalcomResult<CalcomBooking> {
  const parsed = parse(result, success(bookingSchema));
  if (!parsed.ok) return parsed;
  const normalized = normalizeBooking(parsed.data.data);
  return normalized
    ? { ok: true, data: normalized }
    : { ok: false, kind: "ambiguous", code: "bad_response" };
}

// ---------------------------------------------------------------------------
// Operations.

export type CalcomMe = {
  email?: string;
  username?: string;
  timeZone?: string;
};

const meSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    email: z.string().optional(),
    username: z.string().optional(),
    timeZone: z.string().optional(),
  }),
});

/** Who the key belongs to. Also proves the key works. */
export async function getMe(auth: CalcomAuth): Promise<CalcomResult<CalcomMe>> {
  const parsed = parse(
    await call(auth, { method: "GET", path: "/v2/me", timeoutMs: 5000 }),
    meSchema,
  );
  return parsed.ok ? { ok: true, data: parsed.data.data } : parsed;
}

export type CalcomEventType = {
  id: number;
  title?: string;
  lengthInMinutes?: number;
  /** Reasons TradeCatch cannot book this event type unattended. */
  blockers: ("requires_confirmation" | "seated" | "recurring" | "instant")[];
};

const eventTypesSchema = z.object({
  status: z.literal("success"),
  data: z.array(
    z.object({
      id: z.number(),
      title: z.string().optional(),
      lengthInMinutes: z.number().optional(),
      confirmationPolicy: z
        .object({
          type: z.string().optional(),
          disabled: z.boolean().optional(),
        })
        .nullish(),
      seatsPerTimeSlot: z.number().nullish(),
      recurrence: z.unknown().optional(),
      isInstantEvent: z.boolean().optional(),
    }),
  ),
});

/** The event types of the account that owns the key. */
export async function listEventTypes(
  auth: CalcomAuth,
): Promise<CalcomResult<CalcomEventType[]>> {
  const parsed = parse(
    await call(auth, {
      method: "GET",
      path: "/v2/event-types",
      version: CALCOM_VERSION.eventTypes,
      timeoutMs: 8000,
    }),
    eventTypesSchema,
  );
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    data: parsed.data.data.map((row) => {
      const blockers: CalcomEventType["blockers"] = [];
      const policy = row.confirmationPolicy;
      if (policy && policy.disabled !== true && policy.type) {
        blockers.push("requires_confirmation");
      }
      if (row.seatsPerTimeSlot) blockers.push("seated");
      const recurrence = row.recurrence as
        | { disabled?: boolean; interval?: number }
        | null
        | undefined;
      if (
        recurrence &&
        typeof recurrence === "object" &&
        recurrence.disabled !== true &&
        Object.keys(recurrence).length > 0
      ) {
        blockers.push("recurring");
      }
      if (row.isInstantEvent) blockers.push("instant");
      return {
        id: row.id,
        title: row.title,
        lengthInMinutes: row.lengthInMinutes,
        blockers,
      };
    }),
  };
}

const slotsSchema = z.object({
  status: z.literal("success"),
  data: z.record(
    z.string(),
    z.array(z.union([z.string(), z.object({ start: z.string() })])),
  ),
});

/** Free start times (ISO instants) of one event type. */
export async function getSlots(
  auth: CalcomAuth,
  input: {
    eventTypeId: number;
    from: Date;
    until: Date;
    timeZone: string;
    rescheduleUid?: string;
  },
): Promise<CalcomResult<string[]>> {
  const parsed = parse(
    await call(auth, {
      method: "GET",
      path: "/v2/slots",
      version: CALCOM_VERSION.slots,
      query: {
        eventTypeId: input.eventTypeId,
        start: input.from.toISOString(),
        end: input.until.toISOString(),
        timeZone: input.timeZone,
        bookingUidToReschedule: input.rescheduleUid,
      },
      timeoutMs: 4000,
    }),
    slotsSchema,
  );
  if (!parsed.ok) return parsed;
  const starts = new Set<string>();
  for (const day of Object.values(parsed.data.data)) {
    for (const item of day) {
      const at = iso(typeof item === "string" ? item : item.start);
      if (at) starts.add(at);
    }
  }
  return { ok: true, data: [...starts].sort() };
}

export type CalcomCreateInput = {
  eventTypeId: number;
  startAt: string;
  attendee: {
    name: string;
    timeZone: string;
    email?: string;
    phoneNumber?: string;
  };
  metadata: Record<string, string>;
};

export async function createBooking(
  auth: CalcomAuth,
  input: CalcomCreateInput,
): Promise<CalcomResult<CalcomBooking>> {
  return booking(
    await call(auth, {
      method: "POST",
      path: "/v2/bookings",
      version: CALCOM_VERSION.bookings,
      body: {
        start: input.startAt,
        eventTypeId: input.eventTypeId,
        attendee: input.attendee,
        metadata: input.metadata,
      },
      timeoutMs: 8000,
    }),
  );
}

export async function getBooking(
  auth: CalcomAuth,
  uid: string,
): Promise<CalcomResult<CalcomBooking>> {
  return booking(
    await call(auth, {
      method: "GET",
      path: `/v2/bookings/${encodeURIComponent(uid)}`,
      version: CALCOM_VERSION.bookings,
      timeoutMs: 5000,
    }),
  );
}

export async function cancelBooking(
  auth: CalcomAuth,
  uid: string,
  reason: string,
): Promise<CalcomResult<CalcomBooking>> {
  return booking(
    await call(auth, {
      method: "POST",
      path: `/v2/bookings/${encodeURIComponent(uid)}/cancel`,
      version: CALCOM_VERSION.bookings,
      body: { cancellationReason: reason.slice(0, 200) },
      timeoutMs: 6000,
    }),
  );
}

export async function rescheduleBooking(
  auth: CalcomAuth,
  uid: string,
  input: { startAt: string; reason: string },
): Promise<CalcomResult<CalcomBooking>> {
  return booking(
    await call(auth, {
      method: "POST",
      path: `/v2/bookings/${encodeURIComponent(uid)}/reschedule`,
      version: CALCOM_VERSION.bookings,
      body: {
        start: input.startAt,
        reschedulingReason: input.reason.slice(0, 200),
      },
      timeoutMs: 8000,
    }),
  );
}

const bookingsListSchema = z.object({
  status: z.literal("success"),
  data: z.array(bookingSchema),
  pagination: z
    .object({
      nextCursor: z.string().nullish(),
      hasMore: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Bookings of one event type that start from `afterStart`, across the
 * statuses that still hold a slot. Cal.com filters one status per request.
 */
export async function listBookings(
  auth: CalcomAuth,
  input: { eventTypeId: number; afterStart: string; maxPages?: number },
): Promise<CalcomResult<CalcomBooking[]>> {
  const found: CalcomBooking[] = [];
  for (const status of ["upcoming", "unconfirmed"] as const) {
    let cursor: string | undefined;
    for (let page = 0; page < (input.maxPages ?? 3); page += 1) {
      const parsed = parse(
        await call(auth, {
          method: "GET",
          path: "/v2/bookings",
          version: CALCOM_VERSION.bookingsList,
          query: {
            status,
            eventTypeId: input.eventTypeId,
            afterStart: input.afterStart,
            sortStart: "asc",
            limit: 100,
            cursor,
          },
          timeoutMs: 8000,
        }),
        bookingsListSchema,
      );
      if (!parsed.ok) return parsed;
      for (const raw of parsed.data.data) {
        const normalized = normalizeBooking(raw);
        if (normalized) found.push(normalized);
      }
      const next = parsed.data.pagination;
      if (!next?.hasMore || !next.nextCursor) break;
      cursor = next.nextCursor;
    }
  }
  return { ok: true, data: found };
}
