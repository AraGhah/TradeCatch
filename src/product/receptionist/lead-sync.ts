/**
 * Website ↔ AI receptionist sync.
 *
 * - `lookupCallerContext`: what the CRM already knows about a caller (a lead
 *   captured by the contractor's website form, earlier AI calls). Owner-facing
 *   only — never spoken to the caller because caller ID can be spoofed.
 * - `syncFinalizedCall`: after a call, write the outcome back into the same
 *   workspace the website form feeds: update the matching website lead,
 *   add a pipeline card (Growth), and log a timeline event.
 *
 * Dependencies are injected so the logic is store-agnostic and unit-testable.
 */

import type { GrowthStore } from "@/product/growth/memory-store";
import type { PlanId } from "@/product/saas/entitlements";
import { orgHasFeature } from "@/product/saas/entitlements";
import type { WebsiteLead } from "@/product/starter/types";
import type { CallContext, CallSession, ReceptionistConfig } from "./types";

export type SyncOrganization = { id: string; plan: PlanId; status: string };

export type LeadSyncDeps = {
  findOrganization(clientAccountId: string): Promise<SyncOrganization | null>;
  listWebsiteLeads(organizationId: string): Promise<WebsiteLead[]>;
  updateWebsiteLead(
    id: string,
    organizationId: string,
    patch: Partial<
      Pick<WebsiteLead, "status" | "message" | "conversationMode">
    >,
  ): Promise<unknown>;
  growth: Pick<
    GrowthStore,
    "listPipeline" | "upsertPipelineCard" | "addTimelineEvent"
  >;
  /** Earlier receptionist calls for the same business. */
  listCalls(clientAccountId: string): Promise<CallSession[]>;
};

/** Digits only, NANP country code stripped, so +1 514… equals (514) …. */
export function phoneKey(phone: string | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

function sameNumber(a: string | undefined, b: string | undefined): boolean {
  const ka = phoneKey(a);
  return ka.length >= 10 && ka === phoneKey(b);
}

function findWebsiteLead(
  leads: WebsiteLead[],
  numbers: (string | undefined)[],
): WebsiteLead | undefined {
  // listWebsiteLeads is newest-first; a "spam" lead is never treated as a contact.
  return leads.find(
    (l) =>
      l.status !== "spam" && numbers.some((n) => sameNumber(l.phoneE164, n)),
  );
}

export async function lookupCallerContext(
  deps: LeadSyncDeps,
  input: {
    clientAccountId: string;
    callerE164: string;
    callbackE164?: string;
    excludeSessionId: string;
  },
): Promise<CallContext | null> {
  const numbers = [input.callerE164, input.callbackE164];
  const org = await deps.findOrganization(input.clientAccountId);

  let lead: WebsiteLead | undefined;
  if (org) lead = findWebsiteLead(await deps.listWebsiteLeads(org.id), numbers);

  const priorCalls = (await deps.listCalls(input.clientAccountId)).filter(
    (c) =>
      c.id !== input.excludeSessionId &&
      numbers.some((n) => sameNumber(c.fromE164, n)),
  ).length;

  if (!lead && priorCalls === 0) return null;
  return {
    websiteLeadId: lead?.id,
    websiteLeadName: lead?.name,
    websiteLeadService: lead?.serviceRequested ?? lead?.message?.slice(0, 80),
    websiteLeadAt: lead?.createdAt,
    priorCalls,
  };
}

function hasRealRequest(session: CallSession): boolean {
  return Boolean(session.slots.issue || session.slots.message);
}

function cardTitle(session: CallSession): string {
  const who = session.slots.callerName ?? session.fromE164;
  const what = (session.slots.issue ?? session.slots.message ?? "").trim();
  const short = what.length > 60 ? `${what.slice(0, 57)}…` : what;
  const prefix = session.urgency?.level === "critical" ? "🚨 " : "";
  return `${prefix}Appel IA · ${who}${short ? ` — ${short}` : ""}`;
}

const OPEN_STAGES = new Set([
  "new",
  "contacted",
  "qualified",
  "quoted",
  "booked",
]);
const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type LeadSyncResult = {
  organizationId: string | null;
  websiteLeadUpdated: boolean;
  pipelineCard: "created" | "existing" | "skipped";
  timeline: boolean;
};

export async function syncFinalizedCall(
  deps: LeadSyncDeps,
  config: ReceptionistConfig,
  session: CallSession,
  now: Date = new Date(),
): Promise<LeadSyncResult> {
  const result: LeadSyncResult = {
    organizationId: null,
    websiteLeadUpdated: false,
    pipelineCard: "skipped",
    timeline: false,
  };
  const org = await deps.findOrganization(config.clientAccountId);
  if (!org || org.status !== "active") return result;
  result.organizationId = org.id;

  const at = session.endedAt ?? session.updatedAt;
  const critical = session.urgency?.level === "critical";

  await deps.growth.addTimelineEvent({
    organizationId: org.id,
    kind: "ai_call",
    refId: session.id,
    title: session.summary?.headline ?? cardTitle(session),
    detail: session.summary?.nextStep,
    actor: "ai_receptionist",
    at,
  });
  result.timeline = true;

  // Nothing worth a CRM record for FAQ-only calls, pure transfers or silence.
  if (!hasRealRequest(session)) return result;

  // 1) The same person already used the contractor's website form.
  const leads = await deps.listWebsiteLeads(org.id);
  const lead = findWebsiteLead(leads, [
    session.fromE164,
    session.slots.callbackE164,
  ]);
  if (lead) {
    const note =
      `[Appel IA ${at.slice(0, 10)}] ${session.slots.issue ?? session.slots.message ?? ""}`.trim();
    const nextStatus: WebsiteLead["status"] = critical
      ? "needs_attention"
      : lead.status === "new" || lead.status === "contacted"
        ? "qualified"
        : lead.status;
    await deps.updateWebsiteLead(lead.id, org.id, {
      status: nextStatus,
      // A phone conversation happened: a human should look at it, not the SMS bot.
      conversationMode: critical ? "needs_attention" : lead.conversationMode,
      message: [lead.message, note].filter(Boolean).join("\n").slice(0, 2000),
    });
    result.websiteLeadUpdated = true;
  }

  // 2) Pipeline card (Growth only), one open card per phone per week.
  if (!orgHasFeature(org.plan, "ADVANCED_PIPELINE")) return result;

  const cards = await deps.growth.listPipeline(org.id);
  const recent = cards.find(
    (c) =>
      OPEN_STAGES.has(c.stage) &&
      sameNumber(
        c.customerPhoneE164,
        session.slots.callbackE164 ?? session.fromE164,
      ) &&
      now.getTime() - Date.parse(c.updatedAt) < DEDUPE_WINDOW_MS,
  );
  if (recent) {
    result.pipelineCard = "existing";
    return result;
  }

  const complete = Boolean(
    session.slots.callerName &&
    session.slots.serviceAddress &&
    session.slots.issue,
  );
  await deps.growth.upsertPipelineCard({
    organizationId: org.id,
    stage: complete || lead ? "qualified" : "new",
    title: cardTitle(session),
    // Phone-originated lead: same pipeline source as the missed-call workflow.
    source: "missed_call",
    sourceRefId: session.id,
    customerPhoneE164: session.slots.callbackE164 ?? session.fromE164,
  });
  result.pipelineCard = "created";
  return result;
}
