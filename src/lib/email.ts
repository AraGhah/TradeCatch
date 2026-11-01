import { Resend } from "resend";
import type { BookAuditContactPayload } from "@/lib/validation/book-audit";
import type { ReferralSubmissionDetails } from "@/lib/validation/referral-submission";
import type { WebsiteRequest } from "@/product/website-services/model";

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

function row(
  label: string,
  value: string | undefined | null | boolean,
): string {
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

export async function sendBookAuditNotifyEmail(
  payload: BookAuditContactPayload,
  idempotencyKey?: string,
): Promise<{ sent: boolean }> {
  const resend = getClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const notifyEmail =
    process.env.RESEND_NOTIFY_EMAIL?.trim() ||
    process.env.ADMIN_ALERT_EMAIL?.trim();

  if (!resend || !fromEmail || !notifyEmail) {
    console.warn(
      "[email] Resend is not fully configured — skipping notify email.",
    );
    return { sent: false };
  }

  const notifyHtml = brandedShell(
    `New audit request: ${payload.company}`,
    `<table style="border-collapse:collapse;width:100%;font-size:14px;">
      ${row("Name", `${payload.firstName} ${payload.lastName}`)}
      ${row("Company", payload.company)}
      ${row("Trade", payload.trade)}
      ${row("Plan interest", payload.planInterest)}
      ${row("Referral code", payload.referralCode)}
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
      ${row("Service consent", payload.serviceConsent)}
      ${row("Consent wording", payload.consentWording)}
      ${row("Consent source", payload.consentSource)}
      ${row("Marketing consent", payload.marketingConsent)}
    </table>`,
  );

  try {
    const notifyResult = await resend.emails.send(
      {
        from: fromEmail,
        to: notifyEmail,
        replyTo: payload.email,
        subject: `New audit request: ${payload.company} (${payload.trade})`,
        html: notifyHtml,
      },
      { idempotencyKey, signal: AbortSignal.timeout(8_000) },
    );
    if (notifyResult.error || !notifyResult.data?.id) {
      console.error(
        "[email] notify email rejected by Resend",
        notifyResult.error,
      );
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error("[email] failed to send notify email", error);
    return { sent: false };
  }
}

/** Subject lines carry visitor text: collapse any line breaks. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Tells the team about a referral submitted on the public form. Nothing is
 * stored: the email is the record, so a failed send is reported to the caller
 * and the visitor is asked to retry instead of being told it went through.
 * The referred person is never emailed from here.
 */
export async function sendReferralSubmissionEmail(
  details: ReferralSubmissionDetails,
  idempotencyKey?: string,
): Promise<{ sent: boolean }> {
  const resend = getClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const notifyEmail =
    process.env.RESEND_NOTIFY_EMAIL?.trim() ||
    process.env.ADMIN_ALERT_EMAIL?.trim();

  if (!resend || !fromEmail || !notifyEmail) {
    console.warn(
      "[email] Resend is not fully configured — referral email not sent.",
    );
    return { sent: false };
  }

  const html = brandedShell(
    `New referral: ${details.businessName}`,
    `<p style="margin:0 0 12px;">${escapeHtml(details.referrerName)} referred a contractor and confirmed they have permission to share these details.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      ${row("Referred by", details.referrerName)}
      ${row("Referrer email", details.referrerEmail)}
      ${row("Referrer code", details.referralCode)}
      ${row("Contact", details.contactName)}
      ${row("Business", details.businessName)}
      ${row("Contact email", details.contactEmail)}
      ${row("Contact phone", details.contactPhone)}
      ${row("Language", details.language)}
      ${row("Note", details.note)}
    </table>
    <p style="margin:16px 0 0;">When you get in touch, say that ${escapeHtml(details.referrerName)} suggested it.</p>`,
  );

  try {
    const result = await resend.emails.send(
      {
        from: fromEmail,
        to: notifyEmail,
        replyTo: details.referrerEmail,
        subject: oneLine(
          `New referral: ${details.businessName} (from ${details.referrerName})`,
        ),
        html,
      },
      { idempotencyKey, signal: AbortSignal.timeout(8_000) },
    );
    if (result.error || !result.data?.id) {
      console.error("[email] referral email rejected by Resend", result.error);
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error("[email] failed to send referral email", error);
    return { sent: false };
  }
}

/**
 * Tells the team a Done-for-You Website Service request came in. The request
 * itself is stored (that is the record); this email is the nudge to answer it,
 * so a failed send is logged and reported but never loses the request.
 */
export async function sendWebsiteRequestEmail(
  request: WebsiteRequest,
  idempotencyKey?: string,
): Promise<{ sent: boolean }> {
  const resend = getClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const notifyEmail =
    process.env.RESEND_NOTIFY_EMAIL?.trim() ||
    process.env.ADMIN_ALERT_EMAIL?.trim();

  if (!resend || !fromEmail || !notifyEmail) {
    console.warn(
      "[email] Resend is not fully configured — website request email not sent.",
    );
    return { sent: false };
  }

  const kind =
    request.requestType === "new" ? "New website" : "Improve existing website";
  const html = brandedShell(
    `Website request: ${request.businessName}`,
    `<p style="margin:0 0 12px;">A website service request came in (${escapeHtml(kind)}). It is a separate one-time project starting at $349 CAD: confirm the scope and final price in writing before any payment.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      ${row("Business", request.businessName)}
      ${row("Contact", request.contactName)}
      ${row("Email", request.contactEmail)}
      ${row("Phone", request.contactPhone)}
      ${row("Type", kind)}
      ${row("Current website", request.currentWebsiteUrl)}
      ${row("Focus areas", request.focusAreas.join(", "))}
      ${row("Customer account", request.organizationId ? "yes (signed in)" : "no (public form)")}
      ${row("Asked from", request.source)}
      ${row("Language", request.language)}
      ${row("Notes", request.notes)}
    </table>`,
  );

  try {
    const result = await resend.emails.send(
      {
        from: fromEmail,
        to: notifyEmail,
        replyTo: request.contactEmail,
        subject: oneLine(
          `Website request: ${request.businessName} (${request.requestType})`,
        ),
        html,
      },
      { idempotencyKey, signal: AbortSignal.timeout(8_000) },
    );
    if (result.error || !result.data?.id) {
      console.error("[email] website request email rejected", result.error);
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error("[email] failed to send website request email", error);
    return { sent: false };
  }
}

export async function sendBookAuditCustomerEmail(
  payload: BookAuditContactPayload,
  idempotencyKey?: string,
): Promise<{ sent: boolean }> {
  const resend = getClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!resend || !fromEmail) {
    console.warn(
      "[email] Resend is not fully configured — skipping customer confirmation.",
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

  try {
    const leadResult = await resend.emails.send(
      {
        from: fromEmail,
        to: payload.email,
        subject: leadSubject,
        html: brandedShell(leadSubject, leadInner),
      },
      { idempotencyKey, signal: AbortSignal.timeout(8_000) },
    );
    if (leadResult.error || !leadResult.data?.id) {
      console.error(
        "[email] lead confirmation rejected by Resend",
        leadResult.error,
      );
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error("[email] failed to send customer confirmation", error);
    return { sent: false };
  }
}
