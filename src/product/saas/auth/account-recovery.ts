import { newId } from "../ids";
import { isPlatformAdminUser } from "../platform-admin";
import { getSaasStore } from "../runtime";
import { normalizeEmail } from "../store";
import type { AccountRecoveryRequest, User } from "../types";
import { sendAuthEmail } from "./mailer";
import { issuePasswordToken, setPasswordUrl } from "./password-auth";
import { sendEmailChangedNotice, siteOrigin } from "./security-emails";

/**
 * Support-based account recovery, for a customer who can no longer reach the
 * email on their account (so "Forgot password" cannot help them).
 *
 * The rules that keep it from becoming a way in:
 * - Submitting a request changes nothing and reveals nothing: the answer is
 *   the same whether or not the email has an account.
 * - Only a platform administrator, signed in with MFA and the admin token, can
 *   act on a request, and must first record how they verified the person's
 *   identity. The email can only change after that step, and only once.
 * - Changing the email signs nobody in. It revokes every session and old link
 *   and the old password, and emails a single-use, 30-minute password link to
 *   the NEW address; the old address gets a notice. Businesses, memberships, data, appointments,
 *   settings and subscriptions are untouched: only the sign-in email changes.
 * - Administrator accounts and the acting administrator's own account cannot
 *   be recovered this way (operator-only: scripts/reset-admin-mfa.js).
 * - Every step is written to the audit log.
 */

export const VERIFICATION_METHODS = [
  "phone_callback_number_on_file",
  "billing_details_match",
  "video_call_photo_id",
  "signed_contract_details",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/** Long enough that "verified" alone is never accepted as the evidence. */
export const MIN_VERIFICATION_NOTES = 20;

type Locale = "en" | "fr";

async function audit(input: {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  target?: string;
  detail?: string;
}) {
  const { recordSecurityEvent } = await import("@/product/security/hooks");
  await recordSecurityEvent(input);
}

/** "a***@example.com": enough for an audit reader, not the whole address. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function firstOrganizationId(userId: string): Promise<string | undefined> {
  const memberships = await getSaasStore().listMembershipsForUser(userId);
  return memberships[0]?.organizationId;
}

/**
 * Records a recovery request. Same answer whatever happens, so it cannot be
 * used to learn which emails have accounts. Repeats of an open request for the
 * same account and contact address are not stored twice.
 */
export async function submitRecoveryRequest(input: {
  accountEmail: string;
  contactEmail: string;
  contactName: string;
  businessName: string;
  phone?: string;
  details: string;
  locale: Locale;
}): Promise<{ ok: true }> {
  const store = getSaasStore();
  const accountEmail = normalizeEmail(input.accountEmail);
  const contactEmail = normalizeEmail(input.contactEmail);

  const existing = await store.listRecoveryRequests();
  const duplicate = existing.find(
    (row) =>
      (row.status === "open" || row.status === "verified") &&
      row.accountEmail === accountEmail &&
      row.contactEmail === contactEmail,
  );
  if (duplicate) return { ok: true };

  const user = await store.getUserByEmail(accountEmail);
  const now = new Date().toISOString();
  const request: AccountRecoveryRequest = {
    id: newId("rec"),
    status: "open",
    accountEmail,
    contactEmail,
    contactName: input.contactName.trim(),
    businessName: input.businessName.trim(),
    phone: input.phone?.trim() || undefined,
    details: input.details.trim(),
    locale: input.locale,
    userId: user?.id,
    createdAt: now,
    updatedAt: now,
  };
  await store.createRecoveryRequest(request);
  await audit({
    organizationId: user ? await firstOrganizationId(user.id) : undefined,
    action: "account_recovery_requested",
    target: request.id,
  });

  // Fixed wording, no account details: it only confirms that we will call.
  await sendAuthEmail({
    to: contactEmail,
    subject:
      input.locale === "fr"
        ? "Nous avons reçu votre demande de récupération de compte"
        : "We received your account recovery request",
    text:
      input.locale === "fr"
        ? `Bonjour,

Nous avons reçu votre demande de récupération de compte TradeCatch. Un membre de notre équipe vous contactera pour vérifier votre identité avant toute modification.

TradeCatch ne vous demandera jamais votre mot de passe. Si vous n’avez rien demandé, ignorez ce courriel.
`
        : `Hi,

We received your TradeCatch account recovery request. Someone from our team will contact you to verify your identity before anything is changed.

TradeCatch will never ask for your password. If you did not make this request, ignore this email.
`,
  });
  const alert = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (alert) {
    await sendAuthEmail({
      to: alert,
      subject: "Account recovery request waiting for review",
      text: `A customer asked for account recovery (request ${request.id}). Review and verify identity in TradeCatch Admin > Account recovery.\n`,
    });
  }
  return { ok: true };
}

export type AdminRecoveryView = AccountRecoveryRequest & {
  /** What the administrator needs to verify identity against the records. */
  match: null | {
    userName: string;
    currentEmail: string;
    isAdministrator: boolean;
    businesses: { id: string; name: string; phone: string | null; plan: string; status: string }[];
  };
};

/** Requests with the account they point at, for the admin desk only. */
export async function listRecoveryRequestsForAdmin(): Promise<AdminRecoveryView[]> {
  const store = getSaasStore();
  const rows = await store.listRecoveryRequests();
  return Promise.all(
    rows.map(async (row) => {
      const user = row.userId ? await store.getUser(row.userId) : null;
      if (!user) return { ...row, match: null };
      const memberships = await store.listMembershipsForUser(user.id);
      const businesses = (
        await Promise.all(memberships.map((m) => store.getOrganization(m.organizationId)))
      )
        .filter((org): org is NonNullable<typeof org> => Boolean(org))
        .map((org) => ({
          id: org.id,
          name: org.name,
          phone: org.phoneE164,
          plan: org.plan,
          status: org.status,
        }));
      return {
        ...row,
        match: {
          userName: user.name,
          currentEmail: user.email,
          isAdministrator: isPlatformAdminUser(user),
          businesses,
        },
      };
    }),
  );
}

export type RecoveryActionError =
  | "not_found"
  | "wrong_status"
  | "no_matching_account"
  | "protected_account"
  | "weak_evidence"
  | "email_taken"
  | "invalid_email";

type ActionResult =
  | { ok: true; request: AccountRecoveryRequest; /** Set only when completing: was the password link emailed? */ linkSent?: boolean }
  | { ok: false; error: RecoveryActionError };

/** Refuses accounts that must never be recovered through support. */
function protectedAccount(user: User, adminUserId: string): boolean {
  return user.id === adminUserId || isPlatformAdminUser(user);
}

/** Step 1: the administrator records how they verified the requester is the account owner. */
export async function verifyRecoveryIdentity(input: {
  requestId: string;
  adminUserId: string;
  method: VerificationMethod;
  notes: string;
}): Promise<ActionResult> {
  const store = getSaasStore();
  const request = await store.getRecoveryRequest(input.requestId);
  if (!request) return { ok: false, error: "not_found" };
  if (request.status !== "open") return { ok: false, error: "wrong_status" };
  // Re-resolve now: the account may have changed since the request came in.
  const user = await store.getUserByEmail(request.accountEmail);
  if (!user) return { ok: false, error: "no_matching_account" };
  if (protectedAccount(user, input.adminUserId)) return { ok: false, error: "protected_account" };
  const notes = input.notes.trim();
  if (notes.length < MIN_VERIFICATION_NOTES || !VERIFICATION_METHODS.includes(input.method)) {
    return { ok: false, error: "weak_evidence" };
  }

  const now = new Date().toISOString();
  const updated = await store.updateRecoveryRequest(request.id, "open", {
    status: "verified",
    userId: user.id,
    verifiedBy: input.adminUserId,
    verifiedAt: now,
    verificationMethod: input.method,
    verificationNotes: notes,
    updatedAt: now,
  });
  if (!updated) return { ok: false, error: "wrong_status" };
  await audit({
    organizationId: await firstOrganizationId(user.id),
    actorUserId: input.adminUserId,
    action: "account_recovery_identity_verified",
    target: request.id,
    detail: `method ${input.method}`,
  });
  return { ok: true, request: updated };
}

/**
 * Step 2: moves the account to the verified contact address. Signs nobody in:
 * the new address receives a single-use link to choose a password.
 */
export async function completeRecoveryEmailChange(input: {
  requestId: string;
  adminUserId: string;
  notes?: string;
  origin?: string;
}): Promise<ActionResult> {
  const store = getSaasStore();
  const request = await store.getRecoveryRequest(input.requestId);
  if (!request) return { ok: false, error: "not_found" };
  if (request.status !== "verified" || !request.userId) {
    return { ok: false, error: "wrong_status" };
  }
  const user = await store.getUser(request.userId);
  if (!user) return { ok: false, error: "no_matching_account" };
  if (protectedAccount(user, input.adminUserId)) return { ok: false, error: "protected_account" };
  const newEmail = normalizeEmail(request.contactEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { ok: false, error: "invalid_email" };
  const holder = await store.getUserByEmail(newEmail);
  if (holder && holder.id !== user.id) return { ok: false, error: "email_taken" };

  // Claim the request first so two administrators cannot both apply it.
  const now = new Date();
  const nowIso = now.toISOString();
  const claimed = await store.updateRecoveryRequest(request.id, "verified", {
    status: "completed",
    resolvedBy: input.adminUserId,
    resolvedAt: nowIso,
    resolutionNotes: input.notes?.trim() || undefined,
    updatedAt: nowIso,
  });
  if (!claimed) return { ok: false, error: "wrong_status" };

  const oldEmail = user.email;
  if (newEmail !== normalizeEmail(oldEmail)) {
    const changed = await store.updateUserEmail(user.id, newEmail);
    if (!changed.ok) {
      // Put the request back so it can be resolved another way.
      await store.updateRecoveryRequest(request.id, "completed", {
        status: "verified",
        resolutionNotes: "Email change failed: the new address already has an account.",
        updatedAt: new Date().toISOString(),
      });
      return { ok: false, error: changed.error === "email_taken" ? "email_taken" : "no_matching_account" };
    }
  }

  // Whoever was signed in, and any link sent to the old address, stops working.
  await store.revokeUserSessions(user.id, nowIso);
  try {
    await store.invalidatePasswordTokens(user.id, nowIso);
    // The old password goes too: whoever gets back in must choose a new one
    // through the link sent to the verified address.
    await store.deletePasswordCredential(user.id);
  } catch {
    // Password storage missing (migration 037): nothing to invalidate.
  }

  const organizationId = await firstOrganizationId(user.id);
  await audit({
    organizationId,
    actorUserId: input.adminUserId,
    action: "account_recovery_email_changed",
    target: request.id,
    detail: `user ${user.id}: ${maskEmail(oldEmail)} -> ${maskEmail(newEmail)}`,
  });

  const locale = request.locale;
  let linkSent = false;
  try {
    const rawToken = await issuePasswordToken({ userId: user.id, kind: "reset" });
    const url = setPasswordUrl(siteOrigin(input.origin), locale, rawToken);
    const sent = await sendAuthEmail({
      to: newEmail,
      subject:
        locale === "fr"
          ? "Votre compte TradeCatch est récupéré : choisissez un mot de passe"
          : "Your TradeCatch account is recovered: choose a password",
      text:
        locale === "fr"
          ? `Bonjour,

Votre identité a été vérifiée et cette adresse est maintenant celle de votre compte TradeCatch. Cliquez sur le lien pour choisir un nouveau mot de passe :
${url}

Le lien ne sert qu’une fois et expire dans 30 minutes. S’il a expiré, utilisez « Mot de passe oublié » sur la page de connexion.
`
          : `Hi,

Your identity was verified and this address is now the sign-in email of your TradeCatch account. Click the link to choose a new password:
${url}

The link works once and expires in 30 minutes. If it has expired, use "Forgot your password" on the sign-in page.
`,
    });
    linkSent = sent.ok;
  } catch (error) {
    console.error("[saas-auth] recovery password link not issued", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  if (normalizeEmail(oldEmail) !== newEmail) {
    await sendEmailChangedNotice({ to: oldEmail, locale });
  }
  await audit({
    organizationId,
    actorUserId: input.adminUserId,
    action: linkSent ? "account_recovery_link_sent" : "account_recovery_link_failed",
    target: request.id,
  });
  return { ok: true, request: claimed, linkSent };
}

/** Closes a request without changing anything (identity could not be verified, duplicate, abuse). */
export async function rejectRecoveryRequest(input: {
  requestId: string;
  adminUserId: string;
  notes: string;
}): Promise<ActionResult> {
  const store = getSaasStore();
  const request = await store.getRecoveryRequest(input.requestId);
  if (!request) return { ok: false, error: "not_found" };
  if (request.status !== "open" && request.status !== "verified") {
    return { ok: false, error: "wrong_status" };
  }
  const now = new Date().toISOString();
  const updated = await store.updateRecoveryRequest(request.id, request.status, {
    status: "rejected",
    resolvedBy: input.adminUserId,
    resolvedAt: now,
    resolutionNotes: input.notes.trim() || undefined,
    updatedAt: now,
  });
  if (!updated) return { ok: false, error: "wrong_status" };
  await audit({
    organizationId: request.userId ? await firstOrganizationId(request.userId) : undefined,
    actorUserId: input.adminUserId,
    action: "account_recovery_rejected",
    target: request.id,
  });
  return { ok: true, request: updated };
}
