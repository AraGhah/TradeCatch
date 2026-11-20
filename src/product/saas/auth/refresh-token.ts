import { canManageBilling } from "../billing-access";
import { hashToken, newId, randomToken } from "../ids";
import { isPlatformAdminUser } from "../platform-admin";
import { getSaasStore } from "../runtime";
import type { Organization, RefreshToken, Session, User } from "../types";
import { getAuthSecret } from "./secret";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  signSessionClaims,
} from "./session-token";

/**
 * A refreshed token may be presented again for this long without being treated
 * as theft: two tabs (or a page and its prefetches) that refresh at the same
 * moment both send the same cookie, and only one of them can win the rotation.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/** randomToken(32) is 43 base64url characters; anything else cannot be ours. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type SessionTokens = {
  accessToken: string;
  /** Seconds the access cookie should live. */
  accessMaxAge: number;
  /** Unix seconds when the access token expires. */
  accessExpiresAt: number;
  /** Absent only when refresh storage is unavailable (see issueSessionTokens). */
  refreshToken?: string;
  refreshMaxAge: number;
};

async function audit(input: {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  target?: string;
}) {
  const { recordSecurityEvent } = await import("@/product/security/hooks");
  await recordSecurityEvent(input);
}

/**
 * Issues a fresh access token and refresh token for an existing session row.
 * Called when someone signs in and on every refresh.
 *
 * If refresh-token storage is not in the database yet (migration 039 not
 * applied), the person is still signed in, with an access token that lasts as
 * long as the session, exactly as before this change, and the gap is logged.
 * Deploy order must never lock customers out.
 */
export async function issueSessionTokens(input: {
  session: Session;
  plan: Organization["plan"];
  secret: string;
  nowMs?: number;
}): Promise<SessionTokens> {
  const nowMs = input.nowMs ?? Date.now();
  const sessionEndsMs = Date.parse(input.session.expiresAt);
  const sessionSeconds = Math.max(0, Math.floor((sessionEndsMs - nowMs) / 1000));

  let refreshToken: string | undefined = randomToken(32);
  try {
    await getSaasStore().createRefreshToken({
      id: newId("rtk"),
      sessionId: input.session.id,
      userId: input.session.userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: input.session.expiresAt,
      createdAt: new Date(nowMs).toISOString(),
    });
  } catch (error) {
    console.error("[saas-auth] refresh tokens unavailable (migration 039?)", {
      error: error instanceof Error ? error.message : "unknown",
    });
    refreshToken = undefined;
  }

  const accessSeconds = refreshToken
    ? Math.min(ACCESS_TOKEN_TTL_SECONDS, sessionSeconds)
    : sessionSeconds;
  const accessExpiresAt = Math.floor(nowMs / 1000) + accessSeconds;
  const accessToken = await signSessionClaims(
    {
      sid: input.session.id,
      uid: input.session.userId,
      oid: input.session.organizationId,
      plan: input.plan,
      exp: accessExpiresAt,
    },
    input.secret,
    nowMs,
  );
  return {
    accessToken,
    accessMaxAge: accessSeconds,
    accessExpiresAt,
    refreshToken,
    refreshMaxAge: sessionSeconds,
  };
}

export type RefreshResult =
  | {
      ok: true;
      tokens: SessionTokens;
      session: Session;
      user: User;
      organization: Organization;
      billingOnly: boolean;
      isPlatformAdmin: boolean;
    }
  | { ok: false; error: "invalid" | "reused" | "unavailable" };

/** The session a refresh token points at, or null when it has ended (revoked, expired, someone else's). */
async function usableSession(
  found: RefreshToken,
  nowMs: number,
): Promise<Session | null> {
  const session = await getSaasStore().getSession(found.sessionId);
  if (
    !session ||
    session.revokedAt ||
    session.userId !== found.userId ||
    Date.parse(session.expiresAt) <= nowMs ||
    Date.parse(found.expiresAt) <= nowMs
  ) {
    return null;
  }
  return session;
}

/**
 * The person and business behind a session, or null when they may no longer
 * sign in (membership removed, or a suspended business whose person cannot
 * manage billing). `billingOnly` is a suspended business that may still pay.
 */
async function accountOf(session: Session): Promise<{
  user: User;
  organization: Organization;
  billingOnly: boolean;
} | null> {
  const store = getSaasStore();
  const [user, organization, membership] = await Promise.all([
    store.getUser(session.userId),
    store.getOrganization(session.organizationId),
    store.getMembership(session.organizationId, session.userId),
  ]);
  if (!user || !organization || !membership) return null;
  const billingOnly = organization.status !== "active";
  if (billingOnly && !canManageBilling(membership.role)) return null;
  return { user, organization, billingOnly };
}

/**
 * Exchanges a refresh token for a new access token and a new refresh token
 * (rotation). The session row is re-checked every time, so a revoked session,
 * a removed membership or a suspended business stops renewing immediately.
 * Presenting a token that was already rotated (outside the short grace period)
 * means two parties hold it: the whole session is revoked and audited.
 */
export async function refreshSession(input: {
  rawToken: string;
  nowMs?: number;
}): Promise<RefreshResult> {
  const secret = getAuthSecret();
  if (!secret) return { ok: false, error: "unavailable" };
  if (!TOKEN_SHAPE.test(input.rawToken)) return { ok: false, error: "invalid" };

  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const store = getSaasStore();
  const tokenHash = hashToken(input.rawToken);

  const found = await store.findRefreshToken(tokenHash);
  if (!found) return { ok: false, error: "invalid" };

  const session = await usableSession(found, nowMs);
  if (!session) return { ok: false, error: "invalid" };

  const rotated = await store.rotateRefreshToken(tokenHash, nowIso);
  if (!rotated) {
    // Someone already used this token. Fine if it was a moment ago (parallel
    // tabs); otherwise a copy of it is being replayed.
    const current = await store.findRefreshToken(tokenHash);
    const rotatedAtMs = current?.rotatedAt ? Date.parse(current.rotatedAt) : NaN;
    if (!(nowMs - rotatedAtMs <= REFRESH_REUSE_GRACE_MS)) {
      await store.revokeSession(session.id, nowIso);
      await audit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "refresh_token_reuse_detected",
        target: session.id,
      });
      return { ok: false, error: "reused" };
    }
  }

  const account = await accountOf(session);
  if (!account) return { ok: false, error: "invalid" };
  const { user, organization, billingOnly } = account;

  const tokens = await issueSessionTokens({
    session,
    plan: organization.plan,
    secret,
    nowMs,
  });
  return {
    ok: true,
    tokens,
    session,
    user,
    organization,
    billingOnly,
    isPlatformAdmin: isPlatformAdminUser(user),
  };
}

export type RefreshPeek = {
  session: Session;
  user: User;
  organization: Organization;
  billingOnly: boolean;
  isPlatformAdmin: boolean;
};

/**
 * Who a refresh token belongs to, WITHOUT using it. Read-only on purpose:
 * nothing is rotated, revoked or audited, so any number of tabs can ask at any
 * time without racing the session keeper's real renewal. Answers null for a
 * token that refreshSession would refuse (unknown, ended session, expired, or
 * already rotated beyond the grace period). It may throw when the store is
 * unavailable; a caller must not read that as "signed out".
 */
export async function peekRefreshToken(
  rawToken: string,
  nowMs = Date.now(),
): Promise<RefreshPeek | null> {
  if (!TOKEN_SHAPE.test(rawToken)) return null;
  const found = await getSaasStore().findRefreshToken(hashToken(rawToken));
  if (!found) return null;
  if (
    found.rotatedAt &&
    !(nowMs - Date.parse(found.rotatedAt) <= REFRESH_REUSE_GRACE_MS)
  ) {
    return null;
  }
  const session = await usableSession(found, nowMs);
  if (!session) return null;
  const account = await accountOf(session);
  if (!account) return null;
  return {
    session,
    ...account,
    isPlatformAdmin: isPlatformAdminUser(account.user),
  };
}

/**
 * The session a refresh token belongs to, without using the token. For
 * sign-out when the access token has already expired.
 */
export async function sessionIdForRefreshToken(rawToken: string): Promise<string | null> {
  if (!TOKEN_SHAPE.test(rawToken)) return null;
  const found = await getSaasStore().findRefreshToken(hashToken(rawToken));
  return found?.sessionId ?? null;
}
