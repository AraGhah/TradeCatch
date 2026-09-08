import { Resend } from "resend";
import { isE2eHarness, isProductionRuntime } from "@/lib/config";
import { hashToken, newId, randomToken } from "../ids";
import { getSaasStore } from "../runtime";
import { normalizeEmail } from "../store";
import type { User } from "../types";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSessionClaims,
} from "./session-token";
import { getAuthSecret } from "../tenant";

const MAGIC_LINK_TTL_MS = 20 * 60 * 1000;

export async function requestMagicLink(input: {
  email: string;
  locale: "en" | "fr";
  origin: string;
}): Promise<{ ok: true; devToken?: string } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) {
    return { ok: false, error: "Invalid email." };
  }

  const store = getSaasStore();
  const user = await store.getUserByEmail(email);
  if (!user) {
    // Keep the public response enumeration-safe, but never create a user,
    // organization, or magic-link token from an untrusted sign-in request.
    return { ok: true };
  }

  const memberships = await store.listMembershipsForUser(user.id);
  const organization = memberships[0]
    ? await store.getOrganization(memberships[0].organizationId)
    : null;

  if (!organization) {
    return { ok: true };
  }

  const rawToken = randomToken(32);
  const now = new Date();
  await store.createMagicLink({
    id: newId("mlk"),
    email,
    tokenHash: hashToken(rawToken),
    organizationId: organization.id,
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  });

  const verifyUrl = `${input.origin.replace(/\/$/, "")}/api/auth/callback?token=${encodeURIComponent(rawToken)}&locale=${input.locale}`;

  const sent = await sendMagicLinkEmail({
    to: email,
    verifyUrl,
    locale: input.locale,
    orgName: organization.name,
  });

  const allowDevToken =
    (process.env.SAAS_DEV_LOGIN === "1" ||
      (!isProductionRuntime() && !sent.ok)) &&
    (!isProductionRuntime() || isE2eHarness());

  if (!sent.ok && !allowDevToken) {
    console.error("[saas-auth] magic-link delivery failed", {
      error: sent.error || "send failed",
    });
  }

  return {
    ok: true,
    ...(allowDevToken ? { devToken: rawToken } : {}),
  };
}

async function sendMagicLinkEmail(input: {
  to: string;
  verifyUrl: string;
  locale: "en" | "fr";
  orgName: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    console.warn("[saas-auth] Resend not configured — magic link not emailed");
    return { ok: false, error: "Email is not configured." };
  }

  const resend = new Resend(apiKey);
  const subject =
    input.locale === "fr"
      ? `Connexion TradeCatch — ${input.orgName}`
      : `TradeCatch sign-in — ${input.orgName}`;
  const body =
    input.locale === "fr"
      ? `Bonjour,\n\nCliquez pour vous connecter à TradeCatch (${input.orgName}) :\n${input.verifyUrl}\n\nCe lien expire dans 20 minutes.\n`
      : `Hi,\n\nClick to sign in to TradeCatch (${input.orgName}):\n${input.verifyUrl}\n\nThis link expires in 20 minutes.\n`;

  try {
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject,
      text: body,
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "send failed",
    };
  }
}

export async function consumeMagicLinkAndCreateSession(input: {
  rawToken: string;
  userAgent?: string;
  ip?: string;
}): Promise<
  | { ok: true; cookieValue: string; user: User; maxAge: number }
  | { ok: false; error: string }
> {
  const secret = getAuthSecret();
  if (!secret) {
    return { ok: false, error: "AUTH_SECRET is not configured." };
  }

  const store = getSaasStore();
  const now = new Date();
  const link = await store.consumeMagicLink(
    hashToken(input.rawToken),
    now.toISOString(),
  );
  if (!link) {
    return { ok: false, error: "Invalid or expired link." };
  }

  const user = await store.getUserByEmail(link.email);
  if (!user) {
    return { ok: false, error: "User not found." };
  }

  let organizationId = link.organizationId;
  if (!organizationId) {
    const memberships = await store.listMembershipsForUser(user.id);
    organizationId = memberships[0]?.organizationId;
  }
  if (!organizationId) {
    return { ok: false, error: "No organization for this user." };
  }

  const organization = await store.getOrganization(organizationId);
  if (!organization || organization.status !== "active") {
    return { ok: false, error: "Organization unavailable." };
  }

  const membership = await store.getMembership(organization.id, user.id);
  if (!membership) {
    return { ok: false, error: "Not a member of this organization." };
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
    user,
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function sessionCookieOptions(maxAge: number) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
