import { canManageBilling } from "../billing-access";
import { newId } from "../ids";
import { getSaasStore } from "../runtime";
import { getAuthSecret } from "./secret";
import type { User } from "../types";
import { SESSION_TTL_SECONDS, signSessionClaims } from "./session-token";

export type StartedSession =
  | {
      ok: true;
      cookieValue: string;
      user: User;
      maxAge: number;
      /** The business is not active: the person may only reach billing. */
      billingOnly: boolean;
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

  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const sessionId = newId("ses");
  await store.createSession({
    id: sessionId,
    userId: user.id,
    organizationId: organization.id,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
    userAgent: input.userAgent,
    ip: input.ip,
  });

  const cookieValue = await signSessionClaims(
    {
      sid: sessionId,
      uid: user.id,
      oid: organization.id,
      plan: organization.plan,
      exp: Math.floor(expiresAt.getTime() / 1000),
    },
    secret,
  );

  return {
    ok: true,
    cookieValue,
    billingOnly,
    user,
    maxAge: SESSION_TTL_SECONDS,
  };
}
