/**
 * Shapes shared by the Google Calendar synchronization modules.
 *
 * Direction of authority (the conflict rule, in one place):
 *  - A TradeCatch appointment is never changed, moved or cancelled because of
 *    something that happened in Google. A Google change to an event TradeCatch
 *    wrote is recorded on its link and shown to the owner; the appointment
 *    stays exactly as it was.
 *  - Every other event in the chosen calendar is only ever READ: it blocks
 *    times in TradeCatch, nothing else.
 *  - TradeCatch writes to Google only because an appointment changed in
 *    TradeCatch. A change that came FROM Google never causes a write back, so
 *    the two systems cannot ping-pong.
 */

/** How much of the customer ends up in the owner's Google event. */
export type EventDetail = "minimal" | "standard";

/** What happens to the Google event when its appointment is canceled. */
export type CancelPolicy = "remove" | "mark_canceled";

export const EVENT_DETAILS: readonly EventDetail[] = ["minimal", "standard"];
export const CANCEL_POLICIES: readonly CancelPolicy[] = ["remove", "mark_canceled"];

export type GoogleErrorKind =
  /** The refresh token was revoked or expired: only the owner can fix it. */
  | "auth_revoked"
  /** The access token was refused: refresh it and try once more. */
  | "auth"
  | "rate_limited"
  /** Network, timeout or a 5xx: worth trying again later. */
  | "transient"
  | "not_found"
  /** 410: a stale sync token, or an event that is already gone. */
  | "gone"
  /** 409: the event id already exists. */
  | "conflict"
  /** Anything retrying cannot fix (bad request, no permission on this calendar). */
  | "permanent";

/** What TradeCatch still has to do for one appointment's Google event. */
export type EventLinkOp = "create" | "update" | "delete";

export type EventLinkState =
  /** Google matches TradeCatch. */
  | "synced"
  /** A change is waiting to be sent (or is being retried). */
  | "pending"
  /** Retries ran out. Visible to the owner; never retried silently forever. */
  | "failed"
  /** The owner moved or edited the Google event. The appointment is kept as is. */
  | "external_modified"
  /** The owner deleted the Google event. The appointment is kept as is. */
  | "external_deleted"
  /** The calendar was disconnected. The appointment is untouched. */
  | "detached";

/** The stable mapping between one TradeCatch appointment and its Google event. */
export type EventLink = {
  organizationId: string;
  appointmentId: string;
  calendarId: string;
  /** Null until the event has been created. */
  eventId: string | null;
  /** Bumped when an event has to be created again (Google never reuses a deleted id). */
  generation: number;
  state: EventLinkState;
  pendingOp: EventLinkOp | null;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  lastSyncedAt?: string;
  /** The etag Google gave us when we last wrote the event: how we recognise our own echo. */
  remoteEtag?: string;
  /** The times TradeCatch last wrote. */
  syncedStartAt?: string;
  syncedEndAt?: string;
  /** Where the owner moved the event to (only with `external_modified`). */
  externalStartAt?: string;
  externalEndAt?: string;
  updatedAt: string;
};

/** The mirror of one Google event: just enough to block time. Never a title or a guest. */
export type ExternalEvent = {
  eventId: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  /** Free time ("show as available"). Does not block. */
  transparent: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  /** The owner declined this invitation. Does not block. */
  declined: boolean;
  /** Working-location and similar markers that are not appointments. Does not block. */
  informational: boolean;
  etag?: string;
  /** Set only on events TradeCatch itself wrote (our marker). */
  appointmentId?: string;
};

export type SyncState = {
  organizationId: string;
  /** The calendar the token, the mirror and the channel belong to. */
  calendarId?: string;
  syncToken?: string;
  /** The hash of the secret Google sends back with every push. */
  channelTokenHash?: string;
  channelId?: string;
  resourceId?: string;
  channelExpiresAt?: string;
  /** Highest push message number seen: a repeated or older push is ignored. */
  lastMessageNumber?: number;
  lastSyncedAt?: string;
  lastFullSyncAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  nextAttemptAt?: string;
  /** One sync at a time per business, across Worker instances. */
  leaseUntil?: string;
};

/** What the owner sees about synchronization. No tokens, no event content. */
export type SyncSummary = {
  lastSuccessfulSyncAt?: string;
  lastError?: string;
  pending: number;
  failed: number;
  /** Appointments whose Google event was moved or deleted by the owner. */
  needsAttention: {
    appointmentId: string;
    state: "external_modified" | "external_deleted";
    startAt?: string;
  }[];
  /** Confirmed appointments that overlap something else in the calendar. */
  overlaps: { appointmentId: string; startAt: string }[];
  push: "active" | "unavailable" | "expiring" | "off";
};
