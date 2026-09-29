import { z } from "zod";
import { isReservedDemoPhone } from "@/product/missed-call/client-config";
import type { ClientAccount } from "@/product/missed-call/types";
import { defaultUrgencyRubric } from "@/product/missed-call/urgency";
import type { ReceptionistConfig } from "./types";

const E164_PHONE = /^\+[1-9]\d{7,14}$/;
const HH_MM_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

const e164 = z
  .string()
  .trim()
  .regex(E164_PHONE, "must be an E.164 phone number");

const notificationChannelSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), to: z.string().email() }),
  z.object({ type: z.literal("sms"), toE164: e164 }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().min(8).optional(),
  }),
]);

export const DEFAULT_VOICES = {
  fr: "Polly.Gabrielle-Neural",
  en: "Polly.Joanna-Neural",
} as const;

/**
 * Zod schema for RECEPTIONIST_CONFIG_JSON (one object or an array of objects).
 * Every optional field has a conservative default so a minimal config works.
 */
export const receptionistConfigSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  clientAccountId: z.string().min(1),
  phoneNumberE164: e164,
  businessName: z.string().min(1),
  timezone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, "must be a valid IANA time zone")
    .default("America/Toronto"),
  businessHours: z
    .object({
      start: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
      end: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
      days: z.array(z.number().int().min(0).max(6)).min(1),
    })
    .default({ start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] }),
  languages: z
    .array(z.enum(["fr", "en"]))
    .min(1)
    .default(["fr", "en"]),
  defaultLanguage: z.enum(["fr", "en"]).default("fr"),
  voices: z
    .object({ fr: z.string().min(1), en: z.string().min(1) })
    .default({ ...DEFAULT_VOICES }),
  greetingFr: z.string().min(1).optional(),
  greetingEn: z.string().min(1).optional(),
  afterHoursMessageFr: z.string().min(1).optional(),
  afterHoursMessageEn: z.string().min(1).optional(),
  afterHoursMode: z
    .enum(["take_message", "take_message_emergency_transfer"])
    .default("take_message_emergency_transfer"),
  personality: z.string().max(2000).optional(),
  businessFacts: z.string().max(4000).optional(),
  routing: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        phoneE164: e164,
        keywords: z.array(z.string().min(2)).default([]),
        description: z.string().optional(),
      }),
    )
    .default([]),
  emergencyTransferE164: e164.optional(),
  fallbackTransferE164: e164.optional(),
  faqs: z
    .array(
      z.object({
        id: z.string().min(1),
        keywords: z.array(z.string().min(2)).min(1),
        question: z.string().optional(),
        answerFr: z.string().min(1),
        answerEn: z.string().min(1),
      }),
    )
    .default([]),
  urgencyRubric: z
    .array(
      z.object({
        id: z.string(),
        level: z.enum(["routine", "priority", "critical"]),
        keywordsFr: z.array(z.string()),
        keywordsEn: z.array(z.string()),
      }),
    )
    .optional(),
  collectPreferredTime: z.boolean().default(true),
  maxTurns: z.number().int().min(3).max(30).default(12),
  notifications: z.array(notificationChannelSchema).default([]),
  smsFromE164: e164.optional(),
  smsRecoveryOnIncomplete: z.boolean().default(true),
  transcriptRetentionDays: z.number().int().min(1).max(730).default(90),
});

export type ReceptionistConfigInput = z.input<typeof receptionistConfigSchema>;

export function defaultGreetings(businessName: string) {
  return {
    greetingFr: `Bonjour, vous êtes bien chez ${businessName}. Je suis l'assistante virtuelle et je peux prendre votre demande.`,
    greetingEn: `Hi, you've reached ${businessName}. I'm the virtual assistant and I can take your request.`,
    afterHoursMessageFr: `Nos bureaux sont présentement fermés, mais je peux prendre votre demande et l'équipe vous rappellera dès l'ouverture.`,
    afterHoursMessageEn: `Our office is currently closed, but I can take your request and the team will call you back when we open.`,
  };
}

/** Parse + fill defaults. Throws a readable error on invalid input. */
export function parseReceptionistConfig(input: unknown): ReceptionistConfig {
  const parsed = receptionistConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`[receptionist] Invalid config: ${issues}`);
  }
  const c = parsed.data;
  const defaults = defaultGreetings(c.businessName);
  const languages = Array.from(new Set(c.languages));
  return {
    ...c,
    languages,
    defaultLanguage: languages.includes(c.defaultLanguage)
      ? c.defaultLanguage
      : languages[0]!,
    greetingFr: c.greetingFr ?? defaults.greetingFr,
    greetingEn: c.greetingEn ?? defaults.greetingEn,
    afterHoursMessageFr: c.afterHoursMessageFr ?? defaults.afterHoursMessageFr,
    afterHoursMessageEn: c.afterHoursMessageEn ?? defaults.afterHoursMessageEn,
    urgencyRubric: c.urgencyRubric ?? defaultUrgencyRubric(),
  };
}

export function parseReceptionistConfigJson(raw: string): ReceptionistConfig[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      "[receptionist] RECEPTIONIST_CONFIG_JSON is not valid JSON",
    );
  }
  const list = Array.isArray(json) ? json : [json];
  return list.map((entry) => parseReceptionistConfig(entry));
}

/** Production checks beyond structure: real numbers, a human escape hatch. */
export function validateReceptionistConfig(config: ReceptionistConfig): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const phones: [string, string | undefined][] = [
    ["phoneNumberE164", config.phoneNumberE164],
    ["emergencyTransferE164", config.emergencyTransferE164],
    ["fallbackTransferE164", config.fallbackTransferE164],
    ["smsFromE164", config.smsFromE164],
    ...config.routing.map(
      (r) => [`routing.${r.id}`, r.phoneE164] as [string, string],
    ),
    ...config.notifications
      .filter((n) => n.type === "sms")
      .map((n) => ["notifications.sms", n.toE164] as [string, string]),
  ];
  for (const [label, phone] of phones) {
    if (phone && isReservedDemoPhone(phone)) {
      errors.push(`${label} is a reserved demo number`);
    }
  }
  if (!config.emergencyTransferE164 && !config.fallbackTransferE164) {
    errors.push(
      "emergencyTransferE164 or fallbackTransferE164 required (critical calls need a live human)",
    );
  }
  if (config.notifications.length === 0) {
    errors.push("at least one notification channel is required");
  }
  const ids = new Set<string>();
  for (const r of config.routing) {
    if (ids.has(r.id)) errors.push(`duplicate routing id ${r.id}`);
    ids.add(r.id);
  }
  return { ok: errors.length === 0, errors };
}

function ownerPhone(client: ClientAccount): string | undefined {
  const owner = client.ownerTechnicianId
    ? client.technicianRoster.find(
        (t) => t.id === client.ownerTechnicianId && t.active,
      )
    : undefined;
  return owner?.phone;
}

function primaryPhone(client: ClientAccount): string | undefined {
  return client.technicianRoster.find(
    (t) => t.id === client.mainTechnicianId && t.active,
  )?.phone;
}

/**
 * Derive a working receptionist profile from the Module A client so a pilot
 * can switch the number's Voice URL without writing a full JSON config.
 */
export function deriveConfigFromClient(
  client: ClientAccount,
  env: NodeJS.ProcessEnv = process.env,
): ReceptionistConfig {
  const notifications: ReceptionistConfigInput["notifications"] = [];
  const notifyEmail =
    env.RECEPTIONIST_NOTIFY_EMAIL?.trim() || env.RESEND_NOTIFY_EMAIL?.trim();
  if (notifyEmail) notifications.push({ type: "email", to: notifyEmail });
  const notifySms = env.RECEPTIONIST_NOTIFY_SMS?.trim() || ownerPhone(client);
  if (notifySms) notifications.push({ type: "sms", toE164: notifySms });
  const webhook = env.RECEPTIONIST_WEBHOOK_URL?.trim();
  if (webhook) {
    notifications.push({
      type: "webhook",
      url: webhook,
      secret: env.RECEPTIONIST_WEBHOOK_SECRET?.trim() || undefined,
    });
  }

  return parseReceptionistConfig({
    id: `rc_${client.id}`,
    clientAccountId: client.id,
    phoneNumberE164:
      env.RECEPTIONIST_PHONE_NUMBER?.trim() || client.smsFromNumber,
    businessName: client.contractorDisplayName,
    timezone: client.timezone,
    businessHours: client.businessHours,
    urgencyRubric: client.urgencyRubric,
    emergencyTransferE164:
      env.RECEPTIONIST_EMERGENCY_PHONE?.trim() ||
      primaryPhone(client) ||
      client.humanReviewPhone,
    fallbackTransferE164:
      env.RECEPTIONIST_FALLBACK_PHONE?.trim() ||
      client.humanReviewPhone ||
      ownerPhone(client),
    notifications,
    smsFromE164: client.smsFromNumber,
  });
}

/**
 * Load receptionist configs:
 * 1. RECEPTIONIST_CONFIG_JSON (object or array) — full control.
 * 2. RECEPTIONIST_ENABLED=1 — derive one profile from the Module A client.
 * Production validates every config and refuses demo numbers.
 */
export function loadReceptionistConfigsFromEnv(
  client: ClientAccount | null,
  env: NodeJS.ProcessEnv = process.env,
): ReceptionistConfig[] {
  const isProd = env.NODE_ENV === "production";
  let configs: ReceptionistConfig[] = [];

  if (env.RECEPTIONIST_CONFIG_JSON?.trim()) {
    configs = parseReceptionistConfigJson(env.RECEPTIONIST_CONFIG_JSON);
  } else if (env.RECEPTIONIST_ENABLED === "1" && client) {
    configs = [deriveConfigFromClient(client, env)];
  }

  if (isProd && env.MISSED_CALL_ALLOW_DEMO !== "1") {
    for (const config of configs) {
      const v = validateReceptionistConfig(config);
      if (!v.ok) {
        throw new Error(
          `[receptionist] Invalid production config ${config.id}: ${v.errors.join("; ")}`,
        );
      }
    }
  }
  return configs;
}
