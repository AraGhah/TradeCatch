/**
 * Per-organization receptionist profile edited from the client workspace.
 *
 * Split of control (deliberate):
 * - Owner (via /app/receptionist): content — greetings, hours, routing targets,
 *   FAQ, emergency / fallback lines, notification email + SMS.
 * - Founder / ops only: which Twilio number the profile answers and whether it
 *   is activated (it is a paid plan and a Twilio cost).
 *
 * Toll-fraud guard: transfer / notification numbers must be Canadian NANP
 * numbers. Anything else (premium, international, Caribbean) is rejected, since
 * an editable dial target is otherwise a way to make the line call expensive
 * numbers. Founders can still configure any number via RECEPTIONIST_CONFIG_JSON.
 */

import { z } from "zod";
import type { ClientAccount } from "@/product/missed-call/types";
import {
  DEFAULT_VOICES,
  parseReceptionistConfig,
  validateReceptionistConfig,
} from "./config";
import type {
  CallHandlingMode,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "./types";

const CANADIAN_AREA_CODES = new Set(
  (
    "204 226 236 249 250 263 289 306 343 354 365 367 368 382 403 416 418 428 431 437 438 450 468 474 " +
    "506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 " +
    "867 873 879 902 905"
  ).split(" "),
);

/** Canadian geographic number, not an N11 service code. */
export function isSafeTransferNumber(e164: string): boolean {
  const m = /^\+1(\d{3})([2-9]\d{2})\d{4}$/.exec(e164.trim());
  if (!m) return false;
  const [, area, exchange] = m;
  if (!CANADIAN_AREA_CODES.has(area!)) return false;
  return !exchange!.endsWith("11");
}

const safePhone = z
  .string()
  .trim()
  .refine(
    isSafeTransferNumber,
    "must be a Canadian phone number in E.164 format (e.g. +14385551234)",
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const optionalPhone = z
  .union([z.literal(""), safePhone])
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const keyword = z.string().trim().min(2).max(40);

const stringList = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().trim().min(1).max(maxLen))
    .max(maxItems)
    .default([]);

export const knowledgeSchema = z.object({
  companyName: optionalText(120),
  industry: optionalText(60),
  services: stringList(40, 80),
  serviceAreas: stringList(40, 80),
  emergencyServices: z.boolean().default(false),
  emergencyHours: optionalText(120),
  /** Only prices the contractor explicitly provided — never invent. */
  startingPrices: optionalText(500),
  businessAddress: optionalText(200),
  additionalInstructions: optionalText(2000),
});

export const transferSettingsSchema = z.object({
  primaryTransferE164: optionalPhone,
  secondaryTransferE164: optionalPhone,
  conditions: z
    .array(
      z.enum([
        "caller_request",
        "urgent",
        "unknown_answer",
        "manager_request",
        "custom",
      ]),
    )
    .max(8)
    .default(["caller_request", "urgent", "unknown_answer"]),
  transferHours: z.enum(["always", "business_hours"]).default("always"),
  timeoutSeconds: z.number().int().min(10).max(120).default(30),
  failedAction: z
    .enum(["take_message", "urgent_lead", "voicemail"])
    .default("take_message"),
});

export const appointmentSettingsSchema = z.object({
  calendarProvider: z
    .enum(["none", "simulated", "google", "outlook"])
    .default("simulated"),
  durationMinutes: z.number().int().min(15).max(240).default(60),
  bufferMinutes: z.number().int().min(0).max(120).default(15),
  maxDailyBookings: z.number().int().min(1).max(50).optional(),
  bookingNoticeHours: z.number().int().min(0).max(168).default(2),
  confirmationMethod: z
    .enum(["sms", "email", "both", "none"])
    .default("sms"),
  bookableServices: stringList(20, 80),
});

export const collectFieldsSchema = z.object({
  name: z.boolean().default(true),
  phone: z.boolean().default(true),
  service: z.boolean().default(true),
  location: z.boolean().default(true),
  description: z.boolean().default(true),
  urgency: z.boolean().default(true),
  preferredDate: z.boolean().default(true),
  notes: z.boolean().default(true),
});

export const profileSettingsSchema = z.object({
  receptionistName: optionalText(60),
  languages: z
    .array(z.enum(["fr", "en"]))
    .min(1)
    .max(2)
    .default(["fr", "en"]),
  defaultLanguage: z.enum(["fr", "en"]).default("fr"),
  voiceFr: optionalText(80),
  voiceEn: optionalText(80),
  communicationStyle: z
    .enum(["professional_friendly", "professional", "warm", "brief"])
    .default("professional_friendly"),
  speakingSpeed: z.enum(["slow", "normal", "fast"]).default("normal"),
  callHandlingMode: z
    .enum(["always", "business_hours", "after_hours", "overflow", "disabled"])
    .default("always"),
  greetingFr: optionalText(400),
  greetingEn: optionalText(400),
  afterHoursMessageFr: optionalText(400),
  afterHoursMessageEn: optionalText(400),
  businessHours: z
    .object({
      start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
      end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    })
    .optional(),
  personality: optionalText(600),
  businessFacts: optionalText(2000),
  // Zod object `.default({})` returns the raw object without nested defaults —
  // always seed concrete defaults (or preprocess through the child schema).
  knowledge: knowledgeSchema.default({
    services: [],
    serviceAreas: [],
    emergencyServices: false,
  }),
  routing: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        phoneE164: safePhone,
        keywords: z.array(keyword).max(8).default([]),
      }),
    )
    .max(8)
    .default([]),
  faqs: z
    .array(
      z.object({
        question: optionalText(200),
        keywords: z.array(keyword).max(8).default([]),
        answerFr: z.string().trim().min(1).max(500),
        answerEn: z.string().trim().min(1).max(500),
      }),
    )
    .max(20)
    .default([])
    .superRefine((faqs, ctx) => {
      faqs.forEach((f, i) => {
        const keys =
          f.keywords.length > 0
            ? f.keywords
            : f.question
              ? f.question
                  .toLowerCase()
                  .split(/\s+/)
                  .map((w) => w.replace(/[^a-zàâäéèêëïîôùûüç0-9-]/gi, ""))
                  .filter((w) => w.length >= 2)
                  .slice(0, 8)
              : [];
        if (keys.length < 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "provide keywords or a question",
            path: [i, "keywords"],
          });
        }
      });
    }),
  emergencyTransferE164: optionalPhone,
  fallbackTransferE164: optionalPhone,
  transferSettings: transferSettingsSchema.default({
    conditions: ["caller_request", "urgent", "unknown_answer"],
    transferHours: "always",
    timeoutSeconds: 30,
    failedAction: "take_message",
  }),
  appointmentSettings: appointmentSettingsSchema.default({
    calendarProvider: "simulated",
    durationMinutes: 60,
    bufferMinutes: 15,
    bookingNoticeHours: 2,
    confirmationMethod: "sms",
    bookableServices: [],
  }),
  collectFields: collectFieldsSchema.default({
    name: true,
    phone: true,
    service: true,
    location: true,
    description: true,
    urgency: true,
    preferredDate: true,
    notes: true,
  }),
  notifyEmail: z
    .union([z.literal(""), z.string().trim().email().max(200)])
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  notifySmsE164: optionalPhone,
  collectPreferredTime: z.boolean().default(true),
});

export type ProfileSettings = z.infer<typeof profileSettingsSchema>;
export type KnowledgeSettings = z.infer<typeof knowledgeSchema>;
export type TransferSettings = z.infer<typeof transferSettingsSchema>;
export type AppointmentSettings = z.infer<typeof appointmentSettingsSchema>;

export function defaultProfileSettings(): ProfileSettings {
  return profileSettingsSchema.parse({});
}

function stylePersonality(
  style: ProfileSettings["communicationStyle"],
  existing?: string,
): string | undefined {
  const base: Record<ProfileSettings["communicationStyle"], string> = {
    professional_friendly:
      "Professional and friendly. Identify yourself as a virtual receptionist. Keep answers short and conversational.",
    professional:
      "Professional and concise. Identify yourself as a virtual receptionist. Do not invent prices or services.",
    warm: "Warm and reassuring. Identify yourself as a virtual receptionist. Stay brief.",
    brief:
      "Brief and direct. Identify yourself as a virtual receptionist. Ask one question at a time.",
  };
  const baked = base[style];
  if (!existing?.trim()) return baked;
  return `${baked} ${existing.trim()}`.slice(0, 2000);
}

/** Compose structured knowledge into the free-form facts string the brains use. */
export function composeBusinessFacts(
  knowledge: KnowledgeSettings | undefined,
  freeform?: string,
): string | undefined {
  const k = knowledge ?? {
    services: [],
    serviceAreas: [],
    emergencyServices: false,
  };
  const services = k.services ?? [];
  const areas = k.serviceAreas ?? [];
  const lines: string[] = [];
  if (k.companyName) lines.push(`Company: ${k.companyName}`);
  if (k.industry) lines.push(`Industry: ${k.industry}`);
  if (services.length) lines.push(`Services: ${services.join(", ")}`);
  if (areas.length) lines.push(`Service areas: ${areas.join(", ")}`);
  if (k.emergencyServices) {
    lines.push(
      `Emergency services: available${
        k.emergencyHours ? ` (${k.emergencyHours})` : ""
      }`,
    );
  } else {
    lines.push("Emergency services: not configured as available.");
  }
  if (k.startingPrices?.trim()) {
    lines.push(`Starting prices (approved only): ${k.startingPrices}`);
  } else {
    lines.push(
      "Pricing: do not quote any price; say a team member will confirm.",
    );
  }
  if (k.businessAddress) lines.push(`Address: ${k.businessAddress}`);
  if (k.additionalInstructions)
    lines.push(`Business rules: ${k.additionalInstructions}`);
  if (freeform?.trim()) lines.push(freeform.trim());
  lines.push(
    "Never invent services, prices, or arrival times. Offer a human transfer when unsure.",
  );
  const text = lines.join("\n").trim();
  return text || undefined;
}

function faqKeywords(f: {
  question?: string;
  keywords: string[];
}): string[] {
  if (f.keywords.length > 0) return f.keywords;
  if (!f.question) return [];
  return f.question
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zàâäéèêëïîôùûüç0-9-]/gi, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 8);
}

export type ReceptionistProfile = {
  organizationId: string;
  /** Twilio number this profile answers — ops-controlled. */
  phoneNumberE164?: string;
  /** Ops switch: only activated profiles answer calls. */
  activated: boolean;
  settings: ProfileSettings;
  updatedBy?: string;
  updatedAt: string;
};

export type ProfileBuildContext = {
  client: ClientAccount;
  env?: NodeJS.ProcessEnv;
};

function slug(name: string, index: number): string {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${s || "dept"}-${index + 1}`;
}

function ownerPhone(client: ClientAccount): string | undefined {
  const id = client.ownerTechnicianId;
  return id
    ? client.technicianRoster.find((t) => t.id === id && t.active)?.phone
    : undefined;
}

function primaryPhone(client: ClientAccount): string | undefined {
  return client.technicianRoster.find(
    (t) => t.id === client.mainTechnicianId && t.active,
  )?.phone;
}

/** Turn owner-editable settings + the linked Module A client into a full config. */
export function buildProfileConfig(
  profile: ReceptionistProfile,
  ctx: ProfileBuildContext,
): ReceptionistConfig {
  const { client } = ctx;
  const s = profile.settings;
  const notifications: {
    type: "email" | "sms";
    to?: string;
    toE164?: string;
  }[] = [];
  if (s.notifyEmail) notifications.push({ type: "email", to: s.notifyEmail });
  const sms = s.notifySmsE164 ?? ownerPhone(client);
  if (sms) notifications.push({ type: "sms", toE164: sms });

  const languages = s.languages as ReceptionistLanguage[];
  const mode: CallHandlingMode = s.callHandlingMode ?? "always";
  const knowledge = s.knowledge ?? defaultProfileSettings().knowledge;
  const transfer = s.transferSettings ?? defaultProfileSettings().transferSettings;
  const collect = s.collectFields ?? defaultProfileSettings().collectFields;
  const businessName =
    knowledge.companyName?.trim() || client.contractorDisplayName;
  const primaryTransfer =
    transfer.primaryTransferE164 ?? s.fallbackTransferE164;
  const emergency =
    s.emergencyTransferE164 ??
    primaryPhone(client) ??
    client.humanReviewPhone;

  const raw: Record<string, unknown> = {
    id: `rc_org_${profile.organizationId}`,
    enabled: mode !== "disabled",
    clientAccountId: client.id,
    // Placeholder keeps validation meaningful before ops assigns the number.
    phoneNumberE164: profile.phoneNumberE164 ?? client.smsFromNumber,
    businessName,
    receptionistName: s.receptionistName,
    callHandlingMode: mode,
    timezone: client.timezone,
    businessHours: s.businessHours ?? client.businessHours,
    languages,
    defaultLanguage: languages.includes(s.defaultLanguage)
      ? s.defaultLanguage
      : languages[0],
    voices: {
      fr: s.voiceFr ?? DEFAULT_VOICES.fr,
      en: s.voiceEn ?? DEFAULT_VOICES.en,
    },
    greetingFr: s.greetingFr,
    greetingEn: s.greetingEn,
    afterHoursMessageFr: s.afterHoursMessageFr,
    afterHoursMessageEn: s.afterHoursMessageEn,
    personality: stylePersonality(
      s.communicationStyle ?? "professional_friendly",
      s.personality,
    ),
    businessFacts: composeBusinessFacts(knowledge, s.businessFacts),
    routing: (s.routing ?? []).map((r, i) => ({
      id: slug(r.name, i),
      name: r.name,
      phoneE164: r.phoneE164,
      keywords: r.keywords,
    })),
    faqs: (s.faqs ?? []).map((f, i) => ({
      id: `faq-${i + 1}`,
      question: f.question,
      keywords: faqKeywords(f),
      answerFr: f.answerFr,
      answerEn: f.answerEn,
    })),
    urgencyRubric: client.urgencyRubric,
    emergencyTransferE164: emergency,
    fallbackTransferE164:
      primaryTransfer ??
      transfer.secondaryTransferE164 ??
      client.humanReviewPhone ??
      ownerPhone(client),
    collectPreferredTime:
      s.collectPreferredTime !== false && collect.preferredDate !== false,
    notifications,
    smsFromE164: client.smsFromNumber,
  };
  for (const k of Object.keys(raw)) if (raw[k] === undefined) delete raw[k];

  const config = parseReceptionistConfig(raw);
  return { ...config, source: "profile" };
}

export type ProfileIssue = { field: string; message: string };

/**
 * Save-time validation: settings shape, dial targets, no transfer loops, and —
 * in production — the same checks the founder config gets.
 */
export function validateProfile(
  profile: ReceptionistProfile,
  ctx: ProfileBuildContext,
):
  | { ok: true; config: ReceptionistConfig }
  | { ok: false; issues: ProfileIssue[] } {
  const issues: ProfileIssue[] = [];
  const own = profile.phoneNumberE164;
  const targets: [string, string | undefined][] = [
    ["emergencyTransferE164", profile.settings.emergencyTransferE164],
    ["fallbackTransferE164", profile.settings.fallbackTransferE164],
    [
      "transferSettings.primaryTransferE164",
      profile.settings.transferSettings?.primaryTransferE164,
    ],
    [
      "transferSettings.secondaryTransferE164",
      profile.settings.transferSettings?.secondaryTransferE164,
    ],
    ...profile.settings.routing.map(
      (r, i) => [`routing.${i}.phoneE164`, r.phoneE164] as [string, string],
    ),
  ];
  for (const [field, phone] of targets) {
    if (own && phone && phone === own) {
      issues.push({
        field,
        message:
          "cannot be the number the receptionist answers (transfer loop)",
      });
    }
  }
  const names = new Set<string>();
  profile.settings.routing.forEach((r, i) => {
    const key = r.name.toLowerCase();
    if (names.has(key))
      issues.push({
        field: `routing.${i}.name`,
        message: "duplicate department name",
      });
    names.add(key);
  });
  if (issues.length > 0) return { ok: false, issues };

  let config: ReceptionistConfig;
  try {
    config = buildProfileConfig(profile, ctx);
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          field: "profile",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
  const env = ctx.env ?? process.env;
  if (env.NODE_ENV === "production" && env.MISSED_CALL_ALLOW_DEMO !== "1") {
    const v = validateReceptionistConfig(config);
    if (!v.ok)
      return {
        ok: false,
        issues: v.errors.map((message) => ({ field: "profile", message })),
      };
  }
  return { ok: true, config };
}
