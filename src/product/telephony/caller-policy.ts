/**
 * Who the AI receptionist must not answer, decided before any AI starts.
 *
 * The personal-contacts list lets a contractor keep friends, family or
 * suppliers away from the receptionist. Caller ID can be spoofed, so a match
 * only ever makes the call *less* capable (a short message, a ring to the
 * owner's own approved line, or a polite end). It never unlocks anything, and
 * the list itself is never sent to the voice agent or the language model —
 * the LiveKit agent receives only the computed policy for one call.
 */

import type { ReceptionistConfig, ReceptionistLanguage } from "@/product/receptionist/types";

export type CallerPolicyDecision =
  | { kind: "ai" }
  | { kind: "personal_message" }
  | { kind: "personal_transfer"; transferE164: string }
  | { kind: "personal_end" }
  | { kind: "unknown_message" };

/**
 * Caller IDs carriers and Twilio use for a withheld number
 * (anonymous, unknown, restricted, blocked).
 */
const WITHHELD = new Set([
  "+266696687",
  "+86282452253",
  "+7378742833",
  "+2562533",
  "anonymous",
  "unknown",
  "restricted",
  "private",
  "blocked",
  "unavailable",
]);

const E164 = /^\+[1-9]\d{7,14}$/;

/** E.164 for a North American or + number, else null. */
export function callerE164(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (WITHHELD.has(trimmed.toLowerCase())) return null;
  const digits = trimmed.replace(/\D/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  if (WITHHELD.has(e164)) return null;
  return E164.test(e164) ? e164 : null;
}

type PolicyConfig = Pick<
  ReceptionistConfig,
  | "phoneNumberE164"
  | "personalContacts"
  | "personalCallPolicy"
  | "personalCallTransferE164"
  | "unknownCallerPolicy"
>;

export function callerPolicyFor(
  config: PolicyConfig,
  fromRaw: string | null | undefined,
): CallerPolicyDecision {
  const from = callerE164(fromRaw);
  if (!from) {
    return config.unknownCallerPolicy === "message"
      ? { kind: "unknown_message" }
      : { kind: "ai" };
  }
  const contacts = config.personalContacts ?? [];
  if (!contacts.includes(from)) return { kind: "ai" };

  const policy = config.personalCallPolicy ?? "message";
  if (policy === "end") return { kind: "personal_end" };
  if (policy === "transfer") {
    const target = config.personalCallTransferE164;
    // Never ring the number the caller just dialed, nor the caller back.
    if (
      target &&
      E164.test(target) &&
      target !== config.phoneNumberE164 &&
      target !== from
    ) {
      return { kind: "personal_transfer", transferE164: target };
    }
  }
  return { kind: "personal_message" };
}

const DEFAULT_PERSONAL: Record<ReceptionistLanguage, string> = {
  fr: "Merci de votre appel. Je ne peux pas répondre pour le moment, je vous rappelle dès que possible.",
  en: "Thanks for calling. I can't answer right now; I'll call you back as soon as I can.",
};

const UNKNOWN: Record<ReceptionistLanguage, (business: string) => string> = {
  fr: (b) =>
    `Vous avez joint ${b}. Nous ne prenons pas les appels à numéro masqué. Veuillez rappeler en affichant votre numéro. Merci.`,
  en: (b) =>
    `You've reached ${b}. We can't take calls from a hidden number. Please call back with your caller ID on. Thank you.`,
};

/** The words for a non-AI caller policy, in the line's languages, default first. */
export function personalCallMessage(
  config: Pick<
    ReceptionistConfig,
    | "businessName"
    | "languages"
    | "defaultLanguage"
    | "personalCallMessageFr"
    | "personalCallMessageEn"
  >,
  kind: "personal" | "unknown",
): { text: string; lang: ReceptionistLanguage }[] {
  const order: ReceptionistLanguage[] = [
    config.defaultLanguage,
    ...config.languages.filter((l) => l !== config.defaultLanguage),
  ];
  return order.map((lang) => {
    if (kind === "unknown") return { lang, text: UNKNOWN[lang](config.businessName) };
    const own = lang === "fr" ? config.personalCallMessageFr : config.personalCallMessageEn;
    return { lang, text: own?.trim() || DEFAULT_PERSONAL[lang] };
  });
}

/**
 * Spoken to whoever picks up the contractor's phone on a ring-first call.
 * A person presses 1; a carrier voicemail never does, so it is not mistaken
 * for the contractor answering.
 */
export function screeningPrompt(
  config: Pick<ReceptionistConfig, "businessName" | "defaultLanguage">,
): { text: string; lang: ReceptionistLanguage } {
  const lang = config.defaultLanguage;
  return lang === "fr"
    ? {
        lang,
        text: `Appel client pour ${config.businessName}. Appuyez sur 1 pour le prendre, sinon votre réceptionniste répondra.`,
      }
    : {
        lang,
        text: `Customer call for ${config.businessName}. Press 1 to take it, or your receptionist will answer.`,
      };
}
