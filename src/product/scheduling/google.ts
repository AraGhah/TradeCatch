import { decryptSecret, encryptSecret, signState, verifyState } from "./crypto";
import {
  clientCredentials,
  createGoogleClient,
  googleUrls,
  requestTokens,
  type TokenResult,
} from "./gcal/client";

/**
 * Least privilege. TradeCatch reads and writes events in the calendar the owner
 * picks (`calendar.events`) and lists the owner's calendars so they can pick one
 * (`calendar.calendarlist.readonly`). It never asks for the owner's address
 * book, profile, mail, or the broad `calendar` scope, and it no longer asks for
 * `calendar.freebusy` because busy time is read from the events themselves.
 */
export const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

const SCOPES = REQUIRED_SCOPES.join(" ");

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email?: string;
  /** The scopes Google actually granted (the owner can untick some). */
  scope?: string;
};

/** True when every scope TradeCatch needs was granted. */
export function scopesSatisfied(granted: string | undefined): boolean {
  if (!granted) return false;
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.every((scope) => have.has(scope));
}

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
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  return `${site.replace(/\/$/, "")}/api/calendar/oauth/callback`;
}

function secret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value)
    throw new Error("AUTH_SECRET is required to protect calendar tokens.");
  return value;
}

export function buildGoogleAuthUrl(
  organizationId: string,
  userId: string,
  nowMs = Date.now(),
) {
  const state = signState(
    JSON.stringify({
      organizationId,
      userId,
      exp: nowMs + 10 * 60_000,
      nonce: crypto.randomUUID(),
    }),
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
  return {
    url: `${googleUrls().auth}?${params.toString()}`,
    state,
  };
}

export function readOAuthState(
  state: string,
  nowMs = Date.now(),
): { organizationId: string; userId: string } | null {
  const raw = verifyState(state, secret());
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      organizationId?: string;
      userId?: string;
      exp?: number;
    };
    if (
      !parsed.organizationId ||
      !parsed.userId ||
      !parsed.exp ||
      parsed.exp < nowMs
    )
      return null;
    return { organizationId: parsed.organizationId, userId: parsed.userId };
  } catch {
    return null;
  }
}

export function sealTokens(tokens: GoogleTokens) {
  return encryptSecret(JSON.stringify(tokens), secret());
}

export function openTokens(ciphertext: string): GoogleTokens {
  return JSON.parse(decryptSecret(ciphertext, secret())) as GoogleTokens;
}

/** Trades the one-time code for tokens. A failure says why, never throws. */
export function exchangeGoogleCode(code: string): Promise<TokenResult> {
  return requestTokens({
    ...clientCredentials(),
    code,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
}

export function refreshGoogleTokens(tokens: GoogleTokens): Promise<TokenResult> {
  return requestTokens(
    {
      ...clientCredentials(),
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    },
    { previous: tokens },
  );
}

/**
 * Ends the grant at Google. Best-effort: whatever Google answers, the caller
 * removes TradeCatch's own copy of the credential.
 */
export function revokeGoogleToken(tokens: GoogleTokens): Promise<boolean> {
  return createGoogleClient({ tokens }).revoke();
}
