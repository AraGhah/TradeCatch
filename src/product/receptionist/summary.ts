import type { LlmClient } from "./llm";
import type {
  CallIntent,
  CallOutcome,
  CallSession,
  CallSummary,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "./types";

const INTENT_LABEL: Record<CallIntent, Record<ReceptionistLanguage, string>> = {
  service_request: { fr: "Demande de service", en: "Service request" },
  appointment: { fr: "Demande de rendez-vous", en: "Appointment request" },
  faq: { fr: "Question", en: "Question" },
  transfer: { fr: "Transfert", en: "Transfer" },
  message: { fr: "Message", en: "Message" },
  emergency: { fr: "URGENCE", en: "EMERGENCY" },
  other: { fr: "Appel", en: "Call" },
};

export const OUTCOME_LABEL: Record<
  CallOutcome,
  Record<ReceptionistLanguage, string>
> = {
  message_taken: { fr: "Message pris", en: "Message taken" },
  appointment_requested: {
    fr: "Rendez-vous demandé",
    en: "Appointment requested",
  },
  transferred: { fr: "Transféré", en: "Transferred" },
  emergency_transferred: {
    fr: "Urgence transférée",
    en: "Emergency transferred",
  },
  faq_answered: { fr: "Question répondue", en: "Question answered" },
  voicemail: { fr: "Message vocal", en: "Voicemail" },
  caller_hung_up: { fr: "L'appelant a raccroché", en: "Caller hung up" },
  failed: { fr: "Échec technique", en: "Technical failure" },
};

function nextStepText(
  session: CallSession,
  outcome: CallOutcome,
  lang: ReceptionistLanguage,
): string {
  const fr = lang === "fr";
  const lastTransfer = session.transfers.at(-1);
  const callback = session.slots.callbackE164 ?? session.fromE164;
  switch (outcome) {
    case "emergency_transferred":
      return fr
        ? `URGENT : confirmer que ${lastTransfer?.targetName ?? "l'équipe de garde"} a bien pris l'appel.`
        : `URGENT: confirm ${lastTransfer?.targetName ?? "the on-call team"} handled the call.`;
    case "transferred":
      return fr
        ? `Appel transféré à ${lastTransfer?.targetName ?? "l'équipe"} — aucun suivi sauf si l'appel a coupé.`
        : `Call transferred to ${lastTransfer?.targetName ?? "the team"} — no follow-up unless it dropped.`;
    case "voicemail":
      return fr
        ? "Écouter le message vocal et rappeler."
        : "Listen to the voicemail and call back.";
    case "faq_answered":
      return fr ? "Aucun suivi requis." : "No follow-up needed.";
    case "caller_hung_up":
      return session.smsRecoveryTriggeredAt
        ? fr
          ? "Raccroché avant les détails — relance SMS automatique lancée."
          : "Hung up before details — automatic SMS follow-up started."
        : fr
          ? `Raccroché avant les détails — rappeler le ${callback}.`
          : `Hung up before details — call back ${callback}.`;
    case "failed":
      return fr
        ? `Rappeler le ${callback} (échec technique).`
        : `Call back ${callback} (technical failure).`;
    default:
      return session.afterHours
        ? fr
          ? `Rappeler le ${callback} dès l'ouverture.`
          : `Call back ${callback} when the office opens.`
        : fr
          ? `Rappeler le ${callback} dès que possible.`
          : `Call back ${callback} as soon as possible.`;
  }
}

function knownContactText(
  session: CallSession,
  lang: ReceptionistLanguage,
): string | undefined {
  const c = session.context;
  if (!c) return undefined;
  const fr = lang === "fr";
  const parts: string[] = [];
  if (c.websiteLeadId) {
    const who = c.websiteLeadName ? ` « ${c.websiteLeadName} »` : "";
    const what = c.websiteLeadService ? ` (${c.websiteLeadService})` : "";
    const when = c.websiteLeadAt
      ? ` ${fr ? "le" : "on"} ${c.websiteLeadAt.slice(0, 10)}`
      : "";
    parts.push(
      fr
        ? `Déjà un lead web${who}${what}${when}`
        : `Already a website lead${who}${what}${when}`,
    );
  }
  if (c.priorCalls > 0) {
    parts.push(
      fr
        ? `${c.priorCalls} appel(s) précédent(s)`
        : `${c.priorCalls} earlier call(s)`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Deterministic, structured summary (owner language = config.defaultLanguage). */
export function buildCallSummary(
  config: ReceptionistConfig,
  session: CallSession,
): CallSummary {
  const lang = config.defaultLanguage;
  const outcome = session.outcome ?? "caller_hung_up";
  const intent: CallIntent =
    session.urgency?.level === "critical"
      ? "emergency"
      : (session.intent ?? "other");
  const urgencyPrefix =
    session.urgency?.level === "critical"
      ? "🚨 "
      : session.urgency?.level === "priority"
        ? lang === "fr"
          ? "Prioritaire · "
          : "Priority · "
        : "";
  const who = session.slots.callerName ?? session.fromE164;
  const transferred = session.transfers.find((t) => t.status === "completed");

  return {
    headline: `${urgencyPrefix}${INTENT_LABEL[intent][lang]} — ${who} (${OUTCOME_LABEL[outcome][lang]})`,
    language: session.language,
    intent,
    outcome,
    urgency: session.urgency?.level ?? "unknown",
    callerE164: session.fromE164,
    callerName: session.slots.callerName,
    callbackE164: session.slots.callbackE164,
    serviceAddress: session.slots.serviceAddress,
    issue: session.slots.issue,
    preferredTime: session.slots.preferredTime,
    message: session.slots.message,
    transferredTo: transferred?.targetName,
    afterHours: session.afterHours,
    durationSeconds: session.durationSeconds,
    nextStep: nextStepText(session, outcome, lang),
    knownContact: knownContactText(session, lang),
  };
}

/** Optional 2–3 sentence prose summary; failures are swallowed. */
export async function generateAiSummary(
  llm: LlmClient | null,
  config: ReceptionistConfig,
  session: CallSession,
): Promise<string | undefined> {
  if (!llm) return undefined;
  const transcript = session.turns
    .filter((t) => t.speaker !== "system")
    .map(
      (t) => `${t.speaker === "agent" ? "Receptionist" : "Caller"}: ${t.text}`,
    )
    .join("\n");
  if (!transcript.trim()) return undefined;
  try {
    const text = await llm.generateText({
      system: `Summarize this phone call for the owner of ${config.businessName} in ${config.defaultLanguage === "fr" ? "Canadian French" : "English"}. 2–3 sentences, factual, no speculation, include what the caller needs and any time preference.`,
      user: transcript.slice(-8000),
      maxTokens: 250,
    });
    return text.slice(0, 1200) || undefined;
  } catch (err) {
    console.warn(
      "[receptionist] AI summary skipped",
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}
