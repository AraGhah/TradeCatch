/**
 * Approved spoken copy (FR-CA / EN). Automated speech never diagnoses a
 * problem, never promises an arrival time, and only gives the standard 9-1-1
 * referral for danger — consistent with Module A messaging rules.
 */

import type { ReceptionistConfig, ReceptionistLanguage } from "./types";

type Copy = Record<ReceptionistLanguage, string>;

export const PHRASES = {
  /** Each half is spoken with its own voice (see languageMenuPrompts). */
  languageMenu: {
    fr: "Pour le service en français, dites français ou appuyez sur 1.",
    en: "For English, say English or press 2.",
  },
  askReason: {
    fr: "Comment puis-je vous aider aujourd'hui?",
    en: "How can I help you today?",
  },
  askName: {
    fr: "Parfait. Quel est votre nom, s'il vous plaît?",
    en: "Got it. May I have your name, please?",
  },
  askAddress: {
    fr: "Merci {name}. Quelle est l'adresse où le service est requis?",
    en: "Thanks {name}. What is the address where you need the service?",
  },
  askCallback: {
    fr: "Est-ce que le {phone} est le bon numéro pour vous rappeler? Dites oui ou non.",
    en: "Is {phone} the best number to call you back? Please say yes or no.",
  },
  askCallbackNumber: {
    fr: "D'accord. Dites ou composez le numéro à 10 chiffres où l'on peut vous joindre.",
    en: "Okay. Please say or key in the 10-digit number where we can reach you.",
  },
  askPreferredTime: {
    fr: "Quel moment vous conviendrait le mieux pour qu'on vous rappelle ou qu'on passe?",
    en: "When would be the best time for us to call you back or come by?",
  },
  anythingElse: {
    fr: "Y a-t-il autre chose que je peux faire pour vous?",
    en: "Is there anything else I can help you with?",
  },
  listening: {
    fr: "Je vous écoute.",
    en: "Go ahead, I'm listening.",
  },
  noted: {
    fr: "C'est noté.",
    en: "Noted.",
  },
  wrapUp: {
    fr: "Merci {name}. J'ai bien noté votre demande et un membre de l'équipe vous rappellera {when}. Bonne journée!",
    en: "Thank you {name}. I've noted your request and someone from the team will call you back {when}. Have a great day!",
  },
  whenSoon: { fr: "dès que possible", en: "as soon as possible" },
  whenOpening: { fr: "dès l'ouverture", en: "as soon as we open" },
  reprompt: {
    fr: "Désolée, je n'ai pas bien entendu. Pouvez-vous répéter?",
    en: "Sorry, I didn't catch that. Could you say it again?",
  },
  voicemailIntro: {
    fr: "Je vais plutôt prendre un message. Laissez votre nom, votre numéro et votre demande après le bip, puis appuyez sur le carré.",
    en: "Let me take a message instead. Please leave your name, number and request after the beep, then press pound.",
  },
  voicemailThanks: {
    fr: "Merci, votre message a été transmis à l'équipe. Au revoir.",
    en: "Thank you, your message has been sent to the team. Goodbye.",
  },
  transferring: {
    fr: "Je vous transfère à {target}. Un instant, s'il vous plaît.",
    en: "I'm transferring you to {target}. One moment, please.",
  },
  transferFailed: {
    fr: "{target} n'est pas disponible pour le moment. Je vais prendre votre demande pour qu'on vous rappelle.",
    en: "{target} isn't available right now. I'll take your request so we can call you back.",
  },
  humanAfterHours: {
    fr: "Il n'y a personne au bureau en ce moment, mais je transmets votre demande dès maintenant.",
    en: "Nobody is in the office right now, but I'll pass your request along right away.",
  },
  emergencyTransfer: {
    fr: "Si quelqu'un est en danger immédiat, raccrochez et composez le 9-1-1. Je vous mets en ligne avec notre équipe de garde.",
    en: "If anyone is in immediate danger, hang up and dial 9-1-1. I'm connecting you with our on-call team now.",
  },
  emergencyNoTransfer: {
    fr: "Si quelqu'un est en danger immédiat, raccrochez et composez le 9-1-1. Je signale votre appel comme urgent à l'équipe.",
    en: "If anyone is in immediate danger, hang up and dial 9-1-1. I'm flagging your call as urgent for the team.",
  },
  technicalIssue: {
    fr: "Désolée, nous éprouvons un problème technique.",
    en: "Sorry, we're having a technical issue.",
  },
  goodbye: {
    fr: "Merci d'avoir appelé {business}. Au revoir!",
    en: "Thank you for calling {business}. Goodbye!",
  },
} satisfies Record<string, Copy>;

export type PhraseKey = keyof typeof PHRASES;

export function phrase(
  key: PhraseKey,
  language: ReceptionistLanguage,
  vars: Record<string, string | undefined> = {},
): string {
  return PHRASES[key][language]
    .replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").trim())
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

export function languageMenuPrompts(): {
  text: string;
  lang: ReceptionistLanguage;
}[] {
  return [
    { text: PHRASES.languageMenu.fr, lang: "fr" },
    { text: PHRASES.languageMenu.en, lang: "en" },
  ];
}

export function greetingFor(
  config: ReceptionistConfig,
  language: ReceptionistLanguage,
): string {
  return language === "fr" ? config.greetingFr : config.greetingEn;
}

export function afterHoursFor(
  config: ReceptionistConfig,
  language: ReceptionistLanguage,
): string {
  return language === "fr"
    ? config.afterHoursMessageFr
    : config.afterHoursMessageEn;
}

/** Speech-recognition hints per step improve Twilio ASR accuracy. */
export function hintsFor(config: ReceptionistConfig): string[] {
  const words = new Set<string>([
    "oui",
    "non",
    "français",
    "English",
    "yes",
    "no",
    "rendez-vous",
    "appointment",
    "soumission",
    "quote",
    "urgence",
    "emergency",
  ]);
  for (const r of config.routing) {
    words.add(r.name);
    for (const k of r.keywords.slice(0, 5)) words.add(k);
  }
  return Array.from(words).slice(0, 50);
}
