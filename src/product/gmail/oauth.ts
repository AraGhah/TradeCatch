import { isE2eHarness } from "@/lib/config";
import {
  encryptSecret,
  decryptSecret,
  signState,
  verifyState,
} from "@/product/scheduling/crypto";
import { GmailApiError, failureFromResponse } from "./errors";
import type { GmailAccount } from "./types";

/**
 * The one scope this feature needs: read messages and download attachments.
 * It cannot send, delete or modify mail. (Google classes it as a restricted
 * scope, so a public launch needs Google's OAuth verification.)
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const GOOGLE = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://gmail.googleapis.com/gmail/v1/users/me",
};

const REQUEST_TIMEOUT_MS = 15_000;

export type GmailTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type GmailEnv = {
  authUrl?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  authSecret?: string;
  siteUrl?: string;
  pubsubTopic?: string;
  webhookToken?: string;
  /** Overridable only inside the local E2E harness (see readGmailEnv). */
  apiBase?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  /** Shrinks the sync throttle in the local E2E harness only, so tests need not sleep. */
  testMinGapMs?: number;
};

export function readGmailEnv(env: NodeJS.ProcessEnv = process.env): GmailEnv {
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  const e2e = isE2eHarness(env);
  const testBase = e2e
    ? env.GMAIL_TEST_GOOGLE_BASE?.trim().replace(/\/$/, "")
    : "";
  const gap = Number(env.GMAIL_TEST_MIN_GAP_MS);
  return {
    clientId: env.GOOGLE_GMAIL_CLIENT_ID?.trim(),
    clientSecret: env.GOOGLE_GMAIL_CLIENT_SECRET?.trim(),
    redirectUri:
      env.GOOGLE_GMAIL_REDIRECT_URI?.trim() ||
      `${site.replace(/\/$/, "")}/api/app/gmail/callback`,
    authSecret: env.AUTH_SECRET?.trim() || env.SESSION_SECRET?.trim(),
    siteUrl: site.replace(/\/$/, ""),
    pubsubTopic: env.GMAIL_PUBSUB_TOPIC?.trim(),
    webhookToken: env.GMAIL_WEBHOOK_TOKEN?.trim(),
    authUrl: testBase ? `${testBase}/o/oauth2/v2/auth` : GOOGLE.auth,
    apiBase: testBase ? `${testBase}/gmail/v1/users/me` : GOOGLE.api,
    tokenUrl: testBase ? `${testBase}/token` : GOOGLE.token,
    revokeUrl: testBase ? `${testBase}/revoke` : GOOGLE.revoke,
    testMinGapMs:
      e2e && env.GMAIL_TEST_MIN_GAP_MS !== undefined && Number.isFinite(gap)
        ? gap
        : undefined,
  };
}

export function gmailConfigured(env: GmailEnv = readGmailEnv()): boolean {
  return Boolean(env.clientId && env.clientSecret && env.authSecret);
}

export function gmailPushConfigured(env: GmailEnv = readGmailEnv()): boolean {
  return Boolean(env.pubsubTopic && env.webhookToken);
}

export function gmailWatchActive(
  account: Pick<GmailAccount, "status" | "watchExpiration"> | null | undefined,
  env: GmailEnv = readGmailEnv(),
  now = Date.now(),
): boolean {
  return (
    gmailPushConfigured(env) &&
    account?.status === "connected" &&
    Date.parse(account.watchExpiration || "") > now
  );
}

function requireSecret(env: GmailEnv): string {
  if (!env.authSecret)
    throw new Error("AUTH_SECRET is required to protect Gmail tokens.");
  return env.authSecret;
}

export function buildGmailAuthUrl(
  input: {
    organizationId: string;
    userId: string;
    locale?: "en" | "fr";
    loginHint?: string | null;
  },
  env: GmailEnv = readGmailEnv(),
  nowMs = Date.now(),
) {
  if (!gmailConfigured(env)) throw new Error("not_configured");
  const state = signState(
    JSON.stringify({
      organizationId: input.organizationId,
      userId: input.userId,
      locale: input.locale === "fr" ? "fr" : "en",
      exp: nowMs + 10 * 60_000,
      nonce: crypto.randomUUID(),
    }),
    requireSecret(env),
  );
  const params = new URLSearchParams({
    client_id: env.clientId!,
    redirect_uri: env.redirectUri!,
    response_type: "code",
    access_type: "offline",
    // Forces a refresh token on every consent, including reconnects.
    prompt: "consent",
    include_granted_scopes: "false",
    scope: GMAIL_SCOPE,
    state,
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return { url: `${env.authUrl || GOOGLE.auth}?${params.toString()}`, state };
}

export function readGmailState(
  state: string,
  env: GmailEnv = readGmailEnv(),
  nowMs = Date.now(),
): { organizationId: string; userId: string; locale: "en" | "fr" } | null {
  if (!env.authSecret) return null;
  const raw = verifyState(state, env.authSecret);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      organizationId?: string;
      userId?: string;
      locale?: string;
      exp?: number;
    };
    if (
      !parsed.organizationId ||
      !parsed.userId ||
      !parsed.exp ||
      parsed.exp < nowMs
    )
      return null;
    return {
      organizationId: parsed.organizationId,
      userId: parsed.userId,
      locale: parsed.locale === "fr" ? "fr" : "en",
    };
  } catch {
    return null;
  }
}

export function sealGmailTokens(
  tokens: GmailTokens,
  env: GmailEnv = readGmailEnv(),
): string {
  return encryptSecret(JSON.stringify(tokens), requireSecret(env));
}

export function openGmailTokens(
  ciphertext: string,
  env: GmailEnv = readGmailEnv(),
): GmailTokens {
  const parsed = JSON.parse(
    decryptSecret(ciphertext, requireSecret(env)),
  ) as GmailTokens;
  if (!parsed.refreshToken || !parsed.accessToken)
    throw new Error("Invalid token payload");
  return parsed;
}

type TokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

async function tokenRequest(
  env: GmailEnv,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<TokenJson> {
  let response: Response;
  try {
    response = await fetchImpl(env.tokenUrl || GOOGLE.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new GmailApiError(
      "sync_failed",
      0,
      error instanceof Error ? error.message : "network",
    );
  }
  const text = await response.text();
  if (!response.ok)
    throw failureFromResponse(
      response.status,
      text,
      response.headers.get("retry-after"),
    );
  try {
    return JSON.parse(text) as TokenJson;
  } catch {
    throw new GmailApiError(
      "sync_failed",
      response.status,
      "token response was not JSON",
    );
  }
}

/**
 * Exchanges the one-time code. Google's granular consent lets a user untick
 * the Gmail permission, so the granted scope is checked rather than assumed.
 */
export async function exchangeGmailCode(
  code: string,
  env: GmailEnv = readGmailEnv(),
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<GmailTokens> {
  const json = await tokenRequest(
    env,
    new URLSearchParams({
      code,
      client_id: env.clientId || "",
      client_secret: env.clientSecret || "",
      redirect_uri: env.redirectUri || "",
      grant_type: "authorization_code",
    }),
    fetchImpl,
  );
  if (!json.access_token)
    throw new GmailApiError("sync_failed", 0, "no access token");
  if (!(json.scope || "").split(/\s+/).includes(GMAIL_SCOPE)) {
    throw new GmailApiError(
      "needs_reconnect",
      0,
      "gmail permission was not granted",
    );
  }
  if (!json.refresh_token)
    throw new GmailApiError("needs_reconnect", 0, "no refresh token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(nowMs + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function refreshGmailTokens(
  tokens: GmailTokens,
  env: GmailEnv = readGmailEnv(),
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<GmailTokens> {
  const json = await tokenRequest(
    env,
    new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: env.clientId || "",
      client_secret: env.clientSecret || "",
      grant_type: "refresh_token",
    }),
    fetchImpl,
  );
  if (!json.access_token)
    throw new GmailApiError("sync_failed", 0, "no access token");
  return {
    accessToken: json.access_token,
    // Google only rotates the refresh token occasionally; keep ours otherwise.
    refreshToken: json.refresh_token || tokens.refreshToken,
    expiresAt: new Date(nowMs + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

/** Best effort: tells Google to drop the grant so it disappears from the user's account. */
export async function revokeGmailToken(
  tokens: GmailTokens,
  env: GmailEnv = readGmailEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(env.revokeUrl || GOOGLE.revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function accessTokenFresh(
  tokens: GmailTokens,
  nowMs = Date.now(),
): boolean {
  return Date.parse(tokens.expiresAt) - nowMs > 60_000;
}
