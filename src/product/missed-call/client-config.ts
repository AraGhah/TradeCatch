import { z } from "zod";
import { demoClientAccount } from "./fixtures";
import { defaultApprovedQuestions } from "./messaging";
import { defaultUrgencyRubric } from "./urgency";
import { defaultServiceAreas } from "./fixtures";
import type { ClientAccount, TechnicianRosterEntry } from "./types";

const RESERVED_DEMO_PHONES = new Set([
  "+15145550100",
  "+15145550199",
  "+15145550288",
  "+15145550377",
]);

const E164_PHONE = /^\+[1-9]\d{7,14}$/;
const HH_MM_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isE164Phone(phone: string): boolean {
  return E164_PHONE.test(phone.trim());
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function isReservedDemoPhone(phone: string): boolean {
  const n = phone.replace(/[^\d+]/g, "");
  if (RESERVED_DEMO_PHONES.has(n)) return true;
  // North-American fictional 555 exchange
  return /\+1\d{3}555\d{4}$/.test(n) || /^5145550/.test(n.replace(/^\+1/, ""));
}

export type ClientConfigValidation = {
  ok: boolean;
  errors: string[];
};

const technicianRosterEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().trim().regex(E164_PHONE, "must be an E.164 phone number"),
  role: z.enum(["primary", "backup", "owner"]),
  active: z.boolean(),
});

const approvedQuestionSchema = z.object({
  id: z.enum(["language", "name", "address", "description", "photo", "done"]),
  enabled: z.boolean(),
  promptFr: z.string(),
  promptEn: z.string(),
  required: z.boolean(),
});

/** Structural validation for MISSED_CALL_CLIENT_CONFIG_JSON. */
export const clientAccountConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  contractorDisplayName: z.string().min(1),
  timezone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, "must be a valid IANA time zone"),
  businessHours: z.object({
    start: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
    end: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
    days: z.array(z.number().int().min(0).max(6)).min(1),
  }),
  serviceAreaNotes: z.string().optional(),
  approvedServiceAreas: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      matchTokens: z.array(z.string()),
    }),
  ),
  urgencyRubric: z.array(
    z.object({
      id: z.string(),
      level: z.enum(["routine", "priority", "critical"]),
      keywordsFr: z.array(z.string()),
      keywordsEn: z.array(z.string()),
    }),
  ),
  technicianRoster: z.array(technicianRosterEntrySchema).min(1),
  mainTechnicianId: z.string().min(1),
  backupTechnicianIds: z.array(z.string()),
  ownerTechnicianId: z.string().optional(),
  onCallSchedule: z.array(
    z.object({
      day: z.number().int().min(0).max(6),
      start: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
      end: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
      technicianId: z.string().min(1),
    }),
  ),
  escalationPolicy: z.object({
    primaryResponseMs: z.number().positive(),
    backupResponseMs: z.number().positive(),
    ownerResponseMs: z.number().positive(),
  }),
  timeouts: z
    .object({
      customerCollectionMs: z.number().positive(),
    })
    .optional(),
  onCallTechnicians: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      phone: z
        .string()
        .trim()
        .regex(E164_PHONE, "must be an E.164 phone number"),
      active: z.boolean(),
    }),
  ),
  approvedQuestions: z.array(approvedQuestionSchema).min(1),
  smsFromNumber: z
    .string()
    .trim()
    .regex(E164_PHONE, "must be an E.164 phone number"),
  optOutKeywords: z.array(z.string()).min(1),
  duplicateWindowMs: z.number().positive(),
  humanReviewPhone: z
    .string()
    .trim()
    .regex(E164_PHONE, "must be an E.164 phone number")
    .optional(),
});

export function parseClientConfigJson(raw: string): ClientAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "[missed-call] MISSED_CALL_CLIENT_CONFIG_JSON is not valid JSON",
    );
  }
  const result = clientAccountConfigSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `[missed-call] MISSED_CALL_CLIENT_CONFIG_JSON failed schema validation: ${detail}`,
    );
  }
  return result.data as ClientAccount;
}

export function validateClientConfig(
  client: ClientAccount,
): ClientConfigValidation {
  const errors: string[] = [];
  if (!client.id || client.id === "client_demo") {
    errors.push("client id must not be the demo id in production");
  }
  if (!isE164Phone(client.smsFromNumber || "")) {
    errors.push("smsFromNumber must be a valid E.164 phone number");
  } else if (isReservedDemoPhone(client.smsFromNumber)) {
    errors.push("smsFromNumber is a reserved demo number");
  }
  if (!isValidTimeZone(client.timezone)) {
    errors.push("timezone must be a valid IANA time zone");
  }
  if (
    !HH_MM_TIME.test(client.businessHours.start) ||
    !HH_MM_TIME.test(client.businessHours.end)
  ) {
    errors.push("businessHours start/end must use 24-hour HH:MM");
  }
  if (
    client.businessHours.days.length === 0 ||
    new Set(client.businessHours.days).size !== client.businessHours.days.length
  ) {
    errors.push("businessHours days must contain unique weekdays");
  }
  const chain = [
    client.mainTechnicianId,
    ...client.backupTechnicianIds,
    client.ownerTechnicianId,
  ].filter(Boolean) as string[];
  for (const slot of client.onCallSchedule) {
    if (!chain.includes(slot.technicianId)) {
      chain.push(slot.technicianId);
    }
  }
  if (chain.length === 0) errors.push("no technicians configured");

  for (const id of chain) {
    const t =
      client.technicianRoster.find((r) => r.id === id) ||
      client.onCallTechnicians.find((r) => r.id === id);
    if (!t) {
      errors.push(`technician ${id} missing from roster`);
      continue;
    }
    if (!t.active) errors.push(`technician ${id} is inactive`);
    if (!isE164Phone(t.phone || "")) {
      errors.push(`technician ${id} phone must be E.164`);
    } else if (isReservedDemoPhone(t.phone)) {
      errors.push(`technician ${id} has a reserved demo phone`);
    }
  }

  if (client.humanReviewPhone && !isE164Phone(client.humanReviewPhone)) {
    errors.push("humanReviewPhone must be E.164");
  } else if (
    client.humanReviewPhone &&
    isReservedDemoPhone(client.humanReviewPhone)
  ) {
    errors.push("humanReviewPhone is a reserved demo number");
  }
  if (!client.humanReviewPhone && !client.ownerTechnicianId) {
    errors.push("humanReviewPhone or ownerTechnicianId required");
  }

  return { ok: errors.length === 0, errors };
}

function tech(
  id: string,
  name: string,
  phone: string,
  role: TechnicianRosterEntry["role"],
): TechnicianRosterEntry {
  return { id, name, phone, role, active: true };
}

/**
 * Build a production client from environment variables.
 * Never returns the demo fixture when NODE_ENV=production.
 */
export function loadClientAccountFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { client: ClientAccount; source: "env" | "demo" } {
  const isProd = env.NODE_ENV === "production";
  const allowDemo = env.MISSED_CALL_ALLOW_DEMO === "1";

  if (env.MISSED_CALL_CLIENT_CONFIG_JSON?.trim()) {
    const parsed = parseClientConfigJson(env.MISSED_CALL_CLIENT_CONFIG_JSON);
    if (isProd && !allowDemo) {
      const v = validateClientConfig(parsed);
      if (!v.ok) {
        throw new Error(
          `[missed-call] Invalid production client config: ${v.errors.join("; ")}`,
        );
      }
    }
    return { client: parsed, source: "env" };
  }

  const clientId = env.MISSED_CALL_CLIENT_ID?.trim();
  const smsFrom = env.MISSED_CALL_SMS_FROM?.trim();
  const primaryPhone = env.MISSED_CALL_TECH_PHONE?.trim();
  const primaryName = env.MISSED_CALL_TECH_NAME?.trim() || "Primary technician";
  const contractor = env.MISSED_CALL_CONTRACTOR_NAME?.trim() || "Contractor";
  const backupRaw = env.MISSED_CALL_TECH_BACKUP_PHONES?.trim() || "";
  const ownerPhone = env.MISSED_CALL_TECH_OWNER_PHONE?.trim();
  const ownerName = env.MISSED_CALL_TECH_OWNER_NAME?.trim() || "Owner";
  const humanReview = env.MISSED_CALL_HUMAN_REVIEW_PHONE?.trim() || ownerPhone;

  const canBuildFromEnv = Boolean(clientId && smsFrom && primaryPhone);

  if (isProd && !allowDemo) {
    if (!canBuildFromEnv) {
      throw new Error(
        "[missed-call] Production requires MISSED_CALL_CLIENT_ID, MISSED_CALL_SMS_FROM, MISSED_CALL_TECH_PHONE (or MISSED_CALL_CLIENT_CONFIG_JSON). Demo fixtures are disabled.",
      );
    }
  }

  if (isProd && allowDemo) {
    console.error(
      "[missed-call] MISSED_CALL_ALLOW_DEMO=1 is set in production — demo contacts may be reachable. Remove this flag before real traffic.",
    );
  }

  if (!canBuildFromEnv) {
    return { client: demoClientAccount(), source: "demo" };
  }

  const mainId = "tech_primary";
  const backups = backupRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const backupIds = backups.map((_, i) => `tech_backup_${i + 1}`);
  const ownerId = ownerPhone ? "tech_owner" : undefined;

  const roster: TechnicianRosterEntry[] = [
    tech(mainId, primaryName, primaryPhone!, "primary"),
    ...backups.map((phone, i) =>
      tech(backupIds[i]!, `Backup ${i + 1}`, phone, "backup"),
    ),
  ];
  if (ownerId && ownerPhone) {
    roster.push(tech(ownerId, ownerName, ownerPhone, "owner"));
  }

  const client: ClientAccount = {
    id: clientId!,
    name: contractor,
    contractorDisplayName: contractor,
    timezone: env.MISSED_CALL_TIMEZONE?.trim() || "America/Toronto",
    businessHours: {
      start: "08:00",
      end: "17:00",
      days: [1, 2, 3, 4, 5],
    },
    approvedServiceAreas: defaultServiceAreas(),
    urgencyRubric: defaultUrgencyRubric(),
    technicianRoster: roster,
    mainTechnicianId: mainId,
    backupTechnicianIds: backupIds,
    ownerTechnicianId: ownerId,
    onCallSchedule: [1, 2, 3, 4, 5].map((day) => ({
      day,
      start: "08:00",
      end: "17:00",
      technicianId: mainId,
    })),
    escalationPolicy: {
      primaryResponseMs: 5 * 60 * 1000,
      backupResponseMs: 5 * 60 * 1000,
      ownerResponseMs: 10 * 60 * 1000,
    },
    timeouts: {
      customerCollectionMs: 2 * 60 * 60 * 1000,
    },
    humanReviewPhone: humanReview,
    onCallTechnicians: [
      { id: mainId, name: primaryName, phone: primaryPhone!, active: true },
    ],
    approvedQuestions: defaultApprovedQuestions(),
    smsFromNumber: smsFrom!,
    optOutKeywords: ["stop", "arret", "arrêt"],
    duplicateWindowMs: 30 * 60 * 1000,
  };

  if (isProd && !allowDemo) {
    const v = validateClientConfig(client);
    if (!v.ok) {
      throw new Error(
        `[missed-call] Invalid production client config: ${v.errors.join("; ")}`,
      );
    }
  }

  return { client, source: "env" };
}
