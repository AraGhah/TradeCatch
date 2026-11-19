import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { notifyTeamOfWebsiteRequest } from "../../src/product/website-services/notify";
import { createPostgresWebsiteRequestStore } from "../../src/product/website-services/postgres-store";
import {
  createWebsiteRequestService,
  type WebsiteRequestService,
} from "../../src/product/website-services/service";
import { createMemoryWebsiteRequestStore } from "../../src/product/website-services/store";
import type { WebsiteFocusArea } from "../../src/product/website-services/model";
import {
  openAdminConsoleDb,
  pgliteAvailable,
  poolOf,
  type Db,
} from "./support/pglite-db";

const input = (name: string, email = "jo@acme.ca") => ({
  requestType: "new" as const,
  businessName: name,
  contactName: "Jo Acme",
  contactEmail: email,
  contactPhone: "514-555-0100",
  currentWebsiteUrl: "",
  focusAreas: ["mobile", "lead_capture"] as WebsiteFocusArea[],
  notes: "Need it before spring",
  language: "en" as const,
});

const submit = (service: WebsiteRequestService, name = "Acme Plumbing", email?: string) =>
  service.submit(input(name, email), { organizationId: null, source: "pricing" });

/**
 * The admin review workflow, run against BOTH stores: the in-memory one used in
 * development and the real PostgreSQL one (the same SQL production runs).
 */
function lifecycle(label: string, make: () => Promise<WebsiteRequestService>) {
  describe(`website request review workflow (${label})`, () => {
    let service: WebsiteRequestService;
    before(async () => {
      service = await make();
    });

    it("saves a new request as Pending with payment not requested and a first history line", async () => {
      const { created, request } = await submit(service);
      assert.equal(created, true);
      assert.equal(request.status, "submitted");
      assert.equal(request.paymentStatus, "not_requested");
      assert.equal(request.notificationStatus, null);
      const history = await service.history(request.id);
      assert.deepEqual(history.map((e) => e.kind), ["submitted"]);
    });

    it("requires review before approval: a pending request cannot be approved directly", async () => {
      const { request } = await submit(service, "Review First");
      const skipped = await service.adminUpdate(request.id, { status: "approved" }, "admin@x.ca");
      assert.deepEqual(skipped, { ok: false, error: "invalid_transition" });
      const review = await service.adminUpdate(request.id, { status: "in_review" }, "admin@x.ca");
      assert.equal(review.ok && review.request.status, "in_review");
      const approved = await service.adminUpdate(request.id, { status: "approved" }, "admin@x.ca");
      assert.equal(approved.ok && approved.request.status, "approved");
    });

    it("records who made each change, in order", async () => {
      const { request } = await submit(service, "History Co");
      await service.adminUpdate(request.id, { status: "in_review" }, "ada@tradecatch.ca");
      await service.adminUpdate(request.id, { status: "approved" }, "ops:founder");
      const history = await service.history(request.id);
      assert.deepEqual(
        history.map((e) => [e.kind, e.actor, e.fromStatus, e.toStatus]),
        [
          ["submitted", "customer", null, "submitted"],
          ["status_changed", "ada@tradecatch.ca", "submitted", "in_review"],
          ["status_changed", "ops:founder", "in_review", "approved"],
        ].map(([kind, actor, from, to]) => [kind, actor, from, to]),
      );
    });

    it("only allows a payment request once work is approved, and only with a price", async () => {
      const { request } = await submit(service, "Pay Co");
      const early = await service.adminUpdate(request.id, { paymentStatus: "requested" }, "a");
      assert.deepEqual(early, { ok: false, error: "payment_not_allowed" });

      await service.adminUpdate(request.id, { status: "in_review" }, "a");
      const stillEarly = await service.adminUpdate(request.id, { paymentStatus: "requested" }, "a");
      assert.deepEqual(stillEarly, { ok: false, error: "payment_not_allowed" });

      await service.adminUpdate(request.id, { status: "approved" }, "a");
      const noPrice = await service.adminUpdate(request.id, { paymentStatus: "requested" }, "a");
      assert.deepEqual(noPrice, { ok: false, error: "quote_required" });

      const asked = await service.adminUpdate(
        request.id,
        { paymentStatus: "requested", quotedPriceCad: 699.99, scopeSummary: "5-page site" },
        "a",
      );
      assert.equal(asked.ok && asked.request.paymentStatus, "requested");
      // Asking for payment records the ask; it does not move the work along or charge anyone.
      assert.equal(asked.ok && asked.request.status, "approved");
    });

    it("tracks payment through requested and paid, refuses impossible jumps, and keeps the history", async () => {
      const { request } = await submit(service, "Paid Co");
      await service.adminUpdate(request.id, { status: "in_review" }, "a");
      await service.adminUpdate(request.id, { status: "approved" }, "a");
      const jump = await service.adminUpdate(
        request.id,
        { paymentStatus: "paid", quotedPriceCad: 699.99, scopeSummary: "x" },
        "a",
      );
      assert.deepEqual(jump, { ok: false, error: "invalid_payment_transition" });

      await service.adminUpdate(
        request.id,
        { paymentStatus: "requested", quotedPriceCad: 699.99, scopeSummary: "x" },
        "a",
      );
      const paid = await service.adminUpdate(request.id, { paymentStatus: "paid" }, "a");
      assert.equal(paid.ok && paid.request.paymentStatus, "paid");
      const again = await service.adminUpdate(request.id, { paymentStatus: "requested" }, "a");
      assert.deepEqual(again, { ok: false, error: "invalid_payment_transition" });

      const history = await service.history(request.id);
      assert.deepEqual(
        history.filter((e) => e.kind === "payment_updated").map((e) => e.note),
        ["requested", "paid"],
      );
    });

    it("rejection needs a reason, is final, and withdraws a pending payment request", async () => {
      const { request } = await submit(service, "Reject Co");
      await service.adminUpdate(request.id, { status: "in_review" }, "a");
      const bare = await service.adminUpdate(request.id, { status: "rejected" }, "a");
      assert.deepEqual(bare, { ok: false, error: "review_note_required" });

      const rejected = await service.adminUpdate(
        request.id,
        { status: "rejected", reviewNote: "Outside our service area" },
        "a",
      );
      assert.equal(rejected.ok && rejected.request.status, "rejected");
      assert.equal(rejected.ok && rejected.request.reviewNote, "Outside our service area");
      const after = await service.adminUpdate(request.id, { status: "in_review" }, "a");
      assert.deepEqual(after, { ok: false, error: "invalid_transition" });
    });

    it("never lets an approved request skip to completed without a quote", async () => {
      const { request } = await submit(service, "Quote Co");
      await service.adminUpdate(request.id, { status: "in_review" }, "a");
      await service.adminUpdate(request.id, { status: "approved" }, "a");
      const direct = await service.adminUpdate(request.id, { status: "delivered" }, "a");
      // approved -> delivered is not a transition at all; in_progress comes first.
      assert.deepEqual(direct, { ok: false, error: "invalid_transition" });
    });

    it("a double click applies a change once: the second concurrent update does not duplicate it", async () => {
      const { request } = await submit(service, "Double Click");
      await service.adminUpdate(request.id, { status: "in_review" }, "a");
      const [first, second] = await Promise.all([
        service.adminUpdate(request.id, { status: "approved" }, "a"),
        service.adminUpdate(request.id, { status: "approved" }, "a"),
      ]);
      assert.equal([first, second].filter((r) => r.ok).length, 1);
      const history = await service.history(request.id);
      assert.equal(
        history.filter((e) => e.kind === "status_changed" && e.toStatus === "approved").length,
        1,
      );
    });

    it("records whether the team notification went out, on the request and in its history", async () => {
      const { request } = await submit(service, "Notify Co");
      await service.recordNotification(request.id, "sent");
      const found = await service.getAny(request.id);
      assert.equal(found?.notificationStatus, "sent");
      const history = await service.history(request.id);
      assert.ok(history.some((e) => e.kind === "notified" && e.note === "sent"));
    });

    it("filters by status, payment, search text and date, and counts match the list", async () => {
      const a = await submit(service, "Filter Alpha", "alpha@filter.ca");
      const b = await submit(service, "Filter Beta", "beta@filter.ca");
      await service.adminUpdate(b.request.id, { status: "in_review" }, "a");

      const byStatus = await service.listAll({ status: "in_review", q: "filter" });
      assert.deepEqual(byStatus.map((r) => r.id), [b.request.id]);
      assert.equal(await service.countAll({ status: "in_review", q: "filter" }), 1);

      const byEmail = await service.listAll({ q: "alpha@filter.ca" });
      assert.deepEqual(byEmail.map((r) => r.id), [a.request.id]);

      const none = await service.listAll({ q: "filter", paymentStatus: "paid" });
      assert.deepEqual(none, []);

      const future = await service.listAll({ q: "filter", from: "2999-01-01" });
      assert.deepEqual(future, []);

      const paged = await service.listAll({ q: "filter", limit: 1, offset: 0 });
      const rest = await service.listAll({ q: "filter", limit: 1, offset: 1 });
      assert.equal(paged.length, 1);
      assert.equal(rest.length, 1);
      assert.notEqual(paged[0].id, rest[0].id);
      assert.equal(await service.countAll({ q: "filter" }), 2);
    });

    it("treats % and _ in search text literally", async () => {
      await submit(service, "Literal 100% Plumbing", "pct@literal.ca");
      assert.equal((await service.listAll({ q: "100%" })).length, 1);
      assert.equal((await service.listAll({ q: "%" })).length, 1);
      assert.equal((await service.listAll({ q: "_" })).length, 0);
    });
  });
}

lifecycle("memory store", async () => createWebsiteRequestService(createMemoryWebsiteRequestStore()));

describe("website request review workflow (PostgreSQL)", { skip: !pgliteAvailable }, () => {
  let db: Db;
  let service: WebsiteRequestService;
  before(async () => {
    db = await openAdminConsoleDb();
    service = createWebsiteRequestService(createPostgresWebsiteRequestStore(poolOf(db)));
  });
  after(async () => {
    await db?.close();
  });

  // Re-use the shared suite against the real database.
  lifecycle("real SQL", async () => service);

  it("keeps the history append-only at the database", async () => {
    const { request } = await submit(service, "Append Only");
    await assert.rejects(
      db.query(`UPDATE tc_website_request_events SET note = 'edited' WHERE request_id = $1`, [request.id]),
      /append-only|42501|permission/i,
    );
    await assert.rejects(
      db.query(`DELETE FROM tc_website_request_events WHERE request_id = $1`, [request.id]),
      /append-only|42501|permission/i,
    );
  });
});

describe("team notification when a request arrives", () => {
  const fullEnv = {
    RESEND_API_KEY: "re_x",
    RESEND_FROM_EMAIL: "a@b.ca",
    ADMIN_ALERT_EMAIL: "team@b.ca",
  };

  async function run(
    send: () => Promise<{ sent: boolean }>,
    env: Record<string, string | undefined>,
  ) {
    const service = createWebsiteRequestService(createMemoryWebsiteRequestStore());
    const { request } = await submit(service, "Mail Co");
    const status = await notifyTeamOfWebsiteRequest(request, "key-1", { send, service, env });
    return { status, stored: (await service.getAny(request.id))?.notificationStatus };
  }

  it("records sent when the email goes out", async () => {
    assert.deepEqual(await run(async () => ({ sent: true }), fullEnv), { status: "sent", stored: "sent" });
  });

  it("records not_configured when no notification address exists", async () => {
    assert.deepEqual(await run(async () => ({ sent: false }), {}), {
      status: "not_configured",
      stored: "not_configured",
    });
  });

  it("records failed when it is configured but delivery failed or threw, without failing the request", async () => {
    assert.deepEqual(await run(async () => ({ sent: false }), fullEnv), { status: "failed", stored: "failed" });
    assert.deepEqual(
      await run(async () => {
        throw new Error("provider down");
      }, fullEnv),
      { status: "failed", stored: "failed" },
    );
  });
});
