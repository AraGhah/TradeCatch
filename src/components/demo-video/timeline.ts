export type DemoLocale = "en" | "fr";

export type SceneId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Scene lengths are tuned per locale so the narration lands with roughly
 * one second of air on either side — no dead space, no clipped sentences.
 * Values come from scripts/measure-narration.mjs.
 */
export const SCENE_DURATIONS_SEC: Record<DemoLocale, Record<SceneId, number>> = {
  en: { 1: 7, 2: 9, 3: 12, 4: 10, 5: 8, 6: 12, 7: 9, 8: 10 },
  fr: { 1: 9, 2: 10, 3: 13, 4: 11, 5: 10, 6: 13, 7: 11, 8: 12 },
};

export type SceneWindow = {
  id: SceneId;
  start: number;
  end: number;
  duration: number;
};

const SCENE_ORDER: SceneId[] = [1, 2, 3, 4, 5, 6, 7, 8];

function buildScenes(locale: DemoLocale): SceneWindow[] {
  let cursor = 0;
  return SCENE_ORDER.map((id) => {
    const duration = SCENE_DURATIONS_SEC[locale][id];
    const window = { id, start: cursor, end: cursor + duration, duration };
    cursor += duration;
    return window;
  });
}

const SCENES_BY_LOCALE: Record<DemoLocale, SceneWindow[]> = {
  en: buildScenes("en"),
  fr: buildScenes("fr"),
};

export function scenesFor(locale: DemoLocale): SceneWindow[] {
  return SCENES_BY_LOCALE[locale];
}

export function totalDurationSec(locale: DemoLocale): number {
  const scenes = scenesFor(locale);
  return scenes[scenes.length - 1].end;
}

export function totalDurationMs(locale: DemoLocale): number {
  return totalDurationSec(locale) * 1000;
}

export const DEMO_DATA = {
  company: "NorthStar Plumbing",
  companyFr: "Plomberie NorthStar",
  location: "Laval, Québec",
  customer: "Sarah Martin",
  customerPhone: "438-555-0148",
  address: "2450 Rue des Érables, Laval",
  /** A range, not a promise — the system cannot price a job from a text thread. */
  emergencyRange: "CA$500 – CA$1,500",
  secondaryCustomer: "Michael Turner",
  secondaryValue: "CA$4,800",
  weekly: {
    missedCalls: 12,
    qualified: 9,
    appointments: 5,
    estimatesReactivated: 3,
    potentialValue: 14600,
  },
  /** The closing card shows the domain and the phone only — no personal inbox. */
  contact: {
    website: "tradecatch.ca",
    phone: "438-993-6997",
  },
} as const;

export type CaptionCue = {
  start: number;
  end: number;
  text: string;
  highlights?: string[];
};

/** Caption windows are fractions of their scene so they scale with locale. */
type CaptionPiece = {
  from: number;
  to: number;
  en: string;
  fr: string;
  highlightsEn?: string[];
  highlightsFr?: string[];
};

const CAPTION_PIECES: Record<SceneId, CaptionPiece[]> = {
  1: [
    {
      from: 0.02,
      to: 0.48,
      en: "You already paid to make the phone ring.",
      fr: "Vous avez déjà payé pour faire sonner le téléphone.",
      highlightsEn: ["already paid"],
      highlightsFr: ["déjà payé"],
    },
    {
      from: 0.5,
      to: 0.99,
      en: "But when you are working, you cannot always answer.",
      fr: "Mais quand vous travaillez, vous ne pouvez pas toujours répondre.",
    },
  ],
  2: [
    {
      from: 0.02,
      to: 0.46,
      en: "Trade Catch answers within seconds, under your company’s name.",
      fr: "Trade Catch répond en quelques secondes, au nom de votre entreprise.",
      highlightsEn: ["within seconds"],
      highlightsFr: ["quelques secondes"],
    },
    {
      from: 0.48,
      to: 0.99,
      en: "The customer stays engaged instead of calling your competitor.",
      fr: "Le client reste engagé au lieu d’appeler votre concurrent.",
      highlightsEn: ["your competitor"],
      highlightsFr: ["votre concurrent"],
    },
  ],
  3: [
    {
      from: 0.02,
      to: 0.6,
      en: "It collects the problem, the urgency, the address and a photo — while you stay on the job.",
      fr: "Le système recueille le problème, l’urgence, l’adresse et une photo — sans vous déranger.",
    },
    {
      from: 0.62,
      to: 0.99,
      en: "By the time you check your phone, the lead is already qualified.",
      fr: "Quand vous regardez votre téléphone, la demande est déjà qualifiée.",
      highlightsEn: ["already qualified"],
      highlightsFr: ["déjà qualifiée"],
    },
  ],
  4: [
    {
      from: 0.02,
      to: 0.42,
      en: "You receive one clear opportunity summary.",
      fr: "Vous recevez un seul résumé clair.",
      highlightsEn: ["one clear"],
      highlightsFr: ["un seul"],
    },
    {
      from: 0.44,
      to: 0.68,
      en: "No long message thread to review.",
      fr: "Aucune longue conversation à relire.",
    },
    {
      from: 0.7,
      to: 0.99,
      en: "You immediately know who needs your attention first.",
      fr: "Vous savez quel client rappeler en priorité.",
      highlightsEn: ["immediately"],
      highlightsFr: ["en priorité"],
    },
  ],
  5: [
    {
      from: 0.02,
      to: 0.48,
      en: "Accept the job and the appointment is confirmed.",
      fr: "Confirmez l’intervention, et le client reçoit son rendez-vous.",
      highlightsEn: ["confirmed"],
      highlightsFr: ["son rendez-vous"],
    },
    {
      from: 0.5,
      to: 0.99,
      en: "Your customer is kept informed without you touching a keyboard.",
      fr: "Tout se fait sans que vous touchiez à un clavier.",
    },
  ],
  6: [
    {
      from: 0.02,
      to: 0.6,
      en: "Trade Catch also follows up on unanswered estimates, bringing forgotten opportunities back.",
      fr: "Trade Catch relance aussi vos soumissions restées sans réponse.",
      highlightsEn: ["forgotten opportunities"],
    },
    {
      from: 0.62,
      to: 0.99,
      en: "You already invested time preparing that estimate.",
      fr: "Vous avez déjà investi du temps à préparer ces soumissions.",
      highlightsEn: ["already invested time"],
      highlightsFr: ["déjà investi du temps"],
    },
  ],
  7: [
    {
      from: 0.02,
      to: 0.52,
      en: "Every week you see what was recovered, booked and reactivated.",
      fr: "Chaque semaine, vous voyez ce qui a été récupéré, réservé et réactivé.",
      highlightsEn: ["recovered"],
      highlightsFr: ["récupéré"],
    },
    {
      from: 0.54,
      to: 0.99,
      en: "No more guessing whether your follow-up is working.",
      fr: "Vous savez enfin si vos relances produisent des résultats.",
      highlightsFr: ["des résultats"],
    },
  ],
  8: [
    {
      from: 0.02,
      to: 0.3,
      en: "Stop losing jobs when you cannot answer.",
      fr: "Ne perdez plus de contrats parce que vous ne pouvez pas répondre.",
      highlightsFr: ["contrats"],
    },
    {
      from: 0.32,
      to: 0.62,
      en: "Get your free missed-opportunity audit with Trade Catch.",
      fr: "Obtenez votre audit gratuit des opportunités manquées avec Trade Catch.",
      highlightsEn: ["free"],
      highlightsFr: ["gratuit"],
    },
  ],
};

export function captionsForLocale(locale: DemoLocale): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const scene of scenesFor(locale)) {
    for (const piece of CAPTION_PIECES[scene.id]) {
      cues.push({
        start: scene.start + piece.from * scene.duration,
        end: scene.start + piece.to * scene.duration,
        text: locale === "fr" ? piece.fr : piece.en,
        highlights: locale === "fr" ? piece.highlightsFr : piece.highlightsEn,
      });
    }
  }
  return cues;
}

/** Narration sells the consequence; the interface demonstrates the mechanism. */
export const NARRATION: Record<DemoLocale, Record<SceneId, string>> = {
  en: {
    1: "You already paid to make the phone ring. But when you are working, you cannot always answer.",
    2: "Trade Catch answers within seconds, under your company's name. The customer stays engaged instead of calling your competitor.",
    3: "It collects the problem, the urgency, the address and a photo, while you stay focused on the job. By the time you check your phone, the lead is already qualified.",
    4: "You receive one clear opportunity summary. No long message thread to review. You immediately know who needs your attention first.",
    5: "Accept the job and the appointment is confirmed. Your customer is kept informed without you touching a keyboard.",
    6: "Trade Catch also follows up on unanswered estimates, bringing forgotten opportunities back to your attention. You already invested time preparing that estimate.",
    7: "Every week you see what was recovered, booked and reactivated. No more guessing whether your follow-up is working.",
    8: "Stop losing jobs when you cannot answer. Get your free missed-opportunity audit with Trade Catch.",
  },
  fr: {
    1: "Vous avez déjà payé pour faire sonner le téléphone. Mais quand vous travaillez, vous ne pouvez pas toujours répondre.",
    2: "Trade Catch répond en quelques secondes, au nom de votre entreprise. Le client reste engagé au lieu d'appeler votre concurrent.",
    3: "Le système recueille le problème, l'urgence, l'adresse et une photo, pendant que vous restez concentré sur le travail. Quand vous regardez votre téléphone, la demande est déjà qualifiée.",
    4: "Vous recevez un seul résumé clair. Aucune longue conversation à relire. Vous savez quel client rappeler en priorité.",
    5: "Confirmez l'intervention, et le client reçoit immédiatement son rendez-vous. Tout se fait sans que vous touchiez à un clavier.",
    6: "Trade Catch relance aussi vos soumissions restées sans réponse. Vous avez déjà investi du temps à préparer ces soumissions, et le système évite qu'elles soient simplement oubliées.",
    7: "Chaque semaine, vous voyez ce qui a été récupéré, réservé et réactivé. Vous savez enfin si vos relances produisent des résultats.",
    8: "Ne perdez plus de contrats parce que vous ne pouvez pas répondre. Obtenez votre audit gratuit des opportunités manquées avec Trade Catch.",
  },
};

export const UI = {
  en: {
    playDemo: "Play demo",
    clickToPlay: "Click to play",
    play: "Play",
    pause: "Pause",
    replay: "Replay",
    restart: "Restart",
    fullScreen: "Full screen",
    exit: "Exit",
    voiceOn: "Voice On",
    voiceOff: "Voice Off",
    tip: "Tip: click the video to play or pause · Space · R restart",
    incomingCall: "Incoming call…",
    missedCall: "Missed Call",
    mobile: "mobile",
    decline: "Decline",
    accept: "Accept",
    callUnanswered: "Call went unanswered",
    headline1: "You already paid to make the phone ring.",
    headline2: "But you cannot always answer.",
    missedCallLabel: "Missed call",
    sentAuto: "Auto-reply sent in 8 seconds",
    autoSecondLang: "Auto-reply · FR",
    bilingualLabel: "Automatic bilingual replies",
    companyTitle: DEMO_DATA.company,
    smsEn:
      "Hi Sarah, this is NorthStar Plumbing. Sorry we missed your call. How can we help you today?",
    smsFr:
      "Bonjour Sarah, ici Plomberie NorthStar. Désolés d’avoir manqué votre appel. Comment pouvons-nous vous aider?",
    infoExtracted: "Information extracted",
    emergency: "Emergency",
    pipeLeak: "Pipe leak",
    photoReceived: "Photo received",
    custLeak: "My basement pipe is leaking and water is spreading.",
    waterOff: "Is the water shut off?",
    no: "No.",
    askPhoto: "Shut the nearest valve if safe. Your address and a photo?",
    newUrgentLead: "New urgent lead",
    urgentRunning: "Urgent · Water currently running",
    estValue: "Potential job range",
    issue: "Issue",
    issueValue: "Emergency pipe leak",
    location: "Location",
    status: "Status",
    statusValue: "Water currently running",
    attachment: "Attachment",
    recommended: "Recommended action:",
    callImmediately: "Call immediately",
    callCustomer: "Call Customer",
    assignTech: "Assign Technician",
    bookAppt: "Book appointment",
    day: "Day",
    today: "Today",
    window: "Window",
    windowValue: "3:00 – 5:00 p.m.",
    todaysSchedule: "Today’s schedule",
    confirmSms:
      "Your appointment is confirmed for today, 3:00–5:00 p.m. A technician will contact you before arriving.",
    confirmed: "Confirmed",
    estimatePipeline: "Estimate pipeline",
    awaiting: "Awaiting response",
    reactivated: "Opportunity reactivated",
    moved: "Moved →",
    followUp: "Follow-up",
    followUpMsg:
      "Hi Michael, just making sure you received the estimate for your basement project. Any questions before moving forward?",
    reply: "Reply",
    replyMsg: "Yes, we would like to begin next Monday.",
    basementProject: "Basement plumbing project",
    sentThreeDays: "Sent three days ago · No response",
    followUpSent: "Follow-up sent",
    customerReplied: "Customer replied",
    weeklyResults: "Weekly results",
    demoData: "Demonstration data",
    missedAnswered: "missed calls answered",
    qualified: "opportunities qualified",
    appointmentsBooked: "appointments booked",
    potentialValue: "potential job value influenced",
    estimatesReactivated: "estimates reactivated",
    closingHeadline: "Stop losing jobs when you cannot answer.",
    closingSupport:
      "Missed-call recovery and estimate follow-up for contractors.",
    closingCtaLine: "Get your free missed-opportunity audit.",
    bookDemo: "Get my free audit",
  },
  fr: {
    playDemo: "Lancer la démo",
    clickToPlay: "Cliquez pour lire",
    play: "Lecture",
    pause: "Pause",
    replay: "Rejouer",
    restart: "Recommencer",
    fullScreen: "Plein écran",
    exit: "Quitter",
    voiceOn: "Voix activée",
    voiceOff: "Voix coupée",
    tip: "Astuce : cliquez la vidéo pour lecture/pause · Espace · R recommencer",
    incomingCall: "Appel entrant…",
    missedCall: "Appel manqué",
    mobile: "mobile",
    decline: "Refuser",
    accept: "Accepter",
    callUnanswered: "Appel sans réponse",
    headline1: "Vous avez déjà payé pour faire sonner le téléphone.",
    headline2: "Mais vous ne pouvez pas toujours répondre.",
    missedCallLabel: "Appel manqué",
    sentAuto: "Réponse automatique en 8 secondes",
    autoSecondLang: "Réponse automatique · EN",
    bilingualLabel: "Réponses bilingues automatiques",
    companyTitle: DEMO_DATA.companyFr,
    smsEn:
      "Hi Sarah, this is NorthStar Plumbing. Sorry we missed your call. How can we help you today?",
    smsFr:
      "Bonjour Sarah, ici Plomberie NorthStar. Désolés d’avoir manqué votre appel. Comment pouvons-nous vous aider?",
    infoExtracted: "Informations extraites",
    emergency: "Urgence",
    pipeLeak: "Fuite de tuyau",
    photoReceived: "Photo reçue",
    custLeak: "Le tuyau de mon sous-sol fuit et l’eau se répand.",
    waterOff: "L’eau est-elle fermée ?",
    no: "Non.",
    askPhoto: "Fermez la valve si c’est sécuritaire. Votre adresse et une photo ?",
    newUrgentLead: "Nouvelle piste urgente",
    urgentRunning: "Urgent · Eau encore ouverte",
    estValue: "Fourchette potentielle",
    issue: "Problème",
    issueValue: "Fuite de tuyau urgente",
    location: "Emplacement",
    status: "Statut",
    statusValue: "Eau encore ouverte",
    attachment: "Pièce jointe",
    recommended: "Action recommandée :",
    callImmediately: "Appeler immédiatement",
    callCustomer: "Appeler le client",
    assignTech: "Assigner un technicien",
    bookAppt: "Prendre rendez-vous",
    day: "Jour",
    today: "Aujourd’hui",
    window: "Plage",
    windowValue: "15 h – 17 h",
    todaysSchedule: "Horaire du jour",
    confirmSms:
      "Votre rendez-vous est confirmé aujourd’hui, 15 h – 17 h. Un technicien vous contactera avant d’arriver.",
    confirmed: "Confirmé",
    estimatePipeline: "Pipeline de soumissions",
    awaiting: "En attente de réponse",
    reactivated: "Opportunité réactivée",
    moved: "Déplacé →",
    followUp: "Relance",
    followUpMsg:
      "Bonjour Michael, je m’assure que vous avez reçu la soumission pour votre sous-sol. Des questions avant d’avancer ?",
    reply: "Réponse",
    replyMsg: "Oui, nous aimerions commencer lundi prochain.",
    basementProject: "Projet de plomberie au sous-sol",
    sentThreeDays: "Envoyée il y a trois jours · Aucune réponse",
    followUpSent: "Relance envoyée",
    customerReplied: "Client a répondu",
    weeklyResults: "Résultats de la semaine",
    demoData: "Données de démonstration",
    missedAnswered: "appels manqués récupérés",
    qualified: "opportunités qualifiées",
    appointmentsBooked: "rendez-vous pris",
    potentialValue: "valeur potentielle des occasions",
    estimatesReactivated: "soumissions réactivées",
    closingHeadline:
      "Ne perdez plus de contrats parce que vous ne pouvez pas répondre.",
    closingSupport:
      "Récupération d’appels manqués et relance de soumissions pour entrepreneurs.",
    closingCtaLine: "Obtenez votre audit gratuit des opportunités manquées.",
    bookDemo: "Obtenir mon audit gratuit",
  },
} as const;

export type DemoCopy = (typeof UI)["en"];

export function getCopy(locale: DemoLocale): DemoCopy {
  return UI[locale] as DemoCopy;
}

export function sceneAt(timeSec: number, locale: DemoLocale): SceneId {
  for (const scene of scenesFor(locale)) {
    if (timeSec >= scene.start && timeSec < scene.end) return scene.id;
  }
  return 8;
}

/** Progress within the current scene, 0 → 1. Scenes animate on this. */
export function sceneProgress(
  timeSec: number,
  sceneId: SceneId,
  locale: DemoLocale,
): number {
  const scene = scenesFor(locale).find((s) => s.id === sceneId)!;
  return Math.max(0, Math.min(1, (timeSec - scene.start) / scene.duration));
}

export function captionAt(
  timeSec: number,
  locale: DemoLocale,
): CaptionCue | null {
  return (
    captionsForLocale(locale).find((c) => timeSec >= c.start && timeSec < c.end) ??
    null
  );
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** SFX cues expressed as a scene plus a fraction of that scene. */
const SFX_CUES: { key: string; scene: SceneId; at: number }[] = [
  { key: "ring1", scene: 1, at: 0.05 },
  { key: "ring2", scene: 1, at: 0.3 },
  { key: "missed", scene: 1, at: 0.58 },
  { key: "sms1", scene: 2, at: 0.12 },
  { key: "notify", scene: 4, at: 0.05 },
  { key: "confirm", scene: 5, at: 0.55 },
  { key: "sms2", scene: 6, at: 0.2 },
];

export function sfxMarks(
  locale: DemoLocale,
): { key: string; start: number; end: number }[] {
  const scenes = scenesFor(locale);
  return SFX_CUES.map(({ key, scene, at }) => {
    const window = scenes.find((s) => s.id === scene)!;
    const start = window.start + at * window.duration;
    return { key, start, end: start + 1.2 };
  });
}
