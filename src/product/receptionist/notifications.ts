/**
 * Deliver call summaries to the configured channels (email / SMS / webhook).
 * Each channel is independent: one failing never blocks the others, and the
 * result is logged on the session — nothing reports success it did not get.
 */

import type { BusinessNotifyInput } from "@/lib/business-notifications";
import type { SmsPort } from "@/product/missed-call/types";
import { OUTCOME_LABEL } from "./summary";
import type {
  CallSession,
  CallSummary,
  NotificationDelivery,
  ReceptionistConfig,
} from "./types";

export type ReceptionistNotifier = {
  deliverSummary(
    config: ReceptionistConfig,
    session: CallSession,
    summary: CallSummary,
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

function smsBody(config: ReceptionistConfig, summary: CallSummary): string {
  const fr = config.defaultLanguage === "fr";
  const parts = [
    `[${config.businessName}] ${fr ? "Appel IA" : "AI call"}: ${summary.headline}`,
    summary.callbackE164
      ? `${fr ? "Rappel" : "Callback"}: ${summary.callbackE164}`
      : `${fr ? "De" : "From"}: ${summary.callerE164}`,
    summary.serviceAddress
      ? `${fr ? "Adresse" : "Address"}: ${summary.serviceAddress}`
      : "",
    summary.issue ? `${fr ? "Demande" : "Request"}: ${summary.issue}` : "",
    summary.preferredTime
      ? `${fr ? "Moment" : "Time"}: ${summary.preferredTime}`
      : "",
    summary.message ? `${fr ? "Note" : "Note"}: ${summary.message}` : "",
    summary.knownContact
      ? `${fr ? "Contact connu" : "Known contact"}: ${summary.knownContact}`
      : "",
    `→ ${summary.nextStep}`,
  ].filter(Boolean);
  return parts.join("\n").slice(0, 900);
}

function emailInput(
  config: ReceptionistConfig,
  session: CallSession,
  summary: CallSummary,
  to: string,
): BusinessNotifyInput {
  const fr = config.defaultLanguage === "fr";
  const transcript = session.turns
    .filter((t) => t.speaker !== "system")
    .map(
      (t) =>
        `${t.speaker === "agent" ? (fr ? "Réception" : "Receptionist") : fr ? "Appelant" : "Caller"}: ${t.text}`,
    )
    .join("\n");
  return {
    toEmail: to,
    subject: `${summary.headline} · ${config.businessName}`,
    title: summary.headline,
    lines: [
      {
        label: fr ? "Résultat" : "Outcome",
        value: OUTCOME_LABEL[summary.outcome][config.defaultLanguage],
      },
      { label: fr ? "Prochaine étape" : "Next step", value: summary.nextStep },
      { label: fr ? "Nom" : "Name", value: summary.callerName },
      {
        label: fr ? "Numéro appelant" : "Caller ID",
        value: summary.callerE164,
      },
      { label: fr ? "Rappel" : "Callback", value: summary.callbackE164 },
      { label: fr ? "Adresse" : "Address", value: summary.serviceAddress },
      { label: fr ? "Demande" : "Request", value: summary.issue },
      {
        label: fr ? "Moment souhaité" : "Preferred time",
        value: summary.preferredTime,
      },
      { label: "Note", value: summary.message },
      {
        label: fr ? "Contact connu" : "Known contact",
        value: summary.knownContact,
      },
      { label: fr ? "Urgence" : "Urgency", value: summary.urgency },
      {
        label: fr ? "Transféré à" : "Transferred to",
        value: summary.transferredTo,
      },
      {
        label: fr ? "Hors heures" : "After hours",
        value: summary.afterHours ? (fr ? "oui" : "yes") : fr ? "non" : "no",
      },
      {
        label: fr ? "Durée (s)" : "Duration (s)",
        value: summary.durationSeconds?.toString(),
      },
      { label: fr ? "Résumé IA" : "AI summary", value: summary.aiSummary },
      {
        label: fr ? "Message vocal" : "Voicemail",
        value: session.recordingUrl,
      },
      { label: "Transcript", value: transcript.slice(0, 6000) || undefined },
    ],
  };
}

export function createReceptionistNotifier(
  deps: NotifierDeps,
): ReceptionistNotifier {
  const now = () => (deps.clock ? deps.clock() : new Date()).toISOString();
  const doFetch = deps.fetchImpl ?? fetch;

  async function sendSms(config: ReceptionistConfig, to: string, body: string) {
    const from = config.smsFromE164 ?? config.phoneNumberE164;
    try {
      const { sid } = await deps.sms.send({ toE164: to, fromE164: from, body });
      return { at: now(), channel: "sms" as const, ok: true, detail: sid };
    } catch (err) {
      return {
        at: now(),
        channel: "sms" as const,
        ok: false,
        detail: err instanceof Error ? err.message.slice(0, 200) : "sms_failed",
      };
    }
  }

  return {
    async deliverSummary(config, session, summary) {
      const results: NotificationDelivery[] = [];
      for (const channel of config.notifications) {
        if (channel.type === "sms") {
          results.push(
            await sendSms(config, channel.toE164, smsBody(config, summary)),
          );
        } else if (channel.type === "email") {
          if (!deps.sendEmail) {
            results.push({
              at: now(),
              channel: "email",
              ok: false,
              detail: "email_not_wired",
            });
            continue;
          }
          const r = await deps.sendEmail(
            emailInput(config, session, summary, channel.to),
          );
          results.push({
            at: now(),
            channel: "email",
            ok: r.sent,
            detail: r.reason,
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
            ? "Aucune ligne de garde configurée — rappeler immédiatement."
            : "No on-call line configured — call back immediately.",
      ].join("\n");
      const results: NotificationDelivery[] = [];
      for (const channel of config.notifications) {
        if (channel.type === "sms")
          results.push(await sendSms(config, channel.toE164, body));
      }
      return results;
    },
  };
}
