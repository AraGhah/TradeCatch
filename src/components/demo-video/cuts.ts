/**
 * The spoken and captioned script for both demo videos — the single source of
 * truth for narration audio, scene timing, burned-in captions and the VTT
 * tracks. Nothing here may imply more than the product does:
 *
 * - The receptionist takes an appointment *request*; the team confirms the
 *   slot (it never promises one on the call).
 * - Receptionist answering, transfer and summaries are a founder-configured
 *   pilot (docs/CAPABILITY_MATRIX.md); the closing card must keep saying so.
 * - The business, people and numbers are fictional and labelled illustrative.
 *
 * After editing any line, regenerate the media in this order:
 *   npx tsx scripts/demo-media.ts script | python scripts/generate-demo-narration.py
 *   npx tsx scripts/demo-media.ts captions
 *   node scripts/record-demo-video.mjs <cut> <locale>   (for each cut/locale)
 */

export type DemoLocale = "en" | "fr";
export type DemoCut = "platform" | "missed-call";

export const DEMO_CUTS: DemoCut[] = ["platform", "missed-call"];
export const DEMO_LOCALES: DemoLocale[] = ["en", "fr"];

/** `none` is a caption-only line: shown and captioned, never spoken. */
export type Voice = "narrator" | "agent" | "caller" | "caller2" | "none";

export type Segment = {
  voice: Voice;
  text: string;
  /** Words tinted orange in the burned-in caption. */
  highlights?: string[];
  /** Caption-only lines need an explicit on-screen hold. */
  holdSec?: number;
};

export type SceneKey =
  | "contractor"
  | "answer"
  | "liveCall"
  | "transfer"
  | "workspace"
  | "followUps"
  | "closing"
  | "textBack"
  | "leadCaptured"
  | "quoteFollowUp";

export type SceneScript = {
  key: SceneKey;
  /** The scene never runs shorter than this, even if its audio is brief. */
  minSec: number;
  segments: Record<DemoLocale, Segment[]>;
};

export const TTS_VOICES: Record<DemoLocale, Record<Exclude<Voice, "none">, string>> = {
  en: {
    narrator: "en-US-AndrewNeural",
    agent: "en-US-AvaNeural",
    caller: "en-US-ChristopherNeural",
    caller2: "en-US-GuyNeural",
  },
  fr: {
    narrator: "fr-CA-AntoineNeural",
    agent: "fr-CA-SylvieNeural",
    caller: "fr-CA-JeanNeural",
    caller2: "fr-CA-ThierryNeural",
  },
};

export const TTS_RATES: Record<DemoLocale, Record<Exclude<Voice, "none">, string>> = {
  en: { narrator: "+14%", agent: "+12%", caller: "+12%", caller2: "+16%" },
  fr: { narrator: "+26%", agent: "+22%", caller: "+22%", caller2: "+25%" },
};

/** Speaker labels used in the VTT track for dialogue lines. */
export const SPEAKER_LABELS: Record<DemoLocale, Record<Voice, string>> = {
  en: {
    narrator: "",
    agent: "Receptionist",
    caller: "Caller",
    caller2: "Caller",
    none: "",
  },
  fr: {
    narrator: "",
    agent: "Réceptionniste",
    caller: "Client",
    caller2: "Client",
    none: "",
  },
};

const PLATFORM: SceneScript[] = [
  {
    key: "contractor",
    minSec: 8,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "You're busy on the job. Your phone rings, but you can't answer. And just like that, a customer can move on to your competitor.",
          highlights: ["your competitor"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Vous êtes sur un chantier. Le téléphone sonne, mais vous ne pouvez pas répondre. Et ce client peut se tourner vers un concurrent.",
          highlights: ["un concurrent"],
        },
      ],
    },
  },
  {
    key: "answer",
    minSec: 8,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "Meet the TradeCatch Receptionist. It answers your calls as your business, in French or English, even when you can't pick up.",
          highlights: ["TradeCatch Receptionist"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Voici la réceptionniste TradeCatch. Elle répond à vos appels au nom de votre entreprise, en français ou en anglais, même quand vous ne pouvez pas décrocher.",
          highlights: ["réceptionniste TradeCatch"],
        },
      ],
    },
  },
  {
    key: "liveCall",
    minSec: 24,
    segments: {
      en: [
        { voice: "agent", text: "Thank you for calling NorthStar Plumbing! How can I help you today?" },
        { voice: "caller", text: "Hi, my kitchen sink is leaking. Do you do repairs in Laval?" },
        { voice: "agent", text: "Yes, we serve Laval and the surrounding area. Is the leak causing any flooding?" },
        { voice: "caller", text: "No, but I'd like someone to come by tomorrow." },
        { voice: "agent", text: "Of course. What time works best for you?" },
        { voice: "caller", text: "Around ten in the morning." },
        {
          voice: "agent",
          text: "Perfect. I've sent your request for tomorrow at 10 a.m. to the team. They'll text you shortly to confirm.",
        },
      ],
      fr: [
        { voice: "agent", text: "Merci d'avoir appelé Plomberie NorthStar! Comment puis-je vous aider?" },
        { voice: "caller", text: "Bonjour, l'évier de ma cuisine fuit. Faites-vous des réparations à Laval?" },
        { voice: "agent", text: "Oui, nous desservons Laval et les environs. Est-ce que la fuite cause une inondation?" },
        { voice: "caller", text: "Non, mais j'aimerais que quelqu'un passe demain." },
        { voice: "agent", text: "Bien sûr. Quelle heure vous conviendrait le mieux?" },
        { voice: "caller", text: "Vers dix heures du matin." },
        {
          voice: "agent",
          text: "Parfait. J'ai transmis votre demande pour demain à 10 h à l'équipe. Elle vous écrira sous peu pour confirmer.",
        },
      ],
    },
  },
  {
    key: "transfer",
    minSec: 12,
    segments: {
      en: [
        { voice: "caller2", text: "My basement is flooding! I need to speak to someone right now." },
        { voice: "agent", text: "I understand, this is urgent. I'm connecting you to the on-call technician right away." },
        {
          voice: "narrator",
          text: "Emergencies you define go straight to your on-call line.",
          highlights: ["on-call line"],
        },
      ],
      fr: [
        { voice: "caller2", text: "Mon sous-sol est inondé! Je dois parler à quelqu'un tout de suite." },
        { voice: "agent", text: "Je comprends, c'est urgent. Je vous transfère immédiatement au technicien de garde." },
        {
          voice: "narrator",
          text: "Les urgences que vous définissez vont directement à votre ligne de garde.",
          highlights: ["ligne de garde"],
        },
      ],
    },
  },
  {
    key: "workspace",
    minSec: 12,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "Every call lands in one workspace: the lead, the call summary and the appointment request. Your team confirms the visit in one click, without leaving the job.",
          highlights: ["one workspace", "one click"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Chaque appel arrive dans un seul espace de travail : la demande, le résumé de l'appel et la demande de rendez-vous. Votre équipe confirme la visite en un clic, sans quitter le chantier.",
          highlights: ["un seul espace de travail", "un clic"],
        },
      ],
    },
  },
  {
    key: "followUps",
    minSec: 8,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "And when a call goes unanswered or a quote goes quiet, automatic follow-ups keep the conversation moving.",
          highlights: ["automatic follow-ups"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Et quand un appel reste sans réponse ou qu'une soumission reste en suspens, les relances automatiques gardent la conversation active.",
          highlights: ["relances automatiques"],
        },
      ],
    },
  },
  {
    key: "closing",
    minSec: 8,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "Stop letting opportunities slip away. TradeCatch: every call counts.",
          highlights: ["every call counts"],
        },
        {
          voice: "none",
          text: "Illustrative demo with a fictional business. The Receptionist is a founder-configured pilot; features vary by plan.",
          highlights: ["Illustrative", "pilot"],
          holdSec: 4.5,
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Ne laissez plus filer les occasions. TradeCatch : chaque appel compte.",
          highlights: ["chaque appel compte"],
        },
        {
          voice: "none",
          text: "Démonstration illustrative avec une entreprise fictive. La réceptionniste est un pilote configuré par le fondateur; les fonctions varient selon le forfait.",
          highlights: ["illustrative", "pilote"],
          holdSec: 4.5,
        },
      ],
    },
  },
];

const MISSED_CALL: SceneScript[] = [
  {
    key: "contractor",
    minSec: 7,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "You're working. A customer calls. You miss it. And that customer might already be calling your competitor.",
          highlights: ["your competitor"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Vous travaillez. Un client appelle. Vous manquez l'appel. Et ce client est peut-être déjà en train d'appeler votre concurrent.",
          highlights: ["votre concurrent"],
        },
      ],
    },
  },
  {
    key: "textBack",
    minSec: 11,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "With TradeCatch, an eligible missed call triggers a text back under your company's name, so you reconnect before the opportunity disappears.",
          highlights: ["text back"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Avec TradeCatch, un appel manqué admissible déclenche un texto au nom de votre entreprise, pour reprendre contact avant que l'occasion disparaisse.",
          highlights: ["texto"],
        },
      ],
    },
  },
  {
    key: "leadCaptured",
    minSec: 9,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "TradeCatch captures the conversation, organizes the lead, and keeps you informed, all in one workspace.",
          highlights: ["one workspace"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "TradeCatch enregistre la conversation, organise la demande et vous tient informé, dans un seul espace de travail.",
          highlights: ["un seul espace de travail"],
        },
      ],
    },
  },
  {
    key: "quoteFollowUp",
    minSec: 9,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "Sent a quote and heard nothing back? TradeCatch follows up automatically, and a reply stops the sequence.",
          highlights: ["reply stops the sequence"],
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Une soumission envoyée, mais aucune nouvelle? TradeCatch relance automatiquement, et une réponse arrête la séquence.",
          highlights: ["réponse arrête la séquence"],
        },
      ],
    },
  },
  {
    key: "closing",
    minSec: 7,
    segments: {
      en: [
        {
          voice: "narrator",
          text: "Less chasing. More opportunities. TradeCatch: every call counts.",
          highlights: ["every call counts"],
        },
        {
          voice: "none",
          text: "Illustrative demo with a fictional business. Missed-call recovery runs as a controlled pilot.",
          highlights: ["Illustrative", "controlled pilot"],
          holdSec: 3,
        },
      ],
      fr: [
        {
          voice: "narrator",
          text: "Moins de temps à courir après les clients. Plus d'occasions. TradeCatch : chaque appel compte.",
          highlights: ["chaque appel compte"],
        },
        {
          voice: "none",
          text: "Démonstration illustrative avec une entreprise fictive. La récupération des appels manqués fonctionne en pilote contrôlé.",
          highlights: ["illustrative", "pilote contrôlé"],
          holdSec: 3,
        },
      ],
    },
  },
];

export const CUT_SCRIPTS: Record<DemoCut, SceneScript[]> = {
  platform: PLATFORM,
  "missed-call": MISSED_CALL,
};

/** Where a cut's media lives under /public. */
export const CUT_MEDIA: Record<
  DemoCut,
  { video: Record<DemoLocale, string>; captions: Record<DemoLocale, string> }
> = {
  platform: {
    video: {
      en: "/demo-video/TradeCatch-Platform-EN.mp4",
      fr: "/demo-video/TradeCatch-Platform-FR.mp4",
    },
    captions: {
      en: "/demo-video/captions/platform-en.vtt",
      fr: "/demo-video/captions/platform-fr.vtt",
    },
  },
  "missed-call": {
    video: {
      en: "/demo-video/TradeCatch-MissedCall-EN.mp4",
      fr: "/demo-video/TradeCatch-MissedCall-FR.mp4",
    },
    captions: {
      en: "/demo-video/captions/missed-call-en.vtt",
      fr: "/demo-video/captions/missed-call-fr.vtt",
    },
  },
};

/** Phrases the published captions must keep, so a re-cut cannot drop them. */
export const HONESTY_MARKERS: Record<DemoCut, Record<DemoLocale, string[]>> = {
  platform: {
    en: ["Illustrative demo", "fictional business", "founder-configured pilot", "request"],
    fr: ["Démonstration illustrative", "entreprise fictive", "pilote configuré", "demande"],
  },
  "missed-call": {
    en: ["Illustrative demo", "fictional business", "controlled pilot"],
    fr: ["Démonstration illustrative", "entreprise fictive", "pilote contrôlé"],
  },
};

/** Gaps used when laying segments out back to back (seconds). */
export const LAYOUT = {
  leadIn: 0.4,
  dialogueGap: 0.3,
  narratorGap: 0.6,
  tail: 0.9,
} as const;
