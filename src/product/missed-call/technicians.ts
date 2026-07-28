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

export function resolveOnCallTechnicianId(
  client: ClientAccount,
  at: Date,
): string {
  const { day, mins } = localDayAndMinutes(client, at);
  for (const slot of client.onCallSchedule) {
    if (slot.day !== day) continue;
    const start = timeToMinutes(slot.start);
    const end = timeToMinutes(slot.end);
    const inSlot =
      start <= end ? mins >= start && mins < end : mins >= start || mins < end;
    if (inSlot) return slot.technicianId;
  }
  return client.mainTechnicianId;
}

export function getTechnicianChain(client: ClientAccount, at: Date): string[] {
  const primary = resolveOnCallTechnicianId(client, at);
  const chain = [primary];
  for (const id of client.backupTechnicianIds) {
    if (id !== primary && !chain.includes(id)) chain.push(id);
  }
  if (client.ownerTechnicianId && !chain.includes(client.ownerTechnicianId)) {
    chain.push(client.ownerTechnicianId);
  }
  return chain;
}

function legacyAsRoster(
  client: ClientAccount,
  id: string,
): TechnicianRosterEntry | null {
  const t = client.onCallTechnicians.find((x) => x.id === id);
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    phone: t.phone,
    role: t.id === client.mainTechnicianId ? "primary" : "backup",
    active: t.active,
  };
}

export function technicianForStage(
  client: ClientAccount,
  stage: EscalationStage,
  at: Date,
): TechnicianRosterEntry | null {
  const chain = getTechnicianChain(client, at);
  if (stage === "primary") {
    const id = chain[0];
    return (
      client.technicianRoster.find((t) => t.id === id) ?? legacyAsRoster(client, id)
    );
  }
  if (stage === "backup") {
    const id = chain[1] ?? client.backupTechnicianIds[0];
    if (!id) return null;
    return (
      client.technicianRoster.find((t) => t.id === id) ?? legacyAsRoster(client, id)
    );
  }
  if (stage === "owner") {
    const id = client.ownerTechnicianId ?? chain[chain.length - 1];
    if (!id) return null;
    return (
      client.technicianRoster.find((t) => t.id === id) ?? legacyAsRoster(client, id)
    );
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
}): string {
  const { client, collected, callerE164, urgency } = input;
  const lines = [
    `${client.contractorDisplayName} — FICHE JOB`,
    `Ref: ${input.workflowId.slice(-8)}`,
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
    "Actions (répondez par texto):",
    "ACCEPTER — prendre le job",
    "REFUSER — refuser",
    "APPELER — rappeler le client maintenant",
    "",
    "Ne promettez pas d'heure d'arrivée sans confirmation.",
  );

  return lines.join("\n");
}

export function parseTechnicianAction(
  body: string,
): "accept" | "decline" | "call" | null {
  const t = body.trim().toLowerCase();
  if (/^(accepter|accept|accepte|oui|yes|ok|1)\b/.test(t)) return "accept";
  if (/^(refuser|decline|refus|non|no|0)\b/.test(t)) return "decline";
  if (/^(appeler|call|tel|phone|2)\b/.test(t)) return "call";
  return null;
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

export function nextEscalationStage(
  current: EscalationStage,
  client: ClientAccount,
): EscalationStage | null {
  if (current === "primary") {
    return client.backupTechnicianIds.length ? "backup" : "owner";
  }
  if (current === "backup") {
    return client.ownerTechnicianId ? "owner" : "exhausted";
  }
  return null;
}

export function shouldEscalate(
  workflow: {
    status: string;
    technicianAlertedAt?: string;
    escalationStage: EscalationStage;
  },
  client: ClientAccount,
  now: Date,
): EscalationStage | null {
  if (
    workflow.status !== "awaiting_technician" &&
    workflow.status !== "awaiting_human"
  ) {
    return null;
  }
  if (!workflow.technicianAlertedAt) return null;

  const elapsed =
    now.getTime() - new Date(workflow.technicianAlertedAt).getTime();
  const policy = client.escalationPolicy;

  if (
    workflow.escalationStage === "primary" &&
    elapsed >= policy.primaryResponseMs
  ) {
    return nextEscalationStage("primary", client);
  }
  if (
    workflow.escalationStage === "backup" &&
    elapsed >= policy.backupResponseMs
  ) {
    return nextEscalationStage("backup", client);
  }
  if (
    workflow.escalationStage === "owner" &&
    elapsed >= policy.ownerResponseMs
  ) {
    return "exhausted";
  }
  return null;
}

export function afterHoursNote(client: ClientAccount, at: Date): boolean {
  return isAfterHours(client, at);
}
