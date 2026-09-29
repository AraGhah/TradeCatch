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
import { parseReceptionistConfig, validateReceptionistConfig } from "./config";
import type { ReceptionistConfig, ReceptionistLanguage } from "./types";

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

export const profileSettingsSchema = z.object({
  languages: z
    .array(z.enum(["fr", "en"]))
    .min(1)
    .max(2)
    .default(["fr", "en"]),
  defaultLanguage: z.enum(["fr", "en"]).default("fr"),
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
        keywords: z.array(keyword).min(1).max(8),
        answerFr: z.string().trim().min(1).max(500),
        answerEn: z.string().trim().min(1).max(500),
      }),
    )
    .max(20)
    .default([]),
  emergencyTransferE164: optionalPhone,
  fallbackTransferE164: optionalPhone,
  notifyEmail: z
    .union([z.literal(""), z.string().trim().email().max(200)])
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  notifySmsE164: optionalPhone,
  collectPreferredTime: z.boolean().default(true),
});

export type ProfileSettings = z.infer<typeof profileSettingsSchema>;

export function defaultProfileSettings(): ProfileSettings {
  return profileSettingsSchema.parse({});
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
  const raw: Record<string, unknown> = {
    id: `rc_org_${profile.organizationId}`,
    clientAccountId: client.id,
    // Placeholder keeps validation meaningful before ops assigns the number.
    phoneNumberE164: profile.phoneNumberE164 ?? client.smsFromNumber,
    businessName: client.contractorDisplayName,
    timezone: client.timezone,
    businessHours: s.businessHours ?? client.businessHours,
    languages,
    defaultLanguage: languages.includes(s.defaultLanguage)
      ? s.defaultLanguage
      : languages[0],
    greetingFr: s.greetingFr,
    greetingEn: s.greetingEn,
    afterHoursMessageFr: s.afterHoursMessageFr,
    afterHoursMessageEn: s.afterHoursMessageEn,
    personality: s.personality,
    businessFacts: s.businessFacts,
    routing: s.routing.map((r, i) => ({
      id: slug(r.name, i),
      name: r.name,
      phoneE164: r.phoneE164,
      keywords: r.keywords,
    })),
    faqs: s.faqs.map((f, i) => ({ id: `faq-${i + 1}`, ...f })),
    urgencyRubric: client.urgencyRubric,
    emergencyTransferE164:
      s.emergencyTransferE164 ??
      primaryPhone(client) ??
      client.humanReviewPhone,
    fallbackTransferE164:
      s.fallbackTransferE164 ?? client.humanReviewPhone ?? ownerPhone(client),
    collectPreferredTime: s.collectPreferredTime,
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
