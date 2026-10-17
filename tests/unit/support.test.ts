import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchHelp } from "../../src/product/support/help";
import { createSupportService } from "../../src/product/support/service";
import { createMemorySupportStore } from "../../src/product/support/store";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";

function service() {
  const notices: string[] = [];
  const support = createSupportService({
    store: createMemorySupportStore(),
    now: () => new Date("2026-10-16T12:00:00.000Z"),
    async notify(input) { notices.push(input.ticketId); },
  });
  return { support, notices };
}

describe("support, help, and account requests", () => {
  it("keeps tickets inside one business and hides internal notes", async () => {
    const { support, notices } = service();
    const ticket = await support.createTicket({
      organizationId: "org-a",
      subject: "AI receptionist not answering calls",
      category: "ai",
      description: "Customers call and nobody answers. sk_live_secret",
      priority: "critical",
      contactEmail: "owner@example.com",
    });
    assert.equal(notices.length, 1);
    assert.equal(ticket.description.includes("sk_live_secret"), false);
    await assert.rejects(() => support.createTicket({
      organizationId: "org-a",
      subject: "Bypass",
      category: "other",
      description: "Trying a custom priority",
      priority: "urgent" as "normal",
      contactEmail: "owner@example.com",
    }));
    await support.reply({ organizationId: "org-a", ticketId: ticket.id, authorRole: "admin", body: "Checking the receptionist configuration.", internal: false });
    await support.reply({ organizationId: "org-a", ticketId: ticket.id, authorRole: "admin", body: "Private investigation note", internal: true });
    const contractor = await support.forBusiness("org-a", ticket.id);
    assert.equal(contractor.messages.some((message) => message.body.includes("Private")), false);
    await assert.rejects(() => support.forBusiness("org-b", ticket.id));
    const updated = await support.setStatus(ticket.id, "investigating");
    const resolved = await support.setStatus(ticket.id, "resolved");
    assert.equal(updated.status, "investigating");
    assert.equal(resolved.status, "resolved");
  });

  it("detects a disconnected calendar without exposing credentials", () => {
    const { support } = service();
    const report = support.diagnose({
      plan: "starter",
      phone: "+15145550100",
      calendarConnected: false,
      automationEnabled: true,
      smsConfigured: true,
    });
    const serialized = JSON.stringify(report);
    assert.equal(report.liveVerified, false);
    assert.equal(report.scope, "configuration");
    assert.equal(report.findings.some((finding) => finding.code === "calendar_disconnected"), true);
    assert.equal(serialized.includes("sk_"), false);
    assert.equal(serialized.includes("TWILIO"), false);
    assert.equal(serialized.includes("+15145550100"), false);
  });

  it("finds the Google Calendar article in English and French", () => {
    const english = searchHelp("How to connect Google Calendar", "en");
    const french = searchHelp("Comment connecter Google Agenda", "fr");
    assert.equal(english.some((article) => article.id === "calendar"), true);
    assert.equal(french.some((article) => article.id === "calendar"), true);
  });

  it("records deletion without erasing the business or its ticket", async () => {
    const { support } = service();
    const saas = createMemorySaasStore();
    const created = await saas.createOrganizationWithOwner({
      name: "North Plumbing",
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
    });
    const ticket = await support.createTicket({
      organizationId: created.organization.id,
      subject: "Question about subscription",
      category: "billing",
      description: "Need the invoice timing.",
      priority: "normal",
      contactEmail: "owner@example.com",
    });
    const request = await support.requestAccountChange(created.organization.id, "deletion");
    assert.equal(request.phoneRouting, "unchanged_until_transition");
    assert.equal(request.status, "requested");
    const still = await saas.getOrganization(created.organization.id);
    const saved = await saas.updateOrganization(created.organization.id, { name: "North Plumbing Updated" });
    assert.equal(still?.name, "North Plumbing");
    assert.equal(saved?.name, "North Plumbing Updated");
    assert.equal((await support.forBusiness(created.organization.id, ticket.id)).ticket.subject, "Question about subscription");
  });
});
