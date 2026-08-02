import type {
  ConversationMessage,
  LeadRecord,
  MissedCallWorkflow,
  OutcomeStatus,
  TechnicianAlertRecord,
} from "./types";
import type { UrgencyLogEntry } from "./urgency";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createLeadFromWorkflow(
  workflow: MissedCallWorkflow,
  callId: string,
  at: Date,
): LeadRecord {
  const now = at.toISOString();
  return {
    id: id("lead"),
    clientAccountId: workflow.clientAccountId,
    workflowId: workflow.id,
    callId,
    callerE164: workflow.callerE164,
    customerName: workflow.collected.customerName,
    serviceAddress: workflow.collected.serviceAddress,
    issueDescription: workflow.collected.issueDescription,
    photoUrls: [...workflow.collected.photoUrls],
    serviceArea: workflow.serviceArea,
    serviceAreaFlagged: workflow.serviceAreaFlagged ?? false,
    urgency: workflow.urgency,
    humanReviewRequired: workflow.humanReviewRequired ?? false,
    conversation: [],
    techniciansAlerted: [...workflow.technicianAlerts],
    outcome: workflow.outcome,
    manualCorrections: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendConversation(
  lead: LeadRecord,
  msg: ConversationMessage,
): void {
  lead.conversation.push(msg);
  lead.updatedAt = msg.at;
}

export function syncLeadFromWorkflow(
  lead: LeadRecord,
  workflow: MissedCallWorkflow,
): void {
  lead.customerName = workflow.collected.customerName ?? lead.customerName;
  lead.serviceAddress =
    workflow.collected.serviceAddress ?? lead.serviceAddress;
  lead.issueDescription =
    workflow.collected.issueDescription ?? lead.issueDescription;
  lead.photoUrls = [...workflow.collected.photoUrls];
  lead.serviceArea = workflow.serviceArea;
  lead.serviceAreaFlagged =
    workflow.serviceAreaFlagged ?? lead.serviceAreaFlagged;
  lead.urgency = workflow.urgency;
  lead.humanReviewRequired =
    workflow.humanReviewRequired ?? lead.humanReviewRequired;
  lead.techniciansAlerted = [...workflow.technicianAlerts];
  lead.outcome = workflow.outcome;
  lead.updatedAt = new Date().toISOString();
}

export function recordTechnicianResponse(
  lead: LeadRecord,
  alertedAt: string,
  respondedAt: Date,
  accepted: boolean,
): void {
  const ms = respondedAt.getTime() - new Date(alertedAt).getTime();
  if (ms >= 0) lead.technicianResponseMs = ms;
  lead.jobAccepted = accepted;
  lead.updatedAt = respondedAt.toISOString();
}

const LEAD_PATCH_FIELDS = new Set([
  "customerName",
  "serviceAddress",
  "issueDescription",
  "serviceAreaFlagged",
  "jobAccepted",
  "becameBooking",
  "estimatedValue",
  "finalValue",
  "outcome",
]);

const OUTCOME_VALUES = new Set([
  "open",
  "technician_accepted",
  "technician_declined",
  "customer_unreachable",
  "resolved",
  "cancelled",
  "human_review",
]);

function isValidCorrectionValue(field: string, value: unknown): boolean {
  switch (field) {
    case "customerName":
    case "serviceAddress":
    case "issueDescription":
      return typeof value === "string" && value.length <= 500;
    case "serviceAreaFlagged":
    case "jobAccepted":
    case "becameBooking":
      return typeof value === "boolean";
    case "estimatedValue":
    case "finalValue":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1_000_000
      );
    case "outcome":
      return typeof value === "string" && OUTCOME_VALUES.has(value);
    default:
      return false;
  }
}

export function applyManualCorrection(
  lead: LeadRecord,
  field: string,
  newValue: unknown,
  note?: string,
): boolean {
  if (!LEAD_PATCH_FIELDS.has(field)) return false;
  if (!isValidCorrectionValue(field, newValue)) return false;
  const key = field as keyof LeadRecord;
  const previousValue = lead[key];
  const correction = {
    at: new Date().toISOString(),
    field,
    previousValue,
    newValue,
    note,
  };
  lead.manualCorrections.push(correction);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (lead as any)[field] = newValue;
  lead.updatedAt = correction.at;
  return true;
}

export function setLeadOutcome(lead: LeadRecord, outcome: OutcomeStatus): void {
  lead.outcome = outcome;
  lead.updatedAt = new Date().toISOString();
}

export function logUrgencyOnLead(lead: LeadRecord, log: UrgencyLogEntry): void {
  appendConversation(lead, {
    at: log.at,
    direction: "outbound",
    fromE164: "system",
    toE164: lead.callerE164,
    body: `[urgency] ${log.classification.source} → ${log.classification.level} human=${log.classification.requiresHuman}`,
    actor: "system",
  });
}

export function pushTechnicianAlert(
  workflow: MissedCallWorkflow,
  record: TechnicianAlertRecord,
  escalationIndex: number,
): void {
  const now = record.sentAt;
  for (const alert of workflow.technicianAlerts) {
    if (!alert.respondedAt) {
      alert.respondedAt = now;
      alert.response = "timed_out";
    }
  }
  workflow.technicianAlerts.push(record);
  workflow.assignedTechnicianId = record.technicianId;
  workflow.technicianAlertedAt = record.sentAt;
  workflow.escalationStage = record.stage;
  workflow.escalationIndex = escalationIndex;
}

export function markAlertResponse(
  workflow: MissedCallWorkflow,
  technicianId: string,
  response: TechnicianAlertRecord["response"],
  at: Date,
): void {
  const alert = [...workflow.technicianAlerts]
    .reverse()
    .find((a) => a.technicianId === technicianId && !a.respondedAt);
  if (alert) {
    alert.respondedAt = at.toISOString();
    alert.response = response;
  }
}

/** Current open alert for a technician phone (post-escalation stale alerts excluded). */
export function findOpenAlertForPhone(
  workflow: MissedCallWorkflow,
  techPhoneE164: string,
  actionToken?: string | null,
): TechnicianAlertRecord | null {
  const open = [...workflow.technicianAlerts]
    .reverse()
    .find((a) => a.phone === techPhoneE164 && !a.respondedAt);
  if (!open) return null;
  if (
    actionToken &&
    open.actionToken.toUpperCase() !== actionToken.toUpperCase()
  ) {
    return null;
  }
  return open;
}
