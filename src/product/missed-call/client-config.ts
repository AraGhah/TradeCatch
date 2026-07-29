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

export function validateClientConfig(client: ClientAccount): ClientConfigValidation {
  const errors: string[] = [];
  if (!client.id || client.id === "client_demo") {
    errors.push("client id must not be the demo id in production");
  }
  if (!client.smsFromNumber || isReservedDemoPhone(client.smsFromNumber)) {
    errors.push("smsFromNumber is missing or a reserved demo number");
  }
  const chain = [
    client.mainTechnicianId,
    ...client.backupTechnicianIds,
    client.ownerTechnicianId,
  ].filter(Boolean) as string[];
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
    if (!t.phone || isReservedDemoPhone(t.phone)) {
      errors.push(`technician ${id} has missing/demo phone`);
    }
  }

  if (
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
    const parsed = JSON.parse(
      env.MISSED_CALL_CLIENT_CONFIG_JSON,
    ) as ClientAccount;
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
  const primaryName =
    env.MISSED_CALL_TECH_NAME?.trim() || "Primary technician";
  const contractor =
    env.MISSED_CALL_CONTRACTOR_NAME?.trim() || "Contractor";
  const backupRaw = env.MISSED_CALL_TECH_BACKUP_PHONES?.trim() || "";
  const ownerPhone = env.MISSED_CALL_TECH_OWNER_PHONE?.trim();
  const ownerName = env.MISSED_CALL_TECH_OWNER_NAME?.trim() || "Owner";
  const humanReview =
    env.MISSED_CALL_HUMAN_REVIEW_PHONE?.trim() || ownerPhone;

  const canBuildFromEnv = Boolean(clientId && smsFrom && primaryPhone);

  if (isProd && !allowDemo) {
    if (!canBuildFromEnv) {
      throw new Error(
        "[missed-call] Production requires MISSED_CALL_CLIENT_ID, MISSED_CALL_SMS_FROM, MISSED_CALL_TECH_PHONE (or MISSED_CALL_CLIENT_CONFIG_JSON). Demo fixtures are disabled.",
      );
    }
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
