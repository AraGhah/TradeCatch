import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryGrowthStore } from "../../src/product/growth";
import { createMemoryStarterStore } from "../../src/product/starter";
import {
  lookupCallerContext,
  phoneKey,
  syncFinalizedCall,
  type LeadSyncDeps,
  type SyncOrganization,
} from "../../src/product/receptionist/lead-sync";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { buildCallSummary } from "../../src/product/receptionist/summary";
import type { CallSession } from "../../src/product/receptionist/types";

const CALLER = "+15145559876";
const config = parseReceptionistConfig({
  id: "rc_sync",
  clientAccountId: "client_sync",
  phoneNumberE164: "+14385597001",
  businessName: "Nord Plomberie",
  emergencyTransferE164: "+14385597003",
  notifications: [{ type: "email", to: "o@example.com" }],
});

function session(over: Partial<CallSession> = {}): CallSession {
  const now = new Date().toISOString();
  return {
    id: `rcs_${Math.random().toString(16).slice(2)}`,
    callSid: `CA_${Math.random().toString(16).slice(2)}`,
    configId: config.id,
    clientAccountId: config.clientAccountId,
    fromE164: CALLER,
    toE164: config.phoneNumberE164,
    language: "fr",
    status: "completed",
    step: "done",
    afterHours: false,
    slots: {
      callerName: "Marie Tremblay",
      serviceAddress: "123 rue Saint-Denis",
      issue: "évier qui coule",
      callbackE164: CALLER,
    },
    turns: [],
    silenceCount: 0,
    callerTurnCount: 3,
    transfers: [],
    notifications: [],
    startedAt: now,
    endedAt: now,
    updatedAt: now,
    finalizedAt: now,
    outcome: "message_taken",
    version: 2,
    ...over,
  };
}

function setup(plan: SyncOrganization["plan"] = "growth", status = "active") {
  const starter = createMemoryStarterStore();
  const growth = createMemoryGrowthStore();
  const calls: CallSession[] = [];
  const org: SyncOrganization = { id: "org_sync", plan, status };
  const deps: LeadSyncDeps = {
    findOrganization: async (id) => (id === "client_sync" ? org : null),
    listWebsiteLeads: (orgId) => starter.listWebsiteLeads(orgId),
    updateWebsiteLead: (id, orgId, patch) => starter.updateWebsiteLead(id, orgId, patch),
    growth,
    listCalls: async () => calls,
  };
  return { starter, growth, calls, deps };
}

async function webLead(
  starter: ReturnType<typeof setup>["starter"],
  over: Record<string, unknown> = {},
) {
  return starter.createWebsiteLead({
    organizationId: "org_sync",
    name: "Marie T.",
    phoneE164: "(514) 555-9876",
    serviceRequested: "chauffe-eau",
    status: "new",
    conversationMode: "auto",
    openingSmsSent: false,
    ...over,
  } as never);
}

describe("receptionist ↔ website lead sync", () => {
  it("normalizes phone numbers across formats", () => {
    assert.equal(phoneKey("+1 (514) 555-9876"), "5145559876");
    assert.equal(phoneKey("514-555-9876"), "5145559876");
    assert.equal(phoneKey(undefined), "");
  });

  it("recognizes a caller who already filled the website form, and counts earlier calls", async () => {
    const { starter, deps, calls } = setup();
    const lead = await webLead(starter);
    calls.push(session(), session({ fromE164: "+14385550000" }));

    const ctx = await lookupCallerContext(deps, {
      clientAccountId: "client_sync",
      callerE164: CALLER,
      excludeSessionId: "rcs_current",
    });
    assert.equal(ctx!.websiteLeadId, lead.id);
    assert.equal(ctx!.websiteLeadName, "Marie T.");
    assert.equal(ctx!.websiteLeadService, "chauffe-eau");
    assert.equal(ctx!.priorCalls, 1);
  });

  it("returns null for an unknown caller and ignores spam leads and other numbers", async () => {
    const { starter, deps } = setup();
    await webLead(starter, { status: "spam" });
    await webLead(starter, { phoneE164: "+14385550001" });
    assert.equal(
      await lookupCallerContext(deps, { clientAccountId: "client_sync", callerE164: CALLER, excludeSessionId: "x" }),
      null,
    );
  });

  it("matches on the callback number the caller gave, not only the caller id", async () => {
    const { starter, deps } = setup();
    await webLead(starter, { phoneE164: "+15145550999" });
    const ctx = await lookupCallerContext(deps, {
      clientAccountId: "client_sync",
      callerE164: "+15145551111",
      callbackE164: "+15145550999",
      excludeSessionId: "x",
    });
    assert.ok(ctx?.websiteLeadId);
  });

  it("updates the matching website lead, creates one qualified pipeline card and logs the timeline", async () => {
    const { starter, growth, deps } = setup();
    const lead = await webLead(starter, { message: "Besoin d'un chauffe-eau" });
    const call = session();

    const r = await syncFinalizedCall(deps, config, call);
    assert.deepEqual(r, {
      organizationId: "org_sync",
      websiteLeadUpdated: true,
      pipelineCard: "created",
      timeline: true,
    });

    const updated = (await starter.getWebsiteLead(lead.id, "org_sync"))!;
    assert.equal(updated.status, "qualified");
    assert.match(updated.message!, /Besoin d'un chauffe-eau\n\[Appel IA \d{4}-\d{2}-\d{2}\] évier qui coule/);

    const cards = await growth.listPipeline("org_sync");
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.stage, "qualified");
    assert.equal(cards[0]!.source, "missed_call");
    assert.equal(cards[0]!.sourceRefId, call.id);
    assert.match(cards[0]!.title, /Appel IA · Marie Tremblay — évier qui coule/);

    const timeline = await growth.listTimeline("org_sync");
    assert.equal(timeline[0]!.kind, "ai_call");
    assert.equal(timeline[0]!.actor, "ai_receptionist");
  });

  it("does not create a second card for the same caller within a week, but does for a new caller", async () => {
    const { growth, deps } = setup();
    await syncFinalizedCall(deps, config, session());
    const again = await syncFinalizedCall(deps, config, session());
    assert.equal(again.pipelineCard, "existing");
    const other = await syncFinalizedCall(
      deps,
      config,
      session({ fromE164: "+14385550123", slots: { callerName: "Luc", issue: "fuite", callbackE164: "+14385550123" } }),
    );
    assert.equal(other.pipelineCard, "created");
    assert.equal((await growth.listPipeline("org_sync")).length, 2);
  });

  it("escalates a critical call to needs_attention and stops the SMS bot on the linked lead", async () => {
    const { starter, deps } = setup();
    const lead = await webLead(starter);
    await syncFinalizedCall(
      deps,
      config,
      session({ urgency: { level: "critical", source: "critical_gas", requiresHuman: true, escalated: true } }),
    );
    const updated = (await starter.getWebsiteLead(lead.id, "org_sync"))!;
    assert.equal(updated.status, "needs_attention");
    assert.equal(updated.conversationMode, "needs_attention");
  });

  it("only logs the timeline for FAQ-only calls and on Starter (no pipeline entitlement)", async () => {
    const faq = setup();
    const r1 = await syncFinalizedCall(faq.deps, config, session({ slots: {}, outcome: "faq_answered" }));
    assert.equal(r1.pipelineCard, "skipped");
    assert.equal(r1.websiteLeadUpdated, false);
    assert.equal((await faq.growth.listPipeline("org_sync")).length, 0);
    assert.equal((await faq.growth.listTimeline("org_sync")).length, 1);

    const starterPlan = setup("starter");
    const lead = await webLead(starterPlan.starter);
    const r2 = await syncFinalizedCall(starterPlan.deps, config, session());
    assert.equal(r2.websiteLeadUpdated, true);
    assert.equal(r2.pipelineCard, "skipped");
    assert.equal((await starterPlan.growth.listPipeline("org_sync")).length, 0);
    assert.equal((await starterPlan.starter.getWebsiteLead(lead.id, "org_sync"))!.status, "qualified");
  });

  it("does nothing for unlinked or suspended organizations", async () => {
    const unlinked = setup();
    const cfg = parseReceptionistConfig({ ...config, clientAccountId: "client_other", notifications: config.notifications });
    const r = await syncFinalizedCall(unlinked.deps, cfg, session({ clientAccountId: "client_other" }));
    assert.equal(r.organizationId, null);

    const suspended = setup("growth", "suspended");
    const r2 = await syncFinalizedCall(suspended.deps, config, session());
    assert.equal(r2.organizationId, null);
    assert.equal((await suspended.growth.listTimeline("org_sync")).length, 0);
  });

  it("puts the known-contact line in the owner summary", () => {
    const s = session({
      context: {
        websiteLeadId: "wlead_1",
        websiteLeadName: "Marie T.",
        websiteLeadService: "chauffe-eau",
        websiteLeadAt: "2026-03-01T12:00:00.000Z",
        priorCalls: 2,
      },
    });
    const summary = buildCallSummary(config, s);
    assert.match(summary.knownContact!, /Déjà un lead web « Marie T\. » \(chauffe-eau\) le 2026-03-01/);
    assert.match(summary.knownContact!, /2 appel\(s\) précédent\(s\)/);
    assert.equal(buildCallSummary(config, session()).knownContact, undefined);
  });
});
