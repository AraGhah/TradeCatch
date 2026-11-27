import { parseAdminEntries } from "@/lib/admin-rbac";
import type { BusinessNotifyInput } from "@/lib/business-notifications";
import { AlertNotConfiguredError, type AlertNotifier } from "./alerts";

/**
 * Turns a finished, already-sanitized alert into emails to the administrators
 * (KAN-28). It adds nothing of its own to the content: whatever the alert
 * composer decided to say is exactly what is sent, so the "no secrets, no
 * customer data" guarantee is decided in one place.
 */

const MAX_RECIPIENTS = 5;
const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

function fromList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => EMAIL.test(entry));
}

/**
 * ADMIN_ALERT_EMAIL, else the existing RESEND_NOTIFY_EMAIL, else the platform
 * administrators already listed in TRADECATCH_ADMIN_EMAILS, so alerts have
 * somewhere to go on an installation that never set a dedicated address.
 */
export function resolveAlertRecipients(env: Record<string, string | undefined>): string[] {
  const configured = fromList(env.ADMIN_ALERT_EMAIL).length
    ? fromList(env.ADMIN_ALERT_EMAIL)
    : fromList(env.RESEND_NOTIFY_EMAIL).length
      ? fromList(env.RESEND_NOTIFY_EMAIL)
      : parseAdminEntries(env.TRADECATCH_ADMIN_EMAILS)
          .map((entry) => entry.email.trim().toLowerCase())
          .filter((email) => EMAIL.test(email));
  return [...new Set(configured)].slice(0, MAX_RECIPIENTS);
}

export function createAdminAlertNotifier(deps: {
  env: Record<string, string | undefined>;
  send: (input: BusinessNotifyInput) => Promise<{ sent: boolean; reason?: string }>;
}): AlertNotifier {
  return async (payload) => {
    if (payload.simulated) return;
    const recipients = resolveAlertRecipients(deps.env);
    if (recipients.length === 0) throw new AlertNotConfiguredError();

    let failures = 0;
    let providerMissing = 0;
    for (const [index, toEmail] of recipients.entries()) {
      try {
        const result = await deps.send({
          toEmail,
          subject: payload.subject,
          title: payload.title,
          lines: payload.lines,
          ctaUrl: payload.ctaUrl,
          ctaLabel: payload.ctaUrl ? "Open System Health" : undefined,
          idempotencyKey: `${payload.idempotencyKey}-r${index}`,
        });
        if (!result.sent) {
          failures += 1;
          if (result.reason === "resend_not_configured") providerMissing += 1;
        }
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) return;
    // The provider's own text is never carried into the error: it can echo the
    // address or the message, and the failure is stored and shown on the dashboard.
    if (providerMissing === failures) throw new AlertNotConfiguredError();
    throw new Error("Administrator alert email failed");
  };
}
