import { hashToken, newId, randomToken } from "../ids";
import { getSaasStore } from "../runtime";
import { normalizeEmail } from "../store";
import type { PasswordToken, User } from "../types";
import { runAfterResponse } from "@/lib/after-response";
import { consumePolicy } from "@/lib/rate-limit-policy";
import type { RateLimitResult } from "@/lib/rate-limit";
import { devTokenAllowed, sendAuthEmail } from "./mailer";
import { trustedSiteOrigin } from "./site-origin";
import {
  checkPasswordStrength,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  spendPasswordCheck,
  verifyPassword,
  type PasswordProblem,
} from "./password";
import { sendPasswordChangedEmail } from "./security-emails";
import { startSessionForUser, type StartedSession } from "./session-start";

type Locale = "en" | "fr";

/** Single-use links: an invite is read later than a reset, so it lives longer. */
const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A reset link stops working 30 minutes after it was made. Never extended. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MS = PASSWORD_RESET_TTL_MS;

/** randomToken(32) is 43 base64url characters; anything else cannot be ours. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isPasswordTokenShape(value: string): boolean {
  return TOKEN_SHAPE.test(value);
}

export function setPasswordPath(locale: Locale): string {
  return locale === "fr" ? "/fr/definir-mot-de-passe" : "/set-password";
}

/**
 * The link emailed to choose a password. The secret sits in the URL fragment
 * (`#token=`), not the query string: a fragment is never sent to a server, so
 * it cannot land in Cloudflare's request logs or traces, in a Referer header,
 * or in a proxy log. The page reads it in the browser and posts it in a body.
 * The address always comes from the configured site (see site-origin.ts).
 */
export function setPasswordUrl(
  origin: string,
  locale: Locale,
  rawToken: string,
): string {
  return `${trustedSiteOrigin(origin)}${setPasswordPath(locale)}#token=${encodeURIComponent(rawToken)}`;
}

/** Error text that is safe to log: anything shaped like one of our tokens is masked. */
export function safeErrorText(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown";
  return text.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 300);
}

/** Password storage (migration 037) not being in the database yet, as opposed to any other failure. */
function isMissingRelation(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === "42P01") return true;
  return (
    error instanceof Error && /relation ".*" does not exist/i.test(error.message)
  );
}

/**
 * Creates a single-use link token and returns the raw value. Only its hash is
 * stored. Any earlier unused link of the same kind for this person stops
 * working at the same moment, so only the newest link is ever live.
 */
export async function issuePasswordToken(input: {
  userId: string;
  kind: PasswordToken["kind"];
  ttlMs?: number;
}): Promise<string> {
  const rawToken = randomToken(32);
  const now = new Date();
  const ttl =
    input.ttlMs ?? (input.kind === "activation" ? ACTIVATION_TTL_MS : RESET_TTL_MS);
  await getSaasStore().replacePasswordToken({
    id: newId("pwt"),
    userId: input.userId,
    tokenHash: hashToken(rawToken),
    kind: input.kind,
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
    createdAt: now.toISOString(),
  });
  return rawToken;
}

/** Checks a link without spending it, so the form can say up front when it is no good. */
export async function inspectPasswordToken(
  rawToken: string,
): Promise<{ valid: true; kind: PasswordToken["kind"] } | { valid: false }> {
  if (!isPasswordTokenShape(rawToken)) return { valid: false };
  const token = await getSaasStore().findPasswordToken(hashToken(rawToken));
  if (
    !token ||
    token.consumedAt ||
    Date.parse(token.expiresAt) <= Date.now()
  ) {
    return { valid: false };
  }
  return { valid: true, kind: token.kind };
}

export type Throttle = {
  allowed(key: string): Promise<boolean>;
  note(key: string): Promise<void>;
  audit(input: {
    organizationId?: string;
    actorUserId?: string;
    action: string;
  }): Promise<unknown>;
};

async function throttle(): Promise<Throttle> {
  const { getSecurityService } = await import("@/product/security/runtime");
  const security = getSecurityService();
  return {
    allowed: (key) => security.loginAllowed(key),
    note: (key) => security.noteLogin(key),
    audit: (input) => security.audit(input),
  };
}

async function firstOrganization(userId: string) {
  const store = getSaasStore();
  const memberships = await store.listMembershipsForUser(userId);
  const first = memberships[0];
  if (!first) return null;
  const organization = await store.getOrganization(first.organizationId);
  return organization ? { organization, membership: first } : null;
}

/**
 * Emails the owner of an account TradeCatch created for them a link to choose
 * their password. Only server code that already authorized an administrator
 * calls this. The email never contains a password.
 */
export async function sendActivationInvite(input: {
  email: string;
  locale: Locale;
  origin: string;
  organizationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  const store = getSaasStore();
  const user = await store.getUserByEmail(email);
  const organization = await store.getOrganization(input.organizationId);
  if (!user || !organization) return { ok: false, error: "Account not found." };
  const membership = await store.getMembership(organization.id, user.id);
  if (!membership) return { ok: false, error: "Not a member of this account." };

  let rawToken: string;
  try {
    rawToken = await issuePasswordToken({ userId: user.id, kind: "activation" });
  } catch (error) {
    if (!isMissingRelation(error)) {
      // A real failure (not the missing migration): say so instead of quietly
      // sending a different kind of link.
      console.error("[saas-auth] activation link not created", {
        error: safeErrorText(error),
      });
      return { ok: false, error: "Could not create the activation link." };
    }
    // Password storage (migration 037) is not in the database yet: invite with
    // the email sign-in link so a new customer is never locked out by deploy order.
    console.error("[saas-auth] password tokens unavailable, using email link", {
      error: safeErrorText(error),
    });
    return sendLegacyActivationLink({
      email,
      locale: input.locale,
      origin: input.origin,
      organizationId: organization.id,
      organizationName: organization.name,
    });
  }
  const url = setPasswordUrl(input.origin, input.locale, rawToken);
  return sendAuthEmail({
    to: email,
    subject:
      input.locale === "fr"
        ? "Activez votre compte TradeCatch"
        : "Activate your TradeCatch account",
    text:
      input.locale === "fr"
        ? `Bonjour,

Votre compte TradeCatch pour ${organization.name} est prêt. Cliquez sur le lien pour choisir votre mot de passe et activer votre compte :
${url}

Le lien ne sert qu’une fois et expire dans 7 jours. TradeCatch ne vous enverra jamais votre mot de passe par courriel. Si le lien a expiré, utilisez « Mot de passe oublié » sur la page de connexion.
`
        : `Hi,

Your TradeCatch account for ${organization.name} is ready. Click the link to choose your password and activate your account:
${url}

The link works once and expires in 7 days. TradeCatch will never email you your password. If the link has expired, use "Forgot password" on the sign-in page.
`,
  });
}

/** The invitation used before passwords existed: a single-use sign-in link, valid 7 days. */
async function sendLegacyActivationLink(input: {
  email: string;
  locale: Locale;
  origin: string;
  organizationId: string;
  organizationName: string;
  ttlMs?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const rawToken = randomToken(32);
  const now = new Date();
  const ttlMs = input.ttlMs ?? ACTIVATION_TTL_MS;
  const validFor =
    ttlMs === ACTIVATION_TTL_MS
      ? { en: "7 days", fr: "7 jours" }
      : { en: `${Math.round(ttlMs / 60_000)} minutes`, fr: `${Math.round(ttlMs / 60_000)} minutes` };
  await getSaasStore().createMagicLink({
    id: newId("mlk"),
    email: input.email,
    tokenHash: hashToken(rawToken),
    organizationId: input.organizationId,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    createdAt: now.toISOString(),
  });
  const url = `${trustedSiteOrigin(input.origin)}/api/auth/callback?token=${encodeURIComponent(rawToken)}&locale=${input.locale}`;
  return sendAuthEmail({
    to: input.email,
    subject:
      input.locale === "fr"
        ? "Activez votre compte TradeCatch"
        : "Activate your TradeCatch account",
    text:
      input.locale === "fr"
        ? `Bonjour,

Votre compte TradeCatch pour ${input.organizationName} est prêt. Cliquez sur le lien pour l’activer et vous connecter :
${url}

Le lien ne sert qu’une fois et expire dans ${validFor.fr}.
`
        : `Hi,

Your TradeCatch account for ${input.organizationName} is ready. Click the link to activate it and sign in:
${url}

The link works once and expires in ${validFor.en}.
`,
  });
}

/**
 * Sends a password reset link. The answer is the same whether or not the email
 * belongs to an account, and an unknown email never creates anything.
 *
 * In production the account lookup, the link and the email all happen after
 * the answer has been sent, so the response time does not reveal whether the
 * address has an account either. Only a local or test run (where the link is
 * handed back instead of emailed) does the work before answering.
 */
export type PasswordResetRequestResult =
  | { ok: true; devToken?: string }
  | { ok: false; error: "rate_limited"; budget: RateLimitResult };

export async function requestPasswordReset(input: {
  email: string;
  locale: Locale;
  origin: string;
}): Promise<PasswordResetRequestResult> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) return { ok: true };

  // One atomic budget per address (the per-IP budget is spent by the route).
  // It is spent for every address typed, whether or not an account exists, so
  // a refusal here says nothing about who has an account. The address is only
  // ever stored hashed.
  const budget = await consumePolicy("auth.forgot-password-account", {
    subject: hashToken(`pwreset:${email}`),
  });
  const limiter = await throttle();
  if (!budget.allowed) {
    await limiter
      .audit({ action: "password_reset_rate_limited" })
      .catch(() => undefined);
    return { ok: false, error: "rate_limited", budget };
  }

  if (!devTokenAllowed(false)) {
    await runAfterResponse(async () => {
      await deliverPasswordReset(email, input, limiter);
    });
    return { ok: true };
  }
  const devToken = await deliverPasswordReset(email, input, limiter);
  return { ok: true, ...(devToken ? { devToken } : {}) };
}

/** Looks the account up and emails the link. Returns the raw token only where a dev token is allowed. */
async function deliverPasswordReset(
  email: string,
  input: { locale: Locale; origin: string },
  limiter: Throttle,
): Promise<string | undefined> {
  const store = getSaasStore();
  const user = await store.getUserByEmail(email);
  if (!user) return undefined;
  const home = await firstOrganization(user.id);
  if (!home) return undefined;

  let rawToken: string;
  try {
    rawToken = await issuePasswordToken({ userId: user.id, kind: "reset" });
  } catch (error) {
    if (!isMissingRelation(error)) {
      // A real failure: nothing was created, nothing is sent, and no sign-in
      // link is substituted. The person can ask again.
      console.error("[saas-auth] password reset link not created", {
        error: safeErrorText(error),
      });
      await limiter
        .audit({
          organizationId: home.organization.id,
          actorUserId: user.id,
          action: "password_reset_failed",
        })
        .catch(() => undefined);
      return undefined;
    }
    // Password storage (migration 037) is not in the database yet. Never
    // leave a locked-out customer with a silent "email sent": send them a
    // single-use sign-in link instead, the way invitations already do.
    console.error("[saas-auth] password tokens unavailable, sending a sign-in link", {
      error: safeErrorText(error),
    });
    await sendLegacyActivationLink({
      email,
      locale: input.locale,
      origin: input.origin,
      organizationId: home.organization.id,
      organizationName: home.organization.name,
      ttlMs: RESET_TTL_MS,
    });
    await limiter.audit({
      organizationId: home.organization.id,
      actorUserId: user.id,
      action: "password_reset_sign_in_link_fallback",
    });
    return undefined;
  }

  const url = setPasswordUrl(input.origin, input.locale, rawToken);
  const sent = await sendAuthEmail({
    to: email,
    subject:
      input.locale === "fr"
        ? "Réinitialisez votre mot de passe TradeCatch"
        : "Reset your TradeCatch password",
    text:
      input.locale === "fr"
        ? `Bonjour,

Nous avons reçu une demande pour choisir un nouveau mot de passe pour votre compte TradeCatch (${home.organization.name}). Cliquez sur le lien pour le faire :
${url}

Le lien ne sert qu’une fois et expire dans 30 minutes. Si vous n’avez rien demandé, ignorez ce courriel : votre mot de passe actuel reste valide.
`
        : `Hi,

We received a request to choose a new password for your TradeCatch account (${home.organization.name}). Click the link to do it:
${url}

The link works once and expires in 30 minutes. If you did not ask for this, ignore this email: your current password stays valid.
`,
  });
  await limiter.audit({
    organizationId: home.organization.id,
    actorUserId: user.id,
    action: sent.ok ? "password_reset_requested" : "password_reset_email_failed",
  });

  const allowDev = devTokenAllowed(sent.ok);
  if (!sent.ok && !allowDev) {
    console.error("[saas-auth] password reset delivery failed", {
      error: safeErrorText(sent.error || "send failed"),
    });
  }
  return allowDev ? rawToken : undefined;
}

export type CompletePasswordResult =
  | { ok: true; session: Extract<StartedSession, { ok: true }> | null }
  | { ok: false; error: "invalid_link" }
  | { ok: false; error: "weak_password"; problem: PasswordProblem };

/**
 * Finishes an activation or reset link: checks the new password, then in ONE
 * all-or-nothing step spends the link, stores the hash, cancels every other
 * open link and signs the user out of every session (their refresh tokens die
 * with them), and finally signs this browser in.
 *
 * Two simultaneous submissions of the same link: exactly one succeeds. If the
 * database fails part way, the link is not spent and the password is
 * unchanged, so the person can submit again; success is never reported
 * unless the whole step committed.
 */
export async function completePassword(input: {
  rawToken: string;
  password: string;
  userAgent?: string;
  ip?: string;
}): Promise<CompletePasswordResult> {
  if (!isPasswordTokenShape(input.rawToken)) {
    return { ok: false, error: "invalid_link" };
  }
  const store = getSaasStore();
  const tokenHash = hashToken(input.rawToken);

  // Look first so a password that is too weak does not spend the single-use link.
  const found = await store.findPasswordToken(tokenHash);
  if (
    !found ||
    found.consumedAt ||
    Date.parse(found.expiresAt) <= Date.now()
  ) {
    return { ok: false, error: "invalid_link" };
  }
  const user = await store.getUser(found.userId);
  if (!user) return { ok: false, error: "invalid_link" };

  const problem = checkPasswordStrength(input.password, user.email);
  if (problem) return { ok: false, error: "weak_password", problem };

  // Hash before the step below so no database lock is held while scrypt runs.
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  const consumed = await store.completePasswordReset({
    tokenHash,
    atIso: now,
    passwordHash,
  });
  // Null: used, replaced or expired between the check above and now (or by a
  // simultaneous submission that won). Nothing was changed.
  if (!consumed || consumed.userId !== user.id) {
    return { ok: false, error: "invalid_link" };
  }

  const limiter = await throttle();
  const home = await firstOrganization(user.id);
  await limiter.audit({
    organizationId: home?.organization.id,
    actorUserId: user.id,
    action: consumed.kind === "activation" ? "account_activated" : "password_reset",
  });
  if (consumed.kind === "reset") {
    await notifyPasswordChanged(user, limiter, home?.organization.id);
  }

  const started = await startSessionForUser({
    user,
    userAgent: input.userAgent,
    ip: input.ip,
  });
  return { ok: true, session: started.ok ? started : null };
}

/** Emails the account owner that the password changed (after the answer is sent). */
async function notifyPasswordChanged(
  user: User,
  limiter: Throttle,
  organizationId?: string,
) {
  await runAfterResponse(async () => {
    const sent = await sendPasswordChangedEmail({ to: user.email, locale: user.locale });
    if (!sent.ok) {
      console.error("[saas-auth] password change notice not sent", {
        error: safeErrorText(sent.error || "send failed"),
      });
    }
    await limiter.audit({
      organizationId,
      actorUserId: user.id,
      action: sent.ok ? "password_change_notice_sent" : "password_change_notice_failed",
    });
  });
}

export type PasswordLoginResult =
  | { ok: true; session: Extract<StartedSession, { ok: true }> }
  | { ok: false; error: "invalid_credentials" | "rate_limited" | "unavailable" };

/**
 * Email and password sign-in. One answer for every failure, equal work whether
 * or not the account exists, and a per-email attempt limit.
 */
export async function passwordLogin(input: {
  email: string;
  password: string;
  userAgent?: string;
  ip?: string;
}): Promise<PasswordLoginResult> {
  const email = normalizeEmail(input.email);
  const limiter = await throttle();
  const key = `pw:${email}`;
  if (!(await limiter.allowed(key))) {
    await limiter.audit({ action: "password_login_rate_limited" });
    return { ok: false, error: "rate_limited" };
  }

  const store = getSaasStore();
  const user = email.includes("@") ? await store.getUserByEmail(email) : null;
  const credential = user ? await store.getPasswordCredential(user.id) : null;

  let valid = false;
  if (
    user &&
    credential &&
    input.password.length > 0 &&
    input.password.length <= PASSWORD_MAX_LENGTH
  ) {
    valid = await verifyPassword(input.password, credential.hash);
  } else {
    await spendPasswordCheck(input.password.slice(0, PASSWORD_MAX_LENGTH));
  }

  if (!valid || !user) {
    await limiter.note(key);
    if (user) {
      await limiter.audit({ actorUserId: user.id, action: "password_login_failed" });
    }
    return { ok: false, error: "invalid_credentials" };
  }

  const started = await startSessionForUser({
    user,
    userAgent: input.userAgent,
    ip: input.ip,
  });
  if (!started.ok) return { ok: false, error: "unavailable" };
  await limiter.audit({ actorUserId: user.id, action: "password_login" });
  return { ok: true, session: started };
}

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      error: "no_password" | "wrong_password" | "rate_limited" | "same_password";
    }
  | { ok: false; error: "weak_password"; problem: PasswordProblem };

/** Changes the password for a signed-in person and signs out their other sessions. */
export async function changePassword(input: {
  user: User;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const store = getSaasStore();
  const limiter = await throttle();
  const key = `pwchange:${input.user.id}`;
  if (!(await limiter.allowed(key))) {
    await limiter.audit({
      actorUserId: input.user.id,
      action: "password_change_rate_limited",
    });
    return { ok: false, error: "rate_limited" };
  }

  const credential = await store.getPasswordCredential(input.user.id);
  if (!credential) return { ok: false, error: "no_password" };

  const currentOk =
    input.currentPassword.length > 0 &&
    input.currentPassword.length <= PASSWORD_MAX_LENGTH &&
    (await verifyPassword(input.currentPassword, credential.hash));
  if (!currentOk) {
    await limiter.note(key);
    await limiter.audit({
      actorUserId: input.user.id,
      action: "password_change_failed",
    });
    return { ok: false, error: "wrong_password" };
  }

  if (input.newPassword === input.currentPassword) {
    return { ok: false, error: "same_password" };
  }
  const problem = checkPasswordStrength(input.newPassword, input.user.email);
  if (problem) return { ok: false, error: "weak_password", problem };

  const now = new Date().toISOString();
  await store.setPasswordCredential({
    userId: input.user.id,
    hash: await hashPassword(input.newPassword),
    updatedAt: now,
  });
  await store.invalidatePasswordTokens(input.user.id, now);
  for (const session of await store.listSessionsForUser(input.user.id)) {
    if (session.id !== input.currentSessionId && !session.revokedAt) {
      await store.revokeSession(session.id, now);
    }
  }
  await limiter.audit({
    actorUserId: input.user.id,
    action: "password_changed",
  });
  await notifyPasswordChanged(input.user, limiter);
  return { ok: true };
}

/**
 * Whether this person has chosen a password yet (drives the account settings
 * form). Null when password storage is not available, so the page can leave the
 * section out instead of failing.
 */
export async function hasPassword(userId: string): Promise<boolean | null> {
  try {
    return (await getSaasStore().getPasswordCredential(userId)) !== null;
  } catch {
    return null;
  }
}
