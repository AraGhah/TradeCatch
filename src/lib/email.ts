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

function row(label: string, value: string | undefined | null | boolean): string {
  if (value === undefined || value === null || value === "") {
    return `<tr><td style="padding:6px 12px 6px 0;color:#5C6875;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#1A2430;">—</td></tr>`;
  }
  const display =
    typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  return `<tr><td style="padding:6px 12px 6px 0;color:#5C6875;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#1A2430;">${escapeHtml(display)}</td></tr>`;
}

function brandedShell(title: string, inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F1EC;font-family:IBM Plex Sans,Helvetica,Arial,sans-serif;color:#1A2430;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid rgba(12,20,30,0.1);padding:32px;">
    <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C6875;">TradeCatch</p>
    <h1 style="margin:12px 0 0;font-size:24px;letter-spacing:-0.03em;color:#0C141E;">${escapeHtml(title)}</h1>
    <div style="margin-top:20px;font-size:15px;line-height:1.6;">${inner}</div>
    <p style="margin:28px 0 0;font-size:12px;color:#5C6875;">TradeCatch · Montréal · Laval · surrounding Québec</p>
  </div>
</body></html>`;
}

// Sends the lead confirmation + internal notification for a book-audit
// submission. If RESEND_API_KEY / RESEND_FROM_EMAIL / RESEND_NOTIFY_EMAIL
// aren't configured yet, this no-ops and logs a warning instead of throwing —
// the API route still records the submission attempt server-side.
export async function sendBookAuditEmails(
  payload: BookAuditPayload,
): Promise<{ sent: boolean }> {
  const resend = getClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const notifyEmail = process.env.RESEND_NOTIFY_EMAIL;

  if (!resend || !fromEmail || !notifyEmail) {
    console.warn(
      "[email] Resend is not fully configured (RESEND_API_KEY / RESEND_FROM_EMAIL / RESEND_NOTIFY_EMAIL) — skipping email send.",
    );
    return { sent: false };
  }

  const isFrench = payload.preferredLanguage === "fr";
  const leadSubject = isFrench
    ? "Votre demande d'audit a bien été reçue"
    : "Your audit request has been received";
  const leadInner = isFrench
    ? `<p>Bonjour ${escapeHtml(payload.firstName)},</p>
       <p>Nous avons bien reçu votre demande d'audit pour <strong>${escapeHtml(payload.company)}</strong>.</p>
       <p>Ara vous contactera sous peu pour confirmer un moment. Ayez sous la main votre volume d'appels récent, vos soumissions ouvertes et les logiciels que vous utilisez déjà.</p>
       <p>Des questions en attendant? Répondez à ce courriel ou composez le <a href="tel:+14389936997">438·993·6997</a>.</p>`
    : `<p>Hi ${escapeHtml(payload.firstName)},</p>
       <p>We received your audit request for <strong>${escapeHtml(payload.company)}</strong>.</p>
       <p>Ara will follow up shortly to confirm a time. Have your recent call volume, open quotes and any software you already run handy for the call.</p>
       <p>Questions in the meantime? Reply to this email or call <a href="tel:+14389936997">438·993·6997</a>.</p>`;

  const notifyHtml = brandedShell(
    `New audit request: ${payload.company}`,
    `<table style="border-collapse:collapse;width:100%;font-size:14px;">
      ${row("Name", `${payload.firstName} ${payload.lastName}`)}
      ${row("Company", payload.company)}
      ${row("Trade", payload.trade)}
      ${row("Email", payload.email)}
      ${row("Phone", payload.phone)}
      ${row("City", payload.city)}
      ${row("Language", payload.preferredLanguage)}
      ${row("Employees", payload.employees)}
      ${row("Calls / month", payload.callsPerMonth)}
      ${row("Missed calls / week", payload.missedCallsPerWeek)}
      ${row("After hours", payload.afterHours)}
      ${row("Quotes / month", payload.quotesPerMonth)}
      ${row("Avg job value", payload.averageJobValue)}
      ${row("Current CRM", payload.currentCrm)}
      ${row("Handles missed calls", payload.handlesMissedCalls)}
      ${row("Follows up quotes", payload.followsUpQuotes)}
      ${row("Main problem", payload.mainProblem)}
      ${row("Marketing consent", payload.marketingConsent)}
    </table>`,
  );

  try {
    await resend.emails.send({
      from: fromEmail,
      to: payload.email,
      subject: leadSubject,
      html: brandedShell(leadSubject, leadInner),
    });

    await resend.emails.send({
      from: fromEmail,
      to: notifyEmail,
      replyTo: payload.email,
      subject: `New audit request: ${payload.company} (${payload.trade})`,
      html: notifyHtml,
    });

    return { sent: true };
  } catch (error) {
    console.error("[email] failed to send book-audit emails", error);
    return { sent: false };
  }
}
