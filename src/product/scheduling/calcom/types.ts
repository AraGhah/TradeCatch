/** What TradeCatch stores about one business's Cal.com account. */

export type CalcomEventTypeMapping = {
  /** The TradeCatch service this Cal.com event type books. Omit for the default (a plain service call). */
  serviceId?: string;
  /** Cal.com event type id. One per specialist calendar. */
  eventTypeId: number;
  /** The TradeCatch technician (specialist) whose Cal.com calendar this is. */
  technicianId?: string;
  /** Used when Cal.com needs a length the event type does not fix. */
  lengthInMinutes?: number;
  /** The event type has the "attendee address" location enabled: send the service address as the location. */
  addressAsLocation?: boolean;
};

export type CalcomConnectionStatus = "connected" | "error" | "disconnected";

export type StoredCalcomConnection = {
  organizationId: string;
  status: CalcomConnectionStatus;
  /** The API key, sealed with AUTH_SECRET (credentials.ts). Never leaves the server. */
  credentialCiphertext?: string;
  /** Display only, e.g. the Cal.com username. */
  accountLabel?: string;
  eventTypes: CalcomEventTypeMapping[];
  /**
   * Cal.com may require an attendee e-mail the caller never gave. Bookings made
   * by phone then use this address (the business's own) instead of a made-up one.
   */
  fallbackAttendeeEmail?: string;
  /** Language of the confirmation e-mails Cal.com sends the attendee. */
  language: "fr" | "en";
  lastError?: string;
  updatedAt: string;
};

/** The connection as the dashboard may see it: never the credential. */
export type CalcomConnectionPublic = Omit<
  StoredCalcomConnection,
  "credentialCiphertext"
> & { hasCredential: boolean };

export function toPublicConnection(
  row: StoredCalcomConnection,
): CalcomConnectionPublic {
  const { credentialCiphertext, ...rest } = row;
  return { ...rest, hasCredential: Boolean(credentialCiphertext) };
}
