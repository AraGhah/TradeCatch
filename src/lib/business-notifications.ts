/**
 * Business owner notifications (email). Gated by BUSINESS_NOTIFICATIONS entitlement
 * at the call site. Never invents success if Resend is unset.
 */

import { Resend } from "resend";

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

export type BusinessNotifyInput = {
  toEmail: string;
  subject: string;
  title: string;
  lines: { label: string; value?: string | null }[];
  ctaUrl?: string;
  ctaLabel?: string;
};

export async function sendBusinessNotifyEmail(
  input: BusinessNotifyInput,
): Promise<{ sent: boolean; reason?: string }> {
  const resend = getClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resend || !fromEmail) {
    return { sent: false, reason: "resend_not_configured" };
  }
  if (!input.toEmail.trim()) {
    return { sent: false, reason: "missing_to" };
  }

  const rows = input.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5C6875;">${escapeHtml(l.label)}</td><td style="padding:6px 0;color:#1A2430;">${escapeHtml(l.value || "—")}</td></tr>`,
    )
    .join("");

  const cta =
    input.ctaUrl && input.ctaLabel
      ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#0C141E;color:#fff;text-decoration:none;padding:10px 16px;border-radius:4px;font-size:14px;">${escapeHtml(input.ctaLabel)}</a></p>`
      : "";

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#F4F1EC;font-family:IBM Plex Sans,Helvetica,Arial,sans-serif;color:#1A2430;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid rgba(12,20,30,0.1);padding:32px;">
    <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C6875;">TradeCatch</p>
    <h1 style="margin:12px 0 0;font-size:22px;color:#0C141E;">${escapeHtml(input.title)}</h1>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:16px;">${rows}</table>
    ${cta}
  </div></body></html>`;

  try {
    await resend.emails.send({
      from: fromEmail,
      to: input.toEmail,
      subject: input.subject,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error("[business-notify] send failed", err);
    return { sent: false, reason: "send_failed" };
  }
}

/** Optional SMS notify to owner phone via injected port. */
export async function sendBusinessNotifySms(input: {
  sms: { send: (m: { toE164: string; fromE164: string; body: string }) => Promise<unknown> };
  toE164: string;
  fromE164: string;
  body: string;
}): Promise<{ sent: boolean }> {
  try {
    await input.sms.send({
      toE164: input.toE164,
      fromE164: input.fromE164,
      body: input.body,
    });
    return { sent: true };
  } catch (err) {
    console.error("[business-notify] sms failed", err);
    return { sent: false };
  }
}
