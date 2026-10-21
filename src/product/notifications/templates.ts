import type {
  ChannelPrefs,
  NotificationPreferences,
  NotificationType,
  PreferenceCategory,
} from "./types";

const yes = (email: boolean, sms: boolean): ChannelPrefs => ({
  inApp: true,
  email,
  sms,
});

export const DEFAULT_CHANNELS: Record<PreferenceCategory, ChannelPrefs> = {
  new_leads: yes(true, false),
  urgent: yes(true, true),
  appointments: yes(true, false),
  replies: yes(false, false),
  quote_accepted: yes(true, false),
  transfer_failed: yes(true, true),
  automation_failures: yes(true, false),
  daily_summary: yes(true, false),
  // Receptionist outages are critical: reach owners outside the app by default.
  outages: yes(true, true),
  system: yes(false, false),
};

/** Stored preferences predate newer categories; fill any gap from the defaults. */
export function withDefaultCategories(
  stored: Partial<NotificationPreferences["categories"]> | undefined,
): NotificationPreferences["categories"] {
  return { ...structuredClone(DEFAULT_CHANNELS), ...stored };
}

export function defaultPreferences(
  organizationId: string,
  userId: string,
  language: "en" | "fr",
  at: string,
): NotificationPreferences {
  return {
    organizationId,
    userId,
    categories: structuredClone(DEFAULT_CHANNELS),
    quietStart: "20:00",
    quietEnd: "08:00",
    quietEnabled: true,
    language,
    dailySummary: false,
    scope: userId ? "all" : "all",
    updatedAt: at,
  };
}

const COPY: Record<
  NotificationType,
  { en: { title: string; body: string }; fr: { title: string; body: string } }
> = {
  lead_created: {
    en: {
      title: "New lead captured",
      body: "{business}: {customer} requested {service} in {location}.",
    },
    fr: {
      title: "Nouveau prospect",
      body: "{business} : {customer} demande {service} à {location}.",
    },
  },
  urgent_request: {
    en: {
      title: "Urgent customer request",
      body: "{business}: urgent request from {customer} in {location}. {service}",
    },
    fr: {
      title: "Demande urgente",
      body: "{business} : demande urgente de {customer} à {location}. {service}",
    },
  },
  human_requested: {
    en: {
      title: "Human assistance requested",
      body: "{customer} asked to speak with someone at {business}.",
    },
    fr: {
      title: "Aide humaine demandée",
      body: "{customer} veut parler à quelqu’un chez {business}.",
    },
  },
  transfer_failed: {
    en: {
      title: "Call transfer failed",
      body: "A caller for {business} could not be transferred.",
    },
    fr: {
      title: "Transfert d’appel échoué",
      body: "Un appel pour {business} n’a pas pu être transféré.",
    },
  },
  appointment_confirmed: {
    en: {
      title: "Appointment confirmed",
      body: "{customer} — {service} in {location}. {when}",
    },
    fr: {
      title: "Rendez-vous confirmé",
      body: "{customer} — {service} à {location}. {when}",
    },
  },
  appointment_canceled: {
    en: {
      title: "Appointment canceled",
      body: "The appointment for {customer} ({service}) was canceled.",
    },
    fr: {
      title: "Rendez-vous annulé",
      body: "Le rendez-vous de {customer} ({service}) a été annulé.",
    },
  },
  appointment_rescheduled: {
    en: {
      title: "Appointment updated",
      body: "The appointment for {customer} was moved. {when}",
    },
    fr: {
      title: "Rendez-vous modifié",
      body: "Le rendez-vous de {customer} a été déplacé. {when}",
    },
  },
  customer_message: {
    en: {
      title: "New customer message",
      body: "{customer} sent a message to {business}.",
    },
    fr: {
      title: "Nouveau message client",
      body: "{customer} a écrit à {business}.",
    },
  },
  gmail_reply: {
    en: {
      title: "New customer email",
      body: "An important customer email is waiting in your connected Gmail inbox. Open TradeCatch to read it.",
    },
    fr: {
      title: "Nouveau courriel client",
      body: "Un courriel client important vous attend dans votre boîte Gmail connectée. Ouvrez TradeCatch pour le lire.",
    },
  },
  quote_response: {
    en: {
      title: "Quote response received",
      body: "{customer} replied about a quote for {business}.",
    },
    fr: {
      title: "Réponse à une soumission",
      body: "{customer} a répondu à une soumission de {business}.",
    },
  },
  quote_accepted: {
    en: {
      title: "Quote accepted",
      body: "{customer} accepted a quote from {business}.",
    },
    fr: {
      title: "Soumission acceptée",
      body: "{customer} a accepté une soumission de {business}.",
    },
  },
  missed_call_recovered: {
    en: {
      title: "Missed call recovered",
      body: "{business} recovered a conversation with {customer}.",
    },
    fr: {
      title: "Appel manqué récupéré",
      body: "{business} a repris la conversation avec {customer}.",
    },
  },
  receptionist_offline: {
    en: {
      title: "Receptionist unavailable",
      body: "The receptionist for {business} could not answer a call. Callers were sent to your backup line or voicemail. Check Calls for details.",
    },
    fr: {
      title: "Réceptionniste indisponible",
      body: "La réceptionniste de {business} n’a pas pu répondre à un appel. Les appelants ont été dirigés vers votre ligne de secours ou la boîte vocale. Consultez les appels pour les détails.",
    },
  },
  automation_failure: {
    en: {
      title: "Automation failure",
      body: "An automation for {business} failed repeatedly.",
    },
    fr: {
      title: "Échec d’automatisation",
      body: "Une automatisation de {business} a échoué plusieurs fois.",
    },
  },
  calendar_disconnected: {
    en: {
      title: "Calendar connection lost",
      body: "Google Calendar for {business} needs to be reconnected.",
    },
    fr: {
      title: "Calendrier déconnecté",
      body: "Le calendrier Google de {business} doit être reconnecté.",
    },
  },
  daily_summary: {
    en: {
      title: "Daily summary",
      body: "New activity for {business}: {service}",
    },
    fr: {
      title: "Résumé quotidien",
      body: "Activité de {business} : {service}",
    },
  },
  support_update: {
    en: {
      title: "Support update",
      body: "TradeCatch updated a support request for {business}.",
    },
    fr: {
      title: "Mise à jour du support",
      body: "TradeCatch a mis à jour une demande de support pour {business}.",
    },
  },
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] || "—");
}

export function publicLabel(value?: string): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (/^\+?\d{8,}$/.test(trimmed.replace(/[\s()-]/g, ""))) return "Customer";
  return trimmed.slice(0, 80);
}

type Plural = [one: string, other: string];

/** Order is the order the summary lists them in: what needs attention first. */
const SUMMARY_LABELS: [
  NotificationType,
  { en: Plural; fr: Plural },
][] = [
  [
    "receptionist_offline",
    {
      en: ["receptionist outage", "receptionist outages"],
      fr: ["panne de la réceptionniste", "pannes de la réceptionniste"],
    },
  ],
  [
    "urgent_request",
    {
      en: ["urgent request", "urgent requests"],
      fr: ["demande urgente", "demandes urgentes"],
    },
  ],
  [
    "human_requested",
    {
      en: ["request to speak with a person", "requests to speak with a person"],
      fr: [
        "demande de parler à une personne",
        "demandes de parler à une personne",
      ],
    },
  ],
  [
    "transfer_failed",
    {
      en: ["failed call transfer", "failed call transfers"],
      fr: ["transfert d’appel échoué", "transferts d’appel échoués"],
    },
  ],
  [
    "lead_created",
    {
      en: ["new lead", "new leads"],
      fr: ["nouveau prospect", "nouveaux prospects"],
    },
  ],
  [
    "missed_call_recovered",
    {
      en: ["recovered missed call", "recovered missed calls"],
      fr: ["appel manqué récupéré", "appels manqués récupérés"],
    },
  ],
  [
    "appointment_confirmed",
    {
      en: ["appointment confirmed", "appointments confirmed"],
      fr: ["rendez-vous confirmé", "rendez-vous confirmés"],
    },
  ],
  [
    "appointment_rescheduled",
    {
      en: ["appointment rescheduled", "appointments rescheduled"],
      fr: ["rendez-vous déplacé", "rendez-vous déplacés"],
    },
  ],
  [
    "appointment_canceled",
    {
      en: ["appointment canceled", "appointments canceled"],
      fr: ["rendez-vous annulé", "rendez-vous annulés"],
    },
  ],
  [
    "customer_message",
    {
      en: ["customer message", "customer messages"],
      fr: ["message client", "messages clients"],
    },
  ],
  [
    "gmail_reply",
    {
      en: ["customer email", "customer emails"],
      fr: ["courriel client", "courriels clients"],
    },
  ],
  [
    "quote_response",
    {
      en: ["quote response", "quote responses"],
      fr: ["réponse à une soumission", "réponses à des soumissions"],
    },
  ],
  [
    "quote_accepted",
    {
      en: ["accepted quote", "accepted quotes"],
      fr: ["soumission acceptée", "soumissions acceptées"],
    },
  ],
  [
    "automation_failure",
    {
      en: ["automation failure", "automation failures"],
      fr: ["échec d’automatisation", "échecs d’automatisation"],
    },
  ],
  [
    "calendar_disconnected",
    {
      en: ["calendar disconnection", "calendar disconnections"],
      fr: ["déconnexion du calendrier", "déconnexions du calendrier"],
    },
  ],
  [
    "support_update",
    {
      en: ["support update", "support updates"],
      fr: ["mise à jour du support", "mises à jour du support"],
    },
  ],
];

/** Counts only: a summary that leaves the app never repeats customer details. */
export function renderDailySummary(
  language: "en" | "fr",
  business: string,
  counts: Partial<Record<NotificationType, number>>,
) {
  const parts: string[] = [];
  for (const [type, labels] of SUMMARY_LABELS) {
    const count = counts[type] ?? 0;
    if (count > 0) parts.push(`${count} ${labels[language][count === 1 ? 0 : 1]}`);
  }
  if (parts.length === 0) return null;
  const list = parts.join(", ");
  return language === "fr"
    ? `Aujourd’hui chez ${business} : ${list}.`
    : `Today at ${business}: ${list}.`;
}

export function renderNotice(
  type: NotificationType,
  language: "en" | "fr",
  vars: {
    business: string;
    customer?: string;
    service?: string;
    location?: string;
    when?: string;
  },
) {
  const copy = COPY[type][language];
  const fields = {
    business: vars.business,
    customer: publicLabel(vars.customer),
    service: (vars.service || "—").slice(0, 80),
    location: (vars.location || "—").slice(0, 80),
    when: (vars.when || "").slice(0, 80),
  };
  return {
    title: copy.title,
    message: fill(copy.body, fields),
    subject: `TradeCatch — ${copy.title}`,
  };
}
