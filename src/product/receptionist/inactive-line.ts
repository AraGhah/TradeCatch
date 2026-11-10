/**
 * What a caller hears when the business has switched its receptionist off.
 *
 * A switched-off line never starts a conversation, never greets as the
 * receptionist and never collects details. The only thing a caller gets is one
 * short, fixed notice, in the business's language(s), read verbatim. The notice
 * promises nothing (no callback, no voicemail, no transfer): nothing here
 * invents a number or a behaviour the business did not configure.
 */

import type { ReceptionistLanguage } from "./types";

export type InactiveNoticeLine = { lang: ReceptionistLanguage; text: string };

export type InactiveReason = "deactivated" | "disabled";

/** Same rule as the voice agent's caller-policy lines: no markup, bounded. */
function safeName(name: string): string {
  return name.replace(/[<>{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function line(lang: ReceptionistLanguage, business: string): string {
  if (lang === "fr") {
    return business
      ? `Vous avez joint ${business}. Nous ne pouvons pas répondre à votre appel pour le moment. Veuillez rappeler plus tard.`
      : "Nous ne pouvons pas répondre à votre appel pour le moment. Veuillez rappeler plus tard.";
  }
  return business
    ? `You have reached ${business}. We are unable to take your call right now. Please call back later.`
    : "We are unable to take your call right now. Please call back later.";
}

/**
 * The notice lines, default language first. A bilingual business gets both
 * (the caller's language is not known: nothing was said that detects it).
 */
export function inactiveLineNotice(input: {
  businessName: string;
  languages: ReceptionistLanguage[];
  defaultLanguage?: ReceptionistLanguage;
}): InactiveNoticeLine[] {
  const business = safeName(input.businessName);
  const wanted = input.languages.length > 0 ? input.languages : ["fr" as const];
  const first = input.defaultLanguage && wanted.includes(input.defaultLanguage)
    ? input.defaultLanguage
    : wanted[0]!;
  const ordered = [first, ...wanted.filter((l) => l !== first)];
  return ordered.map((lang) => ({ lang, text: line(lang, business) }));
}
