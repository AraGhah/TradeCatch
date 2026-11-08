import { hashToken, newId, randomToken } from "../ids";
import { getSaasStore } from "../runtime";
import { normalizeEmail } from "../store";
import { devTokenAllowed, sendAuthEmail } from "./mailer";
import { safeReturnPath } from "./return-path";
import { getAuthSecret } from "./secret";
import { SESSION_COOKIE } from "./session-token";
import { startSessionForUser, type StartedSession } from "./session-start";

// Account invitations now carry a "choose your password" link; see password-auth.ts.
export { sendActivationInvite } from "./password-auth";

const MAGIC_LINK_TTL_MS = 20 * 60 * 1000;

export async function requestMagicLink(input: {
  email: string;
  locale: "en" | "fr";
  origin: string;
  /** Where to land after signing in; ignored unless it is one of our own pages. */
  next?: string | null;
}): Promise<{ ok: true; devToken?: string } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) {
    return { ok: false, error: "Invalid email." };
  }
  const { getSecurityService } = await import("@/product/security/runtime");
  const security = getSecurityService();
  if (!(await security.loginAllowed(email))) {
    await security.audit({ action: "login_rate_limited" });
    return { ok: true };
  }
  await security.noteLogin(email);

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

  const back = safeReturnPath(input.next);
  const verifyUrl = `${input.origin.replace(/\/$/, "")}/api/auth/callback?token=${encodeURIComponent(rawToken)}&locale=${input.locale}${back ? `&next=${encodeURIComponent(back)}` : ""}`;

  const sent = await sendMagicLinkEmail({
    to: email,
    verifyUrl,
    locale: input.locale,
    orgName: organization.name,
  });

  const allowDevToken = devTokenAllowed(sent.ok);

  if (!sent.ok && !allowDevToken) {
    console.error("[saas-auth] magic-link delivery failed", {
      error: sent.ok ? "send failed" : sent.error || "send failed",
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
}) {
  const subject =
    input.locale === "fr"
      ? `Connexion à TradeCatch pour ${input.orgName}`
      : `TradeCatch sign-in for ${input.orgName}`;
  const text =
    input.locale === "fr"
      ? `Bonjour,\n\nCliquez pour vous connecter à TradeCatch (${input.orgName}) :\n${input.verifyUrl}\n\nCe lien expire dans 20 minutes.\n`
      : `Hi,\n\nClick to sign in to TradeCatch (${input.orgName}):\n${input.verifyUrl}\n\nThis link expires in 20 minutes.\n`;
  return sendAuthEmail({ to: input.to, subject, text });
}

export async function consumeMagicLinkAndCreateSession(input: {
  rawToken: string;
  userAgent?: string;
  ip?: string;
}): Promise<StartedSession> {
  // Check this before spending the single-use link, so a config gap cannot burn it.
  if (!getAuthSecret()) {
    return { ok: false, error: "AUTH_SECRET is not configured." };
  }
  const store = getSaasStore();
  const link = await store.consumeMagicLink(
    hashToken(input.rawToken),
    new Date().toISOString(),
  );
  if (!link) {
    return { ok: false, error: "Invalid or expired link." };
  }

  const user = await store.getUserByEmail(link.email);
  if (!user) {
    return { ok: false, error: "User not found." };
  }

  return startSessionForUser({
    user,
    organizationId: link.organizationId,
    userAgent: input.userAgent,
    ip: input.ip,
  });
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
