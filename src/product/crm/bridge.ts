/**
 * Best-effort bridges from the receptionist, missed-call recovery, and SMS.
 * Failures here must not break the call or text that already succeeded.
 */

import type { MissedCallWorkflow } from "@/product/missed-call/types";
import type { CallSession } from "@/product/receptionist/types";
import type { LeadPriority } from "./types";
import { getCrmService } from "./runtime";

function priorityFromUrgency(level?: string): LeadPriority | undefined {
  if (level === "critical") return "urgent";
  if (level === "priority") return "high";
  if (level === "routine") return "medium";
  return undefined;
}

async function organizationIdForClient(
  clientAccountId: string,
): Promise<string | null> {
  const { getSaasStore } = await import("@/product/saas/runtime");
  const org =
    await getSaasStore().findOrganizationByMissedCallClientId(clientAccountId);
  if (!org || org.status !== "active") return null;
  return org.id;
}

export async function syncAiCallToCrm(
  session: CallSession,
  clientAccountId: string,
): Promise<void> {
  const useful = Boolean(
    session.slots.issue ||
      session.slots.message ||
      session.slots.callerName ||
      session.urgency?.level === "critical",
  );
  if (!useful) return;
  const organizationId = await organizationIdForClient(clientAccountId);
  if (!organizationId) return;
  const description =
    session.summary?.headline ||
    session.slots.issue ||
    session.slots.message ||
    undefined;
  await getCrmService().capture({
    organizationId,
    source: "ai_receptionist",
    phoneE164: session.slots.callbackE164 ?? session.fromE164,
    displayName: session.slots.callerName,
    serviceAddress: session.slots.serviceAddress,
    preferredLanguage: session.language,
    service: session.intent,
    description,
    priority: priorityFromUrgency(session.urgency?.level),
    urgencyNote: session.urgency?.level,
    callSessionId: session.id,
    callSid: session.callSid,
    actor: "ai_receptionist",
    message: description
      ? {
          direction: "inbound",
          body: description,
          fromE164: session.fromE164,
          automated: false,
          simulated: false,
          deliveryStatus: "delivered",
        }
      : undefined,
  });
  const urgent = session.urgency?.level === "critical";
  const { emitBusinessEvent } = await import("@/product/notifications/hooks");
  await emitBusinessEvent({
    organizationId,
    type: urgent ? "urgent_request" : session.intent === "transfer" ? "human_requested" : "lead_created",
    idempotencyKey: `call:${session.id}`,
    customer: session.slots.callerName,
    service: description,
    location: session.slots.serviceAddress,
    callId: session.id,
    consolidateKey: session.id,
    href: "/app/leads",
  });
}

export async function syncMissedCallWorkflow(input: {
  clientAccountId: string;
  workflow: MissedCallWorkflow | null;
  callSid?: string;
}): Promise<void> {
  if (!input.workflow) return;
  const organizationId = await organizationIdForClient(input.clientAccountId);
  if (!organizationId) return;
  const collected = input.workflow.collected;
  await getCrmService().capture({
    organizationId,
    source: "missed_call",
    phoneE164: input.workflow.callerE164,
    displayName: collected.customerName,
    serviceAddress: collected.serviceAddress,
    preferredLanguage: collected.language === "en" ? "en" : "fr",
    description: collected.issueDescription,
    priority: priorityFromUrgency(input.workflow.urgency?.level),
    urgencyNote: input.workflow.urgency?.level,
    callSid: input.callSid,
    missedCallLeadId: input.workflow.leadId,
    actor: "missed_call",
    message: collected.issueDescription
      ? {
          direction: "inbound",
          body: collected.issueDescription,
          fromE164: input.workflow.callerE164,
          automated: false,
          deliveryStatus: "delivered",
        }
      : undefined,
  });
}

export async function syncWebsiteLeadToCrm(input: {
  organizationId: string;
  phoneE164: string;
  name?: string;
  email?: string;
  message?: string;
  service?: string;
  websiteLeadId: string;
}): Promise<void> {
  if (!input.phoneE164) return;
  await getCrmService().capture({
    organizationId: input.organizationId,
    source: "website",
    phoneE164: input.phoneE164,
    displayName: input.name,
    email: input.email,
    service: input.service,
    description: input.message,
    websiteLeadId: input.websiteLeadId,
    actor: "website",
    message: input.message
      ? {
          direction: "inbound",
          body: input.message,
          automated: false,
          deliveryStatus: "delivered",
        }
      : undefined,
  });
}
