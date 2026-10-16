import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCrmStore } from "../../src/product/crm/memory-store";
import { createCrmService } from "../../src/product/crm/service";

function service() {
  return createCrmService(createMemoryCrmStore());
}

describe("crm leads", () => {
  it("creates a customer, lead and conversation from one capture", async () => {
    const crm = service();
    const result = await crm.capture({
      organizationId: "org_a",
      source: "ai_receptionist",
      phoneE164: "(438) 555-0100",
      displayName: "Marie Tremblay",
      description: "Fuite sous l'évier",
      priority: "high",
    });
    assert.equal(result.created, true);
    assert.equal(result.customer.phoneE164, "+14385550100");
    assert.equal(result.customer.displayName, "Marie Tremblay");
    assert.equal(result.lead.status, "new");
    assert.equal(result.lead.priority, "high");
    assert.equal(result.conversation.control, "ai_managed");
    assert.equal(result.lead.organizationId, "org_a");
  });

  it("keeps a second touch on the same open lead", async () => {
    const crm = service();
    const first = await crm.capture({
      organizationId: "org_a",
      source: "missed_call",
      phoneE164: "+14385550100",
      description: "Premier appel",
    });
    const second = await crm.capture({
      organizationId: "org_a",
      source: "sms",
      phoneE164: "+1 438 555 0100",
      description: "Je rappelle",
      priority: "urgent",
      message: {
        direction: "inbound",
        body: "Je rappelle",
        deliveryStatus: "delivered",
      },
    });
    assert.equal(second.created, false);
    assert.equal(second.lead.id, first.lead.id);
    assert.equal(second.customer.id, first.customer.id);
    assert.equal(second.lead.priority, "urgent");
    assert.equal(second.lead.status, "new");
    const messages = await crm.getConversationBundle(
      "org_a",
      second.conversation.id,
    );
    assert.equal(messages?.messages.length, 1);
  });

  it("starts a new lead after the previous one is closed", async () => {
    const crm = service();
    const first = await crm.capture({
      organizationId: "org_a",
      source: "manual",
      phoneE164: "+14385550100",
    });
    await crm.updateLead("org_a", first.lead.id, { status: "won", actor: "owner" });
    const second = await crm.capture({
      organizationId: "org_a",
      source: "sms",
      phoneE164: "+14385550100",
      description: "Nouveau besoin",
    });
    assert.equal(second.created, true);
    assert.notEqual(second.lead.id, first.lead.id);
    assert.equal(second.customer.id, first.customer.id);
    const won = await crm.getLead("org_a", first.lead.id);
    assert.equal(won?.status, "won");
  });

  it("does not show another organization's leads", async () => {
    const crm = service();
    await crm.capture({
      organizationId: "org_a",
      source: "manual",
      phoneE164: "+14385550100",
      displayName: "Only A",
    });
    await crm.capture({
      organizationId: "org_b",
      source: "manual",
      phoneE164: "+14385550100",
      displayName: "Only B",
    });
    const a = await crm.listLeads("org_a");
    const b = await crm.listLeads("org_b");
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0]?.customer.displayName, "Only A");
    assert.equal(b[0]?.customer.displayName, "Only B");
    assert.equal(await crm.getLead("org_b", a[0]!.id), null);
  });

  it("blocks automated replies when a person has taken over", async () => {
    const crm = service();
    const first = await crm.capture({
      organizationId: "org_a",
      source: "sms",
      phoneE164: "+14385550100",
      message: {
        direction: "inbound",
        body: "Bonjour",
        deliveryStatus: "delivered",
      },
    });
    await crm.setControl("org_a", first.conversation.id, "human_managed", "owner");
    const blocked = await crm.capture({
      organizationId: "org_a",
      source: "sms",
      phoneE164: "+14385550100",
      message: {
        direction: "outbound",
        body: "Réponse automatique",
        automated: true,
        deliveryStatus: "queued",
      },
    });
    assert.equal(blocked.blocked, true);
    const bundle = await crm.getConversationBundle("org_a", first.conversation.id);
    assert.equal(bundle?.messages.length, 1);
    assert.equal(bundle?.conversation.control, "human_managed");
    const human = await crm.sendHumanMessage({
      organizationId: "org_a",
      conversationId: first.conversation.id,
      body: "Je m'en occupe",
      actor: "owner",
      simulated: true,
    });
    assert.equal(human?.deliveryStatus, "sent");
    assert.equal(human?.automated, false);
    const after = await crm.getLead("org_a", first.lead.id);
    assert.equal(after?.status, "contacted");
  });

  it("filters by status without mixing priority", async () => {
    const crm = service();
    await crm.capture({
      organizationId: "org_a",
      source: "manual",
      phoneE164: "+14385550101",
      priority: "low",
    });
    const hot = await crm.capture({
      organizationId: "org_a",
      source: "manual",
      phoneE164: "+14385550102",
      priority: "urgent",
    });
    await crm.updateLead("org_a", hot.lead.id, { status: "qualified" });
    const qualified = await crm.listLeads("org_a", { status: "qualified" });
    const urgent = await crm.listLeads("org_a", { priority: "urgent" });
    assert.equal(qualified.length, 1);
    assert.equal(qualified[0]?.priority, "urgent");
    assert.equal(urgent.length, 1);
    assert.equal(urgent[0]?.status, "qualified");
  });
});
