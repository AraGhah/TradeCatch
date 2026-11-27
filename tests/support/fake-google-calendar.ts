/**
 * A small but faithful stand-in for the parts of Google that Calendar
 * synchronization talks to: the OAuth consent/token/revoke endpoints and the
 * Calendar v3 REST API (calendarList, events list with sync tokens and paging,
 * insert/get/patch/delete, watch channels). It is used in-process by the unit
 * tests (as a `fetch`) and over real HTTP by Playwright, so both exercise the
 * same behaviour: 409 for a duplicate event id, 410 for a stale sync token or a
 * deleted event, revoked grants, expired access tokens, rate limits, outages.
 *
 * It also plays the OWNER: tests call `ownerAdds`, `ownerMoves`, `ownerDeletes`
 * to do what a person does in Google Calendar, outside TradeCatch.
 */

export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const REQUIRED_GRANT = `${CALENDAR_EVENTS_SCOPE} ${CALENDAR_LIST_SCOPE}`;

type EventTime = { dateTime?: string; date?: string; timeZone?: string };

export type FakeEvent = {
  id: string;
  /** Private to the owner: TradeCatch must never read or store it. */
  summary?: string;
  description?: string;
  status: "confirmed" | "tentative" | "cancelled";
  start: EventTime;
  end: EventTime;
  transparency?: "opaque" | "transparent";
  eventType?: string;
  attendees?: { email?: string; self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
  etag: string;
  /** The calendar's change counter when this event last changed. */
  version: number;
};

class FakeCalendar {
  readonly events = new Map<string, FakeEvent>();
  version = 1;
  constructor(
    readonly id: string,
    readonly summary: string,
    readonly primary: boolean,
    readonly accessRole: "owner" | "writer" | "reader" | "freeBusyReader",
  ) {}
}

class FakeAccount {
  readonly calendars = new Map<string, FakeCalendar>();
  constructor(readonly email: string) {
    this.calendars.set(email, new FakeCalendar(email, email, true, "owner"));
  }
}

export type Channel = {
  id: string;
  token: string;
  address: string;
  resourceId: string;
  calendarId: string;
  email: string;
  expiration: number;
};

export type CalendarCall = { method: string; path: string; query: string; email?: string };

export class FakeGoogleCalendar {
  readonly accounts = new Map<string, FakeAccount>();
  readonly calls: CalendarCall[] = [];
  readonly revokedTokens: string[] = [];
  readonly channels = new Map<string, Channel>();
  readonly stoppedChannels: string[] = [];
  /** Access token -> account email. */
  private valid = new Map<string, { email: string; grant: string }>();
  /**
   * Google revokes one grant (one authorization of TradeCatch by an account),
   * not the account: two businesses that both connected the same Google account
   * hold independent grants, so refusing or removing one leaves the other alone.
   */
  private revokedGrants = new Set<string>();
  private grantsByEmail = new Map<string, Set<string>>();
  private grantCounter = 0;
  private counter = 0;
  private failures: {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
    method?: string;
  }[] = [];
  /** The fake's clock (channel expiry). Tests that move time point this at their own clock. */
  now: () => number = () => Date.now();
  private etagCounter = 0;
  /** While true every Calendar API call answers 503. The OAuth endpoints stay up. */
  down = false;
  /** Every Calendar API answer takes this long, so tests can make two workers overlap. */
  latencyMs = 0;

  /** What the next visit to the consent screen does. */
  consent: { mode: "allow" | "deny"; email: string } = { mode: "allow", email: "" };
  readonly authRequests: { params: URLSearchParams }[] = [];
  /** The scopes the consent screen "grants" (null: whatever was requested). */
  grantScope: string | null = null;
  grantRefreshToken = true;
  /** Smallest page the events list returns, to force paging. */
  pageSize: number | null = null;

  account(email: string): FakeAccount {
    let account = this.accounts.get(email);
    if (!account) {
      account = new FakeAccount(email);
      this.accounts.set(email, account);
    }
    return account;
  }

  calendar(email: string, calendarId = email): FakeCalendar {
    const found = this.account(email).calendars.get(calendarId);
    if (!found) throw new Error(`no calendar ${calendarId}`);
    return found;
  }

  addCalendar(email: string, id: string, summary: string, accessRole: "owner" | "writer" | "reader" = "owner") {
    this.account(email).calendars.set(id, new FakeCalendar(id, summary, false, accessRole));
  }

  codeFor(email: string) {
    this.account(email);
    return `code:${email}`;
  }

  /** Make every issued access token stop working (what an hour passing does). */
  expireAccessTokens() {
    this.valid.clear();
  }

  /** The owner removes TradeCatch in their Google account settings. */
  ownerRevokesAccess(email: string) {
    for (const grant of this.grantsByEmail.get(email) ?? []) this.revokeGrant(grant);
  }

  private revokeGrant(grant: string) {
    this.revokedGrants.add(grant);
    for (const [token, entry] of this.valid) {
      if (entry.grant === grant) this.valid.delete(token);
    }
  }

  private newGrant(email: string) {
    this.grantCounter += 1;
    const grant = `g${this.grantCounter}`;
    const set = this.grantsByEmail.get(email) ?? new Set<string>();
    set.add(grant);
    this.grantsByEmail.set(email, set);
    return grant;
  }

  /** The grant a refresh token or an access token belongs to. */
  private grantOf(token: string): string | undefined {
    const refresh = /^rt:.+#(g\d+)$/.exec(token);
    if (refresh) return refresh[1];
    return this.valid.get(token)?.grant;
  }

  /**
   * The next Calendar API call (or the next one using `method`) answers with
   * this error. Name the method to aim at a write rather than the read that
   * usually comes first.
   */
  failNext(
    status: number,
    body: unknown = {},
    headers: Record<string, string> = {},
    times = 1,
    method?: string,
  ) {
    for (let i = 0; i < times; i += 1) this.failures.push({ status, body, headers, method });
  }

  private takeFailure(method: string) {
    const index = this.failures.findIndex((f) => !f.method || f.method === method);
    return index < 0 ? undefined : this.failures.splice(index, 1)[0];
  }

  count(match: string): number {
    return this.calls.filter((call) => `${call.method} ${call.path}`.includes(match)).length;
  }

  clearCalls() {
    this.calls.length = 0;
  }

  /** A `fetch` that talks to this fake: what the unit tests hand the client. */
  readonly fetch: typeof fetch = (input, init) =>
    this.handle(new Request(input as RequestInfo, init));

  // ------------------------------------------------------------------ owner actions

  private nextEtag() {
    this.etagCounter += 1;
    return `"e${this.etagCounter}"`;
  }

  /** The owner adds an event in Google Calendar. Returns its id. */
  ownerAdds(
    email: string,
    event: {
      id?: string;
      summary?: string;
      start: string | { date: string };
      end: string | { date: string };
      transparency?: "opaque" | "transparent";
      status?: "confirmed" | "tentative";
      eventType?: string;
      declined?: boolean;
      calendarId?: string;
      private?: Record<string, string>;
    },
  ): string {
    const calendar = this.calendar(email, event.calendarId ?? email);
    calendar.version += 1;
    const id = event.id ?? `own${(this.counter += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const time = (value: string | { date: string }): EventTime =>
      typeof value === "string" ? { dateTime: value } : { date: value.date };
    calendar.events.set(id, {
      id,
      summary: event.summary ?? "Private appointment",
      description: "Private notes the owner would not want shared",
      status: event.status ?? "confirmed",
      start: time(event.start),
      end: time(event.end),
      transparency: event.transparency,
      eventType: event.eventType,
      attendees: event.declined
        ? [{ email: "owner@private.example", self: true, responseStatus: "declined" }]
        : [{ email: "guest@private.example", responseStatus: "accepted" }],
      extendedProperties: event.private ? { private: event.private } : undefined,
      etag: this.nextEtag(),
      version: calendar.version,
    });
    return id;
  }

  /** The owner drags an event to a new time. */
  ownerMoves(email: string, eventId: string, start: string, end: string, calendarId = email) {
    const calendar = this.calendar(email, calendarId);
    const event = calendar.events.get(eventId);
    if (!event) throw new Error(`no event ${eventId}`);
    calendar.version += 1;
    event.start = { dateTime: start };
    event.end = { dateTime: end };
    event.etag = this.nextEtag();
    event.version = calendar.version;
  }

  /** The owner edits only the title (no time change). */
  ownerRetitles(email: string, eventId: string, summary: string, calendarId = email) {
    const calendar = this.calendar(email, calendarId);
    const event = calendar.events.get(eventId);
    if (!event) throw new Error(`no event ${eventId}`);
    calendar.version += 1;
    event.summary = summary;
    event.etag = this.nextEtag();
    event.version = calendar.version;
  }

  /** The owner deletes an event. */
  ownerDeletes(email: string, eventId: string, calendarId = email) {
    const calendar = this.calendar(email, calendarId);
    const event = calendar.events.get(eventId);
    if (!event) throw new Error(`no event ${eventId}`);
    calendar.version += 1;
    event.status = "cancelled";
    event.etag = this.nextEtag();
    event.version = calendar.version;
  }

  /** Events whose id was chosen by TradeCatch (the `tc` prefix). */
  tradecatchEvents(email: string, calendarId = email): FakeEvent[] {
    return [...this.calendar(email, calendarId).events.values()].filter((event) => event.id.startsWith("tc"));
  }

  liveEvents(email: string, calendarId = email): FakeEvent[] {
    return [...this.calendar(email, calendarId).events.values()].filter((event) => event.status !== "cancelled");
  }

  /** What Google would push for the newest channel (id and secret token). */
  latestChannel(): Channel | undefined {
    return [...this.channels.values()].at(-1);
  }

  // ------------------------------------------------------------------ plumbing

  private issue(email: string, grant: string) {
    this.counter += 1;
    const token = `at:${email}:${this.counter}`;
    this.valid.set(token, { email, grant });
    return token;
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  private apiError(status: number, reason: string, headers?: Record<string, string>) {
    return this.json(
      status,
      { error: { code: status, message: "private detail that must never be stored", errors: [{ reason }] } },
      headers,
    );
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const record: CalendarCall = { method: request.method, path, query: url.search };
    this.calls.push(record);

    if (path === "/o/oauth2/v2/auth" && request.method === "GET") return this.consentScreen(url);
    if (path === "/token" && request.method === "POST") return this.token(await request.text());
    if (path === "/revoke" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const token = form.get("token") || "";
      this.revokedTokens.push(token);
      const grant = this.grantOf(token);
      if (grant) this.revokeGrant(grant);
      return this.json(200, {});
    }

    const prefix = "/calendar/v3";
    if (!path.startsWith(prefix)) return this.json(404, { error: "not found" });
    const auth = request.headers.get("authorization") || "";
    const entry = this.valid.get(auth.replace(/^Bearer /, ""));
    const email = entry && !this.revokedGrants.has(entry.grant) ? entry.email : undefined;
    record.email = email;
    if (!email) return this.apiError(401, "authError");
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (this.down) return this.json(503, { error: { code: 503, message: "backend error" } });
    const failure = this.takeFailure(request.method);
    if (failure) return this.json(failure.status, failure.body, failure.headers);

    const route = path.slice(prefix.length);
    if (route === "/users/me/calendarList") return this.calendarList(email, url);
    if (route === "/channels/stop" && request.method === "POST") {
      const body = (await request.json()) as { id?: string };
      if (body.id) {
        this.channels.delete(body.id);
        this.stoppedChannels.push(body.id);
      }
      return new Response(null, { status: 204 });
    }
    const match = /^\/calendars\/([^/]+)\/events(?:\/([^/]+|watch))?$/.exec(route);
    if (!match) return this.json(404, { error: "unknown route" });
    const calendarId = decodeURIComponent(match[1]!);
    const account = this.account(email);
    const calendar = account.calendars.get(calendarId);
    if (!calendar) return this.apiError(404, "notFound");
    if (calendar.accessRole === "reader" || calendar.accessRole === "freeBusyReader") {
      if (request.method !== "GET") return this.apiError(403, "forbiddenForNonOrganizer");
    }
    const tail = match[2];
    if (!tail && request.method === "GET") return this.list(calendar, url);
    if (!tail && request.method === "POST") return this.insert(calendar, await request.json());
    if (tail === "watch" && request.method === "POST") {
      return this.watch(email, calendar, (await request.json()) as Record<string, unknown>);
    }
    const eventId = decodeURIComponent(tail!);
    if (request.method === "GET") return this.getOne(calendar, eventId);
    if (request.method === "PATCH") return this.patch(calendar, eventId, await request.json());
    if (request.method === "DELETE") return this.remove(calendar, eventId);
    return this.json(405, { error: "method" });
  }

  // ------------------------------------------------------------------ OAuth

  private consentScreen(url: URL): Response {
    this.authRequests.push({ params: url.searchParams });
    const redirect = url.searchParams.get("redirect_uri") || "";
    const state = url.searchParams.get("state") || "";
    const target = new URL(redirect);
    if (this.consent.mode === "deny") {
      target.searchParams.set("error", "access_denied");
    } else {
      target.searchParams.set("code", this.codeFor(this.consent.email));
    }
    target.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { Location: target.toString() } });
  }

  private token(body: string): Response {
    const form = new URLSearchParams(body);
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const code = form.get("code") || "";
      const email = code.replace(/^code:/, "");
      if (!code.startsWith("code:") || !this.accounts.has(email)) {
        return this.json(400, { error: "invalid_grant" });
      }
      const grantId = this.newGrant(email);
      return this.json(200, {
        access_token: this.issue(email, grantId),
        ...(this.grantRefreshToken ? { refresh_token: `rt:${email}#${grantId}` } : {}),
        expires_in: 3600,
        scope: this.grantScope ?? REQUIRED_GRANT,
        token_type: "Bearer",
      });
    }
    if (grant === "refresh_token") {
      const refresh = form.get("refresh_token") || "";
      const parsed = /^rt:(.+)#(g\d+)$/.exec(refresh);
      if (!parsed || !this.accounts.has(parsed[1]!) || this.revokedGrants.has(parsed[2]!)) {
        return this.json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      }
      if (this.down) return this.json(503, { error: "backend_error" });
      return this.json(200, {
        access_token: this.issue(parsed[1]!, parsed[2]!),
        expires_in: 3600,
        scope: this.grantScope ?? REQUIRED_GRANT,
        token_type: "Bearer",
      });
    }
    return this.json(400, { error: "unsupported_grant_type" });
  }

  // ------------------------------------------------------------------ Calendar

  private calendarList(email: string, url: URL): Response {
    const min = url.searchParams.get("minAccessRole");
    const rank = { freeBusyReader: 0, reader: 1, writer: 2, owner: 3 } as const;
    const items = [...this.account(email).calendars.values()]
      .filter((calendar) => !min || rank[calendar.accessRole] >= rank[min as keyof typeof rank])
      .map((calendar) => ({
        id: calendar.id,
        summary: calendar.summary,
        primary: calendar.primary || undefined,
        accessRole: calendar.accessRole,
      }));
    return this.json(200, { items });
  }

  /** Honours `fields` the way Google does: a field not asked for is not sent. */
  private project(event: FakeEvent, fields: string | null) {
    const base: Record<string, unknown> = {
      id: event.id,
      etag: event.etag,
      status: event.status,
      start: event.start,
      end: event.end,
      transparency: event.transparency,
      eventType: event.eventType,
      extendedProperties: event.extendedProperties,
      attendees: event.attendees,
    };
    if (!fields) {
      base.summary = event.summary;
      base.description = event.description;
      return base;
    }
    const wantsSummary = /(^|[,(])summary([,)]|$)/.test(fields);
    const wantsDescription = /(^|[,(])description([,)]|$)/.test(fields);
    if (wantsSummary) base.summary = event.summary;
    if (wantsDescription) base.description = event.description;
    if (!/attendees\([^)]*email/.test(fields) && event.attendees) {
      base.attendees = event.attendees.map((a) => ({ self: a.self, responseStatus: a.responseStatus }));
    }
    return base;
  }

  private list(calendar: FakeCalendar, url: URL): Response {
    const token = url.searchParams.get("syncToken");
    const pageToken = url.searchParams.get("pageToken");
    const timeMin = url.searchParams.get("timeMin");
    const timeMax = url.searchParams.get("timeMax");
    const showDeleted = url.searchParams.get("showDeleted") === "true";
    const fields = url.searchParams.get("fields");
    let rows = [...calendar.events.values()];
    if (token) {
      const since = /^st-(\d+)$/.exec(token);
      // A token Google no longer knows: the client must start over.
      if (!since || Number(since[1]) > calendar.version || this.staleTokens.has(token)) {
        return this.apiError(410, "fullSyncRequired");
      }
      rows = rows.filter((event) => event.version > Number(since[1]));
    } else {
      rows = rows.filter((event) => showDeleted || event.status !== "cancelled");
      const min = timeMin ? Date.parse(timeMin) : -Infinity;
      const max = timeMax ? Date.parse(timeMax) : Infinity;
      rows = rows.filter((event) => {
        if (event.status === "cancelled") return true;
        const start = Date.parse(event.start.dateTime ?? `${event.start.date}T00:00:00Z`);
        const end = Date.parse(event.end.dateTime ?? `${event.end.date}T00:00:00Z`);
        return end > min && start < max;
      });
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const size = this.pageSize ?? Number(url.searchParams.get("maxResults") || 250);
    const offset = pageToken ? Number(pageToken) : 0;
    const page = rows.slice(offset, offset + size);
    const more = offset + size < rows.length;
    return this.json(200, {
      items: page.map((event) => this.project(event, fields)),
      ...(more ? { nextPageToken: String(offset + size) } : { nextSyncToken: `st-${calendar.version}` }),
    });
  }

  /** Sync tokens the test marks as expired (Google expires them after long idle). */
  readonly staleTokens = new Set<string>();

  private insert(calendar: FakeCalendar, raw: unknown): Response {
    const body = raw as Partial<FakeEvent> & { id?: string };
    if (body.id !== undefined && !/^[a-v0-9]{5,1024}$/.test(body.id)) {
      return this.apiError(400, "invalid");
    }
    const id = body.id ?? `g${(this.counter += 1).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    if (calendar.events.has(id)) return this.apiError(409, "duplicate");
    if (!body.start || !body.end) return this.apiError(400, "required");
    calendar.version += 1;
    const event: FakeEvent = {
      id,
      summary: body.summary,
      description: body.description,
      status: "confirmed",
      start: body.start,
      end: body.end,
      transparency: body.transparency,
      extendedProperties: body.extendedProperties,
      etag: this.nextEtag(),
      version: calendar.version,
    };
    calendar.events.set(id, event);
    return this.json(200, this.project(event, null));
  }

  private getOne(calendar: FakeCalendar, id: string): Response {
    const event = calendar.events.get(id);
    if (!event) return this.apiError(404, "notFound");
    return this.json(200, this.project(event, null));
  }

  private patch(calendar: FakeCalendar, id: string, raw: unknown): Response {
    const event = calendar.events.get(id);
    if (!event) return this.apiError(404, "notFound");
    if (event.status === "cancelled") return this.apiError(410, "deleted");
    const body = raw as Partial<FakeEvent>;
    calendar.version += 1;
    if (body.summary !== undefined) event.summary = body.summary;
    if (body.description !== undefined) event.description = body.description;
    if (body.start) event.start = body.start;
    if (body.end) event.end = body.end;
    if (body.transparency) event.transparency = body.transparency;
    if (body.extendedProperties) event.extendedProperties = body.extendedProperties;
    event.etag = this.nextEtag();
    event.version = calendar.version;
    return this.json(200, this.project(event, null));
  }

  private remove(calendar: FakeCalendar, id: string): Response {
    const event = calendar.events.get(id);
    if (!event) return this.apiError(404, "notFound");
    if (event.status === "cancelled") return this.apiError(410, "deleted");
    calendar.version += 1;
    event.status = "cancelled";
    event.etag = this.nextEtag();
    event.version = calendar.version;
    return new Response(null, { status: 204 });
  }

  private watch(email: string, calendar: FakeCalendar, body: Record<string, unknown>): Response {
    const id = String(body.id ?? "");
    if (!id || !body.address || !body.token) return this.apiError(400, "required");
    const ttl = Number((body.params as { ttl?: string } | undefined)?.ttl ?? 604800);
    const channel: Channel = {
      id,
      token: String(body.token),
      address: String(body.address),
      resourceId: `res-${id.slice(0, 8)}`,
      calendarId: calendar.id,
      email,
      expiration: this.now() + ttl * 1000,
    };
    this.channels.set(id, channel);
    return this.json(200, {
      kind: "api#channel",
      id,
      resourceId: channel.resourceId,
      resourceUri: `https://www.googleapis.com/calendar/v3/calendars/${calendar.id}/events`,
      expiration: String(channel.expiration),
    });
  }
}
