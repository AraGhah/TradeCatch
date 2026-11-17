/**
 * Cal.com as an optional scheduling provider (API v2).
 *
 * The contractor's own Cal.com account holds the real calendar. TradeCatch
 * keeps its own appointment rows and a small ledger of every booking attempt
 * so that a request which timed out cannot leave a booking nobody knows about.
 */

/** Which Cal.com event type serves a service and/or a specialist. */
export type CalcomRoute = {
  eventTypeId: number;
  /** A TradeCatch service. Omitted: the route is not specific to a service. */
  serviceId?: string;
  /** A TradeCatch technician (specialist calendar). Needs Receptionist Plus. */
  technicianId?: string;
};

export type CalcomConnectionStatus = "connected" | "error" | "disconnected";

export type CalcomConnection = {
  organizationId: string;
  status: CalcomConnectionStatus;
  /** Only API keys are implemented; the field leaves room for OAuth tokens. */
  credentialKind: "api_key";
  /** AES-256-GCM sealed credential. Never returned to a browser or a log. */
  credentialCiphertext?: string;
  accountEmail?: string;
  accountUsername?: string;
  accountTimeZone?: string;
  /** Used when no route matches the service and technician. */
  defaultEventTypeId: number;
  routes: CalcomRoute[];
  /**
   * Cal.com wants a contact for the attendee. A caller on the phone rarely
   * gives an email, so the contractor can set one that receives these.
   */
  attendeeEmail?: string;
  lastError?: string;
  lastVerifiedAt?: string;
  updatedAt: string;
};

/** What the owner sees: everything except the credential. */
export type CalcomConnectionPublic = Omit<
  CalcomConnection,
  "credentialCiphertext" | "credentialKind"
> & { credential: "api_key" | "none" };

/**
 * Lifecycle of one booking attempt.
 *
 * - `creating`: the request was sent and its outcome is not known yet.
 * - `confirmed`: Cal.com answered `accepted`; `providerUid` is set.
 * - `failed`: Cal.com refused it; nothing exists on its side.
 * - `canceled`: we cancelled the Cal.com booking (customer, owner or timeout).
 * - `orphan_canceled`: reconciliation found a booking we never confirmed and
 *   cancelled it.
 * - `unresolved`: could not be settled automatically; an owner must look.
 */
export type CalcomLedgerState =
  | "creating"
  | "confirmed"
  | "failed"
  | "canceled"
  | "orphan_canceled"
  | "unresolved";

export type CalcomBookingRecord = {
  organizationId: string;
  appointmentId: string;
  eventTypeId: number;
  state: CalcomLedgerState;
  providerUid?: string;
  /** The start that was requested, ISO 8601. */
  startAt: string;
  errorCode?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

/** Prefix on `calendarEventId`, so a Cal.com uid is never sent to Google. */
export const CALCOM_EVENT_PREFIX = "calcom:";

export function calcomEventId(uid: string): string {
  return `${CALCOM_EVENT_PREFIX}${uid}`;
}

export function calcomUidFrom(eventId: string | undefined): string | null {
  if (!eventId?.startsWith(CALCOM_EVENT_PREFIX)) return null;
  const uid = eventId.slice(CALCOM_EVENT_PREFIX.length);
  return /^[A-Za-z0-9_-]{4,128}$/.test(uid) ? uid : null;
}

export function isCalcomEventId(eventId: string | undefined): boolean {
  return Boolean(eventId?.startsWith(CALCOM_EVENT_PREFIX));
}
