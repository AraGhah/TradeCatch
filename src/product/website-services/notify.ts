import { sendWebsiteRequestEmail } from "@/lib/email";
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
