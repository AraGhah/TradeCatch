/**
 * What the business owner receives after each finished call: a short SMS and a
 * detailed email. Pure formatting — no I/O — so the wording is easy to test.
 *
 * Only facts the call actually produced appear. A field nobody collected is left
 * out (never "Unknown", never guessed), and the SMS carries no transcript and no
 * street address: those stay behind the signed-in dashboard link.
 */

import type { BusinessNotifyInput } from "@/lib/business-notifications";
import { OUTCOME_LABEL } from "./summary";
import type {
  CallSession,
  CallSummary,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "./types";

type Lang = ReceptionistLanguage;

const URGENCY_LABEL: Record<CallSummary["urgency"], Record<Lang, string>> = {
  routine: { en: "Routine", fr: "Normale" },
  priority: { en: "High", fr: "Élevée" },
  critical: { en: "Emergency", fr: "Urgence" },
  unknown: { en: "Not assessed", fr: "Non évaluée" },
};

/** 126 -> "2m 06s", 45 -> "45s". */
export function formatDuration(seconds?: number): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
    return undefined;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m === 0 ? `${s}s` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/** "+15145550123" -> "+1 514-555-0123"; anything else is shown as received. */
export function formatPhone(e164?: string): string | undefined {
  if (!e164) return undefined;
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : e164;
}

/** What the owner has to do (or that nothing is needed), from the recorded outcome. */
export function nextActionLabel(summary: CallSummary, lang: Lang): string {
  const fr = lang === "fr";
  switch (summary.outcome) {
    case "appointment_booked":
      return fr ? "Rendez-vous réservé" : "Appointment booked";
    case "appointment_requested":
      return fr ? "Rendez-vous à confirmer" : "Appointment to confirm";
    case "transferred":
    case "emergency_transferred":
      return fr ? "Transféré à une personne" : "Transferred to a person";
    case "faq_answered":
      return fr ? "Question répondue" : "Question answered";
    case "failed":
      return fr ? "Échec technique — rappeler" : "Technical failure — call back";
    case "caller_hung_up":
      return fr ? "Appel interrompu — rappeler" : "Call dropped — call back";
    case "voicemail":
    case "message_taken":
    default:
      return fr ? "Rappel à faire" : "Callback needed";
  }
}

/** Absolute dashboard URL for one call, or undefined when no site origin is configured. */
export function dashboardCallUrl(
  lang: Lang,
  sessionId: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const origin = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!origin) return undefined;
  try {
    const base = new URL(origin);
    if (base.protocol !== "https:" && base.hostname !== "localhost")
      return undefined;
    // localePrefix is "as-needed": English has no prefix.
    const path = `${lang === "fr" ? "/fr" : ""}/app/receptionist`;
    return `${base.origin}${path}?call=${encodeURIComponent(sessionId)}`;
  } catch {
    return undefined;
  }
}

function service(session: CallSession): string | undefined {
  return session.slots.service?.trim() || session.slots.project?.trim() || undefined;
}

function line(label: string, value?: string): string {
  return value ? `${label}: ${value}` : "";
}

/**
 * Where the work is. The street address, plus the city when the caller gave it
 * separately; the city alone when that is all there is, so the owner never sees
 * an empty address for a call that named a place.
 */
export function jobAddress(summary: {
  serviceAddress?: string;
  location?: string;
}): string | undefined {
  const street = summary.serviceAddress?.trim();
  const place = summary.location?.trim();
  if (street && place && !street.toLowerCase().includes(place.toLowerCase())) {
    return `${street}, ${place}`;
  }
  return street || place || undefined;
}

/** The owner SMS. The owner's language is the profile's default language. */
export function ownerCallSms(
  config: ReceptionistConfig,
  session: CallSession,
  summary: CallSummary,
): string {
  const lang = config.defaultLanguage;
  const fr = lang === "fr";
  const url = dashboardCallUrl(lang, session.id);
  const issue = summary.issue?.slice(0, 140);
  const lines = [
    fr ? "TradeCatch | Nouvel appel" : "TradeCatch | New Call",
    line(fr ? "Client" : "Customer", summary.callerName),
    line(
      fr ? "Téléphone" : "Phone",
      formatPhone(summary.callbackE164 ?? summary.callerE164),
    ),
    line(fr ? "Service" : "Service", service(session)),
    line(fr ? "Problème" : "Issue", issue),
    // Only a level the call actually established; "not assessed" is not news.
    line(
      fr ? "Urgence" : "Urgency",
      summary.urgency === "unknown"
        ? undefined
        : URGENCY_LABEL[summary.urgency][lang],
    ),
    line(fr ? "Durée" : "Duration", formatDuration(summary.durationSeconds)),
    line(fr ? "Statut" : "Status", nextActionLabel(summary, lang)),
    url
      ? `${fr ? "Détails" : "Details"}: ${url}`
      : fr
        ? "Détails complets dans TradeCatch."
        : "View full details in TradeCatch.",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 600);
}

export function ownerCallEmailSubject(
  config: ReceptionistConfig,
): string {
  const fr = config.defaultLanguage === "fr";
  return `TradeCatch | ${fr ? "Résumé d'un nouvel appel client" : "New Customer Call Summary"} · ${config.businessName}`;
}

function yesNo(value: boolean, lang: Lang): string {
  return value ? (lang === "fr" ? "Oui" : "Yes") : lang === "fr" ? "Non" : "No";
}

/** The detailed owner email. `to` must already be a configured, validated recipient. */
export function ownerCallEmail(
  config: ReceptionistConfig,
  session: CallSession,
  summary: CallSummary,
  to: string,
): BusinessNotifyInput {
  const lang = config.defaultLanguage;
  const fr = lang === "fr";
  const url = dashboardCallUrl(lang, session.id);
  const booked = summary.appointment?.status === "booked";
  const transferred = Boolean(summary.transferredTo);
  const emergency =
    summary.urgency === "critical" || summary.outcome === "emergency_transferred";
  const needsFollowUp = !booked && !transferred && summary.outcome !== "faq_answered";
  const spoken = session.language;
  const when = new Date(session.startedAt).toLocaleString(
    fr ? "fr-CA" : "en-CA",
    { timeZone: config.timezone, dateStyle: "medium", timeStyle: "short" },
  );

  return {
    toEmail: to,
    subject: ownerCallEmailSubject(config),
    title: fr ? "Résumé d'un nouvel appel client" : "New Customer Call Summary",
    // One email per finished call and recipient, even if the report is retried.
    idempotencyKey: `rcs-${session.id}-email-${to.toLowerCase()}`.slice(0, 256),
    lines: [],
    sections: [
      {
        heading: fr ? "Informations sur l'appel" : "Call information",
        lines: [
          { label: fr ? "Date et heure" : "Date and time", value: when },
          {
            label: fr ? "Numéro de l'appelant" : "Caller number",
            value: formatPhone(summary.callerE164),
          },
          { label: fr ? "Durée" : "Duration", value: formatDuration(summary.durationSeconds) },
          { label: fr ? "Langue" : "Language", value: spoken === "fr" ? "Français" : "English" },
          {
            label: fr ? "Statut de l'appel" : "Call status",
            value: OUTCOME_LABEL[summary.outcome][lang],
          },
        ],
      },
      {
        heading: fr ? "Informations sur le client" : "Customer information",
        lines: [
          { label: fr ? "Nom" : "Name", value: summary.callerName },
          {
            label: fr ? "Numéro de rappel" : "Callback number",
            value: formatPhone(summary.callbackE164),
          },
          { label: fr ? "Courriel" : "Email", value: summary.email },
          { label: fr ? "Service demandé" : "Requested service", value: service(session) },
          { label: fr ? "Description du problème" : "Problem description", value: summary.issue },
          {
            label: fr ? "Détails du projet" : "Project details",
            // The service line already shows the project when there is no service name.
            value: session.slots.service ? session.slots.project : undefined,
          },
          { label: fr ? "Adresse" : "Address", value: jobAddress(summary) },
          {
            label: fr ? "Moment souhaité pour le rendez-vous" : "Preferred appointment time",
            value: summary.preferredTime,
          },
          { label: fr ? "Message" : "Message", value: summary.message },
        ],
      },
      {
        heading: fr ? "Résultat de l'appel" : "Call outcome",
        lines: [
          {
            label: fr ? "Rendez-vous" : "Appointment",
            value: booked
              ? `${fr ? "Réservé" : "Booked"}${summary.appointment?.label ? ` — ${summary.appointment.label}` : ""}`
              : summary.appointment?.status === "requested"
                ? fr ? "Demandé, non confirmé" : "Requested, not confirmed"
                : fr ? "Non réservé" : "Not booked",
          },
          { label: fr ? "Urgence détectée" : "Emergency detected", value: yesNo(emergency, lang) },
          {
            label: fr ? "Appel transféré" : "Call transferred",
            value: transferred
              ? `${yesNo(true, lang)} — ${summary.transferredTo}`
              : yesNo(false, lang),
          },
          { label: fr ? "Suivi requis" : "Follow-up required", value: yesNo(needsFollowUp, lang) },
          { label: fr ? "Prochaine étape" : "Next step", value: summary.nextStep },
        ],
      },
      {
        heading: fr ? "Résumé de la conversation" : "Conversation summary",
        lines: [],
        // The structured fields above are authoritative; the prose is only added
        // when the summary step produced one from the real conversation.
        body: summary.aiSummary,
      },
    ],
    ...(url
      ? {
          ctaUrl: url,
          ctaLabel: fr ? "Voir l'appel dans TradeCatch" : "View call in TradeCatch",
        }
      : {}),
  };
}
