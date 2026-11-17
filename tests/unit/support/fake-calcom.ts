/**
 * An in-memory stand-in for the Cal.com v2 API, as a `fetch` implementation.
 * It enforces the one rule that matters for double-booking (a start time can
 * be booked once) and can fail in the ways a real network does, including the
 * dangerous one: the booking is made but the answer never arrives.
 */

export type FakeBooking = {
  uid: string;
  status: "accepted" | "pending" | "cancelled" | "rejected";
  start: string;
  end: string;
  eventTypeId: number;
  metadata: Record<string, string>;
  rescheduledFromUid?: string;
  rescheduledToUid?: string;
};

export type CreateBehavior =
  | "ok"
  /** Cal.com refuses: that time is gone. Nothing created. */
  | "slot_taken"
  /** Server error and nothing created. */
  | "never_arrived"
  /** The booking IS created, then the answer is a 500. */
  | "lost_answer"
  /** The booking IS created, then the connection fails. */
  | "timeout_after_create"
  /** The event type needs host approval: created as pending. */
  | "pending"
  /** Created at a different time than asked. */
  | "wrong_time"
  | "bad_key";

export type FakeRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | undefined;
  headers: Record<string, string>;
};

export function createFakeCalcom(input: {
  /** ISO start times Cal.com offers. */
  slots: string[];
  lengthMinutes?: number;
  eventTypes?: { id: number; title: string; hidden?: boolean }[];
}) {
  const length = input.lengthMinutes ?? 60;
  const bookings = new Map<string, FakeBooking>();
  const requests: FakeRequest[] = [];
  let counter = 0;
  const state = {
    create: "ok" as CreateBehavior,
    reschedule: "ok" as "ok" | "slot_taken" | "lost_answer",
    cancel: "ok" as "ok" | "error",
    list: "ok" as "ok" | "error" | "more_pages",
    slots: "ok" as "ok" | "error",
    keyValid: true,
  };
  const end = (start: string) =>
    new Date(Date.parse(start) + length * 60_000).toISOString();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const isTaken = (start: string) =>
    [...bookings.values()].some(
      (b) =>
        (b.status === "accepted" || b.status === "pending") &&
        Date.parse(b.start) === Date.parse(start),
    );
  const view = (b: FakeBooking) => ({
    uid: b.uid,
    status: b.status,
    start: b.start,
    end: b.end,
    eventType: { id: b.eventTypeId, slug: "visit" },
    metadata: b.metadata,
    ...(b.rescheduledFromUid ? { rescheduledFromUid: b.rescheduledFromUid } : {}),
    ...(b.rescheduledToUid ? { rescheduledToUid: b.rescheduledToUid } : {}),
  });

  async function fetchImpl(
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const u = new URL(typeof url === "string" || url instanceof URL ? url : url.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const path = u.pathname.replace(/^\/v2/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const query = Object.fromEntries(u.searchParams.entries());
    requests.push({ method, path, query, body, headers });

    if (!state.keyValid || state.create === "bad_key") {
      return json({ status: "error", error: { message: "Invalid API key" } }, 401);
    }

    if (method === "GET" && path === "/event-types") {
      return json({
        status: "success",
        data: (input.eventTypes ?? [{ id: 11, title: "Visit" }]).map((t) => ({
          id: t.id,
          slug: `visit-${t.id}`,
          title: t.title,
          lengthInMinutes: length,
          hidden: t.hidden ?? false,
          users: [{ name: "Alex Specialist", username: "alex" }],
        })),
      });
    }

    if (method === "GET" && path === "/slots") {
      if (state.slots === "error") return json({ status: "error" }, 500);
      const days: Record<string, { start: string; end: string }[]> = {};
      for (const start of input.slots) {
        if (isTaken(start)) continue;
        const day = start.slice(0, 10);
        (days[day] ??= []).push({ start, end: end(start) });
      }
      return json({ status: "success", data: days });
    }

    if (method === "POST" && path === "/bookings") {
      const start = String(body?.start);
      const eventTypeId = Number(body?.eventTypeId);
      const metadata = (body?.metadata ?? {}) as Record<string, string>;
      if (state.create === "slot_taken" || isTaken(start)) {
        return json(
          { status: "error", error: { message: "no_available_users_found_error" } },
          400,
        );
      }
      if (state.create === "never_arrived") {
        return json({ status: "error" }, 500);
      }
      const booking: FakeBooking = {
        uid: `bk_${(counter += 1)}`,
        status: state.create === "pending" ? "pending" : "accepted",
        start: state.create === "wrong_time" ? end(start) : start,
        end: end(state.create === "wrong_time" ? end(start) : start),
        eventTypeId,
        metadata,
      };
      bookings.set(booking.uid, booking);
      if (state.create === "lost_answer") return json({ status: "error" }, 500);
      if (state.create === "timeout_after_create") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      return json({ status: "success", data: view(booking) }, 201);
    }

    const action = /^\/bookings\/([^/]+)\/(cancel|reschedule)$/.exec(path);
    if (method === "POST" && action) {
      const booking = bookings.get(action[1]);
      if (!booking) return json({ status: "error" }, 404);
      if (action[2] === "cancel") {
        if (state.cancel === "error") return json({ status: "error" }, 500);
        if (booking.status === "cancelled") {
          return json({ status: "error", error: { message: "already cancelled" } }, 400);
        }
        booking.status = "cancelled";
        return json({ status: "success", data: view(booking) });
      }
      const start = String(body?.start);
      if (state.reschedule === "slot_taken" || isTaken(start)) {
        return json({ status: "error", error: { message: "no_available_users_found_error" } }, 400);
      }
      const next: FakeBooking = {
        uid: `bk_${(counter += 1)}`,
        status: "accepted",
        start,
        end: end(start),
        eventTypeId: booking.eventTypeId,
        // Cal.com does not reliably carry our metadata across a reschedule.
        metadata: {},
        rescheduledFromUid: booking.uid,
      };
      booking.status = "cancelled";
      booking.rescheduledToUid = next.uid;
      bookings.set(next.uid, next);
      if (state.reschedule === "lost_answer") return json({ status: "error" }, 500);
      return json({ status: "success", data: view(next) });
    }

    const one = /^\/bookings\/([^/]+)$/.exec(path);
    if (method === "GET" && one) {
      const booking = bookings.get(one[1]);
      return booking
        ? json({ status: "success", data: view(booking) })
        : json({ status: "error" }, 404);
    }

    if (method === "GET" && path === "/bookings") {
      if (state.list === "error") return json({ status: "error" }, 500);
      return json({
        status: "success",
        data: [...bookings.values()].map(view),
        pagination:
          state.list === "more_pages"
            ? { hasMore: true, nextCursor: "next" }
            : { hasMore: false, nextCursor: null },
      });
    }
    return json({ status: "error", error: { message: `unhandled ${method} ${path}` } }, 404);
  }

  return {
    fetch: fetchImpl as typeof fetch,
    bookings,
    requests,
    state,
    count: (method: string, path: RegExp | string) =>
      requests.filter(
        (r) =>
          r.method === method &&
          (typeof path === "string" ? r.path === path : path.test(r.path)),
      ).length,
    /** Make a booking exist in Cal.com without TradeCatch asking (e.g. made by the contractor). */
    seed(booking: Partial<FakeBooking> & { start: string }): FakeBooking {
      const made: FakeBooking = {
        uid: `bk_${(counter += 1)}`,
        status: "accepted",
        end: end(booking.start),
        eventTypeId: 11,
        metadata: {},
        ...booking,
      };
      bookings.set(made.uid, made);
      return made;
    },
  };
}
