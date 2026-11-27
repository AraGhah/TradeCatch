import { isE2eHarness } from "@/lib/config";
import type { GoogleTokens } from "../google";
import type { GoogleErrorKind } from "./types";

/**
 * The only code that talks to Google Calendar. It never throws for an answer
 * Google gave: every call returns `{ ok: true, ... }` or `{ ok: false, kind }`,
 * so the sync engine decides what to retry, what to show the owner and what to
 * give up on. It never keeps Google's error text (which can echo event data):
 * only a short code.
 */

export type GoogleUrls = {
  auth: string;
  token: string;
  revoke: string;
  /** Calendar API root, e.g. https://www.googleapis.com/calendar/v3 */
  api: string;
};

const PRODUCTION_URLS: GoogleUrls = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://www.googleapis.com/calendar/v3",
};

/**
 * Google's endpoints. Only the local test harness (never a production runtime)
 * may point them at a fake Google: `isE2eHarness` refuses anything but a
 * localhost site with TRADECATCH_E2E=1, so a stray variable cannot redirect a
 * real business's tokens to another host.
 */
export function googleUrls(
  env: Record<string, string | undefined> = process.env,
): GoogleUrls {
  const base = isE2eHarness(env)
    ? env.GCAL_TEST_GOOGLE_BASE?.trim().replace(/\/$/, "")
    : "";
  if (!base) return PRODUCTION_URLS;
  return {
    auth: `${base}/o/oauth2/v2/auth`,
    token: `${base}/token`,
    revoke: `${base}/revoke`,
    api: `${base}/calendar/v3`,
  };
}

export type CallFailure = {
  ok: false;
  kind: GoogleErrorKind;
  status: number;
  /** Google's own reason code (`rateLimitExceeded`), never free text. */
  reason?: string;
  retryAfterMs?: number;
};
export type CallResult<T> = ({ ok: true } & T) | CallFailure;

/** What the owner is told. Short, stable, free of Google's wording. */
export function describeFailure(failure: CallFailure): string {
  switch (failure.kind) {
    case "auth_revoked":
    case "auth":
      return "google_access_revoked";
    case "rate_limited":
      return "google_rate_limited";
    case "transient":
      return "google_unavailable";
    case "not_found":
    case "gone":
      return "google_event_missing";
    case "conflict":
      return "google_conflict";
    default:
      return failure.status === 403
        ? "google_permission_denied"
        : "google_rejected_request";
  }
}

const RATE_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
  "calendarUsageLimitsExceeded",
]);

function reasonOf(body: unknown): string | undefined {
  const error = (body as { error?: unknown })?.error;
  if (typeof error === "string") return error.slice(0, 80);
  const first = (error as { errors?: { reason?: unknown }[] } | undefined)
    ?.errors?.[0]?.reason;
  return typeof first === "string" ? first.slice(0, 80) : undefined;
}

function retryAfterMs(headers: Headers, now: number): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds, 3600)) * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.min(at - now, 3_600_000));
}

export function classifyStatus(
  status: number,
  body: unknown,
  headers: Headers,
  now = Date.now(),
): CallFailure {
  const reason = reasonOf(body);
  const base = { ok: false as const, status, reason, retryAfterMs: retryAfterMs(headers, now) };
  if (status === 401) return { ...base, kind: "auth" };
  if (status === 429 || (status === 403 && reason && RATE_REASONS.has(reason)))
    return { ...base, kind: "rate_limited" };
  if (status === 404) return { ...base, kind: "not_found" };
  if (status === 409) return { ...base, kind: "conflict" };
  if (status === 410) return { ...base, kind: "gone" };
  if (status >= 500 || status === 408) return { ...base, kind: "transient" };
  return { ...base, kind: "permanent" };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

export type TokenResult =
  | { ok: true; tokens: GoogleTokens }
  | CallFailure;

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Exchanges a code or a refresh token. `invalid_grant` is how Google says the
 * owner revoked access, the password changed, or the refresh token expired:
 * that one needs the owner to reconnect. Everything else that fails (a network
 * error, a 5xx) is Google being unreachable and must NOT be reported as a
 * revoked connection.
 */
export async function requestTokens(
  params: Record<string, string>,
  options: {
    fetchImpl?: typeof fetch;
    urls?: GoogleUrls;
    previous?: GoogleTokens;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<TokenResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const urls = options.urls ?? googleUrls();
  const now = options.now ?? Date.now;
  let response: Response;
  try {
    response = await doFetch(urls.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
  } catch {
    return { ok: false, kind: "transient", status: 0 };
  }
  const json = (await readJson(response)) as TokenResponse;
  if (!response.ok || !json.access_token) {
    if (json.error === "invalid_grant")
      return { ok: false, kind: "auth_revoked", status: response.status, reason: "invalid_grant" };
    const failure = classifyStatus(response.status, json, response.headers, now());
    // A 400/401 from the token endpoint that is not invalid_grant means our own
    // client credentials are wrong: retrying never helps, and the owner cannot fix it.
    return { ...failure, kind: failure.kind === "auth" ? "permanent" : failure.kind };
  }
  return {
    ok: true,
    tokens: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || options.previous?.refreshToken || "",
      expiresAt: new Date(now() + (json.expires_in ?? 3600) * 1000).toISOString(),
      email: options.previous?.email,
      scope: json.scope ?? options.previous?.scope,
    },
  };
}

export function clientCredentials(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? "",
    client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "",
  };
}

// ---------------------------------------------------------------------------
// The calendar client
// ---------------------------------------------------------------------------

export type CalendarListEntry = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

export type RawEventPage = {
  items: unknown[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type GoogleClient = ReturnType<typeof createGoogleClient>;

export function createGoogleClient(options: {
  tokens: GoogleTokens;
  /** Called whenever the access token changed, to be sealed and stored. */
  onTokens?: (tokens: GoogleTokens) => Promise<void>;
  fetchImpl?: typeof fetch;
  urls?: GoogleUrls;
  timeoutMs?: number;
  now?: () => number;
}) {
  const doFetch = options.fetchImpl ?? fetch;
  const urls = options.urls ?? googleUrls();
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8000;
  let tokens = options.tokens;
  const stats = { calls: 0 };

  async function refresh(): Promise<CallFailure | null> {
    if (!tokens.refreshToken)
      return { ok: false, kind: "auth_revoked", status: 401, reason: "no_refresh_token" };
    const result = await requestTokens(
      {
        ...clientCredentials(),
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      },
      { fetchImpl: doFetch, urls, previous: tokens, timeoutMs, now },
    );
    if (!result.ok) return result;
    tokens = result.tokens;
    await options.onTokens?.(tokens);
    return null;
  }

  async function call(
    method: string,
    path: string,
    init: { query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<CallResult<{ body: Record<string, unknown>; headers: Headers }>> {
    if (Date.parse(tokens.expiresAt) < now() + 30_000) {
      const failure = await refresh();
      if (failure) return failure;
    }
    const url = new URL(`${urls.api}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      stats.calls += 1;
      let response: Response;
      try {
        response = await doFetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "Content-Type": "application/json",
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, kind: "transient", status: 0 };
      }
      const body = (await readJson(response)) as Record<string, unknown>;
      if (response.ok) return { ok: true, body, headers: response.headers };
      const failure = classifyStatus(response.status, body, response.headers, now());
      // An access token Google refuses is refreshed once and the call repeated.
      if (failure.kind === "auth" && attempt === 0) {
        const refreshed = await refresh();
        if (refreshed) return refreshed;
        continue;
      }
      if (failure.kind === "auth")
        return { ...failure, kind: "auth_revoked", reason: failure.reason ?? "unauthorized" };
      return failure;
    }
    return { ok: false, kind: "transient", status: 0 };
  }

  const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;

  return {
    get calls() {
      return stats.calls;
    },
    get tokens() {
      return tokens;
    },

    /** Calendars the owner can write to, and the account's own address (the primary calendar's id). */
    async listCalendars(): Promise<
      CallResult<{ calendars: CalendarListEntry[]; accountEmail?: string }>
    > {
      const result = await call("GET", "/users/me/calendarList", {
        query: {
          minAccessRole: "writer",
          fields: "items(id,summary,primary,accessRole)",
          maxResults: "250",
        },
      });
      if (!result.ok) return result;
      const items = (result.body.items ?? []) as {
        id?: string;
        summary?: string;
        primary?: boolean;
        accessRole?: string;
      }[];
      const calendars = items
        .filter(
          (item) =>
            typeof item.id === "string" &&
            (item.accessRole === "owner" || item.accessRole === "writer"),
        )
        .map((item) => ({
          id: item.id as string,
          summary: (item.summary || item.id) as string,
          primary: Boolean(item.primary),
          accessRole: item.accessRole as string,
        }));
      // The primary calendar's id IS the account's email address, so the owner
      // can be shown which account is connected without asking for the
      // separate (broader) email scope.
      const primary = calendars.find((entry) => entry.primary);
      return {
        ok: true,
        calendars,
        accountEmail: primary && primary.id.includes("@") ? primary.id : undefined,
      };
    },

    async listEvents(input: {
      calendarId: string;
      syncToken?: string;
      pageToken?: string;
      timeMin?: string;
      timeMax?: string;
      fields: string;
    }): Promise<CallResult<{ page: RawEventPage }>> {
      const query: Record<string, string | undefined> = {
        singleEvents: "true",
        showDeleted: "true",
        maxResults: "250",
        fields: input.fields,
        pageToken: input.pageToken,
      };
      // Google refuses timeMin/timeMax together with a sync token.
      if (input.syncToken) query.syncToken = input.syncToken;
      else {
        query.timeMin = input.timeMin;
        query.timeMax = input.timeMax;
      }
      const result = await call("GET", `${cal(input.calendarId)}/events`, { query });
      if (!result.ok) return result;
      return {
        ok: true,
        page: {
          items: Array.isArray(result.body.items) ? result.body.items : [],
          nextPageToken:
            typeof result.body.nextPageToken === "string" ? result.body.nextPageToken : undefined,
          nextSyncToken:
            typeof result.body.nextSyncToken === "string" ? result.body.nextSyncToken : undefined,
        },
      };
    },

    async getEvent(calendarId: string, eventId: string) {
      const result = await call("GET", `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`);
      return result.ok ? { ok: true as const, event: result.body } : result;
    },

    async insertEvent(calendarId: string, body: Record<string, unknown>) {
      const result = await call("POST", `${cal(calendarId)}/events`, {
        query: { sendUpdates: "none" },
        body,
      });
      return result.ok ? { ok: true as const, event: result.body } : result;
    },

    async patchEvent(calendarId: string, eventId: string, body: Record<string, unknown>) {
      const result = await call(
        "PATCH",
        `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { query: { sendUpdates: "none" }, body },
      );
      return result.ok ? { ok: true as const, event: result.body } : result;
    },

    async deleteEvent(calendarId: string, eventId: string) {
      const result = await call(
        "DELETE",
        `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { query: { sendUpdates: "none" } },
      );
      return result.ok ? { ok: true as const } : result;
    },

    /** Registers a push channel. Google answers with the resource id and when it expires. */
    async watch(
      calendarId: string,
      channel: { id: string; token: string; address: string; ttlSeconds: number },
    ) {
      const result = await call("POST", `${cal(calendarId)}/events/watch`, {
        body: {
          id: channel.id,
          type: "web_hook",
          address: channel.address,
          token: channel.token,
          params: { ttl: String(channel.ttlSeconds) },
        },
      });
      if (!result.ok) return result;
      const expiration = Number(result.body.expiration);
      return {
        ok: true as const,
        resourceId: typeof result.body.resourceId === "string" ? result.body.resourceId : undefined,
        expiresAt: Number.isFinite(expiration) ? new Date(expiration).toISOString() : undefined,
      };
    },

    async stopChannel(channel: { id: string; resourceId?: string }) {
      // Channels live under /channels/stop, not under a calendar.
      const result = await call("POST", "/channels/stop", {
        body: { id: channel.id, resourceId: channel.resourceId },
      });
      return result.ok ? { ok: true as const } : result;
    },

    /**
     * Revokes the grant. The refresh token is revoked in preference to the
     * access token: revoking either ends the grant, and the refresh token is
     * the long-lived one.
     */
    async revoke(): Promise<boolean> {
      const token = tokens.refreshToken || tokens.accessToken;
      if (!token) return false;
      try {
        const response = await doFetch(urls.revoke, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
