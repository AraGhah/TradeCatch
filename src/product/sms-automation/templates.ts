import type { AutomationConfig, AutomationType, MessageCategory, TemplateKey } from "./types";

export function defaultConfig(type: AutomationType): AutomationConfig {
  const shared = {
    language: "customer" as const,
    windowStartHour: 8,
    windowEndHour: 20,
    duplicateProtection: true,
    stopOnCustomerReply: true,
    stopOnHumanContact: true,
  };
  switch (type) {
    case "missed_call_recovery":
      return {
        ...shared,
        trigger: "no_answer",
        initialDelayMinutes: 2,
        maxAttempts: 1,
        weekendSending: true,
        stopOnQuoteAccepted: false,
        stopOnQuoteRejected: false,
        messageCategory: "inquiry_response",
      };
    case "quote_followup":
      return {
        ...shared,
        trigger: "quote_unanswered",
        initialDelayMinutes: 24 * 60,
        secondDelayMinutes: 5 * 24 * 60,
        maxAttempts: 2,
        weekendSending: false,
        stopOnQuoteAccepted: true,
        stopOnQuoteRejected: true,
        messageCategory: "requested_estimate",
      };
    case "appointment_reminder":
      return {
        ...shared,
        trigger: "appointment_approaching",
        initialDelayMinutes: 24 * 60,
        maxAttempts: 1,
        weekendSending: true,
        stopOnQuoteAccepted: false,
        stopOnQuoteRejected: false,
        messageCategory: "appointment_service",
      };
    case "customer_reengagement":
      return {
        ...shared,
        trigger: "inactive_customer",
        initialDelayMinutes: 14 * 24 * 60,
        maxAttempts: 1,
        weekendSending: false,
        stopOnQuoteAccepted: false,
        stopOnQuoteRejected: false,
        messageCategory: "marketing",
      };
    case "urgent_lead_notification":
      return {
        ...shared,
        trigger: "urgent_lead",
        initialDelayMinutes: 0,
        maxAttempts: 1,
        weekendSending: true,
        stopOnQuoteAccepted: false,
        stopOnQuoteRejected: false,
        messageCategory: "inquiry_response",
      };
  }
}

export function categoryForType(type: AutomationType): MessageCategory {
  return defaultConfig(type).messageCategory;
}

const EN_STOP = "Reply STOP to opt out.";
const FR_STOP = "Répondez STOP pour vous désabonner.";

export const DEFAULT_TEMPLATES: Record<TemplateKey, { en: string; fr: string }> = {
  missed_call_recovery: {
    en: `Hi! This is {{business_name}}. Sorry we missed your call. How can we help you today? ${EN_STOP}`,
    fr: `Bonjour ! Ici {{business_name}}. Désolé, nous avons manqué votre appel. Comment pouvons-nous vous aider ? ${FR_STOP}`,
  },
  quote_followup_1: {
    en: `Hi {{customer_name}}, this is {{business_name}}. Just following up on the estimate we sent{{quote_ref}}. Do you have any questions? ${EN_STOP}`,
    fr: `Bonjour {{customer_name}}, ici {{business_name}}. Nous faisons un suivi de la soumission envoyée{{quote_ref}}. Avez-vous des questions ? ${FR_STOP}`,
  },
  quote_followup_2: {
    en: `Hi {{customer_name}}, this is {{business_name}}. We're checking in about your {{service_name}} estimate. Let us know if you'd like to discuss the next steps. ${EN_STOP}`,
    fr: `Bonjour {{customer_name}}, ici {{business_name}}. Nous revenons vers vous au sujet de votre soumission pour {{service_name}}. Dites-nous si vous voulez en discuter. ${FR_STOP}`,
  },
  appointment_confirmation: {
    en: `Hi {{customer_name}}, this is {{business_name}}. Your {{service_name}} appointment is confirmed for {{appointment_time}}. ${EN_STOP}`,
    fr: `Bonjour {{customer_name}}, ici {{business_name}}. Votre rendez-vous pour {{service_name}} est confirmé : {{appointment_time}}. ${FR_STOP}`,
  },
  appointment_reminder: {
    en: `Hi {{customer_name}}, this is {{business_name}}. Reminder: your {{service_name}} appointment is coming up at {{appointment_time}}. ${EN_STOP}`,
    fr: `Bonjour {{customer_name}}, ici {{business_name}}. Rappel : votre rendez-vous pour {{service_name}} approche ({{appointment_time}}). ${FR_STOP}`,
  },
  general_followup: {
    en: `Hi {{customer_name}}, this is {{business_name}}. We're following up regarding your {{service_name}} request. Let us know if you have any questions. ${EN_STOP}`,
    fr: `Bonjour {{customer_name}}, ici {{business_name}}. Nous faisons un suivi de votre demande pour {{service_name}}. Dites-nous si vous avez des questions. ${FR_STOP}`,
  },
  human_assistance: {
    en: `Hi {{customer_name}}, this is {{business_name}}. We tried to reach a teammate for you and will follow up shortly. ${EN_STOP}`,
    fr: `Bonjour {{customer_name}}, ici {{business_name}}. Nous avons essayé de joindre un membre de l'équipe et nous vous recontactons bientôt. ${FR_STOP}`,
  },
  after_hours: {
    en: `Hi! This is {{business_name}}. We missed your call outside our usual hours. Reply here and we'll help you as soon as we're available. ${EN_STOP}`,
    fr: `Bonjour ! Ici {{business_name}}. Nous avons manqué votre appel en dehors des heures habituelles. Répondez ici et nous vous aiderons dès que possible. ${FR_STOP}`,
  },
};

const ALLOWED = new Set([
  "customer_name",
  "business_name",
  "service_name",
  "quote_ref",
  "appointment_time",
]);

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

export function validateTemplate(body: string, locale: "en" | "fr"): string[] {
  const errors: string[] = [];
  const text = body.trim();
  if (text.length < 12) errors.push("empty");
  if (text.length > 1000) errors.push("too_long");
  if (!text.includes("{{business_name}}")) errors.push("missing_business_identification");
  const stopOk =
    locale === "fr"
      ? /r[ée]pondez\s+stop|arr[êe]t/i.test(text)
      : /reply\s+stop\s+to\s+opt\s+out/i.test(text);
  if (!stopOk) errors.push("missing_opt_out");
  const unknown = [...text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)]
    .map((m) => m[1]!.toLowerCase())
    .filter((name) => !ALLOWED.has(name));
  if (unknown.length > 0) errors.push("unknown_variable");
  return errors;
}

function fallback(locale: "en" | "fr", name: string, provided?: string): string {
  if (provided && provided.trim()) return provided.trim();
  if (name === "customer_name") return locale === "fr" ? "" : "there";
  if (name === "service_name") return locale === "fr" ? "service" : "service";
  if (name === "quote_ref") return "";
  if (name === "appointment_time") {
    return locale === "fr" ? "votre rendez-vous" : "your appointment";
  }
  return "";
}

export type RenderResult = {
  body: string;
  missing: string[];
  segments: number;
  encoding: "gsm" | "ucs2";
  chars: number;
};

export function smsSegments(body: string): { segments: number; encoding: "gsm" | "ucs2"; chars: number } {
  let gsm = true;
  let units = 0;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXT.has(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) {
    const chars = [...body].length;
    const segments = chars <= 70 ? 1 : Math.ceil(chars / 67);
    return { segments, encoding: "ucs2", chars };
  }
  const segments = units <= 160 ? 1 : Math.ceil(units / 153);
  return { segments, encoding: "gsm", chars: units };
}

export function renderTemplate(input: {
  body: string;
  locale: "en" | "fr";
  vars: Record<string, string | undefined>;
  businessName: string;
}): RenderResult {
  const missing: string[] = [];
  let rendered = input.body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, raw: string) => {
    const name = raw.toLowerCase();
    if (!ALLOWED.has(name)) {
      missing.push(name);
      return "";
    }
    const value =
      name === "business_name"
        ? input.businessName
        : fallback(input.locale, name, input.vars[name]);
    if (name !== "quote_ref" && name !== "customer_name" && !value) missing.push(name);
    if (name === "quote_ref" && value) return ` (${value})`;
    return value;
  });
  rendered = rendered.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  const business = input.businessName.trim();
  if (business && !rendered.toLowerCase().includes(business.toLowerCase())) {
    rendered +=
      input.locale === "fr" ? `\nIci ${business}.` : `\nThis is ${business}.`;
  }
  const hasStop =
    input.locale === "fr"
      ? /r[ée]pondez\s+stop|arr[êe]t/i.test(rendered)
      : /reply\s+stop/i.test(rendered);
  if (!hasStop) {
    rendered += input.locale === "fr" ? `\n${FR_STOP}` : `\n${EN_STOP}`;
  }
  const segments = smsSegments(rendered);
  return { body: rendered, missing, ...segments };
}

export function mergeConfig(
  type: AutomationType,
  patch: Partial<AutomationConfig>,
): { config: AutomationConfig; errors: string[] } {
  const base = { ...defaultConfig(type), ...patch };
  const errors: string[] = [];
  if (!Number.isFinite(base.initialDelayMinutes) || base.initialDelayMinutes < 0) {
    errors.push("initial_delay");
  }
  if (base.initialDelayMinutes > 60 * 24 * 30) errors.push("initial_delay");
  if (
    base.secondDelayMinutes !== undefined &&
    (base.secondDelayMinutes < base.initialDelayMinutes ||
      base.secondDelayMinutes > 60 * 24 * 60)
  ) {
    errors.push("second_delay");
  }
  if (!Number.isInteger(base.maxAttempts) || base.maxAttempts < 1 || base.maxAttempts > 5) {
    errors.push("max_attempts");
  }
  if (
    !Number.isInteger(base.windowStartHour) ||
    !Number.isInteger(base.windowEndHour) ||
    base.windowStartHour < 0 ||
    base.windowEndHour > 24 ||
    base.windowStartHour >= base.windowEndHour
  ) {
    errors.push("sending_window");
  }
  if (!["en", "fr", "customer"].includes(base.language)) errors.push("language");
  const categories: MessageCategory[] = [
    "inquiry_response",
    "requested_estimate",
    "appointment_service",
    "marketing",
  ];
  if (!categories.includes(base.messageCategory)) errors.push("category");
  base.trigger = String(base.trigger || defaultConfig(type).trigger).slice(0, 60);
  return { config: base, errors };
}
