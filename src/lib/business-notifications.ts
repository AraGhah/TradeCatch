/**
 * Business owner notifications (email). Gated by BUSINESS_NOTIFICATIONS entitlement
 * at the call site. Never invents success if Resend is unset.
 */

import { escapeHtml } from "@/lib/escape";
import { getResendClient } from "@/lib/resend-client";

export type BusinessNotifyInput = {
  toEmail: string;
  subject: string;
  title: string;
  lines: { label: string; value?: string | null }[];
  /**
   * Optional headed groups rendered after `lines`. Rows with no value are left
   * out: a section never shows a placeholder for something nobody collected.
   */
  sections?: {
    heading: string;
    lines: { label: string; value?: string | null }[];
    /** Free paragraph text (e.g. a call summary), rendered under the rows. */
    body?: string;
  }[];
  ctaUrl?: string;
  ctaLabel?: string;
  idempotencyKey?: string;
  /**
   * The one thing the owner must see first (booked, emergency, transferred,
   * follow-up), as a coloured banner under the title.
   */
  status?: { tone: NotifyTone; label: string; detail?: string };
};

export type NotifyTone = "success" | "urgent" | "info" | "action";

/** Text, background and border per tone. Contrast checked against WCAG AA. */
const TONES: Record<NotifyTone, { fg: string; bg: string; border: string }> = {
  success: { fg: "#14532D", bg: "#ECFDF3", border: "#A7E3BF" },
  urgent: { fg: "#8A1C1C", bg: "#FEF2F2", border: "#F5B5B5" },
  info: { fg: "#1E3A5F", bg: "#EEF4FB", border: "#B9CFEA" },
  action: { fg: "#7A4A00", bg: "#FFF7E6", border: "#F2D08A" },
};

const LABEL_CELL =
  "padding:10px 12px 10px 0;border-top:1px solid #ECE7DF;font-size:13px;line-height:20px;color:#5C6875;vertical-align:top;";
const VALUE_CELL =
  "padding:10px 0;border-top:1px solid #ECE7DF;font-size:14px;line-height:20px;color:#0C141E;vertical-align:top;word-break:break-word;";

/** Label/value rows with one fixed label column, so every section lines up. */
function rowsTable(
  lines: { label: string; value?: string | null }[],
  dash: boolean,
): string {
  const rows = lines
    .filter((l) => dash || l.value)
    .map(
      (l) =>
        `<tr><td class="tc-l" width="38%" style="${LABEL_CELL}">${escapeHtml(l.label)}</td><td class="tc-v" style="${VALUE_CELL}">${escapeHtml(l.value || "—")}</td></tr>`,
    )
    .join("");
  return rows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;width:100%;">${rows}</table>`
    : "";
}

/** The owner email, as HTML. Pure (no sending) so it can be checked in tests. */
export function renderBusinessNotifyEmail(input: BusinessNotifyInput): string {
  const tone = input.status ? TONES[input.status.tone] : null;
  const banner =
    input.status && tone
      ? `<tr><td style="padding:16px 28px 0;"><div style="border:1px solid ${tone.border};background:${tone.bg};border-radius:8px;padding:12px 14px;"><p style="margin:0;font-size:15px;line-height:22px;font-weight:700;color:${tone.fg};">${escapeHtml(input.status.label)}</p>${
          input.status.detail
            ? `<p style="margin:2px 0 0;font-size:13px;line-height:20px;color:${tone.fg};">${escapeHtml(input.status.detail)}</p>`
            : ""
        }</div></td></tr>`
      : "";
  const own = rowsTable(input.lines, true);
  const sections = (input.sections ?? [])
    .map((sec) => {
      const table = rowsTable(sec.lines, false);
      if (!table && !sec.body) return "";
      const paragraph = sec.body
        ? `<p style="margin:${table ? "12px" : "0"} 0 0;font-size:14px;line-height:22px;color:#1A2430;white-space:pre-line;">${escapeHtml(sec.body)}</p>`
        : "";
      return `<tr><td style="padding:24px 28px 0;"><h2 style="margin:0 0 8px;font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#5C6875;font-weight:700;">${escapeHtml(sec.heading)}</h2>${table}${paragraph}</td></tr>`;
    })
    .join("");
  const cta =
    input.ctaUrl && input.ctaLabel
      ? `<tr><td style="padding:24px 28px 0;"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#0C141E;color:#FFFFFF;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:14px;font-weight:700;">${escapeHtml(input.ctaLabel)}</a></td></tr>`
      : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title>
<style>@media only screen and (max-width:480px){.tc-l,.tc-v{display:block!important;width:100%!important;}.tc-l{padding-bottom:0!important;}.tc-v{border-top:0!important;padding-top:2px!important;}}</style></head>
<body style="margin:0;padding:0;background:#F4F1EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1EC;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E4DED4;border-radius:12px;font-family:Helvetica,Arial,sans-serif;color:#1A2430;">
<tr><td style="padding:28px 28px 0;"><p style="margin:0;font-size:11px;line-height:16px;letter-spacing:1.6px;text-transform:uppercase;color:#5C6875;">TradeCatch</p><h1 style="margin:10px 0 0;font-size:22px;line-height:28px;color:#0C141E;">${escapeHtml(input.title)}</h1></td></tr>
${banner}
${own ? `<tr><td style="padding:16px 28px 0;">${own}</td></tr>` : ""}
${sections}
${cta}
<tr><td style="padding:28px;"></td></tr>
</table></td></tr></table></body></html>`;
}

function plainText(input: BusinessNotifyInput): string {
  const row = (l: { label: string; value?: string | null }) =>
    `${l.label}: ${l.value}`;
  const parts = [input.title];
  if (input.status)
    parts.push(
      [input.status.label, input.status.detail].filter(Boolean).join(" · "),
    );
  const own = input.lines.filter((l) => l.value).map(row);
  if (own.length) parts.push(own.join("\n"));
  for (const s of input.sections ?? []) {
    const lines = s.lines.filter((l) => l.value).map(row);
    if (!lines.length && !s.body) continue;
    parts.push(
      [s.heading.toUpperCase(), ...lines, s.body ?? ""]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (input.ctaUrl) parts.push(`${input.ctaLabel ?? "Open"}: ${input.ctaUrl}`);
  return parts.join("\n\n");
}

export async function sendBusinessNotifyEmail(
  input: BusinessNotifyInput,
): Promise<{ sent: boolean; reason?: string }> {
  const resend = getResendClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resend || !fromEmail) {
    return { sent: false, reason: "resend_not_configured" };
  }
  if (!input.toEmail.trim()) {
    return { sent: false, reason: "missing_to" };
  }

  const html = renderBusinessNotifyEmail(input);

  try {
    const result = await resend.emails.send(
      {
        from: fromEmail,
        to: input.toEmail,
        subject: input.subject,
        html,
        text: plainText(input),
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );
    if (result.error || !result.data?.id)
      return { sent: false, reason: "send_failed" };
    return { sent: true };
  } catch (err) {
    console.error("[business-notify] send failed", err);
    return { sent: false, reason: "send_failed" };
  }
}

/** Optional SMS notify to owner phone via injected port. */
export async function sendBusinessNotifySms(input: {
  sms: {
    send: (m: {
      toE164: string;
      fromE164: string;
      body: string;
      internal?: boolean;
    }) => Promise<unknown>;
  };
  toE164: string;
  fromE164: string;
  body: string;
}): Promise<{ sent: boolean }> {
  try {
    await input.sms.send({
      toE164: input.toE164,
      fromE164: input.fromE164,
      body: input.body,
      internal: true,
    });
    return { sent: true };
  } catch (err) {
    console.error("[business-notify] sms failed", err);
    return { sent: false };
  }
}
