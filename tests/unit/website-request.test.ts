import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeWebsiteUrl,
  publicWebsiteRequestSchema,
  websiteRequestSchema,
  websiteRequestUpdateSchema,
} from "../../src/lib/validation/website-request";
import {
  canTransitionWebsiteStatus,
  isValidQuotedPrice,
  toWebsiteRequestView,
  type WebsiteFocusArea,
  type WebsiteRequest,
} from "../../src/product/website-services/model";
import { createWebsiteRequestService } from "../../src/product/website-services/service";
import { createMemoryWebsiteRequestStore } from "../../src/product/website-services/store";

const valid = {
  requestType: "new" as const,
  businessName: "Acme Plumbing",
  contactName: "Jo Acme",
  contactEmail: "jo@acme.ca",
  contactPhone: "514-555-0100",
  currentWebsiteUrl: "",
  focusAreas: ["mobile", "lead_capture"] as WebsiteFocusArea[],
  notes: "",
  language: "en" as const,
};

describe("normalizeWebsiteUrl", () => {
  it("accepts addresses people actually type", () => {
    assert.equal(normalizeWebsiteUrl("acme.ca"), "https://acme.ca/");
    assert.equal(normalizeWebsiteUrl("www.acme.ca/about"), "https://www.acme.ca/about");
    assert.equal(normalizeWebsiteUrl("http://acme.ca"), "http://acme.ca/");
    assert.equal(normalizeWebsiteUrl("acme.ca:8080/x"), "https://acme.ca:8080/x");
  });

  it("refuses anything that is not an http(s) web address", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<b>x</b>",
      "mailto:jo@acme.ca",
      "ftp://acme.ca",
      "file:///etc/passwd",
      "https://user:pass@acme.ca",
      "localhost",
      "acme",
      "acme.ca/has space",
      "",
      "   ",
      `https://acme.ca/${"a".repeat(2100)}`,
    ]) {
      assert.equal(normalizeWebsiteUrl(bad), null, bad);
    }
  });
});

describe("websiteRequestSchema", () => {
  it("accepts a short new-website request", () => {
    assert.equal(websiteRequestSchema.safeParse(valid).success, true);
  });

  it("requires the current website only when improving", () => {
    const improve = websiteRequestSchema.safeParse({ ...valid, requestType: "improve" });
    assert.equal(improve.success, false);
    assert.equal(
      improve.error?.issues.some((i) => i.message === "url_required"),
      true,
    );
    assert.equal(
      websiteRequestSchema.safeParse({
        ...valid,
        requestType: "improve",
        currentWebsiteUrl: "acme.ca",
      }).success,
      true,
    );
  });

  it("rejects an unusable address even when optional", () => {
    const result = websiteRequestSchema.safeParse({
      ...valid,
      currentWebsiteUrl: "javascript:alert(1)",
    });
    assert.equal(result.success, false);
  });

  it("rejects bad types, focus areas, emails and over-long notes", () => {
    for (const patch of [
      { requestType: "rebuild" },
      { focusAreas: ["mobile", "hacking"] },
      { contactEmail: "not-an-email" },
      { businessName: "" },
      { notes: "x".repeat(1001) },
      { language: "de" },
      { contactPhone: "call me" },
    ]) {
      assert.equal(
        websiteRequestSchema.safeParse({ ...valid, ...patch }).success,
        false,
        JSON.stringify(patch),
      );
    }
  });

  it("public form also needs the bot check and an idempotency key", () => {
    const base = {
      ...valid,
      turnstileToken: "t",
      idempotencyKey: "0b8f4f86-6c57-4c3b-9a2c-0a0a0a0a0a0a",
    };
    assert.equal(publicWebsiteRequestSchema.safeParse(base).success, true);
    assert.equal(
      publicWebsiteRequestSchema.safeParse({ ...base, turnstileToken: "" }).success,
      false,
    );
    assert.equal(
      publicWebsiteRequestSchema.safeParse({ ...base, idempotencyKey: "x" }).success,
      false,
    );
  });
});

describe("websiteRequestUpdateSchema", () => {
  it("refuses unknown fields (e.g. reassigning the business) and empty updates", () => {
    assert.equal(
      websiteRequestUpdateSchema.safeParse({ organizationId: "org_other" }).success,
      false,
    );
    assert.equal(websiteRequestUpdateSchema.safeParse({}).success, false);
    assert.equal(
      websiteRequestUpdateSchema.safeParse({ status: "in_review" }).success,
      true,
    );
    assert.equal(
      websiteRequestUpdateSchema.safeParse({ status: "refunded" }).success,
      false,
    );
  });
});

describe("status model", () => {
  it("only moves forward, or to cancelled", () => {
    assert.equal(canTransitionWebsiteStatus("submitted", "in_review"), true);
    assert.equal(canTransitionWebsiteStatus("in_review", "quoted"), true);
    assert.equal(canTransitionWebsiteStatus("quoted", "in_progress"), true);
    assert.equal(canTransitionWebsiteStatus("in_progress", "delivered"), true);
    assert.equal(canTransitionWebsiteStatus("quoted", "in_review"), true);
    // Never straight into work without a quote, never back from delivered.
    assert.equal(canTransitionWebsiteStatus("submitted", "in_progress"), false);
    assert.equal(canTransitionWebsiteStatus("in_review", "delivered"), false);
    assert.equal(canTransitionWebsiteStatus("delivered", "in_progress"), false);
    assert.equal(canTransitionWebsiteStatus("cancelled", "submitted"), false);
  });

  it("never quotes below the starting price", () => {
    assert.equal(isValidQuotedPrice(349, 349), true);
    assert.equal(isValidQuotedPrice(1200, 349), true);
    assert.equal(isValidQuotedPrice(348.99, 349), false);
    assert.equal(isValidQuotedPrice(Number.NaN, 349), false);
    assert.equal(isValidQuotedPrice(1_000_000, 349), false);
  });
});

function setup() {
  let tick = 0;
  const service = createWebsiteRequestService(
    createMemoryWebsiteRequestStore(),
    () => new Date(Date.UTC(2026, 10, 1, 12, 0, tick++)),
  );
  return service;
}

describe("website request service", () => {
  it("records a request without any billing side effect and normalizes input", async () => {
    const service = setup();
    const { created, request } = await service.submit(
      {
        ...valid,
        requestType: "improve",
        currentWebsiteUrl: "acme.ca",
        contactEmail: "Jo@Acme.CA",
        focusAreas: ["mobile", "mobile", "tradecatch"],
      },
      { organizationId: "org_a", source: "dashboard" },
    );
    assert.equal(created, true);
    assert.equal(request.status, "submitted");
    assert.equal(request.currentWebsiteUrl, "https://acme.ca/");
    assert.equal(request.contactEmail, "jo@acme.ca");
    assert.deepEqual(request.focusAreas, ["mobile", "tradecatch"]);
    assert.equal(request.quotedPriceCad, null);
    assert.equal(request.organizationId, "org_a");
  });

  it("a replayed submission returns the original instead of a second request", async () => {
    const service = setup();
    const ctx = { organizationId: null, source: "pricing" as const, idempotencyKey: "k-1" };
    const first = await service.submit(valid, ctx);
    const second = await service.submit(valid, ctx);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.request.id, first.request.id);
    assert.equal((await service.listAll()).length, 1);
  });

  it("keeps each business's requests apart (tenant isolation)", async () => {
    const service = setup();
    const a = await service.submit(valid, { organizationId: "org_a", source: "dashboard" });
    await service.submit(valid, { organizationId: "org_b", source: "dashboard" });
    await service.submit(valid, { organizationId: null, source: "pricing" });

    assert.equal((await service.listForOrganization("org_a")).length, 1);
    assert.equal((await service.listForOrganization("org_b")).length, 1);
    assert.equal((await service.listForOrganization("org_c")).length, 0);
    assert.ok(await service.getForOrganization(a.request.id, "org_a"));
    // Another business cannot read it even with the exact id, and a public
    // request (no tenant) belongs to nobody.
    assert.equal(await service.getForOrganization(a.request.id, "org_b"), null);
  });

  it("the customer view hides internal fields", async () => {
    const service = setup();
    const { request } = await service.submit(valid, {
      organizationId: "org_a",
      source: "dashboard",
      createdByUserId: "usr_1",
    });
    const view = toWebsiteRequestView(request) as Record<string, unknown>;
    assert.equal("organizationId" in view, false);
    assert.equal("contactEmail" in view, false);
    assert.equal("contactPhone" in view, false);
    assert.equal(view.status, "submitted");
  });

  async function created(service: ReturnType<typeof setup>): Promise<WebsiteRequest> {
    return (await service.submit(valid, { organizationId: "org_a", source: "dashboard" }))
      .request;
  }

  it("walks submitted → in_review → quoted → in_progress → delivered", async () => {
    const service = setup();
    const { id } = await created(service);

    let result = await service.adminUpdate(id, { status: "in_review" });
    assert.equal(result.ok && result.request.status, "in_review");

    result = await service.adminUpdate(id, {
      status: "quoted",
      quotedPriceCad: 799,
      scopeSummary: "  5-page site, mobile-ready, contact form  ",
    });
    assert.equal(result.ok && result.request.quotedPriceCad, 799);
    assert.equal(
      result.ok && result.request.scopeSummary,
      "5-page site, mobile-ready, contact form",
    );

    result = await service.adminUpdate(id, { status: "in_progress" });
    assert.equal(result.ok && result.request.status, "in_progress");
    result = await service.adminUpdate(id, { status: "delivered" });
    assert.equal(result.ok && result.request.status, "delivered");
  });

  it("refuses to quote or start without a written scope and a price", async () => {
    const service = setup();
    const { id } = await created(service);
    assert.deepEqual(await service.adminUpdate(id, { status: "quoted" }), {
      ok: false,
      error: "quote_required",
    });
    assert.deepEqual(
      await service.adminUpdate(id, { status: "quoted", quotedPriceCad: 500 }),
      { ok: false, error: "quote_required" },
    );
    assert.deepEqual(
      await service.adminUpdate(id, { status: "quoted", scopeSummary: "scope" }),
      { ok: false, error: "quote_required" },
    );
  });

  it("refuses a price below the starting price and any skipped step", async () => {
    const service = setup();
    const { id } = await created(service);
    assert.deepEqual(
      await service.adminUpdate(id, {
        status: "quoted",
        quotedPriceCad: 200,
        scopeSummary: "scope",
      }),
      { ok: false, error: "price_too_low" },
    );
    assert.deepEqual(await service.adminUpdate(id, { status: "in_progress" }), {
      ok: false,
      error: "invalid_transition",
    });
    assert.deepEqual(await service.adminUpdate("wsr_missing", { status: "in_review" }), {
      ok: false,
      error: "not_found",
    });
  });

  it("locks the agreed scope and price once work has started", async () => {
    const service = setup();
    const { id } = await created(service);
    await service.adminUpdate(id, {
      status: "quoted",
      quotedPriceCad: 600,
      scopeSummary: "scope",
    });
    await service.adminUpdate(id, { status: "in_progress" });
    assert.deepEqual(await service.adminUpdate(id, { quotedPriceCad: 900 }), {
      ok: false,
      error: "locked",
    });
    // A finished request cannot be reopened.
    await service.adminUpdate(id, { status: "delivered" });
    assert.deepEqual(await service.adminUpdate(id, { status: "in_progress" }), {
      ok: false,
      error: "invalid_transition",
    });
  });

  it("can be cancelled from an open state", async () => {
    const service = setup();
    const { id } = await created(service);
    const result = await service.adminUpdate(id, { status: "cancelled" });
    assert.equal(result.ok && result.request.status, "cancelled");
  });
});
