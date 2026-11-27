import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  decisionEmailKey,
  renderWebsiteDecisionEmail,
  websiteDomain,
} from "../../src/product/website-services/decision-email";
import { notifyCustomerOfDecision } from "../../src/product/website-services/notify";
import { createWebsiteRequestService } from "../../src/product/website-services/service";
import { createMemoryWebsiteRequestStore } from "../../src/product/website-services/store";
import type { WebsiteFocusArea } from "../../src/product/website-services/model";
import { createPostgresWebsiteRequestStore } from "../../src/product/website-services/postgres-store";
import { openAdminConsoleDb, pgliteAvailable, poolOf, type Db } from "./support/pglite-db";

const input = (language: "en" | "fr" = "en", url = "https://www.acme-plomberie.ca/contact") => ({
  requestType: "improve" as const,
  businessName: "Acme <Plomberie>",
  contactName: "Jo",
  contactEmail: "jo@acme.ca",
  contactPhone: "514-555-0100",
  currentWebsiteUrl: url,
  focusAreas: ["mobile"] as WebsiteFocusArea[],
  notes: "",
  language,
});

function setup() {
  const service = createWebsiteRequestService(createMemoryWebsiteRequestStore());
  const sent: { to: string; subject: string; html: string; text: string; idempotencyKey: string }[] = [];
  const send = async (email: (typeof sent)[number]) => {
    sent.push(email);
    return { sent: true, configured: true };
  };
  return { service, sent, send };
}

async function decide(
  service: ReturnType<typeof setup>["service"],
  status: "approved" | "rejected",
  language: "en" | "fr" = "en",
  url?: string,
) {
  const { request } = await service.submit(input(language, url), {
    organizationId: "org_1",
    source: "dashboard",
  });
  await service.adminUpdate(request.id, { status: "in_review" }, "admin@tradecatch.ca");
  const result = await service.adminUpdate(
    request.id,
    status === "rejected"
      ? {
          status,
          reviewNote: "internal: low budget",
          customerReason: "We only build sites for trades in Québec.",
        }
      : { status },
    "admin@tradecatch.ca",
  );
  assert.equal(result.ok, true);
  return result.ok ? result.request : request;
}

describe("website decision email", () => {
  it("names the domain, status, decision date and next steps for an approval", async () => {
    const { service } = setup();
    const request = await decide(service, "approved");
    const email = renderWebsiteDecisionEmail(request, {
      status: "approved",
      reason: null,
      dashboardUrl: "https://tradecatch.ca/en/app/website-services",
    });
    assert.equal(email.subject, "Your website request is approved: acme-plomberie.ca");
    assert.match(email.text, /Website: acme-plomberie\.ca/);
    assert.match(email.text, /New status: Approved/);
    assert.match(email.text, /Decision date: .*2026|Decision date: \w+ \d+, \d{4}/);
    assert.match(email.text, /Next steps:\n1\. We will send you the written scope/);
    assert.doesNotMatch(email.text, /Reason:/, "an approval has no reason");
    assert.match(email.html, /href="https:\/\/tradecatch\.ca\/en\/app\/website-services"/);
  });

  it("gives the customer reason, never the internal note, and escapes everything", async () => {
    const { service } = setup();
    const request = await decide(service, "rejected", "fr");
    const email = renderWebsiteDecisionEmail(request, {
      status: "rejected",
      reason: "Nous ne réalisons que des sites <b>au Québec</b>.",
      dashboardUrl: "https://tradecatch.ca/fr/app/website-services",
    });
    assert.equal(email.subject, "Suivi de votre demande de site web: acme-plomberie.ca");
    assert.match(email.text, /Nouveau statut : Non approuvée|Nouveau statut: Non approuvée/);
    assert.match(email.text, /Motif: Nous ne réalisons/);
    assert.doesNotMatch(email.html, /internal: low budget/);
    assert.doesNotMatch(email.html, /<b>au Québec<\/b>/, "the reason is escaped");
    assert.match(email.html, /Acme &lt;Plomberie&gt;/, "the business name is escaped");
  });

  it("says 'your new website' when there is no current site", () => {
    assert.equal(websiteDomain(null), null);
    assert.equal(websiteDomain("not a url at all"), null);
    assert.equal(websiteDomain("acme.ca"), "acme.ca");
  });
});

describe("notifying the customer of a decision", () => {
  it("emails once per decision, records it, and a replay sends nothing", async () => {
    const { service, sent, send } = setup();
    const request = await decide(service, "approved");
    const first = await notifyCustomerOfDecision(request, { reason: null }, { service, send, siteUrl: "https://tradecatch.ca" });
    const again = await notifyCustomerOfDecision(request, { reason: null }, { service, send, siteUrl: "https://tradecatch.ca" });
    assert.equal(first, "sent");
    assert.equal(again, "already_sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "jo@acme.ca");
    assert.equal(sent[0]!.idempotencyKey, decisionEmailKey(request));
    const notes = (await service.history(request.id)).filter((e) => e.kind === "notified").map((e) => e.note);
    assert.deepEqual(notes, [`Customer email approved [${request.statusChangedAt}]: sent`]);
  });

  it("records a failure (so the team can follow up) and tries again next time", async () => {
    const { service } = setup();
    const request = await decide(service, "rejected");
    let calls = 0;
    const failing = async () => {
      calls += 1;
      return { sent: false, configured: true };
    };
    assert.equal(await notifyCustomerOfDecision(request, { reason: "x".repeat(10) }, { service, send: failing }), "failed");
    assert.equal(await notifyCustomerOfDecision(request, { reason: "x".repeat(10) }, { service, send: failing }), "failed");
    assert.equal(calls, 2, "a failed email is not counted as sent");
  });

  it("says so when email is not configured, and never emails other statuses", async () => {
    const { service } = setup();
    const request = await decide(service, "approved");
    const off = async () => ({ sent: false, configured: false });
    assert.equal(await notifyCustomerOfDecision(request, { reason: null }, { service, send: off }), "not_configured");
    const { request: fresh } = await service.submit(input(), { organizationId: null, source: "pricing" });
    assert.equal(await notifyCustomerOfDecision(fresh, { reason: null }, { service, send: off }), "skipped");
  });
});

describe("customer decision emails on PostgreSQL", { skip: !pgliteAvailable }, () => {
  let db: Db;
  before(async () => {
    db = await openAdminConsoleDb();
  });
  after(async () => {
    await db?.close();
  });

  it("records the email in the real history table and dedupes on it", async () => {
    const service = createWebsiteRequestService(createPostgresWebsiteRequestStore(poolOf(db)));
    const { request } = await service.submit(input(), { organizationId: null, source: "pricing" });
    await service.adminUpdate(request.id, { status: "in_review" }, "a");
    const approved = await service.adminUpdate(request.id, { status: "approved" }, "a");
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    let sends = 0;
    const send = async () => {
      sends += 1;
      return { sent: true, configured: true };
    };
    assert.equal(await notifyCustomerOfDecision(approved.request, { reason: null }, { service, send }), "sent");
    assert.equal(await notifyCustomerOfDecision(approved.request, { reason: null }, { service, send }), "already_sent");
    assert.equal(sends, 1);
    const row = await service.getAny(request.id);
    assert.equal(row?.notificationStatus, null, "the team notification status is untouched");
  });
});
