import { decryptSecret, encryptSecret, signState, verifyState } from "./crypto";
import type { CalendarPort } from "./service";
import type { BusyBlock, ScheduleAppointment } from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email?: string;
};

export function googleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(),
  );
}

function redirectUri() {
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim()) {
    return process.env.GOOGLE_CALENDAR_REDIRECT_URI.trim();
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  return `${site.replace(/\/$/, "")}/api/calendar/oauth/callback`;
}

function secret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("AUTH_SECRET is required to protect calendar tokens.");
  return value;
}

export function buildGoogleAuthUrl(organizationId: string) {
  const state = signState(
    JSON.stringify({ organizationId, exp: Date.now() + 10 * 60_000, nonce: crypto.randomUUID() }),
    secret(),
  );
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!.trim(),
    redirect_uri: redirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    scope: SCOPES,
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state };
}

export function readOAuthState(state: string): { organizationId: string } | null {
  const raw = verifyState(state, secret());
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { organizationId?: string; exp?: number };
  if (!parsed.organizationId || !parsed.exp || parsed.exp < Date.now()) return null;
  return { organizationId: parsed.organizationId };
}

export function sealTokens(tokens: GoogleTokens) {
  return encryptSecret(JSON.stringify(tokens), secret());
}

export function openTokens(ciphertext: string): GoogleTokens {
  return JSON.parse(decryptSecret(ciphertext, secret())) as GoogleTokens;
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error || "Google token exchange failed");
  }
  return json;
}

export async function exchangeGoogleCode(code: string, previousRefresh?: string): Promise<GoogleTokens> {
  const json = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!.trim(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  );
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token || previousRefresh || "",
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function refreshGoogleTokens(tokens: GoogleTokens): Promise<GoogleTokens> {
  const json = await tokenRequest(
    new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!.trim(),
      grant_type: "refresh_token",
    }),
  );
  return {
    ...tokens,
    accessToken: json.access_token!,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

async function googleFetch(accessToken: string, url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { response, json };
}

export function createGoogleCalendarPort(input: {
  tokens: GoogleTokens;
  calendarId: string;
  onTokens?: (tokens: GoogleTokens) => Promise<void>;
}): CalendarPort {
  const calls = { externalCalls: 0 };
  let tokens = input.tokens;

  async function authed(url: string, init?: RequestInit) {
    if (Date.parse(tokens.expiresAt) < Date.now() + 30_000) {
      tokens = await refreshGoogleTokens(tokens);
      await input.onTokens?.(tokens);
    }
    calls.externalCalls += 1;
    const result = await googleFetch(tokens.accessToken, url, init);
    if (result.response.status === 401 && tokens.refreshToken) {
      tokens = await refreshGoogleTokens(tokens);
      await input.onTokens?.(tokens);
      calls.externalCalls += 1;
      return googleFetch(tokens.accessToken, url, init);
    }
    return result;
  }

  const calendarId = encodeURIComponent(input.calendarId || "primary");
  return {
    kind: "google",
    connected: true,
    get externalCalls() {
      return calls.externalCalls;
    },
    async freeBusy(fromIso, untilIso) {
      const { response, json } = await authed("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        body: JSON.stringify({
          timeMin: fromIso,
          timeMax: untilIso,
          items: [{ id: input.calendarId || "primary" }],
        }),
      });
      if (!response.ok) return [];
      const calendars = (json.calendars ?? {}) as Record<string, { busy?: { start: string; end: string }[] }>;
      const busy = Object.values(calendars)[0]?.busy ?? [];
      return busy.map((block) => ({ startAt: block.start, endAt: block.end })) satisfies BusyBlock[];
    },
    async createEvent(appointment: ScheduleAppointment) {
      const { response, json } = await authed(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: "POST",
          body: JSON.stringify({
            summary: `${appointment.serviceName} — ${appointment.customerName ?? "Customer"}`,
            description: appointment.serviceAddress ?? "",
            start: { dateTime: appointment.startAt, timeZone: appointment.timezone },
            end: { dateTime: appointment.endAt, timeZone: appointment.timezone },
          }),
        },
      );
      if (!response.ok || typeof json.id !== "string") {
        return { error: "calendar_error" };
      }
      return { id: json.id };
    },
    async updateEvent(eventId, appointment) {
      const { response } = await authed(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            start: { dateTime: appointment.startAt, timeZone: appointment.timezone },
            end: { dateTime: appointment.endAt, timeZone: appointment.timezone },
          }),
        },
      );
      return response.ok ? { ok: true as const } : { error: "calendar_error" };
    },
    async deleteEvent(eventId) {
      const { response } = await authed(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      );
      return response.ok || response.status === 404 ? { ok: true as const } : { error: "calendar_error" };
    },
  };
}

export async function listGoogleCalendars(tokens: GoogleTokens) {
  const { response, json } = await googleFetch(
    tokens.accessToken,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
  );
  if (!response.ok) return [];
  const items = (json.items ?? []) as { id: string; summary?: string; accessRole?: string }[];
  return items
    .filter((item) => item.accessRole === "owner" || item.accessRole === "writer")
    .map((item) => ({ id: item.id, summary: item.summary || item.id }));
}

export async function revokeGoogleToken(accessToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
  }).catch(() => undefined);
}
