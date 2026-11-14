import { canManageBilling } from "../billing-access";
import { newId } from "../ids";
import { isPlatformAdminUser } from "../platform-admin";
import { getSaasStore } from "../runtime";
import type { User } from "../types";
import { issueSessionTokens, type SessionTokens } from "./refresh-token";
import { getAuthSecret } from "./secret";
import { SESSION_TTL_SECONDS } from "./session-token";

export type StartedSession =
  | {
      ok: true;
      /** The access token (JWT) for the `tc_session` cookie. */
      cookieValue: string;
      /** Seconds the access cookie should live. */
      maxAge: number;
      tokens: SessionTokens;
      sessionId: string;
      user: User;
      /** The business is not active: the person may only reach billing. */
      billingOnly: boolean;
      /** On the administrator list: lands on the admin dashboard (which still asks for MFA). */
      isPlatformAdmin: boolean;
    }
  | { ok: false; error: string };

/**
 * Opens a session for a user whose identity has ALREADY been proven (by a
 * single-use email link or by their password). This is the one place that
 * decides which business the session belongs to and whether it is billing-only,
 * so every sign-in route behaves the same.
 */
export async function startSessionForUser(input: {
  user: User;
  /** The business the link was issued for; falls back to the user's first one. */
  organizationId?: string;
  userAgent?: string;
  ip?: string;
}): Promise<StartedSession> {
  const secret = getAuthSecret();
  if (!secret) return { ok: false, error: "AUTH_SECRET is not configured." };

  const store = getSaasStore();
  const now = new Date();
  const { user } = input;

  let organizationId = input.organizationId;
  if (!organizationId) {
    const memberships = await store.listMembershipsForUser(user.id);
    organizationId = memberships[0]?.organizationId;
  }
  if (!organizationId) {
    return { ok: false, error: "No organization for this user." };
  }

  const organization = await store.getOrganization(organizationId);
  if (!organization) return { ok: false, error: "Organization unavailable." };

  const membership = await store.getMembership(organization.id, user.id);
  if (!membership) {
    return { ok: false, error: "Not a member of this organization." };
  }

  const billingOnly = organization.status !== "active";
  if (billingOnly && !canManageBilling(membership.role)) {
    return { ok: false, error: "Organization unavailable." };
  }

  const session = {
    id: newId("ses"),
    userId: user.id,
    organizationId: organization.id,
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    createdAt: now.toISOString(),
    userAgent: input.userAgent?.slice(0, 300),
    ip: input.ip,
  };
  await store.createSession(session);

  const tokens = await issueSessionTokens({
    session,
    plan: organization.plan,
    secret,
    nowMs: now.getTime(),
  });

  return {
    ok: true,
    cookieValue: tokens.accessToken,
    maxAge: tokens.accessMaxAge,
    tokens,
    sessionId: session.id,
    billingOnly,
    isPlatformAdmin: isPlatformAdminUser(user),
    user,
  };
}
