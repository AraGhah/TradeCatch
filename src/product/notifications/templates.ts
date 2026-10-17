import type { ChannelPrefs, NotificationPreferences, NotificationType, PreferenceCategory } from "./types";

const yes = (email: boolean, sms: boolean): ChannelPrefs => ({ inApp: true, email, sms });

export const DEFAULT_CHANNELS: Record<PreferenceCategory, ChannelPrefs> = {
  new_leads: yes(true, false),
  urgent: yes(true, true),
  appointments: yes(true, false),
  replies: yes(false, false),
  quote_accepted: yes(true, false),
  transfer_failed: yes(true, true),
  automation_failures: yes(true, false),
  system: yes(false, false),
};

export function defaultPreferences(organizationId: string, userId: string, language: "en" | "fr", at: string): NotificationPreferences {
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

const COPY: Record<NotificationType, { en: { title: string; body: string }; fr: { title: string; body: string } }> = {
  lead_created: {
    en: { title: "New lead captured", body: "{business}: {customer} requested {service} in {location}." },
    fr: { title: "Nouveau prospect", body: "{business} : {customer} demande {service} à {location}." },
  },
  urgent_request: {
    en: { title: "Urgent customer request", body: "{business}: urgent request from {customer} in {location}. {service}" },
    fr: { title: "Demande urgente", body: "{business} : demande urgente de {customer} à {location}. {service}" },
  },
  human_requested: {
    en: { title: "Human assistance requested", body: "{customer} asked to speak with someone at {business}." },
    fr: { title: "Aide humaine demandée", body: "{customer} veut parler à quelqu’un chez {business}." },
  },
  transfer_failed: {
    en: { title: "Call transfer failed", body: "A caller for {business} could not be transferred." },
    fr: { title: "Transfert d’appel échoué", body: "Un appel pour {business} n’a pas pu être transféré." },
  },
  appointment_confirmed: {
    en: { title: "Appointment confirmed", body: "{customer} — {service} in {location}. {when}" },
    fr: { title: "Rendez-vous confirmé", body: "{customer} — {service} à {location}. {when}" },
  },
  appointment_canceled: {
    en: { title: "Appointment canceled", body: "The appointment for {customer} ({service}) was canceled." },
    fr: { title: "Rendez-vous annulé", body: "Le rendez-vous de {customer} ({service}) a été annulé." },
  },
  appointment_rescheduled: {
    en: { title: "Appointment updated", body: "The appointment for {customer} was moved. {when}" },
    fr: { title: "Rendez-vous modifié", body: "Le rendez-vous de {customer} a été déplacé. {when}" },
  },
  customer_message: {
    en: { title: "New customer message", body: "{customer} sent a message to {business}." },
    fr: { title: "Nouveau message client", body: "{customer} a écrit à {business}." },
  },
  quote_response: {
    en: { title: "Quote response received", body: "{customer} replied about a quote for {business}." },
    fr: { title: "Réponse à une soumission", body: "{customer} a répondu à une soumission de {business}." },
  },
  quote_accepted: {
    en: { title: "Quote accepted", body: "{customer} accepted a quote from {business}." },
    fr: { title: "Soumission acceptée", body: "{customer} a accepté une soumission de {business}." },
  },
  missed_call_recovered: {
    en: { title: "Missed call recovered", body: "{business} recovered a conversation with {customer}." },
    fr: { title: "Appel manqué récupéré", body: "{business} a repris la conversation avec {customer}." },
  },
  receptionist_offline: {
    en: { title: "Receptionist unavailable", body: "The receptionist for {business} is temporarily unavailable." },
    fr: { title: "Réceptionniste indisponible", body: "La réceptionniste de {business} est temporairement indisponible." },
  },
  automation_failure: {
    en: { title: "Automation failure", body: "An automation for {business} failed repeatedly." },
    fr: { title: "Échec d’automatisation", body: "Une automatisation de {business} a échoué plusieurs fois." },
  },
  calendar_disconnected: {
    en: { title: "Calendar connection lost", body: "Google Calendar for {business} needs to be reconnected." },
    fr: { title: "Calendrier déconnecté", body: "Le calendrier Google de {business} doit être reconnecté." },
  },
  daily_summary: {
    en: { title: "Daily summary", body: "New activity for {business}: {service}" },
    fr: { title: "Résumé quotidien", body: "Activité de {business} : {service}" },
  },
  support_update: {
    en: { title: "Support update", body: "TradeCatch updated a support request for {business}." },
    fr: { title: "Mise à jour du support", body: "TradeCatch a mis à jour une demande de support pour {business}." },
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

export function renderNotice(
  type: NotificationType,
  language: "en" | "fr",
  vars: { business: string; customer?: string; service?: string; location?: string; when?: string },
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
