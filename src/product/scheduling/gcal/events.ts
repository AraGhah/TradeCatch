import { createHash } from "node:crypto";
import type { BusyBlock, ScheduleAppointment } from "../types";
import type {
  CancelPolicy,
  EventDetail,
  EventLink,
  ExternalEvent,
} from "./types";

/** Private extended property naming the TradeCatch appointment an event was written for. */
export const APPOINTMENT_MARKER = "tcAppointmentId";

// ---------------------------------------------------------------------------
// Event ids
// ---------------------------------------------------------------------------

const BASE32_HEX = "0123456789abcdefghijklmnopqrstuv";

function base32hex(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_HEX[(value << (5 - bits)) & 31];
  return out;
}

/**
 * The Google event id for an appointment. Google lets the caller choose the id
 * (lowercase a-v and 0-9, 5 to 1024 characters) and answers 409 when it already
 * exists, so creating the same event twice is detected instead of duplicated,
 * even when the first answer was lost. Google never reuses the id of a deleted
 * event, so re-creating one needs the next `generation`.
 */
export function eventIdFor(
  organizationId: string,
  appointmentId: string,
  generation = 1,
): string {
  const digest = createHash("sha256")
    .update(`${organizationId}\u0000${appointmentId}\u0000${generation}`)
    .digest();
  return `tc${base32hex(digest.subarray(0, 18))}`;
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant at which calendar day `YYYY-MM-DD` begins in `timeZone`. */
export function dayStartUtc(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  // The offset depends on the instant, so settle it in two passes (this also
  // lands correctly on a day whose midnight is skipped or repeated by DST).
  let guess = wallClockAsUtc - offsetMs(new Date(wallClockAsUtc), timeZone);
  guess = wallClockAsUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

// ---------------------------------------------------------------------------
// What TradeCatch writes
// ---------------------------------------------------------------------------

export type EventBody = Record<string, unknown>;

/**
 * The event body for an appointment. `minimal` names the service only: no
 * customer name, phone or address ever reaches the owner's calendar. `standard`
 * adds them, because the owner is the controller of that calendar and chose it.
 * Nobody is invited and no one is emailed by Google.
 */
export function buildEventBody(
  appointment: ScheduleAppointment,
  options: {
    detail: EventDetail;
    canceled?: boolean;
    cancelPolicy?: CancelPolicy;
  },
): EventBody {
  const standard = options.detail === "standard";
  const customer = appointment.customerName?.trim();
  const baseSummary = standard
    ? `${appointment.serviceName} · ${customer || "Customer"}`
    : appointment.serviceName;
  const lines: string[] = [];
  if (standard) {
    if (appointment.customerPhoneE164) {
      lines.push(`Phone: ${appointment.customerPhoneE164}`);
    }
    if (appointment.serviceAddress) {
      lines.push(`Address: ${appointment.serviceAddress}`);
    }
  }
  lines.push("Booked through TradeCatch. Change this appointment in TradeCatch.");
  const canceled = Boolean(options.canceled);
  const body: EventBody = {
    summary: canceled ? `[Canceled] ${baseSummary}` : baseSummary,
    description: lines.join("\n"),
    start: { dateTime: appointment.startAt, timeZone: appointment.timezone },
    end: { dateTime: appointment.endAt, timeZone: appointment.timezone },
    // A canceled appointment kept on the calendar must not block the owner's time.
    transparency: canceled ? "transparent" : "opaque",
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: { useDefault: true },
    extendedProperties: {
      private: { [APPOINTMENT_MARKER]: appointment.id },
    },
  };
  if (standard && appointment.serviceAddress) {
    body.location = appointment.serviceAddress;
  }
  return body;
}

// ---------------------------------------------------------------------------
// What Google tells us
// ---------------------------------------------------------------------------

type RawEvent = {
  id?: string;
  etag?: string;
  status?: string;
  transparency?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
};

/** `fields` for events.list: the least Google can tell us, never a title or a guest list. */
export const EVENT_LIST_FIELDS =
  "nextPageToken,nextSyncToken,items(id,etag,status,transparency,eventType,start,end,attendees(self,responseStatus),extendedProperties/private)";

export type ParsedEvent =
  | { kind: "event"; event: ExternalEvent }
  | { kind: "deleted"; eventId: string };

export function parseGoogleEvent(
  raw: RawEvent,
  businessTimeZone: string,
): ParsedEvent | null {
  if (!raw || typeof raw.id !== "string" || !raw.id) return null;
  if (raw.status === "cancelled") return { kind: "deleted", eventId: raw.id };

  let startAt: string;
  let endAt: string;
  let allDay = false;
  if (raw.start?.dateTime && raw.end?.dateTime) {
    const start = Date.parse(raw.start.dateTime);
    const end = Date.parse(raw.end.dateTime);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    startAt = new Date(start).toISOString();
    endAt = new Date(end).toISOString();
  } else if (raw.start?.date && raw.end?.date) {
    // All-day events carry plain dates (the end is exclusive): the business's
    // own days, not UTC days.
    allDay = true;
    const start = dayStartUtc(raw.start.date, businessTimeZone);
    const end = dayStartUtc(raw.end.date, businessTimeZone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) return null;
    startAt = start.toISOString();
    endAt = end.toISOString();
  } else {
    return null;
  }

  const self = raw.attendees?.find((attendee) => attendee.self);
  return {
    kind: "event",
    event: {
      eventId: raw.id,
      startAt,
      endAt,
      allDay,
      transparent: raw.transparency === "transparent",
      status: raw.status === "tentative" ? "tentative" : "confirmed",
      declined: self?.responseStatus === "declined",
      informational:
        raw.eventType === "workingLocation" || raw.eventType === "birthday",
      etag: raw.etag,
      appointmentId: raw.extendedProperties?.private?.[APPOINTMENT_MARKER],
    },
  };
}

/** Events TradeCatch wrote and still tracks: their time is held by the appointment itself. */
export function ownEventIds(links: EventLink[]): Set<string> {
  return new Set(
    links
      .filter((link) => link.eventId && link.state !== "detached")
      .map((link) => link.eventId as string),
  );
}

/**
 * The busy times the owner's calendar imposes on TradeCatch.
 *
 * Events TradeCatch wrote are skipped (counting them would block an
 * appointment's own time, and make moving it by half an hour impossible). An
 * event of ours that the owner moved is the exception: its NEW time is real
 * occupancy, so it blocks, while the appointment itself stays where it was.
 */
export function busyBlocks(
  events: ExternalEvent[],
  links: EventLink[],
): BusyBlock[] {
  const own = ownEventIds(links);
  // An event carrying our marker for an appointment we know was written by us,
  // even when its link was detached by a disconnect and has not been re-attached
  // yet. Counting it would make an appointment block its own time.
  const ours = new Set(links.map((link) => link.appointmentId));
  const out: BusyBlock[] = [];
  for (const event of events) {
    if (own.has(event.eventId)) continue;
    if (event.appointmentId && ours.has(event.appointmentId)) continue;
    if (
      event.status === "cancelled" ||
      event.transparent ||
      event.declined ||
      event.informational
    ) {
      continue;
    }
    out.push({
      startAt: event.startAt,
      endAt: event.endAt,
      externalId: event.eventId,
    });
  }
  for (const link of links) {
    if (
      link.state === "external_modified" &&
      link.externalStartAt &&
      link.externalEndAt
    ) {
      out.push({
        startAt: link.externalStartAt,
        endAt: link.externalEndAt,
        externalId: link.eventId ?? undefined,
      });
    }
  }
  return out;
}
