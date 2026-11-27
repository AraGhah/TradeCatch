import { sendWebsiteRequestEmail } from "@/lib/email";
import { getResendClient } from "@/lib/resend-client";
import { getSiteUrl } from "@/lib/seo";
import {
  decisionEmailKey,
  isCustomerDecision,
  renderWebsiteDecisionEmail,
} from "./decision-email";
import type { WebsiteNotificationStatus, WebsiteRequest } from "./model";
import { getWebsiteRequestService } from "./runtime";
import type { WebsiteRequestService } from "./service";

type EnvLike = Record<string, string | undefined>;

/** Whether the server has what it needs to email the team. Presence only, never a value. */
export function teamEmailConfigured(env: EnvLike = process.env): boolean {
  return Boolean(
    env.RESEND_API_KEY?.trim() &&
      env.RESEND_FROM_EMAIL?.trim() &&
      (env.RESEND_NOTIFY_EMAIL?.trim() || env.ADMIN_ALERT_EMAIL?.trim()),
  );
}

/**
 * Tells the team a website request arrived and RECORDS what happened, so the
 * administration console can show whether the notification went out instead of
 * leaving the team to assume it did.
 *
 * The request row is the record; this email only prompts the team. A failure
 * here never fails the customer's submission.
 */
export async function notifyTeamOfWebsiteRequest(
  request: WebsiteRequest,
  idempotencyKey: string | undefined,
  deps: {
    send?: (
      request: WebsiteRequest,
      idempotencyKey?: string,
    ) => Promise<{ sent: boolean }>;
    service?: Pick<WebsiteRequestService, "recordNotification">;
    env?: EnvLike;
  } = {},
): Promise<WebsiteNotificationStatus> {
  const send = deps.send ?? sendWebsiteRequestEmail;
  const service = deps.service ?? getWebsiteRequestService();
  const configured = teamEmailConfigured(deps.env);

  let status: WebsiteNotificationStatus;
  try {
    const { sent } = await send(request, idempotencyKey);
    status = sent ? "sent" : configured ? "failed" : "not_configured";
  } catch {
    status = "failed";
  }
  try {
    await service.recordNotification(request.id, status);
  } catch (error) {
    console.error("[website-requests] could not record notification", error);
  }
  return status;
}

/** History note prefix of a decision email; the rest says which one and how it went. */
export const CUSTOMER_EMAIL_NOTE = "Customer email";

export type CustomerDecisionEmailResult =
  | "sent"
  | "already_sent"
  | "not_configured"
  | "failed"
  | "skipped";

/**
 * Emails the customer when their request is approved or rejected, and RECORDS
 * the outcome in the request's history.
 *
 * At most one email per request, decision and decision time: the history is
 * checked first, and Resend gets an idempotency key built from the same three
 * things, so a retried request or a replayed call cannot send it twice. Only
 * the one update that actually moved the status calls this (the store's
 * compare-and-set lets a single administrator win). A failure never undoes the
 * decision; the console shows it so the team can follow up by hand.
 */
export async function notifyCustomerOfDecision(
  request: WebsiteRequest,
  decision: { reason: string | null },
  deps: {
    service?: Pick<
      WebsiteRequestService,
      "history" | "recordCustomerNotification"
    >;
    send?: (email: {
      to: string;
      subject: string;
      html: string;
      text: string;
      idempotencyKey: string;
    }) => Promise<{ sent: boolean; configured: boolean }>;
    siteUrl?: string;
  } = {},
): Promise<CustomerDecisionEmailResult> {
  if (!isCustomerDecision(request.status)) return "skipped";
  const service = deps.service ?? getWebsiteRequestService();
  const key = decisionEmailKey(request);
  const marker = `${CUSTOMER_EMAIL_NOTE} ${request.status} [${request.statusChangedAt}]`;

  try {
    const events = await service.history(request.id);
    if (events.some((e) => e.kind === "notified" && e.note?.startsWith(`${marker}: sent`))) {
      return "already_sent";
    }
  } catch (error) {
    // Unknown history: still safe to try, the idempotency key guards Resend.
    console.error("[website-requests] could not read history before emailing", error);
  }

  const lang = request.language === "fr" ? "fr" : "en";
  const email = renderWebsiteDecisionEmail(request, {
    status: request.status,
    reason: decision.reason,
    dashboardUrl: `${(deps.siteUrl ?? getSiteUrl()).replace(/\/$/, "")}/${lang}/app/website-services`,
  });

  let result: CustomerDecisionEmailResult;
  try {
    const { sent, configured } = await (deps.send ?? sendCustomerEmail)({
      to: request.contactEmail,
      ...email,
      idempotencyKey: key,
    });
    result = sent ? "sent" : configured ? "failed" : "not_configured";
  } catch {
    result = "failed";
  }
  try {
    await service.recordCustomerNotification(request.id, `${marker}: ${result}`);
  } catch (error) {
    console.error("[website-requests] could not record the customer email", error);
  }
  return result;
}

async function sendCustomerEmail(email: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<{ sent: boolean; configured: boolean }> {
  const resend = getResendClient();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resend || !from) return { sent: false, configured: false };
  const replyTo =
    process.env.RESEND_NOTIFY_EMAIL?.trim() || process.env.ADMIN_ALERT_EMAIL?.trim();
  try {
    const res = await resend.emails.send(
      {
        from,
        to: email.to,
        ...(replyTo ? { replyTo } : {}),
        subject: email.subject.replace(/\s+/g, " ").trim(),
        html: email.html,
        text: email.text,
      },
      { idempotencyKey: email.idempotencyKey, signal: AbortSignal.timeout(8_000) },
    );
    if (res.error || !res.data?.id) {
      console.error("[email] website decision email rejected", res.error?.name);
      return { sent: false, configured: true };
    }
    return { sent: true, configured: true };
  } catch (error) {
    console.error("[email] website decision email failed", error);
    return { sent: false, configured: true };
  }
}
