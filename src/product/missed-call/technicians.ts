import type {
  ClientAccount,
  CollectedLead,
  EscalationStage,
  TechnicianRosterEntry,
  UrgencyClassification,
} from "./types";
import { isAfterHours } from "./call-handling";

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function localDayAndMinutes(
  client: ClientAccount,
  at: Date,
): { day: number; mins: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: client.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { day: weekdayMap[weekday] ?? at.getDay(), mins: hour * 60 + minute };
}

function slotContainsLocal(
  slot: { day: number; start: string; end: string },
  day: number,
  mins: number,
): boolean {
  const start = timeToMinutes(slot.start);
  const end = timeToMinutes(slot.end);
  if (start === end) return slot.day === day;
  if (start < end) {
    return slot.day === day && mins >= start && mins < end;
  }
  // Overnight e.g. Mon 22:00–06:00 → Mon ≥22:00 OR Tue <06:00
  if (slot.day === day && mins >= start) return true;
  const nextDay = (slot.day + 1) % 7;
  return day === nextDay && mins < end;
}

export function isEligibleTechnician(
  client: ClientAccount,
  technicianId: string,
): TechnicianRosterEntry | null {
  const fromRoster = client.technicianRoster.find((t) => t.id === technicianId);
  if (fromRoster) {
    if (!fromRoster.active) return null;
    if (!fromRoster.phone || fromRoster.phone.length < 8) return null;
    return fromRoster;
  }
  const legacy = client.onCallTechnicians.find((t) => t.id === technicianId);
  if (!legacy || !legacy.active || legacy.phone.length < 8) return null;
  return {
    id: legacy.id,
    name: legacy.name,
    phone: legacy.phone,
    role: legacy.id === client.mainTechnicianId ? "primary" : "backup",
    active: true,
  };
}

export function resolveOnCallTechnicianId(
  client: ClientAccount,
  at: Date,
): string {
  const { day, mins } = localDayAndMinutes(client, at);
  for (const slot of client.onCallSchedule) {
    if (!slotContainsLocal(slot, day, mins)) continue;
    const eligible = isEligibleTechnician(client, slot.technicianId);
    if (eligible) return eligible.id;
  }
  const main = isEligibleTechnician(client, client.mainTechnicianId);
  if (main) return main.id;
  const firstActive = client.technicianRoster.find((t) => t.active);
  return firstActive?.id ?? client.mainTechnicianId;
}

/** Ordered escalation targets: on-call primary → every backup → owner. */
export function getEscalationChain(
  client: ClientAccount,
  at: Date,
): TechnicianRosterEntry[] {
  const ids: string[] = [];
  const primary = resolveOnCallTechnicianId(client, at);
  ids.push(primary);
  for (const id of client.backupTechnicianIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  if (client.ownerTechnicianId && !ids.includes(client.ownerTechnicianId)) {
    ids.push(client.ownerTechnicianId);
  }
  return ids
    .map((id) => isEligibleTechnician(client, id))
    .filter((t): t is TechnicianRosterEntry => Boolean(t));
}

export function getTechnicianChain(client: ClientAccount, at: Date): string[] {
  return getEscalationChain(client, at).map((t) => t.id);
}

export function stageForEscalationIndex(
  index: number,
  chainLength: number,
): EscalationStage {
  if (index <= 0) return "primary";
  if (index >= chainLength - 1 && chainLength > 1) return "owner";
  return "backup";
}

export function technicianAtEscalationIndex(
  client: ClientAccount,
  index: number,
  at: Date,
): TechnicianRosterEntry | null {
  const chain = getEscalationChain(client, at);
  return chain[index] ?? null;
}

/** @deprecated Prefer technicianAtEscalationIndex for multi-backup chains. */
export function technicianForStage(
  client: ClientAccount,
  stage: EscalationStage,
  at: Date,
): TechnicianRosterEntry | null {
  const chain = getEscalationChain(client, at);
  if (stage === "primary") return chain[0] ?? null;
  if (stage === "owner") return chain[chain.length - 1] ?? null;
  if (stage === "backup") {
    if (chain.length <= 2) return chain[1] ?? null;
    return chain[1] ?? null;
  }
  return null;
}

export function urgencyLabel(
  urgency: UrgencyClassification | undefined,
  lang: "fr" | "en",
): string {
  if (!urgency) return lang === "fr" ? "Non classé" : "Unclassified";
  const map: Record<string, { fr: string; en: string }> = {
    routine: { fr: "Routine", en: "Routine" },
    priority: { fr: "Prioritaire", en: "Priority" },
    critical: { fr: "CRITIQUE — revue humaine", en: "CRITICAL — human review" },
  };
  return map[urgency.level][lang];
}

export function buildJobCardSms(input: {
  client: ClientAccount;
  collected: CollectedLead;
  callerE164: string;
  urgency?: UrgencyClassification;
  serviceAreaFlagged?: boolean;
  humanReviewRequired?: boolean;
  workflowId: string;
  actionToken: string;
}): string {
  const { client, collected, callerE164, urgency } = input;
  const code = input.actionToken.toUpperCase();
  const lines = [
    `${client.contractorDisplayName} — FICHE JOB`,
    `Ref: ${input.workflowId.slice(-8)}`,
    `Code: ${code}`,
    `Client: ${collected.customerName ?? "—"}`,
    `Tel: ${callerE164}`,
    `Adresse: ${collected.serviceAddress ?? "—"}`,
    `Problème: ${collected.issueDescription ?? "—"}`,
    collected.photoUrls.length
      ? `Photos: ${collected.photoUrls.join(", ")}`
      : "Photos: aucune",
    `Urgence: ${urgencyLabel(urgency, "fr")}`,
  ];

  if (input.serviceAreaFlagged) {
    lines.push("Zone: À VÉRIFIER (humain requis si incertain/hors zone)");
  }
  if (input.humanReviewRequired) {
    lines.push("⚠ Revue humaine obligatoire — ne pas diagnostiquer par texto.");
  }

  lines.push(
    "",
    "Actions (répondez par texto avec le code):",
    `ACCEPTER ${code} — prendre le job`,
    `REFUSER ${code} — refuser`,
    `APPELER ${code} — rappeler le client maintenant`,
    "",
    "Ne promettez pas d'heure d'arrivée sans confirmation.",
  );

  return lines.join("\n");
}

export type ParsedTechnicianAction = {
  action: "accept" | "decline" | "call";
  /** Required when the job card included a Code. */
  actionToken: string | null;
};

export function parseTechnicianAction(
  body: string,
): ParsedTechnicianAction | null {
  const t = body.trim();
  const match = t.match(
    /^(accepter|accept|accepte|oui|yes|ok|1|refuser|decline|refus|non|no|0|appeler|call|tel|phone|2)\b(?:\s+([A-Za-z0-9]{4,12}))?/i,
  );
  if (!match) return null;
  const verb = match[1]!.toLowerCase();
  const token = match[2] ? match[2].toUpperCase() : null;
  let action: ParsedTechnicianAction["action"];
  if (/^(accepter|accept|accepte|oui|yes|ok|1)$/.test(verb)) action = "accept";
  else if (/^(refuser|decline|refus|non|no|0)$/.test(verb)) action = "decline";
  else action = "call";
  return { action, actionToken: token };
}

/**
 * Generate a short per-alert action token (not a cryptographic auth secret —
 * binding + open-alert expiry is the primary guard; token reduces ambiguity).
 */
export function createActionToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function humanReviewAlertBody(
  client: ClientAccount,
  collected: CollectedLead,
  reason: string,
  workflowId: string,
): string {
  return [
    `${client.contractorDisplayName} — REVUE HUMAINE`,
    `Ref: ${workflowId.slice(-8)}`,
    `Raison: ${reason}`,
    `Client: ${collected.customerName ?? "—"} / ${collected.serviceAddress ?? "—"}`,
    `Problème: ${collected.issueDescription ?? "—"}`,
    "Assignez manuellement — ne pas auto-refuser.",
  ].join("\n");
}

export function nextEscalationIndex(
  currentIndex: number,
  chainLength: number,
): number | "exhausted" {
  const next = currentIndex + 1;
  if (next >= chainLength) return "exhausted";
  return next;
}

export function responseDeadlineMs(
  client: ClientAccount,
  escalationIndex: number,
  chainLength: number,
): number {
  const policy = client.escalationPolicy;
  if (escalationIndex <= 0) return policy.primaryResponseMs;
  if (escalationIndex >= chainLength - 1) return policy.ownerResponseMs;
  return policy.backupResponseMs;
}

/** Returns next escalation index, or "exhausted", or null if not yet due. */
export function shouldEscalateToIndex(
  workflow: {
    status: string;
    technicianAlertedAt?: string;
    escalationIndex: number;
  },
  client: ClientAccount,
  now: Date,
): number | "exhausted" | null {
  if (
    workflow.status !== "awaiting_technician" &&
    workflow.status !== "awaiting_human"
  ) {
    return null;
  }
  if (!workflow.technicianAlertedAt) return null;
  if (workflow.escalationIndex < 0) return null;

  const chain = getEscalationChain(client, now);
  if (chain.length === 0) return "exhausted";

  const elapsed =
    now.getTime() - new Date(workflow.technicianAlertedAt).getTime();
  const deadline = responseDeadlineMs(
    client,
    workflow.escalationIndex,
    chain.length,
  );
  if (elapsed < deadline) return null;
  return nextEscalationIndex(workflow.escalationIndex, chain.length);
}

/** @deprecated Use shouldEscalateToIndex for multi-backup chains. */
export function shouldEscalate(
  workflow: {
    status: string;
    technicianAlertedAt?: string;
    escalationStage: EscalationStage;
    escalationIndex?: number;
  },
  client: ClientAccount,
  now: Date,
): EscalationStage | null {
  const index =
    typeof workflow.escalationIndex === "number"
      ? workflow.escalationIndex
      : workflow.escalationStage === "primary"
        ? 0
        : workflow.escalationStage === "backup"
          ? 1
          : 2;
  const next = shouldEscalateToIndex(
    { ...workflow, escalationIndex: index },
    client,
    now,
  );
  if (next === null) return null;
  if (next === "exhausted") return "exhausted";
  const chain = getEscalationChain(client, now);
  return stageForEscalationIndex(next, chain.length);
}

export function afterHoursNote(client: ClientAccount, at: Date): boolean {
  return isAfterHours(client, at);
}
