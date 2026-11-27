import { escapeHtml } from "@/lib/escape";
import type { WebsiteRequest } from "./model";

/** The two decisions a customer is emailed about. */
export type WebsiteDecision = "approved" | "rejected";

export function isCustomerDecision(
  status: string,
): status is WebsiteDecision {
  return status === "approved" || status === "rejected";
}

/** "acme.ca" from "https://www.acme.ca/contact"; null for a new site or a bad URL. */
export function websiteDomain(url: string | null): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/** Resend key: one email per request, decision and decision time, ever. */
export function decisionEmailKey(request: WebsiteRequest): string {
  return `website-decision/${request.id}/${request.status}/${request.statusChangedAt}`;
}

const COPY = {
  en: {
    subject: {
      approved: "Your website request is approved",
      rejected: "Update on your website request",
    },
    hello: (name: string) => `Hi ${name},`,
    intro: {
      approved: (site: string) =>
        `Good news: we approved your website request for ${site}.`,
      rejected: (site: string) =>
        `We reviewed your website request for ${site} and cannot take it on as submitted.`,
    },
    newSite: "your new website",
    labels: {
      website: "Website",
      business: "Business",
      status: "New status",
      date: "Decision date",
      reason: "Reason",
    },
    status: { approved: "Approved", rejected: "Not approved" },
    nextTitle: "Next steps",
    next: {
      approved: [
        "We will send you the written scope and the final price to confirm.",
        "Nothing is charged until you confirm the quote.",
        "Follow the request from your dashboard at any time.",
      ],
      rejected: [
        "Reply to this email if you have questions or would like to discuss it.",
        "You can send a new request from your dashboard once the points above are addressed.",
        "Your TradeCatch subscription is not affected.",
      ],
    },
    cta: "Open my website requests",
    footer: "You received this email because you asked TradeCatch for a website service.",
  },
  fr: {
    subject: {
      approved: "Votre demande de site web est approuvée",
      rejected: "Suivi de votre demande de site web",
    },
    hello: (name: string) => `Bonjour ${name},`,
    intro: {
      approved: (site: string) =>
        `Bonne nouvelle : nous avons approuvé votre demande de site web pour ${site}.`,
      rejected: (site: string) =>
        `Nous avons étudié votre demande de site web pour ${site} et ne pouvons pas la réaliser telle quelle.`,
    },
    newSite: "votre nouveau site",
    labels: {
      website: "Site web",
      business: "Entreprise",
      status: "Nouveau statut",
      date: "Date de la décision",
      reason: "Motif",
    },
    status: { approved: "Approuvée", rejected: "Non approuvée" },
    nextTitle: "Prochaines étapes",
    next: {
      approved: [
        "Nous vous enverrons la portée écrite et le prix final à confirmer.",
        "Rien n’est facturé avant que vous confirmiez la soumission.",
        "Suivez la demande en tout temps depuis votre tableau de bord.",
      ],
      rejected: [
        "Répondez à ce courriel si vous avez des questions ou souhaitez en discuter.",
        "Vous pourrez envoyer une nouvelle demande depuis votre tableau de bord une fois les points ci-dessus réglés.",
        "Votre abonnement TradeCatch n’est pas touché.",
      ],
    },
    cta: "Voir mes demandes de site web",
    footer: "Vous recevez ce courriel parce que vous avez demandé un service de site web à TradeCatch.",
  },
} as const;

const TONE = {
  approved: { fg: "#14532D", bg: "#ECFDF3", border: "#A7E3BF" },
  rejected: { fg: "#7A2E0E", bg: "#FEF3EE", border: "#F4C7B0" },
} as const;

function formatDecisionDate(iso: string, language: "en" | "fr"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(date);
}

function detailRow(label: string, value: string): string {
  return `<tr>
      <td width="38%" valign="top" style="padding:10px 12px 10px 0;border-top:1px solid #ECE7DF;font-size:13px;line-height:20px;color:#5C6875;">${escapeHtml(label)}</td>
      <td valign="top" style="padding:10px 0;border-top:1px solid #ECE7DF;font-size:14px;line-height:20px;color:#0C141E;font-weight:600;">${escapeHtml(value)}</td>
    </tr>`;
}

/**
 * The customer's decision email, in the language they submitted in. Pure:
 * everything it shows comes from the request and the decision, all escaped.
 */
export function renderWebsiteDecisionEmail(
  request: WebsiteRequest,
  decision: { status: WebsiteDecision; reason: string | null; dashboardUrl: string },
): { subject: string; html: string; text: string } {
  const lang = request.language === "fr" ? "fr" : "en";
  const c = COPY[lang];
  const tone = TONE[decision.status];
  const domain = websiteDomain(request.currentWebsiteUrl);
  const site = domain ?? c.newSite;
  const date = formatDecisionDate(request.statusChangedAt, lang);
  const reason =
    decision.status === "rejected" ? decision.reason?.trim() || null : null;
  const subject = `${c.subject[decision.status]}${domain ? `: ${domain}` : ""}`;
  const steps = c.next[decision.status];

  const html = `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F1EC;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1EC;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4DED4;border-radius:12px;font-family:Helvetica,Arial,sans-serif;color:#1A2430;">
        <tr><td style="padding:28px 28px 0;">
          <p style="margin:0;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#5C6875;">TradeCatch</p>
          <p style="margin:16px 0 0;"><span style="display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid ${tone.border};background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:700;">${escapeHtml(c.status[decision.status])}</span></p>
          <h1 style="margin:12px 0 0;font-size:22px;line-height:28px;color:#0C141E;">${escapeHtml(c.subject[decision.status])}</h1>
          <p style="margin:16px 0 0;font-size:15px;line-height:24px;">${escapeHtml(c.hello(request.contactName))}</p>
          <p style="margin:8px 0 0;font-size:15px;line-height:24px;">${escapeHtml(c.intro[decision.status](site))}</p>
        </td></tr>
        <tr><td style="padding:20px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${detailRow(c.labels.website, site)}
            ${detailRow(c.labels.business, request.businessName)}
            ${detailRow(c.labels.status, c.status[decision.status])}
            ${detailRow(c.labels.date, date)}
          </table>
        </td></tr>
        ${
          reason
            ? `<tr><td style="padding:16px 28px 0;">
          <div style="border-left:3px solid ${tone.fg};background:${tone.bg};padding:12px 14px;border-radius:4px;">
            <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:${tone.fg};">${escapeHtml(c.labels.reason)}</p>
            <p style="margin:6px 0 0;font-size:14px;line-height:22px;color:#1A2430;">${escapeHtml(reason)}</p>
          </div>
        </td></tr>`
            : ""
        }
        <tr><td style="padding:20px 28px 0;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#0C141E;">${escapeHtml(c.nextTitle)}</p>
          <ol style="margin:8px 0 0;padding-left:20px;font-size:14px;line-height:22px;">
            ${steps.map((s) => `<li style="margin:0 0 6px;">${escapeHtml(s)}</li>`).join("")}
          </ol>
        </td></tr>
        <tr><td style="padding:16px 28px 28px;">
          <a href="${escapeHtml(decision.dashboardUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#0C141E;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(c.cta)}</a>
          <p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#5C6875;">${escapeHtml(c.footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    c.hello(request.contactName),
    "",
    c.intro[decision.status](site),
    "",
    `${c.labels.website}: ${site}`,
    `${c.labels.business}: ${request.businessName}`,
    `${c.labels.status}: ${c.status[decision.status]}`,
    `${c.labels.date}: ${date}`,
    ...(reason ? [`${c.labels.reason}: ${reason}`] : []),
    "",
    `${c.nextTitle}:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `${c.cta}: ${decision.dashboardUrl}`,
  ].join("\n");

  return { subject, html, text };
}
