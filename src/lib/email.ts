import { Resend } from "resend";
import type { BookAuditPayload } from "@/lib/validation/book-audit";

let client: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sends the lead confirmation + internal notification for a book-audit
// submission. If RESEND_API_KEY / RESEND_FROM_EMAIL / RESEND_NOTIFY_EMAIL
// aren't configured yet, this no-ops and logs a warning instead of throwing —
// the API route still records the submission attempt server-side.
export async function sendBookAuditEmails(
  payload: BookAuditPayload
): Promise<{ sent: boolean }> {
  const resend = getClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const notifyEmail = process.env.RESEND_NOTIFY_EMAIL;

  if (!resend || !fromEmail || !notifyEmail) {
    console.warn(
      "[email] Resend is not fully configured (RESEND_API_KEY / RESEND_FROM_EMAIL / RESEND_NOTIFY_EMAIL) — skipping email send."
    );
    return { sent: false };
  }

  const isFrench = payload.preferredLanguage === "fr";
  const leadSubject = isFrench
    ? "Votre demande d'audit a bien été reçue"
    : "Your audit request has been received";
  const leadBody = isFrench
    ? `<p>Bonjour ${escapeHtml(payload.firstName)},</p><p>Nous avons bien reçu votre demande d'audit pour ${escapeHtml(payload.company)}. Nous vous contacterons sous peu pour confirmer un moment.</p>`
    : `<p>Hi ${escapeHtml(payload.firstName)},</p><p>We received your audit request for ${escapeHtml(payload.company)}. We'll follow up shortly to confirm a time.</p>`;

  try {
    await resend.emails.send({
      from: fromEmail,
      to: payload.email,
      subject: leadSubject,
      html: leadBody,
    });

    await resend.emails.send({
      from: fromEmail,
      to: notifyEmail,
      subject: `New audit request: ${payload.company}`,
      html: `<ul>
        <li>Name: ${escapeHtml(payload.firstName)} ${escapeHtml(payload.lastName)}</li>
        <li>Company: ${escapeHtml(payload.company)} (${escapeHtml(payload.trade)})</li>
        <li>Email: ${escapeHtml(payload.email)}</li>
        <li>Phone: ${escapeHtml(payload.phone)}</li>
        <li>City: ${escapeHtml(payload.city)}</li>
        <li>Preferred language: ${escapeHtml(payload.preferredLanguage)}</li>
        <li>Main problem: ${escapeHtml(payload.mainProblem || "—")}</li>
        <li>Marketing consent: ${payload.marketingConsent ? "yes" : "no"}</li>
      </ul>`,
    });

    return { sent: true };
  } catch (error) {
    console.error("[email] failed to send book-audit emails", error);
    return { sent: false };
  }
}
