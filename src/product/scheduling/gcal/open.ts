import { openTokens, sealTokens, type GoogleTokens } from "../google";
import type { SchedulingStore, StoredConnection } from "../store";
import { createGoogleClient, type GoogleClient, type GoogleUrls } from "./client";

export type OpenGoogle =
  | { ok: true; client: GoogleClient; connection: StoredConnection; calendarId: string }
  | {
      ok: false;
      /**
       * `not_allowed`: the plan or enrollment does not include Google Calendar.
       * `not_configured`: this server has no Google client credentials.
       * `not_connected`: no usable credential (never connected, disconnected, or
       *   the owner has not picked a calendar yet).
       * `revoked`: Google refused the refresh token. Only the owner can fix it.
       */
      reason: "not_allowed" | "not_configured" | "not_connected" | "revoked";
    };

export type OpenGoogleDeps = {
  store: SchedulingStore;
  /** Plan + operator enrollment. Checked on every use, never cached. */
  allowed: (organizationId: string) => Promise<boolean>;
  configured: () => boolean;
  fetchImpl?: typeof fetch;
  urls?: GoogleUrls;
  now?: () => Date;
};

/**
 * Builds a Google client for one business, or says why it cannot. The
 * credential stays in this module and the client: callers receive neither the
 * ciphertext nor the token text, so nothing downstream can leak them.
 */
export function createOpenGoogle(deps: OpenGoogleDeps) {
  return async function open(
    organizationId: string,
    options: { timeoutMs?: number; selecting?: boolean } = {},
  ): Promise<OpenGoogle> {
    if (!(await deps.allowed(organizationId)))
      return { ok: false, reason: "not_allowed" };
    if (!deps.configured()) return { ok: false, reason: "not_configured" };
    const connection = await deps.store.getConnection(organizationId);
    if (!connection?.tokenCiphertext || connection.status === "disconnected")
      return { ok: false, reason: "not_connected" };
    if (connection.status === "expired") return { ok: false, reason: "revoked" };
    // While the owner is choosing a calendar there is a credential but no
    // calendar yet: listing calendars is allowed, syncing is not.
    if (!options.selecting) {
      if (!connection.calendarId) return { ok: false, reason: "not_connected" };
      // `error` with a reason that is not about the token (a failed sync) still
      // has a good credential: it is allowed to try again and clear itself.
      if (connection.status === "error" && connection.lastError === "select_calendar")
        return { ok: false, reason: "not_connected" };
    }

    let tokens: GoogleTokens;
    try {
      tokens = openTokens(connection.tokenCiphertext);
    } catch {
      // A credential that cannot be opened (the secret changed) is as good as revoked.
      return { ok: false, reason: "revoked" };
    }

    const client = createGoogleClient({
      tokens,
      fetchImpl: deps.fetchImpl,
      urls: deps.urls,
      timeoutMs: options.timeoutMs,
      now: deps.now ? () => deps.now!().getTime() : undefined,
      onTokens: async (next) => {
        // Re-read first: the owner may have changed the settings or
        // disconnected while a call was in flight, and that must win.
        const fresh = await deps.store.getConnection(organizationId);
        if (!fresh || fresh.status === "disconnected") return;
        await deps.store.saveConnection({
          ...fresh,
          tokenCiphertext: sealTokens(next),
          expiresAt: next.expiresAt,
        });
      },
    });
    return { ok: true, client, connection, calendarId: connection.calendarId ?? "" };
  };
}

export type OpenGoogleFn = ReturnType<typeof createOpenGoogle>;
