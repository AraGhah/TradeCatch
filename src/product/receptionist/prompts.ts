/**
 * Approved spoken copy (FR-CA / EN). Automated speech never diagnoses a
 * problem, never promises an arrival time, never states a price that was not
 * configured, and only gives the standard 9-1-1 referral for danger —
 * consistent with Module A messaging rules.
 *
 * Style: short sentences, one question at a time, the way a receptionist talks
 * on the phone. Acknowledgements ("Parfait.", "Got it.") rotate so the same
 * word is not said on every turn.
 */

import { splitGreeting } from "./language-select";
import type { ReceptionistConfig, ReceptionistLanguage } from "./types";

type Copy = Record<ReceptionistLanguage, string>;

export const PHRASES = {
  /** Spoken in French, right after the greeting. Nothing to press for French. */
  stayForFrench: {
    fr: "Pour continuer en français, restez en ligne.",
    en: "To continue in French, stay on the line.",
  },
  /** Spoken in English. 1 = English, 2 = French (see language-select.ts). */
  pressForEnglish: {
    fr: "For English, press 1.",
    en: "For English, press 1.",
  },
  languageSwitchedFr: {
    fr: "Bien sûr, je continue en français.",
    en: "Of course, I'll continue in French.",
  },
  languageSwitchedEn: {
    fr: "Of course, I'll continue in English.",
    en: "Of course, I'll continue in English.",
  },
  languageChosenFr: {
    fr: "Parfait, on continue en français.",
    en: "Perfect, we'll continue in French.",
  },
  languageChosenEn: {
    fr: "Sure, I'll continue in English.",
    en: "Sure, I'll continue in English.",
  },
  askReason: {
    fr: "Comment puis-je vous aider aujourd'hui?",
    en: "How can I help you today?",
  },
  /** After a price question that did not say what the job is. */
  askProject: {
    fr: "Dites-moi en quelques mots ce que vous avez en tête.",
    en: "Tell me a little about what you have in mind.",
  },
  askName: {
    fr: "Quel est votre nom, s'il vous plaît?",
    en: "Can I get your name, please?",
  },
  askAddress: {
    fr: "Quelle est l'adresse où le service est requis, {name}?",
    en: "What's the address where you need the service, {name}?",
  },
  askAddressIn: {
    fr: "C'est à quelle adresse, à {location}?",
    en: "What's the address in {location}?",
  },
  askCallback: {
    fr: "Est-ce que le {phone} est le bon numéro pour vous rappeler?",
    en: "Is {phone} the best number to call you back?",
  },
  askCallbackNumber: {
    fr: "Quel est le numéro à 10 chiffres où l'on peut vous joindre? Vous pouvez le dire ou le composer.",
    en: "What's the 10-digit number where we can reach you? You can say it or key it in.",
  },
  askPreferredTime: {
    fr: "Quel serait le meilleur moment pour qu'on vous rappelle ou qu'on passe?",
    en: "What's the best time for us to call you back or come by?",
  },
  /** Phone booking: every time read out comes from the scheduling backend. */
  offerSlots: {
    fr: "Voici les disponibilités : {options}. Dites ou appuyez sur le numéro de votre choix.",
    en: "Here are the openings I have: {options}. Please say or press the number you'd like.",
  },
  offerNearest: {
    fr: "Je n'ai rien à ce moment-là. Les prochaines disponibilités sont : {options}. Dites ou appuyez sur le numéro de votre choix.",
    en: "I don't have anything at that time. The next openings are: {options}. Please say or press the number you'd like.",
  },
  offerMore: {
    fr: "D'accord. J'ai aussi : {options}. Dites ou appuyez sur le numéro de votre choix.",
    en: "Okay. I also have: {options}. Please say or press the number you'd like.",
  },
  slotTaken: {
    fr: "Ce moment vient tout juste d'être pris. J'ai plutôt : {options}. Dites ou appuyez sur le numéro de votre choix.",
    en: "That time was just taken. I have these instead: {options}. Please say or press the number you'd like.",
  },
  offerRepeat: {
    fr: "Désolée, je n'ai pas bien compris. Je répète : {options}. Dites ou appuyez sur le numéro de votre choix.",
    en: "Sorry, I didn't catch that. Again: {options}. Please say or press the number you'd like.",
  },
  bookedConfirmed: {
    fr: "C'est confirmé, {name} : votre rendez-vous est le {when}. L'équipe a été avisée. Merci et bonne journée!",
    en: "You're booked, {name}: your appointment is {when}. The team has been notified. Thanks for calling, and have a great day!",
  },
  bookingRequestOnly: {
    fr: "Je n'ai pas pu réserver un moment automatiquement. J'ai bien noté votre demande et un membre de l'équipe vous rappellera pour confirmer un rendez-vous. Merci {name}!",
    en: "I wasn't able to reserve a time automatically. I've noted your request and someone from the team will call you to confirm an appointment. Thank you {name}!",
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
    fr: "Parfait, {name}. J'ai bien noté votre demande et un membre de l'équipe vous rappellera {when}. Merci d'avoir appelé et bonne journée!",
    en: "Perfect, {name}. I've noted your request and someone from the team will call you back {when}. Thanks for calling, and have a great day!",
  },
  whenSoon: { fr: "dès que possible", en: "as soon as possible" },
  whenOpening: { fr: "dès l'ouverture", en: "as soon as we open" },
  /** The recap before the call closes; the caller can correct any part. */
  recap: {
    fr: "Alors, si je comprends bien : {summary}. C'est bien ça?",
    en: "So, if I've got this right: {summary}. Is that correct?",
  },
  askCorrection: {
    fr: "D'accord. Qu'est-ce que je devrais corriger?",
    en: "No problem. What should I change?",
  },
  /** Recognition was unsure: ask again instead of guessing. */
  unclear: {
    fr: "Désolée, je n'ai pas bien saisi. Pouvez-vous répéter?",
    en: "Sorry, I didn't quite catch that. Could you say it again?",
  },
  unclearWithLanguage: {
    fr: "Désolée, je n'ai pas bien saisi. Pouvez-vous répéter? For English, press 1.",
    en: "Sorry, I didn't quite catch that. Could you say it again?",
  },
  stillThere: {
    fr: "Êtes-vous toujours là?",
    en: "Are you still there?",
  },
  silenceGoodbye: {
    fr: "Je n'entends plus rien, alors je vais vous laisser. N'hésitez pas à rappeler quand vous voulez. Au revoir!",
    en: "I'm not hearing anything, so I'll let you go. Feel free to call back anytime. Goodbye!",
  },
  voicemailIntro: {
    fr: "Votre message sera enregistré pour que notre équipe puisse vous répondre. Si vous ne souhaitez pas être enregistré, raccrochez avant le bip. Sinon, laissez votre nom, votre numéro et votre demande après le bip, puis appuyez sur le carré.",
    en: "Your message will be recorded so our team can respond. If you do not want to be recorded, hang up before the beep. Otherwise, leave your name, number and request after the beep, then press pound.",
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
  /** Honest, short, then back to the call. Never a claim to be human. */
  aiIdentity: {
    fr: "Oui, je suis l'assistante virtuelle de {business}. Je peux prendre votre demande ou vous mettre en contact avec l'équipe.",
    en: "Yes, I'm the virtual assistant for {business}. I can take your request or connect you with the team.",
  },
  /** Not about the business at all: one polite redirect, then the pending question. */
  offTopic: {
    fr: "Ça, je ne pourrai pas vous aider, mais je peux prendre votre demande de service.",
    en: "I can't help with that one, but I can take your service request.",
  },
  smallTalk: {
    fr: "Très bien, merci!",
    en: "I'm doing well, thank you!",
  },
  /** Said after a corrected detail is applied, before the call wraps up. */
  corrected: {
    fr: "C'est corrigé.",
    en: "Got it, I've updated that.",
  },
  correctedWith: {
    fr: "C'est corrigé : {what}.",
    en: "Got it, I've updated that: {what}.",
  },
  /** Stored (never spoken) when the caller would not give a name. */
  noNameGiven: {
    fr: "(nom non donné)",
    en: "(name not given)",
  },
  /** A price question with no approved price: no number, offer the estimate. */
  priceNoInfo: {
    fr: "Ça dépend un peu de la taille du projet et de ce qu'il y a à faire. Je peux vous organiser une estimation, si vous voulez.",
    en: "That depends a bit on the size of the project and what needs to be done. I can help you set up an estimate if you'd like.",
  },
  priceConfigured: {
    fr: "{price} Pour un prix précis, il faut voir le projet. Je peux vous organiser une estimation.",
    en: "{price} For an exact price we'd need to see the project. I can help you set up an estimate.",
  },
  priceAgain: {
    fr: "Le montant exact dépend de l'évaluation. Une personne de l'équipe pourra vous le confirmer.",
    en: "The exact amount depends on the assessment. Someone from the team can confirm it for you.",
  },
  serviceNotOffered: {
    fr: "Désolée, {service} ne fait pas partie de nos services.",
    en: "I'm sorry, {service} isn't something we offer.",
  },
  serviceNotOfferedList: {
    fr: "Désolée, {service} ne fait pas partie de nos services. Nous offrons : {services}.",
    en: "I'm sorry, {service} isn't something we offer. We do {services}.",
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
  const template: string = PHRASES[key][language];
  const text = template
    .replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").trim())
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A sentence that opens with a variable ("{target} n'est pas disponible…") gets a
  // capital even when the variable is lowercase. Fragments such as "dès l'ouverture",
  // which are dropped into other sentences, are left alone.
  return template.startsWith("{")
    ? text.replace(/^\p{Ll}/u, (c) => c.toUpperCase())
    : text;
}

const ACKNOWLEDGEMENTS: Record<ReceptionistLanguage, string[]> = {
  fr: ["Parfait.", "D'accord.", "Très bien.", "Je vois.", "Merci."],
  en: ["Got it.", "Okay.", "Sure.", "Perfect.", "Alright."],
};

/**
 * A short acknowledgement that changes from one turn to the next. Deterministic
 * (the caller passes the turn number) so a replayed call reads the same.
 */
export function acknowledgement(
  language: ReceptionistLanguage,
  turn: number,
): string {
  const list = ACKNOWLEDGEMENTS[language];
  return list[Math.abs(turn) % list.length]!;
}

/**
 * The language menu, spoken right after the French greeting: the French half in
 * the French voice, the English half in the English voice.
 */
export function languageMenuPrompts(): {
  text: string;
  lang: ReceptionistLanguage;
}[] {
  return [
    { text: PHRASES.stayForFrench.fr, lang: "fr" },
    { text: PHRASES.pressForEnglish.en, lang: "en" },
  ];
}

export function greetingFor(
  config: ReceptionistConfig,
  language: ReceptionistLanguage,
): string {
  return language === "fr" ? config.greetingFr : config.greetingEn;
}

/**
 * The owner's greeting without its closing question, so the question can be
 * asked once, after the language window. An empty greeting falls back to the
 * generic welcome rather than silence.
 */
export function greetingStatement(
  config: ReceptionistConfig,
  language: ReceptionistLanguage,
): string {
  const { statement } = splitGreeting(greetingFor(config, language));
  if (statement) return statement;
  return language === "fr"
    ? `Bonjour! Merci d'avoir appelé ${config.businessName}.`
    : `Thanks for calling ${config.businessName}!`;
}

/** The opening question: the owner's own if the greeting ended in one, else the default. */
export function openingQuestion(
  config: ReceptionistConfig,
  language: ReceptionistLanguage,
): string {
  return (
    splitGreeting(greetingFor(config, language)).question ??
    phrase("askReason", language)
  );
}

export function afterHoursFor(
  config: ReceptionistConfig,
  language: ReceptionistLanguage,
): string {
  return language === "fr"
    ? config.afterHoursMessageFr
    : config.afterHoursMessageEn;
}

/**
 * Speech-recognition hints improve Twilio ASR accuracy. The business's own words
 * (services, areas, departments) come first because the list is capped at 50 and
 * a generic word is easier to recognise than a street or a trade name.
 */
export function hintsFor(config: ReceptionistConfig): string[] {
  const own = new Set<string>();
  for (const s of config.services ?? []) own.add(s);
  for (const a of config.serviceAreas ?? []) own.add(a);
  for (const r of config.routing) {
    own.add(r.name);
    for (const k of r.keywords.slice(0, 5)) own.add(k);
  }
  const words = new Set<string>([
    ...own,
    "oui",
    "non",
    "français",
    "English",
    "yes",
    "no",
    "rendez-vous",
    "appointment",
    "soumission",
    "estimation",
    "estimate",
    "quote",
    "urgence",
    "emergency",
    "plomberie",
    "plumbing",
    "peinture",
    "painting",
    "chauffage",
    "heating",
    "toiture",
    "roofing",
    "rénovation",
    "renovation",
    "Montréal",
    "Laval",
    "Longueuil",
    "Brossard",
    "rue",
    "avenue",
    "boulevard",
  ]);
  return Array.from(words)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && w.length <= 100)
    .slice(0, 50);
}
