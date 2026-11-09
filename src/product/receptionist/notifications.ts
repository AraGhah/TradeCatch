/**
 * Deliver call summaries to the configured channels (email / SMS / webhook).
 * Each channel is independent: one failing never blocks the others, and the
 * result is logged on the session — nothing reports success it did not get.
 */

import type { BusinessNotifyInput } from "@/lib/business-notifications";
import { smsFailureDisposition } from "@/product/missed-call/twilio";
import type { SmsPort } from "@/product/missed-call/types";
import { ownerCallEmail, ownerCallSms } from "./owner-call-alert";
import type {
  CallSession,
  CallSummary,
  NotificationChannel,
  NotificationDelivery,
  ReceptionistConfig,
} from "./types";

export type ReceptionistNotifier = {
  /**
   * `attempt` is 1 for the first delivery and counts up for retries; it is
   * recorded on every delivery so the dashboard and the retry job agree.
   */
  deliverSummary(
    config: ReceptionistConfig,
    session: CallSession,
    summary: CallSummary,
    options?: { attempt?: number },
  ): Promise<NotificationDelivery[]>;
  /** Immediate SMS to every SMS channel when a critical call comes in. */
  alertEmergency(
    config: ReceptionistConfig,
    session: CallSession,
    issue: string,
  ): Promise<NotificationDelivery[]>;
};

export type NotifierDeps = {
  sms: SmsPort;
  sendEmail?: (
    input: BusinessNotifyInput,
  ) => Promise<{ sent: boolean; reason?: string }>;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
};

/** Configured channels minus the ones the owner switched off. */
export function activeChannels(config: ReceptionistConfig): NotificationChannel[] {
  const muted = config.mutedNotificationChannels ?? [];
  return config.notifications.filter(
    (channel) => channel.type === "webhook" || !muted.includes(channel.type),
  );
}

/** Enough to tell recipients apart in the delivery log without storing the full address. */
export function maskDestination(
  channel: "sms" | "email" | "webhook",
  value: string,
): string {
  if (channel === "sms") return `•••${value.replace(/\D/g, "").slice(-4)}`;
  if (channel === "email") {
    const [local = "", domain = ""] = value.split("@");
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  try {
    return new URL(value).hostname;
  } catch {
    return "webhook";
  }
}

/** A short, value-free reason for a failed send (provider code when there is one). */
function failureCode(err: unknown, fallback: string): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "number" || (typeof code === "string" && /^[\w.-]{1,40}$/.test(code)))
    return `provider_${code}`;
  if (err instanceof Error && err.name && err.name !== "Error")
    return err.name.slice(0, 60);
  return fallback;
}

export function createReceptionistNotifier(
  deps: NotifierDeps,
): ReceptionistNotifier {
  const now = () => (deps.clock ? deps.clock() : new Date()).toISOString();
  const doFetch = deps.fetchImpl ?? fetch;

  async function sendSms(
    config: ReceptionistConfig,
    to: string,
    body: string,
    attempt = 1,
  ): Promise<NotificationDelivery> {
    const from = config.smsFromE164 ?? config.phoneNumberE164;
    try {
      // Always an owner/staff notification channel (config.notifications),
      // never the caller — exempt from the customer-facing abuse rate limit.
      const { sid } = await deps.sms.send({
        toE164: to,
        fromE164: from,
        body,
        internal: true,
      });
      return {
        at: now(),
        channel: "sms",
        ok: true,
        detail: sid,
        to: maskDestination("sms", to),
        attempt,
      };
    } catch (err) {
      // "uncertain" means the provider may already have delivered it; resending
      // would risk a duplicate text, so only a clear "retry" is retryable.
      const disposition = smsFailureDisposition(err);
      return {
        at: now(),
        channel: "sms",
        ok: false,
        // A provider code, never the message (it can quote the number).
        detail: failureCode(err, "sms_failed"),
        to: maskDestination("sms", to),
        attempt,
        retryable: disposition === "retry",
      };
    }
  }

  return {
    async deliverSummary(config, session, summary, options = {}) {
      const attempt = options.attempt ?? 1;
      const results: NotificationDelivery[] = [];
      // The owner asked for emergencies only: say nothing about routine calls.
      if (
        config.emergencyOnlyAlerts &&
        summary.urgency !== "critical" &&
        summary.outcome !== "emergency_transferred"
      )
        return results;
      for (const channel of activeChannels(config)) {
        if (channel.type === "sms") {
          results.push(
            await sendSms(
              config,
              channel.toE164,
              ownerCallSms(config, session, summary),
              attempt,
            ),
          );
        } else if (channel.type === "email") {
          const to = maskDestination("email", channel.to);
          if (!deps.sendEmail) {
            results.push({
              at: now(),
              channel: "email",
              ok: false,
              detail: "email_not_wired",
              to,
              attempt,
              retryable: false,
            });
            continue;
          }
          const r = await deps
            .sendEmail(ownerCallEmail(config, session, summary, channel.to))
            .catch(() => ({ sent: false, reason: "send_failed" }));
          results.push({
            at: now(),
            channel: "email",
            ok: r.sent,
            detail: r.reason,
            to,
            attempt,
            // The email carries an idempotency key, so a retry cannot double-send.
            retryable: !r.sent && r.reason === "send_failed",
          });
        } else {
          const headers: Record<string, string> = {
            "content-type": "application/json",
          };
          if (channel.secret)
            headers.authorization = `Bearer ${channel.secret}`;
          try {
            const res = await doFetch(channel.url, {
              method: "POST",
              headers,
              body: JSON.stringify({
                event: "receptionist.call.completed",
                configId: config.id,
                clientAccountId: config.clientAccountId,
                call: {
                  id: session.id,
                  callSid: session.callSid,
                  from: session.fromE164,
                  to: session.toE164,
                  language: session.language,
                  startedAt: session.startedAt,
                  endedAt: session.endedAt,
                  transfers: session.transfers,
                  recordingUrl: session.recordingUrl,
                },
                summary,
                transcript: session.turns,
              }),
              signal: AbortSignal.timeout(8000),
            });
            results.push({
              at: now(),
              channel: "webhook",
              ok: res.ok,
              detail: res.ok ? undefined : `http_${res.status}`,
              to: maskDestination("webhook", channel.url),
              attempt,
              // A 4xx is the receiver refusing the payload; retrying cannot help.
              retryable: !res.ok && (res.status >= 500 || res.status === 429),
            });
          } catch (err) {
            results.push({
              at: now(),
              channel: "webhook",
              ok: false,
              detail:
                err instanceof Error
                  ? err.message.slice(0, 200)
                  : "webhook_failed",
              to: maskDestination("webhook", channel.url),
              attempt,
              retryable: true,
            });
          }
        }
      }
      return results;
    },

    async alertEmergency(config, session, issue) {
      const fr = config.defaultLanguage === "fr";
      const body = [
        `🚨 [${config.businessName}] ${fr ? "APPEL URGENT en cours" : "URGENT CALL in progress"}`,
        `${fr ? "De" : "From"}: ${session.fromE164}`,
        `${fr ? "Dit" : "Said"}: ${issue.slice(0, 300)}`,
        config.emergencyTransferE164
          ? fr
            ? "Transfert vers la ligne de garde en cours."
            : "Transferring to the on-call line now."
          : fr
            ? "Aucune ligne de garde configurée. Rappeler immédiatement."
            : "No on-call line configured. Call back immediately.",
      ].join("\n");
      const results: NotificationDelivery[] = [];
      for (const channel of activeChannels(config)) {
        if (channel.type === "sms")
          results.push(await sendSms(config, channel.toE164, body));
      }
      return results;
    },
  };
}
